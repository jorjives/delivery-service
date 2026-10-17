// Close interface DX note: the closer ships with a "writing a closer" guide,
// followable without reading the surface driver or provisioning code. This
// runs the guide's own worked example, so it cannot drift from the contract.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { git, REPO_ROOT } from "./helpers.js";
import { initTempRepo } from "../src/temp-repo.js";
import { branchName, provisionWorktree, resolveCloser, type CloseContext, type CloserRef } from "../src/index.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-closer.md"), "utf-8");

function exampleCloser(): string {
  const match = /```js\n(\/\/ merge-back-closer\.mjs\n[\s\S]*?)```/.exec(guide);
  if (!match?.[1]) throw new Error("guide has no ```js block starting with // merge-back-closer.mjs");
  return match[1];
}

describe("the 'writing a closer' guide", () => {
  it("covers the context, the three outcomes, FAIL versus ERROR, replays, secrets and how to reference a closer", () => {
    for (const field of ["worktreePath", "dir", "repoPath", "branch", "baseBranch", "repairBrief"]) {
      expect(guide).toContain(`\`${field}\``);
    }
    for (const kind of ["accepted", "escalated", "aborted"]) expect(guide).toContain(`"${kind}"`);
    for (const status of ["DONE", "FAIL", "ERROR"]) expect(guide).toContain(`"${status}"`);
    expect(guide).toMatch(/already done/i);
    expect(guide).toMatch(/secret/i);
    expect(guide).toContain('type: "custom"');
    expect(guide).toContain('type: "merge-back"');
    expect(guide).toContain('type: "open-pr"');
    expect(guide).toContain("gh auth login");
    expect(guide).toMatch(/origin/);
    expect(guide).toContain("resolveCloser(");
    expect(guide).toContain("npm run demo:close-slice-4");
    expect(guide).toContain("npm run demo:close-slice-5");
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  describe("its worked merge-back closer, loaded as a custom closer", () => {
    const ref: CloserRef = { type: "custom", modulePath: "closers/merge-back-closer.mjs" };
    let repo: string;
    let ctx: CloseContext;

    beforeEach(async () => {
      repo = initTempRepo("closer-guide-repo-", { "seed.txt": "hello\n" });
      mkdirSync(join(repo, "closers"));
      writeFileSync(join(repo, "closers", "merge-back-closer.mjs"), exampleCloser());
      const dir = mkdtempSync(join(tmpdir(), "closer-guide-case-"));
      const worktreePath = join(mkdtempSync(join(tmpdir(), "closer-guide-tree-")), "wt");
      const { baseBranch } = await provisionWorktree(dir, repo, worktreePath, "surface-1");
      ctx = { worktreePath, dir, repoPath: repo, branch: branchName("surface-1"), baseBranch };
    });

    it("merges accepted work into the base branch, cleans up, and is DONE again on replay", async () => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the work\n");
      const closer = resolveCloser(ref, repo);

      const first = await closer.close(ctx, { kind: "accepted" });

      expect(first.status).toBe("DONE");
      expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
      expect(existsSync(ctx.worktreePath)).toBe(false);
      expect(git(repo, ["branch", "--list", ctx.branch])).toBe("");

      const replay = await closer.close(ctx, { kind: "accepted" });
      expect(replay.status).toBe("DONE");
      expect(replay.detail).toMatch(/already/i);
    });

    it("lands by moving the base branch when no checkout holds it", async () => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the work");
      git(repo, ["checkout", "-q", "-b", "elsewhere"]);
      const closer = resolveCloser(ref, repo);

      const report = await closer.close(ctx, { kind: "accepted" });

      expect(report.status).toBe("DONE");
      expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
      expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("elsewhere");
    });

    it("refuses with FAIL, changing nothing, when the base branch has moved on", async () => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the work\n");
      writeFileSync(join(repo, "hotfix.txt"), "moved on\n");
      git(repo, ["add", "seed.txt", "hotfix.txt"]);
      git(repo, ["commit", "-m", "main moved on"]);
      const tip = git(repo, ["rev-parse", "main"]);

      const report = await resolveCloser(ref, repo).close(ctx, { kind: "accepted" });

      expect(report.status).toBe("FAIL");
      expect(git(repo, ["rev-parse", "main"])).toBe(tip);
      expect(existsSync(ctx.worktreePath)).toBe(true);
    });

    it("tears down a stopped surface's worktree and keeps its branch", async () => {
      const report = await resolveCloser(ref, repo).close(ctx, { kind: "escalated" });

      expect(report.status).toBe("DONE");
      expect(existsSync(ctx.worktreePath)).toBe(false);
      expect(git(repo, ["branch", "--list", ctx.branch, "--format=%(refname:short)"])).toBe(ctx.branch);
    });
  });
});
