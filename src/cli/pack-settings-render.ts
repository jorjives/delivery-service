import { hasHidden } from "../packs/hidden-characters.js";
import type { SettingProblem } from "../packs/settings.js";
import {
  EMPTY,
  FORWARD_SLASHES,
  NOT_ABSOLUTE,
  NOT_PATH,
  NOT_PATHS,
  NOT_SEVERITY,
  NOT_TEXT,
  NO_BRACES,
  NO_GIT,
  NO_PARENT,
  ONE_LINE,
  PATHS_MAX,
  PATHS_MIN,
  PATHS_UNIQUE,
  TEXT_MAX,
  writtenAs,
} from "../packs/setting-types.js";
import { INSPECT_WIDTH, wrap } from "./packs-inspect-render.js";

export const DEFAULT_CONFIG_NAME = "delivery.config.json";

/** The longest string shown back to the owner, in characters. */
const SHOWN_MAX = 40;
const BRACES = /\{\{|\}\}/;

type Words = { statement: string; remedy: string };
type Missing = Extract<SettingProblem, { kind: "missing" }>;
type Fault = Exclude<SettingProblem, { kind: "missing" }>;

/** The value as the owner wrote it, in JSON, when it is printable and short enough to show; else null. */
export function shownValue(value: unknown): string | null {
  if (typeof value === "string") {
    if (hasHidden(value) || BRACES.test(value) || [...value].length > SHOWN_MAX) return null;
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  return null;
}

const FOLDER_REMEDY = 'Give a folder inside the project, such as "docs".';

/** The statement and remedy for each value rule, given the subject: the shown value, or "The value" when none can be shown. */
const WORDS = new Map<string, (subject: string) => Words>([
  [NOT_SEVERITY, (s) => ({ statement: `${s} is not a severity.`, remedy: "Use one of: low, medium, high, critical." })],
  [NOT_ABSOLUTE, (s) => ({ statement: `${s} is not inside this project.`, remedy: FOLDER_REMEDY })],
  [NO_PARENT, (s) => ({ statement: `${s} is not inside this project.`, remedy: FOLDER_REMEDY })],
  [NO_GIT, (s) => ({ statement: `${s} names .git.`, remedy: FOLDER_REMEDY })],
  [FORWARD_SLASHES, (s) => ({ statement: `${s} uses \\ between folders.`, remedy: 'Use / between folders, such as "docs/guides".' })],
  [NOT_TEXT, (s) => ({ statement: `${s} is not text.`, remedy: "Give it in quotes." })],
  [NOT_PATH, (s) => ({ statement: `${s} is not a path.`, remedy: 'Give one path in quotes, such as "docs".' })],
  [NOT_PATHS, (s) => ({ statement: `${s} is not a list of paths.`, remedy: 'Give a list, such as ["docs"].' })],
  [EMPTY, () => ({ statement: "The value is empty.", remedy: "Give a value." })],
  [TEXT_MAX, () => ({ statement: "The value is longer than 200 characters.", remedy: "Give one line of 200 characters or fewer." })],
  [ONE_LINE, () => ({ statement: "The value has a line break, tab or hidden character.", remedy: "Give one line of plain text." })],
  [NO_BRACES, () => ({ statement: "The value holds {{ or }}.", remedy: "Remove them: a value cannot hold a placeholder." })],
  [PATHS_MIN, () => ({ statement: "The list is empty.", remedy: 'List at least one path, such as ["docs"].' })],
  [PATHS_MAX, () => ({ statement: "The list has more than 32 paths.", remedy: "List 32 or fewer." })],
  [PATHS_UNIQUE, () => ({ statement: "The list names a path twice.", remedy: "List each path once." })],
]);

/** The owner's words for a value rule: what is wrong with the value, and how to give it. */
export function ownerWords(rule: string, value: unknown): Words {
  const subject = shownValue(value) ?? "The value";
  const written = /^must be written as "(.*)"$/.exec(rule);
  if (written !== null) return { statement: `${subject} is not written plainly.`, remedy: `Write it as "${written[1]}".` };
  const words = WORDS.get(rule);
  if (words !== undefined) return words(subject);
  return { statement: `The value cannot be used: it ${rule}.`, remedy: "" };
}

/** The lines to add to the config, one placeholder per unset setting, grouped by pack. Never wrapped: the reader pastes them. */
export function snippetLines(unmet: readonly { pack: string; setting: string }[]): string[] {
  const packs: Record<string, Record<string, string>> = {};
  for (const { pack, setting } of unmet) packs[pack] = { ...packs[pack], [setting]: "..." };
  const oneLine = `  "packSettings": { ${Object.entries(packs)
    .map(([pack, settings]) => `"${pack}": { ${Object.keys(settings).map((setting) => `"${setting}": "..."`).join(", ")} }`)
    .join(", ")} }`;
  if (oneLine.length <= INSPECT_WIDTH) return [oneLine];
  return `"packSettings": ${JSON.stringify(packs, null, 2)}`.split("\n").map((line) => `  ${line}`);
}

/** A summary as a clause: its first letter lower-cased, unless the second letter is capitalised too (an acronym). */
const asClause = (summary: string): string => (/[A-Z]/.test(summary.charAt(1)) ? summary : summary.charAt(0).toLowerCase() + summary.slice(1));

function faultLines(problem: Fault): string[] {
  switch (problem.kind) {
    case "unknown-pack":
      return [
        ...wrap(`${problem.pack}: no pack called ${problem.pack} is used by this project.`, "  ", "    "),
        ...wrap(`Packs in use: ${problem.inUse.join(", ")}.`, "    "),
      ];
    case "undeclared":
      return [
        ...wrap(`${problem.pack}: "${problem.setting}" is not a setting of this pack.`, "  ", "    "),
        ...wrap(problem.declared.length > 0 ? `Its settings are: ${problem.declared.join(", ")}.` : "This pack has no settings.", "    "),
      ];
    case "invalid": {
      const { statement, remedy } = ownerWords(problem.rule, problem.value);
      return [...wrap(`${problem.pack}.${problem.setting}: ${statement}`, "  ", "    "), ...(remedy === "" ? [] : wrap(remedy, "    "))];
    }
  }
}

function missingLines(missing: readonly Missing[], configName: string): string[] {
  const packs = new Map<string, Missing[]>();
  for (const problem of missing) packs.set(problem.pack, [...(packs.get(problem.pack) ?? []), problem]);
  const count = packs.size;
  const [[onlyPack, onlySettings] = ["", []]] = [...packs];
  const head =
    count > 1
      ? `${count} packs need settings you have not given.`
      : onlySettings.length === 1
        ? `the pack ${onlyPack} needs a setting you have not given.`
        : `the pack ${onlyPack} needs ${onlySettings.length} settings you have not given.`;
  const lines = [
    ...wrap(`Nothing can run yet: ${head}`, ""),
    ...wrap(`This stops every run in this project, not only ${count > 1 ? "those packs" : onlyPack}, so that a half-set-up project never starts.`, ""),
  ];
  for (const [pack, settings] of packs) {
    if (count > 1) lines.push(...wrap(`The pack ${pack} needs:`, ""));
    for (const { setting, summary } of settings) lines.push(...wrap(`${setting}: ${asClause(summary)}`, "  ", "    "));
  }
  lines.push(...wrap(`Add this to ${configName}, replacing the dots:`, ""), ...snippetLines(missing));
  return lines;
}

/**
 * The whole refusal for a project whose pack settings are not all right: the faults first (the cause), then the unset
 * settings, then the line that says nothing was run. Pure: no I/O.
 */
export function settingsRefusal(problems: readonly SettingProblem[], configName: string): string {
  const faults = problems.filter((problem): problem is Fault => problem.kind !== "missing");
  const missing = problems.filter((problem): problem is Missing => problem.kind === "missing");
  const lines: string[] = [];
  if (faults.length > 0) {
    lines.push(...wrap(`${configName}: packSettings`, ""));
    for (const fault of faults) lines.push(...faultLines(fault));
  }
  if (missing.length > 0) lines.push(...missingLines(missing, configName));
  lines.push("Nothing was run.");
  return lines.join("\n");
}
