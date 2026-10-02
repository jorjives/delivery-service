# Observability and Reporting — Slice 1: Come Back to Your Task List and See What Happened and What to Do

> **Status:** ✅ Complete — 2026-10-02 — `f608aaa`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md`
**Spec:** `docs/superpowers/specs/2026-10-01-observability-and-reporting-design.md`

**Goal:** A project owner types `delivery report` and reads, in plain words, how many tasks landed, which need her, which need an engineer, which were not started, and the next step for each.

**Architecture:** One read model in the library, apart from the code that prints it: `loadSnapshot(repoPath, subject, { live, list })` is the only reading (it takes no lock and sets a damaged record aside instead of throwing), `deriveReport(snapshot)` is a pure function to one `ReportDocument`, and `renderText(doc, { colour })` is a pure function to lines. They live in a new `src/report/`, in the library and not yet part of its public surface (Slice 5 exports them from `src/index.ts`, with the stability promise); `src/cli/report-command.ts` only resolves what is being asked about and prints. Two facts the report needs and the record does not yet hold start being recorded, both optional and read by nothing that decides what a run does next: why a task stopped (`outcome.cause`) and which usage limit stopped a session (`limit` on a terminus entry). Wording comes from closed phrase tables that are total over a closed set of stops, so a new kind of stop does not compile until it has words.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`, `.js` import suffixes), zod v4, vitest v5, commander v14. The scripted agent (`vendor/claude-mock`, through the `DELIVERY_TEST_MOCK_SCRIPT` seam) for the two real runs in the command tests and for the demo. No new dependency.

## Global Constraints

- Node ≥22; `strict` and `noUncheckedIndexedAccess` are on; `tseslint.configs.strict` forbids the `!` non-null operator and `any`.
- No new dependency (spec, "Buy-vs-build decisions": "No dependency is added for the MUST or SHOULD tiers").
- **Exit codes, one rule** (spec, "Commands and exit codes"): `report` exits ok whenever the report could be made, whatever it says. `run` and `resume` keep today's codes. An id that names no run is a failure to answer and keeps today's exit 2 and message.
- **Vocabulary** (spec, "Vocabulary"): owner-facing text says "task", "needs your decision", "attempts", "retries", "the check", "repair of the check, of the setup", "the agent". It never says: surface, budget, gate, triage, authority, terminus, breaker, escalated, worker, router, slot, population, degraded. One exported pattern, `FORBIDDEN` in `src/report/report-fixtures.ts`, is what the tests scan with.
- **Determinism** (spec, "Non-functional requirements"): the same record, task list and `live` value give byte-identical text. Nothing in `src/report/derive.ts` or `src/report/text.ts` reads a file, a clock, a locale, an environment variable or the terminal width.
- **Accuracy:** a report never states a figure it cannot derive; a missing fact reads "not recorded", never `0`, blank or `NaN`.
- **Compatibility:** a new build reads every old record. Every schema addition is optional and no entry kind is added (spec, "What is newly recorded"). Existing `status`, `status --all` and `status --json` output, keys and exit codes are unchanged.
- **Terminal safety** (spec, "Security"): the text renderer strips ESC sequences and the other C0 and C1 control characters from every quoted field, keeping newline and tab. The record is never altered.
- **Reading while a run writes:** a report takes no lock and writes nothing.
- User-facing copy (report sentences, `--help`, README, docs, changeset): controlled British English, plain words, no em-dashes (colons, semicolons, commas instead).
- Every path in a command is relative to the repository root; run every command from there and never `cd` elsewhere. If `node_modules` is missing, run `npm ci` once before the first test command.
- Targeted verification only: each task runs its own test files with `npx vitest run <files>`, plus `npx tsc --noEmit` and `npx eslint` on what it touched. The full suite runs once in final review, not per task. The slice's UAT/e2e test is recorded by a later phase: do not write one, and add nothing under `tests/`.
- Commit after each green cycle, as the steps say: one line saying what changed, then a paragraph saying why.
- **Buy-vs-build (slice Build note, copied):** "One read model, kept in the library and apart from the code that prints it, following the owner's autoloop precedent of separating a console's model from its views; the command line renders it and later slices add renderings, never a second derivation. States, retries and standings are worked out by the same folds that resuming a run already uses, not by a parallel reporting fold that could disagree with them. Wording comes from closed phrase tables that cover every case, as today's output phrases do, never from a model-written summary. Layout is plain lines as `delivery status` prints today, with no table or colour library; colour and tone reuse the existing rule. Stripping terminal control characters from quoted text is one small purpose-built function, not a dependency. No dependency is added." In this plan that means: `deriveBudgetsFromLog`, `supervisedView`, `claimedBy`, `repairsUsed`, `findQueueRun`, `queuePositionOf`, `newestFirstBy`, `startedInstant`, `branchName`, `USAGE_LIMIT_WORDS`, `paint` and `useColour` are reused, never re-implemented.
- **Operability/DX (slice Operational note, copied):** "No set-up change and no configuration key: the report works on any runs already on disk, including ones made before this slice, and reads without taking the lock, so it is safe during a run. Reports are a pure reading of the record, so a problem a user hits can be reproduced from a copy of their run folder. A reporting demo built on the scripted agent sits with the existing demos, so the output can be seen with no agent and no sign-in. The reason a task stopped starts being recorded with each outcome from this slice on; nothing that decides what a run does next reads it."
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **The library does not import the command line.** `supervisedView`, the run-location helpers, `RunRecord`, the list-matching helpers and `paint` lived in `src/cli/`. Rather than have `src/report/` reach into `src/cli/`, or copy them, Task 1 moves them into the library first, with no behaviour change and no re-export shims: every importer is updated.
  - **One cause, written once.** `escalateFor` takes the in-memory cause and derives both the escalation packet and the recorded `outcome.cause` from it, so the two cannot drift. A triage round's cause is written into that round's ref, because on resume it cannot be worked out again from the log. A round recorded before this slice has none, and none is invented.
  - **One reader of the run folders.** `readRunRecords` returns the records that read back and the damaged ones set aside; `allRuns` (which `status` uses, and which must keep stopping on damage) is re-expressed over it rather than left as a second directory walk. Which file is damaged is found by re-reading `case.json`, not by adding a field to `CorruptCaseFile`.
  - **`--json` is refused by `delivery report` for now** (exit 2, one sentence), rather than printing text where a script expects data or publishing a document shape before Slice 5 makes the stability promise. The `ReportDocument` built here holds only what this slice renders; `states`, `decisions`, `escalation`, `usage`, `repairs`, entry times, `--write`, `--schema` and `--watch` belong to later slices. For the same reason nothing is added to `src/index.ts` in this slice: making the pipeline and its schemas available to code that imports the package is a Slice 5 acceptance criterion, and exporting `delivery.report/1` now would publish a shape the next four slices still change.
  - **Routes that work, checked against the code.** A list task whose run has ended is only run again when its wording changes, so the advice for it is to reword or remove it and then `delivery run`. Two kinds of stop are not about the wording (a usage limit; an agent that could not be started): for those the route is to wait or sign in, then `delivery run --task "<the task, exactly as it is written>"`, which starts a fresh run that becomes the task's current answer, then `delivery run` for the rest. That is never "simply run again": a bare `delivery run` on an unchanged list would only retell the old outcome. `--task` matches a list entry written as a sentence; the ceiling is marked with a `ponytail:` comment.
  - **`delivery resume <id>` is advised only where it works.** It reads one task's record, so it is advised for an unfinished task of a list worked one at a time. An unfinished run of several tasks is advised `delivery run`, which is what picks such a run up. This narrows the slice's "a run that did not finish is advised `delivery resume` with its id" to the case where that command exists.
  - **A fifth section, "Not finished".** The slice names four sections; a task that is still working, held or waiting in a run of several is none of them, and the slice also requires that a run still going is reported as such. Those tasks are told under "Not finished", present only when it has tasks.
  - **"Stopped, for your engineers" also holds stops with no recorded cause** (runs made before this slice), with the reason the run recorded and no "To act" list.
  - **Identifiers are data, not sentences.** Run ids, branch names (`surface/<id>`) and file paths appear outside quotation marks so they can be copied. The vocabulary test removes quoted spans, run ids and branch names before scanning; every other word is the report's own and is scanned.
  - **The headline claims a way of landing only when every delivered task landed that way** ("completed and merged"); otherwise it says "completed" and each task's own line says where its work went.
  - **Times are printed from the record's own digits** ("1 Oct 02:19 UTC"), never through `Date` formatting or a locale, and durations only between two recorded instants.
  - **Tests:** `deriveReport` is tested on hand-built snapshots (the spec allows it) made by one fixtures module with the production types; the readers are tested on records written by the production writer; the command is tested on those and on two real runs through the scripted agent. Recording is tested through the production driver in `src/surface.test.ts`.
  - **One commit for both recorded facts** (Task 2): `cause` and `limit` are the same change to the same two files for the same reason, and splitting the verified diff by hand would risk it.

## Scaffolding Impact

- **Reactive:**
  - `docs/single-surface-control-flow.md`, the case-file sketch: the `outcome` line and the `terminus` entry describe shapes that gain `cause?` and `limit?` → Task 2.
  - `src/cli/output.ts` no longer holds `paint` and `Tone`; `src/cli/runs.ts`, `src/cli/queue.ts` and `src/cli/settings.ts` no longer hold the helpers that moved. Every importer, and the one doc comment that names `src/cli/run-location.ts`, is updated → Task 1.
- **Proactive:**
  - `README.md`: a new section, "Come back to your task list", before "See what happened to a run" → Task 7.
  - `docs/getting-started.md`, "4. Read what happened, later": a pointer to `delivery report` → Task 7.
  - `delivery --help` and `delivery report --help` (`src/cli/program.ts`) → Task 7.
  - `.changeset/come-back-to-your-task-list.md` (every user-visible change gets a changeset here) → Task 7.
- **Inherited (Operational note):** "A reporting demo built on the scripted agent sits with the existing demos" → `demos/observability-slice-1-report.ts` and the `demo:report-slice-1` script in `package.json`, Task 8, named in the README section by Task 8. "No set-up change and no configuration key" → nothing in `init`, `validate` or the config schema is touched.
- Checked and unchanged: the global `--json` help text in `src/cli/program.ts` ("one JSON document from status and validate" stays true); README "See what happened to a run" and "See every run" (`status` is untouched); `docs/project-configuration.md`, `docs/shared-environment.md` and `docs/testing-your-pipeline.md` (they describe `run` and `status` output, which does not change); `docs/multi-surface-control-flow.md` (the run file gains nothing); `src/index.ts` (the public exports are Slice 5's); `CONTRIBUTING.md`; `vendor/` (never edited). No `CLAUDE.md` or `AGENTS.md` in this repo.

---

### Task 1: Tidy first: put what a report reads in the library ✅ DONE (deliver-slice)

No behaviour changes in this task. It moves code so that `src/report/` (Tasks 3 to 6) never imports from `src/cli/`. There is no new test: the existing tests of the moved code are the check, before and after.

**Files:**
- Move: `src/cli/run-location.ts` → `src/run-location.ts`; `src/cli/run-location.test.ts` → `src/run-location.test.ts`
- Move: `src/cli/supervised-view.ts` → `src/supervised-view.ts`; `src/cli/supervised-view.test.ts` → `src/supervised-view.test.ts`
- Create: `src/run-records.ts` (`RunRecord`, `startedInstant`, `newestFirstBy`, `newestFirst`, moved from `src/cli/runs.ts`)
- Create: `src/task-list.ts` (`QueuePosition`, `findQueueRun`, `stillToTake`, `queuePositionOf` from `src/cli/queue.ts`; `taskIntent` from `src/cli/settings.ts`)
- Create: `src/paint.ts` (`Tone`, `paint`, moved from `src/cli/output.ts`)
- Modify: `src/cli/runs.ts`, `src/cli/queue.ts`, `src/cli/settings.ts`, `src/cli/output.ts`, `src/cli/drive.ts`, `src/cli/preview-command.ts`, `src/cli/run-command.ts`, `src/cli/resume-command.ts`, `src/cli/status-command.ts`, `src/cli/repo-lock.ts`, `src/cli/outcome.ts`, `src/cli/report.ts`, `src/cli/command-fixtures.ts`
- Modify (imports only): `src/cli/queue.test.ts`, `src/cli/runs.test.ts`, `src/cli/settings.test.ts`, `src/cli/run-command.test.ts`, `src/cli/repo-lock.test.ts`, `src/cli/status-command.test.ts`, `src/cli/output.test.ts`, `tests/delivery-command.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (`src/run-records.ts`): `interface RunRecord { runId: string; repoPath: string; dir: string; caseFile: CaseFile }`; `startedInstant(runId: string): string | null`; `newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[]`; `newestFirst(records: RunRecord[]): RunRecord[]`.
- Produces (`src/task-list.ts`): `interface QueuePosition { task: number; of: number }`; `taskIntent(taskDef: TaskDef): string`; `findQueueRun(records: RunRecord[], taskDef: TaskDef): RunRecord | undefined`; `stillToTake(records: RunRecord[], taskDef: TaskDef, claimed?: readonly TaskDef[]): boolean`; `queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined`.
- Produces (`src/paint.ts`): `type Tone = "done" | "attention" | "stopped" | "quiet"`; `paint(colour: boolean, tone: Tone, text: string): string`.
- Produces (new paths, every export unchanged): `src/run-location.ts`, from which later tasks use `runsRoot(repoPath: string): string`, `supervisedRoot(repoPath: string): string` and `supervisedPlace(repoPath: string, runId: string): string`; and `src/supervised-view.ts`, from which Task 5 uses `supervisedView(runFile, records, list, live)` and `claimedBy(runFile)`.

- [ ] **Step 1: Run the tests of the code about to move, to see them pass before anything changes**

Run: `npx vitest run src/cli/run-location.test.ts src/cli/supervised-view.test.ts src/cli/queue.test.ts src/cli/runs.test.ts src/cli/settings.test.ts src/cli/output.test.ts`
Expected: PASS (6 files).

- [ ] **Step 2: Move the two modules and their tests**

```bash
git mv src/cli/run-location.ts src/run-location.ts
git mv src/cli/run-location.test.ts src/run-location.test.ts
git mv src/cli/supervised-view.ts src/supervised-view.ts
git mv src/cli/supervised-view.test.ts src/supervised-view.test.ts
```

- [ ] **Step 3: Create `src/run-records.ts`**

```ts
import type { CaseFile } from "./schema.js";

/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
export interface RunRecord {
  runId: string;
  repoPath: string;
  dir: string;
  caseFile: CaseFile;
}

/**
 * The UTC instant a run started, which its id already carries
 * (`src/run-location.ts`), as a timestamp a script can parse. `null` for an
 * id that carries no stamp, rather than a made-up time.
 */
export function startedInstant(runId: string): string | null {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/**
 * Newest first, by the second each item's run id carries rather than by when
 * its record was last written: a list is a history, so resuming an old run
 * today does not make it the newest. A run id with no stamp sorts last, and
 * the sort is stable, so runs that started in the same second keep the order
 * they came in.
 */
export function newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[] {
  const startedOf = (item: T): string => startedInstant(runIdOf(item)) ?? "";
  return [...items].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
}

/** Newest first, by the second each run id carries. See `newestFirstBy`. */
export function newestFirst(records: RunRecord[]): RunRecord[] {
  return newestFirstBy(records, (record) => record.runId);
}
```

- [ ] **Step 4: Create `src/task-list.ts`**

```ts
import { isDeepStrictEqual } from "node:util";
import { newestFirst, type RunRecord } from "./run-records.js";
import type { TaskDef } from "./schema.js";

/** Where a task sits in the list as it is written now, counted from one, which is how "Task N of M" reads. */
export interface QueuePosition {
  task: number;
  of: number;
}

/** The task's own words, for the run's id and the line that announces it. A task is opaque to the harness, so one shaped another way still gets a run. */
export function taskIntent(taskDef: TaskDef): string {
  return typeof taskDef.intent === "string" && taskDef.intent.trim() !== "" ? taskDef.intent.trim() : "run";
}

/**
 * The run that answers for a task, or none yet. Identity is what the task says:
 * a run's record pins the task it was started with, so comparing the two is
 * enough, and nothing about the queue has to be stored. Position is deliberately
 * not identity — a checked-in list is inserted into, reordered and trimmed, and a
 * remembered index would silently skip a new entry or repeat an old one.
 *
 * Several runs can answer for one task: someone ran the same words ad hoc, or
 * asked for a fresh start. The most recently started one is the project's
 * current answer, as it is everywhere else the harness picks "the latest".
 */
export function findQueueRun(records: RunRecord[], taskDef: TaskDef): RunRecord | undefined {
  const [answering] = newestFirst(records.filter((record) => isDeepStrictEqual(record.caseFile.header.taskDef, taskDef)));
  return answering;
}

/** Whether a task is done with: only a delivered run is. One that escalated or was stopped still needs the owner, so the list waits on it. */
const isClosed = (record: RunRecord | undefined): boolean => record?.caseFile.outcome?.kind === "closed";

/**
 * Whether a list task is still for a run to take: its run has not been
 * delivered, and no slot has already taken it in this run. The one rule
 * `delivery run` fills each slot by, and `delivery status` counts queued tasks by.
 */
export function stillToTake(records: RunRecord[], taskDef: TaskDef, claimed: readonly TaskDef[] = []): boolean {
  return !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef));
}

/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}
```

- [ ] **Step 5: Point every importer at the new homes, and delete the moved code from the old ones**

Make exactly these edits (lines starting `-` are removed, lines starting `+` are added; the `rename` entries are the files Step 2 moved, shown with the import lines to change inside them). No re-export is left behind in `src/cli/`.

```diff
diff --git a/src/cli/command-fixtures.ts b/src/cli/command-fixtures.ts
--- a/src/cli/command-fixtures.ts
+++ b/src/cli/command-fixtures.ts
@@ -17,5 +17,5 @@ import type { EscalationPacket } from "../triage-role-config.js";
 import type { ExitOnInterrupt } from "./context.js";
 import { runCli } from "./program.js";
-import { prepareRunDir, runIdFor, runPlace, runsRoot, supervisedPlace } from "./run-location.js";
+import { prepareRunDir, runIdFor, runPlace, runsRoot, supervisedPlace } from "../run-location.js";
 import { DEFAULT_CLOSER } from "./settings.js";
 
diff --git a/src/cli/drive.ts b/src/cli/drive.ts
--- a/src/cli/drive.ts
+++ b/src/cli/drive.ts
@@ -13,7 +13,8 @@ import { type ExitCode } from "./failures.js";
 import { reportOutcome } from "./outcome.js";
 import { pickingUp } from "./output.js";
-import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
-import type { RunRecord } from "./runs.js";
-import { checkCustomModules, DEFAULT_CLOSER, taskIntent, type ProjectSettings } from "./settings.js";
+import { prepareRunDir, runIdFor, runPlace } from "../run-location.js";
+import type { RunRecord } from "../run-records.js";
+import { taskIntent } from "../task-list.js";
+import { checkCustomModules, DEFAULT_CLOSER, type ProjectSettings } from "./settings.js";
 
 /** A run about to exist: what it is being asked to do, and everything its project asks of every run. */
diff --git a/src/cli/preview-command.ts b/src/cli/preview-command.ts
--- a/src/cli/preview-command.ts
+++ b/src/cli/preview-command.ts
@@ -9,5 +9,6 @@ import { EXIT, Refusal, type ExitCode } from "./failures.js";
 import { EVERY_TASK_DONE, nextQueueTask, queueTasks, taskHeading } from "./queue.js";
 import { allRuns } from "./runs.js";
-import { NO_TASK, taskIntent } from "./settings.js";
+import { taskIntent } from "../task-list.js";
+import { NO_TASK } from "./settings.js";
 import { locateConfig, readProject, type ValidateOptions } from "./validate-command.js";
 
diff --git a/src/cli/queue.test.ts b/src/cli/queue.test.ts
--- a/src/cli/queue.test.ts
+++ b/src/cli/queue.test.ts
@@ -8,6 +8,7 @@ import type { GateRef, TaskDef } from "../schema.js";
 import { writeRunRecord } from "./command-fixtures.js";
 import { allRuns } from "./runs.js";
-import { runsRoot } from "./run-location.js";
-import { environmentGaveUp, findQueueRun, listExitCode, listStandings, liveRunFound, nextQueueTask, queuePositionOf, queueTasks, runPickedUp, runShape, taskEnded } from "./queue.js";
+import { runsRoot } from "../run-location.js";
+import { findQueueRun, queuePositionOf } from "../task-list.js";
+import { environmentGaveUp, listExitCode, listStandings, liveRunFound, nextQueueTask, queueTasks, runPickedUp, runShape, taskEnded } from "./queue.js";
 import { EXIT } from "./failures.js";
 
diff --git a/src/cli/queue.ts b/src/cli/queue.ts
--- a/src/cli/queue.ts
+++ b/src/cli/queue.ts
@@ -1,3 +1,2 @@
-import { isDeepStrictEqual } from "node:util";
 import type { SessionEnvironment } from "../agent-invoke.js";
 import type { RunHeader, SlotOutcome, TaskDef, UsageLimit } from "../schema.js";
@@ -13,14 +12,10 @@ import { dispatchRepair, resumeRun, startRun } from "./drive.js";
 import { EXIT, Refusal, type ExitCode } from "./failures.js";
 import { reportOutcome } from "./outcome.js";
-import { prepareRunDir, runIdFor, supervisedPlace, supervisedRunId } from "./run-location.js";
-import { allRuns, describeRun, newestFirst, readRun, startedAt, type RunRecord, unfinishedSupervisedRun } from "./runs.js";
+import { prepareRunDir, runIdFor, supervisedPlace, supervisedRunId } from "../run-location.js";
+import type { RunRecord } from "../run-records.js";
+import { findQueueRun, stillToTake, taskIntent, type QueuePosition } from "../task-list.js";
+import { allRuns, describeRun, readRun, startedAt, unfinishedSupervisedRun } from "./runs.js";
 import { repoLocked, takeRepoLock } from "./repo-lock.js";
-import { taskIntent, type ProjectSettings } from "./settings.js";
-
-/** Where a task sits in the list as it is written now, counted from one, which is how "Task N of M" reads. */
-export interface QueuePosition {
-  task: number;
-  of: number;
-}
+import type { ProjectSettings } from "./settings.js";
 
 /** Everything this project's list asks for, in the order it was written. */
@@ -29,32 +24,4 @@ export function queueTasks(config: DeliveryConfig): TaskDef[] {
 }
 
-/**
- * The run that answers for a task, or none yet. Identity is what the task says:
- * a run's record pins the task it was started with, so comparing the two is
- * enough, and nothing about the queue has to be stored. Position is deliberately
- * not identity — a checked-in list is inserted into, reordered and trimmed, and a
- * remembered index would silently skip a new entry or repeat an old one.
- *
- * Several runs can answer for one task: someone ran the same words ad hoc, or
- * asked for a fresh start. The most recently started one is the project's
- * current answer, as it is everywhere else the harness picks "the latest".
- */
-export function findQueueRun(records: RunRecord[], taskDef: TaskDef): RunRecord | undefined {
-  const [answering] = newestFirst(records.filter((record) => isDeepStrictEqual(record.caseFile.header.taskDef, taskDef)));
-  return answering;
-}
-
-/** Whether a task is done with: only a delivered run is. One that escalated or was stopped still needs the owner, so the list waits on it. */
-const isClosed = (record: RunRecord | undefined): boolean => record?.caseFile.outcome?.kind === "closed";
-
-/**
- * Whether a list task is still for a run to take: its run has not been
- * delivered, and no slot has already taken it in this run. The one rule
- * `delivery run` fills each slot by, and `delivery status` counts queued tasks by.
- */
-export function stillToTake(records: RunRecord[], taskDef: TaskDef, claimed: readonly TaskDef[] = []): boolean {
-  return !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef));
-}
-
 /**
  * The task `delivery run` would act on next: the first one on the list whose
@@ -69,10 +36,4 @@ export function nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: r
 }
 
-/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
-export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
-  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
-  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
-}
-
 /** "Task N of M", as every line naming a task's place in the list starts. */
 const positionPhrase = (position: QueuePosition): string => `Task ${position.task} of ${position.of}`;
diff --git a/src/cli/repo-lock.test.ts b/src/cli/repo-lock.test.ts
--- a/src/cli/repo-lock.test.ts
+++ b/src/cli/repo-lock.test.ts
@@ -5,5 +5,5 @@ import { git } from "../../tests/helpers.js";
 import { initTempRepo } from "../temp-repo.js";
 import { repoLocked, takeRepoLock } from "./repo-lock.js";
-import { supervisorLockPath } from "./run-location.js";
+import { supervisorLockPath } from "../run-location.js";
 
 const repo = (prefix: string) => initTempRepo(prefix, { "package.json": "{}" });
diff --git a/src/cli/repo-lock.ts b/src/cli/repo-lock.ts
--- a/src/cli/repo-lock.ts
+++ b/src/cli/repo-lock.ts
@@ -1,4 +1,4 @@
 import lockfile from "proper-lockfile";
-import { prepareDeliveryDir, supervisorLockPath } from "./run-location.js";
+import { prepareDeliveryDir, supervisorLockPath } from "../run-location.js";
 
 /**
diff --git a/src/cli/resume-command.ts b/src/cli/resume-command.ts
--- a/src/cli/resume-command.ts
+++ b/src/cli/resume-command.ts
@@ -5,5 +5,6 @@ import { EXIT, Refusal, type ExitCode } from "./failures.js";
 import { findRepository } from "./project.js";
 import { refuseIfRunGoing } from "./queue.js";
-import { alreadyFinished, chooseRun, readRun, unfinishedRuns, type RunRecord } from "./runs.js";
+import type { RunRecord } from "../run-records.js";
+import { alreadyFinished, chooseRun, readRun, unfinishedRuns } from "./runs.js";
 
 /** What `delivery resume` was given on the command line, besides the run id. */
