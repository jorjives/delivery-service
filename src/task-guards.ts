import { DEFAULT_GUARDS, DEFAULT_ON, guardAssertions, ignoredAssertions, type ActiveGuards, type AcceptedSettings } from "./guards.js";
import { FixTask } from "./packs/fix-task.js";
import type { Gate } from "./command-gate.js";
import { errorReport, messageOf } from "./gate-support.js";
import { git } from "./git-exec.js";
import { resolvedAssertion } from "./item-check.js";
import { GuardName, GuardSwitches, type GateRef, type TaskDef, type CaseFileHeader, type Assertion, type GateReport } from "./schema.js";

/** Only the switches a task's own `guards` names: the config file refuses anything else, so a record holding more is read as holding none. */
const SwitchesOf = GuardSwitches.partial();
const switchesOf = (taskDef: TaskDef): GuardSwitches => {
  const parsed = SwitchesOf.safeParse(taskDef.guards);
  return parsed.success ? parsed.data : {};
};

/**
 * The guards that judge a task, and, in a workflow, the step it is on: the task's own, then the step's switches.
 */
export function activeGuards(taskDef: TaskDef, step?: GuardSwitches): ActiveGuards {
  const own = taskGuards(taskDef);
  if (step === undefined) return own;
  const { add = [], off = [] } = step;
  return { lists: own.lists, on: GuardName.options.filter((name) => (own.on.includes(name) || add.includes(name)) && !off.includes(name)) };
}

/**
 * The guards a task's run is judged by. A fix of a problem a review found keeps every guard, by the lists it was
 * authorised with, and may change an existing test only when the problem is in one or its owner allowed it. Any
 * other task gets the defaults, with what its own `guards` adds and turns off. In `GuardName` order, so the same
 * task always yields the same list.
 */
function taskGuards(taskDef: TaskDef): ActiveGuards {
  const fix = FixTask.safeParse(taskDef);
  if (fix.success) {
    const { guards, authorisation } = fix.data;
    const lists = guards === undefined ? DEFAULT_GUARDS : { testGlobs: guards.testGlobs, protectedGlobs: guards.protectedGlobs, skipMarkers: guards.skipMarkers };
    const editsAllowed = guards?.testsCategory === true || authorisation.allowTestEdits === true;
    return { lists, on: GuardName.options.filter((name) => !(editsAllowed && name === "tests-unchanged")) };
  }
  const { add = [], off = [] } = switchesOf(taskDef);
  return { lists: DEFAULT_GUARDS, on: GuardName.options.filter((name) => (DEFAULT_ON.includes(name) || add.includes(name)) && !off.includes(name)) };
}

/** How a task's guards differ from the defaults, for a reader of its record; null when they do not. */
export function guardChanges(taskDef: TaskDef, step?: GuardSwitches): { added: GuardName[]; off: GuardName[] } | null {
  const { on } = activeGuards(taskDef, step);
  const added = on.filter((name) => !DEFAULT_ON.includes(name));
  const off = DEFAULT_ON.filter((name) => !on.includes(name));
  return added.length === 0 && off.length === 0 ? null : { added, off };
}

/** The check whose own files the guards protect: the run's gate, or the project check a fix wraps (none in a project with no tests). */
export function verifyOf(taskDef: TaskDef, gateRef: GateRef): GateRef | null {
  const fix = FixTask.safeParse(taskDef);
  return fix.success ? fix.data.authorisation.verify : gateRef;
}

/** Where the guards diff from: the commit the work started from, or, for a record made before it was pinned, where the work branched from its base branch. */
export type GuardBase = { commit: string } | { branch: string };

const commitOf = async (worktreePath: string, base: GuardBase): Promise<string> =>
  "commit" in base ? base.commit : git(worktreePath, ["merge-base", "HEAD", base.branch]);

/** The check's report with the guards' results joined to it. A check that could not run still fails on a guard that failed. */
function joined(report: GateReport, guards: Assertion[]): GateReport {
  const failed = guards.some((a) => a.outcome === "FAIL");
  if (report.status === "ERROR") return failed ? { status: "FAIL", assertions: [...report.assertions, ...guards], detail: report.detail } : report;
  return { ...report, status: failed ? "FAIL" : report.status, assertions: [...report.assertions, ...guards] };
}

/**
 * Any gate, with the guards the task is judged by joined to it. At baseline the ignored files already there are
 * recorded, after the check's own run so what that run leaves is not a new failure. At check the guards are worked
 * out before the check runs, so what is judged is the agent's change, not what a test run leaves behind. Guards
 * that cannot be worked out are an error, never a pass.
 */
export function guardedGate(gate: Gate, base: GuardBase, accepted: AcceptedSettings = {}): Gate {
  return {
    async baseline(ctx) {
      const report = await gate.baseline(ctx);
      if (report.status === "ERROR") return report;
      try {
        return { ...report, assertions: [...report.assertions, ...(await ignoredAssertions(ctx.worktreePath, activeGuards(ctx.taskDef, ctx.guards)))] };
      } catch (err) {
        return errorReport(`which files git ignores could not be checked: ${messageOf(err)}`);
      }
    },
    async check(ctx) {
      let guards: Assertion[];
      try {
        guards = await guardAssertions(ctx.worktreePath, await commitOf(ctx.worktreePath, base), activeGuards(ctx.taskDef, ctx.guards), verifyOf(ctx.taskDef, ctx.gateRef), accepted);
        const resolved = await resolvedAssertion(ctx.taskDef, ctx.itemId, ctx.worktreePath);
        if (resolved !== undefined) guards = [...guards, resolved];
      } catch (err) {
        return errorReport(`whether this work changed the project's tests could not be checked: ${messageOf(err)}`);
      }
      return joined(await gate.check(ctx), guards);
    },
  };
}

/**
 * Where a run's guards diff from: its pinned start commit. A fix recorded before the start commit was pinned keeps
 * the guards it was always judged by, from where it branched; any other such run is judged by its gate alone.
 */
export function guardBase(header: CaseFileHeader): GuardBase | null {
  if (header.startCommit !== undefined) return { commit: header.startCommit };
  return FixTask.safeParse(header.taskDef).success && header.baseBranch !== null ? { branch: header.baseBranch } : null;
}
