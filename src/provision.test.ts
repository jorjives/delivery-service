import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { branchName, provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { ProvisioningFailure } from "./errors.js";
import { cleanGitEnv } from "./git-env.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

describe("branchName", () => {
  it("derives a deterministic branch from the surface id", () => {
    expect(branchName("surface-42")).toBe("surface/surface-42");
    expect(branchName("surface-42")).toBe(branchName("surface-42"));
  });
});

describe("provisionWorktree", () => {
  let dir: string;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "provision-case-"));
    repo = initTempRepo("provision-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "provision-tree-")), "wt");
  });

  it("creates a real worktree on a surface-derived branch off the default branch", async () => {
    await provisionWorktree(dir, repo, tree, "surface-42");

    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    expect(git(tree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("surface/surface-42");
    // Branched off the repo's default branch, so it carries its commit
    expect(git(tree, ["rev-parse", "HEAD"])).toBe(git(repo, ["rev-parse", "HEAD"]));
  });

  it("tears down a partial worktree and recreates it rather than adopting it", async () => {
    await provisionWorktree(dir, repo, tree, "surface-42");
    await writeFile(join(tree, "stray.txt"), "left behind by a torn attempt\n");

    await provisionWorktree(dir, repo, tree, "surface-42");

    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    await expect(readFile(join(tree, "stray.txt"), "utf-8")).rejects.toThrow();
  });

  it("reports a clean first provision as not restarted", async () => {
    const result = await provisionWorktree(dir, repo, tree, "surface-42");

    expect(result).toEqual({ restarted: false });
  });

  it("reports a provision that had to clear a leftover worktree as restarted", async () => {
    await provisionWorktree(dir, repo, tree, "surface-42");

    const result = await provisionWorktree(dir, repo, tree, "surface-42");

    expect(result).toEqual({ restarted: true });
  });

  it("throws ProvisioningFailure naming the surface dir when the path is unusable", async () => {
    const blocker = join(await mkdtemp(join(tmpdir(), "provision-block-")), "file");
    await writeFile(blocker, "not a directory\n");

    await expect(
      provisionWorktree(dir, repo, join(blocker, "wt"), "surface-42"),
    ).rejects.toThrow(ProvisioningFailure);

    await expect(
      provisionWorktree(dir, repo, join(blocker, "wt"), "surface-42"),
    ).rejects.toThrow(new RegExp(dir));
  });
});
