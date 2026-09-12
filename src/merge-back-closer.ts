import { existsSync } from "node:fs";
import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "./ports.js";
import { messageOf } from "./gate-support.js";
import { ensureCommitted, git, tryGit } from "./git-exec.js";
import { removeWorktree, teardownWorktree } from "./closer-support.js";

/**
 * Land the accepted work on the branch the surface was started from.
 *
 * Every "have I already done this?" answer comes from git state, because the
 * close report carries no resume token: a crash anywhere between the merge and
 * the surface recording the close replays this same function.
 *
 * The order is load-bearing: branch existence is checked, then (guarded by the
 * worktree still existing) `ensureCommitted`, and only then the ancestry probe
 * — never the reverse. The worker's changes are uncommitted at the start of a
 * first close, so an ancestry probe run before committing sees the surface
 * branch sitting exactly at the base tip and reports "already merged",
 * discarding the work. The
 * worktree-existence guard, not a branch-existence inference, is what lets a
 * `deleteBranch: false` replay skip straight to the ancestry probe once the
 * worktree is gone but the branch survived cleanup.
 *
 * The merge lands on the local base branch only. Nothing is pushed.
 */
export function createMergeBackCloser(options: { deleteBranch?: boolean } = {}): CloserPort {
  const deleteBranch = options.deleteBranch ?? true;

  async function cleanup(ctx: CloseContext): Promise<void> {
    // Worktree first, then branch, so a missing branch always implies a missing
    // worktree — though with deleteBranch:false the branch can outlive the
    // worktree, which is why callers never infer worktree presence from branch
    // presence.
    await removeWorktree(ctx);
    if (deleteBranch) {
      // Lower-case -d is git's own "is this merged?" guard.
      await tryGit(ctx.repoPath, ["branch", "-d", "--", ctx.branch]);
    }
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return { status: "ERROR", detail: "This surface has no pinned base branch, so there is nothing to merge into." };
    }

    const branchExists = await tryGit(ctx.repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${ctx.branch}`]);
    if (!branchExists) {
      return {
        status: "DONE",
        detail: `Already closed: branch ${ctx.branch} no longer exists, so an earlier close merged the work and cleaned up.`,
      };
    }

    // Guarded on the worktree's own existence, not on branch existence: with
    // deleteBranch:false a replay can find the branch still here after an
    // earlier close already removed the worktree, and worktreePath must never
    // be touched once it is gone. Run before the ancestry probe below — the
    // probe can only see committed work.
    if (existsSync(ctx.worktreePath)) {
      await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    }

    const nothingToLand = await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.branch, ctx.baseBranch]);
    if (nothingToLand) {
      await cleanup(ctx);
      const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      return {
        status: "DONE",
        detail:
          `Already merged: ${ctx.baseBranch} is at ${sha} and already has everything from ${ctx.branch} — ` +
          `nothing new to land. Cleaned up the scratch worktree.`,
      };
    }

    const head = await git(ctx.repoPath, ["symbolic-ref", "--short", "HEAD"]);
    if (head !== ctx.baseBranch) {
      return {
        status: "ERROR",
        detail:
          `The main checkout is on ${head}, not the base branch ${ctx.baseBranch}. ` +
          `Switching a checkout someone else may be using is not this closer's call, so nothing was changed. ` +
          `Check out ${ctx.baseBranch} there and close again.`,
      };
    }

    // The merge is its own conflict probe: --ff-only either advances the ref or
    // refuses, changing nothing either way.
    const merged = await tryGit(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]);
    if (!merged) {
      const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      return {
        status: "FAIL",
        detail:
          `Could not fast-forward ${ctx.baseBranch} onto ${ctx.branch}. ${ctx.baseBranch} is at ${tip}: either it has ` +
          `moved on since this surface started, or the checkout has local changes in the way. ` +
          `Nothing was changed and the work is still on ${ctx.branch}.`,
      };
    }

    const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
    await cleanup(ctx);
    const branchNote = deleteBranch ? `, and deleted ${ctx.branch}` : `. ${ctx.branch} was kept`;
    return {
      status: "DONE",
      detail:
        `Fast-forwarded ${ctx.baseBranch} to ${sha}, so the accepted work is now on ${ctx.baseBranch} in this checkout ` +
        `(nothing was pushed). Removed the scratch worktree${branchNote}.`,
    };
  }

  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      try {
        if (outcome.kind !== "accepted") {
          return await teardownWorktree(ctx, outcome);
        }
        return await closeAccepted(ctx);
      } catch (err) {
        // A closer never throws at the driver: an environment problem is an
        // ERROR report, which routes to close-triage like any other.
        return { status: "ERROR", detail: `The close could not run: ${messageOf(err)}` };
      }
    },
  };
}
