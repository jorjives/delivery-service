import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseDir, git } from "../tests/helpers.js";
import { resolveCloser } from "./resolve-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import type { CloserRef } from "./schema.js";
import type { CloseContext } from "./ports.js";

const accepted = { kind: "accepted" } as const;

describe("resolveCloser", () => {
  let ctx: CloseContext;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    const dir = await caseDir("surface-42", { goal: "add the feature" });
    repo = initTempRepo("resolve-closer-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "resolve-closer-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("turns the merge-back name into a closer that actually merges", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await resolveCloser({ type: "merge-back" }, repo).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
  });

  it("passes the keep-the-branch parameter through", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await resolveCloser({ type: "merge-back", deleteBranch: false }, repo).close(ctx, accepted);

    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("surface/surface-42");
  });

  it("turns an unknown closer reference into an error report, not a crash", async () => {
    const report = await resolveCloser({ type: "teleport" } as unknown as CloserRef, repo).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
    expect(existsSync(tree)).toBe(true);
  });

  it("turns an unreadable closer reference into an error report", async () => {
    const report = await resolveCloser(undefined as unknown as CloserRef, repo).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
  });

  it("resolves a commit-to-branch reference to a closer that keeps the branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const mainTip = git(repo, ["rev-parse", "main"]);
    const closer = resolveCloser({ type: "commit-to-branch" }, repo);

    const report = await closer.close(ctx, { kind: "accepted" });

    expect(report.status).toBe("DONE");
    expect(report.detail).toContain("surface/surface-42");
    expect(git(repo, ["rev-parse", "main"])).toBe(mainTip);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("requires a repo root: omitting it must not type-check", () => {
    // @ts-expect-error repoPath is required, so a custom closer's relative
    // modulePath can never resolve against the worktree or process.cwd().
    resolveCloser({ type: "merge-back" });
  });

  it("resolves a custom reference's relative module path against the repo root", async () => {
    mkdirSync(join(repo, "closers"));
    writeFileSync(
      join(repo, "closers", "landing.mjs"),
      `export default { async close(ctx) { return { status: "DONE", detail: "project closer ran for " + ctx.branch }; } };`,
    );

    const report = await resolveCloser({ type: "custom", modulePath: "closers/landing.mjs" }, repo).close(ctx, accepted);

    expect(report).toEqual({ status: "DONE", detail: "project closer ran for surface/surface-42" });
  });

  it("selects a named export of a custom closer module", async () => {
    mkdirSync(join(repo, "closers"));
    writeFileSync(
      join(repo, "closers", "many.mjs"),
      `export const quiet = { close: async () => ({ status: "DONE", detail: "quiet" }) };`,
    );

    const report = await resolveCloser({ type: "custom", modulePath: "closers/many.mjs", exportName: "quiet" }, repo).close(ctx, accepted);

    expect(report.detail).toBe("quiet");
  });

  it("turns a custom reference to a missing module into an error report naming it", async () => {
    const report = await resolveCloser({ type: "custom", modulePath: "closers/absent.mjs" }, repo).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("closers/absent.mjs");
    expect(existsSync(tree)).toBe(true);
  });
});