diff --git a/src/cli/run-command.test.ts b/src/cli/run-command.test.ts
--- a/src/cli/run-command.test.ts
+++ b/src/cli/run-command.test.ts
@@ -19,5 +19,5 @@ import { NO_TASK } from "./run-command.js";
 import { EVERY_TASK_DONE, liveRunFound, taskEnded, runPickedUp, STOPPED_PART_WAY } from "./queue.js";
 import { repoLocked, takeRepoLock } from "./repo-lock.js";
-import { supervisedPlace, supervisorLockPath } from "./run-location.js";
+import { supervisedPlace, supervisorLockPath } from "../run-location.js";
 import type { RunEventRecord, SurfaceStepRecord } from "./report.js";
 
diff --git a/src/cli/run-command.ts b/src/cli/run-command.ts
--- a/src/cli/run-command.ts
+++ b/src/cli/run-command.ts
@@ -15,7 +15,7 @@ import {
   resolveProject,
   resolveSettings,
-  taskIntent,
   type RunFlags,
 } from "./settings.js";
+import { taskIntent } from "../task-list.js";
 
 export { NO_TASK } from "./settings.js";
diff --git a/src/cli/runs.test.ts b/src/cli/runs.test.ts
--- a/src/cli/runs.test.ts
+++ b/src/cli/runs.test.ts
@@ -9,6 +9,7 @@ import { CorruptCaseFile, RunFileNotFound } from "../errors.js";
 import { setRunOutcome } from "../run-file.js";
 import type { GateRef } from "../schema.js";
-import { runsRoot, supervisedRoot } from "./run-location.js";
-import { allRuns, allSupervisedRuns, chooseRun, describeRun, NOTHING_CHOSEN, NOTHING_HERE, NOTHING_TO_RESUME, readRun, readableUtc, readSupervisedRun, startedAt, startedInstant, touchedAt, unfinishedRuns, unfinishedSupervisedRun } from "./runs.js";
+import { runsRoot, supervisedRoot } from "../run-location.js";
+import { startedInstant } from "../run-records.js";
+import { allRuns, allSupervisedRuns, chooseRun, describeRun, NOTHING_CHOSEN, NOTHING_HERE, NOTHING_TO_RESUME, readRun, readableUtc, readSupervisedRun, startedAt, touchedAt, unfinishedRuns, unfinishedSupervisedRun } from "./runs.js";
 import { writeSupervisedRun } from "./command-fixtures.js";
 import { Refusal } from "./failures.js";
diff --git a/src/cli/runs.ts b/src/cli/runs.ts
--- a/src/cli/runs.ts
+++ b/src/cli/runs.ts
@@ -5,18 +5,11 @@ import { load } from "../case-file.js";
 import { FileNotFound, RunFileNotFound } from "../errors.js";
 import { loadRunFile } from "../run-file.js";
-import type { CaseFile, RunFile } from "../schema.js";
-import { runsRoot, supervisedRoot, supervisedPlace } from "./run-location.js";
-import { taskIntent } from "./settings.js";
+import type { RunFile } from "../schema.js";
+import { runsRoot, supervisedRoot, supervisedPlace } from "../run-location.js";
+import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
+import { taskIntent } from "../task-list.js";
 import type { CommandContext } from "./context.js";
 import { EXIT, Refusal } from "./failures.js";
 
-/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
-export interface RunRecord {
-  runId: string;
-  repoPath: string;
-  dir: string;
-  caseFile: CaseFile;
-}
-
 /** One run by its id, finished or not. An id that names nothing raises `FileNotFound`, which the command already renders plainly. */
 export async function readRun(repoPath: string, runId: string): Promise<RunRecord> {
@@ -136,15 +129,4 @@ export async function unfinishedSupervisedRun(repoPath: string): Promise<Supervi
 }
 
