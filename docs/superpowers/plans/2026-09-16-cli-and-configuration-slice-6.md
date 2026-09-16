# CLI and Configuration — Slice 6: Script Against Runs With Machine-Readable Output

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 6 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Give a script the same three things a person already gets from the `delivery` command: one JSON object per step while a run happens, one JSON document for a run's status, and a listing of every run in the repository, newest first, in plain language or JSON, with the exit codes and the plain-language default both unchanged.

**Architecture:** No library change and no new library API. Today the run loop renders its own lines: `drive.ts` calls `progress.step(state)` and then writes `putRight(recovery)`, the summary headline and its details through `ctx.writeLine`, while `run-command.ts` writes the "Starting run" line and its notes the same way. This slice puts one seam in front of all of that, a `RunReporter` with three methods (`note`, `step`, `outcome`), built once in `program.ts` from a new global `--json` option and carried on `CommandContext`. `plainReporter` is exactly today's behaviour moved behind the seam; `jsonReporter` writes one JSON object per step to standard output and sends every human note to standard error, so stdout under `--json` is machine-readable and nothing else. `status` gains the same fork one level up: `statusReport` (prose lines, slice 4) sits beside `statusDocument` (one JSON document over the same record), and `--all` adds a listing built from a small `RunSummary` that both renderings share. `allRuns` (slice 4) already reads every run, so `--all` needs no new discovery.

**Tech Stack:** Node ≥ 22, TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, the vendored `@jorj/claude-mock` through the contributor test seam. No new dependency: `JSON.stringify` is the whole of the serialisation story.

## Global Constraints

- **Buy-vs-build:** this slice carries no Build note, so the spec's own architecture is the constraint, verbatim. On progress: "The observation seam is the CLI's own `advance` loop: after every step it holds an `AdvanceResult` (`{ state, done, recovery? }`, `src/surface.ts:14-24`) and renders it through a small renderer (human lines, or JSON lines under `--json`). No event or observer API is added to `src/surface.ts`. Item 11 can replace or augment the renderer (for example, also writing each step to a structured log) without the run loop changing." On output: "There is no automatic switch to a different format when stdout is not a TTY; `--json` (SHOULD) is an explicit opt-in that emits one JSON object per step (`{ state, done, recovery?, at }`)." And: "No new library API is needed beyond `DEFAULT_BUDGETS`." Nothing in `src/` outside `src/cli/` changes. No new dependency, no serialisation library, no schema for output: `JSON.stringify` over plain interfaces.
- **Operability / DX:** this slice carries no Operational note. It adds one global option and one `status` option, no build step, no dependency and no environment of its own; slice 1's harness, slice 5's packaging and the existing CI cover it unchanged. What it changes is what the command accepts and what it prints, so the README, the sample project's walkthrough, the command's own `--help` and a changeset are updated in the tasks whose deliverables changed them (see Scaffolding Impact).
- **Raw state names (spec, verbatim):** "States are translated, never shown raw in the human stream. … Raw state names appear only in `--json`." So `STEP_PHRASES` stays the only thing a person sees, and `state`, `nextStep` and `outcome` in the JSON surfaces carry the harness's own tokens (`SurfaceState`, `ResumeAction`, `CaseFileOutcome["kind"]`) unchanged, so a script switches on a stable name rather than on prose.
- **Exit codes (spec, verbatim):** "`0` closed, `1` unexpected/internal error, `2` configuration or input problem, `3` agent runtime precondition unmet, `4` run escalated (needs a human), `5` run aborted." And: "`status` and `init` exit `0` on success and `2` when the named run or repository is not found." `--json` changes none of them: `EXIT` (`src/cli/failures.ts`) is untouched, and `driveToOutcome` keeps returning `summary.exitCode` whichever reporter it was given.
- **Copy:** "Every message names the problem and the fix without harness vocabulary ('worktree', 'envelope', 'surface', a state name)." British English, no em-dashes in any user-facing string or document. The command speaks in the first person where it speaks of itself, matching slices 1 to 5. Exact user-facing strings a test asserts on are exported constants or built by exported functions, as in slices 1 to 5.
- **Colour:** decorative only, through `paint` (`src/cli/output.ts`), and off entirely under `--json`: escape codes inside a JSON line would break the very thing `--json` exists for.
- **Determinism (spec, verbatim):** "The CLI adds non-determinism only to rendering (timestamps, elapsed time) and to run-id creation." The step record's `at` is the one clock read this slice adds, so it is injected (`now`) and the tests pin it. Ordering is derived from the run ids' own timestamps, not from the disk, so a listing is the same twice running.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests while working (`npx vitest run <file>` or `npx vitest run <file> -t "<name>"`). No task's own tests need `npm run build`: they all drive `runCli` in process through the `delivery` fixture.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Six decisions this plan makes, and why

Recorded here because this was an unattended run with no human to validate them.

1. **`--json` is one global option on `delivery`, not three per-command flags.** `--no-color` is already global (`src/cli/program.ts:38`) and is the precedent. Declaring `--json` once means `run`, `resume` and `status` all honour it with no extra code, and `resume` gets it for free precisely because it drives the same loop as `run`. Per-command flags would be three declarations, three help entries and a way for the three to drift.

2. **A step record carries exactly the four fields the acceptance criterion names**, `state`, `done`, `recovery` (when there is one) and `at`, and nothing else. The run id is deliberately not on it: a script that needs it reads the "Starting run …" note from standard error, or calls `delivery status --all --json`, which exists in this same slice and gives every run's id. Adding a fifth field would mean plumbing the run id into a reporter that is built before the run id exists, to solve a problem two commands already solve.

3. **Under `--json`, standard output carries machine-readable output and nothing else.** Every human note, every prompt and every error goes to standard error instead: the "Starting run" line, the uncommitted-changes warning, the ignored-settings note, the "which run should I pick up" prompt, the closing sentence and the lines under it, and every refusal. A script can therefore pipe stdout straight into a parser without a filter, and a person watching still sees the words. This is why `chooseRun`'s prompt moves onto the reporter rather than staying on `ctx.writeLine`.

4. **`status --all` orders by the run's own start time, newest first; bare `status` and `--last` keep most-recently-touched.** The acceptance criterion says "newest first", and a run id carries the UTC second it started, so sorting on it needs no filesystem times and gives the same answer twice running. The two orders can differ, when an old run is resumed today, and that is correct: a list is a history, while `--last` means "the one I was just working on". The README says which is which.

5. **`status --all` on a repository with no runs exits 0 with an empty listing.** Listing is a different question from looking one up: an empty list is a complete answer, whereas a named or most-recent run that is not there is a failure to answer, which slice 4 already fixed as `NOTHING_HERE` and exit 2. `--all --json` therefore prints `[]` and exits 0, which is what a CI step needs; `--all` in plain language prints the same `NOTHING_HERE` sentence on standard output and exits 0.

