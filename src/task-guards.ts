import { DEFAULT_GUARDS, DEFAULT_ON, GuardName, GuardSwitches, type ActiveGuards } from "./guards.js";
import { FixTask } from "./packs/fix-task.js";
import type { GateRef, TaskDef } from "./schema.js";

/** Only the switches a task's own `guards` names: the config file refuses anything else, so a record holding more is read as holding none. */
const SwitchesOf = GuardSwitches.partial();
const switchesOf = (taskDef: TaskDef): GuardSwitches => {
  const parsed = SwitchesOf.safeParse(taskDef.guards);
  return parsed.success ? parsed.data : {};
};

/**
 * The guards a task's run is judged by. A fix of a problem a review found keeps every guard, by the lists it was
 * authorised with, and may change an existing test only when the problem is in one or its owner allowed it. Any
 * other task gets the defaults, with what its own `guards` adds and turns off. In `GuardName` order, so the same
 * task always yields the same list.
 */
export function activeGuards(taskDef: TaskDef): ActiveGuards {
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
export function guardChanges(taskDef: TaskDef): { added: GuardName[]; off: GuardName[] } | null {
  const { on } = activeGuards(taskDef);
  const added = on.filter((name) => !DEFAULT_ON.includes(name));
  const off = DEFAULT_ON.filter((name) => !on.includes(name));
  return added.length === 0 && off.length === 0 ? null : { added, off };
}

/** The check whose own files the guards protect: the run's gate, or the project check a fix wraps (none in a project with no tests). */
export function verifyOf(taskDef: TaskDef, gateRef: GateRef): GateRef | null {
  const fix = FixTask.safeParse(taskDef);
  return fix.success ? fix.data.authorisation.verify : gateRef;
}
