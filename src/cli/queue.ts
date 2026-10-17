import type { SessionEnvironment } from "../agent-invoke.js";
import type { FenceRecord, RunHeader, SlotOutcome, TaskDef, UsageLimit } from "../schema.js";
import { USAGE_LIMIT_WORDS } from "../ports.js";
import { createRunBreaker, repairsUsed, tripsOf, type RunBreaker } from "../breaker.js";
import { RunHalted } from "../errors.js";
import { supervise, type Settled } from "../supervisor.js";
import { createRunFile, loadRunFile, setRunOutcome } from "../run-file.js";
import { agentSession } from "./agent-session.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { dispatchRepair, fenceAtStart, resumeRun, startRun, type RunStart } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { reportOutcome } from "./outcome.js";
import { prepareRunDir, runIdFor, supervisedPlace, supervisedRunId } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import { findQueueRun, stillToTake, taskIntent, type QueuePosition } from "../task-list.js";
import { allRuns, describeRun, readRun, startedAt, unfinishedSupervisedRun } from "./runs.js";
import { repoLocked, takeRepoLock } from "../repo-lock.js";
import type { ProjectSettings } from "./settings.js";

/** Everything this project's list asks for, in the order it was written. */
export function queueTasks(config: DeliveryConfig): TaskDef[] {
  return (config.tasks ?? []).map(structureTask);
}

/**
 * The task `delivery run` would act on next: the first one on the list whose
 * run has not been delivered and that no slot has already taken in this run,
 * counted as "Task N of M" counts. Nothing when no task is left. The same rule
 * `runQueue` fills each slot by, so what `delivery preview` calls next is what a run
 * does next.
 */
export function nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: readonly TaskDef[] = []): QueuePosition | undefined {
  const index = tasks.findIndex((taskDef) => stillToTake(records, taskDef, claimed));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}

/** "Task N of M", as every line naming a task's place in the list starts. */
const positionPhrase = (position: QueuePosition): string => `Task ${position.task} of ${position.of}`;

/** Which task of how many this is, in the owner's own words, around the step lines a single run already prints. */
export const taskHeading = (position: QueuePosition, intent: string): string => `${positionPhrase(position)}: ${intent}`;

export const EVERY_TASK_DONE =
  "Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.";

export const STOPPED_PART_WAY =
  "Stopped before every task finished. Type `delivery run` again in this folder to carry on from where each task got to.";

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

/** How the tasks on the list stand when a run stops: a run under way, a run that ended, or none yet. */
export interface ListStandings {
  waiting: number;
  finished: number;
  queued: number;
}

export function listStandings(records: RunRecord[], tasks: TaskDef[]): ListStandings {
  const standings: ListStandings = { waiting: 0, finished: 0, queued: 0 };
  for (const taskDef of tasks) {
    const record = findQueueRun(records, taskDef);
    if (record === undefined) standings.queued += 1;
    else if (record.caseFile.outcome === undefined) standings.waiting += 1;
    else standings.finished += 1;
  }
  return standings;
}

/** What a run of several at once says when it gives up on the environment its tasks share, or when a usage limit stops its repair. */
export function environmentGaveUp(attempts: number, { waiting, finished, queued }: ListStandings, of: number, limit: UsageLimit | null = null): string {
  const tries = `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
  const opening = limit === null ? `Couldn't fix it after ${tries}.` : `The repair could not run because ${USAGE_LIMIT_WORDS[limit]}.`;
  const were = waiting === 1 ? "was waiting on this and needs" : "were waiting on this and need";
  const is = queued === 1 ? "is" : "are";
  return `${opening} Stopping the run. ${waiting} of ${of} tasks ${were} your attention; ${finished} had already finished, ${queued} ${is} still queued.`;
}

/** How big a run of several at once is: how many tasks, and how many at a time. */
export const shapeOf = (tasks: number, concurrency: number): string =>
  `${tasks} ${tasks === 1 ? "task" : "tasks"}, up to ${concurrency} at once`;

/** The line a run of several tasks at once opens with. */
export const runShape = (runId: string, tasks: number, concurrency: number): string => `Starting run ${runId}: ${shapeOf(tasks, concurrency)}`;

