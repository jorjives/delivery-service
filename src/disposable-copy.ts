import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, tryGit } from "./git-exec.js";
import { treeOf } from "./repair-changes.js";

/**
 * Run `work` in a throwaway copy of a working copy as it stands, uncommitted changes and new files included.
 * The copy is a detached worktree of a commit no branch points at, so nothing done in it reaches the task's
 * working copy, its branch or its index, and the copy is removed however `work` ends.
 */
export async function inDisposableCopy<T>(worktreePath: string, work: (copy: string) => Promise<T>): Promise<T> {
  const tree = await treeOf(worktreePath);
  // A fixed identity: the commit is never kept, and the operator's own may not be set.
  const commit = await git(worktreePath, ["-c", "user.name=delivery", "-c", "user.email=delivery@localhost.invalid", "commit-tree", tree, "-p", "HEAD", "-m", "disposable copy"]);
  const copy = join(await mkdtemp(join(tmpdir(), "delivery-copy-")), "copy");
  await git(worktreePath, ["worktree", "add", "--detach", "--", copy, commit]);
  try {
    return await work(copy);
  } finally {
    await tryGit(worktreePath, ["worktree", "remove", "--force", "--", copy]);
    await tryGit(worktreePath, ["worktree", "prune"]);
  }
}
