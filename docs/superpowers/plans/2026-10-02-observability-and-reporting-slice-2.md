# Observability and Reporting — Slice 2: See Why a Task Stopped, With Every Decision and Retry Behind It

> **Status:** ✅ Complete — 2026-10-02 — `50bc3a1`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md`
**Spec:** `docs/superpowers/specs/2026-10-01-observability-and-reporting-design.md`

**Goal:** An engineer types `delivery status` for a stopped or running task and reads, beneath the account it already gave, each triage round that led there, the retry budgets at that moment and what to do, with the full text of every round on `--decisions`.

**Architecture:** The detail is a second rendering of the report document Slice 1 built, never a second derivation. `loadSnapshot` additionally reads back what each triage round wrote beside its log entry (`refs`), `deriveReport` (still pure) puts each round on its task as `decisions` and the record's `state` beside it, and a new pure renderer, `src/report/detail.ts`, turns one `ReportSurface` into the lines `status` adds. `src/cli/status-command.ts` keeps its own lookups, messages, exit codes and every line it prints today (`statusReport`, `statusBody` and the escalation packet rendering are not edited); it derives the document once more and appends the detail, the roll-up for a run of several tasks, the counts on each `--all` line, and a closing `Next:` line.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`, `.js` import suffixes), zod v4, vitest v5, commander v14. No new dependency.

## Global Constraints

