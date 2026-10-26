import { GUARD_REFUSES } from "../guards.js";
import { atOrAbove } from "../item-check.js";
import type { Change } from "../packs/install/compare.js";
import type { DiffLine, FileDiff } from "../packs/install/file-diff.js";
import { showHidden, showName } from "../packs/hidden-characters.js";
import type { Inspection } from "../packs/inspection.js";
import type { MissingSetting, SettingProblem } from "../packs/settings.js";
import { CHECKS_AND_LANDING_DIMENSIONS } from "../packs/widening.js";
import { SEVERITIES, type Severity } from "../schema.js";
import { addThisLines, ownerWords } from "./pack-settings-render.js";
import type { ConfirmQuestion } from "./init.js";
import { findingSentence, orList } from "./packs-inspect-render.js";
import { INSPECT_WIDTH, wrap } from "./text-wrap.js";

/** The last line of a refusal, or of an answer that changed nothing. */
export const NOTHING_UPDATED = "Nothing was changed.";

/** A sentence wrapped at its indent, with a hanging indent two columns deeper. */
const sentence = (text: string, indent = ""): string[] => wrap(text, indent, `${indent}  `);

/** The severities a sign-off rates, named the way the account names them: the threshold first, then each more severe. */
const ratedAt = (threshold: Severity): string => orList(SEVERITIES.filter((severity) => atOrAbove(severity, threshold)).reverse());

const lineCount = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;

const kindPhrase = (kind: "find" | "act"): string => (kind === "act" ? "an act" : "a find");

export function lookupLines(packageName: string, request: string, found: string, have: string): string[] {
  return [
    ...sentence(`Checking ${showName(packageName)} on npm.`),
    ...sentence(`Found ${showName(found)} for "${showName(request)}" (you have ${showName(have)}).`),
    ...sentence("Nothing is changed until you say yes."),
  ];
}

export function upToDateLines(name: string, version: string, request: string): string[] {
  return [...sentence(`${showName(name)} is up to date at ${showName(version)}.`), ...sentence(`"${showName(request)}" on npm is still the pack you have.`, "  ")];
}

export function sameContentLines(name: string, have: string, found: string): string[] {
  return [
    ...sentence(`${showName(name)} ${showName(found)} has the same content as the ${showName(have)} you have.`),
    ...sentence(NOTHING_UPDATED, "  "),
  ];
}

/** What to do next when the kept copy is not the one approved, or when the record has no approval. Nothing for an ok copy. */
export function stateHintLines(name: string, state: "ok" | "unapproved" | "changed"): string[] {
  const shown = showName(name);
  if (state === "ok") return [];
  if (state === "changed") {
    return [...sentence("The kept copy differs from what was approved. To go back:"), ...sentence(`delivery packs restore ${shown}`, "  ")];
  }
  return [...sentence(`The record says ${shown} has not been approved. To read it and decide:`), ...sentence(`delivery packs approve ${shown}`, "  ")];
}

export function notUpdatableLines(name: string, state: "missing" | "invalid" | "newer-format"): string[] {
  const shown = showName(name);
  if (state === "newer-format") {
    return [
      ...sentence(`Not updated: the kept files of ${shown} are in a newer pack format than this delivery-service reads.`),
      ...sentence("Upgrade delivery-service to read them.", "  "),
      ...sentence(NOTHING_UPDATED, "  "),
    ];
  }
  const problem = state === "missing" ? "are missing" : "do not read as a pack";
  return [
    ...sentence(`Not updated: the kept files of ${shown} ${problem}.`),
    ...sentence(`Put them back first: delivery packs restore ${shown}`, "  "),
    ...sentence(NOTHING_UPDATED, "  "),
  ];
}

export function renamedLines(name: string, packageName: string, version: string, newName: string): string[] {
  const shown = showName(name);
  const pkg = showName(packageName);
  return [
    ...sentence(`Not updated: ${pkg} ${showName(version)} holds a pack named ${showName(newName)}, but this project keeps it as ${shown}.`),
    ...sentence("To take it under its new name, remove this one, then add it again:", "  "),
    ...sentence(`delivery packs remove ${shown}`, "    "),
    ...sentence(`delivery packs add ${pkg}`, "    "),
    ...sentence(NOTHING_UPDATED, "  "),
  ];
}

