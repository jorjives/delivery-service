# CLI and Configuration — Slice 3: Pick Up a Run That Was Interrupted

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Make an interrupted run finish when the person runs the command again: `delivery run` finds the unfinished run in the repository and carries on from where it stopped, saying in plain language what it is picking up and what it had to put right, and `delivery resume` does the same without ever starting a new run.

**Architecture:** No library change: `advance` already resumes onto a legal edge from whatever is on disk (`src/surface.ts:725-767` derives its position from the log tail, not from the possibly stale cursor), and `resumeAction` (`src/case-file.ts:414-434`) already says what a resumed run will do next. This slice is the caller that was missing. Three small modules join the existing thin CLI layer: `src/cli/context.ts` holds the `CommandContext` both commands are handed; `src/cli/runs.ts` owns discovery (which runs exist under `.delivery/runs/`, which are unfinished, how a run is described to a person, and which one we mean when several are); `src/cli/drive.ts` owns the wiring and the loop that `run` and `resume` share, so a resumed run is composed exactly like a new one. `src/cli/run-command.ts` gains one decision at the top (resume, refuse, or start) and hands the rest to `drive.ts`; `src/cli/resume-command.ts` is the same discovery with the "start a new one" branch removed.

**Tech Stack:** Node ≥ 22, TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, the vendored `@jorj/claude-mock` through the contributor test seam. No new dependency: the one prompt this slice needs is `node:readline`.

## Global Constraints

- **Buy-vs-build:** this slice carries no Build note, so the spec's own architecture is the constraint: "Resume is discovery plus the library's existing idempotent `advance` (`src/surface.ts:774-781`)" and "No new library API is needed beyond `DEFAULT_BUDGETS`: `advance` and `run` already provide what a CLI needs." Nothing in `src/` outside `src/cli/` changes. Discovery is `node:fs/promises` `readdir` plus the library's own `load`; the one interactive question is `node:readline`. No prompt library, no run index or lock file, no new persisted field. (`@inquirer/prompts` arrives in slice 7 for the `init` wizard, which is a wizard; a single "which of these?" question does not justify a runtime dependency in the published package now.)
- **Operability / DX:** this slice carries no Operational note. It adds one subcommand and one flag to an existing command, no build step, no dependency and no environment of its own; slice 1's harness, local-run story and CI cover it unchanged. What it changes is what the command accepts and what it prints, so the README, the sample project's walkthrough and the commands' own `--help` are updated with the tasks that change them (see Scaffolding Impact).
- **Command surface (spec, verbatim):** "`delivery run [--task <text> | --task-file <path>] [--gate-command <cmd>] [--closer <type>] [--config <file>] [--repo <path>] [--fresh]` Starts a run, or resumes the unfinished one (see Resume)." "`delivery resume [<run-id> | --last] [--repo <path>]` The explicit form of the resume `run` performs implicitly, for scripts and for a person who wants certainty. Errors plainly when no unfinished run exists."
- **Resume rules (spec, verbatim):** "**Unfinished run:** a case file under `.delivery/runs/` with no `outcome`." "**`delivery run`:** with no unfinished run, starts a new one. With exactly one unfinished run and no `--task` (or a `--task` whose intent equals that run's), resumes it. With a different `--task`, refuses (exit 2) naming the unfinished run, unless `--fresh` is passed, in which case a new run starts and the old one stays on disk, resumable. With several unfinished runs and no explicit id, lists them and asks which (in a non-interactive terminal, refuses with the list and exit 2)." "**`delivery resume`:** the same discovery without ever starting a new run; `--last` picks the most recently modified unfinished run." "**Reporting:** before the first `advance`, the CLI prints the translated `resumeAction(logTail(caseFile))`; after each step, any `recovery` string."
- **Pinned settings (spec, verbatim):** "the existing case file is used as-is and its persisted header wins over any flags (a resumed run cannot be silently reconfigured mid-flight; conflicting flags produce a warning naming what was ignored)."
- **No lock file (spec, verbatim):** "Running two processes against the same run concurrently is out of scope (Item 10 owns concurrency); the CLI adds no lock file, which could itself go stale and break idempotent resume."
- **Idempotent resume (spec, verbatim):** "the CLI keeps no per-invocation state outside the case file, and the worktree path is a pure function of `(repo, run-id)`." `runPlace` (`src/cli/run-location.ts`) already is that function; it is recomputed on resume, never stored. The library prefers the cursor's `worktreeRef` once one exists (`src/surface.ts:26-29`), so a run interrupted after provisioning keeps the working copy it already has.
- **`rebuild()` is not called.** `advance` derives its position from the log tail (`position`, `src/surface.ts:62-66`) and handles every torn state itself, so a resuming process needs nothing but the directory. `demos/single-surface-slice-5-crash-recovery.ts` calls `rebuild` to make its two processes comparable, not because resuming requires it.
- **Exit codes (slice 1, unchanged):** `EXIT = { ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 }` in `src/cli/failures.ts`. Every refusal this slice adds is `EXIT.configuration`; the unreadable-record message keeps the `CORRUPT_CASE_FILE` rendering and exit already in `src/cli/failures.ts`.
- **Copy:** "Every message names the problem and the fix without harness vocabulary ('worktree', 'envelope', 'surface', a state name)." "States are translated, never shown raw in the human stream." British English, no em-dashes in any user-facing string or document. The command speaks in the first person, matching slice 1 and 2. Exact user-facing strings are exported constants the tests import, as in slices 1 and 2.
- **The one deliberate exception to that copy rule** is the `recovery` string, which the spec says to print and which the library writes ("re-created the worktree", "recorded a missing terminus for worker attempt 1"). It is printed verbatim behind a plain-language lead-in rather than paraphrased: it is free-form diagnostic text from the library, and a CLI lookup table over it could not be total and would drift silently. It contains no raw `SurfaceState` name, so slice 1's "never a raw state name" test still holds.
- **Refusal ordering (slices 1 and 2, extended):** repository, then resume discovery (which run, and whether this invocation's task conflicts with it), then — on the new-run path only — the config file, the task, the check, the closer, then any custom module, then the agent runtime preflight, then the uncommitted-changes note, and only then is anything written. A resumed run does not read the config file at all: its settings are pinned, so a config file changed since it started can neither redirect it nor refuse it.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests (`npx vitest run <file> -t "<name>"`). No task here needs `npm run build`: every test drives `runCli` in process.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Scaffolding Impact

- **Reactive, `README.md` describes a command that only ever starts runs:** it gains a "Pick up a run that was interrupted" section covering re-running, `delivery resume`, `--last`, `--fresh` and the pinned-settings rule → Task 5.
- **Reactive, `examples/sample-project/README.md` walks a person through a first run and says nothing about one that stops:** its walkthrough gains the one-line recovery step, which is also what the slice's UAT asks a person to do → Task 5. (`tests/sample-project.test.ts` asserts the folder's file list, not the README's text, so editing it is safe.)
- **Reactive, `delivery run --help` describes a command that only starts:** the `run` description in `src/cli/program.ts` gains "or picks up one that didn't finish", and `--fresh` arrives with its own help text → Task 3.
- **Proactive, a new subcommand needs its own help:** `delivery resume` is registered with a description and help for `--last` and `--repo`, and appears in `delivery --help`'s command list → Task 5.
- **Unchanged, checked:** `CONTRIBUTING.md` (no new build, test or run step; the `DELIVERY_TEST_MOCK_SCRIPT` seam and its `delivery run` example are untouched and still accurate); `package.json` (no new dependency, no new script: `node:readline` is stdlib); `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (all call `npm test`); `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js` (new files sit under the existing `src/**` globs); `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md` (library contracts, unchanged: this slice adds no library API and changes no gate, closer or role behaviour); `docs/provisioning.md`; `examples/sample-project/package.json`, `add.js`, `add.test.js`.

---

### Task 1: Find the runs a repository is holding

**Files:**
- Modify: `src/cli/run-location.ts` (add `runsRoot`, use it in `runPlace`)
- Modify: `src/cli/run-location.test.ts` (one test for `runsRoot`)
- Create: `src/cli/runs.ts`
- Create: `src/cli/runs.test.ts`

**Interfaces:**
- Consumes: `load` from `src/case-file.js`; `FileNotFound` from `src/errors.js`; `CaseFile` type from `src/schema.js`; `taskIntent` from `src/cli/settings.js`.
- Produces:
  - from `src/cli/run-location.ts`: `function runsRoot(repoPath: string): string`
  - from `src/cli/runs.ts`:
    - `interface RunRecord { runId: string; repoPath: string; dir: string; caseFile: CaseFile }`
    - `function readRun(repoPath: string, runId: string): Promise<RunRecord>`
    - `function unfinishedRuns(repoPath: string): Promise<RunRecord[]>` (most recently touched first)
    - `function startedAt(runId: string): string`
    - `function describeRun(record: RunRecord): string`

- [ ] **Step 1: Write the failing test**

Create `src/cli/runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import { CorruptCaseFile } from "../errors.js";
import type { GateRef } from "../schema.js";
import { runsRoot } from "./run-location.js";
import { describeRun, readRun, startedAt, unfinishedRuns } from "./runs.js";

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** A run's record on disk, as `delivery run` leaves it: unfinished unless it is given an outcome. */
async function writeRun(repoPath: string, runId: string, intent: string, finished = false): Promise<string> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef: { intent }, gateRef: GATE, closerRef: { type: "commit-to-branch" } }, DEFAULT_BUDGETS);
  if (finished) {
    await setOutcome(dir, { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-15T21:00:00.000Z" });
  }
  return dir;
}

async function scratchRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "runs-"));
}

