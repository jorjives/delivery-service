import { deriveReport } from "../report/derive.js";
import { stepOf, type PlainGroup, type ReportDocument, type ReportSurface } from "../report/document.js";
import { eventsOf, sourceOf, type ReportEvent } from "../report/events.js";
import { attemptsWord, landedWords, RETRY_WORDS } from "../report/plain.js";
import type { RecordSnapshot } from "../report/snapshot.js";
import { doneItem, headlineCounts, incompleteLines, label, lastActivity, minuteOf, quoted, reportPointer, stoppedPartWay, tasksWord } from "../report/text.js";
import type { SurfaceState } from "../schema.js";
import { EXIT, type ExitCode } from "./failures.js";
import { STEP_PHRASES } from "./output.js";
import { listExitCode, shapeOf } from "./queue.js";

/** What a watch remembers between one look at the record and the next. */
export interface WatchState {
  /** For each journal (a task's own, or its run's), the position after the last entry already told. */
  cursors: Record<string, number>;
  /** Said once: nothing records whether the work is still going. */
  saidUnknown: boolean;
  /** Said once: this record holds no times. */
  saidNoTimes: boolean;
}

/** One look at the record: what to print, what to remember, and the exit code once the watch is over. */
export interface WatchTick {
  lines: string[];
  state: WatchState;
  /** null while there is more to wait for. */
  exitCode: ExitCode | null;
}

export const TIMES_NOT_RECORDED = "Times were not recorded for this run.";

/** "02:43 ", or nothing for a record that holds no time: a line never shows a time the record does not. */
const stamp = (at: string | null): string => (at === null ? "" : `${minuteOf(at)} `);

/** A task as a change line names it: its place in the list, or its wording when the list no longer has it. */
const place = (surface: ReportSurface): string => (surface.queue ? `Task ${surface.queue.task} of ${surface.queue.of}` : `Task ${quoted(surface.task, "    ")}`);

/** How a stopped task is told in one phrase. Total over the kinds of stop, so a new one does not compile until it has words. */
const STOP_WORDS: Record<PlainGroup, (surface: ReportSurface) => string> = {
  needs_your_decision: () => "needs your decision",
  failed_after_attempts: (surface) => `failed after ${attemptsWord(surface.attempts)}`,
  abandoned: () => "was abandoned",
  needs_an_engineer: () => "stopped, for your engineers",
  stopped: () => "stopped",
};

const stoppedWords = (surface: ReportSurface): string => (surface.plain === null ? "stopped" : STOP_WORDS[surface.plain.group](surface));

/** The steps a task ends in: told by its outcome, which says where the work went, rather than by the step. */
const ENDED: readonly SurfaceState[] = ["CLOSED", "ESCALATED", "ABORTED"];

/** What a task is doing, in the words the run itself prints as it goes, with which go of the agent's it is. */
const stepWords = (state: SurfaceState, attempt: number): string => `${STEP_PHRASES[state]}${attempt > 1 ? ` (attempt ${attempt})` : ""}`;

/** The line that names what is being watched, and says that stopping the watch stops nothing else. */
function openingLine(doc: ReportDocument): string {
  const [only] = doc.surfaces;
  const subject =
    doc.run !== null && (doc.kind === "run" || doc.run.outcome === null)
      ? `run ${doc.run.runId}: ${shapeOf(doc.run.tasks, doc.run.concurrency)}`
      : doc.kind === "task" && only?.run
        ? `run ${only.run}: ${quoted(only.task, "    ")}`
        : `your task list: ${tasksWord(doc.surfaces.length + doc.incomplete.filter((damaged) => damaged.queue !== null).length)}`;
  return `Watching ${subject}. Ctrl-C stops watching; the run is not affected.`;
}

