import { computeDelta } from "./delta-rule.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import { readDelivery, recordDelivery } from "./delivery-ledger.js";
import { branchExists, git, tryGit } from "./git-exec.js";
import { resolveBaseRef } from "./provision.js";
import { resolveGate } from "./resolve-gate.js";
import { countsNewAssertions, type GateRef } from "./schema.js";
import type { GateContext } from "./command-gate.js";

/** The one delivery branch per base branch (spec §5.7). */
export const deliveryBranchOf = (base: string): string => `delivery/${base}`;

const isAncestor = (repoPath: string, older: string, newer: string): Promise<boolean> => tryGit(repoPath, ["merge-base", "--is-ancestor", older, newer]);

/**
 * The base branch and the commit it is at: the local branch, unless the remote-tracking branch is strictly ahead of it
 * (the owner merged a pull request and fetched, without pulling). Nothing is fetched here.
 */
export async function baseTip(repoPath: string): Promise<{ base: string; commit: string }> {
  const { ref, localBranch } = await resolveBaseRef(repoPath);
  const local = await git(repoPath, ["rev-parse", `refs/heads/${localBranch}`]);
  if (ref === localBranch) return { base: localBranch, commit: local };
  const remote = await git(repoPath, ["rev-parse", ref]).catch(() => local);
  return { base: localBranch, commit: remote !== local && (await isAncestor(repoPath, local, remote)) ? remote : local };
}

export type Reconciled =
  | { ready: true; branch: string; base: string }
  | { ready: false; branch: string; base: string; reason: string; repeated: boolean };

/**
 * Make the delivery branch ready for a run's tasks: open it at the base's tip when none is open or the base already has
 * all it held; bring the owner's own base commits in, by merge, when that is clean and the checks still pass; otherwise
 * say what blocks it. A blocked attempt is not repeated until the base or the branch moves.
 * ponytail: a pull request merged by squash is not seen as reached; the base is then brought in by merge, which is clean.
 */
export async function reconcileDeliveryBranch(repoPath: string, gateRef: GateRef, ledger: string, env?: NodeJS.ProcessEnv): Promise<Reconciled> {
  const { base, commit: baseCommit } = await baseTip(repoPath);
  const branch = deliveryBranchOf(base);
  const ready = { ready: true as const, branch, base };
  const state = await readDelivery(ledger, branch);

  if (!(await branchExists(repoPath, branch))) {
    await git(repoPath, ["branch", "--", branch, baseCommit]);
    await recordDelivery(ledger, { t: "opened", branch, base, from: baseCommit });
    return ready;
  }
  const tip = await git(repoPath, ["rev-parse", `refs/heads/${branch}`]);

  if (await isAncestor(repoPath, tip, baseCommit)) {
    if (tip !== baseCommit) await git(repoPath, ["update-ref", `refs/heads/${branch}`, baseCommit, tip]);
    if (tip !== baseCommit || state.landed.length > 0 || state.openedAt === null) await recordDelivery(ledger, { t: "opened", branch, base, from: baseCommit });
    return ready;
  }
  if (await isAncestor(repoPath, baseCommit, tip)) return ready;

  const { blocked } = state;
  if (blocked !== null && blocked.baseTip === baseCommit && blocked.tip === tip) return { ready: false, branch, base, reason: blocked.reason, repeated: true };

  const merged = await inDetachedWorktree(repoPath, tip, (scratch) => mergeBaseIn(scratch, { repoPath, base, baseCommit, branch, tip, gateRef, env }));
  if ("commit" in merged) {
    await git(repoPath, ["update-ref", `refs/heads/${branch}`, merged.commit, tip]);
    await recordDelivery(ledger, { t: "base_merged", branch, base, commit: merged.commit });
    return ready;
  }
  await recordDelivery(ledger, { t: "blocked", branch, base, baseTip: baseCommit, tip, reason: merged.reason });
  return { ready: false, branch, base, reason: merged.reason, repeated: false };
}

/** Merge the base into a scratch copy of the delivery tip and check it as a task's work is checked: against the tip's baseline. */
async function mergeBaseIn(
  scratch: string,
  { repoPath, base, baseCommit, branch, tip, gateRef, env }: { repoPath: string; base: string; baseCommit: string; branch: string; tip: string; gateRef: GateRef; env: NodeJS.ProcessEnv | undefined },
): Promise<{ commit: string } | { reason: string }> {
  // repoPath is where a custom gate's module resolves from; the gate measures the scratch copy via gateCtx.worktreePath.
  const gate = resolveGate(gateRef, repoPath);
  // The same shape run-gate's gateContext builds; DELIVERY_STEP_START is the delivery tip the merge is judged from.
  const gateCtx: GateContext = { worktreePath: scratch, taskDef: { intent: `Bring ${base} into ${branch}` }, gateRef, baseBranch: base, env: { ...(env ?? process.env), DELIVERY_STEP_START: tip } };
  const owner = `Bring ${base} into ${branch} yourself, or land ${branch} through your closer, then run again.`;
  const before = await gate.baseline(gateCtx);
  if (before.status === "ERROR") return { reason: `The checks could not run on ${branch}, so ${base}'s new commits could not be brought in. ${owner}` };
  if (!(await tryGit(scratch, ["merge", "--no-ff", "-m", `Bring ${base} into ${branch}`, baseCommit]))) {
    const files = (await git(scratch, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
    await tryGit(scratch, ["merge", "--abort"]);
    return { reason: `${base} has new commits that conflict with work on ${branch}${files.length > 0 ? ` in ${files.join(", ")}` : ""}. ${owner}` };
  }
  const delta = computeDelta(before, await gate.check(gateCtx), { failOnNewAssertions: countsNewAssertions(gateRef) });
  if (!delta.pass) {
    const failing = delta.newFailures.map((f) => f.id).join(", ");
    return { reason: `With ${base}'s new commits brought in, the checks fail on ${branch}${failing === "" ? "" : `: ${failing}`}. ${owner}` };
  }
  return { commit: await git(scratch, ["rev-parse", "HEAD"]) };
}