/** The line a run of several at once that was stopped opens with when it is picked up again. */
export const runPickedUp = (runId: string, tasks: number, concurrency: number): string =>
  `Picking up run ${runId}: ${shapeOf(tasks, concurrency)}`;

/**
 * Why a run cannot start: a run of several at once is already going in this
 * repository, and which one, so the owner can look at it rather than start a
 * second that would fight it over the same checkout. `live` is that run's
 * header, when its record can be found.
 */
export function liveRunFound(live: RunHeader | undefined): string {
  const which = live === undefined ? "" : ` (started \`${startedAt(live.runId)}\`, ${shapeOf(live.tasks, live.concurrency)}: \`${live.runId}\`)`;
  return `Another run is already going here${which}. Run \`delivery status\` to see how it is getting on, or wait for it to finish before starting another.`;
}

/** Refuse to go on while a run of several at once holds this repository. Every command that drives a run asks this first. */
export async function refuseIfRunGoing(repoPath: string): Promise<void> {
  if (await repoLocked(repoPath)) {
    throw new Refusal(liveRunFound((await unfinishedSupervisedRun(repoPath))?.runFile.header), EXIT.configuration);
  }
}

/** How a task that was not delivered ended, said once a run of several at once is over. */
export function taskEnded(position: QueuePosition, outcome: SlotOutcome): string {
  const which = positionPhrase(position);
  return outcome === "escalated"
    ? `${which} needs your decision; the rest of the list carried on without it.`
    : `${which} stopped before it finished; the rest of the list carried on without it.`;
}

/** A task a slot has taken from the list: where it sits, the run that already answers for it if any, and the id its run has or will have. */
export interface QueueClaim {
  taskDef: TaskDef;
  surfaceId: string;
  position: QueuePosition;
  existing: RunRecord | undefined;
  /** What a run started for this claim pins besides the task: its workflow, work item and carried-on work. */
  start?: Pick<RunStart, "workflow" | "item" | "continues">;
}

/** Where a run's work comes from when it is not the project's list. `next` must not consume: it is asked again with what is claimed. */
export interface ClaimSource {
  next(claimed: readonly QueueClaim[]): Promise<QueueClaim | undefined>;
  /** Called just before a claim's new run is created: the commit point for anything recorded about it. */
  starting?(claim: QueueClaim): Promise<void>;
  /** Called once a claim's run has ended (not when the command is stopped part way). */
  ended?(claim: QueueClaim, outcome: SlotOutcome): Promise<void>;
}

/** How a task's run ended, from the exit code its end was reported with. */
const slotOutcome = (exitCode: ExitCode): SlotOutcome =>
  exitCode === EXIT.ok ? "closed" : exitCode === EXIT.escalated ? "escalated" : "aborted";

/**
 * End a run that gave up on its shared environment, or whose repair a usage limit stopped: write its outcome, naming which was the cause,
 * say how the list stands, and exit needing a decision. The held tasks keep no outcome of their own, so the next
 * `delivery run` picks them up.
 */
async function stopForEnvironment(repoPath: string, dir: string, runId: string, tasks: TaskDef[], ctx: CommandContext): Promise<ExitCode> {
  const { history } = await loadRunFile(dir);
  const trip = tripsOf(history).at(-1);
  const reason = trip?.reason ?? "the shared environment could not be repaired; no task caused this";
  const limit = trip?.limit ?? null;
  await setRunOutcome(dir, { kind: "escalated", cause: limit === null ? "shared_environment" : "usage_limit", reason, at: new Date().toISOString() });
  ctx.report.note(environmentGaveUp(repairsUsed(history), listStandings(await allRuns(repoPath), tasks), tasks.length, limit));
  ctx.report.run({ runId, state: "ESCALATED", affected: trip?.held ?? [] });
  return EXIT.escalated;
}

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
 *
 * `carryOn` is for a list the harness wrote itself (`delivery fix`): a task that is not delivered
 * never stops the rest, even one at a time, and the list ends without asking the owner to add to it.
 * `skip` is the same list's precondition: asked as each not-yet-started task is about to start, so
 * a task made pointless by an earlier one in the same pass is passed over without spending an agent session.
 */