describe("the runs a repository is holding", () => {
  it("finds none in a repository that has never run anything", async () => {
    expect(await unfinishedRuns(await scratchRepo())).toEqual([]);
  });

  it("leaves out the runs that already finished", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");

    expect((await unfinishedRuns(repo)).map((record) => record.runId)).toEqual(["add-a-greeting-20260915T211500Z"]);
  });

  it("puts the most recently touched run first, whatever order they were started in", async () => {
    const repo = await scratchRepo();
    const older = await writeRun(repo, "reverse-a-word-20260915T213000Z", "reverse a word");
    const newer = await writeRun(repo, "add-a-greeting-20260915T210000Z", "add a greeting");
    await utimes(join(older, "case.json"), new Date("2026-09-15T21:30:00Z"), new Date("2026-09-15T21:30:00Z"));
    await utimes(join(newer, "case.json"), new Date("2026-09-15T22:00:00Z"), new Date("2026-09-15T22:00:00Z"));

    expect((await unfinishedRuns(repo)).map((record) => record.runId)).toEqual([
      "add-a-greeting-20260915T210000Z",
      "reverse-a-word-20260915T213000Z",
    ]);
  });

  it("ignores a folder that holds no record: nothing was ever written there", async () => {
    const repo = await scratchRepo();
    await mkdir(join(runsRoot(repo), "half-made-20260915T210000Z"), { recursive: true });

    expect(await unfinishedRuns(repo)).toEqual([]);
  });

  it("stops on a record that cannot be read back, rather than quietly skipping the user's run", async () => {
    const repo = await scratchRepo();
    const dir = await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeFile(join(dir, "case.json"), "{ this is not json");

    await expect(unfinishedRuns(repo)).rejects.toBeInstanceOf(CorruptCaseFile);
  });

  it("reads one run by its id, finished or not", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);

    const record = await readRun(repo, "reverse-a-word-20260915T210000Z");
    expect(record.caseFile.outcome?.kind).toBe("closed");
    expect(record.repoPath).toBe(repo);
  });
});

describe("how a run is described to a person", () => {
  it("reads the start time out of the run's id, which is where it already lives", () => {
    expect(startedAt("reverse-a-word-20260915T213012Z")).toBe("2026-09-15 21:30 UTC");
  });

  it("says so plainly when an id carries no time", () => {
    expect(startedAt("hand-made")).toBe("an unknown time");
  });

  it("names the run, when it started and what it was asked to do", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T213012Z", "add a function that reverses a word, with a test");

    const [record] = await unfinishedRuns(repo);
    expect(record && describeRun(record)).toBe(
      "reverse-a-word-20260915T213012Z, started 2026-09-15 21:30 UTC: add a function that reverses a word, with a test",
    );
  });
});
```

Add to `src/cli/run-location.test.ts`, inside a new `describe("runsRoot")` block:

```ts
it("is where every run's record in a repository lives", () => {
  expect(runsRoot("/tmp/project")).toBe("/tmp/project/.delivery/runs");
  expect(runPlace("/tmp/project", "add-a-thing-20260914T210309Z", {}).dir).toBe(
    join(runsRoot("/tmp/project"), "add-a-thing-20260914T210309Z"),
  );
});
```

(add `runsRoot` to the existing import from `./run-location.js`; `join` is already imported.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts src/cli/run-location.test.ts`
Expected: FAIL — `Failed to resolve import "./runs.js"`, and `runsRoot is not exported`.

- [ ] **Step 3: Write the implementation**

In `src/cli/run-location.ts`, add above `runPlace`:

```ts
/** Where a repository keeps every run's record: inside the repository, so nobody has to remember where it is. */
export function runsRoot(repoPath: string): string {
  return join(repoPath, ".delivery", "runs");
}
```

and change `runPlace`'s `dir` to `join(runsRoot(repoPath), runId)`.

Create `src/cli/runs.ts`:

```ts
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { load } from "../case-file.js";
import { FileNotFound } from "../errors.js";
import type { CaseFile } from "../schema.js";
import { runsRoot } from "./run-location.js";
import { taskIntent } from "./settings.js";

/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
export interface RunRecord {
  runId: string;
  repoPath: string;
  dir: string;
  caseFile: CaseFile;
}

/** One run by its id, finished or not. An id that names nothing raises `FileNotFound`, which the command already renders plainly. */
export async function readRun(repoPath: string, runId: string): Promise<RunRecord> {
  const dir = join(runsRoot(repoPath), runId);
  return { runId, repoPath, dir, caseFile: await load(dir) };
}

/** When a run's record was last written, for "the most recently touched": the cursor and the log are each rewritten as the run moves. */
async function touchedAt(dir: string): Promise<number> {
  const times = await Promise.all(
    ["case.json", "log.jsonl"].map((name) =>
      stat(join(dir, name)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

/**
 * The runs this repository is still holding: a record with no outcome, which is
 * what an interrupted run leaves behind. Most recently touched first, so "the
 * last one" needs no other bookkeeping.
 *
 * A folder with no record in it was never a run (the process died between
 * making the folder and writing the case file), so it is passed over. A record
 * that is there but cannot be read back is the user's to hear about, so it is
 * not swallowed: it stops the command with the message that names the folder.
 */
export async function unfinishedRuns(repoPath: string): Promise<RunRecord[]> {
  let entries;
  try {
    entries = await readdir(runsRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has ever run here
  }

  const found: { record: RunRecord; touchedAt: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let record: RunRecord;
    try {
      record = await readRun(repoPath, entry.name);
    } catch (err) {
      if (err instanceof FileNotFound) continue;
      throw err;
    }
    if (record.caseFile.outcome) continue;
    found.push({ record, touchedAt: await touchedAt(record.dir) });
  }
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

/** The UTC second a run started, which its id already carries (`src/cli/run-location.ts`), as a person reads it. */
export function startedAt(runId: string): string {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return "an unknown time";
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)} UTC`;
}

