import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeError } from "./closer-support.js";
import { computeDelta } from "./delta-rule.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import { readDelivery, recordDelivery } from "./delivery-ledger.js";
import { branchExists, branchTip, conflictedFiles, git, tryGit } from "./git-exec.js";
import { messageOf } from "./gate-support.js";
import { resolveBaseRef } from "./provision.js";
import { resolveCloser } from "./resolve-closer.js";
import { resolveGate } from "./resolve-gate.js";
import { countsNewAssertions, type CloserRef, type GateRef } from "./schema.js";
import type { CloseReport, DeliveredTask } from "./ports.js";
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

/** Long enough for a slow network; short enough that an unreachable origin does not hold the run. */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * Bring the base's remote-tracking branch up to date from origin (spec §5.8), so a pull request merged on GitHub is
 * seen without the owner pulling: `baseTip` then prefers it. Moves only `refs/remotes/origin/<base>`, never a local
 * branch. A repository whose base is not taken from origin has nothing to fetch. Never throws: a failure (offline,
 * origin gone, a prompt for credentials refused) comes back with git's reason, for the run to report and carry on.
 */
export async function fetchBase(repoPath: string): Promise<{ base: string; reason: string } | undefined> {
  const { ref, localBranch } = await resolveBaseRef(repoPath);
  if (ref === localBranch) return undefined;
  try {
    await git(repoPath, ["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${localBranch}:refs/remotes/${ref}`], { env: { GIT_TERMINAL_PROMPT: "0" }, timeout: FETCH_TIMEOUT_MS });
    return undefined;
  } catch (err) {
    return { base: localBranch, reason: fetchFailure(err) };
  }
}

/** git's first line of complaint, without its "fatal: " prefix; or that it ran out of time. */
function fetchFailure(err: unknown): string {
  const { killed, stderr } = err as { killed?: boolean; stderr?: unknown };
  if (killed === true) return `it took longer than ${FETCH_TIMEOUT_MS / 1000} seconds`;
  const line = typeof stderr === "string" ? stderr.split("\n").map((l) => l.trim()).find((l) => l !== "") : undefined;
  return line === undefined ? messageOf(err) : line.replace(/^fatal: /, "");
}

export type Reconciled =
  | { ready: true; branch: string; base: string }
  | { ready: false; branch: string; base: string; reason: string; repeated: boolean };

/**
 * Make the delivery branch ready for a run's tasks: open it at the base's tip when none is open, when the base already
 * has all it held (a merge-commit merge), or when GitHub reports its tip as the head of a merged pull request
 * (`mergedTips`, supplied for the `open-pr` closer only: a squash or rebase merge leaves nothing in the history to see);
 * bring the owner's own base commits in, by merge, when that is clean and the checks still pass; otherwise say what
 * blocks it. A blocked attempt is not repeated until the base or the branch moves.
 */
export async function reconcileDeliveryBranch(
  repoPath: string,
  gateRef: GateRef,
  ledger: string,
  env?: NodeJS.ProcessEnv,
  mergedTips: ReadonlySet<string> = new Set(),
): Promise<Reconciled> {
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

  if (mergedTips.has(tip) || (await isAncestor(repoPath, tip, baseCommit))) {
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

/**
 * Whether the open delivery branch's work has merged: its tip is an ancestor of the base (as `baseTip` reads it) or is in
 * `mergedTips`, so reconciling would start it again from the base at no cost. False with no branch open, or with the
 * branch already at the base's tip.
 */
export async function deliveryMerged(repoPath: string, mergedTips: ReadonlySet<string>): Promise<boolean> {
  const { base, commit } = await baseTip(repoPath);
  const tip = await branchTip(repoPath, deliveryBranchOf(base));
  return tip !== undefined && tip !== commit && (mergedTips.has(tip) || (await isAncestor(repoPath, tip, commit)));
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
    const files = await conflictedFiles(scratch);
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

/**
 * The project's closer, once, on the delivery branch (spec §5.7): given a scratch worktree of the branch's tip, removed
 * afterwards, and every task landed on it since it opened. What it did is recorded either way: a branch it did not take
 * stands, and the next run tries again.
 */
export async function closeDeliveryBranch(
  { repoPath, closerRef, ledger, branch, base }: { repoPath: string; closerRef: CloserRef; ledger: string; branch: string; base: string },
  landed: readonly DeliveredTask[],
): Promise<CloseReport> {
  const scratch = join(await mkdtemp(join(tmpdir(), "delivery-close-")), "tree");
  try {
    const report = (await tryGit(repoPath, ["worktree", "add", "--", scratch, branch]))
      ? await resolveCloser(closerRef, repoPath).close({ worktreePath: scratch, dir: dirname(ledger), repoPath, branch, baseBranch: base, delivery: { landed } }, { kind: "accepted" })
      : closeError(`${branch} could not be checked out in a scratch copy for your closer, most often because it is checked out somewhere else. Nothing was handed off; check out another branch there and run again.`);
    await recordDelivery(ledger, { t: "closed", branch, status: report.status, detail: report.detail });
    return report;
  } finally {
    await tryGit(repoPath, ["worktree", "remove", "--force", "--", scratch]);
    await tryGit(repoPath, ["worktree", "prune"]);
  }
}
