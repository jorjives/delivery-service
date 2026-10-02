// Slice 2: See Why a Task Stopped, With Every Decision and Retry Behind It
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-02 against commit 68d3410
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a list of three
// tasks, one of whose changes the project's check can never pass. The agent is
// routed to the vendored scripted agent through the contributor-only test seam:
// no network, no API key, no sign-in.
// Acceptance criteria needing a run still in flight, a pre-slice record or an
// agent-backed triage are recorded as skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { RUN_TIMEOUT, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const BANNER = "Show a cookie banner on first visit";

/** A check that fails for as long as the prices task's change is there. */
const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "test ! -f broken.txt" } });

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

const AGENT: MockScript = {
  expectations: [
    { when: { promptContains: PRICES }, ...writes("broken.txt", "updated the prices page") },
    { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
    { when: { promptContains: BANNER }, ...writes("banner.html", "added the cookie banner") },
  ],
};

/** A project whose list has run until it stopped, one task at a time or `concurrency` at once. */
async function stoppedProject(concurrency?: number) {
  const config = JSON.stringify({ closer: { type: "merge-back" }, tasks: [FORM, PRICES, BANNER], concurrency }, null, 2);
  const repo = initTempRepo("uat-status-", { "package.json": PACKAGE, ".gitignore": ".delivery/\n", "delivery.config.json": config });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(AGENT),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-status-state-")),
  };
  expect(runDelivery(["run"], { cwd: repo, env }).status).not.toBe(0);
  return { repo, env };
}

/** The `delivery status <id>` command the report prints under the failed task, as a person would copy it. */
function statusCommandIn(report: string): string[] {
  const id = /Full account: delivery status (\S+)/.exec(report)?.[1];
  if (!id) throw new Error(`the report names no status command:\n${report}`);
  return ["status", id];
}

const BUDGETS_AT_STOP = "correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3";

