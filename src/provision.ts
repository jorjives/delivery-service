import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ProvisioningFailure } from "./errors.js";
import { messageOf } from "./gate-support.js";
import { cleanGitEnv } from "./git-env.js";

const execFile = promisify(execFileCb);

/**
 * The surface_id → branch scheme, settled by the single-surface state machine
 * design: pure, deterministic, and stored nowhere, so it can never drift from
 * the surface id it is derived from.
 */
export function branchName(surfaceId: string): string {
  return `surface/${surfaceId}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, env: cleanGitEnv() });
  return stdout.trim();
}

async function tryGit(cwd: string, args: string[]): Promise<void> {
  try {
    await git(cwd, args);
  } catch {
    // Best-effort clean-up: nothing to remove is the common case.
  }
}

async function resolveBaseRef(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  } catch {
    // No origin (a local-only or freshly-initialised repo): the checked-out
    // branch is the repo's default.
    return git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
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
 * it again.
 */
export async function provisionWorktree(
  dir: string,
  repoPath: string,
  worktreePath: string,
  surfaceId: string,
): Promise<void> {
  const branch = branchName(surfaceId);
  try {
    const baseRef = await resolveBaseRef(repoPath);
    await tryGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    await tryGit(repoPath, ["branch", "-D", branch]);
    await git(repoPath, ["worktree", "add", worktreePath, "-b", branch, baseRef]);
  } catch (err) {
    throw new ProvisioningFailure(dir, messageOf(err));
  }
}
