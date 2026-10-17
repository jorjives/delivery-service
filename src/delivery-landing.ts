import { appendEntry, load } from "./case-file.js";
import { closeError } from "./closer-support.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import { git, tryGit } from "./git-exec.js";
import { takeBaseline } from "./run-gate.js";
import { stepView } from "./workflow-step.js";
import type { CloseContext, CloseReport } from "./ports.js";
import type { LandingEntry } from "./schema.js";

/** A close on a moved delivery branch: a landing entry, already appended, or a report for the close entry. */
export type Rebuilt = { entry: LandingEntry } | { report: CloseReport };

const lines = (text: string): string[] => text.split("\n").filter(Boolean);

/**
 * Before a task on a delivery branch lands: undefined when the branch's tip is where the task last started from (or
 * already holds its work, a landing replayed after a crash), so the fast-forward goes ahead with nothing re-checked.
 * Otherwise the task is rebased onto the tip in its own worktree, never merged and never resolved: clean, it is
 * re-checked against the tip's baseline; conflicting, the rebase is undone and the next attempt starts at the tip.
 */
export async function rebuildIfMoved(dir: string, ctx: CloseContext, env?: NodeJS.ProcessEnv): Promise<Rebuilt | undefined> {
  const raw = await load(dir);
  const landed = raw.history.findLast((e): e is LandingEntry => e.t === "landing");
  const start = landed?.onto ?? raw.header.startCommit;
  const tip = await git(ctx.repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${ctx.baseBranch}`]).catch(() => undefined);
  if (tip === undefined || tip === start) return undefined;
  if (await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.branch, tip])) return undefined;

  const view = stepView(raw);
  const short = tip.slice(0, 7);
  const baseline = await inDetachedWorktree(ctx.repoPath, tip, (scratch) =>
    takeBaseline({ ...view, header: { ...view.header, startCommit: tip } }, { repoPath: ctx.repoPath, worktreePath: scratch }, env),
  );
  if (baseline.status === "ERROR") {
    return { report: closeError(`The checks could not run on ${ctx.baseBranch} at ${short}, so this task could not be rebuilt on it. Nothing was landed and the work is still on ${ctx.branch}.`) };
  }

  // A rebase a crash left half done is undone first, so this is safe to run again.
  await tryGit(ctx.worktreePath, ["rebase", "--abort"]);
  if (await tryGit(ctx.worktreePath, ["rebase", tip])) {
    const entry: LandingEntry = { t: "landing", onto: tip, baseline };
    await appendEntry(dir, entry);
    return { entry };
  }

  const files = lines(await git(ctx.worktreePath, ["diff", "--name-only", "--diff-filter=U"]));
  await tryGit(ctx.worktreePath, ["rebase", "--abort"]);
  if (files.length === 0) {
    return { report: closeError(`git could not rebuild ${ctx.branch} on ${ctx.baseBranch} at ${short}, although nothing conflicts. Nothing was landed and the work is still on ${ctx.branch}.`) };
  }
  return { entry: await recordConflict(dir, ctx, raw.history.filter((e) => e.t === "landing" && e.conflict !== undefined).length + 1, tip, baseline, files) };
}

// Replaced in the next change, which makes a conflict the next attempt's evidence.
async function recordConflict(_dir: string, ctx: CloseContext, _n: number, tip: string, _baseline: LandingEntry["baseline"], files: string[]): Promise<LandingEntry> {
  throw new Error(`rebuilding ${ctx.branch} on ${tip} conflicts in ${files.join(", ")}`);
}
