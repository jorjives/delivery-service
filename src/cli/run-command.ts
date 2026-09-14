import { resolve } from "node:path";
import { createAgentPort } from "../agent-invoke.js";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SurfacePorts } from "../ports.js";
import type { CloserRef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { createProgress, paint } from "./output.js";
import { findRepository, hasUncommittedChanges, inferGate, UNCOMMITTED_NOTE } from "./project.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";

export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';

/** The one closer a run uses when nothing else is configured: it needs only git, and leaves a branch to inspect before trusting it. */
const DEFAULT_CLOSER: CloserRef = { type: "commit-to-branch" };

/** What `delivery run` was given on the command line. */
export interface RunOptions {
  task?: string;
  repo?: string;
}

/** What a command needs from the process it runs in, passed in so tests can run it in-process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  writeLine(line: string): void;
}

/**
 * `delivery run`: resolve the defaults, check the agent can start, then drive
 * one run to its end, one plain-language line per step.
 *
 * Every check that can refuse runs before anything is written, so a refusal
 * leaves the repository exactly as it was.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const intent = options.task?.trim();
  if (!intent) throw new Refusal(NO_TASK, EXIT.configuration);
  const gateRef = await inferGate(repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.writeLine(UNCOMMITTED_NOTE);

  const runId = runIdFor(intent, new Date());
  const { dir, location } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  await create(dir, { surfaceId: runId, taskDef: { intent }, gateRef, closerRef: DEFAULT_CLOSER }, DEFAULT_BUDGETS);
  ctx.writeLine(`Starting run ${runId}: ${intent}`);

  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: resolveCloser(DEFAULT_CLOSER, repoPath) };
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
