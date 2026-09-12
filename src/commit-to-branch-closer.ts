import { existsSync } from "node:fs";
import type { CloseContext, CloseReport, CloserPort } from "./ports.js";
import { closerFromAcceptedHandler, removeWorktree } from "./closer-support.js";
import { ensureCommitted } from "./git-exec.js";

/**
 * Leave the accepted work committed on the surface's own branch, for a project
 * owner who wants to review before anything merges.
 *
 * With no merge to probe, the "have I already done this?" answer comes from the
 * cheapest git-adjacent signal there is: the scratch worktree's own existence.
 * Cleanup removes it last, so a worktree that is gone means a previous close ran
 * to completion. The branch is never deleted, on any outcome — it is the whole
 * point of this closer, and on a stopped surface it is what whoever takes over
 * continues from.
 *
 * Nothing is pushed and the base branch is never touched.
 */
export function createCommitToBranchCloser(): CloserPort {
  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (!existsSync(ctx.worktreePath)) {
      return {
        status: "DONE",
        detail:
          `Already closed: the scratch worktree is gone, so an earlier close already committed the work ` +
          `to ${ctx.branch} and cleaned up. ${ctx.branch} is untouched.`,
      };
    }

    await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    await removeWorktree(ctx);

    return {
      status: "DONE",
      detail:
        `The accepted work is committed on ${ctx.branch}, which was kept for review. Removed the scratch ` +
        `worktree. ${ctx.baseBranch} was not changed and nothing was pushed.`,
    };
  }

  return closerFromAcceptedHandler(closeAccepted);
}
