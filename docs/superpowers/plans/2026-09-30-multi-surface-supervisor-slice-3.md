# Multi-Surface Supervisor — Slice 3: Pick Up a Running-at-Once Run After a Crash, and Refuse a Second One

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** Running `delivery run` again after a supervised run was stopped or killed carries that same run on (same run id, same record, same shape), every in-flight task resuming from its own case file; a second `delivery run` or `delivery resume` while a supervised run is live is refused with exit 2 naming it; Ctrl-C on a supervised run exits 5.

**Architecture:** Three small additions around the existing scheduler, no new recovery mechanism. (1) A cross-process repository lock, `src/cli/repo-lock.ts`, over `proper-lockfile` on `.delivery/supervisor.lock`: a supervised run takes it for its lifetime; every `delivery run` / `delivery resume` checks it first and refuses while it is held; a stale lock (its holder killed) is taken over by `proper-lockfile`'s mtime staleness. (2) Resume from the run record's tail: `runQueue` looks for the newest supervised run record with no outcome; the one action that implies is "carry on in this record", so it reuses that run's id, folder and recorded `concurrency`, says `Picking up run …`, and lets the unchanged content-identity selection (`nextQueueTask` + `findQueueRun`) decide each slot: a delivered task is passed over, an in-flight task's own case file is resumed by the existing `resumeRun`, the rest start. `supervise()` stops creating the run file and only appends to the one it is handed. (3) Ctrl-C / SIGTERM during a supervised run ends the process at once with exit 5 and a one-line farewell, through an injectable `exitOnInterrupt` port on `CliIo`/`CommandContext` that `main.ts` wires to the real process; exiting at once leaves every record exactly as a crash does, which is the path resume already handles, and `proper-lockfile`'s own exit hook releases the lock.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`), vitest 5, `proper-lockfile` 4.1.2 (+ `@types/proper-lockfile`), the vendored `claude-mock` through the `DELIVERY_TEST_MOCK_SCRIPT` contributor seam.

## Global Constraints

- Node ≥22; `noUncheckedIndexedAccess` is on; `tseslint.configs.strict` forbids the `!` non-null operator.
- Exactly one new runtime dependency: `proper-lockfile` (`^4.1.2`), plus the dev dependency `@types/proper-lockfile`. Import it as a default import (`import lockfile from "proper-lockfile"`); it is CommonJS.
- Exit codes are unchanged in number and meaning (`src/cli/failures.ts` `EXIT`): a refused start is `EXIT.configuration` (2); an interrupted supervised run is `EXIT.aborted` (5).
- At `concurrency: 1` with no unfinished supervised run on disk, nothing a user sees or finds on disk changes: no lock taken, no signal handler installed, no run record, no tags. The existing queue and run-command tests are the proof and must pass unchanged (apart from the one `supervise()` test Task 2 updates for the moved `createRunFile`).
- Tests are offline: no network, no API key; every agent session is the vendored `claude-mock`.
- User-facing copy (messages, README, changeset): controlled British English, plain words, no em-dashes; colons, semicolons and commas instead. Internal state names never reach the human-readable path.
- **Buy-vs-build (Build note):** use `proper-lockfile` for the cross-process repository lock, for its stale-lock detection after an abrupt kill; do not write a lock by hand (no `mkdir` lock, no pid file, no own staleness check). The in-process shared-checkout lock already exists (`takeTurn` inside `git()`, slice 1) and is not touched. Resume reads the run record and takes the one action it implies; the git set-up and merge steps are already safe to repeat, and each task's own case file already resumes from its own tail, so no new recovery mechanism is added: task selection stays `nextQueueTask`/`findQueueRun`, per-task resume stays `resumeRun`.
- **Operability/DX (Operational note):** a supervised run holds the lock on the repository for its lifetime. After a hard kill, running the command again reclaims its own stale lock automatically; there is never a manual unlock step. The sequential path takes no lock but respects a live one. The lock lives at `.delivery/supervisor.lock`, inside the self-ignoring `.delivery/` folder, so `git status` never shows it.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - The lock module lives at `src/cli/repo-lock.ts`, not `src/repo-lock.ts` as the spec's table sketches: the only taker is the CLI's `runQueue`, and the `.delivery/` layout it locks inside is owned by `src/cli/run-location.ts`. The testing API's `runSupervisorAgainstMock` runs against scratch repositories and takes no lock.
  - A resumed run keeps the `concurrency` its record's immutable header says, whatever the file or flags say now, as a resumed single run keeps its header's check and closer. So `delivery run` at `concurrency: 1` after a supervised run was killed carries that run on at its own shape rather than leaving it orphaned.
  - `delivery run --task "…"` and `delivery resume` are refused while a supervised run is live, as well as both list paths: each drives git in the shared checkout and could write to a case file the live run is driving. This is the "at any concurrency" AC applied to every entry point that drives a run.
  - The refusal suggests `delivery status` (no id), which works today and, from slice 4, reports the most recently touched run of either kind. `delivery status <run-id>` for a supervised id is slice 4's to add.
  - On Ctrl-C the process exits at once rather than draining in-flight tasks: the terminal's SIGINT also reaches the agent and check subprocesses, and whatever they reported afterwards would be written into case files as though it had happened (a killed check read as a gate error). A record left exactly as a crash leaves it is the one the next run already knows how to pick up.
  - `supervise()`'s `record` becomes `{ dir }`, a record that already exists; its creator (`runQueue`) makes it with `createRunFile` for a new run and reuses it on resume. One owner for "new or carried on", rather than a flag inside the launcher.
  - `RunState` gains `"RESUMED"`, so a `--json` reader is not told a carried-on run `STARTED`.
  - `ponytail:` `proper-lockfile`'s default 10 s staleness is kept (set explicitly so `lock` and `check` agree). A run started within 10 s of a `SIGKILL` is refused as though the old one were live; after 10 s it takes the lock over. Ctrl-C, SIGTERM and closing the terminal release the lock at once (verified: `proper-lockfile`'s `signal-exit` hook runs on `process.exit`). Shorten `stale` only if the 10 s window is seen to bite.

## Scaffolding Impact

- **Inherited (Operational note):** the repository lock at `.delivery/supervisor.lock`, reclaimed when stale, never unlocked by hand → Task 1 (the lock), Task 5 (taken by a supervised run, respected by every other entry point).
- **Proactive:** `package.json` / `package-lock.json` gain `proper-lockfile` and `@types/proper-lockfile` → Task 1. `tests/packaging.ci.test.ts`'s header comment says "the package's three runtime dependencies", already stale (there are four) and now five; reword to count-free → Task 1 (tidy first).
- **Proactive (DX):** every behaviour here is verified by targeted vitest files run with `npx vitest run <file>`; the one real-signal check spawns the compiled binary, so its step builds first (`npm run build`), as `npm test` does. No new command, env var or script.
- **Reactive:** `README.md`, "Pick up a run that was interrupted", describes resuming only a single run; it gains a run of several at once being carried on (Task 4), a second run being refused and the lock clearing itself (Task 5), and Ctrl-C exiting 5 (Task 6).
- **Proactive:** `.changeset/pick-up-several-tasks-after-a-stop.md` (every user-visible change gets a changeset in this repo) → created in Task 4, extended in Tasks 5 and 6.
- `docs/project-configuration.md` ("If the run stops part way … it carries on with the task it was on, then the rest of the list"): describes the guide's one-at-a-time project and stays true; no change. `docs/multi-surface-control-flow.md` and `docs/provisioning.md` speak of "the repo lock" generically and stay true. `docs/testing-your-pipeline.md`: the testing API is unchanged. `CLAUDE.md`: none in this repo.