export function badRequestLines(request: string): string[] {
  return [...sentence(`Not updated: ${showName(request)} is not a version, range or tag.`), ...sentence(NOTHING_UPDATED, "  ")];
}

export function keptDiffersLines(): string[] {
  return sentence("The kept copy differs from what was approved; the changes below are from the kept copy as it is now.");
}

/** A fingerprint as two lines of 32 characters: the identity block's split. */
const fingerprintLines = (hash: string): string[] => [`  ${hash.slice(0, 32)}`, `  ${hash.slice(32)}`];

export function headlineLines(name: string, from: { version: string; hash: string }, to: { version: string; hash: string }): string[] {
  return [
    ...sentence(`${showName(name)}: ${showName(from.version)} to ${showName(to.version)}`),
    "Fingerprint before:",
    ...fingerprintLines(from.hash),
    "Fingerprint after:",
    ...fingerprintLines(to.hash),
  ];
}

type HoldChange = Extract<Change, { kind: "hold" }>;
type HoldUnknownChange = Extract<Change, { kind: "hold-unknown" }>;
type WidensChange = Extract<Change, { kind: "widens-added" | "widens-removed" }>;

const isWidens = (change: Change): change is WidensChange => change.kind === "widens-added" || change.kind === "widens-removed";

function signOffSentence(change: HoldChange | HoldUnknownChange): string {
  const name = `"${showName(change.workflow)}"`;
  if (change.kind === "hold-unknown") return `Sign-off: ${name} takes its sign-off from a setting with no value yet, so what waits for you cannot be known.`;
  const { from, to } = change;
  if (to === null) return `Sign-off: ${name} no longer waits for your sign-off.`;
  if (from === null) return `Sign-off: ${name} now waits for your sign-off on ideas rated ${ratedAt(to)}.`;
  return `Sign-off: ${name} now waits for your sign-off on ideas rated ${ratedAt(to)} (before: ${ratedAt(from)}).`;
}

function guardSentence(change: Extract<Change, { kind: "guard-added" | "guard-removed" }>): string {
  const name = `"${showName(change.workflow)}"`;
  const refuses = GUARD_REFUSES[change.guard];
  return change.kind === "guard-removed"
    ? `Guards: ${name} is no longer refused if it ${refuses}.`
    : `Guards: ${name} is now also refused if it ${refuses}.`;
}

/** The summary of an update, in the order the owner reads it: sign-off, guards, workflows, checks and landing, widening, new findings, then the caveat. */
export function summaryLines(changes: readonly Change[], after: Inspection): string[] {
  const holds = changes.filter((change): change is HoldChange | HoldUnknownChange => change.kind === "hold" || change.kind === "hold-unknown");
  const guards = changes.filter((change): change is Extract<Change, { kind: "guard-added" | "guard-removed" }> => change.kind === "guard-added" || change.kind === "guard-removed");
  const names = (kind: "workflow-added" | "workflow-removed"): string[] =>
    changes.flatMap((change) => (change.kind === kind ? [showName(change.workflow)] : []));
  const added = names("workflow-added");
  const removed = names("workflow-removed");
  const kinds = changes.flatMap((change) =>
    change.kind === "kind-changed"
      ? [`"${showName(change.workflow)}" is now ${kindPhrase(change.to)} (before: ${kindPhrase(change.from)}).`]
      : [],
  );
  const widens = changes.filter(isWidens);
  const checks = widens.filter(({ dimension }) => CHECKS_AND_LANDING_DIMENSIONS.includes(dimension));
  const otherWidens = widens.filter(({ dimension }) => !CHECKS_AND_LANDING_DIMENSIONS.includes(dimension));
  const gained = changes.flatMap((change) => (change.kind === "finding-gained" ? [change.finding] : []));

  const signOff = holds.length === 0 ? ["Sign-off: no change."] : holds.map(signOffSentence);
  const guardLines = guards.length === 0 ? ["Guards: no change."] : guards.map(guardSentence);
  const checkLines =
    checks.length === 0
      ? ["Checks and landing: no change."]
      : checks.map(({ workflow, kind, dimension }) => `Checks and landing: "${showName(workflow)}" ${kind === "widens-added" ? "now has" : "no longer has"} ${dimension}.`);
  const widenLines = otherWidens.map(({ workflow, kind, dimension }) => {
    const verb = kind === "widens-added" ? "now widens" : "no longer widens";
    return `"${showName(workflow)}" ${verb} what the agent may do beyond your project's defaults: ${dimension}.`;
  });

  return [
    ...sentence("What changed, in short"),
    ...[
      ...signOff,
      ...guardLines,
      `Workflows added: ${added.length === 0 ? "none" : added.join(", ")}`,
      `Workflows removed: ${removed.length === 0 ? "none" : removed.join(", ")}`,
      ...kinds.map((line) => `Workflows changed: ${line}`),
      ...checkLines,
      `Widens what the agent may do: ${after.widens ? "yes" : "no"}.`,
      ...widenLines,
    ].flatMap((line) => sentence(line, "  ")),
    ...(gained.length === 0
      ? []
      : [
          ...sentence("New things to look at:", "  "),
          ...gained.flatMap((finding, index) => wrap(`${index + 1}. ${findingSentence(finding)}`, "    ", "       ")),
        ]),
    ...sentence("Read the changed lines below. This summary does not cover what the instructions say.", "  "),
  ];
}