/** One task in the picture: where it stands, and for a task under way which step it is in and since when. */
function pictureLine(surface: ReportSurface, live: boolean | null): string {
  switch (surface.standing) {
    case "closed":
      return doneItem(surface);
    case "escalated":
    case "aborted":
      return `  ${label(surface)}: ${stoppedWords(surface)}`;
    case "paused":
      return `  ${label(surface)}: held while the setup every task shares is repaired`;
    case "queued":
      return `  ${label(surface)}: waiting to start`;
    case "not_started":
      return `  ${label(surface)}: not started`;
    case "unfinished": {
      const step = stepOf(surface);
      // A run known to have stopped has nothing in any step.
      if (step === null || live === false) return `  ${label(surface)}: not finished`;
      const corrections = surface.budgets.find((row) => row.population === "correction");
      const retries = corrections && corrections.used > 0 ? `; ${corrections.used} of ${corrections.max} ${RETRY_WORDS.correction} used` : "";
      const attempts = surface.attempts > 0 ? ` (attempt ${surface.attempts}${retries})` : "";
      return `  ${label(surface)}: ${STEP_PHRASES[step.state]}${attempts}.${step.at === null ? "" : ` In this step since ${minuteOf(step.at)} UTC.`}`;
    }
  }
}

/** Every task as the record shows it at this moment. The time named is the last the record holds, never the clock's. */
function pictureLines(doc: ReportDocument): string[] {
  const at = lastActivity(doc);
  return [
    ...incompleteLines(doc),
    `Right now (last activity ${at === null ? "not recorded" : `${minuteOf(at)} UTC`}): ${headlineCounts(doc)}.`,
    ...doc.surfaces.map((surface) => pictureLine(surface, doc.live)),
  ];
}

/** One recorded change as a line: the time, then the task's place or, for the setup every task shares, nothing. Nothing for a change that reads the same as the line before it. */
function changeLine(event: ReportEvent, doc: ReportDocument): string[] {
  const surface = doc.surfaces.find((candidate) => candidate.run !== null && candidate.run === event.surface);
  switch (event.type) {
    case "surface_state":
      if (surface === undefined || event.state === event.from || ENDED.includes(event.state)) return [];
      return [`${stamp(event.at)}${place(surface)}: ${stepWords(event.state, event.attempt)}.`];
    case "surface_outcome":
      if (surface === undefined) return [];
      return event.outcome === "closed"
        ? [`${stamp(event.at)}${place(surface)}: done, ${landedWords(surface.closer ?? "commit-to-branch", surface.branch, surface.base)}.`]
        : [`${stamp(event.at)}! ${place(surface)}: ${stoppedWords(surface)}.`];
    case "breaker_changed":
      if (event.state === "DEGRADED") {
        return [`${stamp(event.at)}! The setup the checks need looks broken. Holding tasks about to check or hand over their work while it is repaired.`];
      }
      return event.state === "HEALTHY" ? [`${stamp(event.at)}The setup is repaired; tasks carry on.`] : [];
    case "repair_started":
      return [`${stamp(event.at)}The setup is being repaired (repair ${event.attempt} of ${event.of}).`];
    case "repair_finished":
      return event.status === "completed" ? [] : [`${stamp(event.at)}! That repair did not fix the setup.`];
  }
}

/** Whether a task still under way holds a step with no time: a record made before steps carried one. */
const timeless = (doc: ReportDocument): boolean =>
  doc.surfaces.some((surface) => (surface.standing === "unfinished" || surface.standing === "paused") && surface.states.some((visit) => visit.at === null));

/**
 * How the watch's subject ended, once it has: the closing words and the code its run ended with. Nothing while there is more to wait for.
 * A task list ended with the run of several tasks that governs it (see `ReportRun.governs`), or else with the first task that stopped it.
 */