---

### Task 1: A repository lock that a killed run's successor takes over

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `tests/packaging.ci.test.ts:4` (comment only)
- Modify: `src/cli/run-location.ts` (add `prepareDeliveryDir`, `supervisedRoot`, `supervisorLockPath`; `prepareRunDir` and `supervisedPlace` reuse them)
- Create: `src/cli/repo-lock.ts`
- Test: `src/cli/repo-lock.test.ts`

**Interfaces:**
- Consumes: `initTempRepo(prefix, files)` from `src/temp-repo.ts`; `git(cwd, args)` from `tests/helpers.ts`.
- Produces:
  - `prepareDeliveryDir(repoPath: string): Promise<void>`: makes `.delivery/` and its `*` `.gitignore`.
  - `supervisedRoot(repoPath: string): string`: `<repo>/.delivery/supervised`.
  - `supervisorLockPath(repoPath: string): string`: `<repo>/.delivery/supervisor.lock`.
  - `takeRepoLock(repoPath: string): Promise<(() => Promise<void>) | undefined>`: the release function, or `undefined` when a live run holds the lock.
  - `repoLocked(repoPath: string): Promise<boolean>`: whether a live (not stale) run holds it.

- [ ] **Step 1: Add the dependency and tidy the stale comment**

```bash
npm install proper-lockfile@^4.1.2
npm install --save-dev @types/proper-lockfile
```

In `tests/packaging.ci.test.ts`, line 4, replace `// package's three runtime dependencies from the registry or the npm cache,` with `// package's runtime dependencies from the registry or the npm cache,`.

- [ ] **Step 2: Write the failing tests**

Create `src/cli/repo-lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { repoLocked, takeRepoLock } from "./repo-lock.js";
import { supervisorLockPath } from "./run-location.js";

const repo = (prefix: string) => initTempRepo(prefix, { "package.json": "{}" });

describe("the lock a run of several tasks at once holds on its repository", () => {
  it("is free in a repository nothing has run in", async () => {
    expect(await repoLocked(repo("repo-lock-free-"))).toBe(false);
  });

  it("is held from when it is taken until it is let go, and cannot be taken twice meanwhile", async () => {
    const path = repo("repo-lock-held-");
    const release = await takeRepoLock(path);
    expect(release).toBeTypeOf("function");
    expect(await repoLocked(path)).toBe(true);
    expect(await takeRepoLock(path)).toBeUndefined();

    await release?.();
    expect(await repoLocked(path)).toBe(false);
    const again = await takeRepoLock(path);
    expect(again).toBeTypeOf("function");
    await again?.();
  });

  it("is taken over when the run that held it was killed and stopped keeping it fresh", async () => {
    const path = repo("repo-lock-stale-");
    // What a run killed outright leaves behind: the lock, no longer touched by anyone.
    mkdirSync(join(path, ".delivery"), { recursive: true });
    mkdirSync(supervisorLockPath(path));
    const aMinuteAgo = new Date(Date.now() - 60_000);
    utimesSync(supervisorLockPath(path), aMinuteAgo, aMinuteAgo);

    expect(await repoLocked(path)).toBe(false);
    const release = await takeRepoLock(path);
    expect(release).toBeTypeOf("function");
    await release?.();
  });

  it("leaves `git status` as it was while held", async () => {
    const path = repo("repo-lock-status-");
    const release = await takeRepoLock(path);
    expect(git(path, ["status", "--porcelain"])).toBe("");
    await release?.();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/cli/repo-lock.test.ts`
Expected: FAIL, `Failed to resolve import "./repo-lock.js"`.

- [ ] **Step 4: Add the `.delivery/` helpers to `src/cli/run-location.ts`**

Replace `supervisedPlace` and `prepareRunDir` with:

```ts
/** Where the runs of several tasks at once keep their records: beside the tasks' records, so reading them never meets these. */
export function supervisedRoot(repoPath: string): string {
  return join(repoPath, ".delivery", "supervised");
}

/** Where a run of several tasks at once keeps its own record. */
export function supervisedPlace(repoPath: string, runId: string): string {
  return join(supervisedRoot(repoPath), runId);
}

/** The lock a run of several tasks at once holds on its repository for as long as it runs. Repository-wide, because it guards the repository, not one run. */
export function supervisorLockPath(repoPath: string): string {
  return join(repoPath, ".delivery", "supervisor.lock");
}

/** Make `.delivery/`, and make it ignore itself, so nothing the harness keeps there ever shows in `git status`. The repository's own `.gitignore` is never touched. */
export async function prepareDeliveryDir(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, ".delivery"), { recursive: true });
  await writeFile(join(repoPath, ".delivery", ".gitignore"), "*\n");
}

/**
 * Create the run's empty record folder inside the self-ignoring `.delivery/`,
 * so starting a run leaves `git status` exactly as it was. Fails if the folder
 * already exists, rather than write over another run's record.
 */
export async function prepareRunDir(repoPath: string, dir: string): Promise<void> {
  await prepareDeliveryDir(repoPath);
  await mkdir(dirname(dir), { recursive: true });
  await mkdir(dir);
}
```

- [ ] **Step 5: Write `src/cli/repo-lock.ts`**

```ts
import lockfile from "proper-lockfile";
import { prepareDeliveryDir, supervisorLockPath } from "./run-location.js";

/**
 * How long a lock nobody has touched is still taken to be held. `proper-lockfile`
 * touches a held lock every half of this, so only a holder that was killed lets
 * it go stale. Its own default, set here so taking and checking agree.
 * ponytail: 10 s, so a run started within 10 s of a SIGKILL is refused as though the old one were live; shorten if that bites.
 */
const STALE_MS = 10_000;

const lockOptions = (repoPath: string) => ({ lockfilePath: supervisorLockPath(repoPath), stale: STALE_MS });

/**
 * Take the repository's lock for a run of several tasks at once, so a second
 * cannot start on top of it. `proper-lockfile` rather than a lock of our own:
 * it keeps the lock fresh while its holder lives and treats a stale one as
 * free, so a run killed outright is followed by one that simply takes the lock
 * over, with no unlock step for anyone. Its exit hook lets the lock go when the
 * process ends by `process.exit` or a signal, so Ctrl-C frees it at once.
 *
 * The release function, or nothing when a live run already holds the lock.
 */
export async function takeRepoLock(repoPath: string): Promise<(() => Promise<void>) | undefined> {
  await prepareDeliveryDir(repoPath);
  try {
    return await lockfile.lock(repoPath, { ...lockOptions(repoPath), retries: 0 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOCKED") return undefined;
    throw err;
  }
}

/** Whether a live run of several tasks at once holds this repository's lock. A stale lock is not held. */
export function repoLocked(repoPath: string): Promise<boolean> {
  return lockfile.check(repoPath, lockOptions(repoPath));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/repo-lock.test.ts src/cli/run-location.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/packaging.ci.test.ts src/cli/run-location.ts src/cli/repo-lock.ts src/cli/repo-lock.test.ts
git commit -m "Add a repository lock a killed run's successor takes over

A run of several tasks at once must be the only one driving its repository,
and a run killed outright must not leave the next one locked out. proper-lockfile
gives both: a lock kept fresh while its holder lives, and a stale one treated as
free, so there is never a manual unlock step. The packaging test's comment
no longer counts the runtime dependencies, which it had already got wrong."
```

