# Multi-Surface Supervisor — Slice 4: See Where a Running-at-Once Run Has Got To

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** `delivery status` reads a run of several tasks at once: `delivery status run-…` prints the run line, the environment, the counts and one line per task (a task needing a decision followed by today's decision rendering, unchanged); `--json` gives one document nesting today's per-task document; with no id it reports the most recently touched run of either kind; `--all` shows a supervised run as one summarising line; a task's own id still reads exactly as today.

**Architecture:** Everything is read-only over records that already exist. `src/cli/runs.ts` learns to read supervised run records by id and to list them (`readSupervisedRun`, `allSupervisedRuns`), beside the per-task `readRun`/`allRuns`. A new pure module, `src/cli/supervised-view.ts`, turns one run file, the per-task records and the project's list as written now into a `SupervisedView`: every task the run took (deduplicated by task run id, since a resumed run re-fills a slot for a task it already took) with its own record and a standing (`closed | escalated | aborted | unfinished | queued`), plus, for an unfinished run, every list task still to take, by the same rule `nextQueueTask` fills slots by. `src/cli/status-command.ts` stays the one renderer: it dispatches a `run-…` id (or a newest-touched supervised record) to a supervised report and a supervised JSON document that reuse the existing per-task pieces (`statusDocument`, and the escalated rendering extracted as `statusBody`), and closed-set word tables for standings and the environment.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`), vitest, `proper-lockfile` (already a dependency; only its existing `repoLocked` check is used, to tell a live run from a stopped one).

## Global Constraints

- Node ≥22; `noUncheckedIndexedAccess` is on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new dependency.
- Exit codes are unchanged (`src/cli/failures.ts` `EXIT`): `status` exits 0 whenever it could read a run, 2 (`EXIT.configuration`) when the id names nothing or the repository has no runs.
- `delivery status <task-run-id>` output, plain and `--json`, is byte-for-byte what it is today, including for a task that belongs to a supervised run. The existing `src/cli/status-command.test.ts` single-run tests must pass unchanged, except the one `--all --json` test Task 6 updates for the new `tasks` key.
- Human-readable output never shows an internal state name (`HEALTHY`, `ESCALATED`, `DRAINED`, …); closed-set `Record<…, string>` tables translate, so a new state does not compile without words. `--json` uses the harness's own names.
- Under `--json`, every key is always present, `null` where it does not apply; stdout holds only JSON.
- Tests are offline and in-process (`delivery([...])` from `src/cli/command-fixtures.ts`); records are written with the existing fixtures `writeRunRecord` and `writeSupervisedRun`, never by paying for a run.
- User-facing copy (messages, README, changeset): controlled British English, plain words, no em-dashes; colons, semicolons and commas instead.
- **Buy-vs-build (Build note):** reuse the existing status command, the existing per-task report (`statusReport`/`statusDocument`) and the closed-set phrase-table pattern; no second renderer. The per-task JSON entries are `statusDocument(...)` results, nested, not re-schemed. "Queued" is worked out by the same rule the supervisor fills slots by (`stillToTake`, extracted from `nextQueueTask`), not a second rule. Live-versus-stopped is `repoLocked` (slice 3), not a new check.
- **Operability/DX (Operational note):** this is the post-mortem surface: the whole run record is readable through `delivery status <run> --json`, nesting each task's existing report. Verified by targeted vitest files (`npx vitest run <file>`); no new command, flag, env var or script.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **Environment is always "healthy" in this slice.** The run file records no breaker until slice 5. `BreakerState` is added to `src/schema.ts` as `z.enum(["HEALTHY"])` and the view always reports `"HEALTHY"`; slice 5 widens the enum, and the total `ENVIRONMENT_WORDS` table then refuses to compile until the new states have words. `ponytail:` comment marks it.
  - **"Paused" is not a standing yet.** A task is only ever held for a repair from slice 5; the counts line lists only non-zero standings, so "paused" appears when slice 5 adds it. The five standings here are `closed` ("done"), `escalated` ("needs your decision"), `aborted` ("stopped before it finished"), `unfinished` ("not finished yet"), `queued` ("queued").
  - **"Queued, waiting for a free slot" only while the run is live** (`!outcome && repoLocked(repo)`). A stopped run's queued tasks say "queued", and the report adds the existing `STOPPED_PART_WAY` sentence saying how to carry on, rather than claiming they wait for a slot nothing is filling.
  - **A task the run took but whose record does not exist yet** (killed between `slot_fill` and the case file) is shown as queued: resuming starts it from scratch, which is what queued means.
  - **A finished (drained) run lists nothing queued**, even if the list has grown since: it will take nothing more.
  - **Each task line names the task's own run id** once it has a record (`[1/4] add a hello (add-a-hello-…): done`), so the UAT's "copy the name of one finished task from the list" is possible: `--all` folds the tasks away and the footer names only one.
  - **Task position** is the task's place in the project's list as written now (`queuePositionOf`), as single-run status already does; a task no longer on the list has no `[n/M]` tag and sorts after those that do. The run line's task count is the header's (`tasks`), what the run started with.
  - **Most recently touched, of either kind:** the newest-touched task record and the newest-touched supervised record are compared by file mtime (`touchedAt`, generalised to `case.json`/`run.json`/`log.jsonl`). A task record that wins but was taken by an *unfinished* supervised run is reported as that run, so checking on a live (or stopped) run with no id shows the run, not whichever of its tasks moved last. Once a supervised run has finished, a task of it that is touched again (for example by `delivery resume <task-id>`) is reported as that task, as today.
  - **`--all` folds a supervised run's tasks into its one line**; they are read in full with `delivery status run-…` then by their own ids. Its JSON entries all gain a `tasks` key: `null` for a single run, the member tasks' `RunSummary` list for a supervised one (whose `task` is `null` and whose `outcome` is `unfinished` until drained, then `escalated` > `aborted` > `closed`, the `listExitCode` precedence).
  - **An id is looked up as a supervised run first, then as a task run.** A missing supervised record (`RunFileNotFound`) falls through to `readRun`, whose `FileNotFound` renders the existing "I couldn't find that run's record" message. `ponytail:` a task whose text has no letters or digits gets the slug `run`, so its id could equal a supervised id started in the same second; the supervised run wins. Accepted; not worth a namespace change.
  - The supervised JSON document's `runBudgets` (spec) is left to slice 5, which introduces run budgets; adding a key later is additive.

## Scaffolding Impact

- **Reactive:** `README.md` "See what happened to a run" describes reading one run only → gains "A run of several tasks at once" (Task 3), its `--json` (Task 4), and the no-id rule now covering either kind (Task 5). "See every run" example and its `--all --json` description → updated for a supervised run's one line and the `tasks` key (Task 6).
- **Proactive:** `.changeset/see-a-run-of-several-at-once.md` (every user-visible change gets a changeset in this repo) → created in Task 3, extended in Tasks 4, 5 and 6.
- **Inherited (Operational note):** `delivery status <run> --json` as the post-mortem surface → Task 4.
- Checked and unchanged: `docs/getting-started.md` and `docs/project-configuration.md` describe `status` for one run at a time and stay true; the `status` command's `--help` text ("say what happened to a run", "[run-id]") stays true for a run id of either kind; `docs/testing-your-pipeline.md` (testing API untouched); `src/index.ts`/`src/testing.ts` export nothing from `src/cli/`. No `CLAUDE.md` in this repo.

---

### Task 1: Read supervised run records by id, and list them all ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/runs.ts`
- Test: `src/cli/runs.test.ts`

**Interfaces:**
- Consumes: `loadRunFile(dir)` (`src/run-file.ts`), `supervisedPlace(repoPath, runId)`, `supervisedRoot(repoPath)` (`src/cli/run-location.ts`), existing `SupervisedRecord { dir: string; runFile: RunFile }`.
- Produces:
  - `touchedAt(dir: string): Promise<number>`: now exported; the newest mtime of `case.json`, `run.json`, `log.jsonl` in `dir` (a missing file counts as 0).
  - `readSupervisedRun(repoPath: string, runId: string): Promise<SupervisedRecord>`: rejects with `RunFileNotFound` when no such run.
  - `allSupervisedRuns(repoPath: string): Promise<SupervisedRecord[]>`: finished and unfinished, most recently touched first; a folder with no `run.json` is passed over; an unreadable record throws.
  - `newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[]`: now exported, unchanged.
  - `unfinishedSupervisedRun` keeps its signature and behaviour, reimplemented over `allSupervisedRuns`.

- [ ] **Step 1: Write the failing tests**

Add `readSupervisedRun`, `allSupervisedRuns` and `touchedAt` to the `./runs.js` import in `src/cli/runs.test.ts`, `RunFileNotFound` from `../errors.js`, and `utimes` from `node:fs/promises` (merge with existing imports; `writeSupervisedRun`, `setRunOutcome`, `supervisedRoot`, `mkdir`, `join` and `scratchRepo` are already there). Append:

```ts
describe("every run of several tasks at once a repository holds", () => {
  const header = (repoPath: string, runId: string) => ({ runId, repoPath, concurrency: 2, tasks: 3 });
  const backdateRun = async (dir: string): Promise<void> => {
    const longAgo = new Date("2026-09-01T00:00:00.000Z");
    for (const name of ["run.json", "log.jsonl"]) await utimes(join(dir, name), longAgo, longAgo);
  };

  it("finds none in a repository that has never run several at once", async () => {
    expect(await allSupervisedRuns(await scratchRepo())).toEqual([]);
  });

  it("includes finished runs as well as unfinished ones, most recently touched first", async () => {
    const repo = await scratchRepo();
    const older = await writeSupervisedRun(repo, header(repo, "run-20260930T110000Z"));
    const finished = await writeSupervisedRun(repo, header(repo, "run-20260930T090000Z"));
    await setRunOutcome(finished, { kind: "drained", at: "2026-09-30T10:00:00.000Z" });
    await backdateRun(older);

    const found = await allSupervisedRuns(repo);
    expect(found.map((record) => record.runFile.header.runId)).toEqual(["run-20260930T090000Z", "run-20260930T110000Z"]);
    expect(found[0]?.dir).toBe(finished);
  });

  it("passes over a folder with no record in it", async () => {
    const repo = await scratchRepo();
    await mkdir(join(supervisedRoot(repo), "run-20260930T090000Z"), { recursive: true });
    expect(await allSupervisedRuns(repo)).toEqual([]);
  });

  it("reads one by its id, and says plainly when the id names no such run", async () => {
    const repo = await scratchRepo();
    const dir = await writeSupervisedRun(repo, header(repo, "run-20260930T090000Z"));

    const record = await readSupervisedRun(repo, "run-20260930T090000Z");
    expect(record.dir).toBe(dir);
    expect(record.runFile.header.tasks).toBe(3);
    await expect(readSupervisedRun(repo, "run-20200101T000000Z")).rejects.toBeInstanceOf(RunFileNotFound);
  });

  it("counts a run's record as touched when its log was last written", async () => {
    const repo = await scratchRepo();
    const dir = await writeSupervisedRun(repo, header(repo, "run-20260930T090000Z"));
    await backdateRun(dir);
    expect(await touchedAt(dir)).toBe(new Date("2026-09-01T00:00:00.000Z").getTime());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts`
Expected: FAIL: `allSupervisedRuns`, `readSupervisedRun` and `touchedAt` are not exported.

- [ ] **Step 3: Implement**

In `src/cli/runs.ts`, add `supervisedPlace` to the `./run-location.js` import, then replace the private `touchedAt` with the exported, generalised one:

```ts
/**
 * When a record was last written, for "the most recently touched": whichever of
 * its files was rewritten or appended to last. A run of one task keeps
 * `case.json`, a run of several at once `run.json`, and both keep `log.jsonl`;
 * a file a record does not keep counts as never written.
 */
export async function touchedAt(dir: string): Promise<number> {
  const times = await Promise.all(
    ["case.json", "run.json", "log.jsonl"].map((name) =>
      stat(join(dir, name)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}
```

Replace the body of `unfinishedSupervisedRun` (keep its doc comment) and add the two readers above it:

```ts
/** A run of several tasks at once by its id, finished or not. An id that names no such run raises `RunFileNotFound`. */
export async function readSupervisedRun(repoPath: string, runId: string): Promise<SupervisedRecord> {
  const dir = supervisedPlace(repoPath, runId);
  return { dir, runFile: await loadRunFile(dir) };
}

/**
 * Every run of several tasks at once this repository holds, finished or not,
 * most recently touched first. A folder with no record in it was never a run
 * and is passed over; a record that cannot be read back stops the command with
 * the message naming its folder.
 */
export async function allSupervisedRuns(repoPath: string): Promise<SupervisedRecord[]> {
  let entries;
  try {
    entries = await readdir(supervisedRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has run several at once here
  }
  const read = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readSupervisedRun(repoPath, entry.name).catch((err: unknown) => {
          if (err instanceof RunFileNotFound) return undefined;
          throw err;
        }),
      ),
  );
  const found = await Promise.all(
    read
      .filter((record): record is SupervisedRecord => record !== undefined)
      .map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })),
  );
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

export async function unfinishedSupervisedRun(repoPath: string): Promise<SupervisedRecord | undefined> {
  const unfinished = (await allSupervisedRuns(repoPath)).filter((record) => record.runFile.outcome === undefined);
  return newestFirstBy(unfinished, (record) => record.runFile.header.runId).at(0);
}
```

Change `function newestFirstBy<T>(` to `export function newestFirstBy<T>(`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/runs.test.ts`
Expected: PASS, including the existing "the run of several tasks at once that didn't finish" tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/runs.ts src/cli/runs.test.ts
git commit -m "Read and list runs of several tasks at once by id

delivery status needs to find a run of several at once by the id it
opened with, and to compare it with single runs for the most recently
touched; the only reader so far found the unfinished one for resume."
```

---

### Task 2: Work out what each task of a supervised run is doing ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (add `BreakerState`)
- Modify: `src/cli/queue.ts` (extract `stillToTake`; export `shapeOf`)
- Create: `src/cli/supervised-view.ts`
- Test: `src/cli/supervised-view.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `allRuns`, `readSupervisedRun` (Task 1); `queuePositionOf`, `QueuePosition`, `findQueueRun` (`src/cli/queue.ts`); `RunFile`, `SlotOutcome`, `TaskDef` (`src/schema.ts`).
- Produces:
  - `src/schema.ts`: `export const BreakerState = z.enum(["HEALTHY"]); export type BreakerState = z.infer<typeof BreakerState>;`
  - `src/cli/queue.ts`: `stillToTake(records: RunRecord[], taskDef: TaskDef, claimed?: readonly TaskDef[]): boolean`; `shapeOf(tasks: number, concurrency: number): string` now exported (unchanged: `"4 tasks, up to 2 at once"`).
  - `src/cli/supervised-view.ts`:
    - `type TaskStanding = SlotOutcome | "unfinished" | "queued"`
    - `const STANDINGS: readonly TaskStanding[]` = `["closed", "escalated", "aborted", "unfinished", "queued"]` (the order counts are said in)
    - `interface ViewTask { taskDef: TaskDef; position: QueuePosition | undefined; record: RunRecord | undefined; standing: TaskStanding }`
    - `interface SupervisedView { runFile: RunFile; live: boolean; breaker: BreakerState; tasks: ViewTask[] }`
    - `claimedBy(runFile: RunFile): { surfaceId: string; taskDef: TaskDef }[]`
    - `supervisedView(runFile: RunFile, records: RunRecord[], list: TaskDef[], live: boolean): SupervisedView`
    - `standingCounts(tasks: readonly ViewTask[]): Record<TaskStanding, number>`
    - `overallOutcome(view: SupervisedView): SlotOutcome | "unfinished"`

- [ ] **Step 1: Write the failing tests**

Create `src/cli/supervised-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setRunOutcome } from "../run-file.js";
import type { CaseFileOutcome, RunEntry, SlotOutcome } from "../schema.js";
import { ESCALATION, writeRunRecord, writeSupervisedRun } from "./command-fixtures.js";
import { queueTasks } from "./queue.js";
import { allRuns, readSupervisedRun } from "./runs.js";
import { claimedBy, overallOutcome, standingCounts, supervisedView, type SupervisedView } from "./supervised-view.js";