/** One run on one line: which run, when it started, and what it was asked to do. */
export function describeRun(record: RunRecord): string {
  return `${record.runId}, started ${startedAt(record.runId)}: ${taskIntent(record.caseFile.header.taskDef)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/runs.test.ts src/cli/run-location.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/runs.ts src/cli/runs.test.ts src/cli/run-location.ts src/cli/run-location.test.ts
git commit -m "$(cat <<'EOF'
Find the runs a repository is still holding

Resuming starts with knowing what there is to resume. The run's record is
already in the repository and its id already carries the second it started, so
discovery is a directory listing and the library's own load, with no index,
lock file or new persisted field to go stale. A folder with nothing written in
it was never a run and is passed over; a record that is there but unreadable
stops the command instead, because that is the user's to know about.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `delivery run` picks up the run that didn't finish

**Files:**
- Create: `src/cli/context.ts`
- Create: `src/cli/drive.ts`
- Create: `src/cli/command-fixtures.ts` (test support, as `src/temp-repo.ts` already is)
- Modify: `src/cli/output.ts` (resume phrases, the recovery line)
- Modify: `src/cli/output.test.ts`
- Modify: `src/cli/settings.ts` (lift `explicitIntent` out of `taskFrom`)
- Modify: `src/cli/run-command.ts` (decide, then hand off to `drive.ts`)
- Modify: `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `unfinishedRuns` (`src/cli/runs.js`); `advance`, `AdvanceResult` (`src/surface.js`); `resumeAction`, `logTail`, `create`, `load` (`src/case-file.js`); `runPlace`, `prepareRunDir`, `runIdFor` (`src/cli/run-location.js`); `summariseOutcome` (`src/cli/outcome.js`); `agentSession` (`src/cli/agent-session.js`); `checkCustomModules`, `taskIntent`, `DEFAULT_CLOSER` (`src/cli/settings.js`); `resolveCloser` (`src/resolve-closer.js`).
- Produces:
  - from `src/cli/context.ts`: `interface CommandContext { cwd: string; env: NodeJS.ProcessEnv; colour: boolean; writeLine(line: string): void }`
  - from `src/cli/output.ts`: `const RESUME_PHRASES: Record<ResumeAction, string>`; `function pickingUp(caseFile: CaseFile): string`; `function putRight(recovery: string): string`
  - from `src/cli/settings.ts`: `function explicitIntent(flags: RunFlags, env: NodeJS.ProcessEnv, cwd: string): Promise<string | undefined>`
  - from `src/cli/drive.ts`: `function driveToOutcome(record: RunRecord, session: SessionEnvironment, progress: Progress, ctx: CommandContext): Promise<ExitCode>`; `function resumeRun(record: RunRecord, ctx: CommandContext): Promise<ExitCode>`
  - from `src/cli/command-fixtures.ts`: `const PACKAGE: string`; `const TASK: string`; `const GATE: GateRef`; `const RUN_TIMEOUT: number`; `const completes: MockScript`; `function scriptFile(script: MockScript): Promise<string>`; `function delivery(args: string[], io: DeliveryIo): Promise<{ exitCode: number; stdout: string; stderr: string }>`; `function branchIn(stdout: string): string`; `function interruptedRun(repo: string, state: string, options: { task: string; steps: number; worker: (ctx: AgentContext) => Promise<Terminus> }): Promise<string>`
- Note: `src/cli/run-command.ts` re-exports nothing new; `CommandContext` moves out of it into `context.ts` and every importer follows (only `run-command.ts` itself uses it today).

- [ ] **Step 1: Write the failing tests for what the terminal says**

Add to `src/cli/output.test.ts`:

```ts
import { DEFAULT_BUDGETS } from "../budgets.js";
import type { ResumeAction } from "../case-file.js";
import type { CaseFile, GateRef, HistoryEntry } from "../schema.js";
import { pickingUp, putRight, RESUME_PHRASES, STEP_PHRASES } from "./output.js";

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** A case file with the given log tail, which is what decides where a resumed run picks up. */
function caseFileEndingIn(tail: HistoryEntry | undefined): CaseFile {
  return {
    header: { surfaceId: "reverse-a-word-20260915T213012Z", taskDef: { intent: "reverse a word" }, gateRef: GATE, baseline: null, baseBranch: null },
    cursor: { state: "GATING", budgets: DEFAULT_BUDGETS, worktreeRef: "/tmp/copy" },
    history: tail ? [tail] : [],
  };
}

describe("what a resumed run says it is picking up", () => {
  it("says what happens next in the same words the step lines use", () => {
    const caseFile = caseFileEndingIn({ t: "terminus", attempt: 1, sessionKey: "worker-1-1", status: "completed", rationale: "added it" });
    expect(pickingUp(caseFile)).toBe("Picking up where it left off: checking the agent's work.");
  });

  it("has a phrase for a run that was stopped before anything was recorded", () => {
    expect(pickingUp(caseFileEndingIn(undefined))).toBe("Picking up where it left off: getting the agent going.");
  });

  it("never shows a raw state name, whatever the run was doing", () => {
    for (const phrase of Object.values(RESUME_PHRASES)) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  it("has a phrase for every way a run can be picked up", () => {
    const actions: ResumeAction[] = ["start", "incomplete_terminus", "gate", "triage", "close", "act_on_verdict", "close_triage", "done"];
    for (const action of actions) expect(RESUME_PHRASES[action]).toBeTruthy();
  });
});

describe("what a resumed run says it put right", () => {
  it("leads with plain language, then the harness's own account of what it fixed", () => {
    expect(putRight("re-created the working copy")).toBe("Had to put something right: re-created the working copy.");
  });
});
```

(The existing file already imports `describe`, `expect`, `it` and `STEP_PHRASES`; merge the imports rather than duplicating them.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/output.test.ts`
Expected: FAIL — `pickingUp is not exported by ./output.js`.

- [ ] **Step 3: Say what a resumed run is picking up**

Add to `src/cli/output.ts` (importing `logTail`, `resumeAction` and the `ResumeAction` and `CaseFile` types):

```ts
/**
 * Every way a run can be picked up, as a person reads it. `ResumeAction` is a
 * closed set, so the table is total: a new one does not compile until it has a
 * phrase. The wording matches `STEP_PHRASES` wherever the two describe the same
 * work, so "picking up where it left off" and the step lines that follow it
 * speak one language.
 */
export const RESUME_PHRASES: Record<ResumeAction, string> = {
  start: "getting the agent going",
  incomplete_terminus: "the agent stopped without finishing",
  gate: "checking the agent's work",
  triage: "deciding what to do about a setback",
  act_on_verdict: "acting on what it decided about the last setback",
  close: "wrapping up",
  close_triage: "deciding what to do about a delivery that didn't finish",
  done: "finishing off",
};

/** What this run will do first now it has been picked up, read from its log rather than its cursor, which a kill can leave behind. */
export function pickingUp(caseFile: CaseFile): string {
  return `Picking up where it left off: ${RESUME_PHRASES[resumeAction(logTail(caseFile))]}.`;
}

/**
 * Something a resumed run had to fix before it could go on. The harness's own
 * account is printed as it wrote it: it is free-form, so paraphrasing it here
 * would be a lookup table that silently stops matching.
 */
export function putRight(recovery: string): string {
  return `Had to put something right: ${recovery}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/output.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/output.ts src/cli/output.test.ts
git commit -m "$(cat <<'EOF'
Translate what a resumed run is picking up

The library has said what a resumed run will do next since the case file was
written, and what it had to put right since crash recovery landed, but nothing
has ever printed either. Both tables live with the step phrases because they
are the same kind of thing: the closed set of states the terminal is allowed to
talk about, in words a person reads.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Put the CLI tests' fixtures where both commands' tests can reach them**

Two test files need the same scratch repository, the same in-process invocation
and the same interrupted run, so the fixtures move out of `run-command.test.ts`
into a module of their own, following `src/temp-repo.ts`, which is test and demo
support living in `src/` for the same reason.

Create `src/cli/command-fixtures.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create } from "../case-file.js";
import { writeMockScript, type MockScript } from "../mock-script.js";
import { resolveCloser } from "../resolve-closer.js";
import { deterministicRouter } from "../router.js";
import { advance } from "../surface.js";
import { fakeAgentPort } from "../agent-port-double.js";
import type { AgentContext, Terminus } from "../ports.js";
import type { GateRef } from "../schema.js";
import { runCli } from "./program.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import { DEFAULT_CLOSER } from "./settings.js";

/** Test support: the scratch project the command tests run against, and the task they give it. */
export const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });
export const TASK = "add a function that says hello to a name, with a test";
export const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** A whole run, agent sessions and git included, needs longer than vitest's default. */
export const RUN_TIMEOUT = 60_000;