(End every commit message with the attribution line from the session's system reminder.)

---

### Task 2: The launcher carries on the record it is handed

**Files:**
- Modify: `src/supervisor.ts` (`record` becomes `{ dir }`; no `createRunFile`)
- Modify: `src/cli/queue.ts` (`runQueue` creates the run file itself)
- Test: `src/supervisor.test.ts`

**Interfaces:**
- Consumes: `createRunFile(dir, header)`, `appendRunEntry(dir, entry)`, `loadRunFile(dir)` from `src/run-file.ts`.
- Produces: `Supervision<C>.record?: { dir: string }`: a run record that already exists; `supervise` only appends `slot_fill`/`slot_free` to it and sets its `drained` outcome.

- [ ] **Step 1: Write the failing test, and update the existing record test**

In `src/supervisor.test.ts`, add `appendRunEntry, createRunFile` to the `./run-file.js` import. In the test "records which task took which slot and how each ended, then that the run drained", replace

```ts
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir, header } });
```

with

```ts
    await createRunFile(dir, header);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir } });
```

Then add, in the same `describe`:

```ts
  it("carries on a record it is handed: what it already holds is kept, and this run's slots are written after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supervise-resume-"));
    const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 1 };
    await createRunFile(dir, header);
    const before = [
      { t: "slot_fill", slot: 1, surfaceId: "earlier", taskDef: { intent: "an earlier task" } },
      { t: "slot_free", slot: 1, surfaceId: "earlier", outcome: "closed" },
    ] as const;
    for (const entry of before) await appendRunEntry(dir, entry);

    const p = pool(1);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir } });
    await vi.waitFor(() => expect(p.started).toEqual(["task-1"]));
    await p.end("task-1");
    await done;

    const runFile = await loadRunFile(dir);
    expect(runFile.header).toEqual(header);
    expect(runFile.history).toEqual([
      ...before,
      { t: "slot_fill", slot: 1, surfaceId: "task-1", taskDef: { intent: "task 1" } },
      { t: "slot_free", slot: 1, surfaceId: "task-1", outcome: "closed" },
    ]);
    expect(runFile.outcome?.kind).toBe("drained");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/supervisor.test.ts`
Expected: FAIL in both record tests: `supervise` still calls `createRunFile(record.dir, record.header)`, and with no `header` in `record` the run file's schema rejects it (a `ZodError` naming `header`). Were a header passed, it would overwrite `log.jsonl` and lose `before`.

- [ ] **Step 3: Change `supervise` in `src/supervisor.ts`**

Change the imports to:

```ts
import { appendRunEntry, setRunOutcome } from "./run-file.js";
import type { RunEntry, SlotOutcome, TaskDef } from "./schema.js";
```

Replace the `record` member of `Supervision<C>` with:

```ts
  /**
   * The run's own record, already made: a new one, or the one a stopped run
   * left, which this run carries on by writing after what it holds. None for a
   * list worked down one at a time.
   */
  record?: { dir: string };
```

Delete the line `if (record) await createRunFile(record.dir, record.header);` at the top of `supervise`.

- [ ] **Step 4: Make `runQueue` create the record in `src/cli/queue.ts`**

Add `import { createRunFile } from "../run-file.js";` and change the `RunHeader` type import to be unused-free (remove `RunHeader` from `import type { RunHeader, SlotOutcome, TaskDef } from "../schema.js";`). Replace the block

```ts
  let record: { dir: string; header: RunHeader } | undefined;
  if (runId !== undefined) {
    const dir = supervisedPlace(repoPath, runId);
    await prepareRunDir(repoPath, dir);
    record = { dir, header: { runId, repoPath, concurrency: project.concurrency, tasks: tasks.length } };
```

with

```ts
  let record: { dir: string } | undefined;
  if (runId !== undefined) {
    const dir = supervisedPlace(repoPath, runId);
    await prepareRunDir(repoPath, dir);
    await createRunFile(dir, { runId, repoPath, concurrency: project.concurrency, tasks: tasks.length });
    record = { dir };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/supervisor.test.ts && npx vitest run src/cli/run-command.test.ts -t "several tasks at once" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/supervisor.ts src/supervisor.test.ts src/cli/queue.ts
git commit -m "Let the launcher carry on the run record it is handed

A run picked up after a stop must write after what its record already holds,
not start the record afresh. Whoever starts the run now decides whether the
record is new or carried on, and the launcher only appends to it."
```

---

### Task 3: Find the run of several at once that did not finish

**Files:**
- Modify: `src/cli/runs.ts` (add `SupervisedRecord`, `unfinishedSupervisedRun`)
- Modify: `src/cli/command-fixtures.ts` (add `writeSupervisedRun`)
- Test: `src/cli/runs.test.ts`

**Interfaces:**
- Consumes: `loadRunFile(dir)` (src/run-file.ts), `RunFileNotFound` (src/errors.ts), `supervisedRoot`, `supervisedPlace`, `prepareRunDir` (src/cli/run-location.ts, Task 1), `startedInstant(runId)` (src/cli/runs.ts), `createRunFile`, `appendRunEntry`.
- Produces:
  - `interface SupervisedRecord { dir: string; runFile: RunFile }`
  - `unfinishedSupervisedRun(repoPath: string): Promise<SupervisedRecord | undefined>`: the most recently started supervised run record with no outcome.
  - Test fixture `writeSupervisedRun(repoPath: string, header: RunHeader, history?: RunEntry[]): Promise<string>`: returns the record's folder.

- [ ] **Step 1: Add the fixture to `src/cli/command-fixtures.ts`**

Add `import { appendRunEntry, createRunFile } from "../run-file.js";`, add `RunEntry, RunHeader` to the `../schema.js` type import, add `supervisedPlace` to the `./run-location.js` import, and append:

```ts
/**
 * Test support: a run of several tasks at once, as its record is on disk: the
 * header it started with and the slots it has recorded so far. No outcome, so
 * unfinished, which is what a stopped or killed run leaves behind.
 */
export async function writeSupervisedRun(repoPath: string, header: RunHeader, history: RunEntry[] = []): Promise<string> {
  const dir = supervisedPlace(repoPath, header.runId);
  await prepareRunDir(repoPath, dir);
  await createRunFile(dir, header);
  for (const entry of history) await appendRunEntry(dir, entry);
  return dir;
}
```

- [ ] **Step 2: Write the failing tests**

In `src/cli/runs.test.ts`, add `unfinishedSupervisedRun` to the `./runs.js` import, `import { setRunOutcome } from "../run-file.js";`, `import { writeSupervisedRun } from "./command-fixtures.js";`, `import { supervisedRoot } from "./run-location.js";`, and append:

```ts
describe("the run of several tasks at once that didn't finish", () => {
  const header = (repoPath: string, runId: string) => ({ runId, repoPath, concurrency: 2, tasks: 3 });

  it("is none in a repository that has never run several at once", async () => {
    expect(await unfinishedSupervisedRun(await scratchRepo())).toBeUndefined();
  });

  it("passes over one that finished", async () => {
    const repo = await scratchRepo();
    const dir = await writeSupervisedRun(repo, header(repo, "run-20260930T090000Z"));
    await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T10:00:00.000Z" });
    expect(await unfinishedSupervisedRun(repo)).toBeUndefined();
  });

  it("is the one most recently started when more than one didn't finish, with its folder and record", async () => {
    const repo = await scratchRepo();
    await writeSupervisedRun(repo, header(repo, "run-20260930T090000Z"));
    const newer = await writeSupervisedRun(repo, header(repo, "run-20260930T110000Z"), [
      { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T110000Z", taskDef: { intent: "add a page" } },
    ]);
    await writeSupervisedRun(repo, header(repo, "run-20260930T100000Z"));

    const found = await unfinishedSupervisedRun(repo);
    expect(found?.dir).toBe(newer);
    expect(found?.runFile.header.runId).toBe("run-20260930T110000Z");
    expect(found?.runFile.history).toHaveLength(1);
  });

  it("passes over a folder with no record in it, which the process died before writing", async () => {
    const repo = await scratchRepo();
    await mkdir(join(supervisedRoot(repo), "run-20260930T090000Z"), { recursive: true });
    expect(await unfinishedSupervisedRun(repo)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts`
Expected: FAIL, `unfinishedSupervisedRun is not a function` (not exported).

- [ ] **Step 4: Implement in `src/cli/runs.ts`**

Add imports: `import { loadRunFile } from "../run-file.js";`, `RunFileNotFound` beside `FileNotFound` from `../errors.js`, `type RunFile` beside `CaseFile` from `../schema.js`, and `supervisedRoot` beside `runsRoot` from `./run-location.js`. Append after `unfinishedRuns`:

```ts
/** A run of several tasks at once, read back from the repository: its folder and its record. */
export interface SupervisedRecord {
  dir: string;
  runFile: RunFile;
}

/**
 * The run of several tasks at once that didn't finish, if there is one: a
 * record with no outcome, which is what a stopped or killed run leaves. The one
 * started most recently, should there be more than one. A folder with no
 * record in it was never a run and is passed over; a record that cannot be
 * read back stops the command with the message naming its folder.
 */
export async function unfinishedSupervisedRun(repoPath: string): Promise<SupervisedRecord | undefined> {
  let entries;
  try {
    entries = await readdir(supervisedRoot(repoPath), { withFileTypes: true });
  } catch {
    return undefined; // nothing has run several at once here
  }
  const read = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<SupervisedRecord | undefined> => {
        const dir = join(supervisedRoot(repoPath), entry.name);
        try {
          return { dir, runFile: await loadRunFile(dir) };
        } catch (err) {
          if (err instanceof RunFileNotFound) return undefined;
          throw err;
        }
      }),
  );
  const startedOf = (record: SupervisedRecord): string => startedInstant(record.runFile.header.runId) ?? "";
  return read
    .filter((record): record is SupervisedRecord => record !== undefined && record.runFile.outcome === undefined)
    .toSorted((a, b) => startedOf(b).localeCompare(startedOf(a)))
    .at(0);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/runs.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/runs.ts src/cli/runs.test.ts src/cli/command-fixtures.ts
git commit -m "Find the run of several tasks at once that didn't finish

Picking a stopped run back up starts from its record: the newest one with no
outcome is the run to carry on, and a folder the process died before filling is
passed over, as it already is for a single run's record."
```

---

### Task 4: `delivery run` carries a stopped run of several at once on

**Files:**
- Modify: `src/cli/queue.ts` (`runQueue` resumes; `runPickedUp`; shared shape phrase)
- Modify: `src/cli/report.ts:28` (`RunState` gains `"RESUMED"`)
- Modify: `README.md` ("Pick up a run that was interrupted")
- Create: `.changeset/pick-up-several-tasks-after-a-stop.md`
- Test: `src/cli/queue.test.ts`, `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `unfinishedSupervisedRun`, `SupervisedRecord` (Task 3); `setRunOutcome(dir, outcome)`, `createRunFile` (src/run-file.ts); `writeSupervisedRun` (Task 3), `interruptedRun`, `writesHello`, `writeRunRecord`, `readRun` (existing fixtures and `src/cli/runs.ts`).
- Produces:
  - `runPickedUp(runId: string, tasks: number, concurrency: number): string` → `Picking up run ${runId}: ${n} task(s), up to ${c} at once`
  - `shapeOf(tasks: number, concurrency: number): string` (module-private in `queue.ts`; Task 5 uses it in the same file)
  - `RunState = "STARTED" | "RESUMED" | "DRAINED"`

- [ ] **Step 1: Write the failing unit test for the line**

In `src/cli/queue.test.ts`, add `runPickedUp` to the `./queue.js` import, and inside `describe("what a list of several at once says", …)` add:

```ts
  it("opens a run it picked up by saying so, with the run's id and shape", () => {
    expect(runPickedUp("run-20260930T090000Z", 4, 2)).toBe("Picking up run run-20260930T090000Z: 4 tasks, up to 2 at once");
    expect(runPickedUp("run-20260930T090000Z", 1, 2)).toBe("Picking up run run-20260930T090000Z: 1 task, up to 2 at once");
  });
```

- [ ] **Step 2: Write the failing command tests**

In `src/cli/run-command.test.ts`, add `interruptedRun, writesHello, writeSupervisedRun` to the `./command-fixtures.js` import, `readRun` to the `./runs.js` import, `import { setRunOutcome } from "../run-file.js";`, and `runPickedUp` to the `./queue.js` import. Inside `describe("delivery run with several tasks at once", …)`, after `fillsOf`, add:

```ts
  const SHOUT = "make a shouting function that shouts a name, with a test";
  const RUN = "run-20260930T090000Z";

  it(
    "picks a stopped run up at the shape it started with: each task carries on from its own last step, a delivered one is left alone, and the rest start once",
    async () => {
      // No concurrency in the file: the run carries on as it was started, two at once.
      const repo = listRepo("run-command-several-resume-", { tasks: [PAGE, SWAP, WAVE, SHOUT] });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const pageId = "add-a-hello-function-that-20260930T090000Z";
      await writeRunRecord(repo, { runId: pageId, task: PAGE, outcome: closed });
      const swapId = await interruptedRun(repo, state, { task: SWAP, steps: 3, worker: writesHello });
      const waveId = await interruptedRun(repo, state, { task: WAVE, steps: 1, worker: writesHello });
      const before: RunEntry[] = [
        { t: "slot_fill", slot: 1, surfaceId: pageId, taskDef: { intent: PAGE } },
        { t: "slot_fill", slot: 2, surfaceId: swapId, taskDef: { intent: SWAP } },
        { t: "slot_free", slot: 1, surfaceId: pageId, outcome: "closed" },
        { t: "slot_fill", slot: 1, surfaceId: waveId, taskDef: { intent: WAVE } },
      ];
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 4 }, before);

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toBe(runPickedUp(RUN, 4, 2));
      expect(stdout).toContain(`[2/4] Resuming run ${swapId}: ${SWAP}`);
      expect(stdout).toContain(`[3/4] Resuming run ${waveId}: ${WAVE}`);
      expect(stdout).toMatch(/^\[4\/4\] Starting run /m);
      expect(stdout).not.toContain("[1/4]");
      expect(stdout.trimEnd().split("\n").at(-1)).toBe(EVERY_TASK_DONE);

      // One record per task: nothing was started a second time.
      const ids = readdirSync(runsRoot(repo));
      expect(ids).toHaveLength(4);
      expect(ids).toEqual(expect.arrayContaining([pageId, swapId, waveId]));
      // The delivered task was not touched, and neither resumed task was begun again from its starting point.
      expect((await readRun(repo, pageId)).caseFile.outcome).toEqual(closed);
      for (const id of [swapId, waveId]) {
        const { caseFile } = await readRun(repo, id);
        expect(caseFile.outcome?.kind).toBe("closed");
        expect(caseFile.history.filter((entry) => entry.t === "baseline")).toHaveLength(1);
      }
      // The same run's record, carried on: what it held, then this invocation's slots, then its end.
      const runFile = await theRunFile(repo);
      expect(runFile.header.runId).toBe(RUN);
      expect(runFile.history.slice(0, 4)).toEqual(before);
      expect(fillsOf(runFile.history.slice(4)).map((fill) => fill.taskDef)).toEqual([{ intent: SWAP }, { intent: WAVE }, { intent: SHOUT }]);
      expect(runFile.outcome?.kind).toBe("drained");
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n")).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "under --json says the run was picked up, not started",
    async () => {
      const repo = listRepo("run-command-several-resume-json-", { tasks: [PAGE] });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1 });

      const { exitCode, stdout } = await delivery(["run", "--json"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as SurfaceStepRecord | RunEventRecord);
      expect(records[0]).toMatchObject({ scope: "run", runId: RUN, state: "RESUMED", done: false });
      expect(records.at(-1)).toMatchObject({ scope: "run", runId: RUN, state: "DRAINED", done: true });
    },
    RUN_TIMEOUT,
  );

  it("ends a stopped run whose tasks have all since been delivered, starting nothing", async () => {
    const repo = listRepo("run-command-several-resume-done-", { tasks: [PAGE], concurrency: 2 });
    await writeRunRecord(repo, { runId: "add-a-hello-function-that-20260930T090000Z", task: PAGE, outcome: closed });
    const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1 });

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.trimEnd()).toBe(EVERY_TASK_DONE);
    expect((await loadRunFile(dir)).outcome?.kind).toBe("drained");
  });

  it(
    "starts a new run, with its own id, when the last run of several at once finished",
    async () => {
      const repo = listRepo("run-command-several-after-finished-", { tasks: [PAGE], concurrency: 2 });
      const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1 });
      await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T10:00:00.000Z" });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toMatch(/^Starting run run-\d{8}T\d{6}Z: 1 task, up to 2 at once$/);
      expect(stdout).not.toContain(RUN);
      expect(readdirSync(supervisedRoot(repo))).toHaveLength(2);
    },
    RUN_TIMEOUT,
  );
