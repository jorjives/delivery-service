import { describe, it, expect } from "vitest";
import { budgetExhausted } from "./budgets.js";

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
