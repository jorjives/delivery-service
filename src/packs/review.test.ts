import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { mockSessionEnvironment, promptsSent, readJournal, writeMockScript, type MockScript } from "../testing.js";
import { provisionWorktree } from "../provision.js";
import { runPlace } from "../run-location.js";
import { resolvePack } from "./manifest.js";
import { listReviews, packsRoot } from "./review-record.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "./review-fixtures.js";
import { runReview, scanErrorsDir } from "./review.js";

/** A session pointed at claude-mock with `script`, and where its journal goes. */
async function scripted(script: MockScript) {
  const dir = mkdtempSync(join(tmpdir(), "review-mock-"));
  const scriptPath = join(dir, "mock.json");
  const journalPath = join(dir, "journal.jsonl");
  await writeMockScript(scriptPath, script);
  return { session: () => Promise.resolve(mockSessionEnvironment({ scriptPath, journalPath })), journalPath };
}

const NEVER = (): Promise<never> => Promise.reject(new Error("no session should be started"));
const state = () => ({ XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "review-state-")) });
const branches = (repo: string) => git(repo, ["branch", "--list"]);

describe("running a review", () => {
  it("reviews the last commit in one read-only session and saves the confirmed list", async () => {
    const repo = exampleRepo();
    const { session, journalPath } = await scripted(scanScript(EXAMPLE_SCAN));
    const outcome = await runReview(repo, await resolvePack("code", "/"), { session, env: state() });

    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.recovered).toBe(false);
    expect(outcome.review.header).toMatchObject({ pack: { name: "code", maxFindings: 40 }, commit: git(repo, ["rev-parse", "HEAD"]), fileCount: 6 });
    expect(outcome.review.header.pack.fixInstructions).toBe((await resolvePack("code", "/")).fixInstructions);
    expect(outcome.review.result.findings).toHaveLength(3);
    expect(outcome.review.result.unconfirmed).toHaveLength(1);
    const [prompt] = promptsSent(await readJournal(journalPath));
    expect(prompt).toContain("# Review: Code review");
    expect(prompt).toContain("checkout.js");
  });

  it("leaves the owner's files, branches and working copy exactly as they were", async () => {
    const repo = exampleRepo();
    const before = { head: git(repo, ["rev-parse", "HEAD"]), branches: branches(repo) };
    const { session } = await scripted(scanScript(EXAMPLE_SCAN));
    await runReview(repo, await resolvePack("code", "/"), { session, env: state() });

    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before.head);
    expect(branches(repo)).toBe(before.branches);
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });

  it("saves no review when the agent does not reply with a usable list, and keeps why for an engineer", async () => {
    const repo = exampleRepo();
    const { session } = await scripted({ expectations: [{ fail: { message: "the network went away" } }] });
    const outcome = await runReview(repo, await resolvePack("code", "/"), { session, env: state() });

    expect(outcome).toMatchObject({ kind: "failed", terminus: { status: "incomplete" } });
    expect(await listReviews(repo)).toEqual([]);
    expect(existsSync(join(scanErrorsDir(repo), "refs"))).toBe(true);
    expect(branches(repo)).toBe("* main");
  });

  it("saves no review when the session cannot start at all", async () => {
    const repo = exampleRepo();
    const outcome = await runReview(repo, await resolvePack("code", "/"), { session: () => Promise.resolve({ pathToClaudeCodeExecutable: "/no/such/claude" }), env: state() });
    expect(outcome).toMatchObject({ kind: "failed", terminus: { notRun: true } });
    expect(await listReviews(repo)).toEqual([]);
  });

  it("sets nothing up when the session cannot be had, such as when nobody is signed in", async () => {
    const repo = exampleRepo();
    await expect(runReview(repo, await resolvePack("code", "/"), { session: NEVER, env: state() })).rejects.toThrow("no session should be started");
    expect(existsSync(packsRoot(repo))).toBe(false);
  });
});

describe("a review that was interrupted", () => {
  it("is finished from the agent's saved reply, with no second session, when it stopped after the agent replied", async () => {
    const repo = exampleRepo();
    const env = state();
    const { session } = await scripted(scanScript(EXAMPLE_SCAN));
    const pack = await resolvePack("code", "/");
    const first = await runReview(repo, pack, { session, env });
    if (first.kind !== "done") throw new Error("expected the first review to finish");
    rmSync(join(first.review.dir, "refs", "scan.json"));

    const again = await runReview(repo, pack, { session: NEVER, env });

    expect(again).toMatchObject({ kind: "done", recovered: true });
    if (again.kind === "done") expect(again.review.result).toEqual(first.review.result);
  });

  it("is done again in a new session when it stopped while the agent was working, clearing what was left behind", async () => {
    const repo = exampleRepo();
    const env = state();
    const { worktreePath } = runPlace(repo, "review-code", env).location;
    await provisionWorktree(mkdtempSync(join(tmpdir(), "x-")), repo, worktreePath, "review-code");
    mkdirSync(join(packsRoot(repo), "code-20261005T000000Z"), { recursive: true });
    const { session, journalPath } = await scripted(scanScript(EXAMPLE_SCAN));

    const outcome = await runReview(repo, await resolvePack("code", "/"), { session, env });

    expect(outcome).toMatchObject({ kind: "done", recovered: false });
    expect(promptsSent(await readJournal(journalPath))).toHaveLength(1);
    expect(branches(repo)).toBe("* main");
  });
});