```

(`closed`, `listRepo`, `supervisedRoot`, `theRunFile`, `fillsOf`, `PAGE`, `SWAP`, `WAVE` are already defined in that `describe`; `mkdtempSync`, `tmpdir`, `readdirSync`, `git`, `loadRunFile` are already imported.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts -t "several"`
Expected: FAIL. `runPickedUp` is not exported; the resume test's first line is `Starting run run-…: 4 tasks, up to 1 at once` (a new run, at the file's concurrency 1 it is not even supervised: `Task 1 of 4` lines); the `--json` test's first record is `STARTED`; the "all since delivered" test's record has no outcome.

- [ ] **Step 4: Add `"RESUMED"` in `src/cli/report.ts`**

Replace

```ts
/** What a run of several tasks at once says of itself: that it has started, and that every task it could take has ended. */
export type RunState = "STARTED" | "DRAINED";
```

with

```ts
/** What a run of several tasks at once says of itself: that it has started, or been picked up after a stop, and that every task it could take has ended. */
export type RunState = "STARTED" | "RESUMED" | "DRAINED";
```

- [ ] **Step 5: Implement the resume in `src/cli/queue.ts`**

Add `setRunOutcome` to the `../run-file.js` import (from Task 2) and `unfinishedSupervisedRun` to the `./runs.js` import. Replace `runShape` with:

