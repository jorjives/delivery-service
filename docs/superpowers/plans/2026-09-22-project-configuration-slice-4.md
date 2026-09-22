# Project Configuration — Slice 4: See Exactly What the Agent Will Be Told

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** Add `delivery preview`: offline, with no agent and no sign-in, it names a task from the project's configuration and prints, word for word, the instructions a real run of that task sends the agent on its first dispatch, followed by what the agent may do in everyday phrases.

**Architecture:** No renderer of its own. `preview` builds the case file `create()` would write for the chosen task (via a new pure `initialCaseFile`, extracted from `create()` so the two cannot disagree), gives it the evidence a first dispatch has (none), and calls the library's own `assemblePrompt` with the role configuration a CLI run uses (a new shared `RUN_ROLES` constant, which `driveToOutcome` also uses). Which task is "next" comes from the queue driver's own rule (a new `nextQueueTask`, shared with `runQueue`), and every configuration problem goes through the same `locateConfig` / `readProject` pair `validate` uses (split out of `validateCommand`), so the refusals are the same sentences. A regression test runs a real queue against the scripted agent and compares, byte for byte, what `preview` printed with what each session was actually sent on the wire.

**Tech Stack:** Node ≥ 22, TypeScript strict (Node16 ESM, `noUncheckedIndexedAccess`), zod 4, commander 14 (`Option.choices`, `InvalidArgumentError`), vitest, git, the vendored `claude-mock`. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Preview must call the library's own prompt assembly on a stand-in run record; it must not contain a second renderer of the prompt. That is the whole guarantee that what is previewed is what is sent." So: `assemblePrompt` from `src/prompt-assembly.ts` produces every character between the two rules; the stand-in record is `initialCaseFile` (the function `create()` itself uses); the role configuration is `RUN_ROLES` (the object `driveToOutcome` itself passes to `createAgentPort`). `preview-command.ts` must contain no string that restates any part of a prompt.
- **Spec buy-vs-build row (verbatim):** "Prompt preview | Reuse-estate: call exported `assemblePrompt` on a synthetic case file | A standalone template renderer | A second renderer could drift from the real prompt, which is the exact risk to Item 4's guarantee."
- **Operability (this slice's Operational note, verbatim):** "Like `validate`, this command needs no agent runtime or sign-in, writes nothing, and is safe alongside an active run. Its truthfulness is protected by a regression test that compares what it prints with what a real run actually sends to the scripted agent." Honoured in Task 4 (no agent: every preview unit test runs with `agentSession` made to throw; writes nothing: a before/after snapshot test) and Task 6 (the wire-comparison regression test).
- **Command surface (spec, verbatim):** "`delivery preview [--queue-index <n>] [--role worker|gate-maintenance] [--config <file>] [--repo <path>]` *(new)* Prints the assembled prompt for one task and one role. Defaults: the next task the queue would run, and the worker role. `--queue-index` is 1-based, matching "Task N of M". Against a config with a singular `task` it previews that task and refuses `--queue-index`. With neither `task` nor `tasks` it refuses with `run`'s existing "no task" sentence. It takes no free-text task of its own. Exit `0`, or `2`."
- **Out-of-range index (spec, verbatim):** "`preview --queue-index` out of range | "There's no task 7; your queue has 4." | 2".
- **Key flow (spec, verbatim; the prompt text between the rules is `assemblePrompt`'s output, unaltered):**
  ```
  $ delivery preview
  Next task: "add a page that shows who's on call today"

  What the worker will be told (before any run starts):
  ─────────────────────────────────────────────────────
  You are the worker on a gated delivery harness.
  …
  ─────────────────────────────────────────────────────
  Tools it can use: read files, look through the project, edit files, run commands.
  ```
  This plan keeps the shape and settles the first line as `Next up is Task N of M: <task>` (reusing the queue's own `taskHeading`, so the owner sees the same "Task N of M" `delivery run` prints); see the decisions below.
- **Tools line (spec):** "The tools line translates `allowedTools` into plain phrases, as Item 8 translates surface states; a tool name with no translation is printed as written."
- **Accessibility (spec):** "No harness vocabulary in any declarative-altitude output: never "worktree", "envelope", "surface", "case file", "role config" or schema terms." Verified empirically while planning: the assembled worker and gate-maintenance prompts contain none of these words.
- **Error model (spec):** every configuration problem exits `2` (`EXIT.configuration`); `preview` never exits `3`, `4` or `5`.
- **Determinism (spec):** "Two `validate` or `preview` calls on the same inputs print identical output." The stand-in record's id is a fixed string, never a clock value.
- **Copy:** British English; no em-dashes in anything a person reads (CLI output, README, changeset).
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.

### Decisions settled for this plan (unattended run)

- **No config file at all** gives `validate`'s `NO_CONFIG` sentence (AC: "Any configuration problem produces the same single plain-language message `delivery validate` would give"). A file that names neither `task` nor `tasks` gives `run`'s `NO_TASK` sentence (AC: "with no task at all it gives the same "no task" message `delivery run` gives").
- **Every listed task already done, no `--queue-index`:** prints the queue's own `EVERY_TASK_DONE` sentence and exits 0, as `delivery run` does in the same state. `--queue-index` still previews any entry, done or not.
- **"Next" follows `delivery run` exactly:** the first entry whose answering run is not closed. An escalated or aborted entry is "next", because the queue stops there.
- **`--queue-index` that is not a whole number from 1** is refused by commander's own argument validation (exit 2) with a plain sentence; only a number past the end of the list gets the spec's "There's no task N; your queue has M." sentence.
- **An unknown `--role`** is refused by commander's own `choices` (exit 2), which lists the two allowed values.
- **Heading lines:** queue default `Next up is Task 2 of 3: <task>`; chosen index `Task 3 of 3: <task>`; single `task` `Your task: <task>`. Role line: `What the worker will be told (before any run starts):` or `What the agent that repairs your check will be told (before any run starts):`.
- **Everyday tool phrases:** `Read` read files; `Glob` and `Grep` look through the project; `Edit` and `Write` edit files; `Bash` run commands. Duplicate phrases collapse, first-seen order kept; anything else printed as written.
- **Wire capture in Task 6:** claude-mock's journal records only the task turn, and the system prompt travels in the SDK's opening `initialize` control request (verified while planning: `{"type":"control_request","request":{"subtype":"initialize","systemPrompt":["…"]}}`). `vendor/README.md` forbids editing the vendored journal here, so the test wraps the vendored mock in a two-line shell script that `tee`s stdin to a file. Marked with a `ponytail:` comment naming the upgrade (have claude-mock journal the initialize request upstream, then re-vendor).
- **`preview --json`:** the global `--json` flag is accepted and ignored, as `validate` does before slice 9. No machine-readable preview is designed.

## Scaffolding Impact

- `delivery --help` gains a `preview` command with its description and `--queue-index`, `--role`, `--config`, `--repo` options → Task 4 (`--role`, `--config`, `--repo`) and Task 5 (`--queue-index`), in `src/cli/program.ts`.
- `README.md` gains a "See what the agent will be told" section after "Check your setup before a run", and the `domain` row of the settings table says `delivery preview` shows the description in place → Task 5.
- `.changeset/see-what-the-agent-will-be-told.md` (minor) records the new command for the changelog, following `.changeset/check-your-setup-for-free.md` → Task 5.
- Proactive DX, the preview's truthfulness check: a regression test (`src/cli/preview-matches-run.test.ts`) that needs no network and no credential and runs under the normal `vitest run` → Task 6.
- Checked and unaffected: `docs/configuring-a-role.md`, `docs/agent-interface.md` (describe prompt assembly, which does not change; slice 5 owns role-override docs), `CONTRIBUTING.md` (no new test seam or env var), `vendor/README.md` (the vendored copy is not touched), the `understanding-claude-mock` skill (claude-mock's formats do not change).

---

### Task 1: A pure "record a new run starts with", shared by `create()`

**Files:**
- Modify: `src/case-file.ts` (the `create` function, currently lines 60-82)
- Test: `src/case-file.test.ts`

**Interfaces:**
- Consumes: `CreateHeader`, `BudgetSet`, `CaseFile`, `CaseFileHeader` from `src/schema.ts`.
- Produces: `export function initialCaseFile(header: CreateHeader, budgetDefaults: BudgetSet): CaseFile` in `src/case-file.ts`. Pure: no I/O, no clock. `create(dir, header, budgetDefaults)` keeps its signature and now returns `initialCaseFile(header, budgetDefaults)` after writing it.

- [ ] **Step 1: Write the failing test**

In `src/case-file.test.ts`, add `initialCaseFile` to the existing import from `./case-file.js` and add `CreateHeader` to the existing type import from `./schema.js`:

```ts
import { create, initialCaseFile, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setBaseBranch, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog, setbackOf } from "./case-file.js";
import type { BudgetSet, CreateHeader, HistoryEntry, GateReport } from "./schema.js";
```

Then add, directly after the existing `describe("create", ...)` block:

```ts
describe("initialCaseFile", () => {
  it("is exactly the record create() writes and returns, worked out without touching disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "case-file-initial-"));
    const header: CreateHeader = {
      surfaceId: "surface-1",
      taskDef: { intent: "fix bug" },
      gateRef,
      closerRef: { type: "commit-to-branch" },
      domainPrompt: "A small tool.",
    };

    const pure = initialCaseFile(header, budgetDefaults);

    expect(await create(dir, header, budgetDefaults)).toEqual(pure);
    expect(await load(dir)).toEqual(pure);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/case-file.test.ts -t initialCaseFile`
Expected: FAIL (`initialCaseFile` is not exported from `./case-file.js`, so it is `undefined` and calling it throws "initialCaseFile is not a function").

- [ ] **Step 3: Write the minimal implementation**

In `src/case-file.ts`, replace the whole `create` function with:

```ts
/**
 * The record a run starts with: nothing measured, nothing tried, every budget
 * at its default. Pure, so something that needs a new run's record without
 * writing one (what `delivery preview` shows an agent would be told) gets
 * exactly the record `create()` writes, not a copy of its shape.
 */
export function initialCaseFile(header: CreateHeader, budgetDefaults: BudgetSet): CaseFile {
  return {
    header: { ...header, baseline: null, baseBranch: null },
    cursor: { state: "PROVISIONING", budgets: budgetDefaults, worktreeRef: "" },
    history: [],
  };
}

export async function create(
  dir: string,
  header: CreateHeader,
  budgetDefaults: BudgetSet,
): Promise<CaseFile> {
  const caseFile = initialCaseFile(header, budgetDefaults);
  const caseJson: CaseJson = CaseJson.parse({ header: caseFile.header, cursor: caseFile.cursor });

  try {
    await Promise.all([
      atomicWriteJson(join(dir, "case.json"), caseJson),
      writeAndSync(join(dir, "log.jsonl"), "w", ""),
    ]);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }

  return caseFile;
}
```

`CaseFileHeader` was used only by the old `create` body, so remove it from the `./schema.js` import on line 3 of `src/case-file.ts` (lint fails on an unused import).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/case-file.test.ts`
Expected: PASS (the new test and every existing `create` test).

- [ ] **Step 5: Commit**

```bash
git add src/case-file.ts src/case-file.test.ts
git commit -m "Extract initialCaseFile from create() as a pure function

A preview of what an agent will be told needs the record a new run starts
with, without writing one. Taking it from the function create() itself uses,
rather than rebuilding its shape elsewhere, is what keeps the preview and a
real run reading the same record.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: One rule for "the next task on the list", shared by `runQueue`

**Files:**
- Modify: `src/cli/queue.ts`
- Test: `src/cli/queue.test.ts`

**Interfaces:**
- Consumes: `findQueueRun(records, taskDef)`, `QueuePosition` (already in `src/cli/queue.ts`); `RunRecord`, `allRuns` from `src/cli/runs.ts`; `writeRunRecord` from `src/cli/command-fixtures.ts` (tests only).
- Produces: `export function nextQueueTask(records: RunRecord[], tasks: TaskDef[]): QueuePosition | undefined` in `src/cli/queue.ts`: the first task whose answering run is not closed, as `{ task: index + 1, of: tasks.length }`, or `undefined` when every task has a closed run. `runQueue` uses the same closed test.

- [ ] **Step 1: Write the failing tests**

In `src/cli/queue.test.ts`, extend the imports:

```ts
import { writeRunRecord } from "./command-fixtures.js";
import { findQueueRun, nextQueueTask, queuePositionOf, queueTasks } from "./queue.js";
```

Append:

```ts
describe("the next task on the list, as `delivery run` would pick it", () => {
  const WAVE = "add a function that waves at a name";
  const tasks = queueTasks({ tasks: [PAGE, SWAP, WAVE] });
  const at = "2026-09-17T09:00:00.000Z";

  it("is the first task when nothing has run yet", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("passes over a task whose run was delivered", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "closed", source: "close", reason: "committed", at } });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 2, of: 3 });
  });

  it("stops at a task whose run needs a decision, rather than skipping it", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "escalated", source: "worker", reason: "authority", at } });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("stops at a task whose run was interrupted", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("is nothing when every task was delivered", async () => {
    const repo = await scratchRepo();
    for (const [i, task] of [PAGE, SWAP, WAVE].entries()) {
      await writeRunRecord(repo, { runId: `task-${i}-20260917T09000${i}Z`, task, outcome: { kind: "closed", source: "close", reason: "committed", at } });
    }
    expect(nextQueueTask(await allRuns(repo), tasks)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/queue.test.ts`
Expected: FAIL ("nextQueueTask is not a function").

- [ ] **Step 3: Write the minimal implementation**

In `src/cli/queue.ts`, add after `findQueueRun`:

```ts
/** Whether a task is done with: only a delivered run is. One that escalated or was stopped still needs the owner, so the list waits on it. */
const isClosed = (record: RunRecord | undefined): boolean => record?.caseFile.outcome?.kind === "closed";

/**
 * The task `delivery run` would act on next: the first one on the list whose
 * run has not been delivered, counted as "Task N of M" counts. Nothing when
 * every task is done. The same rule `runQueue` walks the list by, so what
 * `delivery preview` calls next is what a run does next.
 */
export function nextQueueTask(records: RunRecord[], tasks: TaskDef[]): QueuePosition | undefined {
  const index = tasks.findIndex((taskDef) => !isClosed(findQueueRun(records, taskDef)));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}
```

In `runQueue`, replace:

```ts
    if (existing?.caseFile.outcome?.kind === "closed") continue;
```

with:

```ts
    if (isClosed(existing)) continue;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts`
Expected: PASS (new tests, and the existing queue-driving `run` tests that cover `runQueue`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/queue.ts src/cli/queue.test.ts
git commit -m "Add nextQueueTask so the list's next task is decided in one place

delivery preview has to name the task delivery run would act on next. Taking
that from the rule runQueue walks the list by, rather than restating it,
keeps the two from disagreeing about an escalated or interrupted entry.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Split validate's reading of a project so preview refuses in the same words

**Files:**
- Modify: `src/cli/validate-command.ts`
- Test: `src/cli/validate-command.test.ts` (existing tests are the safety net; no new test, this is a behaviour-preserving refactor)

**Interfaces:**
- Consumes: `findConfig`, `readConfig`, `DeliveryConfig` (`src/cli/config.ts`); `findRepository` (`src/cli/project.ts`); `resolveProject`, `checkCustomModules`, `ProjectSettings` (`src/cli/settings.ts`).
- Produces, in `src/cli/validate-command.ts`:
  - `export async function locateConfig(options: ValidateOptions, ctx: CommandContext): Promise<{ repoPath: string; file: string }>`: throws `Refusal(NO_CONFIG, EXIT.configuration)` when there is no file.
  - `export async function readProject(file: string, repoPath: string, env: NodeJS.ProcessEnv): Promise<{ config: DeliveryConfig; project: ProjectSettings }>`: parses the file, resolves what a run would use, loads (never runs) custom modules; throws the first problem.
  - `ValidateOptions` unchanged (`{ config?: string; repo?: string }`); Task 4's `PreviewOptions` extends it.

- [ ] **Step 1: Confirm the safety net is green**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: PASS.

- [ ] **Step 2: Refactor**

In `src/cli/validate-command.ts`, replace the whole `validateCommand` function (and its doc comment) with:

```ts
/**
 * Where this invocation's config file is, and the repository it belongs to.
 * No file is refused: a command asked about a project's setup has no setup to
 * read, and answering from the defaults would be a guess. (`run` treats no
 * file as "use the defaults"; it is not asked about the setup.)
 */
export async function locateConfig(options: ValidateOptions, ctx: CommandContext): Promise<{ repoPath: string; file: string }> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  return { repoPath, file };
}

/**
 * Everything `delivery run` would read before setting anything up, and
 * nothing more: the file's settings, the check and closing action a run would
 * use (no flags, the environment a run here would also see), and any module
 * of the project's own, loaded but never run. The first problem is thrown and
 * rendered as every command's are: one plain sentence, the configuration exit
 * code. Shared by `validate` and `preview`, so both refuse in the same words.
 */
export async function readProject(
  file: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await readConfig(file);
  const project = await resolveProject({}, { env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  return { config, project };
}

/**
 * `delivery validate`: check the project's configuration the way `delivery
 * run` would before it set anything up, and stop there. Everything it does is
 * a read, so it needs no agent, no sign-in and no network, and is safe beside
 * a run in progress.
 */
export async function validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, file } = await locateConfig(options, ctx);
  // Both sides real: discovery answers with real paths and a named file may not be one.
  ctx.writeLine(`Checking ${relative(realpathSync(ctx.cwd), realpathSync(file))}…`);
  const { config, project } = await readProject(file, repoPath, ctx.env);
  for (const line of checkedLines(config, project)) ctx.writeLine(line);
  ctx.writeLine(READY);
  return EXIT.ok;
}
```

The import block at the top of the file needs no change (every name is still used).

- [ ] **Step 3: Run the tests to verify behaviour is unchanged**

Run: `npx vitest run src/cli/validate-command.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/validate-command.ts
git commit -m "Split validate's reading of a project into locateConfig and readProject

delivery preview must refuse a broken configuration in exactly the words
delivery validate uses. Sharing the steps that find, parse and check the
file, rather than repeating them, is what makes that true by construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `delivery preview` shows the next task's instructions, for either role

**Files:**
- Create: `src/cli/preview-command.ts`
- Create: `src/cli/preview-command.test.ts`
- Modify: `src/cli/drive.ts` (add `RUN_ROLES`, use it in `driveToOutcome`)
- Modify: `src/cli/program.ts` (register `preview`)

**Interfaces:**
- Consumes: `initialCaseFile` (Task 1); `nextQueueTask`, `queueTasks`, `taskHeading`, `EVERY_TASK_DONE` (`src/cli/queue.ts`, Task 2); `locateConfig`, `readProject`, `ValidateOptions`, `NO_CONFIG` (Task 3); `assemblePrompt`, `PromptEvidence` (`src/prompt-assembly.ts`); `allRuns` (`src/cli/runs.ts`); `NO_TASK`, `taskIntent` (`src/cli/settings.ts`); `RoleConfigs` (`src/agent-invoke.ts`).
- Produces:
  - `src/cli/drive.ts`: `export const RUN_ROLES: RoleConfigs`, the roles every command-line run uses; `driveToOutcome` passes it to `createAgentPort`.
  - `src/cli/preview-command.ts`:
    - `export type PreviewRole = "worker" | "gate-maintenance"`
    - `export const PREVIEW_ROLES: readonly PreviewRole[]`
    - `export interface PreviewOptions extends ValidateOptions { queueIndex?: number; role: PreviewRole }` (`queueIndex` is wired in Task 5)
    - `export const RULE: string` (the frame line; Task 6 splits on it)
    - `export function toolsLine(tools: readonly string[]): string`
    - `export async function previewCommand(options: PreviewOptions, ctx: CommandContext): Promise<ExitCode>`
  - What it prints: heading line, blank line, role line, `RULE`, then `` `${systemPrompt}\n\n${prompt}` `` exactly as `assemblePrompt` returned them (so the block between the rules is that string plus the newline `writeLine` adds), `RULE`, tools line.

- [ ] **Step 1: Write the failing tests**

Create `src/cli/preview-command.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, runsRoot, writeRunRecord } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { RULE, toolsLine } from "./preview-command.js";
import { EVERY_TASK_DONE } from "./queue.js";
import { NO_TASK } from "./settings.js";

// preview must work on a machine with no Claude Code runtime and no sign-in.
// The one way into the agent runtime fails loudly in every test here.
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("preview must never start an agent");
  },
}));

