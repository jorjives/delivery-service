import { isDeepStrictEqual } from "node:util";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { SlotOutcome, TaskDef } from "../schema.js";
import { supervise } from "../supervisor.js";
import { createRunFile, setRunOutcome } from "../run-file.js";
import { agentSession } from "./agent-session.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { resumeRun, startRun } from "./drive.js";
import { EXIT, type ExitCode } from "./failures.js";
import { reportOutcome } from "./outcome.js";
import { prepareRunDir, runIdFor, supervisedPlace, supervisedRunId } from "./run-location.js";
import { allRuns, describeRun, newestFirst, type RunRecord, unfinishedSupervisedRun } from "./runs.js";
import { taskIntent, type ProjectSettings } from "./settings.js";

/** Where a task sits in the list as it is written now, counted from one, which is how "Task N of M" reads. */
export interface QueuePosition {
  task: number;
  of: number;
}

/** Everything this project's list asks for, in the order it was written. */
export function queueTasks(config: DeliveryConfig): TaskDef[] {
  return (config.tasks ?? []).map(structureTask);
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
 * The task `delivery run` would act on next: the first one on the list whose
 * run has not been delivered and that no slot has already taken in this run,
 * counted as "Task N of M" counts. Nothing when no task is left. The same rule
 * `runQueue` fills each slot by, so what `delivery preview` calls next is what a run
 * does next.
 */
export function nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: readonly TaskDef[] = []): QueuePosition | undefined {
  const index = tasks.findIndex(
    (taskDef) => !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef)),
  );
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}

/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}

/** "Task N of M", as every line naming a task's place in the list starts. */
const positionPhrase = (position: QueuePosition): string => `Task ${position.task} of ${position.of}`;

/** Which task of how many this is, in the owner's own words, around the step lines a single run already prints. */
export const taskHeading = (position: QueuePosition, intent: string): string => `${positionPhrase(position)}: ${intent}`;

export const EVERY_TASK_DONE =
  "Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.";

/**
 * Why the rest of the list was left alone. The harness never decides on the
 * owner's behalf that a later task matters more than a decision this one is
 * waiting for, so there is no skipping: the way past a stopped task is to deal
 * with it, or to reword the entry.
 */
export function listStopped(position: QueuePosition, exitCode: ExitCode): string {
  const which = positionPhrase(position);
  return exitCode === EXIT.escalated
    ? `${which} needs your decision before I can go on, so I've left the rest of the list alone.`
    : `${which} stopped before it finished, so I've left the rest of the list alone.`;
}

/**
 * The exit code a whole list ends with, from how each task it took ended: a
 * decision wanted anywhere comes first, then a task that stopped, and only a
 * list delivered in full is 0.
 */
export function listExitCode(outcomes: readonly SlotOutcome[]): ExitCode {
  if (outcomes.includes("escalated")) return EXIT.escalated;
  if (outcomes.includes("aborted")) return EXIT.aborted;
  return EXIT.ok;
}

/** How big a run of several at once is: how many tasks, and how many at a time. */
const shapeOf = (tasks: number, concurrency: number): string =>
  `${tasks} ${tasks === 1 ? "task" : "tasks"}, up to ${concurrency} at once`;

/** The line a run of several tasks at once opens with. */
export const runShape = (runId: string, tasks: number, concurrency: number): string => `Starting run ${runId}: ${shapeOf(tasks, concurrency)}`;

/** The line a run of several at once that was stopped opens with when it is picked up again. */
export const runPickedUp = (runId: string, tasks: number, concurrency: number): string =>
  `Picking up run ${runId}: ${shapeOf(tasks, concurrency)}`;

/** How a task that was not delivered ended, said once a run of several at once is over. */
export function taskEnded(position: QueuePosition, outcome: SlotOutcome): string {
  const which = positionPhrase(position);
  return outcome === "escalated"
    ? `${which} needs your decision; the rest of the list carried on without it.`
    : `${which} stopped before it finished; the rest of the list carried on without it.`;
}

/** A task a slot has taken from the list: where it sits, the run that already answers for it if any, and the id its run has or will have. */
interface QueueClaim {
  taskDef: TaskDef;
  surfaceId: string;
  position: QueuePosition;
  existing: RunRecord | undefined;
}

/** How a task's run ended, from the exit code its end was reported with. */
const slotOutcome = (exitCode: ExitCode): SlotOutcome =>
  exitCode === EXIT.ok ? "closed" : exitCode === EXIT.escalated ? "escalated" : "aborted";

