# CLI and Configuration — Slice 7: Set Up a Project by Answering a Few Questions

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 7 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Add `delivery init`: three questions in plain English that write a `delivery.config.json` at the top of the repository, which the next `delivery run` picks up with no flags at all.

**Architecture:** No library change, no change to how a run works, and no new configuration shape. `init` writes exactly the file slice 2 already reads, so the whole of the "does the run use it?" contract is `loadConfig` + `resolveSettings`, unchanged. The wizard is split in two: `src/cli/init.ts` holds the questions as **data** (message, default, choices, each choice's one-line description) plus `initCommand`, which takes an `Ask` it is handed rather than importing a prompt library; `src/cli/prompts.ts` is the only file that imports `@inquirer/prompts`, and maps that data onto `input`, `select` and `confirm`. That boundary is why the acceptance criteria are testable as unit tests: what is asked, and what gets written, is ours and is asserted directly; drawing a menu and reading a keypress is the library's and is not re-tested. `project.ts` gains `inferredCheck`, the non-throwing half of today's `inferGate`, so the wizard's suggestion and the run's default come from one inference rather than two.

**Tech Stack:** Node ≥ 22, TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, and one new runtime dependency: `@inquirer/prompts` (^8.7.2).

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Use @inquirer/prompts for the prompts, following the estate precedent of autoloop's setup wizard; not @clack/prompts or a hand-rolled prompt loop." The spec records the same decision and why: "Estate precedent: `autoloop` ships its setup wizard on `@inquirer/prompts`. The architect's draft preferred `@clack/prompts` for footprint; assembly chose the estate library, since `init`'s three prompts need nothing either lacks and conformity with the sibling wizard outweighs a few kilobytes." So: no hand-rolled readline loop, no second prompt library, and `firstLine`/`chooseRun` (`src/cli/runs.ts`) is **not** extended to serve `init`. `@inquirer/prompts` goes in `dependencies`, not `devDependencies`: `dist/cli/prompts.js` imports it at runtime in an installed copy.
- **Operability / DX:** this slice carries no Operational note. It adds one subcommand and one runtime dependency; no build step, no environment variable, no new test harness. Slice 1's regression harness, slice 5's packaging and the existing CI cover it unchanged, and `tests/packaging.ci.test.ts` already installs from a packed tarball with `npm install`, which resolves the new dependency like the three that are already there. What changes for a reader is that a new command exists, so the README, the sample project's walkthrough, the command's own `--help` and a changeset are updated in the task whose deliverable created them (see Scaffolding Impact).
- **Configuration shape (spec, verbatim):** "One file, `delivery.config.json` … holding exactly the four keys a run needs"; "`task`, `gate`, `closer` are the library's existing `TaskDef`, `GateRef` and `CloserRef` shapes verbatim." `init` therefore invents no format of its own: it builds the same object `DeliveryConfig` (`src/cli/config.ts:56-64`) parses, and parses it before writing.
- **Defaults (spec, verbatim):** "**Gate:** if the target repository's `package.json` has `scripts.test`, `{ type: "command", command: "npm test", parseMode: "exitcode" }`." "**Closer:** `commit-to-branch`. `merge-back` lands on the base branch with no review step, wrong for a first unsupervised run; `open-pr` needs a remote and forge credentials." The wizard offers exactly those defaults, so answering by pressing Enter three times gives the same run as `delivery run --task "…"` with no config file.
- **Exit codes (spec, verbatim):** "`status` and `init` exit `0` on success and `2` when the named run or repository is not found." `EXIT` (`src/cli/failures.ts:26-33`) is untouched. Declining to overwrite is `0`: nothing failed, and the person got the outcome they asked for.
- **Copy:** "Every message names the problem and the fix without harness vocabulary ('worktree', 'envelope', 'surface', a state name)." British English, no em-dashes in any user-facing string or document. The command speaks in the first person where it speaks of itself, matching slices 1 to 6. Every user-facing string a test asserts on is an exported constant or built by an exported function, as in slices 1 to 6.
- **Colour:** decorative only. `initCommand` paints nothing at all: its own two lines go through `ctx.writeLine` with no `paint`. The prompts are drawn by the library, so `--no-color` reaches them through a partial theme whose styles return their text unchanged (see decision 6).
- **Determinism:** the wizard reads no clock and generates no id. The file it writes is a function of three answers and the repository path alone, so writing it twice from the same answers gives byte-identical output.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests while working (`npx vitest run <file>` or `npx vitest run <file> -t "<name>"`). No task's own tests need `npm run build`: they all call functions in process.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Seven decisions this plan makes, and why

Recorded here because this was an unattended run with no human to validate them.

1. **The wizard is handed its questioner (`Ask`) rather than importing one.** `initCommand(options, ctx, ask)` takes a third argument; `program.ts` passes `inquirerAsk(ctx.colour)`. Every acceptance criterion in this slice is about *what is asked* and *what is written*: which command is suggested, which three closing actions are offered and how each is described, what lands in the file, whether an existing file survives a "no". None of that is about drawing a menu or reading a keypress, which is precisely the work `@inquirer/prompts` was bought to do. Driving the real prompts in a unit test would mean choreographing escape sequences to assert on our own strings, and would leave the tests failing whenever the library changed how it renders. So the seam sits where our behaviour ends and the vendor's begins.

2. **The questions are data, not calls.** `checkQuestion(suggested)`, `CLOSER_QUESTION` and `TASK_QUESTION` are plain objects with a message, a default and (for the closer) the three choices and their descriptions. `inquirerAsk` is a pure mapping from those objects onto `input`, `select` and `confirm`. This is what keeps decision 1 honest: the adapter has nothing in it to get wrong except the mapping, and the mapping has one test of its own (Task 3).

3. **The closer choices are derived from the library's own list, and a test pins them to it.** `BUILT_IN_CLOSERS` (`src/cli/config.ts:18-20`) is built from `CloserRef`'s own options, so `unknownCloser` can never list a closer the harness does not have. The wizard's menu is asserted against that same list, so adding a fourth built-in closer to the schema fails the wizard's test until it has a choice with a one-line description. The descriptions cannot be derived, because they are the plain-language part, so that test is the only thing holding the two together.

4. **The overwrite question is asked first, before the three.** The acceptance criterion says only "it asks before overwriting". Asking first means someone who is keeping the file they have answers one question instead of four and finds out immediately; asking last means answering three questions and then throwing the answers away. It also means the "leaves the file untouched" case touches nothing at all, not even the inferred check.

5. **The file is written at the top of the repository, not in the folder the command was run from.** Config discovery (`configCandidates`, `src/cli/config.ts:119-129`) walks from the working folder *up* to the repository root. A file written into a subfolder would therefore be invisible to a `delivery run` from anywhere else in the project, which is the opposite of what "set up this project" means. `--repo <path>` names the repository, as it does on `run`, `resume` and `status`.

6. **`--no-color` reaches the prompts through a partial theme; `NO_COLOR` is the library's own job.** `initCommand` prints no colour itself, so the only colour in an `init` is the prompt chrome. `@inquirer/prompts` honours `NO_COLOR` through its colour library, which is the standard the spec names first, but it cannot see our `--no-color` flag. A partial theme whose `style` functions return their argument unchanged, passed only when `ctx.colour` is false, closes that gap in ten lines. *If `PLAIN_THEME` will not typecheck against the installed version's `Theme` type, drop the theme, keep `inquirerAsk(colour)`'s signature, and leave a comment naming the ceiling: `NO_COLOR` still works and `init`'s own output is colourless either way. Do not spend a task fighting the types.*

7. **`init` ignores `--json`.** `--json` exists for scripts, and a script has no terminal, and `init` refuses without one: the combination reaches `NEEDS_A_TERMINAL` on standard error before anything is printed on standard output, so stdout under `--json` stays empty rather than becoming unparseable prose. A caller who wants a config file without a person writes the file; that is the format slice 2 documents and this command's whole output.

## Scaffolding Impact

- **Proactive, a new subcommand needs its own help:** `init` is registered on the `delivery` program in `src/cli/program.ts` with a description and a `--repo` option, and appears in `delivery --help` and `delivery init --help` → Task 3.
- **Proactive, a new runtime dependency:** `@inquirer/prompts` is added to `dependencies` in `package.json` (not `devDependencies`: the installed `dist/cli/prompts.js` imports it) → Task 3.
- **Reactive, `README.md` documents how a project is configured and never mentions a way to do it by answering questions:** a "Set it up by answering a few questions" section is added immediately above "Configure it once", so the wizard introduces the file that section then documents → Task 3.
- **Reactive, `examples/sample-project/README.md` walks a person through every `delivery` command there is and would now be missing one:** it gains a final step for `delivery init` → Task 3.
- **Proactive, `CONTRIBUTING.md` requires a changeset for anything a user would notice** ("Every change that a user of the package would notice needs a changeset", `CONTRIBUTING.md:76`): one changeset describes the new command → Task 3.
- **Reactive, `docs/getting-started.md` sends a reader to the config file and now knows a way to write one it does not mention:** its "Where to go next" bullet about `delivery.config.json` (`docs/getting-started.md:125-127`) gains the wizard, as prose only → Task 3. The guide's own steps stay as they are: `tests/getting-started-guide.test.ts` executes the `delivery run --task` line and every ```` ```text ```` block of expected output, and an interactive wizard cannot be executed by that test, so the shortest path from install to one finished run stays `delivery run --task`. A bullet with no fenced block is invisible to that extraction; check it stays green all the same.
- **Unchanged, checked:** `CONTRIBUTING.md`'s test-seam section (no new seam, no new build, test or run step; `DELIVERY_TEST_MOCK_SCRIPT` is untouched). `package.json`'s `bin`, `exports`, `files` and `scripts` (no new entry point and no new script; `tests/packaging.test.ts:28-36` asserts all four and stays green). `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `Makefile`, `.githooks/pre-push` (all call `npm test` or the release flow, neither of which changes; the packed-install check already runs `npm install`, which resolves the new dependency). `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js` (the two new files sit under the existing `src/**` globs, which `tests/typecheck-coverage.test.ts` checks). `examples/sample-project/package.json`, `add.js`, `add.test.js` (`tests/sample-project.test.ts:20` and `tests/cli-and-configuration/1-…:308` assert the folder's file list, not the README's text, so editing the README alone is safe, and `init` is never run against the checked-in copy). `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md`, `docs/provisioning.md`, `docs/single-surface-control-flow.md`, `docs/multi-surface-control-flow.md`, `docs/agent-interface.md` (library contracts and control flow: this slice adds no library API and changes no gate, closer, role or state behaviour). `src/cli/config.ts`, `src/cli/settings.ts`, `src/cli/run-command.ts` (the run reads the file exactly as it did before: this slice adds a second way to author it, not a second way to read it).

---

### Task 1: The check the wizard can suggest

`inferGate` (`src/cli/project.ts:39-45`) answers two questions at once today: "what is this project's check?" and "is there one at all?", by throwing `NO_CHECK` when there is not. The wizard needs the first answer without the second, because "no test script" is a question to ask, not a refusal. Rather than infer twice, split the inference out and let `inferGate` refuse over it. The placeholder rule (`npm init`'s always-failing `no test specified`, which would accept any change) moves with the inference and so keeps applying to both callers.

**Files:**
- Modify: `src/cli/project.ts:39-45`
- Test: `src/cli/project.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `inferredCheck(repoPath: string): Promise<string | undefined>` — the command this project's own `package.json` implies (`"npm test"`), or `undefined` when it implies none. `inferGate(repoPath: string): Promise<GateRef>` keeps its exact signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/project.test.ts`, after the existing `describe("inferGate", …)` block. Note the import line at the top of the file gains `inferredCheck`:

```ts
import { findRepository, hasUncommittedChanges, inferGate, inferredCheck, NO_CHECK, NOT_A_REPOSITORY } from "./project.js";
```

```ts
describe("inferredCheck", () => {
  it("is the project's own npm test when it has a test script to run", async () => {
    const repo = initTempRepo("project-check-", { "package.json": withTest("node --test") });
    expect(await inferredCheck(repo)).toBe("npm test");
  });

  it.each([
    ["no package.json", {}],
    ["a package.json with no scripts", { "package.json": JSON.stringify({ name: "scratch" }) }],
    ["an empty test script", { "package.json": withTest("  ") }],
    ["npm init's always-failing placeholder", { "package.json": withTest('echo "Error: no test specified" && exit 1') }],
    ["a package.json that is not JSON", { "package.json": "{ not json" }],
  ])("has nothing to suggest for %s, rather than refusing", async (_label, files: Record<string, string>) => {
    const repo = initTempRepo("project-no-check-", { "README.md": "hi\n", ...files });
    expect(await inferredCheck(repo)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/project.test.ts -t "inferredCheck"`
Expected: FAIL. TypeScript and vitest both object that `inferredCheck` is not exported from `./project.js`.

- [ ] **Step 3: Write the implementation**

In `src/cli/project.ts`, replace the body of `inferGate` (lines 39-45) with the two functions below. Nothing else in the file changes: `TestScript`, `NPM_INIT_PLACEHOLDER`, `testScript`, `NO_CHECK` and `hasUncommittedChanges` all stay exactly as they are.

```ts
/**
 * The check this project's own `package.json` implies, or nothing when it
 * implies none. `npm init`'s placeholder is nothing: it always fails, so a
 * check built on it would accept any change, which is no check at all dressed
 * as one. Undefined rather than a refusal, because "there isn't one" is a
 * question `delivery init` asks and a refusal `delivery run` makes, and they
 * should not infer it separately.
 */
export async function inferredCheck(repoPath: string): Promise<string | undefined> {
  const script = await testScript(repoPath);
  return script === undefined || script.includes(NPM_INIT_PLACEHOLDER) ? undefined : "npm test";
}

/**
 * The default check: the repository's own `npm test`, judged by its exit code
 * alone, the one parse mode that assumes nothing about the runner's output.
 */
export async function inferGate(repoPath: string): Promise<GateRef> {
  const command = await inferredCheck(repoPath);
  if (command === undefined) throw new Refusal(NO_CHECK, EXIT.configuration);
  return { type: "command", command, parseMode: "exitcode" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/project.test.ts`
Expected: PASS, both the new `inferredCheck` block and the existing `inferGate` block (which is what proves the refusal still happens where it did).

- [ ] **Step 5: Commit**

```bash
git add src/cli/project.ts src/cli/project.test.ts
git commit -m "Split the project's inferred check out of the gate that refuses without one

\`inferGate\` answered two questions at once: what this project's check is, and
whether it has one. The setup wizard needs the first without the second, because
a project with no test script is something to ask about rather than refuse over.
Inferring it twice would let the two answers drift, and the \`npm init\`
placeholder rule is exactly the sort of thing that would drift first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The three questions, and the file they write

The whole of the wizard's behaviour, with the asking injected. Everything a person sees is here, as data or as an exported constant, so every acceptance criterion in the slice is asserted directly rather than through a rendered terminal. The file is built by `DeliveryConfig.parse`, the same schema `delivery run` will read it back with, so `init` cannot write a file its own loader would refuse.

**Files:**
- Create: `src/cli/init.ts`
- Create: `src/cli/init.test.ts`

**Interfaces:**
- Consumes: `inferredCheck(repoPath)` (Task 1). `findRepository(path)` (`src/cli/project.ts:19`). `CONFIG_BASENAME`, `DeliveryConfig`, `BUILT_IN_CLOSERS` (`src/cli/config.ts:11,18,56`). `DEFAULT_CLOSER` (`src/cli/settings.ts:20`). `CommandContext` (`src/cli/context.ts:7`). `EXIT`, `Refusal`, `ExitCode` (`src/cli/failures.ts`).
- Produces:
  - `interface TextQuestion { message: string; default?: string; required?: boolean }`
  - `interface Choice { value: string; name: string; description: string }`
  - `interface ChoiceQuestion { message: string; choices: Choice[]; default: string }`
  - `interface ConfirmQuestion { message: string; default: boolean }`
  - `interface Ask { text(q: TextQuestion): Promise<string>; choose(q: ChoiceQuestion): Promise<string>; confirm(q: ConfirmQuestion): Promise<boolean> }`
  - `interface InitOptions { repo?: string }`
  - `initCommand(options: InitOptions, ctx: CommandContext, ask: Ask): Promise<ExitCode>`
  - `checkQuestion(suggested: string | undefined): TextQuestion`, `CLOSER_QUESTION: ChoiceQuestion`, `TASK_QUESTION: TextQuestion`, `overwriteQuestion(file: string): ConfirmQuestion`
  - `configFrom({ check, closer, task }: { check: string; closer: string; task: string }): DeliveryConfig`
  - `CONFIG_FILE(repoPath: string): string`, `NEEDS_A_TERMINAL: string`, `LEFT_ALONE(file: string): string`, `WRITTEN(file: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/cli/init.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { initTempRepo } from "../temp-repo.js";
import { PACKAGE } from "./command-fixtures.js";
import { BUILT_IN_CLOSERS, loadConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal } from "./failures.js";
import { plainReporter } from "./report.js";
import { DEFAULT_CLOSER, resolveSettings } from "./settings.js";
import {
  CONFIG_FILE,
  initCommand,
  LEFT_ALONE,
  NEEDS_A_TERMINAL,
  WRITTEN,
  type Ask,
  type ChoiceQuestion,
  type ConfirmQuestion,
  type TextQuestion,
} from "./init.js";

const TASK = "add a function that says hello to a name, with a test";

/** A command context with somebody at the terminal, unless the test says there is nobody. */
function context(cwd: string, { interactive = true }: { interactive?: boolean } = {}) {
  const lines: string[] = [];
  const writeLine = (line: string): void => void lines.push(line);
  const stdin = Object.assign(Readable.from([]), { isTTY: interactive || undefined });
  const ctx: CommandContext = { cwd, env: {}, colour: false, json: false, stdin, writeLine, report: plainReporter(writeLine, false) };
  return { ctx, lines };
}

/**
 * A person answering the questions in the order they are asked, recording each
 * question so a test can assert on what was actually offered. An answer left
 * out is Enter: the question's own default.
 */
function scriptedAsk({ texts = [], choice, confirm }: { texts?: (string | undefined)[]; choice?: string; confirm?: boolean } = {}) {
  const asked: (TextQuestion | ChoiceQuestion | ConfirmQuestion)[] = [];
  const queue = [...texts];
  const ask: Ask = {
    text(question) {
      asked.push(question);
      // An answer of `undefined` is Enter: whatever the question offered.
      return Promise.resolve(queue.shift() ?? question.default ?? "");
    },
    choose(question) {
      asked.push(question);
      return Promise.resolve(choice ?? question.default);
    },
    confirm(question) {
      asked.push(question);
      return Promise.resolve(confirm ?? question.default);
    },
  };
  return { ask, asked };
}

const sample = (files: Record<string, string> = { "package.json": PACKAGE }) => initTempRepo("init-", { "README.md": "hi\n", ...files });

describe("what `delivery init` asks", () => {
  it("offers the project's own check when it has one, so pressing Enter accepts it", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[0] as TextQuestion).default).toBe("npm test");
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
    });
  });

  it("asks for a check with nothing suggested when the project has no test script", async () => {
    const repo = sample({});
    const { ask, asked } = scriptedAsk({ texts: ["make check", "build a greeting"] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[0] as TextQuestion).default).toBeUndefined();
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "make check", parseMode: "exitcode" },
    });
  });

  it("offers every built-in closing action, each with a line saying what it does", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);
    const closerQuestion = asked[1] as ChoiceQuestion;

    // Sorted on both sides: the menu leads with the default, because that is
    // what a person should see first, and the schema's own order is arbitrary.
    // What must not drift is which closers are offered at all.
    expect(closerQuestion.choices.map((choice) => choice.value).sort()).toEqual([...BUILT_IN_CLOSERS].sort());
    for (const choice of closerQuestion.choices) {
      expect(choice.name.length, choice.value).toBeGreaterThan(0);
      expect(choice.description.length, choice.value).toBeGreaterThan(0);
    }
  });

  it("commits to a branch unless told otherwise, as a run with no config file does", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[1] as ChoiceQuestion).default).toBe(DEFAULT_CLOSER.type);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER });
  });

  it("asks three questions and writes exactly those three answers", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: ["npm test", TASK], choice: "merge-back" });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(asked).toHaveLength(3);
    const written = readFileSync(CONFIG_FILE(repo), "utf-8");
    expect(JSON.parse(written)).toEqual({
      task: { intent: TASK },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
    });
    expect(written.endsWith("\n")).toBe(true);
    expect(lines).toEqual([WRITTEN(CONFIG_FILE(repo))]);
  });

  it("writes the file at the top of the repository, where a run from any folder finds it", async () => {
    const repo = sample();
    const { ctx } = context(join(repo, "does-not-matter"));

    await initCommand({ repo }, ctx, scriptedAsk({ texts: ["npm test", TASK] }).ask);

    expect(existsSync(CONFIG_FILE(repo))).toBe(true);
  });
});