const DOMAIN = "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.";
const FIRST = "add a page that shows who's on call today";
const SECOND = "let someone swap their on-call day with a teammate";
const THIRD = "send a reminder the morning before someone's day";
const PROJECT = { domain: DOMAIN, tasks: [FIRST, SECOND, THIRD], gate: { type: "command", command: "npm test", parseMode: "exitcode" } };
const CLOSED = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;

/** A committed repository with a test script and, unless `config` is undefined, a delivery.config.json holding it. */
function repoWith(config: unknown, files: Record<string, string> = {}): string {
  return initTempRepo("preview-", {
    "package.json": PACKAGE,
    ...(config === undefined ? {} : { "delivery.config.json": JSON.stringify(config) }),
    ...files,
  });
}

describe("the everyday phrase for each tool", () => {
  it("says what the worker's tools let it do, once each, in order", () => {
    expect(toolsLine(workerRoleConfig.allowedTools)).toBe("Tools it can use: read files, look through the project, edit files, run commands.");
  });

  it("prints a tool with no everyday phrase as written", () => {
    expect(toolsLine(["Read", "WebFetch"])).toBe("Tools it can use: read files, WebFetch.");
  });
});

describe("delivery preview", () => {
  it("names the next task, then frames the worker's instructions with the description and the task in the owner's words", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, stderr, exitCode } = await delivery(["preview"], { cwd: repo });

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 4)).toEqual([`Next up is Task 1 of 3: ${FIRST}`, "", "What the worker will be told (before any run starts):", RULE]);
    expect(lines[4]).toBe(workerRoleConfig.systemPromptFragment.split("\n")[0]);
    expect(stdout).toContain(`${workerRoleConfig.systemPromptFragment}\n\n${DOMAIN}\n\n## Task`);
    expect(stdout).toContain(`"intent": "${FIRST}"`);
    expect(stdout.endsWith(`${RULE}\n${toolsLine(workerRoleConfig.allowedTools)}\n`)).toBe(true);
  });

  it("passes over a task whose run was delivered, as delivery run would", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    const { stdout } = await delivery(["preview"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe(`Next up is Task 2 of 3: ${SECOND}`);
    expect(stdout).toContain(`"intent": "${SECOND}"`);
  });

  it("shows the description as the file says it now", async () => {
    const repo = repoWith(PROJECT);
    const reworded = "A small internal tool for the support team's on-call rota.";
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ ...PROJECT, domain: reworded }));
    const { stdout } = await delivery(["preview"], { cwd: repo });
    expect(stdout).toContain(reworded);
    expect(stdout).not.toContain(DOMAIN);
  });

  it("prints the same thing twice for the same project", async () => {
    const repo = repoWith(PROJECT);
    expect((await delivery(["preview"], { cwd: repo })).stdout).toBe((await delivery(["preview"], { cwd: repo })).stdout);
  });

  it("shows what the agent that repairs the check is told, and what it may do, when asked for that role", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, exitCode } = await delivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("What the agent that repairs your check will be told (before any run starts):");
    expect(stdout).toContain(`${gateMaintenanceRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
    expect(stdout.endsWith(`${toolsLine(gateMaintenanceRoleConfig.allowedTools)}\n`)).toBe(true);
    expect(toolsLine(gateMaintenanceRoleConfig.allowedTools)).toBe("Tools it can use: read files, look through the project, edit files.");
  });

  it("refuses a role it cannot show, naming the two it can", async () => {
    const repo = repoWith(PROJECT);
    const { stderr, exitCode } = await delivery(["preview", "--role", "triage"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("worker, gate-maintenance");
  });

  it.each(["worker", "gate-maintenance"])("uses none of the harness's own words for the %s", async (role) => {
    const repo = repoWith(PROJECT);
    const { stdout } = await delivery(["preview", "--role", role], { cwd: repo });
    expect(stdout).not.toMatch(/worktree|envelope|surface|case file|role config/i);
  });

  it("previews a single `task` when the file has no list", async () => {
    const repo = repoWith({ domain: DOMAIN, task: { intent: FIRST } });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe(`Your task: ${FIRST}`);
    expect(stdout).toContain(`"intent": "${FIRST}"`);
  });

  it("says what delivery run says when the file names no task at all", async () => {
    const repo = repoWith({ domain: DOMAIN });
    const { stdout, stderr, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(stderr).toBe(`${NO_TASK}\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says every task is done when each has a delivered run", async () => {
    const repo = repoWith({ tasks: [FIRST, SECOND] });
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    await writeRunRecord(repo, { runId: "let-someone-20260917T100000Z", task: SECOND, outcome: CLOSED });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(stdout).toBe(`${EVERY_TASK_DONE}\n`);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("reads the file --config names, in the repository --repo names", async () => {
    const repo = repoWith(undefined, { "elsewhere.json": JSON.stringify(PROJECT) });
    const elsewhere = mkdtempSync(join(tmpdir(), "preview-elsewhere-"));
    const { stdout, exitCode } = await delivery(["preview", "--repo", repo, "--config", join(repo, "elsewhere.json")], { cwd: elsewhere });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(DOMAIN);
  });
});

