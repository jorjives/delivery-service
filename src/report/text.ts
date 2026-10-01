import { paint, type Tone } from "../paint.js";
import { USAGE_LIMIT_WORDS } from "../ports.js";
import type { DamagedRecord, ReportDocument, ReportRun, ReportSurface } from "./document.js";
import { completedWords, landedWords, RETRY_WORDS, whereTheWorkIs, type Landing } from "./plain.js";

export const NO_RUNS_YET = "No runs yet in this folder. Start one with: delivery run";

/** Said above a report of the most recent run when the project has no task list to report on. */
export const NO_TASK_LIST = "This project has no task list, so this is its most recent run.";

/**
 * Text from a record with everything that could drive the terminal taken out:
 * escape sequences whole, then any other control character. Line breaks and
 * tabs are kept, because quoted output is read as it was written.
 */
export function stripControl(text: string): string {
  // The pattern is the control characters themselves: matching them is the point.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

/** Words from the record, in quotation marks, with later lines set under the first. */
function quoted(text: string, indent: string): string {
  return `"${stripControl(text).trim().split("\n").join(`\n${indent}`)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "02:19", from an ISO 8601 UTC instant by its own digits: no clock and no locale is read. */
const minuteOf = (iso: string): string => iso.slice(11, 16);

/** "1 Oct 02:19", the same way. */
const dayAndMinute = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${minuteOf(iso)}`;

/** How long it was between two recorded instants. Never measured against now. */
function elapsed(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

const tasksWord = (count: number): string => `${count} ${count === 1 ? "task" : "tasks"}`;

/** The part of the report a task is told in. */
type Section = "needs_you" | "engineers" | "done" | "not_finished" | "not_started";

const SECTIONS: readonly Section[] = ["needs_you", "engineers", "done", "not_finished", "not_started"];

const HEADING: Record<Section, { title: string; tone: Tone }> = {
  needs_you: { title: "NEEDS YOU", tone: "attention" },
  engineers: { title: "STOPPED, FOR YOUR ENGINEERS", tone: "stopped" },
  done: { title: "DONE", tone: "done" },
  not_finished: { title: "NOT FINISHED", tone: "quiet" },
  not_started: { title: "NOT STARTED", tone: "quiet" },
};

/** Total over the standings, so a new one does not compile until it has a section. */
function sectionOf(surface: ReportSurface): Section {
  switch (surface.standing) {
    case "closed":
      return "done";
    case "escalated":
    case "aborted":
      return surface.plain?.audience === "owner" ? "needs_you" : "engineers";
    case "paused":
    case "unfinished":
    case "queued":
      return "not_finished";
    case "not_started":
      return "not_started";
  }
}

const label = (surface: ReportSurface): string =>
  `${surface.queue ? `Task ${surface.queue.task} of ${surface.queue.of}` : "Task"}: ${quoted(surface.task, "    ")}`;

const stoppedByLimit = (surface: ReportSurface): boolean =>
  surface.cause?.kind === "budget" && surface.cause.population === "terminus" && surface.limit !== null;

/** "3 of 5 tasks completed and merged; 1 needs your decision; 1 failed after 3 attempts." Said only when nothing is still to finish. */
function headline(doc: ReportDocument): string {
  const done = doc.surfaces.filter((surface) => surface.standing === "closed");
  const [first] = done;
  const sameLanding = first?.closer != null && done.every((surface) => surface.closer === first.closer) ? first.closer : null;
  const of = (group: string): ReportSurface[] => doc.surfaces.filter((surface) => surface.plain?.group === group);
  const failed = of("failed_after_attempts").filter((surface) => !stoppedByLimit(surface));
  const limited = doc.surfaces.filter(stoppedByLimit);
  const [onlyFailure] = failed;
  const engineers = doc.surfaces.filter((surface) => sectionOf(surface) === "engineers").length;
  const some = (count: number, one: string, many: string): string[] => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);
  return [
    `${done.length} of ${tasksWord(doc.surfaces.length + doc.incomplete.filter((damaged) => damaged.queue !== null).length)} ${sameLanding === null ? "completed" : completedWords(sameLanding, done.length)}`,
    ...some(of("needs_your_decision").length, "needs your decision", "need your decision"),
    ...(failed.length === 1 && onlyFailure
      ? [`1 failed after ${onlyFailure.attempts} ${onlyFailure.attempts === 1 ? "attempt" : "attempts"}`]
      : some(failed.length, "failed", "failed after repeated attempts")),
    ...some(limited.length, "stopped at a usage limit", "stopped at a usage limit"),
    ...some(of("abandoned").length, "was abandoned", "were abandoned"),
    ...some(engineers, "stopped, for your engineers", "stopped, for your engineers"),
    ...some(doc.incomplete.filter((damaged) => damaged.queue !== null).length, "could not be read", "could not be read"),
    ...some(doc.counts.not_started, "not started", "not started"),
  ].join("; ");
}

/** "5 tasks: 1 done, 2 working, 2 waiting to start", for a report on work that has not finished. */
function tally(doc: ReportDocument): string {
  const count = (section: Section): number => doc.surfaces.filter((surface) => sectionOf(surface) === section).length;
  const part = (number: number, words: string): string[] => (number === 0 ? [] : [`${number} ${words}`]);
  return `${tasksWord(doc.surfaces.length)}: ${[
    ...part(count("done"), "done"),
    ...part(count("needs_you"), count("needs_you") === 1 ? "needs you" : "need you"),
    ...part(count("engineers"), "stopped for your engineers"),
    ...part(doc.counts.unfinished, doc.live === true ? "working" : "not finished"),
    ...part(doc.counts.paused, "held"),
    ...part(doc.counts.queued, "waiting to start"),
    ...part(doc.counts.not_started, "not started"),
  ].join(", ")}`;
}

/** What the report is about, as its opening words. Total over the kinds of report. */
const SUBJECT: Record<ReportDocument["kind"], { final: string; going: string; partWay: string; unknown: string }> = {
  list: {
    final: "Your task list",
    going: "Your task list is still being worked on",
    partWay: "Work on your task list stopped part way",
    unknown: "Your task list has not finished",
  },
  run: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
  task: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
};

/** The first lines: what happened, counted. Never final-sounding while a task is still to finish. */
function opening(doc: ReportDocument): string[] {
  const words = SUBJECT[doc.kind];
  const waiting = doc.counts.unfinished + doc.counts.paused + doc.counts.queued;
  if (waiting === 0) return doc.surfaces.length === 0 ? [] : [`${words.final}: ${headline(doc)}.`];
  if (doc.live === true) return [`${words.going} (${tally(doc)}).`];
  // A run that records why it stopped says how to carry on in its own line, below.
  if (doc.live === false) return [`${words.partWay} (${tally(doc)}).${doc.run?.cause == null ? " To carry on: delivery run" : ""}`];
  const unfinished = doc.surfaces.find((surface) => surface.standing === "unfinished");
  return [
    `${words.unknown} (${tally(doc)}); nothing records whether it is still going.${unfinished?.run ? ` If it is not, carry on with: delivery resume ${unfinished.run}` : ""}`,
  ];
}

function incompleteLines(doc: ReportDocument): string[] {
  const others = doc.surfaces.length;
  const rest = others === 0 ? "nothing else could be read" : `the other ${tasksWord(others)} ${others === 1 ? "is" : "are"} reported below`;
  return doc.incomplete.map((damaged: DamagedRecord) =>
    damaged.queue
      ? `Incomplete report: the record for task ${damaged.queue.task} is damaged (${damaged.file}); ${rest}.`
      : `Incomplete report: the record of run ${damaged.run} is damaged (${damaged.file}); ${others === 0 ? "nothing else could be read" : "what could be read is reported below"}.`,
  );
}

/** When the work ran. A run of several at once has times of its own; a list worked one task at a time has only its tasks'. */
function whenLines(doc: ReportDocument): string[] {
  const { run } = doc;
  if (run) {
    const shape = `up to ${tasksWord(run.concurrency)} at once`;
    if (run.startedAt === null) return [`Run ${run.runId}, start time not recorded, ${shape}.`];
    return run.finishedAt === null
      ? [`Run ${run.runId}, started ${dayAndMinute(run.startedAt)} UTC, ${shape}.`]
      : [`Run ${run.runId}, ${dayAndMinute(run.startedAt)} to ${minuteOf(run.finishedAt)} UTC (${elapsed(run.startedAt, run.finishedAt)}), ${shape}.`];
  }
  const ran = doc.surfaces.filter((surface) => surface.run !== null);
  if (ran.length === 0) return [];
  const started = ran.flatMap((surface) => (surface.startedAt === null ? [] : [surface.startedAt])).sort().at(0);
  // Only an ended task records a time, so a task still to finish leaves the last activity unknown.
  const finished = ran.every((surface) => surface.finishedAt !== null) ? ran.flatMap((surface) => surface.finishedAt ?? []).sort().at(-1) : undefined;
  return [
    `Started ${started === undefined ? "at a time not recorded" : `${dayAndMinute(started)} UTC`}; last activity ${finished === undefined ? "not recorded" : `${dayAndMinute(finished)} UTC`}.`,
  ];
}

/** Why a run of several at once stopped when no task caused it. Total over the causes a run records. */
function runStopLines(run: ReportRun | null): string[] {
  switch (run?.cause) {
    case undefined:
    case null:
      return [];
    case "shared_environment":
      return ["The run stopped because the setup every task shares could not be repaired; no task caused this. Once it is fixed, carry on with: delivery run"];
    case "usage_limit":
      return [
        `The run stopped because a usage limit was reached${run.limit === null ? "" : `: ${USAGE_LIMIT_WORDS[run.limit]}`}; no task caused this. Once the limit no longer applies, carry on with: delivery run`,
      ];
  }
}

/** "To act:" with its steps, numbered only when there is more than one. */
function toAct(next: string[]): string[] {
  const [only] = next;
  if (only === undefined) return [];
  if (next.length === 1) return [`    To act: ${only}`];
  return next.map((step, index) => `    ${index === 0 ? "To act:" : "       "} ${index + 1}. ${step}`);
}

/** A stopped task: the kind of stop, the agent's own words, where the work is, and what to do. */
function stoppedItem(surface: ReportSurface): string[] {
  const { plain } = surface;
  if (plain === null || surface.run === null) return [`  ${label(surface)}`];
  const landing: Landing = surface.closer ?? "commit-to-branch";
  return [
    `  ${label(surface)}`,
    `    ${plain.sentence}`,
    ...(plain.group === "stopped" ? [`    The run recorded this reason: ${surface.reason === null ? "not recorded" : quoted(surface.reason, "    ")}`] : []),
    `    The agent said: ${plain.agentSaid === null ? "not recorded" : quoted(plain.agentSaid, "    ")}`,
    ...(plain.audience === "owner" ? [`    Where the work is: ${whereTheWorkIs(landing, surface.base)}`] : []),
    ...toAct(plain.next),
    ...(plain.audience === "engineer" ? [] : [`    Full account: delivery status ${surface.run}`]),
  ];
}

const doneItem = (surface: ReportSurface): string =>
  `  ${label(surface)}: ${landedWords(surface.closer ?? "commit-to-branch", surface.branch, surface.base)}${surface.finishedAt === null ? "" : ` at ${minuteOf(surface.finishedAt)}`}`;

/** A task that has not finished, and how to carry it on when nothing says it is still going. */
function unfinishedItem(surface: ReportSurface, live: boolean | null): string[] {
  const standing =
    surface.standing === "queued"
      ? "waiting to start"
      : surface.standing === "paused"
        ? "held while the setup every task shares is repaired"
        : live === true
          ? "working"
          : "not finished";
  return [
    `  ${label(surface)}: ${standing}`,
    ...(surface.standing === "unfinished" && live === null && surface.run ? [`    If it is no longer going, carry on with: delivery resume ${surface.run}`] : []),
  ];
}

/** Why the tasks with no run were left, and how to carry on. A list worked one task at a time stops at the first task that does not finish. */
function notStartedReason(doc: ReportDocument): string[] {
  const damaged = doc.incomplete.flatMap((record) => (record.queue ? [record.queue.task] : [])).sort((a, b) => a - b).at(0);
  const stuck = doc.surfaces.find((surface) => surface.queue !== null && surface.standing !== "closed" && surface.standing !== "not_started");
  const ahead = stuck?.queue?.task;
  // A run of several at once does not stop at a task, so nothing is waiting behind one.
  if (doc.run !== null || (ahead === undefined && damaged === undefined)) return ["  These have not been started yet. To start them: delivery run"];
  if (damaged !== undefined && (ahead === undefined || damaged < ahead)) {
    return [`  These are waiting behind task ${damaged}, whose record is damaged. They are left alone until that is put right.`];
  }
  const behind = `  These are waiting behind task ${ahead}.`;
  if (stuck === undefined || sectionOf(stuck) === "not_finished") return [`${behind} It has not finished, so they have been left alone.`];
  const left = "The harness does not skip a task that stopped, so it left these alone.";
  return sectionOf(stuck) === "needs_you"
    ? [`${behind} ${left} Amend or remove task ${ahead}, then run \`delivery run\` to carry on with them.`]
    : [`${behind} ${left} Once task ${ahead} has been dealt with, run \`delivery run\` to carry on with them.`];
}

function sectionLines(doc: ReportDocument, section: Section, colour: boolean): string[] {
  const surfaces = doc.surfaces.filter((surface) => sectionOf(surface) === section);
  if (surfaces.length === 0) return [];
  const { title, tone } = HEADING[section];
  const body = ((): string[] => {
    switch (section) {
      case "needs_you":
      case "engineers":
        return surfaces.flatMap((surface, index) => [...(index === 0 ? [] : [""]), ...stoppedItem(surface)]);
      case "done":
        return surfaces.map(doneItem);
      case "not_finished":
        return surfaces.flatMap((surface) => unfinishedItem(surface, doc.live));
      case "not_started":
        return [...surfaces.map((surface) => `  ${label(surface)}`), ...notStartedReason(doc)];
    }
  })();
  return ["", paint(colour, tone, `${title} (${surfaces.length})`), ...body];
}

/** Retries used, in the owner's vocabulary, for whoever adjusts the limits. Nothing when no task has a run to count. */
function tuningLines(doc: ReportDocument, colour: boolean): string[] {
  const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
  if (ran.length === 0) return [];
  const populations = ["correction", "gateError", "gateMaintenance", "terminus", "close"] as const;
  const sums = populations.map((population) => {
    const rows = ran.flatMap((surface) => surface.budgets.filter((row) => row.population === population));
    return `${RETRY_WORDS[population]} ${rows.reduce((sum, row) => sum + row.used, 0)} of ${rows.reduce((sum, row) => sum + row.max, 0)}`;
  });
  return [
    "",
    paint(colour, "quiet", "FOR WHOEVER TUNES THIS"),
    `  Retries used across ${ran.length === 1 ? "this task" : "these tasks"}: ${sums.join("; ")}.`,
    ...(doc.run ? [`  Repairs of the setup every task shares: ${doc.run.runBudgets.gateMaintenance.used} of ${doc.run.runBudgets.gateMaintenance.max}.`] : []),
    "  Time and cost were not recorded for this run.",
  ];
}

/** Where to go from here: only commands that exist. */
function nextLine(doc: ReportDocument): string {
  const [only] = doc.surfaces;
  if (doc.run) return `Next: delivery status ${doc.run.runId} (detail), delivery status --all (every run)`;
  if (doc.kind === "task" && only?.run) return `Next: delivery status ${only.run} (detail), delivery report (your task list)`;
  return "Next: delivery status --all (every run)";
}

/**
 * The report as a person reads it: plain lines, one fact per line, no columns
 * and no wrapping, so it reads the same at any width, in a pipe and in a screen
 * reader. Pure: the same document always gives the same text. Every sentence
 * outside quotation marks is from a fixed table; words from the record appear
 * only quoted, with control characters taken out.
 */
export function renderText(doc: ReportDocument, { colour }: { colour: boolean }): string[] {
  return [
    ...incompleteLines(doc),
    ...opening(doc),
    ...whenLines(doc),
    ...runStopLines(doc.run),
    ...SECTIONS.flatMap((section) => sectionLines(doc, section, colour)),
    ...tuningLines(doc, colour),
    "",
    nextLine(doc),
  ];
}
