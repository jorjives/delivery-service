import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, appendEntry, writeRef, initialCaseFile } from "./case-file.js";
import { assemblePrompt, resolveEvidence, NO_PRIOR_TRIAGE, LANDING_BOUNDARY, UNTRUSTED_TASK, type PromptEvidence } from "./prompt-assembly.js";
import { GATE_ERROR_EVIDENCE } from "./escalation-packet.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import type { BudgetSet, GateRef, HistoryEntry } from "./schema.js";
import { stepView } from "./workflow-step.js";

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
  it.each([
    ["worker", workerRoleConfig, "You are carrying out one task for a delivery harness"],
    ["gate maintenance", gateMaintenanceRoleConfig, "The project's check could not run in this working copy"],
  ])("puts the role fragment and the domain prompt in %s's system prompt", async (_role, roleCfg, opening) => {
    const caseFile = await load(dir);
    const { systemPrompt } = assemblePrompt(caseFile, roleCfg, await resolveEvidence(dir, caseFile));
    expect(systemPrompt).toContain(opening);
    expect(systemPrompt).toContain("This is a Python service.");
  });

  it("carries the task definition, the brief slot and the envelope instruction, in that order", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("add a greeting endpoint");
    const order = ["## Task", "## Acceptance", "## Brief", "## Gate evidence", "## Reply format"];
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

  it("appends the operator's own added instructions after the role's context and the project's description", () => {
    const caseFile = initialCaseFile({ surfaceId: "s", taskDef: { intent: "t" }, gateRef, domainPrompt: "A tool.", agent: { append: "Use British English." } }, budgets);
    const { systemPrompt } = assemblePrompt(caseFile, workerRoleConfig, { brief: null, newFailures: [], setback: null });
    expect(systemPrompt).toBe(`${workerRoleConfig.systemPromptFragment}\n\nA tool.\n\nUse British English.`);
  });

  it("produces a byte-identical request for the same case file", async () => {
    const first = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second.prompt).toBe(first.prompt);
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it("frames a task from an issue tracker as data, and leaves every other prompt as it was", async () => {
    const caseFile = await load(dir);
    const evidence = await resolveEvidence(dir, caseFile);
    const plain = assemblePrompt(caseFile, workerRoleConfig, evidence);
    const fromIssue = { ...caseFile, header: { ...caseFile.header, item: { key: "github:12", source: "github", id: "12", raise: true as const, untrusted: true as const } } };
    const framed = assemblePrompt(fromIssue, workerRoleConfig, evidence);
    expect(framed.prompt).toContain(`## Task\n${UNTRUSTED_TASK}\n`);
    expect(plain.prompt).not.toContain(UNTRUSTED_TASK);
    expect(framed.prompt.replace(`${UNTRUSTED_TASK}\n`, "")).toBe(plain.prompt);
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

describe("the Acceptance section", () => {
  const caseFileWith = (header: Partial<Parameters<typeof initialCaseFile>[0]>) =>
    initialCaseFile({ surfaceId: "s", taskDef: { intent: "add a greeting" }, gateRef, ...header }, budgets);
  const acceptanceOf = (prompt: string): string => prompt.slice(prompt.indexOf("## Acceptance"), prompt.indexOf("## Brief"));
  const NOTHING: PromptEvidence = { brief: null, newFailures: [], setback: null };

  it("comes straight after the task, for the worker and for gate maintenance, and never for triage", () => {
    for (const roleCfg of [workerRoleConfig, gateMaintenanceRoleConfig]) {
      const { prompt } = assemblePrompt(caseFileWith({}), roleCfg, NOTHING);
      expect(prompt.indexOf("## Task")).toBeLessThan(prompt.indexOf("## Acceptance"));
      expect(prompt.indexOf("## Acceptance")).toBeLessThan(prompt.indexOf("## Brief"));
    }
    expect(assemblePrompt(caseFileWith({}), triageRoleConfig, NOTHING).prompt).not.toContain("## Acceptance");
  });

  it("names the check and how to run it, and no longer says it is hidden", () => {
    const acceptance = acceptanceOf(assemblePrompt(caseFileWith({}), workerRoleConfig, NOTHING).prompt);
    expect(acceptance).toContain("the command `cat report.tap`, run in this working copy");
    expect(acceptance).toContain("each test's own result is read from its TAP output");
    expect(acceptance).toContain("You may read what it runs and run it yourself.");
    expect(acceptance).not.toMatch(/cannot see|hidden/);
  });

  it("names a check of the project's own by its module, and says it is verified unchanged", () => {
    const acceptance = acceptanceOf(assemblePrompt(caseFileWith({ gateRef: { type: "custom", modulePath: "./checks/gate.mjs" } }), workerRoleConfig, NOTHING).prompt);
    expect(acceptance).toContain("the module `./checks/gate.mjs` in the project's main folder");
    expect(acceptance).toContain("verified unchanged");
  });

  it("states the guards the task is judged by, in one paragraph, and only those", () => {
    const byDefault = acceptanceOf(assemblePrompt(caseFileWith({}), workerRoleConfig, NOTHING).prompt);
    expect(byDefault).toContain("no existing test deleted or renamed; no change to how tests run");
    expect(byDefault).not.toContain("no existing test edited");
    const strict = acceptanceOf(assemblePrompt(caseFileWith({ taskDef: { intent: "x", guards: { add: ["tests-unchanged"] } } }), workerRoleConfig, NOTHING).prompt);
    expect(strict).toContain("no existing test edited");
  });

  it("ends with the landing boundary, word for word", () => {
    expect(LANDING_BOUNDARY).toBe("Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.");
    expect(acceptanceOf(assemblePrompt(caseFileWith({}), workerRoleConfig, NOTHING).prompt).trim().endsWith(LANDING_BOUNDARY)).toBe(true);
  });
});

describe("worker and gate-maintenance prompts carry no setback", () => {
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

      ## Acceptance
      Your work is judged by the project's check: the command \`cat report.tap\`, run in this working copy, where each test's own result is read from its TAP output. You may read what it runs and run it yourself. A check that passed before your work must still pass.

      The harness also checks your change against the commit this task started from: no existing test deleted or renamed; no change to how tests run (test-runner settings, CI files, the test command, .gitignore, and the Makefile or equivalent build file, since each can hide or redefine what the tests do); no new skip or only marker added to a test file; no test setting, or test that switches others off, left out of git; no existing item in .delivery/backlog/ edited or removed, and any new item you add there (a follow-up) in the item format. A failure names what it found.

      Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.

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
                  "authority",
                  "decision"
                ],
                "description": "exhaustion: you are stuck; authority: the work needs permission you were not given; decision: you need the operator to choose something before you can go on"
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              },
              "question": {
                "description": "decision only: the one question the operator must answer, written for them to read",
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

      ## Acceptance
      Your work is judged by the project's check: the command \`cat report.tap\`, run in this working copy, where each test's own result is read from its TAP output. You may read what it runs and run it yourself. A check that passed before your work must still pass.

      The harness also checks your change against the commit this task started from: no existing test deleted or renamed; no change to how tests run (test-runner settings, CI files, the test command, .gitignore, and the Makefile or equivalent build file, since each can hide or redefine what the tests do); no new skip or only marker added to a test file; no test setting, or test that switches others off, left out of git; no existing item in .delivery/backlog/ edited or removed, and any new item you add there (a follow-up) in the item format. A failure names what it found.

      Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.

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
                  "authority",
                  "decision"
                ],
                "description": "exhaustion: you are stuck; authority: the work needs permission you were not given; decision: you need the operator to choose something before you can go on"
              },
              "rationale": {
                "type": "string",
                "minLength": 1
              },
              "question": {
                "description": "decision only: the one question the operator must answer, written for them to read",
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

  it("says a gate error left nothing to read, rather than pointing at gate evidence that is not there", async () => {
    await appendEntry(dir, { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));
    const setback = prompt.slice(prompt.indexOf("## Setback"), prompt.indexOf("## Reply format"));
    expect(setback).toContain("Trigger: gate_error");
    expect(setback).toContain(GATE_ERROR_EVIDENCE);
    expect(setback).not.toContain("listed under Gate evidence above");
  });
});

describe("a command gate's setup and teardown", () => {
  it("tells the agent in the Acceptance slot", async () => {
    const hooked: GateRef = { type: "command", command: "npm test", parseMode: "exitcode", setup: "docker compose up -d", teardown: "docker compose down" };
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt({ ...caseFile, header: { ...caseFile.header, gateRef: hooked } }, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("Before it runs, `docker compose up -d` sets up; afterwards, `docker compose down` tears down, whatever the result.");
  });
});

describe("the Step slot", () => {
  const workflow = { name: "w", steps: [{ name: "plan", prompt: "Write PLAN.md." }, { name: "build", prompt: "Carry out PLAN.md.", agent: { append: "Be brief." } }] };
  const NOTHING: PromptEvidence = { brief: null, newFailures: [], setback: null };
  const caseFileWith = (header: Partial<Parameters<typeof initialCaseFile>[0]>) =>
    initialCaseFile({ surfaceId: "s", taskDef: { intent: "add a greeting" }, gateRef, ...header }, budgets);
  const withHistory = (cf: ReturnType<typeof caseFileWith>, history: HistoryEntry[]) => ({ ...cf, history });

  it("follows the task with the current step's instruction", () => {
    const cf = stepView(withHistory(caseFileWith({ workflow }), [{ t: "step", step: 2, startCommit: "c1" }]));
    const { prompt, systemPrompt } = assemblePrompt(cf, workerRoleConfig, NOTHING);
    expect(prompt).toContain('## Step\nStep 2 of 2, "build":\nCarry out PLAN.md.\n\n## Acceptance');
    expect(systemPrompt.endsWith("Be brief.")).toBe(true);
  });

  it("is absent, and the prompt unchanged, for a run with no workflow", () => {
    const cf = caseFileWith({});
    expect(assemblePrompt(stepView(cf), workerRoleConfig, NOTHING)).toEqual(assemblePrompt(cf, workerRoleConfig, NOTHING));
    expect(assemblePrompt(cf, workerRoleConfig, NOTHING).prompt).not.toContain("## Step");
  });

  it("says the check is the step's own only when the step names one, and the guards diff from the step's start", () => {
    const own: GateRef = { type: "command", command: "test -f PLAN.md", parseMode: "exitcode", checkOnly: true };
    const named = { ...workflow, steps: [{ name: "plan", prompt: "Write PLAN.md.", gateRef: own }, workflow.steps[1] as (typeof workflow.steps)[number]] };
    const first = assemblePrompt(stepView(caseFileWith({ workflow: named })), workerRoleConfig, NOTHING).prompt;
    expect(first).toContain("Your work is judged by this step's check: the command `test -f PLAN.md`");
    expect(first).toContain("against the commit this step started from");
    const second = assemblePrompt(stepView(withHistory(caseFileWith({ workflow: named }), [{ t: "step", step: 2, startCommit: "c1" }])), workerRoleConfig, NOTHING).prompt;
    expect(second).toContain("Your work is judged by the project's check: the command `cat report.tap`");
    expect(second).toContain("against the commit this step started from");
  });
});

describe("the Continuing section", () => {
  const CONTINUES = { runId: "r1", worktreePath: "wt", from: "abc", startCommit: "abc", baseline: null } as const;
  const caseFileWith = (header: Partial<Parameters<typeof initialCaseFile>[0]>) =>
    initialCaseFile({ surfaceId: "s", taskDef: { intent: "add a greeting" }, gateRef, ...header }, budgets);
  const NOTHING: PromptEvidence = { brief: null, newFailures: [], setback: null };

  it("tells a continued session the operator's answer, after the step", () => {
    const { prompt } = assemblePrompt(
      caseFileWith({ continues: { ...CONTINUES, turn: { kind: "answer", question: "Formal?", answer: "Yes, formal." } } }),
      workerRoleConfig, NOTHING,
    );
    expect(prompt).toContain("## Continuing\nYou stopped to ask the operator: Formal?\nTheir answer: Yes, formal.\nThe work so far is in this working copy. Carry on from where it got to, using their answer.");
  });

  it("tells a continued session its signed-off work must pass again where it lands", () => {
    const { prompt } = assemblePrompt(caseFileWith({ continues: { ...CONTINUES, turn: { kind: "signed_off" } } }), workerRoleConfig, NOTHING);
    expect(prompt).toContain("The operator signed this work off, but it no longer passes its checks where it is to land. Put it right; it will wait for their sign-off again.");
  });

  it("tells a continued session it was interrupted", () => {
    const { prompt } = assemblePrompt(caseFileWith({ continues: { ...CONTINUES, turn: { kind: "interrupted" } } }), workerRoleConfig, NOTHING);
    expect(prompt).toContain("## Continuing\nAn earlier session on this task was interrupted before it finished. The work so far is in this working copy. Carry on from where it got to.");
  });

  it("sits after the step, and is not given to triage", () => {
    const named = { name: "plan-then-build", steps: [{ name: "plan", prompt: "write PLAN.md" }] };
    const continued = caseFileWith({ workflow: named, continues: { ...CONTINUES, turn: { kind: "interrupted" } } });
    const { prompt } = assemblePrompt(continued, workerRoleConfig, NOTHING);
    expect(prompt.indexOf("## Step")).toBeLessThan(prompt.indexOf("## Continuing"));
    expect(assemblePrompt(continued, triageRoleConfig, NOTHING).prompt).not.toContain("## Continuing");
  });
});

describe("evidence after a conflicting landing", () => {
  it("shows the conflict as the newest failure, not an older gate round's", async () => {
    const old = await writeRef(dir, "gate-1-0-0", { id: "t1", baselineOutcome: "PASS", checkOutcome: "FAIL", detail: "an old failure" });
    await appendEntry(dir, { t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "t1", detailRef: old }] });
    const detail = "Rebuilding this task on delivery/main conflicts in shared.txt.";
    const ref = await writeRef(dir, "landing-1", { id: "landing:conflict", baselineOutcome: "PASS", checkOutcome: "FAIL", detail });
    await appendEntry(dir, { t: "landing", onto: "tip", baseline: { status: "PASS", assertions: [] }, conflict: { files: ["shared.txt"], kept: "surface/s-1-conflict-1" }, newFailures: [{ id: "landing:conflict", detailRef: ref }] });

    const evidence = await resolveEvidence(dir, await load(dir));

    expect(evidence.newFailures.map((f) => f.detail)).toEqual([detail]);
  });
});
