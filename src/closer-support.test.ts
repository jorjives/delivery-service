import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { teardownWorktree } from "./closer-support.js";
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

  it("removes the scratch worktree and keeps the branch", async () => {
    const report = await teardownWorktree(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("says in plain prose which branch was kept and why", async () => {
    const report = await teardownWorktree(ctx, { kind: "escalated" });

    expect(report.detail).toContain("surface/surface-42");
    expect(report.detail).toContain("escalated");
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/Preparing worktree|HEAD is now at/);
  });

  it("is harmless the second time, leaving the branch untouched", async () => {
    const first = await teardownWorktree(ctx, { kind: "aborted" });
    const tip = git(repo, ["rev-parse", "surface/surface-42"]);

    const second = await teardownWorktree(ctx, { kind: "aborted" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    expect(git(repo, ["rev-parse", "surface/surface-42"])).toBe(tip);
  });
});
