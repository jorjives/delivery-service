# Project Configuration — Slice 9: Get Every Configuration Problem at Once, in a Form Scripts Can Read

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 9 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** `delivery validate --json` prints one JSON document, `{ "ready": <bool>, "problems": [{ "field": <string|null>, "message": <string> }] }`, listing every problem in the configuration with the same plain-language message the human form gives, and exits with the same code the human form would; without `--json` nothing changes.

**Architecture:** The one place that turns a zod issue into a sentence (`describeProblem` in `src/cli/config.ts`) becomes `configProblems`, which describes *every* issue (one per unknown key) with the setting it concerns; `readConfig` throws the first of that list, so the plain form's one line is by construction the JSON list's first message. `validate-command.ts` gains a `--json` branch that collects problems instead of throwing: every shape problem at once, then (only once the shape is right) the first problem from resolving the check and closing action a run would use. Anything that would be a configuration refusal in the plain form becomes a problem in the list; anything else (a bug, a `.js` config that throws) still goes to standard error exactly as today, so exit codes cannot diverge. Post-shape refusals carry the setting they concern on `Refusal.field`.

**Tech Stack:** Node ≥ 22, TypeScript strict (`noUncheckedIndexedAccess`), zod 4, commander, vitest, changesets. No new dependency.

## Global Constraints

- **Build note (verbatim):** "Follow the existing `--json` convention on `run` and `status`. If an editor schema for the configuration file is offered alongside, generate it with the schema library's built-in JSON Schema output, which the estate already uses; add no dependency."
  - Convention followed: the global `--json` option, read through `ctx.json` (`src/cli/program.ts` `contextFor`); one pretty-printed document on standard output via `ctx.writeLine(JSON.stringify(value, null, 2))`, exactly as `status --json` does (`src/cli/status-command.ts:217,278`); exit codes unchanged; nothing but JSON on standard output.
  - **No editor schema in this slice.** The slice says "if … offered"; nothing asks for it and no AC covers it. Add it with `z.toJSONSchema(DeliveryConfig)` when someone asks for editor completion.
- **Spec, reuse-estate:** plain-language errors extend the existing `describeProblem` machinery (no `zod-validation-error`, no second loader, no second message table). The JSON messages are produced by the very same function the plain form uses.
- **Spec, DX:** `validate` needs no agent, no credential and no network, with or without `--json`. The existing `vi.mock("./agent-session.js")` guard in `src/cli/validate-command.test.ts` covers the new tests too.
- **Unchanged behaviour (AC):** without `--json`, `delivery validate` prints exactly what it prints today: the first problem, one line, standard error, exit 2; or the ticked lines and "Ready to run.", exit 0. Every existing test in `src/cli/validate-command.test.ts` and `src/cli/config.test.ts` must still pass unmodified in its assertions.
- **JSON shape (decided here):** `{ "ready": boolean, "problems": Array<{ "field": string | null, "message": string }> }`.
  - `field` is the setting's path as written in the file, dot-joined, array positions counted from 0 as a script indexes them (`"domain"`, `"tasks.1"`, `"roles.worker.systemPromptFragment"`, `"gate.type"`). An unknown key's field is the key itself at its place (`"foo"`, `"roles.triage"`, `"gate.extra"`). `null` means the problem is with the file as a whole or with no single setting (no file found, not valid JSON, not an object, not a git repository).
  - `message` is byte-for-byte what the plain form prints for that problem when it is the first one.
  - Problems are listed in the order zod reports them (schema key order), so the list is deterministic.
- **Exit codes (AC):** `ready: true` → `EXIT.ok` (0); `ready: false` → `EXIT.configuration` (2). Only errors that `renderFailure` renders with `EXIT.configuration` become problems; any other error is re-thrown and rendered by `runCli` on standard error exactly as without `--json`.
- **Known ceiling (mark with a `ponytail:` comment):** once the file's shape is right, the remaining checks (resolving the check and closing action a run would use, loading the project's own modules) stop at the first failure, so at most one such problem is listed. Upgrade path: check the gate and closer modules independently if CI users meet both at once.
- **Copy:** British English; no em-dashes in anything a person reads (messages, README, guide, changeset). The project-configuration guide's prose (outside code) must not use "worktree", "envelope", "surface", "case file", "role config" or "schema".
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Running a targeted test:** `src/` unit tests run directly: `npx vitest run <file>`. Before each commit also run `npx tsc --noEmit` and `npx eslint <changed files>`.

