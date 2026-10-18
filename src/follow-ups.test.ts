import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { heldFollowUps, holdFollowUps, landFollowUps } from "./follow-ups.js";
import { readDelivery } from "./delivery-ledger.js";

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

describe("landing an after pass's follow-ups", () => {
  const ledgerIn = () => join(mkdtempSync(join(tmpdir(), "follow-ups-ledger-")), "delivery.jsonl");

  it("commits them onto the open delivery branch and records them as landed there", async () => {
    const repo = initTempRepo("land-follow-ups-", { "package.json": "{}" });
    git(repo, ["branch", "delivery/main"]);
    const ledger = ledgerIn();
    await landFollowUps({ repoPath: repo, ledger, branch: "delivery/main", base: "main", runId: "b1-1" }, [{ file: FOLLOW, text: ITEM }]);
    expect(git(repo, ["show", `delivery/main:.delivery/backlog/${FOLLOW}`])).toBe(ITEM.trim());
    expect((await readDelivery(ledger, "delivery/main")).pending).toEqual([expect.objectContaining({ runId: "b1-1", key: "after:follow-ups" })]);
  });

  it("opens the delivery branch again at the base when the closer deleted it, and adds nothing twice", async () => {
    const repo = initTempRepo("land-follow-ups-reopen-", { "package.json": "{}" });
    const ledger = ledgerIn();
    const at = { repoPath: repo, ledger, branch: "delivery/main", base: "main", runId: "b1-1" };
    await landFollowUps(at, [{ file: FOLLOW, text: ITEM }]);
    const tip = git(repo, ["rev-parse", "delivery/main"]);
    await landFollowUps(at, [{ file: FOLLOW, text: ITEM }]);
    expect(git(repo, ["rev-parse", "delivery/main"])).toBe(tip);
    expect(git(repo, ["rev-parse", "delivery/main~1"])).toBe(git(repo, ["rev-parse", "main"]));
    const state = await readDelivery(ledger, "delivery/main");
    expect(state.openedAt).not.toBeNull();
    expect(state.landed).toHaveLength(1);
  });
});