-/**
- * The UTC instant a run started, which its id already carries
- * (`src/cli/run-location.ts`), as a timestamp a script can parse. `null` for an
- * id that carries no stamp, rather than a made-up time.
- */
-export function startedInstant(runId: string): string | null {
-  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
-  if (stamp === undefined) return null;
-  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
-}
-
 /** When a run started, as a person reads it. */
 export function startedAt(runId: string): string {
@@ -153,21 +135,4 @@ export function startedAt(runId: string): string {
 }
 
-/**
- * Newest first, by the second each item's run id carries rather than by when
- * its record was last written: a list is a history, so resuming an old run
- * today does not make it the newest. A run id with no stamp sorts last, and
- * the sort is stable, so runs that started in the same second keep the order
- * they came in.
- */
-export function newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[] {
-  const startedOf = (item: T): string => startedInstant(runIdOf(item)) ?? "";
-  return [...items].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
-}
-
-/** Newest first, by the second each run id carries. See `newestFirstBy`. */
-export function newestFirst(records: RunRecord[]): RunRecord[] {
-  return newestFirstBy(records, (record) => record.runId);
-}
-
 /** An ISO 8601 timestamp as a person reads it: the date, the minute, and the zone it is in. */
 export function readableUtc(iso: string): string {
diff --git a/src/cli/settings.test.ts b/src/cli/settings.test.ts
--- a/src/cli/settings.test.ts
+++ b/src/cli/settings.test.ts
@@ -19,7 +19,7 @@ import {
   NO_TASK_FILE,
   resolveSettings,
-  taskIntent,
   type RunFlags,
 } from "./settings.js";
+import { taskIntent } from "../task-list.js";
 
 const TASK = "add a function that says goodbye to a name, with a test";
diff --git a/src/cli/settings.ts b/src/cli/settings.ts
--- a/src/cli/settings.ts
+++ b/src/cli/settings.ts
@@ -60,9 +60,4 @@ export interface Settings extends ProjectSettings {
 }
 
-/** The task's own words, for the run's id and the line that announces it. A task is opaque to the harness, so one shaped another way still gets a run. */
-export function taskIntent(taskDef: TaskDef): string {
-  return typeof taskDef.intent === "string" && taskDef.intent.trim() !== "" ? taskDef.intent.trim() : "run";
-}
-
 /**
  * The task this invocation named, from the flag, the file it points at or the
diff --git a/src/cli/status-command.test.ts b/src/cli/status-command.test.ts
--- a/src/cli/status-command.test.ts
+++ b/src/cli/status-command.test.ts
@@ -10,5 +10,5 @@ import type { CommandContext } from "./context.js";
 import { ESCALATION, delivery, PACKAGE, writeRunRecord, writeSupervisedRun } from "./command-fixtures.js";
 import { EXIT } from "./failures.js";
-import { runPlace, runsRoot } from "./run-location.js";
+import { runPlace, runsRoot } from "../run-location.js";
 import { NOTHING_HERE, readRun } from "./runs.js";
 import { ALL_AND_ONE, statusDocument, statusReport, type RunStatusDocument } from "./status-command.js";
diff --git a/src/cli/status-command.ts b/src/cli/status-command.ts
--- a/src/cli/status-command.ts
+++ b/src/cli/status-command.ts
@@ -14,10 +14,11 @@ import { findRepository } from "./project.js";
 import { packetOf, summariseOutcome } from "./outcome.js";
 import { BREAKER_PHRASES, nextStepPhrase, paint } from "./output.js";
-import { queuePositionOf, queueTasks, shapeOf, STOPPED_PART_WAY, type QueuePosition } from "./queue.js";
+import { queueTasks, shapeOf, STOPPED_PART_WAY } from "./queue.js";
 import { repoLocked } from "./repo-lock.js";
-import { runPlace } from "./run-location.js";
-import { allRuns, allSupervisedRuns, describeRun, newestFirstBy, NOTHING_HERE, readableUtc, readRun, readSupervisedRun, startedAt, startedInstant, touchedAt, type RunRecord, type SupervisedRecord } from "./runs.js";
-import { claimedBy, overallOutcome, STANDINGS, standingCounts, supervisedView, type SupervisedView, type TaskStanding, type ViewTask } from "./supervised-view.js";
-import { taskIntent } from "./settings.js";
+import { runPlace } from "../run-location.js";
+import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
+import { queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
+import { allRuns, allSupervisedRuns, describeRun, NOTHING_HERE, readableUtc, readRun, readSupervisedRun, startedAt, touchedAt, type SupervisedRecord } from "./runs.js";
+import { claimedBy, overallOutcome, STANDINGS, standingCounts, supervisedView, type SupervisedView, type TaskStanding, type ViewTask } from "../supervised-view.js";
 
 /**
diff --git a/src/cli/run-location.test.ts b/src/run-location.test.ts
rename from src/cli/run-location.test.ts
rename to src/run-location.test.ts
--- a/src/cli/run-location.test.ts
+++ b/src/run-location.test.ts
@@ -4,8 +4,8 @@ import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
 import { homedir } from "node:os";
 import { join } from "node:path";
-import { cleanGitEnv } from "../git-env.js";
-import { initTempRepo } from "../temp-repo.js";
+import { cleanGitEnv } from "./git-env.js";
+import { initTempRepo } from "./temp-repo.js";
 import { prepareRunDir, repoKey, runIdFor, runPlace, runsRoot, stateHome, supervisedPlace, supervisedRunId } from "./run-location.js";
-import { startedInstant } from "./runs.js";
+import { startedInstant } from "./run-records.js";
 
 const AT = new Date("2026-09-14T21:03:09.123Z");
diff --git a/src/cli/run-location.ts b/src/run-location.ts
rename from src/cli/run-location.ts
rename to src/run-location.ts
--- a/src/cli/run-location.ts
+++ b/src/run-location.ts
@@ -2,5 +2,5 @@ import { mkdir, writeFile } from "node:fs/promises";
 import { homedir } from "node:os";
 import { dirname, isAbsolute, join } from "node:path";
-import type { SurfaceLocation } from "../ports.js";
+import type { SurfaceLocation } from "./ports.js";
 
 /** How many words of the task name a run. Enough to tell runs apart at a glance. */
diff --git a/src/cli/supervised-view.test.ts b/src/supervised-view.test.ts
rename from src/cli/supervised-view.test.ts
rename to src/supervised-view.test.ts
--- a/src/cli/supervised-view.test.ts
+++ b/src/supervised-view.test.ts
@@ -3,9 +3,9 @@ import { mkdtemp } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
-import { setRunOutcome } from "../run-file.js";
-import type { CaseFileOutcome, RunEntry, RunFile, RunOutcome, SlotOutcome } from "../schema.js";
-import { ESCALATION, writeRunRecord, writeSupervisedRun } from "./command-fixtures.js";
-import { queueTasks } from "./queue.js";
-import { allRuns, readSupervisedRun } from "./runs.js";
+import { setRunOutcome } from "./run-file.js";
+import type { CaseFileOutcome, RunEntry, RunFile, RunOutcome, SlotOutcome } from "./schema.js";
+import { ESCALATION, writeRunRecord, writeSupervisedRun } from "./cli/command-fixtures.js";
+import { queueTasks } from "./cli/queue.js";
+import { allRuns, readSupervisedRun } from "./cli/runs.js";
 import { claimedBy, overallOutcome, standingCounts, supervisedView, type SupervisedView } from "./supervised-view.js";
 
diff --git a/src/cli/supervised-view.ts b/src/supervised-view.ts
rename from src/cli/supervised-view.ts
rename to src/supervised-view.ts
--- a/src/cli/supervised-view.ts
+++ b/src/supervised-view.ts
@@ -1,6 +1,6 @@
-import type { BreakerState, RunFile, SlotOutcome, TaskDef } from "../schema.js";
-import { breakerOf, openTrip, tripsOf, type Trip } from "../breaker.js";
-import { queuePositionOf, stillToTake, type QueuePosition } from "./queue.js";
-import type { RunRecord } from "./runs.js";
+import type { BreakerState, RunFile, SlotOutcome, TaskDef } from "./schema.js";
+import { breakerOf, openTrip, tripsOf, type Trip } from "./breaker.js";
+import type { RunRecord } from "./run-records.js";
+import { queuePositionOf, stillToTake, type QueuePosition } from "./task-list.js";
 
 /** Where one task of a run of several at once has got to: how its own run ended, that it hasn't yet, or that it is still waiting to start. */
diff --git a/tests/delivery-command.test.ts b/tests/delivery-command.test.ts
--- a/tests/delivery-command.test.ts
+++ b/tests/delivery-command.test.ts
@@ -8,5 +8,5 @@ import { EXIT } from "../src/cli/failures.js";
 import { loadRunFile } from "../src/run-file.js";
 import { repoLocked } from "../src/cli/repo-lock.js";
-import { supervisedRoot } from "../src/cli/run-location.js";
+import { supervisedRoot } from "../src/run-location.js";
 import { STOPPED_PART_WAY } from "../src/cli/queue.js";
 import { writeMockScript } from "../src/mock-script.js";
```

- [ ] **Step 6: Check that nothing but the addresses changed**

Run: `npx tsc --noEmit && npx eslint src tests demos`
Expected: no output.

Run: `npx vitest run src/run-location.test.ts src/supervised-view.test.ts src/cli/queue.test.ts src/cli/runs.test.ts src/cli/settings.test.ts`
Expected: PASS (5 files, 158 tests).

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Move run location, the supervised view and list matching out of src/cli" -m "A report is a library function over the record, and the library must not import the command line. These helpers are what a report reads a record with, so they move to where the library can reach them; nothing about what they do changes."
```

- [ ] **Step 8: Create `src/paint.ts`**

```ts
import { styleText } from "node:util";

/** What a line means. Always also said in words: colour only decorates it. */
export type Tone = "done" | "attention" | "stopped" | "quiet";

const STYLE: Record<Tone, "green" | "yellow" | "red" | "dim"> = {
  done: "green",
  attention: "yellow",
  stopped: "red",
  quiet: "dim",
};

/**
 * `text` in its tone's colour, or unchanged when colour is off. Whether to
 * colour at all is the caller's decision (the command line's `useColour`), so
 * styleText is told not to make its own.
 */
export function paint(colour: boolean, tone: Tone, text: string): string {
  return colour ? styleText(STYLE[tone], text, { validateStream: false }) : text;
}
```

- [ ] **Step 9: Delete `paint` from `src/cli/output.ts` and point its importers at `src/paint.ts`**

`useColour` stays in `src/cli/output.ts`: whether to colour is the command line's decision.

```diff
diff --git a/src/cli/outcome.ts b/src/cli/outcome.ts
--- a/src/cli/outcome.ts
+++ b/src/cli/outcome.ts
@@ -6,5 +6,5 @@ import { EscalationPacket } from "../triage-role-config.js";
 import type { CommandContext } from "./context.js";
 import { EXIT, type ExitCode } from "./failures.js";
-import type { Tone } from "./output.js";
+import type { Tone } from "../paint.js";
 
 /** How a finished run is reported: a headline in plain language, the lines under it, and the exit code. */
diff --git a/src/cli/output.test.ts b/src/cli/output.test.ts
--- a/src/cli/output.test.ts
+++ b/src/cli/output.test.ts
@@ -4,5 +4,6 @@ import type { ResumeAction } from "../case-file.js";
 import type { CaseFile, GateRef, HistoryEntry } from "../schema.js";
 import { SurfaceState } from "../schema.js";
-import { paint, pickingUp, putRight, RESUME_PHRASES, STEP_PHRASES, useColour, BREAKER_PHRASES } from "./output.js";
+import { paint } from "../paint.js";
+import { pickingUp, putRight, RESUME_PHRASES, STEP_PHRASES, useColour, BREAKER_PHRASES } from "./output.js";
 
 const ESC = "[";
diff --git a/src/cli/output.ts b/src/cli/output.ts
--- a/src/cli/output.ts
+++ b/src/cli/output.ts
@@ -1,3 +1,2 @@
-import { styleText } from "node:util";
 import { logTail, resumeAction } from "../case-file.js";
 import type { ResumeAction } from "../case-file.js";
@@ -12,22 +11,4 @@ export function useColour({ flag, env, isTTY }: { flag: boolean; env: NodeJS.Pro
 }
 
-/** What a line means. Always also said in words: colour only decorates it. */
-export type Tone = "done" | "attention" | "stopped" | "quiet";
-
-const STYLE: Record<Tone, "green" | "yellow" | "red" | "dim"> = {
-  done: "green",
-  attention: "yellow",
-  stopped: "red",
-  quiet: "dim",
-};
-
-/**
- * `text` in its tone's colour, or unchanged when colour is off. The stream
- * check is ours (`useColour`), so styleText is told not to make its own.
- */
-export function paint(colour: boolean, tone: Tone, text: string): string {
-  return colour ? styleText(STYLE[tone], text, { validateStream: false }) : text;
-}
-
 /**
  * Every state as a person reads it. The state set is closed, so the table is
diff --git a/src/cli/report.ts b/src/cli/report.ts
--- a/src/cli/report.ts
+++ b/src/cli/report.ts
@@ -2,5 +2,6 @@ import type { BreakerState, SurfaceState } from "../schema.js";
 import type { AdvanceResult } from "../surface.js";
 import type { OutcomeSummary } from "./outcome.js";
-import { ENVIRONMENT_BROKE, FIXED_RESUMING, paint, putRight, repairingLine, STEP_PHRASES } from "./output.js";
+import { paint } from "../paint.js";
+import { ENVIRONMENT_BROKE, FIXED_RESUMING, putRight, repairingLine, STEP_PHRASES } from "./output.js";
 
 /**
diff --git a/src/cli/status-command.ts b/src/cli/status-command.ts
--- a/src/cli/status-command.ts
+++ b/src/cli/status-command.ts
@@ -13,5 +13,6 @@ import { RunFileNotFound } from "../errors.js";
 import { findRepository } from "./project.js";
 import { packetOf, summariseOutcome } from "./outcome.js";
-import { BREAKER_PHRASES, nextStepPhrase, paint } from "./output.js";
+import { paint } from "../paint.js";
+import { BREAKER_PHRASES, nextStepPhrase } from "./output.js";
 import { queueTasks, shapeOf, STOPPED_PART_WAY } from "./queue.js";
 import { repoLocked } from "./repo-lock.js";
```

- [ ] **Step 10: Check**

Run: `npx tsc --noEmit && npx eslint src`
Expected: no output.

Run: `npx vitest run src/cli/output.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 11: Commit**

```bash
git add -A src
git commit -m "Move paint out of src/cli" -m "The report's text renderer lives in the library and colours its headings by the same rule every other line uses. Moving the one function keeps a single rule for tone instead of a second copy."
```

---

### Task 2: Record why a task stopped, and which usage limit stopped a session ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (`UsageLimit` moves above `TerminusEntry`; `TerminusEntry.limit`; new `OutcomeCause`; `CaseFileOutcome.cause`)
- Modify: `src/surface.ts` (`escalate` and `abort` take a cause; new `outcomeCause`, `escalateFor`, `triageCause`; the triage round's ref carries the cause; `dispatchSession` records `limit`)
- Modify: `docs/single-surface-control-flow.md` (the case-file sketch)
- Test: `src/surface.test.ts`, `src/case-file.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (`src/schema.ts`):
  ```ts
  export const OutcomeCause = z.object({
    kind: z.enum(["authority", "repair_gave_up", "session_not_run", "budget", "triage_failure", "triage_escalated", "triage_abort", "provisioning"]),
    role: z.enum(["worker", "gate-maintenance"]).optional(),        // authority, session_not_run
    population: z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]).optional(), // budget
  });
  export type OutcomeCause = z.infer<typeof OutcomeCause>;
  // CaseFileOutcome gains:  cause: OutcomeCause.optional()
  // TerminusEntry gains:    limit: UsageLimit.optional()   // "rate" | "spend"
  ```
  Tasks 4 and 5 read `outcome.cause` and the last terminus entry's `limit`.

- [ ] **Step 1: Write the failing tests for the recorded cause**

In `src/surface.test.ts`, add `CaseFile` to the type import from `./schema.js`:

```ts
import type { BudgetPopulation, BudgetSet, CaseFile, GateRef, HistoryEntry, SurfaceState } from "./schema.js";
```

Then append this block at the end of the file. It uses helpers the file already defines (`provisioned`, `run`, `sessionAgent`, `gateRef`, `budgets`, `PASSING_TAP`, `FAILING_TAP` and the rest):

```ts
describe("why a task stopped, as its outcome records it", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Drive the task to its end over a repository whose check passes (or cannot run at all) before the agent touches it. */
  async function stoppedWith(ports: SurfacePorts, files: Record<string, string> = { "report.tap": PASSING_TAP }): Promise<CaseFile> {
    const location = await provisioned(dir, files, ports);
    await run(dir, location, ports);
    return load(dir);
  }

  const breaksTheCheck = sessionAgent((_role, ctx) => {
    writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
    return Promise.resolve({ status: "completed", rationale: "broke it" });
  });
  const stuck = (): Promise<Terminus> => Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "stuck" });
  const agentPacket = {
    decision: "Decide whether to grant access.", evidence: "no access", dead_ends: "none", why_now: "a retry would repeat it", references: ["worker-1-0"],
  };

  it("records an authority stop and whose session it was", async () => {
    const ports = portsWith(scriptedAgent([{ status: "escalate", category: "authority", rationale: "needs a sign-off" }]));

    expect((await stoppedWith(ports)).outcome?.cause).toEqual({ kind: "authority", role: "worker" });
  });

  it("records a session that never started, for a worker and for a repair", async () => {
    const neverStarted = scriptedAgent([{ status: "incomplete", notRun: true, rationale: "could not start" }]);

    expect((await stoppedWith(portsWith(neverStarted))).outcome?.cause).toEqual({ kind: "session_not_run", role: "worker" });

    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    // No report.tap: the check cannot run, so the first session is a repair.
    expect((await stoppedWith(portsWith(neverStarted), { "seed.txt": "hello\n" })).outcome?.cause).toEqual({
      kind: "session_not_run", role: "gate-maintenance",
    });
  });

  it("records which retries ran out", async () => {
    const neverEnds = portsWith(scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]));
    expect((await stoppedWith(neverEnds)).outcome?.cause).toEqual({ kind: "budget", population: "terminus" });

    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const neverRepairs = portsWith(scriptedAgent([{ status: "completed", rationale: "claims to have fixed it" }]));
    expect((await stoppedWith(neverRepairs, { "seed.txt": "hello\n" })).outcome?.cause).toEqual({ kind: "budget", population: "gateMaintenance" });

    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    expect((await stoppedWith(portsWithTriage(breaksTheCheck))).outcome?.cause).toEqual({ kind: "budget", population: "correction" });
  });

  it("records a repair that gave up", async () => {
    const ports = portsWith(scriptedAgent([{ status: "escalate", category: "exhaustion", rationale: "cannot repair this" }]));

    expect((await stoppedWith(ports, { "seed.txt": "hello\n" })).outcome?.cause).toEqual({ kind: "repair_gave_up" });
  });

  it("records a triage agent's own escalation apart from a triage that failed", async () => {
    const asks = sessionAgent(stuck, () => Promise.resolve({ status: "escalate", rationale: "no retry will help", payload: agentPacket }));
    const escalated = await stoppedWith({ agent: asks, triage: createAgentTriage(asks), closer: noopCloser });
    expect(escalated.outcome?.cause).toEqual({ kind: "triage_escalated" });
    expect(await readRef(dir, "triage-0")).toMatchObject({ cause: { kind: "triage_escalated" } });

    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const fails = sessionAgent(stuck, () => Promise.resolve({ status: "incomplete", rationale: "triage said nothing usable" }));
    const failed = await stoppedWith({ agent: fails, triage: createAgentTriage(fails), closer: noopCloser });
    expect(failed.outcome?.cause).toEqual({ kind: "triage_failure" });
  });

  it("records a triage abort and a provisioning abort", async () => {
    const aborting: SurfacePorts["triage"] = { triage: () => Promise.resolve({ verdict: "abort", rationale: "the task is unsound" }) };
    expect((await stoppedWith({ agent: breaksTheCheck, triage: aborting, closer: noopCloser })).outcome?.cause).toEqual({ kind: "triage_abort" });

    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const blocker = join(await mkdtemp(join(tmpdir(), "surface-block-")), "file");
    await writeFile(blocker, "not a directory\n");
    await advance(dir, { repoPath: initTempRepo("surface-repo-", { "seed.txt": "hello\n" }), worktreePath: join(blocker, "wt") }, portsWith(unusedAgent()));
    expect((await load(dir)).outcome?.cause).toEqual({ kind: "provisioning" });
  });

  it("records no cause for a task that was delivered", async () => {
    const ports = portsWithTriage(scriptedAgent([{ status: "completed", rationale: "done" }]));

    const delivered = await stoppedWith(ports);

    expect(delivered.outcome?.kind).toBe("closed");
    expect(delivered.outcome).not.toHaveProperty("cause");
  });

  /** A log ending in a triage escalate whose outcome was never written: the crash window `escalateFromTail` resumes. */
  async function crashedAfterTriageEscalate(roundRef: Record<string, unknown>): Promise<void> {
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "escalate", category: "exhaustion", rationale: "stuck" });
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "no retry will help", artifact: agentPacket, ...roundRef });
    await appendEntry(dir, { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "escalate", rationale: "no retry will help", artifactRef: "triage-0" });
  }

  it("reads the cause back from the round's ref when the outcome is written on resume", async () => {
    await crashedAfterTriageEscalate({ cause: { kind: "budget", population: "correction" } });

    await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, portsWith(unusedAgent()));

    expect((await load(dir)).outcome?.cause).toEqual({ kind: "budget", population: "correction" });
  });

  it("invents no cause on resume for a round recorded before causes were", async () => {
    await crashedAfterTriageEscalate({});

    await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, portsWith(unusedAgent()));

    const { outcome } = await load(dir);
    expect(outcome).toMatchObject({ kind: "escalated", source: "triage" });
    expect(outcome).not.toHaveProperty("cause");
  });

  it("records on the session's own entry that a usage limit stopped it, and counts it as any other session that did not finish", async () => {
    const limited = portsWith(scriptedAgent([{ status: "incomplete", limit: "rate", rationale: "the AI service is limiting requests" }]));

    const { history, outcome } = await stoppedWith(limited);

    const sessions = history.filter((entry) => entry.t === "terminus");
    expect(sessions).toHaveLength(budgets.terminus.max);
    expect(sessions.every((entry) => entry.limit === "rate")).toBe(true);
    expect(outcome?.cause).toEqual({ kind: "budget", population: "terminus" });
  });
});
```

- [ ] **Step 2: Write the failing test for the recorded usage limit**

In `src/case-file.test.ts`, insert this block immediately before `describe("setbackOf", …)`. The second test passes before and after: it is the guard the spec asks for, that the new field changes neither the state nor the retries derived from the log.

```ts
describe("a recorded usage limit", () => {
  const maxima: BudgetSet = {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  };
  const limited: HistoryEntry = { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "incomplete", rationale: "stopped", limit: "spend" };
  const dispatch: HistoryEntry = { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" };

  it("survives a write and a read of the log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "case-file-"));
    await create(dir, { surfaceId: "s", taskDef: { intent: "x" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } }, maxima);
    await appendEntry(dir, dispatch);
    await appendEntry(dir, limited);

    expect((await load(dir)).history.at(-1)).toEqual(limited);
  });

  it("changes neither where the task is nor the retries it has used", () => {
    // Exactly what a session that did not finish derives without the fact recorded.
    expect(deriveStateFromEntry(limited)).toBe("INCOMPLETE_TERMINUS");
    expect(deriveBudgetsFromLog([dispatch, limited], maxima)).toEqual({ ...maxima, terminus: { used: 1, max: 5 } });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "why a task stopped"`
Expected: FAIL, 8 failed and 2 passed. The failures are `expected undefined to deeply equal { kind: … }` and the like. The two that pass are the guards: "records no cause for a task that was delivered" and "invents no cause on resume for a round recorded before causes were".

Run: `npx vitest run src/case-file.test.ts -t "a recorded usage limit"`
Expected: FAIL, 1 failed ("survives a write and a read of the log": the schema drops the unknown `limit` key) and 1 passed.

- [ ] **Step 4: Add the fields to the schema and write them where a task ends**

Make exactly these edits to `src/schema.ts` and `src/surface.ts`:

```diff
diff --git a/src/schema.ts b/src/schema.ts
--- a/src/schema.ts
+++ b/src/schema.ts
@@ -206,6 +206,10 @@ export const DispatchEntry = z.object({
 });
 export type DispatchEntry = z.infer<typeof DispatchEntry>;
 
+/** A usage limit that can stop an agent session: the API's request rate, or the account's spending cap. */
+export const UsageLimit = z.enum(["rate", "spend"]);
+export type UsageLimit = z.infer<typeof UsageLimit>;
+
 export const TerminusEntry = z.object({
   t: z.literal("terminus"),
   attempt: z.number().int().positive(),
@@ -219,6 +223,9 @@ export const TerminusEntry = z.object({
   // from the log on resume. Optional, so every case file written before it
   // existed stays valid and keeps the retry it was recorded expecting.
   notRun: z.literal(true).optional(),
+  // Incomplete only: a usage limit stopped the session. Recorded so a report
+  // can say so; no routing decision reads it.
+  limit: UsageLimit.optional(),
 });
 export type TerminusEntry = z.infer<typeof TerminusEntry>;
 
@@ -266,6 +273,29 @@ export type HistoryEntry = z.infer<typeof HistoryEntry>;
 
 // --- Outcome ---
 
+/**
+ * Why a task stopped, as a closed set a reader can switch on. Written with the
+ * outcome and read only by reporting: nothing that decides what a run does
+ * next reads it.
+ */
+export const OutcomeCause = z.object({
+  kind: z.enum([
+    "authority",
+    "repair_gave_up",
+    "session_not_run",
+    "budget",
+    "triage_failure",
+    "triage_escalated",
+    "triage_abort",
+    "provisioning",
+  ]),
+  // authority and session_not_run only: whose session it was.
+  role: z.enum(["worker", "gate-maintenance"]).optional(),
+  // budget only: which retries ran out.
+  population: z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]).optional(),
+});
+export type OutcomeCause = z.infer<typeof OutcomeCause>;
+
 export const CaseFileOutcome = z.object({
   kind: z.enum(["closed", "escalated", "aborted"]),
   source: z.string(),
@@ -274,6 +304,9 @@ export const CaseFileOutcome = z.object({
   // Escalated only: the ref holding the EscalationPacket a person reads.
   // Optional, so every case file written before packets existed stays valid.
   packetRef: z.string().optional(),
+  // Escalated and aborted only. Optional, so every case file written before
+  // causes were recorded stays valid; a reader shows such a stop as recorded.
+  cause: OutcomeCause.optional(),
 });
 export type CaseFileOutcome = z.infer<typeof CaseFileOutcome>;
 
@@ -327,10 +360,6 @@ const SurfaceId = z.string().min(1);
 export const RepairStatus = z.enum(["completed", "escalate", "incomplete"]);
 export type RepairStatus = z.infer<typeof RepairStatus>;
 
-/** A usage limit that can stop an agent session: the API's request rate, or the account's spending cap. */
-export const UsageLimit = z.enum(["rate", "spend"]);
-export type UsageLimit = z.infer<typeof UsageLimit>;
-
 /** What tripped the breaker. Both kinds name `surfaceId`: the task whose report tripped it, in whose copy the repair runs. */
 export const BreakerCause = z.discriminatedUnion("kind", [
   // A task found the check could not run before it had started.
diff --git a/src/surface.ts b/src/surface.ts
--- a/src/surface.ts
+++ b/src/surface.ts
@@ -9,6 +9,7 @@ import { BriefRef } from "./prompt-assembly.js";
 import { resolveEscalationPacket } from "./escalation-packet.js";
 import { EscalationPacket, type SharpenedBrief } from "./triage-role-config.js";
 import type { SurfaceLocation, SurfacePorts, TriageInput, EscalationCause, TriageVerdict, CloseContext } from "./ports.js";
+import { OutcomeCause } from "./schema.js";
 import type { CaseFile, CaseFileOutcome, SurfaceState, HistoryEntry } from "./schema.js";
 
 export interface AdvanceResult {
@@ -169,6 +170,8 @@ async function escalate(
   ports: SurfacePorts,
   source: string,
   reason: string,
+  // Absent only when resuming a record whose triage round was written before causes were recorded.
+  cause: OutcomeCause | undefined,
   packet: EscalationPacket,
 ): Promise<AdvanceResult> {
   const packetRef = await writeRef(dir, "escalation", packet);
@@ -178,6 +181,7 @@ async function escalate(
     reason,
     at: new Date().toISOString(),
     packetRef,
+    ...(cause ? { cause } : {}),
   });
 }
 
@@ -186,8 +190,44 @@ async function packetFor(dir: string, cause: EscalationCause): Promise<Escalatio
   return resolveEscalationPacket(dir, await load(dir), cause);
 }
 
+/** What the outcome records of an in-memory cause: its kind and what a reader switches on, never its prose. */
+function outcomeCause(cause: EscalationCause): OutcomeCause {
+  switch (cause.kind) {
+    case "authority":
+    case "session_not_run":
+      return { kind: cause.kind, role: cause.role };
+    case "budget":
+      return { kind: "budget", population: cause.population };
+    case "repair_gave_up":
+    case "triage_failure":
+      return { kind: cause.kind };
+  }
+}
+
+/** Escalate for a cause the harness itself found: the one cause names the packet and what the outcome records. */
+async function escalateFor(
+  dir: string,
+  caseFile: CaseFile,
+  location: SurfaceLocation,
+  ports: SurfacePorts,
+  source: string,
+  reason: string,
+  cause: EscalationCause,
+): Promise<AdvanceResult> {
+  return escalate(dir, caseFile, location, ports, source, reason, outcomeCause(cause), await packetFor(dir, cause));
+}
+
 /** The ref shape `triage()` writes for an escalate round. */
-const PacketRef = z.object({ artifact: EscalationPacket });
+const PacketRef = z.object({ artifact: EscalationPacket, cause: OutcomeCause.optional() });
+
+/**
+ * What an escalate verdict's outcome records: the cause the port named, else
+ * whether the agent wrote the packet itself or the harness had to stand in.
+ */
+function triageCause(verdict: TriageVerdict): OutcomeCause {
+  if (verdict.cause) return outcomeCause(verdict.cause);
+  return { kind: EscalationPacket.safeParse(verdict.artifact).success ? "triage_escalated" : "triage_failure" };
+}
 
 /**
  * The packet for an escalate verdict: the agent's own when it wrote one, else
@@ -207,7 +247,7 @@ async function packetForVerdict(
   );
 }
 
-/** Terminate as ABORTED with the standard `{kind, source, reason, at}` shape. */
+/** Terminate as ABORTED with the standard `{kind, source, reason, at, cause}` shape. */
 function abort(
   dir: string,
   caseFile: CaseFile,
@@ -215,12 +255,14 @@ function abort(
   ports: SurfacePorts,
   source: string,
   reason: string,
+  cause: OutcomeCause,
 ): Promise<AdvanceResult> {
   return terminate(dir, caseFile, location, ports, "ABORTED", {
     kind: "aborted",
     source,
     reason,
     at: new Date().toISOString(),
+    cause,
   });
 }
 
@@ -240,22 +282,19 @@ async function escalateFromTail(
   const tail = logTail(caseFile);
   if (tail?.t === "triage") {
     // TRIAGE wrote this round's packet into its ref before appending the entry.
+    // The round's cause is there too: it cannot be worked out again from the log.
     const ref = PacketRef.safeParse(await readRef(dir, tail.artifactRef));
-    const packet = ref.success
-      ? ref.data.artifact
-      : await packetFor(dir, { kind: "triage_failure", rationale: tail.rationale });
-    return escalate(dir, caseFile, location, ports, "triage", tail.rationale, packet);
+    if (!ref.success) {
+      return escalateFor(dir, caseFile, location, ports, "triage", tail.rationale, { kind: "triage_failure", rationale: tail.rationale });
+    }
+    return escalate(dir, caseFile, location, ports, "triage", tail.rationale, ref.data.cause, ref.data.artifact);
   }
   const terminus = tail?.t === "terminus" ? tail : undefined;
   const cause: EscalationCause =
     terminus?.category === "authority"
       ? { kind: "authority", role: terminus.role ?? "worker" }
       : { kind: "repair_gave_up" };
-  return escalate(
-    dir, caseFile, location, ports, source,
-    terminus ? terminus.rationale : "the session escalated",
-    await packetFor(dir, cause),
-  );
+  return escalateFor(dir, caseFile, location, ports, source, terminus ? terminus.rationale : "the session escalated", cause);
 }
 
 /**
@@ -282,9 +321,7 @@ function escalateIfNotRun(
   tail: Extract<HistoryEntry, { t: "terminus" }>,
 ): Promise<AdvanceResult> | undefined {
   if (!tail.notRun) return undefined;
-  return packetFor(dir, { kind: "session_not_run", role }).then((packet) =>
-    escalate(dir, caseFile, location, ports, role, tail.rationale, packet),
-  );
+  return escalateFor(dir, caseFile, location, ports, role, tail.rationale, { kind: "session_not_run", role });
 }
 
 /**
@@ -377,16 +414,14 @@ async function dispatchSession(
     status: terminus.status,
     ...(terminus.status === "escalate" ? { category: terminus.category } : {}),
     ...(terminus.status === "incomplete" && terminus.notRun ? { notRun: true as const } : {}),
+    ...(terminus.status === "incomplete" && terminus.limit ? { limit: terminus.limit } : {}),
     rationale: terminus.rationale,
   };
   await appendEntry(dir, entry);
 
   const state = deriveStateFromEntry(entry);
   if (state === "ESCALATED") {
-    return escalate(
-      dir, caseFile, location, ports, role, terminus.rationale,
-      await packetFor(dir, { kind: "authority", role }),
-    );
+    return escalateFor(dir, caseFile, location, ports, role, terminus.rationale, { kind: "authority", role });
   }
   await updateCursor(dir, { state });
   return { state, done: false };
@@ -411,10 +446,10 @@ async function dispatchOwnRepair(
   const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
   const { used, max } = budgets.gateMaintenance;
   if (used >= max) {
-    return escalate(
+    return escalateFor(
       dir, caseFile, location, ports, "gate-maintenance",
       budgetExhausted("gateMaintenance", { used, max }, reason),
-      await packetFor(dir, { kind: "budget", population: "gateMaintenance", budget: { used, max }, detail: reason }),
+      { kind: "budget", population: "gateMaintenance", budget: { used, max }, detail: reason },
     );
   }
 
@@ -536,7 +571,7 @@ async function provisioning(
     if (!(err instanceof ProvisioningFailure)) throw err;
     // Provisioning failure is infra-class and terminal: there is no worker or
     // triage move that helps, so it never reaches the caller as a throw.
-    return abort(dir, caseFile, location, ports, "provisioning", err.detail);
+    return abort(dir, caseFile, location, ports, "provisioning", err.detail, { kind: "provisioning" });
   }
 
   // Guarded rather than unconditional: provisioning legitimately runs twice
@@ -609,10 +644,10 @@ async function incompleteTerminus(
     caseFile.cursor.budgets,
   ).terminus;
   if (used >= max) {
-    return escalate(
+    return escalateFor(
       dir, caseFile, location, ports, "worker",
       budgetExhausted("terminus", { used, max }, tail.rationale),
-      await packetFor(dir, { kind: "budget", population: "terminus", budget: { used, max }, detail: tail.rationale }),
+      { kind: "budget", population: "terminus", budget: { used, max }, detail: tail.rationale },
     );
   }
 
@@ -751,11 +786,13 @@ async function triage(
   // overwrite each other's artefacts; a crash between the ref and the entry
   // leaves an orphan ref that the re-run overwrites at the same key.
   const packet = verdict.verdict === "escalate" ? await packetForVerdict(dir, caseFile, verdict) : undefined;
+  const cause = packet ? triageCause(verdict) : undefined;
   const artifact = packet ?? verdict.artifact;
   const artifactRef = await writeRef(dir, `triage-${priorTriages}`, {
     trigger,
     rationale: verdict.rationale,
     ...(artifact ? { artifact } : {}),
+    ...(cause ? { cause } : {}),
   });
 
   const entry: HistoryEntry = {
@@ -772,10 +809,10 @@ async function triage(
   // `packet` is set exactly when the verdict is escalate, which is exactly when
   // the entry routes to ESCALATED.
   if (state === "ESCALATED" && packet) {
-    return escalate(dir, caseFile, location, ports, "triage", verdict.rationale, packet);
+    return escalate(dir, caseFile, location, ports, "triage", verdict.rationale, cause, packet);
   }
   if (state === "ABORTED") {
-    return abort(dir, caseFile, location, ports, "triage", verdict.rationale);
+    return abort(dir, caseFile, location, ports, "triage", verdict.rationale, { kind: "triage_abort" });
   }
   await updateCursor(dir, { state });
   return { state, done: false };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts src/case-file.test.ts`
Expected: PASS (both files, every test: the suites that were green stay green).

Run: `npx tsc --noEmit && npx eslint src/schema.ts src/surface.ts src/surface.test.ts src/case-file.test.ts`
Expected: no output.

- [ ] **Step 6: Bring the control-flow document's sketch of the record up to date**

In `docs/single-surface-control-flow.md`, replace

```
  outcome?                    # {kind: closed|escalated|aborted, source, reason, at, packet_ref?}
                              # packet_ref: escalated only → the EscalationPacket a person reads
                              # (decision, verbatim evidence, dead ends, why now, session keys)
```

with

```
  outcome?                    # {kind: closed|escalated|aborted, source, reason, at, packet_ref?, cause?}
                              # packet_ref: escalated only → the EscalationPacket a person reads
                              # (decision, verbatim evidence, dead ends, why now, session keys)
                              # cause: escalated and aborted only → {kind, role?, population?}, why the
                              # task stopped, as a closed set. Read only by reporting, never by routing.
```

and replace

```
        category?,             # for escalate: exhaustion | authority
        rationale, role? }     # role as above; must match its dispatch
```

with

```
        category?,             # for escalate: exhaustion | authority
        rationale, role?,      # role as above; must match its dispatch
        limit? }               # for incomplete: rate | spend, the usage limit that stopped the
                               # session. Read only by reporting, never by routing.
```

- [ ] **Step 7: Commit**

```bash
git add src/schema.ts src/surface.ts src/surface.test.ts src/case-file.test.ts docs/single-surface-control-flow.md
git commit -m "Record why a task stopped and which usage limit stopped a session" -m "A report has to say what kind of stop it was and who must act, and the outcome's reason is a sentence written for a log, not a fact a reader can switch on. Both additions are optional, so every older record still reads, and nothing that decides what a run does next reads either."
```

---

### Task 3: Read every record without stopping at a damaged one ✅ DONE (deliver-slice)

**Files:**
- Create: `src/report/report-fixtures.ts` (test support, shipped beside the code as `src/cli/command-fixtures.ts` is)
- Modify: `src/run-records.ts` (new `DamagedRun`, `readRunRecords`)
- Modify: `src/cli/runs.ts` (`allRuns` re-expressed over `readRunRecords`)
- Create: `src/report/snapshot.ts`
- Test: `src/run-records.test.ts`, `src/report/snapshot.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `newestFirstBy` (`src/run-records.ts`, Task 1); `runsRoot`, `supervisedRoot` (`src/run-location.ts`, Task 1); `OutcomeCause` (`src/schema.ts`, Task 2).
- Produces (`src/run-records.ts`):
  ```ts
  export interface DamagedRun { runId: string; dir: string; file: "case.json" | "log.jsonl"; taskDef?: TaskDef; error: CorruptCaseFile }
  export function readRunRecords(repoPath: string): Promise<{ records: RunRecord[]; damaged: DamagedRun[] }>
  ```
- Produces (`src/report/snapshot.ts`):
  ```ts
  export type ReportSubject = { kind: "list" } | { kind: "run"; runId: string } | { kind: "task"; runId: string };
  export interface DamagedFile { runId: string; file: string; taskDef?: TaskDef }   // file is relative to the repository
  export interface RecordSnapshot { subject: ReportSubject; live: boolean; list: TaskDef[]; records: RunRecord[]; runs: RunFile[]; damaged: DamagedFile[] }
  export function loadSnapshot(repoPath: string, subject: ReportSubject, options: { live: boolean; list: TaskDef[] }): Promise<RecordSnapshot>
  ```
  It throws `FileNotFound` (subject `task`) or `RunFileNotFound` (subject `run`) when nothing on disk answers for the named id.
- Produces (`src/report/report-fixtures.ts`, used by the tests of Tasks 3 to 7): `TaskRun`, `recordOf(run, repoPath?)`, `writeRecord(repoPath, run)`, `damageLog(dir)`, `attempt(number, said, ending?)`, `failedCheck(number, verdict)`, `closedAt(at)`, `stoppedAt(at, cause, reason?, kind?)`, `fill(slot, surfaceId, task)`, `runFileOf(runId, history, outcome?)`, `FORBIDDEN`, the list `FORM`, `FOOTER`, `HOMEPAGE`, `BANNER`, the ids `ID`, the records `formDone`, `footerFailed`, `homepageAsks`, `footerWorking`, and (added in Step 7) `snapshotOf(over?)`.

- [ ] **Step 1: Create the shared test support, `src/report/report-fixtures.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, initialCaseFile, setBaseBranch, setOutcome } from "../case-file.js";
import { runsRoot } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import type { CaseFileOutcome, CloserRef, CreateHeader, GateRef, HistoryEntry, OutcomeCause, RunEntry, RunFile, RunOutcome } from "../schema.js";

/** Test support: one task's run, as much of it as a report reads. No `outcome` leaves it unfinished. */
export interface TaskRun {
  runId: string;
  task: string;
  history?: HistoryEntry[];
  outcome?: CaseFileOutcome;
  /** Absent: no closer pinned, as in a record from before closers were. */
  closerRef?: CloserRef;
}

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

const headerOf = ({ runId, task, closerRef }: TaskRun): CreateHeader => ({
  surfaceId: runId,
  taskDef: { intent: task },
  gateRef: GATE,
  ...(closerRef ? { closerRef } : {}),
});

/** Test support: a run's record as `loadSnapshot` would read it, built in memory. */
export function recordOf(run: TaskRun, repoPath = "/repo"): RunRecord {
  const caseFile = initialCaseFile(headerOf(run), DEFAULT_BUDGETS);
  return {
    runId: run.runId,
    repoPath,
    dir: join(runsRoot(repoPath), run.runId),
    caseFile: { ...caseFile, header: { ...caseFile.header, baseBranch: "main" }, history: run.history ?? [], ...(run.outcome ? { outcome: run.outcome } : {}) },
  };
}

/** Test support: the same record on disk, written the way a run writes it. */
export async function writeRecord(repoPath: string, run: TaskRun): Promise<string> {
  const dir = join(runsRoot(repoPath), run.runId);
  await mkdir(dir, { recursive: true });
  await create(dir, headerOf(run), DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  for (const entry of run.history ?? []) await appendEntry(dir, entry);
  if (run.outcome) await setOutcome(dir, run.outcome);
  return dir;
}

/**
 * Test support: damage a record's log the way a bad disk does, in the middle. A
 * torn last line is not damage: the journal drops it, as after a crash.
 */
export async function damageLog(dir: string): Promise<void> {
  await writeFile(join(dir, "log.jsonl"), `this is not a log line\n${JSON.stringify(attempt(1, "x")[0])}\n`);
}

/** One session of the agent on the task: set to work, and how it ended in its own words. */
export function attempt(number: number, said: string, ending: "completed" | "authority" | "exhaustion" = "completed"): HistoryEntry[] {
  const sessionKey = `worker-${number}-0`;
  return [
    { t: "dispatch", role: "worker", attempt: number, sessionKey },
    ending === "completed"
      ? { t: "terminus", role: "worker", attempt: number, sessionKey, status: "completed", rationale: said }
      : { t: "terminus", role: "worker", attempt: number, sessionKey, status: "escalate", category: ending, rationale: said },
  ];
}

/** A check that failed after an attempt, and the round that sent the agent back or gave up. */
export function failedCheck(number: number, verdict: "reroute" | "escalate"): HistoryEntry[] {
  return [
    { t: "gate", attempt: number, status: "FAIL", newFailures: [{ id: "footer-links", detailRef: `gate-${number}` }] },
    { t: "triage", afterAttempt: number, trigger: "gate_fail", verdict, rationale: `gate_fail: ${verdict}`, artifactRef: `triage-${number - 1}` },
  ];
}

export const closedAt = (at: string): CaseFileOutcome => ({ kind: "closed", source: "closer", reason: "the closer accepted the work", at });

export const stoppedAt = (at: string, cause: OutcomeCause | undefined, reason = "recorded reason", kind: "escalated" | "aborted" = "escalated"): CaseFileOutcome => ({
  kind,
  source: "worker",
  reason,
  at,
  ...(cause ? { cause } : {}),
});

/** A run of several at once taking a task into a slot. */
export const fill = (slot: number, surfaceId: string, task: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent: task } });

/** Test support: the record of a run of several at once, built in memory. No `outcome` leaves it unfinished. */
export function runFileOf(runId: string, history: RunEntry[], outcome?: RunOutcome): RunFile {
  const tasks = history.filter((entry) => entry.t === "slot_fill").length;
  return { header: { runId, repoPath: "/repo", concurrency: 2, tasks, runBudgetMax: { gateMaintenance: 2 } }, history, ...(outcome ? { outcome } : {}) };
}

/** The words the owner is never shown: the harness's own names for things. */
export const FORBIDDEN = /\b(surfaces?|budgets?|gates?|triage|authority|terminus|breaker|escalat\w*|workers?|router|slots?|populations?|degraded|verdicts?|repair sessions?)\b/i;

/** A small project's list, and the ids its runs were given. */
export const FORM = "Add a contact form";
export const FOOTER = "Fix the broken footer links";
export const HOMEPAGE = "Replace the old homepage";
export const BANNER = "Add a cookie banner";

export const ID = {
  form: "add-a-contact-form-20261001T020100Z",
  footer: "fix-the-broken-footer-links-20261001T022000Z",
  homepage: "replace-the-old-homepage-20261001T030000Z",
  banner: "add-a-cookie-banner-20261001T031000Z",
  run: "run-20261001T020000Z",
} as const;

const MERGE: CloserRef = { type: "merge-back" };

/** Delivered at the first attempt and merged. */
export const formDone = recordOf({ runId: ID.form, task: FORM, closerRef: MERGE, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

/** Four attempts, the check failing after each, until the corrections ran out. */
export const footerFailed = recordOf({
  runId: ID.footer,
  task: FOOTER,
  closerRef: MERGE,
  history: [
    ...attempt(1, "first go"),
    ...failedCheck(1, "reroute"),
    ...attempt(2, "second go"),
    ...failedCheck(2, "reroute"),
    ...attempt(3, "third go"),
    ...failedCheck(3, "reroute"),
    ...attempt(4, "I fixed 4 of the 6 links.\nThe other 2 point at pages that no longer exist."),
    ...failedCheck(4, "escalate"),
  ],
  outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (3/3)"),
});

/** Stopped at once for the owner's say-so. */
export const homepageAsks = recordOf({
  runId: ID.homepage,
  task: HOMEPAGE,
  closerRef: MERGE,
  history: attempt(1, "This would delete 14 published pages. I need the owner to confirm.", "authority"),
  outcome: stoppedAt("2026-10-01T03:04:00.000Z", { kind: "authority", role: "worker" }, "worker escalated: authority"),
});

/** Set to work, and nothing since. */
export const footerWorking = recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: attempt(1, "first go") });
```

- [ ] **Step 2: Write the failing tests for the tolerant reader**

Create `src/run-records.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorruptCaseFile } from "./errors.js";
import { attempt, closedAt, damageLog, FOOTER, FORM, ID, writeRecord } from "./report/report-fixtures.js";
import { runsRoot } from "./run-location.js";
import { readRunRecords } from "./run-records.js";
import { initTempRepo } from "./temp-repo.js";