export async function runQueue(
  tasks: TaskDef[],
  project: ProjectSettings,
  {
    repoPath,
    carryOn = false,
    skip,
    claims,
  }: { repoPath: string; carryOn?: boolean; skip?: (task: TaskDef) => Promise<boolean>; claims?: ClaimSource },
  ctx: CommandContext,
): Promise<ExitCode> {
  // One promise, not one session: slots that start together share one check rather than racing to make two.
  let session: Promise<SessionEnvironment> | undefined;
  const agent = (): Promise<SessionEnvironment> => (session ??= agentSession(ctx.env));

  // Probed once for the whole list, when the first task starts, so its warning is said once.
  let fenced: Promise<FenceRecord> | undefined;
  const fence = (): Promise<FenceRecord> => (fenced ??= fenceAtStart(project.fence, repoPath, ctx));

  // A run of several at once that was stopped is carried on, in its own record and at the shape its record
  // says it started with, whatever the setting says now. Each slot is then filled exactly as for a new run:
  // a delivered task is passed over, one that was under way is picked up from its own record, the rest start.
  let unfinished = await unfinishedSupervisedRun(repoPath);
  const concurrency = unfinished?.runFile.header.concurrency ?? project.concurrency;

  // A run of several at once holds the repository for as long as it runs, so a second cannot start on top of it.
  // One at a time takes no lock: every command has already refused to start while one is held.
  let release: (() => Promise<void>) | undefined;
  if (concurrency > 1) {
    release = await takeRepoLock(repoPath);
    if (release === undefined) throw new Refusal(liveRunFound(unfinished?.runFile.header), EXIT.configuration);
  }
  try {
    // A run that gave up on its environment but was stopped before it could say so ends now, then a new run picks up the held tasks.
    if (unfinished?.runFile.history.some((entry) => entry.t === "run_escalated")) {
      await stopForEnvironment(repoPath, unfinished.dir, unfinished.runFile.header.runId, tasks, ctx);
      unfinished = undefined; // Clear so a new run can start
    }

    let breaker: RunBreaker | undefined;
    // Tasks the list's own precondition passed over in this invocation: never claimed, never asked about again.
    const passedOver: TaskDef[] = [];
    const next = async (claimed: readonly QueueClaim[]): Promise<QueueClaim | undefined> => {
      if (breaker?.gaveUp !== undefined) return undefined;
      if (claims !== undefined) return claims.next(claimed);
      for (;;) {
        const records = await allRuns(repoPath);
        const position = nextQueueTask(records, tasks, [...claimed.map((claim) => claim.taskDef), ...passedOver]);
        const taskDef = position === undefined ? undefined : tasks[position.task - 1];
        if (position === undefined || taskDef === undefined) return undefined;
        const existing = findQueueRun(records, taskDef);
        // A task with no run yet is asked, just before it would start, whether it still needs doing.
        if (existing === undefined && (await skip?.(taskDef))) {
          passedOver.push(taskDef);
          continue;
        }
        // A run started a moment ago by another slot may not be on disk yet, so its id counts as taken too.
        const taken = new Set([...records.map((record) => record.runId), ...claimed.map((claim) => claim.surfaceId)]);
        return { taskDef, position, existing, surfaceId: existing?.runId ?? runIdFor(taskIntent(taskDef), new Date(), taken) };
      }
    };

    if ((await next([])) === undefined) {
      // Every task a stopped run was still to take has been delivered since, so that run is over too.
      if (unfinished) await setRunOutcome(unfinished.dir, { kind: "drained", at: new Date().toISOString() });
      if (!carryOn) ctx.report.note(EVERY_TASK_DONE);
      return EXIT.ok;
    }

    const runId = unfinished?.runFile.header.runId ?? (concurrency > 1 ? supervisedRunId(new Date()) : undefined);

    let record: { dir: string } | undefined;
    if (unfinished) {
      record = { dir: unfinished.dir };
      ctx.report.note(runPickedUp(unfinished.runFile.header.runId, tasks.length, concurrency));
      ctx.report.run({ runId: unfinished.runFile.header.runId, state: "RESUMED" });
    } else if (runId !== undefined) {
      const dir = supervisedPlace(repoPath, runId);
      await prepareRunDir(repoPath, dir);
      await createRunFile(dir, { runId, repoPath, concurrency, tasks: tasks.length, runBudgetMax: { gateMaintenance: project.budgets.gateMaintenance.max } });
      record = { dir };
      ctx.report.note(runShape(runId, tasks.length, concurrency));
      ctx.report.run({ runId, state: "STARTED" });
    }

    if (record !== undefined && runId !== undefined) {
      breaker = createRunBreaker({
        dir: record.dir,
        history: unfinished?.runFile.history ?? [],
        limit: unfinished?.runFile.header.runBudgetMax.gateMaintenance ?? project.budgets.gateMaintenance.max,
        dispatch: async (surfaceId, sessionKey) => dispatchRepair(await readRun(repoPath, surfaceId), sessionKey, await agent(), ctx.env),
        onChange: (change) => ctx.report.run({ runId, ...change }),
      });
    }

    const drive = async (claim: QueueClaim): Promise<SlotOutcome> => {
      const { taskDef, surfaceId, position, existing } = claim;
      const report =
        runId === undefined ? ctx.report : ctx.report.forTask({ runId, ordinal: position.task, of: position.of, id: surfaceId });
      const taskCtx: CommandContext = { ...ctx, report, ...(breaker === undefined ? {} : { repairCoordinator: breaker }) };
      // One at a time, a heading frames each task. Several at once, the tag says where it sits and the run's own
      // first line names the task, except for one that already ended, which is named here before it is retold.
      if (runId === undefined) report.note(taskHeading(position, taskIntent(taskDef)));
      else if (existing?.caseFile.outcome) report.note(describeRun(existing));

      const exitCode =
        existing === undefined
          ? await (async () => {
              await claims?.starting?.(claim);
              return startRun({ repoPath, taskDef, runId: surfaceId, ...project, ...claim.start, fenceRecord: await fence() }, await agent(), taskCtx);
            })()
          : existing.caseFile.outcome
            ? // What a run that already ended did, said again for whoever is looking at the list today rather than watching that run.
              await reportOutcome(existing.dir, existing.caseFile, taskCtx)
            : await resumeRun(existing, taskCtx, await agent());

      if (runId === undefined && !carryOn && exitCode !== EXIT.ok) report.note(listStopped(position, exitCode));
      const outcome = slotOutcome(exitCode);
      await claims?.ended?.(claim, outcome);
      return outcome;
    };

    // With several at once, a stop ends the command immediately with the stopped code. Immediately, because Ctrl-C
    // reaches the agents and checks too, and whatever they reported while shutting down would otherwise be written
    // into the tasks' records as though it had really happened. Leaving each record exactly as a crash would is
    // safe: the next run already knows how to pick that up. The lock is released with the process. With one at a
    // time, a stop ends the command as it always has.
    const disarm = runId === undefined ? undefined : ctx.exitOnInterrupt?.(EXIT.aborted, STOPPED_PART_WAY);
    let settled: Settled<QueueClaim>[];
    try {
      settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined && !carryOn, record });
    } catch (err) {
      // A task stopped at its next check or hand-off because the run gave up on the shared environment.
      if (err instanceof RunHalted && record !== undefined && runId !== undefined) {
        return await stopForEnvironment(repoPath, record.dir, runId, tasks, ctx);
      }
      throw err;
    } finally {
      disarm?.();
    }

    if (runId !== undefined) ctx.report.run({ runId, state: "DRAINED" });
    const exitCode = listExitCode(settled.map(({ outcome }) => outcome));
    if (exitCode === EXIT.ok) {
      if (!carryOn) ctx.report.note(EVERY_TASK_DONE);
    } else if (runId !== undefined || carryOn) {
      for (const { claim, outcome } of settled.toSorted((a, b) => a.claim.position.task - b.claim.position.task)) {
        if (outcome !== "closed") ctx.report.note(taskEnded(claim.position, outcome));
      }
    }
    return exitCode;
  } finally {
    await release?.();
  }
}
