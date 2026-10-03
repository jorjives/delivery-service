// Slice 7: See How Long a Run Took and Roughly What It Cost
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-03 against commit 1712f71
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a list of two
// tasks, the agent routed to the vendored scripted agent through the
// contributor-only test seam: no network, no API key. Each scripted session is
// given a cost and a duration, which is itself the last acceptance criterion.
// Acceptance criteria needing a repair or triage session, a run where only some
// sessions recorded a figure, or a record made before this slice are recorded as
// skipped below, each with its reason.

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed command output is held as untyped data, as a consumer would hold it */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";

const AGENT: MockScript = {
  expectations: [
    {
      when: { promptContains: FORM },
      effects: [{ write: { path: "contact.html", content: "form\n" } }],
      json: { status: "completed", rationale: "added the contact form" },
      costUsd: 0.25,
      durationMs: 60_000,
    },
    {
      when: { promptContains: PRICES },
      effects: [{ write: { path: "prices.html", content: "prices\n" } }],
      json: { status: "completed", rationale: "updated the prices page" },
      costUsd: 0.1,
      durationMs: 30_000,
    },
  ],
};

/** A project whose list of two tasks has run, each task's agent session costing and taking what the script says. */
async function ranProject(script: MockScript = AGENT) {
  const repo = initTempRepo("uat-cost-", {
    "package.json": PACKAGE,
    ".gitignore": ".delivery/\n",
    "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" }, tasks: [FORM, PRICES] }, null, 2),
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-cost-state-")),
  };
  const run = runDelivery(["run"], { cwd: repo, env });
  expect(run.status).toBe(0);
  return { repo, env };
}

const json = (text: string): Record<string, any> => JSON.parse(text);

describe("UAT: see what a list of tasks cost and how long the agent spent on it, with an honest statement of how complete that figure is", () => {
  it("says the run's time and cost and how many sessions they cover; status gives each task's share; the data document carries the same", async () => {
    const { repo, env } = await ranProject();

    // Step 2: the report's "For whoever tunes this" block has the "Time and cost" line, labelled as an estimate.
    const report = runDelivery(["report"], { cwd: repo, env });
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("FOR WHOEVER TUNES THIS");
    expect(report.stdout).toContain("Time and cost, recorded for 2 of 2 agent sessions: 1 min 30 s of session time; USD 0.35, estimated by the agent runtime.");

    // Step 3: a task's status shows its own share.
    const runs = readdirSync(join(repo, ".delivery", "runs"));
    const formRun = runs.find((d) => d.startsWith("add-a-contact-form"));
    if (!formRun) throw new Error("the task left no record");
    const status = runDelivery(["status", formRun], { cwd: repo, env });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Time and cost, recorded for 1 of 1 agent session: 1 min of session time; USD 0.25, estimated by the agent runtime.");

    // Step 4: the data document carries the same figures for the run and for each task.
    const doc = json(runDelivery(["report", "--json"], { cwd: repo, env }).stdout);
    expect(doc.usage).toEqual({ costUsd: 0.35, durationMs: 90_000 });
    expect(doc.usageRecorded).toEqual({ recorded: 2, sessions: 2 });
    const form = doc.surfaces.find((s: any) => s.task === FORM);
    const prices = doc.surfaces.find((s: any) => s.task === PRICES);
    expect(form).toMatchObject({ usage: { costUsd: 0.25, durationMs: 60_000 }, usageRecorded: { recorded: 1, sessions: 1 } });
    expect(prices).toMatchObject({ usage: { costUsd: 0.1, durationMs: 30_000 }, usageRecorded: { recorded: 1, sessions: 1 } });
  });
});

describe("AC: a scripted test can give a session a cost and a duration and see them in the report", () => {
  it("shows a different script's figures, not a fixed one", async () => {
    const dear: MockScript = {
      expectations: AGENT.expectations.map((e) => ({ ...e, costUsd: 2, durationMs: 3_600_000 })),
    };
    const { repo, env } = await ranProject(dear);
    const report = runDelivery(["report"], { cwd: repo, env });
    expect(report.stdout).toContain("recorded for 2 of 2 agent sessions: 2 h of session time; USD 4.00, estimated by the agent runtime.");
  });
});

describe("AC: figures are information only", () => {
  it("does not stop or change a run: every task lands whatever it cost", async () => {
    const dear: MockScript = {
      expectations: AGENT.expectations.map((e) => ({ ...e, costUsd: 1000, durationMs: 86_400_000 })),
    };
    const { repo, env } = await ranProject(dear);
    const doc = json(runDelivery(["report", "--json"], { cwd: repo, env }).stdout);
    expect(doc.counts).toMatchObject({ closed: 2 });
  });
});

describe("AC: skipped", () => {
  it.skip("a figure covering only some sessions says how many: needs a session whose runtime reported no figure, which the scripted agent cannot produce (it reports zero) outside src/ unit tests of the document", () => {});
  it.skip("a run with nothing recorded reads 'Time and cost were not recorded for this run': needs a record made before this slice, which a fresh run cannot make", () => {});
  it.skip("sessions of every kind count (repair, agent-backed triage): needs a shared-environment repair or configured triage agent; covered by src/scripted-surface-run.test.ts", () => {});
});
