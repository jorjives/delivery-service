import { DEFAULT_GUARDS, DEFAULT_ON, guardAssertions, ignoredAssertions, type ActiveGuards, type AcceptedSettings } from "./guards.js";
import type { Gate } from "./command-gate.js";
import { errorReport, messageOf } from "./gate-support.js";
import { resolvedAssertion } from "./item-check.js";
import { GuardName, GuardSwitches, type TaskDef, type CaseFileHeader, type Assertion, type GateReport } from "./schema.js";

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
 * The guards a task's run is judged by: the defaults, with what its own `guards` adds and turns off. In `GuardName`
 * order, so the same task always yields the same list.
 */
function taskGuards(taskDef: TaskDef): ActiveGuards {
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

/** Where the guards diff from: the commit the work started from. */
export type GuardBase = { commit: string };

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
        guards = await guardAssertions(ctx.worktreePath, base.commit, activeGuards(ctx.taskDef, ctx.guards), ctx.gateRef, accepted, ctx.itemId);
        const resolved = await resolvedAssertion(ctx.taskDef, ctx.itemId, ctx.worktreePath);
        if (resolved !== undefined) guards = [...guards, resolved];
      } catch (err) {
        return errorReport(`whether this work changed the project's tests could not be checked: ${messageOf(err)}`);
      }
      return joined(await gate.check(ctx), guards);
    },
  };
}

/** Where a run's guards diff from: its pinned start commit. A run recorded before the start commit was pinned is judged by its gate alone. */
export function guardBase(header: CaseFileHeader): GuardBase | null {
  return header.startCommit === undefined ? null : { commit: header.startCommit };
}
