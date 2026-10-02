import { z } from "zod";
import { BreakerState, RepairStatus, SlotOutcome, SurfaceState, TriageEntry, type RunFile } from "../schema.js";
import type { RunRecord } from "../run-records.js";
import { claimedBy } from "../supervised-view.js";
import { deriveReport, stateAfter } from "./derive.js";
import { lastActivity, Standing, type ReportDocument } from "./document.js";
import type { RecordSnapshot } from "./snapshot.js";

/** The version every event names itself by, under the promise the report document makes for its own. */
export const EVENT_SCHEMA = "delivery.event/1";

/**
 * What every event says of itself: the run of several tasks it belongs to (null
 * when there is none), the task's own run (null for an event of the run as a
 * whole), the position in its source journal of the entry it tells, and when
 * that entry was recorded (null for a record made before steps carried a time).
 */
const envelope = {
  schema: z.literal(EVENT_SCHEMA),
  run: z.string().nullable(),
  surface: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  at: z.string().nullable(),
};

/** The step a task is in after a log entry, the step it was in before (null for its first entry), and which go of the agent's it is on. */
const step = { state: SurfaceState, from: SurfaceState.nullable(), attempt: z.number().int().nonnegative() };

/**
 * Why a stream ended. `ended`: what it followed recorded its ending.
 * `stopped_part_way`: a run of several tasks is known to have been stopped
 * with no ending recorded. `unreadable`: the record of what it followed is
 * damaged. `nothing_recorded`: the folder holds no run to follow.
 */
export const StreamEnding = z.enum(["ended", "stopped_part_way", "unreadable", "nothing_recorded"]);
export type StreamEnding = z.infer<typeof StreamEnding>;

/**
 * One line of a stream. Between its two markers, an event is one journal entry
 * (or a recorded outcome, which follows its journal's last entry), never a
 * difference between two readings, so replaying a finished run gives the same
 * events as following it while it happened. A marker is the stream's own: its
 * `seq` is 0 and it stands for no entry.
 */
export const ReportEvent = z.discriminatedUnion("type", [
  /** The first line of every stream: what is being followed. `run` is null for a list worked one task at a time, which has no run of its own. */
  z.object({ ...envelope, type: z.literal("stream_started"), subject: z.enum(["task", "run", "list"]) }),
  /** A task's log gained an entry. */
  z.object({ ...envelope, type: z.literal("surface_state"), ...step }),
  /** A task's log gained a triage round: what set it off, what was decided, and the reasoning word for word. */
  z.object({
    ...envelope,
    type: z.literal("triage_decision"),
    ...step,
    afterAttempt: TriageEntry.shape.afterAttempt,
    trigger: TriageEntry.shape.trigger,
    verdict: TriageEntry.shape.verdict,
    rationale: z.string(),
  }),
  /** A task ended. */
  z.object({ ...envelope, type: z.literal("surface_outcome"), outcome: SlotOutcome }),
  /** The setup every task of a run shares broke, or was repaired. */
  z.object({ ...envelope, type: z.literal("breaker_changed"), state: BreakerState }),
  /** A repair of that setup started: which of how many the run allows. */
  z.object({ ...envelope, type: z.literal("repair_started"), attempt: z.number().int().positive(), of: z.number().int().positive() }),
  /** That repair's session ended. */
  z.object({ ...envelope, type: z.literal("repair_finished"), status: RepairStatus }),
  /** A run of several tasks ended: every task it could take was taken and has ended, or it stopped and no task caused it. */
  z.object({
    ...envelope,
    type: z.literal("run_outcome"),
    outcome: z.enum(["drained", "escalated"]),
    cause: z.enum(["shared_environment", "usage_limit"]).nullable(),
    reason: z.string().nullable(),
  }),
  /**
   * The last line of every stream: why it ended and how things stood. `runOutcome`
   * is null where there is no run of several tasks; `surfaceOutcome` is one task's
   * outcome, or for a list the outcome of the task that stopped it, and null otherwise.
   */
  z.object({
    ...envelope,
    type: z.literal("stream_ended"),
    subject: z.enum(["task", "run", "list"]),
    ending: StreamEnding,
    counts: z.record(Standing, z.number().int().nonnegative()),
    runOutcome: z.enum(["drained", "escalated"]).nullable(),
    surfaceOutcome: SlotOutcome.nullable(),
  }),
]);
export type ReportEvent = z.infer<typeof ReportEvent>;

/** What any event carries whatever its `type`: all a reader can rely on in one whose type it does not know. */
export const UnknownEvent = z.object({ ...envelope, type: z.string() });

/** The journal an event came from: a task's own, or its run's. */
export const sourceOf = (event: ReportEvent): string => event.surface ?? event.run ?? "";

/** One task's events, in the order its log holds them, then its outcome once it has one. */
function surfaceEvents(record: RunRecord, run: string | null): ReportEvent[] {
  const { history, outcome } = record.caseFile;
  const head = { schema: EVENT_SCHEMA, run, surface: record.runId } as const;
  let from: SurfaceState | null = null;
  let dispatched = 0;
  const events = history.map((entry, seq): ReportEvent => {
    const setToWork = entry.t === "dispatch" && (entry.role ?? "worker") === "worker";
    if (setToWork) dispatched += 1;
    const state = stateAfter(entry);
    // An entry that sends the agent back to work is already about its next go, before that go is recorded.
    const attempt = state === "AGENT_ACTIVE" && !setToWork ? dispatched + 1 : dispatched;
    const told = { ...head, seq, at: entry.at ?? null, state, from, attempt };
    from = state;
    return entry.t === "triage"
      ? { ...told, type: "triage_decision", afterAttempt: entry.afterAttempt, trigger: entry.trigger, verdict: entry.verdict, rationale: entry.rationale }
      : { ...told, type: "surface_state" };
  });
  return outcome === undefined ? events : [...events, { ...head, seq: history.length, at: outcome.at, type: "surface_outcome", outcome: outcome.kind }];
}

