import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./case-file.js";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { deterministicRouter } from "./router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { DID_NOT_COMPLETE } from "./agent-invoke.js";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSurfaceAgainstMock } from "./testing.js";
import type { MockExpectation, MockScript, ScriptedSurfaceRun } from "./testing.js";
import type { TriageInput } from "./ports.js";
import type { BudgetSet, CloserRef, GateRef } from "./schema.js";
import { createAgentTriage } from "./triage.js";
import { deriveReport } from "./report/derive.js";
import { renderText } from "./report/text.js";
import { snapshotOf } from "./report/report-fixtures.js";

// Small correction and terminus caps keep the runs that cannot succeed short.
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 2 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const INTENT = "add a greeting file that says hello";
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

/** A worker that, when its prompt contains `trigger`, writes one file and reports completion. */
function workerScript(trigger: string, write: { path: string; content: string }): MockScript {
  return {
    expectations: [
      { when: { promptContains: trigger }, effects: [{ write }], json: { status: "completed", rationale: `wrote ${write.path}` } },
    ],
  };
}

/** One surface in a fresh scratch repository whose gate passes before the worker starts. */
async function scratchRun(script: MockScript, triage: ScriptedSurfaceRun["triage"] = () => deterministicRouter) {
  const scratch = await mkdtemp(join(tmpdir(), "scripted-surface-test-"));
  const dir = await mkdtemp(join(scratch, "case-"));
  const repoPath = initTempRepo("scripted-surface-repo-", { "report.tap": PASSING_TAP });
  const ran = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: join(scratch, "wt") },
    header: { surfaceId: "greeting", taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs,
    triage,
    script,
  });
  return { ...ran, dir, repoPath };
}

/** A triage that records each setback it is handed, then decides as the deterministic router does. */
function recordingRouter(triggers: TriageInput["trigger"][]): ScriptedSurfaceRun["triage"] {
  return () => ({
    triage: (input) => {
      triggers.push(input.trigger);
      return deterministicRouter.triage(input);
    },
  });
}

/** Each agent session's terminus, in order, as the case file recorded it. */
async function terminiOf(dir: string): Promise<string[]> {
  const { history } = await load(dir);
  return history.flatMap((e) => (e.t === "terminus" ? [`${e.status}: ${e.rationale}`] : []));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runSurfaceAgainstMock", () => {
  it("lands a scripted worker's change through the real gate and the real closer, with no key and nowhere to push", async () => {
    // A key in the caller's environment must not be what makes the run work.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-be-needed");
    const { result, dir, repoPath } = await scratchRun(workerScript("add a greeting file", { path: "greeting.txt", content: "hello\n" }));

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.source).toBe("closer");
    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [e.status] : []))).toEqual(["PASS"]);
    expect(git(repoPath, ["show", "main:greeting.txt"])).toBe("hello");
    expect(git(repoPath, ["remote"])).toBe("");
  });

  it("returns the parsed journal, which shows the task's intent reached the worker and the script was fully used", async () => {
    const script = workerScript("add a greeting file", { path: "greeting.txt", content: "hello\n" });

    const { journal } = await scratchRun(script);

    expect(promptsSent(journal)).toHaveLength(1);
    expect(promptsSent(journal)[0]).toContain(`"intent": "${INTENT}"`);
    expect(() => assertFullyConsumed(journal, script)).not.toThrow();
  });

  it("returns a journal whose consumption check shows the prompt sent and the expectation still waiting when the trigger has a typo", async () => {
    const script = workerScript("add a greting file", { path: "greeting.txt", content: "hello\n" });

    const { result, journal, repoPath } = await scratchRun(script);

    expect(result.state).toBe("ESCALATED");
    expect(() => git(repoPath, ["show", "main:greeting.txt"])).toThrow();
    expect(() => assertFullyConsumed(journal, script)).toThrow('expectation 0: waiting for a prompt containing "add a greting file"');
    expect(() => assertFullyConsumed(journal, script)).toThrow(`"intent": "${INTENT}"`);
  });
});

