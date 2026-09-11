import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, appendEntry, writeRef } from "./case-file.js";
import { assemblePrompt, resolveEvidence, NO_PRIOR_TRIAGE } from "./prompt-assembly.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prompt-assembly-"));
  await create(
    dir,
    {
      surfaceId: "s-1",
      taskDef: { intent: "add a greeting endpoint" },
      gateRef,
      domainPrompt: "This is a Python service.",
    },
    budgets,
  );
});

describe("assemblePrompt", () => {
  it("puts the role fragment and the domain prompt in the system prompt", async () => {
    const caseFile = await load(dir);
    const { systemPrompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(systemPrompt).toContain("You are the worker on a gated delivery harness.");
    expect(systemPrompt).toContain("This is a Python service.");
  });

  it("carries the task definition, the brief slot and the envelope instruction, in that order", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("add a greeting endpoint");
    const order = ["## Task", "## Brief", "## Gate evidence", "## Reply format"];
    const positions = order.map((heading) => prompt.indexOf(heading));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("names the role's legal statuses in the envelope instruction", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("completed");
    expect(prompt).toContain("escalate");
  });

  it("says plainly when there is no brief and no gate evidence yet", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
    expect(prompt).toContain("No failing assertions");
  });

  it("reproduces the gate's newly-failing assertions verbatim", async () => {
    const detailRef = await writeRef(dir, "gate-1-0-0", {
      id: "test_greeting",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "AssertionError: expected 'hi' to equal 'hello'",
    });
    await appendEntry(dir, {
      t: "gate",
      attempt: 1,
      status: "FAIL",
      newFailures: [{ id: "test_greeting", detailRef }],
      class: "fail",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("test_greeting");
    expect(prompt).toContain("AssertionError: expected 'hi' to equal 'hello'");
  });

  it("produces a byte-identical request for the same case file", async () => {
    const first = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second.prompt).toBe(first.prompt);
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it("ignores the session key, so a retry re-sends the same request", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    const before = await load(dir);
    const first = assemblePrompt(before, workerRoleConfig, await resolveEvidence(dir, before));
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-1" });
    const after = await load(dir);
    const second = assemblePrompt(after, workerRoleConfig, await resolveEvidence(dir, after));
    expect(second.prompt).toBe(first.prompt);
  });
});

describe("worker and gate-maintenance prompts are unchanged by triage", () => {
  it("renders the worker prompt exactly as before", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "exhaustion", rationale: "I am stuck",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toMatchInlineSnapshot(`
      "## Task
      {
        "intent": "add a greeting endpoint"
      }

      ## Brief
      No distilled brief — work from the task and the gate evidence below.

      ## Gate evidence
      No failing assertions recorded yet.

      ## Reply format
      End your turn by emitting a JSON object matching this schema exactly:

      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "const": "completed"
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "status",
              "rationale"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "const": "escalate"
              },
              "category": {
                "type": "string",
                "enum": [
                  "exhaustion",
                  "authority"
                ]
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "status",
              "category",
              "rationale"
            ],
            "additionalProperties": false
          }
        ]
      }

      Emit no other status. A reply that does not match this schema is treated as
      no reply at all, and the attempt is recorded as incomplete.
      "
    `);
  });

  it("renders the gate-maintenance prompt exactly as before", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, gateMaintenanceRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toMatchInlineSnapshot(`
      "## Task
      {
        "intent": "add a greeting endpoint"
      }

      ## Brief
      No distilled brief — work from the task and the gate evidence below.

      ## Gate evidence
      No failing assertions recorded yet.

      ## Reply format
      End your turn by emitting a JSON object matching this schema exactly:

      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "const": "completed"
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "status",
              "rationale"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "const": "escalate"
              },
              "category": {
                "type": "string",
                "enum": [
                  "exhaustion",
                  "authority"
                ]
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "status",
              "category",
              "rationale"
            ],
            "additionalProperties": false
          }
        ]
      }

      Emit no other status. A reply that does not match this schema is treated as
      no reply at all, and the attempt is recorded as incomplete.
      "
    `);
  });
});

