import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { createOpenPrCloser } from "./open-pr-closer.js";
import { create } from "./case-file.js";
import { provisionWorktree } from "./provision.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { createGhStandIn, type GhStandIn } from "./gh-stand-in.js";
import type { CloseContext } from "./ports.js";
import type { BudgetSet, GateRef, TaskDef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "true", parseMode: "exitcode" };
const accepted = { kind: "accepted" } as const;
const BRANCH = "surface/surface-71";
const FIRST_PR = "https://github.com/example/project/pull/1";

async function caseDir(taskDef: TaskDef): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "open-pr-case-"));
  await create(dir, { surfaceId: "surface-71", taskDef, gateRef }, budgets);
  return dir;
}

describe("the open-pr closer", () => {
  let repo: string;
  let origin: string;
  let tree: string;
  let ctx: CloseContext;
  let standIn: GhStandIn;

  const closer = () => createOpenPrCloser({ ghCommand: standIn.command });

  beforeEach(async () => {
    const dir = await caseDir({ goal: "add the feature" });
    repo = initTempRepo("open-pr-repo-", { "seed.txt": "hello\n" });
    origin = addLocalOrigin(repo);
    tree = join(await mkdtemp(join(tmpdir(), "open-pr-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-71");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: BRANCH, baseBranch };
    standIn = createGhStandIn();
  });

  it("titles the commit it pushes with the task it delivers", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await closer().close(ctx, accepted);

    expect(git(origin, ["log", "-1", "--format=%s", BRANCH])).toBe("add the feature");
  });

  it("commits the work, pushes the branch and opens a pull request against the base branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(origin, ["show", `${BRANCH}:feature.txt`])).toBe("the work");
    expect(standIn.pullRequests()).toEqual([expect.objectContaining({ head: BRANCH, base: "main" })]);
  });

  it("reports the pull request's address as the closing report", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await closer().close(ctx, accepted);

    expect(report.detail).toBe(FIRST_PR);
  });

  it("names the surface and the task in the pull request", async () => {
    // Real gh refuses a pull request with no commits between the branches, so
    // every case that expects one to open has work to land.
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await closer().close(ctx, accepted);

    const [pr] = standIn.pullRequests();
    expect(pr?.title).toBe("add the feature (surface-71)");
    expect(pr?.body).toContain("surface-71");
    expect(pr?.body).toContain('"goal": "add the feature"');
  });

  it("leaves the worktree in place for follow-up commits", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await closer().close(ctx, accepted);

    expect(existsSync(tree)).toBe(true);
  });

  it("reports the already-open pull request on a repeat close, and opens no second one", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await closer().close(ctx, accepted);

    const repeat = await closer().close(ctx, accepted);

    expect(repeat.status).toBe("DONE");
    expect(repeat.detail.startsWith(FIRST_PR)).toBe(true);
    expect(repeat.detail).toMatch(/no new pull request was opened/i);
    expect(standIn.pullRequests()).toHaveLength(1);
  });

  it("passes task content to gh as data that cannot be read as commands or flags", async () => {
    const hostile = "--base=evil $(touch pwned) `touch pwned`; touch pwned";
    const hostileCtx = { ...ctx, dir: await caseDir({ goal: hostile }) };
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await closer().close(hostileCtx, accepted);

    expect(report.status).toBe("DONE");
    const [pr] = standIn.pullRequests();
    expect(pr?.title).toBe(`${hostile} (surface-71)`);
    expect(pr?.base).toBe("main");
    expect(pr?.body).toContain(hostile);
    expect(existsSync(join(repo, "pwned"))).toBe(false);
    expect(existsSync(join(tree, "pwned"))).toBe(false);
  });

  it.each(["escalated", "aborted"] as const)(
    "tears down a surface that %s: worktree removed, branch holding the work kept, nothing pushed or opened",
    async (kind) => {
      writeFileSync(join(tree, "feature.txt"), "half the work\n");
      const report = await closer().close(ctx, { kind });

      expect(report.status).toBe("DONE");
      expect(existsSync(tree)).toBe(false);
      expect(git(repo, ["branch", "--list", BRANCH])).toContain(BRANCH);
      expect(git(origin, ["branch", "--list", BRANCH])).toBe("");
      expect(standIn.pullRequests()).toEqual([]);
    },
  );

  it("reports an ERROR naming origin when the repository has no origin remote", async () => {
    git(repo, ["remote", "remove", "origin"]);

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/origin/);
    expect(standIn.pullRequests()).toEqual([]);
  });

  it("reports an ERROR naming the branch when the push is rejected", async () => {
    git(repo, ["remote", "set-url", "origin", join(tmpdir(), "no-such-origin-for-open-pr")]);

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/could not push/i);
    expect(report.detail).toContain(BRANCH);
  });

  it("reports an ERROR when the surface pinned no base branch", async () => {
    const report = await closer().close({ ...ctx, baseBranch: "" }, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/base branch/i);
  });

  describe("when GitHub cannot be used", () => {
    beforeEach(() => {
      writeFileSync(join(tree, "feature.txt"), "the work\n");
    });

    it("names the missing GitHub tool and how to install it", async () => {
      const missing = createOpenPrCloser({ ghCommand: join(tmpdir(), "no-such-gh-for-open-pr") });

      const report = await missing.close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/not installed/i);
      expect(report.detail).toContain("https://cli.github.com");
    });

    it.each(["signed-out", "expired"] as const)("says GitHub sign-in is needed and how, when gh is %s", async (mode) => {
      standIn.setMode(mode);

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/GitHub sign-in is needed/);
      expect(report.detail).toContain("gh auth login");
      expect(standIn.pullRequests()).toEqual([]);
    });

    it("names missing permission and how to fix it", async () => {
      standIn.setMode("forbidden");

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/permission/i);
      expect(report.detail).toContain("gh auth refresh");
    });

    it("names an unreachable GitHub as a network problem", async () => {
      standIn.setMode("offline");

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/could not reach GitHub/i);
    });

    it("reports a pull request refused for a content reason as a FAIL carrying the reason", async () => {
      standIn.refuseCreate(
        "pull request create failed: GraphQL: Pull requests into main are blocked by a branch protection rule (createPullRequest)",
      );

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("FAIL");
      expect(report.detail).toContain("blocked by a branch protection rule");
      expect(report.detail).toContain(BRANCH);
      expect(standIn.pullRequests()).toEqual([]);
    });

    it("never writes a token gh printed into the report", async () => {
      standIn.refuseCreate(
        "pull request create failed: ghp_abc123SECRET456 rejected at https://x-access-token:ghs_S3CR3Tvalue@github.com/example/project",
      );

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("FAIL");
      expect(report.detail).not.toContain("ghp_abc123SECRET456");
      expect(report.detail).not.toContain("ghs_S3CR3Tvalue");
      expect(report.detail).toContain("[redacted]");
    });
  });
});
