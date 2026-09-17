import { isDeepStrictEqual } from "node:util";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { TaskDef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { resumeRun, startRun } from "./drive.js";
import { EXIT, type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { allRuns, newestFirst, type RunRecord } from "./runs.js";
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

/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}

/** Which task of how many this is, in the owner's own words, around the step lines a single run already prints. */
export const taskHeading = (position: QueuePosition, intent: string): string =>
  `Task ${position.task} of ${position.of}: ${intent}`;

export const EVERY_TASK_DONE =
  "Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.";

/**
 * Why the rest of the list was left alone. The harness never decides on the
 * owner's behalf that a later task matters more than a decision this one is
 * waiting for, so there is no skipping: the way past a stopped task is to deal
 * with it, or to reword the entry.
 */
export function listStopped(position: QueuePosition, exitCode: ExitCode): string {
  const which = `Task ${position.task} of ${position.of}`;
  return exitCode === EXIT.escalated
    ? `${which} needs your decision before I can go on, so I've left the rest of the list alone.`
    : `${which} stopped before it finished, so I've left the rest of the list alone.`;
}

/** What a run that already ended did, said again for whoever is looking at the list today rather than watching that run. */
async function retell(record: RunRecord, ctx: CommandContext): Promise<ExitCode> {
  const summary = await summariseOutcome(record.dir, record.caseFile);
  ctx.report.outcome(summary);
  return summary.exitCode;
}

/**
 * Work down the list, one ordinary run at a time. Progress is read from the
 * runs already on disk rather than remembered, so an interruption anywhere
 * leaves nothing stale and the next invocation works out afresh what is left:
 * a task with a finished run is passed over, one with a run that stopped part
 * way is picked up, and one with no run at all is started.
 *
 * A task whose run ended without being delivered stops the list where it is,
 * rather than being skipped, and stops it again next time for the same reason.
 * Only the runs that existed when this invocation began are considered: the
 * list holds no two entries that mean the same task, so a run started for one
 * entry can never answer for another.
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
  const records = await allRuns(repoPath);
  let session: SessionEnvironment | undefined;
  const agent = async (): Promise<SessionEnvironment> => {
    session ??= await agentSession(ctx.env);
    return session;
  };

  for (const [index, taskDef] of tasks.entries()) {
    const existing = findQueueRun(records, taskDef);
    if (existing?.caseFile.outcome?.kind === "closed") continue;

    const position: QueuePosition = { task: index + 1, of: tasks.length };
    ctx.report.note(taskHeading(position, taskIntent(taskDef)));
    const exitCode =
      existing === undefined
        ? await startRun({ repoPath, taskDef, ...project }, await agent(), ctx)
        : existing.caseFile.outcome
          ? await retell(existing, ctx)
          : await resumeRun(existing, ctx, await agent());

    if (exitCode !== EXIT.ok) {
      ctx.report.note(listStopped(position, exitCode));
      return exitCode;
    }
  }

  ctx.report.note(EVERY_TASK_DONE);
  return EXIT.ok;
}