const RUN = "run-20260930T090000Z";
const AT = "2026-09-30T09:05:00.000Z";
const CLOSED: CaseFileOutcome = { kind: "closed", source: "closer", reason: "committed", at: AT };
const ESCALATED: CaseFileOutcome = { kind: "escalated", source: "worker", reason: "authority limit", at: AT };
const ABORTED: CaseFileOutcome = { kind: "aborted", source: "provisioning", reason: "no worktree", at: AT };
const HELLO = "add a hello";
const GREETING = "delete the greeting";
const GOODBYE = "add a goodbye";
const ID = { hello: "add-a-hello-20260930T090000Z", greeting: "delete-the-greeting-20260930T090000Z", goodbye: "add-a-goodbye-20260930T090100Z" };

const fill = (slot: number, surfaceId: string, intent: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent } });
const free = (slot: number, surfaceId: string, outcome: SlotOutcome): RunEntry => ({ t: "slot_free", slot, surfaceId, outcome });

/** The view of one supervised run in a scratch repository, against a list as it is written now. */
async function viewOf(
  { list, runs, history, drained = false, live = false }:
    { list: string[]; runs: { runId: string; task: string; outcome?: CaseFileOutcome }[]; history: RunEntry[]; drained?: boolean; live?: boolean },
): Promise<SupervisedView> {
  const repo = await mkdtemp(join(tmpdir(), "supervised-view-"));
  for (const run of runs) await writeRunRecord(repo, { ...run, packet: run.outcome?.kind === "escalated" ? ESCALATION : undefined });
  const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: list.length }, history);
  if (drained) await setRunOutcome(dir, { kind: "drained", at: AT });
  return supervisedView((await readSupervisedRun(repo, RUN)).runFile, await allRuns(repo), queueTasks({ tasks: list }), live);
}

