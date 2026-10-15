import { deterministicRouter } from "./router.js";
import { SETBACK_LABELS } from "./escalation-packet.js";
import { CHECK_GUARD, settingsChanged, type AcceptedSettings } from "./guards.js";
import { activeGuards, guardBase, verifyOf } from "./task-guards.js";
import { treeOf } from "./repair-changes.js";
import { git } from "./git-exec.js";
import { appendEntry } from "./case-file.js";
import type { AgentPort, TriageInput, TriagePort, TriageTerminus, TriageVerdict } from "./ports.js";
import type { Budget, CaseFile, GateEntry } from "./schema.js";

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

/** The ids a case file's last gate round newly failed; empty when there is none yet. */
const lastGateFailureIds = (history: CaseFile["history"]): string[] =>
  (history.findLast((entry): entry is GateEntry => entry.t === "gate")?.newFailures ?? []).map((failure) => failure.id);

/**
 * Whether a setback is a gate_fail whose round failed on the settings guard alone: the one guard a false positive
 * can hide behind (a `.gitignore` or `Makefile` edit the task genuinely needed), and the one case a retry cannot
 * change by trying again — the guard fires identically until the setting is reverted or someone judges it.
 */
function isLoneSettingsFailure(caseFile: CaseFile): boolean {
  const ids = lastGateFailureIds(caseFile.history);
  return ids.length > 0 && ids.every((id) => id === CHECK_GUARD);
}

/**
 * Whether a real decision exists that an agent could change. A stuck worker
 * with a correction slot left is one: triage may judge a retry worthwhile and
 * say what to try. The last slot of a population is another: with one slot
 * left, a clean escalation may beat a long-shot retry. Once a population is
 * spent, no judgement changes the outcome, so no agent is asked a question
 * whose only answer is escalate. A round whose only new failure is the
 * settings guard is a third: no retry changes that verdict either, so
 * judgement is asked for on the first such round rather than after several
 * blind ones.
 */
export function needsJudgement({ trigger, category, remainingBudgets: b, caseFile }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate":
      return category !== "authority" && left(b.correction) > 0;
    case "gate_fail":
      return left(b.correction) === 1 || isLoneSettingsFailure(caseFile);
    case "close_failure":
      return left(b.close) === 1;
    case "gate_error":
      // Rechecks are free and need no judgement; once they are spent, whether
      // a repair is worth dispatching is a decision, while one can be paid for.
      return left(b.gateError) <= 0 && left(b.gateMaintenance) > 0;
  }
}

/**
 * The single translation from the agent's `status` to the case file's
 * `verdict`. Anything unusable or illegal escalates: a default reroute would
 * burn correction slots on a triage fault and disguise it as a retry loop.
 */
export function toTriageVerdict(terminus: TriageTerminus, input: TriageInput): TriageVerdict {
  if (terminus.status === "incomplete") {
    const rationale = `triage did not produce a usable verdict: ${terminus.rationale}. Escalating rather than guessing.`;
    return { verdict: "escalate", rationale, cause: { kind: "triage_failure", rationale } };
  }
  const legal = legalVerdicts[input.trigger];
  if (!legal.has(terminus.status)) {
    const rationale =
      `triage answered ${terminus.status}, which is not allowed after ${SETBACK_LABELS[input.trigger]} ` +
      `(allowed: ${[...legal].join(", ")}). Escalating rather than acting on it.`;
    return { verdict: "escalate", rationale, cause: { kind: "triage_failure", rationale } };
  }
  return { verdict: terminus.status, rationale: terminus.rationale, artifact: terminus.payload };
}

/** The protected settings currently changed from where the task started, fingerprinted as they stand now — never as triage says they stand. Empty when the task's start point is not pinned (a run from before Task 6; judged by its gate alone, as elsewhere). */
async function currentSettings(worktreePath: string, caseFile: CaseFile): Promise<AcceptedSettings> {
  const base = guardBase(caseFile.header);
  if (base === null) return {};
  const commit = "commit" in base ? base.commit : await git(worktreePath, ["merge-base", "HEAD", base.branch]);
  const { lists } = activeGuards(caseFile.header.taskDef);
  const verify = verifyOf(caseFile.header.taskDef, caseFile.header.gateRef);
  return Object.fromEntries(await settingsChanged(worktreePath, commit, await treeOf(worktreePath), lists, verify));
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
      const terminus = await agent.invoke({ role: "triage" }, input.ctx);
      const verdict = toTriageVerdict(terminus, input);
      // Only ever read here: a lone settings-guard round, answered reroute, said yes. Nothing else writes an
      // acceptance, and a round that also failed for a real reason is never in reach of this at all.
      if (input.trigger === "gate_fail" && terminus.status === "reroute" && terminus.acceptSettings === true && isLoneSettingsFailure(input.caseFile)) {
        const settings = await currentSettings(input.ctx.worktreePath, input.caseFile);
        if (Object.keys(settings).length > 0) await appendEntry(input.ctx.dir, { t: "triage_accepted", settings });
      }
      // An agent decided this round, so it was a session, recorded or not.
      return { ...verdict, usage: terminus.usage ?? {} };
    },
  };
}
