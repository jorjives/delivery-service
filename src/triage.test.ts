import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentTriage, needsJudgement, toTriageVerdict } from "./triage.js";
import { fakeAgentPort } from "./testing.js";
import { initTempRepo } from "./temp-repo.js";
import { git } from "../tests/helpers.js";
import { create, load } from "./case-file.js";
import type { AgentContext, AgentPort, TriageInput, TriageTerminus, Metered } from "./ports.js";
import type { BudgetSet, CaseFile, GateRef } from "./schema.js";
import { DID_NOT_COMPLETE } from "./agent-invoke.js";
import type { TriageEnvelope } from "./triage-role-config.js";

const ctx: AgentContext = { worktreePath: initTempRepo("triage-", { "a.txt": "a\n" }), dir: "/d", sessionKey: "triage-0" };

function budgets(correctionUsed: number, closeUsed = 0): BudgetSet {
  return {
    correction: { used: correctionUsed, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: closeUsed, max: 3 },
  };
}

function input(overrides: Partial<TriageInput>): TriageInput {
  return {
    trigger: "worker_escalate",
    category: "exhaustion",
    caseFile: { history: [] } as unknown as CaseFile, // gate_fail reads the last gate round; every other trigger still never does
    remainingBudgets: budgets(0),
    ctx,
    ...overrides,
  };
}

const brief = { problem: "p", dead_ends: "attempt 1 edited the wrong file", scope: "s", references: ["worker-1-0"], diagnosis: "h" };

/** An agent port that answers triage with `reply` and records every call. */
function triageAgent(reply: Metered<TriageTerminus>): AgentPort & { calls: AgentContext[] } {
  const calls: AgentContext[] = [];
  const agent = fakeAgentPort({
    triage: (c) => {
      calls.push(c);
      return Promise.resolve(reply);
    },
  });
  return Object.assign(agent, { calls });
}

/** An agent port that fails the test if it is called at all. */
const forbiddenAgent: AgentPort = fakeAgentPort({});

const checkUntouchedOnly: CaseFile = { history: [{ t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "guard:check-untouched", detailRef: "d" }] }] } as unknown as CaseFile;
const mixedFailure: CaseFile = { history: [{ t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "guard:check-untouched", detailRef: "d" }, { id: "report.tap", detailRef: "d2" }] }] } as unknown as CaseFile;

describe("needsJudgement", () => {
  it("engages the agent for a stuck worker while a correction slot is left", () => {
    expect(needsJudgement(input({ remainingBudgets: budgets(2) }))).toBe(true);
  });

  it("does not engage the agent for a stuck worker once corrections are spent", () => {
    expect(needsJudgement(input({ remainingBudgets: budgets(3) }))).toBe(false);
  });

  it("never engages the agent for an authority limit", () => {
    expect(needsJudgement(input({ category: "authority" }))).toBe(false);
  });

  it("does not engage the agent for a plain gate failure with more than one slot left", () => {
    expect(needsJudgement(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(0) }))).toBe(false);
  });

  it("engages the agent on the first round whose only new failure is the settings guard", () => {
    expect(needsJudgement(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(0), caseFile: checkUntouchedOnly }))).toBe(true);
  });

  it("does not engage the agent for a settings failure alongside a real one, with budget left", () => {
    expect(needsJudgement(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(0), caseFile: mixedFailure }))).toBe(false);
  });
});

