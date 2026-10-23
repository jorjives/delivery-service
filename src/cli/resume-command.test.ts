import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { repoLocked } from "../repo-lock.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import {
  branchIn,
  completes,
  delivery,
  interruptedRun,
  PACKAGE,
  RUN_TIMEOUT,
  scriptFile,
  TASK,
  writesHello,
} from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { NOTHING_TO_RESUME } from "./runs.js";
import { SAVED_DATA, SAVED_TEXT } from "./saved-report.js";

describe("delivery resume", () => {
  it(
    "picks up the one run that didn't finish",
    async () => {
      const repo = initTempRepo("resume-one-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${runId}`);
      expect(stdout).toContain("Picking up where it left off: checking the agent's work.");
      expect(branchIn(stdout)).toBe(`surface/${runId}`);
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it(
    "holds the repository's lock while it carries the run on, and lets it go at the end",
    async () => {
      const repo = initTempRepo("resume-lock-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-lock-state-"));
      await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const resuming = delivery(["resume"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile({ ...completes, delayMs: 1000 }) } });
      await vi.waitFor(async () => expect(await repoLocked(repo)).toBe(true), { timeout: 30_000, interval: 50 });

      expect((await resuming).exitCode).toBe(EXIT.ok);
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "picks up the run its id names",
    async () => {
      const repo = initTempRepo("resume-named-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const wanted = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume", wanted], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${wanted}`);
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it(
    "picks up the one touched most recently with --last, without asking",
    async () => {
      const repo = initTempRepo("resume-last-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      const newest = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume", "--last"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${newest}`);
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it(
    "ends with the report's opening sentence and where to read the rest, and saves the report on the run it picked up",
    async () => {
      const repo = initTempRepo("resume-saved-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) };

      const { stdout, exitCode } = await delivery(["resume"], { cwd: repo, env });

      expect(stdout.trimEnd().split("\n").slice(-2)).toEqual([
        "This run: 1 of 1 task completed and committed to its own branch.",
        `Run \`delivery report ${runId}\` for what to do.`,
      ]);
      expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe((await delivery(["report", runId], { cwd: repo, env })).stdout);
      expect(JSON.parse(readFileSync(join(repo, SAVED_DATA), "utf-8"))).toMatchObject({ kind: "task" });
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it("says plainly when there is nothing to pick up, and never starts a run", async () => {
    const repo = initTempRepo("resume-none-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["resume"], { cwd: repo });

    expect(stderr).toContain(NOTHING_TO_RESUME);
    expect(exitCode).toBe(EXIT.configuration);
    expect(readdirSync(repo)).not.toContain(".delivery");
  });

  it(
    "says so when the run it is given has already finished",
    async () => {
      const repo = initTempRepo("resume-finished-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const first = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      const runId = branchIn(first.stdout).replace("surface/", "");

      const { stderr, exitCode } = await delivery(["resume", runId], { cwd: repo, env: { XDG_STATE_HOME: state } });

      expect(stderr).toContain("has already finished");
      expect(exitCode).toBe(EXIT.configuration);
    },
  );

  it("says it cannot find a run id that names nothing", async () => {
    const repo = initTempRepo("resume-unknown-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["resume", "no-such-run-20260915T210000Z"], { cwd: repo });

    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("at Object.");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("refuses to carry on a run that started inside the fence on a machine where it is now absent", async () => {
    const repo = initTempRepo("resume-fence-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "resume-fence-state-"));
    await interruptedRun(repo, state, { task: TASK, steps: 1, worker: writesHello, fence: { mode: "preferred", devices: [], state: { present: true } } });
    const { exitCode, stderr } = await delivery(["resume"], { cwd: repo, env: { XDG_STATE_HOME: state } });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("started with your main folder protected");
  });
});
