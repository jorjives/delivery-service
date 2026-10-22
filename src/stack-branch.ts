import { FETCH_TIMEOUT_MS, baseTip, closeDeliveryBranch, deliveryBranchOf } from "./delivery-branch.js";
import { readDelivery, recordDelivery } from "./delivery-ledger.js";
import { planStack, pullsFingerprint, readStack, type ObservedPull, type StackLevel } from "./delivery-stack.js";
import { ghReason } from "./gh.js";
import { ghFailureReason } from "./github-source.js";
import { branchExists, git, tryGit } from "./git-exec.js";
import { readItemLedger, recordMoved } from "./item-ledger.js";
import { listPullRequests, standingPullRequest } from "./pull-requests.js";
import { moveRefs, restackLevels, type RestackLevel } from "./restack.js";
import type { CloseReport, DeliveredLevel } from "./ports.js";
import type { CloserRef, GateRef } from "./schema.js";

/** Whether a closer publishes a stack of pull requests: the `open-pr` closer with `stack` on. */
export const isStacked = (closer: CloserRef): boolean => closer.type === "open-pr" && closer.stack === true;

/** What the run found of the delivery branch's stack: ready to hand off, with what GitHub shows for each level; or blocked, with why. */
export type StackReconciled =
  | { ready: true; branch: string; base: string; reported: ReadonlyMap<string /* level ref */, string /* head */> }
  | { ready: false; branch: string; base: string; reason: string; repeated: boolean };

export const couldNotAskStackState = (reason: string): string =>
  `Could not ask GitHub for the state of the stack's pull requests: ${reason} The stack was left as it is.`;

const NOTHING: ReadonlyMap<string, string> = new Map();

/**
 * Make the delivery branch ready for a stack run, and move a stack whose bottom GitHub shows merged. A branch with no
 * open section is opened at the base's tip; a rolling section is started again from the base's tip as a stacked section
 * (the first stack run; checkStackSetup has already refused anything unsafe). A stacked section asks GitHub once about
 * every level, then either moves the levels still open onto the base, records why it cannot, or leaves them as they are.
 * Never merges the base in: each level stays on the commit it landed on, and the owner's new base commits reach a stack by
 * way of its base, not its tip. With `opens` off, a branch that is missing or rolling is left alone.
 */
export async function reconcileStackBranch(
  repoPath: string,
  ledger: string,
  options: { gateRef: GateRef; itemLedger: string; env?: NodeJS.ProcessEnv; opens?: boolean },
): Promise<StackReconciled> {
  const { gateRef, itemLedger, env, opens = true } = options;
  const { base, commit: baseCommit } = await baseTip(repoPath);
  const branch = deliveryBranchOf(base);
  const ready = (reported: ReadonlyMap<string, string>): StackReconciled => ({ ready: true, branch, base, reported });

  const exists = await branchExists(repoPath, branch);
  const delivery = exists ? await readDelivery(ledger, branch) : undefined;
  if (delivery?.stacked !== true) {
    if (!opens) return ready(NOTHING);
    if (exists) {
      const tip = await git(repoPath, ["rev-parse", `refs/heads/${branch}`]);
      if (tip !== baseCommit) await git(repoPath, ["update-ref", `refs/heads/${branch}`, baseCommit, tip]);
    } else {
      await git(repoPath, ["branch", "--", branch, baseCommit]);
    }
    await recordDelivery(ledger, { t: "opened", branch, base, from: baseCommit, stack: true });
    return ready(NOTHING);
  }

  const levels = await readStack(repoPath, ledger, branch);
  if (levels.length === 0) return ready(NOTHING);

  const listing = await listPullRequests(repoPath, { heads: levels.map((level) => level.ref) }, { state: "all" });
  if (!listing.ok) return { ready: false, branch, base, reason: couldNotAskStackState(ghFailureReason(listing.failure)), repeated: false };
  const observed = new Map<string, ObservedPull>();
  for (const level of levels) {
    const pr = standingPullRequest(listing.pullRequests.filter((candidate) => candidate.headRefName === level.ref));
    if (pr !== undefined) observed.set(level.ref, { url: pr.url, state: pr.state, head: pr.headRefOid, base: pr.baseRefName, mergeCommit: pr.mergeCommit?.oid ?? null });
  }

  const tip = await git(repoPath, ["rev-parse", `refs/heads/${branch}`]);
  const pulls = pullsFingerprint(observed);
  const blocked = delivery.blocked;
  if (blocked?.baseTip === baseCommit && blocked.tip === tip && blocked.pulls === pulls) {
    return { ready: false, branch, base, reason: blocked.reason, repeated: true };
  }

  const held = new Set<string>();
  for (const pull of observed.values()) {
    if (pull.state === "MERGED" && pull.mergeCommit !== null && (await tryGit(repoPath, ["merge-base", "--is-ancestor", pull.mergeCommit, baseCommit]))) {
      held.add(pull.mergeCommit);
    }
  }
  const carried = await carriedLevels(repoPath, levels, observed);

  const plan = planStack(levels, observed, { base, held, carried });
  if (plan.kind === "blocked") {
    await recordDelivery(ledger, { t: "blocked", branch, base, baseTip: baseCommit, tip, reason: plan.reason, pulls });
    return { ready: false, branch, base, reason: plan.reason, repeated: false };
  }
  if (plan.kind === "restack") {
    const reason = await restackStack(repoPath, { ledger, itemLedger, gateRef, env, branch, base, baseCommit, tip, pulls }, observed, plan.merged, plan.remaining);
    if (reason !== undefined) return { ready: false, branch, base, reason, repeated: false };
  }

  const after = await readStack(repoPath, ledger, branch);
  await repairItems(itemLedger, branch, after);
  const reported = new Map<string, string>();
  for (const level of after) {
    const pull = observed.get(level.ref);
    if (pull !== undefined) reported.set(level.ref, pull.head);
  }
  return ready(reported);
}