const summary = (view: SupervisedView) =>
  view.tasks.map((task) => ({ intent: task.taskDef.intent, position: task.position?.task, standing: task.standing, id: task.record?.runId }));

describe("what each task of a run of several at once is doing", () => {
  it("gives every task the run took the standing its own record says, in list order", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [
        { runId: ID.hello, task: HELLO, outcome: CLOSED },
        { runId: ID.greeting, task: GREETING, outcome: ESCALATED },
        { runId: ID.goodbye, task: GOODBYE, outcome: ABORTED },
      ],
      history: [fill(1, ID.greeting, GREETING), fill(2, ID.hello, HELLO), free(2, ID.hello, "closed"), fill(2, ID.goodbye, GOODBYE)],
      drained: true,
    });
    expect(summary(view)).toEqual([
      { intent: HELLO, position: 1, standing: "closed", id: ID.hello },
      { intent: GREETING, position: 2, standing: "escalated", id: ID.greeting },
      { intent: GOODBYE, position: 3, standing: "aborted", id: ID.goodbye },
    ]);
  });

  it("says a task under way has not finished", async () => {
    const view = await viewOf({ list: [HELLO], runs: [{ runId: ID.hello, task: HELLO }], history: [fill(1, ID.hello, HELLO)] });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "unfinished", id: ID.hello }]);
  });

  it("counts a task the run took but never got to start as queued", async () => {
    const view = await viewOf({ list: [HELLO], runs: [], history: [fill(1, ID.hello, HELLO)] });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "queued", id: undefined }]);
  });

  it("lists, for a run still going, every list task it has yet to take, but not one an earlier run delivered", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING }],
      history: [fill(1, ID.greeting, GREETING)],
    });
    expect(summary(view)).toEqual([
      { intent: GREETING, position: 2, standing: "unfinished", id: ID.greeting },
      { intent: GOODBYE, position: 3, standing: "queued", id: undefined },
    ]);
  });

  it("lists nothing queued for a run that has finished, even when the list has grown since", async () => {
    const view = await viewOf({
      list: [HELLO, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }],
      history: [fill(1, ID.hello, HELLO), free(1, ID.hello, "closed")],
      drained: true,
    });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "closed", id: ID.hello }]);
  });

  it("shows a task once when a resumed run took it again", async () => {
    const view = await viewOf({
      list: [HELLO],
      runs: [{ runId: ID.hello, task: HELLO }],
      history: [fill(1, ID.hello, HELLO), fill(1, ID.hello, HELLO)],
    });
    expect(view.tasks).toHaveLength(1);
    expect(claimedBy(view.runFile)).toEqual([{ surfaceId: ID.hello, taskDef: { intent: HELLO } }]);
  });

  it("puts a task no longer on the list after those that are, with no position", async () => {
    const view = await viewOf({
      list: [GREETING],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING, outcome: CLOSED }],
      history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
      drained: true,
    });
    expect(summary(view)).toEqual([
      { intent: GREETING, position: 1, standing: "closed", id: ID.greeting },
      { intent: HELLO, position: undefined, standing: "closed", id: ID.hello },
    ]);
  });

  it("reports the shared environment as healthy, and whether the run is going, as it was told", async () => {
    const view = await viewOf({ list: [HELLO], runs: [], history: [], live: true });
    expect(view.breaker).toBe("HEALTHY");
    expect(view.live).toBe(true);
  });
});

