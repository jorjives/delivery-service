import { POPULATION_LABELS, SETBACK_LABELS } from "../escalation-packet.js";
import { briefLines } from "../prompt-assembly.js";
import type { BudgetRow, Decision, ReportDocument, RepairFile, ReportRepair, ReportSurface, Standing } from "./document.js";
import { attemptsWord } from "./plain.js";
import { budgetTotals, pathName, quoted, REPAIR_OF, stripControl, toAct } from "./text.js";

/** Said under a stopped task that is on the project's list: running the list again does not run it again. */
export const UNCHANGED_NOT_RUN_AGAIN = "An unchanged task on your list is not run again: `delivery run` would retell this outcome.";

/** Said under every stopped task: a run that has ended is not one `delivery resume` picks up. */
export const RESUME_DOES_NOT_APPLY = "`delivery resume` does not apply: this run is finished.";

const TRIGGER_WORDS: Record<string, string> = SETBACK_LABELS;

/** Retries used of retries allowed, kind by kind, in the harness's own names for the kinds. */
export function budgetWords(rows: BudgetRow[]): string {
  return rows.map((row) => `${POPULATION_LABELS[row.population]} ${row.used} of ${row.max}`).join(", ");
}

/** The triage rounds of one task: one line each (after which attempt, what set it off, what was decided), or every round in full. */
export function roundLines(decisions: Decision[], { full }: { full: boolean }): string[] {
  if (decisions.length === 0) return ["How it got here: no triage rounds."];
  if (full) return fullRoundLines(decisions);
  return [
    "How it got here (triage rounds; --decisions for the full text):",
    // A trigger this build has no words for is shown as the record holds it.
    ...decisions.map((round) => `  After attempt ${round.afterAttempt}: ${TRIGGER_WORDS[round.trigger] ?? stripControl(round.trigger)}; verdict: ${round.verdict}`),
  ];
}

/** What a round produced for whoever came next. Total over the verdicts, so a new one does not compile until it has words. */
function producedLines(round: Decision): string[] {
  switch (round.verdict) {
    case "reroute":
    case "fix_the_gate":
    case "retry_close":
      // A round that wrote no brief is not one whose brief was lost: only the second is "not recorded".
      if (round.brief === null) return [`    Brief for the next session: ${round.recorded ? "none; this round wrote no brief." : "not recorded."}`];
      return ["    Brief for the next session:", ...briefLines(round.brief).map((line) => `      ${stripControl(line).split("\n").join("\n      ")}`)];
    case "escalate":
      return round.packet === null
        ? ["    Packet for a person: not recorded."]
        : [
            "    Packet for a person:",
            `      Decision: ${quoted(round.packet.decision, "      ")}`,
            `      Evidence: ${quoted(round.packet.evidence, "      ")}`,
            `      Dead ends: ${quoted(round.packet.dead_ends, "      ")}`,
            `      Why now: ${quoted(round.packet.why_now, "      ")}`,
            `      References: ${round.packet.references.length === 0 ? "none" : round.packet.references.map(stripControl).join(", ")}`,
          ];
    case "recheck_gate":
      return ["    Produced nothing: the gate was run again as it was."];
    case "abort":
      return ["    Produced nothing: the run was abandoned."];
  }
}

/** Every triage round in full: trigger, verdict, reasoning word for word, and the brief or packet it produced. */
function fullRoundLines(decisions: Decision[]): string[] {
  return [
    `How it got here (${decisions.length} triage ${decisions.length === 1 ? "round" : "rounds"}, in full):`,
    ...decisions.flatMap((round, index) => {
      const known = TRIGGER_WORDS[round.trigger];
      return [
        `  Round ${index + 1}, after attempt ${round.afterAttempt}`,
        `    Trigger: ${known === undefined ? stripControl(round.trigger) : `${known} (${round.trigger})`}`,
        `    Verdict: ${round.verdict}`,
        `    Rationale: ${quoted(round.rationale, "    ")}`,
        ...producedLines(round),
      ];
    }),
  ];
}

/** When the retry figures are as of. Total over the standings. */
const AS_OF: Record<Standing, string> = {
  closed: "when it finished",
  escalated: "at stop",
  aborted: "at stop",
  paused: "so far",
  unfinished: "so far",
  queued: "so far",
  not_started: "so far",
};

