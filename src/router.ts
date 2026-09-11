import type { TriageInput, TriagePort, TriageVerdict } from "./ports.js";
import type { BudgetPopulation } from "./schema.js";
import { budgetExhausted } from "./budgets.js";

/**
 * The whole deterministic rule, one row per trigger: the budget that gates the
 * helpful verdict, and the verdict itself. At cap, every trigger escalates.
 *
 * `gateError` is deliberately absent. It is reserved for a future bounded,
 * agent-free re-check fast path, which needs a `TriageVerdict` case this item
 * does not add; a gate that could not run is routed to `GATE_MAINTENANCE` on
 * the `gateMaintenance` budget, exactly like the pre-task case.
 */
const rules: Record<
  TriageInput["trigger"],
  { budget: BudgetPopulation; helpful: TriageVerdict["verdict"] }
> = {
  gate_fail: { budget: "correction", helpful: "reroute" },
  gate_error: { budget: "gateMaintenance", helpful: "fix_the_gate" },
  worker_escalate: { budget: "correction", helpful: "reroute" },
  close_failure: { budget: "close", helpful: "retry_close" },
};

/**
 * The built-in `TriagePort`: a lookup table with no agent call. It never writes
 * a brief or a packet; when it escalates it names the cause (`cause`), and the
 * surface builds the escalation packet a person reads from that. It reads
 * nothing but the trigger, the escalate category, and the log-derived budgets
 * the caller computed immediately before calling it.
 */
export const deterministicRouter: TriagePort = {
  triage(input: TriageInput): Promise<TriageVerdict> {
    // An authority limit is the worker's own judgement that no retry can help.
    // Nothing in a lookup table is entitled to overrule it, and no budget makes
    // it retryable — this is checked before the table, not inside it.
    if (input.trigger === "worker_escalate" && input.category === "authority") {
      return Promise.resolve({
        verdict: "escalate",
        rationale: "authority limit: the worker reported no retry can resolve this",
        cause: { kind: "authority", role: "worker" },
      });
    }

    const { budget, helpful } = rules[input.trigger];
    const { used, max } = input.remainingBudgets[budget];

    if (used >= max) {
      const detail = `no retry remains for a ${input.trigger} setback`;
      return Promise.resolve({
        verdict: "escalate",
        rationale: budgetExhausted(budget, { used, max }, detail),
        cause: { kind: "budget", population: budget, budget: { used, max }, detail },
      });
    }

    return Promise.resolve({
      verdict: helpful,
      rationale: `${input.trigger}: ${helpful} (${budget} ${used}/${max})`,
    });
  },
};