type SettingChange = Extract<Change, { kind: "setting-added" | "setting-removed" | "setting-default-changed" | "setting-type-changed" }>;

const isSettingChange = (change: Change): change is SettingChange =>
  change.kind === "setting-added" || change.kind === "setting-removed" || change.kind === "setting-default-changed" || change.kind === "setting-type-changed";

const STOP_SENTENCE = "Until you fix this, every run in this project will stop, including scheduled runs.";

/** The clause that says a default change moved the sign-off in effect: only a hold of an act that takes its threshold from the setting. */
function holdClause(setting: string, changes: readonly Change[], after: Inspection): string {
  const hold = changes.find(
    (change): change is HoldChange =>
      change.kind === "hold" && after.workflows.some((workflow) => workflow.local === change.workflow && workflow.holdSetting === setting),
  );
  if (hold === undefined || hold.to === null) return "";
  return ` A change now waits for sign-off only at ${ratedAt(hold.to)}: this lets ${hold.direction === "wider" ? "more" : "less"} through.`;
}

function settingSentence(change: SettingChange, changes: readonly Change[], after: Inspection, accepted: readonly string[], problems: readonly SettingProblem[]): string {
  const { setting } = change;
  const names = (kind: "missing" | "undeclared" | "invalid"): boolean => problems.some((problem) => problem.kind === kind && "setting" in problem && problem.setting === setting);
  switch (change.kind) {
    case "setting-added":
      if (!change.required) return `New, has a default: ${setting} (${change.default}).`;
      if (names("missing")) return `New, needs a value: ${setting}.`;
      if (accepted.includes(setting)) return `New: ${setting}. Your configuration gives it.`;
      return `New: ${setting}. Your configuration gives it a value the pack cannot use.`;
    case "setting-removed":
      return `Removed: ${setting}.${names("undeclared") ? " Your configuration still names it: remove that line." : ""}`;
    case "setting-default-changed":
      if (change.to === null) return `Default removed: ${setting} (was ${change.from}).`;
      if (change.from === null) return `Default added: ${setting} (${change.to}).`;
      return `Default changed: ${setting}, ${change.from} to ${change.to}.${holdClause(setting, changes, after)}`;
    case "setting-type-changed":
      return `Type changed: ${setting}, ${change.from} to ${change.to}.${names("invalid") ? " Your value no longer fits." : ""}`;
  }
}