describe("createAgentTriage", () => {
  it("asks the triage agent about a stuck worker with budget left, with the round's context", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "worth one more try", payload: brief, usage: {} });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(agent.calls).toEqual([{ ...ctx, worktreePath: expect.any(String) }]);
    expect(agent.calls[0]?.worktreePath).not.toBe(ctx.worktreePath);
    expect(verdict).toEqual({ verdict: "reroute", rationale: "worth one more try", artifact: brief, usage: {} });
  });

  it("lets the triage agent change nothing in the task's working copy", async () => {
    const agent = fakeAgentPort({
      triage: (c) => {
        expect(readFileSync(join(c.worktreePath, "a.txt"), "utf-8")).toBe("a\n");
        writeFileSync(join(c.worktreePath, "a.txt"), "triage was here\n");
        return Promise.resolve({ status: "reroute", rationale: "worth one more try", payload: brief, usage: {} });
      },
    });
    await createAgentTriage(agent).triage(input({}));
    expect(readFileSync(join(ctx.worktreePath, "a.txt"), "utf-8")).toBe("a\n");
  });

  it("routes a plain gate failure with more than one slot left with no agent call and no artefact", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(
      input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(1) }),
    );
    expect(verdict.verdict).toBe("reroute");
    expect(verdict.artifact).toBeUndefined();
  });

  it("passes an authority limit straight to escalation without asking the agent", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(input({ category: "authority" }));
    expect(verdict.verdict).toBe("escalate");
  });

  it("carries what the runtime reported for the triage session on the verdict", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "worth one more try", payload: brief, usage: { costUsd: 0.05, durationMs: 4000 } });
    expect((await createAgentTriage(agent).triage(input({}))).usage).toEqual({ costUsd: 0.05, durationMs: 4000 });
  });

  it("marks a round an agent decided even when its runtime reported nothing, so it still counts as a session", async () => {
    const verdict = await createAgentTriage(triageAgent({ status: "incomplete", rationale: "triage session did not complete: no reply" })).triage(input({}));
    expect(verdict.usage).toEqual({});
  });

  it("carries nothing on a round the rules decided: no session ran", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(input({ category: "authority" }));
    expect(verdict).not.toHaveProperty("usage");
  });
});

describe("toTriageVerdict", () => {
  it("escalates, never reroutes, when triage produced nothing usable", () => {
    const verdict = toTriageVerdict({ status: "incomplete", rationale: "triage session did not complete: x" }, input({}));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.rationale).toBe(
      "triage did not produce a usable verdict: triage session did not complete: x. Escalating rather than guessing.",
    );
    expect(verdict.artifact).toBeUndefined();
  });

  it("escalates a verdict that is not legal for the trigger, naming the verdict, setback and legal set", () => {
    const verdict = toTriageVerdict({ status: "retry_close", rationale: "close it", payload: brief }, input({}));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.rationale).toContain("retry_close");
    expect(verdict.rationale).toContain("after a worker escalation");
    expect(verdict.rationale).toContain("reroute, escalate, abort");
  });

  it("carries a legal verdict's rationale and payload through unchanged", () => {
    expect(toTriageVerdict({ status: "abort", rationale: "infra", payload: { reason: "disk full" } }, input({}))).toEqual({
      verdict: "abort",
      rationale: "infra",
      artifact: { reason: "disk full" },
    });
  });
});

const packet = {
  decision: "Decide whether to amend the task.",
  evidence: "not ok 2 - beta",
  dead_ends: "attempt 1 edited the template",
  why_now: "one slot left",
  references: ["worker-1-0"],
};

describe("a failed close", () => {
  const failedClose = (closeUsed: number) =>
    input({ trigger: "close_failure", category: undefined, remainingBudgets: budgets(0, closeUsed) });

  it("engages the agent only on its last close slot", () => {
    expect(needsJudgement(failedClose(2))).toBe(true);
    expect(needsJudgement(failedClose(1))).toBe(false);
    expect(needsJudgement(failedClose(3))).toBe(false);
  });

  it.each(["reroute", "fix_the_gate"] as const)(
    "escalates a %s answer instead, naming the verdict and the verdicts allowed",
    (status) => {
      const verdict = toTriageVerdict({ status, rationale: "try again", payload: brief }, failedClose(2));
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toBe(
        `triage answered ${status}, which is not allowed after a close failure ` +
          "(allowed: retry_close, escalate, abort). Escalating rather than acting on it.",
      );
      expect(verdict.artifact).toBeUndefined();
      expect(verdict.cause).toEqual({ kind: "triage_failure", rationale: verdict.rationale });
    },
  );

  it.each([
    { status: "retry_close", rationale: "flaky", payload: brief },
    { status: "escalate", rationale: "stop", payload: packet },
    { status: "abort", rationale: "infra", payload: { reason: "disk full" } },
  ] as TriageTerminus[])("acts on a legal $status answer", (reply) => {
    expect(toTriageVerdict(reply, failedClose(2)).verdict).toBe(reply.status);
  });

  it("asks the agent on the last slot, and escalates its 'retry the worker' answer", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "retry the worker", payload: brief });
    const verdict = await createAgentTriage(agent).triage(failedClose(2));
    expect(agent.calls).toHaveLength(1);
    expect(verdict.verdict).toBe("escalate");
  });
});