function ending(doc: ReportDocument): { words: string; exitCode: ExitCode } | undefined {
  const standings = doc.surfaces.flatMap((surface) => (surface.standing === "closed" || surface.standing === "escalated" || surface.standing === "aborted" ? [surface.standing] : []));
  const [only] = doc.surfaces;
  if (doc.kind === "task") {
    if (only === undefined || standings.length === 0) return undefined;
    return { words: only.standing === "closed" ? "This run finished" : "This run stopped", exitCode: listExitCode(standings) };
  }
  if (doc.run !== null && doc.run.outcome === null) return undefined;
  if (doc.run?.governs) {
    // A run that gave up on the setup its tasks share stopped with tasks still to finish: it did not finish.
    return doc.run.outcome === "escalated" ? { words: "Run stopped", exitCode: EXIT.escalated } : { words: "Run finished", exitCode: listExitCode(standings) };
  }
  // A list worked one task at a time stops at the first task that did not close, as `delivery run` stops it.
  for (const surface of doc.surfaces) {
    if (surface.standing === "closed") continue;
    if (surface.standing !== "escalated" && surface.standing !== "aborted") return undefined;
    return { words: "Your task list has stopped", exitCode: listExitCode([surface.standing]) };
  }
  // ponytail: a list with a damaged record is never called done, so its watch waits until stopped; end it with a code of its own if that proves a nuisance.
  return doc.surfaces.length === 0 || doc.incomplete.length > 0 ? undefined : { words: "Every task on your list is done", exitCode: EXIT.ok };
}

/**
 * One look at the record, as lines to add. The first look says what is being
 * watched and gives the picture as it stands; every later look adds one line
 * for each change recorded since the one before. Pure and deterministic: it
 * reads no file and no clock, so the same looks always give the same lines.
 *
 * The watch is over when its subject ended (the code is the one that run, or
 * `delivery run` for that list, ended with) or when a run of several tasks is
 * known to have been stopped part way (ok: there is no outcome to mirror).
 * Where nothing records whether the work is still going, it says so once and
 * keeps waiting: it never decides for itself that a run is dead.
 */
export function watchTick(previous: WatchState | undefined, snapshot: RecordSnapshot): WatchTick {
  const doc = deriveReport(snapshot);
  const events = eventsOf(snapshot);
  const state: WatchState = { ...(previous ?? { cursors: {}, saidUnknown: false, saidNoTimes: false }) };
  const lines: string[] = [];

  if (previous === undefined) {
    lines.push(openingLine(doc), "", ...pictureLines(doc), "");
    if (timeless(doc)) {
      lines.push(TIMES_NOT_RECORDED);
      state.saidNoTimes = true;
    }
  } else {
    for (const event of events) {
      if (event.seq < (state.cursors[sourceOf(event)] ?? 0)) continue;
      const told = changeLine(event, doc);
      if (told.length > 0 && event.at === null && !state.saidNoTimes) {
        lines.push(TIMES_NOT_RECORDED);
        state.saidNoTimes = true;
      }
      lines.push(...told);
    }
  }
  state.cursors = { ...state.cursors };
  for (const event of events) state.cursors[sourceOf(event)] = Math.max(state.cursors[sourceOf(event)] ?? 0, event.seq + 1);

  // A subject that cannot be read at all: the picture names it on the first look, and a later look names it here, so a
  // record damaged while it is watched never ends the watch without a word. There is nothing to wait for.
  if (doc.surfaces.length === 0 && doc.incomplete.length > 0) {
    return { lines: previous === undefined ? lines : [...lines, ...incompleteLines(doc)], state, exitCode: EXIT.ok };
  }

  const ended = ending(doc);
  if (ended) {
    lines.push(`${stamp(lastActivity(doc))}${ended.words}: ${headlineCounts(doc)}. ${reportPointer(doc)}`);
    return { lines, state, exitCode: ended.exitCode };
  }
  // Only a run of several tasks holds the lock, so only one of those can be known to have been stopped.
  if (doc.live === false && (doc.kind === "task" || doc.run?.outcome === null)) {
    lines.push(stoppedPartWay(doc));
    return { lines, state, exitCode: EXIT.ok };
  }
  if (doc.live !== true && !state.saidUnknown) {
    const at = lastActivity(doc);
    lines.push(
      `Nothing records whether ${doc.kind === "list" ? "your task list" : "this run"} is still being worked on. Last recorded activity: ${at === null ? "not recorded" : `${minuteOf(at)} UTC`}. Still watching.`,
    );
    state.saidUnknown = true;
  }
  return { lines, state, exitCode: null };
}
