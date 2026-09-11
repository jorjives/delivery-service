import { describe, it, expect } from "vitest";
import { createAgentTriage, needsJudgement, toTriageVerdict } from "./triage.js";
import type { AgentContext, AgentPort, TriageInput, TriageTerminus } from "./ports.js";
import type { BudgetSet, CaseFile } from "./schema.js";

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

  it("escalates a verdict that is not legal for the trigger, naming the verdict, trigger and legal set", () => {
    const verdict = toTriageVerdict({ status: "retry_close", rationale: "close it", payload: brief }, input({}));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.rationale).toContain("retry_close");
    expect(verdict.rationale).toContain("worker_escalate");
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
