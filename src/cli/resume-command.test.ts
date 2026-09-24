import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import {
  branchIn,
  completes,
  delivery,
  interruptedRun,
  PACKAGE,
  scriptFile,
  TASK,
  writesHello,
} from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { NOTHING_TO_RESUME } from "./runs.js";

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
});