/** A run's own events: what happened to the setup its tasks share, then its outcome once it has one. Which task took which slot is told by the tasks' own events. */
function runEvents(runFile: RunFile): ReportEvent[] {
  const { history, outcome } = runFile;
  const head = { schema: EVENT_SCHEMA, run: runFile.header.runId, surface: null } as const;
  const events = history.flatMap((entry, seq): ReportEvent[] => {
    const at = entry.at ?? null;
    switch (entry.t) {
      case "breaker_degraded":
        return [{ ...head, seq, at, type: "breaker_changed", state: "DEGRADED" }];
      case "breaker_healthy":
        return [{ ...head, seq, at, type: "breaker_changed", state: "HEALTHY" }];
      case "repair_dispatch":
        return [{ ...head, seq, at, type: "repair_started", attempt: entry.attempt, of: runFile.header.runBudgetMax.gateMaintenance }];
      case "repair_terminus":
        return [{ ...head, seq, at, type: "repair_finished", status: entry.status }];
      case "slot_fill":
      case "slot_free":
      case "held":
      case "repair_request":
      case "gate_error_signal":
      case "run_escalated":
        return [];
    }
  });
  if (outcome === undefined) return events;
  const stopped = outcome.kind === "escalated" ? outcome : undefined;
  return [...events, { ...head, seq: history.length, at: outcome.at, type: "run_outcome", outcome: outcome.kind, cause: stopped?.cause ?? null, reason: stopped?.reason ?? null }];
}

/**
 * Several journals as one sequence: each journal's own order is kept exactly,
 * and across journals the earlier recorded time goes first. An event with no
 * time sorts before any with one, so records made before steps carried a time
 * come out journal by journal.
 */
function merged(sources: ReportEvent[][]): ReportEvent[] {
  const next = sources.map(() => 0);
  const out: ReportEvent[] = [];
  for (;;) {
    let pick: { index: number; event: ReportEvent } | undefined;
    sources.forEach((source, index) => {
      const event = source[next[index] ?? 0];
      if (event !== undefined && (pick === undefined || (event.at ?? "") < (pick.event.at ?? ""))) pick = { index, event };
    });
    if (pick === undefined) return out;
    out.push(pick.event);
    next[pick.index] = (next[pick.index] ?? 0) + 1;
  }
}

/**
 * Everything the record shows happening to what a report on `snapshot` is
 * about, in order: the run's own journal when the report's standing is that
 * run's (see `ReportRun.governs`), and the journal of every task the report shows.
 * Pure, total and deterministic over the snapshot, as `deriveReport` is.
 */
export function eventsOf(snapshot: RecordSnapshot): ReportEvent[] {
  const doc = deriveReport(snapshot);
  const runFile = doc.run?.governs ? snapshot.runs.find((run) => run.header.runId === doc.run?.runId) : undefined;
  const records = doc.surfaces.flatMap((surface) => snapshot.records.find((record) => record.runId === surface.run) ?? []);
  const taken = new Set(runFile ? claimedBy(runFile).map((claim) => claim.surfaceId) : []);
  const runOf = (record: RunRecord): string | null => (runFile !== undefined && taken.has(record.runId) ? runFile.header.runId : null);
  return merged([...(runFile ? [runEvents(runFile)] : []), ...records.map((record) => surfaceEvents(record, runOf(record)))]);
}

/** The run of several tasks a report's standing belongs to: none for one task, and none for a task list worked on its own since, whatever run once took one of its tasks. */
const governing = (doc: ReportDocument) => (doc.run?.governs ? doc.run : null);

/** What both markers say of the stream: the run of several tasks it follows, if there is one, and the task's own run when it follows one task. */
const markerOf = (doc: ReportDocument) =>
  ({ schema: EVENT_SCHEMA, run: governing(doc)?.runId ?? null, surface: doc.kind === "task" ? (doc.surfaces[0]?.run ?? null) : null, seq: 0, subject: doc.kind }) as const;

/** The first line of a stream about `doc`. It says nothing that depends on when the stream began, so a replay opens exactly as a live stream did. */
export const streamStarted = (doc: ReportDocument): ReportEvent => ({ ...markerOf(doc), at: null, type: "stream_started" });

const ENDED = SlotOutcome.options as readonly string[];

/** The last line of a stream about `doc`: why it ended, and how things stood by the record's own account. */
export function streamEnded(doc: ReportDocument, ending: StreamEnding): ReportEvent {
  const run = governing(doc);
  // One task: its own outcome. A list worked one at a time: the first task that did not close, which is where it stops. A run of several: no one task's.
  const decisive = doc.kind === "task" ? doc.surfaces[0] : run === null ? doc.surfaces.find((surface) => surface.standing !== "closed") : undefined;
  return {
    ...markerOf(doc),
    at: lastActivity(doc),
    type: "stream_ended",
    ending,
    counts: doc.counts,
    runOutcome: run?.outcome ?? null,
    surfaceOutcome: decisive !== undefined && ENDED.includes(decisive.standing) ? SlotOutcome.parse(decisive.standing) : null,
  };
}