describe("reading every run a repository holds", () => {
  it("finds none where nothing has ever run", async () => {
    const repo = initTempRepo("records-none-", { "README.md": "x\n" });

    expect(await readRunRecords(repo)).toEqual({ records: [], damaged: [] });
  });

  it("reads each run back, in run id order", async () => {
    const repo = initTempRepo("records-two-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

    const { records, damaged } = await readRunRecords(repo);

    expect(records.map((record) => [record.runId, record.caseFile.outcome?.kind])).toEqual([
      [ID.form, "closed"],
      [ID.footer, undefined],
    ]);
    expect(damaged).toEqual([]);
  });

  it("sets a run whose log is damaged aside, naming the log and the task it was for, and still reads the others", async () => {
    const repo = initTempRepo("records-log-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER, history: attempt(1, "done") });
    await damageLog(dir);

    const { records, damaged } = await readRunRecords(repo);

    expect(records.map((record) => record.runId)).toEqual([ID.form]);
    expect(damaged.map(({ runId, dir: where, file, taskDef }) => ({ runId, where, file, taskDef }))).toEqual([
      { runId: ID.footer, where: dir, file: "log.jsonl", taskDef: { intent: FOOTER } },
    ]);
    expect(damaged[0]?.error).toBeInstanceOf(CorruptCaseFile);
  });

  it("names the case file, and no task, when the case file itself is damaged", async () => {
    const repo = initTempRepo("records-case-", { "README.md": "x\n" });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await writeFile(join(dir, "case.json"), "{ truncated");

    const { damaged } = await readRunRecords(repo);

    expect(damaged.map(({ runId, file, taskDef }) => ({ runId, file, taskDef }))).toEqual([{ runId: ID.footer, file: "case.json", taskDef: undefined }]);
  });

  it("passes over a folder with no record in it: it was never a run", async () => {
    const repo = initTempRepo("records-empty-dir-", { "README.md": "x\n" });
    await mkdir(join(runsRoot(repo), "never-a-run-20261001T020000Z"), { recursive: true });

    expect(await readRunRecords(repo)).toEqual({ records: [], damaged: [] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/run-records.test.ts`
Expected: FAIL, all 5, with `readRunRecords is not a function`.

- [ ] **Step 4: Add the reader**

Replace `src/run-records.ts` with this (the first four exports are unchanged from Task 1; `DamagedRun`, `whatIsDamaged` and `readRunRecords` are new):

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "./case-file.js";
import { CorruptCaseFile, FileNotFound } from "./errors.js";
import { runsRoot } from "./run-location.js";
import { CaseJson, type CaseFile, type TaskDef } from "./schema.js";

/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
export interface RunRecord {
  runId: string;
  repoPath: string;
  dir: string;
  caseFile: CaseFile;
}

/**
 * The UTC instant a run started, which its id already carries
 * (`src/run-location.ts`), as a timestamp a script can parse. `null` for an
 * id that carries no stamp, rather than a made-up time.
 */
export function startedInstant(runId: string): string | null {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/**
 * Newest first, by the second each item's run id carries rather than by when
 * its record was last written: a list is a history, so resuming an old run
 * today does not make it the newest. A run id with no stamp sorts last, and
 * the sort is stable, so runs that started in the same second keep the order
 * they came in.
 */
export function newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[] {
  const startedOf = (item: T): string => startedInstant(runIdOf(item)) ?? "";
  return [...items].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
}

/** Newest first, by the second each run id carries. See `newestFirstBy`. */
export function newestFirst(records: RunRecord[]): RunRecord[] {
  return newestFirstBy(records, (record) => record.runId);
}

/** A run whose record cannot be read back: which of its files is at fault, and the task it was for when its header still reads. */
export interface DamagedRun {
  runId: string;
  dir: string;
  file: "case.json" | "log.jsonl";
  taskDef?: TaskDef;
  /** The error reading it raised, for a caller that stops on damage rather than reporting around it. */
  error: CorruptCaseFile;
}

/** Which file of a damaged record is at fault. Its header still reads when only the log is damaged, and that names the task. */
async function whatIsDamaged(dir: string): Promise<Pick<DamagedRun, "file" | "taskDef">> {
  try {
    const { header } = CaseJson.parse(JSON.parse(await readFile(join(dir, "case.json"), "utf-8")));
    return { file: "log.jsonl", taskDef: header.taskDef };
  } catch {
    return { file: "case.json" };
  }
}

/**
 * Every run this repository is holding, in run id order, with the ones whose
 * record cannot be read back set aside rather than thrown: one damaged record
 * must not hide the others from a reader. A folder with no record in it was
 * never a run (the process died between making the folder and writing the case
 * file), so it is passed over.
 */
export async function readRunRecords(repoPath: string): Promise<{ records: RunRecord[]; damaged: DamagedRun[] }> {
  let runIds: string[];
  try {
    runIds = (await readdir(runsRoot(repoPath), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { records: [], damaged: [] }; // nothing has ever run here
  }

  const read = await Promise.all(
    runIds.map(async (runId): Promise<RunRecord | DamagedRun | undefined> => {
      const dir = join(runsRoot(repoPath), runId);
      try {
        return { runId, repoPath, dir, caseFile: await load(dir) };
      } catch (err) {
        if (err instanceof FileNotFound) return undefined;
        if (!(err instanceof CorruptCaseFile)) throw err;
        return { runId, dir, error: err, ...(await whatIsDamaged(dir)) };
      }
    }),
  );
  return {
    records: read.filter((run): run is RunRecord => run !== undefined && "caseFile" in run),
    damaged: read.filter((run): run is DamagedRun => run !== undefined && "error" in run),
  };
}
```

- [ ] **Step 5: Make `allRuns` use it, so there is one walk of the run folders**

`allRuns` keeps its contract: a damaged record still stops `delivery status` with the message that names the folder. Make exactly these edits to `src/cli/runs.ts`:

```diff
diff --git a/src/cli/runs.ts b/src/cli/runs.ts
--- a/src/cli/runs.ts
+++ b/src/cli/runs.ts
@@ -3,9 +3,9 @@ import { join } from "node:path";
 import { createInterface } from "node:readline";
 import { load } from "../case-file.js";
-import { FileNotFound, RunFileNotFound } from "../errors.js";
+import { RunFileNotFound } from "../errors.js";
 import { loadRunFile } from "../run-file.js";
 import type { RunFile } from "../schema.js";
 import { runsRoot, supervisedRoot, supervisedPlace } from "../run-location.js";
-import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
+import { newestFirstBy, readRunRecords, startedInstant, type RunRecord } from "../run-records.js";
 import { taskIntent } from "../task-list.js";
 import type { CommandContext } from "./context.js";
@@ -46,24 +46,8 @@ export async function touchedAt(dir: string): Promise<number> {
  */
 export async function allRuns(repoPath: string): Promise<RunRecord[]> {
-  let entries;
-  try {
-    entries = await readdir(runsRoot(repoPath), { withFileTypes: true });
-  } catch {
-    return []; // nothing has ever run here
-  }
-
-  const read = await Promise.all(
-    entries.filter((entry) => entry.isDirectory()).map((entry) =>
-      readRun(repoPath, entry.name).catch((err) => {
-        if (err instanceof FileNotFound) return undefined;
-        throw err;
-      }),
-    ),
-  );
-  const found = await Promise.all(
-    read
-      .filter((record): record is RunRecord => record !== undefined)
-      .map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })),
-  );
+  const { records, damaged } = await readRunRecords(repoPath);
+  const [unreadable] = damaged;
+  if (unreadable) throw unreadable.error;
+  const found = await Promise.all(records.map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })));
   return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
 }
```

- [ ] **Step 6: Run the tests to verify they pass, and commit**

Run: `npx vitest run src/run-records.test.ts src/cli/runs.test.ts`
Expected: PASS (2 files, 36 tests).

Run: `npx tsc --noEmit && npx eslint src/run-records.ts src/run-records.test.ts src/cli/runs.ts src/report`
Expected: no output.

```bash
git add src/run-records.ts src/run-records.test.ts src/cli/runs.ts src/report/report-fixtures.ts
git commit -m "Read every run's record, setting a damaged one aside" -m "One damaged record must not hide the others from a report. The reader now returns what read back and what did not, with the file at fault; status keeps stopping on damage by throwing the first one, over the same single walk of the folders."
```

- [ ] **Step 7: Write the failing tests for the snapshot**

Create `src/report/snapshot.test.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileNotFound, RunFileNotFound } from "../errors.js";
import { appendRunEntry, createRunFile } from "../run-file.js";
import { prepareRunDir, supervisedPlace } from "../run-location.js";
import { initTempRepo } from "../temp-repo.js";
import { attempt, closedAt, damageLog, fill, FOOTER, FORM, ID, writeRecord } from "./report-fixtures.js";
import { loadSnapshot } from "./snapshot.js";

const LIST = [{ intent: FORM }, { intent: FOOTER }];

async function writeRun(repo: string): Promise<string> {
  const dir = supervisedPlace(repo, ID.run);
  await prepareRunDir(repo, dir);
  await createRunFile(dir, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } });
  await appendRunEntry(dir, fill(1, ID.form, FORM));
  return dir;
}

describe("reading what a report is derived from", () => {
  it("is empty, not an error, where nothing has ever run", async () => {
    const repo = initTempRepo("snapshot-none-", { "README.md": "x\n" });

    expect(await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST })).toEqual({
      subject: { kind: "list" },
      live: false,
      list: LIST,
      records: [],
      runs: [],
      damaged: [],
    });
  });

  it("reads every task's record and every run of several at once", async () => {
    const repo = initTempRepo("snapshot-all-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });
    await writeRun(repo);

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: true, list: LIST });

    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.form]);
    expect(snapshot.runs.map((run) => [run.header.runId, run.history.length])).toEqual([[ID.run, 1]]);
    expect(snapshot.live).toBe(true);
  });

  it("names a damaged task record by its file, relative to the repository", async () => {
    const repo = initTempRepo("snapshot-damaged-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await damageLog(dir);

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });

    expect(snapshot.damaged).toEqual([{ runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } }]);
    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.form]);
  });

  it("names a damaged run of several at once by its folder", async () => {
    const repo = initTempRepo("snapshot-damaged-run-", { "README.md": "x\n" });
    const dir = await writeRun(repo);
    await writeFile(join(dir, "run.json"), "{ truncated");

    const snapshot = await loadSnapshot(repo, { kind: "run", runId: ID.run }, { live: false, list: LIST });

    expect(snapshot.runs).toEqual([]);
    expect(snapshot.damaged).toEqual([{ runId: ID.run, file: `.delivery/supervised/${ID.run}` }]);
  });

  it("fails to answer for a named run nothing on disk answers for", async () => {
    const repo = initTempRepo("snapshot-unknown-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });

    await expect(loadSnapshot(repo, { kind: "task", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(FileNotFound);
    await expect(loadSnapshot(repo, { kind: "run", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(RunFileNotFound);
  });
});
```

The snapshot's type exists from this cycle on, so the fixtures gain the helper Tasks 5 and 6 build their snapshots with. In `src/report/report-fixtures.ts`, add this import after the import from `../schema.js`:

```ts
import type { RecordSnapshot } from "./snapshot.js";
```

and append this at the end of the file:

```ts
/** Test support: what `loadSnapshot` would return for the four-task list, nothing run and nothing going unless said. */
export const snapshotOf = (over: Partial<RecordSnapshot> = {}): RecordSnapshot => ({
  subject: { kind: "list" },
  live: false,
  list: [FORM, FOOTER, HOMEPAGE, BANNER].map((intent) => ({ intent })),
  records: [],
  runs: [],
  damaged: [],
  ...over,
});
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npx vitest run src/report/snapshot.test.ts`
Expected: FAIL: the file cannot be loaded (`Cannot find module './snapshot.js'` or the equivalent resolution error).

- [ ] **Step 9: Create `src/report/snapshot.ts`**

```ts
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { CorruptRunFile, FileNotFound, RunFileNotFound } from "../errors.js";
import { loadRunFile } from "../run-file.js";
import { runsRoot, supervisedRoot } from "../run-location.js";
import { readRunRecords, type DamagedRun, type RunRecord } from "../run-records.js";
import type { RunFile, TaskDef } from "../schema.js";

/** What a report is about: the project's task list, one run of several tasks at once, or one task's own run. */
export type ReportSubject = { kind: "list" } | { kind: "run"; runId: string } | { kind: "task"; runId: string };

/** A record that could not be read back, with the file at fault named as the owner would find it: relative to the repository. */
export interface DamagedFile {
  runId: string;
  file: string;
  /** The task the record was for, when its header could still be read. */
  taskDef?: TaskDef;
}

/** Everything a report is derived from, read once. Plain data: `deriveReport` does no reading of its own. */
export interface RecordSnapshot {
  subject: ReportSubject;
  /** Whether a run of several at once holds the repository right now. */
  live: boolean;
  /** The project's task list as written now; empty when it has none. */
  list: TaskDef[];
  records: RunRecord[];
  runs: RunFile[];
  damaged: DamagedFile[];
}

/** Every run of several at once this repository holds, and the ones whose record cannot be read back. */
async function readRunFiles(repoPath: string): Promise<{ runs: RunFile[]; damaged: DamagedFile[] }> {
  const root = supervisedRoot(repoPath);
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return { runs: [], damaged: [] }; // no run of several at once has ever started here
  }
  const runs: RunFile[] = [];
  const damaged: DamagedFile[] = [];
  for (const name of names) {
    try {
      runs.push(await loadRunFile(join(root, name)));
    } catch (err) {
      if (err instanceof RunFileNotFound) continue; // a folder with no record in it was never a run
      if (!(err instanceof CorruptRunFile)) throw err;
      damaged.push({ runId: name, file: relative(repoPath, join(root, name)) });
    }
  }
  return { runs, damaged };
}

const asDamagedFile = (repoPath: string, { runId, dir, file, taskDef }: DamagedRun): DamagedFile => ({
  runId,
  file: relative(repoPath, join(dir, file)),
  ...(taskDef ? { taskDef } : {}),
});

/**
 * Read everything a report on `subject` is derived from. The only reading a
 * report does, and it takes no lock, so it is safe while a run is going: the
 * records are replaced whole or appended to, never half-written. A damaged
 * record is set aside and named rather than thrown. A subject that names a
 * run nothing on disk answers for is a failure to answer, and throws the same
 * error a lookup of that id does anywhere else.
 */
export async function loadSnapshot(repoPath: string, subject: ReportSubject, { live, list }: { live: boolean; list: TaskDef[] }): Promise<RecordSnapshot> {
  // A run's own record first, then its tasks': the run's outcome is written last, so a run read as ended
  // never sits beside a task read before it ended (spec, "Reading while a run writes").
  const supervised = await readRunFiles(repoPath);
  const tasks = await readRunRecords(repoPath);
  const damaged = [...tasks.damaged.map((run) => asDamagedFile(repoPath, run)), ...supervised.damaged];
  const known = (runId: string): boolean => damaged.some((file) => file.runId === runId);

  if (subject.kind === "task" && !tasks.records.some((record) => record.runId === subject.runId) && !known(subject.runId)) {
    const dir = join(runsRoot(repoPath), subject.runId);
    throw new FileNotFound(dir, join(dir, "case.json"));
  }
  if (subject.kind === "run" && !supervised.runs.some((run) => run.header.runId === subject.runId) && !known(subject.runId)) {
    const dir = join(supervisedRoot(repoPath), subject.runId);
    throw new RunFileNotFound(dir, join(dir, "run.json"));
  }
  return { subject, live, list, records: tasks.records, runs: supervised.runs, damaged };
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/report/snapshot.test.ts`
Expected: PASS (5 tests).

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add src/report/snapshot.ts src/report/snapshot.test.ts src/report/report-fixtures.ts
git commit -m "Add the snapshot a report is derived from" -m "Everything a report reads is read once, here, without a lock, so deriving and printing can be pure functions and a user's problem can be reproduced from a copy of their run folder. A damaged record is named by its file rather than thrown."
```

---

### Task 4: The report document, and a stop in the owner's words ✅ DONE (deliver-slice)

**Files:**
- Create: `src/report/document.ts`
- Create: `src/report/plain.ts`
- Test: `src/report/plain.test.ts`

**Interfaces:**
- Consumes: `OutcomeCause`, `UsageLimit` (`src/schema.ts`); `USAGE_LIMIT_WORDS` (`src/ports.ts`, existing); `FORBIDDEN` (`src/report/report-fixtures.ts`, Task 3).
- Produces (`src/report/document.ts`): `REPORT_SCHEMA = "delivery.report/1"`; zod schemas and inferred types `Standing` (`closed | escalated | aborted | paused | unfinished | queued | not_started`), `PlainGroup` (`needs_your_decision | failed_after_attempts | abandoned | needs_an_engineer | stopped`), `Audience` (`owner | engineer | unknown`), `Plain { group, audience, sentence, agentSaid: string | null, next: string[] }`, `BudgetRow`, `ReportSurface`, `ReportRun`, `DamagedRecord { run, file, queue }`, `ReportDocument { schema, kind: "task" | "run" | "list", live: boolean | null, incomplete, counts, run, surfaces }`.
- Produces (`src/report/plain.ts`):
  ```ts
  export interface PlainFacts { runId: string; cause: OutcomeCause | null; agentStuck: boolean; attempts: number; limit: UsageLimit | null; agentSaid: string | null; listed: boolean }
  export function plainOf(facts: PlainFacts): Plain
  export type Landing = "merge-back" | "commit-to-branch" | "open-pr" | "custom";
  export function landedWords(closer: Landing, branch: string | null, base: string | null): string
  export function completedWords(closer: Landing, count: number): string
  export function whereTheWorkIs(closer: Landing, base: string | null): string
  export const RETRY_WORDS: Record<"correction" | "gateError" | "gateMaintenance" | "terminus" | "close", string>
  ```

- [ ] **Step 1: Create the document schema, `src/report/document.ts`**

This is a declaration with no behaviour of its own; `deriveReport`'s tests (Task 5) parse real documents through it.

```ts
import { z } from "zod";
import { OutcomeCause, UsageLimit } from "../schema.js";

/** The version every report document names itself by. A later version adds keys; it never renames or removes one. */
export const REPORT_SCHEMA = "delivery.report/1";

/**
 * Where one task stands. The first six are the standings a run of several at
 * once already reports; `not_started` is a list task with no run of its own
 * yet, which a list worked down one at a time leaves behind a task that did
 * not finish.
 */
export const Standing = z.enum(["closed", "escalated", "aborted", "paused", "unfinished", "queued", "not_started"]);
export type Standing = z.infer<typeof Standing>;

/** What kind of stop a stopped task was, as the owner is told it. */
export const PlainGroup = z.enum(["needs_your_decision", "failed_after_attempts", "abandoned", "needs_an_engineer", "stopped"]);
export type PlainGroup = z.infer<typeof PlainGroup>;

/** Who must act on a stopped task. `unknown` when the record does not say why it stopped. */
export const Audience = z.enum(["owner", "engineer", "unknown"]);
export type Audience = z.infer<typeof Audience>;

/** A stopped task in the owner's words: every sentence fixed, except the agent's own, which is quoted. */
export const Plain = z.object({
  group: PlainGroup,
  audience: Audience,
  sentence: z.string(),
  /** The agent's own last explanation, verbatim; null when the record holds none. */
  agentSaid: z.string().nullable(),
  /** What to do, in order. Empty when the record backs no advice. */
  next: z.array(z.string()),
});
export type Plain = z.infer<typeof Plain>;

const QueuePosition = z.object({ task: z.number().int().positive(), of: z.number().int().positive() });

const BudgetRow = z.object({
  population: z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]),
  used: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});
export type BudgetRow = z.infer<typeof BudgetRow>;

/** One task. Every key is always there: null where the record does not hold the fact. */
export const ReportSurface = z.object({
  /** The task's own run id; null for a task with no run yet. */
  run: z.string().nullable(),
  /** The task's wording. */
  task: z.string(),
  /** Its place in the project's list as written now. */
  queue: QueuePosition.nullable(),
  standing: Standing,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** How it ended, as the run recorded it. */
  reason: z.string().nullable(),
  cause: OutcomeCause.nullable(),
  /** How this task's work is landed, as its run pinned it. */
  closer: z.enum(["merge-back", "commit-to-branch", "open-pr", "custom"]).nullable(),
  branch: z.string().nullable(),
  base: z.string().nullable(),
  /** How many times the agent was set to work on the task. */
  attempts: z.number().int().nonnegative(),
  budgets: z.array(BudgetRow),
  /** The usage limit that stopped the task's last session, when one did. */
  limit: UsageLimit.nullable(),
  /** Stopped tasks only. */
  plain: Plain.nullable(),
});
export type ReportSurface = z.infer<typeof ReportSurface>;

/** The run of several tasks at once a report is about. */
export const ReportRun = z.object({
  runId: z.string(),
  startedAt: z.string().nullable(),
  tasks: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  outcome: z.enum(["drained", "escalated"]).nullable(),
  finishedAt: z.string().nullable(),
  reason: z.string().nullable(),
  cause: z.enum(["shared_environment", "usage_limit"]).nullable(),
  limit: UsageLimit.nullable(),
  runBudgets: z.object({ gateMaintenance: z.object({ used: z.number().int().nonnegative(), max: z.number().int().positive() }) }),
});
export type ReportRun = z.infer<typeof ReportRun>;

/** A record that could not be read back: which run, which of its files, and the list task it answered for when that could still be told. */
export const DamagedRecord = z.object({ run: z.string(), file: z.string(), queue: QueuePosition.nullable() });
export type DamagedRecord = z.infer<typeof DamagedRecord>;

/**
 * What happened, as data: one document for a single task, a run of several at
 * once, or the project's task list. Derived from the record alone
 * (`deriveReport`) and rendered by whoever reads it (`renderText`).
 */
export const ReportDocument = z.object({
  schema: z.literal(REPORT_SCHEMA),
  kind: z.enum(["task", "run", "list"]),
  /** Whether the work is going right now. null when nothing records it: a run of one task at a time holds no lock. */
  live: z.boolean().nullable(),
  /** Records left out because they are damaged. Non-empty marks the report incomplete. */
  incomplete: z.array(DamagedRecord),
  counts: z.record(Standing, z.number().int().nonnegative()),
  run: ReportRun.nullable(),
  surfaces: z.array(ReportSurface),
});
export type ReportDocument = z.infer<typeof ReportDocument>;
```

- [ ] **Step 2: Write the failing tests for the wording**

Create `src/report/plain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OutcomeCause } from "../schema.js";
import { completedWords, landedWords, plainOf, RETRY_WORDS, whereTheWorkIs, type PlainFacts } from "./plain.js";
import { FORBIDDEN } from "./report-fixtures.js";

const facts = (cause: OutcomeCause | null, over: Partial<PlainFacts> = {}): PlainFacts => ({
  runId: "fix-the-footer-20261001T020100Z",
  cause,
  agentStuck: false,
  attempts: 3,
  limit: null,
  agentSaid: "I could not do it.",
  listed: true,
  ...over,
});

/** Every cause a record can hold, with every refinement that changes the words. */
const EVERY_CAUSE: OutcomeCause[] = [
  { kind: "authority", role: "worker" },
  { kind: "authority", role: "gate-maintenance" },
  { kind: "triage_escalated" },
  { kind: "session_not_run", role: "worker" },
  { kind: "session_not_run", role: "gate-maintenance" },
  { kind: "triage_abort" },
  { kind: "repair_gave_up" },
  { kind: "triage_failure" },
  { kind: "provisioning" },
  { kind: "budget", population: "correction" },
  { kind: "budget", population: "terminus" },
  { kind: "budget", population: "gateError" },
  { kind: "budget", population: "gateMaintenance" },
  { kind: "budget", population: "close" },
  { kind: "budget" },
];

describe("who a stopped task is for", () => {
  it.each([
    [{ kind: "authority", role: "worker" }, "needs_your_decision", "owner"],
    [{ kind: "triage_escalated" }, "needs_your_decision", "owner"],
    [{ kind: "session_not_run", role: "worker" }, "needs_your_decision", "owner"],
    [{ kind: "budget", population: "correction" }, "failed_after_attempts", "owner"],
    [{ kind: "budget", population: "terminus" }, "failed_after_attempts", "owner"],
    [{ kind: "triage_abort" }, "abandoned", "owner"],
    [{ kind: "budget", population: "gateError" }, "needs_an_engineer", "engineer"],
    [{ kind: "budget", population: "gateMaintenance" }, "needs_an_engineer", "engineer"],
    [{ kind: "budget", population: "close" }, "needs_an_engineer", "engineer"],
    [{ kind: "repair_gave_up" }, "needs_an_engineer", "engineer"],
    [{ kind: "triage_failure" }, "needs_an_engineer", "engineer"],
    [{ kind: "provisioning" }, "needs_an_engineer", "engineer"],
  ] as const)("puts %j in %s, for the %s", (cause, group, audience) => {
    expect(plainOf(facts(cause))).toMatchObject({ group, audience });
  });

  it("gives a stop with no recorded cause to nobody, with no advice", () => {
    expect(plainOf(facts(null))).toMatchObject({ group: "stopped", audience: "unknown", next: [] });
  });

  it("gives no advice either for a cause too incomplete to explain", () => {
    expect(plainOf(facts({ kind: "budget" }))).toMatchObject({ group: "stopped", audience: "unknown", next: [] });
  });
});

describe("what kind of stop it was, in fixed words", () => {
  it("says the agent would not go on without the owner's say-so", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" })).sentence).toBe(
      "Needs your decision. The agent stopped and said it could not go on without your say-so.",
    );
  });

  it("counts how many times the agent tried when the check still fails", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { attempts: 4 })).sentence).toBe(
      "Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.",
    );
  });

  it("says one attempt as one", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { attempts: 1 })).sentence).toBe(
      "Failed after 1 attempt. The agent tried once and the check you set up still does not pass.",
    );
  });

  it("says the agent gave up when that, not the check, was the last setback", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { agentStuck: true })).sentence).toBe(
      "Failed after 3 attempts. The agent tried 3 times and said it could not finish the task.",
    );
  });

  it("says a usage limit was reached, and which, in those words", () => {
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "spend" })).sentence).toBe(
      "Stopped because a usage limit was reached: the spending limit has been reached.",
    );
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "rate" })).sentence).toBe(
      "Stopped because a usage limit was reached: the AI service is limiting requests.",
    );
  });

  it("tells the owner a broken check is not her decision", () => {
    expect(plainOf(facts({ kind: "repair_gave_up" })).sentence).toBe(
      "The check you set up could not be repaired automatically. This is a problem with the setup, not a decision for you.",
    );
  });

  it("carries the agent's own words through untouched, and their absence as null", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" }, { agentSaid: "Removing it breaks 3 links." })).agentSaid).toBe("Removing it breaks 3 links.");
    expect(plainOf(facts({ kind: "provisioning" }, { agentSaid: null })).agentSaid).toBeNull();
  });
});

