import { resolve } from "node:path";
import { create } from "../case-file.js";
import type { CommandContext } from "./context.js";
import { driveToOutcome, resumeRun } from "./drive.js";
import { agentSession } from "./agent-session.js";
import { loadConfig } from "./config.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import { chooseRun, unfinishedRuns, unfinishedRunFound } from "./runs.js";
import { checkCustomModules, explicitIntent, ignoredNote, ignoredSettings, resolveSettings, taskIntent, type RunFlags } from "./settings.js";

export { NO_TASK } from "./settings.js";

/** What `delivery run` was given on the command line: the flags the settings resolver reads, and nothing else. */
export type RunOptions = RunFlags;

/**
 * `delivery run`: pick up the run that didn't finish, or start a new one.
 *
 * Discovery comes first, because a run that is already under way settles what
 * this invocation is for: its settings are pinned in its own record, so the
 * config file, the flags and the defaults are only resolved on the way to a
 * new run.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const unfinished = options.fresh ? [] : await unfinishedRuns(repoPath);
  const intent = await explicitIntent(options, ctx.env, ctx.cwd);
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
    return resumeRun(resuming, ctx);
  }
  return startRun(options, { startDir, repoPath, intent }, ctx);
}

/** Start a run: work out what it should do from the project's config file, the flags and the environment, check the agent can start, then drive it. */
async function startRun(
  options: RunOptions,
  { startDir, repoPath, intent }: { startDir: string; repoPath: string; intent: string | undefined },
  ctx: CommandContext,
): Promise<ExitCode> {
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const { taskDef, gateRef, closerRef, budgets } = await resolveSettings(options, {
    env: ctx.env,
    intent,
    repoPath,
    config,
  });
  await checkCustomModules(gateRef, closerRef, repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);

  const resolvedIntent = taskIntent(taskDef);
  const runId = runIdFor(resolvedIntent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef }, budgets);
  ctx.report.note(`Starting run ${runId}: ${resolvedIntent}`);

  // Said before the first advance, because provisioning is the slowest step and
  // a person watching should not wait in silence for it.
  ctx.report.step({ state: "PROVISIONING", done: false });
  return driveToOutcome({ runId, repoPath, dir, caseFile }, session, ctx);
}
