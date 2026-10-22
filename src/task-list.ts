import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { newestFirst, type RunRecord } from "./run-records.js";
import type { TaskDef } from "./schema.js";

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, inner]) => [key, canonical(inner)]))
      : value;

/** A task's identity for the item ledger: what the task says, never where it sits in a list that gets edited. */
export function taskId(taskDef: TaskDef): string {
  return createHash("sha256").update(JSON.stringify(canonical(taskDef))).digest("hex").slice(0, 12);
}

/** Where a task sits in the list as it is written now, counted from one, which is how "Task N of M" reads. */
export interface QueuePosition {
  task: number;
  of: number;
}

/** The task's own words, for the run's id and the line that announces it. A task is opaque to the harness, so one shaped another way still gets a run. */
export function taskIntent(taskDef: TaskDef): string {
  return typeof taskDef.intent === "string" && taskDef.intent.trim() !== "" ? taskDef.intent.trim() : "run";
}

/**
 * The run that answers for a task, or none yet. Identity is what the task says:
 * a run's record pins the task it was started with, so comparing the two is
 * enough, and nothing about the queue has to be stored. Position is deliberately
 * not identity — a checked-in list is inserted into, reordered and trimmed, and a
 * remembered index would silently skip a new entry or repeat an old one.
 *
 * Several runs can answer for one task: someone ran the same words ad hoc, or
 * asked for a fresh start. The most recently started one is the project's
 * current answer, as it is everywhere else the harness picks "the latest".
 */
export function findQueueRun(records: RunRecord[], taskDef: TaskDef): RunRecord | undefined {
  const [answering] = newestFirst(records.filter((record) => isDeepStrictEqual(record.caseFile.header.taskDef, taskDef)));
  return answering;
}

/** Whether a task is done with: only a delivered run is. One that escalated or was stopped still needs the owner, so the list waits on it. */
const isClosed = (record: RunRecord | undefined): boolean => record?.caseFile.outcome?.kind === "closed";

/**
 * Whether a list task is still for a run to take: its run has not been
 * delivered, and no slot has already taken it in this run. The one rule
 * `delivery run` fills each slot by, and `delivery status` counts queued tasks by.
 */
export function stillToTake(records: RunRecord[], taskDef: TaskDef, claimed: readonly TaskDef[] = []): boolean {
  return !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef));
}

/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}

/** The text a task's pull request is written from: its body when that is non-empty text, else its intent. */
export function taskText(taskDef: TaskDef): string {
  const body = taskDef.body;
  return typeof body === "string" && body.trim() !== "" ? body.trim() : taskIntent(taskDef);
}
