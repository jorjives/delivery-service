import { showName } from "../packs/hidden-characters.js";
import type { LockEntry } from "../packs/install/lock.js";
import { wrap } from "./packs-inspect-render.js";

/** A workflow the configuration names, and where in the configuration it does so: `tasks 2`, `task` or `sources 1`. */
export interface WorkflowUse {
  where: string;
  workflow: string;
}

/** What is about to be removed, and the workflows that stop existing with it. `workflows` is null when the pack's files cannot be read as approved. */
export function removingLines(name: string, entry: LockEntry, workflows: readonly string[] | null): string[] {
  const lead = wrap(`Removing ${showName(name)}, added from ${showName(entry.package)} ${showName(entry.version)}.`, "");
  if (workflows === null) return [...lead, ...wrap("It is not as approved, so none of its workflows run now.", "  ")];
  return [...lead, "  These workflows will stop existing:", ...workflows.map((workflow) => `    ${showName(workflow)}`)];
}

/** The refusal: the configuration names workflows that would stop existing, and nothing was changed. */
export function stillNamedLines(configFile: string, uses: readonly WorkflowUse[]): string[] {
  return [
    ...wrap(`Not removed: ${showName(configFile)} still names its workflows.`, ""),
    ...uses.map((use) => `  ${use.where}: ${showName(use.workflow)}`),
    ...wrap("Change these first, so nothing names a workflow that stops existing.", ""),
    "Nothing was changed.",
  ];
}

/** The pack is gone: its folder, and its record entry, to be committed together. */
export function removedLines(name: string): string[] {
  return [
    `Removed ${showName(name)}.`,
    `  Deleted: .delivery/packs/${showName(name)}`,
    "  And its entry in .delivery/packs.lock.json",
    "Commit both, so the pack is gone for everyone.",
  ];
}
