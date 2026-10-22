import { computeDelta } from "./delta-rule.js";
import { deliveryGateContext } from "./delivery-branch.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import { conflictedFiles, git, tryGit } from "./git-exec.js";
import { resolveGate } from "./resolve-gate.js";
import { countsNewAssertions, type GateRef } from "./schema.js";

/** One level of a stack to move: its branch, the commit it stands at, and what its pull request says. */
export interface RestackLevel {
  ref: string;
  commit: string;
  intent: string;
  /** 1-based, bottom first, as the stack status numbers it. */
  position: number;
  /** The level's pull request, when it has one. */
  pull: string | null;
  /**
   * A commit pushed to the level's branch that extends `commit`. When set, the level's content is replayed from
   * `adopted` instead of `commit`; the level above is still replayed from `commit`, the commit it was built on.
   */
  adopted?: string;
}

export type Restacked = { commits: string[] } | { reason: string };

/**
 * Replay each level, bottom first, onto the commit below it in a scratch copy of `onto`, checking each as it lands:
 * the commits the levels now stand at, or the reason the first one that cannot move was left where it was. Nothing
 * outside the scratch copy moves; `moveRefs` moves the branches once every level has come through. `at` names where
 * the levels move onto, for the reasons. A level whose upstream is the commit it is to stand on is not replayed: its
 * tip (`adopted`, else `commit`) is taken as it is, so a merge commit pushed to its branch survives.
 */
export async function restackLevels(
  { repoPath, gateRef, base, env }: { repoPath: string; gateRef: GateRef; base: string; env?: NodeJS.ProcessEnv },
  { onto, upstream, at, levels }: { onto: string; upstream: string; at: string; levels: readonly RestackLevel[] },
): Promise<Restacked> {
  const gate = resolveGate(gateRef, repoPath);
  return inDetachedWorktree(repoPath, onto, async (scratch) => {
    const commits: string[] = [];
    let parent = onto;
    let below = upstream;
    for (const level of levels) {
      const where = level.pull ?? level.ref;
      const described = `level ${level.position}, ${level.intent} (${where})`;
      const tip = level.adopted ?? level.commit;
      const takenAsIs = below === parent;
      await git(scratch, ["checkout", "--detach", parent]);
      const gateContext = () => deliveryGateContext(scratch, { intent: level.intent, gateRef, base, start: parent, env });
      const before = await gate.baseline(gateContext());
      if (before.status === "ERROR") {
        return { reason: `The checks could not run beneath ${described}, on ${at}, so the stack was left as it is.` };
      }
      await tryGit(scratch, ["rebase", "--abort"]);
      if (takenAsIs) {
        await git(scratch, ["checkout", "--detach", tip]);
      } else if (!(await tryGit(scratch, ["rebase", "--onto", parent, below, tip]))) {
        const files = await conflictedFiles(scratch);
        await tryGit(scratch, ["rebase", "--abort"]);
        if (files.length === 0) return { reason: `git could not move ${described}, onto ${at}, although nothing conflicts. The stack was left as it is.` };
        return { reason: `Moving the stack onto ${at}: ${described}, conflicts in ${files.join(", ")}. Resolve the conflict on that pull request's branch, then run again.` };
      }
      const moved = await git(scratch, ["rev-parse", "HEAD"]);
      const delta = computeDelta(before, await gate.check(gateContext()), { failOnNewAssertions: countsNewAssertions(gateRef) });
      if (!delta.pass) {
        const ids = delta.newFailures.map((f) => f.id).join(", ");
        const idsText = ids === "" ? "" : `: ${ids}`;
        if (takenAsIs) {
          return { reason: `${described}, with the commits pushed to its branch, fails the checks${idsText}. Fix it on that pull request's branch, then run again.` };
        }
        return { reason: `Moved onto ${at}, ${described}, fails the checks${idsText}. Fix it on that pull request's branch, then run again.` };
      }
      commits.push(moved);
      parent = moved;
      below = level.commit;
    }
    return { commits };
  });
}

/**
 * Move every ref to its new commit in one transaction: all of them, or none when any one is refused. A ref that does
 * not exist yet is created. `ref` is the full name, `refs/heads/...`.
 */
export async function moveRefs(repoPath: string, moves: readonly { ref: string; to: string }[]): Promise<void> {
  const lines: string[] = [];
  for (const { ref, to } of moves) {
    const current = await git(repoPath, ["rev-parse", "--verify", "--quiet", ref]).catch(() => undefined);
    lines.push(current === undefined ? `create ${ref} ${to}` : `update ${ref} ${to} ${current}`);
  }
  await git(repoPath, ["update-ref", "--stdin"], { input: `${lines.join("\n")}\n` });
}