describe("a config file that is already there", () => {
  it("asks before replacing it, and leaves it exactly as it was when told not to", async () => {
    const repo = sample();
    writeFileSync(CONFIG_FILE(repo), '{ "closer": { "type": "open-pr" } }\n');
    const { ask, asked } = scriptedAsk({ confirm: false });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(readFileSync(CONFIG_FILE(repo), "utf-8")).toBe('{ "closer": { "type": "open-pr" } }\n');
    expect(asked).toHaveLength(1);
    expect(lines).toEqual([LEFT_ALONE(CONFIG_FILE(repo))]);
  });

  it("replaces it when told to, having asked first", async () => {
    const repo = sample();
    writeFileSync(CONFIG_FILE(repo), '{ "closer": { "type": "open-pr" } }\n');
    const { ask, asked } = scriptedAsk({ texts: ["npm test", TASK], confirm: true });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked).toHaveLength(4);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER, task: { intent: TASK } });
  });
});

describe("when there is nobody to answer", () => {
  it("stops and says it needs a terminal, without writing anything", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk();

    const err = await initCommand({}, context(repo, { interactive: false }).ctx, ask).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Refusal);
    expect((err as Refusal).message).toBe(NEEDS_A_TERMINAL);
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(existsSync(CONFIG_FILE(repo))).toBe(false);
  });

  it("says so before complaining about the folder, because that is the mistake to fix first", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "init-not-repo-"));

    const err = await initCommand({}, context(notARepo, { interactive: false }).ctx, scriptedAsk().ask).catch((e: unknown) => e);

    expect((err as Refusal).message).toBe(NEEDS_A_TERMINAL);
  });
});

