import { ProvisioningFailure } from "./errors.js";
import { messageOf } from "./gate-support.js";
import { git, tryGit } from "./git-exec.js";

/**
 * The surface_id → branch scheme, settled by the single-surface state machine
 * design: pure, deterministic, and stored nowhere, so it can never drift from
 * the surface id it is derived from.
 */
export function branchName(surfaceId: string): string {
  return `surface/${surfaceId}`;
}

/**
 * What the worktree branches off, in the two shapes a caller needs: `ref` for
 * `git worktree add`, and `localBranch` for anything that must later merge into
 * it. A remote-tracking ref such as `origin/main` cannot be merged into, so the
 * prefix is stripped for the local branch name.
 */
async function resolveBaseRef(repoPath: string): Promise<{ ref: string; localBranch: string }> {
  try {
    const ref = await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return { ref, localBranch: ref.replace(/^origin\//, "") };
  } catch {
    // No origin (a local-only or freshly-initialised repo): the checked-out
    // branch is the repo's default.
    const ref = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    return { ref, localBranch: ref };
  }
}

/**
 * Create this surface's worktree, off the repository's default branch, on a
 * branch derived from the surface id.
 *
 * Provisioning is the one node that must start from a known-clean tree
 * (docs/provisioning.md), so a partial worktree or a leftover branch from a
 * torn attempt is torn down and recreated rather than adopted. That makes the
 * whole function idempotent: a crash anywhere inside it is recovered by calling
 * it again. Reports whether wreckage was cleared. Also reports the local branch
 * the worktree was started from, which the surface pins in its header for the
 * closer to merge into.
 */
export async function provisionWorktree(
  dir: string,
  repoPath: string,
  worktreePath: string,
  surfaceId: string,
): Promise<{ restarted: boolean; baseBranch: string }> {
  const branch = branchName(surfaceId);
  try {
    const { ref, localBranch } = await resolveBaseRef(repoPath);
    const removedTree = await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    const removedBranch = await tryGit(repoPath, ["branch", "-D", "--", branch]);
    await git(repoPath, ["worktree", "add", "-b", branch, "--", worktreePath, ref]);
    return { restarted: removedTree || removedBranch, baseBranch: localBranch };
  } catch (err) {
    throw new ProvisioningFailure(dir, messageOf(err));
  }
}