describe("unusable triage output", () => {
  it.each(Object.values(DID_NOT_COMPLETE))(
    "escalates in plain English, never a retry, when %s",
    (reason) => {
      const verdict = toTriageVerdict(
        { status: "incomplete", rationale: `triage session did not complete: ${reason}` },
        input({}),
      );
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toBe(
        `triage did not produce a usable verdict: triage session did not complete: ${reason}. Escalating rather than guessing.`,
      );
      expect(verdict.rationale).not.toMatch(/Error|\n\s+at\s/);
      expect(verdict.cause).toEqual({ kind: "triage_failure", rationale: verdict.rationale });
    },
  );

  it("keeps the agent's own packet when it escalates, with no cause to rebuild one from", async () => {
    const agent = triageAgent({ status: "escalate", rationale: "no retry will help", payload: packet, usage: {} });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(verdict).toEqual({ verdict: "escalate", rationale: "no retry will help", artifact: packet, usage: {} });
  });
});

describe("the last correction slot after a gate failure", () => {
  const gateFail = (correctionUsed: number) =>
    input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(correctionUsed) });

  it("engages the agent only on the last correction slot", () => {
    expect(needsJudgement(gateFail(2))).toBe(true);
    expect(needsJudgement(gateFail(1))).toBe(false);
    expect(needsJudgement(gateFail(3))).toBe(false);
  });

  it.each([
    { status: "reroute", rationale: "one more try is worth it", payload: brief },
    { status: "escalate", rationale: "a last retry would repeat attempt 2", payload: packet },
  ] as TriageEnvelope[])("asks the agent on the last slot and acts on its $status answer", async (reply) => {
    const agent = triageAgent({ ...reply, usage: {} });
    const verdict = await createAgentTriage(agent).triage(gateFail(2));
    expect(agent.calls).toEqual([{ ...ctx, worktreePath: expect.any(String) }]);
    expect(verdict).toEqual({ verdict: reply.status, rationale: reply.rationale, artifact: reply.payload, usage: {} });
  });
});

describe("a spent population", () => {
  it.each([
    ["a gate failure", input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(3) }), "correction"],
    ["a stuck worker", input({ remainingBudgets: budgets(3) }), "correction"],
    ["a close failure", input({ trigger: "close_failure", category: undefined, remainingBudgets: budgets(0, 3) }), "close"],
  ] as const)("escalates %s with no agent call, naming the spent budget as the cause", async (_name, spent, population) => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(spent);
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.cause).toMatchObject({ kind: "budget", population });
  });
});

describe("a gate error while rechecks remain", () => {
  it("is rechecked with no agent call", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(input({ trigger: "gate_error", category: undefined }));
    expect(verdict.verdict).toBe("recheck_gate");
    expect(verdict.artifact).toBeUndefined();
  });
});

