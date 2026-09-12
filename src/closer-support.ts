import { tryGit } from "./git-exec.js";
import type { CloserPort, CloseContext, CloseOutcome, CloseReport } from "./ports.js";

/**
 * A closer that reports the same failure however it is called. Resolution
 * failures use this so a caller never has to distinguish "failed to resolve"
 * from "failed to run" — both are just an ERROR report, exactly as `failedGate`
 * does for gates.
 */
export function failedCloser(detail: string): CloserPort {
  return { close: () => Promise.resolve({ status: "ERROR", detail }) };
}

/**
 * Drop a scratch worktree, tolerating "already gone" exactly as provisioning
 * does: on a replay the removal has usually already happened, and a closer has
 * no resume token to tell it so. `prune` clears the administrative entry left
 * behind when the directory itself vanished without git's help.
 */
export async function removeWorktree(ctx: CloseContext): Promise<void> {
  await tryGit(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
  await tryGit(ctx.repoPath, ["worktree", "prune"]);
}

/**
 * What every built-in closer does when the surface did not end accepted: clear
 * the scratch directory, keep the branch. The branch is what whoever takes over
 * an escalation inspects or continues from, so no built-in ever deletes it on a
 * stopped surface.
 *
 * Idempotent by construction — both calls tolerate an absent worktree — because
 * a teardown failure is only logged by the driver, so a later replay is the only
 * thing that will ever try again.
 */
export async function teardownWorktree(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> {
  await removeWorktree(ctx);
  return {
    status: "DONE",
    detail:
      `The surface ended ${outcome.kind}, so nothing was landed. Removed its scratch worktree and kept ` +
      `branch ${ctx.branch}, where the work was left for whoever takes it over.`,
  };
}