## Scaffolding Impact

- **Reactive:** `src/cli/program.ts` global `--json` option help text ("one JSON document from status") must now mention `validate` → Task 2.
- **Reactive:** `README.md` "Check your setup before a run" says validate "prints the one thing to fix"; add the `--json` form listing every problem → Task 2.
- **Reactive:** `README.md` line "`--json` works on `delivery resume` and `delivery status` too." → add `delivery validate` → Task 2.
- **Reactive:** `docs/project-configuration.md` step 6 says validate "prints the one thing to fix" and recommends CI; add one sentence pointing CI at `--json` → Task 2.
- **Reactive:** changelog: new pending minor changeset `.changeset/validate-every-problem-as-json.md` → Task 2.
- **Reactive:** the `Refusal` class doc comment in `src/cli/failures.ts` gains the `field` it now carries → Task 3.
- No new command, env var, dependency or build step. No `CLAUDE.md` / `AGENTS.md` in the repo. `docs/superpowers/specs/*` and existing changesets are history and stay as written.

---

### Task 1: Describe every problem with a config file's shape, each with the setting it concerns

Refactor-plus-behaviour inside `src/cli/config.ts`. `describeProblem` (first issue only) becomes `configProblems` (every issue), and `readConfig` is rebuilt on a new non-throwing `checkConfig`. The plain form's behaviour is unchanged because `readConfig` throws the first problem's message, which is exactly what `describeProblem` returned.

**Files:**
- Modify: `src/cli/config.ts` (the `describeProblem` function and its doc comment, `readConfig`)
- Test: `src/cli/config.test.ts` (the `problemFor` helper at the top, import line 5, plus a new `describe` block)

**Interfaces:**
- Consumes: `DeliveryConfig`, `Refusal`, `EXIT` (already in the file).
- Produces (exported from `src/cli/config.ts`):
  - `interface ConfigProblem { field: string | null; message: string }`
  - `configProblems(file: string, error: z.ZodError, raw: unknown): ConfigProblem[]` — replaces `describeProblem`, which is deleted.
  - `type ConfigCheck = { ok: true; config: DeliveryConfig } | { ok: false; problems: ConfigProblem[] }`
  - `checkConfig(file: string): Promise<ConfigCheck>` — reads and parses the file; still throws the existing `Refusal` for a `.json` file that is not valid JSON (that is not a shape problem).
  - `readConfig(file: string): Promise<DeliveryConfig>` — unchanged signature and behaviour.

- [ ] **Step 1: Write the failing tests**

In `src/cli/config.test.ts`, change the import on line 5 from `describeProblem` to `configProblems, checkConfig` (keep the others):

```ts
import { checkConfig, configCandidates, configProblems, DeliveryConfig, findConfig, loadConfig, NO_SUCH_CONFIG, structureTask, unknownCloser, unknownGate } from "./config.js";
```

Replace the `problemFor` helper (lines 10-15) with:

```ts
/** Every problem the command would report for a config file it refuses, in order. */
function problemsFor(raw: unknown) {
  const parsed = DeliveryConfig.safeParse(raw);
  if (parsed.success) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return configProblems(FILE, parsed.error, raw);
}

/** The message the command would print for a config file it refuses: the first problem, as the plain form shows it. */
function problemFor(raw: unknown): string {
  const [first] = problemsFor(raw);
  if (first === undefined) throw new Error(`expected a problem for ${JSON.stringify(raw)}`);
  return first.message;
}
```

Append a new block at the end of the file (it uses `mkdtempSync`, `writeFileSync`, `tmpdir`, `join`, already imported):

