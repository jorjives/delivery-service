import { describe, expect, it } from "vitest";
import { SurfaceState } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile, TASK } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import type { MockScript } from "../mock-script.js";
import type { OutcomeSummary } from "./outcome.js";
import { jsonReporter, plainReporter, type StepRecord } from "./report.js";

const ESC = "[";
const AT = "2026-09-16T12:00:00.000Z";
const clock = () => new Date(AT);

const SUMMARY: OutcomeSummary = {
  headline: "Done: the change passed `npm test` and is committed on branch surface/x.",
  tone: "done",
  details: ["main was not changed. To look at the work: git log surface/x"],
  exitCode: EXIT.ok,
};

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

describe("telling a person what a run is doing", () => {
  it("writes one plain line per step", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "PROVISIONING", done: false });
    reporter.step({ state: "PRE_GATING", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(lines).toEqual(["- setting up", "- checking the starting point", "- the agent is working"]);
  });

  it("does not repeat a step that reads the same as the one before", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "GATING", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(lines).toEqual(["- the agent is working", "- checking the agent's work", "- the agent is working"]);
  });

  it("says what a step had to put right, under the step it belongs to", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    expect(lines).toEqual(["- checking the agent's work", "Had to put something right: re-created the working copy."]);
  });

  it("ends with the outcome headline and the lines under it, and says notes as they are", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.note("Starting run add-a-hello-20260916T120000Z: add a hello");
    reporter.outcome(SUMMARY);
    expect(lines).toEqual(["Starting run add-a-hello-20260916T120000Z: add a hello", SUMMARY.headline, ...SUMMARY.details]);
  });

  it("prints no escape codes when colour is off", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "CLOSING", done: false });
    reporter.outcome(SUMMARY);
    expect(lines.join("")).not.toContain(ESC);
  });
});

describe("telling a script what a run is doing", () => {
  /** A reporter whose records, notes and clock the test owns. */
  function scripted() {
    const records: string[] = [];
    const notes: string[] = [];
    return { records, notes, reporter: jsonReporter((line) => records.push(line), (line) => notes.push(line), clock) };
  }

  it("writes one JSON object per step: the raw state, whether that was the last one, and when", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "PROVISIONING", done: false });
    reporter.step({ state: "CLOSED", done: true });
    expect(records.map((line) => JSON.parse(line) as StepRecord)).toEqual([
      { state: "PROVISIONING", done: false, at: AT },
      { state: "CLOSED", done: true, at: AT },
    ]);
  });

  it("carries a recovery note on the step that put it right, and leaves the key off every other step", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    reporter.step({ state: "CLOSING", done: false });
    expect(records.map((line) => JSON.parse(line) as StepRecord)).toEqual([
      { state: "GATING", done: false, recovery: "re-created the working copy", at: AT },
      { state: "CLOSING", done: false, at: AT },
    ]);
  });

  it("repeats a state that repeats: one object per step, never per phrase", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(records).toHaveLength(2);
  });

  it("keeps everything that is not a step off the machine-readable stream, the closing sentence included", () => {
    const { records, notes, reporter } = scripted();
    reporter.note("Starting run add-a-hello-20260916T120000Z: add a hello");
    reporter.outcome(SUMMARY);
    expect(records).toEqual([]);
    expect(notes).toEqual([
      "Starting run add-a-hello-20260916T120000Z: add a hello",
      SUMMARY.headline,
      ...SUMMARY.details,
    ]);
  });
});

describe("delivery run --json", () => {
  it(
    "prints one JSON object per step instead of the plain-language lines, and exits the same way",
    async () => {
      const repo = initTempRepo("run-json-closed-", { "package.json": PACKAGE });

      const { exitCode, stdout, stderr } = await delivery(["run", "--json", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StepRecord);
      expect(records.map((record) => record.state)).toEqual([
        "PROVISIONING",
        "PRE_GATING",
        "AGENT_ACTIVE",
        "GATING",
        "CLOSING",
        "CLOSED",
      ]);
      expect(records.map((record) => record.done)).toEqual([false, false, false, false, false, true]);
      for (const record of records) expect(Number.isNaN(Date.parse(record.at))).toBe(false);
      expect(stdout).not.toContain("- setting up");
      expect(stdout).not.toContain("Done: the change");
      expect(stderr).toContain("Starting run");
      // The words a person watching still needs, on the stream a parser ignores.
      expect(stderr).toContain("Done: the change");
    },
    RUN_TIMEOUT,
  );

  it(
    "exits escalated from a run that needs a person, exactly as the plain-language run does",
    async () => {
      const repo = initTempRepo("run-json-escalated-", { "package.json": PACKAGE });

      const { exitCode, stdout } = await delivery(["run", "--json", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
      });

      expect(exitCode).toBe(EXIT.escalated);
      const records = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StepRecord);
      expect(records.at(-1)).toMatchObject({ state: "ESCALATED", done: true });
    },
    RUN_TIMEOUT,
  );

  it("offers --json on the command itself, so --help says it exists", async () => {
    const repo = initTempRepo("run-json-help-", { "package.json": PACKAGE });

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["run", "--help"], { cwd: repo });

    expect(top.stdout).toContain("--json");
    expect(own.stdout).toContain("--json");
  });
});

describe("plain language in every environment", () => {
  it(
    "prints plain-language lines when nothing is a terminal and CI is set, because only --json switches format",
    async () => {
      const repo = initTempRepo("run-plain-ci-", { "package.json": PACKAGE });

      const { stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        isTTY: false,
        env: { CI: "true", [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("- setting up");
      expect(stdout).toContain("Done: the change");
      for (const state of SurfaceState.options) expect(stdout).not.toContain(state);
    },
    RUN_TIMEOUT,
  );
});
