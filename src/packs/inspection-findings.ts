import { z } from "zod";
import { hiddenAt, showName, type HiddenAt } from "./hidden-characters.js";
import type { InspectedWorkflow, InspectionBase } from "./inspection.js";

/** The kinds of thing a reader is asked to look at: a widening, a sign-off that is missing or partial, a guard an older format gains. */
export const FINDING_CODES = ["widens", "lands-without-sign-off", "hold-only-critical", "older-format-guards"] as const;

/**
 * One thing a reader should look at. `workflow` is the qualified name; `detail` is the widening dimension for `widens`,
 * the guard for `older-format-guards`, the severity for `hold-only-critical`, and null for `lands-without-sign-off`.
 */
export const Finding = z.object({
  code: z.enum(FINDING_CODES),
  relation: z.enum(["wider", "note"]),
  workflow: z.string(),
  detail: z.string().nullable(),
});
export type Finding = z.infer<typeof Finding>;

/** The places in the pack's words that a hidden character can be found in. */
export const HIDDEN_PLACES = ["title", "summary", "source-path", "project-path", "workflow-summary", "instructions", "harness", "file-name"] as const;

/**
 * A hidden character in the pack's words or in a file name. `codePoint` is in the `U+202E` form; `shown` is the form the
 * text shows; `workflow` is set for the three workflow places; `file` is set for a file name; `line` only for instructions and harness.
 */
export const HiddenCharacter = z.object({
  codePoint: z.string(),
  shown: z.string(),
  place: z.enum(HIDDEN_PLACES),
  workflow: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  column: z.number().int(),
});
export type HiddenCharacter = z.infer<typeof HiddenCharacter>;

const note = (code: Finding["code"], workflow: string, detail: string | null): Finding => ({ code, relation: "note", workflow, detail });

/** Every widening dimension first, then per act the sign-off limit and each guard an older format gains. Pure: no I/O. */
export function findingsOf(workflows: readonly InspectedWorkflow[]): Finding[] {
  const widens = workflows.flatMap(({ name, widens: dimensions }) =>
    dimensions.map((dimension): Finding => ({ code: "widens", relation: "wider", workflow: name, detail: dimension })),
  );
  const acts = workflows.flatMap((workflow) => {
    if (workflow.kind !== "act") return [];
    const sign: Finding[] = !workflow.holdKnown
      ? []
      : workflow.hold === null
        ? [note("lands-without-sign-off", workflow.name, null)]
        : workflow.hold === "critical"
          ? [note("hold-only-critical", workflow.name, "critical")]
          : [];
    return [...sign, ...workflow.upgraded.map((guard) => note("older-format-guards", workflow.name, guard))];
  });
  return [...widens, ...acts];
}

/** The raw character as `U+202E`: the name the code point has, without the angle brackets `showName` writes. */
const codePointOf = (char: string): string => showName(char).slice(1, -1);

function hiddenIn(found: HiddenAt, place: HiddenCharacter["place"], where: { workflow?: string; file?: string }, lined: boolean): HiddenCharacter {
  return {
    codePoint: codePointOf(found.char),
    shown: found.shown,
    place,
    workflow: where.workflow ?? null,
    file: where.file ?? null,
    line: lined ? found.line : null,
    column: found.column,
  };
}

/** A text read as one line: a newline and a tab are counted as hidden characters too. */
const inOneLine = (text: string, place: HiddenCharacter["place"], where: { workflow?: string; file?: string } = {}): HiddenCharacter[] =>
  hiddenAt(text, { newline: false, tab: false }).map((found) => hiddenIn(found, place, where, false));

/** Instructions and harness words: line breaks and tabs are layout, so only the other hidden characters are counted. */
const inInstructions = (text: string, place: HiddenCharacter["place"], workflow: string): HiddenCharacter[] =>
  hiddenAt(text, { newline: true, tab: true }).map((found) => hiddenIn(found, place, { workflow }, true));

/** Every hidden character in the pack's own words and in the names of its files, in the order a reader meets them. */
export function hiddenCharactersOf({ pack, workflows, project, files }: InspectionBase): HiddenCharacter[] {
  return [
    ...inOneLine(pack.title, "title"),
    ...inOneLine(pack.summary, "summary"),
    ...inOneLine(pack.source.path, "source-path"),
    ...(project.path === null ? [] : inOneLine(project.path, "project-path")),
    ...workflows.flatMap((workflow) => [
      ...inOneLine(workflow.summary ?? "", "workflow-summary", { workflow: workflow.name }),
      // Every step of a workflow runs the same instructions; each distinct text is counted once.
      ...[...new Set(workflow.steps.map(({ instructions }) => instructions.authored))].flatMap((text) => inInstructions(text, "instructions", workflow.name)),
      ...[...new Set(workflow.steps.map(({ instructions }) => instructions.harness ?? ""))].flatMap((text) => inInstructions(text, "harness", workflow.name)),
    ]),
    ...files.flatMap(({ path }) => inOneLine(path, "file-name", { file: path })),
  ];
}
