import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { heldFollowUps, holdFollowUps } from "./follow-ups.js";

const FOLLOW = "20261018T090000Z-tidy-the-readme.md";
const ITEM = "---\nstatus: open\n---\nTidy the README.\n";

function taskOnDeliveryBranch(): { repo: string; worktree: string; dir: string } {
  const repo = initTempRepo("follow-ups-", { "package.json": "{}" });
  git(repo, ["branch", "delivery/main"]);
  const worktree = join(mkdtempSync(join(tmpdir(), "follow-ups-wt-")), "wt");
  git(repo, ["worktree", "add", "-q", "-b", "surface/t1", worktree, "delivery/main"]);
  mkdirSync(join(worktree, ".delivery", "backlog"), { recursive: true });
  writeFileSync(join(worktree, ".delivery", "backlog", FOLLOW), ITEM);
  writeFileSync(join(worktree, "hello.js"), "export const hello = 1;\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-q", "-m", "work"]);
  return { repo, worktree, dir: mkdtempSync(join(tmpdir(), "follow-ups-case-")) };
}

describe("holding a tracker task's follow-ups", () => {
  it("takes new item files off the branch in a commit of their own and holds them in the case file", async () => {
    const { worktree, dir } = taskOnDeliveryBranch();
    await holdFollowUps(dir, worktree, "delivery/main", "tracker");
    expect(git(worktree, ["ls-files", ".delivery/backlog"])).toBe("");
    expect(git(worktree, ["show", "HEAD:hello.js"])).toContain("hello");
    expect(git(worktree, ["log", "-1", "--format=%s"])).toBe("Hold follow-ups to raise in tracker");
    expect(await heldFollowUps(dir)).toEqual([{ file: FOLLOW, text: ITEM }]);
  });

  it("is safe to run again: nothing more is committed and what is held stays", async () => {
    const { worktree, dir } = taskOnDeliveryBranch();
    await holdFollowUps(dir, worktree, "delivery/main", "tracker");
    const head = git(worktree, ["rev-parse", "HEAD"]);
    await holdFollowUps(dir, worktree, "delivery/main", "tracker");
    expect(git(worktree, ["rev-parse", "HEAD"])).toBe(head);
    expect(await heldFollowUps(dir)).toEqual([{ file: FOLLOW, text: ITEM }]);
  });

  it("holds nothing for a case file that never held any", async () => {
    expect(await heldFollowUps(mkdtempSync(join(tmpdir(), "follow-ups-none-")))).toEqual([]);
  });
});
