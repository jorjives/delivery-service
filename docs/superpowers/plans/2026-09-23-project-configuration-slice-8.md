# Project Configuration — Slice 8: Pick a Ready-Made Check by Name

> **Status:** ✅ Complete — 2026-09-23 — `4025477`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 8 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** A project owner can write `"gate": { "type": "file-exists", "path": "CHANGES.md" }` (or `test-runner`, `command-succeeds`, `schema-validates`) in `delivery.config.json`; `delivery validate` describes it in plain words ("checks that CHANGES.md exists"), refuses a misspelt name with one line listing the four names, refuses a missing detail by naming it, and `delivery run` pins and runs exactly the written-out `command` gate the name stands for.

**Architecture:** Presets are config-file sugar in the CLI layer only. A new `src/cli/gate-presets.ts` holds the preset schema (a zod discriminated union on `type`, like the written-out gates and like the built-in closers), the table of details each needs, the preset-to-`GateRef` resolution and the plain-words phrase. `DeliveryConfig.gate` becomes one discriminated union over the library's own `GateRef` options plus the preset options, so a written-out gate parses, and is refused, exactly as before. `resolveProject` turns a preset into its `command` gate (exit-code parse mode) before anything is pinned, and remembers which preset it was in `ProjectSettings.gatePreset` purely so `validate` can describe it; the case file header still records only `gateRef`. The library (`src/schema.ts`, `resolveGate`, `src/index.ts`) is untouched.

