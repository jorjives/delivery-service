import type { BreakerState, RunFile, SlotOutcome, TaskDef } from "../schema.js";
import { breakerOf, openTrip, tripsOf, type Trip } from "../breaker.js";
import { queuePositionOf, stillToTake, type QueuePosition } from "./queue.js";
import type { RunRecord } from "./runs.js";

/** Where one task of a run of several at once has got to: how its own run ended, that it hasn't yet, or that it is still waiting to start. */
export type TaskStanding = SlotOutcome | "paused" | "unfinished" | "queued";

/** Every standing, in the order a summary says them. */
export const STANDINGS: readonly TaskStanding[] = ["closed", "escalated", "aborted", "paused", "unfinished", "queued"];

/** One task of a run of several at once. */
export interface ViewTask {
  taskDef: TaskDef;
  /** Its place in the project's list as written now; none once the list no longer asks for it. */
  position: QueuePosition | undefined;
  /** Its own run's record, once it has one. */
  record: RunRecord | undefined;
  standing: TaskStanding;
}

/** A run of several tasks at once, read back: its record, whether it is going right now, the shared environment, and every task it took or has yet to take. */
export interface SupervisedView {
  runFile: RunFile;
  live: boolean;
  breaker: BreakerState;
  /** The shared environment's trip still unresolved: under repair, or the one the run gave up on. */
  trip: Trip | undefined;
  tasks: ViewTask[];
}

/** Every task the run took, once each, in the order it first took them: a run picked up after a stop takes its unfinished tasks again. */
export function claimedBy(runFile: RunFile): { surfaceId: string; taskDef: TaskDef }[] {
  const taken = new Map<string, TaskDef>();
  for (const entry of runFile.history) {
    if (entry.t === "slot_fill" && !taken.has(entry.surfaceId)) taken.set(entry.surfaceId, entry.taskDef);
  }
  return [...taken].map(([surfaceId, taskDef]) => ({ surfaceId, taskDef }));
}

const LAST = Number.MAX_SAFE_INTEGER;

/** The trip a person still needs to hear about: the open one, or the one the run gave up on. */
function unresolvedTrip(runFile: RunFile): Trip | undefined {
  if (runFile.outcome?.kind === "escalated") return tripsOf(runFile.history).at(-1);
  return openTrip(runFile.history);
}

/**
 * A run of several at once as `delivery status` tells it. Pure over what it is
 * given: the run's record, every task run's record, and the list as written now.
 * A task the run took stands as its own record says, or queued if it never got
 * as far as having one. A run that has not finished also has every list task it
 * would still take, by the rule it fills slots by; a finished run takes nothing more.
 */
export function supervisedView(runFile: RunFile, records: RunRecord[], list: TaskDef[], live: boolean): SupervisedView {
  const breaker = breakerOf(runFile.history);
  const trip = unresolvedTrip(runFile);
  const claims = claimedBy(runFile);
  const taken = claims.map(({ surfaceId, taskDef }): ViewTask => {
    const record = records.find((candidate) => candidate.runId === surfaceId);
    return {
      taskDef,
      position: queuePositionOf(list, taskDef),
      record,
      standing:
        record === undefined
          ? (trip?.held.includes(surfaceId) ? "paused" : "queued")
          : (record.caseFile.outcome?.kind ?? (trip?.held.includes(surfaceId) ? "paused" : "unfinished")),
    };
  });
  const claimed = claims.map(({ taskDef }) => taskDef);
  const waiting: ViewTask[] =
    // Include waiting tasks if the run is not finished, or if it stopped with an environment issue
    (runFile.outcome !== undefined && runFile.outcome.kind !== "escalated")
      ? []
      : list
          .filter((taskDef) => stillToTake(records, taskDef, claimed))
          .map((taskDef): ViewTask => ({ taskDef, position: queuePositionOf(list, taskDef), record: undefined, standing: "queued" }));
  const tasks = [...taken, ...waiting].sort((a, b) => (a.position?.task ?? LAST) - (b.position?.task ?? LAST));
  return { runFile, live, breaker, trip, tasks };
}

/** How many tasks stand each way, every standing present. */
export function standingCounts(tasks: readonly ViewTask[]): Record<TaskStanding, number> {
  const counts: Record<TaskStanding, number> = { closed: 0, escalated: 0, aborted: 0, paused: 0, unfinished: 0, queued: 0 };
  for (const task of tasks) counts[task.standing] += 1;
  return counts;
}

/** How the run ended as one word, the precedence its exit code has: a decision wanted anywhere, then a task that stopped, and closed only when every task closed. */
export function overallOutcome(view: SupervisedView): SlotOutcome | "unfinished" {
  if (view.runFile.outcome === undefined) return "unfinished";
  if (view.runFile.outcome.kind === "escalated") return "escalated";
  const standings = view.tasks.map((task) => task.standing);
  if (standings.includes("escalated")) return "escalated";
  if (standings.includes("aborted")) return "aborted";
  return "closed";
}
