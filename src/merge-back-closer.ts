import { existsSync } from "node:fs";
import type { CloseContext, CloseReport, CloserPort } from "./ports.js";
import { branchExists, git, tryGit } from "./git-exec.js";
import { closerFromAcceptedHandler, commitAccepted, removeWorktree } from "./closer-support.js";

/** The worktree that has `branch` checked out, or null when none does. */
async function checkoutOf(repoPath: string, branch: string): Promise<string | null> {
  const listing = await git(repoPath, ["worktree", "list", "--porcelain"]);
  const holder = listing.split("\n\n").find((block) => block.split("\n").includes(`branch refs/heads/${branch}`));
  return holder?.split("\n")[0]?.replace(/^worktree /, "") ?? null;
}

function movedOn(ctx: CloseContext, tip: string): CloseReport {
  return {
    status: "FAIL",
    detail:
      `${ctx.baseBranch} has moved on since this surface started: it is now at ${tip}, which ${ctx.branch} ` +
      `does not include, so ${ctx.baseBranch} cannot be fast-forwarded onto the work. Nothing was changed and ` +
      `the work is still on ${ctx.branch}. Bring ${ctx.branch} up to date with ${ctx.baseBranch}, or undo the ` +
      `new commits on ${ctx.baseBranch}, and close again; or choose a different close.`,
  };
}

/**
 * Land the accepted work on the branch the surface was started from.
 *
 * Every "have I already done this?" answer comes from git state, because the
 * close report carries no resume token: a crash anywhere between the merge and
 * the surface recording the close replays this same function.
 *
 * The order is load-bearing: branch existence is checked, then (guarded by the
 * worktree still existing) `commitAccepted`, and only then the ancestry probe
 * — never the reverse. The worker's changes are uncommitted at the start of a
 * first close, so an ancestry probe run before committing sees the surface
 * branch sitting exactly at the base tip and reports "already merged",
 * discarding the work. The
 * worktree-existence guard, not a branch-existence inference, is what lets a
 * `deleteBranch: false` replay skip straight to the ancestry probe once the
 * worktree is gone but the branch survived cleanup.
 *
 * The merge lands on the local base branch only: through the checkout that has it, or, when none does, by moving the branch itself. Nothing is pushed.
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
      // Both callers have just verified the branch is an ancestor of the base. -d would
      // instead check against the branch's upstream (origin/main), which a local-only
      // fast-forward has not reached, and would refuse.
      await tryGit(ctx.repoPath, ["branch", "-D", "--", ctx.branch]);
    }
  }

  // No checkout holds the base, so no files need updating: moving its ref is the whole fast-forward.
  // The old value makes the move its own check, as --ff-only is: a base moved since it was read is refused, changing nothing.
  async function moveBase(ctx: CloseContext): Promise<CloseReport> {
    const old = await git(ctx.repoPath, ["rev-parse", `refs/heads/${ctx.baseBranch}`]);
    const work = await git(ctx.repoPath, ["rev-parse", `refs/heads/${ctx.branch}`]);
    const fastForward = await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", old, work]);
    if (!fastForward || !(await tryGit(ctx.repoPath, ["update-ref", `refs/heads/${ctx.baseBranch}`, work, old]))) {
      return movedOn(ctx, await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]));
    }
    const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
    await cleanup(ctx);
    const branchNote = deleteBranch ? `, and deleted ${ctx.branch}` : `. ${ctx.branch} was kept`;
    return {
      status: "DONE",
      detail:
        `Fast-forwarded ${ctx.baseBranch} to ${sha}. No checkout has ${ctx.baseBranch}, so no files were touched ` +
        `(nothing was pushed). Removed the scratch worktree${branchNote}.`,
    };
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return { status: "ERROR", detail: "This surface has no pinned base branch, so there is nothing to merge into." };
    }

    const branchIsThere = await branchExists(ctx.repoPath, ctx.branch);
    if (!branchIsThere) {
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
      await commitAccepted(ctx);
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

    const holder = await checkoutOf(ctx.repoPath, ctx.baseBranch);
    if (holder === null) return moveBase(ctx);
    const here = await git(ctx.repoPath, ["rev-parse", "--show-toplevel"]);
    if (holder !== here) {
      return {
        status: "ERROR",
        detail:
          `${ctx.baseBranch} is checked out at ${holder}, so only a merge there could move it, and that checkout is ` +
          `not this closer's to change. Nothing was changed and the work is still on ${ctx.branch}. ` +
          `Check out another branch there, or merge ${ctx.branch} there yourself, and close again.`,
      };
    }

    // The merge is its own conflict probe: --ff-only either advances the ref or
    // refuses, changing nothing either way. Only once it has refused is the
    // reason worth a second call: a base branch that is no longer an ancestor of
    // the surface branch has moved on, which is a decision for a person (FAIL);
    // anything else that stopped a fast-forward the history allows is the
    // checkout itself being in the way (ERROR).
    const merged = await tryGit(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]);
    if (!merged) {
      const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      const diverged = !(await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.baseBranch, ctx.branch]));
      if (diverged) return movedOn(ctx, tip);
      return {
        status: "ERROR",
        detail:
          `git would not fast-forward ${ctx.baseBranch} (at ${tip}) onto ${ctx.branch}, although the history allows ` +
          `it, so something in the checkout at ${ctx.repoPath} is in the way, most often uncommitted or untracked ` +
          `files the merge would overwrite. Nothing was changed and the work is still on ${ctx.branch}. ` +
          `Clear what is in the way in that checkout and close again.`,
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

  return closerFromAcceptedHandler(closeAccepted);
}