6. **A document is pretty-printed; a stream is JSON Lines.** `status --json` and `status --all --json` print one indented JSON value, because a person reads them too (the slice's own UAT step 3 is "read the output") and a parser does not care. `run --json` prints one compact object per line, because it is a stream a script consumes a line at a time while the run is still going.

## Scaffolding Impact

- **Proactive, a new global option needs its own help:** `--json` is registered on the `delivery` program in `src/cli/program.ts` with a description, and appears under Global Options in `delivery --help` and in each subcommand's help (`showGlobalOptions: true` is already configured) → Task 1.
- **Proactive, a new `status` option needs its own help:** `--all` is registered on the `status` subcommand and appears in `delivery status --help` → Task 3.
- **Reactive, `README.md` documents a command whose output is now switchable:** the "Run a task from the command line" section gains the `--json` paragraph → Task 1; the "See what happened to a run" section gains the `status --json` paragraph → Task 2 and a "See every run" subsection for `--all` → Task 3.
- **Reactive, `examples/sample-project/README.md` walks a person to `delivery status` and stops:** it gains the `delivery status --all` step, which is the slice's own UAT step 1 → Task 3.
- **Proactive, `CONTRIBUTING.md` requires a changeset for anything a user would notice** ("Every change that a user of the package would notice needs a changeset", `CONTRIBUTING.md:76`): one changeset describes this slice's user-visible addition → Task 3.
- **Unchanged, checked:** `docs/getting-started.md` (deliberately: it is the newcomer path from install to one finished run, and `tests/getting-started-guide.test.ts` executes every command it contains, so adding a scripting section would both mis-aim the guide and lengthen its test for no gain; scripting is documented in the README, where the exit-code table and the config reference already live). `CONTRIBUTING.md`'s test-seam section (no new seam, no new build, test or run step; `DELIVERY_TEST_MOCK_SCRIPT` is untouched). `package.json` (no new dependency, no new script; `bin`, `exports` and `files` unchanged). `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `Makefile`, `.githooks/pre-push` (all call `npm test` or the release flow, neither of which changes). `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js` (the new file sits under the existing `src/**` globs, which `tests/typecheck-coverage.test.ts` checks). `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md`, `docs/provisioning.md`, `docs/single-surface-control-flow.md`, `docs/multi-surface-control-flow.md`, `docs/agent-interface.md` (library contracts and control flow: this slice adds no library API and changes no gate, closer, role or state behaviour). `examples/sample-project/package.json`, `add.js`, `add.test.js` (`tests/sample-project.test.ts` asserts the folder's file list, not the README's text, so editing the README alone is safe).

---

### Task 1: One JSON object per step, and one seam in front of the run's words ✅ DONE (deliver-slice)

Today the run loop writes its own lines in three places: `run-command.ts` writes "Starting run …", the uncommitted-changes note and the ignored-settings note; `drive.ts` writes "Resuming run …", "Picking up where it left off …", the recovery note, the outcome headline and its details; and `createProgress` writes the step lines. `--json` has to change all of them at once, so they all move behind one seam first. `plainReporter` is today's behaviour, unchanged, with the step line and its recovery note finally in one place instead of split across `output.ts` and `drive.ts`. `jsonReporter` is the new rendering. Building the reporter once in `program.ts` also collapses the three identical context literals there into one builder.

**Files:**
- Create: `src/cli/report.ts`
- Create: `src/cli/report.test.ts`
- Modify: `src/cli/output.ts` (remove `Progress` and `createProgress`, which move to `report.ts`)
- Modify: `src/cli/output.test.ts` (remove the `createProgress` block, which moves to `report.test.ts`)
- Modify: `src/cli/context.ts` (`CommandContext` gains `json` and `report`)
- Modify: `src/cli/program.ts` (the `--json` option and one context builder)
- Modify: `src/cli/drive.ts` (report through the seam; drop the `progress` parameter)
- Modify: `src/cli/run-command.ts` (report through the seam)
- Modify: `src/cli/runs.ts` (`chooseRun`'s prompt is a note, not an answer)
- Modify: `src/cli/runs.test.ts` (its `answering` helper builds a context)
- Modify: `src/cli/status-command.test.ts` (its `context` helper builds a context)
- Modify: `README.md`

**Interfaces:**
- Consumes: `AdvanceResult` type from `../surface.js`; `SurfaceState` type from `../schema.js`; `OutcomeSummary` type from `./outcome.js`; `paint`, `putRight`, `STEP_PHRASES` from `./output.js`; `useColour` from `./output.js` (in `program.ts`).
- Produces, from `src/cli/report.ts`:
  - `interface StepRecord { state: SurfaceState; done: boolean; recovery?: string; at: string }`
  - `interface RunReporter { note(line: string): void; step(step: AdvanceResult): void; outcome(summary: OutcomeSummary): void }`
  - `function plainReporter(writeLine: (line: string) => void, colour: boolean): RunReporter`
  - `function jsonReporter(writeRecord: (line: string) => void, writeNote: (line: string) => void, now?: () => Date): RunReporter`
- Produces, from `src/cli/context.ts`: `CommandContext` gains `json: boolean` and `report: RunReporter`.
- Changed signature: `driveToOutcome(record: RunRecord, session: SessionEnvironment, ctx: CommandContext): Promise<ExitCode>` (the `progress` parameter is gone).
- Removed: `Progress` and `createProgress` from `src/cli/output.ts`. Everything else that file exports (`useColour`, `Tone`, `paint`, `STEP_PHRASES`, `RESUME_PHRASES`, `nextStep`, `pickingUp`, `putRight`) stays exactly as it is.

- [x] **Step 1: Write the failing tests**

Create `src/cli/report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SurfaceState } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile, TASK } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import type { MockScript } from "../mock-script.js";
import type { OutcomeSummary } from "./outcome.js";
import { jsonReporter, plainReporter, type StepRecord } from "./report.js";

const ESC = "[";
const AT = "2026-09-16T12:00:00.000Z";
const clock = () => new Date(AT);

const SUMMARY: OutcomeSummary = {
  headline: "Done: the change passed `npm test` and is committed on branch surface/x.",
  tone: "done",
  details: ["main was not changed. To look at the work: git log surface/x"],
  exitCode: EXIT.ok,
};

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

describe("telling a person what a run is doing", () => {
  it("writes one plain line per step", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "PROVISIONING", done: false });
    reporter.step({ state: "PRE_GATING", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(lines).toEqual(["- setting up", "- checking the starting point", "- the agent is working"]);
  });

  it("does not repeat a step that reads the same as the one before", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "GATING", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(lines).toEqual(["- the agent is working", "- checking the agent's work", "- the agent is working"]);
  });

  it("says what a step had to put right, under the step it belongs to", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    expect(lines).toEqual(["- checking the agent's work", "Had to put something right: re-created the working copy."]);
  });

  it("ends with the outcome headline and the lines under it, and says notes as they are", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.note("Starting run add-a-hello-20260916T120000Z: add a hello");
    reporter.outcome(SUMMARY);
    expect(lines).toEqual(["Starting run add-a-hello-20260916T120000Z: add a hello", SUMMARY.headline, ...SUMMARY.details]);
  });

  it("prints no escape codes when colour is off", () => {
    const lines: string[] = [];
    const reporter = plainReporter((line) => lines.push(line), false);
    reporter.step({ state: "CLOSING", done: false });
    reporter.outcome(SUMMARY);
    expect(lines.join("")).not.toContain(ESC);
  });
});

describe("telling a script what a run is doing", () => {
  /** A reporter whose records, notes and clock the test owns. */
  function scripted() {
    const records: string[] = [];
    const notes: string[] = [];
    return { records, notes, reporter: jsonReporter((line) => records.push(line), (line) => notes.push(line), clock) };
  }

  it("writes one JSON object per step: the raw state, whether that was the last one, and when", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "PROVISIONING", done: false });
    reporter.step({ state: "CLOSED", done: true });
    expect(records.map((line) => JSON.parse(line) as StepRecord)).toEqual([
      { state: "PROVISIONING", done: false, at: AT },
      { state: "CLOSED", done: true, at: AT },
    ]);
  });

  it("carries a recovery note on the step that put it right, and leaves the key off every other step", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    reporter.step({ state: "CLOSING", done: false });
    expect(records.map((line) => JSON.parse(line) as StepRecord)).toEqual([
      { state: "GATING", done: false, recovery: "re-created the working copy", at: AT },
      { state: "CLOSING", done: false, at: AT },
    ]);
  });

  it("repeats a state that repeats: one object per step, never per phrase", () => {
    const { records, reporter } = scripted();
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    reporter.step({ state: "AGENT_ACTIVE", done: false });
    expect(records).toHaveLength(2);
  });

  it("keeps everything that is not a step off the machine-readable stream, the closing sentence included", () => {
    const { records, notes, reporter } = scripted();
    reporter.note("Starting run add-a-hello-20260916T120000Z: add a hello");
    reporter.outcome(SUMMARY);
    expect(records).toEqual([]);
    expect(notes).toEqual([
      "Starting run add-a-hello-20260916T120000Z: add a hello",
      SUMMARY.headline,
      ...SUMMARY.details,
    ]);
  });
});

describe("delivery run --json", () => {
  it(
    "prints one JSON object per step instead of the plain-language lines, and exits the same way",
    async () => {
      const repo = initTempRepo("run-json-closed-", { "package.json": PACKAGE });

      const { exitCode, stdout, stderr } = await delivery(["run", "--json", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StepRecord);
      expect(records.map((record) => record.state)).toEqual([
        "PROVISIONING",
        "PRE_GATING",
        "AGENT_ACTIVE",
        "GATING",
        "CLOSING",
        "CLOSED",
      ]);
      expect(records.map((record) => record.done)).toEqual([false, false, false, false, false, true]);
      for (const record of records) expect(Number.isNaN(Date.parse(record.at))).toBe(false);
      expect(stdout).not.toContain("- setting up");
      expect(stdout).not.toContain("Done: the change");
      expect(stderr).toContain("Starting run");
      // The words a person watching still needs, on the stream a parser ignores.
      expect(stderr).toContain("Done: the change");
    },
    RUN_TIMEOUT,
  );

  it(
    "exits escalated from a run that needs a person, exactly as the plain-language run does",
    async () => {
      const repo = initTempRepo("run-json-escalated-", { "package.json": PACKAGE });

      const { exitCode, stdout } = await delivery(["run", "--json", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
      });

      expect(exitCode).toBe(EXIT.escalated);
      const records = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StepRecord);
      expect(records.at(-1)).toMatchObject({ state: "ESCALATED", done: true });
    },
    RUN_TIMEOUT,
  );

  it("offers --json on the command itself, so --help says it exists", async () => {
    const repo = initTempRepo("run-json-help-", { "package.json": PACKAGE });

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["run", "--help"], { cwd: repo });

    expect(top.stdout).toContain("--json");
    expect(own.stdout).toContain("--json");
  });
});

describe("plain language in every environment", () => {
  it(
    "prints plain-language lines when nothing is a terminal and CI is set, because only --json switches format",
    async () => {
      const repo = initTempRepo("run-plain-ci-", { "package.json": PACKAGE });

      const { stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        isTTY: false,
        env: { CI: "true", [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("- setting up");
      expect(stdout).toContain("Done: the change");
      for (const state of SurfaceState.options) expect(stdout).not.toContain(state);
    },
    RUN_TIMEOUT,
  );
});
```

Then delete the whole `describe("createProgress", …)` block from `src/cli/output.test.ts` (lines 70-95) and drop `createProgress` from that file's import on line 6, leaving `import { paint, pickingUp, putRight, RESUME_PHRASES, STEP_PHRASES, useColour } from "./output.js";`. Its three cases are reproduced above against `plainReporter`, which is what replaces it.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/report.test.ts`
Expected: FAIL — `Failed to load .../report.js` (the module does not exist yet).

- [x] **Step 3: Write the implementation**

First create `src/cli/report.ts`:

```ts
import type { SurfaceState } from "../schema.js";
import type { AdvanceResult } from "../surface.js";
import type { OutcomeSummary } from "./outcome.js";
import { paint, putRight, STEP_PHRASES } from "./output.js";

/**
 * One step of a run as a script reads it: the harness's own state name, whether
 * that was the last step, what the step had to put right if it recovered one,
 * and when it happened. This is the one place a raw state name is meant to be
 * seen, which is why the human stream translates every one of them.
 */
export interface StepRecord {
  state: SurfaceState;
  done: boolean;
  recovery?: string;
  at: string;
}

/**
 * How a run is told while it happens. Two renderings of the same three events,
 * chosen once per invocation: plain-language lines for a person, or one JSON
 * object per step for a script. The run loop reports through this and never
 * learns which it was given.
 */
export interface RunReporter {
  /** Something worth saying that is not a step: which run this is, a setting that was ignored, a question. Never part of the machine-readable stream. */
  note(line: string): void;
  /** One step of the run. `AdvanceResult` is the whole of what a step is, so a run that has only just begun reports its first state the same way. */
  step(step: AdvanceResult): void;
  /** What the run did in the end. */
  outcome(summary: OutcomeSummary): void;
}

/**
 * The run as a person reads it: one line per step, no cursor movement, spinners
 * or box drawing, so logs and screen readers read it as printed. A step that
 * reads the same as the last one is not repeated, but what it put right always
 * is: the sentence is the whole of why the step was worth mentioning.
 */
export function plainReporter(writeLine: (line: string) => void, colour: boolean): RunReporter {
  let last: string | undefined;
  return {
    note: writeLine,
    step(step) {
      const phrase = STEP_PHRASES[step.state];
      if (phrase !== last) {
        last = phrase;
        writeLine(paint(colour, "quiet", `- ${phrase}`));
      }
      if (step.recovery) writeLine(putRight(step.recovery));
    },
    outcome(summary) {
      writeLine(paint(colour, summary.tone, summary.headline));
      for (const line of summary.details) writeLine(line);
    },
  };
}

/**
 * The run as a script reads it: one JSON object per line on standard output,
 * and nothing else, so a reader can parse a line at a time while the run is
 * still going. Everything a person would want to be told goes to standard
 * error instead, where it is still read but never parsed, the closing sentence
 * included: the outcome needs no record of its own, because the last step
 * already said the run is over and the exit code says how it ended, but a
 * person reading the log still needs the words.
 */
export function jsonReporter(
  writeRecord: (line: string) => void,
  writeNote: (line: string) => void,
  now: () => Date = () => new Date(),
): RunReporter {
  return {
    note: writeNote,
    step(step) {
      const record: StepRecord = {
        state: step.state,
        done: step.done,
        ...(step.recovery === undefined ? {} : { recovery: step.recovery }),
        at: now().toISOString(),
      };
      writeRecord(JSON.stringify(record));
    },
    outcome(summary) {
      // On the note stream, never as a record: see the note above.
      writeNote(summary.headline);
      for (const line of summary.details) writeNote(line);
    },
  };
}
```

Second, remove `Progress` and `createProgress` from `src/cli/output.ts` (lines 52-69, the `export interface Progress` block and the `export function createProgress` block, together with the comment above each). Everything else in the file stays. The `SurfaceState` type import stays, because `STEP_PHRASES` still uses it.

Third, in `src/cli/context.ts`, add the two fields:

```ts
import type { RunReporter } from "./report.js";

/** The command's standard input: a person typing, or a pipe with nobody behind it. */
export type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean };

/** What a command needs from the process it runs in, passed in so tests can run it in process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  /** Whether this invocation asked for machine-readable output. */
  json: boolean;
  stdin: CliStdin;
  /** The answer this command was asked for, on standard output. */
  writeLine(line: string): void;
  /** How a run is told while it happens, and anything said alongside it. */
  report: RunReporter;
}
```

Fourth, in `src/cli/program.ts`: add `--json` to the program's options, next to `--no-color` (after line 38), and replace the three identical context literals with one builder declared above `runCli`. Add the imports `import type { CommandContext } from "./context.js";` and `import { jsonReporter, plainReporter, type RunReporter } from "./report.js";`.

```ts
    .option("--no-color", "print without colour")
    .option("--json", "print machine-readable output: one JSON object per step while a run happens, and one JSON document from status")
```

```ts
/**
 * How this invocation tells a run: plain-language lines for a person, or one
 * JSON object per step for a script, with everything that is not a step kept
 * off standard output so a reader never has to filter it back out.
 */
function reporterFor(io: CliIo, { json, colour }: { json: boolean; colour: boolean }): RunReporter {
  const writeLine = (line: string) => io.stdout.write(`${line}\n`);
  return json ? jsonReporter(writeLine, (line) => io.stderr.write(`${line}\n`)) : plainReporter(writeLine, colour);
}

/**
 * What every command gets from this process. Built once here rather than at
 * each command, so `--json` and `--no-color` cannot mean one thing to `run` and
 * another to `status`. Colour is off under `--json`: an escape code inside a
 * JSON line would break the one thing that option is for.
 */
function contextFor(io: CliIo, command: Command): CommandContext {
  const { color, json = false } = command.optsWithGlobals<{ color: boolean; json?: boolean }>();
  const colour = !json && useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY });
  return {
    cwd: io.cwd,
    env: io.env,
    colour,
    json,
    stdin: io.stdin,
    writeLine: (line) => io.stdout.write(`${line}\n`),
    report: reporterFor(io, { json, colour }),
  };
}
```

Then each of the three `.action` bodies becomes one line. For `run`:

```ts
    .action(async (options: RunOptions, command: Command) => {
      // A throw here rejects parseAsync with the original error, rendered once below.
      exitCode = await runCommand(options, contextFor(io, command));
    });
```

For `resume`:

```ts
    .action(async (runId: string | undefined, options: ResumeOptions, command: Command) => {
      exitCode = await resumeCommand(runId, options, contextFor(io, command));
    });
```

For `status`:

```ts
    .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
      exitCode = await statusCommand(runId, options, contextFor(io, command));
    });
```

Fifth, in `src/cli/drive.ts`: drop the `progress` parameter and report through `ctx.report`. Change the import on line 14 to `import { pickingUp } from "./output.js";`, and rewrite the two functions' bodies where they print:

```ts
export async function driveToOutcome(
  record: RunRecord,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
```

```ts
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    ctx.report.step(result);
  } while (!result.done);

  const summary = await summariseOutcome(dir, await load(dir));
  ctx.report.outcome(summary);
  return summary.exitCode;
}
```

and in `resumeRun`:

```ts
  ctx.report.note(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.report.note(pickingUp(record.caseFile));
  return driveToOutcome(record, session, ctx);
}
```

(`paint`, `putRight` and `createProgress` are no longer used in this file; remove them from its imports, and remove the now-unused `Progress` type import.)

Sixth, in `src/cli/run-command.ts`: drop the `createProgress` import (line 8) and report through `ctx.report`. Line 42 becomes `if (ignored.length > 0) ctx.report.note(ignoredNote(ignored));`, line 63 becomes `if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);`, and lines 70-74 become:

```ts
  ctx.report.note(`Starting run ${runId}: ${resolvedIntent}`);

  // Said before the first advance, because provisioning is the slowest step and
  // a person watching should not wait in silence for it.
  ctx.report.step({ state: "PROVISIONING", done: false });
  return driveToOutcome({ runId, repoPath, dir, caseFile }, session, ctx);
```

Seventh, in `src/cli/runs.ts`, `chooseRun`'s question is a note rather than an answer, so it goes where notes go. Replace the three `ctx.writeLine(...)` calls in `chooseRun` (lines 143-145) with `ctx.report.note(...)`:

```ts
  ctx.report.note("More than one run didn't finish. Which one should I pick up?");
  records.forEach((record, index) => ctx.report.note(`  ${index + 1}. ${describeRun(record)}`));
  ctx.report.note("Type its number and press Enter.");
```

Eighth, the two test helpers that build a `CommandContext` need the two new fields. In `src/cli/runs.test.ts`, `answering` (lines 102-107) becomes:

```ts
/** A command context reading the answers a person would type, with `isTTY` saying whether anyone is there to type them. */
function answering(answers: string[], { interactive }: { interactive: boolean }) {
  const lines: string[] = [];
  const writeLine = (line: string) => lines.push(line);
  const stdin = Object.assign(Readable.from(answers.map((answer) => `${answer}\n`)), { isTTY: interactive || undefined });
  return { ctx: { cwd: "/", env: {}, colour: false, json: false, stdin, writeLine, report: plainReporter(writeLine, false) }, lines };
}
```

with `import { plainReporter } from "./report.js";` added to that file's imports. In `src/cli/status-command.test.ts`, `context` (lines 22-30) gains the same two fields:

```ts
    colour: false,
    json: false,
    stdin: Object.assign(Readable.from([]), { isTTY: undefined }),
    writeLine: () => undefined,
    report: plainReporter(() => undefined, false),
```

with `import { plainReporter } from "./report.js";` added to its imports.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/report.test.ts`
Expected: PASS — all thirteen cases.

Then the files whose insides moved, to confirm nothing a person sees has changed:

Run: `npx vitest run src/cli/output.test.ts src/cli/runs.test.ts src/cli/run-command.test.ts src/cli/resume-command.test.ts src/cli/status-command.test.ts`
Expected: PASS — in particular `run-command.test.ts`'s "prints one plain-language line per step and never a raw state name" and `resume-command.test.ts`'s resume wording, which are the proof that `plainReporter` reproduces `createProgress` and the lines around it exactly.

- [x] **Step 5: Commit**

```bash
git add src/cli/report.ts src/cli/report.test.ts src/cli/output.ts src/cli/output.test.ts src/cli/context.ts src/cli/program.ts src/cli/drive.ts src/cli/run-command.ts src/cli/runs.ts src/cli/runs.test.ts src/cli/status-command.test.ts
git commit -m "Print one JSON object per step when a run is asked for --json

A CI step wrapping the harness had to scrape prose to learn what a run was
doing. The run loop's words were written in three different places, so they are
all put behind one reporter first: the plain-language rendering is what it
always was, and the machine-readable one writes a record per step to standard
output while every note, question and error goes to standard error, so a
script can parse stdout without filtering it. --json is one global option, so
run, resume and status all mean the same thing by it, and nothing switches
format on its own: without it the output is plain language in every
environment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [x] **Step 6: Document `--json` for a run**

In `README.md`, in the "Run a task from the command line" section, add this immediately after the exit-code table and before the `delivery --help` paragraph:

````markdown
For a script or a CI step, add `--json`:

```bash
delivery run --json --task "add a function that says hello to a name, with a test"
```

Instead of the plain-language lines, each step prints as one JSON object on its own line, with
the harness's own state name, whether the run is over, anything the step had to put right, and
when it happened:

```text
{"state":"PROVISIONING","done":false,"at":"2026-09-16T12:00:00.000Z"}
{"state":"AGENT_ACTIVE","done":false,"at":"2026-09-16T12:00:11.284Z"}
{"state":"CLOSED","done":true,"at":"2026-09-16T12:01:39.002Z"}
```

The exit codes are the same ones in the table above, so a script reads the outcome from the exit
code and the detail from `delivery status --json`. Everything that is not a step, such as which
run started, any warning and the closing sentence, goes to standard error, so standard output is
only ever JSON.
`--json` works on `delivery resume` and `delivery status` too. Without it the output is
plain-language lines everywhere, piped or in CI included: nothing switches format on its own.
````

- [x] **Step 7: Confirm the documented option is the real one**

Run: `npx vitest run src/cli/report.test.ts -t "offers --json on the command itself"`
Expected: PASS — `--json` is registered on the program and shows in both `delivery --help` and `delivery run --help`, exactly as the README says.

- [x] **Step 8: Commit the documentation**

```bash
git add README.md
git commit -m "Describe --json for a run in the readme

The readme took a reader as far as watching a run and reading its exit code,
which left the one thing a CI step needs undocumented. The example shows the
real record shape, and says where the things that are not steps go, because a
reader piping stdout into a parser needs to know that before they try it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: One run's status as one JSON document ✅ DONE (deliver-slice)

`statusReport` (slice 4) already turns a record into the lines a person reads. This adds the same information as data beside it, over the same record, with no second read of the case file and no second vocabulary: the run id, the task and how it ended come from one small `RunSummary` that Task 3's listing will share, and the rest is the fields the prose renders. Every key is always present, with `null` for "not this kind of run", so a script reads a fixed shape rather than probing for keys.

**Files:**
- Modify: `src/cli/runs.ts` (`startedInstant`, with `startedAt` re-expressed over it)
- Modify: `src/cli/runs.test.ts`
- Modify: `src/cli/output.ts` (rename `nextStep` to `nextStepPhrase`)
- Unchanged, checked: `src/cli/output.test.ts` (it tests `pickingUp`, never `nextStep` by name, so the rename needs nothing there)
- Modify: `src/cli/status-command.ts`
- Modify: `src/cli/status-command.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `existsSync` from `node:fs`; `logTail`, `resumeAction` and the `ResumeAction` type from `../case-file.js`; `branchName` from `../provision.js`; `SurfaceState` type from `../schema.js`; `EscalationPacket` type from `../triage-role-config.js`; `packetOf` and `summariseOutcome` from `./outcome.js`; `runPlace` from `./run-location.js`; `RunRecord` and `startedInstant` from `./runs.js`; `taskIntent` from `./settings.js` — all but `logTail`, `resumeAction` and `startedInstant` already imported by `status-command.ts`.
- Produces, from `src/cli/runs.ts`:
  - `function startedInstant(runId: string): string | null` — `"2026-09-14T21:03:09Z"`, or `null` when the id carries no stamp
  - `function startedAt(runId: string): string` — unchanged signature and output, now built on `startedInstant` and `readableUtc`
- Produces, from `src/cli/output.ts`: `function nextStepPhrase(caseFile: CaseFile): string` (the former `nextStep`, renamed). `pickingUp` is unchanged.
- Produces, from `src/cli/status-command.ts`:
  - `type RunOutcomeName = "closed" | "escalated" | "aborted" | "unfinished"`
  - `interface RunSummary { run: string; task: string; startedAt: string | null; outcome: RunOutcomeName }`
  - `interface RunStatusDocument extends RunSummary { state: SurfaceState; finishedAt: string | null; reason: string | null; nextStep: ResumeAction | null; summary: string | null; details: string[]; branch: string; base: string | null; dir: string; worktree: string | null; escalation: EscalationPacket | null }`
  - `function runSummary(record: RunRecord): RunSummary`
  - `function statusDocument(record: RunRecord, ctx: CommandContext): Promise<RunStatusDocument>`
  - `statusCommand` keeps its signature; `StatusOptions` is unchanged in this task.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/runs.test.ts`, inside the existing `describe("a time a person can read", …)` block:

```ts
  it("reads the instant a run started off its own id, as a timestamp a script can parse", () => {
    expect(startedInstant("add-a-hello-20260914T210309Z")).toBe("2026-09-14T21:03:09Z");
  });

  it("has no instant for a run id that carries no stamp, and says so rather than inventing one", () => {
    expect(startedInstant("handwritten")).toBeNull();
    expect(startedAt("handwritten")).toBe("an unknown time");
  });
```

with `startedInstant` added to that file's import from `./runs.js`.

Then append to the end of `src/cli/status-command.test.ts`, after the existing `describe("delivery status", …)` block, so that `AT`, `RUN_ID`, `TASK`, `context`, `reportOn`, `CLOSED` and `backdate` are all already declared above:

```ts
describe("one run's status as one JSON document", () => {
  it("says the run, the task, when it started and that it hasn't finished, with what picking it up would do first", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const document = await statusDocument(await readRun(repo, RUN_ID), ctx);

    expect(document).toMatchObject({
      run: RUN_ID,
      task: TASK,
      startedAt: "2026-09-14T21:03:09Z",
      outcome: "unfinished",
      nextStep: "start",
      finishedAt: null,
      reason: null,
      summary: null,
      details: [],
      escalation: null,
      branch: `surface/${RUN_ID}`,
      base: "main",
      dir: join(runsRoot(repo), RUN_ID),
    });
  });

  it("says how a closed run ended, in the same sentence the plain-language report leads with", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    const record = await readRun(repo, RUN_ID);

    const document = await statusDocument(record, ctx);
    const lines = await statusReport(record, ctx);

    expect(document).toMatchObject({
      outcome: "closed",
      finishedAt: AT,
      reason: "committed",
      nextStep: null,
      escalation: null,
    });
    expect(document.summary).toBe(lines[1]);
    // The lines the report prints under that sentence, which a closer such as
    // open-pr fills with something no other field carries.
    expect(document.details).toEqual(lines.slice(3));
  });

  it("carries every field of the packet a run escalated with", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const document = await statusDocument(await readRun(repo, RUN_ID), ctx);

    expect(document.outcome).toBe("escalated");
    expect(document.escalation).toEqual(ESCALATION);
  });

  it("names the agent's working copy while it is on disk, and says null once it is gone", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    expect((await statusDocument(await readRun(repo, RUN_ID), ctx)).worktree).toBeNull();

    const { location } = runPlace(repo, RUN_ID, ctx.env);
    await mkdir(location.worktreePath, { recursive: true });
    expect((await statusDocument(await readRun(repo, RUN_ID), ctx)).worktree).toBe(location.worktreePath);
  });
});

