import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { create, setBaseBranch } from "../case-file.js";
import { cleanGitEnv } from "../git-env.js";
import { DEFAULT_BUDGETS } from "../index.js";
import { provisionWorktree } from "../provision.js";
import { runPlace } from "../run-location.js";
import findingCloser, { FINDING_CLOSER_MODULE } from "./finding-closer.js";
import { fixTaskFor } from "./fix-task.js";
import { exampleRepo, sampleFinding } from "./review-fixtures.js";

const NPM = { type: "command", command: "npm test", parseMode: "exitcode" } as const;
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf-8" }).trim();

/** A fix's run, its working copy holding the fix uncommitted, as the closer finds it when the check has passed. */
async function passedFix(release: { hold: boolean; landing: { type: "merge-back" } } | undefined) {
  const repo = exampleRepo("finding-closer-");
  const runId = `fix-${release?.hold === true ? "held" : "open"}-20261006T110000Z`;
  const { dir, location } = runPlace(repo, runId, { XDG_STATE_HOME: join(repo, ".state") });
  mkdirSync(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef: fixTaskFor("security", sampleFinding(), NPM, undefined, release), gateRef: NPM, closerRef: { type: "custom", modulePath: FINDING_CLOSER_MODULE } }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  await provisionWorktree(dir, repo, location.worktreePath, runId);
  writeFileSync(join(location.worktreePath, "checkout.js"), readFileSync(join(location.worktreePath, "checkout.js"), "utf-8").replace("return price - discount;", "return Math.max(0, price - discount);"));
  const ctx = { worktreePath: location.worktreePath, dir, repoPath: repo, branch: `surface/${runId}`, baseBranch: "main" };
  return { repo, ctx };
}

describe("the closer every fix runs through", () => {
  it("keeps a held fix committed on its branch and leaves the main copy alone", async () => {
    const { repo, ctx } = await passedFix({ hold: true, landing: { type: "merge-back" } });
    const before = git(repo, ["rev-parse", "main"]);
    expect(await findingCloser.close(ctx, { kind: "accepted" })).toMatchObject({ status: "DONE" });
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
    expect(git(repo, ["show", `${ctx.branch}:checkout.js`])).toContain("Math.max(0, price - discount)");
    expect(existsSync(ctx.worktreePath)).toBe(false);
  });

  it("lands a fix that is not held the way the project chose", async () => {
    const { repo, ctx } = await passedFix({ hold: false, landing: { type: "merge-back" } });
    expect(await findingCloser.close(ctx, { kind: "accepted" })).toMatchObject({ status: "DONE" });
    expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("Math.max(0, price - discount)");
  });

  it("keeps a fix that recorded no landing on its branch: nothing lands without a record saying it may", async () => {
    const { repo, ctx } = await passedFix(undefined);
    const before = git(repo, ["rev-parse", "main"]);
    expect(await findingCloser.close(ctx, { kind: "accepted" })).toMatchObject({ status: "DONE" });
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
  });
});