/** A scripted agent that does the task and says so. */
export const completes: MockScript = {
  expectations: [
    {
      effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
      json: { status: "completed", rationale: "added hello.js" },
    },
  ],
};

/** A claude-mock script file, for the contributor test seam. */
export async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "command-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

export interface DeliveryIo {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  /** What a person types at the command's questions. Given any, standard input reports itself as a terminal. */
  answers?: string[];
}

/** Test support: run `delivery <args>` in process, capturing what it prints. Working copies go under a scratch state folder unless the caller names one. */
export async function delivery(args: string[], { cwd, env = {}, isTTY = false, answers = [] }: DeliveryIo) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv: args,
    cwd,
    env: { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "command-state-")), ...env },
    stdin: Object.assign(Readable.from(answers.map((answer) => `${answer}\n`)), { isTTY: answers.length > 0 || undefined }),
    stdout: { write: (text: string) => (stdout += text), isTTY },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

/** The branch a closing or escalating run names. */
export function branchIn(stdout: string): string {
  const match = /branch (surface\/\S+?)\.?$/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no branch named in:\n${stdout}`);
  return match[1];
}

/** A worker that leaves its change on disk, as the real one does, so the check has something to pass. */
export const writesHello = async (ctx: AgentContext): Promise<Terminus> => {
  await writeFile(join(ctx.worktreePath, "hello.js"), "export const hello = (name) => `hello ${name}`;\n");
  return { status: "completed", rationale: "added hello.js" };
};

/**
 * Test support: a run that was interrupted. Its record is on disk with no
 * outcome, exactly as killing `delivery run` leaves it. The run is driven with
 * the same library the command drives, then stopped after `steps` advances;
 * `worker` is what the agent did before the stop, and rejecting from it is a
 * session that died mid-flight, the one window a clean stop between advances
 * cannot reach. `state` is the state folder the resuming command must also be
 * given, so both processes compute the same place for the working copy.
 */
export async function interruptedRun(
  repo: string,
  state: string,
  { task, steps, worker }: { task: string; steps: number; worker: (ctx: AgentContext) => Promise<Terminus> },
): Promise<string> {
  const runId = runIdFor(task, new Date());
  const { dir, location } = runPlace(repo, runId, { XDG_STATE_HOME: state });
  await prepareRunDir(repo, dir);
  await create(dir, { surfaceId: runId, taskDef: { intent: task }, gateRef: GATE, closerRef: DEFAULT_CLOSER }, DEFAULT_BUDGETS);
  const ports = { agent: fakeAgentPort({ worker }), triage: deterministicRouter, closer: resolveCloser(DEFAULT_CLOSER, repo) };
  for (let step = 0; step < steps; step++) {
    // The interruption is the last advance, so a rejecting worker throws here.
    await advance(dir, location, ports).catch(() => undefined);
  }
  return runId;
}
```

Note the `stdin` field: `CliIo` does not have one until Task 4, so add
`stdin: Object.assign(...)` to this helper only once Task 4 has widened
`CliIo`. Until then, leave that line out and drop `answers` from `DeliveryIo`.

Then delete `PACKAGE`, `TASK`, `RUN_TIMEOUT`, `completes`, `scriptFile`,
`delivery` and `branchIn` from `src/cli/run-command.test.ts` and import them
from `./command-fixtures.js` instead, leaving its `git`, `escalates`,
`CREDENTIALS` and `ESC` where they are.

- [ ] **Step 7: Write the failing tests for picking a run up**

Add to `src/cli/run-command.test.ts`, importing `interruptedRun` and
`writesHello` from `./command-fixtures.js` and `runsRoot` from
`./run-location.js`:

```ts
describe("picking up a run that didn't finish", () => {
  it(
    "carries on from where it stopped instead of starting over, and says so",
    async () => {
      const repo = initTempRepo("run-command-resume-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { exitCode, stdout, stderr } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stderr).toBe("");
      expect(stdout).toContain(`Resuming run ${runId}: ${TASK}`);
      expect(stdout).toContain("Picking up where it left off: checking the agent's work.");
      expect(stdout).not.toContain("Starting run");
      expect(exitCode).toBe(EXIT.ok);
      expect(branchIn(stdout)).toBe(`surface/${runId}`);
      expect(readdirSync(runsRoot(repo))).toEqual([runId]);
    },
    RUN_TIMEOUT,
  );

  it(
    "picks the same run up when it is given the task that run is already doing",
    async () => {
      const repo = initTempRepo("run-command-resume-same-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${runId}`);
      expect(exitCode).toBe(EXIT.ok);
      expect(readdirSync(runsRoot(repo))).toEqual([runId]);
    },
    RUN_TIMEOUT,
  );

  it(
    "says what it had to put right when the run was stopped in the middle of something",
    async () => {
      const repo = initTempRepo("run-command-recovery-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      await interruptedRun(repo, state, {
        task: TASK,
        steps: 3,
        worker: () => Promise.reject(new Error("the machine was switched off")),
      });

      const { stdout, exitCode } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("Had to put something right: recorded a missing terminus for worker attempt 1");
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it(
    "starts a new run when the only run for that task already finished",
    async () => {
      const repo = initTempRepo("run-command-finished-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const first = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(first.exitCode).toBe(EXIT.ok);

      const second = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(second.stdout).toContain("Starting run");
      expect(second.stdout).not.toContain("Picking up");
      expect(branchIn(second.stdout)).not.toBe(branchIn(first.stdout));
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
    },
    RUN_TIMEOUT,
  );

  it("stops with the folder named when a run's record cannot be read back", async () => {
    const repo = initTempRepo("run-command-corrupt-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const runId = await interruptedRun(repo, state, { task: TASK, steps: 1, worker: writesHello });
    writeFileSync(join(runsRoot(repo), runId, "case.json"), "{ this is not json");

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(stderr).toContain(join(runsRoot(repo), runId));
    expect(stderr).toContain("Remove that folder to start afresh.");
    expect(stderr).not.toContain("at Object.");
    expect(exitCode).toBe(EXIT.unexpected);
  });
});
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npx vitest run src/cli/run-command.test.ts -t "picking up a run"`
Expected: FAIL — the first test starts a second run instead of picking the first up ("Starting run …"), and `runsRoot` is not imported by the command yet.

- [ ] **Step 9: Give the two commands one place to be handed the process, and one run loop**

Create `src/cli/context.ts`:

```ts
/** What a command needs from the process it runs in, passed in so tests can run it in process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  writeLine(line: string): void;
}
```

Create `src/cli/drive.ts`:

```ts
import { createAgentPort } from "../agent-invoke.js";
import { load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { SurfacePorts } from "../ports.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { createProgress, paint, pickingUp, putRight, type Progress } from "./output.js";
import { runPlace } from "./run-location.js";
import type { RunRecord } from "./runs.js";
import { checkCustomModules, DEFAULT_CLOSER, taskIntent } from "./settings.js";

/**
 * Drive one run to its end, whether it was created a moment ago or left behind
 * by a process that was killed: the wiring is the same, and the settings come
 * from the run's own record, never from this invocation. One plain-language
 * line per step, then what the run did.
 *
 * The working copy's path is recomputed from the repository and the run id
 * rather than stored, so a resumed run finds the same place; once a run has
 * been set up, the library prefers the copy it already made.
 */
export async function driveToOutcome(
  record: RunRecord,
  session: SessionEnvironment,
  progress: Progress,
  ctx: CommandContext,
): Promise<ExitCode> {
  const { dir, repoPath, runId } = record;
  const { header } = record.caseFile;
  const { location } = runPlace(repoPath, runId, ctx.env);
  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
  const ports: SurfacePorts = {
    agent,
    triage: deterministicRouter,
    closer: resolveCloser(header.closerRef ?? DEFAULT_CLOSER, repoPath),
  };

  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    progress.step(result.state);
    if (result.recovery) ctx.writeLine(putRight(result.recovery));
  } while (!result.done);

  const summary = await summariseOutcome(dir, await load(dir));
  ctx.writeLine(paint(ctx.colour, summary.tone, summary.headline));
  for (const line of summary.details) ctx.writeLine(line);
  return summary.exitCode;
}