describe("UAT: open a task that stopped and see the decision, the retries and every step on the way", () => {
  it(
    "shows the evidence, a line per triage round and the spent correction budget; --decisions expands each round",
    async () => {
      // Steps 1-2: run the list until it finishes; copy the status command from under the failed task.
      const { repo, env } = await stoppedProject();
      const report = runDelivery(["report"], { cwd: repo, env });
      expect(report.stdout).toContain("1 failed after 4 attempts");
      const command = statusCommandIn(report.stdout);

      // Step 3: read "How it got here" and "Retry budgets at stop".
      const status = runDelivery(command, { cwd: repo, env });
      expect(status.status).toBe(0);
      // Everything status printed before this slice is still there, the check's evidence word for word.
      expect(status.stdout).toContain("This needs your decision: No correction budget remains (3/3 used).");
      expect(status.stdout).toContain("What the harness saw:\nexit:npm test: exit code 1");
      expect(status.stdout).toContain("Where to look:");
      const detail = status.stdout.slice(status.stdout.indexOf("How it got here"));
      expect(detail).toContain("How it got here (triage rounds; --decisions for the full text):");
      expect(detail).toContain("  After attempt 1: a gate failure; verdict: reroute");
      expect(detail).toContain("  After attempt 2: a gate failure; verdict: reroute");
      expect(detail).toContain("  After attempt 3: a gate failure; verdict: reroute");
      expect(detail).toContain("  After attempt 4: a gate failure; verdict: escalate");
      expect(detail).toContain(`Retry budgets at stop, after 4 attempts:\n  ${BUDGETS_AT_STOP}`);

      // Step 4: the same command with --decisions prints every round in full.
      const full = runDelivery([...command, "--decisions"], { cwd: repo, env });
      expect(full.status).toBe(0);
      expect(full.stdout).toContain("How it got here (4 triage rounds, in full):");
      expect(full.stdout).toContain("  Round 1, after attempt 1\n    Trigger: a gate failure (gate_fail)\n    Verdict: reroute\n    Rationale: \"gate_fail: reroute (correction 0/3)\"");
      // The rule-based router the command runs writes no brief, and the status says so rather than "not recorded".
      expect(full.stdout).toContain("    Brief for the next session: none; this round wrote no brief.");
      expect(full.stdout).toContain("  Round 4, after attempt 4\n    Trigger: a gate failure (gate_fail)\n    Verdict: escalate");
      expect(full.stdout).toContain('    Rationale: "correction budget exhausted (3/3): no retry remains for a gate_fail setback"');
      expect(full.stdout).toContain('    Packet for a person:\n      Decision: "No correction budget remains (3/3 used).');
      expect(full.stdout).toContain('      Evidence: "exit:npm test: exit code 1"');
      // Everything but the rounds is the same output.
      expect(full.stdout.slice(0, full.stdout.indexOf("How it got here"))).toBe(status.stdout.slice(0, status.stdout.indexOf("How it got here")));
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: a stopped task's status ends with the report's own 'To act' advice, says an unchanged task is not run again and that resume does not apply, then 'Next:'",
    async () => {
      const { repo, env } = await stoppedProject();
      const report = runDelivery(["report"], { cwd: repo, env });
      const command = statusCommandIn(report.stdout);
      const status = runDelivery(command, { cwd: repo, env });

      const advice = ["Reword the task, or remove it from your list.", "Run: delivery run"];
      for (const step of advice) {
        expect(report.stdout).toContain(step);
        expect(status.stdout.slice(status.stdout.indexOf("To act:"))).toContain(step);
      }
      expect(status.stdout).toContain("An unchanged task on your list is not run again");
      expect(status.stdout).toContain("`delivery resume` does not apply: this run is finished.");
      const last = status.stdout.trimEnd().split("\n").at(-1);
      expect(last).toBe(`Next: delivery ${command.join(" ")} --decisions (every triage round in full), delivery report (your task list)`);
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: a task with no triage rounds and no stop says so in one line each, and still shows its budgets",
    async () => {
      const { repo, env } = await stoppedProject();
      const all = runDelivery(["status", "--all"], { cwd: repo, env });
      const done = /^ {2}(add-a-contact-form\S+),/m.exec(all.stdout)?.[1];
      if (!done) throw new Error(`the listing names no run for the finished task:\n${all.stdout}`);

      const status = runDelivery(["status", done], { cwd: repo, env });
      expect(status.status).toBe(0);
      expect(status.stdout).toContain("How it got here: no triage rounds.");
      expect(status.stdout).toContain("Retry budgets when it finished, after 1 attempt:\n  correction 0 of 3,");
      expect(status.stdout).toContain("No stop: this run finished.");
      expect(status.stdout.trimEnd().split("\n").at(-1)).toMatch(/^Next: .*delivery report/);
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: status --all shows the headline counts on each run's line",
    async () => {
      const { repo, env } = await stoppedProject();
      const all = runDelivery(["status", "--all"], { cwd: repo, env });
      expect(all.status).toBe(0);
      expect(all.stdout).toMatch(/^ {2}update-the-prices-page\S+, started .*\(needs a decision from you\): 0 of 1 task completed; 1 failed after 4 attempts$/m);
      expect(all.stdout).toMatch(/^ {2}add-a-contact-form\S+, started .*\(finished\): 1 of 1 task completed and merged$/m);
      expect(all.stdout.trimEnd().split("\n").at(-1)).toBe("Next: delivery report (your task list)");
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: status for a run of several tasks rolls the retry budgets up across the run beside its shared repair limit",
    async () => {
      const { repo, env } = await stoppedProject(2);
      const status = runDelivery(["status"], { cwd: repo, env });
      expect(status.status).toBe(0);
      const runId = /^Run (run-\S+), started/m.exec(status.stdout)?.[1];
      if (!runId) throw new Error(`status names no run of several tasks:\n${status.stdout}`);
      expect(status.stdout).toContain(
        "Retry budgets across the 3 tasks this run has taken:\n  correction 3 of 9, gate recheck 0 of 9, gate repair 0 of 6, session retry 0 of 15, close retry 0 of 9\n  shared repair limit for the run: 0 of 2 used",
      );
      expect(status.stdout.trimEnd().split("\n").at(-1)).toBe(
        `Next: delivery status ${runId} --decisions (every triage round in full), delivery report ${runId} (this run in plain words)`,
      );
    },
    RUN_TIMEOUT,
  );

  it(
    "AC: --decisions is refused, exit 2, where it cannot apply, and status's exit codes are otherwise unchanged",
    async () => {
      const { repo, env } = await stoppedProject();
      const withAll = runDelivery(["status", "--all", "--decisions"], { cwd: repo, env });
      expect(withAll.status).toBe(2);
      expect(withAll.stdout).toBe("");
      expect(withAll.stderr).toContain("Use either `--all` or `--decisions`, not both");
      const unknown = runDelivery(["status", "no-such-run"], { cwd: repo, env });
      expect(unknown.status).toBe(2);
    },
    RUN_TIMEOUT,
  );

  it.skip("AC: status for a run of several tasks shows what each in-flight task is doing right now (needs a concurrently live run; timing-dependent; covered by src/cli/status-command.test.ts)", () => {});
  it.skip("AC: a run made before this slice shows what its record holds and 'not recorded' for the rest (needs a pre-slice record fixture; covered by unit tests in src/report)", () => {});
  it.skip("AC: --decisions prints the brief a round produced, word for word (the command's rule-based router writes no brief; needs an agent-backed triage; covered by src/report/detail.test.ts)", () => {});
});
