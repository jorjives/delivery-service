import { z } from "zod";
import { deriveBudgetsFromLog, readRef } from "./case-file.js";
import { NewFailure, type BudgetPopulation, type BudgetSet, type CaseFile, type HistoryEntry } from "./schema.js";
import type { EscalationCause, TriageInput } from "./ports.js";
import type { EscalationPacket } from "./triage-role-config.js";

/** Budget populations as a person reads them. Key order is the order they are listed in. */
export const POPULATION_LABELS: Record<BudgetPopulation, string> = {
  correction: "correction",
  gateError: "gate recheck",
  gateMaintenance: "gate repair",
  terminus: "session retry",
  close: "close retry",
};

/** Setback triggers as a person reads them. */
export const SETBACK_LABELS: Record<TriageInput["trigger"], string> = {
  gate_fail: "a gate failure",
  gate_error: "a gate error",
  worker_escalate: "a worker escalation",
  close_failure: "a close failure",
};

const ROLE_LABELS = { worker: "worker", "gate-maintenance": "gate repair session" } as const;

export const NO_PRIOR_ATTEMPTS = "No prior attempts were triaged.";
const NO_EVIDENCE = "No setback evidence is recorded in the case file.";
export const GATE_ERROR_EVIDENCE = "The gate could not run to completion; its error output is not kept in the case file.";
const GATE_FAIL_EVIDENCE = "The gate failed without recording which assertions broke.";

const CloseDetail = z.object({ detail: z.string().min(1) });

/** What a packet says beyond its cause: all of it read from the case file. */
export interface PacketFacts {
  /** Verbatim: the failing assertions, the session's own rationale, or the close report's detail. */
  evidence: string;
  /** Rationales of the triage rounds before this escalation, oldest first. */
  priorRationales: string[];
  /** Session keys of every dispatch, for pulling a transcript. */
  references: string[];
  budgets: BudgetSet;
}

/**
 * The packet a person reads at ESCALATED when no agent wrote one. Pure: the
 * decision and the reason are fixed sentences per cause, everything else is
 * quoted from the case file, so the same log always yields the same packet.
 */
export function buildEscalationPacket(cause: EscalationCause, facts: PacketFacts): EscalationPacket {
  return {
    decision: decisionFor(cause),
    evidence: facts.evidence,
    dead_ends:
      facts.priorRationales.length === 0
        ? NO_PRIOR_ATTEMPTS
        : facts.priorRationales.map((rationale, i) => `${i + 1}. ${rationale}`).join("\n"),
    why_now: `${reasonFor(cause)} Budgets used so far: ${budgetLine(facts.budgets)}.`,
    references: facts.references,
  };
}

function decisionFor(cause: EscalationCause): string {
  switch (cause.kind) {
    case "authority":
      return `The ${ROLE_LABELS[cause.role]} stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.`;
    case "repair_gave_up":
      return "The gate repair session gave up. Decide whether to repair the check yourself, amend the task, or abandon it.";
    case "session_not_run":
      return `The ${ROLE_LABELS[cause.role]} could not be started, so no session ran. Put the agent runtime right and run again, or take the task on yourself.`;
    case "budget":
      if (cause.population === "close") {
        // The work was already accepted: the question is how to land it, never
        // whether to amend or abandon the task. The closer's report is the evidence.
        return (
          `No close retry budget remains (${cause.budget.used}/${cause.budget.max} used), so the accepted work has not landed. ` +
          "Decide whether to resolve what the closer reports below, such as a base branch that has moved on, " +
          "and close again, or choose a different close."
        );
      }
      return `No ${POPULATION_LABELS[cause.population]} budget remains (${cause.budget.used}/${cause.budget.max} used). Decide whether to continue manually, amend the task, or abandon it.`;
    case "triage_failure":
      return "Triage could not reach a verdict. Decide how to proceed from the evidence below.";
    case "landed_outside_closer":
      return `The agent opened a pull request for this task's branch itself: ${cause.pullRequest}. Nothing has been landed by the harness. Decide whether to close that pull request or review and merge it yourself.`;
  }
}

function reasonFor(cause: EscalationCause): string {
  switch (cause.kind) {
    case "authority":
      return `The ${ROLE_LABELS[cause.role]} reported that it lacks the authority to go on; an authority limit goes straight to a person and is never retried.`;
    case "repair_gave_up":
      return "The gate repair session escalated: it judged it could not get the check running again.";
    case "session_not_run":
      return `The ${ROLE_LABELS[cause.role]} never started, so nothing about another attempt could differ; a session that never ran is escalated after one attempt rather than retried.`;
    case "budget":
      return `The ${POPULATION_LABELS[cause.population]} budget is spent (${cause.budget.used}/${cause.budget.max} used), so the harness cannot try again.`;
    case "triage_failure":
      return `Triage's reply could not be acted on: ${cause.rationale}`;
    case "landed_outside_closer":
      return `A pull request was found open for the task's branch after session ${cause.sessionKey}; landing belongs to the harness, so the task stops for you rather than being treated as merged.`;
  }
}

function budgetLine(budgets: BudgetSet): string {
  return (Object.keys(POPULATION_LABELS) as BudgetPopulation[])
    .map((p) => `${POPULATION_LABELS[p]} ${budgets[p].used}/${budgets[p].max}`)
    .join(", ");
}

/**
 * Read what the packet quotes, then build it. The only I/O in this module.
 *
 * An escalate triage round is the escalation being reported, not an earlier
 * dead end, so it is left out; that also makes the packet identical whether it
 * is built just before that round's entry is appended or just after.
 */
export async function resolveEscalationPacket(
  dir: string,
  caseFile: CaseFile,
  cause: EscalationCause,
): Promise<EscalationPacket> {
  const { history } = caseFile;
  const fallback = cause.kind === "budget" ? cause.detail : NO_EVIDENCE;
  const evidence =
    cause.kind === "landed_outside_closer"
      ? `Pull request ${cause.pullRequest}, found open after session ${cause.sessionKey}.`
      : (await evidenceOf(dir, history)) || fallback;
  return buildEscalationPacket(cause, {
    evidence,
    priorRationales: history.flatMap((e) => (e.t === "triage" && e.verdict !== "escalate" ? [e.rationale] : [])),
    references: history.flatMap((e) => (e.t === "dispatch" ? [e.sessionKey] : [])),
    budgets: deriveBudgetsFromLog(history, caseFile.cursor.budgets),
  });
}

/** Verbatim evidence from the latest setback in the log, or undefined when there is none. */
async function evidenceOf(dir: string, history: HistoryEntry[]): Promise<string | undefined> {
  const setback = history.findLast(
    (e) =>
      (e.t === "terminus" && e.status !== "completed") ||
      (e.t === "gate" && e.status !== "PASS") ||
      (e.t === "close" && e.status !== "DONE"),
  );
  if (setback?.t === "terminus") return setback.rationale;
  if (setback?.t === "gate") {
    const parsed = await Promise.all(
      setback.newFailures.map((f) => readRef(dir, f.detailRef).then((raw) => NewFailure.safeParse(raw))),
    );
    const lines = parsed.flatMap((p) => (p.success ? [`${p.data.id}: ${p.data.detail}`] : []));
    if (lines.length > 0) return lines.join("\n");
    return setback.status === "ERROR" ? GATE_ERROR_EVIDENCE : GATE_FAIL_EVIDENCE;
  }
  if (setback?.t === "close") {
    const report = CloseDetail.safeParse(await readRef(dir, setback.detailRef));
    return report.success ? report.data.detail : "The closer reported a failure and left no detail.";
  }
  return undefined;
}
