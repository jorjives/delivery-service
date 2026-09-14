import { describe, it, expect } from "vitest";
import { budgetExhausted, DEFAULT_BUDGETS } from "./budgets.js";
import { BudgetSet } from "./schema.js";

describe("budgetExhausted", () => {
  it("names the population, the cap and the setback that ran out of retries", () => {
    expect(budgetExhausted("correction", { used: 3, max: 3 }, "the worker is still stuck")).toBe(
      "correction budget exhausted (3/3): the worker is still stuck",
    );
  });

  it("uses the same shape for every population", () => {
    expect(budgetExhausted("terminus", { used: 5, max: 5 }, "hit the turn cap")).toBe(
      "terminus budget exhausted (5/5): hit the turn cap",
    );
    expect(budgetExhausted("gateMaintenance", { used: 2, max: 2 }, "the gate still cannot run")).toBe(
      "gateMaintenance budget exhausted (2/2): the gate still cannot run",
    );
  });
});

describe("DEFAULT_BUDGETS", () => {
  it("is the cap set the demos and tests already share, with nothing used", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      correction: { used: 0, max: 3 },
      gateError: { used: 0, max: 3 },
      gateMaintenance: { used: 0, max: 2 },
      terminus: { used: 0, max: 5 },
      close: { used: 0, max: 3 },
    });
  });

  it("is a budget set the case file accepts", () => {
    expect(BudgetSet.parse(DEFAULT_BUDGETS)).toEqual(DEFAULT_BUDGETS);
  });

  it("is exported from the library entry point, so every caller starts from the same numbers", async () => {
    const index = await import("./index.js");
    expect(index.DEFAULT_BUDGETS).toBe(DEFAULT_BUDGETS);
  });
});