describe("what to do about a stopped task", () => {
  it("has the owner say yes or no in the list, then run", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" })).next).toEqual([
      "Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.",
      "Run: delivery run",
    ]);
  });

  it("has the owner reword or remove a task that failed, then run", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" })).next).toEqual(["Reword the task, or remove it from your list.", "Run: delivery run"]);
  });

  it("has a task that is not on a list typed again with its new wording", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { listed: false })).next).toEqual([
      'Reword the task and run it again: delivery run --task "<the reworded task>"',
    ]);
  });

  it("has the owner wait out a usage limit, then run that task on its own before the list", () => {
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "rate" })).next).toEqual([
      "Wait until the limit no longer applies.",
      'Run this task again on its own: delivery run --task "<the task, exactly as it is written>"',
      "Then carry on with your list: delivery run",
    ]);
  });

  it("gives the owner one line to pass to an engineer, naming the run", () => {
    expect(plainOf(facts({ kind: "repair_gave_up" })).next).toEqual([
      "Pass this to whoever maintains your checks: delivery status fix-the-footer-20261001T020100Z",
    ]);
  });

  it.each(EVERY_CAUSE)("never sends a finished task to `delivery resume`, nor to a bare re-run of an unchanged list: %j", (cause) => {
    for (const listed of [true, false]) {
      for (const limit of [null, "rate"] as const) {
        const { next } = plainOf(facts(cause, { listed, limit }));
        expect(next.join("\n")).not.toContain("delivery resume");
        // `delivery run` on a list retells an unchanged task, so it is only ever a later step, after one that changes something.
        expect(next[0] ?? "").not.toMatch(/delivery run$/);
      }
    }
  });
});

describe("the owner's vocabulary", () => {
  it.each(EVERY_CAUSE)("keeps the harness's own words out of every sentence and step: %j", (cause) => {
    for (const listed of [true, false]) {
      for (const agentStuck of [true, false]) {
        for (const limit of [null, "rate", "spend"] as const) {
          const plain = plainOf(facts(cause, { listed, agentStuck, limit, runId: "run-1" }));
          expect([plain.sentence, ...plain.next].join("\n")).not.toMatch(FORBIDDEN);
        }
      }
    }
  });

  it("names the five kinds of retry without them", () => {
    expect(RETRY_WORDS).toEqual({
      correction: "agent corrections",
      gateError: "check re-runs",
      gateMaintenance: "check repairs",
      terminus: "agent restarts",
      close: "hand-off retries",
    });
  });
});

describe("where the work is", () => {
  it("says how each way of landing work left a delivered task", () => {
    expect(landedWords("merge-back", "surface/x", "main")).toBe("merged into main");
    expect(landedWords("commit-to-branch", "surface/x", "main")).toBe("committed on branch surface/x");
    expect(landedWords("open-pr", "surface/x", "main")).toBe("on branch surface/x, with a pull request open");
    expect(landedWords("custom", "surface/x", "main")).toBe("your own closer handled this task; check what it did");
  });

  it("says what completed meant when every delivered task landed the same way", () => {
    expect(completedWords("merge-back", 3)).toBe("completed and merged");
    expect(completedWords("commit-to-branch", 3)).toBe("completed and committed to their own branches");
    expect(completedWords("commit-to-branch", 1)).toBe("completed and committed to its own branch");
    expect(completedWords("open-pr", 3)).toBe("completed, each with a pull request open");
    expect(completedWords("open-pr", 1)).toBe("completed, with a pull request open");
    expect(completedWords("custom", 3)).toBe("completed");
  });

  it("claims only what the way of landing work guarantees for a stopped task", () => {
    expect(whereTheWorkIs("merge-back", "main")).toBe("this task's changes were not added to main.");
    expect(whereTheWorkIs("custom", "main")).toBe("your own closer was told this task stopped; check what it did.");
    expect(whereTheWorkIs("open-pr", null)).toBe("not recorded.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/report/plain.test.ts`
Expected: FAIL: the file cannot be loaded (`Cannot find module './plain.js'` or the equivalent resolution error).

- [ ] **Step 4: Create `src/report/plain.ts`**

Every table is a `Record` over a closed union, and both `switch` statements are exhaustive with no `default`, so a new kind of stop or a new way of landing work does not compile until it has words.

```ts
import { USAGE_LIMIT_WORDS } from "../ports.js";
import type { OutcomeCause, UsageLimit } from "../schema.js";
import type { Audience, Plain, PlainGroup } from "./document.js";

/** What `plainOf` reads of a stopped task: facts from its record, never prose to paraphrase. */
export interface PlainFacts {
  runId: string;
  cause: OutcomeCause | null;
  /** Whether the task's last setback was the agent saying it could not finish, rather than the check failing. */
  agentStuck: boolean;
  /** How many times the agent was set to work on the task. */
  attempts: number;
  /** The usage limit that stopped the task's last session, when one did. */
  limit: UsageLimit | null;
  agentSaid: string | null;
  /** Whether the project's list asks for this task, so the owner can amend or remove it there. */
  listed: boolean;
}

/** Every kind of stop the report has words for. Closed, so each table below is total over it. */
type Stop =
  | "say_so"
  | "say_so_in_repair"
  | "asked"
  | "could_not_start"
  | "check_still_fails"
  | "agent_stuck"
  | "never_finished"
  | "usage_limit"
  | "abandoned"
  | "check_cannot_run"
  | "repairs_ran_out"
  | "repair_gave_up"
  | "hand_off_failed"
  | "could_not_decide"
  | "no_working_copy"
  | "unexplained";

/** Which kind of stop a record's facts describe. A cause this build does not know in full is unexplained, never guessed at. */
function stopOf({ cause, agentStuck, limit }: PlainFacts): Stop {
  if (cause === null) return "unexplained";
  switch (cause.kind) {
    case "authority":
      return cause.role === "gate-maintenance" ? "say_so_in_repair" : "say_so";
    case "triage_escalated":
      return "asked";
    case "session_not_run":
      return "could_not_start";
    case "triage_abort":
      return "abandoned";
    case "repair_gave_up":
      return "repair_gave_up";
    case "triage_failure":
      return "could_not_decide";
    case "provisioning":
      return "no_working_copy";
    case "budget":
      switch (cause.population) {
        case "correction":
          return agentStuck ? "agent_stuck" : "check_still_fails";
        case "terminus":
          return limit === null ? "never_finished" : "usage_limit";
        case "gateError":
          return "check_cannot_run";
        case "gateMaintenance":
          return "repairs_ran_out";
        case "close":
          return "hand_off_failed";
        case undefined:
          return "unexplained";
      }
  }
}

const GROUP: Record<Stop, PlainGroup> = {
  say_so: "needs_your_decision",
  say_so_in_repair: "needs_your_decision",
  asked: "needs_your_decision",
  could_not_start: "needs_your_decision",
  check_still_fails: "failed_after_attempts",
  agent_stuck: "failed_after_attempts",
  never_finished: "failed_after_attempts",
  usage_limit: "failed_after_attempts",
  abandoned: "abandoned",
  check_cannot_run: "needs_an_engineer",
  repairs_ran_out: "needs_an_engineer",
  repair_gave_up: "needs_an_engineer",
  hand_off_failed: "needs_an_engineer",
  could_not_decide: "needs_an_engineer",
  no_working_copy: "needs_an_engineer",
  unexplained: "stopped",
};

const AUDIENCE: Record<PlainGroup, Audience> = {
  needs_your_decision: "owner",
  failed_after_attempts: "owner",
  abandoned: "owner",
  needs_an_engineer: "engineer",
  stopped: "unknown",
};

const attemptsWord = (count: number): string => `${count} ${count === 1 ? "attempt" : "attempts"}`;
const timesWord = (count: number): string => (count === 1 ? "once" : `${count} times`);

const NOT_YOURS = "This is a problem with the setup, not a decision for you.";

/** What kind of stop it was, in fixed words. The only figures are counts from the record. */
const SENTENCE: Record<Stop, (facts: PlainFacts) => string> = {
  say_so: () => "Needs your decision. The agent stopped and said it could not go on without your say-so.",
  say_so_in_repair: () => "Needs your decision. While repairing the check, the agent stopped and said it could not go on without your say-so.",
  asked: () => "Needs your decision. The agent stopped and asked for a person to decide.",
  could_not_start: () => "Needs you. The agent could not be started, which usually means a sign-in or credential only you can supply.",
  check_still_fails: ({ attempts }) =>
    `Failed after ${attemptsWord(attempts)}. The agent tried ${timesWord(attempts)} and the check you set up still does not pass.`,
  agent_stuck: ({ attempts }) => `Failed after ${attemptsWord(attempts)}. The agent tried ${timesWord(attempts)} and said it could not finish the task.`,
  never_finished: ({ attempts }) =>
    `Failed after ${attemptsWord(attempts)}. The agent was started ${timesWord(attempts)} and each time stopped without finishing.`,
  // `limit` is non-null whenever the stop is `usage_limit`; the fallback keeps the table free of assertions.
  usage_limit: ({ limit }) => `Stopped because a usage limit was reached: ${limit === null ? "which one was not recorded" : USAGE_LIMIT_WORDS[limit]}.`,
  abandoned: () => "Abandoned. The agent judged that this task cannot be done as it is written.",
  check_cannot_run: () => `The check you set up could not be run, even after trying it again. ${NOT_YOURS}`,
  repairs_ran_out: () => `The check you set up could not be run, and repairing it did not work. ${NOT_YOURS}`,
  repair_gave_up: () => `The check you set up could not be repaired automatically. ${NOT_YOURS}`,
  hand_off_failed: () => `The work passed the check you set up, but it could not be handed off. ${NOT_YOURS}`,
  could_not_decide: () => `After a setback, the harness could not work out what to do next. ${NOT_YOURS}`,
  no_working_copy: () => `A working copy of your project could not be set up, so the agent never started. ${NOT_YOURS}`,
  unexplained: () => "Stopped. The record does not say what kind of stop this was.",
};

/** The route that works for each kind of stop. A finished task is never resumed, and running an unchanged list again only retells it. */
type Route = "decide" | "reword" | "sign_in" | "wait" | "engineer" | "none";

const ROUTE: Record<Stop, Route> = {
  say_so: "decide",
  say_so_in_repair: "decide",
  asked: "decide",
  could_not_start: "sign_in",
  check_still_fails: "reword",
  agent_stuck: "reword",
  never_finished: "reword",
  usage_limit: "wait",
  abandoned: "reword",
  check_cannot_run: "engineer",
  repairs_ran_out: "engineer",
  repair_gave_up: "engineer",
  hand_off_failed: "engineer",
  could_not_decide: "engineer",
  no_working_copy: "engineer",
  unexplained: "none",
};

const RUN_LIST = "Run: delivery run";
// ponytail: `--task` matches a list entry written as a sentence. An entry written as an object with extra keys is not
// matched by it, so the list would retell the old outcome; say so here if such lists turn up.
const RUN_AGAIN_ALONE = 'Run this task again on its own: delivery run --task "<the task, exactly as it is written>"';
const THEN_THE_LIST = "Then carry on with your list: delivery run";
const RUN_REWORDED = 'delivery run --task "<the reworded task>"';

/** What to do about it, in order. `listed` decides whether the task is amended in the list or typed again. */
const NEXT: Record<Route, (facts: PlainFacts) => string[]> = {
  decide: ({ listed }) =>
    listed
      ? ["Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.", RUN_LIST]
      : [`Decide. To say yes, run the task again with the permission in its wording: ${RUN_REWORDED}. To say no, do nothing more.`],
  reword: ({ listed }) =>
    listed ? ["Reword the task, or remove it from your list.", RUN_LIST] : [`Reword the task and run it again: ${RUN_REWORDED}`],
  sign_in: ({ listed }) => ["Check that the agent can sign in on this machine.", RUN_AGAIN_ALONE, ...(listed ? [THEN_THE_LIST] : [])],
  wait: ({ listed }) => ["Wait until the limit no longer applies.", RUN_AGAIN_ALONE, ...(listed ? [THEN_THE_LIST] : [])],
  engineer: ({ runId }) => [`Pass this to whoever maintains your checks: delivery status ${runId}`],
  none: () => [],
};

/** A stopped task in the owner's words. Total: every record gets a group, and one with no cause gets no advice. */
export function plainOf(facts: PlainFacts): Plain {
  const stop = stopOf(facts);
  const group = GROUP[stop];
  return { group, audience: AUDIENCE[group], sentence: SENTENCE[stop](facts), agentSaid: facts.agentSaid, next: NEXT[ROUTE[stop]](facts) };
}

/** How a project lands its work. `ReportSurface.closer`, without the null a task with no run has. */
export type Landing = "merge-back" | "commit-to-branch" | "open-pr" | "custom";

const NOT_RECORDED = "not recorded";

/** Where a delivered task's work went. Total over the ways of landing work, so a new one does not compile until it has words. */
export function landedWords(closer: Landing, branch: string | null, base: string | null): string {
  switch (closer) {
    case "merge-back":
      return `merged into ${base ?? `your base branch (${NOT_RECORDED})`}`;
    case "commit-to-branch":
      return `committed on branch ${branch ?? NOT_RECORDED}`;
    case "open-pr":
      return `on branch ${branch ?? NOT_RECORDED}, with a pull request open`;
    case "custom":
      return "your own closer handled this task; check what it did";
  }
}

/** What "completed" meant for the `count` tasks that were delivered, when they all landed the same way. Total over the ways of landing work. */
export function completedWords(closer: Landing, count: number): string {
  switch (closer) {
    case "merge-back":
      return "completed and merged";
    case "commit-to-branch":
      return count === 1 ? "completed and committed to its own branch" : "completed and committed to their own branches";
    case "open-pr":
      return count === 1 ? "completed, with a pull request open" : "completed, each with a pull request open";
    case "custom":
      return "completed";
  }
}

/** Where a stopped task's work is: only what the way of landing work guarantees, never that work was kept or that nothing changed. */
export function whereTheWorkIs(closer: Landing, base: string | null): string {
  if (closer === "custom") return "your own closer was told this task stopped; check what it did.";
  return base === null ? `${NOT_RECORDED}.` : `this task's changes were not added to ${base}.`;
}

/** The five kinds of retry, as the owner reads them. */
export const RETRY_WORDS: Record<"correction" | "gateError" | "gateMaintenance" | "terminus" | "close", string> = {
  correction: "agent corrections",
  gateError: "check re-runs",
  gateMaintenance: "check repairs",
  terminus: "agent restarts",
  close: "hand-off retries",
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/report/plain.test.ts`
Expected: PASS (every test).

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/report/document.ts src/report/plain.ts src/report/plain.test.ts
git commit -m "Say what kind of stop a task had, in the owner's words" -m "A report is only useful if it says who must act and what to do, without the harness's own vocabulary. The wording is closed tables over a closed set of stops, so it cannot contradict the record, costs nothing to produce, and a new kind of stop cannot ship without words."
```

---

### Task 5: Derive the report from the record ✅ DONE (deliver-slice)

**Files:**
- Create: `src/report/derive.ts`
- Test: `src/report/derive.test.ts`

**Interfaces:**
- Consumes: `RecordSnapshot`, `ReportSubject`, `DamagedFile` (`src/report/snapshot.ts`, Task 3); the document types and `REPORT_SCHEMA` (`src/report/document.ts`, Task 4); `plainOf` (`src/report/plain.ts`, Task 4); `deriveBudgetsFromLog` (`src/case-file.ts`), `repairsUsed` (`src/breaker.ts`), `branchName` (`src/provision.ts`), `supervisedView` and `claimedBy` (`src/supervised-view.ts`), `findQueueRun`, `queuePositionOf`, `taskIntent` (`src/task-list.ts`), `newestFirstBy`, `startedInstant` (`src/run-records.ts`): all existing or from Task 1.
- Produces:
  ```ts
  export function deriveReport(snapshot: RecordSnapshot): ReportDocument
  export function mostRecentSubject(snapshot: RecordSnapshot): ReportSubject | undefined
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/report/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ReportDocument } from "./document.js";
import { deriveReport, mostRecentSubject } from "./derive.js";
import { attempt, BANNER, closedAt, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, ID, recordOf, runFileOf, snapshotOf, stoppedAt } from "./report-fixtures.js";

describe("a report on the project's task list", () => {
  it("stands each task as its latest run left it, and a task with no run as not started", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(doc.kind).toBe("list");
    expect(doc.surfaces.map((surface) => [surface.queue?.task, surface.task, surface.standing, surface.run])).toEqual([
      [1, FORM, "closed", ID.form],
      [2, FOOTER, "escalated", ID.footer],
      [3, HOMEPAGE, "not_started", null],
      [4, BANNER, "not_started", null],
    ]);
    expect(doc.counts).toEqual({ closed: 1, escalated: 1, aborted: 0, paused: 0, unfinished: 0, queued: 0, not_started: 2 });
  });

  it("invents no run for a list worked one task at a time, and knows it is not going once every run has ended", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(doc.run).toBeNull();
    expect(doc.live).toBe(false);
  });

  it("does not claim to know whether a task with no outcome is still going", () => {
    expect(deriveReport(snapshotOf({ records: [formDone, footerWorking] })).live).toBeNull();
  });

  it("takes the newest run of a task as the one that answers for it", () => {
    const again = recordOf({ runId: "fix-the-broken-footer-links-20261002T090000Z", task: FOOTER, history: attempt(1, "fixed"), outcome: closedAt("2026-10-02T09:10:00.000Z") });

    const doc = deriveReport(snapshotOf({ records: [footerFailed, again] }));

    expect(doc.surfaces[1]).toMatchObject({ run: again.runId, standing: "closed" });
  });

  it("validates against its own schema, with every key present", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(ReportDocument.parse(doc)).toEqual(doc);
    expect(Object.keys(doc.surfaces[2] ?? {}).sort()).toEqual(Object.keys(doc.surfaces[0] ?? {}).sort());
  });
});

describe("what a report says of one task", () => {
  const [, failed] = deriveReport(snapshotOf({ records: [formDone, footerFailed] })).surfaces;

  it("counts how many times the agent was set to work, and the retries the log shows", () => {
    expect(failed?.attempts).toBe(4);
    expect(failed?.budgets).toEqual([
      { population: "correction", used: 3, max: 3 },
      { population: "gateError", used: 0, max: 3 },
      { population: "gateMaintenance", used: 0, max: 2 },
      { population: "terminus", used: 0, max: 5 },
      { population: "close", used: 0, max: 3 },
    ]);
  });

  it("carries the recorded reason and cause, and the stop in the owner's words", () => {
    expect(failed).toMatchObject({
      reason: "correction budget exhausted (3/3)",
      cause: { kind: "budget", population: "correction" },
      finishedAt: "2026-10-01T02:58:00.000Z",
      startedAt: "2026-10-01T02:20:00Z",
      plain: { group: "failed_after_attempts", audience: "owner", agentSaid: "I fixed 4 of the 6 links.\nThe other 2 point at pages that no longer exist." },
    });
  });

  it("says how the task lands its work, and where", () => {
    expect(failed).toMatchObject({ closer: "merge-back", branch: `surface/${ID.footer}`, base: "main" });
  });

  it("reads a record that pinned no closer as committed to its own branch, as such runs were", () => {
    const old = recordOf({ runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

    expect(deriveReport(snapshotOf({ records: [old] })).surfaces[0]?.closer).toBe("commit-to-branch");
  });

  it("gives a delivered task no plain block: there is nothing to act on", () => {
    expect(deriveReport(snapshotOf({ records: [formDone] })).surfaces[0]?.plain).toBeNull();
  });

  it("quotes nothing as the agent's when its last session ended without a result", () => {
    const cutOff = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [
        ...attempt(1, "an earlier explanation"),
        { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" },
        { t: "terminus", role: "worker", attempt: 2, sessionKey: "worker-2-0", status: "incomplete", rationale: "the AI service is limiting requests", limit: "rate" },
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "terminus" }),
    });

    const [, surface] = deriveReport(snapshotOf({ records: [formDone, cutOff] })).surfaces;

    expect(surface?.plain?.agentSaid).toBeNull();
    expect(surface?.limit).toBe("rate");
    expect(surface?.plain?.sentence).toBe("Stopped because a usage limit was reached: the AI service is limiting requests.");
  });

  it("groups a stop recorded before causes were as stopped, with the recorded reason and no advice", () => {
    const old = recordOf({ runId: ID.footer, task: FOOTER, history: attempt(1, "I gave up"), outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)") });

    const [, surface] = deriveReport(snapshotOf({ records: [formDone, old] })).surfaces;

    expect(surface).toMatchObject({ cause: null, reason: "correction budget exhausted (3/3)", plain: { group: "stopped", audience: "unknown", next: [] } });
  });
});

describe("a report on a run of several tasks at once", () => {
  const working = footerWorking;
  const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);

  it("stands its tasks as the run's own view does, with the tasks still to take waiting", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone, working], runs: [going] }));

    expect(doc.surfaces.map((surface) => [surface.queue?.task, surface.standing])).toEqual([[1, "closed"], [2, "unfinished"], [3, "queued"], [4, "queued"]]);
    expect(doc.live).toBe(true);
    expect(doc.run).toMatchObject({ runId: ID.run, startedAt: "2026-10-01T02:00:00Z", concurrency: 2, outcome: null, finishedAt: null });
  });

  it("is not going when nothing holds the repository, even though it has not finished", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: false, records: [formDone, working], runs: [going] }));

    expect(doc.live).toBe(false);
  });

  it("is never going once it has an outcome, whoever holds the repository now", () => {
    const drained = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" });

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone], runs: [drained] }));

    expect(doc.live).toBe(false);
    expect(doc.run).toMatchObject({ outcome: "drained", finishedAt: "2026-10-01T05:47:00.000Z", cause: null, reason: null });
  });

  it("says why the run itself stopped, and how many shared repairs it used", () => {
    const gaveUp = runFileOf(
      ID.run,
      [
        fill(1, ID.form, FORM),
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.form, reason: "the check cannot run" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1", surfaceId: ID.form },
        { t: "repair_terminus", attempt: 1, sessionKey: "repair-1", status: "incomplete", rationale: "limited" },
        { t: "run_escalated", reason: "the repair could not run", limit: "spend" },
      ],
      { kind: "escalated", cause: "usage_limit", reason: "the repair could not run", at: "2026-10-01T02:30:00.000Z" },
    );

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [], runs: [gaveUp] }));

    expect(doc.run).toMatchObject({ outcome: "escalated", cause: "usage_limit", limit: "spend", reason: "the repair could not run", runBudgets: { gateMaintenance: { used: 1, max: 2 } } });
  });

  it("is the run a list report names once it took one of the list's tasks", () => {
    const drained = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" });

    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed], runs: [drained] }));

    expect(doc.kind).toBe("list");
    expect(doc.run?.runId).toBe(ID.run);
    expect(doc.live).toBe(false);
  });

  it("gives a list report its tasks' standings while it is going", () => {
    const doc = deriveReport(snapshotOf({ live: true, records: [formDone, working], runs: [going] }));

    expect(doc.live).toBe(true);
    expect(doc.surfaces.map((surface) => surface.standing)).toEqual(["closed", "unfinished", "queued", "queued"]);
  });
});

describe("a report on one task's run", () => {
  it("reports that task alone, with its place on the list", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [formDone, footerFailed] }));

    expect(doc.kind).toBe("task");
    expect(doc.surfaces.map((surface) => [surface.run, surface.queue])).toEqual([[ID.footer, { task: 2, of: 4 }]]);
    expect(doc.live).toBe(false);
  });

  it("treats a task the list does not ask for as typed by hand", () => {
    const adHoc = recordOf({ runId: ID.homepage, task: "something else", history: attempt(1, "no"), outcome: stoppedAt("2026-10-01T03:10:00.000Z", { kind: "budget", population: "correction" }) });

    const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.homepage }, records: [adHoc] })).surfaces;

    expect(surface?.queue).toBeNull();
    expect(surface?.plain?.next).toEqual(['Reword the task and run it again: delivery run --task "<the reworded task>"']);
  });

  it("knows an unfinished task is going only when a run of several that took it holds the repository", () => {
    const working = footerWorking;
    const going = runFileOf(ID.run, [fill(1, ID.footer, FOOTER)]);
    const subject = { kind: "task", runId: ID.footer } as const;

    expect(deriveReport(snapshotOf({ subject, live: true, records: [working], runs: [going] })).live).toBe(true);
    expect(deriveReport(snapshotOf({ subject, live: false, records: [working], runs: [] })).live).toBeNull();
  });
});

describe("a damaged record", () => {
  const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };

  it("is named with its file and its place on the list, and leaves the other tasks reported", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone], damaged: [damaged] }));

    expect(doc.incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: { task: 2, of: 4 } }]);
    expect(doc.surfaces.map((surface) => surface.queue?.task)).toEqual([1, 3, 4]);
  });

  it("is passed over when a newer run of the same task reads back", () => {
    const again = recordOf({ runId: "fix-the-broken-footer-links-20261002T090000Z", task: FOOTER, history: attempt(1, "fixed"), outcome: closedAt("2026-10-02T09:10:00.000Z") });

    const doc = deriveReport(snapshotOf({ records: [formDone, again], damaged: [damaged] }));

    expect(doc.incomplete).toEqual([]);
    expect(doc.surfaces[1]).toMatchObject({ run: again.runId, standing: "closed" });
  });

  it("is still named when too damaged to say which task it was for", () => {
    const unknown = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/case.json` };

    expect(deriveReport(snapshotOf({ records: [formDone], damaged: [unknown] })).incomplete).toEqual([{ run: ID.footer, file: unknown.file, queue: null }]);
  });

  it("makes a report on that run alone an incomplete report of nothing, not a failure", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, damaged: [damaged] }));

    expect(doc.surfaces).toEqual([]);
    expect(doc.incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: { task: 2, of: 4 } }]);
  });

  it("is left out of a run of several that took it, and named instead", () => {
    const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone], runs: [going], damaged: [damaged] }));

    expect(doc.incomplete.map((record) => record.run)).toEqual([ID.footer]);
    expect(doc.surfaces.map((surface) => surface.queue?.task)).toEqual([1, 3, 4]);
  });
});

