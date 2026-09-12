import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCloser } from "./resolve-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloserRef } from "./schema.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const accepted = { kind: "accepted" } as const;

describe("resolveCloser", () => {
  let ctx: CloseContext;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "resolve-closer-case-"));
    repo = initTempRepo("resolve-closer-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "resolve-closer-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("turns the merge-back name into a closer that actually merges", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await resolveCloser({ type: "merge-back" }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
  });

  it("passes the keep-the-branch parameter through", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await resolveCloser({ type: "merge-back", deleteBranch: false }).close(ctx, accepted);

    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("surface/surface-42");
  });

  it("turns an unknown closer reference into an error report, not a crash", async () => {
    const report = await resolveCloser({ type: "teleport" } as unknown as CloserRef).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
    expect(existsSync(tree)).toBe(true);
  });

  it("turns an unreadable closer reference into an error report", async () => {
    const report = await resolveCloser(undefined as unknown as CloserRef).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
  });
});