```ts
describe("every problem with a config file's shape, at once", () => {
  it("lists each problem with the setting it concerns, in the words the plain form uses for it alone", () => {
    expect(problemsFor({ domain: " ", tasks: ["add a page", ""] })).toEqual([
      { field: "tasks.1", message: `I can't use ${FILE}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.` },
      { field: "domain", message: `I can't use ${FILE}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.` },
    ]);
  });

  it("gives each unknown key its own problem, named at its place", () => {
    expect(problemsFor({ foo: 1, roles: { triage: {} } })).toEqual([
      {
        field: "roles.triage",
        message: `I can't use ${FILE}: \`roles\` has no role called \`triage\`. Only \`worker\` and \`gateMaintenance\` can be changed here, so remove it to keep the built-in one.`,
      },
      {
        field: "foo",
        message: `I can't use ${FILE}: there's no setting called \`foo\`. A config file takes only \`task\`, \`tasks\`, \`domain\`, \`roles\`, \`gate\`, \`closer\` and \`budgets\`.`,
      },
    ]);
    expect(problemsFor({ foo: 1, bar: 2 }).map((problem) => problem.field)).toEqual(["foo", "bar"]);
  });

  it("names no field for a file that is not an object of settings at all", () => {
    expect(problemsFor("add a page")).toEqual([
      {
        field: null,
        message: `I can't use ${FILE}: it should hold one object of settings, using \`task\`, \`tasks\`, \`domain\`, \`roles\`, \`gate\`, \`closer\` and \`budgets\`. A \`.js\` or \`.mjs\` file exports that object as its default.`,
      },
    ]);
  });

  it("keeps every problem of a written-out gate at its own path", () => {
    expect(problemsFor({ gate: { type: "command" } }).map((problem) => problem.field)).toEqual(["gate.command", "gate.parseMode"]);
  });
});

describe("checking a config file without refusing it", () => {
  function fileHolding(config: unknown): string {
    const file = join(mkdtempSync(join(tmpdir(), "check-config-")), "delivery.config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  }

  it("returns the settings of a file with nothing wrong", async () => {
    expect(await checkConfig(fileHolding({ domain: "A tool." }))).toEqual({ ok: true, config: { domain: "A tool." } });
  });

  it("returns every problem of a file with several, the first being the one readConfig refuses with", async () => {
    const file = fileHolding({ domain: "", tasks: ["add a page", ""] });
    const checked = await checkConfig(file);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.problems.map((problem) => problem.field)).toEqual(["tasks.1", "domain"]);
    const refusal = await refusalOf(loadConfig({ startDir: dirname(file), repoPath: dirname(file), flag: file, env: {} }));
    expect(refusal.message).toBe(checked.problems[0]?.message);
  });
});
```

Add `dirname` to the `node:path` import on line 4: `import { dirname, join } from "node:path";`. (`refusalOf` is defined at line 387 as an `async function`, hoisted, so it is usable here.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL: `configProblems` and `checkConfig` are not exported (import errors / "is not a function").

- [ ] **Step 3: Implement**

In `src/cli/config.ts`:

(a) Replace the doc comment and signature of `describeProblem` and its first four lines. The body of the old function (everything from `const where = issue.path.join(".");` to the final `return` of the general sentence) becomes a private `describeIssue`, unchanged except that it takes the issue directly:

```ts
/** One problem with a config file, as a script reads it: the setting it concerns, and the sentence a person is shown. */
export interface ConfigProblem {
  /** The setting's path as written in the file, dot-joined, array positions from 0; null when the problem is with the file as a whole. */
  field: string | null;
  message: string;
}

/** Where an issue sits in the file: an unknown key is named at its own place, not at the object that holds it. */
function fieldOf(issue: Issue): string | null {
  const path = issue.code === "unrecognized_keys" ? [...issue.path, issue.keys[0] ?? ""] : issue.path;
  return path.length === 0 ? null : path.join(".");
}

/**
 * One plain-language sentence about one thing wrong with a config file,
 * naming the key or the value. The plain form shows the first of these and
 * stops, because a list of schema complaints is the stack trace that command
 * exists to avoid; `validate --json` lists them all, each in the same words.
 */
function describeIssue(file: string, issue: Issue, raw: unknown): string {
  const where = issue.path.join(".");
  // ... the rest of the old describeProblem body, unchanged ...
}

/**
 * Every problem with a config file's shape, in the order they were found, each
 * said exactly as it would be said alone. zod reports several unknown keys in
 * one issue; each is its own problem here, so each is named.
 */
export function configProblems(file: string, error: z.ZodError, raw: unknown): ConfigProblem[] {
  return error.issues
    .flatMap((issue) => (issue.code === "unrecognized_keys" ? issue.keys.map((key) => ({ ...issue, keys: [key] })) : [issue]))
    .map((issue) => ({ field: fieldOf(issue), message: describeIssue(file, issue, raw) }));
}
```

Delete the old `describeProblem` export entirely (the `const issue = error.issues[0]; if (!issue) return ...` lines go with it). `describeIssue` names `issue.keys[0]` exactly as `describeProblem` did, and zod's first unknown key stays first, so the plain form's first message is unchanged.

(b) Replace `readConfig` with `checkConfig` plus a `readConfig` built on it:

```ts
/** What a config file holds: its settings, or every problem with its shape. A file that is not valid JSON is still refused outright. */
export type ConfigCheck = { ok: true; config: DeliveryConfig } | { ok: false; problems: ConfigProblem[] };

export async function checkConfig(file: string): Promise<ConfigCheck> {
  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false, problems: configProblems(file, parsed.error, raw) };
}

