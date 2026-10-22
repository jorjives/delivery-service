import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { cleanGitEnv } from "./git-env.js";

const execFile = promisify(execFileCb);

/** The last piece of work queued in each folder, settled either way: what the next piece waits for. */
const turns = new Map<string, Promise<void>>();

/**
 * Run `work` once everything queued before it in the same folder has settled.
 * This is the in-process lock around the shared checkout: it is keyed on where
 * a git call runs, not on which subcommand it is, so every call against the
 * checkout several tasks share (setting up and removing working copies,
 * deleting branches, merging) takes its turn, and a call added later cannot
 * slip past a list. Each task's own working copy is its own folder, so work
 * there never waits on another task. A plain promise chain is the whole of a
 * non-reentrant mutex, and this one lives only as long as the process.
 */
export function takeTurn<T>(cwd: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(cwd);
  const mine = (turns.get(key) ?? Promise.resolve()).then(work, work);
  const settled = mine.then(
    () => undefined,
    () => undefined,
  );
  turns.set(key, settled);
  void settled.then(() => {
    if (turns.get(key) === settled) turns.delete(key);
  });
  return mine;
}

/**
 * Every git call the harness makes goes through here: arguments as a list so
 * nothing derived from task content can be read as shell syntax, and
 * `cleanGitEnv()` so an inherited `GIT_DIR`/`GIT_WORK_TREE` (git sets these for
 * hooks) cannot redirect the call away from `cwd`. Also takes its turn in
 * `cwd` (`takeTurn`), so two tasks never run git in the shared checkout at once.
 *
 * `env` is laid over the cleaned environment, for a caller that means to point
 * git somewhere on purpose (a private index); `maxBuffer` bounds the output
 * accepted, and past it the call rejects with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
 * `timeout`, in milliseconds, ends the call and rejects when it runs longer;
 * `raw` returns standard output exactly as git wrote it, for file contents;
 * `input` is written to standard input, then closed, for a call such as `hash-object --stdin`.
 *
 * ponytail: no retry on an index.lock left by a person running git in the checkout at the same moment; add a bounded retry here if that is seen in practice (design §4).
 */
export async function git(cwd: string, args: string[], options: { env?: NodeJS.ProcessEnv; maxBuffer?: number; timeout?: number; raw?: boolean; input?: string } = {}): Promise<string> {
  const { stdout } = await takeTurn(cwd, () => {
    const call = execFile("git", args, {
      cwd,
      env: { ...cleanGitEnv(), ...options.env },
      ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
    if (options.input !== undefined) call.child.stdin?.end(options.input);
    return call;
  });
  return options.raw === true ? stdout : stdout.trim();
}

/** Ran-and-succeeded as a boolean, for probes and best-effort clean-up. */
/** Whether `branch` is a local branch of the repository at `repoPath`. */
export const branchExists = (repoPath: string, branch: string): Promise<boolean> =>
  tryGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);

/** The tip commit of local `branch`, or undefined when there is no such branch. */
export async function branchTip(repoPath: string, branch: string): Promise<string | undefined> {
  return (await branchExists(repoPath, branch)) ? git(repoPath, ["rev-parse", `refs/heads/${branch}`]) : undefined;
}

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

/** The files a merge or rebase in `cwd` left conflicted. */
export async function conflictedFiles(cwd: string): Promise<string[]> {
  return (await git(cwd, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
}
