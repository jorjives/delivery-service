import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./case-file.js";
import { cleanGitEnv } from "./git-env.js";
import { initTempRepo } from "./temp-repo.js";
import { deterministicRouter } from "./router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "./testing.js";
import type { MockScript, ScriptedSurfaceRun } from "./testing.js";
import type { TriageInput } from "./ports.js";
import type { BudgetSet, CloserRef, GateRef } from "./schema.js";

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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

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

  it("does not land a change the real gate rejects, and hands the setback to the caller's triage", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const recordingTriage: ScriptedSurfaceRun["triage"] = () => ({
      triage: (input) => {
        triggers.push(input.trigger);
        return deterministicRouter.triage(input);
      },
    });

    const { result, dir, repoPath } = await scratchRun(
      workerScript("add a greeting file", { path: "report.tap", content: FAILING_TAP }),
      recordingTriage,
    );

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [e.status] : []))[0]).toBe("FAIL");
    expect(triggers[0]).toBe("gate_fail");
    expect(git(repoPath, ["show", "main:report.tap"])).toBe(PASSING_TAP.trim());
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