describe("runSurfaceAgainstMock when the agent misbehaves", () => {
  const badReplies: Array<{ name: string; expectation: MockExpectation; reason: string; unmatchedPrompts: number }> = [
    {
      name: "a prompt no expectation matches",
      expectation: { when: { promptContains: "a phrase the harness never sends" }, json: { status: "completed", rationale: "never reached" } },
      reason: DID_NOT_COMPLETE.errored,
      unmatchedPrompts: 2,
    },
    {
      name: "a reply with no envelope",
      expectation: { reply: "I looked around but never reported back." },
      reason: DID_NOT_COMPLETE.noEnvelope,
      unmatchedPrompts: 0,
    },
    {
      name: "an envelope in a triage verdict's shape",
      expectation: { json: { status: "reroute", rationale: "someone else should take this" } },
      reason: DID_NOT_COMPLETE.wrongShape,
      unmatchedPrompts: 0,
    },
    {
      name: "a scripted failure",
      expectation: { fail: { message: "the session crashed part way through" } },
      reason: DID_NOT_COMPLETE.errored,
      unmatchedPrompts: 0,
    },
  ];

  it.each(badReplies)(
    "ends the worker's session as incomplete with the plain-English reason for $name, retries it within the terminus budget, then escalates",
    async ({ expectation, reason, unmatchedPrompts }) => {
      const { result, journal, dir } = await scratchRun({ expectations: [expectation] });

      const rationale = `worker session did not complete: ${reason}`;
      expect(await terminiOf(dir)).toEqual([`incomplete: ${rationale}`, `incomplete: ${rationale}`]);
      const { history } = await load(dir);
      expect(history.some((e) => e.t === "gate")).toBe(false);
      expect(result.state).toBe("ESCALATED");
      expect(result.outcome?.reason).toBe(`terminus budget exhausted (2/2): ${rationale}`);
      // An unmatched prompt and a scripted failure share a reason; only the journal tells them apart.
      expect(journal.filter((e) => e.event === "unmatched")).toHaveLength(unmatchedPrompts);
    },
  );

  it("escalates at once when the worker escalates for authority, with no retry and no triage", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const reason = "deploying needs a production credential this worker was not given";

    const { result, journal, dir } = await scratchRun(
      { expectations: [{ json: { status: "escalate", category: "authority", rationale: reason } }] },
      recordingRouter(triggers),
    );

    expect(result.state).toBe("ESCALATED");
    expect(result.outcome?.source).toBe("worker");
    expect(result.outcome?.reason).toBe(reason);
    expect(await terminiOf(dir)).toEqual([`escalate: ${reason}`]);
    expect(promptsSent(journal)).toHaveLength(1);
    expect(triggers).toEqual([]);
  });

  it("routes a change the real gate rejects back to the worker for another attempt, and lands only the attempt that passes", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const script: MockScript = {
      expectations: [
        // Each session re-reads the script and takes the first expectation that matches,
        // so the retry's expectation, keyed on the failure the gate reported, comes first.
        {
          when: { promptContains: "2 - beta (PASS -> FAIL)" },
          effects: [{ write: { path: "report.tap", content: PASSING_TAP } }, { write: { path: "greeting.txt", content: "hello\n" } }],
          json: { status: "completed", rationale: "restored the beta check and wrote greeting.txt" },
        },
        {
          when: { promptContains: INTENT },
          effects: [{ write: { path: "report.tap", content: FAILING_TAP } }],
          json: { status: "completed", rationale: "wrote the greeting, breaking the beta check" },
        },
      ],
    };

    const { result, journal, dir, repoPath } = await scratchRun(script, recordingRouter(triggers));

    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [`${e.attempt}: ${e.status}`] : []))).toEqual(["1: FAIL", "2: PASS"]);
    expect(history.flatMap((e) => (e.t === "triage" ? [e.verdict] : []))).toEqual(["reroute"]);
    expect(triggers).toEqual(["gate_fail"]);
    expect(result.state).toBe("CLOSED");
    expect(git(repoPath, ["show", "main:report.tap"])).toBe(PASSING_TAP.trim());
    expect(git(repoPath, ["show", "main:greeting.txt"])).toBe("hello");
    expect(() => assertFullyConsumed(journal, script)).not.toThrow();
  });

  it("reports the cost and time a script gave each session, the worker's and an agent's triage alike", async () => {
    const script: MockScript = {
      expectations: [
        // Only triage's prompt carries its verdicts' names, so this expectation is triage's alone.
        {
          when: { promptContains: "\"reroute\"" },
          json: expectEnvelope(triageRoleConfig, { status: "reroute", rationale: "the beta check broke", payload: { problem: "beta fails", dead_ends: "attempt 1 broke it", scope: "report.tap", references: ["worker-1-0"], diagnosis: "restore beta" } }),
          costUsd: 0.05,
          durationMs: 4_000,
        },
        {
          when: { promptContains: "2 - beta (PASS -> FAIL)" },
          effects: [{ write: { path: "report.tap", content: PASSING_TAP } }],
          json: { status: "completed", rationale: "restored the beta check" },
          costUsd: 0.2,
          durationMs: 56_000,
        },
        { when: { promptContains: INTENT }, effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "broke the beta check" }, costUsd: 0.25, durationMs: 60_000 },
      ],
    };

    const { result, dir, repoPath } = await scratchRun(script, (agent) => createAgentTriage(agent));
    const record = { runId: "greeting", repoPath, dir, caseFile: await load(dir) };
    const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: "greeting" }, list: [], records: [record] }));

    expect(result.state).toBe("CLOSED");
    expect(doc.usageRecorded).toEqual({ recorded: 3, sessions: 3 });
    expect(renderText(doc, { colour: false })).toContain("  Time and cost, recorded for 3 of 3 agent sessions: 2 min of session time; USD 0.50, estimated by the agent runtime.");
  });
});
