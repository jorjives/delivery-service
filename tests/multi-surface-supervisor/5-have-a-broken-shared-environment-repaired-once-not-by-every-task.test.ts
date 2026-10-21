// Slice 5: Have a Broken Shared Environment Repaired Once, Not by Every Task
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-10-01 against commit ad67e95
//
// Drives the compiled `delivery` command as a person would: real subprocesses
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped `examples/shared-environment-example` (its check reads
// a shared helper file that lives outside every task's own copy, so deleting
// it breaks the whole run rather than one task), the agent routed to the
// vendored scripted agent through the contributor-only test seam so the UAT
// needs no network, no API key and no real Claude Code sign-in.
//
// This follows docs/shared-environment.md's own walkthrough exactly: a repair
// session works inside its own task's copy, so it can restore a helper that
// lives there, but the shared helper here lives in the repository root,
// outside every copy, so each repair genuinely cannot reach it and the run
// exhausts its run-wide repair limit. That is the same guarantee slice 5
// promises, demonstrated from the side this fixture can actually reach: a
// successful repair (Fixed. Resuming., held tasks carry on) is exercised at
// the integration level in src/cli/run-command.test.ts against a gate whose
// fix lives inside a task's own copy.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

/** A throwaway git-initialised copy of the shared-environment example, as the guide's own walkthrough sets one up. */
function sharedEnvironmentCopy(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "shared-environment-example") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function scratchState(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function scriptFile(script: MockScript, prefix: string): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), prefix)), "mock.json");
  await writeMockScript(path, script);
  return path;
}

/** Every task session answers the same way: the shared check errors regardless of what a session writes, so one scripted turn serves every task and every repair attempt. */
const completesEveryTurn: MockScript = {
  expectations: [
    { effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "did it" } },
  ],
};

/** The run id the opening "Starting run <id>: ..." line names. */
function runIdIn(stdout: string): string {
  const match = /^Starting run (run-\S+?):/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no supervised run id in:\n${stdout}`);
  return match[1];
}

describe("UAT: trust that one broken piece of shared set-up is fixed once for the whole run, and be told plainly when it cannot be", () => {
  it(
    "holds any task about to check or hand off its work, runs exactly one repair per attempt against one run-wide limit, and states plainly the environment is the cause once that limit is spent",
    async () => {
      const repo = sharedEnvironmentCopy("uat-slice-5-");
      const script = await scriptFile(completesEveryTurn, "uat-slice-5-script-");
      const env = { ...process.env, XDG_STATE_HOME: scratchState("uat-slice-5-state-"), [TEST_MOCK_SCRIPT]: script };

      // Step: break the shared helper every task's check reads, outside every task's own copy.
      rmSync(join(repo, "shared", "helper.json"));

      // Step: `delivery run` the example's four tasks, two at once.
      const run = runDelivery(["run"], { cwd: repo, env });

      // AC: exactly one repair runs per attempt, however many tasks asked for it, against one
      // run-wide limit (2, per the example's default budget) rather than one per task.
      const repairingLines = run.stdout.split("\n").filter((line) => /^ {2}- repairing \(attempt \d of \d\)$/.test(line));
      expect(repairingLines).toEqual(["  - repairing (attempt 1 of 2)", "  - repairing (attempt 2 of 2)"]);

      // AC: while broken, no task begins checking or handing off its work -- both tasks that had
      // started stayed held rather than being force-stopped, and the two others never started.
      expect(run.stdout).toContain("! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.");

      // AC: repair failing within the run-wide limit stops the run, says how many tasks were
      // waiting, finished and still queued, and exits with the "needs a decision" code.
      expect(run.status).toBe(EXIT.escalated);
      expect(run.stdout.trimEnd().split("\n").at(-3)).toBe(
        "Couldn't fix it after 2 attempts. Stopping the run. 2 of 4 tasks were waiting on this and need your attention; 0 had already finished, 2 are still queued.",
      );

      // AC: human-readable output never leaks the breaker's internal state names.
      expect(run.stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);

      const runId = runIdIn(run.stdout);

      // AC: `delivery status` leads with the environment narration, naming what broke and which
      // tasks it held, when the environment is not healthy.
      const status = runDelivery(["status"], { cwd: repo, env });
      expect(status.status).toBe(EXIT.ok);
      const statusLines = status.stdout.trimEnd().split("\n");
      expect(statusLines[0]).toBe("The shared environment could not be fixed after 2 attempts, so the run stopped; no task caused this.");
      expect(statusLines[1]).toMatch(/^It was first noticed by \[\d\/4] .*?: the shared helper .*shared\/helper\.json is missing, so the check cannot run\.$/);
      expect(statusLines[2]).toMatch(/^Held: \[\d\/4] .*?, \[\d\/4] .*?\.$/);
      expect(status.stdout).toContain(`Environment: something in the shared environment looks broken`);
      expect(status.stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);

      // AC: `--json` carries a run-scope line for each change in the environment's state, with
      // the tasks affected, and the run outcome names the shared environment as the cause.
      const statusJson = runDelivery(["status", runId, "--json"], { cwd: repo, env });
      expect(statusJson.status).toBe(EXIT.ok);
      const parsed = JSON.parse(statusJson.stdout) as { cause?: string; runBudgets: { gateMaintenance: { used: number; max: number } }; trips: unknown[] };
      expect(parsed.cause).toBe("shared_environment");
      expect(parsed.runBudgets.gateMaintenance).toEqual({ used: 2, max: 2 });
      // One trip's worth of history per repair attempt, plus the final attempt that gives up.
      expect(parsed.trips).toHaveLength(3);
    },
    RUN_TIMEOUT,
  );

  it(
    "carries `--json`'s run-scope events through every breaker state change, naming the tasks each one affects",
    async () => {
      const repo = sharedEnvironmentCopy("uat-slice-5-json-");
      const script = await scriptFile(completesEveryTurn, "uat-slice-5-json-script-");
      const env = { ...process.env, XDG_STATE_HOME: scratchState("uat-slice-5-json-state-"), [TEST_MOCK_SCRIPT]: script };

      rmSync(join(repo, "shared", "helper.json"));

      const run = runDelivery(["run", "--json"], { cwd: repo, env });

      expect(run.status).toBe(EXIT.escalated);
      const runRecords = run.stdout
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as { scope: string; state: string; affected: string[] | null; done: boolean })
        .filter((record) => record.scope === "run");

      expect(runRecords.map((record) => record.state)).toEqual([
        "STARTED", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "ESCALATED",
      ]);
      expect(runRecords[0]?.affected).toBeNull();
      expect(runRecords.at(-1)).toMatchObject({ done: true });
      // Every change while the environment is broken names at least the task that found it.
      for (const record of runRecords.slice(1)) expect(record.affected?.length).toBeGreaterThan(0);
    },
    RUN_TIMEOUT,
  );
});