describe("the run a project with no task list is told about", () => {
  it("is the one started most recently, a run of several counting once", () => {
    const run = runFileOf(ID.run, [fill(1, ID.form, FORM)]);

    expect(mostRecentSubject(snapshotOf({ list: [], records: [formDone, footerFailed], runs: [run] }))).toEqual({ kind: "task", runId: ID.footer });
    expect(mostRecentSubject(snapshotOf({ list: [], records: [formDone], runs: [run] }))).toEqual({ kind: "run", runId: ID.run });
  });

  it("is a damaged record when that is the newest run, rather than an older run passed off as the latest", () => {
    const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };
    const snapshot = snapshotOf({ list: [], records: [formDone], damaged: [damaged] });

    expect(mostRecentSubject(snapshot)).toEqual({ kind: "task", runId: ID.footer });
    expect(deriveReport({ ...snapshot, subject: { kind: "task", runId: ID.footer } }).incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: null }]);
  });

  it("is nothing when the folder holds no run at all", () => {
    expect(mostRecentSubject(snapshotOf({ list: [] }))).toBeUndefined();
  });
});

describe("determinism", () => {
  it("gives the same document for the same snapshot", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed] });

    expect(deriveReport(snapshot)).toEqual(deriveReport(structuredClone(snapshot)));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/report/derive.test.ts`
Expected: FAIL: the file cannot be loaded (`Cannot find module './derive.js'` or the equivalent resolution error).

- [ ] **Step 3: Create `src/report/derive.ts`**

Nothing here reads a file or a clock. Retries come from `deriveBudgetsFromLog`, the fold resuming uses; the standings of a run of several come from `supervisedView`, which `delivery status` uses.

```ts
import { isDeepStrictEqual } from "node:util";
import { repairsUsed } from "../breaker.js";
import { deriveBudgetsFromLog } from "../case-file.js";
import { branchName } from "../provision.js";
import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
import type { RunFile, TaskDef } from "../schema.js";
import { claimedBy, supervisedView } from "../supervised-view.js";
import { findQueueRun, queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
import { REPORT_SCHEMA, Standing, type DamagedRecord, type ReportDocument, type ReportRun, type ReportSurface } from "./document.js";
import { plainOf } from "./plain.js";
import type { DamagedFile, RecordSnapshot, ReportSubject } from "./snapshot.js";

const POPULATIONS = ["correction", "gateError", "gateMaintenance", "terminus", "close"] as const;

/** A task with no run of its own yet: every fact about a run is null. */
function withoutRun(taskDef: TaskDef, queue: QueuePosition | null, standing: Standing): ReportSurface {
  return {
    run: null,
    task: taskIntent(taskDef),
    queue,
    standing,
    startedAt: null,
    finishedAt: null,
    reason: null,
    cause: null,
    closer: null,
    branch: null,
    base: null,
    attempts: 0,
    budgets: [],
    limit: null,
    plain: null,
  };
}

/** One task from its own record. The retries are the log's, by the fold resuming uses, so a report and a resume cannot disagree. */
function withRun(record: RunRecord, queue: QueuePosition | null, standing: Standing): ReportSurface {
  const { header, history, outcome, cursor } = record.caseFile;
  const budgets = deriveBudgetsFromLog(history, cursor.budgets);
  const lastSession = history.findLast((entry) => entry.t === "terminus");
  const attempts = history.filter((entry) => entry.t === "dispatch" && (entry.role ?? "worker") === "worker").length;
  const limit = lastSession?.limit ?? null;
  const cause = outcome?.cause ?? null;
  // A session that ended without a result has no words of the agent's: its rationale is the harness's own.
  const agentSaid = lastSession !== undefined && lastSession.status !== "incomplete" && lastSession.rationale.trim() !== "" ? lastSession.rationale : null;
  return {
    run: record.runId,
    task: taskIntent(header.taskDef),
    queue,
    standing,
    startedAt: startedInstant(record.runId),
    finishedAt: outcome?.at ?? null,
    reason: outcome?.reason ?? null,
    cause,
    // A run that pinned no closer predates closers being pinned, and was committed to its branch.
    closer: header.closerRef?.type ?? "commit-to-branch",
    branch: branchName(header.surfaceId),
    base: header.baseBranch ?? null,
    attempts,
    budgets: POPULATIONS.map((population) => ({ population, used: budgets[population].used, max: budgets[population].max })),
    limit,
    plain:
      standing === "escalated" || standing === "aborted"
        ? plainOf({
            runId: record.runId,
            cause,
            agentStuck: history.findLast((entry) => entry.t === "triage")?.trigger === "worker_escalate",
            attempts,
            limit,
            agentSaid,
            listed: queue !== null,
          })
        : null,
  };
}

function runBlock(runFile: RunFile): ReportRun {
  const { header, history, outcome } = runFile;
  const escalated = outcome?.kind === "escalated" ? outcome : undefined;
  return {
    runId: header.runId,
    startedAt: startedInstant(header.runId),
    tasks: header.tasks,
    concurrency: header.concurrency,
    outcome: outcome?.kind ?? null,
    finishedAt: outcome?.at ?? null,
    reason: escalated?.reason ?? null,
    cause: escalated?.cause ?? null,
    limit: history.findLast((entry) => entry.t === "run_escalated")?.limit ?? null,
    runBudgets: { gateMaintenance: { used: repairsUsed(history), max: header.runBudgetMax.gateMaintenance } },
  };
}

function document(
  snapshot: RecordSnapshot,
  parts: { live: boolean | null; run: ReportRun | null; surfaces: ReportSurface[]; incomplete: DamagedRecord[] },
): ReportDocument {
  const counts = Object.fromEntries(Standing.options.map((standing) => [standing, 0])) as Record<Standing, number>;
  for (const surface of parts.surfaces) counts[surface.standing] += 1;
  return { schema: REPORT_SCHEMA, kind: snapshot.subject.kind, counts, ...parts };
}

const asIncomplete = (damaged: DamagedFile, list: TaskDef[]): DamagedRecord => ({
  run: damaged.runId,
  file: damaged.file,
  queue: damaged.taskDef === undefined ? null : (queuePositionOf(list, damaged.taskDef) ?? null),
});

/** One task's own run. */
function taskReport(snapshot: RecordSnapshot, runId: string): ReportDocument {
  const { records, runs, list, live } = snapshot;
  const record = records.find((candidate) => candidate.runId === runId);
  if (record === undefined) {
    const incomplete = snapshot.damaged.filter((damaged) => damaged.runId === runId).map((damaged) => asIncomplete(damaged, list));
    return document(snapshot, { live: false, run: null, surfaces: [], incomplete });
  }
  const finished = record.caseFile.outcome !== undefined;
  // Only a run of several at once holds the lock, so only a task one of those took can be known to be going.
  const taken = runs.some((run) => run.outcome === undefined && claimedBy(run).some((claim) => claim.surfaceId === runId));
  const surface = withRun(record, queuePositionOf(list, record.caseFile.header.taskDef) ?? null, record.caseFile.outcome?.kind ?? "unfinished");
  return document(snapshot, { live: finished ? false : taken ? live : null, run: null, surfaces: [surface], incomplete: [] });
}

/** The tasks of one run of several at once, as `supervisedView` stands them, less any whose record is damaged. */
function runSurfaces(snapshot: RecordSnapshot, runFile: RunFile, live: boolean): { surfaces: ReportSurface[]; incomplete: DamagedRecord[] } {
  const { records, list } = snapshot;
  const claimed = new Set(claimedBy(runFile).map((claim) => claim.surfaceId));
  const damaged = snapshot.damaged.filter((file) => claimed.has(file.runId));
  const view = supervisedView(runFile, records, list, live);
  const surfaces = view.tasks
    // A damaged record's task reads as waiting to the view, which only knows it has no record: it is reported as damaged instead.
    .filter((task) => task.record !== undefined || !damaged.some((file) => isDeepStrictEqual(file.taskDef, task.taskDef)))
    .map((task) =>
      task.record ? withRun(task.record, task.position ?? null, task.standing) : withoutRun(task.taskDef, task.position ?? null, task.standing),
    );
  return { surfaces, incomplete: damaged.map((file) => asIncomplete(file, list)) };
}

/** One run of several tasks at once. */
function runReport(snapshot: RecordSnapshot, runId: string): ReportDocument {
  const runFile = snapshot.runs.find((run) => run.header.runId === runId);
  if (runFile === undefined) {
    const incomplete = snapshot.damaged.filter((damaged) => damaged.runId === runId).map((damaged) => asIncomplete(damaged, snapshot.list));
    return document(snapshot, { live: false, run: null, surfaces: [], incomplete });
  }
  const live = runFile.outcome === undefined && snapshot.live;
  return document(snapshot, { live, run: runBlock(runFile), ...runSurfaces(snapshot, runFile, live) });
}

/**
 * The project's task list as the owner experiences it: each task as written
 * now, with the latest run that answers for it. A list worked down one task at
 * a time has no run of its own, so none is invented: a task with no run yet is
 * `not_started`.
 */
function listReport(snapshot: RecordSnapshot): ReportDocument {
  const { list, records, runs } = snapshot;
  // The run of several at once this list was last worked by, if any: the newest that took one of its tasks.
  const run = newestFirstBy(
    runs.filter((candidate) => claimedBy(candidate).some((claim) => queuePositionOf(list, claim.taskDef) !== undefined)),
    (candidate) => candidate.header.runId,
  ).at(0);
  const going = run !== undefined && run.outcome === undefined;
  const live = going && snapshot.live;
  const inRun = going ? runSurfaces(snapshot, run, live) : { surfaces: [], incomplete: [] };

  const incomplete: DamagedRecord[] = [...inRun.incomplete];
  const surfaces: ReportSurface[] = [];
  list.forEach((taskDef, index) => {
    const queue: QueuePosition = { task: index + 1, of: list.length };
    if (incomplete.some((damaged) => damaged.queue?.task === queue.task)) return;
    const taken = inRun.surfaces.find((surface) => surface.queue?.task === queue.task);
    if (taken) return void surfaces.push(taken);

    const record = findQueueRun(records, taskDef);
    // A damaged record answers for the task when it is the newest run of it: an older readable run would be stale news.
    const damaged = newestFirstBy(
      snapshot.damaged.filter((file) => isDeepStrictEqual(file.taskDef, taskDef)),
      (file) => file.runId,
    ).at(0);
    if (damaged && (record === undefined || (startedInstant(damaged.runId) ?? "") > (startedInstant(record.runId) ?? ""))) {
      return void incomplete.push({ run: damaged.runId, file: damaged.file, queue });
    }
    surfaces.push(record ? withRun(record, queue, record.caseFile.outcome?.kind ?? "unfinished") : withoutRun(taskDef, queue, "not_started"));
  });
  // A record too damaged to say which task it was for may be one of this list's: named, so the report is marked incomplete.
  for (const file of snapshot.damaged) {
    if (file.taskDef === undefined && !incomplete.some((damaged) => damaged.run === file.runId)) incomplete.push(asIncomplete(file, list));
  }

  const unfinished = surfaces.some((surface) => surface.standing === "unfinished");
  return document(snapshot, {
    live: going ? live : unfinished ? null : false,
    run: run ? runBlock(run) : null,
    surfaces,
    incomplete,
  });
}

/**
 * The run a report falls back to when the project has no task list: the one
 * started most recently, a run of several at once counting as one run and its
 * tasks as part of it. A damaged record is still a run: when it is the newest,
 * it is the subject, so the report names it rather than passing an older run
 * off as the latest. Nothing when the folder holds no run at all.
 */
export function mostRecentSubject(snapshot: RecordSnapshot): ReportSubject | undefined {
  const taken = new Set(snapshot.runs.flatMap((run) => claimedBy(run).map((claim) => claim.surfaceId)));
  const subjects: Exclude<ReportSubject, { kind: "list" }>[] = [
    ...snapshot.runs.map((run) => ({ kind: "run" as const, runId: run.header.runId })),
    ...snapshot.records.filter((record) => !taken.has(record.runId)).map((record) => ({ kind: "task" as const, runId: record.runId })),
    ...snapshot.damaged.filter((file) => !taken.has(file.runId)).map((file) => ({ kind: "task" as const, runId: file.runId })),
  ];
  return newestFirstBy(subjects, (subject) => subject.runId).at(0);
}

/**
 * What happened, as one document. Pure, total and deterministic over the
 * snapshot: it reads no file and no clock, so the same record always gives the
 * same report.
 */
export function deriveReport(snapshot: RecordSnapshot): ReportDocument {
  const { subject } = snapshot;
  switch (subject.kind) {
    case "task":
      return taskReport(snapshot, subject.runId);
    case "run":
      return runReport(snapshot, subject.runId);
    case "list":
      return listReport(snapshot);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/report/derive.test.ts`
Expected: PASS (30 tests).

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/report/derive.ts src/report/derive.test.ts
git commit -m "Derive one report document from the record" -m "Every rendering, now and in later slices, reads this one document, so two views of a run cannot disagree. It is worked out by the folds resuming already uses, from a snapshot alone, so the same record always gives the same report."
```

---

### Task 6: Print the report as plain lines ✅ DONE (deliver-slice)

**Files:**
- Create: `src/report/text.ts`
- Test: `src/report/text.test.ts`

**Interfaces:**
- Consumes: `ReportDocument`, `ReportSurface`, `ReportRun`, `DamagedRecord` (Task 4); `completedWords`, `landedWords`, `whereTheWorkIs`, `RETRY_WORDS`, `Landing` (Task 4); `paint`, `Tone` (`src/paint.ts`, Task 1); `USAGE_LIMIT_WORDS` (`src/ports.ts`); `deriveReport` (Task 5) and the fixtures (Task 3) in the tests.
- Produces (`src/report/text.ts`):
  ```ts
  export const NO_RUNS_YET = "No runs yet in this folder. Start one with: delivery run";
  export const NO_TASK_LIST = "This project has no task list, so this is its most recent run.";
  export function stripControl(text: string): string
  export function renderText(doc: ReportDocument, options: { colour: boolean }): string[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/report/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveReport } from "./derive.js";
import {
  attempt,
  BANNER,
  closedAt,
  fill,
  FOOTER,
  footerFailed,
  footerWorking,
  FORBIDDEN,
  FORM,
  formDone,
  HOMEPAGE,
  homepageAsks,
  ID,
  recordOf,
  runFileOf,
  snapshotOf,
  stoppedAt,
} from "./report-fixtures.js";
import type { RecordSnapshot } from "./snapshot.js";
import { renderText, stripControl } from "./text.js";

const report = (snapshot: RecordSnapshot): string[] => renderText(deriveReport(snapshot), { colour: false });

const bannerDone = recordOf({ runId: ID.banner, task: BANNER, closerRef: { type: "merge-back" }, history: attempt(1, "done"), outcome: closedAt("2026-10-01T05:47:00.000Z") });
const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
const stopped = (cause: Parameters<typeof stoppedAt>[1], history = attempt(1, "done")): RecordSnapshot =>
  snapshotOf({ records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, closerRef: { type: "merge-back" }, history, outcome: stoppedAt("2026-10-01T02:58:00.000Z", cause) })] });

describe("the report on a list worked one task at a time", () => {
  it("reads, in full, as what happened and what to do", () => {
    expect(report(snapshotOf({ records: [formDone, footerFailed] }))).toEqual([
      "Your task list: 1 of 4 tasks completed and merged; 1 failed after 4 attempts; 2 not started.",
      "Started 1 Oct 02:01 UTC; last activity 1 Oct 02:58 UTC.",
      "",
      "NEEDS YOU (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.",
      '    The agent said: "I fixed 4 of the 6 links.\n    The other 2 point at pages that no longer exist."',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Reword the task, or remove it from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
      "",
      "DONE (1)",
      '  Task 1 of 4: "Add a contact form": merged into main at 02:19',
      "",
      "NOT STARTED (2)",
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These are waiting behind task 2. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 2, then run `delivery run` to carry on with them.",
      "",
      "FOR WHOEVER TUNES THIS",
      "  Retries used across these tasks: agent corrections 3 of 6; check re-runs 0 of 6; check repairs 0 of 4; agent restarts 0 of 10; hand-off retries 0 of 6.",
      "  Time and cost were not recorded for this run.",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });

  it("says tasks nobody has run have not been started, and how to start them", () => {
    expect(report(snapshotOf())).toEqual([
      "Your task list: 0 of 4 tasks completed; 4 not started.",
      "",
      "NOT STARTED (4)",
      '  Task 1 of 4: "Add a contact form"',
      '  Task 2 of 4: "Fix the broken footer links"',
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These have not been started yet. To start them: delivery run",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });

  it("does not sound final, nor claim the work is going, when a task has no outcome", () => {
    const lines = report(snapshotOf({ records: [formDone, footerWorking] }));

    expect(lines.slice(0, 2)).toEqual([
      "Your task list has not finished (4 tasks: 1 done, 1 not finished, 2 not started); nothing records whether it is still going. If it is not, carry on with: delivery resume fix-the-broken-footer-links-20261001T022000Z",
      "Started 1 Oct 02:01 UTC; last activity not recorded.",
    ]);
    expect(lines).toContain('  Task 2 of 4: "Fix the broken footer links": not finished');
    expect(lines).toContain("    If it is no longer going, carry on with: delivery resume fix-the-broken-footer-links-20261001T022000Z");
    expect(lines).toContain("  These are waiting behind task 2. It has not finished, so they have been left alone.");
  });
});

describe("the report on a list worked several tasks at once", () => {
  const five = snapshotOf({
    records: [formDone, footerFailed, homepageAsks, bannerDone],
    runs: [runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER), fill(1, ID.homepage, HOMEPAGE), fill(2, ID.banner, BANNER)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" })],
  });

  it("opens with the counts, the run and how long it took", () => {
    expect(report(five).slice(0, 2)).toEqual([
      "Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 failed after 4 attempts.",
      "Run run-20261001T020000Z, 1 Oct 02:00 to 05:47 UTC (3 h 47 min), up to 2 tasks at once.",
    ]);
  });

  it("tells each stopped task apart: the kind of stop, the agent's own words, and the route", () => {
    const lines = report(five);

    expect(lines.slice(lines.indexOf('  Task 3 of 4: "Replace the old homepage"'), lines.indexOf("DONE (2)") - 1)).toEqual([
      '  Task 3 of 4: "Replace the old homepage"',
      "    Needs your decision. The agent stopped and said it could not go on without your say-so.",
      '    The agent said: "This would delete 14 published pages. I need the owner to confirm."',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status replace-the-old-homepage-20261001T030000Z",
    ]);
  });

  it("counts the shared repairs and ends on the run's own detail", () => {
    const lines = report(five);

    expect(lines).toContain("  Repairs of the setup every task shares: 0 of 2.");
    expect(lines.at(-1)).toBe("Next: delivery status run-20261001T020000Z (detail), delivery status --all (every run)");
  });

  it("says a run is still going, with no final headline", () => {
    const lines = report(snapshotOf({ live: true, records: [formDone, footerWorking], runs: [going] }));

    expect(lines.slice(0, 2)).toEqual([
      "Your task list is still being worked on (4 tasks: 1 done, 1 working, 2 waiting to start).",
      "Run run-20261001T020000Z, started 1 Oct 02:00 UTC, up to 2 tasks at once.",
    ]);
    expect(lines.slice(lines.indexOf("NOT FINISHED (3)"), lines.indexOf("NOT FINISHED (3)") + 4)).toEqual([
      "NOT FINISHED (3)",
      '  Task 2 of 4: "Fix the broken footer links": working',
      '  Task 3 of 4: "Replace the old homepage": waiting to start',
      '  Task 4 of 4: "Add a cookie banner": waiting to start',
    ]);
  });

  it("says a run that is no longer going stopped part way, and how to carry on", () => {
    const [first] = report(snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] }));

    expect(first).toBe("Work on your task list stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
  });

  it("says in words which usage limit stopped the run itself", () => {
    const limited = runFileOf(ID.run, [fill(1, ID.form, FORM), { t: "run_escalated", reason: "the repair could not run", limit: "spend" }], {
      kind: "escalated",
      cause: "usage_limit",
      reason: "the repair could not run",
      at: "2026-10-01T02:30:00.000Z",
    });

    expect(report(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone], runs: [limited] })).slice(0, 3)).toEqual([
      "This run stopped part way (4 tasks: 1 done, 3 waiting to start).",
      "Run run-20261001T020000Z, 1 Oct 02:00 to 02:30 UTC (30 min), up to 2 tasks at once.",
      "The run stopped because a usage limit was reached: the spending limit has been reached; no task caused this. Once the limit no longer applies, carry on with: delivery run",
    ]);
  });
});

describe("the report on one named run", () => {
  it("reports that run, and points back to the list", () => {
    const lines = report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [formDone, footerFailed] }));

    expect(lines[0]).toBe("This run: 0 of 1 task completed; 1 failed after 4 attempts.");
    expect(lines).toContain("  Retries used across this task: agent corrections 3 of 3; check re-runs 0 of 3; check repairs 0 of 2; agent restarts 0 of 5; hand-off retries 0 of 3.");
    expect(lines.at(-1)).toBe("Next: delivery status fix-the-broken-footer-links-20261001T022000Z (detail), delivery report (your task list)");
  });
});

describe("where a stopped task is told", () => {
  it("puts a stop only an engineer can deal with under their heading, with one thing for the owner to do", () => {
    const lines = report(stopped({ kind: "budget", population: "gateError" }));

    expect(lines.slice(lines.indexOf("STOPPED, FOR YOUR ENGINEERS (1)"), lines.indexOf("DONE (1)") - 1)).toEqual([
      "STOPPED, FOR YOUR ENGINEERS (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    The check you set up could not be run, even after trying it again. This is a problem with the setup, not a decision for you.",
      '    The agent said: "done"',
      "    To act: Pass this to whoever maintains your checks: delivery status fix-the-broken-footer-links-20261001T022000Z",
    ]);
    expect(lines[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 stopped, for your engineers; 2 not started.");
  });

  it("tells a stop recorded before causes were by its recorded reason, with no advice", () => {
    const lines = report(stopped(undefined));

    expect(lines.slice(lines.indexOf("STOPPED, FOR YOUR ENGINEERS (1)"), lines.indexOf("DONE (1)") - 1)).toEqual([
      "STOPPED, FOR YOUR ENGINEERS (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Stopped. The record does not say what kind of stop this was.",
      '    The run recorded this reason: "recorded reason"',
      '    The agent said: "done"',
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
    ]);
  });

  it("writes `not recorded` where the agent left no explanation", () => {
    const silent = [{ t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" } as const];

    expect(report(stopped({ kind: "session_not_run", role: "worker" }, silent))).toContain("    The agent said: not recorded");
  });

  it("says a task stopped at a usage limit, in the headline and at the task", () => {
    const limited = [
      { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" } as const,
      { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "incomplete", rationale: "limited", limit: "spend" } as const,
    ];

    const lines = report(stopped({ kind: "budget", population: "terminus" }, limited));

    expect(lines[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 stopped at a usage limit; 2 not started.");
    expect(lines).toContain("    Stopped because a usage limit was reached: the spending limit has been reached.");
    expect(lines.slice(lines.indexOf("    To act: 1. Wait until the limit no longer applies."), lines.indexOf("    To act: 1. Wait until the limit no longer applies.") + 3)).toEqual([
      "    To act: 1. Wait until the limit no longer applies.",
      '            2. Run this task again on its own: delivery run --task "<the task, exactly as it is written>"',
      "            3. Then carry on with your list: delivery run",
    ]);
  });
});

describe("how delivered work is described", () => {
  const delivered = (closerRef: Parameters<typeof recordOf>[0]["closerRef"]): string[] =>
    report(snapshotOf({ list: [{ intent: FORM }], records: [recordOf({ runId: ID.form, task: FORM, ...(closerRef ? { closerRef } : {}), history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") })] }));

  it("says merged only for a project that merges", () => {
    expect(delivered({ type: "merge-back" })[0]).toBe("Your task list: 1 of 1 task completed and merged.");
    expect(delivered({ type: "merge-back" })).toContain('  Task 1 of 1: "Add a contact form": merged into main at 02:19');
  });

  it("names the branch for a project that commits each task to its own", () => {
    expect(delivered(undefined)[0]).toBe("Your task list: 1 of 1 task completed and committed to its own branch.");
    expect(delivered(undefined)).toContain('  Task 1 of 1: "Add a contact form": committed on branch surface/add-a-contact-form-20261001T020100Z at 02:19');
  });

  it("names the branch and the pull request for a project that opens one", () => {
    expect(delivered({ type: "open-pr" })).toContain('  Task 1 of 1: "Add a contact form": on branch surface/add-a-contact-form-20261001T020100Z, with a pull request open at 02:19');
  });

  it("claims nothing about where the work went for a project's own closer", () => {
    expect(delivered({ type: "custom", modulePath: "./closer.js" })[0]).toBe("Your task list: 1 of 1 task completed.");
    expect(delivered({ type: "custom", modulePath: "./closer.js" })).toContain('  Task 1 of 1: "Add a contact form": your own closer handled this task; check what it did at 02:19');
  });
});

describe("a damaged record", () => {
  const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };

  it("is named first, with its file, and the rest is still reported", () => {
    const lines = report(snapshotOf({ records: [formDone], damaged: [damaged] }));

    expect(lines.slice(0, 2)).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); the other 3 tasks are reported below.",
      "Your task list: 1 of 4 tasks completed and merged; 1 could not be read; 2 not started.",
    ]);
    expect(lines).toContain("  These are waiting behind task 2, whose record is damaged. They are left alone until that is put right.");
  });

  it("is all the report says when it is the one run asked about", () => {
    expect(report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, damaged: [damaged] }))).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); nothing else could be read.",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });
});

describe("words taken from the record", () => {
  const hostile = "line one\u001B[2J\u001B]0;owned\u0007\r\nline\ttwo\u0007\u009B";

  it("lose every control character but line breaks and tabs", () => {
    expect(stripControl(hostile)).toBe("line one\nline\ttwo");
  });

  it("are stripped wherever the report quotes them: the task, the agent and the recorded reason", () => {
    const record = recordOf({ runId: ID.footer, task: `Fix\u001B[31m the footer`, history: attempt(1, hostile), outcome: stoppedAt("2026-10-01T02:58:00.000Z", undefined, "why\u001B[0m\u0008") });

    const lines = report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [record] }));

    expect(lines).toContain('  Task: "Fix the footer"');
    expect(lines).toContain('    The agent said: "line one\n    line\ttwo"');
    expect(lines).toContain('    The run recorded this reason: "why"');
    // eslint-disable-next-line no-control-regex
    expect(lines.join("\n")).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
  });
});

describe("the report's own words", () => {
  const everyReport = [
    snapshotOf(),
    snapshotOf({ records: [formDone, footerFailed] }),
    snapshotOf({ records: [formDone, footerWorking] }),
    snapshotOf({ live: true, records: [formDone, footerWorking], runs: [going] }),
    snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] }),
    snapshotOf({ records: [formDone, homepageAsks] }),
    stopped({ kind: "budget", population: "gateError" }),
    stopped({ kind: "budget", population: "gateMaintenance" }),
    stopped({ kind: "budget", population: "close" }),
    stopped({ kind: "budget", population: "terminus" }),
    stopped({ kind: "triage_failure" }),
    stopped({ kind: "triage_abort" }),
    stopped({ kind: "provisioning" }),
    stopped({ kind: "repair_gave_up" }),
    stopped(undefined),
  ];

  /** The report with what it quotes from the record, and the identifiers it names, taken out: those are data. */
  const ownWords = (lines: string[]): string =>
    lines
      .join("\n")
      .replace(/"[^"]*"/g, "")
      .replace(/\b(surface\/\S+|\S+-\d{8}T\d{6}Z)/g, "");

  it("never use the harness's internal names for things", () => {
    for (const snapshot of everyReport) expect(ownWords(report(snapshot))).not.toMatch(FORBIDDEN);
  });

  it("end on a `Next:` line naming only commands that exist", () => {
    for (const snapshot of everyReport) {
      const last = report(snapshot).at(-1) ?? "";
      expect(last).toMatch(/^Next: delivery (status|report)/);
      expect(last.match(/delivery [a-z]+( --?[a-z-]+)?/g)?.every((command) => /^delivery (status|report|status --all)$/.test(command))).toBe(true);
    }
  });

  it("never send a task that has ended to `delivery resume`", () => {
    for (const snapshot of everyReport.filter((each) => each.records.every((record) => record.caseFile.outcome !== undefined))) {
      expect(report(snapshot).join("\n")).not.toContain("delivery resume");
    }
  });

  it("set the tuning section apart, under its own heading, after everything the owner acts on", () => {
    const lines = report(snapshotOf({ records: [formDone, footerFailed] }));

    expect(lines.indexOf("FOR WHOEVER TUNES THIS")).toBeGreaterThan(lines.indexOf("NOT STARTED (2)"));
  });
});

describe("the text of a report", () => {
  it("is the same every time for the same records", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed] });

    expect(report(structuredClone(snapshot)).join("\n")).toBe(report(snapshot).join("\n"));
  });

  it("carries no colour codes unless colour is asked for, and only on headings when it is", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));
    const plain = renderText(doc, { colour: false });
    const coloured = renderText(doc, { colour: true });

    expect(plain.join("\n")).not.toContain("\u001B");
    // eslint-disable-next-line no-control-regex
    expect(coloured.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""))).toEqual(plain);
    expect(coloured.filter((line, index) => line !== plain[index]).length).toBe(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/report/text.test.ts`
Expected: FAIL: the file cannot be loaded (`Cannot find module './text.js'` or the equivalent resolution error).

- [ ] **Step 3: Create `src/report/text.ts`**

One fact per line, no columns and no wrapping, so the output is the same at any width and in a pipe. Colour touches only the section headings and goes through `paint`.

```ts
import { paint, type Tone } from "../paint.js";
import { USAGE_LIMIT_WORDS } from "../ports.js";
import type { DamagedRecord, ReportDocument, ReportRun, ReportSurface } from "./document.js";
import { completedWords, landedWords, RETRY_WORDS, whereTheWorkIs, type Landing } from "./plain.js";

export const NO_RUNS_YET = "No runs yet in this folder. Start one with: delivery run";

/** Said above a report of the most recent run when the project has no task list to report on. */
export const NO_TASK_LIST = "This project has no task list, so this is its most recent run.";

/**
 * Text from a record with everything that could drive the terminal taken out:
 * escape sequences whole, then any other control character. Line breaks and
 * tabs are kept, because quoted output is read as it was written.
 */
export function stripControl(text: string): string {
  // The pattern is the control characters themselves: matching them is the point.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

/** Words from the record, in quotation marks, with later lines set under the first. */
function quoted(text: string, indent: string): string {
  return `"${stripControl(text).trim().split("\n").join(`\n${indent}`)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "02:19", from an ISO 8601 UTC instant by its own digits: no clock and no locale is read. */
const minuteOf = (iso: string): string => iso.slice(11, 16);

/** "1 Oct 02:19", the same way. */
const dayAndMinute = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${minuteOf(iso)}`;

/** How long it was between two recorded instants. Never measured against now. */
function elapsed(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

const tasksWord = (count: number): string => `${count} ${count === 1 ? "task" : "tasks"}`;

/** The part of the report a task is told in. */
type Section = "needs_you" | "engineers" | "done" | "not_finished" | "not_started";

const SECTIONS: readonly Section[] = ["needs_you", "engineers", "done", "not_finished", "not_started"];

const HEADING: Record<Section, { title: string; tone: Tone }> = {
  needs_you: { title: "NEEDS YOU", tone: "attention" },
  engineers: { title: "STOPPED, FOR YOUR ENGINEERS", tone: "stopped" },
  done: { title: "DONE", tone: "done" },
  not_finished: { title: "NOT FINISHED", tone: "quiet" },
  not_started: { title: "NOT STARTED", tone: "quiet" },
};

/** Total over the standings, so a new one does not compile until it has a section. */
function sectionOf(surface: ReportSurface): Section {
  switch (surface.standing) {
    case "closed":
      return "done";
    case "escalated":
    case "aborted":
      return surface.plain?.audience === "owner" ? "needs_you" : "engineers";
    case "paused":
    case "unfinished":
    case "queued":
      return "not_finished";
    case "not_started":
      return "not_started";
  }
}

const label = (surface: ReportSurface): string =>
  `${surface.queue ? `Task ${surface.queue.task} of ${surface.queue.of}` : "Task"}: ${quoted(surface.task, "    ")}`;

const stoppedByLimit = (surface: ReportSurface): boolean =>
  surface.cause?.kind === "budget" && surface.cause.population === "terminus" && surface.limit !== null;

/** "3 of 5 tasks completed and merged; 1 needs your decision; 1 failed after 3 attempts." Said only when nothing is still to finish. */
function headline(doc: ReportDocument): string {
  const done = doc.surfaces.filter((surface) => surface.standing === "closed");
  const [first] = done;
  const sameLanding = first?.closer != null && done.every((surface) => surface.closer === first.closer) ? first.closer : null;
  const of = (group: string): ReportSurface[] => doc.surfaces.filter((surface) => surface.plain?.group === group);
  const failed = of("failed_after_attempts").filter((surface) => !stoppedByLimit(surface));
  const limited = doc.surfaces.filter(stoppedByLimit);
  const [onlyFailure] = failed;
  const engineers = doc.surfaces.filter((surface) => sectionOf(surface) === "engineers").length;
  const some = (count: number, one: string, many: string): string[] => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);
  return [
    `${done.length} of ${tasksWord(doc.surfaces.length + doc.incomplete.filter((damaged) => damaged.queue !== null).length)} ${sameLanding === null ? "completed" : completedWords(sameLanding, done.length)}`,
    ...some(of("needs_your_decision").length, "needs your decision", "need your decision"),
    ...(failed.length === 1 && onlyFailure
      ? [`1 failed after ${onlyFailure.attempts} ${onlyFailure.attempts === 1 ? "attempt" : "attempts"}`]
      : some(failed.length, "failed", "failed after repeated attempts")),
    ...some(limited.length, "stopped at a usage limit", "stopped at a usage limit"),
    ...some(of("abandoned").length, "was abandoned", "were abandoned"),
    ...some(engineers, "stopped, for your engineers", "stopped, for your engineers"),
    ...some(doc.incomplete.filter((damaged) => damaged.queue !== null).length, "could not be read", "could not be read"),
    ...some(doc.counts.not_started, "not started", "not started"),
  ].join("; ");
}

/** "5 tasks: 1 done, 2 working, 2 waiting to start", for a report on work that has not finished. */
function tally(doc: ReportDocument): string {
  const count = (section: Section): number => doc.surfaces.filter((surface) => sectionOf(surface) === section).length;
  const part = (number: number, words: string): string[] => (number === 0 ? [] : [`${number} ${words}`]);
  return `${tasksWord(doc.surfaces.length)}: ${[
    ...part(count("done"), "done"),
    ...part(count("needs_you"), count("needs_you") === 1 ? "needs you" : "need you"),
    ...part(count("engineers"), "stopped for your engineers"),
    ...part(doc.counts.unfinished, doc.live === true ? "working" : "not finished"),
    ...part(doc.counts.paused, "held"),
    ...part(doc.counts.queued, "waiting to start"),
    ...part(doc.counts.not_started, "not started"),
  ].join(", ")}`;
}

/** What the report is about, as its opening words. Total over the kinds of report. */
const SUBJECT: Record<ReportDocument["kind"], { final: string; going: string; partWay: string; unknown: string }> = {
  list: {
    final: "Your task list",
    going: "Your task list is still being worked on",
    partWay: "Work on your task list stopped part way",
    unknown: "Your task list has not finished",
  },
  run: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
  task: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
};

/** The first lines: what happened, counted. Never final-sounding while a task is still to finish. */
function opening(doc: ReportDocument): string[] {
  const words = SUBJECT[doc.kind];
  const waiting = doc.counts.unfinished + doc.counts.paused + doc.counts.queued;
  if (waiting === 0) return doc.surfaces.length === 0 ? [] : [`${words.final}: ${headline(doc)}.`];
  if (doc.live === true) return [`${words.going} (${tally(doc)}).`];
  // A run that records why it stopped says how to carry on in its own line, below.
  if (doc.live === false) return [`${words.partWay} (${tally(doc)}).${doc.run?.cause == null ? " To carry on: delivery run" : ""}`];
  const unfinished = doc.surfaces.find((surface) => surface.standing === "unfinished");
  return [
    `${words.unknown} (${tally(doc)}); nothing records whether it is still going.${unfinished?.run ? ` If it is not, carry on with: delivery resume ${unfinished.run}` : ""}`,
  ];
}

function incompleteLines(doc: ReportDocument): string[] {
  const others = doc.surfaces.length;
  const rest = others === 0 ? "nothing else could be read" : `the other ${tasksWord(others)} ${others === 1 ? "is" : "are"} reported below`;
  return doc.incomplete.map((damaged: DamagedRecord) =>
    damaged.queue
      ? `Incomplete report: the record for task ${damaged.queue.task} is damaged (${damaged.file}); ${rest}.`
      : `Incomplete report: the record of run ${damaged.run} is damaged (${damaged.file}); ${others === 0 ? "nothing else could be read" : "what could be read is reported below"}.`,
  );
}

/** When the work ran. A run of several at once has times of its own; a list worked one task at a time has only its tasks'. */
function whenLines(doc: ReportDocument): string[] {
  const { run } = doc;
  if (run) {
    const shape = `up to ${tasksWord(run.concurrency)} at once`;
    if (run.startedAt === null) return [`Run ${run.runId}, start time not recorded, ${shape}.`];
    return run.finishedAt === null
      ? [`Run ${run.runId}, started ${dayAndMinute(run.startedAt)} UTC, ${shape}.`]
      : [`Run ${run.runId}, ${dayAndMinute(run.startedAt)} to ${minuteOf(run.finishedAt)} UTC (${elapsed(run.startedAt, run.finishedAt)}), ${shape}.`];
  }
  const ran = doc.surfaces.filter((surface) => surface.run !== null);
  if (ran.length === 0) return [];
  const started = ran.flatMap((surface) => (surface.startedAt === null ? [] : [surface.startedAt])).sort().at(0);
  // Only an ended task records a time, so a task still to finish leaves the last activity unknown.
  const finished = ran.every((surface) => surface.finishedAt !== null) ? ran.flatMap((surface) => surface.finishedAt ?? []).sort().at(-1) : undefined;
  return [
    `Started ${started === undefined ? "at a time not recorded" : `${dayAndMinute(started)} UTC`}; last activity ${finished === undefined ? "not recorded" : `${dayAndMinute(finished)} UTC`}.`,
  ];
}

/** Why a run of several at once stopped when no task caused it. Total over the causes a run records. */
function runStopLines(run: ReportRun | null): string[] {
  switch (run?.cause) {
    case undefined:
    case null:
      return [];
    case "shared_environment":
      return ["The run stopped because the setup every task shares could not be repaired; no task caused this. Once it is fixed, carry on with: delivery run"];
    case "usage_limit":
      return [
        `The run stopped because a usage limit was reached${run.limit === null ? "" : `: ${USAGE_LIMIT_WORDS[run.limit]}`}; no task caused this. Once the limit no longer applies, carry on with: delivery run`,
      ];
  }
}

/** "To act:" with its steps, numbered only when there is more than one. */
function toAct(next: string[]): string[] {
  const [only] = next;
  if (only === undefined) return [];
  if (next.length === 1) return [`    To act: ${only}`];
  return next.map((step, index) => `    ${index === 0 ? "To act:" : "       "} ${index + 1}. ${step}`);
}

/** A stopped task: the kind of stop, the agent's own words, where the work is, and what to do. */
function stoppedItem(surface: ReportSurface): string[] {
  const { plain } = surface;
  if (plain === null || surface.run === null) return [`  ${label(surface)}`];
  const landing: Landing = surface.closer ?? "commit-to-branch";
  return [
    `  ${label(surface)}`,
    `    ${plain.sentence}`,
    ...(plain.group === "stopped" ? [`    The run recorded this reason: ${surface.reason === null ? "not recorded" : quoted(surface.reason, "    ")}`] : []),
    `    The agent said: ${plain.agentSaid === null ? "not recorded" : quoted(plain.agentSaid, "    ")}`,
    ...(plain.audience === "owner" ? [`    Where the work is: ${whereTheWorkIs(landing, surface.base)}`] : []),
    ...toAct(plain.next),
    ...(plain.audience === "engineer" ? [] : [`    Full account: delivery status ${surface.run}`]),
  ];
}

const doneItem = (surface: ReportSurface): string =>
  `  ${label(surface)}: ${landedWords(surface.closer ?? "commit-to-branch", surface.branch, surface.base)}${surface.finishedAt === null ? "" : ` at ${minuteOf(surface.finishedAt)}`}`;

/** A task that has not finished, and how to carry it on when nothing says it is still going. */
function unfinishedItem(surface: ReportSurface, live: boolean | null): string[] {
  const standing =
    surface.standing === "queued"
      ? "waiting to start"
      : surface.standing === "paused"
        ? "held while the setup every task shares is repaired"
        : live === true
          ? "working"
          : "not finished";
  return [
    `  ${label(surface)}: ${standing}`,
    ...(surface.standing === "unfinished" && live === null && surface.run ? [`    If it is no longer going, carry on with: delivery resume ${surface.run}`] : []),
  ];
}

/** Why the tasks with no run were left, and how to carry on. A list worked one task at a time stops at the first task that does not finish. */
function notStartedReason(doc: ReportDocument): string[] {
  const damaged = doc.incomplete.flatMap((record) => (record.queue ? [record.queue.task] : [])).sort((a, b) => a - b).at(0);
  const stuck = doc.surfaces.find((surface) => surface.queue !== null && surface.standing !== "closed" && surface.standing !== "not_started");
  const ahead = stuck?.queue?.task;
  // A run of several at once does not stop at a task, so nothing is waiting behind one.
  if (doc.run !== null || (ahead === undefined && damaged === undefined)) return ["  These have not been started yet. To start them: delivery run"];
  if (damaged !== undefined && (ahead === undefined || damaged < ahead)) {
    return [`  These are waiting behind task ${damaged}, whose record is damaged. They are left alone until that is put right.`];
  }
  const behind = `  These are waiting behind task ${ahead}.`;
  if (stuck === undefined || sectionOf(stuck) === "not_finished") return [`${behind} It has not finished, so they have been left alone.`];
  const left = "The harness does not skip a task that stopped, so it left these alone.";
  return sectionOf(stuck) === "needs_you"
    ? [`${behind} ${left} Amend or remove task ${ahead}, then run \`delivery run\` to carry on with them.`]
    : [`${behind} ${left} Once task ${ahead} has been dealt with, run \`delivery run\` to carry on with them.`];
}

function sectionLines(doc: ReportDocument, section: Section, colour: boolean): string[] {
  const surfaces = doc.surfaces.filter((surface) => sectionOf(surface) === section);
  if (surfaces.length === 0) return [];
  const { title, tone } = HEADING[section];
  const body = ((): string[] => {
    switch (section) {
      case "needs_you":
      case "engineers":
        return surfaces.flatMap((surface, index) => [...(index === 0 ? [] : [""]), ...stoppedItem(surface)]);
      case "done":
        return surfaces.map(doneItem);
      case "not_finished":
        return surfaces.flatMap((surface) => unfinishedItem(surface, doc.live));
      case "not_started":
        return [...surfaces.map((surface) => `  ${label(surface)}`), ...notStartedReason(doc)];
    }
  })();
  return ["", paint(colour, tone, `${title} (${surfaces.length})`), ...body];
}

/** Retries used, in the owner's vocabulary, for whoever adjusts the limits. Nothing when no task has a run to count. */
function tuningLines(doc: ReportDocument, colour: boolean): string[] {
  const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
  if (ran.length === 0) return [];
  const populations = ["correction", "gateError", "gateMaintenance", "terminus", "close"] as const;
  const sums = populations.map((population) => {
    const rows = ran.flatMap((surface) => surface.budgets.filter((row) => row.population === population));
    return `${RETRY_WORDS[population]} ${rows.reduce((sum, row) => sum + row.used, 0)} of ${rows.reduce((sum, row) => sum + row.max, 0)}`;
  });
  return [
    "",
    paint(colour, "quiet", "FOR WHOEVER TUNES THIS"),
    `  Retries used across ${ran.length === 1 ? "this task" : "these tasks"}: ${sums.join("; ")}.`,
    ...(doc.run ? [`  Repairs of the setup every task shares: ${doc.run.runBudgets.gateMaintenance.used} of ${doc.run.runBudgets.gateMaintenance.max}.`] : []),
    "  Time and cost were not recorded for this run.",
  ];
}

/** Where to go from here: only commands that exist. */
function nextLine(doc: ReportDocument): string {
  const [only] = doc.surfaces;
  if (doc.run) return `Next: delivery status ${doc.run.runId} (detail), delivery status --all (every run)`;
  if (doc.kind === "task" && only?.run) return `Next: delivery status ${only.run} (detail), delivery report (your task list)`;
  return "Next: delivery status --all (every run)";
}

/**
 * The report as a person reads it: plain lines, one fact per line, no columns
 * and no wrapping, so it reads the same at any width, in a pipe and in a screen
 * reader. Pure: the same document always gives the same text. Every sentence
 * outside quotation marks is from a fixed table; words from the record appear
 * only quoted, with control characters taken out.
 */
export function renderText(doc: ReportDocument, { colour }: { colour: boolean }): string[] {
  return [
    ...incompleteLines(doc),
    ...opening(doc),
    ...whenLines(doc),
    ...runStopLines(doc.run),
    ...SECTIONS.flatMap((section) => sectionLines(doc, section, colour)),
    ...tuningLines(doc, colour),
    "",
    nextLine(doc),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/report/text.test.ts`
Expected: PASS (28 tests).

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/report/text.ts src/report/text.test.ts
git commit -m "Print a report as plain lines a person can act on" -m "The owner reads the report in a terminal, a pipe or a screen reader, so it is one fact per line with no layout to break. Words from the record appear only in quotation marks with control characters removed, so nothing an agent or a check printed can rewrite her screen."
```

`src/index.ts` is not touched: the pipeline is in the library, where `src/cli/` and later slices reach it by path, and Slice 5 makes it public.

---

### Task 7: The `delivery report` command ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/report-command.ts`
- Modify: `src/cli/program.ts` (register `report [run-id]`)
- Modify: `src/cli/status-command.ts` (`listTasks` is exported)
- Modify: `README.md`, `docs/getting-started.md`
- Create: `.changeset/come-back-to-your-task-list.md`
- Test: `src/cli/report-command.test.ts`

**Interfaces:**
- Consumes: `loadSnapshot`, `ReportSubject` (Task 3); `deriveReport`, `mostRecentSubject` (Task 5); `renderText`, `NO_RUNS_YET`, `NO_TASK_LIST` (Task 6); `supervisedPlace` (`src/run-location.ts`); existing `findRepository` (`src/cli/project.ts`), `repoLocked` (`src/cli/repo-lock.ts`), `listTasks` (`src/cli/status-command.ts`), `CommandContext`, `EXIT`, `Refusal`.
- Produces:
  ```ts
  export interface ReportOptions { repo?: string }
  export const NO_REPORT_DATA_YET: string
  export function reportCommand(runId: string | undefined, options: ReportOptions, ctx: CommandContext): Promise<ExitCode>
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/cli/report-command.test.ts`. The last two tests drive real runs through the scripted agent (`TEST_MOCK_SCRIPT`), the same seam `src/cli/run-command.test.ts` uses; they need no agent, sign-in or network.

```ts
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../git-env.js";
import type { MockScript } from "../mock-script.js";
import {
  attempt,
  BANNER,
  closedAt,
  damageLog,
  failedCheck,
  fill,
  FOOTER,
  FORM,
  HOMEPAGE,
  ID,
  stoppedAt,
  writeRecord,
  type TaskRun,
} from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, PACKAGE, RUN_TIMEOUT, scriptFile, writeSupervisedRun } from "./command-fixtures.js";
import { takeRepoLock } from "./repo-lock.js";

const LIST = [FORM, FOOTER, HOMEPAGE, BANNER];

const formDone: TaskRun = { runId: ID.form, task: FORM, closerRef: { type: "merge-back" }, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") };
const footerFailed: TaskRun = {
  runId: ID.footer,
  task: FOOTER,
  closerRef: { type: "merge-back" },
  history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "2 links still point nowhere"), ...failedCheck(2, "escalate")],
  outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (1/1)"),
};

async function project(prefix: string, tasks: string[] | undefined, runs: TaskRun[]): Promise<string> {
  const repo = initTempRepo(prefix, { "package.json": PACKAGE, ...(tasks ? { "delivery.config.json": JSON.stringify({ tasks }) } : {}) });
  for (const run of runs) await writeRecord(repo, run);
  return repo;
}

/** Everything git can see of the folder, tracked or not, and the run records themselves, which git ignores. */
const everything = (repo: string): string =>
  ["status --porcelain --ignored", "stash list", "branch --list", "rev-parse HEAD"]
    .map((args) => execFileSync("git", args.split(" "), { cwd: repo, env: cleanGitEnv(), encoding: "utf-8" }))
    .concat(execFileSync("sh", ["-c", "find .delivery -type f | sort | xargs cksum"], { cwd: repo, encoding: "utf-8" }))
    .join("\n");

describe("delivery report", () => {
  it("reports the project's task list: what landed, what needs the owner, and what was not started", async () => {
    const repo = await project("report-list-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n")).toEqual([
      "Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.",
      "Started 1 Oct 02:01 UTC; last activity 1 Oct 02:58 UTC.",
      "",
      "NEEDS YOU (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Failed after 2 attempts. The agent tried 2 times and the check you set up still does not pass.",
      '    The agent said: "2 links still point nowhere"',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Reword the task, or remove it from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
      "",
      "DONE (1)",
      '  Task 1 of 4: "Add a contact form": merged into main at 02:19',
      "",
      "NOT STARTED (2)",
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These are waiting behind task 2. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 2, then run `delivery run` to carry on with them.",
      "",
      "FOR WHOEVER TUNES THIS",
      "  Retries used across these tasks: agent corrections 1 of 6; check re-runs 0 of 6; check repairs 0 of 4; agent restarts 0 of 10; hand-off retries 0 of 6.",
      "  Time and cost were not recorded for this run.",
      "",
      "Next: delivery status --all (every run)",
      "",
    ]);
    expect(stderr).toBe("");
    // The report was made, so the command succeeded: a failed task is what the report says, not how the command went.
    expect(exitCode).toBe(0);
  });

  it("prints the same bytes every time for the same records", async () => {
    const repo = await project("report-same-", LIST, [formDone, footerFailed]);

    const first = await delivery(["report"], { cwd: repo });
    const second = await delivery(["report"], { cwd: repo });

    expect(first.stdout.split("\n")[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.");
    expect(second.stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain("\u001B");
  });

  it("changes nothing: no file, no branch, no record", async () => {
    const repo = await project("report-read-only-", LIST, [formDone, footerFailed]);
    const before = everything(repo);

    const list = await delivery(["report"], { cwd: repo });
    const one = await delivery(["report", ID.footer], { cwd: repo });

    expect([list.exitCode, one.exitCode]).toEqual([0, 0]);
    expect(everything(repo)).toBe(before);
  });

  it("reports one task's run when given its id", async () => {
    const repo = await project("report-named-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout } = await delivery(["report", ID.footer], { cwd: repo });
    const lines = stdout.split("\n");

    expect(lines[0]).toBe("This run: 0 of 1 task completed; 1 failed after 2 attempts.");
    expect(lines).toContain('  Task 2 of 4: "Fix the broken footer links"');
    expect(stdout).not.toContain("Add a contact form");
    expect(exitCode).toBe(0);
  });

  it("reports a run of several tasks at once when given its id, and says it is still going while it holds the folder", async () => {
    const repo = await project("report-run-", LIST, [formDone, { runId: ID.footer, task: FOOTER, history: attempt(1, "first go") }]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
    ]);
    const release = await takeRepoLock(repo);

    const going = await delivery(["report", ID.run], { cwd: repo });
    await release?.();
    const stopped = await delivery(["report", ID.run], { cwd: repo });

    expect(going.stdout.split("\n")[0]).toBe("This run is still going (4 tasks: 1 done, 1 working, 2 waiting to start).");
    expect(stopped.stdout.split("\n")[0]).toBe("This run stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
    expect([going.exitCode, stopped.exitCode]).toEqual([0, 0]);
  });

  it("says so in one line, and reports the most recent run, when the project has no task list", async () => {
    const repo = await project("report-no-list-", undefined, [formDone, footerFailed]);

    const { exitCode, stdout } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "This project has no task list, so this is its most recent run.",
      "This run: 0 of 1 task completed; 1 failed after 2 attempts.",
    ]);
    expect(stdout).toContain('  Task: "Fix the broken footer links"');
    expect(stdout).toContain('    To act: Reword the task and run it again: delivery run --task "<the reworded task>"');
    expect(exitCode).toBe(0);
  });

  it("says there are no runs yet, and how to start one, in a folder that has never had one", async () => {
    const repo = await project("report-empty-", LIST, []);

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout).toBe("No runs yet in this folder. Start one with: delivery run\n\nNext: delivery run\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("names one damaged record with its file, says the report is incomplete, and still reports the rest", async () => {
    const repo = await project("report-damaged-", LIST, [formDone, footerFailed]);
    await damageLog(join(repo, ".delivery", "runs", ID.footer));

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); the other 3 tasks are reported below.",
      "Your task list: 1 of 4 tasks completed and merged; 1 could not be read; 2 not started.",
    ]);
    expect(stdout).toContain('  Task 1 of 4: "Add a contact form": merged into main at 02:19');
    expect(stdout + stderr).not.toContain("    at ");
    expect(exitCode).toBe(0);
  });

  it("still reports when the damaged record is the very run asked about", async () => {
    const repo = await project("report-damaged-named-", LIST, [footerFailed]);
    await writeFile(join(repo, ".delivery", "runs", ID.footer, "case.json"), "{ truncated");

    const { exitCode, stdout } = await delivery(["report", ID.footer], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(
      "Incomplete report: the record of run fix-the-broken-footer-links-20261001T022000Z is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/case.json); nothing else could be read.",
    );
    expect(exitCode).toBe(0);
  });

  it("fails, plainly, only when it could not answer: an id that names no run", async () => {
    const repo = await project("report-unknown-", LIST, [formDone]);

    const { exitCode, stdout, stderr } = await delivery(["report", "never-ran-20260101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("    at ");
  });

  it("refuses --json for now rather than print text where a script expects data", async () => {
    const repo = await project("report-json-", LIST, [formDone]);

    const { exitCode, stdout, stderr } = await delivery(["report", "--json"], { cwd: repo });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("`delivery report` prints its report as text only for now. Run it without `--json`.");
  });

  it("describes itself in the help, and is listed among the commands", async () => {
    const repo = await project("report-help-", LIST, []);

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["report", "--help"], { cwd: repo });

    expect(top.stdout).toMatch(/^\s+report \[options\] \[run-id\]\s+say in plain words what happened/m);
    expect(own.stdout).toContain("--repo <path>");
  });

  it(
    "tells a real run of the list apart: the task that landed, and the one the agent stopped on for the owner's say-so",
    async () => {
      // Deliberately distinct in their first five words: a run id slugs only those.
      const hello = "add a hello function that greets a name, with a test";
      const purge = "delete every old page from the published site";
      const script: MockScript = {
        expectations: [
          { when: { promptContains: purge }, json: { status: "escalate", category: "authority", rationale: "this would delete 14 published pages" } },
          {
            when: { promptContains: hello },
            effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
            json: { status: "completed", rationale: "added hello.js" },
          },
        ],
      };
      const repo = await project("report-real-", [hello, purge, "a third task nobody reaches"], []);
      const env = { [TEST_MOCK_SCRIPT]: await scriptFile(script) };

      await delivery(["run"], { cwd: repo, env });
      const { exitCode, stdout } = await delivery(["report"], { cwd: repo, env });
      const lines = stdout.split("\n");

      expect(lines[0]).toBe("Your task list: 1 of 3 tasks completed and committed to its own branch; 1 needs your decision; 1 not started.");
      expect(lines).toContain("    Needs your decision. The agent stopped and said it could not go on without your say-so.");
      expect(lines).toContain('    The agent said: "this would delete 14 published pages"');
      expect(lines).toContain("    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.");
      expect(lines).toContain('  Task 3 of 3: "a third task nobody reaches"');
      expect(exitCode).toBe(0);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "counts a real run's attempts when the check never passes",
    async () => {
      const task = "add a hello function that greets a name, with a test";
      const repo = initTempRepo("report-real-failing-", {
        "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "test ! -f broken.txt" } }),
        "delivery.config.json": JSON.stringify({ tasks: [task] }),
      });
      const env = { [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [{ effects: [{ write: { path: "broken.txt", content: "x\n" } }], json: { status: "completed", rationale: "I believe this is done" } }] }) };

      await delivery(["run"], { cwd: repo, env });
      const { exitCode, stdout } = await delivery(["report"], { cwd: repo, env });

      const lines = stdout.split("\n");

      expect(lines[0]).toBe("Your task list: 0 of 1 task completed; 1 failed after 4 attempts.");
      expect(lines).toContain("    Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.");
      expect(lines).toContain('    The agent said: "I believe this is done"');
      expect(lines).toContain("  Retries used across this task: agent corrections 3 of 3; check re-runs 0 of 3; check repairs 0 of 2; agent restarts 0 of 5; hand-off retries 0 of 3.");
      expect(exitCode).toBe(0);
    },
    RUN_TIMEOUT * 2,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/report-command.test.ts`
Expected: FAIL, all 14: commander refuses `report` as an unknown command, so each run exits 2 with nothing on standard output.

- [ ] **Step 3: Create `src/cli/report-command.ts`**

```ts
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { NO_RUNS_YET, NO_TASK_LIST, renderText } from "../report/text.js";
import { supervisedPlace } from "../run-location.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { repoLocked } from "./repo-lock.js";
import { listTasks } from "./status-command.js";

/** What `delivery report` was given on the command line besides the run id. */
export interface ReportOptions {
  repo?: string;
}

export const NO_REPORT_DATA_YET = "`delivery report` prints its report as text only for now. Run it without `--json`.";

/**
 * `delivery report`: what happened and what to do about it, in the owner's
 * words. With no id, the project's task list; with one, that task or that run
 * of several tasks; and where the project has no list, its most recent run.
 * It reads the records and nothing else, takes no lock and changes nothing, so
 * it is safe while a run is going. The exit code says whether a report could
 * be made, never what the report says.
 */
export async function reportCommand(runId: string | undefined, options: ReportOptions, ctx: CommandContext): Promise<ExitCode> {
  if (ctx.json) throw new Refusal(NO_REPORT_DATA_YET, EXIT.configuration);
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const [list, live] = await Promise.all([listTasks(startDir, repoPath, ctx), repoLocked(repoPath)]);

  // A run of several tasks at once keeps a record of its own; any other id names one task's run.
  const named: ReportSubject | undefined =
    runId === undefined
      ? undefined
      : existsSync(join(supervisedPlace(repoPath, runId), "run.json"))
        ? { kind: "run", runId }
        : { kind: "task", runId };
  const snapshot = await loadSnapshot(repoPath, named ?? { kind: "list" }, { live, list });

  if (snapshot.records.length + snapshot.runs.length + snapshot.damaged.length === 0) {
    for (const line of [NO_RUNS_YET, "", "Next: delivery run"]) ctx.writeLine(line);
    return EXIT.ok;
  }

  const recent = named === undefined && list.length === 0 ? mostRecentSubject(snapshot) : undefined;
  if (recent) ctx.writeLine(NO_TASK_LIST);
  for (const line of renderText(deriveReport(recent ? { ...snapshot, subject: recent } : snapshot), { colour: ctx.colour })) ctx.writeLine(line);
  return EXIT.ok;
}
```

- [ ] **Step 4: Register the command, and let it read the list the way `status` does**

Make exactly these edits to `src/cli/program.ts` and `src/cli/status-command.ts`:

```diff
diff --git a/src/cli/program.ts b/src/cli/program.ts
--- a/src/cli/program.ts
+++ b/src/cli/program.ts
@@ -8,4 +8,5 @@ import { PREVIEW_ROLES, previewCommand, taskNumber, type PreviewOptions } from "
 import { inquirerAsk } from "./prompts.js";
 import { jsonReporter, plainReporter, type RunReporter } from "./report.js";
+import { reportCommand, type ReportOptions } from "./report-command.js";
 import { resumeCommand, type ResumeOptions } from "./resume-command.js";
 import { runCommand, type RunOptions } from "./run-command.js";
@@ -117,4 +118,15 @@ export async function runCli(io: CliIo): Promise<number> {
     });
 
+  program
+    .command("report")
+    .description(
+      "say in plain words what happened to your task list and what to do next: which tasks landed, which need you, which need an engineer and which were not started, without changing anything",
+    )
+    .argument("[run-id]", "report this task's run, or this run of several tasks, instead of the task list")
+    .option("--repo <path>", "the git repository the runs belong to (default: the current folder)")
+    .action(async (runId: string | undefined, options: ReportOptions, command: Command) => {
+      exitCode = await reportCommand(runId, options, contextFor(io, command));
+    });
+
   program
     .command("validate")
diff --git a/src/cli/status-command.ts b/src/cli/status-command.ts
--- a/src/cli/status-command.ts
+++ b/src/cli/status-command.ts
@@ -430,5 +430,5 @@ async function mostRecent(repoPath: string): Promise<RunRecord | SupervisedRecor
 
 /** The project's list as written now, or none when there is no list or the file fails to load: status reads it only to annotate, never to gate. */
-async function listTasks(startDir: string, repoPath: string, ctx: CommandContext): Promise<TaskDef[]> {
+export async function listTasks(startDir: string, repoPath: string, ctx: CommandContext): Promise<TaskDef[]> {
   try {
     return queueTasks(await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env }));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/report-command.test.ts`
Expected: PASS (14 tests).

Run: `npx tsc --noEmit && npx eslint src/cli`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/report-command.ts src/cli/report-command.test.ts src/cli/program.ts src/cli/status-command.ts
git commit -m "Add delivery report" -m "An owner who comes back after a list of tasks has run needs one command that says what landed, what needs her and what to do, in her own words. The command only resolves what is being asked about and prints: the report itself is the library's."
```

- [ ] **Step 7: Say so in the README**

In `README.md`, insert this section immediately before the line `## See what happened to a run`:

````markdown
## Come back to your task list

After a list of tasks has run, overnight or while you were elsewhere, one command says what
happened and what to do about it, in plain words:

```bash
delivery report
```

```text
Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 not started.
Started 1 Oct 02:01 UTC; last activity 1 Oct 03:04 UTC.

NEEDS YOU (1)
  Task 3 of 4: "Remove every page under the old news section"
    Needs your decision. The agent stopped and said it could not go on without your say-so.
    The agent said: "This would delete 14 published pages. I need the owner to confirm before I remove them."
    Where the work is: this task's changes were not added to main.
    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.
            2. Run: delivery run
    Full account: delivery status remove-every-page-under-the-20261001T030000Z

DONE (2)
  Task 1 of 4: "Add a contact form to the site": merged into main at 02:19
  Task 2 of 4: "Update the prices page for October": merged into main at 02:31

NOT STARTED (1)
  Task 4 of 4: "Show a cookie banner on first visit"
  These are waiting behind task 3. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 3, then run `delivery run` to carry on with them.

FOR WHOEVER TUNES THIS
  Retries used across these tasks: agent corrections 0 of 9; check re-runs 0 of 9; check repairs 0 of 6; agent restarts 0 of 15; hand-off retries 0 of 9.
  Time and cost were not recorded for this run.

Next: delivery status --all (every run)
```

The first line counts your tasks by what happened to them. Under it, each part appears only when
it has tasks in it:

- **Needs you:** a task that stopped for something only you can settle. It says what kind of stop
  it was ("Needs your decision", "Failed after 3 attempts", a usage limit), quotes what the agent
  itself said, says where the work is, and lists what to do under "To act".
- **Stopped, for your engineers:** a task stopped by a problem with the check, its repair or
  handing the work off. It is not a decision for you; it gives one line to pass on.
- **Done:** each finished task and where its work went, in the words of how your project lands
  work: merged, committed on a branch, or a pull request open.
- **Not finished:** tasks of a run that is still going, or that stopped part way.
- **Not started:** tasks nothing has run yet, with why they were left and how to carry on.

Words taken from a run (your task, what the agent said) are always in quotation marks; every other
sentence is the harness's own and is the same for every project. "For whoever tunes this" counts
the retries used, for the person who sets the limits.

`delivery report <run-id>` reports one task's run, or one run of several tasks at once, instead
of the list. In a project with no `tasks` list, `delivery report` reports the most recent run and
says so in its first line.

It only ever reads, and takes no lock, so it is safe while a run is going: it then says the run is
still going rather than giving a final count. Where nothing records whether a task worked one at a
time is still going, it says exactly that and how to carry on if it is not. If one run's record is
damaged, the report names that task and the file, says at the top that it is incomplete, and
still reports the rest. A run made by an earlier version still reports: where its record does not
say why a task stopped, the task appears under "Stopped, for your engineers" with the reason the
run recorded.

`report` exits 0 whenever the report could be made, whatever it says, and 2 when it could not (a
run id that names nothing). It prints text only for now: for one JSON document about a run, use
`delivery status --json`.

````

- [ ] **Step 8: Point to it from the getting-started guide**

In `docs/getting-started.md`, in the section "4. Read what happened, later", add this paragraph after the paragraph that ends "with the evidence behind it underneath." and before `## Where to go next`:

```markdown
Once your project has a list of tasks (the next guide sets one up), `delivery report` is the
command to come back to: it says in plain words which tasks landed, which need you, and what to do
about each. See [Come back to your task list](../README.md#come-back-to-your-task-list).
```

- [ ] **Step 9: Record the change**

Create `.changeset/come-back-to-your-task-list.md`:

```markdown
---
"delivery-service": minor
---

`delivery report` says in plain words what happened to your list of tasks and what to do next. Its
first line counts the tasks by what happened ("3 of 5 tasks completed and merged; 1 needs your
decision; 1 failed after 3 attempts"), then it lists the tasks that need you, the ones stopped for
your engineers, the ones done, and the ones not started. Each stopped task says what kind of stop
it was, quotes what the agent itself said, says where the work is, and gives the steps to take.
`delivery report <run-id>` reports one run instead; a project with no list gets its most recent
run. It only reads, so it is safe while a run is going, it works on runs made by earlier versions,
and it exits 0 whenever the report could be made. One damaged record no longer hides the others:
it is named, with its file, and the rest is reported.

A run's record now says why a task stopped (`cause` on its outcome) and which usage limit stopped
an agent session (`limit` on that session's entry). Both are optional, so older records read as
before, and nothing that decides what a run does next reads them.
```

- [ ] **Step 10: Commit**

```bash
git add README.md docs/getting-started.md .changeset/come-back-to-your-task-list.md
git commit -m "Document delivery report" -m "The command is the first thing a returning owner should reach for, so the README shows what it prints and what each part means, the first-run guide points to it, and the changeset tells an upgrading user what is new."
```

---

### Task 8: A demo of the report on the scripted agent ✅ DONE (deliver-slice)

**Files:**
- Create: `demos/observability-slice-1-report.ts`
- Modify: `package.json` (`demo:report-slice-1`)
- Modify: `README.md` (one sentence in "Come back to your task list")

**Interfaces:**
- Consumes: `delivery`, `PACKAGE`, `scriptFile` (`src/cli/command-fixtures.ts`), `TEST_MOCK_SCRIPT` (`src/cli/agent-session.ts`), `initTempRepo` (`src/temp-repo.ts`), `cleanGitEnv` (`src/git-env.ts`), `MockScript` (`src/mock-script.ts`): all existing. The `report` command (Task 7).
- Produces: `npm run demo:report-slice-1`.

A demo is not a test and has no failing-test step: the check is that it runs and prints the two reports.

- [x] **Step 1: Create `demos/observability-slice-1-report.ts`**

```ts
/**
 * Demo for Observability and Reporting Slice 1: Come Back to Your Task
 * List and See What Happened and What to Do.
 *
 * 1. Sets up a scratch project with a list of four tasks, one of which asks
 *    for something the agent will not do without the owner's say-so.
 * 2. Runs `delivery run` until it stops, then prints `delivery report`.
 * 3. Follows the report's "To act" steps: rewords that task to give the
 *    permission, runs `delivery run` again, and prints `delivery report` again.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:report-slice-1
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, PACKAGE, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import type { MockScript } from "../src/mock-script.js";
import { initTempRepo } from "../src/temp-repo.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const PURGE = "Remove every page under the old news section";
const BANNER = "Show a cookie banner on first visit";
const PERMISSION = "The owner has confirmed the 14 published pages may be deleted.";

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

/** The agent, scripted: it does each task, except that it will not delete published pages until the task says it may. */
const script: MockScript = {
  expectations: [
    { when: { promptContains: PERMISSION }, ...writes("news-removed.txt", "removed the 14 pages under the old news section") },
    {
      when: { promptContains: PURGE },
      json: { status: "escalate", category: "authority", rationale: "This would delete 14 published pages. I need the owner to confirm before I remove them." },
    },
    { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
    { when: { promptContains: PRICES }, ...writes("prices.html", "updated the prices page") },
    { when: { promptContains: BANNER }, ...writes("banner.html", "added the cookie banner") },
  ],
};

const configOf = (tasks: string[]): string => JSON.stringify({ closer: { type: "merge-back" }, tasks }, null, 2);

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

async function main(): Promise<void> {
  const repo = initTempRepo("report-demo-", { "package.json": PACKAGE, ".gitignore": ".delivery/\n", "delivery.config.json": configOf([FORM, PRICES, PURGE, BANNER]) });
  // One state folder for both runs, so the second finds the working copies the first made.
  const env = { [TEST_MOCK_SCRIPT]: await scriptFile(script), XDG_STATE_HOME: join(repo, "..", `${repo.split("/").at(-1)}-state`) };
  console.log(`Scratch project: ${repo}`);

  console.log("\n=== 1. Run the list until it stops, then come back and ask what happened ===");
  await show(repo, env, ["run"]);
  await show(repo, env, ["report"]);

  console.log("\n=== 2. Do what the report says: give the permission in the task's wording, and run again ===");
  writeFileSync(join(repo, "delivery.config.json"), configOf([FORM, PRICES, `${PURGE}. ${PERMISSION}`, BANNER]));
  execFileSync("git", ["commit", "-am", "give the permission to remove the old news pages"], { cwd: repo, env: cleanGitEnv(), stdio: "pipe" });
  await show(repo, env, ["run"]);
  await show(repo, env, ["report"]);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 2: Add the script**

In `package.json`, after the line `"demo:mock-slice-4": "npx tsx demos/agent-mock-slice-4-misbehaving-agent.ts",` add:

```json
    "demo:report-slice-1": "npx tsx demos/observability-slice-1-report.ts",
```

- [x] **Step 3: Run it**

Run: `npm run demo:report-slice-1`
Expected: exit 0. The first `delivery run` ends `(exit 4)`. The first `delivery report` begins `Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 not started.`, quotes `"This would delete 14 published pages. I need the owner to confirm before I remove them."` under `NEEDS YOU (1)`, and ends `(exit 0)`. The second `delivery report` begins `Your task list: 4 of 4 tasks completed and merged.`

Run: `npx tsc --noEmit && npx eslint demos/observability-slice-1-report.ts`
Expected: no output.

- [x] **Step 4: Name the demo in the README**

In `README.md`, at the end of the section "Come back to your task list" (after the paragraph that ends "use `delivery status --json`."), add:

```markdown
To see a report without an agent or a sign-in, run `npm run demo:report-slice-1` in a checkout of
this repository: it runs a list of four tasks against a scripted agent, prints the report, follows
its advice, and prints the report again.
```

- [x] **Step 5: Commit**

```bash
git add demos/observability-slice-1-report.ts package.json README.md
git commit -m "Add a demo of delivery report on the scripted agent" -m "The report's output should be visible to anyone with a checkout, with no agent and no sign-in, and a problem with it should be reproducible the same way. The demo follows the report's own advice, which is the claim the report makes."
```

---

## Acceptance criteria, and the task that delivers each

| Slice criterion | Delivered by |
|---|---|
| Headline counting tasks by what happened; sections present only when they have tasks | Task 6 (`headline`, `sectionLines`); shown end to end in Task 7 |
| A list run one task at a time; "Not started" says why and how to carry on | Task 5 (`listReport`, standing `not_started`), Task 6 (`notStartedReason`) |
| A named run reports that task or that run; no list reports the most recent run and says so | Task 5 (`taskReport`, `runReport`, `mostRecentSubject`), Task 7 (`reportCommand`, `NO_TASK_LIST`) |
| Kind of stop and who must act; "Failed after N attempts"; engineers' section with a line to pass on | Task 2 (the recorded cause), Task 4 (`plainOf`), Task 6 (`sectionOf`, `stoppedItem`) |
| The agent's own last explanation, quoted and labelled; no other task-specific wording | Task 5 (`agentSaid`), Task 6 (`quoted`, "The agent said:") |
| "To act" with a route that works; never `delivery resume` for a finished task; never a bare re-run | Task 4 (`ROUTE`, `NEXT`), Task 6 (`toAct`, `unfinishedItem`) |
| Landing words follow the way the project lands work; own closer told to check | Task 4 (`landedWords`, `completedWords`, `whereTheWorkIs`) |
| A usage limit said in those words | Task 2 (`limit`), Task 4 (`usage_limit`), Task 6 (`runStopLines`) |
| No internal words; "For whoever tunes this" | Task 4 and Task 6 (vocabulary tests over `FORBIDDEN`), Task 6 (`tuningLines`) |
| A run made before this slice still reports; "not recorded" | Task 4 (`unexplained`), Task 5 (old-record tests), Task 6 ("The run recorded this reason") |
| No runs; still going; liveness unknown | Task 7 (`NO_RUNS_YET`), Task 5 (`live`), Task 6 (`opening`) |
| One damaged record does not stop the report; no stack trace | Task 3 (`readRunRecords`, `loadSnapshot`), Task 5 (`incomplete`), Task 6 (`incompleteLines`), Task 7 |
| Control characters removed, line breaks kept | Task 6 (`stripControl`) |
| Exit 0 whenever the report could be made; `run` and `resume` codes unchanged | Task 7 (`reportCommand`); nothing in `run` or `resume` is touched |
| Byte-identical output; every report ends with "Next:" naming real commands | Task 6 (`renderText`, `nextLine`), Task 7 (same-bytes test) |