/** What each problem asks the owner to do, in the order the problems are given. The missing settings share one block of lines to add. */
function problemLines(problems: readonly SettingProblem[], configName: string): string[] {
  const missing = problems.filter((problem): problem is MissingSetting => problem.kind === "missing");
  return problems.flatMap((problem) => {
    switch (problem.kind) {
      case "missing":
        return problem === missing[0] ? addThisLines(missing, configName, "  ") : [];
      case "undeclared":
        return sentence(`Remove ${problem.setting} from packSettings in ${configName}.`, "  ");
      case "invalid": {
        const { statement, remedy } = ownerWords(problem.rule, problem.value);
        return [...sentence(`Change ${problem.setting} in ${configName}: ${statement}`, "  "), ...(remedy === "" ? [] : sentence(remedy, "  "))];
      }
      case "unknown-pack":
        return [];
    }
  });
}

/**
 * The settings part of an update: each setting change in one sentence, then what will stop every run until it is fixed, and
 * what to do. `accepted` names the settings the owner's values already give a usable value. `problems` are the very problems
 * the refusal renders, so a run stops for what this part names. Empty when no setting changed and nothing is wrong.
 */
export function settingsChangeLines(
  changes: readonly Change[],
  after: Inspection,
  accepted: readonly string[],
  problems: readonly SettingProblem[],
  configName: string,
): string[] {
  const settingChanges = changes.filter(isSettingChange);
  if (settingChanges.length === 0 && problems.length === 0) return [];
  return [
    "Settings",
    ...settingChanges.flatMap((change) => sentence(settingSentence(change, changes, after, accepted, problems), "  ")),
    ...(problems.length === 0 ? [] : [...sentence(STOP_SENTENCE, "  "), ...problemLines(problems, configName)]),
  ];
}

/** The instruction files, each with its counts, in the order given. */
export function filesLines(diffs: readonly FileDiff[]): string[] {
  return [
    "Instruction files",
    ...diffs.flatMap((diff) => sentence(`${showName(diff.path)}: ${fileCounts(diff)}`, "  ")),
  ];
}

function fileCounts({ status, added, removed }: FileDiff): string {
  switch (status) {
    case "changed":
      return `changed, ${lineCount(added)} added, ${removed} removed`;
    case "added":
      return `new, ${lineCount(added)}`;
    case "removed":
      return `removed, ${lineCount(removed)}`;
    case "unchanged":
      return "unchanged";
  }
}

const LEGEND = 'A line starting "-" was removed. A line starting "+" was added. Two spaces start an unchanged line. "..." marks lines left out.';

/** Pack-authored text as a reader sees it: hidden characters visible, a tab kept. */
const shownText = (text: string): string => showHidden(text, { newline: false, tab: true });

function diffLine(line: DiffLine): string {
  switch (line.kind) {
    case "removed":
      return `  - ${shownText(line.text)}`;
    case "added":
      return `  + ${shownText(line.text)}`;
    case "context":
      return `    ${shownText(line.text)}`;
    case "gap":
      return "  ...";
    case "no-line-break":
      return "  (no line break at the end of the line above)";
  }
}

/** Every changed line of each changed file, under the legend. The pack's own lines are not wrapped: they are shown as written. */
export function changedLinesBlock(diffs: readonly FileDiff[]): string[] {
  return [
    "Changed lines",
    ...wrap(LEGEND, "  "),
    ...diffs
      .filter(({ status }) => status !== "unchanged")
      .flatMap((diff) => ["", `  ${showName(diff.path)}`, ...diff.lines.map(diffLine)]),
  ];
}

export const updateQuestion = (name: string, from: string, to: string): ConfirmQuestion => ({
  message: `Move ${showName(name)} from ${showName(from)} to ${showName(to)}?`,
  default: false,
});

export function updatedLines(name: string, version: string): string[] {
  const shown = showName(name);
  // The path is never broken, so when the label and the path would pass the width, the path takes a line of its own.
  const kept = `Kept as:  .delivery/packs/${shown}`;
  const keptLines = kept.length + 2 <= INSPECT_WIDTH ? [`  ${kept}`] : ["  Kept as:", `    .delivery/packs/${shown}`];
  return [
    ...sentence(`Updated ${shown} to ${showName(version)}.`),
    "  Recorded: .delivery/packs.lock.json",
    ...keptLines,
    ...sentence(`Commit both. Runs use ${showName(version)} from now on.`),
  ];
}
