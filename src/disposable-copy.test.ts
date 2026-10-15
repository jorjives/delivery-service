import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inDisposableCopy } from "./disposable-copy.js";
import { git } from "./git-exec.js";
import { initTempRepo } from "./temp-repo.js";

/** A working copy mid-task: one tracked file changed, one new file, nothing committed. */
function midTask(): string {
  const repo = initTempRepo("disposable-", { "a.txt": "a\n" });
  writeFileSync(join(repo, "a.txt"), "changed\n");
  writeFileSync(join(repo, "new.txt"), "new\n");
  return repo;
}

describe("a disposable copy of a working copy", () => {
  it("holds the work exactly as it stands, uncommitted changes and new files included", async () => {
    const repo = midTask();
    const seen = await inDisposableCopy(repo, (copy) => Promise.resolve([readFileSync(join(copy, "a.txt"), "utf-8"), readFileSync(join(copy, "new.txt"), "utf-8")]));
    expect(seen).toEqual(["changed\n", "new\n"]);
  });

  it("keeps nothing done in it: the working copy, its branch and its staged files are as they were, and the copy is gone", async () => {
    const repo = midTask();
    const before = { head: await git(repo, ["rev-parse", "HEAD"]), status: await git(repo, ["status", "--porcelain"]), worktrees: await git(repo, ["worktree", "list"]) };
    let where = "";
    await inDisposableCopy(repo, async (copy) => {
      where = copy;
      writeFileSync(join(copy, "a.txt"), "triage was here\n");
      await git(copy, ["add", "-A"]);
      await git(copy, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "experiment"]);
    });
    expect(readFileSync(join(repo, "a.txt"), "utf-8")).toBe("changed\n");
    expect({ head: await git(repo, ["rev-parse", "HEAD"]), status: await git(repo, ["status", "--porcelain"]), worktrees: await git(repo, ["worktree", "list"]) }).toEqual(before);
    expect(existsSync(where)).toBe(false);
  });

  it("is removed when the work inside it fails", async () => {
    const repo = midTask();
    let where = "";
    await expect(inDisposableCopy(repo, (copy) => {
      where = copy;
      return Promise.reject(new Error("triage failed"));
    })).rejects.toThrow("triage failed");
    expect(existsSync(where)).toBe(false);
  });
});
