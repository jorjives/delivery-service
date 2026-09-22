import { createAgentPort } from "../agent-invoke.js";
import { create, load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { RoleConfigs, SessionEnvironment } from "../agent-invoke.js";
import type { SurfacePorts } from "../ports.js";
import type { TaskDef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { type ExitCode } from "./failures.js";
import { reportOutcome } from "./outcome.js";
import { pickingUp } from "./output.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import type { RunRecord } from "./runs.js";
import { checkCustomModules, DEFAULT_CLOSER, taskIntent, type ProjectSettings } from "./settings.js";

/** A run about to exist: what it is being asked to do, and everything its project asks of every run. */
export interface RunStart extends ProjectSettings {
  repoPath: string;
  taskDef: TaskDef;
}

/**
 * The roles every run from the command line is given. One object, so what
 * `delivery preview` shows an agent will be told is what a run tells it.
 */
export const RUN_ROLES: RoleConfigs = {
  worker: workerRoleConfig,
  "gate-maintenance": gateMaintenanceRoleConfig,
  triage: triageRoleConfig,
};

/**
 * Start one run and drive it to its end: give it an id from its own words and
 * the second it began, write its record, and say so before the first step,
 * because setting up is the slowest part and a person watching should not wait
 * in silence for it. Everything that can refuse — the check, the closing
 * action, the agent runtime — has already refused by the time this is called,
 * so from here on there is a record on disk for whatever happens next.
 */
export async function startRun(
  { repoPath, taskDef, gateRef, closerRef, budgets, domainPrompt }: RunStart,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef, domainPrompt }, budgets);
  ctx.report.note(`Starting run ${runId}: ${intent}`);
  ctx.report.step({ state: "PROVISIONING", done: false });
  return driveToOutcome({ runId, repoPath, dir, caseFile }, session, ctx);
}

/**
 * Drive one run to its end, whether it was created a moment ago or left behind
 * by a process that was killed: the wiring is the same, and the settings come
 * from the run's own record, never from this invocation. One plain-language
 * line per step, then what the run did.
 *
 * The working copy's path is recomputed from the repository and the run id
 * rather than stored, so a resumed run finds the same place; once a run has
 * been set up, the library prefers the copy it already made.
 */
export async function driveToOutcome(
  record: RunRecord,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
  const { dir, repoPath, runId } = record;
  const { header } = record.caseFile;
  const { location } = runPlace(repoPath, runId, ctx.env);
  const agent = createAgentPort(RUN_ROLES, session);
  const ports: SurfacePorts = {
    agent,
    triage: deterministicRouter,
    closer: resolveCloser(header.closerRef ?? DEFAULT_CLOSER, repoPath),
  };

  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    ctx.report.step(result);
  } while (!result.done);

  return reportOutcome(dir, await load(dir), ctx);
}

export async function resumeRun(record: RunRecord, ctx: CommandContext, session?: SessionEnvironment): Promise<ExitCode> {
  const { header } = record.caseFile;
  await checkCustomModules(header.gateRef, header.closerRef ?? DEFAULT_CLOSER, record.repoPath);
  const started = session ?? (await agentSession(ctx.env));
  ctx.report.note(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.report.note(pickingUp(record.caseFile));
  return driveToOutcome(record, started, ctx);
}
