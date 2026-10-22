import { baseTip, closeDeliveryBranch, deliveryBranchOf, type Reconciled } from "./delivery-branch.js";
import { readDelivery, recordDelivery } from "./delivery-ledger.js";
import { ghReason } from "./gh.js";
import { branchExists, git, tryGit } from "./git-exec.js";
import { listPullRequests, standingPullRequest } from "./pull-requests.js";
import type { CloseReport, DeliveredLevel } from "./ports.js";
import type { CloserRef } from "./schema.js";

/** Whether a closer publishes a stack of pull requests: the `open-pr` closer with `stack` on. */
export const isStacked = (closer: CloserRef): boolean => closer.type === "open-pr" && closer.stack === true;

/**
 * Make the delivery branch ready for a stack run: opened at the base's tip as a stacked section when none is open, and
 * started again from the base's tip, as a stacked section, when the open one is a rolling section (the first stack run;
 * checkStackSetup has already refused anything unsafe). Otherwise ready as it stands. Never merges the base in: each
 * level stays on the commit it landed on, and the owner's new base commits reach a stack by way of its base, not its tip.
 */
export async function reconcileStackBranch(repoPath: string, ledger: string): Promise<Reconciled> {
  const { base, commit: baseCommit } = await baseTip(repoPath);
  const branch = deliveryBranchOf(base);
  if (!(await branchExists(repoPath, branch))) {
    await git(repoPath, ["branch", "--", branch, baseCommit]);
  } else if ((await readDelivery(ledger, branch)).stacked) {
    return { ready: true, branch, base };
  } else {
    const tip = await git(repoPath, ["rev-parse", `refs/heads/${branch}`]);
    if (tip !== baseCommit) await git(repoPath, ["update-ref", `refs/heads/${branch}`, baseCommit, tip]);
  }
  await recordDelivery(ledger, { t: "opened", branch, base, from: baseCommit, stack: true });
  return { ready: true, branch, base };
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