```ts
/** How big a run of several at once is: how many tasks, and how many at a time. */
const shapeOf = (tasks: number, concurrency: number): string =>
  `${tasks} ${tasks === 1 ? "task" : "tasks"}, up to ${concurrency} at once`;

/** The line a run of several tasks at once opens with. */
export const runShape = (runId: string, tasks: number, concurrency: number): string => `Starting run ${runId}: ${shapeOf(tasks, concurrency)}`;

/** The line a run of several at once that was stopped opens with when it is picked up again. */
export const runPickedUp = (runId: string, tasks: number, concurrency: number): string =>
  `Picking up run ${runId}: ${shapeOf(tasks, concurrency)}`;
```

In `runQueue`, replace everything from `if ((await next([])) === undefined) {` down to and including the `supervise(...)` call with:

```ts
  // A run of several at once that was stopped is carried on, in its own record and at the shape its record
  // says it started with, whatever the setting says now. Each slot is then filled exactly as for a new run:
  // a delivered task is passed over, one that was under way is picked up from its own record, the rest start.
  const unfinished = await unfinishedSupervisedRun(repoPath);
  const concurrency = unfinished?.runFile.header.concurrency ?? project.concurrency;

  if ((await next([])) === undefined) {
    // Every task a stopped run was still to take has been delivered since, so that run is over too.
    if (unfinished) await setRunOutcome(unfinished.dir, { kind: "drained", at: new Date().toISOString() });
    ctx.report.note(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const runId = unfinished?.runFile.header.runId ?? (concurrency > 1 ? supervisedRunId(new Date()) : undefined);
```

keep the `drive` function exactly as it is, then replace the old `let record … }` block and the `supervise` call with:

```ts
  let record: { dir: string } | undefined;
  if (unfinished) {
    record = { dir: unfinished.dir };
    ctx.report.note(runPickedUp(unfinished.runFile.header.runId, tasks.length, concurrency));
    ctx.report.run({ runId: unfinished.runFile.header.runId, state: "RESUMED" });
  } else if (runId !== undefined) {
    const dir = supervisedPlace(repoPath, runId);
    await prepareRunDir(repoPath, dir);
    await createRunFile(dir, { runId, repoPath, concurrency, tasks: tasks.length });
    record = { dir };
    ctx.report.note(runShape(runId, tasks.length, concurrency));
    ctx.report.run({ runId, state: "STARTED" });
  }

  const settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });
```

Update `runQueue`'s doc comment: after the sentence ending "and the end names each task that was not delivered.", add: "A run of several at once that was stopped, by Ctrl-C, a kill or the machine going down, is carried on by the next invocation: the same run id and record, at the shape it started with, and each task it had under way picked up from its own record."

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts src/cli/report.test.ts && npx tsc --noEmit`
Expected: PASS (the existing list and concurrency-1 tests included, unchanged).

- [ ] **Step 7: Update the README and add the changeset**

In `README.md`, section "## Pick up a run that was interrupted", after the paragraph ending "it prints the list and stops.", insert:

```markdown
A run of several tasks at once is picked up the same way, with `delivery run`. It says which run
it is carrying on (`Picking up run run-20260926T090000Z: 4 tasks, up to 2 at once`), every task
that was under way carries on from its own last step, tasks already delivered are left alone,
and the rest of the list starts as slots free up. It keeps the number of tasks at once it started
with, whatever the setting says now.
```

Create `.changeset/pick-up-several-tasks-after-a-stop.md`:

```markdown
---
"delivery-service": minor
---

