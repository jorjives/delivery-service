// Slice 6: Treat the Same Check Error in Two Tasks as a Shared Problem
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-10-01 against commit fabd4bc
//
// Drives the compiled `delivery` command as a person would: real subprocesses
// (tests/helpers.ts's runDelivery) against a copy of examples/shared-environment-example,
// with its shared/outage.json set as docs/shared-environment.md step 5 describes,
// the agent routed to the vendored scripted agent so no network or sign-in is needed.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 120_000;
const BROKEN = "! Something in the shared environment looks broken.";

async function setUp(prefix: string, outage: { tasks: number; checks: number }) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "shared-environment-example") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  // Step: make the shared helper intermittently unavailable, as the guide describes.
  writeFileSync(join(repo, "shared", "outage.json"), JSON.stringify(outage));
  const script: MockScript = {
    expectations: [{ effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "did it" } }],
  };
  const scriptPath = join(mkdtempSync(join(tmpdir(), `${prefix}script-`)), "mock.json");
  await writeMockScript(scriptPath, script);
  const env = { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), `${prefix}state-`)), [TEST_MOCK_SCRIPT]: scriptPath };
  return { repo, env };
}

describe("UAT: tell a one-off hiccup apart from a problem every task is hitting", () => {
  it(
    "treats the second task to run out of check retries as a shared problem, repairs once, finishes the list, and shows the repair in status",
    async () => {
      const { repo, env } = await setUp("uat-slice-6-two-", { tasks: 2, checks: 4 });

      const run = runDelivery(["run"], { cwd: repo, env });

      // AC: a second, different task exhausting its retries puts the run into the broken state
      // and triggers a single repair, after which the run carries on.
      expect(run.status).toBe(EXIT.ok);
      expect(run.stdout).toContain(`${BROKEN} Holding any task about to check or hand off its work while it is repaired; work already under way carries on.`);
      expect(run.stdout.split("\n").filter((line) => line.startsWith("  - repairing"))).toEqual(["  - repairing (attempt 1 of 2)"]);
      expect(run.stdout).toContain("✓ Fixed. Resuming.");
      expect(run.stdout).toContain("Every task on your list is done.");
      expect(run.stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);

      // Step: `delivery status`; the repair is in the run's history.
      const status = runDelivery(["status"], { cwd: repo, env });
      expect(status.status).toBe(EXIT.ok);
      expect(status.stdout).toContain("Environment: healthy (repaired once during this run)");
      expect(status.stdout).toContain("4 done");
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: leaves a single task's check errors to that task, with no run-wide message and no repair",
    async () => {
      const { repo, env } = await setUp("uat-slice-6-one-", { tasks: 1, checks: 4 });

      const run = runDelivery(["run"], { cwd: repo, env });

      expect(run.status).toBe(EXIT.ok);
      expect(run.stdout).not.toContain(BROKEN);
      expect(run.stdout).not.toContain("repairing");
      expect(run.stdout).toContain("Every task on your list is done.");
    },
    RUN_TIMEOUT,
  );

  // The remaining ACs are not observable through the shipped example without
  // bespoke fixtures; they are verified at the integration level in
  // src/cli/run-command.test.ts and the breaker's unit tests.
  it.skip("AC: the same task erroring twice counts once (needs a per-task error trace the example cannot produce)", () => {});
  it.skip("AC: after a successful repair, earlier check-error evidence no longer counts (needs a multi-outage fixture)", () => {});
  it.skip("AC: a rate or spend limit is described as that and not counted (the scripted agent seam cannot emit a usage-limit stop through the CLI)", () => {});
});
