import type { Inspection, InspectedSetting, ProjectBaseline } from "../packs/inspection.js";
import { renderSettings } from "../placeholders.js";
import { addThisLines } from "./pack-settings-render.js";
import { wrap } from "./text-wrap.js";

const CHANGES_TOLD = "Changes: what the agent is told.";
const CHANGES_HOLD = "Changes: how far it goes before it asks you.";
const CHANGES_BOTH = "Changes: what the agent is told, and how far it goes before it asks you.";
const CLOSING = ["These change what the agent is told and when it waits.", "They do not change your project's own check."];

/** Why the values shown are not the owner's, when some setting is not read: the project's state decides the words. */
function notReadReason({ found, config }: ProjectBaseline): string {
  if (!found) return "No project found. Values shown are defaults.";
  if (config === "code") return "Your configuration is code, so its values were not read. Values shown are defaults.";
  if (config === "unreadable") return "Your configuration could not be read. Values shown are defaults.";
  return "Values shown are the pack's defaults. This project does not use the pack.";
}

function valueLine({ value, default: fallback, source }: InspectedSetting): string {
  switch (source) {
    case "configuration":
      return `Your value: ${value} (your configuration)`;
    case "default":
      return `Your value: ${value} (default)`;
    case "unset":
      return "Your value: not set. Required: this pack will not run until you give one.";
    case "not-read":
      return fallback === null ? "Value: none. A project that uses this pack must give one." : `Value: ${fallback} (default)`;
  }
}

/** The name, padded to the longest name in the block, then the type and the default, or that it is required. */
function typeLine({ name, type, default: fallback }: InspectedSetting, width: number): string {
  const padded = name.padEnd(width);
  return fallback === null ? `${padded}   ${type}, required` : `${padded}   ${type}, default ${fallback}`;
}

/** What a setting changes, by the shown workflows: the agent's words, its sign-off, or both. */
function changesOf(name: string, workflows: Inspection["workflows"]): string {
  const holds = workflows.some((workflow) => workflow.holdSetting === name);
  const told = workflows.some((workflow) => workflow.steps.some(({ uses }) => uses.some((use) => use.setting === name)));
  if (holds && told) return CHANGES_BOTH;
  return holds ? CHANGES_HOLD : CHANGES_TOLD;
}

function settingLines(setting: InspectedSetting, width: number, changes: string): string[] {
  return [
    ...wrap(typeLine(setting, width), "  ", "    "),
    ...wrap(setting.summary, "    "),
    ...wrap(valueLine(setting), "    "),
    ...wrap(changes, "    "),
  ];
}

/** The Settings block: each setting the pack asks for, the value in effect and where it came from, then the lines to add for any unset one. Pure: no I/O. */
export function settingsBlock(inspection: Inspection, configName: string): string[] {
  const { settings, pack, project } = inspection;
  if (settings.length === 0) return ["Settings", "  This pack has no settings."];
  const width = Math.max(...settings.map(({ name }) => name.length));
  const reason = settings.some(({ source }) => source === "not-read") ? wrap(notReadReason(project), "  ") : [];
  const unset = settings.filter(({ source }) => source === "unset");
  const add =
    unset.length === 0
      ? []
      : addThisLines(
          unset.map(({ name }) => ({ pack: pack.name, setting: name })),
          configName,
          "  ",
        );
  return [
    `Settings (${settings.length})`,
    ...reason,
    ...settings.flatMap((setting) => settingLines(setting, width, changesOf(setting.name, inspection.workflows))),
    ...add,
    ...CLOSING.flatMap((line) => wrap(line, "  ")),
  ];
}

/** The authored prompt with each used setting's value in front of its placeholder, or that it is not set. Pure: no I/O. */
export function annotated(authored: string, uses: Inspection["workflows"][number]["steps"][number]["uses"]): string {
  const shown = Object.fromEntries(uses.map(({ placeholder, setting, value }) => [setting, value === null ? `[${placeholder}, not set]` : `${value} [${placeholder}]`]));
  return renderSettings(authored, shown);
}
