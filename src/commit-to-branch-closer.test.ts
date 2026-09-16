import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { git } from "../tests/helpers.js";
import type { CloseContext } from "./ports.js";

const accepted = { kind: "accepted" } as const;

describe("the commit-to-branch closer", () => {
  let repo: string;
  let tree: string;
  let ctx: CloseContext;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "commit-branch-case-"));
    repo = initTempRepo("commit-branch-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "commit-branch-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("commits the accepted work on the surface branch and leaves the base branch alone", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const mainTip = git(repo, ["rev-parse", "main"]);

    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "surface/surface-42:feature.txt"])).toBe("the work");
    expect(git(repo, ["rev-parse", "main"])).toBe(mainTip);
    expect(() => git(repo, ["show", "main:feature.txt"])).toThrow();
  });

  it("names the branch holding the work, in plain prose", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.detail).toContain("surface/surface-42");
    expect(report.detail).toMatch(/committed/i);
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/files? changed|create mode|\[surface\//);
  });

  it("removes the scratch worktree", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await createCommitToBranchCloser().close(ctx, accepted);

    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["worktree", "list"])).not.toContain(tree);
  });

  it("closes cleanly when the worker changed nothing", async () => {
    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
  });

  it("reports already closed when a replay finds the worktree gone", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await createCommitToBranchCloser().close(ctx, accepted);
    const branchTip = git(repo, ["rev-parse", "surface/surface-42"]);

    const replay = await createCommitToBranchCloser().close(ctx, accepted);

    expect(replay.status).toBe("DONE");
    expect(replay.detail).toMatch(/already closed/i);
    expect(git(repo, ["rev-parse", "surface/surface-42"])).toBe(branchTip);
  });

  it("never deletes the surface branch, on any outcome", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const closer = createCommitToBranchCloser();

    for (const outcome of [accepted, { kind: "escalated" } as const, { kind: "aborted" } as const]) {
      await closer.close(ctx, outcome);
      expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
    }
  });

  it("tears the worktree down and keeps the branch when the surface escalated", async () => {
    const report = await createCommitToBranchCloser().close(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("reports an ERROR rather than throwing when git cannot run", async () => {
    // A directory that exists — so the "already closed" detect does not fire —
    // but is no git worktree, so the commit itself fails.
    const notAWorktree = await mkdtemp(join(tmpdir(), "commit-branch-bare-"));

    const report = await createCommitToBranchCloser().close(
      { ...ctx, worktreePath: notAWorktree },
      accepted,
    );

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/could not run/i);
  });

  it("behaves the same when handed a repair brief", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const repairBrief = { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "commit it" };

    const report = await createCommitToBranchCloser().close({ ...ctx, repairBrief }, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toContain("surface/surface-42");
    expect(git(repo, ["show", "surface/surface-42:feature.txt"])).toBe("the work");
  });
});
