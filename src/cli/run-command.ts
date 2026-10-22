import { resolve } from "node:path";
import type { CommandContext } from "./context.js";
import { fenceAtStart, resumeRun, startRun } from "./drive.js";
import { agentSession } from "./agent-session.js";
import { loadConfig, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { queueTasks, runQueue } from "./queue.js";
import { holdingRepo } from "./run-exclusion.js";
import { chooseRun, unfinishedRuns, unfinishedRunFound } from "./runs.js";
import {
  checkCustomModules,
  explicitIntent,
  ignoredNote,
  ignoredSettings,
  MAX_NEEDS_SOURCES,
  resolveProject,
  resolveSettings,
  SOURCES_AND_TASK,
  WORKFLOW_NEEDS_TASK,
  type RunFlags,
} from "./settings.js";
import { taskIntent } from "../task-list.js";
import { closingReport } from "./report-command.js";
import { runIdFor } from "../run-location.js";
import { runSources } from "./sources-run.js";

export { NO_TASK } from "./settings.js";

/** What `delivery run` was given on the command line: the flags the settings resolver reads, and nothing else. */
export type RunOptions = RunFlags;

/**
 * `delivery run`: work down the project's list of tasks, or pick up the run
 * that didn't finish, or start a new one.
 *
 * The project's file is read first, because a list of tasks is the project's
 * own plan for itself and only the file can say there is one. A task named on
 * the command line is something a person is asking for right now, so it wins:
 * it runs on its own and the list is left alone.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);

  // Whatever this run would be, it would drive git in the checkout another run is using, so it holds the repository while it runs.
  return holdingRepo(repoPath, { ifIdle: options.ifIdle === true }, ctx, () => runIn(options, { startDir, repoPath }, ctx));
}

/** The body of `delivery run`, once the repository is found and held. */
async function runIn(options: RunOptions, { startDir, repoPath }: { startDir: string; repoPath: string }, ctx: CommandContext): Promise<ExitCode> {
  if (options.max !== undefined && !options.sources) throw new Refusal(MAX_NEEDS_SOURCES, EXIT.configuration, "max");
  if (options.sources) {
    if (options.task !== undefined || options.taskFile !== undefined || options.workflow !== undefined) {
      throw new Refusal(SOURCES_AND_TASK, EXIT.configuration);
    }
    const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
    return runSources(options, { repoPath, config }, ctx);
  }

  const intent = await explicitIntent(options, ctx.env, ctx.cwd);
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const list = queueTasks(config);
  if (intent === undefined && config.tasks) {
    if (options.workflow !== undefined) throw new Refusal(WORKFLOW_NEEDS_TASK, EXIT.configuration, "workflow");
    const exitCode = await startQueue(options, { repoPath, config }, ctx);
    await closingReport(repoPath, { kind: "list" }, list, ctx, config.notify);
    return exitCode;
  }

  const unfinished = options.fresh ? [] : await unfinishedRuns(repoPath);
  const [mostRecent] = unfinished;
  if (mostRecent) {
    // A task the user typed settles which run they mean without asking; anything
    // else would resume a run they did not name.
    const resuming =
      intent === undefined
        ? await chooseRun(unfinished, ctx)
        : unfinished.find((record) => taskIntent(record.caseFile.header.taskDef) === intent);
    if (!resuming) throw new Refusal(unfinishedRunFound(mostRecent), EXIT.configuration);
    const ignored = ignoredSettings(options, ctx.env, resuming.caseFile.header);
    if (ignored.length > 0) ctx.report.note(ignoredNote(ignored));
    const exitCode = await resumeRun(resuming, ctx);
    await closingReport(repoPath, { kind: "task", runId: resuming.runId }, list, ctx, config.notify);
    return exitCode;
  }
  return startOne(options, { repoPath, intent, config }, ctx);
}

/**
 * Work down the project's list. What the whole list shares is settled once
 * here — the check, the closing action, the limits, the description, and the
 * modules those name — and the list itself decides when an agent is first
 * needed, so a list with nothing left to do answers without one.
 */
async function startQueue(
  options: RunOptions,
  { repoPath, config }: { repoPath: string; config: DeliveryConfig },
  ctx: CommandContext,
): Promise<ExitCode> {
  const project = await resolveProject(options, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  return runQueue(queueTasks(config), project, { repoPath }, ctx);
}

/** Start one run: work out what it should do from the project's config file, the flags and the environment, check the agent can start, then drive it. */
async function startOne(
  options: RunOptions,
  { repoPath, intent, config }: { repoPath: string; intent: string | undefined; config: DeliveryConfig },
  ctx: CommandContext,
): Promise<ExitCode> {
  const settings = await resolveSettings(options, { env: ctx.env, intent, repoPath, config });
  await checkCustomModules(settings.gateRef, settings.closerRef, repoPath, settings.workflow);
  const session = await agentSession(ctx.env);
  const fenceRecord = await fenceAtStart(settings.fence, repoPath, ctx);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  // The id is chosen here rather than left to `startRun`, so the report at the end knows which run to tell.
  const runId = runIdFor(taskIntent(settings.taskDef), new Date());
  const exitCode = await startRun({ repoPath, ...settings, runId, fenceRecord }, session, ctx);
  await closingReport(repoPath, { kind: "task", runId }, queueTasks(config), ctx, config.notify);
  return exitCode;
}