function budgetLines(surface: ReportSurface): string[] {
  return [`Retry budgets ${AS_OF[surface.standing]}, after ${attemptsWord(surface.attempts)}:`, `  ${budgetWords(surface.budgets)}`];
}

const filesWord = (count: number): string => `${count} ${count === 1 ? "file" : "files"}`;

/** A changed file by name, marked when it is one the check runs. Says nothing about whether the change was safe. */
const fileName = (file: RepairFile): string => `${pathName(file.path)}${file.touchesCheck ? " (the check runs this file)" : ""}`;

/** One repair in one line: which, how many files it changed, the lines added and removed, and the names. */
export function repairLine(repair: ReportRepair, index: number): string {
  const which = `Repair ${index + 1} (${REPAIR_OF[repair.of]}, attempt ${repair.attempt} of ${repair.max})`;
  if (repair.status === null) return `${which} is still going.`;
  if (!repair.recorded) return `${which}: what this repair changed was not recorded.`;
  if (repair.files.length === 0) return `${which} changed no files.`;
  const added = repair.files.reduce((sum, file) => sum + file.added, 0);
  const removed = repair.files.reduce((sum, file) => sum + file.removed, 0);
  return `${which} changed ${filesWord(repair.files.length)}, +${added} -${removed}: ${repair.files.map(fileName).join(", ")}`;
}

/** Each file a repair changed, and its patch as recorded, or that it was too large to keep. */
function patchLines(file: RepairFile): string[] {
  return [
    `    ${fileName(file)}: ${file.status}, +${file.added} -${file.removed}`,
    ...(file.patch === null ? ["      patch too large to keep"] : stripControl(file.patch).replace(/\n$/, "").split("\n").map((line) => `      ${line}`)),
  ];
}

/** Every repair that ran in a task's copy: one line each, or, with `patches`, each with every file's patch. */
export function repairLines(repairs: ReportRepair[], { patches }: { patches: boolean }): string[] {
  if (repairs.length === 0) return ["Repairs: none ran for this task."];
  if (!patches) return ["Repairs (--repairs for each patch):", ...repairs.map((repair, index) => `  ${repairLine(repair, index)}`)];
  return [
    `Repairs (${repairs.length}, each with what it changed):`,
    ...repairs.flatMap((repair, index) => [`  ${repairLine(repair, index)}`, ...repair.files.flatMap(patchLines)]),
  ];
}

/** What to do about a stop, exactly as the report advises it; a task that did not stop says so in one line. */
function actLines(surface: ReportSurface): string[] {
  const { plain } = surface;
  if (plain === null) return [surface.standing === "closed" ? "No stop: this run finished." : "No stop: this run has not finished."];
  return [
    ...(plain.next.length === 0 ? ["To act: not recorded; the record does not say what kind of stop this was."] : toAct(plain.next, "")),
    ...(surface.queue === null ? [] : [UNCHANGED_NOT_RUN_AGAIN]),
    RESUME_DOES_NOT_APPLY,
  ];
}

/**
 * What `delivery status` says of one task beneath its own account: the triage
 * rounds (one line each, or in full), the retry budgets, the repairs (one line
 * each, or with their patches), and what to do. Another rendering of the report
 * document, so it is pure and reads nothing. The technical parts use the harness's
 * own words, because whoever reads them is looking for those words; the advice is
 * the report's, unchanged.
 */
export function detailLines(surface: ReportSurface, { full, patches }: { full: boolean; patches: boolean }): string[] {
  return [...roundLines(surface.decisions, { full }), "", ...budgetLines(surface), "", ...repairLines(surface.repairs, { patches }), "", ...actLines(surface)];
}

/**
 * The retries of a run of several tasks added up across the tasks it has
 * taken, with the run's own limit on repairs of what its tasks share: the one
 * figure no single task holds.
 */
export function rollUpLines(doc: ReportDocument): string[] {
  const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
  const shared = doc.run === null ? [] : [`  shared repair limit for the run: ${doc.run.runBudgets.gateMaintenance.used} of ${doc.run.runBudgets.gateMaintenance.max} used`];
  if (ran.length === 0) return ["Retry budgets: no task of this run has started.", ...shared];
  return [`Retry budgets across the ${ran.length === 1 ? "1 task" : `${ran.length} tasks`} this run has taken:`, `  ${budgetWords(budgetTotals(ran))}`, ...shared];
}