**Tech Stack:** Node ≥ 22, TypeScript strict, zod 4, vitest, changesets. No new dependency (the `schema-validates` preset runs a pinned `ajv-cli` through `npx` inside the project's own check command; it is not a dependency of this package).

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Presets are names that resolve to the existing gate definitions; they add no new gate machinery and no change to what a run record stores." So: every preset resolves to `{ type: "command", command, parseMode: "exitcode" }`; no new `Gate` implementation, no change to `GateRef`, `resolveGate`, `CaseFileHeader` or `src/index.ts`.
- **Spec (verbatim):** "Named gate presets (`test-runner`, `file-exists`, `command-succeeds`, `schema-validates`): sugar resolving to a `GateRef`, per roadmap Item 2's accessibility note."
- **Spec, reuse-estate:** plain-language errors extend the existing `describeProblem` (no `zod-validation-error`); the config schema extends `DeliveryConfig` (no second loader). No new runtime dependency.
- **Spec, DX:** `validate` needs no agent, no credential and no network. Resolving a preset (including `schema-validates`) never runs anything; only the gate command itself, during a run, may fetch.
- **Unchanged behaviour:** every existing written-out gate (`command`, `custom`) parses, resolves, is described and is refused with exactly the messages it has today, except the one generic "what a check looks like" sentence, which now leads with a ready-made example (Task 2).
- **UAT wording (verbatim):** validation describes a `file-exists` preset for `CHANGES.md` as "checks that CHANGES.md exists"; a misspelt preset name is answered with "a single line [that] lists the four valid names".
- **Copy:** British English; no em-dashes in anything a person reads (messages, README, guides, changeset). The project-configuration guide's prose (outside code) must not use "worktree", "envelope", "surface", "case file", "role config" or "schema".
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.
- **Running a targeted test:** `src/` unit tests run directly (`npx vitest run <file>`); `tests/project-configuration-guide.test.ts` drives the compiled CLI, so `npm run build && npx vitest run tests/project-configuration-guide.test.ts`.

### Decisions settled for this plan (unattended run)

- **A preset is named with `type`, not a separate `preset` key:** `{ "type": "file-exists", "path": "CHANGES.md" }`. One discriminator means one discriminated union, so zod keeps path-accurate issues for written-out gates (verified: a plain `z.union` of two differently keyed unions collapses every written-out gate error to a bare `invalid_union` at `gate`, which would break the "unchanged" AC). It also matches how built-in closers are chosen (`{ "type": "commit-to-branch" }`), and an unknown name arrives as a `gate.type` issue, answered like `unknownCloser`.
- **Details:** `test-runner` needs none (optional `command`; default is the project's own `npm test`, inferred exactly as the no-config default check is); `file-exists` needs `path`; `command-succeeds` needs `command`; `schema-validates` needs `file` and `schema`. Each preset object is `.strict()`, so an extra detail is named and refused.
- **Resolutions:** `test-runner` → the command; `file-exists` → `test -f '<path>'` (single-quoted for `/bin/sh`); `command-succeeds` → the command; `schema-validates` → `npx --yes ajv-cli@5.0.0 validate -s '<schema>' -d '<file>'` (verified: exit 0 valid, 1 invalid, 2 missing file). All `parseMode: "exitcode"`.
- **`schema-validates` uses a pinned `ajv-cli` via `npx`** rather than a validator shipped in this package: shipping one would add a runtime dependency and new gate machinery, both ruled out. Ceiling (marked with a `ponytail:` comment): the first run needs the network, and ajv-cli's default draft-07 applies. Upgrade path: bundle a validator when offline use matters.
- **`validate` describes a preset only when the check actually came from it:** `--gate-command` / `DELIVERY_GATE_COMMAND` still beat the file, and then the command is described as today.
- **The example project keeps its written-out gate.** Two recorded UAT tests and the guide-as-test pin its validate output (`runs \`npm test\``). The guide instead leads step 4 with the preset and proves, in its own test, that the guide's preset resolves to exactly the example's written-out gate.
- **No bare-string form** (`"gate": "test-runner"`): one shape for every preset; a bare string is answered by the generic sentence, which now shows a preset example.

## Scaffolding Impact

- **Reactive:** `README.md` "Configure it once" settings table, `gate` row, says only "see Writing a gate" → Task 3.
- **Reactive:** `docs/writing-a-gate.md` "The built-in command gate" is where an owner lands for a config-only check; add a pointer that the common checks can be named instead → Task 3.
- **Reactive:** `src/cli/config.ts` `WHAT_IT_TAKES.gate` (the refusal copy describing what `gate` takes) → Task 2.
- **Reactive:** `docs/project-configuration.md` step 4 describes choosing a check as writing a command out → Task 4 (the slice AC), with `tests/project-configuration-guide.test.ts` extended in the same task.
- **Reactive:** changelog: new pending minor changeset `.changeset/pick-a-ready-made-check-by-name.md` → Task 3.
- No new command, flag, env var, dependency or build step. No `CLAUDE.md` / `AGENTS.md` exists. `docs/superpowers/specs/*` and existing changesets are history and stay as written.

---

### Task 1: Know what each ready-made check is and the written-out gate it stands for

A self-contained module: the presets' schema, names, details and resolution. Nothing reads it yet, so this commit changes no behaviour and compiles on its own.

**Files:**
- Create: `src/cli/gate-presets.ts`
- Test: `src/cli/gate-presets.test.ts` (new)

**Interfaces:**
- Consumes: `GateRef`, `Written` from `src/schema.ts`; `inferredCheck(repoPath): Promise<string | undefined>` from `src/cli/project.ts`; `EXIT`, `Refusal` from `src/cli/failures.ts`; `resolveGate(gateRef, repoPath)` from `src/resolve-gate.ts` and `inferGate` from `src/cli/project.ts` (tests only).
- Produces (all exported from `src/cli/gate-presets.ts`):
  - `GatePreset` (zod schema) and `type GatePreset` — `{ type: "test-runner"; command?: string } | { type: "file-exists"; path: string } | { type: "command-succeeds"; command: string } | { type: "schema-validates"; file: string; schema: string }`.
  - `type PresetName = GatePreset["type"]`.
  - `PRESET_NAMES: PresetName[]` — `["test-runner", "file-exists", "command-succeeds", "schema-validates"]`, in that order.
  - `PRESET_DETAILS: Record<PresetName, Record<string, string>>` — each detail's plain-words description.
  - `GateChoice` (zod schema) and `type GateChoice` — `GateRef | GatePreset`, one discriminated union on `type`.
  - `isPresetName(value: unknown): value is PresetName`; `isPreset(gate: GateChoice): gate is GatePreset`.
  - `type CommandGate = Extract<GateRef, { type: "command" }>`.
  - `presetGate(preset: GatePreset, repoPath: string): Promise<CommandGate>` — throws `Refusal(NO_TEST_COMMAND, EXIT.configuration)` for `test-runner` with no `command` in a project with no usable `test` script.
  - `NO_TEST_COMMAND: string`.

- [ ] **Step 1: Write the failing tests**

Create `src/cli/gate-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateRef } from "../schema.js";
import { resolveGate } from "../resolve-gate.js";
import { EXIT, Refusal } from "./failures.js";
import { GatePreset, isPreset, NO_TEST_COMMAND, PRESET_DETAILS, PRESET_NAMES, presetGate } from "./gate-presets.js";
import { inferGate } from "./project.js";

/** A folder standing in for a repository, holding just the files given. */
function folder(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-presets-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const byExitCode = (command: string): GateRef => ({ type: "command", command, parseMode: "exitcode" });

describe("the ready-made checks", () => {
  it("are the four the roadmap names, in its order", () => {
    expect(PRESET_NAMES).toEqual(["test-runner", "file-exists", "command-succeeds", "schema-validates"]);
  });

  it("can say, in plain words, what every detail each one takes is", () => {
    for (const option of GatePreset.options) {
      const takes = Object.keys(option.shape).filter((key) => key !== "type").sort();
      expect(Object.keys(PRESET_DETAILS[option.shape.type.value]).sort()).toEqual(takes);
    }
  });

  it("tells a ready-made check from a written-out one", () => {
    expect(isPreset({ type: "file-exists", path: "CHANGES.md" })).toBe(true);
    expect(isPreset({ type: "command", command: "npm test", parseMode: "exitcode" })).toBe(false);
    expect(isPreset({ type: "custom", modulePath: "./gates/mine.mjs" })).toBe(false);
  });
});

describe("what each ready-made check stands for", () => {
  it.each<[GatePreset, GateRef]>([
    [{ type: "test-runner", command: "npx vitest run" }, byExitCode("npx vitest run")],
    [{ type: "file-exists", path: "CHANGES.md" }, byExitCode("test -f 'CHANGES.md'")],
    [{ type: "command-succeeds", command: "npm run lint" }, byExitCode("npm run lint")],
    [
      { type: "schema-validates", file: "data.json", schema: "data.schema.json" },
      byExitCode("npx --yes ajv-cli@5.0.0 validate -s 'data.schema.json' -d 'data.json'"),
    ],
  ])("%j is the written-out gate %j", async (preset, gateRef) => {
    expect(await presetGate(preset, folder())).toEqual(gateRef);
  });

  it("runs the project's own tests when test-runner names no command, exactly as the default check does", async () => {
    const repoPath = folder({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
    expect(await presetGate({ type: "test-runner" }, repoPath)).toEqual(await inferGate(repoPath));
  });

  it("refuses test-runner with no command in a project with no test script, naming the detail it needs", async () => {
    const err = await presetGate({ type: "test-runner" }, folder()).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Refusal);
    expect((err as Refusal).message).toBe(NO_TEST_COMMAND);
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
  });
});

describe("a ready-made check judges work as its written-out gate does", () => {
  it.each([["CHANGES.md"], ["it's the notes.md"]])("file-exists %j fails before the file is there and passes once it is", async (path) => {
    const worktreePath = folder();
    const gateRef = await presetGate({ type: "file-exists", path }, worktreePath);
    const gate = resolveGate(gateRef, worktreePath);
    const ctx = { worktreePath, taskDef: { intent: "add the file" }, gateRef };
    expect((await gate.baseline(ctx)).assertions.map((a) => a.outcome)).toEqual(["FAIL"]);
    writeFileSync(join(worktreePath, path), "one line\n");
    expect((await gate.check(ctx)).assertions.map((a) => a.outcome)).toEqual(["PASS"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/gate-presets.test.ts`
Expected: FAIL — `./gate-presets.js` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/cli/gate-presets.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/gate-presets.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/gate-presets.ts src/cli/gate-presets.test.ts
git commit -m "Define the four ready-made checks and the gates they stand for

The roadmap asks that an owner can choose a check by name. Each name is
only sugar for the built-in command gate judged by exit code, so this
module holds the names, the detail each needs, and the exact written-out
gate each becomes; nothing reads it yet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Choose a ready-made check in the config file, refused plainly when wrong and run as its written-out gate

**Files:**
- Modify: `src/cli/config.ts` (imports; `andList` extracted from `unknownCloser`; new `unknownGate`, `presetProblem`; `WHAT_IT_TAKES.gate`; `DeliveryConfig.gate`; two new branches in `describeProblem`)
- Modify: `src/cli/settings.ts` (`ProjectSettings.gatePreset`; `gateFrom` resolves a preset; `resolveProject` spreads it)
- Test: `src/cli/config.test.ts`, `src/cli/settings.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `unknownGate(type: unknown): string` (exported from `src/cli/config.ts`).
  - `DeliveryConfig.gate` is now `GateChoice.optional()`.
  - `ProjectSettings.gatePreset?: GatePreset` — set only when `gateRef` came from a preset in the file.

- [ ] **Step 1: Write the failing tests**

In `src/cli/config.test.ts`, change the import line to add `unknownGate`:

```ts
import { configCandidates, DeliveryConfig, describeProblem, findConfig, loadConfig, NO_SUCH_CONFIG, structureTask, unknownCloser, unknownGate } from "./config.js";
```

Append inside `describe("what a config file may contain", ...)`:

```ts
  it.each([
    [{ type: "test-runner" }],
    [{ type: "test-runner", command: "npx vitest run" }],
    [{ type: "file-exists", path: "CHANGES.md" }],
    [{ type: "command-succeeds", command: "npm run lint" }],
    [{ type: "schema-validates", file: "data.json", schema: "data.schema.json" }],
  ])("accepts the ready-made check %j with only the detail it needs", (gate) => {
    expect(DeliveryConfig.parse({ gate })).toEqual({ gate });
  });
```

Replace the existing `it("names a malformed check and what a check looks like", ...)` with (the copy changes on purpose, see Step 3):

```ts
  it("names a malformed check and what a check looks like", () => {
    expect(problemFor({ gate: { type: "command", command: "npm test", parseMode: "toml" } })).toBe(
      'I can\'t use delivery.config.json: the setting `gate.parseMode` is `"toml"`. ' +
        'It says how the work is checked: a ready-made check such as `{ "type": "test-runner" }`, or one written out such as ' +
        '`{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
    );
  });
```

Append inside `describe("what it says about a file it can't use", ...)`:

```ts
  it("answers a misspelt ready-made check with the four names, in one line", () => {
    const said = problemFor({ gate: { type: "file-exist", path: "CHANGES.md" } });
    expect(said).toBe(unknownGate("file-exist"));
    expect(said.split("\n")).toHaveLength(1);
  });

  it.each<[unknown, string]>([
    [{ type: "file-exists" }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "file-exists", path: "  " }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "file-exists", file: "CHANGES.md" }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "command-succeeds" }, "the ready-made check `command-succeeds` needs `command`, the command that should succeed."],
    [{ type: "schema-validates", file: "data.json" }, "the ready-made check `schema-validates` needs `schema`, the file describing the shape it should have."],
    [{ type: "test-runner", command: 7 }, "the ready-made check `test-runner` needs `command`, the command that runs your tests."],
  ])("names the detail the ready-made check %j is missing", (gate, message) => {
    expect(problemFor({ gate })).toBe(`I can't use delivery.config.json: ${message}`);
  });

  it.each<[unknown, string]>([
    [{ type: "test-runner", path: "CHANGES.md" }, "the ready-made check `test-runner` takes only `command`, so remove `path`."],
    [{ type: "file-exists", path: "CHANGES.md", command: "ls" }, "the ready-made check `file-exists` takes only `path`, so remove `command`."],
  ])("names a detail the ready-made check %j doesn't take", (gate, message) => {
    expect(problemFor({ gate })).toBe(`I can't use delivery.config.json: ${message}`);
  });