- Node ≥22; `strict` and `noUncheckedIndexedAccess` are on; `tseslint.configs.strict` forbids the `!` non-null operator and `any`.
- No new dependency (spec, "Buy-vs-build decisions": "No dependency is added for the MUST or SHOULD tiers").
- **Buy-vs-build (slice Build note, copied):** "The detail is another rendering of the read model the report already uses, not a second derivation; the existing escalation packet rendering at the top of `delivery status` is kept as it is. Budget figures and triage rounds come from the record the harness already keeps and the folds that resuming uses."
- **Operability/DX:** the slice carries no Operational note. Nothing in set-up, configuration, `init` or `validate` changes; `status` still only reads and takes no lock, so it stays safe while a run is going. There is no new demo.
- **Compatibility (slice criterion 9):** every line `delivery status` prints today is still printed, in the same order, and its exit codes are unchanged (0 whenever the run could be read, 2 when it could not be found or the options contradict each other). `--json` output of `status`, `status <run>` and `status --all` is unchanged, key for key: the triage rounds and budgets join the published document in Slice 5.
- **Exit codes, one rule** (spec, "Commands and exit codes"): `status` exits ok whenever the report could be made, whatever it says.
- **Vocabulary:** the sections this slice adds are the technical ones. They use the harness's own words (triage, gate, correction, verdict, reroute, escalate) deliberately; the "To act" steps are the report's own plain words, unchanged. Evidence, rationales, briefs and packets are shown word for word, never paraphrased.
- **Accuracy:** nothing is stated that the record cannot back. A missing fact reads "not recorded", never `0`, blank or a guess; "none" is said only where the record shows there was none.
- **Determinism:** `src/report/derive.ts` and `src/report/detail.ts` read no file, clock, locale, environment variable or terminal width. The same record, list and `live` value give byte-identical lines.
- **Terminal safety** (spec, "Security"): every field quoted from the record goes through `stripControl` (or `quoted`, which uses it) before it is printed. The record is never altered.
- User-facing copy (status lines, `--help`, README, docs, changeset): controlled British English, plain words, no em-dashes (colons, semicolons, commas instead).
- Every path in a command is relative to the repository root; run every command from there and never `cd` elsewhere. If `node_modules` is missing, run `npm ci` once before the first test command.
- Targeted verification only: each task runs its own test files with `npx vitest run <files>`, plus `npx tsc --noEmit` and `npx eslint` on what it touched. Do not run the whole suite in a task. Tests under `tests/` drive the compiled command, so run `npm run build` before any `npx vitest run tests/...` command.
- The slice's UAT/e2e test is recorded by a later phase: do not write one. No new file is added under `tests/`. Two existing files there are touched only because they pin output this slice deliberately changes: one recorded test (Tasks 6 and 7) and the getting-started guide's sample (Task 5).
- Tests assert expected values written out by hand. A test that compares a function with itself, or one output of the code under test with another, cannot fail and is not a test.
- Commit after each green cycle, as the steps say: one line saying what changed, then a paragraph saying why.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **Existing lines are appended to, never re-laid.** The spec's sample of the status detail uses capital headings and a different order. Criterion 9 and the Build note outrank the sample: `statusReport` and the packet rendering stay byte for byte, and the new sections follow in the sentence style `status` already has ("How it got here", "Retry budgets at stop", "To act").
  - **The document gains only what this slice renders:** `state` and `decisions` on each task. `states`, `nextStep`, `escalation`, `usage`, `repairs` and entry times belong to later slices and are not added.
  - **Refs are read in `loadSnapshot`, so `deriveReport` stays pure.** A round's ref is parsed with the harness's own validators (`BriefRef` from `src/prompt-assembly.ts`, `PacketRef` from `src/surface.ts`), so a report and the next session cannot read it differently. A missing or damaged ref is left out and the round reads "not recorded": one lost file must not cost the reader the whole account.
  - **`status` reads the records once more than before.** It keeps its own lookups (`lookUp`, `mostRecent`, `viewOf`, `allRuns`) because they own which run is meant, the wording of every refusal and the exit codes, and then derives the report document for the new sections. `status <task-id>` therefore reads every record once, as `delivery report <id>` does; the triage refs it reads are only that task's own (Task 2), not every run's. The spec asks that reading cost be no worse than today's `status`; the extra read is accepted for now and marked with a `ponytail:` comment naming the upgrade (serve the account from the same snapshot).
  - **A round's brief is printed by the function that builds the prompt.** `briefLines` is lifted out of `assemblePrompt` (Task 1) and used by both, so "what the next attempt was told" is the same text, not a look-alike.
  - **A round that wrote no brief is told apart from a brief that cannot be read back.** The record does tell them apart: a round always writes its ref (`{ trigger, rationale }`, plus `artifact` when it produced one), so a ref that is there with no `artifact` means the round wrote none, and a ref that is missing or damaged means the record cannot say. The first reads "Brief for the next session: none; this round wrote no brief." and the second "Brief for the next session: not recorded." The rule-based router the command line runs never writes a brief, so the first is what most rounds of a real run show; calling it "not recorded" would make every such run read as if it had lost data. `Decision.recorded` carries the difference from `deriveReport` to the renderer.
  - **The one-line form names the trigger in words and the verdict as the harness spells it** ("After attempt 2: a gate failure; verdict: reroute"). A trigger this build has no words for is shown as the record holds it, with control characters removed.
  - **`--decisions` expands the rounds in place;** the rest of the output is the same. It works on a run of several tasks (each task's rounds, under its name). It is refused with `--all` (a listing has no rounds) and with `--json` (printing text where a script expects data would be worse than saying so), both exit 2, the code `status` already uses for contradictory options.
  - **The two plain statements are said only where true.** "An unchanged task on your list is not run again" is printed only for a stopped task that is on the list; "`delivery resume` does not apply" under every stopped task. A stop with no recorded cause (a run made before Slice 1) gets "To act: not recorded" and no invented steps.
  - **In-flight words are said only while the run is going.** `cursor.state` is right for a task that is going; a killed run can leave it a step behind its log. So a task of a live run says what it is doing ("the agent is working, attempt 2", from the run's own `STEP_PHRASES`), and a task of a run that stopped part way keeps "not finished yet". The counts line above the tasks keeps its words.
  - **`--all` uses one rule for every line:** the counts `delivery report` would open with for that run (`headlineCounts`), appended after the words in brackets that are already there. The bracketed words are `status`'s own long-standing outcome words; the counts classify by the recorded cause. For a record with no recorded cause the two can read differently ("needs a decision from you" beside "1 stopped, for your engineers"); both are kept, because criterion 9 forbids changing the first and the second is what the report says.
  - **"Every status output ends with Next:" means every text output.** `--json` output is data and is unchanged; refusals go to standard error as before.
  - **No new demo:** the slice has no Operational note, and the report demo from Slice 1 is not extended.

## Scaffolding Impact

- **Reactive:**
  - `README.md`, "See what happened to a run": describes what `status` prints for one task and says `--json` gives "the same information" → Task 5.
  - `README.md`, "A run of several tasks at once": the description and the sample output → Task 6.
  - `README.md`, "See every run": the sample output and its description → Task 7.
  - `docs/getting-started.md`, "4. Read what happened, later": the sample output, which `tests/getting-started-guide.test.ts` holds to the real output line by line → Task 5.
  - `tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts`: pins the last line of a run's status and the whole `--all` line, both deliberately changed → Tasks 6 and 7.
- **Proactive:**
  - `delivery status --help` gains `--decisions` (`src/cli/program.ts`) → Task 5.
  - `.changeset/see-why-a-task-stopped.md` (every user-visible change gets a changeset here) → created in Task 5, extended in Tasks 6 and 7.
- **Inherited (Operational note):** none on this slice.
- Checked and unchanged: `docs/shared-environment.md` (its `status` samples are partial, marked with "…", and every line they show is still printed); `docs/project-configuration.md` (mentions `status --all` only by name); the global `--json` help text in `src/cli/program.ts`; `docs/single-surface-control-flow.md` and `docs/multi-surface-control-flow.md` (nothing recorded changes); `src/index.ts` (public exports are Slice 5's); `CONTRIBUTING.md`; `vendor/` (never edited). The other recorded tests that read `status` (`tests/cli-and-configuration/4-…`, `tests/cli-and-configuration/6-…`, `tests/shared-environment-guide.test.ts`, `tests/multi-surface-supervisor/5-…` and `6-…`, `tests/project-configuration/2-…`, `tests/observability-and-reporting/…`, `tests/delivery-command.test.ts`) assert lines that are still printed and need no change. No `CLAUDE.md` or `AGENTS.md` in this repo.

---

### Task 1: Tidy first: export what the detail reuses ✅ DONE (deliver-slice)

No behaviour changes in this task. It lifts four small pieces out of where they are private so that Tasks 3, 4 and 6 reuse them instead of copying them. There is no new test: the existing tests of the code that moves are the check, before and after.

**Files:**
- Modify: `src/prompt-assembly.ts` (new export `briefLines`, used by `assemblePrompt`)
- Modify: `src/surface.ts` (export `PacketRef`)
- Modify: `src/report/plain.ts` (export `attemptsWord`)
- Modify: `src/report/text.ts` (export `quoted`; export `toAct` with an `indent` parameter; new export `budgetTotals`, used by `tuningLines`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `briefLines(brief: SharpenedBrief): string[]` from `src/prompt-assembly.ts`: the five lines a session reads a brief as.
  - `PacketRef` from `src/surface.ts`: the zod schema `{ artifact: EscalationPacket, cause?: OutcomeCause }` an escalate round's ref is read with.
  - `attemptsWord(count: number): string` from `src/report/plain.ts`: "1 attempt", "4 attempts".
  - `quoted(text: string, indent: string): string` from `src/report/text.ts`.
  - `toAct(next: string[], indent = "    "): string[]` from `src/report/text.ts`.
  - `budgetTotals(surfaces: ReportSurface[]): BudgetRow[]` from `src/report/text.ts`.

- [ ] **Step 1: Run the existing tests and see them pass**

Run: `npx vitest run src/prompt-assembly.test.ts src/surface.test.ts src/report`
Expected: PASS. Note the number of tests; it must be the same after Step 3 and after Step 6.

- [ ] **Step 2: Lift the brief's lines out of `assemblePrompt`, and export `PacketRef`**

Each change below is shown as a unified diff: remove the `-` lines, add the `+` lines.

```diff
--- a/src/prompt-assembly.ts
+++ b/src/prompt-assembly.ts
@@ -37,6 +37,17 @@ export interface AssembledPrompt {
 export const BriefRef = z.object({ artifact: SharpenedBrief });
 const CloseDetail = z.object({ detail: z.string() });
 
+/** A brief as the session it was written for reads it, one line per field. Exported so a report shows exactly what that session was told. */
+export function briefLines(brief: SharpenedBrief): string[] {
+  return [
+    `Problem: ${brief.problem}`,
+    `Dead ends: ${brief.dead_ends}`,
+    `Scope: ${brief.scope}`,
+    `References: ${brief.references.length === 0 ? "none" : brief.references.join(", ")}`,
+    `Diagnosis (a hypothesis to test, not an established fact): ${brief.diagnosis}`,
+  ];
+}
+
 /**
  * Read what the log points at. The only I/O in this module, split out so that
  * `assemblePrompt` stays a pure function of its arguments and determinism is
@@ -109,13 +120,7 @@ export function assemblePrompt(
   const brief =
     evidence.brief === null
       ? "No distilled brief — work from the task and the gate evidence below."
-      : [
-          `Problem: ${evidence.brief.problem}`,
-          `Dead ends: ${evidence.brief.dead_ends}`,
-          `Scope: ${evidence.brief.scope}`,
-          `References: ${evidence.brief.references.length === 0 ? "none" : evidence.brief.references.join(", ")}`,
-          `Diagnosis (a hypothesis to test, not an established fact): ${evidence.brief.diagnosis}`,
-        ].join("\n");
+      : briefLines(evidence.brief).join("\n");
 
   const gateEvidence =
     evidence.newFailures.length === 0
```

```diff
--- a/src/surface.ts
+++ b/src/surface.ts
@@ -218,7 +218,7 @@ async function escalateFor(
 }
 
 /** The ref shape `triage()` writes for an escalate round. */
-const PacketRef = z.object({ artifact: EscalationPacket, cause: OutcomeCause.optional() });
+export const PacketRef = z.object({ artifact: EscalationPacket, cause: OutcomeCause.optional() });
 
 /**
  * What an escalate verdict's outcome records: the cause the port named, else
```

- [ ] **Step 3: Check nothing changed**

Run: `npx vitest run src/prompt-assembly.test.ts src/surface.test.ts`
Expected: PASS, the same tests as before.

Run: `npx tsc --noEmit && npx eslint src/prompt-assembly.ts src/surface.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/prompt-assembly.ts src/surface.ts
git commit -m "Export the brief's lines and the packet ref shape" -m "A status report is about to show what each triage round told the next session and what it wrote for a person. Reading those with the harness's own validator and printing a brief with the function that builds the prompt means the report cannot drift from what the session was actually given. Nothing about what a run does changes."
```

- [ ] **Step 5: Export the report helpers the detail reuses**

```diff
--- a/src/report/plain.ts
+++ b/src/report/plain.ts
@@ -99,7 +99,7 @@ const AUDIENCE: Record<PlainGroup, Audience> = {
   stopped: "unknown",
 };
 
-const attemptsWord = (count: number): string => `${count} ${count === 1 ? "attempt" : "attempts"}`;
+export const attemptsWord = (count: number): string => `${count} ${count === 1 ? "attempt" : "attempts"}`;
 const timesWord = (count: number): string => (count === 1 ? "once" : `${count} times`);
 
 const NOT_YOURS = "This is a problem with the setup, not a decision for you.";
```

```diff
--- a/src/report/text.ts
+++ b/src/report/text.ts
@@ -1,7 +1,7 @@
 import { paint, type Tone } from "../paint.js";
 import { USAGE_LIMIT_WORDS } from "../ports.js";
 import { Population } from "../schema.js";
-import type { DamagedRecord, ReportDocument, ReportRun, ReportSurface } from "./document.js";
+import type { BudgetRow, DamagedRecord, ReportDocument, ReportRun, ReportSurface } from "./document.js";
 import { completedWords, landedWords, RETRY_WORDS, whereTheWorkIs, type Landing } from "./plain.js";
 
 export const NO_RUNS_YET = "No runs yet in this folder. Start one with: delivery run";
@@ -21,7 +21,7 @@ export function stripControl(text: string): string {
 }
 
 /** Words from the record, in quotation marks, with later lines set under the first. */
-function quoted(text: string, indent: string): string {
+export function quoted(text: string, indent: string): string {
   return `"${stripControl(text).trim().split("\n").join(`\n${indent}`)}"`;
 }
 
@@ -188,12 +194,12 @@ function runStopLines(run: ReportRun | null): string[] {
   }
 }
 
-/** "To act:" with its steps, numbered only when there is more than one. */
-function toAct(next: string[]): string[] {
+/** "To act:" with its steps, numbered only when there is more than one. Indented under a task in the report; flush left in `status`. */
+export function toAct(next: string[], indent = "    "): string[] {
   const [only] = next;
   if (only === undefined) return [];
-  if (next.length === 1) return [`    To act: ${only}`];
-  return next.map((step, index) => `    ${index === 0 ? "To act:" : "       "} ${index + 1}. ${step}`);
+  if (next.length === 1) return [`${indent}To act: ${only}`];
+  return next.map((step, index) => `${indent}${index === 0 ? "To act:" : "       "} ${index + 1}. ${step}`);
 }
 
 /** A stopped task: the kind of stop, the agent's own words, where the work is, and what to do. */
@@ -269,14 +275,19 @@ function sectionLines(doc: ReportDocument, section: Section, colour: boolean): s
   return ["", paint(colour, tone, `${title} (${surfaces.length})`), ...body];
 }
 
+/** The retries of several tasks added up, kind by kind, in the fixed order of the kinds. */
+export function budgetTotals(surfaces: ReportSurface[]): BudgetRow[] {
+  return Population.options.map((population) => {
+    const rows = surfaces.flatMap((surface) => surface.budgets.filter((row) => row.population === population));
+    return { population, used: rows.reduce((sum, row) => sum + row.used, 0), max: rows.reduce((sum, row) => sum + row.max, 0) };
+  });
+}
+
 /** Retries used, in the owner's vocabulary, for whoever adjusts the limits. Nothing when no task has a run to count. */
 function tuningLines(doc: ReportDocument, colour: boolean): string[] {
   const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
   if (ran.length === 0) return [];
-  const sums = Population.options.map((population) => {
-    const rows = ran.flatMap((surface) => surface.budgets.filter((row) => row.population === population));
-    return `${RETRY_WORDS[population]} ${rows.reduce((sum, row) => sum + row.used, 0)} of ${rows.reduce((sum, row) => sum + row.max, 0)}`;
-  });
+  const sums = budgetTotals(ran).map((row) => `${RETRY_WORDS[row.population]} ${row.used} of ${row.max}`);
   return [
     "",
     paint(colour, "quiet", "FOR WHOEVER TUNES THIS"),
```

- [ ] **Step 6: Check nothing changed**

Run: `npx vitest run src/report`
Expected: PASS, the same tests as in Step 1. `src/report/text.test.ts` covers `toAct` (through the report's "To act" lines) and `tuningLines` (through "FOR WHOEVER TUNES THIS"); both must read exactly as before.

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/report/plain.ts src/report/text.ts
git commit -m "Export the report's wording helpers for a second renderer" -m "The status detail gives the same advice and adds up the same retries as the report. Exporting toAct, quoted, attemptsWord and the per-kind totals lets it use the report's own functions rather than a copy that could come to say something different. The report's output is unchanged."
```

---

### Task 2: Read back what each triage round wrote ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/report/snapshot.ts`
- Modify: `src/report/report-fixtures.ts` (test support: a record can be written with refs; `snapshotOf` gains `refs`)
- Test: `src/report/snapshot.test.ts`

**Interfaces:**
- Consumes: `readRef(dir: string, refId: string): Promise<unknown>` from `src/case-file.ts`; `FileNotFound`, `CorruptCaseFile` from `src/errors.ts` (both exist).
- Produces:
  - `export type TriageRefs = Record<string, Record<string, unknown>>` from `src/report/snapshot.ts`: by run id, then by ref id.
  - `RecordSnapshot.refs: TriageRefs`. A run with no readable ref has no key. For a `task` subject only that task's refs are read; for a `list` or `run` subject, every record's.
  - Test support: `TaskRun.refs?: Record<string, unknown>` (written to disk by `writeRecord`); `snapshotOf()` defaults `refs: {}`.

- [ ] **Step 1: Let the fixtures write a round's ref**

In `src/report/report-fixtures.ts`, add `writeRef` to the import from `../case-file.js`:

```ts
import { appendEntry, create, initialCaseFile, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
```

Add this field at the end of `interface TaskRun`:

```ts
  /** What the run wrote beside its log, by ref id: only `writeRecord` puts these on disk. */
  refs?: Record<string, unknown>;
```

In `writeRecord`, add this line directly after the `for (const entry of run.history ?? [])` line:

```ts
  for (const [refId, data] of Object.entries(run.refs ?? {})) await writeRef(dir, refId, data);
```

- [ ] **Step 2: Write the failing tests**

Apply to `src/report/snapshot.test.ts`:

```diff
--- a/src/report/snapshot.test.ts
+++ b/src/report/snapshot.test.ts
@@ -1,11 +1,11 @@
-import { writeFile } from "node:fs/promises";
+import { mkdir, writeFile } from "node:fs/promises";
 import { join } from "node:path";
 import { describe, expect, it } from "vitest";
 import { FileNotFound, RunFileNotFound } from "../errors.js";
 import { appendRunEntry, createRunFile } from "../run-file.js";
 import { prepareRunDir, supervisedPlace } from "../run-location.js";
 import { initTempRepo } from "../temp-repo.js";
-import { attempt, closedAt, damageLog, fill, FOOTER, FORM, ID, writeRecord } from "./report-fixtures.js";
+import { attempt, closedAt, damageLog, failedCheck, fill, FOOTER, FORM, ID, writeRecord } from "./report-fixtures.js";
 import { loadSnapshot } from "./snapshot.js";
 
 const LIST = [{ intent: FORM }, { intent: FOOTER }];
@@ -29,6 +29,7 @@ describe("reading what a report is derived from", () => {
       records: [],
       runs: [],
       damaged: [],
+      refs: {},
     });
   });
 
@@ -67,6 +68,44 @@ describe("reading what a report is derived from", () => {
     expect(snapshot.damaged).toEqual([{ runId: ID.run, file: `.delivery/supervised/${ID.run}` }]);
   });
 
+  it("reads back what each triage round wrote beside its log entry, by run and by ref", async () => {
+    const repo = initTempRepo("snapshot-refs-", { "README.md": "x\n" });
+    const round = { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" };
+    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });
+    await writeRecord(repo, { runId: ID.footer, task: FOOTER, history: [...attempt(1, "first go"), ...failedCheck(1, "reroute")], refs: { "triage-0": round } });
+
+    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });
+
+    expect(snapshot.refs).toEqual({ [ID.footer]: { "triage-0": round } });
+  });
+
+  it("leaves out a round's ref that is missing or cannot be read, and still reads the record", async () => {
+    const repo = initTempRepo("snapshot-refs-missing-", { "README.md": "x\n" });
+    const history = [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go"), ...failedCheck(2, "escalate")];
+    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER, history });
+    await mkdir(join(dir, "refs"), { recursive: true });
+    await writeFile(join(dir, "refs", "triage-1.json"), "{ truncated");
+
+    const snapshot = await loadSnapshot(repo, { kind: "task", runId: ID.footer }, { live: false, list: LIST });
+
+    expect(snapshot.refs).toEqual({});
+    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.footer]);
+    expect(snapshot.damaged).toEqual([]);
+  });
+
+  it("reads only the rounds of the task a report on one task is about", async () => {
+    const repo = initTempRepo("snapshot-refs-one-task-", { "README.md": "x\n" });
+    const round = { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" };
+    const history = [...attempt(1, "first go"), ...failedCheck(1, "reroute")];
+    await writeRecord(repo, { runId: ID.form, task: FORM, history, refs: { "triage-0": round } });
+    await writeRecord(repo, { runId: ID.footer, task: FOOTER, history, refs: { "triage-0": round } });
+
+    const snapshot = await loadSnapshot(repo, { kind: "task", runId: ID.footer }, { live: false, list: LIST });
+
+    expect(snapshot.refs).toEqual({ [ID.footer]: { "triage-0": round } });
+    expect(snapshot.records.map((record) => record.runId).sort()).toEqual([ID.form, ID.footer].sort());
+  });
+
   it("fails to answer for a named run nothing on disk answers for", async () => {
     const repo = initTempRepo("snapshot-unknown-", { "README.md": "x\n" });
     await writeRecord(repo, { runId: ID.form, task: FORM });
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/report/snapshot.test.ts`
Expected: FAIL. Four tests fail: the empty-snapshot test (the snapshot has no `refs` key) and the three new ones (`snapshot.refs` is `undefined`).

- [ ] **Step 4: Read the refs in `loadSnapshot`**

Apply to `src/report/snapshot.ts`:

```diff
--- a/src/report/snapshot.ts
+++ b/src/report/snapshot.ts
@@ -1,6 +1,7 @@
 import { readdir } from "node:fs/promises";
 import { join, relative } from "node:path";
-import { CorruptRunFile, FileNotFound, RunFileNotFound } from "../errors.js";
+import { readRef } from "../case-file.js";
+import { CorruptCaseFile, CorruptRunFile, FileNotFound, RunFileNotFound } from "../errors.js";
 import { loadRunFile } from "../run-file.js";
 import { runsRoot, supervisedRoot } from "../run-location.js";
 import { readRunRecords, type DamagedRun, type RunRecord } from "../run-records.js";
@@ -17,6 +18,9 @@ export interface DamagedFile {
   taskDef?: TaskDef;
 }
 
+/** What the triage rounds of each run point at, read back: by run id, then by ref id. A ref that is missing or unreadable is simply not there. */
+export type TriageRefs = Record<string, Record<string, unknown>>;
+
 /** Everything a report is derived from, read once. Plain data: `deriveReport` does no reading of its own. */
 export interface RecordSnapshot {
   subject: ReportSubject;
@@ -27,6 +31,33 @@ export interface RecordSnapshot {
   records: RunRecord[];
   runs: RunFile[];
   damaged: DamagedFile[];
+  refs: TriageRefs;
+}
+
+/**
+ * What each triage round of each record wrote beside its log entry: the brief
+ * or packet the round produced. Read here so that `deriveReport` reads nothing.
+ * A ref that is missing or damaged is left out, and the round then reads "not
+ * recorded": one lost file must not cost the reader the whole account.
+ */
+async function readTriageRefs(records: RunRecord[]): Promise<TriageRefs> {
+  const read = await Promise.all(
+    records.map(async (record) => {
+      const ids = record.caseFile.history.flatMap((entry) => (entry.t === "triage" ? [entry.artifactRef] : []));
+      const found = await Promise.all(
+        ids.map(async (id): Promise<[string, unknown][]> => {
+          try {
+            return [[id, await readRef(record.dir, id)]];
+          } catch (err) {
+            if (err instanceof FileNotFound || err instanceof CorruptCaseFile) return [];
+            throw err;
+          }
+        }),
+      );
+      return [record.runId, Object.fromEntries(found.flat())] as const;
+    }),
+  );
+  return Object.fromEntries(read.filter(([, refs]) => Object.keys(refs).length > 0));
 }
 
 /** Every run of several at once this repository holds, and the ones whose record cannot be read back. */
@@ -82,5 +113,10 @@ export async function loadSnapshot(repoPath: string, subject: ReportSubject, { l
     const dir = join(supervisedRoot(repoPath), subject.runId);
     throw new RunFileNotFound(dir, join(dir, "run.json"));
   }
-  return { subject, live, list, records: tasks.records, runs: supervised.runs, damaged };
+  // One task's report renders only that task's rounds, so only its refs are read: `status <task-id>` must not
+  // cost a file read per round of every run the repository has ever had (spec, "Read cost").
+  // ponytail: a list or a run still reads every record's rounds; narrow those to the records they show if a
+  // repository with thousands of runs makes a report slow.
+  const rounds = subject.kind === "task" ? tasks.records.filter((record) => record.runId === subject.runId) : tasks.records;
+  return { subject, live, list, records: tasks.records, runs: supervised.runs, damaged, refs: await readTriageRefs(rounds) };
 }
```

In `src/report/report-fixtures.ts`, add `refs: {},` to `snapshotOf`, after `damaged: [],`:

```ts
export const snapshotOf = (over: Partial<RecordSnapshot> = {}): RecordSnapshot => ({
  subject: { kind: "list" },
  live: false,
  list: [FORM, FOOTER, HOMEPAGE, BANNER].map((intent) => ({ intent })),
  records: [],
  runs: [],
  damaged: [],
  refs: {},
  ...over,
});
```

(Only the `refs: {},` line is new.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/report`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/report/snapshot.ts src/report/snapshot.test.ts src/report/report-fixtures.ts
git commit -m "Read each triage round's ref into the report snapshot" -m "The brief or packet a triage round produced is kept beside the log, not in it. Reading it in the one place a report reads from keeps the derivation pure, and leaving out a ref that is missing or damaged means one lost file costs the reader that round's text, not the whole account."
```

---

### Task 3: Put the triage rounds and the state on the report document ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/report/document.ts`
- Modify: `src/report/derive.ts`
- Modify: `src/report/report-fixtures.ts` (test support: a record's state; a brief and a packet)
- Test: `src/report/derive.test.ts`

**Interfaces:**
- Consumes: `RecordSnapshot.refs` (Task 2); `BriefRef` from `src/prompt-assembly.ts`; `PacketRef` from `src/surface.ts` (Task 1); `SharpenedBrief`, `EscalationPacket` from `src/triage-role-config.ts`; `SurfaceState`, `TriageEntry` from `src/schema.ts`.
- Produces:
  - `Decision` (schema and type) from `src/report/document.ts`: `{ afterAttempt: number; trigger: string; verdict: "reroute" | "fix_the_gate" | "retry_close" | "recheck_gate" | "escalate" | "abort"; rationale: string; recorded: boolean; brief: SharpenedBrief | null; packet: EscalationPacket | null }`; `recorded` is false when the round's ref is missing or cannot be read as what a round writes, so a renderer can tell "wrote none" from "not recorded" (the first three take their types from `TriageEntry`).
  - `ReportSurface.state: SurfaceState | null` and `ReportSurface.decisions: Decision[]` (oldest first; `[]` for a task with no run).
  - Test support from `src/report/report-fixtures.ts`: `TaskRun.state?: SurfaceState`, `BRIEF: SharpenedBrief`, `PACKET: EscalationPacket`.

- [ ] **Step 1: Extend the fixtures**

In `src/report/report-fixtures.ts`:

Change the import from `../case-file.js` and the type import from `../schema.js`, and add the import from `../triage-role-config.js`:

```ts
import { appendEntry, create, initialCaseFile, setBaseBranch, setOutcome, updateCursor, writeRef } from "../case-file.js";
```

```ts
import type { CaseFileOutcome, CloserRef, CreateHeader, GateRef, HistoryEntry, OutcomeCause, RunEntry, RunFile, RunOutcome, SurfaceState } from "../schema.js";
import type { EscalationPacket, SharpenedBrief } from "../triage-role-config.js";
```

Add this field to `interface TaskRun`, before `refs`:

```ts
  /** The state the record is in. Absent: the state a record is created in. */
  state?: SurfaceState;
```

Replace the whole `recordOf` function with:

```ts
export function recordOf(run: TaskRun, repoPath = "/repo"): RunRecord {
  const caseFile = initialCaseFile(headerOf(run), DEFAULT_BUDGETS);
  return {
    runId: run.runId,
    repoPath,
    dir: join(runsRoot(repoPath), run.runId),
    caseFile: {
      ...caseFile,
      header: { ...caseFile.header, baseBranch: "main" },
      cursor: { ...caseFile.cursor, ...(run.state ? { state: run.state } : {}) },
      history: run.history ?? [],
      ...(run.outcome ? { outcome: run.outcome } : {}),
    },
  };
}
```

In `writeRecord`, add this line directly after the `run.refs` line:

```ts
  if (run.state) await updateCursor(dir, { state: run.state });
```

Add these two constants directly before the `/** A run of several at once taking a task into a slot. */` comment:

```ts
/** What an agent-run triage round writes for the next session. */
export const BRIEF: SharpenedBrief = {
  problem: "Two footer links point at pages that were removed.",
  dead_ends: "Attempt 1 rewrote the link text and left the targets alone.",
  scope: "Only src/footer.html.",
  references: ["worker-1-0"],
  diagnosis: "The targets moved under /about.",
};

/** What a round that gives up writes for a person. */
export const PACKET: EscalationPacket = {
  decision: "No correction budget remains (3/3 used). Decide whether to continue manually, amend the task, or abandon it.",
  evidence: "footer-links: 2 of 6 links still fail",
  dead_ends: "1. Rewrote the link text.\n2. Pointed both links at the homepage.",
  why_now: "The correction budget is spent (3/3 used), so the harness cannot try again.",
  references: ["worker-4-0", "triage-3"],
};
```

- [ ] **Step 2: Write the failing tests**

Apply to `src/report/derive.test.ts`:

```diff
--- a/src/report/derive.test.ts
+++ b/src/report/derive.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, it } from "vitest";
 import { ReportDocument } from "./document.js";
 import { deriveReport, mostRecentSubject } from "./derive.js";
-import { attempt, BANNER, closedAt, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, ID, recordOf, runFileOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
+import { attempt, BANNER, BRIEF, closedAt, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, ID, PACKET, recordOf, runFileOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
 
 describe("a report on the project's task list", () => {
   it("stands each task as its latest run left it, and a task with no run as not started", () => {
@@ -110,6 +110,57 @@ describe("what a report says of one task", () => {
   });
 });
 
+describe("what a report says of how a task got where it is", () => {
+  const refs = {
+    [ID.footer]: {
+      "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
+      "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
+      "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET, cause: { kind: "budget", population: "correction" } },
+    },
+  };
+  const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [footerFailed], refs }));
+  const [failed] = doc.surfaces;
+
+  it("lists every triage round, oldest first, in the harness's own words", () => {
+    expect(failed?.decisions.map((round) => [round.afterAttempt, round.trigger, round.verdict, round.rationale])).toEqual([
+      [1, "gate_fail", "reroute", "gate_fail: reroute"],
+      [2, "gate_fail", "reroute", "gate_fail: reroute"],
+      [3, "gate_fail", "reroute", "gate_fail: reroute"],
+      [4, "gate_fail", "escalate", "gate_fail: escalate"],
+    ]);
+  });
+
+  it("carries the brief a round wrote for the next session, and the packet a round wrote for a person", () => {
+    expect(failed?.decisions[0]).toMatchObject({ recorded: true, brief: BRIEF, packet: null });
+    expect(failed?.decisions[3]).toMatchObject({ recorded: true, brief: null, packet: PACKET });
+    expect(ReportDocument.parse(doc)).toEqual(doc);
+  });
+
+  it("tells a round that wrote neither from a round whose ref is not there or is not what a round writes", () => {
+    expect(failed?.decisions[1]).toMatchObject({ recorded: true, brief: null, packet: null });
+    expect(failed?.decisions[2]).toMatchObject({ recorded: false, brief: null, packet: null });
+
+    const garbled = { [ID.footer]: { "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: { problem: 7 } } } };
+    const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [footerFailed], refs: garbled })).surfaces;
+    expect(surface?.decisions[0]).toMatchObject({ recorded: false, brief: null, packet: null });
+  });
+
+  it("has no rounds for a task nothing set back, and none for a task with no run", () => {
+    const quiet = deriveReport(snapshotOf({ records: [formDone] }));
+
+    expect(quiet.surfaces.map((surface) => surface.decisions)).toEqual([[], [], [], []]);
+  });
+
+  it("names the state the record is in, and none for a task with no run", () => {
+    const working = recordOf({ runId: ID.footer, task: FOOTER, history: attempt(1, "first go"), state: "GATING" });
+
+    const [, going, notStarted] = deriveReport(snapshotOf({ records: [formDone, working] })).surfaces;
+
+    expect(going?.state).toBe("GATING");
+    expect(notStarted?.state).toBeNull();
+  });
+});
+
 describe("a report on a run of several tasks at once", () => {
   const working = footerWorking;
   const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
```

(`footerFailed` in the fixtures is four attempts, each followed by a failed check and a triage round whose `artifactRef` is `triage-0` to `triage-3`; the `refs` here deliberately leave `triage-2` out.)

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/report/derive.test.ts`
Expected: FAIL. The five new tests fail: a surface has no `decisions` and no `state` yet.

- [ ] **Step 4: Add the two fields to the document**

Apply to `src/report/document.ts`:

```diff
--- a/src/report/document.ts
+++ b/src/report/document.ts
@@ -1,5 +1,6 @@
 import { z } from "zod";
-import { OutcomeCause, Population, UsageLimit } from "../schema.js";
+import { OutcomeCause, Population, SurfaceState, TriageEntry, UsageLimit } from "../schema.js";
+import { EscalationPacket, SharpenedBrief } from "../triage-role-config.js";
 
 /** The version every report document names itself by. A later version adds keys; it never renames or removes one. */
 export const REPORT_SCHEMA = "delivery.report/1";
@@ -42,6 +43,26 @@ const BudgetRow = z.object({
 });
 export type BudgetRow = z.infer<typeof BudgetRow>;
 
+/**
+ * One triage round: what set it off, what was decided and why, in the
+ * harness's own words, with what the round produced for whoever came next.
+ */
+export const Decision = z.object({
+  /** The attempt the round followed. */
+  afterAttempt: TriageEntry.shape.afterAttempt,
+  trigger: TriageEntry.shape.trigger,
+  verdict: TriageEntry.shape.verdict,
+  /** The round's reasoning, word for word. */
+  rationale: z.string(),
+  /** Whether what the round wrote beside the log could be read back. False: `brief` and `packet` are null because the record cannot say, not because the round wrote neither. */
+  recorded: z.boolean(),
+  /** The brief the round wrote for the next session; null when it wrote none, or when what it wrote cannot be read back (`recorded` says which). */
+  brief: SharpenedBrief.nullable(),
+  /** The packet the round wrote for a person; null likewise. */
+  packet: EscalationPacket.nullable(),
+});
+export type Decision = z.infer<typeof Decision>;
+
 /** One task. Every key is always there: null where the record does not hold the fact. */
 export const ReportSurface = z.object({
   /** The task's own run id; null for a task with no run yet. */
@@ -51,6 +72,8 @@ export const ReportSurface = z.object({
   /** Its place in the project's list as written now. */
   queue: QueuePosition.nullable(),
   standing: Standing,
+  /** The state the record is in; null for a task with no run. Right for a task that is going; a killed run can leave it one step behind its log. */
+  state: SurfaceState.nullable(),
   startedAt: z.string().nullable(),
   finishedAt: z.string().nullable(),
   /** How it ended, as the run recorded it. */
@@ -63,6 +86,8 @@ export const ReportSurface = z.object({
   /** How many times the agent was set to work on the task. */
   attempts: z.number().int().nonnegative(),
   budgets: z.array(BudgetRow),
+  /** Every triage round, oldest first. */
+  decisions: z.array(Decision),
   /** The usage limit that stopped the task's last session, when one did. */
   limit: UsageLimit.nullable(),
   /** Stopped tasks only. */
```

- [ ] **Step 5: Derive them**

Apply to `src/report/derive.ts`:

```diff
--- a/src/report/derive.ts
+++ b/src/report/derive.ts
@@ -6,7 +6,9 @@ import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js
 import { Population, type RunFile, type TaskDef } from "../schema.js";
 import { claimedBy, supervisedView } from "../supervised-view.js";
 import { findQueueRun, queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
-import { REPORT_SCHEMA, Standing, type DamagedRecord, type ReportDocument, type ReportRun, type ReportSurface } from "./document.js";
+import { BriefRef } from "../prompt-assembly.js";
+import { PacketRef } from "../surface.js";
+import { REPORT_SCHEMA, Standing, type DamagedRecord, type Decision, type ReportDocument, type ReportRun, type ReportSurface } from "./document.js";
 import { plainOf } from "./plain.js";
 import type { DamagedFile, RecordSnapshot, ReportSubject } from "./snapshot.js";
 
@@ -17,6 +19,7 @@ function withoutRun(taskDef: TaskDef, queue: QueuePosition | null, standing: Sta
     task: taskIntent(taskDef),
     queue,
     standing,
+    state: null,
     startedAt: null,
     finishedAt: null,
     reason: null,
@@ -26,13 +29,41 @@ function withoutRun(taskDef: TaskDef, queue: QueuePosition | null, standing: Sta
     base: null,
     attempts: 0,
     budgets: [],
+    decisions: [],
     limit: null,
     plain: null,
   };
 }
 
+/**
+ * Every triage round of one record, oldest first, with what each produced. The
+ * round's ref is asked the same two questions the harness asks it (`BriefRef`,
+ * `PacketRef`), so a report and the next session cannot read it differently.
+ */
+function decisionsOf(record: RunRecord, refs: Record<string, unknown>): Decision[] {
+  return record.caseFile.history.flatMap((entry) => {
+    if (entry.t !== "triage") return [];
+    const ref = refs[entry.artifactRef];
+    const brief = BriefRef.safeParse(ref);
+    const packet = PacketRef.safeParse(ref);
+    // A round always writes its ref, with `artifact` only when it produced one: a ref with none is a round that wrote none.
+    const wroteNeither = typeof ref === "object" && ref !== null && !("artifact" in ref);
+    return [
+      {
+        afterAttempt: entry.afterAttempt,
+        trigger: entry.trigger,
+        verdict: entry.verdict,
+        rationale: entry.rationale,
+        recorded: brief.success || packet.success || wroteNeither,
+        brief: brief.success ? brief.data.artifact : null,
+        packet: packet.success ? packet.data.artifact : null,
+      },
+    ];
+  });
+}
+
 /** One task from its own record. The retries are the log's, by the fold resuming uses, so a report and a resume cannot disagree. */
-function withRun(record: RunRecord, queue: QueuePosition | null, standing: Standing): ReportSurface {
+function withRun(snapshot: RecordSnapshot, record: RunRecord, queue: QueuePosition | null, standing: Standing): ReportSurface {
   const { header, history, outcome, cursor } = record.caseFile;
   const budgets = deriveBudgetsFromLog(history, cursor.budgets);
   const lastSession = history.findLast((entry) => entry.t === "terminus");
@@ -46,6 +77,7 @@ function withRun(record: RunRecord, queue: QueuePosition | null, standing: Stand
     task: taskIntent(header.taskDef),
     queue,
     standing,
+    state: cursor.state,
     startedAt: startedInstant(record.runId),
     finishedAt: outcome?.at ?? null,
     reason: outcome?.reason ?? null,
@@ -56,6 +88,7 @@ function withRun(record: RunRecord, queue: QueuePosition | null, standing: Stand
     base: header.baseBranch ?? null,
     attempts,
     budgets: Population.options.map((population) => ({ population, used: budgets[population].used, max: budgets[population].max })),
+    decisions: decisionsOf(record, snapshot.refs[record.runId] ?? {}),
     limit,
     plain:
       standing === "escalated" || standing === "aborted"
@@ -115,7 +148,7 @@ function taskReport(snapshot: RecordSnapshot, runId: string): ReportDocument {
   const finished = record.caseFile.outcome !== undefined;
   // Only a run of several at once holds the lock, so only a task one of those took can be known to be going.
   const taken = runs.some((run) => run.outcome === undefined && claimedBy(run).some((claim) => claim.surfaceId === runId));
-  const surface = withRun(record, queuePositionOf(list, record.caseFile.header.taskDef) ?? null, record.caseFile.outcome?.kind ?? "unfinished");
+  const surface = withRun(snapshot, record, queuePositionOf(list, record.caseFile.header.taskDef) ?? null, record.caseFile.outcome?.kind ?? "unfinished");
   return document(snapshot, { live: finished ? false : taken ? live : null, run: null, surfaces: [surface], incomplete: [] });
 }
 
@@ -129,7 +162,7 @@ function runSurfaces(snapshot: RecordSnapshot, runFile: RunFile, live: boolean):
     // A damaged record's task reads as waiting to the view, which only knows it has no record: it is reported as damaged instead.
     .filter((task) => task.record !== undefined || !damaged.some((file) => isDeepStrictEqual(file.taskDef, task.taskDef)))
     .map((task) =>
-      task.record ? withRun(task.record, task.position ?? null, task.standing) : withoutRun(task.taskDef, task.position ?? null, task.standing),
+      task.record ? withRun(snapshot, task.record, task.position ?? null, task.standing) : withoutRun(task.taskDef, task.position ?? null, task.standing),
     );
   return { surfaces, incomplete: damaged.map((file) => asIncomplete(file, list)) };
 }
@@ -179,7 +212,7 @@ function listReport(snapshot: RecordSnapshot): ReportDocument {
     if (damaged && (record === undefined || (startedInstant(damaged.runId) ?? "") > (startedInstant(record.runId) ?? ""))) {
       return void incomplete.push({ run: damaged.runId, file: damaged.file, queue });
     }
-    surfaces.push(record ? withRun(record, queue, record.caseFile.outcome?.kind ?? "unfinished") : withoutRun(taskDef, queue, "not_started"));
+    surfaces.push(record ? withRun(snapshot, record, queue, record.caseFile.outcome?.kind ?? "unfinished") : withoutRun(taskDef, queue, "not_started"));
   });
   // A record too damaged to say which task it was for may be one of this list's: named, so the report is marked incomplete.
   for (const file of snapshot.damaged) {
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/report`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/report/document.ts src/report/derive.ts src/report/derive.test.ts src/report/report-fixtures.ts
git commit -m "Put each task's triage rounds and state on the report document" -m "Whoever is pulled in to a stopped task needs every decision that led there, and a run of several tasks needs to say what each one is doing now. Both come from the record the harness already keeps, through the one derivation the report uses, so status and report cannot disagree about them."
```

---

### Task 4: Render one task's detail as lines ✅ DONE (deliver-slice)

A pure function from one `ReportSurface` to the lines `status` adds beneath its own account. It reads nothing.

**Files:**
- Create: `src/report/detail.ts`
- Test: `src/report/detail.test.ts`

**Interfaces:**
- Consumes: `Decision`, `ReportSurface`, `BudgetRow`, `Standing` (Task 3 and before); `briefLines` (Task 1); `attemptsWord`, `quoted`, `stripControl`, `toAct` (Task 1 and before); `POPULATION_LABELS`, `SETBACK_LABELS` from `src/escalation-packet.ts` (exist: "correction", "gate recheck", "gate repair", "session retry", "close retry"; "a gate failure", "a gate error", "a worker escalation", "a close failure").
- Produces, all from `src/report/detail.ts`:
  - `UNCHANGED_NOT_RUN_AGAIN: string`, `RESUME_DOES_NOT_APPLY: string`
  - `budgetWords(rows: BudgetRow[]): string`
  - `roundLines(decisions: Decision[], { full }: { full: boolean }): string[]`
  - `detailLines(surface: ReportSurface, { full }: { full: boolean }): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/report/detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveReport } from "./derive.js";
import { detailLines, RESUME_DOES_NOT_APPLY, UNCHANGED_NOT_RUN_AGAIN } from "./detail.js";
import type { ReportSurface } from "./document.js";
import { attempt, BRIEF, FOOTER, footerFailed, footerWorking, formDone, homepageAsks, ID, PACKET, recordOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
import type { RecordSnapshot } from "./snapshot.js";
import { renderText } from "./text.js";

const FOOTER_REFS = {
  [ID.footer]: {
    "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
    // Round 2 wrote no brief, as the rule-based router never does; round 3's ref (`triage-2`) is lost.
    "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
    "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET },
  },
};

/** The one task a snapshot is about, as the report document holds it. */
function surfaceOf(record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): ReportSurface {
  const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: record.runId }, records: [record], ...over })).surfaces;
  if (surface === undefined) throw new Error(`no surface for ${record.runId}`);
  return surface;
}

const short = (record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): string[] => detailLines(surfaceOf(record, over), { full: false });

describe("the detail under a stopped task's status", () => {
  it("reads, in full, as how it got here, the retries it had used, and what to do", () => {
    expect(short(footerFailed, { refs: FOOTER_REFS })).toEqual([
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("gives the same advice the report gives for the same task", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed, homepageAsks] });
    const report = renderText(deriveReport(snapshot), { colour: false });

    for (const record of [footerFailed, homepageAsks]) {
      const advice = short(record).filter((line) => /^(To act:| {8}\d\.)/.test(line));
      expect(advice.length).toBeGreaterThan(0);
      for (const line of advice) expect(report).toContain(`    ${line}`);
    }
  });

  it("does not say the list retells a task the list does not ask for", () => {
    const lines = short(footerFailed, { list: [] });

    expect(lines).not.toContain(UNCHANGED_NOT_RUN_AGAIN);
    expect(lines.slice(-2)).toEqual(['To act: Reword the task and run it again: delivery run --task "<the reworded task>"', RESUME_DOES_NOT_APPLY]);
  });

  it("never advises picking up a run that has ended", () => {
    for (const record of [footerFailed, homepageAsks]) {
      expect(short(record).filter((line) => line.includes("delivery resume"))).toEqual([RESUME_DOES_NOT_APPLY]);
    }
  });

  it("uses the harness's own words for the technical parts", () => {
    const technical = short(footerFailed).slice(0, 8).join("\n");

    for (const word of ["triage", "gate", "correction", "verdict", "reroute", "escalate"]) expect(technical).toContain(word);
  });

  it("shows a trigger it has no words for as the record holds it, with anything that could drive the terminal taken out", () => {
    const odd = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [...attempt(1, "x"), { t: "triage", afterAttempt: 1, trigger: "moon_\u001B[31mphase", verdict: "abort", rationale: "no", artifactRef: "triage-0" }],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "triage_abort" }, "no", "aborted"),
    });

    expect(short(odd)[1]).toBe("  After attempt 1: moon_phase; verdict: abort");
  });
});

describe("every triage round in full", () => {
  const full = (record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): string[] => detailLines(surfaceOf(record, over), { full: true });

  it("prints each round's trigger, verdict and reasoning word for word, then the brief or packet it produced", () => {
    const lines = full(footerFailed, { refs: FOOTER_REFS });

    expect(lines.slice(0, lines.indexOf(""))).toEqual([
      "How it got here (4 triage rounds, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session:",
      "      Problem: Two footer links point at pages that were removed.",
      "      Dead ends: Attempt 1 rewrote the link text and left the targets alone.",
      "      Scope: Only src/footer.html.",
      "      References: worker-1-0",
      "      Diagnosis (a hypothesis to test, not an established fact): The targets moved under /about.",
      "  Round 2, after attempt 2",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: none; this round wrote no brief.",
      "  Round 3, after attempt 3",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: not recorded.",
      "  Round 4, after attempt 4",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: escalate",
      '    Rationale: "gate_fail: escalate"',
      "    Packet for a person:",
      '      Decision: "No correction budget remains (3/3 used). Decide whether to continue manually, amend the task, or abandon it."',
      '      Evidence: "footer-links: 2 of 6 links still fail"',
      '      Dead ends: "1. Rewrote the link text.\n      2. Pointed both links at the homepage."',
      '      Why now: "The correction budget is spent (3/3 used), so the harness cannot try again."',
      "      References: worker-4-0, triage-3",
    ]);
  });

  it("is followed by the retries and the advice, as the short account is", () => {
    const lines = full(footerFailed, { refs: FOOTER_REFS });

    expect(lines.slice(lines.indexOf(""))).toEqual([
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("says not recorded for a packet that cannot be read back, rather than leaving the round out", () => {
    expect(full(footerFailed).slice(-13, -8)).toEqual([
      "  Round 4, after attempt 4",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: escalate",
      '    Rationale: "gate_fail: escalate"',
      "    Packet for a person: not recorded.",
    ]);
  });

  it("says what a round that produced nothing did instead", () => {
    const record = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [
        ...attempt(1, "x"),
        { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "gate_error: recheck (gateError 0/3)", artifactRef: "triage-0" },
        { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "abort", rationale: "the task\u001B[2J cannot be done", artifactRef: "triage-1" },
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "triage_abort" }, "the task cannot be done", "aborted"),
    });

    const lines = full(record);

    expect(lines.slice(0, lines.indexOf(""))).toEqual([
      "How it got here (2 triage rounds, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate error (gate_error)",
      "    Verdict: recheck_gate",
      '    Rationale: "gate_error: recheck (gateError 0/3)"',
      "    Produced nothing: the gate was run again as it was.",
      "  Round 2, after attempt 1",
      "    Trigger: a worker escalation (worker_escalate)",
      "    Verdict: abort",
      '    Rationale: "the task cannot be done"',
      "    Produced nothing: the run was abandoned.",
    ]);
  });

  it("says in one line that there were no rounds", () => {
    expect(full(formDone)[0]).toBe("How it got here: no triage rounds.");
  });
});

describe("the detail under a task that has less to tell", () => {
  it("says in one line that there were no triage rounds, and in one line that there was no stop", () => {
    expect(short(formDone)).toEqual([
      "How it got here: no triage rounds.",
      "",
      "Retry budgets when it finished, after 1 attempt:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "No stop: this run finished.",
    ]);
  });

  it("says the same of a run that has not finished, with the retries so far", () => {
    expect(short(footerWorking).slice(2)).toEqual([
      "Retry budgets so far, after 1 attempt:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "No stop: this run has not finished.",
    ]);
  });

  it("says the advice is not recorded for a stop made before stops recorded why, and invents none", () => {
    const old = recordOf({ runId: ID.footer, task: FOOTER, history: footerFailed.caseFile.history, outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)") });

    const lines = short(old);

    expect(lines.slice(0, 5)).toEqual([
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
    ]);
    expect(lines.slice(-3)).toEqual(["To act: not recorded; the record does not say what kind of stop this was.", UNCHANGED_NOT_RUN_AGAIN, RESUME_DOES_NOT_APPLY]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/report/detail.test.ts`
Expected: FAIL: `./detail.js` cannot be resolved.

- [ ] **Step 3: Write the renderer**

Create `src/report/detail.ts`:

```ts
import { POPULATION_LABELS, SETBACK_LABELS } from "../escalation-packet.js";
import { briefLines } from "../prompt-assembly.js";
import type { BudgetRow, Decision, ReportSurface, Standing } from "./document.js";
import { attemptsWord } from "./plain.js";
import { quoted, stripControl, toAct } from "./text.js";

/** Said under a stopped task that is on the project's list: running the list again does not run it again. */
export const UNCHANGED_NOT_RUN_AGAIN = "An unchanged task on your list is not run again: `delivery run` would retell this outcome.";

/** Said under every stopped task: a run that has ended is not one `delivery resume` picks up. */
export const RESUME_DOES_NOT_APPLY = "`delivery resume` does not apply: this run is finished.";

const TRIGGER_WORDS: Record<string, string> = SETBACK_LABELS;

/** Retries used of retries allowed, kind by kind, in the harness's own names for the kinds. */
export function budgetWords(rows: BudgetRow[]): string {
  return rows.map((row) => `${POPULATION_LABELS[row.population]} ${row.used} of ${row.max}`).join(", ");
}

/** The triage rounds of one task: one line each (after which attempt, what set it off, what was decided), or every round in full. */
export function roundLines(decisions: Decision[], { full }: { full: boolean }): string[] {
  if (decisions.length === 0) return ["How it got here: no triage rounds."];
  if (full) return fullRoundLines(decisions);
  return [
    "How it got here (triage rounds; --decisions for the full text):",
    // A trigger this build has no words for is shown as the record holds it.
    ...decisions.map((round) => `  After attempt ${round.afterAttempt}: ${TRIGGER_WORDS[round.trigger] ?? stripControl(round.trigger)}; verdict: ${round.verdict}`),
  ];
}

/** What a round produced for whoever came next. Total over the verdicts, so a new one does not compile until it has words. */
function producedLines(round: Decision): string[] {
  switch (round.verdict) {
    case "reroute":
    case "fix_the_gate":
    case "retry_close":
      // A round that wrote no brief is not one whose brief was lost: only the second is "not recorded".
      if (round.brief === null) return [`    Brief for the next session: ${round.recorded ? "none; this round wrote no brief." : "not recorded."}`];
      return ["    Brief for the next session:", ...briefLines(round.brief).map((line) => `      ${stripControl(line).split("\n").join("\n      ")}`)];
    case "escalate":
      return round.packet === null
        ? ["    Packet for a person: not recorded."]
        : [
            "    Packet for a person:",
            `      Decision: ${quoted(round.packet.decision, "      ")}`,
            `      Evidence: ${quoted(round.packet.evidence, "      ")}`,
            `      Dead ends: ${quoted(round.packet.dead_ends, "      ")}`,
            `      Why now: ${quoted(round.packet.why_now, "      ")}`,
            `      References: ${round.packet.references.length === 0 ? "none" : round.packet.references.map(stripControl).join(", ")}`,
          ];
    case "recheck_gate":
      return ["    Produced nothing: the gate was run again as it was."];
    case "abort":
      return ["    Produced nothing: the run was abandoned."];
  }
}

/** Every triage round in full: trigger, verdict, reasoning word for word, and the brief or packet it produced. */
function fullRoundLines(decisions: Decision[]): string[] {
  return [
    `How it got here (${decisions.length} triage ${decisions.length === 1 ? "round" : "rounds"}, in full):`,
    ...decisions.flatMap((round, index) => {
      const known = TRIGGER_WORDS[round.trigger];
      return [
        `  Round ${index + 1}, after attempt ${round.afterAttempt}`,
        `    Trigger: ${known === undefined ? stripControl(round.trigger) : `${known} (${round.trigger})`}`,
        `    Verdict: ${round.verdict}`,
        `    Rationale: ${quoted(round.rationale, "    ")}`,
        ...producedLines(round),
      ];
    }),
  ];
}

/** When the retry figures are as of. Total over the standings. */
const AS_OF: Record<Standing, string> = {
  closed: "when it finished",
  escalated: "at stop",
  aborted: "at stop",
  paused: "so far",
  unfinished: "so far",
  queued: "so far",
  not_started: "so far",
};

function budgetLines(surface: ReportSurface): string[] {
  return [`Retry budgets ${AS_OF[surface.standing]}, after ${attemptsWord(surface.attempts)}:`, `  ${budgetWords(surface.budgets)}`];
}

/** What to do about a stop, exactly as the report advises it; a task that did not stop says so in one line. */
function actLines(surface: ReportSurface): string[] {
  const { plain } = surface;
  if (plain === null) return [surface.standing === "closed" ? "No stop: this run finished." : "No stop: this run has not finished."];
  return [
    ...(plain.next.length === 0 ? ["To act: not recorded; the record does not say what kind of stop this was."] : toAct(plain.next, "")),
    ...(surface.queue === null ? [] : [UNCHANGED_NOT_RUN_AGAIN]),
    RESUME_DOES_NOT_APPLY,
  ];
}

/**
 * What `delivery status` says of one task beneath its own account: the triage
 * rounds (one line each, or in full), the retry budgets, and what to do.
 * Another rendering of the report document, so it is pure and reads nothing.
 * The technical parts use the harness's own words, because whoever reads them
 * is looking for those words; the advice is the report's, unchanged.
 */
export function detailLines(surface: ReportSurface, { full }: { full: boolean }): string[] {
  return [...roundLines(surface.decisions, { full }), "", ...budgetLines(surface), "", ...actLines(surface)];
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/report/detail.test.ts`
Expected: PASS, 14 tests.

Run: `npx tsc --noEmit && npx eslint src/report`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/report/detail.ts src/report/detail.test.ts
git commit -m "Render a task's triage rounds, retry budgets and advice as lines" -m "The status detail is a second rendering of the report document, so it is a pure function of one task's entry: the rounds in one line each or in full, the retries used of those allowed, and the report's own advice with the two things that are easy to get wrong said plainly. The technical parts keep the harness's words because whoever reads them searches the record for those words."
```

---

### Task 5: Show the detail under one task's status, and `--decisions` ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts`
- Modify: `src/cli/program.ts`
- Modify: `README.md`, `docs/getting-started.md`
- Create: `.changeset/see-why-a-task-stopped.md`
- Test: `src/cli/status-command.test.ts`; `tests/getting-started-guide.test.ts` (existing, unchanged: it holds the guide's sample to the real output)

**Interfaces:**
- Consumes: `deriveReport(snapshot): ReportDocument`; `loadSnapshot(repoPath, subject, { live, list })`; `ReportSubject`; `detailLines` (Task 4); in `src/cli/status-command.ts` already: `listTasks`, `repoLocked`, `statusReport`, `statusDocument`, `positionOf`, `lookUp`, `mostRecent`, `viewOf`, `listRuns`, `supervisedReport`, `supervisedDocument`.
- Produces, in `src/cli/status-command.ts`:
  - `StatusOptions.decisions?: boolean`
  - `ALL_AND_DECISIONS: string`, `NO_DECISIONS_DATA_YET: string` (exported)
  - `documentOf(repoPath: string, startDir: string, subject: ReportSubject, ctx: CommandContext): Promise<ReportDocument>` (module-private)
  - `nextLine(runId: string, report: string, rounds: number, full: boolean): string` (module-private)
  - a `full` constant inside `statusCommand` (`options.decisions === true`), which Task 6 passes to `supervisedReport`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/status-command.test.ts`, replace this import line

```ts
import { ALL_AND_ONE, statusDocument, statusReport, type RunStatusDocument } from "./status-command.js";
```

with

```ts
import { ALL_AND_DECISIONS, ALL_AND_ONE, NO_DECISIONS_DATA_YET, statusDocument, statusReport, type RunStatusDocument } from "./status-command.js";
import { RESUME_DOES_NOT_APPLY, UNCHANGED_NOT_RUN_AGAIN } from "../report/detail.js";
import { attempt, BRIEF, failedCheck, PACKET, stoppedAt, writeRecord } from "../report/report-fixtures.js";
```

Add this `describe` block directly before `describe("delivery status --json", () => {`:

```ts
describe("delivery status, beneath its own account of one task", () => {
  const FORM = "Add a contact form";
  const FOOTER = "Fix the broken footer links";
  const FOOTER_RUN = "fix-the-broken-footer-links-20261001T022000Z";

  /** A project whose second task failed its check after every attempt: four attempts, four triage rounds, the corrections spent. */
  async function footerStopped(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [FORM, FOOTER] }) });
    await writeRecord(repo, {
      runId: FOOTER_RUN,
      task: FOOTER,
      history: [
        ...attempt(1, "first go"),
        ...failedCheck(1, "reroute"),
        ...attempt(2, "second go"),
        ...failedCheck(2, "reroute"),
        ...attempt(3, "third go"),
        ...failedCheck(3, "reroute"),
        ...attempt(4, "I fixed 4 of the 6 links."),
        ...failedCheck(4, "escalate"),
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (3/3)"),
      refs: {
        "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
        "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
        "triage-2": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
        "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET },
      },
    });
    return repo;
  }

  it("keeps every line it printed before, then says how the task got here, the retries at stop and what to do", async () => {
    const repo = await footerStopped("status-detail-");

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const before = await statusReport(await readRun(repo, FOOTER_RUN), await context(), { task: 2, of: 2 });
    expect(lines.slice(0, before.length)).toEqual(before);
    expect(lines.slice(before.length)).toEqual([
      "",
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
      "",
      `Next: delivery status ${FOOTER_RUN} --decisions (every triage round in full), delivery report (your task list)`,
    ]);
  });

  it("gives the advice `delivery report` gives for the same task", async () => {
    const repo = await footerStopped("status-detail-advice-");

    const status = await delivery(["status", FOOTER_RUN], { cwd: repo });
    const report = await delivery(["report", FOOTER_RUN], { cwd: repo });

    const advice = status.stdout.split("\n").filter((line) => /^(To act:| {8}\d\.)/.test(line));
    expect(advice).toHaveLength(2);
    for (const line of advice) expect(report.stdout.split("\n")).toContain(`    ${line}`);
  });

  it("prints every triage round in full with --decisions, in place of the one line each", async () => {
    const repo = await footerStopped("status-decisions-");

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const at = lines.indexOf("How it got here (4 triage rounds, in full):");
    expect(lines.slice(at + 1, at + 11)).toEqual([
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session:",
      `      Problem: ${BRIEF.problem}`,
      `      Dead ends: ${BRIEF.dead_ends}`,
      `      Scope: ${BRIEF.scope}`,
      "      References: worker-1-0",
      `      Diagnosis (a hypothesis to test, not an established fact): ${BRIEF.diagnosis}`,
    ]);
    expect(stdout).toContain(`      Decision: "${PACKET.decision}"`);
    expect(stdout).not.toContain("--decisions for the full text");
    expect(lines.at(-1)).toBe("Next: delivery report (your task list)");
    // The account above the rounds, and the retries and advice below them, are there as they are without the flag.
    const before = await statusReport(await readRun(repo, FOOTER_RUN), await context(), { task: 2, of: 2 });
    expect(lines.slice(0, before.length)).toEqual(before);
    expect(lines.slice(-9, -2)).toEqual([
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("says in one line each that a finished task had no triage rounds and did not stop", async () => {
    const repo = initTempRepo("status-detail-closed-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stdout } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(stdout.trimEnd().split("\n").slice(4)).toEqual([
      "",
      "How it got here: no triage rounds.",
      "",
      "Retry budgets when it finished, after 0 attempts:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "No stop: this run finished.",
      "",
      "Next: delivery report (your task list)",
    ]);
  });

  it("says of a run that has not finished that it has not stopped, after saying how to carry it on", async () => {
    const repo = initTempRepo("status-detail-unfinished-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const lines = (await delivery(["status", RUN_ID], { cwd: repo })).stdout.trimEnd().split("\n");

    expect(lines[2]).toBe(`To finish it: delivery resume ${RUN_ID}`);
    expect(lines).toContain("Retry budgets so far, after 0 attempts:");
    expect(lines).toContain("No stop: this run has not finished.");
    expect(lines.at(-1)).toBe("Next: delivery report (your task list)");
  });

  it("shows what an older record holds, and says not recorded for the advice it cannot back", async () => {
    const repo = initTempRepo("status-detail-old-", { "package.json": PACKAGE });
    await writeRecord(repo, {
      runId: FOOTER_RUN,
      task: FOOTER,
      history: [...attempt(1, "first go"), ...failedCheck(1, "escalate")],
      outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)"),
    });

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("This needs your decision: correction budget exhausted (3/3)");
    expect(stdout).toContain("    Packet for a person: not recorded.");
    expect(stdout).toContain("To act: not recorded; the record does not say what kind of stop this was.");
    expect(stdout).not.toContain(UNCHANGED_NOT_RUN_AGAIN);
    expect(stdout).toContain(RESUME_DOES_NOT_APPLY);
  });

  it("stops when --decisions is given with --all, or with --json, rather than quietly ignoring it", async () => {
    const repo = await footerStopped("status-decisions-conflict-");

    const withAll = await delivery(["status", "--all", "--decisions"], { cwd: repo });
    const withJson = await delivery(["status", FOOTER_RUN, "--decisions", "--json"], { cwd: repo });

    expect(withAll.exitCode).toBe(EXIT.configuration);
    expect(withAll.stderr).toContain(ALL_AND_DECISIONS);
    expect(withJson.exitCode).toBe(EXIT.configuration);
    expect(withJson.stdout).toBe("");
    expect(withJson.stderr).toContain(NO_DECISIONS_DATA_YET);
  });

  it("describes --decisions in the command's own help", async () => {
    const repo = initTempRepo("status-decisions-help-", { "package.json": PACKAGE });

    expect((await delivery(["status", "--help"], { cwd: repo })).stdout).toContain("--decisions");
  });
});
```

In the test "reads one task of the run by its own id exactly as it reads any run", the account is now followed by the detail, so the assertion compares the lines the account has. Replace

```ts
    expect(stdout.trimEnd().split("\n")).toEqual(own);
```

with

```ts
    expect(stdout.split("\n").slice(0, own.length)).toEqual(own);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: FAIL. The eight tests of "delivery status, beneath its own account of one task" fail (nothing follows the account; `--decisions` is an unknown option). Every other test passes.

- [ ] **Step 3: Add the option to the command line**

Apply to `src/cli/program.ts`:

```diff
--- a/src/cli/program.ts
+++ b/src/cli/program.ts
@@ -112,6 +112,7 @@ export async function runCli(io: CliIo): Promise<number> {
     .argument("[run-id]", "the run to read (default: the one touched most recently)")
     .option("--last", "read the run touched most recently, which is also what no run id means")
     .option("--all", "list every run in this repository, newest first, instead of reading one")
+    .option("--decisions", "print every triage round in full: what set it off, the verdict, the reasoning word for word, and the brief or packet it produced")
     .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
     .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
       exitCode = await statusCommand(runId, options, contextFor(io, command));
```

- [ ] **Step 4: Print the detail**

In `src/cli/status-command.ts`:

Add these imports directly after `import { RunFileNotFound } from "../errors.js";`:

```ts
import { deriveReport } from "../report/derive.js";
import { detailLines } from "../report/detail.js";
import type { ReportDocument } from "../report/document.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
```

Add these two constants directly after the `ALL_AND_ONE` constant:

```ts
export const ALL_AND_DECISIONS =
  "Use either `--all` or `--decisions`, not both: `--all` lists every run, and `--decisions` prints one run's triage rounds in full.";

export const NO_DECISIONS_DATA_YET = "`--decisions` prints the triage rounds as text only for now. Run it without `--json`.";
```

Replace `interface StatusOptions` with:

```ts
export interface StatusOptions {
  repo?: string;
  /** List every run this repository holds instead of reading one. */
  all?: boolean;
  /** Print every triage round in full, where the usual account gives each one line. */
  decisions?: boolean;
}
```

Add these two functions directly before the doc comment of `statusCommand` (the comment that begins "`delivery status`: read one run's record"):

```ts
/**
 * The report document for what `status` was asked about: the read model
 * `delivery report` renders, read by the reader it uses. The detail `status`
 * adds beneath its own account is a rendering of this, never a second working
 * out of budgets or rounds.
 */
async function documentOf(repoPath: string, startDir: string, subject: ReportSubject, ctx: CommandContext): Promise<ReportDocument> {
  // ponytail: this reads every record once more than the account above it needed. Serve the account from the
  // same snapshot if a repository with thousands of runs makes `status` slow.
  const [list, live] = await Promise.all([listTasks(startDir, repoPath, ctx), repoLocked(repoPath)]);
  return deriveReport(await loadSnapshot(repoPath, subject, { live, list }));
}

/** Where to go from here: the triage rounds in full, when there are any and they were not just printed, and the report. */
function nextLine(runId: string, report: string, rounds: number, full: boolean): string {
  const more = rounds > 0 && !full ? [`delivery status ${runId} --decisions (every triage round in full)`] : [];
  return `Next: ${[...more, report].join(", ")}`;
}
```

Replace the whole `statusCommand` function (keep its doc comment) with:

```ts
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  // Before the repository is even looked for: a usage mistake is the same
  // mistake wherever it was typed, and hearing about the folder first would
  // send the reader after the wrong problem.
  if (options.all && runId !== undefined) throw new Refusal(ALL_AND_ONE, EXIT.configuration);
  if (options.all && options.decisions) throw new Refusal(ALL_AND_DECISIONS, EXIT.configuration);
  if (options.decisions && ctx.json) throw new Refusal(NO_DECISIONS_DATA_YET, EXIT.configuration);
  const full = options.decisions === true;
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  if (options.all) return listRuns(repoPath, startDir, ctx);
  const record = runId === undefined ? await mostRecent(repoPath) : await lookUp(repoPath, runId);
  if ("runFile" in record) {
    const view = await viewOf(record, repoPath, startDir, ctx);
    if (ctx.json) ctx.writeLine(JSON.stringify(await supervisedDocument(view, ctx), null, 2));
    else for (const line of await supervisedReport(view, ctx)) ctx.writeLine(line);
    return EXIT.ok;
  }
  if (ctx.json) {
    // Indented rather than one line: a person reads this output too, and a parser does not mind.
    ctx.writeLine(JSON.stringify(await statusDocument(record, ctx, await positionOf(record, startDir, ctx)), null, 2));
    return EXIT.ok;
  }
  // The account first, every line as it has always been; then the detail, from the document the report is made from.
  const [surface] = (await documentOf(repoPath, startDir, { kind: "task", runId: record.runId }, ctx)).surfaces;
  const lines = [
    ...(await statusReport(record, ctx, surface?.queue ?? undefined)),
    ...(surface ? ["", ...detailLines(surface, { full })] : []),
    "",
    nextLine(record.runId, "delivery report (your task list)", surface?.decisions.length ?? 0, full),
  ];
  for (const line of lines) ctx.writeLine(line);
  return EXIT.ok;
}
```

`positionOf` is still used, by the `--json` branch. `statusReport` is given the place the document worked out (`surface.queue`), which is the same `queuePositionOf` over the same list.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/cli`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts src/cli/program.ts
git commit -m "Show how a task got here, its retry budgets and what to do under its status" -m "Whoever opens a stopped task was not watching it. Beneath the account status already gave, it now lists each triage round, the retries used at that moment and the report's own advice, with --decisions for every round in full, so nobody has to rebuild that from raw records. Every line printed before is still printed and the exit codes are the same."
```

- [ ] **Step 7: Update the getting-started guide's sample**

In `docs/getting-started.md`, section "4. Read what happened, later", replace the output block and the paragraph after it

````markdown
```text
Run <run-id>, started <when>: add a function that greets a name, with a test
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
It finished <when>.
main was not changed. To look at the work: git log surface/<run-id>
```

`delivery status` only ever reads, so it is safe while a run is still going. If a
run stopped because it needs a decision from you, that decision is the first thing
it prints, with the evidence behind it underneath.
````

with

````markdown
```text
Run <run-id>, started <when>: add a function that greets a name, with a test
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
It finished <when>.
main was not changed. To look at the work: git log surface/<run-id>

How it got here: no triage rounds.

Retry budgets when it finished, after 1 attempt:
  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3

No stop: this run finished.

Next: delivery report (your task list)
```

`delivery status` only ever reads, so it is safe while a run is still going. If a
run stopped because it needs a decision from you, that decision is the first thing
it prints, with the evidence behind it underneath.

Beneath that account it says how the task got there: the times the harness had to decide what to
do after a setback ("triage rounds"; none here, because the first attempt passed), how many
retries of each kind were used, and, for a task that stopped, what to do about it. The last line
names where to go next.
````

- [ ] **Step 8: Check the guide against the real output**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS, 6 tests. The test runs the guide's task through the scripted agent and requires every line of the sample to be a line of the real `delivery status` output.

- [ ] **Step 9: Update the README**

In `README.md`, section "See what happened to a run", directly after the paragraph that ends "worked out from the list as it is written now.", add:

````markdown
Beneath that account, `status` says how the task got there, for whoever has to find out why. These
parts use the harness's own words (triage, gate, correction) on purpose: they are the words to
search the run's record for.

- **How it got here:** one line for each triage round, which is each time the harness had to
  decide what to do after a setback: the attempt it followed, what set it off, and the verdict.
- **Retry budgets:** how many retries of each of the five kinds were used of how many are
  allowed, and how many attempts the agent made.
- **To act:** for a task that stopped, the same steps `delivery report` gives for it, then two
  things that are easy to get wrong: an unchanged task on your list is not run again, and
  `delivery resume` does not apply to a run that has finished.

```text
How it got here (triage rounds; --decisions for the full text):
  After attempt 1: a gate failure; verdict: reroute
  After attempt 2: a gate failure; verdict: reroute
  After attempt 3: a gate failure; verdict: reroute
  After attempt 4: a gate failure; verdict: escalate

Retry budgets at stop, after 4 attempts:
  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3

To act: 1. Reword the task, or remove it from your list.
        2. Run: delivery run
An unchanged task on your list is not run again: `delivery run` would retell this outcome.
`delivery resume` does not apply: this run is finished.

Next: delivery status fix-the-broken-footer-links-20261001T022000Z --decisions (every triage round in full), delivery report (your task list)
```

A task with no triage rounds, or one that did not stop, says so in one line. A run made by an
earlier version shows what its record holds and "not recorded" for the rest. The last line,
`Next:`, names the commands that go further.

To read every triage round in full, add `--decisions`:

```bash
delivery status fix-the-broken-footer-links-20261001T022000Z --decisions
```

```text
How it got here (4 triage rounds, in full):
  Round 1, after attempt 1
    Trigger: a gate failure (gate_fail)
    Verdict: reroute
    Rationale: "gate_fail: reroute"
    Brief for the next session:
      Problem: Two footer links point at pages that were removed.
      Dead ends: Attempt 1 rewrote the link text and left the targets alone.
      Scope: Only src/footer.html.
      References: worker-1-0
      Diagnosis (a hypothesis to test, not an established fact): The targets moved under /about.
  …
  Round 4, after attempt 4
    Trigger: a gate failure (gate_fail)
    Verdict: escalate
    Rationale: "gate_fail: escalate"
    Packet for a person:
      Decision: "No correction budget remains (3/3 used). Decide whether to continue manually, amend the task, or abandon it."
      …
```

Each round gives what set it off, the verdict, the reasoning word for word, and what the round
produced: the brief the next session was given, exactly as that session read it, or the packet
written for a person. A round that wrote no brief says so ("none; this round wrote no brief"); one
whose brief or packet can no longer be read says "not recorded". `--decisions` cannot be
combined with `--all` or, for now, with `--json`: either stops with exit 2.
````

In the same section, the sentence that introduces `--json` no longer holds as written. Replace

```markdown
Add `--json` to get the same information as one JSON document instead of sentences:
```

with

```markdown
Add `--json` to get the account as one JSON document instead of sentences (the triage rounds and
retry budgets are text only for now):
```

- [ ] **Step 10: Add the changeset**

Create `.changeset/see-why-a-task-stopped.md`:

```markdown
---
"delivery-service": minor
---

`delivery status` now says why a task stopped, beneath the account it already gave. For one task
it lists each triage round in one line (the attempt it followed, what set it off, the verdict),
the retries used of those allowed for each of the five kinds with the number of attempts, and,
for a task that stopped, the same "To act" steps `delivery report` gives, followed by two plain
statements: an unchanged task on your list is not run again, and `delivery resume` does not apply
to a finished run. A task with no triage rounds, or no stop, says so in one line; a run made by an
earlier version shows what its record holds and "not recorded" for the rest. Its last line,
`Next:`, names the commands that go further.

`delivery status --decisions` prints every triage round in full: what set it off, the verdict,
the reasoning word for word, and the brief or packet the round produced. It cannot be combined
with `--all` or, for now, with `--json`.

Every line `status` printed before is still printed, and its exit codes and `--json` output are
unchanged.
```

- [ ] **Step 11: Commit**

```bash
git add README.md docs/getting-started.md .changeset/see-why-a-task-stopped.md
git commit -m "Document the detail under delivery status and --decisions" -m "The README and the getting-started guide described and showed status output that has grown. The guide's sample is held to the real output by its test, so it gains the new lines; the README says what each new part is for and how to read every round in full."
```

---

### Task 6: A run of several tasks: what each is doing now, and the retries rolled up ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/report/detail.ts` (new export `rollUpLines`)
- Modify: `src/cli/status-command.ts`
- Modify: `README.md`, `.changeset/see-why-a-task-stopped.md`
- Modify: `tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts` (one pinned assertion)
- Test: `src/report/detail.test.ts`, `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `budgetTotals` (Task 1); `budgetWords`, `roundLines` (Task 4); `documentOf`, `nextLine`, `full` (Task 5); `ReportDocument.run.runBudgets.gateMaintenance` (`{ used, max }`, Slice 1); `STEP_PHRASES` from `src/cli/output.ts` (exists: a phrase for every `SurfaceState`).
- Produces:
  - `rollUpLines(doc: ReportDocument): string[]` from `src/report/detail.ts`.
  - `supervisedReport(view: SupervisedView, ctx: CommandContext, doc: ReportDocument, { full }: { full: boolean }): Promise<string[]>` (two new parameters).
  - module-private in `src/cli/status-command.ts`: `taskName(task: ViewTask): string`, `inFlight(surface: ReportSurface | undefined): string | undefined`, `taskLine(task: ViewTask, live: boolean, surface: ReportSurface | undefined): string`.

- [ ] **Step 1: Write the failing test for the roll-up**

In `src/report/detail.test.ts`, replace these two import lines

```ts
import { detailLines, RESUME_DOES_NOT_APPLY, UNCHANGED_NOT_RUN_AGAIN } from "./detail.js";
import { attempt, BRIEF, FOOTER, footerFailed, footerWorking, formDone, homepageAsks, ID, PACKET, recordOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
```

with

```ts
import { detailLines, RESUME_DOES_NOT_APPLY, rollUpLines, UNCHANGED_NOT_RUN_AGAIN } from "./detail.js";
import { attempt, BRIEF, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, homepageAsks, ID, PACKET, recordOf, runFileOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
```

Add this `describe` block at the end of the file:

```ts
describe("the retries of a run of several tasks, added up", () => {
  const roll = (over: Partial<RecordSnapshot>): string[] => rollUpLines(deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, ...over })));

  it("adds each kind up across the tasks the run has taken, and says the run's shared repair limit beside them", () => {
    const run = runFileOf(ID.run, [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: ID.footer },
      fill(1, ID.homepage, HOMEPAGE),
    ]);

    expect(roll({ records: [formDone, footerFailed], runs: [run] })).toEqual([
      "Retry budgets across the 2 tasks this run has taken:",
      "  correction 3 of 6, gate recheck 0 of 6, gate repair 0 of 4, session retry 0 of 10, close retry 0 of 6",
      "  shared repair limit for the run: 1 of 2 used",
    ]);
  });

  it("says so, with the shared limit, when no task of the run has started", () => {
    expect(roll({ runs: [runFileOf(ID.run, [])] })).toEqual(["Retry budgets: no task of this run has started.", "  shared repair limit for the run: 0 of 2 used"]);
  });
});
```

(`runFileOf` gives a run a shared repair limit of 2; one `repair_dispatch` entry is one repair used.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/report/detail.test.ts`
Expected: FAIL: the two new tests fail, `rollUpLines` is not a function.

- [ ] **Step 3: Write the roll-up**

In `src/report/detail.ts`, change two imports:

```ts
import type { BudgetRow, Decision, ReportDocument, ReportSurface, Standing } from "./document.js";
```

```ts
import { budgetTotals, quoted, stripControl, toAct } from "./text.js";
```

Add this function at the end of the file:

```ts
/**
 * The retries of a run of several tasks added up across the tasks it has
 * taken, with the run's own limit on repairs of what its tasks share: the one
 * figure no single task holds.
 */
export function rollUpLines(doc: ReportDocument): string[] {
  const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
  const shared = doc.run === null ? [] : [`  shared repair limit for the run: ${doc.run.runBudgets.gateMaintenance.used} of ${doc.run.runBudgets.gateMaintenance.max} used`];
  if (ran.length === 0) return ["Retry budgets: no task of this run has started.", ...shared];
  return [`Retry budgets across the ${ran.length === 1 ? "1 task" : `${ran.length} tasks`} this run has taken:`, `  ${budgetWords(budgetTotals(ran))}`, ...shared];
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/report/detail.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/report/detail.ts src/report/detail.test.ts
git commit -m "Add up a run's retries beside its shared repair limit" -m "Whoever tunes the limits needs to see where a run of several tasks spent its retries, and the limit on repairs of what the tasks share is the one figure no single task holds. Both come from the report document, added up by the function the report already uses."
```

- [ ] **Step 6: Write the failing tests for the command**

In `src/cli/status-command.test.ts`, inside `describe("delivery status for a run of several tasks at once", ...)`:

In the test "says the run, the environment and the counts, then one line per task", replace

```ts
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`To read one task in full: delivery status ${IDS.greeting}`);
```

with

```ts
    expect(stdout.trimEnd().split("\n").slice(-7)).toEqual([
      "Retry budgets across the 4 tasks this run has taken:",
      "  correction 0 of 12, gate recheck 0 of 12, gate repair 0 of 8, session retry 0 of 20, close retry 0 of 12",
      "  shared repair limit for the run: 0 of 2 used",
      "",
      `To read one task in full: delivery status ${IDS.greeting}`,
      "",
      `Next: delivery report ${SUPERVISED} (this run in plain words)`,
    ]);
```

In the test "shows a task waiting only because every slot is busy as queued, waiting for a free slot" (the run is going there, and its two tasks' records are in the state a record is created in), replace

```ts
      `  [1/3] ${HELLO} (${IDS.hello}): not finished yet`,
      `  [2/3] ${GREETING} (${IDS.greeting}): not finished yet`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
```

with

```ts
      `  [1/3] ${HELLO} (${IDS.hello}): setting up`,
      `  [2/3] ${GREETING} (${IDS.greeting}): setting up`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
```

Add this helper and these four tests directly before the test "says how to carry on a run that stopped part way, without claiming its queued tasks wait for a slot":

```ts
  /** A run of two at once whose first task is on its second attempt and whose second is having its first checked. */
  async function workingSupervisedRun(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE] }),
    });
    await writeRecord(repo, {
      runId: IDS.hello,
      task: HELLO,
      history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" }],
      state: "AGENT_ACTIVE",
      // What the rule-based router writes for a round: its trigger and reasoning, and no brief.
      refs: { "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute" } },
    });
    await writeRecord(repo, { runId: IDS.greeting, task: GREETING, history: attempt(1, "done"), state: "GATING" });
    await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
      fill(1, IDS.hello, HELLO),
      fill(2, IDS.greeting, GREETING),
    ]);
    return repo;
  }

  it("says what each task under way is doing right now, and which attempt it is on, while the run is going", async () => {
    const repo = await workingSupervisedRun("status-supervised-in-flight-");
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): the agent is working, attempt 2`,
      `  [2/3] ${GREETING} (${IDS.greeting}): checking the agent's work, attempt 1`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
    ]);
  });

  it("does not say a task is doing anything once the run has stopped part way", async () => {
    const repo = await workingSupervisedRun("status-supervised-not-in-flight-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): not finished yet`,
      `  [2/3] ${GREETING} (${IDS.greeting}): not finished yet`,
      `  [3/3] ${GOODBYE}: queued`,
    ]);
  });

  it("adds the retries up across the tasks the run has taken, beside the run's shared repair limit, and points at the rounds", async () => {
    const repo = await workingSupervisedRun("status-supervised-roll-up-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(stdout.trimEnd().split("\n").slice(-7)).toEqual([
      "Retry budgets across the 2 tasks this run has taken:",
      "  correction 1 of 6, gate recheck 0 of 6, gate repair 0 of 4, session retry 0 of 10, close retry 0 of 6",
      "  shared repair limit for the run: 0 of 2 used",
      "",
      `To read one task in full: delivery status ${IDS.hello}`,
      "",
      `Next: delivery status ${SUPERVISED} --decisions (every triage round in full), delivery report ${SUPERVISED} (this run in plain words)`,
    ]);
  });

  it("prints every task's triage rounds in full with --decisions", async () => {
    const repo = await workingSupervisedRun("status-supervised-decisions-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const at = lines.indexOf(`[1/3] ${HELLO} (${IDS.hello}):`);
    expect(lines.slice(at, at + 10)).toEqual([
      `[1/3] ${HELLO} (${IDS.hello}):`,
      "How it got here (1 triage round, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: none; this round wrote no brief.",
      "",
      `[2/3] ${GREETING} (${IDS.greeting}):`,
      "How it got here: no triage rounds.",
    ]);
    expect(lines.at(-1)).toBe(`Next: delivery report ${SUPERVISED} (this run in plain words)`);
  });
```

- [ ] **Step 7: Run them to see them fail**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: FAIL. Five tests fail: the two edited ones, and three of the four new ones ("does not say a task is doing anything once the run has stopped part way" already passes: it pins behaviour that must not change).

- [ ] **Step 8: Print it**

In `src/cli/status-command.ts`:

Replace these two import lines

```ts
import { detailLines } from "../report/detail.js";
import type { ReportDocument } from "../report/document.js";
```

with

```ts
import { detailLines, rollUpLines, roundLines } from "../report/detail.js";
import type { ReportDocument, ReportSurface } from "../report/document.js";
```

and add `STEP_PHRASES` to the import from `./output.js`:

```ts
import { BREAKER_PHRASES, nextStepPhrase, STEP_PHRASES } from "./output.js";
```

Replace the whole `taskLine` function, with its doc comment, by these three functions:

```ts
/** A task's place in the list, what it was asked to do, and its own run id once it has one. */
function taskName(task: ViewTask): string {
  const tag = task.position ? `[${task.position.task}/${task.position.of}] ` : "";
  return `${tag}${taskIntent(task.taskDef)}${task.record ? ` (${task.record.runId})` : ""}`;
}

/** What a task that is going is doing right now, in the words the run itself prints as it goes, and which attempt it is on. */
function inFlight(surface: ReportSurface | undefined): string | undefined {
  if (surface?.state == null) return undefined;
  return `${STEP_PHRASES[surface.state]}${surface.attempts > 0 ? `, attempt ${surface.attempts}` : ""}`;
}

/**
 * One task's line: its place in the list, what it was asked to do, its own run
 * id once it has one (so any task can be read in full with `delivery status <id>`),
 * and where it stands. While the run is going, a task under way says what it
 * is doing; once the run has stopped, nothing is doing anything, so it says
 * only that it has not finished.
 */
function taskLine(task: ViewTask, live: boolean, surface: ReportSurface | undefined): string {
  const standing =
    task.standing === "escalated"
      ? `${STANDING_WORDS.escalated} (see below)`
      : task.standing === "queued" && live
        ? WAITING_FOR_A_SLOT
        : ((task.standing === "unfinished" && live ? inFlight(surface) : undefined) ?? STANDING_WORDS[task.standing]);
  return `  ${taskName(task)}: ${standing}`;
}
```

Replace the whole `supervisedReport` function, with its doc comment, by:

```ts
/**
 * A run of several tasks at once, as a person reads it: which run and its
 * shape, the shared environment, the counts, then one line per task in list
 * order. A task that needs a decision is followed by exactly what `status`
 * says of it on its own, so the decision reads the same wherever it is met.
 * A run that stopped part way says how to carry it on. Then, from the report
 * document: the retries added up across the run with its shared repair limit,
 * and, when asked for, every task's triage rounds in full.
 */
export async function supervisedReport(view: SupervisedView, ctx: CommandContext, doc: ReportDocument, { full }: { full: boolean }): Promise<string[]> {
  const { header, outcome } = view.runFile;
  const surfaceOf = (task: ViewTask): ReportSurface | undefined => doc.surfaces.find((surface) => surface.run !== null && surface.run === task.record?.runId);
  const counts = countsLine(view.tasks);
  const lines = [
    ...environmentNarration(view),
    `Run ${header.runId}, started ${startedAt(header.runId)}: ${shapeOf(header.tasks, header.concurrency)}`,
    `Environment: ${BREAKER_PHRASES[view.breaker]}${repairedDuringRun(view)}`,
    ...(counts === "" ? [] : [counts]),
    ...(outcome === undefined && !view.live ? [STOPPED_PART_WAY] : []),
    "",
  ];
  for (const task of view.tasks) {
    lines.push(taskLine(task, view.live, surfaceOf(task)));
    if (task.standing === "escalated" && task.record) lines.push(...(await statusBody(task.record, ctx)), "");
  }
  // Exactly one blank line after the tasks, whether or not the last one carried a decision's account.
  if (lines.at(-1) !== "") lines.push("");
  lines.push(...rollUpLines(doc));
  if (full) {
    for (const task of view.tasks) {
      const surface = surfaceOf(task);
      if (surface) lines.push("", `${taskName(task)}:`, ...roundLines(surface.decisions, { full }));
    }
  }
  const readable = view.tasks.find((task) => task.standing === "escalated") ?? view.tasks.find((task) => task.record);
  if (readable?.record) lines.push("", `To read one task in full: delivery status ${readable.record.runId}`);
  const rounds = doc.surfaces.reduce((sum, surface) => sum + surface.decisions.length, 0);
  lines.push("", nextLine(header.runId, `delivery report ${header.runId} (this run in plain words)`, rounds, full));
  return lines;
}
```

In `statusCommand`, replace

```ts
  if ("runFile" in record) {
    const view = await viewOf(record, repoPath, startDir, ctx);
    if (ctx.json) ctx.writeLine(JSON.stringify(await supervisedDocument(view, ctx), null, 2));
    else for (const line of await supervisedReport(view, ctx)) ctx.writeLine(line);
    return EXIT.ok;
  }
```

with

```ts
  if ("runFile" in record) {
    const view = await viewOf(record, repoPath, startDir, ctx);
    if (ctx.json) {
      ctx.writeLine(JSON.stringify(await supervisedDocument(view, ctx), null, 2));
      return EXIT.ok;
    }
    const doc = await documentOf(repoPath, startDir, { kind: "run", runId: view.runFile.header.runId }, ctx);
    for (const line of await supervisedReport(view, ctx, doc, { full })) ctx.writeLine(line);
    return EXIT.ok;
  }
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `npx vitest run src/cli/status-command.test.ts src/report/detail.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/cli src/report`
Expected: no output.

- [ ] **Step 10: Update the recorded test that pinned the last line**

`tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts` is a recorded acceptance test of an earlier slice. It asserts that a run's status ends with "To read one task in full"; that line is still printed, and the output now ends with `Next:`. Replace

```ts
      expect(lines.at(-1)).toBe(`To read one task in full: delivery status ${task2Id}`);
```

with

```ts
      expect(lines).toContain(`To read one task in full: delivery status ${task2Id}`);
      // Every status output now ends by saying where to go next.
      expect(lines.at(-1)).toBe(`Next: delivery report ${runId} (this run in plain words)`);
```

Do not run this file yet: its `--all` assertion is updated in Task 7, and it is run there.

- [ ] **Step 11: Update the README and the changeset**

In `README.md`, section "A run of several tasks at once", replace the sentence

```markdown
waiting only because every slot is busy shows as "queued, waiting for a free slot"; if the run
was stopped part way, it says how to carry it on.
```

with

```markdown
waiting only because every slot is busy shows as "queued, waiting for a free slot"; if the run
was stopped part way, it says how to carry it on. While the run is going, a task under way says
what it is doing right now and which attempt it is on ("the agent is working, attempt 2",
"checking the agent's work, attempt 1"); once the run has stopped, it says "not finished yet".
Under the tasks come the retry budgets added up across the tasks the run has taken, beside the
run's own limit on repairs of what its tasks share, and a `Next:` line. With `--decisions`, every
task's triage rounds are printed in full beneath that.
```

In the sample output of the same section, replace

```text
  [4/4] add a shout (add-a-shout-20260930T090200Z): done

To read one task in full: delivery status delete-the-greeting-20260930T090000Z
```

with

```text
  [4/4] add a shout (add-a-shout-20260930T090200Z): done

Retry budgets across the 4 tasks this run has taken:
  correction 0 of 12, gate recheck 0 of 12, gate repair 0 of 8, session retry 0 of 20, close retry 0 of 12
  shared repair limit for the run: 0 of 2 used

To read one task in full: delivery status delete-the-greeting-20260930T090000Z

Next: delivery report run-20260930T090000Z (this run in plain words)
```

Append this paragraph to `.changeset/see-why-a-task-stopped.md`:

```markdown

For a run of several tasks at once, a task under way says what it is doing right now and which
attempt it is on, in place of "not finished yet", while the run is going. Under the tasks, the
retry budgets are added up across the run beside the run's shared repair limit, and
`--decisions` prints every task's triage rounds in full.
```

- [ ] **Step 12: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts README.md .changeset/see-why-a-task-stopped.md
git commit -m "Say what each task of a run is doing now, and roll its retries up" -m "\"Not finished yet\" told a reader nothing about a task that was mid-attempt, and no view showed where a run of several tasks was spending its retries. A task of a run that is going now says its step and attempt, and the run's status adds the retries up beside its shared repair limit. A run that has stopped keeps the old words, because nothing in it is doing anything."
```

---

### Task 7: The headline counts on each line of `status --all` ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/report/text.ts` (new export `headlineCounts`)
- Modify: `src/cli/status-command.ts`
- Modify: `README.md`, `.changeset/see-why-a-task-stopped.md`
- Modify: `tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts` (one pinned assertion)
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `loadSnapshot`, `deriveReport` (already imported, Task 5); in `src/report/text.ts` already: `headline(doc)`, `tally(doc)`; in `src/cli/status-command.ts` already: `isSupervised`, `listedId`, `listedRun`.
- Produces:
  - `headlineCounts(doc: ReportDocument): string` from `src/report/text.ts`: the headline once nothing is still to finish ("3 of 4 tasks completed and committed to their own branches; 1 needs your decision"), the tally until then ("1 task: 1 not finished").
  - `runListing(entries: (RunRecord | SupervisedView)[], countsOf: (entry: RunRecord | SupervisedView) => string): string[]` (one new parameter).

- [ ] **Step 1: Write the failing tests**

In `src/cli/status-command.test.ts`:

Replace the whole test "lists every run, newest first, with its task and how it ended" with these two tests:

```ts
  it("lists every run, newest first, with its task, how it ended, and the counts a report on it opens with", async () => {
    const repo = await threeRuns("status-all-");

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").filter((line) => line.startsWith("  "))).toEqual([
      "  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet): 1 task: 1 not finished",
      "  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you): 0 of 1 task completed; 1 stopped, for your engineers",
      "  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished): 1 of 1 task completed and committed to its own branch",
    ]);
    expect(stdout.trimEnd().split("\n").slice(-3)).toEqual(["To read one in full: delivery status <run-id>", "", "Next: delivery report (your task list)"]);
  });

  it("tells a task that failed after its attempts from one waiting on a decision, on its line", async () => {
    const repo = initTempRepo("status-all-counts-", { "package.json": PACKAGE });
    await writeRecord(repo, {
      runId: "fix-the-broken-footer-links-20261001T022000Z",
      task: "Fix the broken footer links",
      history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go"), ...failedCheck(2, "escalate")],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (1/1)"),
    });
    await writeRecord(repo, {
      runId: "replace-the-old-homepage-20261001T030000Z",
      task: "Replace the old homepage",
      history: attempt(1, "I need the owner to confirm.", "authority"),
      outcome: stoppedAt("2026-10-01T03:04:00.000Z", { kind: "authority", role: "worker" }, "worker escalated: authority"),
    });

    const { stdout } = await delivery(["status", "--all"], { cwd: repo });

    expect(stdout.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.split("): ")[1])).toEqual([
      "0 of 1 task completed; 1 needs your decision",
      "0 of 1 task completed; 1 failed after 2 attempts",
    ]);
  });
```

In the test "says there is nothing here yet, and exits ok: an empty list is an answer", replace

```ts
    expect(plain.stdout).toContain(NOTHING_HERE);
```

with

```ts
    expect(plain.stdout.trimEnd().split("\n")).toEqual([NOTHING_HERE, "", 'Next: delivery run --task "..."']);
```

In the test "lists a run of several at once as one summarising line among the single runs, with its tasks folded in", replace

```ts
      "2 runs in this repository, newest first:",
      "  add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave (finished)",
      `  ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision)`,
      "To read one in full: delivery status <run-id>",
```

with

```ts
      "2 runs in this repository, newest first:",
      "  add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave (finished): 1 of 1 task completed and committed to its own branch",
      `  ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision): 3 of 4 tasks completed and committed to their own branches; 1 stopped, for your engineers`,
      "To read one in full: delivery status <run-id>",
      "",
      "Next: delivery report (your task list)",
```

(The `threeRuns` and `finishedSupervisedRun` fixtures write stops with no recorded cause, as runs made before Slice 1 did; the report counts such a stop as "stopped, for your engineers". The second new test uses records with a recorded cause, and shows the two kinds of stop told apart.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: FAIL: the four tests above fail, because no line carries counts or a `Next:` line yet.

- [ ] **Step 3: Give the report's opening counts a name**

Apply to `src/report/text.ts`:

```diff
--- a/src/report/text.ts
+++ b/src/report/text.ts
@@ -129,11 +129,17 @@ const SUBJECT: Record<ReportDocument["kind"], { final: string; going: string; pa
   task: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
 };
 
+const waitingIn = (doc: ReportDocument): number => doc.counts.unfinished + doc.counts.paused + doc.counts.queued;
+
+/** The counts a report opens with, without the words around them: the headline once nothing is still to finish, the tally until then. */
+export function headlineCounts(doc: ReportDocument): string {
+  return waitingIn(doc) === 0 ? headline(doc) : tally(doc);
+}
+
 /** The first lines: what happened, counted. Never final-sounding while a task is still to finish. */
 function opening(doc: ReportDocument): string[] {
   const words = SUBJECT[doc.kind];
-  const waiting = doc.counts.unfinished + doc.counts.paused + doc.counts.queued;
-  if (waiting === 0) return doc.surfaces.length === 0 ? [] : [`${words.final}: ${headline(doc)}.`];
+  if (waitingIn(doc) === 0) return doc.surfaces.length === 0 ? [] : [`${words.final}: ${headline(doc)}.`];
   if (doc.live === true) return [`${words.going} (${tally(doc)}).`];
   // A run that records why it stopped says how to carry on in its own line, below.
   if (doc.live === false) return [`${words.partWay} (${tally(doc)}).${doc.run?.cause == null ? " To carry on: delivery run" : ""}`];
```

- [ ] **Step 4: Put the counts on each line**

In `src/cli/status-command.ts`:

Add this import directly after the import from `../report/snapshot.js`:

```ts
import { headlineCounts } from "../report/text.js";
```

Replace the whole `runListing` function, with its doc comment, by:

```ts
/**
 * Every run this repository holds, one to a line; a run of several at once is
 * one line saying its shape and how its tasks stand. Each line ends with the
 * counts `delivery report` would open with for that run, which tell a task
 * that failed after its attempts from one waiting on a decision.
 */
export function runListing(entries: (RunRecord | SupervisedView)[], countsOf: (entry: RunRecord | SupervisedView) => string): string[] {
  if (entries.length === 0) return [NOTHING_HERE, "", 'Next: delivery run --task "..."'];
  const line = (entry: RunRecord | SupervisedView): string => {
    if (!isSupervised(entry)) return `${describeRun(entry)} (${OUTCOME_WORDS[runSummary(entry).outcome]})`;
    const { runId, tasks, concurrency } = entry.runFile.header;
    const counts = countsLine(entry.tasks);
    return `${runId}, started ${startedAt(runId)}: ${shapeOf(tasks, concurrency)}${counts === "" ? "" : ` (${counts})`}`;
  };
  return [
    `${entries.length} run${entries.length === 1 ? "" : "s"} in this repository, newest first:`,
    ...entries.map((entry) => `  ${line(entry)}: ${countsOf(entry)}`),
    "To read one in full: delivery status <run-id>",
    "",
    "Next: delivery report (your task list)",
  ];
}
```

Replace the whole `listRuns` function (keep its doc comment) with:

```ts
async function listRuns(repoPath: string, startDir: string, ctx: CommandContext): Promise<ExitCode> {
  const [records, list, locked, supervised] = await Promise.all([
    allRuns(repoPath),
    listTasks(startDir, repoPath, ctx),
    repoLocked(repoPath),
    allSupervisedRuns(repoPath),
  ]);
  const views = supervised.map((record) => supervisedView(record.runFile, records, list, record.runFile.outcome === undefined && locked));
  const members = new Set(views.flatMap((view) => claimedBy(view.runFile).map((claim) => claim.surfaceId)));
  const entries = newestFirstBy<RunRecord | SupervisedView>([...records.filter((record) => !members.has(record.runId)), ...views], listedId);
  if (ctx.json) {
    ctx.writeLine(JSON.stringify(entries.map(listedRun), null, 2));
    return EXIT.ok;
  }
  // One reading for every line's counts: each is the report document for that run, derived from the same snapshot.
  const snapshot = await loadSnapshot(repoPath, { kind: "list" }, { live: locked, list });
  const countsOf = (entry: RunRecord | SupervisedView): string =>
    headlineCounts(deriveReport({ ...snapshot, subject: { kind: isSupervised(entry) ? "run" : "task", runId: listedId(entry) } }));
  for (const line of runListing(entries, countsOf)) ctx.writeLine(line);
  return EXIT.ok;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/cli/status-command.test.ts src/report`
Expected: PASS. `src/report/text.test.ts` still passes: the report's opening lines are built from the same two functions as before.

Run: `npx tsc --noEmit && npx eslint src/cli src/report`
Expected: no output.

- [ ] **Step 6: Update the recorded test that pinned the whole `--all` line**

In `tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts`, replace

```ts
        new RegExp(`^  ${runId}, started [\\d-]+ [\\d:]+ UTC: 4 tasks, up to 2 at once \\(3 done, 1 needs your decision\\)$`, "m"),
```

with

```ts
        // The line goes on to the counts a report on the run opens with, so it is matched from its start.
        new RegExp(`^  ${runId}, started [\\d-]+ [\\d:]+ UTC: 4 tasks, up to 2 at once \\(3 done, 1 needs your decision\\): `, "m"),
```

Run: `npm run build && npx vitest run tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts`
Expected: PASS (3 passed, 2 skipped).

- [ ] **Step 7: Update the README and the changeset**

In `README.md`, section "See every run", replace the sample output

```text
3 runs in this repository, newest first:
  add-a-goodbye-20261001T113000Z, started 2026-10-01 11:30 UTC: add a goodbye (hasn't finished yet)
  run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision)
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)
To read one in full: delivery status <run-id>
```

with

```text
3 runs in this repository, newest first:
  add-a-goodbye-20261001T113000Z, started 2026-10-01 11:30 UTC: add a goodbye (hasn't finished yet): 1 task: 1 not finished
  run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision): 3 of 4 tasks completed and committed to their own branches; 1 needs your decision
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished): 1 of 1 task completed and committed to its own branch
To read one in full: delivery status <run-id>

Next: delivery report (your task list)
```

and replace the paragraph after it

```markdown
A run of several tasks at once is one line: its shape and how its tasks stand. Its tasks are read
with `delivery status run-…`, and each of those by its own run id.
```

with

```markdown
A run of several tasks at once is one line: its shape and how its tasks stand. Its tasks are read
with `delivery status run-…`, and each of those by its own run id. Every line ends with the
counts `delivery report` opens with for that run, so a task that failed after its attempts reads
differently from one waiting on your decision.
```

Append this paragraph to `.changeset/see-why-a-task-stopped.md`:

```markdown

`delivery status --all` ends each run's line with the counts `delivery report` opens with for
that run, so a task that failed after its attempts reads differently from one waiting on a
decision. Every text output of `status` now ends with a `Next:` line.
```

- [ ] **Step 8: Commit**

```bash
git add src/report/text.ts src/cli/status-command.ts src/cli/status-command.test.ts tests/multi-surface-supervisor/4-see-where-a-running-at-once-run-has-got-to.test.ts README.md .changeset/see-why-a-task-stopped.md
git commit -m "End each line of status --all with the counts a report opens with" -m "The listing said a run needed a decision without saying whether a task had failed after its attempts or was waiting on its owner. Each line now carries the same counts delivery report opens with for that run, from the same document, and the listing ends by pointing at the report."
```

---

## Acceptance criteria, and the task that delivers each

| Slice criterion | Delivered by |
|---|---|
| Beneath the existing account of a stopped run: the retry budgets at the moment it stopped (used and allowed, five kinds) and the number of attempts | Task 4 (`budgetLines`, `budgetWords`: "Retry budgets at stop, after 4 attempts"), shown end to end in Task 5 |
| One line per triage round: after which attempt, what set it off, what was decided | Task 2 (`refs`), Task 3 (`decisions`), Task 4 (`roundLines`), Task 5 |
| `--decisions` prints every round in full: trigger, verdict, reasoning word for word, the brief or packet produced | Task 1 (`briefLines`, `PacketRef`), Task 3 (`brief`, `packet`), Task 4 (`fullRoundLines`, `producedLines`), Task 5 (the option and its refusals) |
| A run of several tasks: what each in-flight task is doing in place of "not finished yet"; budgets rolled up beside the run's shared repair limit | Task 3 (`state`), Task 6 (`inFlight`, `taskLine`, `rollUpLines`) |
| A stopped task's status ends with the report's "To act" advice, and says an unchanged task is not run again and `resume` does not apply | Task 1 (`toAct` shared), Task 4 (`actLines`, `UNCHANGED_NOT_RUN_AGAIN`, `RESUME_DOES_NOT_APPLY`), Task 5 (test against `delivery report` output) |
| `status --all` shows the headline counts on each run's line | Task 7 (`headlineCounts`, `runListing`) |
| Technical sections use the harness's own words; evidence word for word | Task 4 (`POPULATION_LABELS`, `SETBACK_LABELS`, raw verdicts; `quoted` and `briefLines` for rationale, brief and packet; the vocabulary test) |
| No triage rounds, or no stop, said in one line; an older run shows what its record holds and "not recorded" for the rest | Task 4 ("How it got here: no triage rounds.", "No stop: …", "Packet for a person: not recorded.", "To act: not recorded; …"), Task 5 (older-record test) |
| Everything `status` printed before is still printed; exit codes unchanged | Task 5 (`statusReport` untouched and asserted as a prefix), Task 6 (existing task lines and footer asserted), Task 7 (existing listing lines asserted); `--json` branches untouched |
| Every status output ends with "Next:" naming `--decisions` and `delivery report` where they apply | Task 5 (`nextLine`, one task), Task 6 (a run of several), Task 7 (`--all`, and the empty listing) |