A run of several tasks at once that was stopped part way, by Ctrl-C, a kill or the machine going
down, is carried on by running `delivery run` again. It keeps the run's id, record and number of
tasks at once, says which run it is picking up, and carries each task that was under way on from
its own last step: a task already delivered is not redone, no working copy is set up twice and
no finished work is merged twice. Under `--json` the run's first record says `RESUMED` rather
than `STARTED`.
```

- [ ] **Step 8: Commit**

```bash
git add src/cli/queue.ts src/cli/queue.test.ts src/cli/report.ts src/cli/run-command.test.ts README.md .changeset/pick-up-several-tasks-after-a-stop.md
git commit -m "Pick a stopped run of several tasks at once back up

A laptop that sleeps or a terminal closed by mistake must not cost the owner
the work already done. The run's own record says whether it finished; if not,
the next delivery run carries it on in the same record and at the shape it
started with, and each slot is filled by the same content rule as ever, so
each task's own record decides where it resumes and nothing is done twice."
```

---

### Task 5: Refuse a second run while one of several at once is live

**Files:**
- Modify: `src/cli/queue.ts` (`liveRunFound`, `refuseIfRunGoing`; `runQueue` takes and releases the lock)
- Modify: `src/cli/run-command.ts` (`runCommand` refuses first)
- Modify: `src/cli/resume-command.ts` (`resumeCommand` refuses first)
- Modify: `README.md`, `.changeset/pick-up-several-tasks-after-a-stop.md`
- Test: `src/cli/queue.test.ts`, `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `takeRepoLock`, `repoLocked` (Task 1); `supervisorLockPath` (Task 1); `unfinishedSupervisedRun` (Task 3); `startedAt(runId)` (src/cli/runs.ts); `Refusal`, `EXIT` (src/cli/failures.ts); `RunHeader` (src/schema.ts).
- Produces:
  - `liveRunFound(live: RunHeader | undefined): string`
  - `refuseIfRunGoing(repoPath: string): Promise<void>`: throws `Refusal(liveRunFound(…), EXIT.configuration)` while the lock is held.

- [ ] **Step 1: Write the failing unit test for the message**

In `src/cli/queue.test.ts`, add `liveRunFound` to the `./queue.js` import, and add:

```ts
describe("why a second run cannot start on top of a live one", () => {
  it("names the live run, when it started and its shape, and how to look at it", () => {
    expect(liveRunFound({ runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4 })).toBe(
      "Another run is already going here (started `2026-09-30 09:00 UTC`, 4 tasks, up to 2 at once: `run-20260930T090000Z`). " +
        "Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });

  it("still says a run is going when its record cannot be found", () => {
    expect(liveRunFound(undefined)).toBe(
      "Another run is already going here. Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });
});
```

- [ ] **Step 2: Write the failing command tests**

In `src/cli/run-command.test.ts`, add `import { vi } from "vitest";` (extend the existing vitest import to `describe, expect, it, vi`), `import { mkdirSync, utimesSync } from "node:fs";` (extend the existing `node:fs` import), `import { repoLocked, takeRepoLock } from "./repo-lock.js";`, `import { supervisorLockPath } from "./run-location.js";`, and `liveRunFound` to the `./queue.js` import. Inside `describe("delivery run with several tasks at once", …)` add:

```ts
  it.each([
    ["a list of several at once", ["run"], { tasks: [PAGE, SWAP], concurrency: 2 }],
    ["a list one at a time", ["run"], { tasks: [PAGE, SWAP] }],
    ["a single task", ["run", "--task", TASK], {}],
    ["picking up a run", ["resume"], {}],
  ])("refuses %s while a run of several at once is going here, naming it, before anything starts", async (_, args, config) => {
    const repo = listRepo("run-command-live-", config);
    const header = { runId: RUN, repoPath: repo, concurrency: 2, tasks: 4 };
    const dir = await writeSupervisedRun(repo, header);
    const release = await takeRepoLock(repo);
    try {
      const { exitCode, stdout, stderr } = await delivery(args, { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.configuration);
      expect(stderr.trimEnd()).toBe(liveRunFound(header));
      expect(stdout).toBe("");
      expect(existsSync(runsRoot(repo))).toBe(false);
      expect((await loadRunFile(dir)).history).toEqual([]);
    } finally {
      await release?.();
    }
  });

  it(
    "holds the repository's lock for as long as it runs, and lets it go at the end",
    async () => {
      const repo = listRepo("run-command-lock-held-", { tasks: [PAGE, SWAP], concurrency: 2 });
      const running = delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile({ ...completes, delayMs: 1000 }) } });

      await vi.waitFor(async () => expect(await repoLocked(repo)).toBe(true), { timeout: 30_000, interval: 50 });
      expect((await running).exitCode).toBe(EXIT.ok);
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "takes over the lock a killed run left behind and carries that run on, with nothing to unlock by hand",
    async () => {
      const repo = listRepo("run-command-lock-stale-", { tasks: [PAGE], concurrency: 2 });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1 });
      // A run killed outright leaves its lock behind, no longer kept fresh by anyone.
      mkdirSync(supervisorLockPath(repo));
      const aMinuteAgo = new Date(Date.now() - 60_000);
      utimesSync(supervisorLockPath(repo), aMinuteAgo, aMinuteAgo);

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toBe(runPickedUp(RUN, 1, 2));
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT,
  );
```