/**
 * Pick a run up where it stopped. It keeps the task, the check and the closing
 * action it started with, so nothing here is resolved again; the custom modules
 * those settings name are loaded first, so a module that has since been moved
 * stops the command rather than becoming a setback mid-run.
 */
export async function resumeRun(record: RunRecord, ctx: CommandContext): Promise<ExitCode> {
  const { header } = record.caseFile;
  await checkCustomModules(header.gateRef, header.closerRef ?? DEFAULT_CLOSER, record.repoPath);
  const session = await agentSession(ctx.env);
  ctx.writeLine(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.writeLine(pickingUp(record.caseFile));
  return driveToOutcome(record, session, createProgress(ctx.writeLine, ctx.colour), ctx);
}
```

- [ ] **Step 10: Lift the task this invocation named out of the precedence rules**

In `src/cli/settings.ts`, replace the body of `taskFrom` with a call to a new exported function, leaving the precedence rule where it is:

```ts
/**
 * The task this invocation named, from the flag, the file it points at or the
 * environment. Undefined when nobody named one: a task sitting in the project's
 * config file is not something the person typed just now, which is what decides
 * whether a run is being resumed or started.
 */
export async function explicitIntent(flags: RunFlags, env: NodeJS.ProcessEnv, cwd: string): Promise<string | undefined> {
  if (flags.task !== undefined && flags.taskFile !== undefined) throw new Refusal(BOTH_TASKS, EXIT.configuration);

  let fromFile: string | undefined;
  if (flags.taskFile !== undefined) {
    try {
      fromFile = (await readFile(resolve(cwd, flags.taskFile), "utf-8")).trim();
    } catch {
      throw new Refusal(NO_TASK_FILE(flags.taskFile), EXIT.configuration);
    }
  }

  return (flags.task ?? fromFile ?? env.DELIVERY_TASK)?.trim() || undefined;
}

async function taskFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig, cwd: string): Promise<TaskDef> {
  const intent = await explicitIntent(flags, env, cwd);
  if (intent) return { intent };
  if (config.task) return config.task;
  throw new Refusal(NO_TASK, EXIT.configuration);
}
```

- [ ] **Step 11: Decide, in `run-command.ts`, before anything else is resolved**

Rewrite `src/cli/run-command.ts` so the existing body becomes `startRun` and the exported command decides first. Delete its local `CommandContext` and `import type { CommandContext } from "./context.js"` instead, re-exporting it (`export type { CommandContext };`) so `program.ts` needs no change; drop the imports that moved to `drive.ts` (`createAgentPort`, `advance`, `deterministicRouter`, `resolveCloser`, the role configs, `summariseOutcome`, `load`, `paint`, `SurfacePorts`); and add `driveToOutcome`, `resumeRun` (`./drive.js`), `unfinishedRuns` (`./runs.js`) and `explicitIntent` (`./settings.js`).

```ts
/**
 * `delivery run`: pick up the run that didn't finish, or start a new one.
 *
 * Discovery comes first, because a run that is already under way settles what
 * this invocation is for: its settings are pinned in its own record, so the
 * config file, the flags and the defaults are only resolved on the way to a
 * new run.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const unfinished = await unfinishedRuns(repoPath);
  const intent = await explicitIntent(options, ctx.env, ctx.cwd);
  const resuming = unfinished.find(
    (record) => intent === undefined || taskIntent(record.caseFile.header.taskDef) === intent,
  );
  if (resuming) return resumeRun(resuming, ctx);
  return startRun(options, { startDir, repoPath }, ctx);
}

/** Start a run: work out what it should do from the project's config file, the flags and the environment, check the agent can start, then drive it. */
async function startRun(
  options: RunOptions,
  { startDir, repoPath }: { startDir: string; repoPath: string },
  ctx: CommandContext,
): Promise<ExitCode> {
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const { taskDef, gateRef, closerRef, budgets } = await resolveSettings(options, { env: ctx.env, cwd: ctx.cwd, repoPath, config });
  await checkCustomModules(gateRef, closerRef, repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.writeLine(UNCOMMITTED_NOTE);

  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef }, budgets);
  ctx.writeLine(`Starting run ${runId}: ${intent}`);

  const progress = createProgress(ctx.writeLine, ctx.colour);
  progress.step("PROVISIONING");
  return driveToOutcome({ runId, repoPath, dir, caseFile }, session, progress, ctx);
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts src/cli/settings.test.ts src/cli/output.test.ts`
Expected: PASS — the new block and every slice 1 and 2 test in those files.

- [ ] **Step 13: Commit**

```bash
git add src/cli/context.ts src/cli/drive.ts src/cli/command-fixtures.ts src/cli/run-command.ts src/cli/run-command.test.ts src/cli/settings.ts
git commit -m "$(cat <<'EOF'
Pick up the run that didn't finish instead of starting over

An interrupted run left a complete record in the repository and no way to reach
it: a person had to know where the record lived and write TypeScript against
advance. Running the same command again now finds it and carries on, saying
what it is picking up and printing what the harness had to put right, which the
library has reported since crash recovery landed but nothing has ever shown.

The run loop moves into drive.ts because resume composes exactly the same
wiring, and a resumed run takes its task, check and closing action from its own
record rather than from this invocation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: A different task stops, `--fresh` starts anyway, and a flag that cannot apply is named

