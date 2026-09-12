import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const accepted = { kind: "accepted" } as const;

describe("the merge-back closer", () => {
  let dir: string;
  let repo: string;
  let tree: string;
  let ctx: CloseContext;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-back-case-"));
    repo = initTempRepo("merge-back-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "merge-back-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("commits the worker's changes and fast-forwards the base branch onto them", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
  });

  it("says in plain prose which branch was updated and to which commit", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser().close(ctx, accepted);
    const sha = git(repo, ["rev-parse", "--short", "main"]);

    expect(report.detail).toContain("main");
    expect(report.detail).toContain(sha);
    expect(report.detail).toMatch(/fast-forward/i);
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/Updating|Fast-forward\n|files? changed/);
  });

  it("removes the worktree and deletes the surface branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await createMergeBackCloser().close(ctx, accepted);

    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("");
  });

  it("keeps the surface branch when the project asked to keep it", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("surface/surface-42");
  });

  it("closes cleanly when the worker changed nothing", async () => {
    const before = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
    expect(existsSync(tree)).toBe(false);
  });

  it("replayed after the merge but before cleanup, reports done without merging twice", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    // Crash window: the merge landed, cleanup never ran.
    await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);
    const merged = git(repo, ["rev-parse", "main"]);
    const commits = git(repo, ["rev-list", "--count", "main"]);

    const report = await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toMatch(/already merged/i);
    expect(git(repo, ["rev-parse", "main"])).toBe(merged);
    expect(git(repo, ["rev-list", "--count", "main"])).toBe(commits);
  });

  it("replayed after full cleanup, reports already closed without erroring on the missing worktree", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await createMergeBackCloser().close(ctx, accepted);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toMatch(/already closed/i);
  });

  it("refuses, without switching the checkout, when the repo is not on the base branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    git(repo, ["checkout", "-q", "-b", "elsewhere"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("elsewhere");
    expect(report.detail).toContain("main");
    expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("elsewhere");
    expect(existsSync(tree)).toBe(true);
  });

  it("reports a diverged base branch as a refusal, leaving the repo and worktree untouched", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    writeFileSync(join(repo, "other.txt"), "moved on\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "main moved on"]);
    const tip = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("FAIL");
    expect(report.detail).toContain(git(repo, ["rev-parse", "--short", "main"]));
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(existsSync(tree)).toBe(true);
  });

  it("reports an error, never a throw, when the surface has no pinned base branch", async () => {
    const report = await createMergeBackCloser().close({ ...ctx, baseBranch: "" }, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/base branch/i);
  });
});