(`TASK` and `existsSync` are already imported in this file.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts -t "live|lock|second run"`
Expected: FAIL. `liveRunFound` is not exported; every `it.each` case gets past the held lock (the list cases start or resume tasks; `resume` says there is nothing to pick up); the lock is never observed held during a run.

- [ ] **Step 4: Implement in `src/cli/queue.ts`**

Add imports: `import { Refusal } from "./failures.js";` (extend the existing `EXIT, type ExitCode` import), `import { repoLocked, takeRepoLock } from "./repo-lock.js";`, `startedAt` in the `./runs.js` import, and `RunHeader` back in the `../schema.js` type import. Add below `runPickedUp`:

```ts
/**
 * Why a run cannot start: a run of several at once is already going in this
 * repository, and which one, so the owner can look at it rather than start a
 * second that would fight it over the same checkout. `live` is that run's
 * header, when its record can be found.
 */
export function liveRunFound(live: RunHeader | undefined): string {
  const which = live === undefined ? "" : ` (started \`${startedAt(live.runId)}\`, ${shapeOf(live.tasks, live.concurrency)}: \`${live.runId}\`)`;
  return `Another run is already going here${which}. Run \`delivery status\` to see how it is getting on, or wait for it to finish before starting another.`;
}

/** Refuse to go on while a run of several at once holds this repository. Every command that drives a run asks this first. */
export async function refuseIfRunGoing(repoPath: string): Promise<void> {
  if (await repoLocked(repoPath)) {
    throw new Refusal(liveRunFound((await unfinishedSupervisedRun(repoPath))?.runFile.header), EXIT.configuration);
  }
}
```

In `runQueue`, directly after `const concurrency = …;`, take the lock and wrap the rest of the function body (from `if ((await next([])) === undefined) {` to the final `return exitCode;`) in `try { … } finally { await release?.(); }`:

```ts
  // A run of several at once holds the repository for as long as it runs, so a second cannot start on top of it.
  // One at a time takes no lock: every command has already refused to start while one is held.
  let release: (() => Promise<void>) | undefined;
  if (concurrency > 1) {
    release = await takeRepoLock(repoPath);
    if (release === undefined) throw new Refusal(liveRunFound(unfinished?.runFile.header), EXIT.configuration);
  }
  try {
    if ((await next([])) === undefined) {
      // Every task a stopped run was still to take has been delivered since, so that run is over too.
      if (unfinished) await setRunOutcome(unfinished.dir, { kind: "drained", at: new Date().toISOString() });
      ctx.report.note(EVERY_TASK_DONE);
      return EXIT.ok;
    }

    const runId = unfinished?.runFile.header.runId ?? (concurrency > 1 ? supervisedRunId(new Date()) : undefined);

    const drive = async ({ taskDef, surfaceId, position, existing }: QueueClaim): Promise<SlotOutcome> => {
      // … the `drive` body exactly as it stands after Task 4, not changed here …
    };

    let record: { dir: string } | undefined;
    if (unfinished) {
      record = { dir: unfinished.dir };
      ctx.report.note(runPickedUp(unfinished.runFile.header.runId, tasks.length, concurrency));
      ctx.report.run({ runId: unfinished.runFile.header.runId, state: "RESUMED" });
    } else if (runId !== undefined) {
      const dir = supervisedPlace(repoPath, runId);
      await prepareRunDir(repoPath, dir);
      await createRunFile(dir, { runId, repoPath, concurrency, tasks: tasks.length });
      record = { dir };
      ctx.report.note(runShape(runId, tasks.length, concurrency));
      ctx.report.run({ runId, state: "STARTED" });
    }

    const settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });

    if (runId !== undefined) ctx.report.run({ runId, state: "DRAINED" });
    const exitCode = listExitCode(settled.map(({ outcome }) => outcome));
    if (exitCode === EXIT.ok) {
      ctx.report.note(EVERY_TASK_DONE);
    } else if (runId !== undefined) {
      for (const { claim, outcome } of settled.toSorted((a, b) => a.claim.position.task - b.claim.position.task)) {
        if (outcome !== "closed") ctx.report.note(taskEnded(claim.position, outcome));
      }
    }
    return exitCode;
  } finally {
    await release?.();
  }
}
```

The only change to what sits inside `try` is indentation: the body is Task 4's, from the "nothing left" check to `return exitCode;`, with `drive` kept verbatim (it is elided above only because it is untouched). The lock is taken before the "nothing left" check because that check may write the stopped run's outcome, which must not happen under a live run's feet.

- [ ] **Step 5: Refuse first in both commands**

In `src/cli/run-command.ts`, import `refuseIfRunGoing` beside `queueTasks, runQueue` from `./queue.js`, and in `runCommand` insert directly after `const repoPath = await findRepository(startDir);`:

```ts
  // Whatever this run would be, it would drive git in the checkout a live run of several at once is using.
  await refuseIfRunGoing(repoPath);
```

In `src/cli/resume-command.ts`, add `import { refuseIfRunGoing } from "./queue.js";` and in `resumeCommand` insert directly after `const repoPath = …;`:

```ts
  // The run to pick up may be one a live run of several at once is driving right now.
  await refuseIfRunGoing(repoPath);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts src/cli/resume-command.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS.

- [ ] **Step 7: Update the README and the changeset**

In `README.md`, after the paragraph Task 4 added, insert:

```markdown
While a run of several tasks at once is going, a second `delivery run` or `delivery resume` in the
same repository is refused straight away with exit code 2, naming the run that is going and
suggesting `delivery status` to see how it is getting on. The run holds a lock on the repository
for as long as it runs; if the command is killed or the machine goes down, the next `delivery run`
takes the lock over by itself, so there is never anything to unlock by hand.
```

Append to `.changeset/pick-up-several-tasks-after-a-stop.md`:

```markdown

While a run of several at once is going, starting another `delivery run` or `delivery resume` in
the same repository, at any concurrency, is refused before anything starts, with exit code 2 and
a message naming the live run, when it started, its shape and how to look at it. The run holds a
lock on the repository under `.delivery/`; a lock left by a killed run is taken over by the next
run, with no unlock step.
```

- [ ] **Step 8: Commit**

```bash
git add src/cli/queue.ts src/cli/queue.test.ts src/cli/run-command.ts src/cli/resume-command.ts src/cli/run-command.test.ts README.md .changeset/pick-up-several-tasks-after-a-stop.md
git commit -m "Refuse a second run while one of several at once is going

Two runs driving one checkout would fight over its git metadata and could write
to the same task's record. A run of several at once now holds the repository's
lock while it runs, and every command that drives a run refuses up front while
it is held, naming the live run and how to look at it."
```

---

### Task 6: Ctrl-C stops a run of several at once with the "stopped before it could finish" code

**Files:**
- Modify: `src/cli/context.ts` (`CommandContext.exitOnInterrupt?`)
- Modify: `src/cli/program.ts` (`CliIo.exitOnInterrupt?`, passed through in `contextFor`)
- Modify: `src/cli/main.ts` (the real process wiring)
- Modify: `src/cli/queue.ts` (`STOPPED_PART_WAY`; `runQueue` arms around `supervise`)
- Modify: `src/cli/command-fixtures.ts` (`DeliveryIo.exitOnInterrupt?`)
- Modify: `README.md`, `.changeset/pick-up-several-tasks-after-a-stop.md`
- Test: `src/cli/run-command.test.ts`, `tests/delivery-command.test.ts`