/** One config file's settings, or a refusal naming the first thing wrong with it. */
export async function readConfig(file: string): Promise<DeliveryConfig> {
  const checked = await checkConfig(file);
  if (checked.ok) return checked.config;
  throw new Refusal(checked.problems[0]?.message ?? `I can't use ${file}.`, EXIT.configuration);
}
```

(The `?? \`I can't use ${file}.\`` keeps the old empty-issues fallback that `noUncheckedIndexedAccess` needs; zod never fails with no issues.)

Then `grep -rn describeProblem src tests docs README.md` and update any remaining reference (doc comments in `src/cli/config.ts` and `src/cli/validate-command.ts` that say "`describeProblem`" → "`configProblems`"). Specs under `docs/superpowers/specs/` and `docs/prd/` are history: leave them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts src/cli/validate-command.test.ts`
Expected: PASS, including every pre-existing plain-form assertion (proves the plain form is unchanged).
Run: `npx tsc --noEmit && npx eslint src/cli/config.ts src/cli/config.test.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "Describe every problem with a config file's shape, not only the first

validate --json must list every problem at once, each in the same words the
plain form uses. Turning the one-issue describer into one that describes every
issue, and having readConfig refuse with the first of that list, makes the
plain form's line and the list's first message the same string by construction
rather than by a second copy of the wording.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `delivery validate --json` prints one result listing every problem

