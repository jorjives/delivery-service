import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoleConfigs } from "./agent-invoke.js";
import type { MockScript } from "./mock-script.js";
import type { AgentPort, TriagePort } from "./ports.js";
import type { BudgetSet, CloserRef, CreateHeader, SlotOutcome } from "./schema.js";
import { runSurfaceAgainstMock, type ScriptedSurfaceResult } from "./scripted-surface-run.js";
import { supervise, type Claim } from "./supervisor.js";

/** One task in a scripted run of several: what it is, and what its own agent does. */
export interface ScriptedTask {
  /** The task, with the gate and closer named as data. `surfaceId` names its branch and working copy, so no two tasks may share one. */
  header: CreateHeader & { closerRef: CloserRef };
  /**
   * What this task's agent does and replies, read by this task's sessions only.
   * `delayMs` is how long it waits before each reply, which is how a test decides
   * which task reaches a step first.
   */
  script: MockScript;
}

/** Several scripted tasks against one repository, and the settings every one of them shares, as one project's list does. */
export interface ScriptedSupervisorRun {
  /** A real git repository every task branches from and closes into. */
  repoPath: string;
  /** How many tasks may run at once, as `concurrency` is for `delivery run`. */
  slots: number;
  /** Started in this order as slots free up. */
  tasks: ScriptedTask[];
  budgets: BudgetSet;
  roleConfigs: RoleConfigs;
  /** As for `runSurfaceAgainstMock`: built once per task, from that task's scripted agent port. */
  triage: (agent: AgentPort) => TriagePort;
}

/** How one task ended, where its case file is, and what its own agent was sent and used. */
export interface ScriptedTaskResult extends ScriptedSurfaceResult {
  surfaceId: string;
  /** The task's case file folder, for `load(dir)`. */
  dir: string;
}

interface ScriptedClaim extends Claim {
  task: ScriptedTask;
  /** The task's own scratch folder: its case file and working copy live here. */
  root: string;
}

/**
 * Run several scripted tasks through the harness's own supervisor, `slots` at a
 * time, against one repository: each task is `runSurfaceAgainstMock` in a slot,
 * with the production driver, agent port, gate and closer resolution and
 * provisioning, unchanged, and git calls in the shared checkout taking turns as
 * in a live run. Nothing here orders events: which task reaches a step first is
 * decided by its script's `delayMs` alone.
 *
 * Results come back in the order `tasks` lists them, whichever finished first.
 * As with one task, whether each script was fully used is not checked here:
 * call `assertFullyConsumed(result.journal, task.script)`.
 */
export async function runSupervisorAgainstMock({
  repoPath,
  slots,
  tasks,
  budgets,
  roleConfigs,
  triage,
}: ScriptedSupervisorRun): Promise<ScriptedTaskResult[]> {
  if (!Number.isInteger(slots) || slots < 1) {
    throw new RangeError(`slots must be a whole number of 1 or more, but was ${slots}.`);
  }
  const ids = tasks.map(({ header }) => header.surfaceId);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new Error(
      `Each scripted task needs its own surfaceId, but "${repeated}" is used more than once: a task's branch and working copy are named after it.`,
    );
  }

  const scratch = await mkdtemp(join(tmpdir(), "scripted-supervisor-"));
  const claims: ScriptedClaim[] = tasks.map((task, index) => ({
    taskDef: task.header.taskDef,
    surfaceId: task.header.surfaceId,
    task,
    root: join(scratch, `task-${index + 1}`),
  }));
  const results = new Map<string, ScriptedTaskResult>();

  await supervise<ScriptedClaim>({
    slots,
    // Every task here is new, so the next is simply the next one listed.
    next: (claimed) => Promise.resolve(claims[claimed.length]),
    drive: async ({ task, root, surfaceId }) => {
      const dir = join(root, "case");
      await mkdir(dir, { recursive: true });
      const ran = await runSurfaceAgainstMock({
        ...task,
        dir,
        location: { repoPath, worktreePath: join(root, "worktree") },
        budgets,
        roleConfigs,
        triage,
      });
      results.set(surfaceId, { ...ran, surfaceId, dir });
      return slotOutcome(surfaceId, ran);
    },
    // A task that needs a decision frees its slot for the next, as a run of several does.
    waitOnSetback: false,
  });

  // supervise drives every claim or throws, so each task has a result.
  return claims.map(({ surfaceId }) => {
    const ran = results.get(surfaceId);
    if (ran === undefined) throw new Error(`${surfaceId} has no result: supervise should have driven it or thrown.`);
    return ran;
  });
}

function slotOutcome(surfaceId: string, { result }: ScriptedSurfaceResult): SlotOutcome {
  if (result.outcome === undefined) throw new Error(`${surfaceId} ended at ${result.state} without a recorded outcome.`);
  return result.outcome.kind;
}