**Interfaces:**
- Consumes: `EXIT.aborted` (src/cli/failures.ts); `repoLocked` (Task 1); `supervisedRoot` (Task 1); `loadRunFile`.
- Produces:
  - `type ExitOnInterrupt = (exitCode: number, farewell: string) => () => void` (exported from `src/cli/context.ts`): from the call until the returned function is called, Ctrl-C or SIGTERM writes `farewell` to standard error and ends the process at once with `exitCode`.
  - `CliIo.exitOnInterrupt?: ExitOnInterrupt`, `CommandContext.exitOnInterrupt?: ExitOnInterrupt`. Absent: nothing listens, and a stop ends the process as the platform does (today's behaviour).
  - `STOPPED_PART_WAY: string` (exported from `src/cli/queue.ts`).

- [ ] **Step 1: Write the failing in-process tests**

In `src/cli/command-fixtures.ts`, add `import type { ExitOnInterrupt } from "./context.js";`, add to `DeliveryIo`:

```ts
  /** What a stop (Ctrl-C) does, as `main.ts` wires it for the real process. Absent: nothing listens, as in every test that does not ask. */
  exitOnInterrupt?: ExitOnInterrupt;
```

and in `delivery`, destructure `exitOnInterrupt` from the options and pass `exitOnInterrupt` in the `runCli({ … })` object.

In `src/cli/run-command.test.ts`, add `STOPPED_PART_WAY` to the `./queue.js` import and, inside `describe("delivery run with several tasks at once", …)`, add:

```ts
  /** Records what the command arranged a stop to do, and whether it took that back by the end. */
  function stopRecorder() {
    const armed: { exitCode: number; farewell: string; disarmed: boolean }[] = [];
    const exitOnInterrupt = (exitCode: number, farewell: string) => {
      const arm = { exitCode, farewell, disarmed: false };
      armed.push(arm);
      return () => {
        arm.disarmed = true;
      };
    };
    return { armed, exitOnInterrupt };
  }

  it(
    "while it runs, has a stop end it at once with the stopped code and a line on how to carry on",
    async () => {
      const repo = listRepo("run-command-several-stop-", { tasks: [PAGE, SWAP], concurrency: 2 });
      const { armed, exitOnInterrupt } = stopRecorder();

      const { exitCode } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) }, exitOnInterrupt });

      expect(exitCode).toBe(EXIT.ok);
      expect(armed).toEqual([{ exitCode: EXIT.aborted, farewell: STOPPED_PART_WAY, disarmed: true }]);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "one at a time, leaves a stop to end the command as it always has",
    async () => {
      const repo = listRepo("run-command-single-stop-", { tasks: [PAGE] });
      const { armed, exitOnInterrupt } = stopRecorder();

      await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) }, exitOnInterrupt });

      expect(armed).toEqual([]);
    },
    RUN_TIMEOUT,
  );
```

- [ ] **Step 2: Write the failing real-signal test**

In `tests/delivery-command.test.ts`, extend imports: `import { spawn } from "node:child_process";`, `readdirSync` into the `node:fs` import, `vi` into the vitest import, `import { loadRunFile } from "../src/run-file.js";`, `import { repoLocked } from "../src/cli/repo-lock.js";`, `import { supervisedRoot } from "../src/cli/run-location.js";`, `import { STOPPED_PART_WAY } from "../src/cli/queue.js";`. Add inside the `describe`:

```ts
  it("stops a run of several at once on Ctrl-C with the stopped code, saying how to carry on, and lets the repository's lock go", async () => {
    const repo = initTempRepo("delivery-command-interrupt-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }),
      "delivery.config.json": JSON.stringify({ tasks: ["add a hello function", "add a goodbye function"], concurrency: 2 }),
    });
    const script = join(mkdtempSync(join(tmpdir(), "delivery-command-script-")), "mock.json");
    // Agents slow enough that both tasks are still going when the stop comes.
    await writeMockScript(script, { expectations: [{ json: { status: "completed", rationale: "done" } }], delayMs: 30_000 });

    // Its own process group, so the stop reaches the command and everything it started, as Ctrl-C in a terminal does.
    const child = spawn(process.execPath, [DELIVERY_BIN, "run"], {
      cwd: repo,
      env: { ...process.env, [TEST_MOCK_SCRIPT]: script, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "delivery-command-state-")) },
      detached: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

    await vi.waitFor(
      async () => {
        const [runId] = readdirSync(supervisedRoot(repo));
        if (runId === undefined) throw new Error("no run of several tasks yet");
        const { history } = await loadRunFile(join(supervisedRoot(repo), runId));
        expect(history.filter((entry) => entry.t === "slot_fill")).toHaveLength(2);
      },
      { timeout: 30_000, interval: 100 },
    );
    if (child.pid === undefined) throw new Error("the command did not start");
    process.kill(-child.pid, "SIGINT");

    expect(await exited).toBe(EXIT.aborted);
    expect(stderr).toContain(STOPPED_PART_WAY);
    expect(await repoLocked(repo)).toBe(false);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run build && npx vitest run src/cli/run-command.test.ts -t "stop" && npx vitest run tests/delivery-command.test.ts -t "Ctrl-C"`
Expected: FAIL. `STOPPED_PART_WAY` is not exported and `exitOnInterrupt` is not a `DeliveryIo`/`CliIo` member (type errors under `tsc`; at runtime `armed` stays `[]`); the spawned command dies of SIGINT with exit code `null` instead of 5.

- [ ] **Step 4: Add the port to the context and the CLI's I/O**

In `src/cli/context.ts`, add:

```ts
/**
 * From when it is called until the function it returns is, have Ctrl-C, or the
 * process being told to stop, say `farewell` on standard error and end the
 * process at once with `exitCode`.
 */
export type ExitOnInterrupt = (exitCode: number, farewell: string) => () => void;
```

and to `CommandContext`:

```ts
  /** How a stop ends this command, when the process it runs in lets it choose. Absent: a stop ends it as the platform does. */
  exitOnInterrupt?: ExitOnInterrupt;
```

In `src/cli/program.ts`, import `ExitOnInterrupt` beside `CommandContext, CliStdin` from `./context.js`, add to `CliIo`:

```ts
  /** How a stop may end a command; `main.ts` passes the real process's. Absent: nothing listens, and a stop ends the process as the platform does. */
  exitOnInterrupt?: ExitOnInterrupt;
```

and in `contextFor`'s returned object add `exitOnInterrupt: io.exitOnInterrupt,`.

- [ ] **Step 5: Wire the real process in `src/cli/main.ts`**

```ts
#!/usr/bin/env node
import { runCli } from "./program.js";

/** What ends a command part way: Ctrl-C in a terminal, and the polite request to stop a supervisor or `kill` sends. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exitOnInterrupt: (exitCode, farewell) => {
    const stop = (): void => {
      process.stderr.write(`${farewell}\n`);
      process.exit(exitCode);
    };
    for (const signal of STOP_SIGNALS) process.on(signal, stop);
    return () => {
      for (const signal of STOP_SIGNALS) process.off(signal, stop);
    };
  },
});
```

- [ ] **Step 6: Arm it around the supervised run in `src/cli/queue.ts`**

Add below `EVERY_TASK_DONE`:

```ts
export const STOPPED_PART_WAY =
  "Stopped before every task finished. Type `delivery run` again in this folder to carry on from where each task got to.";
```

Change the supervisor import to `import { supervise, type Settled } from "../supervisor.js";`. In `runQueue`, replace

```ts
    const settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });
```

with

```ts
    // Several at once, a stop ends the command at once with the stopped code. At once, because Ctrl-C reaches the
    // agents and checks too, and what they said on the way down would be written into the tasks' records as though
    // it had happened; a record left as a crash leaves it is one the next run already knows how to pick up. The
    // lock goes with the process. One at a time, a stop ends the command as it always has.
    const disarm = runId === undefined ? undefined : ctx.exitOnInterrupt?.(EXIT.aborted, STOPPED_PART_WAY);
    let settled: Settled<QueueClaim>[];
    try {
      settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });
    } finally {
      disarm?.();
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run build && npx vitest run src/cli/run-command.test.ts -t "stop" && npx vitest run tests/delivery-command.test.ts && npx tsc --noEmit && npx eslint src/cli tests/delivery-command.test.ts`
Expected: PASS.

- [ ] **Step 8: Update the README and the changeset**

In `README.md`, append to the paragraph Task 4 added (after "whatever the setting says now."): ` Pressing Ctrl-C stops a run of several at once straight away with exit code 5, saying how to carry on.`

Append to `.changeset/pick-up-several-tasks-after-a-stop.md`:

```markdown

Pressing Ctrl-C, or sending the process SIGTERM, stops a run of several at once straight away
with exit code 5 ("stopped before it could finish"), saying how to carry on, and lets the
repository's lock go. A run of one task at a time stops on Ctrl-C as it always has.
```

- [ ] **Step 9: Commit**

```bash
git add src/cli/context.ts src/cli/program.ts src/cli/main.ts src/cli/queue.ts src/cli/command-fixtures.ts src/cli/run-command.test.ts tests/delivery-command.test.ts README.md .changeset/pick-up-several-tasks-after-a-stop.md
git commit -m "Stop a run of several at once on Ctrl-C with the stopped code

An interrupted run is resumable, and its exit code should say so rather than
the shell's 130. The command ends at once rather than letting the tasks' agents
and checks report on their own interruption, so every record is left exactly as
a crash leaves it, which the next run already knows how to pick up."
```