describe("a run of several at once, summed up", () => {
  it("counts every standing, zeros included", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING, outcome: ESCALATED }],
      history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
    });
    expect(standingCounts(view.tasks)).toEqual({ closed: 1, escalated: 1, aborted: 0, unfinished: 0, queued: 1 });
  });

  it("has not finished until its record says so", async () => {
    const view = await viewOf({ list: [HELLO], runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }], history: [fill(1, ID.hello, HELLO)] });
    expect(overallOutcome(view)).toBe("unfinished");
  });

  it("ended wanting a decision if any task did, then stopped if any task stopped, and closed only if every task closed", async () => {
    const ended = (outcomes: CaseFileOutcome[]) =>
      viewOf({
        list: [HELLO, GREETING],
        runs: [{ runId: ID.hello, task: HELLO, outcome: outcomes[0] }, { runId: ID.greeting, task: GREETING, outcome: outcomes[1] }],
        history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
        drained: true,
      });
    expect(overallOutcome(await ended([ABORTED, ESCALATED]))).toBe("escalated");
    expect(overallOutcome(await ended([CLOSED, ABORTED]))).toBe("aborted");
    expect(overallOutcome(await ended([CLOSED, CLOSED]))).toBe("closed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/supervised-view.test.ts`
Expected: FAIL: cannot find module `./supervised-view.js`.

- [ ] **Step 3: Implement**

In `src/schema.ts`, directly above `export const RunHeader`:

```ts
/**
 * Whether the environment every task of a run shares is fit to use. Only
 * healthy so far: the run file records no breaker until repairs are run once
 * for the whole run, which adds the other states here.
 */
export const BreakerState = z.enum(["HEALTHY"]);
export type BreakerState = z.infer<typeof BreakerState>;
```

In `src/cli/queue.ts`, replace `nextQueueTask`'s predicate with an exported helper and export `shapeOf`:

```ts
/**
 * Whether a list task is still for a run to take: its run has not been
 * delivered, and no slot has already taken it in this run. The one rule
 * `delivery run` fills each slot by, and `delivery status` counts queued tasks by.
 */
export function stillToTake(records: RunRecord[], taskDef: TaskDef, claimed: readonly TaskDef[] = []): boolean {
  return !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef));
}

export function nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: readonly TaskDef[] = []): QueuePosition | undefined {
  const index = tasks.findIndex((taskDef) => stillToTake(records, taskDef, claimed));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}
```

(keep `nextQueueTask`'s existing doc comment), and change `const shapeOf = (` to `export const shapeOf = (`.

Create `src/cli/supervised-view.ts`:

```ts
import type { BreakerState, RunFile, SlotOutcome, TaskDef } from "../schema.js";
import { queuePositionOf, stillToTake, type QueuePosition } from "./queue.js";
import type { RunRecord } from "./runs.js";

/** Where one task of a run of several at once has got to: how its own run ended, that it hasn't yet, or that it is still waiting to start. */
export type TaskStanding = SlotOutcome | "unfinished" | "queued";

/** Every standing, in the order a summary says them. */
export const STANDINGS: readonly TaskStanding[] = ["closed", "escalated", "aborted", "unfinished", "queued"];

/** One task of a run of several at once. */
export interface ViewTask {
  taskDef: TaskDef;
  /** Its place in the project's list as written now; none once the list no longer asks for it. */
  position: QueuePosition | undefined;
  /** Its own run's record, once it has one. */
  record: RunRecord | undefined;
  standing: TaskStanding;
}

/** A run of several tasks at once, read back: its record, whether it is going right now, the shared environment, and every task it took or has yet to take. */
export interface SupervisedView {
  runFile: RunFile;
  live: boolean;
  breaker: BreakerState;
  tasks: ViewTask[];
}

/** Every task the run took, once each, in the order it first took them: a run picked up after a stop takes its unfinished tasks again. */
export function claimedBy(runFile: RunFile): { surfaceId: string; taskDef: TaskDef }[] {
  const taken = new Map<string, TaskDef>();
  for (const entry of runFile.history) {
    if (entry.t === "slot_fill" && !taken.has(entry.surfaceId)) taken.set(entry.surfaceId, entry.taskDef);
  }
  return [...taken].map(([surfaceId, taskDef]) => ({ surfaceId, taskDef }));
}

const LAST = Number.MAX_SAFE_INTEGER;

/**
 * A run of several at once as `delivery status` tells it. Pure over what it is
 * given: the run's record, every task run's record, and the list as written now.
 * A task the run took stands as its own record says, or queued if it never got
 * as far as having one. A run that has not finished also has every list task it
 * would still take, by the rule it fills slots by; a finished run takes nothing more.
 */
export function supervisedView(runFile: RunFile, records: RunRecord[], list: TaskDef[], live: boolean): SupervisedView {
  const claims = claimedBy(runFile);
  const taken = claims.map(({ surfaceId, taskDef }): ViewTask => {
    const record = records.find((candidate) => candidate.runId === surfaceId);
    return {
      taskDef,
      position: queuePositionOf(list, taskDef),
      record,
      standing: record === undefined ? "queued" : (record.caseFile.outcome?.kind ?? "unfinished"),
    };
  });
  const claimed = claims.map(({ taskDef }) => taskDef);
  const waiting: ViewTask[] =
    runFile.outcome !== undefined
      ? []
      : list
          .filter((taskDef) => stillToTake(records, taskDef, claimed))
          .map((taskDef): ViewTask => ({ taskDef, position: queuePositionOf(list, taskDef), record: undefined, standing: "queued" }));
  const tasks = [...taken, ...waiting].sort((a, b) => (a.position?.task ?? LAST) - (b.position?.task ?? LAST));
  // ponytail: always healthy until the run file records a breaker (slice 5), which derives it from the history here.
  return { runFile, live, breaker: "HEALTHY", tasks };
}

/** How many tasks stand each way, every standing present. */
export function standingCounts(tasks: readonly ViewTask[]): Record<TaskStanding, number> {
  const counts = Object.fromEntries(STANDINGS.map((standing) => [standing, 0])) as Record<TaskStanding, number>;
  for (const task of tasks) counts[task.standing] += 1;
  return counts;
}

/** How the run ended as one word, the precedence its exit code has: a decision wanted anywhere, then a task that stopped, and closed only when every task closed. */
export function overallOutcome(view: SupervisedView): SlotOutcome | "unfinished" {
  if (view.runFile.outcome === undefined) return "unfinished";
  const standings = view.tasks.map((task) => task.standing);
  if (standings.includes("escalated")) return "escalated";
  if (standings.includes("aborted")) return "aborted";
  return "closed";
}
```

(If `tseslint` strict objects to the `as Record<…>` cast in `standingCounts`, write the literal `{ closed: 0, escalated: 0, aborted: 0, unfinished: 0, queued: 0 }` typed as `Record<TaskStanding, number>` instead; it is total by type, so a new standing still fails to compile.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/supervised-view.test.ts src/cli/queue.test.ts`
Expected: PASS (queue tests prove `nextQueueTask` is unchanged by the extraction).

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/cli/queue.ts src/cli/supervised-view.ts src/cli/supervised-view.test.ts
git commit -m "Work out where each task of a run of several at once stands

delivery status needs, from records already on disk, which tasks a run
took and how each ended, and which it has yet to take; queued is worked
out by the same rule the run fills its slots by."
```

---

### Task 3: `delivery status run-…` tells a run of several at once in plain language ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts`
- Modify: `README.md` ("See what happened to a run")
- Create: `.changeset/see-a-run-of-several-at-once.md`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `readSupervisedRun`, `allRuns`, `startedAt`, `SupervisedRecord` (Task 1); `supervisedView`, `standingCounts`, `STANDINGS`, `SupervisedView`, `TaskStanding` (Task 2); `shapeOf`, `STOPPED_PART_WAY`, `queueTasks`, `queuePositionOf` (`src/cli/queue.ts`); `repoLocked` (`src/cli/repo-lock.ts`); `RunFileNotFound` (`src/errors.ts`); `BreakerState` (`src/schema.ts`).
- Produces (all in `src/cli/status-command.ts`):
  - `statusBody(record: RunRecord, ctx: CommandContext): Promise<string[]>`: `statusReport` minus its opening line(s); `statusReport` becomes opening + `statusBody`.
  - `WAITING_FOR_A_SLOT = "queued, waiting for a free slot"` (exported const).
  - `countsLine(tasks: readonly ViewTask[]): string`: non-zero standings joined, e.g. `"3 done, 1 needs your decision"`.
  - `supervisedReport(view: SupervisedView, ctx: CommandContext): Promise<string[]>`.
  - private `lookUp(repoPath, runId): Promise<RunRecord | SupervisedRecord>`, `listTasks(startDir, repoPath, ctx): Promise<TaskDef[]>`, `viewOf(record: SupervisedRecord, repoPath, startDir, ctx): Promise<SupervisedView>`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/status-command.test.ts`, extend the `./command-fixtures.js` import with `writeSupervisedRun`, and add imports: `setRunOutcome` from `../run-file.js`; `CaseFileOutcome` type is already imported, add `RunEntry, SlotOutcome` types from `../schema.js`; `STOPPED_PART_WAY` from `./queue.js`; `takeRepoLock` from `./repo-lock.js`; `WAITING_FOR_A_SLOT` from `./status-command.js`. Append:

```ts
const SUPERVISED = "run-20260930T090000Z";
const ESCALATED = { kind: "escalated", source: "worker", reason: "authority limit", at: AT } as const;
const HELLO = "add a hello";
const GREETING = "delete the greeting";
const GOODBYE = "add a goodbye";
const SHOUT = "add a shout";
const IDS = {
  hello: "add-a-hello-20260930T090000Z",
  greeting: "delete-the-greeting-20260930T090000Z",
  goodbye: "add-a-goodbye-20260930T090100Z",
  shout: "add-a-shout-20260930T090200Z",
};
const fill = (slot: number, surfaceId: string, intent: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent } });
const free = (slot: number, surfaceId: string, outcome: SlotOutcome): RunEntry => ({ t: "slot_free", slot, surfaceId, outcome });

/** A project listing four tasks, and a run of two at once that took them all: three delivered, one waiting on a decision. */
async function finishedSupervisedRun(prefix: string): Promise<string> {
  const repo = initTempRepo(prefix, {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE, SHOUT] }),
  });
  await writeRunRecord(repo, { runId: IDS.hello, task: HELLO, outcome: CLOSED });
  await writeRunRecord(repo, { runId: IDS.greeting, task: GREETING, outcome: ESCALATED, packet: ESCALATION });
  await writeRunRecord(repo, { runId: IDS.goodbye, task: GOODBYE, outcome: CLOSED });
  await writeRunRecord(repo, { runId: IDS.shout, task: SHOUT, outcome: CLOSED });
  const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 4 }, [
    fill(1, IDS.hello, HELLO),
    fill(2, IDS.greeting, GREETING),
    free(1, IDS.hello, "closed"),
    fill(1, IDS.goodbye, GOODBYE),
    free(2, IDS.greeting, "escalated"),
    fill(2, IDS.shout, SHOUT),
    free(1, IDS.goodbye, "closed"),
    free(2, IDS.shout, "closed"),
  ]);
  await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:30:00.000Z" });
  return repo;
}