describe("a gate error once rechecks are spent", () => {
  const gateError = (repairUsed: number) =>
    input({
      trigger: "gate_error",
      category: undefined,
      remainingBudgets: { ...budgets(0), gateError: { used: 3, max: 3 }, gateMaintenance: { used: repairUsed, max: 2 } },
    });

  it("engages the agent while a repair slot is left, and never before rechecks are spent", () => {
    expect(needsJudgement(gateError(0))).toBe(true);
    expect(needsJudgement(gateError(1))).toBe(true);
    expect(needsJudgement(input({ trigger: "gate_error", category: undefined }))).toBe(false);
  });

  it("carries the agent's repair brief through with its fix_the_gate verdict", async () => {
    const agent = triageAgent({ status: "fix_the_gate", rationale: "the runner is missing", payload: brief, usage: {} });
    const verdict = await createAgentTriage(agent).triage(gateError(0));
    expect(agent.calls).toEqual([{ ...ctx, worktreePath: expect.any(String) }]);
    expect(verdict).toEqual({ verdict: "fix_the_gate", rationale: "the runner is missing", artifact: brief, usage: {} });
  });

  it("escalates with no agent call once repairs are spent too", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(gateError(2));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.cause).toMatchObject({ kind: "budget", population: "gateMaintenance" });
  });
});

describe("a lone settings failure, triage's to accept", () => {
  const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
  const triageBudgets: BudgetSet = { correction: { used: 2, max: 3 }, gateError: { used: 0, max: 3 }, gateMaintenance: { used: 0, max: 2 }, terminus: { used: 0, max: 5 }, close: { used: 0, max: 3 } };

  async function fixture() {
    const repo = initTempRepo("triage-settings-", { "Makefile": "test:\n\tnpm test\n" });
    const start = git(repo, ["rev-parse", "HEAD"]);
    writeFileSync(join(repo, "Makefile"), "test:\n\tnpm test\n\nbuild:\n\tnpm run build\n");
    const dir = mkdtempSync(join(tmpdir(), "triage-settings-case-"));
    await create(dir, { surfaceId: "s", taskDef: { intent: "add a build target" }, gateRef: NPM, startCommit: start }, triageBudgets);
    const caseFile = {
      header: { taskDef: { intent: "add a build target" }, gateRef: NPM, startCommit: start },
      history: [{ t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "guard:check-untouched", detailRef: "d" }] }],
    } as unknown as CaseFile;
    return { repo, dir, caseFile };
  }

  it("records the current setting when triage accepts it, and a later round does not re-fail it", async () => {
    const { repo, dir, caseFile } = await fixture();
    const agent = triageAgent({ status: "reroute", rationale: "the Makefile target is the task's own point", payload: brief, acceptSettings: true, usage: {} });
    await createAgentTriage(agent).triage(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(2), caseFile, ctx: { worktreePath: repo, dir, sessionKey: "triage-0" } }));
    const { history } = await load(dir);
    expect(history.some((entry) => entry.t === "triage_accepted" && Object.keys(entry.settings).includes("Makefile"))).toBe(true);
  });

  it("accepts nothing when triage does not say to", async () => {
    const { repo, dir, caseFile } = await fixture();
    const agent = triageAgent({ status: "reroute", rationale: "not this one", payload: brief, usage: {} });
    await createAgentTriage(agent).triage(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(2), caseFile, ctx: { worktreePath: repo, dir, sessionKey: "triage-0" } }));
    expect((await load(dir)).history.some((entry) => entry.t === "triage_accepted")).toBe(false);
  });

  it("never accepts anything for a test-deleting round, however triage answers: the field means nothing there", async () => {
    const { repo, dir } = await fixture();
    const deletion = { header: { taskDef: { intent: "x" }, gateRef: NPM, startCommit: "0".repeat(40) }, history: [{ t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "guard:tests-untouched", detailRef: "d" }] }] } as unknown as CaseFile;
    const agent = triageAgent({ status: "reroute", rationale: "try again", payload: brief, acceptSettings: true, usage: {} });
    await createAgentTriage(agent).triage(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(0), caseFile: deletion, ctx: { worktreePath: repo, dir, sessionKey: "triage-0" } }));
    expect((await load(dir)).history.some((entry) => entry.t === "triage_accepted")).toBe(false);
  });
});
