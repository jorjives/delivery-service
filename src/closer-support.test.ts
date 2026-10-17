import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { commitAccepted, teardownWorktree } from "./closer-support.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import type { CloseContext } from "./ports.js";

describe("teardownWorktree", () => {
  let ctx: CloseContext;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "teardown-case-"));
    repo = initTempRepo("teardown-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "teardown-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("commits what the stopped worker left onto the branch and keeps it, so whoever takes over has the work", async () => {
    writeFileSync(join(tree, "feature.txt"), "half the work\n");

    const report = await teardownWorktree(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["show", "surface/surface-42:feature.txt"])).toBe("half the work");
    expect(report.detail).toContain("surface/surface-42");
    expect(report.detail).toContain("escalated");
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/Preparing worktree|HEAD is now at|files? changed/);
  });

  it("removes the branch when the stopped worker changed nothing, so no empty branch is left behind", async () => {
    const report = await teardownWorktree(ctx, { kind: "aborted" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toBe("");
    expect(report.detail).toMatch(/no changes/i);
    expect(report.detail).toContain("surface/surface-42");
  });

  it("is harmless the second time, leaving a kept branch untouched", async () => {
    writeFileSync(join(tree, "feature.txt"), "half the work\n");
    const first = await teardownWorktree(ctx, { kind: "aborted" });
    const tip = git(repo, ["rev-parse", "surface/surface-42"]);

    const second = await teardownWorktree(ctx, { kind: "aborted" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    expect(git(repo, ["rev-parse", "surface/surface-42"])).toBe(tip);
  });

  it("is harmless the second time after removing an empty branch", async () => {
    await teardownWorktree(ctx, { kind: "aborted" });

    const second = await teardownWorktree(ctx, { kind: "aborted" });

    expect(second.status).toBe("DONE");
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toBe("");
  });
});

describe("commitAccepted", () => {
  it("does nothing, and reads no case file, when the worktree holds nothing to commit", async () => {
    const repo = initTempRepo("commit-accepted-", { "seed.txt": "seed\n" });
    const before = git(repo, ["rev-parse", "HEAD"]);
    const noCaseFile = await mkdtemp(join(tmpdir(), "no-case-"));

    await commitAccepted({ worktreePath: repo, dir: noCaseFile, repoPath: repo, branch: "main", baseBranch: "main" });

    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
  });
});
