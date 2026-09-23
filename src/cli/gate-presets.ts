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
};

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
      if (command === undefined) throw new Refusal(NO_TEST_COMMAND, EXIT.configuration);
      return byExitCode(command);
    }
    case "file-exists":
      return byExitCode(`test -f ${quoted(preset.path)}`);
    case "command-succeeds":
      return byExitCode(preset.command);
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
    case "schema-validates":
      return `checks that ${preset.file} matches the shape in ${preset.schema}`;
  }
}
