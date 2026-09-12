import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { cleanGitEnv } from "./git-env.js";

const execFile = promisify(execFileCb);

/**
 * Every git call the harness makes goes through here: arguments as a list so
 * nothing derived from task content can be read as shell syntax, and
 * `cleanGitEnv()` so an inherited `GIT_DIR`/`GIT_WORK_TREE` (git sets these for
 * hooks) cannot redirect the call away from `cwd`.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, env: cleanGitEnv() });
  return stdout.trim();
}

/** Ran-and-succeeded as a boolean, for probes and best-effort clean-up. */
export async function tryGit(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit whatever is in the worktree, tolerating "there is nothing to commit" —
 * either the worker changed nothing, or an earlier attempt already committed
 * before crashing. The emptiness check is `status --porcelain` rather than the
 * failed commit's message: git prints "nothing to commit" on stdout, which a
 * rejected `execFile` does not carry in its error message.
 */
export async function ensureCommitted(worktreePath: string, message: string): Promise<void> {
  await git(worktreePath, ["add", "-A"]);
  if ((await git(worktreePath, ["status", "--porcelain"])) === "") return;
  await git(worktreePath, ["commit", "-m", message]);
}