describe("delivery preview on a configuration with a problem", () => {
  it.each<[string, unknown, Record<string, string>]>([
    ["no config file", undefined, {}],
    ["an empty description", { ...PROJECT, domain: "  " }, {}],
    ["an empty list", { ...PROJECT, tasks: [] }, {}],
    ["an empty entry", { ...PROJECT, tasks: [FIRST, "", THIRD] }, {}],
    ["two entries that are the same task", { ...PROJECT, tasks: [FIRST, SECOND, FIRST] }, {}],
    ["both a single task and a list", { ...PROJECT, task: { intent: FIRST } }, {}],
    ["a custom check that can't be loaded", { ...PROJECT, gate: { type: "custom", modulePath: "./gates/nope.mjs" } }, {}],
  ])("with %s, says exactly what delivery validate says", async (_, config, files) => {
    const repo = repoWith(config, files);
    const validate = await delivery(["validate"], { cwd: repo });
    const preview = await delivery(["preview"], { cwd: repo });
    expect(validate.exitCode).toBe(EXIT.configuration);
    expect(preview.stderr).toBe(validate.stderr);
    expect(preview.stdout).toBe("");
    expect(preview.exitCode).toBe(EXIT.configuration);
  });
});

describe("delivery preview changes nothing", () => {
  it("leaves the repository and its run records as they were", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST });
    const status = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });
    const before = { status: status(), runs: readdirSync(runsRoot(repo), { recursive: true }) };

    expect((await delivery(["preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);

    expect({ status: status(), runs: readdirSync(runsRoot(repo), { recursive: true }) }).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/preview-command.test.ts`
Expected: FAIL (module `./preview-command.js` does not exist).

- [ ] **Step 3: Share the run's role configurations**

In `src/cli/drive.ts`, add `type RoleConfigs` to the existing type import from `../agent-invoke.js`:

```ts
import type { RoleConfigs, SessionEnvironment } from "../agent-invoke.js";
```

Add, after the `RunStart` interface:

```ts
/**
 * The roles every run from the command line is given. One object, so what
 * `delivery preview` shows an agent will be told is what a run tells it.
 */
export const RUN_ROLES: RoleConfigs = {
  worker: workerRoleConfig,
  "gate-maintenance": gateMaintenanceRoleConfig,
  triage: triageRoleConfig,
};
```

In `driveToOutcome`, replace:

```ts
  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
```

with:

```ts
  const agent = createAgentPort(RUN_ROLES, session);
```

- [ ] **Step 4: Write the command**

Create `src/cli/preview-command.ts`:

```ts
import { initialCaseFile } from "../case-file.js";
import { assemblePrompt, type PromptEvidence } from "../prompt-assembly.js";
import type { TaskDef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { RUN_ROLES } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { EVERY_TASK_DONE, nextQueueTask, queueTasks, taskHeading } from "./queue.js";
import { allRuns } from "./runs.js";
import { NO_TASK, taskIntent } from "./settings.js";
import { locateConfig, readProject, type ValidateOptions } from "./validate-command.js";

/** The roles an owner can see the instructions of. Triage is the harness's own and is not configurable from the file. */
export type PreviewRole = "worker" | "gate-maintenance";
export const PREVIEW_ROLES: readonly PreviewRole[] = ["worker", "gate-maintenance"];

/** What `delivery preview` was given on the command line. */
export interface PreviewOptions extends ValidateOptions {
  /** Which task on the list, counted from 1 as "Task N of M" counts. */
  queueIndex?: number;
  role: PreviewRole;
}

/** The line above and below the instructions, so where they start and stop is never in doubt. */
export const RULE = "─".repeat(53);

/** Who the instructions are for, as a person reads it. */
const WHO: Record<PreviewRole, string> = {
  worker: "the worker",
  "gate-maintenance": "the agent that repairs your check",
};

/** What each tool lets an agent do, in everyday words. */
const TOOL_PHRASES: Record<string, string> = {
  Read: "read files",
  Glob: "look through the project",
  Grep: "look through the project",
  Edit: "edit files",
  Write: "edit files",
  Bash: "run commands",
};

/** What the agent may do, once per phrase, in the role's own order. A tool with no everyday phrase is named as written, never hidden. */
export function toolsLine(tools: readonly string[]): string {
  const phrases = [...new Set(tools.map((tool) => TOOL_PHRASES[tool] ?? tool))];
  return `Tools it can use: ${phrases.join(", ")}.`;
}

/**
 * What a run's first dispatch has to go on besides its record: nothing yet.
 * No brief, because nothing has been tried; no failing checks; no setback.
 */
const FIRST_DISPATCH: PromptEvidence = { brief: null, newFailures: [], setback: null };

/** The task to preview, and the line that names it. Undefined when every task on the list is done. */
async function chooseTask(config: DeliveryConfig, repoPath: string): Promise<{ heading: string; taskDef: TaskDef } | undefined> {
  if (config.tasks) {
    const tasks = queueTasks(config);
    const next = nextQueueTask(await allRuns(repoPath), tasks);
    if (next === undefined) return undefined;
    const taskDef = tasks[next.task - 1] as TaskDef;
    return { heading: `Next up is ${taskHeading(next, taskIntent(taskDef))}`, taskDef };
  }
  if (config.task) return { heading: `Your task: ${taskIntent(config.task)}`, taskDef: config.task };
  throw new Refusal(NO_TASK, EXIT.configuration);
}

/**
 * `delivery preview`: print, before anything runs, exactly what an agent
 * would be told about this project and one of its tasks.
 *
 * Nothing here renders a prompt. The record a run of the task would start
 * with comes from `initialCaseFile`, the role from `RUN_ROLES`, and the text
 * from the library's own `assemblePrompt`: the same function, on the same
 * inputs, a run's first dispatch uses. Everything else is a read, so it needs
 * no agent, no sign-in and no network, and is safe beside a run in progress.
 */
export async function previewCommand(options: PreviewOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, file } = await locateConfig(options, ctx);
  const { config, project } = await readProject(file, repoPath, ctx.env);
  const chosen = await chooseTask(config, repoPath);
  if (chosen === undefined) {
    ctx.writeLine(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const roleCfg = RUN_ROLES[options.role];
  const { gateRef, closerRef, domainPrompt, budgets } = project;
  // The id is fixed rather than made from the clock, as a real run's is: it
  // is not part of what an agent is told, and a fixed one keeps two previews
  // of the same project identical.
  const standIn = initialCaseFile({ surfaceId: "preview", taskDef: chosen.taskDef, gateRef, closerRef, domainPrompt }, budgets);
  const { systemPrompt, prompt } = assemblePrompt(standIn, roleCfg, FIRST_DISPATCH);

  ctx.writeLine(chosen.heading);
  ctx.writeLine("");
  ctx.writeLine(`What ${WHO[options.role]} will be told (before any run starts):`);
  ctx.writeLine(RULE);
  ctx.writeLine(`${systemPrompt}\n\n${prompt}`);
  ctx.writeLine(RULE);
  ctx.writeLine(toolsLine(roleCfg.allowedTools));
  return EXIT.ok;
}
```

- [ ] **Step 5: Register the command**

In `src/cli/program.ts`, change the commander import and add the preview import:

```ts
import { Command, CommanderError, Option } from "commander";
import { PREVIEW_ROLES, previewCommand, type PreviewOptions } from "./preview-command.js";
```

Register, directly after the `validate` command block:

```ts
  program
    .command("preview")
    .description(
      "show exactly what the agent will be told for the next task on your list, before anything runs: no agent, no sign-in, and nothing on disk changes",
    )
    .addOption(
      new Option("--role <role>", "whose instructions to show: the worker doing the task, or gate-maintenance, the agent that repairs your check when it can't run")
        .choices(PREVIEW_ROLES)
        .default("worker"),
    )
    .option("--config <path>", "read this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to read (default: the current folder)")
    .action(async (options: PreviewOptions, command: Command) => {
      exitCode = await previewCommand(options, contextFor(io, command));
    });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/preview-command.test.ts src/cli/validate-command.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; no type or lint errors. (`validate-command.test.ts` is included because Task 3's split is now consumed by a second command.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/preview-command.ts src/cli/preview-command.test.ts src/cli/drive.ts src/cli/program.ts
git commit -m "Add delivery preview to show what the agent will be told

Owners trust what they can inspect. preview prints, before anything runs,
the instructions the next task on the list would be given, with the project
description in place and the tools in everyday words. It renders nothing
itself: the stand-in record, the role and the text all come from the same
functions a run uses, so what is shown is what is sent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Choose a task by its number; document the command

**Files:**
- Modify: `src/cli/preview-command.ts` (`chooseTask`, `previewCommand`)
- Modify: `src/cli/program.ts` (`--queue-index` option and its parser)
- Modify: `src/cli/preview-command.test.ts`
- Modify: `README.md`
- Create: `.changeset/see-what-the-agent-will-be-told.md`

**Interfaces:**
- Consumes: everything Task 4 produced; `InvalidArgumentError` from `commander`.
- Produces, in `src/cli/preview-command.ts`:
  - `export const noSuchTask = (n: number, of: number): string` → `` `There's no task ${n}; your queue has ${of}.` ``
  - `export const SINGLE_TASK: string`
  - `export const TASK_NUMBER: string` (commander's parser message for a value that is not a whole number from 1)
  - `export function taskNumber(value: string): number` (commander argument parser; throws `InvalidArgumentError(TASK_NUMBER)`)
  - `chooseTask(config, repoPath, queueIndex?)` (module-private) honours `queueIndex`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/preview-command.test.ts`, extend the preview import:

```ts
import { noSuchTask, RULE, SINGLE_TASK, TASK_NUMBER, toolsLine } from "./preview-command.js";
```

Append:

```ts
describe("delivery preview --queue-index", () => {
  it("shows the task with that number, counted as Task N of M counts", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, exitCode } = await delivery(["preview", "--queue-index", "3"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe(`Task 3 of 3: ${THIRD}`);
    expect(stdout).toContain(`"intent": "${THIRD}"`);
    expect(stdout).toContain(DOMAIN);
  });

  it("shows a task that is already done, when asked for it by number", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    const { stdout } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe(`Task 1 of 3: ${FIRST}`);
  });

  it("refuses a number past the end of the list, saying how many there are", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, stderr, exitCode } = await delivery(["preview", "--queue-index", "9"], { cwd: repo });
    expect(stderr).toBe(`${noSuchTask(9, 3)}\n`);
    expect(noSuchTask(9, 3)).toBe("There's no task 9; your queue has 3.");
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it.each(["0", "-1", "two", "1.5"])("refuses %s, which is not a task number", async (value) => {
    const repo = repoWith(PROJECT);
    const { stderr, exitCode } = await delivery(["preview", `--queue-index=${value}`], { cwd: repo });
    expect(stderr).toContain(TASK_NUMBER);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("refuses a number for a project with a single `task`, which has no list to count in", async () => {
    const repo = repoWith({ task: { intent: FIRST } });
    const { stderr, exitCode } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stderr).toBe(`${SINGLE_TASK}\n`);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says what delivery run says when there is no task at all, number or not", async () => {
    const repo = repoWith({ domain: DOMAIN });
    const { stderr, exitCode } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stderr).toBe(`${NO_TASK}\n`);
    expect(exitCode).toBe(EXIT.configuration);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/preview-command.test.ts -t "queue-index"`
Expected: FAIL (the new names are not exported; `--queue-index` is an unknown option).

- [ ] **Step 3: Implement task selection by number**

In `src/cli/preview-command.ts`, add `InvalidArgumentError` from commander at the top:

```ts
import { InvalidArgumentError } from "commander";
```

Add, after `PreviewOptions`:

```ts
export const noSuchTask = (n: number, of: number): string => `There's no task ${n}; your queue has ${of}.`;

export const SINGLE_TASK =
  "This project has a single `task`, not a list, so there's no task number to choose. Leave out `--queue-index` to see it.";

export const TASK_NUMBER = 'A task number is a whole number from 1, as in "Task 1 of 3".';

/** `--queue-index`'s value as a task number, or commander's own refusal naming the option. */
export function taskNumber(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError(TASK_NUMBER);
  return n;
}
```

Replace `chooseTask` with:

```ts
/**
 * The task to preview, and the line that names it: the one asked for by
 * number, or the one `delivery run` would act on next. Undefined when nothing
 * was asked for by number and every task on the list is done.
 */
async function chooseTask(
  config: DeliveryConfig,
  repoPath: string,
  queueIndex: number | undefined,
): Promise<{ heading: string; taskDef: TaskDef } | undefined> {
  if (config.tasks) {
    const tasks = queueTasks(config);
    if (queueIndex !== undefined) {
      const taskDef = tasks[queueIndex - 1];
      if (taskDef === undefined) throw new Refusal(noSuchTask(queueIndex, tasks.length), EXIT.configuration);
      return { heading: taskHeading({ task: queueIndex, of: tasks.length }, taskIntent(taskDef)), taskDef };
    }
    const next = nextQueueTask(await allRuns(repoPath), tasks);
    if (next === undefined) return undefined;
    const taskDef = tasks[next.task - 1] as TaskDef;
    return { heading: `Next up is ${taskHeading(next, taskIntent(taskDef))}`, taskDef };
  }
  if (!config.task) throw new Refusal(NO_TASK, EXIT.configuration);
  if (queueIndex !== undefined) throw new Refusal(SINGLE_TASK, EXIT.configuration);
  return { heading: `Your task: ${taskIntent(config.task)}`, taskDef: config.task };
}
```

In `previewCommand`, change the call to:

```ts
  const chosen = await chooseTask(config, repoPath, options.queueIndex);
```

- [ ] **Step 4: Register the option**

In `src/cli/program.ts`, extend the preview import:

```ts
import { PREVIEW_ROLES, previewCommand, taskNumber, type PreviewOptions } from "./preview-command.js";
```

In the `preview` command block, add before `.addOption(`:

```ts
    .option("--queue-index <n>", 'show this task on your list instead, counted from 1 as in "Task 1 of 3"', taskNumber)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/preview-command.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; no type or lint errors.

- [ ] **Step 6: Document the command**

In `README.md`, in the "Configure it once" settings table, replace the `domain` row with:

```markdown
| `domain` | What your project is, in your own words: every agent on every run of it is told this before its own instructions. A run keeps the description it started with, so editing it changes the next run, not one already going. A long one is easiest in a `delivery.config.js` with a template literal. `delivery preview` shows it in place. |
```

Insert this section immediately before `## Documentation`:

````markdown
## See what the agent will be told

```bash
delivery preview
```

It prints, before anything runs, the instructions the next task on your list would be given,
word for word, with your project description in place, and then what the agent may do:

```
Next up is Task 1 of 3: add a page that shows who's on call today

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.

## Task
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run commands.
```

`--queue-index 3` shows the third task on your list instead, numbered as "Task 3 of 3" numbers
it. `--role gate-maintenance` shows what the agent that repairs your check is told when the
check can't run. A project with a single `task` shows that one. Like `delivery validate`, it
needs no agent, no sign-in and no network, changes nothing on disk, reports a problem with your
configuration in the same words, and takes `--config` and `--repo`.
````

Create `.changeset/see-what-the-agent-will-be-told.md`:

```markdown
---
"delivery-service": minor
---

`delivery preview` prints, before anything runs, exactly what the agent will be told for a task
in `delivery.config.json`: the next one `delivery run` would do, or the one `--queue-index <n>`
names, counted as "Task N of M" counts. The instructions appear word for word, with the project
description in place, followed by what the agent may do in everyday words ("read files", "edit
files", "run commands"). `--role gate-maintenance` shows the instructions for the agent that
repairs a check that can't run. A number past the end of the list is refused with how many tasks
there are; a configuration problem is reported in the same words `delivery validate` uses. It
needs no agent, no sign-in and no network, changes nothing on disk, and takes `--config` and
`--repo`.
```

Check no em-dash crept into either file: `grep -n "—" .changeset/see-what-the-agent-will-be-told.md; sed -n '/^## See what the agent will be told/,/^## Documentation/p' README.md | grep -n "—"` → expect no output.

- [ ] **Step 7: Commit**

```bash
git add src/cli/preview-command.ts src/cli/preview-command.test.ts src/cli/program.ts README.md .changeset/see-what-the-agent-will-be-told.md
git commit -m "Let delivery preview show a task by its number, and document it

An owner tuning the description wants to read the brief for any task on the
list, not only the next one. The number is the one delivery run prints as
Task N of M, so there is one way to count; a number past the end says how
many there are, and a project with a single task has nothing to count.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Prove the preview is what a real run sends

**Files:**
- Create: `src/cli/preview-matches-run.test.ts`

**Interfaces:**
- Consumes: `RULE` (Task 4); `delivery`, `completes`, `scriptFile`, `PACKAGE`, `RUN_TIMEOUT` (`src/cli/command-fixtures.ts`); `mockSessionEnvironment`, `resolveMockExecutable` (`src/mock-session.ts`); `SessionEnvironment` (`src/agent-invoke.ts`); `initTempRepo` (`src/temp-repo.ts`).
- Produces: a regression test only. No production code changes.

This test is expected to pass on first run once Tasks 4 and 5 are in: its job is to fail later if a run and the preview ever drift apart (for example when slice 5 lets the file change a role). Step 3 proves it can fail.

- [ ] **Step 1: Write the test**

Create `src/cli/preview-matches-run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEnvironment } from "../agent-invoke.js";
import { mockSessionEnvironment, resolveMockExecutable } from "../mock-session.js";
import { initTempRepo } from "../temp-repo.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { RULE } from "./preview-command.js";

// `delivery run` gets its agent from agentSession; this file hands it the
// scripted agent with a recorder in front, so the real queue path runs
// unchanged and what it sends can be read back.
const wiring = vi.hoisted(() => ({ session: undefined as SessionEnvironment | undefined }));
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: async () => {
    if (wiring.session === undefined) throw new Error("no session wired for this test");
    return wiring.session;
  },
}));

/**
 * The scripted agent, with everything the harness sends it copied to
 * `capture` on the way in. claude-mock's journal records only the task turn;
 * the instructions travel in the SDK's opening `initialize` request, so the
 * wire is the only place to read them.
 * ponytail: a tee in front of stdin. If claude-mock journals the initialize request upstream, re-vendor and read the journal instead.
 */
function recordingSession(scriptPath: string, capture: string): SessionEnvironment {
  const wrapper = join(mkdtempSync(join(tmpdir(), "preview-wire-")), "claude");
  writeFileSync(wrapper, `#!/bin/sh\ntee -a '${capture}' | '${process.execPath}' '${resolveMockExecutable()}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  return { ...mockSessionEnvironment({ scriptPath, journalPath: `${scriptPath}.journal.jsonl` }), pathToClaudeCodeExecutable: wrapper };
}

interface Sent {
  systemPrompt: string;
  prompt: string;
}

interface Frame {
  type?: string;
  request?: { subtype?: string; systemPrompt?: string[] };
  message?: { content?: Array<{ type?: string; text?: string }> | string };
}

/** Each session's instructions and its one turn, in the order the sessions started. */
function sessionsSent(capture: string): Sent[] {
  const frames = readFileSync(capture, "utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Frame);
  const systemPrompts = frames.flatMap((f) =>
    f.type === "control_request" && f.request?.subtype === "initialize" ? [(f.request.systemPrompt ?? []).join("")] : [],
  );
  const prompts = frames.flatMap((f) => {
    const content = f.type === "user" ? f.message?.content : undefined;
    if (content === undefined) return [];
    return [typeof content === "string" ? content : content.map((block) => block.text ?? "").join("\n")];
  });
  return systemPrompts.map((systemPrompt, i) => ({ systemPrompt, prompt: prompts[i] ?? "" }));
}

/** The instructions a preview printed: everything between its two rules. */
function framed(stdout: string): string {
  const block = stdout.split(`${RULE}\n`)[1];
  if (block === undefined) throw new Error(`no framed instructions in:\n${stdout}`);
  return block;
}

const DOMAIN = "A small internal tool that greets people by name. All user-facing messages are written in French.";
const FIRST = "add a function that says hello to a name, with a test";
const SECOND = "add a function that says goodbye to a name, with a test";

describe("what delivery preview prints is what a real run sends", () => {
  it(
    "matches, byte for byte, the instructions and the task turn each run's first session was sent",
    async () => {
      const repo = initTempRepo("preview-matches-run-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ domain: DOMAIN, tasks: [FIRST, SECOND] }),
      });
      const next = await delivery(["preview"], { cwd: repo });
      const second = await delivery(["preview", "--queue-index", "2"], { cwd: repo });
      expect(next.exitCode).toBe(EXIT.ok);
      expect(second.exitCode).toBe(EXIT.ok);

      const capture = join(mkdtempSync(join(tmpdir(), "preview-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const run = await delivery(["run"], { cwd: repo });
      expect(run.exitCode).toBe(EXIT.ok);

      const sent = sessionsSent(capture);
      expect(sent).toHaveLength(2);
      const [toFirst, toSecond] = sent as [Sent, Sent];
      expect(toFirst.systemPrompt).toContain(DOMAIN);
      expect(framed(next.stdout)).toBe(`${toFirst.systemPrompt}\n\n${toFirst.prompt}\n`);
      expect(framed(second.stdout)).toBe(`${toSecond.systemPrompt}\n\n${toSecond.prompt}\n`);
    },
    RUN_TIMEOUT * 2,
  );
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/cli/preview-matches-run.test.ts`
Expected: PASS. If it fails, the failure diff shows where the preview and the first dispatch differ: fix `previewCommand` (most likely `FIRST_DISPATCH` or the stand-in header), never the test's comparison.

- [ ] **Step 3: Prove it bites, then restore**

Temporarily change `FIRST_DISPATCH` in `src/cli/preview-command.ts` to carry one invented failing check:

```ts
const FIRST_DISPATCH: PromptEvidence = { brief: null, newFailures: [{ id: "x", baselineOutcome: "PASS", checkOutcome: "FAIL", detail: "x" }], setback: null };
```

Run: `npx vitest run src/cli/preview-matches-run.test.ts`
Expected: FAIL on the `framed(next.stdout)` comparison.

Restore the line exactly:

```ts
const FIRST_DISPATCH: PromptEvidence = { brief: null, newFailures: [], setback: null };
```

Run: `npx vitest run src/cli/preview-matches-run.test.ts && git diff --stat src/cli/preview-command.ts`
Expected: PASS, and no diff in `src/cli/preview-command.ts`.

- [ ] **Step 4: Lint the new file**

Run: `npx eslint src/cli/preview-matches-run.test.ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/preview-matches-run.test.ts
git commit -m "Test that delivery preview prints what a real run sends

The preview is only worth trusting if it is the brief an agent actually
gets. This drives a real two-task queue against the scripted agent, reads
what each session was sent on the wire, and compares it byte for byte with
what preview printed, so a later change that makes the two drift fails here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