/** A project listing three tasks, and a run of two at once with both slots taken and the third task still to start. */
async function busySupervisedRun(prefix: string): Promise<string> {
  const repo = initTempRepo(prefix, {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE] }),
  });
  await writeRunRecord(repo, { runId: IDS.hello, task: HELLO });
  await writeRunRecord(repo, { runId: IDS.greeting, task: GREETING });
  await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3 }, [
    fill(1, IDS.hello, HELLO),
    fill(2, IDS.greeting, GREETING),
  ]);
  return repo;
}

const taskLines = (stdout: string): string[] => stdout.split("\n").filter((line) => /^ {2}\[\d+\/\d+\] /.test(line));

describe("delivery status for a run of several tasks at once", () => {
  it("says the run, the environment and the counts, then one line per task", async () => {
    const repo = await finishedSupervisedRun("status-supervised-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").slice(0, 3)).toEqual([
      `Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once`,
      "Environment: healthy",
      "3 done, 1 needs your decision",
    ]);
    // Every task with a record names its own run id, so any one can be read in full from this list.
    expect(taskLines(stdout)).toEqual([
      `  [1/4] ${HELLO} (${IDS.hello}): done`,
      `  [2/4] ${GREETING} (${IDS.greeting}): needs your decision (see below)`,
      `  [3/4] ${GOODBYE} (${IDS.goodbye}): done`,
      `  [4/4] ${SHOUT} (${IDS.shout}): done`,
    ]);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`To read one task in full: delivery status ${IDS.greeting}`);
    expect(stdout).not.toMatch(/HEALTHY|ESCALATED|CLOSED|DRAINED|escalated|closed/);
  });

  it("follows a task that needs a decision with the account status gives of it on its own, unchanged", async () => {
    const repo = await finishedSupervisedRun("status-supervised-decision-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    const lines = stdout.split("\n");
    const own = (await statusReport(await readRun(repo, IDS.greeting), await context())).slice(1);
    const at = lines.indexOf(`  [2/4] ${GREETING} (${IDS.greeting}): needs your decision (see below)`);
    expect(at).toBeGreaterThan(-1);
    expect(own[0]).toBe(`This needs your decision: ${ESCALATION.decision}`);
    expect(lines.slice(at + 1, at + 1 + own.length)).toEqual(own);
  });

  it("shows a task waiting only because every slot is busy as queued, waiting for a free slot", async () => {
    const repo = await busySupervisedRun("status-supervised-busy-");
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(stdout).toContain("2 not finished yet, 1 queued");
    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): not finished yet`,
      `  [2/3] ${GREETING} (${IDS.greeting}): not finished yet`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
    ]);
    expect(stdout).not.toContain(STOPPED_PART_WAY);
  });

  it("says how to carry on a run that stopped part way, without claiming its queued tasks wait for a slot", async () => {
    const repo = await busySupervisedRun("status-supervised-stopped-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(stdout).toContain(STOPPED_PART_WAY);
    expect(taskLines(stdout)).toContain(`  [3/3] ${GOODBYE}: queued`);
    expect(stdout).not.toContain(WAITING_FOR_A_SLOT);
  });

  it("reads one task of the run by its own id exactly as it reads any run", async () => {
    const repo = await finishedSupervisedRun("status-supervised-task-");

    const { stdout } = await delivery(["status", IDS.hello], { cwd: repo });

    const own = await statusReport(await readRun(repo, IDS.hello), await context(), { task: 1, of: 4 });
    expect(stdout.trimEnd().split("\n")).toEqual(own);
  });

  it("gives the usual message when a run-style id names nothing", async () => {
    const repo = await finishedSupervisedRun("status-supervised-unknown-");

    const { stderr, exitCode } = await delivery(["status", "run-20200101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("    at ");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: FAIL: `WAITING_FOR_A_SLOT` is not exported; once stubbed, `status run-…` exits 2 ("I couldn't find that run's record").

- [ ] **Step 3: Implement**

In `src/cli/status-command.ts`:

1. Imports: add `RunFileNotFound` from `../errors.js`; `BreakerState, TaskDef` types from `../schema.js`; `repoLocked` from `./repo-lock.js`; `shapeOf, STOPPED_PART_WAY` to the `./queue.js` import; `readSupervisedRun, type SupervisedRecord` to the `./runs.js` import; and from `./supervised-view.js`: `STANDINGS, standingCounts, supervisedView, type SupervisedView, type TaskStanding, type ViewTask`.

2. Split `statusReport` into opening + body, behaviour unchanged:

```ts
export async function statusReport(record: RunRecord, ctx: CommandContext, position?: QueuePosition): Promise<string[]> {
  return [
    `Run ${record.runId}, started ${startedAt(record.runId)}: ${taskIntent(record.caseFile.header.taskDef)}`,
    ...(position ? [`It is task ${position.task} of ${position.of} on your list.`] : []),
    ...(await statusBody(record, ctx)),
  ];
}

/** What happened to one run, after the line naming it: the part a run of several at once repeats under a task that needs a decision. */
export async function statusBody(record: RunRecord, ctx: CommandContext): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const { outcome } = caseFile;
  if (!outcome) {
    return [
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStepPhrase(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }
  const summary = await summariseOutcome(dir, caseFile);
  const finished = [paint(ctx.colour, summary.tone, summary.headline), `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`];
  if (outcome.kind === "closed") return [...finished, ...summary.details];
  // Not summary.details: that is the live run's short form, which quotes the
  // evidence alone. Whoever reads this later gets the whole packet instead.
  const packet = outcome.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  return [...finished, ...(packet ? packetLines(packet) : []), ...(outcome.kind === "aborted" ? summary.details : []), ...whereToLook(record, ctx)];
}
```

(Move `statusReport`'s existing doc comment onto it unchanged.)

3. Words, beside `OUTCOME_WORDS`:

```ts
/** Where a task of a run of several at once stands, as a person reads it, in a count or on its own line. Total, so a new standing does not compile until it has words. */
const STANDING_WORDS: Record<TaskStanding, string> = {
  closed: "done",
  escalated: "needs your decision",
  aborted: "stopped before it finished",
  unfinished: "not finished yet",
  queued: "queued",
};

/** The environment every task of a run shares, as a person reads it. Total over the breaker's states. */
const ENVIRONMENT_WORDS: Record<BreakerState, string> = {
  HEALTHY: "healthy",
};

/** A task that would be running if a slot were free. Said only while the run is going: a stopped run's queued tasks are waiting for it to be picked up. */
export const WAITING_FOR_A_SLOT = "queued, waiting for a free slot";

/** How many tasks stand each way, in words, leaving out any standing no task has: "3 done, 1 needs your decision". */
export function countsLine(tasks: readonly ViewTask[]): string {
  const counts = standingCounts(tasks);
  return STANDINGS.filter((standing) => counts[standing] > 0)
    .map((standing) => `${counts[standing]} ${STANDING_WORDS[standing]}`)
    .join(", ");
}

/**
 * One task's line: its place in the list, what it was asked to do, its own run
 * id once it has one (so any task can be read in full with `delivery status <id>`),
 * and where it stands.
 */
function taskLine(task: ViewTask, live: boolean): string {
  const tag = task.position ? `[${task.position.task}/${task.position.of}] ` : "";
  const id = task.record ? ` (${task.record.runId})` : "";
  const standing =
    task.standing === "escalated"
      ? `${STANDING_WORDS.escalated} (see below)`
      : task.standing === "queued" && live
        ? WAITING_FOR_A_SLOT
        : STANDING_WORDS[task.standing];
  return `  ${tag}${taskIntent(task.taskDef)}${id}: ${standing}`;
}
```

4. The report:

```ts
/**
 * A run of several tasks at once, as a person reads it: which run and its
 * shape, the shared environment, the counts, then one line per task in list
 * order. A task that needs a decision is followed by exactly what `status`
 * says of it on its own, so the decision reads the same wherever it is met.
 * A run that stopped part way says how to carry it on.
 */
export async function supervisedReport(view: SupervisedView, ctx: CommandContext): Promise<string[]> {
  const { header, outcome } = view.runFile;
  const counts = countsLine(view.tasks);
  const lines = [
    `Run ${header.runId}, started ${startedAt(header.runId)}: ${shapeOf(header.tasks, header.concurrency)}`,
    `Environment: ${ENVIRONMENT_WORDS[view.breaker]}`,
    ...(counts === "" ? [] : [counts]),
    ...(outcome === undefined && !view.live ? [STOPPED_PART_WAY] : []),
    "",
  ];
  for (const task of view.tasks) {
    lines.push(taskLine(task, view.live));
    if (task.standing === "escalated" && task.record) lines.push(...(await statusBody(task.record, ctx)), "");
  }
  const readable = view.tasks.find((task) => task.standing === "escalated") ?? view.tasks.find((task) => task.record);
  if (readable?.record) {
    // Exactly one blank line before the footer, whether or not the last task carried a decision's account.
    if (lines.at(-1) !== "") lines.push("");
    lines.push(`To read one task in full: delivery status ${readable.record.runId}`);
  }
  return lines;
}
```

5. Lookup and the list, replacing `positionOf`'s config loading:

```ts
/** The project's list as written now, or none when there is no list or the file fails to load: status reads it only to annotate, never to gate. */
async function listTasks(startDir: string, repoPath: string, ctx: CommandContext): Promise<TaskDef[]> {
  try {
    return queueTasks(await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env }));
  } catch (err) {
    if (err instanceof Refusal) return [];
    throw err;
  }
}

async function positionOf(record: RunRecord, startDir: string, ctx: CommandContext): Promise<QueuePosition | undefined> {
  return queuePositionOf(await listTasks(startDir, record.repoPath, ctx), record.caseFile.header.taskDef);
}

/** A run by its id: a run of several at once if one has that id, otherwise a single run, whose absence says the usual "couldn't find" message. */
async function lookUp(repoPath: string, runId: string): Promise<RunRecord | SupervisedRecord> {
  try {
    return await readSupervisedRun(repoPath, runId);
  } catch (err) {
    if (!(err instanceof RunFileNotFound)) throw err;
  }
  return readRun(repoPath, runId);
}

/** A run of several at once, read back with every task's record and the list as written now. Live while it holds the repository. */
async function viewOf(record: SupervisedRecord, repoPath: string, startDir: string, ctx: CommandContext): Promise<SupervisedView> {
  const live = record.runFile.outcome === undefined && (await repoLocked(repoPath));
  return supervisedView(record.runFile, await allRuns(repoPath), await listTasks(startDir, repoPath, ctx), live);
}
```

(Keep `positionOf`'s existing doc comment, moving the "broken file just means no queue line" sentence onto `listTasks`.)

6. In `statusCommand`, after `if (options.all) …`:

```ts
  const record = runId === undefined ? await mostRecent(repoPath) : await lookUp(repoPath, runId);
  if ("runFile" in record) {
    for (const line of await supervisedReport(await viewOf(record, repoPath, startDir, ctx), ctx)) ctx.writeLine(line);
    return EXIT.ok;
  }
  const position = await positionOf(record, startDir, ctx);
```

(`mostRecent` still returns `RunRecord`; Task 5 widens it. `--json` for a supervised id is Task 4.)

7. README: in `README.md`, at the end of "## See what happened to a run" (before "### See every run"), add:

~~~markdown
### A run of several tasks at once

A run of several tasks at once has an id of its own, the one it opened with (`run-…`).
`delivery status run-20260930T090000Z` reads the whole run: when it started and its shape,
whether the environment the tasks share is healthy, how many tasks are done, need your
decision, stopped or are still queued, then one line per task in list order, naming the task's
own run id once it has one. A task that needs
your decision is followed by the same account `delivery status` gives of it on its own. A task
waiting only because every slot is busy shows as "queued, waiting for a free slot"; if the run
was stopped part way, it says how to carry it on.

```text
Run run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once
Environment: healthy
3 done, 1 needs your decision

  [1/4] add a hello (add-a-hello-20260930T090000Z): done
  [2/4] delete the greeting (delete-the-greeting-20260930T090000Z): needs your decision (see below)
This needs your decision: …
…
  [3/4] add a goodbye (add-a-goodbye-20260930T090100Z): done
  [4/4] add a shout (add-a-shout-20260930T090200Z): done

To read one task in full: delivery status delete-the-greeting-20260930T090000Z
```

Every task keeps its own run id, and `delivery status <task-run-id>` reads it exactly as it
reads any other run.
~~~

8. Create `.changeset/see-a-run-of-several-at-once.md`:

```markdown
---
"delivery-service": minor
---

`delivery status` reads a run of several tasks at once by the id it opened with (`run-…`): when
it started and its shape, whether the environment the tasks share is healthy, how many tasks are
done, need your decision, stopped or are queued, then one line per task in list order naming its
own run id, with the
decision a stuck task needs set out in full beneath it. A task waiting only because every slot is
busy shows as "queued, waiting for a free slot". Each task is still read on its own by its own
run id, exactly as before.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS, including every existing single-run test (the `statusBody` split is behaviour-preserving).

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/see-a-run-of-several-at-once.md
git commit -m "Tell a run of several tasks at once from delivery status

An owner who leaves several tasks running needs one place that says what
is done and what needs her; the report reuses the single-run rendering
for a task that needs a decision rather than inventing a second one."
```

---

### Task 4: `delivery status run-… --json` nests each task's existing document ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts`
- Modify: `README.md` (the new "A run of several tasks at once" subsection)
- Modify: `.changeset/see-a-run-of-several-at-once.md`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `statusDocument`, `RunStatusDocument` (existing); `SupervisedView` (Task 2); `viewOf` (Task 3); `startedInstant` (`src/cli/runs.ts`); `RunOutcome`, `BreakerState` (`src/schema.ts`).
- Produces:
  - `interface SupervisedStatusDocument { runId: string; startedAt: string | null; tasks: number; concurrency: number; live: boolean; breaker: BreakerState; outcome: RunOutcome["kind"] | null; finishedAt: string | null; surfaces: RunStatusDocument[]; queued: { task: string; queue: QueuePosition | null }[] }`
  - `supervisedDocument(view: SupervisedView, ctx: CommandContext): Promise<SupervisedStatusDocument>`

- [ ] **Step 1: Write the failing tests**

Append to the "delivery status for a run of several tasks at once" describe:

```ts
  it("gives one JSON document: the run's own fields, and each task's usual document nested as it is", async () => {
    const repo = await finishedSupervisedRun("status-supervised-json-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED, "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const document = JSON.parse(stdout);
    expect(Object.keys(document).sort()).toEqual(
      ["breaker", "concurrency", "finishedAt", "live", "outcome", "queued", "runId", "startedAt", "surfaces", "tasks"],
    );
    expect(document).toMatchObject({
      runId: SUPERVISED,
      startedAt: "2026-09-30T09:00:00Z",
      tasks: 4,
      concurrency: 2,
      live: false,
      breaker: "HEALTHY",
      outcome: "drained",
      finishedAt: "2026-09-30T09:30:00.000Z",
      queued: [],
    });
    const ctx = await context();
    const own = await Promise.all(
      [IDS.hello, IDS.greeting, IDS.goodbye, IDS.shout].map(async (id, index) =>
        statusDocument(await readRun(repo, id), ctx, { task: index + 1, of: 4 }),
      ),
    );
    expect(document.surfaces).toEqual(JSON.parse(JSON.stringify(own)));
  });

  it("says null for what a run still going has not got yet, and lists the tasks it has yet to start", async () => {
    const repo = await busySupervisedRun("status-supervised-json-busy-");

    const { stdout } = await delivery(["status", SUPERVISED, "--json"], { cwd: repo });

    const document = JSON.parse(stdout);
    expect(document).toMatchObject({ outcome: null, finishedAt: null, live: false });
    expect(document.surfaces).toHaveLength(2);
    expect(document.queued).toEqual([{ task: GOODBYE, queue: { task: 3, of: 3 } }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "JSON document|null for what"`
Expected: FAIL: `JSON.parse` throws on the plain-language lines.

- [ ] **Step 3: Implement**

In `src/cli/status-command.ts` (add `RunOutcome` to the `../schema.js` type import and `startedInstant` is already imported):

```ts
/**
 * A run of several tasks at once as one document: the run's own fields, then
 * each task it took with a record, as exactly the document `status --json`
 * gives for that task on its own, and the tasks still to start. Every key is
 * always there; null where it does not apply yet.
 */
export interface SupervisedStatusDocument {
  runId: string;
  /** ISO 8601, from the run id. */
  startedAt: string | null;
  /** How many tasks the list held when the run started. */
  tasks: number;
  concurrency: number;
  /** Whether the run is going right now. */
  live: boolean;
  breaker: BreakerState;
  outcome: RunOutcome["kind"] | null;
  finishedAt: string | null;
  surfaces: RunStatusDocument[];
  queued: { task: string; queue: QueuePosition | null }[];
}

export async function supervisedDocument(view: SupervisedView, ctx: CommandContext): Promise<SupervisedStatusDocument> {
  const { header, outcome } = view.runFile;
  return {
    runId: header.runId,
    startedAt: startedInstant(header.runId),
    tasks: header.tasks,
    concurrency: header.concurrency,
    live: view.live,
    breaker: view.breaker,
    outcome: outcome?.kind ?? null,
    finishedAt: outcome?.at ?? null,
    surfaces: await Promise.all(
      view.tasks.flatMap((task) => (task.record ? [statusDocument(task.record, ctx, task.position)] : [])),
    ),
    queued: view.tasks
      .filter((task) => task.record === undefined)
      .map((task) => ({ task: taskIntent(task.taskDef), queue: task.position ?? null })),
  };
}
```

In `statusCommand`, replace the supervised branch from Task 3 with:

```ts
  if ("runFile" in record) {
    const view = await viewOf(record, repoPath, startDir, ctx);
    if (ctx.json) ctx.writeLine(JSON.stringify(await supervisedDocument(view, ctx), null, 2));
    else for (const line of await supervisedReport(view, ctx)) ctx.writeLine(line);
    return EXIT.ok;
  }
```

README: append to the "A run of several tasks at once" subsection:

~~~markdown
`delivery status run-… --json` gives the whole run as one document, for a script or for looking
back after the fact: the run id, when it started, how many tasks and how many at once, whether it
is going now, the environment, how it ended and when, then `surfaces`, one entry per task it took,
each exactly the document `delivery status <task-run-id> --json` gives, and `queued`, the tasks
it has yet to start with their place on your list. Every key is always present, `null` where it
does not apply yet.
~~~

Changeset: append to `.changeset/see-a-run-of-several-at-once.md`:

```markdown

With `--json` it prints the whole run as one document, nesting each task's usual status document
under `surfaces` and listing the tasks still to start under `queued`; every key is always
present, `null` where it does not apply.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/see-a-run-of-several-at-once.md
git commit -m "Give a run of several at once as one JSON document

The run record is the post-mortem surface: a script, or someone looking
back, reads the whole run in one document that nests each task's
existing status document rather than a second shape of it."
```

---

### Task 5: `delivery status` with no id reports the most recently touched run of either kind ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts` (`mostRecent`)
- Modify: `README.md` ("See what happened to a run", first paragraph after the code block)
- Modify: `.changeset/see-a-run-of-several-at-once.md`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `allRuns`, `allSupervisedRuns`, `touchedAt`, `SupervisedRecord` (Task 1); `claimedBy` (Task 2).
- Produces: private `mostRecent(repoPath: string): Promise<RunRecord | SupervisedRecord>`.

- [ ] **Step 1: Write the failing tests**

`utimes` is already imported. Add a helper beside `backdate`, then append the tests to the supervised describe:

```ts
/** Make a run of several at once's record look as though it was last written long ago. */
async function backdateRun(repo: string, runId: string): Promise<void> {
  const longAgo = new Date("2026-09-14T21:04:00.000Z");
  for (const name of ["run.json", "log.jsonl"]) await utimes(join(repo, ".delivery", "supervised", runId, name), longAgo, longAgo);
}
```

```ts
  it("reports a run of several at once when it is the one touched most recently", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-");
    for (const id of Object.values(IDS)) await backdate(join(runsRoot(repo), id));

    const plain = await delivery(["status"], { cwd: repo });
    const json = await delivery(["status", "--json"], { cwd: repo });

    expect(plain.stdout.split("\n")[0]).toBe(`Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once`);
    expect(JSON.parse(json.stdout).runId).toBe(SUPERVISED);
  });

  it("reports the run, not the task, when a task of it was the last thing touched", async () => {
    const repo = await busySupervisedRun("status-supervised-last-task-");
    await backdateRun(repo, SUPERVISED);

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(`Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 3 tasks, up to 2 at once`);
  });

  it("reports a task of a finished run of several at once as that task, when it was touched after the run", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-finished-task-");
    await backdateRun(repo, SUPERVISED);
    for (const id of [IDS.greeting, IDS.goodbye, IDS.shout]) await backdate(join(runsRoot(repo), id));

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(`Run ${IDS.hello}, started 2026-09-30 09:00 UTC: ${HELLO}`);
  });

  it("reports a single run touched after the run of several at once", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-single-");
    await backdateRun(repo, SUPERVISED);
    for (const id of Object.values(IDS)) await backdate(join(runsRoot(repo), id));
    await writeRunRecord(repo, { runId: "add-a-wave-20261001T100000Z", task: "add a wave", outcome: CLOSED });

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe("Run add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave");
  });
```

(`backdate` sets only `case.json`/`log.jsonl`, which is every file a task record keeps. In the "task was last touched" test, `busySupervisedRun`'s run record is backdated, so its (not backdated) task records are the newest-touched records in the repository. In the "finished run" test, only `IDS.hello` is left un-backdated, so it is the newest task record; its run has an outcome, so it is reported as itself.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "touched most recently|last thing touched|touched after"`
Expected: FAIL: the first two report a task run (`Run add-a-…`) instead of `Run run-…`. (The finished-run and single-run tests already pass against today's `mostRecent`; they pin behaviour the new code must keep.)

- [ ] **Step 3: Implement**

Add `allSupervisedRuns, touchedAt` to the `./runs.js` import and `claimedBy` to the `./supervised-view.js` import, then replace `mostRecent`:

```ts
/**
 * The run this command means when no id was given: the one whose record was
 * written most recently, of either kind, finished or not. A task that an
 * unfinished run of several at once took counts as that run being touched, so
 * checking on a run that is going reports the run rather than whichever of its
 * tasks moved last; once that run has finished, its tasks are their own again.
 */
async function mostRecent(repoPath: string): Promise<RunRecord | SupervisedRecord> {
  const [task] = await allRuns(repoPath);
  const supervised = await allSupervisedRuns(repoPath);
  const [run] = supervised;
  if (task === undefined) {
    if (run === undefined) throw new Refusal(NOTHING_HERE, EXIT.configuration);
    return run;
  }
  if (run !== undefined && (await touchedAt(run.dir)) >= (await touchedAt(task.dir))) return run;
  const owner = supervised.find(
    (record) => record.runFile.outcome === undefined && claimedBy(record.runFile).some((claim) => claim.surfaceId === task.runId),
  );
  return owner ?? task;
}
```

README: in "## See what happened to a run", replace the sentence "It reads the run touched most recently and says what happened to it." with:

~~~markdown
It reads the run touched most recently, a single task's or a run of several at once, and says what
happened to it; while a run of several at once is going, that is the whole run rather than
whichever of its tasks moved last.
~~~

Changeset: append:

```markdown

With no run id, `delivery status` reports the run touched most recently of either kind, and a run
of several at once that is still going is reported as the whole run.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS, including the existing "reports on the run touched most recently" and "never had one" tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/see-a-run-of-several-at-once.md
git commit -m "Report the most recently touched run of either kind by default

After an overnight run of several at once, a bare delivery status should
show that run, not the last of its tasks to be written, nor miss it
because only single runs were looked at."
```

---

### Task 6: `delivery status --all` shows a run of several at once as one line ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts` (`runListing`, `listRuns`, new `ListedRun`)
- Modify: `README.md` ("### See every run")
- Modify: `.changeset/see-a-run-of-several-at-once.md`
- Test: `src/cli/status-command.test.ts` (new tests; update the existing `--all --json` expectation)

**Interfaces:**
- Consumes: `allSupervisedRuns`, `newestFirstBy`, `startedInstant` (Task 1 / existing); `claimedBy`, `overallOutcome`, `supervisedView` (Task 2); `countsLine`, `listTasks` (Task 3); `shapeOf`; `repoLocked`.
- Produces:
  - `interface ListedRun { run: string; task: string | null; startedAt: string | null; outcome: RunOutcomeName; tasks: RunSummary[] | null }`
  - `runListing(entries: (RunRecord | SupervisedView)[]): string[]` (signature widened; same output for single runs)
  - private `listRuns(repoPath: string, startDir: string, ctx: CommandContext): Promise<ExitCode>`

- [ ] **Step 1: Write the failing tests**

In the existing "lists every run as JSON, newest first, …" test, add `tasks: null` to each of the three expected objects (every key present in every entry, now that some entries are runs of several at once).

Append to the supervised describe:

```ts
  it("lists a run of several at once as one summarising line among the single runs, with its tasks folded in", async () => {
    const repo = await finishedSupervisedRun("status-supervised-all-");
    await writeRunRecord(repo, { runId: "add-a-wave-20261001T100000Z", task: "add a wave", outcome: CLOSED });

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.trimEnd().split("\n")).toEqual([
      "2 runs in this repository, newest first:",
      "  add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave (finished)",
      `  ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision)`,
      "To read one in full: delivery status <run-id>",
    ]);
  });

  it("lists a run of several at once as JSON with its tasks under it, and a null task of its own", async () => {
    const repo = await finishedSupervisedRun("status-supervised-all-json-");

    const { stdout } = await delivery(["status", "--all", "--json"], { cwd: repo });

    const summary = (run: string, task: string, outcome: string) => ({ run, task, startedAt: expect.any(String), outcome });
    expect(JSON.parse(stdout)).toEqual([
      {
        run: SUPERVISED,
        task: null,
        startedAt: "2026-09-30T09:00:00Z",
        outcome: "escalated",
        tasks: [
          summary(IDS.hello, HELLO, "closed"),
          summary(IDS.greeting, GREETING, "escalated"),
          summary(IDS.goodbye, GOODBYE, "closed"),
          summary(IDS.shout, SHOUT, "closed"),
        ],
      },
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "delivery status --all|summarising line|null task of its own"`
Expected: FAIL: the listing has four single-run lines and no `run-…` line; JSON entries lack `tasks`.

- [ ] **Step 3: Implement**

Add `allSupervisedRuns, newestFirstBy` to the `./runs.js` import and `overallOutcome` to the `./supervised-view.js` import, then:

```ts
/** One entry of `status --all --json`: a single run, or a run of several at once with its tasks under it. Every key in both, null where it does not apply. */
export interface ListedRun {
  run: string;
  /** A single run's task; null for a run of several at once, whose tasks are under `tasks`. */
  task: string | null;
  startedAt: string | null;
  outcome: RunOutcomeName;
  tasks: RunSummary[] | null;
}

const isSupervised = (entry: RunRecord | SupervisedView): entry is SupervisedView => "runFile" in entry;
const listedId = (entry: RunRecord | SupervisedView): string => (isSupervised(entry) ? entry.runFile.header.runId : entry.runId);

function listedRun(entry: RunRecord | SupervisedView): ListedRun {
  if (!isSupervised(entry)) return { ...runSummary(entry), tasks: null };
  return {
    run: listedId(entry),
    task: null,
    startedAt: startedInstant(listedId(entry)),
    outcome: overallOutcome(entry),
    tasks: entry.tasks.flatMap((task) => (task.record ? [runSummary(task.record)] : [])),
  };
}

/** Every run this repository holds, one to a line; a run of several at once is one line saying its shape and how its tasks stand. */
export function runListing(entries: (RunRecord | SupervisedView)[]): string[] {
  if (entries.length === 0) return [NOTHING_HERE];
  const line = (entry: RunRecord | SupervisedView): string => {
    if (!isSupervised(entry)) return `${describeRun(entry)} (${OUTCOME_WORDS[runSummary(entry).outcome]})`;
    const { runId, tasks, concurrency } = entry.runFile.header;
    const counts = countsLine(entry.tasks);
    return `${runId}, started ${startedAt(runId)}: ${shapeOf(tasks, concurrency)}${counts === "" ? "" : ` (${counts})`}`;
  };
  return [
    `${entries.length} run${entries.length === 1 ? "" : "s"} in this repository, newest first:`,
    ...entries.map((entry) => `  ${line(entry)}`),
    "To read one in full: delivery status <run-id>",
  ];
}

/**
 * `delivery status --all`: every run this repository holds, rather than one.
 * A run of several at once is one entry, its tasks folded into it. Listing
 * nothing is a complete answer, so an empty repository exits ok here, unlike
 * a lookup of a run that is not there, which is a failure to answer.
 */
async function listRuns(repoPath: string, startDir: string, ctx: CommandContext): Promise<ExitCode> {
  const records = await allRuns(repoPath);
  const list = await listTasks(startDir, repoPath, ctx);
  const locked = await repoLocked(repoPath);
  const views = (await allSupervisedRuns(repoPath)).map((record) =>
    supervisedView(record.runFile, records, list, record.runFile.outcome === undefined && locked),
  );
  const members = new Set(views.flatMap((view) => claimedBy(view.runFile).map((claim) => claim.surfaceId)));
  const entries = newestFirstBy<RunRecord | SupervisedView>([...records.filter((record) => !members.has(record.runId)), ...views], listedId);
  if (ctx.json) ctx.writeLine(JSON.stringify(entries.map(listedRun), null, 2));
  else for (const line of runListing(entries)) ctx.writeLine(line);
  return EXIT.ok;
}
```

Remove the now-unused `newestFirst` import if nothing else in the file uses it. Update the call in `statusCommand`: `if (options.all) return listRuns(repoPath, startDir, ctx);`.

README: in "### See every run", replace the example and its following paragraph with:

~~~markdown
```text
3 runs in this repository, newest first:
  add-a-goodbye-20261001T113000Z, started 2026-10-01 11:30 UTC: add a goodbye (hasn't finished yet)
  run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision)
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)
To read one in full: delivery status <run-id>
```

A run of several tasks at once is one line: its shape and how its tasks stand. Its tasks are read
with `delivery status run-…`, and each of those by its own run id.

`--all --json` gives the same list as an array, each entry with the run id, the task, the
instant it started, how it ended and `tasks`: `null` for a single run; for a run of several at
once, whose own `task` is `null`, the same four fields for each task it took. The list is ordered
by when each run started, so it is a history; `delivery status` with no run id reports the run you
were last working on, which is not always the newest one. A repository with no runs yet lists
nothing and exits 0.
~~~

Changeset: append:

```markdown

`delivery status --all` lists a run of several at once as one line, its shape and how its tasks
stand ("4 tasks, up to 2 at once (3 done, 1 needs your decision)"), with its tasks folded into it.
Under `--json` every entry now has a `tasks` key: `null` for a single run, and each task's summary
for a run of several at once, whose own `task` is `null`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS, including the existing `--all` tests (the updated JSON one with `tasks: null`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/see-a-run-of-several-at-once.md
git commit -m "List a run of several at once as one line in status --all

The history stays an index: a run of ten tasks is one entry saying how
its tasks stand, not ten entries that hide which run they belonged to."
```
