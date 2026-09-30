# Multi-Surface Supervisor — Slice 1: Run Several Tasks From Your List at Once

> **Status:** ✅ Complete — 2026-09-30 — `8d4143c`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** A project owner sets `concurrency`, and one `delivery run` works through the task list with that many tasks going at once, each on its own copy, every line tagged with the task it is about.

**Architecture:** One scheduler. `runQueue` (src/cli/queue.ts) becomes a thin wiring of a small purpose-built slot launcher (`supervise`, src/supervisor.ts) that knows nothing about the CLI: it is given `next(claimed)` (task selection by content identity, recomputed afresh at every fill) and `drive(claim)` (start, resume or retell one task's run). At `concurrency: 1` it waits on a setback exactly as Item 9's loop did, writes no run record and tags no line; above 1 it keeps a run file under `.delivery/supervised/<runId>/` (built on a journal primitive extracted from `case-file.ts`) and tags every line `[n/M]`. Git calls take turns per folder inside `git()` itself (a promise chain keyed on the call's `cwd`), so every call against the shared checkout is serialised by where it runs, with no change to `surface.ts`, the closers or `provisionWorktree`.

**Tech Stack:** TypeScript (Node ≥22, ES2024), zod 4, commander 14, vitest 5, the vendored `claude-mock` via `DELIVERY_TEST_MOCK_SCRIPT`.

## Global Constraints

- Node ≥22; `Promise.withResolvers` and `Array.prototype.toSorted` are available (tsconfig target ES2024). `noUncheckedIndexedAccess` is on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new runtime dependency in this slice (`proper-lockfile` arrives with the cross-process lock in slice 3).
- Precedence for every setting: flag > environment variable > config file > built-in default. An environment variable set to the empty string is not set (`fromEnv`).
- `concurrency` is a whole number ≥ 1, default `1`.
- Exit codes unchanged: 0 every task delivered, 4 any task needs a decision, 5 a task stopped (and none needs a decision), 2 configuration, 1 unexpected, 3 agent runtime.
- User-facing copy: controlled British English, plain words, no internal state names on the human path, no em-dashes in README, changeset or terminal copy (colons, semicolons, commas instead). Tags are text (`[2/10]`), never colour alone. Output is append-only.
- **Buy-vs-build (Build note):** the slot pool is a small purpose-built launcher, not `p-limit`/`p-queue`; the in-process git lock is a plain promise chain, not `async-mutex`, keyed on where the call runs, not a list of commands; task selection stays content identity (`findQueueRun`/`isClosed`) extended to skip claimed tasks, with no stored list position; `surface.ts` is not changed; the run file reuses the case file's crash-safe write-and-append discipline through one extracted `src/journal.ts`, never a copy.
- **Operability/DX (Operational note):** at `concurrency: 1` (the default) nothing a user sees or finds on disk changes: no run record, no lock, no tagged lines, and Item 9's queue tests (`src/cli/queue.test.ts`, the "delivery run with a list of tasks" block of `src/cli/run-command.test.ts`, `tests/project-configuration/2-…`) pass unchanged against the one scheduler. A run above 1 gets its own `run-<UTC second>` id and a run record beside, not inside, `.delivery/runs/`.
- Tests are offline: the agent is the vendored scripted mock; each mocked session re-reads the whole script, so one catch-all expectation serves every task.

## Scaffolding Impact

- **Reactive:** `README.md` settings table and flags table gain `concurrency` / `--concurrency` / `DELIVERY_CONCURRENCY` → Task 4.
- **Reactive:** `README.md` "Work through a list of tasks" says the list runs "one task at a time" and describes `--json` step objects; both gain the several-at-once behaviour and the `scope` records → Task 8.
- **Reactive:** `docs/provisioning.md` "Supervisor tie-in" and `docs/multi-surface-control-flow.md` describe a `queue_cursor` list position that the design rejected; replaced with content-identity selection and the per-folder git turn → Task 8.
- **Reactive:** `docs/writing-a-closer.md` gains the lock boundary the design requires (§8): built-in closers' git calls in the shared checkout take turns; a custom closer's own git child processes do not → Task 8.
- **Proactive:** a `.changeset/run-several-tasks-at-once.md` entry (the repo records every user-visible change as a changeset) → Task 8.
- **Proactive (DX):** the new behaviour is verified offline through the existing `delivery()` in-process fixture and `DELIVERY_TEST_MOCK_SCRIPT`; no new harness. The run record is plain JSON on disk (`.delivery/supervised/<runId>/run.json` + `log.jsonl`), inspectable by hand until `delivery status` learns it in slice 4 → Tasks 2 and 8.
- **Inherited:** the Operational note's "nothing changes at 1" is landed and proven in Task 8 (Item 9's tests run unchanged plus a new "no record, no tags at 1" test).
- `CLAUDE.md`/`CONTRIBUTING.md`: none; no new command, script or test seam.

---

### Task 1: Extract the journal primitive from the case file ✅ DONE (deliver-slice)

Behaviour-preserving refactor (tidy first): the run file in Task 2 must reuse the case file's crash-safe writes and truncated-tail-tolerant read, so they move into one shared module.

**Files:**
- Create: `src/journal.ts`
- Create: `src/journal.test.ts`
- Modify: `src/case-file.ts` (lines 1-34 helpers, `appendEntry`, `load`)

**Interfaces:**
- Produces:
  - `writeAndSync(filePath: string, flag: "w" | "a", data: string): Promise<void>`
  - `atomicWriteJson(filePath: string, data: unknown): Promise<void>`
  - `appendLine(filePath: string, value: unknown): Promise<void>`
  - `parseLines<T>(raw: string, parse: (value: unknown) => T): T[]`
  - `class MalformedLine extends Error { readonly line: number }` with message `Malformed log entry at line ${line}: ${String(cause)}`
  - `isEnoent(err: unknown): boolean`

- [ ] **Step 1: Write the failing test** — `src/journal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine, atomicWriteJson, MalformedLine, parseLines } from "./journal.js";

const scratch = () => mkdtempSync(join(tmpdir(), "journal-"));
const asNumber = (value: unknown): number => {
  if (typeof value !== "number") throw new Error(`not a number: ${JSON.stringify(value)}`);
  return value;
};

describe("reading a journal back", () => {
  it("is empty for a journal nothing was appended to", () => {
    expect(parseLines("", asNumber)).toEqual([]);
  });

  it("gives every line back, oldest first", () => {
    expect(parseLines("1\n2\n3\n", asNumber)).toEqual([1, 2, 3]);
  });

  it("drops a final line cut short by a crash mid-append", () => {
    expect(parseLines('1\n2\n{"t":', asNumber)).toEqual([1, 2]);
  });

  it("drops a final line that parses but is not an entry, as a torn write can leave", () => {
    expect(parseLines('1\n"x"', asNumber)).toEqual([1]);
  });

  it("refuses a bad line anywhere but the end, naming the line", () => {
    expect(() => parseLines('1\n{"t":\n3\n', asNumber)).toThrow(MalformedLine);
    expect(() => parseLines('1\n{"t":\n3\n', asNumber)).toThrow(/^Malformed log entry at line 2: /);
  });
});

describe("writing a journal", () => {
  it("appends one JSON line per value", async () => {
    const file = join(scratch(), "log.jsonl");
    await appendLine(file, { t: "a" });
    await appendLine(file, { t: "b" });
    expect(readFileSync(file, "utf-8")).toBe('{"t":"a"}\n{"t":"b"}\n');
  });

  it("replaces a JSON file whole, leaving no temporary file behind", async () => {
    const dir = scratch();
    await atomicWriteJson(join(dir, "run.json"), { a: 1 });
    await atomicWriteJson(join(dir, "run.json"), { a: 2 });
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf-8"))).toEqual({ a: 2 });
    expect(readdirSync(dir)).toEqual(["run.json"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/journal.test.ts`
Expected: FAIL, cannot resolve `./journal.js`.

- [ ] **Step 3: Write `src/journal.ts`**

```ts
import { open, rename } from "node:fs/promises";

/**
 * The crash-safe write-and-append discipline every record the harness keeps
 * shares: a JSON file is only ever replaced whole, through a temporary file and
 * a rename, and a journal is only ever appended to, one JSON value per line,
 * synced before the call returns. The case file and the supervised run file
 * both build on this, so the two can never drift apart.
 */
export async function writeAndSync(filePath: string, flag: "w" | "a", data: string): Promise<void> {
  const fd = await open(filePath, flag);
  try {
    await fd.write(data);
    await fd.datasync();
  } finally {
    await fd.close();
  }
}

/** Replace a JSON file whole: a reader sees the old contents or the new, never half of either. */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + ".tmp";
  await writeAndSync(tmp, "w", JSON.stringify(data, null, 2));
  await rename(tmp, filePath);
}

/** Append one value to a journal as its own line. */
export async function appendLine(filePath: string, value: unknown): Promise<void> {
  await writeAndSync(filePath, "a", JSON.stringify(value) + "\n");
}

export function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

/** A journal line that cannot be read and is not the last one, so it is not a torn append: the journal itself is damaged. */
export class MalformedLine extends Error {
  constructor(
    readonly line: number,
    cause: unknown,
  ) {
    super(`Malformed log entry at line ${line}: ${String(cause)}`);
    this.name = "MalformedLine";
  }
}

/**
 * A journal's entries, oldest first. The final line alone may be cut short by
 * a crash mid-append, so one that will not parse is dropped; a bad line
 * anywhere else throws `MalformedLine`, for the owner to name in its own error.
 */
export function parseLines<T>(raw: string, parse: (value: unknown) => T): T[] {
  if (raw.trim().length === 0) return [];
  const lines = raw.trimEnd().split("\n");
  const entries: T[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(parse(JSON.parse(line)));
    } catch (err) {
      if (index === lines.length - 1) break;
      throw new MalformedLine(index + 1, err);
    }
  }
  return entries;
}
```

- [ ] **Step 4: Point `src/case-file.ts` at it**

Replace the imports and the three local helpers at the top of the file:

```ts
import { open, rename, readFile, mkdir } from "node:fs/promises";
```

becomes (`open` and `rename` go; `readFile` and `mkdir` stay; one journal import is added):

```ts
import { readFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { CaseJson, CaseFile, BudgetSet, BudgetPopulation, HistoryEntry, CreateHeader, CaseFileCursor, SurfaceState, GateReport, CaseFileOutcome } from "./schema.js";
import { FileNotFound, CorruptCaseFile, WriteFailure, ImmutabilityViolation } from "./errors.js";
import { appendLine, atomicWriteJson, isEnoent, MalformedLine, parseLines, writeAndSync } from "./journal.js";
import type { TriageInput } from "./ports.js";
```

Delete the local `writeAndSync`, `atomicWriteJson` and `isEnoent` functions. In `appendEntry`, replace the body's write:

```ts
  try {
    await appendLine(join(dir, "log.jsonl"), entry);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
```

(delete the now-unused `const logPath`). In `load`, replace the whole "Parse history entries" block (from `const history: HistoryEntry[] = [];` to the end of its `if`) with:

```ts
  // Parse history entries: a torn final line is dropped by the journal itself.
  let history: HistoryEntry[];
  try {
    history = parseLines(logRaw, (value) => HistoryEntry.parse(value));
  } catch (err) {
    if (err instanceof MalformedLine) throw new CorruptCaseFile(dir, err.message);
    throw err;
  }
```

- [ ] **Step 5: Run the journal and case-file tests**

Run: `npx vitest run src/journal.test.ts src/case-file.test.ts tests/case-file-persistence && npx tsc --noEmit && npx eslint src/journal.ts src/journal.test.ts src/case-file.ts`
Expected: PASS; `case-file.test.ts` unchanged and green is the proof the extraction preserved behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/journal.ts src/journal.test.ts src/case-file.ts
git commit -m "Extract the case file's crash-safe journal into src/journal.ts

The supervised run file needs exactly the case file's write-and-append
discipline: whole-file replacement by rename, synced appends, and a read
that drops a torn final line. One shared module keeps the two records from
drifting apart; case-file.ts behaviour is unchanged and its tests prove it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A run file for a run of several tasks at once ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (append after `CaseFile`)
- Create: `src/run-file.ts`
- Create: `src/run-file.test.ts`

**Interfaces:**
- Consumes: Task 1's `appendLine`, `atomicWriteJson`, `isEnoent`, `MalformedLine`, `parseLines`, `writeAndSync`.
- Produces (schema.ts): `SlotOutcome` (`"closed" | "escalated" | "aborted"`), `RunHeader` `{ runId: string; repoPath: string; concurrency: number; tasks: number }`, `RunEntry` (`{ t: "slot_fill"; slot: number; surfaceId: string; taskDef: TaskDef } | { t: "slot_free"; slot: number; surfaceId: string; outcome: SlotOutcome }`), `RunOutcome` `{ kind: "drained"; at: string }`, `RunJson`, `RunFile` `{ header; history: RunEntry[]; outcome?: RunOutcome }` — each a zod schema plus same-named type.
- Produces (run-file.ts): `createRunFile(dir: string, header: RunHeader): Promise<void>`, `appendRunEntry(dir: string, entry: RunEntry): Promise<void>`, `loadRunFile(dir: string): Promise<RunFile>`, `setRunOutcome(dir: string, outcome: RunOutcome): Promise<void>`. The directory must already exist, as for `create()`.

Deliberately left out until a later slice reads them: the design's denormalised `cursor` (slots, breaker, run budgets) and the `escalated`/`aborted` run outcomes. Slice 1's resume story is the per-task case files; the log alone is authoritative.

- [ ] **Step 1: Write the failing test** — `src/run-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileNotFound, ImmutabilityViolation } from "./errors.js";
import { appendRunEntry, createRunFile, loadRunFile, setRunOutcome } from "./run-file.js";
import type { RunHeader } from "./schema.js";

const HEADER: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 3, tasks: 10 };
const runDir = () => mkdtempSync(join(tmpdir(), "run-file-"));

describe("a supervised run's record", () => {
  it("reads back the header it was created with, nothing yet in its history and no outcome", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    expect(await loadRunFile(dir)).toEqual({ header: HEADER, history: [], outcome: undefined });
  });

  it("keeps which task took which slot, and when each slot was freed, in the order it happened", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await appendRunEntry(dir, { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T090000Z", taskDef: { intent: "add a page" } });
    await appendRunEntry(dir, { t: "slot_free", slot: 1, surfaceId: "add-a-page-20260930T090000Z", outcome: "escalated" });
    expect((await loadRunFile(dir)).history).toEqual([
      { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T090000Z", taskDef: { intent: "add a page" } },
      { t: "slot_free", slot: 1, surfaceId: "add-a-page-20260930T090000Z", outcome: "escalated" },
    ]);
  });

  it("refuses an entry of the wrong shape before writing anything", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await expect(appendRunEntry(dir, { t: "slot_fill", slot: 0, surfaceId: "x", taskDef: {} })).rejects.toThrow();
    expect((await loadRunFile(dir)).history).toEqual([]);
  });

  it("drops a final entry a crash cut short, as the case file does", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await appendRunEntry(dir, { t: "slot_fill", slot: 1, surfaceId: "a", taskDef: { intent: "a" } });
    appendFileSync(join(dir, "log.jsonl"), '{"t":"slot_fr');
    expect((await loadRunFile(dir)).history).toHaveLength(1);
  });

  it("writes its outcome once, and refuses a second", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:10:00.000Z" });
    expect((await loadRunFile(dir)).outcome).toEqual({ kind: "drained", at: "2026-09-30T09:10:00.000Z" });
    await expect(setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:11:00.000Z" })).rejects.toThrow(ImmutabilityViolation);
  });

  it("says plainly when there is no record in the folder", async () => {
    await expect(loadRunFile(runDir())).rejects.toThrow(FileNotFound);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/run-file.test.ts`
Expected: FAIL, cannot resolve `./run-file.js`.

- [ ] **Step 3: Add the schemas to the end of `src/schema.ts`**

```ts
// --- Supervised run file: one run of several tasks at once ---

/** How a task's run ended, as its slot records it: the case file's own outcome kinds. */
export const SlotOutcome = CaseFileOutcome.shape.kind;
export type SlotOutcome = z.infer<typeof SlotOutcome>;

export const RunHeader = z.object({
  runId: z.string().min(1),
  repoPath: z.string().min(1),
  concurrency: z.number().int().positive(),
  // How many tasks the list held when the run started: the M in "[n/M]".
  tasks: z.number().int().nonnegative(),
});
export type RunHeader = z.infer<typeof RunHeader>;

const Slot = z.number().int().positive();

export const RunEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("slot_fill"), slot: Slot, surfaceId: z.string().min(1), taskDef: TaskDef }),
  z.object({ t: z.literal("slot_free"), slot: Slot, surfaceId: z.string().min(1), outcome: SlotOutcome }),
]);
export type RunEntry = z.infer<typeof RunEntry>;

export const RunOutcome = z.object({
  // Every task the run could take was taken and has ended.
  kind: z.literal("drained"),
  at: z.string(), // ISO 8601
});
export type RunOutcome = z.infer<typeof RunOutcome>;

// What lives in run.json on disk
export const RunJson = z.object({ header: RunHeader, outcome: RunOutcome.optional() });
export type RunJson = z.infer<typeof RunJson>;

// The full in-memory run file (run.json + log.jsonl)
export const RunFile = z.object({ header: RunHeader, history: z.array(RunEntry), outcome: RunOutcome.optional() });
export type RunFile = z.infer<typeof RunFile>;
```

- [ ] **Step 4: Write `src/run-file.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CorruptCaseFile, FileNotFound, ImmutabilityViolation, WriteFailure } from "./errors.js";
import { appendLine, atomicWriteJson, isEnoent, MalformedLine, parseLines, writeAndSync } from "./journal.js";
import { RunEntry, RunJson, type RunFile, type RunHeader, type RunOutcome } from "./schema.js";

/**
 * The record a run of several tasks at once keeps of itself, beside the
 * per-task case files and never inside them: an immutable header, an
 * append-only history of which task took which slot, and an outcome written
 * once. The same three-part split and the same journal as the case file.
 */
const runJsonPath = (dir: string): string => join(dir, "run.json");
const logPath = (dir: string): string => join(dir, "log.jsonl");

export async function createRunFile(dir: string, header: RunHeader): Promise<void> {
  const runJson = RunJson.parse({ header });
  try {
    await Promise.all([atomicWriteJson(runJsonPath(dir), runJson), writeAndSync(logPath(dir), "w", "")]);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

export async function appendRunEntry(dir: string, entry: RunEntry): Promise<void> {
  RunEntry.parse(entry);
  try {
    await appendLine(logPath(dir), entry);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

async function readRunJson(dir: string): Promise<RunJson> {
  let raw: string;
  try {
    raw = await readFile(runJsonPath(dir), "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new FileNotFound(dir, runJsonPath(dir));
    throw err;
  }
  try {
    return RunJson.parse(JSON.parse(raw));
  } catch (err) {
    throw new CorruptCaseFile(dir, String(err));
  }
}

export async function loadRunFile(dir: string): Promise<RunFile> {
  const runJson = await readRunJson(dir);
  const raw = await readFile(logPath(dir), "utf-8").catch((err: unknown) => {
    if (isEnoent(err)) return "";
    throw err;
  });
  try {
    return { header: runJson.header, history: parseLines(raw, (value) => RunEntry.parse(value)), outcome: runJson.outcome };
  } catch (err) {
    if (err instanceof MalformedLine) throw new CorruptCaseFile(dir, err.message);
    throw err;
  }
}

export async function setRunOutcome(dir: string, outcome: RunOutcome): Promise<void> {
  const runJson = await readRunJson(dir);
  if (runJson.outcome !== undefined) throw new ImmutabilityViolation(dir, "outcome");
  try {
    await atomicWriteJson(runJsonPath(dir), RunJson.parse({ ...runJson, outcome }));
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/run-file.test.ts src/schema.test.ts && npx tsc --noEmit && npx eslint src/run-file.ts src/run-file.test.ts src/schema.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/run-file.ts src/run-file.test.ts
git commit -m "Add a run file recording which task took which slot

A run of several tasks at once needs its own record, beside the per-task
case files, of which task each slot took and how it ended. It reuses the
journal extracted from the case file, so it has the same crash safety.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Git calls in one folder take turns ✅ DONE (deliver-slice)

The inner lock the design asks for, keyed on where a call runs. Every harness git call already goes through `git()` in `src/git-exec.ts` (provisioning, the merge-back closer, `removeWorktree`, `ensureCommitted`, `tryGit`), so serialising there by `cwd` covers every call against the shared checkout by construction, with no port, no list of subcommands, and no change to `surface.ts`, `provision.ts` or any closer. Calls in different folders (each task's own worktree) never wait on each other. At concurrency 1 there is never a second caller, so nothing observable changes.

**Deviation from the design, deliberately:** the design (§1) routes the inner lock through an optional `ports.repoLock`. Putting it inside `git()` instead reaches the same "keyed on where the call runs" rule with no port plumbing through `provision.ts`, the closers and `surface.ts`, and applies to every in-process caller (library users driving several `run()`s included), which is only ever safer. Slice 3's cross-process lock is a separate mechanism and is unaffected.

**Granularity:** turns are per git call, not per whole set-up or close. That is enough for the slice's "never overlap" criterion because what must not overlap is git's own metadata writes in the shared checkout (each is one call), and every multi-call sequence here is already safe to interleave with another task's calls: provisioning and teardown touch only their own branch and worktree (`worktree prune` only drops entries whose folder is gone), and the merge-back closer's `merge --ff-only` revalidates the base at the moment it runs, so a probe made stale by another task's merge only ever produces the existing `FAIL` ("the base moved on"). If a later closer needs a multi-call critical section, it cannot simply wrap its `git()` calls in `takeTurn(repoPath, …)`: the chain is non-reentrant, so a `git(repoPath, …)` inside a turn on the same folder deadlocks. Such a section would need raw `execFile` inside the turn, and is out of scope here.

**Design open question (open-pr closer's push):** `open-pr-closer.ts` runs `push` and `remote get-url` with `cwd = repoPath`, so under the where-it-runs rule they take the shared checkout's turn. That is correct, not incidental: `push --set-upstream` writes the remote-tracking ref and branch config in the shared `.git`. The cost is that a slow push delays other tasks' set-up for its duration; acceptable for this slice. `gh` is not git and is untouched.

**Files:**
- Modify: `src/git-exec.ts`
- Modify: `src/git-exec.test.ts`

**Interfaces:**
- Produces: `takeTurn<T>(cwd: string, work: () => Promise<T>): Promise<T>` exported from `src/git-exec.ts`; `git()`/`tryGit()` signatures unchanged.

- [ ] **Step 1: Write the failing tests** — append to `src/git-exec.test.ts` (add `takeTurn` to the `./git-exec.js` import, `mkdtempSync` to the `node:fs` import, and `import { tmpdir } from "node:os";`):

```ts
describe("git calls in one folder take turns", () => {
  /** Long enough for a git call that was not made to wait to have finished several times over. */
  const aWhile = () => new Promise((resolve) => setTimeout(resolve, 300));

  it("does not start a git call in a folder until the call before it there has finished", async () => {
    const repo = initTempRepo("git-exec-turns-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<void>();
    const holding = takeTurn(repo, () => hold.promise);
    let finished = false;
    const call = git(repo, ["status", "--porcelain"]).then(() => (finished = true));

    await aWhile();
    expect(finished).toBe(false);

    hold.resolve();
    await holding;
    await call;
    expect(finished).toBe(true);
  });

  it("treats two spellings of the same folder as one", async () => {
    const repo = initTempRepo("git-exec-turns-spelling-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<void>();
    const holding = takeTurn(`${repo}/.`, () => hold.promise);
    let finished = false;
    const call = git(repo, ["status", "--porcelain"]).then(() => (finished = true));

    await aWhile();
    expect(finished).toBe(false);
    hold.resolve();
    await Promise.all([holding, call]);
  });

  it("never makes a call in one folder wait on a call in another", async () => {
    const shared = initTempRepo("git-exec-turns-shared-", { "seed.txt": "hello\n" });
    const other = initTempRepo("git-exec-turns-other-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<void>();
    const holding = takeTurn(shared, () => hold.promise);

    expect(await git(other, ["symbolic-ref", "--short", "HEAD"])).toBe("main");

    hold.resolve();
    await holding;
  });

  it("keeps taking turns after a call fails", async () => {
    const repo = initTempRepo("git-exec-turns-failed-", { "seed.txt": "hello\n" });
    await expect(takeTurn(repo, () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(await git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
  });

  it("runs work in the order it was queued", async () => {
    const folder = mkdtempSync(join(tmpdir(), "git-exec-order-"));
    const order: number[] = [];
    await Promise.all([3, 1, 2].map((n) => takeTurn(folder, async () => {
      await new Promise((resolve) => setTimeout(resolve, n * 20));
      order.push(n);
    })));
    expect(order).toEqual([3, 1, 2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/git-exec.test.ts`
Expected: FAIL, `takeTurn` is not exported.

- [ ] **Step 3: Implement in `src/git-exec.ts`**

Add `import { resolve } from "node:path";` and, above `git`:

```ts
/** The last piece of work queued in each folder, settled either way: what the next piece waits for. */
const turns = new Map<string, Promise<void>>();

/**
 * Run `work` once everything queued before it in the same folder has settled.
 * This is the in-process lock around the shared checkout: it is keyed on where
 * a git call runs, not on which subcommand it is, so every call against the
 * checkout several tasks share (setting up and removing working copies,
 * deleting branches, merging) takes its turn, and a call added later cannot
 * slip past a list. Each task's own working copy is its own folder, so work
 * there never waits on another task. A plain promise chain is the whole of a
 * non-reentrant mutex, and this one lives only as long as the process.
 */
export function takeTurn<T>(cwd: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(cwd);
  const mine = (turns.get(key) ?? Promise.resolve()).then(work, work);
  const settled = mine.then(
    () => undefined,
    () => undefined,
  );
  turns.set(key, settled);
  void settled.then(() => {
    if (turns.get(key) === settled) turns.delete(key);
  });
  return mine;
}
```

Change `git` to take its turn, and extend its doc comment with one sentence ("…and takes its turn in `cwd` (`takeTurn`), so two tasks never run git in the shared checkout at once."):

```ts
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await takeTurn(cwd, () => execFile("git", args, { cwd, env: cleanGitEnv() }));
  return stdout.trim();
}
```

`// ponytail: no retry on an index.lock left by a person running git in the checkout at the same moment; add a bounded retry here if that is seen in practice (design §4).`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/git-exec.test.ts src/provision.test.ts src/merge-back-closer.test.ts && npx tsc --noEmit && npx eslint src/git-exec.ts src/git-exec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git-exec.ts src/git-exec.test.ts
git commit -m "Make git calls in one folder take turns

Several tasks at once share one checkout, and git's metadata there must not
be changed by two calls at the same moment. Serialising inside git() by the
folder a call runs in guards every shared-checkout call by where it runs,
with no list of commands to fall out of date, while each task's own working
copy stays free to run in parallel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `concurrency` setting, and `delivery validate` reporting it ✅ DONE

**Files:**
- Modify: `src/cli/config.ts` (`CONFIG_KEYS`, `DeliveryConfig`, `WHAT_IT_TAKES`)
- Modify: `src/cli/config.test.ts`
- Modify: `src/cli/settings.ts` (`RunFlags`, `ProjectSettings`, `resolveProject`)
- Modify: `src/cli/settings.test.ts`
- Modify: `src/cli/program.ts` (the `run` command's options)
- Modify: `src/cli/validate-command.ts` (`tasksPhrase`, `checkedLines`)
- Modify: `src/cli/validate-command.test.ts`
- Modify: `src/cli/run-command.test.ts` (help test)
- Modify: `README.md` (settings table, flags table)

**Interfaces:**
- Produces: `RunFlags.concurrency?: string`; `ProjectSettings.concurrency: number` (always set, default 1); `DEFAULT_CONCURRENCY = 1`; `NOT_A_CONCURRENCY(source: string, value: string): string` exported from `src/cli/settings.ts`; `DeliveryConfig.concurrency?: number`.

- [ ] **Step 1: Write the failing tests**

`src/cli/config.test.ts`, in "what a config file may contain":

```ts
  it("accepts how many tasks from the list may run at once", () => {
    expect(DeliveryConfig.parse({ tasks: ["add a page"], concurrency: 3 })).toEqual({ tasks: ["add a page"], concurrency: 3 });
  });
```

and beside the other refusal tests:

```ts
  it.each([0, -1, 1.5, "3"])("refuses a concurrency of %j with the one thing to fix", (value) => {
    expect(problemFor({ concurrency: value })).toBe(
      `I can't use delivery.config.json: the setting \`concurrency\` is \`${JSON.stringify(value)}\`. ` +
        "It says how many tasks from your list may run at once: a whole number, 1 or more, such as `3`.",
    );
  });
```

Update every literal list of keys to the new sentence (the behaviour intended: an unknown key names every key there is):

```bash
sed -i 's/`closer` and `budgets`/`closer`, `budgets` and `concurrency`/g; s/\\`closer\\` and \\`budgets\\`/\\`closer\\`, \\`budgets\\` and \\`concurrency\\`/g' src/cli/config.test.ts
```

`src/cli/settings.test.ts` (add `NOT_A_CONCURRENCY` to the `./settings.js` import):

```ts
describe("how many tasks from the list may run at once", () => {
  it("is one when nothing says otherwise", async () => {
    expect((await settings({ task: TASK })).concurrency).toBe(1);
  });

  it("takes the file's value", async () => {
    expect((await settings({ task: TASK }, { config: { concurrency: 3 } })).concurrency).toBe(3);
  });

  it("lets --concurrency beat DELIVERY_CONCURRENCY, which beats the file", async () => {
    const config: DeliveryConfig = { concurrency: 3 };
    expect((await settings({ task: TASK, concurrency: "4" }, { env: { DELIVERY_CONCURRENCY: "2" }, config })).concurrency).toBe(4);
    expect((await settings({ task: TASK }, { env: { DELIVERY_CONCURRENCY: "2" }, config })).concurrency).toBe(2);
  });

  it("treats DELIVERY_CONCURRENCY set to nothing as not set", async () => {
    expect((await settings({ task: TASK }, { env: { DELIVERY_CONCURRENCY: "" }, config: { concurrency: 3 } })).concurrency).toBe(3);
  });

  it.each(["0", "-2", "1.5", "three"])("refuses --concurrency %s, naming the flag, with the configuration code", async (value) => {
    const err = await settings({ task: TASK, concurrency: value }).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(Refusal);
    expect(err).toMatchObject({ message: NOT_A_CONCURRENCY("--concurrency", value), exitCode: EXIT.configuration, field: "concurrency" });
  });

  it("refuses a DELIVERY_CONCURRENCY that is not a whole number, naming the variable", async () => {
    await expect(settings({ task: TASK }, { env: { DELIVERY_CONCURRENCY: "0" } })).rejects.toThrow(NOT_A_CONCURRENCY("DELIVERY_CONCURRENCY", "0"));
  });
});
```

`src/cli/validate-command.test.ts`: in the `project()` helper add `concurrency: 1` to the defaults (`ProjectSettings` now requires it), then in "what validate says a project is set up to do":

```ts
  it("says how many tasks run at once, with how many are queued, when more than one may", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => `task ${i + 1}`);
    expect(checkedLines({ tasks }, project({ concurrency: 3 }))[1]).toBe("✓ concurrency: up to 3 tasks at once (10 queued)");
  });

  it("says only how many are queued at one at a time, exactly as before", () => {
    expect(checkedLines({ tasks: ["a", "b"] }, project({ concurrency: 1 }))[1]).toBe("✓ 2 tasks queued");
  });
```

In "delivery validate on a configuration that is ready":

```ts
  it("reports the concurrency the file sets", async () => {
    const { exitCode, stdout } = await delivery(["validate"], { cwd: repoWith({ ...COMPLETE, concurrency: 2 }) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("✓ concurrency: up to 2 tasks at once (3 queued)");
    expect(stdout).not.toContain("✓ 3 tasks queued");
  });
```

In "delivery validate on a configuration with a problem":

```ts
  it.each([0, -1, 1.5])("refuses a concurrency of %j with the configuration code and one thing to fix", async (value) => {
    const { exitCode, stderr } = await delivery(["validate"], { cwd: repoWith({ ...COMPLETE, concurrency: value }) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(`the setting \`concurrency\` is \`${JSON.stringify(value)}\`. It says how many tasks from your list may run at once`);
  });
```

In "delivery validate --json":

```ts
  it("names the concurrency setting for a DELIVERY_CONCURRENCY that is not a whole number", async () => {
    const { json } = await bothForms(repoWith(COMPLETE), { DELIVERY_CONCURRENCY: "0" });
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(json.result).toMatchObject({ ready: false, problems: [{ field: "concurrency" }] });
  });
```

`src/cli/run-command.test.ts`, in the "delivery run with a config file" describe:

```ts
  it("lists --concurrency in `delivery run --help`", async () => {
    const repo = initTempRepo("run-command-help-concurrency-", { "package.json": PACKAGE });
    expect((await delivery(["run", "--help"], { cwd: repo })).stdout).toContain("--concurrency <n>");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/cli/config.test.ts src/cli/settings.test.ts src/cli/validate-command.test.ts -t "concurren|what a config file|key"`
Expected: FAIL (unknown key `concurrency`, no `NOT_A_CONCURRENCY` export, no validate line).

- [ ] **Step 3: Implement**

`src/cli/config.ts`:

```ts
/** The eight keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `tasks`, `domain`, `roles`, `gate`, `closer`, `budgets` and `concurrency`";
```

In `DeliveryConfig`'s object, after `budgets`:

```ts
    // How many tasks from `tasks` may run at once. One, the default, is the
    // list worked down in order; more starts that many side by side.
    concurrency: z.number().int().positive().optional(),
```

In `WHAT_IT_TAKES`:

```ts
  concurrency: "It says how many tasks from your list may run at once: a whole number, 1 or more, such as `3`.",
```

`src/cli/settings.ts`: add to `RunFlags` `concurrency?: string;`; to `ProjectSettings`:

```ts
  /** How many tasks from the list may run at once. Never pinned into a run: it shapes the list, not any one task. */
  concurrency: number;
```

and:

```ts
/** How many tasks from the list run at once when nothing says otherwise: one, worked down in order, as every project did before. */
export const DEFAULT_CONCURRENCY = 1;

export const NOT_A_CONCURRENCY = (source: string, value: string): string =>
  `I can't use ${source} \`${value}\`: it says how many tasks from your list may run at once, so it is a whole number, 1 or more, such as 3.`;

function concurrencyFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): number {
  const named = flags.concurrency ?? fromEnv(env.DELIVERY_CONCURRENCY);
  if (named === undefined) return config.concurrency ?? DEFAULT_CONCURRENCY;
  if (!/^[1-9]\d*$/.test(named.trim())) {
    const source = flags.concurrency !== undefined ? "--concurrency" : "DELIVERY_CONCURRENCY";
    throw new Refusal(NOT_A_CONCURRENCY(source, named), EXIT.configuration, "concurrency");
  }
  return Number(named.trim());
}
```

In `resolveProject`'s returned object add `concurrency: concurrencyFrom(flags, env, config),`.

`src/cli/program.ts`, on the `run` command after `--closer`:

```ts
    .option("--concurrency <n>", "how many tasks from your list may run at once (default 1: one after another)")
```

`src/cli/validate-command.ts`: change `tasksPhrase` to take the project's concurrency, and `checkedLines` to pass it:

```ts
function tasksPhrase(config: DeliveryConfig, concurrency: number): string {
  if (config.tasks) {
    const queued = config.tasks.length;
    if (concurrency > 1) return `concurrency: up to ${concurrency} tasks at once (${queued} queued)`;
    return `${queued} ${queued === 1 ? "task" : "tasks"} queued`;
  }
  if (config.task) return "1 task, set in `task`";
  return 'no tasks listed: name one when you run, with `delivery run --task "..."`';
}
```

and in `checkedLines`, `tasksPhrase(config, project.concurrency),`. Add to the `tasksPhrase` doc comment: "When more than one task may run at once, the line says so, with how many are queued."

Run `npx tsc --noEmit`; for every other object literal typed `ProjectSettings` it reports as missing `concurrency` (tests only), add `concurrency: 1`.

`README.md`: settings table, after the `budgets` row:

```markdown
| `concurrency` | How many tasks from your list may run at once, a whole number. The default, 1, works down the list one task at a time. 2 or more starts that many, each on its own copy with its own branch and record, and starts the next task on the list as soon as one finishes. |
```

flags table, after `--closer`:

```markdown
| `--concurrency 3` | `DELIVERY_CONCURRENCY` | How many tasks from your list may run at once |
```

and in the sentence after the tables ("An unknown setting, a limit that is not a whole number, …") change "a limit that is not a whole number" to "a limit or a concurrency that is not a whole number".

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli/config.test.ts src/cli/settings.test.ts src/cli/validate-command.test.ts tests/cli-and-configuration/2-choose-your-own-check-closing-action-and-limits.test.ts && npx vitest run src/cli/run-command.test.ts -t "concurrency" && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts src/cli/settings.ts src/cli/settings.test.ts src/cli/program.ts src/cli/validate-command.ts src/cli/validate-command.test.ts src/cli/run-command.test.ts README.md
git commit -m "Add the concurrency setting and report it from delivery validate

A project owner needs one place to say how many tasks from the list may
run at once, overridable per run like every other setting, and to see it
checked before anything is spent. The default stays 1, so no existing
project changes behaviour or cost on upgrade.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reporters say which task a line is about

**Files:**
- Modify: `src/cli/report.ts`
- Modify: `src/cli/report.test.ts`

**Interfaces:**
- Produces (all exported from `src/cli/report.ts`):
  - `interface TaskTag { runId: string; ordinal: number; of: number; id: string }` (`runId` is the supervised run's id, `id` the task's own run id)
  - `type RunState = "STARTED" | "DRAINED"`; `interface RunEvent { runId: string; state: RunState }`
  - `interface SurfaceStepRecord { scope: "surface"; runId: string; surface: { ordinal: number; of: number; id: string }; state: SurfaceState; done: boolean; recovery: string | null; at: string }`
  - `interface RunEventRecord { scope: "run"; runId: string; state: RunState; done: boolean; at: string }`
  - `RunReporter` gains `forTask(task: TaskTag): RunReporter` and `run(event: RunEvent): void`
  - `plainReporter(writeLine, colour, task?: TaskTag)`; `jsonReporter(writeRecord, writeNote, now?, task?: TaskTag)`
- Unchanged: an untagged reporter's `note`/`step`/`outcome` output (the existing `StepRecord` shape, no `scope`).

- [ ] **Step 1: Write the failing tests** — append to `src/cli/report.test.ts` (import `type RunEventRecord, type SurfaceStepRecord, type TaskTag` from `./report.js`):

```ts
const TASK_2: TaskTag = { runId: "run-20260916T120000Z", ordinal: 2, of: 10, id: "let-someone-swap-20260916T120000Z" };
const TASK_3: TaskTag = { runId: "run-20260916T120000Z", ordinal: 3, of: 10, id: "send-a-reminder-20260916T120001Z" };

describe("telling a person about several tasks at once", () => {
  it("starts every line about a task with its place in the list", () => {
    const lines: string[] = [];
    const task = plainReporter((line) => lines.push(line), false).forTask(TASK_2);
    task.note("Starting run let-someone-swap-20260916T120000Z: let someone swap");
    task.step({ state: "PROVISIONING", done: false });
    task.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    task.outcome(SUMMARY);
    expect(lines).toEqual([
      "[2/10] Starting run let-someone-swap-20260916T120000Z: let someone swap",
      "[2/10] - setting up",
      "[2/10] - checking the agent's work",
      "[2/10] Had to put something right: re-created the working copy.",
      `[2/10] ${SUMMARY.headline}`,
      ...SUMMARY.details.map((line) => `[2/10] ${line}`),
    ]);
  });

  it("keeps each task's own run of steps, so two tasks at the same step both say so", () => {
    const lines: string[] = [];
    const plain = plainReporter((line) => lines.push(line), false);
    plain.forTask(TASK_2).step({ state: "AGENT_ACTIVE", done: false });
    plain.forTask(TASK_3).step({ state: "AGENT_ACTIVE", done: false });
    expect(lines).toEqual(["[2/10] - the agent is working", "[3/10] - the agent is working"]);
  });

  it("keeps the tag as text outside any colour", () => {
    const lines: string[] = [];
    plainReporter((line) => lines.push(line), true).forTask(TASK_2).step({ state: "CLOSING", done: false });
    expect(lines[0]?.startsWith("[2/10] ")).toBe(true);
  });

  it("prints nothing for a run event: the run's opening line already said it", () => {
    const lines: string[] = [];
    plainReporter((line) => lines.push(line), false).run({ runId: TASK_2.runId, state: "STARTED" });
    expect(lines).toEqual([]);
  });
});

describe("telling a script about several tasks at once", () => {
  function scripted() {
    const records: string[] = [];
    const notes: string[] = [];
    return { records, notes, reporter: jsonReporter((line) => records.push(line), (line) => notes.push(line), clock) };
  }

  it("writes each task's step with its scope, the run it belongs to, and its place and id, every key present", () => {
    const { records, reporter } = scripted();
    const task = reporter.forTask(TASK_2);
    task.step({ state: "PROVISIONING", done: false });
    task.step({ state: "GATING", done: false, recovery: "re-created the working copy" });
    expect(records.map((line) => JSON.parse(line) as SurfaceStepRecord)).toEqual([
      { scope: "surface", runId: TASK_2.runId, surface: { ordinal: 2, of: 10, id: TASK_2.id }, state: "PROVISIONING", done: false, recovery: null, at: AT },
      { scope: "surface", runId: TASK_2.runId, surface: { ordinal: 2, of: 10, id: TASK_2.id }, state: "GATING", done: false, recovery: "re-created the working copy", at: AT },
    ]);
  });

  it("writes the run's own events with the run scope", () => {
    const { records, reporter } = scripted();
    reporter.run({ runId: TASK_2.runId, state: "STARTED" });
    reporter.run({ runId: TASK_2.runId, state: "DRAINED" });
    expect(records.map((line) => JSON.parse(line) as RunEventRecord)).toEqual([
      { scope: "run", runId: TASK_2.runId, state: "STARTED", done: false, at: AT },
      { scope: "run", runId: TASK_2.runId, state: "DRAINED", done: true, at: AT },
    ]);
  });

  it("keeps a task's words off the machine-readable stream, tagged on the note stream", () => {
    const { records, notes, reporter } = scripted();
    const task = reporter.forTask(TASK_2);
    task.note("Starting run let-someone-swap-20260916T120000Z: let someone swap");
    task.outcome(SUMMARY);
    expect(records).toEqual([]);
    expect(notes).toEqual([
      "[2/10] Starting run let-someone-swap-20260916T120000Z: let someone swap",
      `[2/10] ${SUMMARY.headline}`,
      ...SUMMARY.details.map((line) => `[2/10] ${line}`),
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/cli/report.test.ts`
Expected: FAIL, `forTask` is not a function.

- [ ] **Step 3: Implement in `src/cli/report.ts`**

Add the types:

```ts
/** Which task of a run of several at once a line is about: its place in the list, the run it belongs to, and the task's own run id. */
export interface TaskTag {
  runId: string;
  ordinal: number;
  of: number;
  id: string;
}

/** What a run of several tasks at once says of itself: that it has started, and that every task it could take has ended. */
export type RunState = "STARTED" | "DRAINED";
export interface RunEvent {
  runId: string;
  state: RunState;
}

/** One task's step in a run of several at once, as a script reads it. Every key is present, `null` where it does not apply. */
export interface SurfaceStepRecord {
  scope: "surface";
  runId: string;
  surface: { ordinal: number; of: number; id: string };
  state: SurfaceState;
  done: boolean;
  recovery: string | null;
  at: string;
}

/** Something that happened to a run of several tasks as a whole, as a script reads it. */
export interface RunEventRecord {
  scope: "run";
  runId: string;
  state: RunState;
  done: boolean;
  at: string;
}

/** The text a task's lines start with: its place in the list, never colour alone, so `grep '\[2/10\]'` follows one task. */
const tagOf = (task: TaskTag): string => `[${task.ordinal}/${task.of}]`;
```

Extend `RunReporter`:

```ts
  /** The same rendering for one task of a run of several at once: every line it writes says which task it is about. */
  forTask(task: TaskTag): RunReporter;
  /** Something that happened to a run of several tasks as a whole. */
  run(event: RunEvent): void;
```

Replace `plainReporter`:

```ts
export function plainReporter(writeLine: (line: string) => void, colour: boolean, task?: TaskTag): RunReporter {
  const say = task === undefined ? writeLine : (line: string) => writeLine(`${tagOf(task)} ${line}`);
  let last: string | undefined;
  return {
    note: say,
    step(step) {
      const phrase = STEP_PHRASES[step.state];
      if (phrase !== last) {
        last = phrase;
        say(paint(colour, "quiet", `- ${phrase}`));
      }
      if (step.recovery) say(putRight(step.recovery));
    },
    outcome(summary) {
      say(paint(colour, summary.tone, summary.headline));
      for (const line of summary.details) say(line);
    },
    // Each task gets its own reporter, so its run of steps is its own and two tasks at the same step both say so.
    forTask: (other) => plainReporter(writeLine, colour, other),
    // A person reads the run's shape in the line that opens it and the sentence that ends it, both notes.
    run: () => undefined,
  };
}
```

Replace `jsonReporter`:

```ts
export function jsonReporter(
  writeRecord: (line: string) => void,
  writeNote: (line: string) => void,
  now: () => Date = () => new Date(),
  task?: TaskTag,
): RunReporter {
  const say = task === undefined ? writeNote : (line: string) => writeNote(`${tagOf(task)} ${line}`);
  const write = (record: StepRecord | SurfaceStepRecord | RunEventRecord): void => writeRecord(JSON.stringify(record));
  return {
    note: say,
    step(step) {
      const at = now().toISOString();
      if (task === undefined) {
        write({ state: step.state, done: step.done, ...(step.recovery === undefined ? {} : { recovery: step.recovery }), at });
        return;
      }
      write({
        scope: "surface",
        runId: task.runId,
        surface: { ordinal: task.ordinal, of: task.of, id: task.id },
        state: step.state,
        done: step.done,
        recovery: step.recovery ?? null,
        at,
      });
    },
    outcome(summary) {
      // On the note stream, never as a record: see the note above.
      say(summary.headline);
      for (const line of summary.details) say(line);
    },
    forTask: (other) => jsonReporter(writeRecord, writeNote, now, other),
    run(event) {
      write({ scope: "run", runId: event.runId, state: event.state, done: event.state === "DRAINED", at: now().toISOString() });
    },
  };
}
```

Add one sentence to each reporter's doc comment: plain, "A task of a run of several at once has every line started with its place in the list"; JSON, "A task of a run of several at once writes a `scope: "surface"` record naming its place and id, and the run writes `scope: "run"` records; an untagged step keeps the shape it always had."

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli/report.test.ts && npx tsc --noEmit && npx eslint src/cli/report.ts src/cli/report.test.ts`
Expected: PASS, the existing single-run reporter tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/cli/report.ts src/cli/report.test.ts
git commit -m "Let a reporter say which task of several each line is about

When several tasks run at once their lines interleave, so a person needs a
text tag on every line to follow one task, and a script needs each record
to carry its scope and task. Untagged output is unchanged, so a single run
and a list run one at a time print exactly what they did before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The slot pool

**Files:**
- Create: `src/supervisor.ts`
- Create: `src/supervisor.test.ts`

**Interfaces:**
- Consumes: Task 2's `createRunFile`, `appendRunEntry`, `setRunOutcome`, `loadRunFile` (tests), `RunHeader`, `RunEntry`, `SlotOutcome`, `TaskDef`.
- Produces:

```ts
export interface Claim { taskDef: TaskDef; surfaceId: string }
export interface Settled<C extends Claim> { claim: C; outcome: SlotOutcome }
export interface Supervision<C extends Claim> {
  slots: number;
  next(claimed: readonly C[]): Promise<C | undefined>;
  drive(claim: C): Promise<SlotOutcome>;
  waitOnSetback: boolean;
  record?: { dir: string; header: RunHeader };
}
export function supervise<C extends Claim>(supervision: Supervision<C>): Promise<Settled<C>[]>;
```

`settled` is in the order tasks ended. The pool never starts a task twice because `next` is always handed every claim made so far.

Known limit, left for slice 3: `slot_fill` is written before `drive` runs, so a throw early in `drive` (for example the agent runtime refusing on a machine that is not signed in, surfaced as exit 3) leaves a run record with fills whose task never got a case file, and no outcome. Nothing in this slice reads a run record back to act on it, so this is harmless now; slice 3's resume must treat a `slot_fill` with no matching case file as "not started" rather than "live".

- [ ] **Step 1: Write the failing test** — `src/supervisor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRunFile } from "./run-file.js";
import type { RunHeader, SlotOutcome } from "./schema.js";
import { supervise, type Claim } from "./supervisor.js";

/** Let every promise callback already queued run, so a test sees what the pool has started so far. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A list of `count` tasks, and a driver whose tasks end only when the test says so. */
function pool(count: number) {
  const tasks: Claim[] = Array.from({ length: count }, (_, i) => ({ taskDef: { intent: `task ${i + 1}` }, surfaceId: `task-${i + 1}` }));
  const started: string[] = [];
  const endings = new Map<string, PromiseWithResolvers<SlotOutcome>>();
  let running = 0;
  let peak = 0;
  return {
    started,
    peak: () => peak,
    next: async (claimed: readonly Claim[]) => tasks.find((task) => !claimed.some((claim) => claim.surfaceId === task.surfaceId)),
    drive: async (claim: Claim): Promise<SlotOutcome> => {
      started.push(claim.surfaceId);
      running += 1;
      peak = Math.max(peak, running);
      const ending = Promise.withResolvers<SlotOutcome>();
      endings.set(claim.surfaceId, ending);
      try {
        return await ending.promise;
      } finally {
        running -= 1;
      }
    },
    async end(surfaceId: string, outcome: SlotOutcome = "closed") {
      endings.get(surfaceId)?.resolve(outcome);
      await settle();
    },
    async fail(surfaceId: string, error: Error) {
      endings.get(surfaceId)?.reject(error);
      await settle();
    },
  };
}

describe("running several tasks from a list at once", () => {
  it("starts up to the number of slots at once, in list order, and starts the next as soon as one ends", async () => {
    const p = pool(4);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    expect(p.started).toEqual(["task-1", "task-2"]);

    await p.end("task-2");
    expect(p.started).toEqual(["task-1", "task-2", "task-3"]);
    await p.end("task-1");
    expect(p.started).toEqual(["task-1", "task-2", "task-3", "task-4"]);
    await p.end("task-3");
    await p.end("task-4");

    expect((await done).map((settled) => settled.claim.surfaceId)).toEqual(["task-2", "task-1", "task-3", "task-4"]);
    expect(p.peak()).toBe(2);
  });

  it("never starts a task twice, and ends once every task has ended", async () => {
    const p = pool(3);
    const done = supervise({ slots: 5, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    for (const id of ["task-1", "task-2", "task-3"]) await p.end(id);
    expect(await done).toHaveLength(3);
    expect(new Set(p.started).size).toBe(p.started.length);
  });

  it("carries on past a task that needs a decision, filling its slot with the next task", async () => {
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    await p.end("task-1", "escalated");
    expect(p.started).toContain("task-3");
    await p.end("task-2");
    await p.end("task-3");
    expect((await done).map((settled) => settled.outcome)).toEqual(["escalated", "closed", "closed"]);
  });

  it("starts nothing more after a task that did not close, when the list waits on setbacks", async () => {
    const p = pool(3);
    const done = supervise({ slots: 1, next: p.next, drive: p.drive, waitOnSetback: true });
    await settle();
    await p.end("task-1");
    expect(p.started).toEqual(["task-1", "task-2"]);
    await p.end("task-2", "aborted");
    expect((await done).map((settled) => settled.outcome)).toEqual(["closed", "aborted"]);
    expect(p.started).toEqual(["task-1", "task-2"]);
  });

  it("ends at once, having started nothing, when there is nothing to take", async () => {
    const p = pool(0);
    expect(await supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false })).toEqual([]);
  });

  it("lets every running task finish, starting nothing new, then throws, when driving one throws", async () => {
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    const result = done.then(
      () => "finished",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    await settle();
    await p.fail("task-1", new Error("the harness broke"));
    expect(p.started).toEqual(["task-1", "task-2"]);

    let over = false;
    void result.then(() => (over = true));
    await settle();
    expect(over).toBe(false);

    await p.end("task-2");
    expect(await result).toBe("the harness broke");
  });

  it("records which task took which slot and how each ended, then that the run drained", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supervise-"));
    const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 3 };
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir, header } });
    await vi.waitFor(() => expect(p.started).toEqual(["task-1", "task-2"]));
    await p.end("task-1");
    await vi.waitFor(() => expect(p.started).toContain("task-3"));
    await p.end("task-2");
    await p.end("task-3");
    await done;

    const runFile = await loadRunFile(dir);
    expect(runFile.header).toEqual(header);
    expect(runFile.history.slice(0, 4)).toEqual([
      { t: "slot_fill", slot: 1, surfaceId: "task-1", taskDef: { intent: "task 1" } },
      { t: "slot_fill", slot: 2, surfaceId: "task-2", taskDef: { intent: "task 2" } },
      { t: "slot_free", slot: 1, surfaceId: "task-1", outcome: "closed" },
      // The lowest free slot is taken, so a freed slot is refilled.
      { t: "slot_fill", slot: 1, surfaceId: "task-3", taskDef: { intent: "task 3" } },
    ]);
    expect(runFile.history.slice(4)).toHaveLength(2);
    expect(runFile.history.slice(4)).toEqual(
      expect.arrayContaining([
        { t: "slot_free", slot: 2, surfaceId: "task-2", outcome: "closed" },
        { t: "slot_free", slot: 1, surfaceId: "task-3", outcome: "closed" },
      ]),
    );
    expect(runFile.outcome?.kind).toBe("drained");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/supervisor.test.ts`
Expected: FAIL, cannot resolve `./supervisor.js`.

- [ ] **Step 3: Write `src/supervisor.ts`**

```ts
import { appendRunEntry, createRunFile, setRunOutcome } from "./run-file.js";
import type { RunEntry, RunHeader, SlotOutcome, TaskDef } from "./schema.js";

/** A task a slot has taken: what it says, and the id its run has, or will have once started. */
export interface Claim {
  taskDef: TaskDef;
  surfaceId: string;
}

/** A task that has ended, and how. */
export interface Settled<C extends Claim> {
  claim: C;
  outcome: SlotOutcome;
}

export interface Supervision<C extends Claim> {
  /** How many tasks may run at once. */
  slots: number;
  /**
   * The next task to start, worked out afresh at every fill, or nothing when no
   * task is left to take. `claimed` is every task a slot has taken in this run,
   * running or ended, so a task is never started twice.
   */
  next(claimed: readonly C[]): Promise<C | undefined>;
  /** Take one task to its end. A throw is a broken harness or setup, never a task's own setback. */
  drive(claim: C): Promise<SlotOutcome>;
  /** Start nothing more once a task ends without closing: the list worked down one at a time waits on it. */
  waitOnSetback: boolean;
  /** Where to keep the run's own record, in a folder that already exists; none for a list worked down one at a time. */
  record?: { dir: string; header: RunHeader };
}

/**
 * Keep up to `slots` tasks running, starting the next as soon as one ends,
 * until there is nothing left to take. A small launcher of its own rather than
 * a general concurrency library, because every start must work out the next
 * task afresh and record which slot took it before it runs.
 *
 * A task that throws stops new starts but not the tasks already running: they
 * are left to end, so none is abandoned half way through a git call, and then
 * the first error is thrown. The run's record gets no outcome in that case,
 * which is what an interrupted run leaves behind.
 */
export async function supervise<C extends Claim>({ slots, next, drive, waitOnSetback, record }: Supervision<C>): Promise<Settled<C>[]> {
  if (record) await createRunFile(record.dir, record.header);
  const note = async (entry: RunEntry): Promise<void> => {
    if (record) await appendRunEntry(record.dir, entry);
  };

  const free = new Set(Array.from({ length: slots }, (_, index) => index + 1));
  const claimed: C[] = [];
  const settled: Settled<C>[] = [];
  const running = new Set<Promise<void>>();
  let exhausted = false;
  let halted = false;
  let failure: { error: unknown } | undefined;
  const stop = (error: unknown): void => {
    failure ??= { error };
    halted = true;
  };

  async function start(): Promise<void> {
    const claim = await next(claimed);
    // A task can end, and halt the pool, while the next one is being worked out.
    if (halted) return;
    if (claim === undefined) {
      exhausted = true;
      return;
    }
    const slot = Math.min(...free);
    free.delete(slot);
    claimed.push(claim);
    await note({ t: "slot_fill", slot, surfaceId: claim.surfaceId, taskDef: claim.taskDef });
    const task: Promise<void> = drive(claim)
      .then(async (outcome) => {
        settled.push({ claim, outcome });
        await note({ t: "slot_free", slot, surfaceId: claim.surfaceId, outcome });
        if (waitOnSetback && outcome !== "closed") halted = true;
      })
      .catch(stop)
      .finally(() => {
        free.add(slot);
        running.delete(task);
      });
    running.add(task);
  }

  for (;;) {
    while (!exhausted && !halted && free.size > 0) await start().catch(stop);
    if (running.size === 0) break;
    await Promise.race(running);
  }

  if (failure) throw failure.error;
  if (record) await setRunOutcome(record.dir, { kind: "drained", at: new Date().toISOString() });
  return settled;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/supervisor.test.ts && npx tsc --noEmit && npx eslint src/supervisor.ts src/supervisor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/supervisor.ts src/supervisor.test.ts
git commit -m "Add a slot pool that runs several tasks at once

A list should keep a fixed number of tasks going and start the next as soon
as one ends, recording which slot took which task. The pool is its own small
launcher because every start must pick the next task afresh and write its
slot before running; it knows nothing of the command line, so a scripted
multi-task runner can drive the same pool later.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Queue plumbing: claimed tasks, distinct run ids, and how a list ends

**Files:**
- Modify: `src/cli/run-location.ts` (`runIdFor`, new `supervisedRunId`, `supervisedPlace`)
- Modify: `src/cli/run-location.test.ts`
- Modify: `src/cli/queue.ts` (`nextQueueTask`, new `listExitCode`, `runShape`, `taskEnded`)
- Modify: `src/cli/queue.test.ts`
- Modify: `src/cli/drive.ts` (`RunStart.runId?`)

**Interfaces:**
- Produces:
  - `runIdFor(intent: string, now: Date, taken: ReadonlySet<string> = new Set()): string` — the first of `slug-stamp`, `slug-2-stamp`, `slug-3-stamp`… not in `taken` (stamp stays last so `startedInstant` still reads it)
  - `supervisedRunId(now: Date): string` → `run-<UTC second>`
  - `supervisedPlace(repoPath: string, runId: string): string` → `<repo>/.delivery/supervised/<runId>`
  - `nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: readonly TaskDef[] = []): QueuePosition | undefined`
  - `listExitCode(outcomes: readonly SlotOutcome[]): ExitCode`
  - `runShape(runId: string, tasks: number, concurrency: number): string`
  - `taskEnded(position: QueuePosition, outcome: SlotOutcome): string`
  - `RunStart.runId?: string` — `startRun` uses it when given, else `runIdFor(intent, new Date())` as today

Two slots filled in the same second for tasks sharing their first five words would otherwise get one id, one record folder and one branch: the id is now chosen against every id on disk and every id this run has claimed.

- [ ] **Step 1: Write the failing tests**

`src/cli/run-location.test.ts` (import `supervisedPlace, supervisedRunId` from `./run-location.js` and `startedInstant` from `./runs.js`):

```ts
  it("gives a task the next free id when its first choice is taken, keeping the stamp last", () => {
    const first = runIdFor("add a thing", AT);
    expect(runIdFor("add a thing", AT, new Set([first]))).toBe("add-a-thing-2-20260914T210309Z");
    expect(runIdFor("add a thing", AT, new Set([first, "add-a-thing-2-20260914T210309Z"]))).toBe("add-a-thing-3-20260914T210309Z");
    expect(startedInstant("add-a-thing-2-20260914T210309Z")).toBe("2026-09-14T21:03:09Z");
  });

  it("keeps its first choice when nothing has taken it", () => {
    expect(runIdFor("add a thing", AT, new Set(["something-else-20260914T210309Z"]))).toBe(runIdFor("add a thing", AT));
  });
```

and a new describe:

```ts
describe("a run of several tasks at once", () => {
  it("is named by the UTC second it started", () => {
    expect(supervisedRunId(AT)).toBe("run-20260914T210309Z");
  });

  it("keeps its record beside the tasks' records, not among them", () => {
    expect(supervisedPlace("/repo", "run-20260914T210309Z")).toBe(join("/repo", ".delivery", "supervised", "run-20260914T210309Z"));
    expect(supervisedPlace("/repo", "run-x").startsWith(runsRoot("/repo"))).toBe(false);
  });
});
```

`src/cli/queue.test.ts` (import `listExitCode, runShape, taskEnded` from `./queue.js` and `EXIT` from `./failures.js`), inside "the next task on the list, as `delivery run` would pick it":

```ts
  it("passes over a task a slot has already taken in this run", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks, [{ intent: PAGE }])).toEqual({ task: 2, of: 3 });
  });

  it("passes over a task whose run needs a decision once a slot has taken it, so it is not started twice", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "escalated", source: "worker", reason: "authority", at } });
    expect(nextQueueTask(await allRuns(repo), tasks, [{ intent: PAGE }])).toEqual({ task: 2, of: 3 });
  });

  it("is nothing when every task not yet delivered has been taken", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks, [{ intent: PAGE }, { intent: SWAP }, { intent: WAVE }])).toBeUndefined();
  });
```

and new describes:

```ts
describe("the exit code a whole list ends with", () => {
  it("is 0 only when every task was delivered", () => {
    expect(listExitCode(["closed", "closed"])).toBe(EXIT.ok);
    expect(listExitCode([])).toBe(EXIT.ok);
  });

  it("needs a decision when any task does, whatever else stopped", () => {
    expect(listExitCode(["closed", "aborted", "escalated"])).toBe(EXIT.escalated);
  });

  it("says a task stopped when one did and none needs a decision", () => {
    expect(listExitCode(["closed", "aborted"])).toBe(EXIT.aborted);
  });
});

describe("what a list of several at once says", () => {
  it("opens by naming the run and its shape", () => {
    expect(runShape("run-20260926T090000Z", 10, 3)).toBe("Starting run run-20260926T090000Z: 10 tasks, up to 3 at once");
    expect(runShape("run-20260926T090000Z", 1, 2)).toBe("Starting run run-20260926T090000Z: 1 task, up to 2 at once");
  });

  it("ends by naming each task that was not delivered, and that the rest carried on", () => {
    expect(taskEnded({ task: 3, of: 10 }, "escalated")).toBe("Task 3 of 10 needs your decision; the rest of the list carried on without it.");
    expect(taskEnded({ task: 5, of: 10 }, "aborted")).toBe("Task 5 of 10 stopped before it finished; the rest of the list carried on without it.");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/cli/run-location.test.ts src/cli/queue.test.ts`
Expected: FAIL (missing exports; `claimed` ignored).

- [ ] **Step 3: Implement**

`src/cli/run-location.ts`:

```ts
/** A UTC second as the ids carry it: 2026-09-14T21:03:09Z becomes 20260914T210309Z. */
function stampOf(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/**
 * A run's id, which is also its surface id and so its branch name: the first
 * words of the task, so a person can tell runs apart, then the UTC second it
 * started, so re-running a finished task starts a new run instead of reopening
 * the old one. Two tasks sharing their first words can start in the same second
 * when several run at once, so an id in `taken` is passed over for the next
 * numbered one, with the stamp kept last where every reader expects it.
 */
export function runIdFor(intent: string, now: Date, taken: ReadonlySet<string> = new Set()): string {
  const slug =
    intent
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, SLUG_WORDS)
      .join("-") || "run";
  const stamp = stampOf(now);
  for (let n = 1; ; n++) {
    const id = n === 1 ? `${slug}-${stamp}` : `${slug}-${n}-${stamp}`;
    if (!taken.has(id)) return id;
  }
}

/** A run of several tasks at once: its own id, told apart from every task's id by what it is and when it started. */
export function supervisedRunId(now: Date): string {
  return `run-${stampOf(now)}`;
}

/** Where a run of several tasks at once keeps its own record: beside the tasks' records, so reading them never meets it. */
export function supervisedPlace(repoPath: string, runId: string): string {
  return join(repoPath, ".delivery", "supervised", runId);
}
```

`src/cli/queue.ts`: `nextQueueTask` gains `claimed`:

```ts
/**
 * The task `delivery run` would act on next: the first one on the list whose
 * run has not been delivered and that no slot has already taken in this run,
 * counted as "Task N of M" counts. Nothing when no task is left. The same rule
 * the list is worked by, so what `delivery preview` calls next is what a run
 * does next.
 */
export function nextQueueTask(records: RunRecord[], tasks: TaskDef[], claimed: readonly TaskDef[] = []): QueuePosition | undefined {
  const index = tasks.findIndex(
    (taskDef) => !isClosed(findQueueRun(records, taskDef)) && !claimed.some((taken) => isDeepStrictEqual(taken, taskDef)),
  );
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}
```

and add (importing `type SlotOutcome` from `../schema.js`):

```ts
/**
 * The exit code a whole list ends with, from how each task it took ended: a
 * decision wanted anywhere comes first, then a task that stopped, and only a
 * list delivered in full is 0.
 */
export function listExitCode(outcomes: readonly SlotOutcome[]): ExitCode {
  if (outcomes.includes("escalated")) return EXIT.escalated;
  if (outcomes.includes("aborted")) return EXIT.aborted;
  return EXIT.ok;
}

/** The line a run of several tasks at once opens with. */
export const runShape = (runId: string, tasks: number, concurrency: number): string =>
  `Starting run ${runId}: ${tasks} ${tasks === 1 ? "task" : "tasks"}, up to ${concurrency} at once`;

/** How a task that was not delivered ended, said once a run of several at once is over. */
export function taskEnded(position: QueuePosition, outcome: SlotOutcome): string {
  const which = `Task ${position.task} of ${position.of}`;
  return outcome === "escalated"
    ? `${which} needs your decision; the rest of the list carried on without it.`
    : `${which} stopped before it finished; the rest of the list carried on without it.`;
}
```

`src/cli/drive.ts`: add to `RunStart`:

```ts
  /** The id to give the run, when whoever starts it has already chosen one; otherwise one is made from the task and the second it started. */
  runId?: string;
```

and in `startRun` destructure `runId: chosenId` and use `const runId = chosenId ?? runIdFor(intent, new Date());`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli/run-location.test.ts src/cli/queue.test.ts src/cli/runs.test.ts src/cli/preview-command.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; every earlier `nextQueueTask` and `runIdFor` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/cli/run-location.ts src/cli/run-location.test.ts src/cli/queue.ts src/cli/queue.test.ts src/cli/drive.ts
git commit -m "Teach the queue about tasks already claimed, distinct ids, and list endings

Running several tasks at once needs the next-task rule to skip a task a
slot has already taken, a way to give two same-second tasks different ids
and branches, and one rule for the exit code and closing lines of a whole
list. Task identity stays what the task says; no list position is stored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `delivery run` works the list through the one scheduler

**Files:**
- Modify: `src/cli/queue.ts` (`runQueue`)
- Modify: `src/cli/run-command.test.ts` (new describe)
- Modify: `README.md`, `docs/provisioning.md`, `docs/multi-surface-control-flow.md`, `docs/writing-a-closer.md`
- Create: `.changeset/run-several-tasks-at-once.md`

**Interfaces:**
- Consumes: `supervise`, `Claim` (Task 6); `nextQueueTask(…, claimed)`, `listExitCode`, `runShape`, `taskEnded` (Task 7); `runIdFor(…, taken)`, `supervisedRunId`, `supervisedPlace`, `prepareRunDir` (Task 7 / existing); `RunStart.runId` (Task 7); `ctx.report.forTask`, `ctx.report.run` (Task 5); `ProjectSettings.concurrency` (Task 4); `loadRunFile`, `RunEntry` (Task 2, tests).
- Produces: `runQueue(tasks, project, { repoPath }, ctx)` with the same signature; behaviour at `concurrency: 1` identical to before.

- [ ] **Step 1: Write the failing tests** — add to `src/cli/run-command.test.ts` (imports: `loadRunFile` from `../run-file.js`; `type RunEntry` added to the `../schema.js` import; `allRuns` from `./runs.js`; `taskEnded` added to the `./queue.js` import; `type RunEventRecord, type SurfaceStepRecord` from `./report.js`):

```ts
describe("delivery run with several tasks at once", () => {
  // Distinct in their first five words, as in the list tests above.
  const PAGE = "add a hello function that greets a name, with a test";
  const SWAP = "write a goodbye function that farewells a name, with a test";
  const WAVE = "create a waving function that waves at a name, with a test";
  const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;

  const listRepo = (prefix: string, config: object) =>
    initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config) });
  const supervisedRoot = (repo: string) => join(repo, ".delivery", "supervised");

  /** The one run of several at once this repository holds. */
  async function theRunFile(repo: string) {
    const [only, ...others] = readdirSync(supervisedRoot(repo));
    expect(others).toEqual([]);
    if (only === undefined) throw new Error("no run of several tasks was recorded");
    return loadRunFile(join(supervisedRoot(repo), only));
  }
  const fillsOf = (history: RunEntry[]) =>
    history.filter((entry): entry is Extract<RunEntry, { t: "slot_fill" }> => entry.t === "slot_fill");

  it(
    "runs up to that many at once, fills a freed slot with the next task, and starts every line with its task",
    async () => {
      const repo = listRepo("run-command-several-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      const lines = stdout.trimEnd().split("\n");
      expect(lines[0]).toMatch(/^Starting run run-\d{8}T\d{6}Z: 3 tasks, up to 2 at once$/);
      expect(lines.at(-1)).toBe(EVERY_TASK_DONE);
      for (const line of lines.slice(1, -1)) expect(line).toMatch(/^\[[123]\/3\] /);
      for (const [index, task] of [PAGE, SWAP, WAVE].entries()) {
        expect(stdout).toContain(`[${index + 1}/3] Done: the change for "${task}" passed \`npm test\``);
      }

      const runFile = await theRunFile(repo);
      expect(runFile.header).toMatchObject({ repoPath: repo, concurrency: 2, tasks: 3 });
      // Both slots are taken before either is freed: the two tasks ran at the same time.
      expect(runFile.history.slice(0, 2).map((entry) => entry.t)).toEqual(["slot_fill", "slot_fill"]);
      expect(fillsOf(runFile.history).map((fill) => fill.taskDef)).toEqual([{ intent: PAGE }, { intent: SWAP }, { intent: WAVE }]);
      expect(runFile.outcome?.kind).toBe("drained");
      // Each task's own record is where it always was, one per task.
      expect(readdirSync(runsRoot(repo))).toHaveLength(3);
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n")).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "under --json prints only JSON, each line saying whether it is about the run or a task, and which task",
    async () => {
      const repo = listRepo("run-command-several-json-", { tasks: [PAGE, SWAP] });

      const { exitCode, stdout, stderr } = await delivery(["run", "--json", "--concurrency", "2"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as SurfaceStepRecord | RunEventRecord);
      expect(records[0]).toMatchObject({ scope: "run", state: "STARTED", done: false });
      expect(records.at(-1)).toMatchObject({ scope: "run", state: "DRAINED", done: true });
      const runId = records[0]?.runId;
      expect(runId).toMatch(/^run-\d{8}T\d{6}Z$/);

      const steps = records.filter((record): record is SurfaceStepRecord => record.scope === "surface");
      const taskIds = (await allRuns(repo)).map((record) => record.runId);
      for (const ordinal of [1, 2]) {
        const own = steps.filter((step) => step.surface.ordinal === ordinal);
        expect(own.length).toBeGreaterThan(0);
        for (const step of own) expect(step).toMatchObject({ runId, surface: { of: 2 } });
        const ids = new Set(own.map((step) => step.surface.id));
        expect(ids.size).toBe(1);
        expect(taskIds).toContain([...ids][0]);
        expect(own.at(-1)).toMatchObject({ state: "CLOSED", done: true });
      }
      expect(stderr).toMatch(/^Starting run run-\d{8}T\d{6}Z: 2 tasks, up to 2 at once$/m);
      expect(stderr).toMatch(/^\[1\/2\] Starting run /m);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "carries on past a task that needs a decision, filling its slot, and exits needing a decision",
    async () => {
      const repo = listRepo("run-command-several-escalated-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });
      const swapEscalates: MockScript = {
        expectations: [
          { when: { promptContains: SWAP }, json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
          ...completes.expectations,
        ],
      };

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(swapEscalates) } });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain(`[1/3] Done: the change for "${PAGE}"`);
      expect(stdout).toContain(`[3/3] Done: the change for "${WAVE}"`);
      expect(stdout).toContain("[2/3] This needs your decision:");
      expect(stdout.trimEnd().split("\n").at(-1)).toBe(taskEnded({ task: 2, of: 3 }, "escalated"));
      expect(stdout).not.toContain(EVERY_TASK_DONE);
      expect(fillsOf((await theRunFile(repo)).history)).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "passes over a task an earlier run delivered, and starts every other task exactly once",
    async () => {
      const repo = listRepo("run-command-several-skip-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });
      await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).not.toContain("[1/3]");
      expect(fillsOf((await theRunFile(repo)).history).map((fill) => fill.taskDef)).toEqual([{ intent: SWAP }, { intent: WAVE }]);
      expect(readdirSync(runsRoot(repo))).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "merges one of two tasks that finish together and hands the other back through the close path, leaving the checkout sound",
    async () => {
      const repo = listRepo("run-command-several-merge-", { tasks: [PAGE, SWAP], concurrency: 2, closer: { type: "merge-back" } });
      // Slow agents: both tasks have their working copies before either merges, so the base moves under the second.
      const slow: MockScript = { ...completes, delayMs: 1000 };

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(slow) } });

      expect(exitCode).toBe(EXIT.escalated);
      const runs = await allRuns(repo);
      expect(runs.map((record) => record.caseFile.outcome?.kind).sort()).toEqual(["closed", "escalated"]);
      const refused = runs.find((record) => record.caseFile.outcome?.kind === "escalated");
      expect(refused?.caseFile.history.some((entry) => entry.t === "close" && entry.status === "FAIL")).toBe(true);
      expect(stdout).toContain("is merged into main");
      // The shared checkout is as a person would want it: on main, clean, and holding only its own working copy.
      expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
      expect(git(repo, ["status", "--porcelain"])).toBe("");
      expect(git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "at concurrency 1, the default, keeps no record of its own and starts no line with a task tag",
    async () => {
      const repo = listRepo("run-command-several-default-", { tasks: [PAGE, SWAP] });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(existsSync(supervisedRoot(repo))).toBe(false);
      expect(stdout).not.toMatch(/^\[/m);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
    },
    RUN_TIMEOUT * 2,
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/cli/run-command.test.ts -t "several tasks at once"`
Expected: FAIL: the run is still worked one at a time, so there is no opening line, no tags and no `.delivery/supervised` folder (the concurrency-1 test passes already; it is the guard for Step 3).

- [ ] **Step 3: Rewrite `runQueue` in `src/cli/queue.ts`**

Imports become:

```ts
import { isDeepStrictEqual } from "node:util";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { RunHeader, SlotOutcome, TaskDef } from "../schema.js";
import { supervise } from "../supervisor.js";
import { agentSession } from "./agent-session.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { resumeRun, startRun } from "./drive.js";
import { EXIT, type ExitCode } from "./failures.js";
import { reportOutcome } from "./outcome.js";
import { prepareRunDir, runIdFor, supervisedPlace, supervisedRunId } from "./run-location.js";
import { allRuns, describeRun, newestFirst, type RunRecord } from "./runs.js";
import { taskIntent, type ProjectSettings } from "./settings.js";
```

Replace `runQueue` and its doc comment with:

```ts
/** A task a slot has taken from the list: where it sits, the run that already answers for it if any, and the id its run has or will have. */
interface QueueClaim {
  taskDef: TaskDef;
  surfaceId: string;
  position: QueuePosition;
  existing: RunRecord | undefined;
}

/** How a task's run ended, from the exit code its end was reported with. */
const slotOutcome = (exitCode: ExitCode): SlotOutcome =>
  exitCode === EXIT.ok ? "closed" : exitCode === EXIT.escalated ? "escalated" : "aborted";

/**
 * Work through the list, `project.concurrency` tasks at a time, each an
 * ordinary run with its own copy, branch and record. Progress is read from the
 * runs already on disk, afresh at every start, rather than remembered, so an
 * interruption anywhere leaves nothing stale and the next invocation works out
 * afresh what is left: a task with a finished run is passed over, one with a run
 * that stopped part way is picked up, and one with no run at all is started.
 *
 * One at a time (the default), the list waits on a task whose run ended without
 * being delivered, rather than skipping it, and stops there again next time for
 * the same reason; it keeps no record of its own and prints what it always did.
 * Several at once, a task that needs a decision frees its slot for the next one
 * and the rest carry on; the run gets its own id and record, every line says
 * which task it is about, and the end names each task that was not delivered.
 *
 * The agent runtime is checked when the first task actually needs it, and once
 * for the whole list: a list with nothing left to do, or one stopped on a task
 * that is waiting for a person, is a complete answer on a machine that has
 * never signed in, and saying so is more use than asking for a credential.
 */
export async function runQueue(
  tasks: TaskDef[],
  project: ProjectSettings,
  { repoPath }: { repoPath: string },
  ctx: CommandContext,
): Promise<ExitCode> {
  // One promise, not one session: slots that start together share one check rather than racing to make two.
  let session: Promise<SessionEnvironment> | undefined;
  const agent = (): Promise<SessionEnvironment> => (session ??= agentSession(ctx.env));

  const next = async (claimed: readonly QueueClaim[]): Promise<QueueClaim | undefined> => {
    const records = await allRuns(repoPath);
    const position = nextQueueTask(records, tasks, claimed.map((claim) => claim.taskDef));
    const taskDef = position === undefined ? undefined : tasks[position.task - 1];
    if (position === undefined || taskDef === undefined) return undefined;
    const existing = findQueueRun(records, taskDef);
    // A run started a moment ago by another slot may not be on disk yet, so its id counts as taken too.
    const taken = new Set([...records.map((record) => record.runId), ...claimed.map((claim) => claim.surfaceId)]);
    return { taskDef, position, existing, surfaceId: existing?.runId ?? runIdFor(taskIntent(taskDef), new Date(), taken) };
  };

  if ((await next([])) === undefined) {
    ctx.report.note(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const runId = project.concurrency > 1 ? supervisedRunId(new Date()) : undefined;

  const drive = async ({ taskDef, surfaceId, position, existing }: QueueClaim): Promise<SlotOutcome> => {
    const report =
      runId === undefined ? ctx.report : ctx.report.forTask({ runId, ordinal: position.task, of: position.of, id: surfaceId });
    const taskCtx: CommandContext = { ...ctx, report };
    // One at a time, a heading frames each task. Several at once, the tag says where it sits and the run's own
    // first line names the task, except for one that already ended, which is named here before it is retold.
    if (runId === undefined) report.note(taskHeading(position, taskIntent(taskDef)));
    else if (existing?.caseFile.outcome) report.note(describeRun(existing));

    const exitCode =
      existing === undefined
        ? await startRun({ repoPath, taskDef, runId: surfaceId, ...project }, await agent(), taskCtx)
        : existing.caseFile.outcome
          ? // What a run that already ended did, said again for whoever is looking at the list today rather than watching that run.
            await reportOutcome(existing.dir, existing.caseFile, taskCtx)
          : await resumeRun(existing, taskCtx, await agent());

    if (runId === undefined && exitCode !== EXIT.ok) report.note(listStopped(position, exitCode));
    return slotOutcome(exitCode);
  };

  let record: { dir: string; header: RunHeader } | undefined;
  if (runId !== undefined) {
    const dir = supervisedPlace(repoPath, runId);
    await prepareRunDir(repoPath, dir);
    record = { dir, header: { runId, repoPath, concurrency: project.concurrency, tasks: tasks.length } };
    ctx.report.note(runShape(runId, tasks.length, project.concurrency));
    ctx.report.run({ runId, state: "STARTED" });
  }

  const settled = await supervise({ slots: project.concurrency, next, drive, waitOnSetback: runId === undefined, record });

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
}
```

Also update the `nextQueueTask` doc comment's last sentence to "The same rule `runQueue` fills each slot by, so what `delivery preview` calls next is what a run does next." and `startQueue`'s doc comment in `src/cli/run-command.ts` is unchanged (it still hands the whole list to `runQueue`).

- [ ] **Step 4: Run the new tests and Item 9's list tests, unchanged**

Run: `npx vitest run src/cli/run-command.test.ts -t "several tasks at once|list of tasks" && npx vitest run src/cli/queue.test.ts tests/project-configuration/2-queue-several-tasks-in-plain-words-and-run-them-in-order.test.ts && npx tsc --noEmit && npx eslint src/cli/queue.ts src/cli/run-command.test.ts`
Expected: PASS. The Item 9 tests are the Operational note's proof that the one scheduler at concurrency 1 behaves exactly as the loop it replaced.

- [ ] **Step 5: Update the documentation**

`README.md`, "Work through a list of tasks": replace "It works down the list one task at a time, each as an ordinary run with its own branch and its own record, and says which task it is on:" with "By default it works down the list one task at a time, each as an ordinary run with its own branch and its own record, and says which task it is on:". After the paragraph ending "…stops in the same place until you deal with it.", add:

````markdown
To have several tasks worked on at the same time, add `"concurrency": 2` (or more) to the file,
or pass `--concurrency 2` for one run. Each task still gets its own copy, branch and record,
and as soon as one finishes the next task on the list starts in its place. Every line says
which task it is about:

```text
Starting run run-20260926T090000Z: 3 tasks, up to 2 at once
[1/3] Starting run add-a-page-that-shows-20260926T090000Z: add a page that shows who's on call today
[1/3] - setting up
[2/3] Starting run let-someone-swap-their-on-20260926T090000Z: let someone swap their on-call day with a teammate
[2/3] - setting up
…
[1/3] Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/add-a-page-that-shows-20260926T090000Z.
[3/3] Starting run send-a-reminder-the-morning-20260926T090412Z: send a reminder the morning before someone's on-call day starts
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
```

With several at once, a task that needs a decision from you does not hold up the others: its
place goes to the next task, and the run ends by naming each task that needs you. The exit code
is 0 only if every task was delivered, and 4 if any needs a decision. Setting up and removing
working copies, and merging finished work back, take turns in your checkout, so two tasks
finishing together both close properly; with the `merge-back` closer, the second one's merge is
refused because the first moved the base branch on, and it is handed back to you in the usual
way. Each run of several at once also keeps a small record of its own under
`.delivery/supervised/`.
````

In the `--json` section, after "…standard output is only ever JSON.", add:

```markdown
When several tasks run at once, each object also says what it is about: `"scope": "run"` for the
run starting and finishing, and `"scope": "surface"` for a task's step, with the run's id and a
`surface` object giving the task's place in the list, how many there are, and the task's own run
id. Every key is present, `null` where it does not apply.
```

`docs/provisioning.md`, "Supervisor tie-in": replace the numbered list and the sentence after it with:

```markdown
1. Works out the next task afresh: the first task on the list whose run has not been
   delivered and that no slot has taken in this run, found by what the task says
   (`findQueueRun`), never by a stored list position.
2. Records the slot fill in the run file (`slot_fill`: slot, surface id, task), then
   drives the surface, whose first step is provisioning.
3. Records `slot_free` with the surface's outcome when it ends.

Every git call against the shared checkout, `worktree add` and `remove`, `prune`,
`branch -D` and the close's merge, takes its turn by the folder it runs in
(`takeTurn` in `src/git-exec.ts`), so no two surfaces change the checkout's git
metadata at once; calls inside a surface's own worktree run in parallel.
```

(keep the paragraph "The slot assignment and the provisioning transition are the supervisor's commit point…" and the backpressure sentence). In "What provisioning owns" item 1, replace "runs inside the supervisor's repo-level lock" with "takes its turn with every other git call against the shared checkout".

`docs/multi-surface-control-flow.md`: delete the line `  queue_cursor                # position in the task queue` and after the invariants list add:

```markdown
- **No queue position is stored.** The next task is recomputed at every fill from the
  task list and the runs on disk (content identity, `findQueueRun`), skipping any task a
  slot has already taken in this run, because a checked-in list is edited between runs.
```

`docs/writing-a-closer.md`: add a section before "## When your closer goes wrong":

```markdown
## When several tasks close at once

With `concurrency` above 1, several tasks can reach their close at nearly the same time
against one checkout. Every git call the harness itself makes there takes its turn,
including every call the built-in closers make, so their merges never overlap. The
merge-back closer's `--ff-only` merge also checks the base afresh when it runs: if another
task moved the base on first, it reports `"FAIL"`, and triage and the `close` budget handle
it as for any close that failed.

A closer of your own that runs git in the shared checkout through its own child process is
outside that turn-taking. Write it so another task's git call landing between two of yours
cannot do harm: check the state you depend on in the same command that changes it, as
`merge --ff-only` does, rather than in an earlier one.
```

`.changeset/run-several-tasks-at-once.md`:

```markdown
---
"delivery-service": minor
---

A project can now have several tasks from its list worked on at the same time. Set
`concurrency` in `delivery.config.json`, or pass `--concurrency` or `DELIVERY_CONCURRENCY` for
one run, to say how many may run at once; the default stays 1, which works down the list exactly
as before. With more than one, `delivery run` starts that many tasks, each on its own copy with
its own branch and record, and starts the next task on the list as soon as one finishes. Every
line says which task it is about, such as `[2/10]`, and under `--json` every object carries a
`scope` of `run` or `surface`, with the task's place, the total and the run's id. A task that
needs a decision no longer holds up the others: its place goes to the next task, and the run ends
by naming each task that needs you, exiting 4. Setting up and removing working copies and merging
finished work take turns in the checkout, so two tasks finishing together both close properly.
`delivery validate` reports the setting, such as "up to 3 tasks at once (10 queued)", and refuses
a value that is not a whole number of 1 or more.
```

- [ ] **Step 6: Run the guide tests the docs touch**

Run: `npx vitest run tests/writing-a-closer-guide.test.ts tests/release.test.ts`
Expected: PASS (prose added outside any extracted code block; the changeset parses).

- [ ] **Step 6b: Run the whole suite once**

Run: `npm test` (lint, typecheck, build, then every test, including the UAT tests under `tests/` and any help-text or README assertions this slice's new flag and settings row could touch).
Expected: PASS. Any failure in a test this plan did not name is investigated as a behaviour change at concurrency 1, not patched over.

- [ ] **Step 7: Commit**

```bash
git add src/cli/queue.ts src/cli/run-command.test.ts README.md docs/provisioning.md docs/multi-surface-control-flow.md docs/writing-a-closer.md .changeset/run-several-tasks-at-once.md
git commit -m "Run several tasks from the list at once through one scheduler

The point of a list is throughput: most of a task's time is an agent
working on its own copy, so running several at once turns an afternoon's
list into an hour. runQueue now fills a slot pool, recording the run beside
the tasks' records and tagging every line with its task; at the default
concurrency of 1 it waits on a setback and prints exactly what it did before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
