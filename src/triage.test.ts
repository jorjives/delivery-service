import { describe, it, expect } from "vitest";
import { createAgentTriage, needsJudgement, toTriageVerdict } from "./triage.js";
import type { AgentContext, AgentPort, TriageInput, TriageTerminus } from "./ports.js";
import type { BudgetSet, CaseFile } from "./schema.js";
import { DID_NOT_COMPLETE } from "./agent-invoke.js";

const ctx: AgentContext = { worktreePath: "/w", dir: "/d", sessionKey: "triage-0" };

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
    caseFile: {} as CaseFile, // never read by createAgentTriage
    remainingBudgets: budgets(0),
    ctx,
    ...overrides,
  };
}

const brief = { problem: "p", dead_ends: "attempt 1 edited the wrong file", scope: "s", references: ["worker-1-0"], diagnosis: "h" };

/** An agent port that answers triage with `reply` and records every call. */
function triageAgent(reply: TriageTerminus): AgentPort & { calls: AgentContext[] } {
  const calls: AgentContext[] = [];
  const run = (roleCfg: { role: string }, c: AgentContext) => {
    if (roleCfg.role !== "triage") return Promise.reject(new Error(`unexpected ${roleCfg.role} session`));
    calls.push(c);
    return Promise.resolve(reply);
  };
  return { calls, invoke: run as AgentPort["invoke"] };
}

/** An agent port that fails the test if it is called at all. */
const forbiddenAgent: AgentPort = {
  invoke: (() => Promise.reject(new Error("no agent call was expected"))) as AgentPort["invoke"],
};

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
});

describe("createAgentTriage", () => {
  it("asks the triage agent about a stuck worker with budget left, with the round's context", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "worth one more try", payload: brief });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(agent.calls).toEqual([ctx]);
    expect(verdict).toEqual({ verdict: "reroute", rationale: "worth one more try", artifact: brief });
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
    const agent = triageAgent({ status: "escalate", rationale: "no retry will help", payload: packet });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(verdict).toEqual({ verdict: "escalate", rationale: "no retry will help", artifact: packet });
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
    { verdict: "reroute", rationale: "one more try is worth it", artifact: brief },
    { verdict: "escalate", rationale: "a last retry would repeat attempt 2", artifact: packet },
  ])("asks the agent on the last slot and acts on its $verdict answer", async (expected) => {
    const agent = triageAgent({ status: expected.verdict as any, rationale: expected.rationale, payload: expected.artifact });
    const verdict = await createAgentTriage(agent).triage(gateFail(2));
    expect(agent.calls).toEqual([ctx]);
    expect(verdict).toEqual(expected);
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
