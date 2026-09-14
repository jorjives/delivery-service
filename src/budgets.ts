import type { Budget, BudgetPopulation, BudgetSet } from "./schema.js";

/**
 * The one sentence a budget cap escalates with.
 *
 * The roadmap's DX decision for this item is that a reader of a surface's
 * history must be able to tell "it ran out of retries" from every other kind
 * of escalation, and tell *which* retries ran out. That is a property of the
 * message, so there is exactly one message: every edge that caps a population
 * — the driver's gate-maintenance and incomplete-terminus edges, and the
 * deterministic router's at-cap branch — routes its reason through here.
 *
 * It lives in its own module rather than in `case-file.ts` (which owns
 * `deriveBudgetsFromLog`, the counting) so that `router.ts` — a pure lookup
 * table with no persistence dependency of its own — can use it without
 * importing the persistence layer for a string.
 */
export function budgetExhausted(
  population: BudgetPopulation,
  budget: Budget,
  detail: string,
): string {
  return `${population} budget exhausted (${budget.used}/${budget.max}): ${detail}`;
}

/**
 * The caps a run starts with when its caller names none. These are the numbers
 * the demos and tests already shared, lifted into one place so the command line
 * and any library caller start from the same set. Every `used` is 0: usage is
 * harness state, counted from the log, never a default.
 */
export const DEFAULT_BUDGETS: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
