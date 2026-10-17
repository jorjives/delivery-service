import { createAgentPort, DEFAULT_ROLES } from "../agent-invoke.js";
import { create, load, appendEntry } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { createMergeBackCloser } from "../merge-back-closer.js";
import { deterministicRouter } from "../router.js";
import { advance, worktreeOf, type AdvanceResult } from "../surface.js";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { SurfacePorts } from "../ports.js";
import type { Continues, FenceRecord, PinnedWorkflow, TaskDef, WorkItemRef } from "../schema.js";
import { captureRepair, checkFilesOf } from "../repair-changes.js";
import type { RepairOutcome } from "../breaker.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { reportOutcome } from "./outcome.js";
import { pickingUp } from "./output.js";
import { prepareRunDir, runIdFor, runPlace } from "../run-location.js";
import { gateDigestOf } from "../run-gate.js";
import { judgedRepair } from "../repair-guards.js";
import type { RunRecord } from "../run-records.js";
import { taskIntent } from "../task-list.js";
import { checkCustomModules, DEFAULT_CLOSER, type ProjectSettings } from "./settings.js";
import { bwrapOf, fenceOf, fencePaths, probeFence, type FenceSetting } from "../fence.js";
import { containedSession } from "../containment.js";
import { pullRequestFinder } from "../landed-outside.js";

/** A run about to exist: what it is being asked to do, and everything its project asks of every run. */
export interface RunStart extends ProjectSettings {
  repoPath: string;
  taskDef: TaskDef;
  /** The id to give the run, when whoever starts it has already chosen one; otherwise one is made from the task and the second it started. */
  runId?: string;
  /** The fence probed for this run before it started; absent for a caller that started none. */
  fenceRecord?: FenceRecord;
  /** The workflow to do the task in, already pinned; absent for a run in one step. */
  workflow?: PinnedWorkflow;
  /** The work-source item this run delivers, for --sources runs. */
  item?: WorkItemRef;
  /** The earlier run whose work this run carries on, in that run's working copy. */
  continues?: Continues;
  /** The delivery branch the run starts from and lands on, for --sources runs. */
  delivery?: { branch: string };
}

/** Said before a run starts on a machine where the fence cannot be had. Word for word as the design gives it. */
export const FENCE_ABSENT = "Your main folder is not protected on this machine. Commit or save your work before the run starts.";

const fenceRequired = (reason: string): string =>
  `I can't start: your main folder can't be protected on this machine (${reason}), and \`fence\` is "required" in your configuration. ` +
  'Set it to "preferred" to run without it.';

const fenceLost = (reason: string): string =>
  `I can't carry on this run: it started with your main folder protected, and that protection is not available now (${reason}). ` +
  "Carry it on where it started, or start the task again.";

/**
 * The fence a run starts with, probed once before its first session. Absent and preferred: the run goes ahead,
 * saying so first. Absent and required: a setup refusal. Off: not probed.
 */
export async function fenceAtStart(setting: FenceSetting | undefined, repoPath: string, ctx: CommandContext): Promise<FenceRecord> {
  const { mode, devices } = fenceOf(setting);
  if (mode === "off") return { mode, devices, state: { present: false, reason: "turned off in your configuration" } };
  const state = await probeFence(bwrapOf(ctx.env), await fencePaths(repoPath, undefined, devices), ctx.env);
  if (!state.present) {
    if (mode === "required") throw new Refusal(fenceRequired(state.reason ?? "unknown"), EXIT.configuration, "fence");
    ctx.report.note(FENCE_ABSENT);
  }
  return { mode, devices, state };
}

/**
 * Start one run and drive it to its end: give it an id from its own words and
 * the second it began, write its record, and say so before the first step,
 * because setting up is the slowest part and a person watching should not wait
 * in silence for it. Everything that can refuse — the check, the closing
 * action, the agent runtime — has already refused by the time this is called,
 * so from here on there is a record on disk for whatever happens next.
 */
