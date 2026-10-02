// Slice 1: Come Back to Your Task List and See What Happened and What to Do
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-02 against commit 8c0c721
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a list of four
// tasks, the agent routed to the vendored scripted agent through the
// contributor-only test seam: no network, no API key, no sign-in.
// Acceptance criteria needing a pre-slice run, a damaged record or a live run
// are recorded as skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../../src/git-env.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const PURGE = "Remove every page under the old news section";
const BANNER = "Show a cookie banner on first visit";
const PERMISSION = "The owner has confirmed the 14 published pages may be deleted.";
const SAID = "This would delete 14 published pages. I need the owner to confirm before I remove them.";

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

function agent(refusal: string): MockScript {
  return {
    expectations: [
      { when: { promptContains: PERMISSION }, ...writes("news-removed.txt", "removed the 14 pages") },
      { when: { promptContains: PURGE }, json: { status: "escalate", category: "authority", rationale: refusal } },
      { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
      { when: { promptContains: PRICES }, ...writes("prices.html", "updated the prices page") },
      { when: { promptContains: BANNER }, ...writes("banner.html", "added the cookie banner") },
    ],
  };
}

const configOf = (tasks: string[]): string => JSON.stringify({ closer: { type: "merge-back" }, tasks }, null, 2);

async function project(refusal = SAID) {
  const repo = initTempRepo("uat-report-", { "package.json": PACKAGE, ".gitignore": ".delivery/\n", "delivery.config.json": configOf([FORM, PRICES, PURGE, BANNER]) });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(agent(refusal)),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-report-state-")),
  };
  return { repo, env };
}

const INTERNAL = /\b(surface|budget|gate|triage|authority|terminus|breaker|escalated)\b/i;

describe("UAT: come back to a task list and see what happened and what to do", () => {
  it("reports what landed and what needs the owner, then shows the task done once she follows the steps", async () => {
    const { repo, env } = await project();

    // Steps 1-2: run the list until it stops; read the report's top line.
    const run = runDelivery(["run"], { cwd: repo, env });
    expect(run.status).not.toBe(0);
    const first = runDelivery(["report"], { cwd: repo, env });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("2 of 4 tasks completed and merged; 1 needs your decision; 1 not started.");
    expect(first.stdout).not.toMatch(INTERNAL);

    // Step 3: the task under "Needs you" quotes the agent and says how to act.
    const needs = first.stdout.slice(first.stdout.indexOf("NEEDS YOU"), first.stdout.indexOf("DONE ("));
    expect(needs).toContain(PURGE);
    expect(needs).toContain("Needs your decision");
    expect(needs).toContain(`The agent said: "${SAID}"`);
    expect(needs).toContain("Where the work is");
    expect(needs).toContain("To act:");
    expect(needs).toContain("add the permission to the task wording");
    expect(needs).toContain("delivery run");
    expect(needs).not.toContain("delivery resume");
    expect(first.stdout).toContain("NOT STARTED (1)");
    expect(first.stdout).toContain("waiting behind task 3");
    expect(first.stdout).toMatch(/^Next: .*delivery/m);

    // Step 4: follow the steps, run again, read the report again.
    writeFileSync(join(repo, "delivery.config.json"), configOf([FORM, PRICES, `${PURGE}. ${PERMISSION}`, BANNER]));
    execFileSync("git", ["commit", "-qam", "give the permission"], { cwd: repo, env: cleanGitEnv(), stdio: "pipe" });
    expect(runDelivery(["run"], { cwd: repo, env }).status).toBe(0);
    const second = runDelivery(["report"], { cwd: repo, env });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("4 of 4 tasks completed and merged.");
    expect(second.stdout).not.toContain("NEEDS YOU");
    expect(second.stdout).not.toContain("NOT STARTED");
    expect(second.stdout).toContain(`Task 3 of 4: "${PURGE}. ${PERMISSION}": merged into main`);
  });

  it("AC: the same record prints the same report, byte for byte, and exits 0 whatever it says", async () => {
    const { repo, env } = await project();
    runDelivery(["run"], { cwd: repo, env });
    const a = runDelivery(["report"], { cwd: repo, env });
    const b = runDelivery(["report"], { cwd: repo, env: { ...env, COLUMNS: "40" } });
    expect(a.status).toBe(0);
    expect(b.stdout).toBe(a.stdout);
  });

  it("AC: escape sequences in the agent's quoted words cannot change the terminal", async () => {
    const { repo, env } = await project("I will not do this.\u001b[2J\u001b]0;pwned\u0007 Ask the owner.");
    runDelivery(["run"], { cwd: repo, env });
    const { stdout, status } = runDelivery(["report"], { cwd: repo, env });
    expect(status).toBe(0);
    expect(stdout).not.toContain("\u001b");
    expect(stdout).not.toContain("\u0007");
    expect(stdout).toContain("I will not do this.");
    expect(stdout).toContain("Ask the owner.");
  });

  it("AC: with no runs in the folder it says so and how to start one, and exits 0", async () => {
    const { repo, env } = await project();
    const { stdout, status } = runDelivery(["report"], { cwd: repo, env });
    expect(status).toBe(0);
    expect(stdout).toMatch(/no runs/i);
    expect(stdout).toContain("delivery run");
  });

  it.skip("AC: a run made before this slice still reports, with 'not recorded' for missing facts (needs a pre-slice record fixture; the harness cannot make one now)", () => {});
  it.skip("AC: one damaged task record does not stop the report (needs a hand-corrupted record; covered by unit tests in src)", () => {});
  it.skip("AC: a run still going never prints a final-sounding headline (needs a concurrently live run; timing-dependent)", () => {});
  it.skip("AC: a task that stopped on a usage limit says so in those words (not driven live; covered by unit tests in src)", () => {});
});
