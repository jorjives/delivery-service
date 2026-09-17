# Project Configuration — Slice 2: Queue Several Tasks in Plain Words and Run Them in Order

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** Let a `delivery.config.json` carry an ordered `tasks` list of plain sentences, and let one `delivery run` work down it — one ordinary run per entry, resumable, re-derived from the runs already on disk every time the command is typed.

**Architecture:** Three small pieces, no new machinery. (1) The existing `.strict()` `DeliveryConfig` gains a `tasks` array and one object-level refinement holding the two rules that make the list unambiguous: `task` and `tasks` are mutually exclusive, and no two entries may mean the same task. (2) A new `src/cli/queue.ts` answers "which run answers this entry?" by deep-equal content match against `header.taskDef` over the runs already in `.delivery/runs/` — no stored cursor, no new header field, no lock. (3) The driver is a `for` loop over the entries calling the two things the CLI already does for one run: start one, or pick one up. To make that loop possible without duplicating composition, `startRun`'s body moves from `src/cli/run-command.ts` into `src/cli/drive.ts` beside `resumeRun` and `driveToOutcome`, and `resolveSettings` splits into the project-wide part (check, closing action, limits, description) and the per-run task. Nothing inside `advance`, `driveToOutcome` or `resumeRun` changes.

**Tech Stack:** Node ≥ 22, TypeScript strict (Node16 ESM, `noUncheckedIndexedAccess`), zod 4, commander 14, vitest, git, `node:util`'s `isDeepStrictEqual` for content identity, the vendored `claude-mock` for run tests. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "The queue is an ordered list in the existing configuration file, not a queue engine or a second file. Turning a sentence into a task is a small deterministic step with no agent call. Which run answers for which entry is decided by comparing task content against existing run records, not by list position and not by a new field in the run record. The driver is a thin loop around the existing single-run start and resume; nothing inside the single-run machinery changes." So: no `queue-state.json`, no queue library, no agent call anywhere in structuring, no `CaseFileHeader` change, no edit to `src/surface.ts`, `src/case-file.ts` or `src/schema.ts`.
- **Operability / DX (this slice's Operational note, verbatim):** "Queue progress is never stored anywhere of its own; it is worked out afresh on every command from the records of the runs that already exist. There is no queue state file or lock to back up, migrate or repair, and a queue's history is inspected with the existing run listing." Honoured by Task 2 (progress is a pure function of `allRuns()` plus the file as written) and by adding no new inspection command: `delivery status --all` is the queue's history.
- **Spec, verbatim:** "`tasks`: an ordered array. Each entry is a bare string (sugar for `{ intent: <string> }`) or an `{ intent, ... }` object whose extra fields pass through untouched. `task` (Item 8, one-off) and `tasks` (queue) are mutually exclusive in one file."
- **Spec, verbatim:** "Duplicate detection is enforced once at load, in the same `superRefine` as the `task`/`tasks` mutual exclusion … enforcing that at load, rather than only inside the `validate` command, is what makes the guarantee hold for `run` too."
- **Spec, verbatim:** "only a closed run is skipped; an escalated or aborted match stops the queue and is named." And: "Several matching runs … the most recent run answers."
- **Spec, verbatim:** "`Task N of M` is recomputed from the file as currently written on every invocation; no count is stored."
- **Error model (spec):** every configuration problem exits `2` (`EXIT.configuration`); a queue stopped by escalation exits `4` and by an abort `5` — the codes a single run already uses, taken from `summariseOutcome` rather than re-derived.
- **Accessibility (spec):** no harness vocabulary in any message — never "worktree", "envelope", "surface", "case file", "role config" or schema terms. Refusals keep `describeProblem`'s house shape, "I can't use `<file>`: …", name the one thing wrong and state the fix.
- **Backwards compatibility (spec):** "Every Item 8 config parses unchanged; the queue path activates only when `tasks` is present." A file with no `tasks` behaves exactly as it did before this slice, and an explicit `--task` behaves exactly as before whatever the file holds.

## Scaffolding Impact

- `CONFIG_KEYS` (`src/cli/config.ts:15`), the user-facing sentence naming the settings a config file takes, gains `tasks` → updated in Task 1.
- `README.md` "Configure it once": the settings table gains a `tasks` row and the `task` row gains the mutual-exclusion sentence → updated in Task 1.
- `README.md` "Run a task from the command line": a new short section on running a list, since `delivery run` with no `--task` now has a second meaning → added in Task 3.
- `delivery run`'s own `--help` description in `src/cli/program.ts:80-81`, which today says only "start a run, or picks up a run that didn't finish" → updated in Task 3.
- `README.md` "See what happened to a run": the bullet list of what `status` says gains the list-position line → updated in Task 4.
- `.changeset/queue-tasks-in-plain-words.md`, this slice's release note, following the per-slice changeset convention (`.changeset/describe-your-project-once.md`) → added in Task 4.
- No other document needs changing. `docs/getting-started.md` and `examples/sample-project/README.md` describe the no-config first run and a single `--task` run, neither of which this slice alters; `docs/writing-a-gate.md`, `docs/writing-a-closer.md` and `docs/configuring-a-role.md` each describe one key this slice does not touch; the unified project-configuration guide and the second example project are slice 6's, not this slice's.
- No new command, environment variable, dependency or build/test/deploy step is introduced.

---

### Task 1: A list of tasks in the config file, and every refusal about it

**Files:**
- Modify: `src/cli/config.ts:14-15` (the `CONFIG_KEYS` sentence), `:56-76` (`QueueEntry`, `structureTask`, `DeliveryConfig` and its refinement), `:94-117` (`describeProblem`); `README.md` (the "Configure it once" table)
- Test: `src/cli/config.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `QueueEntry` (zod schema and type): `string | { intent: string; [key: string]: unknown }`, neither blank.
  - `structureTask(entry: QueueEntry): TaskDef` — a sentence becomes `{ intent: <trimmed sentence> }`; an object is returned as it is.
  - `DeliveryConfig` gains `tasks?: QueueEntry[]` (at least one entry) and refuses `task` + `tasks` together and two entries that structure to the same `TaskDef`.
  - `BOTH_TASK_AND_TASKS: string` and `sameTask(first: number, second: number): string` — the two refinement messages, exported so tests and later slices assert one copy of the wording.
  - `CONFIG_KEYS` becomes the six-setting sentence.

- [ ] **Step 1: Write the failing schema tests**

Add to `src/cli/config.test.ts`, inside the existing `describe("what a config file may contain")` block:

```ts
  it("accepts an ordered list of plain sentences", () => {
    const config = {
      tasks: [
        "add a page that shows who's on call today",
        "let someone swap their on-call day with a teammate",
      ],
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts a task written as an object, keeping the fields the harness has no use for", () => {
    const config = { tasks: [{ intent: "add a page that shows who's on call today", area: "billing", priority: 2 }] };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });
```

Add a new top-level block after it:

```ts
describe("turning what someone wrote into a task", () => {
  it("makes a sentence the same shape --task already makes, without its surrounding space", () => {
    expect(structureTask("  add a page that shows who's on call today  ")).toEqual({
      intent: "add a page that shows who's on call today",
    });
  });

  it("leaves a task object exactly as it was written", () => {
    const entry = { intent: "add a page that shows who's on call today", area: "billing" };
    expect(structureTask(entry)).toEqual(entry);
  });
});
```

Add to the existing `describe("what it says about a file it can't use")` block:

```ts
  it("refuses one task and a list of tasks in the same file, rather than guessing which was meant", () => {
    expect(problemFor({ task: { intent: "add a page" }, tasks: ["add a page"] })).toBe(
      "I can't use delivery.config.json: this project has both `task` and `tasks` set. Use `tasks` for a list of things to do, or `task` for a single one-off, not both.",
    );
  });

  it("names an empty list and both ways out", () => {
    expect(problemFor({ tasks: [] })).toBe(
      "I can't use delivery.config.json: `tasks` is empty. Add at least one sentence describing what you want done, or remove `tasks` and use `--task` for a single run.",
    );
  });

  it.each([[""], ["   "], ["\n\t "]])("names the item of the list that is empty, and the two ways out (%j)", (value) => {
    expect(problemFor({ tasks: ["add a page that shows who's on call today", value] })).toBe(
      "I can't use delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });

  it("names an empty task object's sentence the same way", () => {
    expect(problemFor({ tasks: [{ intent: "  ", area: "billing" }] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });

  it("names an entry that is neither a sentence nor a task object, quoting what was written", () => {
    expect(problemFor({ tasks: [42] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is `42`. Each one is a sentence describing what you want done, or an object with an `intent` sentence in it.",
    );
  });

  it("refuses two entries that are the same task, naming both and the fix", () => {
    expect(problemFor({ tasks: ["add a page", "swap a day", "add a page"] })).toBe(
      "I can't use delivery.config.json: tasks 1 and 3 are the same task, so I couldn't tell their runs apart. Reword one, or remove it.",
    );
  });

  it("treats a sentence and the object that means the same thing as one task", () => {
    expect(problemFor({ tasks: ["add a page", { intent: "add a page" }] })).toBe(
      "I can't use delivery.config.json: tasks 1 and 2 are the same task, so I couldn't tell their runs apart. Reword one, or remove it.",
    );
  });

  it("does not call two entries the same when one carries a field the other doesn't", () => {
    expect(DeliveryConfig.safeParse({ tasks: ["add a page", { intent: "add a page", area: "billing" }] }).success).toBe(true);
  });

  it("leads with the empty entry rather than the duplicate it also makes", () => {
    expect(problemFor({ tasks: ["  ", "  "] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });
```

Add to the existing `describe("reading a config file")` block, which is where the exit code is held:

```ts
  it("refuses a list with an empty item as it loads the file, with the configuration exit code", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ tasks: ["add a page", ""] }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
```

Then update the three existing assertions that spell out the settings a file takes:

```ts
  // was: "accepts exactly task, domain, gate, closer and budgets, …"
  it("accepts exactly task, tasks, domain, gate, closer and budgets, in the shapes the library already documents", () => {
```

```ts
  it("names an unknown top-level key, and what the file does take", () => {
    expect(problemFor({ closr: { type: "merge-back" } })).toBe(
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `tasks`, `domain`, `gate`, `closer` and `budgets`.",
    );
  });
```

```ts
  // in describe("reading a config file")
  it("refuses a file whose contents the harness can't use, naming the setting", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ closr: 1 }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: there's no setting called \`closr\`. A config file takes only \`task\`, \`tasks\`, \`domain\`, \`gate\`, \`closer\` and \`budgets\`.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
```

Finally, extend the import at the top of the file (line 5) so `structureTask` is in scope:

```ts
import { configCandidates, DeliveryConfig, describeProblem, loadConfig, NO_SUCH_CONFIG, structureTask, unknownCloser } from "./config.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL — `structureTask` is not exported (a type error as well), every `tasks` config is refused as an unknown setting, and the two unknown-key tests still read the five-setting sentence.

- [ ] **Step 3: Write the implementation**

In `src/cli/config.ts`, add the import of the deep comparison at the top, beside the other `node:` imports:

```ts
import { isDeepStrictEqual } from "node:util";
```

Change the settings sentence (lines 14-15):

```ts
/** The six keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `tasks`, `domain`, `gate`, `closer` and `budgets`";
```

Add the entry schema and the structuring step directly below the existing `Prose` definition (line 56):

```ts
/**
 * One thing a project wants done, as its owner wrote it: a sentence, or an
 * object carrying that sentence and anything else the project keeps beside it.
 * The extra fields mean nothing to the harness and are passed through
 * untouched, so a project can annotate its own list without asking permission.
 */
export const QueueEntry = z.union([Prose, z.looseObject({ intent: Prose })]);
export type QueueEntry = z.infer<typeof QueueEntry>;

/**
 * An entry as the run machinery takes it. A sentence becomes exactly the shape
 * `--task` already produces, so a listed task and an ad-hoc one of the same
 * words are one task; an object is already that shape and is returned as
 * written. Deterministic on purpose: this is what `validate` and `preview` must
 * be able to do with no agent, no spend and no credential.
 */
export function structureTask(entry: QueueEntry): TaskDef {
  return typeof entry === "string" ? { intent: entry.trim() } : entry;
}

export const BOTH_TASK_AND_TASKS =
  "this project has both `task` and `tasks` set. Use `tasks` for a list of things to do, or `task` for a single one-off, not both.";

export const sameTask = (first: number, second: number): string =>
  `tasks ${first} and ${second} are the same task, so I couldn't tell their runs apart. Reword one, or remove it.`;
```

Add the key to `DeliveryConfig` and hang the two whole-file rules off it. Note the refinement stays on the object after `.strict()`, so it reads as one schema and `DeliveryConfig.parse` keeps working as before:

```ts
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    // The things this project wants done, in the order it wants them. A list is
    // the project's own plan for itself; `task` is one thing done over and over.
    // Having both would leave `delivery run` with no honest answer, so the
    // refinement below refuses it.
    tasks: z.array(QueueEntry).min(1).optional(),
    domain: Prose.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.task && config.tasks) ctx.addIssue({ code: "custom", message: BOTH_TASK_AND_TASKS, path: ["tasks"] });
    // Which run answers which entry is decided by what the entry says, so two
    // entries that say the same thing would share one run and one of them could
    // never be done. Refused here, at load, so every command that reads the
    // file inherits the guarantee. A hand-written list is a handful of entries:
    // comparing each against the ones before it is not worth a lookup table.
    const structured = (config.tasks ?? []).map(structureTask);
    structured.forEach((taskDef, index) => {
      const first = structured.findIndex((earlier) => isDeepStrictEqual(earlier, taskDef));
      if (first !== index) ctx.addIssue({ code: "custom", message: sameTask(first + 1, index + 1), path: ["tasks"] });
    });
  });
```

In `describeProblem`, add the two branches directly after the `closer.type` line and before the `domain` one. The entry branch reads the value at the issue's own path, so it covers both a blank sentence (`tasks.1`) and a blank `intent` inside an object (`tasks.0.intent`) with one rule:

```ts
  if (issue.path[0] === "tasks" && issue.path.length > 1) {
    const item = Number(issue.path[1]) + 1;
    // A string that is there but says nothing is the one mistake worth its own
    // sentence, wherever in the entry it sits; anything else is an entry of the
    // wrong kind, quoted back whole.
    const offending = valueAt(raw, issue.path);
    if (typeof offending === "string" && offending.trim() === "") {
      return `I can't use ${file}: \`tasks\` item ${item} is empty. Add a sentence describing what you want done, or remove it.`;
    }
    return (
      `I can't use ${file}: \`tasks\` item ${item} is \`${JSON.stringify(valueAt(raw, issue.path.slice(0, 2)))}\`. ` +
      "Each one is a sentence describing what you want done, or an object with an `intent` sentence in it."
    );
  }
  if (where === "tasks") {
    // The whole-file rules say their own sentence; an array with nothing in it
    // is the only other way the key itself can be wrong.
    if (issue.code === "custom") return `I can't use ${file}: ${issue.message}`;
    return (
      `I can't use ${file}: \`tasks\` is empty. Add at least one sentence describing what you want done, ` +
      "or remove `tasks` and use `--task` for a single run."
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS, all of them. In particular "leads with the empty entry rather than the duplicate it also makes" holds because zod reports the array's own issues before the object-level refinement's, and `describeProblem` reports the first.

- [ ] **Step 5: Describe the setting in the README**

In `README.md`, under "Configure it once", add the `tasks` row immediately below the `task` row of the settings table, and replace the `task` row so the two are not read as combinable:

```markdown
| `task` | One thing you want done, when it is the same every run. Use this or `tasks`, not both. |
| `tasks` | A list of things you want done, in the order you want them, each a sentence in your own words. `delivery run` with no `--task` works down the list, one run at a time. Editing the list between runs is expected: a new entry runs in its place, a reworded entry is a new task, and an entry you delete leaves its run in the history. |
```

- [ ] **Step 6: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/config.ts src/cli/config.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts README.md
git commit -m "$(cat <<'EOF'
Let a config file carry a list of tasks in plain words

A project is more than one task, and the file it checks in is where its plan
belongs. Each entry is a sentence, or an object carrying that sentence and
whatever else the project keeps beside it. The two rules that make the list
unambiguous are enforced at load rather than in one command: a file cannot set
both `task` and `tasks`, and no two entries may mean the same task, because
which run answers which entry is decided by what the entry says.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Which run answers a task, and where that task sits in the list

**Files:**
- Create: `src/cli/queue.ts`, `src/cli/queue.test.ts`
- Modify: `src/cli/runs.ts` (gains `newestFirst`), `src/cli/status-command.ts:190-220` (loses it, imports it instead)

**Interfaces:**
- Consumes: `structureTask` and the `QueueEntry` type from Task 1; `RunRecord`, `allRuns` and `startedInstant` from `src/cli/runs.ts`.
- Produces:
  - `newestFirst(records: RunRecord[]): RunRecord[]` now exported from `src/cli/runs.ts` (unchanged behaviour, unchanged signature).
  - `interface QueuePosition { task: number; of: number }` — 1-based, as "Task N of M" prints it.
  - `queueTasks(config: DeliveryConfig): TaskDef[]` — the list as written, structured, in order. Empty for a config with no list.
  - `findQueueRun(records: RunRecord[], taskDef: TaskDef): RunRecord | undefined` — the run that answers for that task, the most recently started when several do.
  - `queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined`.

- [ ] **Step 1: Move `newestFirst` to where run records live**

`newestFirst` is about run records, not about `status`, and Task 3 needs it too; two callers in two files is the moment to put it where `allRuns`, `startedInstant` and `describeRun` already are. This is a move, not a rewrite: copy the function and its doc comment verbatim.

Cut from `src/cli/status-command.ts` (lines 190-204) and paste into `src/cli/runs.ts`, directly below `startedInstant`:

```ts
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
```

In `src/cli/status-command.ts`, add `newestFirst` to the existing import from `./runs.js`:

```ts
import { allRuns, describeRun, newestFirst, NOTHING_HERE, readableUtc, readRun, startedAt, startedInstant, type RunRecord } from "./runs.js";
```

- [ ] **Step 2: Check the move changed nothing**

Run: `npx tsc --noEmit && npx vitest run src/cli/status-command.test.ts src/cli/runs.test.ts`
Expected: PASS. If `tsc` reports `newestFirst` unused anywhere, the paste landed in the wrong place — it is exported from `runs.ts` and used by `status-command.ts`.

- [ ] **Step 3: Write the failing identity tests**

Create `src/cli/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import type { GateRef, TaskDef } from "../schema.js";
import { allRuns } from "./runs.js";
import { runsRoot } from "./run-location.js";
import { findQueueRun, queuePositionOf, queueTasks } from "./queue.js";

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const PAGE = "add a page that shows who's on call today";
const SWAP = "let someone swap their on-call day with a teammate";

/** One run's record on disk, started with exactly this task. Unfinished unless it is given an outcome. */
async function writeRun(repoPath: string, runId: string, taskDef: TaskDef, finished = false): Promise<void> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef, gateRef: GATE, closerRef: { type: "commit-to-branch" } }, DEFAULT_BUDGETS);
  if (finished) await setOutcome(dir, { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" });
}

const scratchRepo = () => mkdtemp(join(tmpdir(), "queue-"));

describe("the tasks a project's list asks for", () => {
  it("is empty for a project that listed none", () => {
    expect(queueTasks({})).toEqual([]);
  });

  it("keeps the order they were written in, whatever shape each was written in", () => {
    expect(queueTasks({ tasks: [PAGE, { intent: SWAP, area: "rota" }] })).toEqual([{ intent: PAGE }, { intent: SWAP, area: "rota" }]);
  });
});

describe("which run answers for a task", () => {
  it("finds none when nothing has ever run here", async () => {
    expect(findQueueRun(await allRuns(await scratchRepo()), { intent: PAGE })).toBeUndefined();
  });

  it("matches on what the task says, not on where it sits in the list", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    await writeRun(repo, "let-someone-swap-20260917T100000Z", { intent: SWAP });
    const records = await allRuns(repo);

    expect(findQueueRun(records, { intent: PAGE })?.runId).toBe("add-a-page-20260917T090000Z");
    expect(findQueueRun(records, { intent: SWAP })?.runId).toBe("let-someone-swap-20260917T100000Z");
  });

  it("finds nothing for a task whose wording was changed, which is how a finished task is run again", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    expect(findQueueRun(await allRuns(repo), { intent: `${PAGE}, with a test` })).toBeUndefined();
  });

  it("tells two tasks apart by every field they carry, not by their sentence alone", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE, area: "rota" }, true);
    const records = await allRuns(repo);

    expect(findQueueRun(records, { intent: PAGE, area: "rota" })?.runId).toBe("add-a-page-20260917T090000Z");
    expect(findQueueRun(records, { intent: PAGE })).toBeUndefined();
  });

  it("lets the most recently started run answer when several were started for the same task", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    await writeRun(repo, "add-a-page-20260917T140000Z", { intent: PAGE });
    expect(findQueueRun(await allRuns(repo), { intent: PAGE })?.runId).toBe("add-a-page-20260917T140000Z");
  });
});

describe("where a task sits in the list as it is written now", () => {
  it("counts from one, out of however many are listed", () => {
    const tasks = queueTasks({ tasks: [PAGE, SWAP, "send a reminder the morning before"] });
    expect(queuePositionOf(tasks, { intent: SWAP })).toEqual({ task: 2, of: 3 });
  });

  it("moves with the entry when the list is reordered", () => {
    const tasks = queueTasks({ tasks: [SWAP, PAGE] });
    expect(queuePositionOf(tasks, { intent: PAGE })).toEqual({ task: 2, of: 2 });
  });

  it("says nothing about a task the list no longer asks for", () => {
    expect(queuePositionOf(queueTasks({ tasks: [SWAP] }), { intent: PAGE })).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/cli/queue.test.ts`
Expected: FAIL — `./queue.js` does not exist.

- [ ] **Step 5: Write the identity half of `src/cli/queue.ts`**

Create `src/cli/queue.ts` with the pure part only; the driver arrives in Task 3:

```ts
import { isDeepStrictEqual } from "node:util";
import type { TaskDef } from "../schema.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import { newestFirst, type RunRecord } from "./runs.js";

/** Where a task sits in the list as it is written now, counted from one, which is how "Task N of M" reads. */
export interface QueuePosition {
  task: number;
  of: number;
}

/** Everything this project's list asks for, in the order it was written. */
export function queueTasks(config: DeliveryConfig): TaskDef[] {
  return (config.tasks ?? []).map(structureTask);
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

/** Where a task sits in the list as it is written now, or nothing when the list no longer asks for it. */
export function queuePositionOf(tasks: TaskDef[], taskDef: TaskDef): QueuePosition | undefined {
  const index = tasks.findIndex((task) => isDeepStrictEqual(task, taskDef));
  return index === -1 ? undefined : { task: index + 1, of: tasks.length };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/queue.test.ts`
Expected: PASS.

- [ ] **Step 7: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/queue.ts src/cli/queue.test.ts src/cli/runs.ts src/cli/status-command.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/queue.ts src/cli/queue.test.ts src/cli/runs.ts src/cli/status-command.ts
git commit -m "$(cat <<'EOF'
Work out which run answers for which listed task

A list that is checked in gets edited: entries are inserted, reordered, trimmed
and reworded between runs. Anything remembering positions would skip or repeat
a task the first time that happened, so progress is derived instead, by
comparing what an entry says against the task each run pinned when it started.
Nothing is stored, so there is no queue state to repair. `newestFirst` moves
beside the other run-record helpers now that a second caller needs it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Walking the list

**Files:**
- Modify: `src/cli/settings.ts:33-39` (`Settings` splits), `:141-157` (`resolveSettings` splits); `src/cli/drive.ts` (gains `startRun`); `src/cli/queue.ts` (gains the driver and its wording); `src/cli/run-command.ts` (whole file: dispatch); `src/cli/program.ts:79-81` (the `run` description); `README.md` (a new section)
- Test: `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `queueTasks`, `findQueueRun`, `QueuePosition` from Task 2; `structureTask` and the `tasks` key from Task 1.
- Produces:
  - `interface ProjectSettings { gateRef: GateRef; closerRef: CloserRef; budgets: BudgetSet; domainPrompt?: string }` in `src/cli/settings.ts`, and `interface Settings extends ProjectSettings { taskDef: TaskDef }`.
  - `resolveProject(flags: RunFlags, { env, repoPath, config }): Promise<ProjectSettings>` — everything a run needs except what it is being asked to do. `resolveSettings` keeps its exact signature and return type and is now that plus the task.
  - `startRun(start: RunStart, session: SessionEnvironment, ctx: CommandContext): Promise<ExitCode>` in `src/cli/drive.ts`, where `interface RunStart extends ProjectSettings { repoPath: string; taskDef: TaskDef }`.
  - `resumeRun(record, ctx, session?)` — one optional third argument, so a caller that has already checked the agent can start does not check again.
  - `runQueue(tasks: TaskDef[], project: ProjectSettings, { repoPath }: { repoPath: string }, ctx): Promise<ExitCode>` in `src/cli/queue.ts`, with `taskHeading`, `listStopped` and `EVERY_TASK_DONE` beside it. It checks the agent runtime itself, once, and only when a task actually needs an agent.

- [ ] **Step 1: Write the failing end-to-end tests**

Add a new top-level block to `src/cli/run-command.test.ts`, after `describe("delivery run with a config file")`:

```ts
describe("delivery run with a list of tasks", () => {
  const PAGE = "add a function that says hello to a name, with a test";
  const SWAP = "add a function that says goodbye to a name, with a test";

  it(
    "works down the list, one ordinary run at a time, saying which task it is on",
    async () => {
      const repo = initTempRepo("run-command-queue-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(stdout).toContain(`Task 2 of 2: ${SWAP}`);
      expect(stdout).toContain(`Done: the change for "${PAGE}" passed \`npm test\``);
      expect(stdout).toContain(`Done: the change for "${SWAP}" passed \`npm test\``);
      expect(stdout).toContain(EVERY_TASK_DONE);
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
      // The list is the order of visiting: task 1 is announced before task 2.
      expect(stdout.indexOf("Task 1 of 2")).toBeLessThan(stdout.indexOf("Task 2 of 2"));
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "runs exactly the task the command line named and leaves the list alone",
    async () => {
      const repo = initTempRepo("run-command-queue-adhoc-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });

      const { exitCode, stdout } = await delivery(["run", "--task", "add a function that shouts, with a test"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).not.toContain("Task 1 of");
      expect(readdirSync(runsRoot(repo))).toHaveLength(1);
    },
    RUN_TIMEOUT,
  );

  it(
    "picks the unfinished task up where it stopped, then carries on down the list",
    async () => {
      const repo = initTempRepo("run-command-queue-resume-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      const interrupted = await interruptedRun(repo, state, { task: PAGE, steps: 3, worker: writesHello });

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(stdout).toContain(`Resuming run ${interrupted}`);
      expect(stdout).toContain(`Task 2 of 2: ${SWAP}`);
      // One record for the task it picked up, one for the task it went on to.
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
    },
    RUN_TIMEOUT * 2,
  );

  it("says every task is done, and starts nothing, when each one already has a finished run", async () => {
    const repo = initTempRepo("run-command-queue-done-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;
    await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260917T100000Z", task: SWAP, outcome: closed });

    // No scripted agent and no credential: a list with nothing left to do is an
    // answer this command can give without one.
    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(EVERY_TASK_DONE);
    expect(readdirSync(runsRoot(repo))).toHaveLength(2);
  });

  it("stops at a task that needs a decision, names it, and stops at the same one next time", async () => {
    const repo = initTempRepo("run-command-queue-escalated-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    await writeRunRecord(repo, {
      runId: "add-a-hello-20260917T090000Z",
      task: PAGE,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: "2026-09-17T09:05:00.000Z" },
      packet: ESCALATION,
    });

    const first = await delivery(["run"], { cwd: repo });
    const second = await delivery(["run"], { cwd: repo });

    for (const attempt of [first, second]) {
      expect(attempt.exitCode).toBe(EXIT.escalated);
      expect(attempt.stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(attempt.stdout).toContain(`This needs your decision: ${ESCALATION.decision}`);
      expect(attempt.stdout).toContain("Task 1 of 2 needs your decision before I can go on, so I've left the rest of the list alone.");
      expect(attempt.stdout).not.toContain("Task 2 of 2");
    }
    // Nothing was started for the task behind it, either time.
    expect(readdirSync(runsRoot(repo))).toEqual(["add-a-hello-20260917T090000Z"]);
  });

  it("stops at a task whose run was stopped, with the exit code a stopped run already uses", async () => {
    const repo = initTempRepo("run-command-queue-aborted-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    await writeRunRecord(repo, {
      runId: "add-a-hello-20260917T090000Z",
      task: PAGE,
      outcome: { kind: "aborted", source: "close", reason: "the closing action failed", at: "2026-09-17T09:05:00.000Z" },
    });

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.aborted);
    expect(stdout).toContain("Task 1 of 2 stopped before it finished, so I've left the rest of the list alone.");
    expect(stdout).not.toContain("Task 2 of 2");
  });

  it("refuses a file that sets both one task and a list, before anything is set up", async () => {
    const repo = initTempRepo("run-command-queue-both-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ task: { intent: PAGE }, tasks: [PAGE] }),
    });

    const { exitCode, stderr } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("this project has both `task` and `tasks` set.");
    expect(existsSync(join(repo, ".delivery", "runs"))).toBe(false);
  });
});
```

Extend the imports at the top of `src/cli/run-command.test.ts`: `ESCALATION`, `writeRunRecord` and `runsRoot` join the existing `./command-fixtures.js` import, and `EVERY_TASK_DONE` comes from the new module:

```ts
import { branchIn, completes, delivery, ESCALATION, PACKAGE, RUN_TIMEOUT, runsRoot, TASK, scriptFile, writeRunRecord } from "./command-fixtures.js";
import { EVERY_TASK_DONE } from "./queue.js";
```

(`existsSync`, `readdirSync`, `mkdtempSync`, `tmpdir` and `join` are already imported at the top of that file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/run-command.test.ts -t "delivery run with a list of tasks"`
Expected: FAIL — `EVERY_TASK_DONE` is not exported (a type error too), and `delivery run` with no `--task` refuses with "Tell me what to do" because nothing reads the list.

- [ ] **Step 3: Split the project's settings from the run's task**

In `src/cli/settings.ts`, replace the `Settings` interface (lines 33-39) with the pair:

```ts
/** What a project asks of every run of it: how work is checked, what happens to it, how many attempts a setback gets, and what the project is. */
export interface ProjectSettings {
  gateRef: GateRef;
  closerRef: CloserRef;
  budgets: BudgetSet;
  /** What this project is, from the config file, pinned into the run when it starts. Absent when the project didn't say. */
  domainPrompt?: string;
}

/** Everything a run needs to be created: what this one is being asked to do, and everything the project asks of all of them. */
export interface Settings extends ProjectSettings {
  taskDef: TaskDef;
}
```

and replace `resolveSettings` (lines 141-157) with the two functions. The comments move with the code they explain:

```ts
/**
 * What every run of this project uses, from every source that has a say: a flag
 * beats an environment variable, which beats the config file, which beats the
 * built-in default. Everything that can refuse does so here, before any run's
 * record or working copy exists. Separate from the task because a list of tasks
 * resolves this once and then asks it of each entry in turn.
 */
export async function resolveProject(
  flags: RunFlags,
  { env, repoPath, config }: { env: NodeJS.ProcessEnv; repoPath: string; config: DeliveryConfig },
): Promise<ProjectSettings> {
  return {
    gateRef: await gateFrom(flags, env, config, repoPath),
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
    // Only the file can say what the project is: it is prose about the
    // repository, not something a person retypes per run, so there is no flag
    // and no environment variable to lay over it.
    domainPrompt: config.domain,
  };
}

/** What one run will use: what it is being asked to do, and everything its project asks of every run. */
export async function resolveSettings(
  flags: RunFlags,
  {
    env,
    intent,
    repoPath,
    config,
  }: { env: NodeJS.ProcessEnv; intent: string | undefined; repoPath: string; config: DeliveryConfig },
): Promise<Settings> {
  return { taskDef: taskFrom(intent, config), ...(await resolveProject(flags, { env, repoPath, config })) };
}
```

- [ ] **Step 4: Move starting a run beside picking one up**

In `src/cli/drive.ts`, widen the imports it already has rather than adding second ones for the same modules — the file already imports `load` from `../case-file.js`, `runPlace` from `./run-location.js` and three names from `./settings.js`:

```ts
import { create, load } from "../case-file.js";
import type { TaskDef } from "../schema.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import { checkCustomModules, DEFAULT_CLOSER, taskIntent, type ProjectSettings } from "./settings.js";
```

Add, directly above `driveToOutcome`:

```ts
/** A run about to exist: what it is being asked to do, and everything its project asks of every run. */
export interface RunStart extends ProjectSettings {
  repoPath: string;
  taskDef: TaskDef;
}

/**
 * Start one run and drive it to its end: give it an id from its own words and
 * the second it began, write its record, and say so before the first step,
 * because setting up is the slowest part and a person watching should not wait
 * in silence for it. Everything that can refuse — the check, the closing
 * action, the agent runtime — has already refused by the time this is called,
 * so from here on there is a record on disk for whatever happens next.
 */
export async function startRun(
  { repoPath, taskDef, gateRef, closerRef, budgets, domainPrompt }: RunStart,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef, domainPrompt }, budgets);
  ctx.report.note(`Starting run ${runId}: ${intent}`);
  ctx.report.step({ state: "PROVISIONING", done: false });
  return driveToOutcome({ runId, repoPath, dir, caseFile }, session, ctx);
}
```

And let `resumeRun` be handed a session that has already passed the preflight, so walking a list checks the agent runtime once rather than once per task:

```ts
export async function resumeRun(record: RunRecord, ctx: CommandContext, session?: SessionEnvironment): Promise<ExitCode> {
  const { header } = record.caseFile;
  await checkCustomModules(header.gateRef, header.closerRef ?? DEFAULT_CLOSER, record.repoPath);
  const started = session ?? (await agentSession(ctx.env));
  ctx.report.note(`Resuming run ${record.runId}: ${taskIntent(header.taskDef)}`);
  ctx.report.note(pickingUp(record.caseFile));
  return driveToOutcome(record, started, ctx);
}
```

- [ ] **Step 5: Write the driver**

Add to `src/cli/queue.ts`, below the pure functions. Its import block becomes the following in full — `allRuns` joins the existing `./runs.js` import rather than making a second one:

```ts
import { isDeepStrictEqual } from "node:util";
import type { SessionEnvironment } from "../agent-invoke.js";
import type { TaskDef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { structureTask, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { resumeRun, startRun } from "./drive.js";
import { EXIT, type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { allRuns, newestFirst, type RunRecord } from "./runs.js";
import { taskIntent, type ProjectSettings } from "./settings.js";
```

```ts
/** Which task of how many this is, in the owner's own words, around the step lines a single run already prints. */
export const taskHeading = (position: QueuePosition, intent: string): string =>
  `Task ${position.task} of ${position.of}: ${intent}`;

export const EVERY_TASK_DONE =
  "Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.";

/**
 * Why the rest of the list was left alone. The harness never decides on the
 * owner's behalf that a later task matters more than a decision this one is
 * waiting for, so there is no skipping: the way past a stopped task is to deal
 * with it, or to reword the entry.
 */
export function listStopped(position: QueuePosition, exitCode: ExitCode): string {
  const which = `Task ${position.task} of ${position.of}`;
  return exitCode === EXIT.escalated
    ? `${which} needs your decision before I can go on, so I've left the rest of the list alone.`
    : `${which} stopped before it finished, so I've left the rest of the list alone.`;
}

/** What a run that already ended did, said again for whoever is looking at the list today rather than watching that run. */
async function retell(record: RunRecord, ctx: CommandContext): Promise<ExitCode> {
  const summary = await summariseOutcome(record.dir, record.caseFile);
  ctx.report.outcome(summary);
  return summary.exitCode;
}

/**
 * Work down the list, one ordinary run at a time. Progress is read from the
 * runs already on disk rather than remembered, so an interruption anywhere
 * leaves nothing stale and the next invocation works out afresh what is left:
 * a task with a finished run is passed over, one with a run that stopped part
 * way is picked up, and one with no run at all is started.
 *
 * A task whose run ended without being delivered stops the list where it is,
 * rather than being skipped, and stops it again next time for the same reason.
 * Only the runs that existed when this invocation began are considered: the
 * list holds no two entries that mean the same task, so a run started for one
 * entry can never answer for another.
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
  const records = await allRuns(repoPath);
  let session: SessionEnvironment | undefined;
  const agent = async (): Promise<SessionEnvironment> => {
    session ??= await agentSession(ctx.env);
    return session;
  };

  for (const [index, taskDef] of tasks.entries()) {
    const existing = findQueueRun(records, taskDef);
    if (existing?.caseFile.outcome?.kind === "closed") continue;

    const position: QueuePosition = { task: index + 1, of: tasks.length };
    ctx.report.note(taskHeading(position, taskIntent(taskDef)));
    const exitCode =
      existing === undefined
        ? await startRun({ repoPath, taskDef, ...project }, await agent(), ctx)
        : existing.caseFile.outcome
          ? await retell(existing, ctx)
          : await resumeRun(existing, ctx, await agent());

    if (exitCode !== EXIT.ok) {
      ctx.report.note(listStopped(position, exitCode));
      return exitCode;
    }
  }

  ctx.report.note(EVERY_TASK_DONE);
  return EXIT.ok;
}
```

- [ ] **Step 6: Dispatch to it from the run command**

Replace the body of `src/cli/run-command.ts` below its imports with the three paths. The config file is now read before anything else is decided, because whether this invocation is a list or a single run is something only the file can say:

```ts
import { resolve } from "node:path";
import type { CommandContext } from "./context.js";
import { resumeRun, startRun } from "./drive.js";
import { agentSession } from "./agent-session.js";
import { loadConfig, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { queueTasks, runQueue } from "./queue.js";
import { chooseRun, unfinishedRuns, unfinishedRunFound } from "./runs.js";
import {
  checkCustomModules,
  explicitIntent,
  ignoredNote,
  ignoredSettings,
  resolveProject,
  resolveSettings,
  taskIntent,
  type RunFlags,
} from "./settings.js";

export { NO_TASK } from "./settings.js";

/** What `delivery run` was given on the command line: the flags the settings resolver reads, and nothing else. */
export type RunOptions = RunFlags;

/**
 * `delivery run`: work down the project's list of tasks, or pick up the run
 * that didn't finish, or start a new one.
 *
 * The project's file is read first, because a list of tasks is the project's
 * own plan for itself and only the file can say there is one. A task named on
 * the command line is something a person is asking for right now, so it wins:
 * it runs on its own and the list is left alone.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const intent = await explicitIntent(options, ctx.env, ctx.cwd);
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  if (intent === undefined && config.tasks) return startQueue(options, { repoPath, config }, ctx);

  const unfinished = options.fresh ? [] : await unfinishedRuns(repoPath);
  const [mostRecent] = unfinished;
  if (mostRecent) {
    // A task the user typed settles which run they mean without asking; anything
    // else would resume a run they did not name.
    const resuming =
      intent === undefined
        ? await chooseRun(unfinished, ctx)
        : unfinished.find((record) => taskIntent(record.caseFile.header.taskDef) === intent);
    if (!resuming) throw new Refusal(unfinishedRunFound(mostRecent), EXIT.configuration);
    const ignored = ignoredSettings(options, ctx.env, resuming.caseFile.header);
    if (ignored.length > 0) ctx.report.note(ignoredNote(ignored));
    return resumeRun(resuming, ctx);
  }
  return startOne(options, { repoPath, intent, config }, ctx);
}

/**
 * Work down the project's list. What the whole list shares is settled once
 * here — the check, the closing action, the limits, the description, and the
 * modules those name — and the list itself decides when an agent is first
 * needed, so a list with nothing left to do answers without one.
 */
async function startQueue(
  options: RunOptions,
  { repoPath, config }: { repoPath: string; config: DeliveryConfig },
  ctx: CommandContext,
): Promise<ExitCode> {
  const project = await resolveProject(options, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  return runQueue(queueTasks(config), project, { repoPath }, ctx);
}

/** Start one run: work out what it should do from the project's config file, the flags and the environment, check the agent can start, then drive it. */
async function startOne(
  options: RunOptions,
  { repoPath, intent, config }: { repoPath: string; intent: string | undefined; config: DeliveryConfig },
  ctx: CommandContext,
): Promise<ExitCode> {
  const settings = await resolveSettings(options, { env: ctx.env, intent, repoPath, config });
  await checkCustomModules(settings.gateRef, settings.closerRef, repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  return startRun({ repoPath, ...settings }, session, ctx);
}
```

`driveToOutcome` is no longer named here — the two callers that still need it are inside `drive.ts` — which is why it is absent from the import above.

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts -t "delivery run with a list of tasks"`
Expected: PASS.

- [ ] **Step 8: Run the tests around what was moved**

The settings split, the `startRun` move and reading the config file earlier all touch paths other tests hold. Run exactly those files:

Run: `npx vitest run src/cli/run-command.test.ts src/cli/settings.test.ts src/cli/resume-command.test.ts`
Expected: PASS. If "refuses a run with no task, saying how to give one" fails, the `tasks` branch is being taken for a config that has none: the dispatch reads `config.tasks`, not `queueTasks(config).length`, so an absent list is absent rather than empty.

- [ ] **Step 9: Say what the command does now, in the help and the README**

In `src/cli/program.ts`, the `run` command's description (lines 79-81) gains the list:

```ts
    .description("work down the list of tasks in your config file, or start a single run, or pick up a run that didn't finish: the agent works on the task, your check decides whether it is good, and the result is delivered the way your config file asks (by default, committed to a new branch)")
```

In `README.md`, after the "Run a task from the command line" section and before "Pick up a run that was interrupted", add the following (the outer fence below is four backticks, so the three-backtick blocks inside it are part of what you paste):

````markdown
## Work through a list of tasks

Put the things you want done in your `delivery.config.json`, in the order you want them:

```json
{
  "tasks": [
    "add a page that shows who's on call today",
    "let someone swap their on-call day with a teammate",
    "send a reminder the morning before someone's on-call day starts"
  ]
}
```

Then:

```bash
delivery run
```

It works down the list one task at a time, each as an ordinary run with its own branch and its
own record, and says which task it is on:

```text
Task 1 of 3: add a page that shows who's on call today
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
Done: the change for "add a page that shows who's on call today" passed `npm test` and is
committed on branch surface/add-a-page-that-shows-20260917T090000Z.

Task 2 of 3: let someone swap their on-call day with a teammate
…
```

Run it again whenever you like: it works out where it got to from the runs already in the
repository, so an interrupted list picks up the task it was on and carries on from there. A task
that needs a decision from you stops the list there rather than skipping past it, and running the
command again stops in the same place until you deal with it.

The list is yours to edit between runs. A new entry anywhere runs in its place; reordering
changes only the order they are visited in; deleting an entry leaves its run in the history; and
rewording an entry makes it a new task, which is also how you deliberately run a finished task
again. `delivery run --task "..."` always runs exactly that one task and leaves the list alone.
````

- [ ] **Step 10: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/queue.ts src/cli/drive.ts src/cli/run-command.ts src/cli/settings.ts src/cli/program.ts`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/cli/queue.ts src/cli/drive.ts src/cli/run-command.ts src/cli/settings.ts src/cli/program.ts src/cli/run-command.test.ts README.md
git commit -m "$(cat <<'EOF'
Work down a project's list of tasks, one run at a time

The driver is a loop around the two things the command already does for one
run, so nothing inside a run changes: each entry gets an ordinary run of its
own, with its own record and its own branch. Starting a run moves beside
picking one up, and a project's settings separate from the one thing a run is
asked to do, which is what lets the loop resolve the first once and the second
per entry. Everything that can refuse still refuses once, before the first task
is set up.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `delivery status` says which task of how many

**Files:**
- Modify: `src/cli/status-command.ts` (`statusReport`, `statusDocument`, `RunStatusDocument`, `statusCommand`); `README.md` (the "See what happened to a run" bullets)
- Create: `.changeset/queue-tasks-in-plain-words.md`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `queueTasks`, `queuePositionOf` and `QueuePosition` from Task 2; `loadConfig` from `src/cli/config.ts`.
- Produces: `statusReport(record, ctx, position?: QueuePosition)` and `statusDocument(record, ctx, position?: QueuePosition)` — one optional third argument each, so both stay pure over what they are given. `RunStatusDocument` gains `queue: QueuePosition | null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/status-command.test.ts`, as its own top-level block:

```ts
describe("a run that answers for a task on the project's list", () => {
  it("says which task of how many it is", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const lines = await statusReport(await readRun(repo, RUN_ID), ctx, { task: 2, of: 3 });

    expect(lines[1]).toBe("It is task 2 of 3 on your list.");
  });

  it("says nothing of the kind about a run the list doesn't ask for", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-none-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const lines = await statusReport(await readRun(repo, RUN_ID), ctx);

    expect(lines.join("\n")).not.toContain("on your list");
  });

  it("carries the same position in the machine-readable document, and a null when there is none", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-json-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const record = await readRun(repo, RUN_ID);

    expect((await statusDocument(record, ctx, { task: 2, of: 3 })).queue).toEqual({ task: 2, of: 3 });
    expect((await statusDocument(record, ctx)).queue).toBeNull();
  });

  it("works the position out from the project's file as it is written now", async () => {
    const repo = initTempRepo("status-queue-command-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: ["something else entirely", TASK] }),
    });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const { exitCode, stdout } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("It is task 2 of 2 on your list.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "answers for a task on the project's list"`
Expected: FAIL — `statusReport` and `statusDocument` take two arguments (a type error), and nothing prints a position.

- [ ] **Step 3: Write the implementation**

In `src/cli/status-command.ts`, add the imports:

```ts
import { loadConfig } from "./config.js";
import { queuePositionOf, queueTasks, type QueuePosition } from "./queue.js";
```

Give `statusReport` the optional position, and print it directly under the opening line, where it reads as part of saying which run this is:

```ts
export async function statusReport(record: RunRecord, ctx: CommandContext, position?: QueuePosition): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const opening = [
    `Run ${runId}, started ${startedAt(runId)}: ${taskIntent(caseFile.header.taskDef)}`,
    ...(position ? [`It is task ${position.task} of ${position.of} on your list.`] : []),
  ];
  const { outcome } = caseFile;

  if (!outcome) {
    return [
      ...opening,
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStepPhrase(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }

  const summary = await summariseOutcome(dir, caseFile);
  const finished = [
    ...opening,
    paint(ctx.colour, summary.tone, summary.headline),
    `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`,
  ];
```

(the rest of the function is unchanged; only `opening` became a list and is spread rather than listed.)

Add the field to `RunStatusDocument`, below `outcome`'s inherited fields and above `state`:

```ts
  /** Where this run's task sits in the project's list as it is written now, or null when the list doesn't ask for it. */
  queue: QueuePosition | null;
```

and set it in `statusDocument`:

```ts
export async function statusDocument(record: RunRecord, ctx: CommandContext, position?: QueuePosition): Promise<RunStatusDocument> {
```

```ts
  return {
    ...runSummary(record),
    queue: position ?? null,
    state: caseFile.cursor.state,
```

Then work the position out once in `statusCommand`, for the single-run path only — `--all` is a history of everything this repository has ever run, which is not a question about the list:

```ts
/** Where this run's task sits in the project's list as it is written now. Nothing for a run the list doesn't ask for, and for a project with no list. */
async function positionOf(record: RunRecord, startDir: string, ctx: CommandContext): Promise<QueuePosition | undefined> {
  const config = await loadConfig({ startDir, repoPath: record.repoPath, flag: undefined, env: ctx.env });
  return queuePositionOf(queueTasks(config), record.caseFile.header.taskDef);
}
```

```ts
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  // Before the repository is even looked for: a usage mistake is the same
  // mistake wherever it was typed, and hearing about the folder first would
  // send the reader after the wrong problem.
  if (options.all && runId !== undefined) throw new Refusal(ALL_AND_ONE, EXIT.configuration);
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  if (options.all) return listRuns(repoPath, ctx);
  const record = runId === undefined ? await mostRecent(repoPath) : await readRun(repoPath, runId);
  const position = await positionOf(record, startDir, ctx);
  // Indented rather than one line: a person reads this output too, and a parser does not mind.
  if (ctx.json) ctx.writeLine(JSON.stringify(await statusDocument(record, ctx, position), null, 2));
  else for (const line of await statusReport(record, ctx, position)) ctx.writeLine(line);
  return EXIT.ok;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS, the whole file: the existing tests call `statusReport`/`statusDocument` with two arguments and get exactly what they got before.

- [ ] **Step 5: Say so in the README**

In `README.md`, under "See what happened to a run", add a line below the four "What you get depends on how the run ended" bullets:

```markdown
If the run's task is on your `tasks` list, it also says which task of how many it is, worked out
from the list as it is written now.
```

and, in the paragraph listing what `--json` carries, add the position to the sentence:

```markdown
It carries the run id, the task, where that task sits on your list, when it started and finished,
how it ended, the sentences the plain-language report prints about it, the branch, the base
branch, where the run's record is, and, for a run that stopped for a decision, every field of the
escalation packet.
```

- [ ] **Step 6: Write the changeset**

Create `.changeset/queue-tasks-in-plain-words.md`:

```markdown
---
"delivery-service": minor
---

A project can now list what it wants done, in plain words, and have the harness work down the
list. A `tasks` list in `delivery.config.json` holds a sentence per thing to do, or an object
carrying that sentence and any fields of your own; `delivery run` with no `--task` runs the first
task with no finished run, then the next, each as an ordinary run with its own branch and its own
record, announced as "Task N of M" in your own wording. Progress is worked out afresh every time
from the runs already in the repository, so an interrupted list picks up the task it was on and
carries on, and the list is yours to edit in between: a new entry runs in its place, reordering
changes only the order they are visited in, deleting one leaves its run in the history, and
rewording one makes it a new task, which is also how a finished task is deliberately run again. A
task that needs a decision, or whose run stopped, stops the list there and stops there again next
time, with the exit code a single run already uses. A file that sets both `task` and `tasks`, an
empty list, an empty entry or two entries meaning the same task is refused before anything runs.
`delivery status` says which task of how many a run is, and `delivery run --task "..."` still
runs exactly that one task and leaves the list alone.
```

- [ ] **Step 7: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/status-command.ts src/cli/status-command.test.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/queue-tasks-in-plain-words.md
git commit -m "$(cat <<'EOF'
Say which task of how many a run answers for

Someone reading a run's report days later needs to know where it sits in the
project's plan, and the answer is only ever the list as it is written now, so
it is worked out at the moment of reading rather than stored on the run. The
listing of every run stays a plain history: it answers a question about the
repository, not about the list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Do not touch `src/surface.ts`, `src/case-file.ts` or `src/schema.ts`.** The queue adds no field to a run's record and changes nothing about how a run advances. If you find yourself wanting `CaseFileHeader.queueIndex`, the identity rule has been misread: which run answers an entry is decided by comparing what the entry says with the task the run pinned.
- **`--fresh` has no meaning when a list is being walked, and is left alone.** It exists to start a new run alongside one that didn't finish, which is a question about a single ad-hoc task; the list's own rule is content identity, and its way of asking for a task to run again is to reword the entry. The spec offers no other, and inventing one here would be a second re-trigger mechanism.
- **An unfinished run the list doesn't ask for is not picked up by `delivery run` with a list present.** It stays exactly where it is, resumable by `delivery resume <run-id>`, which is what the spec's edit table promises for an entry that was deleted.
- **Reading the config file moved to the top of `runCommand`.** That is deliberate: a file setting both `task` and `tasks`, or holding two entries that mean the same thing, must be refused by every command that reads it, including a `delivery run` that would otherwise have gone straight to picking up an unfinished run. Every existing test passes a config file that parses, so nothing regresses.
- **`ctx.report.note` is the right channel for the "Task N of M" line.** Under `--json` the step stream on standard output must stay one JSON object per line; the notes stream is where "Starting run …" and "Resuming run …" already go.
- **`NO_TASK` is left exactly as it is.** With a list present it can never fire, and a project with neither a task nor a list is in precisely the situation Item 8 wrote that sentence for. The README is where the list is discovered; a second thing to try in a one-line refusal would make it worse, not better.
- **Watch the import direction.** `queue.ts` imports from `config.ts`, `drive.ts`, `outcome.ts`, `runs.ts` and `settings.ts`; nothing imports `queue.ts` except `run-command.ts` and `status-command.ts`. If you find yourself importing `run-command.ts` from `queue.ts`, starting a run has not been moved into `drive.ts`.
- **Duplicate detection is O(n²) and that is fine.** A hand-written list is a handful of entries; a hash of `JSON.stringify` would be wrong anyway, because two objects with the same fields in a different order are the same task and `isDeepStrictEqual` knows it.