/**
 * Work through the list, `project.concurrency` tasks at a time, each an
 * ordinary run with its own copy, branch and record. Progress is read from the
 * runs already on disk, afresh at every start, rather than remembered, so an
 * interruption anywhere leaves nothing stale and the next invocation works out
 * afresh what is left: a task with a finished run is passed over, one with a run
 * that stopped part way is picked up, and one with no run at all is started.
 *
 * One at a time (the default), the list waits on a task whose run ended without
 * being delivered, rather than skipping it, and stops there again next time for
 * the same reason; it keeps no record of its own and prints what it always did.
 * Several at once, a task that needs a decision frees its slot for the next one
 * and the rest carry on; the run gets its own id and record, every line says
 * which task it is about, and the end names each task that was not delivered.
 *
 * A run of several at once that was stopped, by Ctrl-C, a kill or the machine going down, is carried on by
 * the next invocation: the same run id and record, at the shape it started with, and each task it had under way
 * picked up from its own record.
 *
 * The agent runtime is checked when the first task actually needs it, and once
 * for the whole list: a list with nothing left to do, or one stopped on a task
 * that is waiting for a person, is a complete answer on a machine that has
 * never signed in, and saying so is more use than asking for a credential.
 */
export async function runQueue(
  tasks: TaskDef[],
  project: ProjectSettings,
  { repoPath }: { repoPath: string },
  ctx: CommandContext,
): Promise<ExitCode> {
  // One promise, not one session: slots that start together share one check rather than racing to make two.
  let session: Promise<SessionEnvironment> | undefined;
  const agent = (): Promise<SessionEnvironment> => (session ??= agentSession(ctx.env));

  const next = async (claimed: readonly QueueClaim[]): Promise<QueueClaim | undefined> => {
    const records = await allRuns(repoPath);
    const position = nextQueueTask(records, tasks, claimed.map((claim) => claim.taskDef));
    const taskDef = position === undefined ? undefined : tasks[position.task - 1];
    if (position === undefined || taskDef === undefined) return undefined;
    const existing = findQueueRun(records, taskDef);
    // A run started a moment ago by another slot may not be on disk yet, so its id counts as taken too.
    const taken = new Set([...records.map((record) => record.runId), ...claimed.map((claim) => claim.surfaceId)]);
    return { taskDef, position, existing, surfaceId: existing?.runId ?? runIdFor(taskIntent(taskDef), new Date(), taken) };
  };

  // A run of several at once that was stopped is carried on, in its own record and at the shape its record
  // says it started with, whatever the setting says now. Each slot is then filled exactly as for a new run:
  // a delivered task is passed over, one that was under way is picked up from its own record, the rest start.
  const unfinished = await unfinishedSupervisedRun(repoPath);
  const concurrency = unfinished?.runFile.header.concurrency ?? project.concurrency;

  if ((await next([])) === undefined) {
    // Every task a stopped run was still to take has been delivered since, so that run is over too.
    if (unfinished) await setRunOutcome(unfinished.dir, { kind: "drained", at: new Date().toISOString() });
    ctx.report.note(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const runId = unfinished?.runFile.header.runId ?? (concurrency > 1 ? supervisedRunId(new Date()) : undefined);

  const drive = async ({ taskDef, surfaceId, position, existing }: QueueClaim): Promise<SlotOutcome> => {
    const report =
      runId === undefined ? ctx.report : ctx.report.forTask({ runId, ordinal: position.task, of: position.of, id: surfaceId });
    const taskCtx: CommandContext = { ...ctx, report };
    // One at a time, a heading frames each task. Several at once, the tag says where it sits and the run's own
    // first line names the task, except for one that already ended, which is named here before it is retold.
    if (runId === undefined) report.note(taskHeading(position, taskIntent(taskDef)));
    else if (existing?.caseFile.outcome) report.note(describeRun(existing));

    const exitCode =
      existing === undefined
        ? await startRun({ repoPath, taskDef, runId: surfaceId, ...project }, await agent(), taskCtx)
        : existing.caseFile.outcome
          ? // What a run that already ended did, said again for whoever is looking at the list today rather than watching that run.
            await reportOutcome(existing.dir, existing.caseFile, taskCtx)
          : await resumeRun(existing, taskCtx, await agent());

    if (runId === undefined && exitCode !== EXIT.ok) report.note(listStopped(position, exitCode));
    return slotOutcome(exitCode);
  };

  let record: { dir: string } | undefined;
  if (unfinished) {
    record = { dir: unfinished.dir };
    ctx.report.note(runPickedUp(unfinished.runFile.header.runId, tasks.length, concurrency));
    ctx.report.run({ runId: unfinished.runFile.header.runId, state: "RESUMED" });
  } else if (runId !== undefined) {
    const dir = supervisedPlace(repoPath, runId);
    await prepareRunDir(repoPath, dir);
    await createRunFile(dir, { runId, repoPath, concurrency, tasks: tasks.length });
    record = { dir };
    ctx.report.note(runShape(runId, tasks.length, concurrency));
    ctx.report.run({ runId, state: "STARTED" });
  }

  const settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });

  if (runId !== undefined) ctx.report.run({ runId, state: "DRAINED" });
  const exitCode = listExitCode(settled.map(({ outcome }) => outcome));
  if (exitCode === EXIT.ok) {
    ctx.report.note(EVERY_TASK_DONE);
  } else if (runId !== undefined) {
    for (const { claim, outcome } of settled.toSorted((a, b) => a.claim.position.task - b.claim.position.task)) {
      if (outcome !== "closed") ctx.report.note(taskEnded(claim.position, outcome));
    }
  }
  return exitCode;
}
