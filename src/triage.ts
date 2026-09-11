import { deterministicRouter } from "./router.js";
import type { AgentPort, TriageInput, TriagePort, TriageTerminus, TriageVerdict } from "./ports.js";
import type { Budget } from "./schema.js";

type Verdict = TriageVerdict["verdict"];

/**
 * The verdicts each setback may legally end in. Structural, not a prompt
 * instruction: an agent answering `retry_close` to a stuck worker would
 * otherwise send ungated work to CLOSING. `abort` is legal everywhere.
 */
export const legalVerdicts: Record<TriageInput["trigger"], ReadonlySet<Verdict>> = {
  gate_fail: new Set(["reroute", "escalate", "abort"]),
  gate_error: new Set(["fix_the_gate", "escalate", "abort"]),
  worker_escalate: new Set(["reroute", "escalate", "abort"]),
  close_failure: new Set(["retry_close", "escalate", "abort"]),
};

/**
 * Whether a real decision exists that an agent could change. A stuck worker
 * with a correction slot left is one: triage may judge a retry worthwhile and
 * say what to try. Once a population is spent, no judgement changes the
 * outcome, so no agent is asked a question whose only answer is escalate.
 */
export function needsJudgement({ trigger, category, remainingBudgets: b }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate":
      return category !== "authority" && left(b.correction) > 0;
    case "gate_fail":
    case "close_failure":
    case "gate_error":
      return false;
  }
}

/**
 * The single translation from the agent's `status` to the case file's
 * `verdict`. Anything unusable or illegal escalates: a default reroute would
 * burn correction slots on a triage fault and disguise it as a retry loop.
 */
export function toTriageVerdict(terminus: TriageTerminus, input: TriageInput): TriageVerdict {
  if (terminus.status === "incomplete") {
    return {
      verdict: "escalate",
      rationale: `triage did not produce a usable verdict: ${terminus.rationale}. Escalating rather than guessing.`,
    };
  }
  const legal = legalVerdicts[input.trigger];
  if (!legal.has(terminus.status)) {
    return {
      verdict: "escalate",
      rationale:
        `triage answered ${terminus.status}, which is not allowed for a ${input.trigger} setback ` +
        `(allowed: ${[...legal].join(", ")}). Escalating rather than acting on it.`,
    };
  }
  return { verdict: terminus.status, rationale: terminus.rationale, artifact: terminus.payload };
}

/**
 * The agent-backed `TriagePort`. The deterministic router stays the first
 * check: an authority limit passes straight to escalation before anything else
 * is consulted, and every setback with no real decision is routed by the table
 * with no agent call and no cost.
 */
export function createAgentTriage(agent: AgentPort): TriagePort {
  return {
    async triage(input) {
      if (input.trigger === "worker_escalate" && input.category === "authority") {
        return deterministicRouter.triage(input);
      }
      if (!needsJudgement(input)) return deterministicRouter.triage(input);
      return toTriageVerdict(await agent.invoke({ role: "triage" }, input.ctx), input);
    },
  };
}
