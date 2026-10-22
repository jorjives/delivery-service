import { readDelivery } from "../delivery-ledger.js";
import { ghReason } from "../gh.js";
import { branchExists, git } from "../git-exec.js";
import { listPullRequests } from "../pull-requests.js";
import { EXIT, Refusal } from "./failures.js";

/** The oldest git that has `rebase --update-refs`, which stack mode relies on. */
export const STACK_GIT_FLOOR = "2.38";

/** The refusal for a git older than `STACK_GIT_FLOOR`, or for output that does not name a version; undefined when git is new enough. */
export function stackGitRefusal(versionOutput: string): string | undefined {
  const match = /git version ((\d+)\.(\d+)(?:\.\d+)?)/.exec(versionOutput);
  const found = match?.[1] ?? versionOutput.trim();
  const [floorMajor = 0, floorMinor = 0] = STACK_GIT_FLOOR.split(".").map(Number);
  const older = match === null || Number(match[2]) < floorMajor || (Number(match[2]) === floorMajor && Number(match[3]) < floorMinor);
  if (!older) return undefined;
  return `Stack mode needs git ${STACK_GIT_FLOOR} or later, for \`rebase --update-refs\`, and this machine has git ${found}. Update git, or take \`stack\` off the \`open-pr\` closer in your config file.`;
}

/**
 * Whether stack mode may start on `branch` (the delivery branch of the repository at `repoPath`, recorded in `deliveryLedger`).
 * Throws a `Refusal` for a setup that cannot take it, and returns a reason when GitHub cannot be asked, so the caller can
 * record why it did not start; undefined when it may go ahead. Asks GitHub only for a rolling section on an existing branch.
 */
export async function checkStackSetup(repoPath: string, deliveryLedger: string, branch: string): Promise<string | undefined> {
  const versionRefusal = stackGitRefusal(await git(repoPath, ["--version"]));
  if (versionRefusal !== undefined) throw new Refusal(versionRefusal, EXIT.configuration);

  const state = await readDelivery(deliveryLedger, branch);
  if (state.stacked || !(await branchExists(repoPath, branch))) return undefined;

  if (state.pending.length > 0) {
    const keys = state.pending.map((entry) => entry.key).join(", ");
    throw new Refusal(
      `Stack mode cannot start while ${branch} holds work your closer has not taken yet: ${keys}. Take \`stack\` off the \`open-pr\` closer and run once so it reaches a pull request, merge or close that, then turn stack mode on.`,
      EXIT.configuration,
    );
  }

  const listing = await listPullRequests(repoPath, { heads: [branch] });
  if (!listing.ok) {
    return `Could not ask GitHub whether ${branch} has an open pull request (${ghReason(listing.failure)}), so stack mode cannot safely start. Run again once gh can reach GitHub.`;
  }
  const [open] = listing.pullRequests.filter((pr) => pr.state === "OPEN");
  if (open !== undefined) {
    throw new Refusal(
      `Stack mode cannot start while ${open.url}, the pull request for ${branch}, is open. Merge or close it on GitHub, then run again; or take \`stack\` off the \`open-pr\` closer to keep using it.`,
      EXIT.configuration,
    );
  }
  return undefined;
}