describe("the run that follows", () => {
  it("reads back as the check, closing action and task that were answered, with no flags at all", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: ["npm test", TASK], choice: "merge-back" });
    await initCommand({}, context(repo).ctx, ask);

    const config = await loadConfig({ startDir: repo, repoPath: repo, flag: undefined, env: {} });
    const settings = await resolveSettings({}, { env: {}, intent: undefined, repoPath: repo, config });

    expect(settings.taskDef).toEqual({ intent: TASK });
    expect(settings.gateRef).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
    expect(settings.closerRef).toEqual({ type: "merge-back" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/init.test.ts`
Expected: FAIL. The module `./init.js` does not exist, so every test in the file errors on the import.

- [ ] **Step 3: Write the implementation**

Create `src/cli/init.ts`:

```ts
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_BASENAME, DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, inferredCheck } from "./project.js";
import { DEFAULT_CLOSER } from "./settings.js";

/** A question answered by typing. `default` is what pressing Enter means; `required` refuses an empty answer rather than writing one. */
export interface TextQuestion {
  message: string;
  default?: string;
  required?: boolean;
}

/** One thing a person can pick: what gets written, what it is called, and the one line saying what it does. */
export interface Choice {
  value: string;
  name: string;
  description: string;
}

/** A question answered by picking from a list. */
export interface ChoiceQuestion {
  message: string;
  choices: Choice[];
  default: string;
}

/** A question answered yes or no. */
export interface ConfirmQuestion {
  message: string;
  default: boolean;
}

/**
 * How this command asks a person something. The wizard is handed one rather
 * than importing a prompt library, because everything this slice promises is
 * about what is asked and what is written: drawing a menu and reading a
 * keypress is `@inquirer/prompts`' job (`src/cli/prompts.ts`), and re-testing
 * it here would assert on someone else's rendering.
 */
export interface Ask {
  text(question: TextQuestion): Promise<string>;
  choose(question: ChoiceQuestion): Promise<string>;
  confirm(question: ConfirmQuestion): Promise<boolean>;
}

/** What `delivery init` was given on the command line. */
export interface InitOptions {
  repo?: string;
}

/**
 * Where the file goes: the top of the repository, not the folder the command
 * was run from. Config discovery walks from the working folder up to the
 * repository root, so a file written into a subfolder would be invisible to a
 * run started anywhere else in the project.
 */
export const CONFIG_FILE = (repoPath: string): string => join(repoPath, `${CONFIG_BASENAME}.json`);

export const NEEDS_A_TERMINAL =
  "`delivery init` asks you a few questions, so it needs a terminal to type the answers in. " +
  `Run it in a terminal, or write a ${CONFIG_BASENAME}.json yourself: the README says what goes in it.`;

export const LEFT_ALONE = (file: string): string => `Left ${file} as it was. Nothing has changed.`;

export const WRITTEN = (file: string): string => `Written ${file}. To start the run: delivery run`;

/** The check, offering the project's own when it has one, so pressing Enter accepts it. */
export const checkQuestion = (suggested: string | undefined): TextQuestion => ({
  message: "What command should I run to check the agent's work? It passes when that command exits 0.",
  ...(suggested === undefined ? {} : { default: suggested }),
  required: true,
});

/**
 * What happens to work that passes. The three choices are the library's own
 * built-in closers, and the wizard's test pins them to that list, so a fourth
 * one cannot be added to the schema without being described here in words.
 */
export const CLOSER_QUESTION: ChoiceQuestion = {
  message: "What should happen to work that passes the check?",
  choices: [
    {
      value: "commit-to-branch",
      name: "Commit it to a branch",
      description: "The work is left on a branch of its own for you to look at. The branch you started from is untouched.",
    },
    {
      value: "merge-back",
      name: "Merge it into the branch you started from",
      description: "The work goes straight onto that branch, with no review step in between.",
    },
    {
      value: "open-pr",
      name: "Open a pull request",
      description: "The branch is pushed and a pull request is opened for it. This needs a remote and a signed-in `gh`.",
    },
  ],
  default: DEFAULT_CLOSER.type,
};

export const TASK_QUESTION: TextQuestion = {
  message: "What's the first thing you'd like done? Say it the way you'd say it to a colleague.",
  required: true,
};

export const overwriteQuestion = (file: string): ConfirmQuestion => ({
  message: `There's already a ${file}. Shall I replace it?`,
  default: false,
});

/**
 * The three answers as the file a run reads. Parsed by the very schema
 * `delivery run` will parse it with, so this command can never write a file its
 * own loader would refuse. Limits are deliberately absent: the defaults are
 * better left implicit than frozen into a file nobody asked to set.
 */
export function configFrom({ check, closer, task }: { check: string; closer: string; task: string }): DeliveryConfig {
  return DeliveryConfig.parse({
    task: { intent: task },
    gate: { type: "command", command: check, parseMode: "exitcode" },
    closer: { type: closer },
  });
}

/**
 * `delivery init`: set a project up by answering a few questions instead of
 * writing the file by hand. It asks what checks the agent's work, what happens
 * to work that passes, and what you'd like done first, and writes those three
 * answers where the next `delivery run` will find them with no flags at all.
 */
export async function initCommand(options: InitOptions, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  // Before the repository is even looked for: needing somebody to answer is
  // about this command itself, so hearing about the folder first would send the
  // reader after the wrong problem.
  if (ctx.stdin.isTTY !== true) throw new Refusal(NEEDS_A_TERMINAL, EXIT.configuration);

  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const file = CONFIG_FILE(repoPath);

  // Asked first, not last: someone who is keeping the file they have should not
  // have to answer three questions to find that out.
  if (existsSync(file) && !(await ask.confirm(overwriteQuestion(file)))) {
    ctx.writeLine(LEFT_ALONE(file));
    return EXIT.ok;
  }

  const check = await ask.text(checkQuestion(await inferredCheck(repoPath)));
  const closer = await ask.choose(CLOSER_QUESTION);
  const task = await ask.text(TASK_QUESTION);

  await writeFile(file, `${JSON.stringify(configFrom({ check, closer, task }), null, 2)}\n`);
  ctx.writeLine(WRITTEN(file));
  return EXIT.ok;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/init.test.ts`
Expected: PASS, all eleven tests.

If "asks three questions and writes exactly those three answers" fails on key order inside the written JSON, that is `DeliveryConfig.parse` rebuilding the object in the schema's own order. The assertion compares parsed values, not text, so it should not: if it does, the failure is a real mismatch in the values and not the order.

- [ ] **Step 5: Run the linter on the two new files**

Run: `npx eslint src/cli/init.ts src/cli/init.test.ts && npx tsc --noEmit`
Expected: clean. `tsc --noEmit` is what catches a `Choice` shape that does not match what Task 3's adapter will need.

- [ ] **Step 6: Commit**

```bash
git add src/cli/init.ts src/cli/init.test.ts
git commit -m "Add the setup wizard's three questions and the file they write

A project owner who is not an engineer can now be asked what checks the work,
what happens to work that passes and what they want done, rather than being
handed a configuration format to learn. The questions are data and the asking is
injected, so what is offered and what is written is asserted directly, and
drawing a menu stays the prompt library's job. The file is built by the same
schema that reads it back, so this command cannot write one a run would refuse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Asking with @inquirer, and a `delivery init` people can find

The wizard becomes a command. This task adds the one file that imports the prompt library, registers the subcommand so it appears in `--help`, and updates everything that now describes the harness incompletely: the README (which documents the config file and had no way to author it by answering questions), the sample project's walkthrough (which walks through every other `delivery` command), and a changeset (which `CONTRIBUTING.md` requires for anything a user would notice).

**Files:**
- Create: `src/cli/prompts.ts`
- Create: `src/cli/prompts.test.ts`
- Modify: `src/cli/program.ts:9` (imports) and `:109` (after the `status` command)
- Modify: `package.json:76-80` (`dependencies`)
- Modify: `README.md:156` (a new section immediately above "Configure it once")
- Modify: `docs/getting-started.md:125-127` (the config-file bullet under "Where to go next")
- Modify: `examples/sample-project/README.md` (a new final step)
- Create: `.changeset/set-up-by-answering-questions.md`

**Interfaces:**
- Consumes: `Ask`, `TextQuestion`, `ChoiceQuestion`, `ConfirmQuestion`, `InitOptions`, `initCommand` (Task 2). `CommandContext.colour` (`src/cli/context.ts:10`).
- Produces: `inquirerAsk(colour: boolean, streams?: PromptStreams): Ask`, `PLAIN_THEME`, `type PromptStreams = { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream }`. Nothing later in this slice consumes them: `program.ts` is the only caller.

- [ ] **Step 1: Install the prompt library**

Run: `npm install @inquirer/prompts@^8.7.2 --save --no-audit --no-fund`
Expected: `package.json`'s `dependencies` gains `"@inquirer/prompts": "^8.7.2"` alongside `@anthropic-ai/claude-agent-sdk`, `commander` and `zod`, and `package-lock.json` updates. Check it landed in `dependencies` and not `devDependencies`: the installed `dist/cli/prompts.js` imports it at runtime, so a dev-only dependency would give an adopter a command that crashes on `init`.

- [ ] **Step 2: Write the failing test**

Create `src/cli/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { inquirerAsk } from "./prompts.js";

/**
 * Wait for the prompt to be drawn before answering it, by watching for its own
 * words rather than by sleeping: a fixed wait would be a guess that is either
 * slow or flaky, and this fails fast if the question never appears at all.
 */
async function untilShown(shown: () => string, text: string): Promise<void> {
  for (let turn = 0; turn < 200 && !shown().includes(text); turn++) {
    await new Promise((settle) => setImmediate(settle));
  }
  expect(shown()).toContain(text);
}

describe("asking with @inquirer/prompts", () => {
  it("puts the question on the stream it was given and answers with what was typed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));

    const answer = inquirerAsk(false, { input, output }).text({ message: "What command should I run?", required: true });
    await untilShown(() => shown, "What command should I run?");
    input.write("npm test\n");

    expect(await answer).toBe("npm test");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/cli/prompts.test.ts`
Expected: FAIL. The module `./prompts.js` does not exist.

- [ ] **Step 4: Write the adapter**

Create `src/cli/prompts.ts`:

```ts
import { confirm, input, select } from "@inquirer/prompts";
import type { Ask } from "./init.js";

/**
 * The streams the questions are asked on. The real command passes none, so the
 * library talks to this process's terminal, which is the only place `init` runs
 * at all; a test passes its own pair.
 */
export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Colour off, as `--no-color` asks. The library paints its own prompts, so a
 * theme whose styles return their text unchanged is the only way that flag
 * reaches them. `NO_COLOR` needs nothing from us: the library's own colour
 * support honours it.
 */
export const PLAIN_THEME = {
  style: {
    answer: (text: string) => text,
    message: (text: string) => text,
    error: (text: string) => text,
    defaultAnswer: (text: string) => text,
    help: (text: string) => text,
    highlight: (text: string) => text,
    key: (text: string) => text,
  },
};

/**
 * The wizard's questions asked with `@inquirer/prompts`. A plain mapping and
 * nothing else: every word, default and choice comes from `init.ts`, so this
 * file has nothing in it to get wrong except the mapping itself.
 */
export function inquirerAsk(colour: boolean, streams: PromptStreams = {}): Ask {
  const theme = colour ? {} : PLAIN_THEME;
  return {
    text: (question) =>
      input({ message: question.message, default: question.default, required: question.required ?? false, theme }, streams),
    choose: (question) => select({ message: question.message, choices: question.choices, default: question.default, theme }, streams),
    confirm: (question) => confirm({ message: question.message, default: question.default, theme }, streams),
  };
}
```

If `PLAIN_THEME` will not typecheck against the installed version's theme type, delete it, make `inquirerAsk` ignore its `colour` argument, and leave this comment in its place, rather than spending the task on types:

```ts
// `--no-color` does not reach the prompts: the library paints them, and its
// theme type is not worth bending. `NO_COLOR` is honoured by its own colour
// support, and `init` prints no colour of its own, so what is left is prompt
// chrome that is erased as each question is answered.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/cli/prompts.test.ts`
Expected: PASS.

If it times out rather than failing on an assertion, the library is not driving a plain `PassThrough` in this version. Delete `src/cli/prompts.test.ts` and note in the commit message that the adapter's wiring is covered by the slice's own UAT against the real command instead. Do not replace it with a fixed sleep.

- [ ] **Step 6: Register the command**

In `src/cli/program.ts`, add two imports beside the existing ones (`init` before `resume` keeps them alphabetical, as they already are):

```ts
import { initCommand, type InitOptions } from "./init.js";
import { inquirerAsk } from "./prompts.js";
```

Then add this block after the `status` command's `.action(...)` (that is, after line 109, before the `try {`):

```ts
  program
    .command("init")
    .description(
      "set this project up by answering a few questions: what command checks the agent's work, what happens to work that passes, and the first thing you'd like done",
    )
    .option("--repo <path>", "the git repository to set up (default: the current folder)")
    .action(async (options: InitOptions, command: Command) => {
      const ctx = contextFor(io, command);
      exitCode = await initCommand(options, ctx, inquirerAsk(ctx.colour));
    });
```

- [ ] **Step 7: Check the command is there and refuses a pipe**

There is no `src/cli/program.test.ts`; the program is exercised through the compiled command. Confirm by hand from the worktree root:

```bash
npm run build
node dist/cli/main.js --help
node dist/cli/main.js init < /dev/null; echo "exit: $?"
```

Expected: `init` is listed among the commands in the help output with its description; the piped invocation prints the `NEEDS_A_TERMINAL` sentence on standard error and exits `2`.

- [ ] **Step 8: Write the README section**

In `README.md`, insert this immediately before the `## Configure it once` heading (line 156), so the wizard introduces the file that section documents:

````markdown
## Set it up by answering a few questions

If you would rather not write the config file yourself:

```bash
delivery init
```

It asks three things: what command checks the agent's work (offering your project's own
`npm test` when it has one), what should happen to work that passes, and the first thing you
would like done. It writes the answers to a `delivery.config.json` at the top of the
repository, which the next `delivery run` picks up with no flags at all. If there is already a
config file there, it asks before replacing it and leaves it as it was if you say no.

It asks questions, so it needs a terminal. Run in a pipe or in CI it says so and stops, rather
than guessing an answer on your behalf.

````

- [ ] **Step 9: Add the step to the sample project's walkthrough**

In `examples/sample-project/README.md`, add a new step 9 after the existing step 8:

```markdown
9. To set the project up without typing flags every time, run `delivery init`. It asks what
   command checks the work, what should happen to work that passes, and what you would like
   done, then writes your answers to `delivery.config.json`. After that, `delivery run` on its
   own does what you asked for.
```

- [ ] **Step 10: Point the getting-started guide at the wizard**

In `docs/getting-started.md`, replace the first bullet under "Where to go next" (lines 125-127) with:

```markdown
- Settings that belong to a project, such as the check, the closing action and the
  attempt limits, live in a `delivery.config.json` beside your code: see the
  [readme](../README.md). `delivery init` writes one for you by asking what checks
  the work, what happens to work that passes, and what you would like done.
```

No fenced block: the guide's own steps are executed by `tests/getting-started-guide.test.ts`, and an interactive wizard is not something that test can run.

Run: `npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS, unchanged. This is the one place a docs edit in this slice could break a test, which is why it is checked here rather than at the end.

- [ ] **Step 11: Describe the change for the changelog**

Create `.changeset/set-up-by-answering-questions.md`:

```markdown
---
"delivery-service": minor
---

A project can now be set up by answering a few questions. `delivery init` asks what command
should check the agent's work, offering the project's own `npm test` when it has one; what
should happen to work that passes, from the three built-in choices with a line saying what each
one does; and the first thing you would like done. It writes those answers to a
`delivery.config.json` at the top of the repository, which the next `delivery run` uses with no
flags at all. An existing config file is never replaced without being asked about first, and
because the command asks questions, it says so and stops when there is no terminal to answer in.
```

- [ ] **Step 12: Run this task's tests and the linter**

Run: `npx vitest run src/cli/prompts.test.ts src/cli/init.test.ts && npx eslint src/cli/prompts.ts src/cli/prompts.test.ts src/cli/program.ts && npx tsc --noEmit`
Expected: PASS and clean.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json src/cli/prompts.ts src/cli/prompts.test.ts src/cli/program.ts README.md docs/getting-started.md examples/sample-project/README.md .changeset/set-up-by-answering-questions.md
git commit -m "Add \`delivery init\`, asking its questions with @inquirer/prompts

The wizard had no way to reach a person until it was a command. @inquirer/prompts
is the estate's own choice, already shipping autoloop's setup wizard, so the
three questions conform with the sibling wizard rather than introducing a second
prompt library for the sake of a few kilobytes. It is a runtime dependency
because an installed copy imports it. The README and the getting-started guide
documented the config file without a way to author it by answering questions,
and the sample project walked through every other command, so all three now
mention this one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## What this slice deliberately does not do

- **No `delivery init --yes` or any non-interactive mode.** The slice's own acceptance criterion is that it stops without a terminal. A caller with no person writes the file, which is what slice 2 documents.
- **No limits (`budgets`) question.** The acceptance criteria name three answers. A fourth question about attempt caps would make a first-time setup longer in order to set values whose defaults are already the right ones.
- **No custom gate or closer in the wizard.** Both need a module path, which the spec says "are expressed in the config file only". Someone writing a gate of their own is not the person this command is for.
- **No change to `chooseRun`'s prompt (`src/cli/runs.ts:147-159`).** It reads one line to pick from a list of runs, is already tested, and converting it to the prompt library is neither asked for here nor free: it would change what a resume looks like, which is slice 3's behaviour.
