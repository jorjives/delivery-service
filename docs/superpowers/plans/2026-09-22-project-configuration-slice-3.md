# Project Configuration — Slice 3: Check Your Setup for Free Before Spending Anything

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** Add `delivery validate`: offline, with no agent and no sign-in, it either lists what it checked and ends "Ready to run." (exit 0), or states the one thing to fix (exit 2).

**Architecture:** No new checking machinery. `validate` composes what `delivery run` already does before anything is provisioned: find the config file, parse it with the existing `DeliveryConfig` schema (which already refuses every slice 1 and 2 mistake at load), resolve the project's check and closing action with the existing `resolveProject`, and load (not run) any custom gate or closer module with the existing `checkCustomModules`. Every refusal travels the existing path: a thrown `Refusal` or known harness error, rendered once by `renderFailure` in `program.ts`. Two small changes make that composition possible and honest: `loadConfig` is split so a caller can learn *which* file it found (validate must name it, and must say when there is none), and `describeProblem`'s last-resort sentence swaps zod's own wording for a plain "what this setting takes" sentence, so no problem `validate` prints carries schema vocabulary.

**Tech Stack:** Node ≥ 22, TypeScript strict (Node16 ESM, `noUncheckedIndexedAccess`), zod 4, commander 14, vitest, git. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Compose checks the estate already has: the configuration loader, the existing role-configuration validator, and the existing "load but do not run" check for custom gate and closer modules. Failures go through the existing plain-language problem describer, extended; do not add a generic validation-error library." So: `loadConfig`'s own discovery and parsing (split, not duplicated), `DeliveryConfig` for every config refusal, `resolveProject` for the check and closing action, `checkCustomModules` for modules, `describeProblem` extended in place, `renderFailure` for output. No new error class, no error-formatting or validation library, no second schema.
- **Role-configuration validator: deliberately deferred to slice 5.** This slice's file carries no role settings, so the only role configurations that exist are the shipped constants, which `createAgentPort` already validates and which no owner can change. Running `validateRoleConfig` over them here would be a check that can never fail and that no test can drive red. Slice 5 adds the `roles` key, the merge, and `validateRoleConfig` over the merged result inside `validate`, per the spec's "role merge plus `validateRoleConfig`". Recorded here so the reviewer sees the Build note was read, not missed.
- **Operability (this slice's Operational note, verbatim):** "This command needs no Claude Code executable, no sign-in and no network, and it never sets anything up or changes anything on disk. It is safe to run in CI on every push, and safe to run while a run is in progress." Honoured in Task 4: `validate` never reaches `agentSession` (pinned by a test that makes any call to it throw), never calls `prepareRunDir`, `create` or `startRun`, and a test snapshots the repository, its run records and the state folder before and after.
- **Command surface (spec, verbatim):** "`delivery validate [--config <file>] [--repo <path>] [--json]` *(new)* Never provisions, never calls an agent, needs no credential. Exit `0` clean, `2` on a named problem. `--json` is SHOULD." `--json` is slice 9's; this slice adds only `--config` and `--repo`, meaning exactly what they mean on `delivery run`.
- **Key flow (spec, verbatim):**
  ```
  $ delivery validate
  Checking delivery.config.json…
  ✓ domain description: present
  ✓ 3 tasks queued
  ✓ gate: runs `npm test`
  ✓ closer: commits to a new branch
  Ready to run.
  ```
- **No config file (spec, verbatim):** "`validate`: "No delivery.config.json found. Run `delivery init` to create one, or see the getting-started guide."" Exit 2. `run` keeps its no-config behaviour.
- **Error model (spec):** every configuration problem exits `2` (`EXIT.configuration`); `validate` never exits `3`, `4` or `5`.
- **Accessibility (spec):** "Every validation failure names the one thing to fix." No harness vocabulary ("worktree", "envelope", "surface", "case file", "role config") and no schema terms (zod's "Invalid input", "expected string, received …") in anything `validate` prints. Refusals keep `describeProblem`'s house shape, "I can't use `<file>`: …".
- **What `validate` reports is what `run` would use.** It resolves the check and closing action with `resolveProject(flags = {}, { env, repoPath, config })`, so an inferred `npm test`, the default `commit-to-branch` closer, and `DELIVERY_GATE_COMMAND` / `DELIVERY_CLOSER` / `DELIVERY_CONFIG` in the environment are honoured exactly as `run` honours them, and a project with no check at all gets `run`'s own `NO_CHECK` refusal.
- **Backwards compatibility (slice AC):** "An existing four-key configuration from before this phase validates cleanly." A file with no `domain` and no `tasks` is ready to run.
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.

## Scaffolding Impact

- `delivery --help` gains a `validate` command with its own description and `--config` / `--repo` options → Task 4 (`src/cli/program.ts`).
- `README.md` gains a "Check your setup before a run" section, and the closing sentence of "Configure it once" (which lists what stops the command before it starts) points at `delivery validate` → Task 4.
- `.changeset/check-your-setup-for-free.md`, this slice's release note, following the per-slice changeset convention (`.changeset/queue-tasks-in-plain-words.md`) → Task 4.
- The plain sentence for a malformed setting changes (no zod wording, a "what it takes" fix instead). No document quotes the old sentence; `src/cli/config.test.ts` pins it and is updated in Task 2.
- No other document needs changing. `docs/getting-started.md` and `examples/sample-project/` describe the no-config first run, which this slice leaves alone; the unified project-configuration guide that walks through `validate` is slice 6's. No new environment variable, dependency, or build/test/deploy step: the new tests run under the existing `vitest` config and `npm test`.

---

### Task 1: Let a command learn which config file it found

Tidy-first structural change: no behaviour of `delivery run` or `delivery status` changes. `validate` must print the file's name and must tell "no file" apart from "a file with nothing in it", and `loadConfig` answers both as `{}`. Split it rather than re-implement discovery.

**Files:**
- Modify: `src/cli/config.ts` (`loadConfig`, lines ~234-268)
- Test: `src/cli/config.test.ts` (imports on line 5; a new `describe` after `"naming a config file yourself"`; delete the stale two-line comment at lines ~162-163, "Updated as part of adding tasks: …" / "Now we have six: …", which narrates history rather than explaining a test)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface ConfigLookup { startDir: string; repoPath: string; flag: string | undefined; env: NodeJS.ProcessEnv }`
  - `findConfig(lookup: ConfigLookup): string | undefined` — the absolute path of the file this invocation means (named by `flag`, else a non-empty `env.DELIVERY_CONFIG`, else the nearest discovered one); `undefined` when nothing was named and none exists; throws `Refusal(NO_SUCH_CONFIG(named), EXIT.configuration)` for a named file that is not there.
  - `readConfig(file: string): Promise<DeliveryConfig>` — parses one file, refusing exactly as `loadConfig` does today.
  - `loadConfig(lookup: ConfigLookup): Promise<DeliveryConfig>` — unchanged signature and behaviour.

- [ ] **Step 1: Write the failing tests**

In `src/cli/config.test.ts`, change the import on line 5 to:

```ts
import { configCandidates, DeliveryConfig, describeProblem, findConfig, loadConfig, NO_SUCH_CONFIG, structureTask, unknownCloser } from "./config.js";
```

add `realpathSync` to the `node:fs` import on line 2:

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
```

and append this block at the end of the file:

```ts
describe("which config file a command means", () => {
  it("names the nearest file at or above the folder the command was run from", () => {
    const { repo, deep } = tree();
    const file = write(repo, "delivery.config.json", "{}");
    expect(findConfig({ startDir: deep, repoPath: repo, flag: undefined, env: {} })).toBe(realpathSync(file));
  });

  it("names nothing when there is no file, rather than inventing an empty one", () => {
    const { repo, deep } = tree();
    expect(findConfig({ startDir: deep, repoPath: repo, flag: undefined, env: {} })).toBeUndefined();
  });

  it("names the file --config points at, resolved against the folder the command was run from", () => {
    const { repo, deep } = tree();
    write(deep, "elsewhere.json", "{}");
    expect(findConfig({ startDir: deep, repoPath: repo, flag: "elsewhere.json", env: {} })).toBe(join(deep, "elsewhere.json"));
  });

  it("refuses a named file that isn't there", () => {
    const { repo } = tree();
    expect(() => findConfig({ startDir: repo, repoPath: repo, flag: "missing.json", env: {} })).toThrow(NO_SUCH_CONFIG("missing.json"));
  });
});
```

Delete these two comment lines (around line 162):

```ts
  // Updated as part of adding tasks: previously mentioned only five keys
  // Now we have six: task, tasks, domain, gate, closer, budgets
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL — `findConfig` is not exported (TypeError: findConfig is not a function, in the four new tests only).

- [ ] **Step 3: Split `loadConfig`**

In `src/cli/config.ts`, replace the whole of `loadConfig` (from its doc comment to the end of the file) with:

```ts
/** Where to look for a config file: the folder the command was run from, the repository it stops at, and whatever the person named. */
export interface ConfigLookup {
  startDir: string;
  repoPath: string;
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
}

/**
 * The config file this invocation means: the one `--config` or
 * `DELIVERY_CONFIG` names, or the nearest one at or above the folder the
 * command was run from. Nothing when nothing was named and there is none,
 * which a run treats as "use the defaults" and `validate` as the thing to say.
 * A named file that isn't there is refused rather than quietly replaced by
 * discovery.
 */
export function findConfig({ startDir, repoPath, flag, env }: ConfigLookup): string | undefined {
  // An empty DELIVERY_CONFIG is CI writing an input nobody filled in: not a
  // file called "", and not a reason to refuse before discovery has run.
  const named = flag ?? (env.DELIVERY_CONFIG || undefined);
  if (named === undefined) return configCandidates(startDir, repoPath).find((candidate) => existsSync(candidate));
  const file = resolve(startDir, named);
  if (!existsSync(file)) throw new Refusal(NO_SUCH_CONFIG(named), EXIT.configuration);
  return file;
}

/** One config file's settings, or a refusal naming the first thing wrong with it. */
export async function readConfig(file: string): Promise<DeliveryConfig> {
  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  if (!parsed.success) throw new Refusal(describeProblem(file, parsed.error, raw), EXIT.configuration);
  return parsed.data;
}

/**
 * The settings a run starts from: the file the user named, or the nearest one
 * at or above the folder they ran in, or nothing at all, which is not an error
 * because every setting has a default.
 */
export async function loadConfig(lookup: ConfigLookup): Promise<DeliveryConfig> {
  const file = findConfig(lookup);
  return file === undefined ? {} : readConfig(file);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS, every test in the file (the existing `loadConfig` tests prove the split changed nothing).

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "Split finding a config file from reading it

delivery validate has to name the file it checked and has to say when there
is none, and loadConfig answers both no file and an empty file as {}. Splitting
it into findConfig and readConfig lets validate compose the same discovery and
the same parsing run uses, rather than a copy that could drift."
```

---

### Task 2: Say what a setting takes instead of zod's complaint

`describeProblem`'s last-resort sentence ends with zod's own message, e.g. `(Invalid option: expected one of "tap"|"junit"|"exitcode")`: schema vocabulary, and no fix. `validate`'s acceptance criterion is "naming the field and the fix in everyday words with no schema vocabulary", and its Build note says to extend this describer. Replace that tail with a per-setting "what it takes" sentence, keyed on the schema's own keys so a seventh setting does not compile without one.

**Files:**
- Modify: `src/cli/config.ts` (`describeProblem`, lines ~141-189; a new `WHAT_IT_TAKES` table just above it)
- Test: `src/cli/config.test.ts` (the tests at lines ~171-195: "names a malformed value…", "names a setting given the wrong kind of value altogether", "still names a description given the wrong kind of value…")

**Interfaces:**
- Consumes: `CONFIG_KEYS`, `DeliveryConfig` (existing).
- Produces: no new export. `describeProblem(file, error, raw): string` keeps its signature; its fallback sentences become:
  - a setting: ``I can't use <file>: the setting `<path>` is `<json value>`. <WHAT_IT_TAKES[top-level key]>``
  - the file itself: ``I can't use <file>: it should hold one object of settings, using `task`, `tasks`, `domain`, `gate`, `closer` and `budgets`. A `.js` or `.mjs` file exports that object as its default.``

- [ ] **Step 1: Write the failing tests**

In `src/cli/config.test.ts`, replace the three tests "names a malformed value and the setting it belongs to", "names a setting given the wrong kind of value altogether" and "still names a description given the wrong kind of value altogether, rather than calling it empty" with:

```ts
  it("names a malformed check and what a check looks like", () => {
    expect(problemFor({ gate: { type: "command", command: "npm test", parseMode: "toml" } })).toBe(
      'I can\'t use delivery.config.json: the setting `gate.parseMode` is `"toml"`. ' +
        'It says how the work is checked, for example `{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
    );
  });

  it("names a task given as a bare sentence and what a task looks like", () => {
    expect(problemFor({ task: "add a goodbye function" })).toBe(
      'I can\'t use delivery.config.json: the setting `task` is `"add a goodbye function"`. ' +
        'It is one thing you want done, written as an object with an `intent` sentence in it: `{ "intent": "add a page" }`. ' +
        "For a list of sentences, use `tasks`.",
    );
  });

  it("still names a description given the wrong kind of value altogether, rather than calling it empty", () => {
    expect(problemFor({ domain: 42 })).toBe(
      "I can't use delivery.config.json: the setting `domain` is `42`. It is a sentence or two describing your project.",
    );
  });

  it("names a closing action's setting of the wrong kind and where the choices are described", () => {
    expect(problemFor({ closer: { type: "merge-back", deleteBranch: "yes" } })).toBe(
      'I can\'t use delivery.config.json: the setting `closer.deleteBranch` is `"yes"`. ' +
        "It says what happens to work that passes: see docs/writing-a-closer.md for the choices and what each one takes.",
    );
  });

  it("names limits given as something other than a set of limits", () => {
    expect(problemFor({ budgets: "lots" })).toBe(
      'I can\'t use delivery.config.json: the setting `budgets` is `"lots"`. ' +
        'It is a set of limits, each a whole number of attempts, for example `{ "correction": 5 }`.',
    );
  });

  it("names a file that holds something other than one object of settings", () => {
    expect(problemFor(["add a page"])).toBe(
      "I can't use delivery.config.json: it should hold one object of settings, using `task`, `tasks`, `domain`, `gate`, `closer` and `budgets`. " +
        "A `.js` or `.mjs` file exports that object as its default.",
    );
  });

  it.each([
    [{ gate: { type: "command", command: "npm test", parseMode: "toml" } }],
    [{ gate: { type: "command", parseMode: "exitcode" } }],
    [{ task: "add a goodbye function" }],
    [{ domain: 42 }],
    [{ closer: { type: "custom" } }],
    [{ budgets: "lots" }],
    [["add a page"]],
    [undefined],
  ])("never repeats the schema's own wording back (%j)", (raw) => {
    expect(problemFor(raw)).not.toMatch(/Invalid|expected|received/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL — the new `toBe` expectations get the old sentences ending `(Invalid …)`, and the `it.each` cases match `/Invalid|expected|received/`.

- [ ] **Step 3: Implement**

In `src/cli/config.ts`, add this table directly above the `describeProblem` doc comment:

```ts
/**
 * What each setting takes, said as the fix for a value of the wrong kind.
 * Keyed on the schema's own keys, so a new setting does not compile until it
 * can say what it wants. Plain words, never the schema's own complaint: the
 * reader is fixing a file, not debugging a parser.
 */
const WHAT_IT_TAKES: Record<keyof DeliveryConfig, string> = {
  task:
    'It is one thing you want done, written as an object with an `intent` sentence in it: `{ "intent": "add a page" }`. ' +
    "For a list of sentences, use `tasks`.",
  tasks: "It is a list of the things you want done, one sentence each, in the order you want them.",
  domain: "It is a sentence or two describing your project.",
  gate: 'It says how the work is checked, for example `{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
  closer: "It says what happens to work that passes: see docs/writing-a-closer.md for the choices and what each one takes.",
  budgets: 'It is a set of limits, each a whole number of attempts, for example `{ "correction": 5 }`.',
};
```

In `describeProblem`, make the "not a list at all" `tasks` branch reuse the table. Replace:

```ts
    return (
      `I can't use ${file}: \`tasks\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ` +
      "It is a list of the things you want done, one sentence each, in the order you want them."
    );
```

with:

```ts
    return `I can't use ${file}: \`tasks\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ${WHAT_IT_TAKES.tasks}`;
```

and replace the final line of `describeProblem`:

```ts
  return `I can't use ${file}: the setting \`${where || "(the file itself)"}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\` (${issue.message}).`;
```

with:

```ts
  if (where === "") {
    return (
      `I can't use ${file}: it should hold one object of settings, using ${CONFIG_KEYS}. ` +
      "A `.js` or `.mjs` file exports that object as its default."
    );
  }
  // Every other path starts at one of the schema's keys: `.strict()` names any
  // other key through the unrecognised-key branch above.
  const setting = issue.path[0] as keyof DeliveryConfig;
  return `I can't use ${file}: the setting \`${where}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ${WHAT_IT_TAKES[setting]}`;
```

(Verified while planning: zod reports these first-issue paths — `gate.parseMode`, `gate.command`, `task`, `domain`, `closer.deleteBranch`, `closer.modulePath`, `budgets`, and `[]` for both `["add a page"]` and `undefined` — so the expected sentences above are exact.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "Say what a setting takes instead of the schema's own complaint

A malformed setting ended its message with zod's wording, such as \"Invalid
option: expected one of ...\", which names no fix and is exactly the schema
vocabulary delivery validate must never print. Each setting now says what it
takes in plain words, from a table keyed on the schema's own keys so a new
setting cannot ship without one."
```

---

### Task 3: Say in plain words what a project is set up to do

The lines `validate` prints on success, as a pure function of the loaded file and the project settings `run` would use. Kept separate from the command so every phrasing (each gate type, each closer type, each task shape) is tested without a repository.

**Files:**
- Create: `src/cli/validate-command.ts`
- Test: `src/cli/validate-command.test.ts`

**Interfaces:**
- Consumes: `DeliveryConfig` (`src/cli/config.ts`), `ProjectSettings` (`src/cli/settings.ts`: `{ gateRef: GateRef; closerRef: CloserRef; budgets: BudgetSet; domainPrompt?: string }`), `GateRef` / `CloserRef` (`src/schema.ts`), `DEFAULT_BUDGETS` (`src/budgets.ts`, tests only).
- Produces: `checkedLines(config: DeliveryConfig, project: ProjectSettings): string[]` — exactly four lines, each starting `✓ `, in the order description, tasks, gate, closer.

- [ ] **Step 1: Write the failing tests**

Create `src/cli/validate-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import type { CloserRef, GateRef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { ProjectSettings } from "./settings.js";
import { checkedLines } from "./validate-command.js";

const NPM_TEST: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

function project(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { gateRef: NPM_TEST, closerRef: { type: "commit-to-branch" }, budgets: DEFAULT_BUDGETS, ...overrides };
}

describe("what validate says a project is set up to do", () => {
  it("says the description is there, how many tasks are queued, what the check runs and what the closing action does", () => {
    const config: DeliveryConfig = { domain: "A tool.", tasks: ["add a page", "add a form", "add a test"] };
    expect(checkedLines(config, project({ domainPrompt: "A tool." }))).toEqual([
      "✓ domain description: present",
      "✓ 3 tasks queued",
      "✓ gate: runs `npm test`",
      "✓ closer: commits to a new branch",
    ]);
  });

  it("says a missing description is optional, rather than calling it a problem", () => {
    expect(checkedLines({}, project())[0]).toBe("✓ domain description: none (it's optional)");
  });

  it("counts one queued task in the singular", () => {
    expect(checkedLines({ tasks: ["add a page"] }, project())[1]).toBe("✓ 1 task queued");
  });

  it("says a single task set in `task` is there", () => {
    expect(checkedLines({ task: { intent: "add a page" } }, project())[1]).toBe("✓ 1 task, set in `task`");
  });

  it("says where to give a task when the file names none, which is still ready to run", () => {
    expect(checkedLines({}, project())[1]).toBe('✓ no tasks listed: name one when you run, with `delivery run --task "..."`');
  });

  it("names a custom check by the module it lives in", () => {
    const gateRef: GateRef = { type: "custom", modulePath: "./gates/mine.mjs" };
    expect(checkedLines({}, project({ gateRef }))[2]).toBe("✓ gate: your own check, in `./gates/mine.mjs`");
  });

  it.each<[CloserRef, string]>([
    [{ type: "commit-to-branch" }, "✓ closer: commits to a new branch"],
    [{ type: "merge-back" }, "✓ closer: merges into your base branch"],
    [{ type: "open-pr" }, "✓ closer: opens a pull request"],
    [{ type: "custom", modulePath: "./closers/mine.mjs" }, "✓ closer: your own closing action, in `./closers/mine.mjs`"],
  ])("says what the closing action %j does", (closerRef, line) => {
    expect(checkedLines({}, project({ closerRef }))[3]).toBe(line);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: FAIL — `Cannot find module './validate-command.js'` (or equivalent resolve error).

- [ ] **Step 3: Implement**

Create `src/cli/validate-command.ts`:

```ts
import type { CloserRef, GateRef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { ProjectSettings } from "./settings.js";

/** What the check does, as a person reads it. Total over the gate types, so a new one does not compile until it can be described. */
function gatePhrase(gateRef: GateRef): string {
  switch (gateRef.type) {
    case "command":
      return `runs \`${gateRef.command}\``;
    case "custom":
      return `your own check, in \`${gateRef.modulePath}\``;
  }
}

/** What happens to work that passes, as a person reads it. Total over the closer types, as `outcome.ts`'s `landing` is. */
function closerPhrase(closerRef: CloserRef): string {
  switch (closerRef.type) {
    case "commit-to-branch":
      return "commits to a new branch";
    case "merge-back":
      return "merges into your base branch";
    case "open-pr":
      return "opens a pull request";
    case "custom":
      return `your own closing action, in \`${closerRef.modulePath}\``;
  }
}

/**
 * How many things the file asks for. No task at all is not a problem: `delivery
 * run --task "..."` names one each time, which is how the harness is used before
 * a project has a list.
 */
function tasksPhrase(config: DeliveryConfig): string {
  if (config.tasks) return `${config.tasks.length} ${config.tasks.length === 1 ? "task" : "tasks"} queued`;
  if (config.task) return "1 task, set in `task`";
  return 'no tasks listed: name one when you run, with `delivery run --task "..."`';
}

/**
 * One line per thing `validate` checked, in the owner's terms: the description,
 * the tasks, what the check runs and what the closing action does. The check
 * and closing action are the ones a run would use, inferred and defaulted
 * values included, so what is reported is what would happen.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config),
    `gate: ${gatePhrase(project.gateRef)}`,
    `closer: ${closerPhrase(project.closerRef)}`,
  ].map((line) => `✓ ${line}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/validate-command.ts src/cli/validate-command.test.ts
git commit -m "Say in plain words what a project is set up to do

delivery validate ends a clean check with one line per thing it looked at.
Kept as a pure function of the loaded file and the settings a run would use,
so every gate type, closer type and task shape has its phrasing pinned
without a repository, and a new type cannot compile without one."
```

---

### Task 4: `delivery validate`

The command itself: find the file (or say there is none), name it, read it, resolve the check and closing action as `run` would, load any custom module without running it, then print the lines and "Ready to run.". Every refusal is thrown and rendered by `program.ts`'s existing `renderFailure`, exactly as `run`'s are. Folded in: the `--help` entry, the README section and the changeset, because this task is what makes them true.

**Files:**
- Modify: `src/cli/validate-command.ts` (add `ValidateOptions`, `NO_CONFIG`, `READY`, `validateCommand`)
- Modify: `src/cli/program.ts` (register the command, after `status` and before `init`)
- Modify: `README.md` (new section; one sentence in "Configure it once")
- Create: `.changeset/check-your-setup-for-free.md`
- Test: `src/cli/validate-command.test.ts`

**Interfaces:**
- Consumes: `findConfig(lookup: ConfigLookup): string | undefined`, `readConfig(file: string): Promise<DeliveryConfig>` (Task 1); `checkedLines(config, project): string[]` (Task 3); existing `findRepository(path): Promise<string>` (`src/cli/project.ts`), `resolveProject(flags: RunFlags, { env, repoPath, config }): Promise<ProjectSettings>` and `checkCustomModules(gateRef, closerRef, repoPath): Promise<void>` (`src/cli/settings.ts`), `EXIT`, `Refusal`, `ExitCode` (`src/cli/failures.ts`), `CONFIG_BASENAME`, `BOTH_TASK_AND_TASKS`, `sameTask` (`src/cli/config.ts`); test fixtures `delivery`, `PACKAGE`, `writeRunRecord`, `runsRoot` (`src/cli/command-fixtures.ts`), `initTempRepo` (`src/temp-repo.ts`), `cleanGitEnv` (`src/git-env.ts`).
- Produces:
  - `interface ValidateOptions { config?: string; repo?: string }`
  - `NO_CONFIG: string`, `READY: string`
  - `validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode>`
  - `delivery validate [--config <path>] [--repo <path>]` on the command line. Slices 4, 5 and 9 build on `validateCommand`.

- [ ] **Step 1: Write the failing tests**

At the top of `src/cli/validate-command.test.ts`, replace the imports with:

```ts
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { cleanGitEnv } from "../git-env.js";
import type { CloserRef, GateRef } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, runsRoot, writeRunRecord } from "./command-fixtures.js";
import { BOTH_TASK_AND_TASKS, sameTask, type DeliveryConfig } from "./config.js";
import { EXIT } from "./failures.js";
import type { ProjectSettings } from "./settings.js";
import { checkedLines, NO_CONFIG, READY } from "./validate-command.js";

// validate must work on a machine with no Claude Code runtime and no sign-in.
// Every test in this file runs with the one way into the agent runtime made to
// fail loudly, so a validate that reached for it would fail here, not in CI.
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("validate must never start an agent");
  },
}));
```

(keep the Task 3 `NPM_TEST`, `project()` and `describe` block below the imports as they are). Then append:

```ts
const COMPLETE = {
  domain: "A small tool that greets people by name.",
  tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that waves"],
  gate: { type: "command", command: "npm test", parseMode: "exitcode" },
  closer: { type: "commit-to-branch" },
};

const WORKING_GATE =
  "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) };\n";

/** A committed repository with a test script and, unless `config` is undefined, a delivery.config.json holding it. */
function repoWith(config: unknown, files: Record<string, string> = {}): string {
  const configFile = config === undefined ? {} : { "delivery.config.json": JSON.stringify(config) };
  return initTempRepo("validate-", { "package.json": PACKAGE, ...configFile, ...files });
}

describe("delivery validate on a configuration that is ready", () => {
  it("names the file, says what it checked, ends ready to run, and needs no agent to do it", async () => {
    const repo = repoWith(COMPLETE);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "Checking delivery.config.json…",
        "✓ domain description: present",
        "✓ 3 tasks queued",
        "✓ gate: runs `npm test`",
        "✓ closer: commits to a new branch",
        READY,
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(EXIT.ok);
  });

  it("passes an existing four-setting file from before descriptions and lists", async () => {
    const repo = repoWith({
      task: { intent: "add a function that says hello" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
      budgets: { correction: 5 },
    });
    const { stdout, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ domain description: none (it's optional)");
    expect(stdout).toContain("✓ 1 task, set in `task`");
    expect(stdout).toContain("✓ closer: merges into your base branch");
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("loads a custom check without running it", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gate.mjs" } }, { "gate.mjs": WORKING_GATE });
    const { stdout, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ gate: your own check, in `./gate.mjs`");
    expect(exitCode).toBe(EXIT.ok);
  });

  it("checks the repository --repo names, from anywhere", async () => {
    const repo = repoWith(COMPLETE);
    const elsewhere = mkdtempSync(join(tmpdir(), "validate-elsewhere-"));
    const { stdout, exitCode } = await delivery(["validate", "--repo", repo], { cwd: elsewhere });
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("checks the file --config names", async () => {
    const repo = repoWith(undefined, { "elsewhere.json": JSON.stringify(COMPLETE) });
    const { stdout, exitCode } = await delivery(["validate", "--config", "elsewhere.json"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe("Checking elsewhere.json…");
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });
});

describe("delivery validate on a configuration with a problem", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["an empty description", { ...COMPLETE, domain: "  " }, "`domain` is empty. Describe your project in a sentence or two, or remove it."],
    ["an empty list", { ...COMPLETE, tasks: [] }, "`tasks` is empty. Add at least one sentence describing what you want done"],
    [
      "an empty entry",
      { ...COMPLETE, tasks: ["add a function that says hello", "", "add a function that waves"] },
      "`tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.",
    ],
    [
      "two entries that are the same task",
      { ...COMPLETE, tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that says hello"] },
      sameTask(1, 3),
    ],
    ["both a single task and a list", { ...COMPLETE, task: { intent: "add a page" } }, BOTH_TASK_AND_TASKS],
  ])("names %s in one plain line, with the configuration exit code", async (_, config, message) => {
    const repo = repoWith(config);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain(message);
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(stdout).not.toContain(READY);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("names a custom check that can't be loaded", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom gate at `./gates/nope.mjs`");
    expect(stdout).not.toContain(READY);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("names a custom closing action that can't be loaded", async () => {
    const repo = repoWith({ ...COMPLETE, closer: { type: "custom", modulePath: "./closers/nope.mjs" } });
    const { stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom closer at `./closers/nope.mjs`");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says there is no config file, and where to get one", async () => {
    const repo = repoWith(undefined);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe(`${NO_CONFIG}\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });
});

describe("delivery validate changes nothing", () => {
  /** Everything validate could have touched: git's view of the repository, every byte of every run record, and the state folder. */
  function snapshot(repo: string, state: string) {
    const records = readdirSync(runsRoot(repo), { recursive: true, encoding: "utf-8" })
      .sort()
      .map((path) => {
        const full = join(runsRoot(repo), path);
        return statSync(full).isFile() ? `${path}\n${readFileSync(full, "utf-8")}` : path;
      });
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });
    return { status, records, state: readdirSync(state) };
  }

  it("leaves the repository, a run's record and the state folder exactly as they were", async () => {
    const repo = repoWith(COMPLETE);
    await writeRunRecord(repo, { runId: "add-a-function-that-says-hello-20260914T210309Z", task: "add a function that says hello" });
    const state = mkdtempSync(join(tmpdir(), "validate-state-"));
    const before = snapshot(repo, state);

    const { exitCode } = await delivery(["validate"], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(exitCode).toBe(EXIT.ok);
    expect(snapshot(repo, state)).toEqual(before);
    expect(before.state).toEqual([]);
  });
});
```

`DEFAULT_BUDGETS`, `CloserRef`, `GateRef`, `ProjectSettings`, `DeliveryConfig` and `checkedLines` are used by the Task 3 block.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: FAIL — `NO_CONFIG` and `READY` are not exported, and every `delivery(["validate"], …)` call exits `EXIT.configuration` with commander's "unknown command 'validate'" on stderr.

- [ ] **Step 3: Implement the command**

Add to the top of `src/cli/validate-command.ts`, replacing its imports:

```ts
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CloserRef, GateRef } from "../schema.js";
import { CONFIG_BASENAME, findConfig, readConfig, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { checkCustomModules, resolveProject, type ProjectSettings } from "./settings.js";

/** What `delivery validate` was given on the command line: the two options it shares with `delivery run`. */
export interface ValidateOptions {
  config?: string;
  repo?: string;
}

export const NO_CONFIG = `No ${CONFIG_BASENAME}.json found. Run \`delivery init\` to create one, or see the getting-started guide (docs/getting-started.md).`;

export const READY = "Ready to run.";
```

and append to the end of the file:

```ts
/**
 * `delivery validate`: check the project's configuration the way `delivery
 * run` would before it set anything up, and stop there. Everything it does is a
 * read: find the file, parse it, work out the check and closing action a run
 * would use, and load (never run) any module of the project's own. So it needs
 * no agent, no sign-in and no network, and is safe beside a run in progress.
 * The first problem is thrown and rendered as every command's are: one plain
 * sentence, the configuration exit code.
 */
export async function validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  // `run` treats no file as "use the defaults"; asked to check a setup, there is
  // no setup to check, and saying "ready" would be a guess.
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  // Both sides real: discovery answers with real paths and a named file may not be one.
  ctx.writeLine(`Checking ${relative(realpathSync(ctx.cwd), realpathSync(file))}…`);
  const config = await readConfig(file);
  // No flags: validate checks what the project says, with the environment a run here would also see.
  const project = await resolveProject({}, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  for (const line of checkedLines(config, project)) ctx.writeLine(line);
  ctx.writeLine(READY);
  return EXIT.ok;
}
```

(`realpathSync` on both sides matters because `configCandidates` returns real paths while a `--config` path is only resolved: on a machine whose temp folder is a symlink, a plain `relative` would print a `../../private/…` path.)

- [ ] **Step 4: Register the command**

In `src/cli/program.ts`, add the import beside the others:

```ts
import { validateCommand, type ValidateOptions } from "./validate-command.js";
```

and, after the `status` command's registration and before `init`'s, add:

```ts
  program
    .command("validate")
    .description(
      "check your config file is ready to run, without starting anything: no agent, no sign-in and no network, and nothing on disk changes",
    )
    .option("--config <path>", "check this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to check (default: the current folder)")
    .action(async (options: ValidateOptions, command: Command) => {
      exitCode = await validateCommand(options, contextFor(io, command));
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: PASS, including the Task 3 tests. Then `npx eslint src/cli/validate-command.ts src/cli/validate-command.test.ts src/cli/program.ts && npx tsc --noEmit` — expected: no output.

- [ ] **Step 6: Document it**

In `README.md`, in "Configure it once", replace the paragraph:

```markdown
An unknown setting, a limit that is not a whole number, a closer type the harness doesn't know
or a custom module it can't load all stop the command before it starts, naming what to fix.
```

with:

```markdown
An unknown setting, a limit that is not a whole number, a closer type the harness doesn't know
or a custom module it can't load all stop the command before it starts, naming what to fix.
`delivery validate` finds the same mistakes without starting anything.
```

and insert this section directly before `## Documentation`:

````markdown
## Check your setup before a run

```bash
delivery validate
```

It reads your `delivery.config.json` the way `delivery run` would, says what it found, and stops:

```
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

If something is wrong it prints the one thing to fix instead, such as an empty task or two
tasks that say the same thing, and exits 2. It never starts an agent, needs no sign-in and no
network, and changes nothing on disk, so it is safe in CI on every push and safe while a run
is going. `--config <path>` and `--repo <path>` mean what they mean on `delivery run`.
````

Create `.changeset/check-your-setup-for-free.md`:

```markdown
---
"delivery-service": minor
---

`delivery validate` checks a project's configuration before anything runs. It reads
`delivery.config.json` the way `delivery run` would, then either lists what it found (the project
description, how many tasks are queued, what the check runs and what happens to work that
passes) and ends "Ready to run.", or prints the one thing to fix and exits 2. It catches every
mistake a run would refuse at the start, including an empty description, an empty list or entry,
two entries that are the same task, both `task` and `tasks` set, and a custom check or closing
action whose module can't be loaded. It needs no agent, no sign-in and no network, changes
nothing on disk, and takes the same `--config` and `--repo` options as `delivery run`. A setting
of the wrong kind is now described by what it takes, rather than by the schema's own complaint.
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/validate-command.ts src/cli/validate-command.test.ts src/cli/program.ts README.md .changeset/check-your-setup-for-free.md
git commit -m "Add delivery validate to check a setup before any run

An owner should learn about a broken configuration in a second and for free,
not an hour into an unattended run. validate composes what run already does
before it sets anything up (find and parse the file, work out the check and
closing action, load custom modules without running them) and stops there, so
it needs no agent, no sign-in and no network, and changes nothing on disk."
```