export async function startRun(
  { repoPath, taskDef, gateRef, closerRef, budgets, domainPrompt, agent, runId: chosenId, fenceRecord, workflow, item, continues, delivery }: RunStart,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
  const intent = taskIntent(taskDef);
  const runId = chosenId ?? runIdFor(intent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const gateDigest = await gateDigestOf(gateRef, repoPath);
  const caseFile = await create(
    dir,
    {
      surfaceId: runId,
      taskDef,
      gateRef,
      closerRef,
      domainPrompt,
      agent,
      ...(gateDigest === undefined ? {} : { gateDigest }),
      ...(fenceRecord === undefined ? {} : { fence: fenceRecord }),
      ...(workflow === undefined ? {} : { workflow }),
      ...(item === undefined ? {} : { item }),
      ...(continues === undefined ? {} : { continues }),
      ...(delivery === undefined ? {} : { delivery }),
    },
    budgets,
  );
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
  const own = runPlace(repoPath, runId, ctx.env).location;
  const location = { repoPath, worktreePath: worktreeOf(record.caseFile, own) };
  const contained = await containedSession({ ...session, agent: header.agent }, { header, repoPath, dir, worktreePath: location.worktreePath, env: ctx.env });
  const agent = createAgentPort(DEFAULT_ROLES, contained);
  const ports: SurfacePorts = {
    agent,
    triage: deterministicRouter,
    // A task on a delivery branch lands there by merge-back; the project's closer acts once per run, on the branch (spec §5.7).
    closer: header.delivery === undefined ? resolveCloser(header.closerRef ?? DEFAULT_CLOSER, repoPath) : createMergeBackCloser(),
    env: ctx.env,
    landed: pullRequestFinder(repoPath),
    ...(ctx.repairCoordinator === undefined ? {} : { repairCoordinator: ctx.repairCoordinator }),
  };

  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    ctx.report.step(result);
  } while (!result.done);

  return reportOutcome(dir, await load(dir), ctx);
}

/**
 * One repair of the environment every task of a run shares: the existing
 * gate-maintenance role, run in the copy and against the record of the task
 * that found it broken, with that task's own agent options. Nothing about
 * what the repair may touch changes because the run asked, and what it
 * changed in that copy, captured as a task's own repair is.
 */
export async function dispatchRepair(record: RunRecord, sessionKey: string, session: SessionEnvironment, env: NodeJS.ProcessEnv): Promise<RepairOutcome> {
  const { location } = runPlace(record.repoPath, record.runId, env);
  const worktreePath = worktreeOf(record.caseFile, location);
  const contained = await containedSession(
    { ...session, agent: record.caseFile.header.agent },
    { header: record.caseFile.header, repoPath: record.repoPath, dir: record.dir, worktreePath, env },
  );
  const agent = createAgentPort(DEFAULT_ROLES, contained);
  const { result: judged, verdict } = await judgedRepair(
    worktreePath,
    { header: record.caseFile.header, repoPath: record.repoPath, history: record.caseFile.history },
    () =>
      captureRepair(
        worktreePath,
        checkFilesOf(record.caseFile.header.gateRef, { repoPath: record.repoPath, worktreePath }),
        () => agent.invoke({ role: "gate-maintenance" }, { worktreePath, dir: record.dir, sessionKey }),
      ),
  );
  const { result: ended, changes } = judged;
  if (verdict.refused === null && Object.keys(verdict.accepted).length > 0) {
    await appendEntry(record.dir, { t: "repair_accepted", sessionKey, settings: verdict.accepted });
  }
  const terminus = verdict.refused === null ? ended : { status: "escalate" as const, category: "authority" as const, rationale: verdict.refused, ...(ended.usage === undefined ? {} : { usage: ended.usage }) };
  return { terminus, ...(changes === undefined ? {} : { changes }) };
}

export async function resumeRun(record: RunRecord, ctx: CommandContext, session?: SessionEnvironment): Promise<ExitCode> {
  const { header } = record.caseFile;
  await checkCustomModules(header.gateRef, header.closerRef ?? DEFAULT_CLOSER, record.repoPath);
  // A run that started inside the fence never carries on outside it.
  if (header.fence?.state.present === true) {
    const now = await probeFence(bwrapOf(ctx.env), await fencePaths(record.repoPath, undefined, header.fence.devices), ctx.env);
    if (!now.present) throw new Refusal(fenceLost(now.reason ?? "unknown"), EXIT.configuration, "fence");
  }
  const started = session ?? (await agentSession(ctx.env));
  ctx.report.note(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.report.note(pickingUp(record.caseFile));
  return driveToOutcome(record, started, ctx);
}