/**
 * For each merged level whose pull request merged into the level below it, whether its merge commit is in the head the
 * level below had when it merged: asked of origin only when a level like that exists, in one fetch of those heads into
 * FETCH_HEAD. A fetch that fails leaves every level unasked, so it waits. A level whose head is not local is left out.
 */
async function carriedLevels(repoPath: string, levels: readonly StackLevel[], observed: ReadonlyMap<string, ObservedPull>): Promise<Map<string, boolean>> {
  const carried = new Map<string, boolean>();
  const asked = levels.flatMap((level, i) => {
    const below = levels[i - 1];
    const pull = observed.get(level.ref);
    const belowPull = below === undefined ? undefined : observed.get(below.ref);
    if (below === undefined || belowPull?.state !== "MERGED" || pull?.state !== "MERGED" || pull.base !== below.ref || pull.mergeCommit === null) return [];
    return [{ level, belowPull, mergeCommit: pull.mergeCommit }];
  });
  if (asked.length === 0) return carried;
  const refspecs = [...new Set(asked.map(({ belowPull }) => belowPull.url))].flatMap((url) => {
    const number = /\/pull\/(\d+)/.exec(url)?.[1];
    return number === undefined ? [] : [`refs/pull/${number}/head`];
  });
  if (!(await fetchPullHeads(repoPath, refspecs))) return carried;
  for (const { level, belowPull, mergeCommit } of asked) {
    if (!(await tryGit(repoPath, ["cat-file", "-e", `${belowPull.head}^{commit}`]))) continue;
    carried.set(level.ref, await tryGit(repoPath, ["merge-base", "--is-ancestor", mergeCommit, belowPull.head]));
  }
  return carried;
}