**Files:**
- Modify: `src/cli/validate-command.ts` (`readProject`, `validateCommand`; new `settleProject`, `findProblems`)
- Modify: `src/cli/program.ts` (the global `--json` option's help text)
- Modify: `README.md` ("Check your setup before a run" section; the "`--json` works on …" sentence)
- Modify: `docs/project-configuration.md` (step 6, "## 6. Check your setup")
- Create: `.changeset/validate-every-problem-as-json.md`
- Test: `src/cli/validate-command.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: `checkConfig`, `ConfigProblem` from `src/cli/config.ts` (Task 1); `renderFailure`, `EXIT` from `src/cli/failures.ts`; `resolveProject`, `checkCustomModules` from `src/cli/settings.ts`; `ctx.json` from `CommandContext`.
- Produces (exported from `src/cli/validate-command.ts`):
  - `interface Validation { ready: boolean; problems: ConfigProblem[] }`
  - `findProblems(options: ValidateOptions, ctx: CommandContext): Promise<ConfigProblem[]>`
  - `readProject` keeps its signature (used by `preview-command.ts`).
  - Task 3 replaces the `field: null` in `findProblems`'s `catch` with `settingOf(err)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/validate-command.test.ts` (it already imports `delivery`, `EXIT`, `NO_CONFIG`, `READY`, `repoWith`, `COMPLETE`):

```ts
/** What `delivery validate --json` printed, parsed, beside what the plain form printed for the same project. */
async function bothForms(repo: string, env: Record<string, string> = {}) {
  const json = await delivery(["validate", "--json"], { cwd: repo, env });
  const plain = await delivery(["validate"], { cwd: repo, env });
  return { json: { ...json, result: JSON.parse(json.stdout) as unknown }, plain };
}

describe("delivery validate --json", () => {
  it("says a clean configuration is ready with no problems, as the only thing on standard output", async () => {
    const { json, plain } = await bothForms(repoWith(COMPLETE));
    expect(json.result).toEqual({ ready: true, problems: [] });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.ok);
    expect(plain.exitCode).toBe(EXIT.ok);
  });

  it("lists every problem at once, each naming its field, the first in exactly the plain form's words", async () => {
    const repo = repoWith({ ...COMPLETE, domain: "", tasks: ["add a function that says hello", ""] });
    const { json, plain } = await bothForms(repo);
    expect(json.result).toEqual({
      ready: false,
      problems: [
        { field: "tasks.1", message: expect.stringContaining("`tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.") },
        { field: "domain", message: expect.stringContaining("`domain` is empty. Describe your project in a sentence or two, or remove it.") },
      ],
    });
    const { problems } = json.result as { problems: { message: string }[] };
    expect(plain.stderr).toBe(`${problems[0]?.message}\n`);
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });

  it("uses the plain form's words for a problem found after the shape is right", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } });
    const { json, plain } = await bothForms(repo);
    const { problems } = json.result as { problems: { message: string }[] };
    expect(problems).toHaveLength(1);
    expect(plain.stderr).toBe(`${problems[0]?.message}\n`);
    expect(json.exitCode).toBe(plain.exitCode);
  });

  it.each<[string, string, string]>([
    ["no config file at all", "", NO_CONFIG],
    ["a config file that is not valid JSON", "{ nope", "isn't valid JSON"],
  ])("lists %s as a problem with no field, with the configuration exit code", async (_, text, message) => {
    const repo = repoWith(undefined, text === "" ? {} : { "delivery.config.json": text });
    const { json, plain } = await bothForms(repo);
    expect(json.result).toEqual({ ready: false, problems: [{ field: null, message: expect.stringContaining(message) }] });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts -t "delivery validate --json"`
Expected: FAIL: `JSON.parse` throws on the plain form's "Checking delivery.config.json…" output (the `--json` flag is currently ignored by `validate`).

- [ ] **Step 3: Implement the command**

In `src/cli/validate-command.ts`:

Imports: change the config import to `import { checkConfig, CONFIG_BASENAME, findConfig, readConfig, type ConfigProblem, type DeliveryConfig } from "./config.js";` and the failures import to `import { EXIT, Refusal, renderFailure, type ExitCode } from "./failures.js";`.

Replace `readProject` with `readProject` built on a new `settleProject`, and add `findProblems` and `Validation`:

```ts
export async function readProject(
  file: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await readConfig(file);
  return { config, project: await settleProject(config, repoPath, env) };
}

/** The check and closing action a run would use (no flags, this environment), with any module of the project's own loaded but never run. */
async function settleProject(config: DeliveryConfig, repoPath: string, env: NodeJS.ProcessEnv): Promise<ProjectSettings> {
  const project = await resolveProject({}, { env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  return project;
}

/** What `validate --json` prints: whether a run could start, and everything in the way. */
export interface Validation {
  ready: boolean;
  problems: ConfigProblem[];
}

/**
 * Every problem `validate` finds, for a script: every problem with the file's
 * shape together, then what resolving it the way a run would turns up. Whatever
 * the plain form would refuse with the configuration exit code is a problem
 * here, in the same words; anything else is not a problem with the
 * configuration, so it is thrown and rendered as every command's failures are,
 * which keeps the exit codes of the two forms the same.
 */
export async function findProblems(options: ValidateOptions, ctx: CommandContext): Promise<ConfigProblem[]> {
  try {
    const { repoPath, file } = await locateConfig(options, ctx);
    const checked = await checkConfig(file);
    if (!checked.ok) return checked.problems;
    // ponytail: past the shape, only the first failure (the check or closing action a run would use, or a module
    // of the project's own) is listed; check the gate and closer modules separately if CI needs both at once.
    await settleProject(checked.config, repoPath, ctx.env);
    return [];
  } catch (err) {
    const { message, exitCode } = renderFailure(err);
    if (exitCode !== EXIT.configuration) throw err;
    return [{ field: null, message }];
  }
}
```

In `validateCommand`, add the `--json` branch as its first statement (the rest of the function is unchanged):

```ts
  if (ctx.json) {
    const problems = await findProblems(options, ctx);
    const validation: Validation = { ready: problems.length === 0, problems };
    ctx.writeLine(JSON.stringify(validation, null, 2));
    return validation.ready ? EXIT.ok : EXIT.configuration;
  }
```

Update `validateCommand`'s doc comment to add: "With `--json` it prints one document instead, listing every problem it finds rather than the first, with the same exit code."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts src/cli/preview-command.test.ts`
Expected: PASS (preview still uses `readProject`).

- [ ] **Step 5: Update the help text and the docs this changes**

`src/cli/program.ts`, the global option:

```ts
    .option("--json", "print machine-readable output: one JSON object per step while a run happens, and one JSON document from status and validate")
```

`README.md`, in "## Check your setup before a run", after the paragraph ending "…`--config <path>` and `--repo <path>` mean what they mean on `delivery run`.", add:

````markdown
For CI, add `--json` to get every problem at once instead of the first, as one JSON document:

```bash
delivery validate --json
```

```json
{
  "ready": false,
  "problems": [
    { "field": "tasks.1", "message": "I can't use …/delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it." },
    { "field": "domain", "message": "I can't use …/delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it." }
  ]
}
```

Each problem names the setting it concerns (list positions count from 0, and `null` means the
file as a whole) and says it in the same words as the plain form. A clean file gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`.
````

`README.md`, the sentence "`--json` works on `delivery resume` and `delivery status` too." becomes "`--json` works on `delivery resume`, `delivery status` and `delivery validate` too."

`docs/project-configuration.md`, step 6, after "…run it as often as you like, and in CI on every push." add the sentence: "In CI, `delivery validate --json` lists every problem at once, each with the setting it concerns, as one JSON document a script can read." (Prose only; no forbidden words.)

Create `.changeset/validate-every-problem-as-json.md`:

```markdown
---
"delivery-service": minor
---

`delivery validate --json` prints one JSON document saying whether the configuration is ready
and listing every problem in it, not only the first, each with the setting it concerns and the
same plain-language message the plain form gives. A clean configuration gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`, and
without it `delivery validate` still shows the first problem in one line.
```

Run: `npx vitest run src/cli/report.test.ts -t "offers --json"` (it checks the help mentions `--json`), then `npm run build && npx vitest run tests/project-configuration-guide.test.ts` (the guide-as-test; also checks guide prose for forbidden words).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/validate-command.ts src/cli/validate-command.test.ts src/cli/program.ts README.md docs/project-configuration.md .changeset/validate-every-problem-as-json.md
git commit -m "Add delivery validate --json, listing every configuration problem at once

Teams that gate merges on a valid configuration need the whole list in one
pass rather than a fix-and-retry loop. The JSON form follows run's and status's
convention, one document on standard output with unchanged exit codes, and
lists the same sentences the plain form shows, which is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Name the setting a problem found after the shape is right concerns

After Task 2 a problem from resolving the check or closing action, or loading a module, is listed with `field: null`. This task makes it name `gate` or `closer`.

**Files:**
- Modify: `src/cli/failures.ts` (`Refusal`)
- Modify: `src/cli/project.ts:54` (`inferGate`'s `NO_CHECK` refusal)
- Modify: `src/cli/gate-presets.ts:76` (`presetGate`'s `NO_TEST_COMMAND` refusal)
- Modify: `src/cli/settings.ts:117` (`closerFrom`'s `unknownCloser` refusal)
- Modify: `src/cli/validate-command.ts` (`settingOf`)
- Test: `src/cli/validate-command.test.ts` (inside the `delivery validate --json` block)

**Interfaces:**
- Consumes: `findProblems` from Task 2 (its `catch` returns `[{ field: null, message }]`).
- Produces: `Refusal` constructor becomes `new Refusal(message: string, exitCode: ExitCode, field?: string)`, with `readonly field?: string`: the config setting a refusal is about, when it is about one. Existing two-argument calls are unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/validate-command.test.ts` imports: `import { NO_CHECK } from "./project.js";`, `import { NO_TEST_COMMAND } from "./gate-presets.js";` (merge with the existing `type GatePreset` import), and add `unknownCloser` to the existing `./config.js` import. Then inside `describe("delivery validate --json", …)`:

```ts
  it.each<[string, Record<string, unknown>, Record<string, string>, Record<string, string>, string, string]>([
    ["a custom check that can't be loaded", { ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } }, {}, {}, "gate", "Couldn't load the custom gate at `./gates/nope.mjs`"],
    ["a custom closing action that can't be loaded", { ...COMPLETE, closer: { type: "custom", modulePath: "./closers/nope.mjs" } }, {}, {}, "closer", "Couldn't load the custom closer at `./closers/nope.mjs`"],
    ["a test-runner check with no tests to run", { ...COMPLETE, gate: { type: "test-runner" } }, { "package.json": "{}" }, {}, "gate", NO_TEST_COMMAND],
    ["no check and no tests to run", { domain: COMPLETE.domain, tasks: COMPLETE.tasks }, { "package.json": "{}" }, {}, "gate", NO_CHECK],
    ["a closing action the environment names that doesn't exist", COMPLETE, {}, { DELIVERY_CLOSER: "teleport" }, "closer", unknownCloser("teleport")],
  ])("names the setting for %s", async (_, config, files, env, field, message) => {
    const { json, plain } = await bothForms(repoWith(config, files), env);
    expect(json.result).toEqual({ ready: false, problems: [{ field, message: expect.stringContaining(message) }] });
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts -t "names the setting for"`
Expected: FAIL: each result has `field: null` where `"gate"` / `"closer"` is expected.

- [ ] **Step 3: Implement**

`src/cli/failures.ts`, the `Refusal` class and its doc comment:

```ts
/**
 * The command declining to go on: something about the user's setup, never a
 * bug. The message is the whole of what they see, so it names the one missing
 * thing and how to fix it. `field` is the config setting it is about, when it
 * is about one, so `validate --json` can name it.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly field?: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}
```

`src/cli/project.ts` line 54: `if (command === undefined) throw new Refusal(NO_CHECK, EXIT.configuration, "gate");`
`src/cli/gate-presets.ts` line 76: `if (command === undefined) throw new Refusal(NO_TEST_COMMAND, EXIT.configuration, "gate");`
`src/cli/settings.ts` line 117: `if (!parsed.success) throw new Refusal(unknownCloser(named), EXIT.configuration, "closer");`

`src/cli/validate-command.ts`: add `import { CloserModuleLoadFailure, GateModuleLoadFailure, InvalidCloserExport, InvalidGateExport } from "../errors.js";`, add `settingOf` above `findProblems`, and in `findProblems`'s `catch` change `return [{ field: null, message }];` to `return [{ field: settingOf(err), message }];`:

```ts
/** The setting a problem found after the file's shape is right concerns: the one a refusal names, or the kind of module that would not load. */
function settingOf(err: unknown): string | null {
  if (err instanceof Refusal) return err.field ?? null;
  if (err instanceof GateModuleLoadFailure || err instanceof InvalidGateExport) return "gate";
  if (err instanceof CloserModuleLoadFailure || err instanceof InvalidCloserExport) return "closer";
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts src/cli/failures.test.ts src/cli/settings.test.ts src/cli/gate-presets.test.ts src/cli/project.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit && npx eslint src/cli/failures.ts src/cli/project.ts src/cli/gate-presets.ts src/cli/settings.ts src/cli/validate-command.ts src/cli/validate-command.test.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/cli/failures.ts src/cli/project.ts src/cli/gate-presets.ts src/cli/settings.ts src/cli/validate-command.ts src/cli/validate-command.test.ts
git commit -m "Name the setting behind a problem found after the file's shape is right

A script reading validate --json needs to know which setting to fix even when
the problem only shows up once the check or closing action is resolved or a
module is loaded. Refusals that concern one setting now say which, and module
load failures are attributed by kind, so no configuration problem is listed
without its field when it has one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