```

Add to the `it.each` list of `"never repeats the schema's own wording back (%j)"`:

```ts
    [{ gate: { type: "file-exist", path: "CHANGES.md" } }],
    [{ gate: { type: "file-exists" } }],
    [{ gate: { type: "file-exists", path: "CHANGES.md", command: "ls" } }],
    [{ gate: "file-exists" }],
```

Append a new `describe` after `describe("unknownCloser", ...)`:

```ts
describe("unknownGate", () => {
  it("lists the four ready-made checks and where to write one out in full", () => {
    expect(unknownGate("file-exist")).toBe(
      "I don't know the check `file-exist`. The ready-made checks are `test-runner`, `file-exists`, `command-succeeds` and `schema-validates`. " +
        "To write one out in full, see docs/writing-a-gate.md.",
    );
  });

  it("copes with a check type that is missing or not a string at all", () => {
    expect(unknownGate(undefined)).toMatch(/^I don't know that check\. The ready-made checks are /);
    expect(unknownGate(42)).toMatch(/^I don't know that check\. /);
  });
});
```

In `src/cli/settings.test.ts`, append inside `describe("what checks the work", ...)`:

```ts
  it("turns a ready-made check in the file into the gate it stands for, and remembers which it was", async () => {
    const gate = { type: "file-exists", path: "CHANGES.md" } as const;
    const resolved = await settings({ task: TASK }, { config: { gate } });
    expect(resolved.gateRef).toEqual({ type: "command", command: "test -f 'CHANGES.md'", parseMode: "exitcode" });
    expect(resolved.gatePreset).toEqual(gate);
  });

  it("lets --gate-command beat a ready-made check in the file, and then remembers no preset", async () => {
    const resolved = await settings({ task: TASK, gateCommand: "make check" }, { config: { gate: { type: "test-runner" } } });
    expect(resolved.gateRef).toEqual({ type: "command", command: "make check", parseMode: "exitcode" });
    expect(resolved.gatePreset).toBeUndefined();
  });

  it("remembers no preset for a written-out gate or the inferred default", async () => {
    expect((await settings({ task: TASK }, { config: { gate: NPM_TEST } })).gatePreset).toBeUndefined();
    expect((await settings({ task: TASK })).gatePreset).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts src/cli/settings.test.ts`
Expected: FAIL — `unknownGate` is not exported; preset configs are refused by `DeliveryConfig`; the settings tests see a refusal instead of a gate.

- [ ] **Step 3: Implement**

In `src/cli/config.ts`:

1. Change the schema import (drop `GateRef`, now unused here) and add the presets import:

```ts
import { CloserRef, RoleOverrides, TaskDef, Written } from "../schema.js";
import { GateChoice, isPresetName, PRESET_DETAILS, PRESET_NAMES, type PresetName } from "./gate-presets.js";
```

2. Tidy first: move the list-joining out of `unknownCloser` into one helper, and add `unknownGate` beside it (replace the existing `unknownCloser`):

```ts
/** Names as a sentence lists them, each in code: `a`, `b` and `c`. */
function andList(names: readonly string[]): string {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length < 2 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
}

/** A closer type the harness does not know, answered with the choices rather than with a schema complaint. */
export function unknownCloser(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the closer type \`${type}\`` : "that closer type";
  return (
    `I don't know ${named}. The built-in choices are ${andList(BUILT_IN_CLOSERS)}. ` +
    `To use your own, put \`{ "type": "custom", "modulePath": "./closers/mine.js" }\` in ${CONFIG_BASENAME}.json.`
  );
}

/** A check the harness does not know, answered in one line with the ready-made names rather than with a schema complaint. */
export function unknownGate(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the check \`${type}\`` : "that check";
  return `I don't know ${named}. The ready-made checks are ${andList(PRESET_NAMES)}. To write one out in full, see docs/writing-a-gate.md.`;
}
```

3. In `DeliveryConfig`, replace `gate: GateRef.optional(),` with:

```ts
    // How the work is checked: a ready-made check by name, or one written out
    // as the library takes it. Resolved to the written-out form before any run
    // starts, so a run's record never holds a name.
    gate: GateChoice.optional(),
```

4. Replace `WHAT_IT_TAKES.gate` with:

```ts
  gate:
    'It says how the work is checked: a ready-made check such as `{ "type": "test-runner" }`, or one written out such as ' +
    '`{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
```

5. Add, after `roleProblem`:

```ts
/**
 * A ready-made check with a detail missing, empty, of the wrong kind or not
 * its own, said as the one detail to fix. The first issue is enough, as
 * everywhere else: zod reports a missing detail before an extra one.
 */
function presetProblem(file: string, issue: Issue, name: PresetName): string {
  const details = PRESET_DETAILS[name];
  if (issue.code === "unrecognized_keys") {
    return `I can't use ${file}: the ready-made check \`${name}\` takes only ${andList(Object.keys(details))}, so remove \`${issue.keys[0]}\`.`;
  }
  const detail = String(issue.path[1]);
  return `I can't use ${file}: the ready-made check \`${name}\` needs \`${detail}\`, ${details[detail]}.`;
}
```

6. In `describeProblem`, immediately before `if (where === "closer.type") ...`, add:

```ts
  if (where === "gate.type") return unknownGate(valueAt(raw, issue.path));
  const gateType = valueAt(raw, ["gate", "type"]);
  if (issue.path[0] === "gate" && isPresetName(gateType)) return presetProblem(file, issue, gateType);
```

In `src/cli/settings.ts`:

1. Imports: add

```ts
import { isPreset, presetGate, type GatePreset } from "./gate-presets.js";
```

2. Add to `ProjectSettings`, after `gateRef: GateRef;`:

```ts
  /** The ready-made check the file named, when that is where `gateRef` came from: kept only to describe it by name. A run pins `gateRef` alone. */
  gatePreset?: GatePreset;
```

3. Replace `gateFrom` with:

```ts
async function gateFrom(
  flags: RunFlags,
  env: NodeJS.ProcessEnv,
  config: DeliveryConfig,
  repoPath: string,
): Promise<Pick<ProjectSettings, "gateRef" | "gatePreset">> {
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  // `exitcode` is the only parse mode that assumes nothing about the command's output,
  // so it is the one a flag can safely stand for; the rest are named in the file.
  if (command !== undefined) return { gateRef: { type: "command", command, parseMode: "exitcode" } };
  const gate = config.gate;
  if (gate === undefined) return { gateRef: await inferGate(repoPath) };
  // A name is resolved here, before anything is pinned, so a run's record holds
  // the gate itself and never a name that could later mean something else.
  if (isPreset(gate)) return { gateRef: await presetGate(gate, repoPath), gatePreset: gate };
  return { gateRef: gate };
}
```

4. In `resolveProject`'s returned object, replace `gateRef: await gateFrom(flags, env, config, repoPath),` with:

```ts
    ...(await gateFrom(flags, env, config, repoPath)),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts src/cli/settings.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors (every existing caller typed with `DeliveryConfig` still compiles, since a `GateRef` is a `GateChoice`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts src/cli/settings.ts src/cli/settings.test.ts
git commit -m "Accept a ready-made check by name in the config file

A project owner should be able to say how work is checked in a word, not
a block of settings. The presets join the written-out gates in one
discriminated union, so existing gates keep their path-accurate refusals;
a misspelt name or a missing detail is answered in one plain line; and a
run pins the written-out gate the name stands for, never the name.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `delivery validate` describes a ready-made check in plain words

**Files:**
- Modify: `src/cli/gate-presets.ts` (add `presetPhrase`)
- Modify: `src/cli/validate-command.ts` (`checkedLines` gate line)
- Modify: `README.md` (settings table `gate` row)
- Modify: `docs/writing-a-gate.md` ("The built-in command gate" opening)
- Create: `.changeset/pick-a-ready-made-check-by-name.md`
- Test: `src/cli/validate-command.test.ts`

**Interfaces:**
- Consumes: `ProjectSettings.gatePreset` (Task 2), `GatePreset` (Task 1), `unknownGate` (Task 2).
- Produces: `presetPhrase(preset: GatePreset, command: string): string` — `command` is the resolved gate's command (used by `test-runner`).

- [ ] **Step 1: Write the failing tests**

In `src/cli/validate-command.test.ts`, add `import type { GatePreset } from "./gate-presets.js";` and add `unknownGate` to the `./config.js` import. Append inside `describe("what validate says a project is set up to do", ...)`:

```ts
  it.each<[GatePreset, string, string]>([
    [{ type: "test-runner" }, "npm test", "✓ gate: runs your tests with `npm test`"],
    [{ type: "file-exists", path: "CHANGES.md" }, "test -f 'CHANGES.md'", "✓ gate: checks that CHANGES.md exists"],
    [{ type: "command-succeeds", command: "npm run lint" }, "npm run lint", "✓ gate: checks that `npm run lint` succeeds"],
    [
      { type: "schema-validates", file: "data.json", schema: "data.schema.json" },
      "npx --yes ajv-cli@5.0.0 validate -s 'data.schema.json' -d 'data.json'",
      "✓ gate: checks that data.json matches the shape in data.schema.json",
    ],
  ])("describes the ready-made check %j by what it checks", (gatePreset, command, line) => {
    const gateRef: GateRef = { type: "command", command, parseMode: "exitcode" };
    expect(checkedLines({}, project({ gateRef, gatePreset }))[2]).toBe(line);
  });
```

Append inside `describe("delivery validate on a configuration that is ready", ...)`:

```ts
  it("describes a ready-made check in the file by what it checks", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "file-exists", path: "CHANGES.md" } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ gate: checks that CHANGES.md exists\n");
    expect(exitCode).toBe(EXIT.ok);
  });
```

Add two rows to the `it.each` table of `"names %s in one plain line, with the configuration exit code"`:

```ts
    ["a misspelt ready-made check", { ...COMPLETE, gate: { type: "file-exist", path: "CHANGES.md" } }, unknownGate("file-exist")],
    [
      "a ready-made check missing its detail",
      { ...COMPLETE, gate: { type: "file-exists" } },
      "the ready-made check `file-exists` needs `path`, the file that should exist.",
    ],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: FAIL — the preset lines read `runs \`test -f 'CHANGES.md'\`` etc. (the two refusal rows already pass from Task 2; that is expected).

- [ ] **Step 3: Implement**

Append to `src/cli/gate-presets.ts`:

```ts
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
```

In `src/cli/validate-command.ts`, add `import { presetPhrase } from "./gate-presets.js";`, add after `gatePhrase`:

```ts
/** The check a run would use, by name when the file chose a ready-made one and nothing on the command line replaced it. */
function gateLine({ gateRef, gatePreset }: ProjectSettings): string {
  return gatePreset !== undefined && gateRef.type === "command" ? presetPhrase(gatePreset, gateRef.command) : gatePhrase(gateRef);
}
```

and in `checkedLines` replace `` `gate: ${gatePhrase(project.gateRef)}`, `` with:

```ts
    `gate: ${gateLine(project)}`,
```

In `README.md`, replace the `gate` row of the settings table with:

```markdown
| `gate` | What decides whether a change is good. The simplest is a ready-made check chosen by name: `{ "type": "test-runner" }` runs your tests (add `"command"` if they are not run with `npm test`), `{ "type": "file-exists", "path": "CHANGES.md" }`, `{ "type": "command-succeeds", "command": "npm run lint" }`, or `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. `delivery validate` says what the chosen check does. To write one out in full, or write your own, see [Writing a gate](docs/writing-a-gate.md). |
```

In `docs/writing-a-gate.md`, under `## The built-in command gate`, insert as the first paragraph (before "Most projects need nothing more."):

```markdown
For the common checks you need not write this out at all: `delivery.config.json` takes a
ready-made check by name, such as `{ "type": "file-exists", "path": "CHANGES.md" }`, and turns it
into exactly the command gate described here, judged by exit code. The four names are listed in
[Setting up a project](project-configuration.md#4-choose-how-the-work-is-checked-and-what-happens-to-it).
```

Create `.changeset/pick-a-ready-made-check-by-name.md`:

```markdown
---
"delivery-service": minor
---

A project can choose how its work is checked by name in `delivery.config.json`, instead of writing
the check out: `{ "type": "test-runner" }` runs the project's tests, `{ "type": "file-exists",
"path": "CHANGES.md" }` checks a file is there, `{ "type": "command-succeeds", "command": "..." }`
checks a command succeeds, and `{ "type": "schema-validates", "file": "...", "schema": "..." }`
checks a JSON file against a JSON Schema. Each takes only the detail it needs and becomes exactly
the written-out command gate before a run starts, so a run's record is unchanged. `delivery
validate` describes the chosen check in plain words ("checks that CHANGES.md exists"), answers a
misspelt name with one line listing the four, and names a missing detail. Written-out gates work
as before.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/gate-presets.ts src/cli/validate-command.ts src/cli/validate-command.test.ts README.md docs/writing-a-gate.md .changeset/pick-a-ready-made-check-by-name.md
git commit -m "Describe a ready-made check by what it checks in delivery validate

An owner who chose a check by name should read it back in the same terms,
not as the shell command it resolves to. The readme, the gate guide and
the changelog now say ready-made checks exist.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The project-configuration guide shows a ready-made check as the simplest way to choose one

**Files:**
- Modify: `docs/project-configuration.md` (step 4, "Choose how the work is checked, and what happens to it")
- Test: `tests/project-configuration-guide.test.ts`

**Interfaces:**
- Consumes: `GatePreset`, `PRESET_NAMES`, `presetGate` (Tasks 1–2); the guide test's existing `jsonBlock`, `sectionOf`, `STEP`, `EXAMPLE`, `config`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

In `tests/project-configuration-guide.test.ts`, add the import:

```ts
import { GatePreset, PRESET_NAMES, presetGate } from "../src/cli/gate-presets.js";
```

Append inside `describe("the project-configuration guide", ...)`:

```ts
  it("shows a ready-made check as the simplest way to choose one, naming all four", () => {
    const check = sectionOf(guide, STEP.check, STEP.tools);
    const shown = jsonBlock(check).gate;
    expect(GatePreset.safeParse(shown).success).toBe(true);
    expect(check.indexOf("```json")).toBeLessThan(check.indexOf("parseMode"));
    for (const name of PRESET_NAMES) expect(check).toContain(`\`${name}\``);
  });

  it("says truly that its ready-made check does exactly what the example's written-out one does", async () => {
    const shown = GatePreset.parse(jsonBlock(sectionOf(guide, STEP.check, STEP.tools)).gate);
    expect(await presetGate(shown, EXAMPLE)).toEqual(config.gate);
  });
```

In the last test, `"walks through the setup in plain words, ..."`, change the prose line so inline code (file keys and names such as `schema-validates`) is excluded as fenced blocks already are:

```ts
    // Fenced blocks and inline code are the command's own output and the file's own keys and names; the prose is the guide's.
    const prose = sectionOf(guide, "# Setting up a project", STEP.further).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "").toLowerCase();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx vitest run tests/project-configuration-guide.test.ts`
Expected: FAIL — step 4 has no ```json block (`jsonBlock` throws "no ```json block") and does not name the four checks.

- [ ] **Step 3: Update the guide**

In `docs/project-configuration.md`, replace the first paragraph of step 4 (from "`gate` is the check that decides" to "will\ndo.") with:

````markdown
`gate` is the check that decides whether the agent's work is good: the agent's own word
is never taken as proof. The simplest way to choose one is by name:

```json
{ "gate": { "type": "test-runner" } }
```

That runs your project's own tests with `npm test` and passes when they succeed. There are
four ready-made checks, and each takes only the detail it needs:

- `test-runner` runs your tests. Add `"command"` if they are not run with `npm test`.
- `file-exists` checks that a file is there: `{ "type": "file-exists", "path": "CHANGES.md" }`.
- `command-succeeds` checks that a command succeeds: `{ "type": "command-succeeds", "command": "npm run lint" }`.
- `schema-validates` checks that a JSON file has the shape another file describes:
  `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. It
  fetches its checker the first time it runs, so that run needs the network.

`delivery validate` says in plain words what the check you chose does, and if you misspell a
name it lists the four.

The example writes its check out in full instead, which does exactly the same as
`test-runner`: `"command": "npm test"` runs the tests, and `"parseMode": "exitcode"` means the
check passes when the command succeeds. Any command that succeeds when the work is good and
fails when it is not will do.
````

Leave the `closer` paragraph that follows unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && npx vitest run tests/project-configuration-guide.test.ts tests/project-configuration/6-set-up-a-whole-project-by-following-one-guide.test.ts`
Expected: PASS (the slice 6 recorded test reads the same guide, so it is run here as this task's targeted check that its vocabulary and link assertions still hold).

- [ ] **Step 5: Commit**

```bash
git add docs/project-configuration.md tests/project-configuration-guide.test.ts
git commit -m "Lead the project guide's check step with a ready-made check

Choosing a check by name is the simplest way for an owner who does not
write gate definitions, so the guide shows it first and its test proves
the named check is exactly the example's written-out one.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
