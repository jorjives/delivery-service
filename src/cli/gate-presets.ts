import { z } from "zod";
import { GateRef, Written } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";
import { inferredCheck } from "./project.js";

/**
 * The checks a project can choose by name instead of writing one out. Each is
 * sugar over the built-in command gate: it resolves to a `command` gate judged
 * by its exit code, so a run started from one records, and does, exactly what
 * the written-out gate would. Named by `type`, like the written-out gates and
 * the built-in closers, so the file has one way to say which check it means.
 * Each takes only the detail it needs, and `.strict()` names any other.
 */
export const GatePreset = z.discriminatedUnion("type", [
  z.object({ type: z.literal("test-runner"), command: Written.optional() }).strict(),
  z.object({ type: z.literal("file-exists"), path: Written }).strict(),
  z.object({ type: z.literal("command-succeeds"), command: Written }).strict(),
  z.object({ type: z.literal("schema-validates"), file: Written, schema: Written }).strict(),
  z.object({ type: z.literal("commits-ahead") }).strict(),
  z.object({ type: z.literal("fails-with-new-test"), command: Written.optional() }).strict(),
]);
export type GatePreset = z.infer<typeof GatePreset>;
export type PresetName = GatePreset["type"];

/** The ready-made checks by name, from the schema's own list so the two can never disagree. */
export const PRESET_NAMES: PresetName[] = GatePreset.options.map((option) => option.shape.type.value);

/** What each detail a ready-made check takes is, in the owner's words, for naming one that is missing or wrong. */
export const PRESET_DETAILS: Record<PresetName, Record<string, string>> = {
  "test-runner": { command: "the command that runs your tests" },
  "file-exists": { path: "the file that should exist" },
  "command-succeeds": { command: "the command that should succeed" },
  "schema-validates": { file: "the JSON file to check", schema: "the file describing the shape it should have" },
  "commits-ahead": {},
  "fails-with-new-test": { command: "the command that runs your tests" },
};

/** Passes once the work has added a commit since it started: `DELIVERY_STEP_START` is set by the harness on every gate run. */
export const COMMITS_AHEAD = 'test -n "$(git rev-list "$DELIVERY_STEP_START"..HEAD)"';

/** A path that names a test: under a `test`, `tests` or `__tests__` folder, or called `*.test.*` or `*.spec.*`. */
const TEST_FILE = String.raw`(^|/)(tests?|__tests__)/|\.(test|spec)\.[^/]+$`;

/**
 * Passes when the work changed a test file since `DELIVERY_STEP_START`, the tests pass on that commit
 * (in a throwaway checkout of it, sharing `node_modules`) and they fail on the work's own commit.
 */
function failsWithNewTest(testCommand: string): string {
  const run = `sh -c ${quoted(testCommand)}`;
  return [
    `git diff --name-only "$DELIVERY_STEP_START"..HEAD | grep -Eq ${quoted(TEST_FILE)} || exit 1`,
    `start=$(mktemp -d)`,
    `trap 'git worktree remove --force "$start/tree" >/dev/null 2>&1; rm -rf "$start"' EXIT`,
    `git worktree add -q --detach "$start/tree" "$DELIVERY_STEP_START" || exit 1`,
    `if [ -d node_modules ]; then ln -s "$PWD/node_modules" "$start/tree/node_modules"; fi`,
    `(cd "$start/tree" && ${run}) >/dev/null 2>&1 || exit 1`,
    `if ${run} >/dev/null 2>&1; then exit 1; fi`,
  ].join("\n");
}

/**
 * Everything a config file's `gate` may be: a written-out gate, exactly as the
 * library takes it, or a ready-made check by name. One discriminated union over
 * both, so a mistake in a written-out gate is still reported at its own path.
 */
export const GateChoice = z.discriminatedUnion("type", [...GateRef.options, ...GatePreset.options]);
export type GateChoice = z.infer<typeof GateChoice>;

export function isPresetName(value: unknown): value is PresetName {
  return (PRESET_NAMES as unknown[]).includes(value);
}

export function isPreset(gate: GateChoice): gate is GatePreset {
  return isPresetName(gate.type);
}

/** The written-out gate every ready-made check becomes. */
export type CommandGate = Extract<GateRef, { type: "command" }>;

export const NO_TEST_COMMAND =
  "The ready-made check `test-runner` needs `command`, the command that runs your tests: I couldn't find a `test` script in your package.json to use instead.";

// ponytail: npx fetches the checker the first time the gate runs, so that run needs the network, and ajv-cli's
// default (draft-07) rules apply; bundle a validator if offline use or newer drafts matter.
const SHAPE_CHECKER = "npx --yes ajv-cli@5.0.0 validate";

/** A value as one word to `/bin/sh`, whatever spaces or quotes it holds. */
const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const byExitCode = (command: string): CommandGate => ({ type: "command", command, parseMode: "exitcode" });

/**
 * The written-out gate a ready-made check stands for. Every one is the built-in
 * command gate judged by exit code, so this is the whole of what a preset is: a
 * run started from one pins, and runs, exactly this. `repoPath` is only read to
 * find the project's own test command when `test-runner` names none, the same
 * inference the no-config default check uses.
 */
export async function presetGate(preset: GatePreset, repoPath: string): Promise<CommandGate> {
  switch (preset.type) {
    case "test-runner": {
      const command = preset.command ?? (await inferredCheck(repoPath));
      if (command === undefined) throw new Refusal(NO_TEST_COMMAND, EXIT.configuration, "gate");
      return byExitCode(command);
    }
    case "file-exists":
      return { ...byExitCode(`test -f ${quoted(preset.path)}`), checkOnly: true };
    case "command-succeeds":
      return byExitCode(preset.command);
    case "commits-ahead":
      return { ...byExitCode(COMMITS_AHEAD), checkOnly: true };
    case "fails-with-new-test": {
      const command = preset.command ?? (await inferredCheck(repoPath));
      if (command === undefined) throw new Refusal(NO_TEST_COMMAND.replace("`test-runner`", "`fails-with-new-test`"), EXIT.configuration, "gate");
      return { ...byExitCode(failsWithNewTest(command)), checkOnly: true };
    }
    case "schema-validates":
      return byExitCode(`${SHAPE_CHECKER} -s ${quoted(preset.schema)} -d ${quoted(preset.file)}`);
  }
}

/**
 * What a ready-made check does, as `validate` says it. `command` is the gate it
 * resolved to, which names the test command `test-runner` found for itself.
 * Total over the presets, so a new one does not compile until it can be described.
 */
export function presetPhrase(preset: GatePreset, command: string): string {
  switch (preset.type) {
    case "test-runner":
      return `runs your tests with \`${command}\``;
    case "file-exists":
      return `checks that ${preset.path} exists`;
    case "command-succeeds":
      return `checks that \`${preset.command}\` succeeds`;
    case "commits-ahead":
      return "checks that the work added at least one commit";
    case "fails-with-new-test":
      return "checks that the work committed a test that fails, where your tests passed before";
    case "schema-validates":
      return `checks that ${preset.file} matches the shape in ${preset.schema}`;
  }
}
