import { describe, it, expect } from "vitest";
import { deterministicRouter } from "./router.js";
import type { TriageInput } from "./ports.js";
import type { BudgetSet, CaseFile } from "./schema.js";

const fresh: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

/** The router reads only `remainingBudgets`; the case file is inert padding. */
const caseFile = { history: [] } as unknown as CaseFile;

function input(
  trigger: TriageInput["trigger"],
  budgets: BudgetSet = fresh,
  category?: TriageInput["category"],
): TriageInput {
  return { trigger, caseFile, remainingBudgets: budgets, ...(category ? { category } : {}), ctx: { worktreePath: "/w", dir: "/d", sessionKey: "triage-0" } };
}

function atCap(population: keyof BudgetSet): BudgetSet {
  return { ...fresh, [population]: { used: fresh[population].max, max: fresh[population].max } };
}

describe("deterministicRouter", () => {
  it("routes a gate failure back to another worker attempt while corrections remain", async () => {
    expect(await deterministicRouter.triage(input("gate_fail"))).toMatchObject({
      verdict: "reroute",
    });
  });

  it("routes a gate error to a gate repair while repair budget remains", async () => {
    expect(await deterministicRouter.triage(input("gate_error"))).toMatchObject({
      verdict: "fix_the_gate",
    });
  });

  it("routes a close failure back to another close attempt while close budget remains", async () => {
    expect(await deterministicRouter.triage(input("close_failure"))).toMatchObject({
      verdict: "retry_close",
    });
  });

  it("retries an exhaustion-class worker escalate as another worker attempt", async () => {
    expect(await deterministicRouter.triage(input("worker_escalate", fresh, "exhaustion")))
      .toMatchObject({ verdict: "reroute" });
  });

  it("never overrules an authority-class worker escalate, even with budget to spare", async () => {
    expect(await deterministicRouter.triage(input("worker_escalate", fresh, "authority")))
      .toMatchObject({ verdict: "escalate" });
  });

  it.each([
    ["gate_fail", "correction"],
    ["gate_error", "gateMaintenance"],
    ["close_failure", "close"],
    ["worker_escalate", "correction"],
  ] as [TriageInput["trigger"], keyof BudgetSet][])("escalates %s once its %s budget is at cap",
    async (trigger, population) => {
      const verdict = await deterministicRouter.triage(input(trigger, atCap(population)));
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toContain(population);
    },
  );

  it("reads only the budget its trigger owns", async () => {
    // Every population except `correction` is spent; a gate failure still reroutes.
    const spent: BudgetSet = {
      correction: { used: 0, max: 3 },
      gateError: { used: 3, max: 3 },
      gateMaintenance: { used: 2, max: 2 },
      terminus: { used: 5, max: 5 },
      close: { used: 3, max: 3 },
    };
    expect(await deterministicRouter.triage(input("gate_fail", spent))).toMatchObject({
      verdict: "reroute",
    });
  });
});
