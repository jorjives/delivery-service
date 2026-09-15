import { resolve } from "node:path";
import { createAgentPort } from "../agent-invoke.js";
import { create, load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SurfacePorts } from "../ports.js";
import { agentSession } from "./agent-session.js";
import { loadConfig } from "./config.js";
import { type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { createProgress, paint } from "./output.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import { checkCustomModules, resolveSettings, taskIntent, type RunFlags } from "./settings.js";

export { NO_TASK } from "./settings.js";

/** What `delivery run` was given on the command line: the flags the settings resolver reads, and nothing else. */
export type RunOptions = RunFlags;

/** What a command needs from the process it runs in, passed in so tests can run it in-process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  writeLine(line: string): void;
}

/**
 * `delivery run`: work out what this run should do from the project's config
 * file, the flags and the environment, check the agent can start, then drive one
 * run to its end, one plain-language line per step.
 *
 * Every check that can refuse runs before anything is written, so a refusal
 * leaves the repository exactly as it was.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const { taskDef, gateRef, closerRef, budgets } = await resolveSettings(options, {
    env: ctx.env,
    cwd: ctx.cwd,
    repoPath,
    config,
  });
  await checkCustomModules(gateRef, closerRef, repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.writeLine(UNCOMMITTED_NOTE);

  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir, location } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef }, budgets);
  ctx.writeLine(`Starting run ${runId}: ${intent}`);

  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: resolveCloser(closerRef, repoPath) };
  const progress = createProgress(ctx.writeLine, ctx.colour);
  progress.step("PROVISIONING");
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    progress.step(result.state);
  } while (!result.done);

  const summary = await summariseOutcome(dir, await load(dir));
  ctx.writeLine(paint(ctx.colour, summary.tone, summary.headline));
  for (const line of summary.details) ctx.writeLine(line);
  return summary.exitCode;
}