describe("delivery status --json", () => {
  it("prints one JSON document instead of the plain-language lines, and still exits ok", async () => {
    const repo = initTempRepo("status-json-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stdout, exitCode } = await delivery(["status", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const document = JSON.parse(stdout) as RunStatusDocument;
    expect(document).toMatchObject({ run: RUN_ID, task: TASK, outcome: "closed", branch: `surface/${RUN_ID}` });
    expect(stdout).not.toContain("It finished 2026-09-14 21:05 UTC.");
  });

  it("hands an escalated run's whole packet to a script, and exits ok because reading it worked", async () => {
    const repo = initTempRepo("status-json-escalated-", { "package.json": PACKAGE });
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const { stdout, exitCode } = await delivery(["status", RUN_ID, "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect((JSON.parse(stdout) as RunStatusDocument).escalation).toEqual(ESCALATION);
  });

  it("says plainly on standard error, not as JSON, when the id names nothing", async () => {
    const repo = initTempRepo("status-json-unknown-", { "package.json": PACKAGE });

    const { stdout, stderr, exitCode } = await delivery(["status", "never-ran-20260101T000000Z", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toBe("");
    expect(stderr).toContain("I couldn't find that run's record");
  });
});
```

Extend that file's imports with `statusDocument, type RunStatusDocument` alongside the existing `statusReport` from `./status-command.js`. `runPlace`, `runsRoot`, `readRun`, `initTempRepo`, `delivery`, `PACKAGE`, `ESCALATION`, `writeRunRecord`, `EXIT`, `mkdtemp`, `mkdir`, `tmpdir` and `join` are all already imported there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts -t "instant" src/cli/status-command.test.ts`
Expected: FAIL — `startedInstant is not a function`, and `statusDocument` is not exported from `./status-command.js`.

- [ ] **Step 3: Write the implementation**

First, in `src/cli/runs.ts`, replace `startedAt` (lines 77-82) with the pair, keeping `readableUtc` below them as it is:

```ts
/**
 * The UTC instant a run started, which its id already carries
 * (`src/cli/run-location.ts`), as a timestamp a script can parse. `null` for an
 * id that carries no stamp, rather than a made-up time.
 */
export function startedInstant(runId: string): string | null {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/** When a run started, as a person reads it. */
export function startedAt(runId: string): string {
  const instant = startedInstant(runId);
  return instant === null ? "an unknown time" : readableUtc(instant);
}
```

(`readableUtc` is declared below `startedAt` today; function declarations hoist, so the order needs no change.)

Second, in `src/cli/output.ts`, rename `nextStep` to `nextStepPhrase`, so that the phrase and the raw `ResumeAction` the JSON document carries are never mistaken for each other:

```ts
/** What a run will do first when it is picked up, in words, read from its log rather than its cursor, which a kill can leave behind. */
export function nextStepPhrase(caseFile: CaseFile): string {
  return RESUME_PHRASES[resumeAction(logTail(caseFile))];
}

/** What this run will do first now it has been picked up. */
export function pickingUp(caseFile: CaseFile): string {
  return `Picking up where it left off: ${nextStepPhrase(caseFile)}.`;
}
```

and update its one other caller, in `statusReport` (`src/cli/status-command.ts:72`), to `nextStepPhrase(caseFile)`, with the import on line 9 becoming `import { nextStepPhrase, paint } from "./output.js";`.

Third, in `src/cli/status-command.ts`, add the document beneath `statusReport`, with `logTail`, `resumeAction` and the `ResumeAction` type imported from `../case-file.js`, the `SurfaceState` type from `../schema.js`, and `startedInstant` added to the existing `./runs.js` import:

```ts
/** How a run ended, as one word a script can switch on. "unfinished" is the fourth: a run that is still resumable has not ended at all. */
export type RunOutcomeName = "closed" | "escalated" | "aborted" | "unfinished";

/** One run at a glance: which run, what it was asked to do, when it started and how it ended. */
export interface RunSummary {
  run: string;
  task: string;
  /** ISO 8601, from the run id itself; null when the id carries no stamp. */
  startedAt: string | null;
  outcome: RunOutcomeName;
}

/**
 * Everything the plain-language report says about one run, as one document.
 * Every key is always there: a null says "not that kind of run", so a reader
 * never has to probe for a key, and the shape is the same for all four
 * outcomes. The harness's own names are used unchanged, because this is the
 * one place they are meant to be read.
 */
export interface RunStatusDocument extends RunSummary {
  /** The state the record is in. */
  state: SurfaceState;
  finishedAt: string | null;
  /** How it ended, in the harness's own words. */
  reason: string | null;
  /** Unfinished only: what picking it up would do first. */
  nextStep: ResumeAction | null;
  /** Finished only: the sentence the plain-language report leads with. */
  summary: string | null;
  /**
   * The lines the plain-language report prints under that sentence, empty for a
   * run that has not finished. Not always derivable from the fields beside it: a
   * pull-request closer names its pull request here, and a custom closer says
   * whatever only it knows.
   */
  details: string[];
  branch: string;
  base: string | null;
  /** Everything this run recorded. */
  dir: string;
  /** The agent's working copy, while it is still on disk. */
  worktree: string | null;
  escalation: EscalationPacket | null;
}

/** One run at a glance, from its record. */
export function runSummary(record: RunRecord): RunSummary {
  return {
    run: record.runId,
    task: taskIntent(record.caseFile.header.taskDef),
    startedAt: startedInstant(record.runId),
    outcome: record.caseFile.outcome?.kind ?? "unfinished",
  };
}

/**
 * One run's record as a script reads it: the same information `statusReport`
 * says in sentences, over the same record, read once. Nothing here advances
 * anything either.
 */
export async function statusDocument(record: RunRecord, ctx: CommandContext): Promise<RunStatusDocument> {
  const { caseFile, dir, runId } = record;
  const { outcome } = caseFile;
  const { location } = runPlace(record.repoPath, runId, ctx.env);
  const packet = outcome?.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  // Read once, as the report reads it, so the two can never say different things.
  const summary = outcome ? await summariseOutcome(dir, caseFile) : undefined;
  return {
    ...runSummary(record),
    state: caseFile.cursor.state,
    finishedAt: outcome?.at ?? null,
    reason: outcome?.reason ?? null,
    nextStep: outcome ? null : resumeAction(logTail(caseFile)),
    summary: summary?.headline ?? null,
    details: summary?.details ?? [],
    branch: branchName(caseFile.header.surfaceId),
    base: caseFile.header.baseBranch ?? null,
    dir,
    worktree: existsSync(location.worktreePath) ? location.worktreePath : null,
    escalation: packet ?? null,
  };
}
```

Fourth, in `statusCommand`, fork on `ctx.json`:

```ts
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const record = runId === undefined ? await mostRecent(repoPath) : await readRun(repoPath, runId);
  // Indented rather than one line: a person reads this output too, and a parser does not mind.
  if (ctx.json) ctx.writeLine(JSON.stringify(await statusDocument(record, ctx), null, 2));
  else for (const line of await statusReport(record, ctx)) ctx.writeLine(line);
  return EXIT.ok;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts src/cli/runs.test.ts src/cli/output.test.ts`
Expected: PASS — the new blocks, and every slice-4 case unchanged, which is what proves `startedAt` and `statusReport` still say exactly what they said.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts src/cli/runs.ts src/cli/runs.test.ts src/cli/output.ts
git commit -m "Report one run's status as one JSON document

A script checking whether a run needs a person had to read sentences written
for a person, including an escalation packet whose whole point is that it is
prose. The document carries the same information over the same record, with
every key always present so a reader never probes for one, and the harness's
own names for the state, the next step and the outcome so it can switch on them
rather than on wording. The phrase lookup is renamed to say it is a phrase, now
that the raw action name is a field beside it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Document `status --json`**

In `README.md`, in the "See what happened to a run" section, add this immediately after the paragraph beginning "`status` exits 0 whenever it could read the run":

````markdown
Add `--json` to get the same information as one JSON document instead of sentences:

```bash
delivery status --last --json
```

It carries the run id, the task, when it started and finished, how it ended, the sentences the
plain-language report prints about it, the branch, the base branch, where the run's record is,
and, for a run that stopped for a decision, every field of the escalation packet. Every key is
always present: a `null` means "not that kind of run", so
a script never has to check whether a key is there. A run that could not be found is still a
plain-language message on standard error and exit 2, not JSON.
````

- [ ] **Step 7: Confirm the documented behaviour is the real one**

Run: `npx vitest run src/cli/status-command.test.ts -t "delivery status --json"`
Expected: PASS — the document, the escalation packet and the plain-language refusal on standard error are exactly as the README describes them.

- [ ] **Step 8: Commit the documentation**

```bash
git add README.md
git commit -m "Describe status --json in the readme

The status section told a reader what the command says and not what it can hand
a script, which is the half a CI step needs. The note about always-present keys
is there because it is the thing a reader would otherwise discover by writing a
defensive parser first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Every run in the repository, at a glance ✅ DONE (deliver-slice)

The last of the three: a listing rather than a lookup. `allRuns` (slice 4) already reads every record, so this adds the ordering the criterion asks for, the words for each outcome, and the two renderings, plus the documents and the changeset that say the whole slice exists.

**Files:**
- Modify: `src/cli/status-command.ts`
- Modify: `src/cli/status-command.test.ts`
- Modify: `src/cli/program.ts` (register `--all`)
- Modify: `README.md`
- Modify: `examples/sample-project/README.md`
- Create: `.changeset/machine-readable-runs.md`

**Interfaces:**
- Consumes: `allRuns`, `describeRun`, `NOTHING_HERE`, `startedInstant` from `./runs.js`; `Refusal`, `EXIT` from `./failures.js`; `runSummary`, `RunSummary`, `RunOutcomeName` from Task 2 — all in `status-command.ts` already except `describeRun`.
- Produces, from `src/cli/status-command.ts`:
  - `const ALL_AND_ONE: string`
  - `function newestFirst(records: RunRecord[]): RunRecord[]`
  - `function runListing(records: RunRecord[]): string[]`
  - `interface StatusOptions { repo?: string; all?: boolean }` (gains `all`)

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/cli/status-command.test.ts`, below the blocks Task 2 added:

```ts
describe("delivery status --all", () => {
  /** Three runs in one repository: one finished, one that needed a person, one still going. */
  async function threeRuns(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: "add-a-hello-20260914T210309Z", task: "add a hello", outcome: CLOSED });
    await writeRunRecord(repo, {
      runId: "delete-the-greeting-20260915T090000Z",
      task: "delete the greeting",
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260916T113000Z", task: "add a goodbye" });
    return repo;
  }

  it("lists every run, newest first, with its task and how it ended", async () => {
    const repo = await threeRuns("status-all-");

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").filter((line) => line.startsWith("  "))).toEqual([
      "  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet)",
      "  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you)",
      "  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)",
    ]);
  });

  it("lists every run as JSON, newest first, with the four things a script sorts and filters on", async () => {
    const repo = await threeRuns("status-all-json-");

    const { stdout, exitCode } = await delivery(["status", "--all", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual([
      { run: "add-a-goodbye-20260916T113000Z", task: "add a goodbye", startedAt: "2026-09-16T11:30:00Z", outcome: "unfinished" },
      { run: "delete-the-greeting-20260915T090000Z", task: "delete the greeting", startedAt: "2026-09-15T09:00:00Z", outcome: "escalated" },
      { run: "add-a-hello-20260914T210309Z", task: "add a hello", startedAt: "2026-09-14T21:03:09Z", outcome: "closed" },
    ]);
  });

  it("orders by when each run started, not by which record was written last", async () => {
    const repo = await threeRuns("status-all-order-");
    // The newest run's record is now the least recently written, which is what
    // resuming an older run leaves behind. It is still the newest run.
    await backdate(join(runsRoot(repo), "add-a-goodbye-20260916T113000Z"));

    const { stdout } = await delivery(["status", "--all"], { cwd: repo });

    expect(stdout).toContain("  add-a-goodbye-20260916T113000Z");
    expect(stdout.indexOf("add-a-goodbye")).toBeLessThan(stdout.indexOf("add-a-hello"));
  });

  it("says there is nothing here yet, and exits ok: an empty list is an answer", async () => {
    const repo = initTempRepo("status-all-empty-", { "package.json": PACKAGE });

    const plain = await delivery(["status", "--all"], { cwd: repo });
    const json = await delivery(["status", "--all", "--json"], { cwd: repo });

    expect(plain.exitCode).toBe(EXIT.ok);
    expect(plain.stdout).toContain(NOTHING_HERE);
    expect(json.exitCode).toBe(EXIT.ok);
    expect(JSON.parse(json.stdout)).toEqual([]);
  });

  it("stops when it is given both --all and a run id, rather than quietly ignoring one", async () => {
    const repo = await threeRuns("status-all-conflict-");

    const { stderr, exitCode } = await delivery(["status", "--all", "add-a-hello-20260914T210309Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(ALL_AND_ONE);
    expect(stderr).not.toContain("    at ");
  });

  it("describes --all in the command's own help", async () => {
    const repo = initTempRepo("status-all-help-", { "package.json": PACKAGE });

    const { stdout } = await delivery(["status", "--help"], { cwd: repo });

    expect(stdout).toContain("--all");
  });
});
```

Extend that file's imports with `ALL_AND_ONE` alongside `statusDocument` and `statusReport` from `./status-command.js`, and with `NOTHING_HERE`, which that file already imports from `./runs.js`. `backdate` and `CLOSED` are declared above these blocks, and `runsRoot` is already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "delivery status --all"`
Expected: FAIL — `ALL_AND_ONE` is not exported, and once that is stubbed, `error: unknown option '--all'`.

- [ ] **Step 3: Write the implementation**

In `src/cli/status-command.ts`, add the listing above `statusCommand`, with `allRuns`, `describeRun` and `NOTHING_HERE` added to the existing `./runs.js` import:

```ts
/** How a run ended, as a person reads it in a list. Total over the four names, so a new one does not compile until it has words. */
const OUTCOME_WORDS: Record<RunOutcomeName, string> = {
  closed: "finished",
  escalated: "needs a decision from you",
  aborted: "stopped before it finished",
  unfinished: "hasn't finished yet",
};

export const ALL_AND_ONE =
  "Use either `--all` or a run id, not both: `--all` lists every run, and a run id reads one of them in full.";

/**
 * Newest first, by the second each run id carries rather than by when its
 * record was last written: a list is a history, so resuming an old run today
 * does not make it the newest. A run id with no stamp sorts last, and the sort
 * is stable, so runs that started in the same second keep the order they came
 * in.
 */
export function newestFirst(records: RunRecord[]): RunRecord[] {
  const startedOf = (record: RunRecord): string => startedInstant(record.runId) ?? "";
  return [...records].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
}

/** Every run this repository holds, one to a line: which run, when it started, what it was asked to do, and how it ended. */
export function runListing(records: RunRecord[]): string[] {
  if (records.length === 0) return [NOTHING_HERE];
  return [
    `${records.length} run${records.length === 1 ? "" : "s"} in this repository, newest first:`,
    ...records.map((record) => `  ${describeRun(record)} (${OUTCOME_WORDS[runSummary(record).outcome]})`),
    "To read one in full: delivery status <run-id>",
  ];
}

/**
 * `delivery status --all`: every run this repository holds, rather than one.
 * Listing nothing is a complete answer, so an empty repository exits ok here,
 * unlike a lookup of a run that is not there, which is a failure to answer.
 */
async function listRuns(repoPath: string, ctx: CommandContext): Promise<ExitCode> {
  const records = newestFirst(await allRuns(repoPath));
  if (ctx.json) ctx.writeLine(JSON.stringify(records.map(runSummary), null, 2));
  else for (const line of runListing(records)) ctx.writeLine(line);
  return EXIT.ok;
}
```

Extend `StatusOptions`:

```ts
export interface StatusOptions {
  repo?: string;
  /** List every run this repository holds instead of reading one. */
  all?: boolean;
}
```

(`--last` needs no conflict check beside `ALL_AND_ONE`: it is not a field on this
interface at all, because it is the explicit spelling of the default rather than a
second meaning, so `--all --last` reads as `--all` and nothing is quietly dropped.)

and take the listing branch first in `statusCommand`:

```ts
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  // Before the repository is even looked for: a usage mistake is the same
  // mistake wherever it was typed, and hearing about the folder first would
  // send the reader after the wrong problem.
  if (options.all && runId !== undefined) throw new Refusal(ALL_AND_ONE, EXIT.configuration);
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  if (options.all) return listRuns(repoPath, ctx);
  const record = runId === undefined ? await mostRecent(repoPath) : await readRun(repoPath, runId);
  // Indented rather than one line: a person reads this output too, and a parser does not mind.
  if (ctx.json) ctx.writeLine(JSON.stringify(await statusDocument(record, ctx), null, 2));
  else for (const line of await statusReport(record, ctx)) ctx.writeLine(line);
  return EXIT.ok;
}
```

Then register the option in `src/cli/program.ts`, on the `status` command after `--last`:

```ts
    .option("--all", "list every run in this repository, newest first, instead of reading one")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS — the six new cases and every case from slice 4 and Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts src/cli/program.ts
git commit -m "List every run in the repository with delivery status --all

Checking many runs meant knowing every run id in advance, because status could
only look one up. --all lists them newest first by the second each run id
carries, so resuming an old run today does not reorder the history, and says in
words or as data whether each one finished, needs a decision, stopped or is
still going. Listing nothing is an answer rather than a failure, so an empty
repository exits ok here even though looking up a run that is not there does
not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Document the listing, the walkthrough step and the change**

In `README.md`, add this as a new subsection at the end of the "See what happened to a run" section, after the `--json` paragraph Task 2 added:

````markdown
### See every run

To see the whole history of runs in a repository:

```bash
delivery status --all
```

```text
3 runs in this repository, newest first:
  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet)
  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you)
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)
To read one in full: delivery status <run-id>
```

`--all --json` gives the same list as an array, each entry with the run id, the task, the
instant it started and how it ended, so a script can filter it. The list is ordered by when
each run started, so it is a history; `delivery status` with no run id reports the run you were
last working on, which is not always the newest one. A repository with no runs yet lists nothing
and exits 0.
````

In `examples/sample-project/README.md`, add a step after the existing step 7:

````markdown
8. After a few runs, `delivery status --all` lists all of them, newest first, with what each one
   was asked to do and whether it finished. Add `--json` to any of these commands to get the
   same information as data for a script.
````

Create `.changeset/machine-readable-runs.md`:

```markdown
---
"delivery-service": minor
---

The `delivery` command can now be scripted against. `delivery run --json` prints one JSON object
per step instead of the plain-language lines, with the same exit codes; `delivery status --json`
prints a run's whole status as one JSON document, including every field of the escalation packet
when a run needs a decision; and `delivery status --all` lists every run in the repository,
newest first, with its task and how it ended, in plain language or JSON. Without `--json` the
output is plain-language lines in every environment, piped or in CI included.
```

- [ ] **Step 7: Confirm the documented commands are the real ones**

Run: `npx vitest run src/cli/status-command.test.ts -t "describes --all in the command's own help" && npx vitest run tests/release.test.ts`
Expected: PASS — `--all` is registered exactly as the README describes it, and the release checks still hold with a changeset present.

- [ ] **Step 8: Commit the documentation**

```bash
git add README.md examples/sample-project/README.md .changeset/machine-readable-runs.md
git commit -m "Describe the run listing and add the slice's changeset

The readme and the sample project's walkthrough both stopped at reading one
run, which is the command a person reaches for second rather than first when
they have been away. The ordering note is there because --all and a bare status
can legitimately name different runs, and a reader who meets that by accident
will think one of them is wrong.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for whoever executes this plan

- **Do not add a TTY check anywhere.** The spec is explicit: "There is no automatic switch to a different format when stdout is not a TTY." `--json` is the only thing that changes the format, and `report.test.ts`'s "plain language in every environment" case exists to fail if anyone adds one later.
- **Do not put anything but JSON on standard output under `--json`.** That includes the "Starting run" line, the uncommitted-changes warning, the ignored-settings note, `chooseRun`'s question and every refusal. If a new message appears in the run path later, it is a `ctx.report.note`, never a `ctx.writeLine`.
- **Do not add a record for the outcome to the `run --json` stream.** The last step record already carries `done: true` and the terminal state, and the exit code says how it ended. A script that wants the branch calls `delivery status --last --json`, which this slice also delivers. The outcome's own sentences are still said, on standard error with the other notes, so a person reading a CI log is not left with a run that stops mid-stream and an escalation whose decision was never printed.
- **Do not change what the plain-language stream says.** `plainReporter` is `createProgress` plus the two lines that sat around it in `drive.ts`, moved, not rewritten. `run-command.test.ts`'s step-phrase case and the slice 1 to 5 acceptance tests in `tests/cli-and-configuration/` are the proof; if any of them changes, the move was not faithful.
- **Do not add `delivery init`.** It is slice 7 of the slice scope.
- **`--json` on `delivery resume` is deliberate, not an accident of the global option.** Resume drives the same loop as `run`, so a scheduled retry gets the same stream. It needs no separate test: `report.test.ts` covers the reporter, and `resume-command.test.ts` covers the command.