const sharpened = {
  problem: "the greeting is 'hi', the test wants 'hello'",
  dead_ends: "attempt 1 edited the template, but the string comes from the i18n table",
  scope: "touch src/i18n/en.json only",
  references: ["worker-1-0"],
  diagnosis: "the i18n key was renamed",
};

/** A stuck worker's escalate on attempt 1: the tail triage reads. */
async function stuckWorker(): Promise<void> {
  await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
  await appendEntry(dir, {
    t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
    status: "escalate", category: "exhaustion", rationale: "I cannot find where the greeting comes from",
  });
}

describe("the brief a triage reroute left behind", () => {
  it("renders each field under its own label, with the diagnosis marked as a hypothesis", async () => {
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "retry", artifact: sharpened });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));

    const brief = prompt.slice(prompt.indexOf("## Brief"), prompt.indexOf("## Gate evidence"));
    expect(brief).toContain(`Problem: ${sharpened.problem}`);
    expect(brief).toContain(`Dead ends: ${sharpened.dead_ends}`);
    expect(brief).toContain(`Scope: ${sharpened.scope}`);
    expect(brief).toContain("References: worker-1-0");
    expect(brief).toContain(`Diagnosis (a hypothesis to test, not an established fact): ${sharpened.diagnosis}`);
    expect(prompt.indexOf("## Gate evidence")).toBeGreaterThan(prompt.indexOf("## Brief"));
  });

  it("falls back to the no-brief sentence when the ref carries no artefact (a deterministic reroute)", async () => {
    await writeRef(dir, "triage-0", { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
  });

  it("falls back to the no-brief sentence when the artefact is malformed (missing fields)", async () => {
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "retry", artifact: { problem: "only this field" } });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
  });
});

describe("the triage prompt's setback slot", () => {
  it("shows the setback, the remaining budgets and the fixed no-prior-rounds sentence", async () => {
    await stuckWorker();
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));

    const setback = prompt.slice(prompt.indexOf("## Setback"), prompt.indexOf("## Reply format"));
    expect(prompt.indexOf("## Setback")).toBeGreaterThan(prompt.indexOf("## Gate evidence"));
    expect(setback).toContain("Trigger: worker_escalate (exhaustion)");
    expect(setback).toContain("- correction: 0/3");
    expect(setback).toContain("- gateMaintenance: 0/2");
    expect(setback).toContain("I cannot find where the greeting comes from");
    expect(setback).toContain(NO_PRIOR_TRIAGE);
  });

  it("lists earlier triage rationales oldest first", async () => {
    await stuckWorker();
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "first round" });
    await appendEntry(dir, { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "reroute", rationale: "first round: retry", artifactRef: "triage-0" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" });
    await appendEntry(dir, { t: "gate", attempt: 2, status: "FAIL", newFailures: [] });
    await appendEntry(dir, { t: "triage", afterAttempt: 2, trigger: "gate_fail", verdict: "reroute", rationale: "second round: retry", artifactRef: "triage-1" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 3, sessionKey: "worker-3-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 3, sessionKey: "worker-3-0",
      status: "escalate", category: "exhaustion", rationale: "still stuck",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));

    expect(prompt).not.toContain(NO_PRIOR_TRIAGE);
    expect(prompt.indexOf("- first round: retry")).toBeGreaterThan(-1);
    expect(prompt.indexOf("- second round: retry")).toBeGreaterThan(prompt.indexOf("- first round: retry"));
    expect(prompt).toContain("- correction: 2/3");
  });

  it("shows a close failure's report detail as the setback evidence", async () => {
    await writeRef(dir, "close-0", { status: "FAIL", detail: "merge conflict in src/app.ts" });
    await appendEntry(dir, { t: "close", status: "FAIL", detailRef: "close-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("Trigger: close_failure");
    expect(prompt).toContain("merge conflict in src/app.ts");
  });

  it("assembles the identical triage request twice from the same case file", async () => {
    await stuckWorker();
    const first = assemblePrompt(await load(dir), triageRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), triageRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second).toEqual(first);
  });

  it("is never rendered for a worker, even when the tail is a setback", async () => {
    await stuckWorker();
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).not.toContain("## Setback");
  });
});