**Files:**
- Modify: `src/cli/runs.ts` (the refusal's wording)
- Modify: `src/cli/settings.ts` (`RunFlags.fresh`, `ignoredSettings`, `ignoredNote`)
- Modify: `src/cli/settings.test.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/cli/run-command.test.ts`
- Modify: `src/cli/program.ts` (`--fresh`, and the `run` description)

**Interfaces:**
- Consumes: `RunRecord`, `startedAt`, `describeRun` (`src/cli/runs.js`); `taskIntent` (`src/cli/settings.js`); `Refusal`, `EXIT` (`src/cli/failures.js`); `CaseFileHeader` type (`src/schema.js`).
- Produces:
  - from `src/cli/runs.ts`: `function unfinishedRunFound(record: RunRecord): string`
  - from `src/cli/settings.ts`: `RunFlags` gains `fresh?: boolean`; `function ignoredSettings(flags: RunFlags, env: NodeJS.ProcessEnv, header: CaseFileHeader): string[]`; `function ignoredNote(names: string[]): string`

- [ ] **Step 1: Write the failing tests for what a resumed run ignores**

Add to `src/cli/settings.test.ts`:

```ts
import type { CaseFileHeader } from "../schema.js";
import { ignoredNote, ignoredSettings } from "./settings.js";

const PINNED: CaseFileHeader = {
  surfaceId: "reverse-a-word-20260915T213012Z",
  taskDef: { intent: "reverse a word" },
  gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
  closerRef: { type: "commit-to-branch" },
  baseline: null,
  baseBranch: null,
};

describe("what a resumed run cannot take from this invocation", () => {
  it("names a flag that asks for something the run did not start with", () => {
    expect(ignoredSettings({ gateCommand: "npm run verify" }, {}, PINNED)).toEqual(["--gate-command"]);
    expect(ignoredSettings({ closer: "merge-back" }, {}, PINNED)).toEqual(["--closer"]);
  });

  it("names the environment variable when that is where the setting came from", () => {
    expect(ignoredSettings({}, { DELIVERY_CLOSER: "merge-back" }, PINNED)).toEqual(["DELIVERY_CLOSER"]);
  });

  it("says nothing when the flag asks for what the run is already doing", () => {
    expect(ignoredSettings({ gateCommand: "npm test", closer: "commit-to-branch" }, {}, PINNED)).toEqual([]);
  });

  it("says nothing when no flag was given at all", () => {
    expect(ignoredSettings({}, { DELIVERY_CLOSER: "" }, PINNED)).toEqual([]);
  });

  it("reads as one note, however many settings it names", () => {
    expect(ignoredNote(["--closer"])).toBe("Note: a run keeps the settings it started with, so --closer was ignored.");
    expect(ignoredNote(["--gate-command", "--closer"])).toBe(
      "Note: a run keeps the settings it started with, so --gate-command and --closer were ignored.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/settings.test.ts -t "cannot take from this invocation"`
Expected: FAIL — `ignoredSettings is not exported by ./settings.js`.

- [ ] **Step 3: Work out what a resumed run has to ignore**

Add `fresh?: boolean;` to `RunFlags` in `src/cli/settings.ts`, and below `closerFrom`:

```ts
/**
 * The settings this invocation asked for that a run already under way cannot
 * take: its check and closing action were pinned when it started, so changing
 * them mid-flight would make its own record a lie. Naming the flag or the
 * variable the value came from is what tells the user which one to drop.
 */
export function ignoredSettings(flags: RunFlags, env: NodeJS.ProcessEnv, header: CaseFileHeader): string[] {
  const ignored: string[] = [];
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  if (command !== undefined && !(header.gateRef.type === "command" && header.gateRef.command === command)) {
    ignored.push(flags.gateCommand !== undefined ? "--gate-command" : "DELIVERY_GATE_COMMAND");
  }
  const closer = flags.closer ?? fromEnv(env.DELIVERY_CLOSER);
  if (closer !== undefined && closer !== (header.closerRef ?? DEFAULT_CLOSER).type) {
    ignored.push(flags.closer !== undefined ? "--closer" : "DELIVERY_CLOSER");
  }
  return ignored;
}

/** One note for everything this invocation asked for that the run it picked up will not do. */
export function ignoredNote(names: string[]): string {
  return `Note: a run keeps the settings it started with, so ${names.join(" and ")} ${names.length === 1 ? "was" : "were"} ignored.`;
}
```

(import the `CaseFileHeader` type from `../schema.js`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the refusal and `--fresh`**

Add to the `describe("picking up a run that didn't finish")` block in `src/cli/run-command.test.ts`:

```ts
it("stops when a different task is asked for, naming the run that didn't finish", async () => {
  const repo = initTempRepo("run-command-different-", { "package.json": PACKAGE });
  const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
  const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

  const { exitCode, stdout, stderr } = await delivery(["run", "--task", "something different"], {
    cwd: repo,
    env: { XDG_STATE_HOME: state },
  });

  expect(stderr).toContain(`task: \`${TASK}\``);
  expect(stderr).toContain(startedAt(runId));
  expect(stderr).toContain("Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway.");
  expect(stdout).toBe("");
  expect(exitCode).toBe(EXIT.configuration);
  expect(readdirSync(runsRoot(repo))).toEqual([runId]);
});

