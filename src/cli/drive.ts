import { createAgentPort } from "../agent-invoke.js";
import { load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { SurfacePorts } from "../ports.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { pickingUp } from "./output.js";
import { runPlace } from "./run-location.js";
import type { RunRecord } from "./runs.js";
import { checkCustomModules, DEFAULT_CLOSER, taskIntent } from "./settings.js";

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
  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
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

  const summary = await summariseOutcome(dir, await load(dir));
  ctx.report.outcome(summary);
  return summary.exitCode;
}

/**
 * Pick a run up where it stopped. It keeps the task, the check and the closing
 * action it started with, so nothing here is resolved again; the custom modules
 * those settings name are loaded first, so a module that has since been moved
 * stops the command rather than becoming a setback mid-run.
 */
export async function resumeRun(record: RunRecord, ctx: CommandContext): Promise<ExitCode> {
  const { header } = record.caseFile;
  await checkCustomModules(header.gateRef, header.closerRef ?? DEFAULT_CLOSER, record.repoPath);
  const session = await agentSession(ctx.env);
  ctx.report.note(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.report.note(pickingUp(record.caseFile));
  return driveToOutcome(record, session, ctx);
}
