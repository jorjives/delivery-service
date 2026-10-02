import { z } from "zod";
import { BreakerState, RepairStatus, SlotOutcome, SurfaceState, type RunFile } from "../schema.js";
import type { RunRecord } from "../run-records.js";
import { claimedBy } from "../supervised-view.js";
import { deriveReport, stateAfter } from "./derive.js";
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

/**
 * One thing a record shows happening. An event is one journal entry (or a
 * task's recorded outcome, which follows its last entry), never a difference
 * between two readings, so replaying a finished run gives the same events as
 * following it while it happened.
 */
export const ReportEvent = z.discriminatedUnion("type", [
  /** A task's log gained an entry: the step it is in after it, the step it was in before (null for its first entry), and which go of the agent's it is on. */
  z.object({ ...envelope, type: z.literal("surface_state"), state: SurfaceState, from: SurfaceState.nullable(), attempt: z.number().int().nonnegative() }),
  /** A task ended. */
  z.object({ ...envelope, type: z.literal("surface_outcome"), outcome: SlotOutcome }),
  /** The setup every task of a run shares broke, or was repaired. */
  z.object({ ...envelope, type: z.literal("breaker_changed"), state: BreakerState }),
  /** A repair of that setup started: which of how many the run allows. */
  z.object({ ...envelope, type: z.literal("repair_started"), attempt: z.number().int().positive(), of: z.number().int().positive() }),
  /** That repair's session ended. */
  z.object({ ...envelope, type: z.literal("repair_finished"), status: RepairStatus }),
]);
export type ReportEvent = z.infer<typeof ReportEvent>;

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
    const event: ReportEvent = { ...head, seq, at: entry.at ?? null, type: "surface_state", state, from, attempt };
    from = state;
    return event;
  });
  return outcome === undefined ? events : [...events, { ...head, seq: history.length, at: outcome.at, type: "surface_outcome", outcome: outcome.kind }];
}

/** A run's own events: what happened to the setup its tasks share. Which task took which slot is told by the tasks' own events. */
function runEvents(runFile: RunFile): ReportEvent[] {
  const head = { schema: EVENT_SCHEMA, run: runFile.header.runId, surface: null } as const;
  return runFile.history.flatMap((entry, seq): ReportEvent[] => {
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
 * about, in order: the run's own journal when the report has a run that has
 * not ended or is its subject, and the journal of every task the report shows.
 * Pure, total and deterministic over the snapshot, as `deriveReport` is.
 */
export function eventsOf(snapshot: RecordSnapshot): ReportEvent[] {
  const doc = deriveReport(snapshot);
  const runFile = doc.run === null ? undefined : snapshot.runs.find((run) => run.header.runId === doc.run?.runId);
  const records = doc.surfaces.flatMap((surface) => snapshot.records.find((record) => record.runId === surface.run) ?? []);
  const taken = new Set(runFile ? claimedBy(runFile).map((claim) => claim.surfaceId) : []);
  const runOf = (record: RunRecord): string | null => (runFile !== undefined && taken.has(record.runId) ? runFile.header.runId : null);
  return merged([...(runFile ? [runEvents(runFile)] : []), ...records.map((record) => surfaceEvents(record, runOf(record)))]);
}