/** Fetch the given pull request heads into FETCH_HEAD alone: no branch or tag moves. False when origin cannot be asked. */
async function fetchPullHeads(repoPath: string, refspecs: readonly string[]): Promise<boolean> {
  try {
    await git(repoPath, ["fetch", "--quiet", "--no-tags", "origin", ...refspecs], { env: { GIT_TERMINAL_PROMPT: "0" }, timeout: FETCH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

interface StackRun {
  ledger: string;
  itemLedger: string;
  gateRef: GateRef;
  env: NodeJS.ProcessEnv | undefined;
  branch: string;
  base: string;
  baseCommit: string;
  tip: string;
  pulls: string;
}

/**
 * Act on a stack whose bottom levels have all reached the base: empty it when every level has merged; retarget it when
 * the top merged level is already in the base; otherwise replay the levels still open onto the base, then move their refs
 * and record the move. Returns the reason the stack is blocked (recorded) or undefined when it has moved or was left as it is.
 */
async function restackStack(
  repoPath: string,
  run: StackRun,
  observed: ReadonlyMap<string, ObservedPull>,
  merged: readonly StackLevel[],
  remaining: readonly StackLevel[],
): Promise<string | undefined> {
  const { ledger, itemLedger, gateRef, env, branch, base, baseCommit, tip, pulls } = run;
  const upstream = merged.at(-1)?.commit;
  if (upstream === undefined) throw new Error("A stack restack moves past at least one merged level");
  const mergedRuns = merged.map((level) => level.run);

  if (remaining.length === 0) {
    await git(repoPath, ["update-ref", `refs/heads/${branch}`, baseCommit, tip]);
    await recordDelivery(ledger, { t: "opened", branch, base, from: baseCommit, stack: true });
    return undefined;
  }
  if (await tryGit(repoPath, ["merge-base", "--is-ancestor", upstream, baseCommit])) {
    await recordDelivery(ledger, { t: "restacked", branch, onto: baseCommit, merged: mergedRuns, levels: remaining.map((level) => ({ runId: level.run, commit: level.commit })) });
    return undefined;
  }

  const levels: RestackLevel[] = remaining.map((level, i) => ({ ref: level.ref, commit: level.commit, intent: level.intent, position: merged.length + i + 1, pull: observed.get(level.ref)?.url ?? null }));
  const restacked = await restackLevels({ repoPath, gateRef, base, ...(env === undefined ? {} : { env }) }, { onto: baseCommit, upstream, levels });
  if ("reason" in restacked) {
    await recordDelivery(ledger, { t: "blocked", branch, base, baseTip: baseCommit, tip, reason: restacked.reason, pulls });
    return restacked.reason;
  }

  const moved = remaining.map((level, i) => ({ level, commit: restacked.commits[i] ?? level.commit }));
  await moveRefs(repoPath, [
    ...moved.map(({ level, commit }) => ({ ref: `refs/heads/${level.ref}`, to: commit })),
    { ref: `refs/heads/${branch}`, to: moved.at(-1)?.commit ?? tip },
  ]);
  await recordDelivery(ledger, { t: "restacked", branch, onto: baseCommit, merged: mergedRuns, levels: moved.map(({ level, commit }) => ({ runId: level.run, commit })) });
  for (const { level, commit } of moved) await recordMoved(itemLedger, level.item, branch, commit);
  return undefined;
}

/**
 * Each level's item is brought to the level's commit, when the item's last run is this level's run: a run that stopped
 * between recording a restack and recording the items' moves is finished here, so the moved item does not read as
 * unfinished and get dispatched again. A later run of the same item is never rewritten.
 */
async function repairItems(itemLedger: string, branch: string, levels: readonly StackLevel[]): Promise<void> {
  const items = await readItemLedger(itemLedger);
  for (const level of levels) {
    const state = items.get(level.item);
    if (state?.lastRunId === level.run && state.commit !== level.commit) await recordMoved(itemLedger, level.item, branch, level.commit);
  }
}

/**
 * The project's closer on a stacked delivery branch: each level's ref is created at the commit it landed at, unless the
 * ref already exists (then it stays where it is), and the stack is handed to the closer. Then what GitHub shows for each
 * level is recorded, whatever the close's status, since a close that failed part way may still have opened some pull
 * requests. When GitHub cannot be asked, `unobserved` carries gh's reason and nothing is recorded.
 */
export async function closeDeliveryStack(
  target: { repoPath: string; closerRef: CloserRef; ledger: string; branch: string; base: string },
  levels: readonly DeliveredLevel[],
): Promise<{ report: CloseReport; unobserved?: string }> {
  const { repoPath, ledger, branch } = target;
  // The empty old value makes git refuse to move a ref that already exists.
  for (const level of levels) await tryGit(repoPath, ["update-ref", `refs/heads/${level.ref}`, level.commit, ""]);
  const report = await closeDeliveryBranch(target, levels, levels);

  const refs = levels.map((level) => level.ref);
  const listing = await listPullRequests(repoPath, { heads: refs }, { state: "all" });
  if (!listing.ok) return { report, unobserved: ghReason(listing.failure) };
  const pullRequests = refs.flatMap((ref) => {
    const pr = standingPullRequest(listing.pullRequests.filter((candidate) => candidate.headRefName === ref));
    return pr === undefined ? [] : [{ ref, url: pr.url, state: pr.state }];
  });
  await recordDelivery(ledger, { t: "observed", branch, pullRequests });
  return { report };
}