it(
  "starts the new task with --fresh and leaves the old run there to pick up",
  async () => {
    const repo = initTempRepo("run-command-fresh-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const interrupted = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

    const { exitCode, stdout } = await delivery(["run", "--task", "add a goodbye function, with a test", "--fresh"], {
      cwd: repo,
      env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });

    expect(stdout).toContain("Starting run");
    expect(exitCode).toBe(EXIT.ok);
    expect(readdirSync(runsRoot(repo))).toContain(interrupted);
    expect(readdirSync(runsRoot(repo))).toHaveLength(2);
  },
  RUN_TIMEOUT,
);

it(
  "notes what it ignored when a flag asks a resumed run for something else",
  async () => {
    const repo = initTempRepo("run-command-ignored-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

    const { stdout, exitCode } = await delivery(["run", "--closer", "merge-back"], {
      cwd: repo,
      env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });

    expect(stdout).toContain("Note: a run keeps the settings it started with, so --closer was ignored.");
    expect(stdout).toContain("is committed on branch");
    expect(exitCode).toBe(EXIT.ok);
  },
  RUN_TIMEOUT,
);
```

(add `startedAt` and `runsRoot` to the file's imports.)

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/cli/run-command.test.ts -t "picking up a run"`
Expected: FAIL — the different task starts a second run, `--fresh` is rejected as an unknown option, and no note is printed.

- [ ] **Step 7: Refuse, or start fresh, or note what was ignored**

Add to `src/cli/runs.ts`:

```ts
/** Why a new task cannot simply start: a run is already under way, and which one, so the user can choose between finishing it and setting it aside. */
export function unfinishedRunFound(record: RunRecord): string {
  return (
    `There's a run that didn't finish (started \`${startedAt(record.runId)}\`, task: \`${taskIntent(record.caseFile.header.taskDef)}\`). ` +
    "Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway."
  );
}
```

In `src/cli/run-command.ts`, add `EXIT` and `Refusal` to the `./failures.js` import, `unfinishedRunFound` to the `./runs.js` import and `ignoredNote`, `ignoredSettings` to the `./settings.js` import, then replace the decision in `runCommand`:

```ts
  const unfinished = options.fresh ? [] : await unfinishedRuns(repoPath);
  const intent = await explicitIntent(options, ctx.env, ctx.cwd);
  const [mostRecent] = unfinished;
  if (mostRecent) {
    // A task the user typed settles which run they mean without asking; anything
    // else would resume a run they did not name.
    const resuming =
      intent === undefined ? mostRecent : unfinished.find((record) => taskIntent(record.caseFile.header.taskDef) === intent);
    if (!resuming) throw new Refusal(unfinishedRunFound(mostRecent), EXIT.configuration);
    const ignored = ignoredSettings(options, ctx.env, resuming.caseFile.header);
    if (ignored.length > 0) ctx.writeLine(ignoredNote(ignored));
    return resumeRun(resuming, ctx);
  }
  return startRun(options, { startDir, repoPath }, ctx);
```

In `src/cli/program.ts`, on the `run` command:

```ts
    .option("--fresh", "start a new run even though one didn't finish, leaving that one to pick up later")
```

and change the `run` description to end `…, or picks up a run that didn't finish`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/cli/runs.ts src/cli/settings.ts src/cli/settings.test.ts src/cli/run-command.ts src/cli/run-command.test.ts src/cli/program.ts
git commit -m "$(cat <<'EOF'
Stop when a new task is asked for while a run is unfinished

Silently starting a second run would leave the first one stranded with no sign
of it, and silently resuming would do the wrong task. Naming the run, when it
started and what it was asked to do gives the user the two moves that exist:
finish it, or set it aside with --fresh. A flag that a resumed run cannot take
is named for the same reason: its settings were pinned when it started, so
quietly honouring the flag would make the run's own record a lie.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Ask which run when there is more than one

**Files:**
- Modify: `src/cli/context.ts` (the command's standard input)
- Modify: `src/cli/runs.ts` (`chooseRun` and its messages)
- Modify: `src/cli/runs.test.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/cli/run-command.test.ts`
- Modify: `src/cli/program.ts`, `src/cli/main.ts` (pass standard input through)

**Interfaces:**
- Consumes: `describeRun`, `RunRecord` (`src/cli/runs.js`); `Refusal`, `EXIT` (`src/cli/failures.js`); `createInterface` (`node:readline`).
- Produces:
  - from `src/cli/context.ts`: `type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean }`; `CommandContext` gains `stdin: CliStdin`
  - from `src/cli/runs.ts`: `const NOTHING_TO_RESUME: string`; `const NOTHING_CHOSEN: string`; `function severalRuns(records: RunRecord[]): string`; `function chooseRun(records: RunRecord[], ctx: CommandContext): Promise<RunRecord>`
  - `CliIo` in `src/cli/program.ts` gains `stdin: CliStdin`

- [ ] **Step 1: Write the failing tests for choosing**

Add to `src/cli/runs.test.ts`:

```ts
import { Readable } from "node:stream";
import { Refusal } from "./failures.js";
import { chooseRun, NOTHING_CHOSEN, NOTHING_TO_RESUME, severalRuns } from "./runs.js";

/** A command context reading the answers a person would type, with `isTTY` saying whether anyone is there to type them. */
function answering(answers: string[], { interactive }: { interactive: boolean }) {
  const lines: string[] = [];
  const stdin = Object.assign(Readable.from(answers.map((answer) => `${answer}\n`)), { isTTY: interactive || undefined });
  return { ctx: { cwd: "/", env: {}, colour: false, stdin, writeLine: (line: string) => lines.push(line) }, lines };
}

describe("choosing which run to pick up", () => {
  it("takes the only unfinished run without asking", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    const { ctx, lines } = answering([], { interactive: true });

    expect((await chooseRun(await unfinishedRuns(repo), ctx)).runId).toBe("reverse-a-word-20260915T210000Z");
    expect(lines).toEqual([]);
  });

  it("lists them and asks when there is more than one", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const records = await unfinishedRuns(repo);
    const { ctx, lines } = answering(["2"], { interactive: true });

    expect((await chooseRun(records, ctx)).runId).toBe(records[1]?.runId);
    expect(lines.join("\n")).toContain("  1. add-a-greeting-20260915T211500Z, started 2026-09-15 21:15 UTC: add a greeting");
    expect(lines.join("\n")).toContain("  2. reverse-a-word-20260915T210000Z, started 2026-09-15 21:00 UTC: reverse a word");
  });

  it("leaves every run alone when the answer names none of them", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const { ctx } = answering([""], { interactive: true });

    await expect(chooseRun(await unfinishedRuns(repo), ctx)).rejects.toThrow(NOTHING_CHOSEN);
  });

  it("prints the list and stops when nobody is there to answer", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const { ctx } = answering([], { interactive: false });

    const refusal = await chooseRun(await unfinishedRuns(repo), ctx).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toContain("reverse-a-word-20260915T210000Z");
    expect((refusal as Refusal).message).toContain("delivery resume --last");
    expect((refusal as Refusal).exitCode).toBe(2);
  });

  it("says plainly when there is nothing to pick up", async () => {
    const { ctx } = answering([], { interactive: true });
    await expect(chooseRun([], ctx)).rejects.toThrow(NOTHING_TO_RESUME);
  });
});
```

(`severalRuns` is exercised through the non-interactive refusal; import it only if you assert on it directly.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts -t "choosing which run"`
Expected: FAIL — `chooseRun is not exported by ./runs.js`.

- [ ] **Step 3: Ask, or print the list and stop**

In `src/cli/context.ts`:

```ts
/** The command's standard input: a person typing, or a pipe with nobody behind it. */
export type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean };
```

and add `stdin: CliStdin;` to `CommandContext`.

Add to `src/cli/runs.ts`:

```ts
import { createInterface } from "node:readline";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal } from "./failures.js";

export const NOTHING_TO_RESUME =
  'There\'s no run here that didn\'t finish, so there is nothing to pick up. Start one with `delivery run --task "..."`.';

export const NOTHING_CHOSEN =
  "That isn't one of the numbers in the list, so I've left every run alone. Run `delivery resume <run-id>` when you know which one you want.";

/** Every run that didn't finish, for a terminal with nobody in front of it to read in its log. */
export function severalRuns(records: RunRecord[]): string {
  return [
    "More than one run didn't finish:",
    ...records.map((record) => `  ${describeRun(record)}`),
    "Say which one to pick up: `delivery resume <run-id>`, or `delivery resume --last` for the one touched most recently.",
  ].join("\n");
}

/** The first line the user types, and nothing else: the answer to one question, not a session. */
async function firstLine(stdin: CommandContext["stdin"]): Promise<string> {
  const lines = createInterface({ input: stdin });
  try {
    for await (const line of lines) return line;
    return "";
  } finally {
    lines.close();
  }
}

/**
 * Which run this command means. One is unambiguous. Several are not, so a
 * person is asked rather than guessed at, and a terminal with nobody in front
 * of it is given the list and stopped: picking one for a script would sooner or
 * later finish the wrong run.
 */
export async function chooseRun(records: RunRecord[], ctx: CommandContext): Promise<RunRecord> {
  const [first] = records;
  if (first === undefined) throw new Refusal(NOTHING_TO_RESUME, EXIT.configuration);
  if (records.length === 1) return first;
  if (ctx.stdin.isTTY !== true) throw new Refusal(severalRuns(records), EXIT.configuration);

  ctx.writeLine("More than one run didn't finish. Which one should I pick up?");
  records.forEach((record, index) => ctx.writeLine(`  ${index + 1}. ${describeRun(record)}`));
  ctx.writeLine("Type its number and press Enter.");
  const chosen = records[Number((await firstLine(ctx.stdin)).trim()) - 1];
  if (chosen === undefined) throw new Refusal(NOTHING_CHOSEN, EXIT.configuration);
  return chosen;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/runs.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the command asking**

In `src/cli/command-fixtures.ts`, restore the two lines Task 2 left out now that
`CliIo` can take them: `answers?: string[]` on `DeliveryIo`, and the `stdin`
field in `delivery`'s call to `runCli`, exactly as that step wrote them. Then
add to the `describe("picking up a run that didn't finish")` block in
`src/cli/run-command.test.ts`:

```ts
it(
  "asks which run to pick up when more than one didn't finish",
  async () => {
    const repo = initTempRepo("run-command-several-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const older = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
    const newer = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

    const { stdout, exitCode } = await delivery(["run"], {
      cwd: repo,
      env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      answers: ["2"],
    });

    expect(stdout).toContain(`  1. ${newer}`);
    expect(stdout).toContain(`  2. ${older}`);
    expect(stdout).toContain(`Resuming run ${older}`);
    expect(exitCode).toBe(EXIT.ok);
  },
  RUN_TIMEOUT,
);

it("prints the list and stops when more than one didn't finish and nobody can answer", async () => {
  const repo = initTempRepo("run-command-several-ci-", { "package.json": PACKAGE });
  const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
  const first = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
  const second = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

  const { stderr, exitCode } = await delivery(["run"], { cwd: repo, env: { XDG_STATE_HOME: state } });

  expect(stderr).toContain(first);
  expect(stderr).toContain(second);
  expect(stderr).toContain("delivery resume --last");
  expect(exitCode).toBe(EXIT.configuration);
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/cli/run-command.test.ts -t "more than one"`
Expected: FAIL — the command resumes the most recent run without asking, and `runCli` rejects the extra `stdin` property.

- [ ] **Step 7: Let the command ask**

In `src/cli/program.ts`, add `stdin: CliStdin;` to `CliIo` (importing the type from `./context.js`) and pass `stdin: io.stdin` into the `runCommand` context. In `src/cli/main.ts`, pass `stdin: process.stdin`.

In `src/cli/run-command.ts`, replace the `intent === undefined ? mostRecent : …` line with:

```ts
    const resuming =
      intent === undefined
        ? await chooseRun(unfinished, ctx)
        : unfinished.find((record) => taskIntent(record.caseFile.header.taskDef) === intent);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/cli/context.ts src/cli/runs.ts src/cli/runs.test.ts src/cli/command-fixtures.ts src/cli/run-command.ts src/cli/run-command.test.ts src/cli/program.ts src/cli/main.ts
git commit -m "$(cat <<'EOF'
Ask which run to pick up when more than one didn't finish

Guessing is the one thing the command must not do here: finishing the wrong run
commits work the person did not ask for now. A terminal with someone in front
of it gets the list and one question; a pipe or a CI step gets the same list and
stops, because there is nobody to ask and no safe default. One readline question
rather than a prompt library: this is a single question, and the package that
people install should not carry a dependency for it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `delivery resume`

**Files:**
- Create: `src/cli/resume-command.ts`
- Create: `src/cli/resume-command.test.ts`
- Modify: `src/cli/runs.ts` (`alreadyFinished`)
- Modify: `src/cli/program.ts` (register the command)
- Modify: `README.md`
- Modify: `examples/sample-project/README.md`

**Interfaces:**
- Consumes: `findRepository` (`src/cli/project.js`); `chooseRun`, `readRun`, `unfinishedRuns`, `alreadyFinished` (`src/cli/runs.js`); `resumeRun` (`src/cli/drive.js`); `CommandContext` (`src/cli/context.js`); `Refusal`, `EXIT`, `ExitCode` (`src/cli/failures.js`).
- Produces:
  - from `src/cli/runs.ts`: `function alreadyFinished(runId: string): string`
  - from `src/cli/resume-command.ts`: `interface ResumeOptions { last?: boolean; repo?: string }`; `function resumeCommand(runId: string | undefined, options: ResumeOptions, ctx: CommandContext): Promise<ExitCode>`

- [ ] **Step 1: Write the failing tests**

Create `src/cli/resume-command.test.ts`, taking its fixtures from the module Task 2 created:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import {
  branchIn,
  completes,
  delivery,
  interruptedRun,
  PACKAGE,
  RUN_TIMEOUT,
  scriptFile,
  TASK,
  writesHello,
} from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { NOTHING_TO_RESUME } from "./runs.js";

describe("delivery resume", () => {
  it(
    "picks up the one run that didn't finish",
    async () => {
      const repo = initTempRepo("resume-one-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${runId}`);
      expect(stdout).toContain("Picking up where it left off: checking the agent's work.");
      expect(branchIn(stdout)).toBe(`surface/${runId}`);
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it(
    "picks up the run its id names",
    async () => {
      const repo = initTempRepo("resume-named-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const wanted = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume", wanted], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${wanted}`);
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it(
    "picks up the one touched most recently with --last, without asking",
    async () => {
      const repo = initTempRepo("resume-last-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      const newest = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["resume", "--last"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${newest}`);
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it("says plainly when there is nothing to pick up, and never starts a run", async () => {
    const repo = initTempRepo("resume-none-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["resume"], { cwd: repo });

    expect(stderr).toContain(NOTHING_TO_RESUME);
    expect(exitCode).toBe(EXIT.configuration);
    expect(readdirSync(repo)).not.toContain(".delivery");
  });

  it(
    "says so when the run it is given has already finished",
    async () => {
      const repo = initTempRepo("resume-finished-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "resume-state-"));
      const first = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      const runId = branchIn(first.stdout).replace("surface/", "");

      const { stderr, exitCode } = await delivery(["resume", runId], { cwd: repo, env: { XDG_STATE_HOME: state } });

      expect(stderr).toContain("has already finished");
      expect(exitCode).toBe(EXIT.configuration);
    },
    RUN_TIMEOUT,
  );

  it("says it cannot find a run id that names nothing", async () => {
    const repo = initTempRepo("resume-unknown-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["resume", "no-such-run-20260915T210000Z"], { cwd: repo });

    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("at Object.");
    expect(exitCode).toBe(EXIT.configuration);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/resume-command.test.ts`
Expected: FAIL — `error: unknown command 'resume'`, exit code 2 with commander's message.

- [ ] **Step 3: Write the command**

Add to `src/cli/runs.ts`:

```ts
/** Why a finished run cannot be picked up: it is done, and reopening it would deliver its work twice. */
export function alreadyFinished(runId: string): string {
  return `The run \`${runId}\` has already finished, so there is nothing to pick up. Start a new one with \`delivery run --task "..."\`.`;
}
```

Create `src/cli/resume-command.ts`:

```ts
import { resolve } from "node:path";
import type { CommandContext } from "./context.js";
import { resumeRun } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { alreadyFinished, chooseRun, readRun, unfinishedRuns, type RunRecord } from "./runs.js";

/** What `delivery resume` was given on the command line, besides the run id. */
export interface ResumeOptions {
  last?: boolean;
  repo?: string;
}

/** The run this command means when no id was given: the one that didn't finish, the most recent with `--last`, or a question. */
async function discover(repoPath: string, options: ResumeOptions, ctx: CommandContext): Promise<RunRecord> {
  const runs = await unfinishedRuns(repoPath);
  const [mostRecent] = runs;
  if (options.last && mostRecent) return mostRecent;
  return chooseRun(runs, ctx);
}

/**
 * `delivery resume`: the explicit form of what `delivery run` does when it finds
 * a run that didn't finish, for a script or for someone who wants certainty. It
 * never starts a new run, so when there is nothing to pick up it says so rather
 * than quietly doing something else.
 */
export async function resumeCommand(runId: string | undefined, options: ResumeOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const record = runId === undefined ? await discover(repoPath, options, ctx) : await readRun(repoPath, runId);
  if (record.caseFile.outcome) throw new Refusal(alreadyFinished(record.runId), EXIT.configuration);
  return resumeRun(record, ctx);
}
```

In `src/cli/program.ts`, importing `resumeCommand` and the `ResumeOptions` type from `./resume-command.js`, after the `run` command:

```ts
  program
    .command("resume")
    .description("pick up a run that didn't finish, without ever starting a new one")
    .argument("[run-id]", "the run to pick up (default: the one that didn't finish)")
    .option("--last", "pick up the run touched most recently, without asking")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: ResumeOptions, command: Command) => {
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await resumeCommand(runId, options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        stdin: io.stdin,
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/resume-command.test.ts`
Expected: PASS

- [ ] **Step 5: Say so where people read about the command**

In `README.md`, after the "Run a task from the command line" section and before "Configure it once":

```markdown
## Pick up a run that was interrupted

If a run stops before it finishes, because you closed the terminal, pressed Ctrl-C or the
machine restarted, run the same command again in the same repository:

```bash
delivery run
```

It finds the run that didn't finish, says what it is picking up, and carries on from there
rather than starting over. `delivery resume` does the same and never starts a new run: give it
a run id, or `--last` for the run touched most recently. If more than one run didn't finish, it
lists them and asks which one; in a script or a CI step, where nobody can answer, it prints the
list and stops.

A run keeps the task, the check and the closing action it started with, so a flag asking for
something else is ignored with a note saying so. Asking for a different task while a run is
unfinished stops the command: finish that run with `delivery resume`, or add `--fresh` to start
the new task and leave the old run to pick up later.
```

In `examples/sample-project/README.md`, add a step 6:

```markdown
6. If the run stops before it finishes, run `delivery run` again in the same folder. It picks
   up where it left off rather than starting over.
```

- [ ] **Step 6: Run the tests to verify the sample project is still shipped as described**

Run: `npx vitest run tests/sample-project.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/resume-command.ts src/cli/resume-command.test.ts src/cli/runs.ts src/cli/program.ts README.md examples/sample-project/README.md
git commit -m "$(cat <<'EOF'
Add delivery resume, the explicit form of picking a run up

Re-running the same command is the recovery a person reaches for, but a script,
or someone who wants to be sure nothing new starts, needs to say what they mean.
resume is the same discovery with the "start a new one" branch removed, so there
is one rule about which run is meant, not two. A run id or --last skips the
question entirely.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **`advance` is the whole of resume.** Do not add a lock file, a run index, a "resumable" flag or a call to `rebuild()`. If a resumed run behaves differently from an uninterrupted one, that is a library bug to report, not something for the CLI to paper over: `demos/single-surface-slice-5-crash-recovery.ts` proves the four crash windows reach identical outcomes.
- **A resumed run is never reconfigured.** Nothing on the resume path calls `loadConfig` or `resolveSettings`. The header is the only source of the task, the check and the closing action, and `ignoredSettings` exists to say so out loud, not to apply anything.
- **Tests share one `XDG_STATE_HOME`** between building an interrupted run and resuming it, so the working copy is in the same place both times. The helper takes it as an argument for exactly that reason.
