# Multi-Surface Supervisor — Slice 2: Test Your Setup With Several Tasks Running Together

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** A harness extender drives several scripted tasks through the real supervisor against one temporary repository, with a chosen number of slots and an order of events forced by reply delays, and gets each task's result, case file and journal back through `delivery-service/testing`.

**Architecture:** One new module, `src/scripted-supervisor-run.ts`, exports `runSupervisorAgainstMock`. It sits beside `src/scripted-surface-run.ts` and is built from two existing pieces with no new mechanism: `supervise()` (src/supervisor.ts, the same slot launcher `delivery run` uses above `concurrency: 1`) fills the slots in list order, and each slot's `drive` is a plain call to the existing single-task runner `runSurfaceAgainstMock`, which already creates the case file, writes the task's own script and journal, and runs the production driver with the real agent port, gate and closer resolution and provisioning. The per-folder git turn (`takeTurn` inside `git()`, slice 1) already serialises every shared-checkout git call, so the runner adds no locking. Order is forced only by each task's `MockScript.delayMs`. `docs/testing-your-pipeline.md` gains a "Testing several tasks at once" section whose worked example is run as a test by `tests/testing-your-pipeline-guide.test.ts`.

**Tech Stack:** TypeScript (Node ≥22, ES2024), vitest 5, the vendored `claude-mock` (`vendor/claude-mock`) via `mockSessionEnvironment`, `node:test` for the guide's worked example.

## Global Constraints

- Node ≥22; `noUncheckedIndexedAccess` is on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new runtime or dev dependency.
- `src/testing.ts` is the public testing entry point (`delivery-service/testing`); only the testing API is exported from it, and `src/testing.test.ts` pins its exact export list.
- Tests are offline: no network, no API key; every agent session is the vendored `claude-mock`.
- User-facing copy (the guide, README, changeset, error messages): controlled British English, plain words, no em-dashes (the guide test asserts `—` is absent), colons/semicolons/commas instead.
- **Buy-vs-build (Build note):** reuse the existing scripted mock (`MockScript`, `writeMockScript`, `readJournal`, `mockSessionEnvironment`), its script vocabulary and its per-reply `delayMs` to force an order of events. Do not add a second mocking vocabulary, an interleaving DSL, or any new synchronisation primitive (no barriers, latches, hooks into `supervise` or the surface). The multi-task runner sits beside `runSurfaceAgainstMock`, calls it for each task, and so uses the real provisioning, check and closer resolution unchanged. `supervise()` is used as-is; `surface.ts`, the closers and `provision.ts` are not changed.
- **Operability/DX (Operational note):** `docs/testing-your-pipeline.md` gains a section on testing several tasks at once; like the rest of the guide, its worked example is staged verbatim and run by `tests/testing-your-pipeline-guide.test.ts`, and type-checked with the guide's other snippets, so the guide cannot drift from the product.
- Decisions taken for this slice (unattended run, right-vs-easy): the runner creates each task's case folder and working-copy path itself under one scratch folder (N callers' `mkdir` boilerplate is not the extender's job) and returns each task's `dir` so the case file stays readable with `load(dir)`; results come back in list order, not finish order, so a test names tasks by position or `surfaceId` independent of timing; budgets, role configurations and triage are run-wide (as they are across one project's list) while each task brings its own `header` and `script`; `slots` that is not a whole number ≥ 1, or two tasks sharing a `surfaceId`, is refused before anything runs, because either would otherwise run nothing, or collide on one branch, with a confusing result far from the mistake. The supervisor's run record (`record`) is not written: nothing in this slice reads it, and slice 3 owns resume.

## Scaffolding Impact

- **Reactive:** `src/testing.test.ts` pins the testing entry point's export list; it gains `runSupervisorAgainstMock` → Task 1.
- **Inherited (Operational note):** `docs/testing-your-pipeline.md` gains "## Testing several tasks at once" with a worked example `several-tasks.test.ts`, and two rows in "## When the test itself is wrong"; `tests/testing-your-pipeline-guide.test.ts` runs, type-checks and quotes them → Task 2.
- **Reactive:** `CONTRIBUTING.md`'s paragraph on `runSurfaceAgainstMock` gains the multi-task runner, so contributors reach for it instead of hand-wiring `supervise` in tests → Task 2.
- **Reactive:** `README.md`'s documentation list line for the testing guide says it covers one task or several → Task 2.
- **Proactive:** `.changeset/test-several-tasks-at-once.md` (every user-visible change gets a changeset in this repo; a new public testing export is one) → Task 2.
- **Proactive (DX):** no new command, env var or script. The runner is verified by its own vitest file (`src/scripted-supervisor-run.test.ts`) against the vendored mock, run with `npx vitest run <file>`; the guide test needs `dist/`, so its step builds first (`npm run build`), as `npm test` does.
- `docs/multi-surface-control-flow.md`, the design spec, `CLAUDE.md`: none. No documented behaviour of the product changes; the spec's §13 already names `scripted-supervisor-run.ts`.

---

### Task 1: Run several scripted tasks through the supervisor from the testing entry point ✅ DONE (deliver-slice)

**Files:**
- Create: `src/scripted-supervisor-run.ts`
- Create: `src/scripted-supervisor-run.test.ts`
- Modify: `src/testing.ts` (add two export lines)
- Modify: `src/testing.test.ts` (export list)

**Interfaces:**
- Consumes (existing, unchanged):
  - `supervise<C extends Claim>({ slots, next, drive, waitOnSetback, record? }: Supervision<C>): Promise<Settled<C>[]>` and `interface Claim { taskDef: TaskDef; surfaceId: string }` from `src/supervisor.ts`
  - `runSurfaceAgainstMock(input: ScriptedSurfaceRun): Promise<ScriptedSurfaceResult>` and `interface ScriptedSurfaceResult { result: RunResult; journal: JournalEvent[] }` from `src/scripted-surface-run.ts`
  - `RoleConfigs` (src/agent-invoke.ts), `MockScript` (src/mock-script.ts), `AgentPort`, `TriagePort` (src/ports.ts), `BudgetSet`, `CloserRef`, `CreateHeader`, `SlotOutcome` (src/schema.ts)
- Produces (exported from `src/testing.ts`, used by Task 2):
  - `runSupervisorAgainstMock(input: ScriptedSupervisorRun): Promise<ScriptedTaskResult[]>`: results in the order `input.tasks` lists them
  - `interface ScriptedTask { header: CreateHeader & { closerRef: CloserRef }; script: MockScript }`
  - `interface ScriptedSupervisorRun { repoPath: string; slots: number; tasks: ScriptedTask[]; budgets: BudgetSet; roleConfigs: RoleConfigs; triage: (agent: AgentPort) => TriagePort }`
  - `interface ScriptedTaskResult extends ScriptedSurfaceResult { surfaceId: string; dir: string }`
  - Refusal messages (quoted verbatim by Task 2's guide):
    - `slots must be a whole number of 1 or more, but was ${slots}.` (a `RangeError`)
    - `Each scripted task needs its own surfaceId, but "${id}" is used more than once: a task's branch and working copy are named after it.` (an `Error`)

- [ ] **Step 1: Write the failing tests**

Create `src/scripted-supervisor-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { load, readRef } from "./case-file.js";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { deterministicRouter } from "./router.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { CloseReport } from "./schema.js";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSupervisorAgainstMock } from "./testing.js";
import type { ScriptedTask, ScriptedTaskResult } from "./testing.js";
import type { BudgetSet, CloserRef, GateRef } from "./schema.js";

// Caps of 1 keep a task that cannot close short: one refused close, one retry, then escalation.
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 1 },
  gateMaintenance: { used: 0, max: 1 },
  terminus: { used: 0, max: 1 },
  close: { used: 0, max: 1 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

/**
 * How much longer the second task's agent takes to answer. Both working copies
 * are made as the run starts; the gap must outlast one agent session starting
 * and the first task's check and merge, even on a busy machine.
 */
const STAGGER_MS = 2000;

/** A task whose agent waits `delayMs`, writes `<name>.txt` and reports completion. */
function task(name: string, delayMs: number): ScriptedTask {
  return {
    header: { surfaceId: name, taskDef: { intent: `add a ${name} file` }, gateRef, closerRef },
    script: {
      delayMs,
      expectations: [
        {
          effects: [{ write: { path: `${name}.txt`, content: `${name}\n` } }],
          json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: `wrote ${name}.txt` }),
        },
      ],
    },
  };
}

const scratchRepo = (): string => initTempRepo("scripted-supervisor-repo-", { "report.tap": "1..1\nok 1 - greets\n" });

const runTasks = (repoPath: string, slots: number, tasks: ScriptedTask[]): Promise<ScriptedTaskResult[]> =>
  runSupervisorAgainstMock({ repoPath, slots, tasks, budgets, roleConfigs, triage: () => deterministicRouter });

function resultFor(results: ScriptedTaskResult[], surfaceId: string): ScriptedTaskResult {
  const found = results.find((ran) => ran.surfaceId === surfaceId);
  if (found === undefined) throw new Error(`no result for ${surfaceId}`);
  return found;
}

describe("runSupervisorAgainstMock", () => {
  it("with one slot, runs the tasks one after another in list order, whatever their delays, and both land", async () => {
    const repoPath = scratchRepo();
    // The first task is the slow one: if the two ran together, the second would merge first and the first be refused.
    const tasks = [task("hello", STAGGER_MS), task("goodbye", 0)];

    const results = await runTasks(repoPath, 1, tasks);

    expect(results.map((ran) => [ran.surfaceId, ran.result.state])).toEqual([
      ["hello", "CLOSED"],
      ["goodbye", "CLOSED"],
    ]);
    expect(git(repoPath, ["show", "main:hello.txt"])).toBe("hello");
    expect(git(repoPath, ["show", "main:goodbye.txt"])).toBe("goodbye");
  });

  it("gives each task its own journal: only its own prompts, and only its own script used", async () => {
    const repoPath = scratchRepo();
    const tasks = [task("hello", 0), task("goodbye", STAGGER_MS)];

    const results = await runTasks(repoPath, 2, tasks);

    for (const [index, { script, header }] of tasks.entries()) {
      const ran = results[index];
      expect(ran?.surfaceId).toBe(header.surfaceId);
      const journal = ran?.journal ?? [];
      assertFullyConsumed(journal, script);
      const prompts = promptsSent(journal);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(`add a ${header.surfaceId} file`);
    }
    expect(promptsSent(resultFor(results, "hello").journal).join("\n")).not.toContain("add a goodbye file");
  });

  it.each([
    { first: "hello", second: "goodbye" },
    { first: "goodbye", second: "hello" },
  ])(
    "with two slots, $first answering first is merged and $second is refused because the base moved on",
    async ({ first, second }) => {
      const repoPath = scratchRepo();
      const delayOf = (name: string): number => (name === first ? 0 : STAGGER_MS);
      // List order is the same both times: only the delays decide who reaches the merge first.
      const results = await runTasks(repoPath, 2, [task("hello", delayOf("hello")), task("goodbye", delayOf("goodbye"))]);

      const merged = resultFor(results, first);
      const refused = resultFor(results, second);
      expect(merged.result.state).toBe("CLOSED");
      expect(refused.result.state).toBe("ESCALATED");

      const closes = (await load(refused.dir)).history.flatMap((entry) => (entry.t === "close" ? [entry] : []));
      expect(closes.length).toBeGreaterThan(0);
      for (const close of closes) {
        expect(close.status).toBe("FAIL");
        expect(CloseReport.parse(await readRef(refused.dir, close.detailRef)).detail).toContain("main has moved on");
      }

      expect(git(repoPath, ["show", `main:${first}.txt`])).toBe(first);
      expect(() => git(repoPath, ["show", `main:${second}.txt`])).toThrow();
      // The refused work is kept on its own branch for a person to bring up to date.
      expect(git(repoPath, ["show", `surface/${second}:${second}.txt`])).toBe(second);
      expect(git(repoPath, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    },
  );

  it.each([0, -1, 1.5])("refuses %s slots before anything runs", async (slots) => {
    const repoPath = scratchRepo();

    await expect(runTasks(repoPath, slots, [task("hello", 0)])).rejects.toThrow(
      `slots must be a whole number of 1 or more, but was ${slots}.`,
    );
    expect(git(repoPath, ["branch", "--list", "surface/*"])).toBe("");
  });

  it("refuses two tasks with one surfaceId before anything runs", async () => {
    const repoPath = scratchRepo();

    await expect(runTasks(repoPath, 2, [task("hello", 0), task("hello", 0)])).rejects.toThrow(
      `Each scripted task needs its own surfaceId, but "hello" is used more than once: a task's branch and working copy are named after it.`,
    );
    expect(git(repoPath, ["branch", "--list", "surface/*"])).toBe("");
  });
});
```

In `src/testing.test.ts`, add `"runSupervisorAgainstMock"` to the sorted export list, between `"readJournal"` and `"runSurfaceAgainstMock"`:

```ts
    expect(Object.keys(testing).sort()).toEqual([
      "assertFullyConsumed",
      "expectEnvelope",
      "fakeAgentPort",
      "mockSessionEnvironment",
      "promptsSent",
      "readJournal",
      "runSupervisorAgainstMock",
      "runSurfaceAgainstMock",
      "writeMockScript",
    ]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/scripted-supervisor-run.test.ts src/testing.test.ts`
Expected: FAIL. In `src/scripted-supervisor-run.test.ts`, `runSupervisorAgainstMock` is not yet exported by `./testing.js`, so vitest binds it as `undefined` and every case fails with a `TypeError` (`runSupervisorAgainstMock is not a function`), including the refusal cases, whose `rejects.toThrow(...)` sees a synchronous throw rather than the expected message; `src/testing.test.ts` fails on the export list missing `runSupervisorAgainstMock`.

- [ ] **Step 3: Write the implementation**

Create `src/scripted-supervisor-run.ts`:

```ts
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoleConfigs } from "./agent-invoke.js";
import type { MockScript } from "./mock-script.js";
import type { AgentPort, TriagePort } from "./ports.js";
import type { BudgetSet, CloserRef, CreateHeader, SlotOutcome } from "./schema.js";
import { runSurfaceAgainstMock, type ScriptedSurfaceResult } from "./scripted-surface-run.js";
import { supervise, type Claim } from "./supervisor.js";

/** One task in a scripted run of several: what it is, and what its own agent does. */
export interface ScriptedTask {
  /** The task, with the gate and closer named as data. `surfaceId` names its branch and working copy, so no two tasks may share one. */
  header: CreateHeader & { closerRef: CloserRef };
  /**
   * What this task's agent does and replies, read by this task's sessions only.
   * `delayMs` is how long it waits before each reply, which is how a test decides
   * which task reaches a step first.
   */
  script: MockScript;
}

/** Several scripted tasks against one repository, and the settings every one of them shares, as one project's list does. */
export interface ScriptedSupervisorRun {
  /** A real git repository every task branches from and closes into. */
  repoPath: string;
  /** How many tasks may run at once, as `concurrency` is for `delivery run`. */
  slots: number;
  /** Started in this order as slots free up. */
  tasks: ScriptedTask[];
  budgets: BudgetSet;
  roleConfigs: RoleConfigs;
  /** As for `runSurfaceAgainstMock`: built once per task, from that task's scripted agent port. */
  triage: (agent: AgentPort) => TriagePort;
}

/** How one task ended, where its case file is, and what its own agent was sent and used. */
export interface ScriptedTaskResult extends ScriptedSurfaceResult {
  surfaceId: string;
  /** The task's case file folder, for `load(dir)`. */
  dir: string;
}

interface ScriptedClaim extends Claim {
  task: ScriptedTask;
  /** The task's own scratch folder: its case file and working copy live here. */
  root: string;
}

/**
 * Run several scripted tasks through the harness's own supervisor, `slots` at a
 * time, against one repository: each task is `runSurfaceAgainstMock` in a slot,
 * with the production driver, agent port, gate and closer resolution and
 * provisioning, unchanged, and git calls in the shared checkout taking turns as
 * in a live run. Nothing here orders events: which task reaches a step first is
 * decided by its script's `delayMs` alone.
 *
 * Results come back in the order `tasks` lists them, whichever finished first.
 * As with one task, whether each script was fully used is not checked here:
 * call `assertFullyConsumed(result.journal, task.script)`.
 */
export async function runSupervisorAgainstMock({
  repoPath,
  slots,
  tasks,
  budgets,
  roleConfigs,
  triage,
}: ScriptedSupervisorRun): Promise<ScriptedTaskResult[]> {
  if (!Number.isInteger(slots) || slots < 1) {
    throw new RangeError(`slots must be a whole number of 1 or more, but was ${slots}.`);
  }
  const ids = tasks.map(({ header }) => header.surfaceId);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new Error(
      `Each scripted task needs its own surfaceId, but "${repeated}" is used more than once: a task's branch and working copy are named after it.`,
    );
  }

  const scratch = await mkdtemp(join(tmpdir(), "scripted-supervisor-"));
  const claims: ScriptedClaim[] = tasks.map((task, index) => ({
    taskDef: task.header.taskDef,
    surfaceId: task.header.surfaceId,
    task,
    root: join(scratch, `task-${index + 1}`),
  }));
  const results = new Map<string, ScriptedTaskResult>();

  await supervise<ScriptedClaim>({
    slots,
    // Every task here is new, so the next is simply the next one listed.
    next: (claimed) => Promise.resolve(claims[claimed.length]),
    drive: async ({ task, root, surfaceId }) => {
      const dir = join(root, "case");
      await mkdir(dir, { recursive: true });
      const ran = await runSurfaceAgainstMock({
        ...task,
        dir,
        location: { repoPath, worktreePath: join(root, "worktree") },
        budgets,
        roleConfigs,
        triage,
      });
      results.set(surfaceId, { ...ran, surfaceId, dir });
      return slotOutcome(surfaceId, ran);
    },
    // A task that needs a decision frees its slot for the next, as a run of several does.
    waitOnSetback: false,
  });

  // supervise drives every claim or throws, so each task has a result.
  return claims.flatMap(({ surfaceId }) => results.get(surfaceId) ?? []);
}

function slotOutcome(surfaceId: string, { result }: ScriptedSurfaceResult): SlotOutcome {
  if (result.outcome === undefined) throw new Error(`${surfaceId} ended at ${result.state} without a recorded outcome.`);
  return result.outcome.kind;
}
```

In `src/testing.ts`, after the two `scripted-surface-run.js` lines, add:

```ts
export { runSupervisorAgainstMock } from "./scripted-supervisor-run.js";
export type { ScriptedSupervisorRun, ScriptedTask, ScriptedTaskResult } from "./scripted-supervisor-run.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/scripted-supervisor-run.test.ts src/testing.test.ts`
Expected: PASS (all cases, including both orderings of the two-slot case).

- [ ] **Step 5: Confirm the ordering is repeatable**

The slice requires the same test to give the same result every time. Run the two-slot cases five times back to back:

Run: `for i in 1 2 3 4 5; do npx vitest run src/scripted-supervisor-run.test.ts -t "with two slots" || break; done`
Expected: five PASS runs, no failure. If any run fails because the slower task merged first, raise `STAGGER_MS` (in steps of 1000) rather than adding any synchronisation, and re-run this step.

- [ ] **Step 6: Lint and type-check the changed files**

Run: `npx eslint src/scripted-supervisor-run.ts src/scripted-supervisor-run.test.ts src/testing.ts src/testing.test.ts && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/scripted-supervisor-run.ts src/scripted-supervisor-run.test.ts src/testing.ts src/testing.test.ts
git commit -m "Add runSupervisorAgainstMock to run several scripted tasks at once

An extender cannot trust concurrency they cannot test cheaply and repeatably.
This runs several scripted tasks through the real supervisor against one
repository, each slot an ordinary runSurfaceAgainstMock call, with the order
of events decided only by each script's existing delayMs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Teach testing several tasks at once in the guide, run as a test ✅ DONE (deliver-slice)

**Files:**
- Modify: `docs/testing-your-pipeline.md` (new section before `## When a reply ends as incomplete`; two rows in `## When the test itself is wrong`)
- Modify: `tests/testing-your-pipeline-guide.test.ts`
- Modify: `CONTRIBUTING.md` (the `runSurfaceAgainstMock` paragraph)
- Modify: `README.md:385` (documentation list line)
- Create: `.changeset/test-several-tasks-at-once.md`

**Interfaces:**
- Consumes: `runSupervisorAgainstMock`, `ScriptedTask`, `ScriptedTaskResult` from `delivery-service/testing` (Task 1), with its two refusal messages verbatim; `load`, `readRef`, `deterministicRouter`, role configs, `DEFAULT_BUDGETS` and the types `BudgetSet`, `CloseReport`, `CloserRef`, `GateRef` from `delivery-service`.
- Produces: the guide snippet `several-tasks.test.ts` (fenced ```` ```ts ```` block whose first line is `// several-tasks.test.ts`, which `snippetFrom` finds) and the section heading `## Testing several tasks at once`.

- [ ] **Step 1: Write the failing guide tests**

In `tests/testing-your-pipeline-guide.test.ts`:

1. Extend the imports:

```ts
import { DEFAULT_BUDGETS, DID_NOT_COMPLETE, deterministicRouter, gateMaintenanceRoleConfig, triageRoleConfig, workerRoleConfig } from "../src/index.js";
import {
  assertFullyConsumed,
  expectEnvelope,
  fakeAgentPort,
  runSupervisorAgainstMock,
  type JournalEvent,
  type MockScript,
  type ScriptedTask,
} from "../src/testing.js";
```

(replacing the existing `import { DID_NOT_COMPLETE, workerRoleConfig } from "../src/index.js";` and `import { assertFullyConsumed, expectEnvelope, fakeAgentPort, type JournalEvent, type MockScript } from "../src/testing.js";` lines).

2. In `"type-checks every snippet it tells a reader to save"`, change the list to:

```ts
    for (const name of ["fake-agent.ts", "happy-path.test.ts", "misbehaviour.test.ts", "several-tasks.test.ts"]) stage(name);
```

3. At the end of `"quotes each authoring mistake's message exactly as the testing API words it"`, before its closing `});`, add:

```ts
    const wrongSetup = (slots: number, tasks: ScriptedTask[]): Promise<string> =>
      runSupervisorAgainstMock({
        repoPath: "/nowhere",
        slots,
        tasks,
        budgets: DEFAULT_BUDGETS,
        roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
        triage: () => deterministicRouter,
      }).then(() => "", (err: unknown) => (err as Error).message);
    const hello: ScriptedTask = {
      header: { surfaceId: "hello", taskDef: { intent: "add a hello file" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" }, closerRef: { type: "merge-back" } },
      script: { expectations: [] },
    };
    const noSlots = await wrongSetup(0, [hello]);
    expect(noSlots).toMatch(/slots/);
    expect(wrong).toContain(noSlots);
    const sharedId = await wrongSetup(2, [hello, hello]);
    expect(sharedId).toMatch(/surfaceId/);
    expect(wrong).toContain(sharedId);
```

(The guard refuses before the gate is ever resolved or the repository touched, so a placeholder gate and a missing `repoPath` are fine here.)

4. After the `"runs its worked misbehaviour test as written, and both cases pass"` test, add:

```ts
  it("explains how to choose which of several tasks reaches a step first", () => {
    const several = sectionOf(guide, "## Testing several tasks at once", "## When a reply ends as incomplete");
    for (const term of [
      "`runSupervisorAgainstMock`",
      "`slots`",
      "`delayMs`",
      "`concurrency`",
      "own `journal`",
      "`surface/<surfaceId>`",
      "`main has moved on`",
      "Swap the two delays",
    ]) {
      expect(several).toContain(term);
    }
  });

  it("runs its worked several-tasks test as written, and it passes", () => {
    const stdout = runWorkedTest("several-tasks.test.ts");
    expect(stdout).toContain(
      "✔ two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on",
    );
    expect(stdout).toContain("ℹ pass 1");
  }, 60_000);
```

- [ ] **Step 2: Run the guide test to verify it fails**

Run: `npm run build && npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: FAIL. `snippetFrom` throws "the guide has no ```ts block starting with // several-tasks.test.ts" in the type-check and run cases; the section case finds no `## Testing several tasks at once`; the authoring-mistake case fails `expect(wrong).toContain(noSlots)`.

- [ ] **Step 3: Write the guide section**

In `docs/testing-your-pipeline.md`, insert this section immediately before `## When a reply ends as incomplete`:

````markdown
## Testing several tasks at once

When `delivery run` has several tasks going at once, they share one
repository: each task's working copy is made from it, and each task's finished
work is merged back into it. `runSupervisorAgainstMock` runs several scripted
tasks through the harness's own supervisor, the one `delivery run` uses when
`concurrency` is above 1, against one scratch repository, so you can prove your
gate and closer behave when tasks finish together.

Each task brings its own `header` and its own `script`, so each task's agent
does only what its own script says. `slots` is how many tasks may run at once,
as `concurrency` is for `delivery run`. The budgets, role configurations and
triage are shared by every task, as they are across one project's list.

**Choosing which task gets there first.** A script's `delayMs` is how long its
agent waits before each reply. Tasks that start together have their working
copies made before any agent answers, so the task whose agent answers first
reaches the merge first. Give the task you want second a delay a couple of
seconds longer than the first: each agent session takes a moment to start, and
the gap has to outlast that. Nothing else decides the order, so the same test
gives the same result every time. With `slots: 1` the delays decide nothing:
the tasks run one after another, in the order you listed them.

This test scripts two tasks that reach the merge together:

```ts
// several-tasks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deterministicRouter, gateMaintenanceRoleConfig, load, readRef, triageRoleConfig, workerRoleConfig,
  type BudgetSet, type CloseReport, type CloserRef, type GateRef,
} from "delivery-service";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSupervisorAgainstMock, type ScriptedTask } from "delivery-service/testing";

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 1 },
  gateMaintenance: { used: 0, max: 1 },
  terminus: { used: 0, max: 1 },
  close: { used: 0, max: 1 },
};
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

// How long each task's agent waits before it answers. Swap the two numbers to swap which task is merged.
const HELLO_DELAY_MS = 0;
const GOODBYE_DELAY_MS = 2000;

/** A throwaway git repository on main, holding `files` in one commit. */
function scratchRepo(files: Record<string, string>): string {
  const repoPath = mkdtempSync(join(tmpdir(), "pipeline-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath, env });
  git("init", "-b", "main");
  git("config", "user.email", "pipeline-test@example.invalid");
  git("config", "user.name", "Pipeline test");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repoPath, name), content);
  git("add", "-A");
  git("commit", "-m", "seed");
  return repoPath;
}

/** A task whose agent waits `delayMs`, writes `<name>.txt` and reports completion. */
function task(name: string, delayMs: number): ScriptedTask {
  return {
    header: { surfaceId: name, taskDef: { intent: `add a ${name} file` }, gateRef, closerRef },
    script: {
      delayMs,
      expectations: [
        {
          effects: [{ write: { path: `${name}.txt`, content: `${name}\n` } }],
          json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: `wrote ${name}.txt` }),
        },
      ],
    },
  };
}

test("two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on", async () => {
  const repoPath = scratchRepo({ "report.tap": "1..1\nok 1 - greets\n" });
  const hello = task("hello", HELLO_DELAY_MS);
  const goodbye = task("goodbye", GOODBYE_DELAY_MS);

  const [helloRun, goodbyeRun] = await runSupervisorAgainstMock({
    repoPath,
    slots: 2,
    tasks: [hello, goodbye],
    budgets,
    roleConfigs,
    triage: () => deterministicRouter,
  });
  assert.ok(helloRun && goodbyeRun);

  // Each task has its own journal, checked as for one task.
  assertFullyConsumed(helloRun.journal, hello.script);
  assertFullyConsumed(goodbyeRun.journal, goodbye.script);
  const [goodbyePrompt, ...others] = promptsSent(goodbyeRun.journal);
  assert.equal(others.length, 0);
  assert.match(goodbyePrompt ?? "", /add a goodbye file/);

  const [merged, refused] = HELLO_DELAY_MS < GOODBYE_DELAY_MS ? [helloRun, goodbyeRun] : [goodbyeRun, helloRun];
  assert.equal(merged.result.state, "CLOSED");
  assert.equal(refused.result.state, "ESCALATED");

  const [firstClose] = (await load(refused.dir)).history.flatMap((entry) => (entry.t === "close" ? [entry] : []));
  assert.ok(firstClose);
  assert.equal(firstClose.status, "FAIL");
  const report = (await readRef(refused.dir, firstClose.detailRef)) as CloseReport;
  assert.match(report.detail, /main has moved on/);

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath, env, encoding: "utf-8" });
  assert.equal(git("show", `main:${merged.surfaceId}.txt`), `${merged.surfaceId}\n`);
  assert.equal(git("show", `surface/${refused.surfaceId}:${refused.surfaceId}.txt`), `${refused.surfaceId}\n`);
});
```

Save it beside the others as `several-tasks.test.ts` and run it the same way:

```bash
npx tsx --test several-tasks.test.ts
```

It passes in a few seconds. The output ends like this:

```text
✔ two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

What it shows:

- **The first task to answer is merged.** Its merge-back closer fast-forwards
  `main` onto its work.
- **The other is refused because the base moved on.** Its working copy was made
  from `main` as it was before the first merge, so `main` can no longer be
  fast-forwarded onto it. Its close ends `FAIL`, and the closer's report says
  `main has moved on`. That goes through triage like any close that fails: it
  is retried while the `close` budget allows, then the task ends `ESCALATED`,
  with its work kept on its own branch, `surface/<surfaceId>`, for a person to
  bring up to date.
- **Each task has its own `journal`.** `runSupervisorAgainstMock` returns one
  result per task, in the order you listed them, whichever finished first: the
  task's `surfaceId`, its case file's `dir` (read it with `load(dir)`), its
  `result`, and its own `journal`, which `promptsSent` and
  `assertFullyConsumed` read exactly as for one task.

Swap the two delays and run it again: `goodbye` is merged, and `hello` is the
one refused because the base moved on, every time you run it.

To test your own pipeline, replace `gateRef`, `closerRef`, `roleConfigs` and
`budgets` with yours, and script what each task's worker should do.
````

In the same file's `## When the test itself is wrong` table, add these two rows after the `A scripted envelope is malformed by mistake` row:

```markdown
| `slots` is not a whole number of 1 or more | `runSupervisorAgainstMock` throws `slots must be a whole number of 1 or more, but was 0.` before anything runs |
| Two tasks share a `surfaceId` | `runSupervisorAgainstMock` throws `Each scripted task needs its own surfaceId, but "hello" is used more than once: a task's branch and working copy are named after it.` before anything runs |
```

- [ ] **Step 4: Run the guide test to verify it passes**

Run: `npm run build && npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: PASS, every case, including "runs its worked several-tasks test as written, and it passes" and "type-checks every snippet it tells a reader to save".

- [ ] **Step 5: Update CONTRIBUTING.md, README.md and add the changeset**

In `CONTRIBUTING.md`, in the paragraph beginning "To prove a gate, a closer and role configurations work together", after the sentence ending "fails naming any expectation the run never used.", insert:

```markdown
To prove the same with several tasks at once, `runSupervisorAgainstMock` runs a list of
scripted tasks through the real supervisor with a chosen number of `slots`, one script and one
journal per task; each script's `delayMs` decides which task reaches a step first. Never add a
barrier or hook to force an order.
```

In `README.md`, change the line

```markdown
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent
```

to

```markdown
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent, one task at a time or several at once
```

Create `.changeset/test-several-tasks-at-once.md`:

```markdown
---
"delivery-service": minor
---

The testing API can now run several scripted tasks at once. `runSupervisorAgainstMock` from
`delivery-service/testing` drives a list of tasks through the same supervisor `delivery run` uses
with `concurrency` above 1, against one scratch repository, with a chosen number of slots; each
task has its own script and its own journal, and each script's `delayMs` decides which task
reaches a step first, so a test of two tasks finishing together gives the same result every time.
The testing guide has a new section, "Testing several tasks at once", whose worked example shows
one task merged and the other refused because the base moved on.
```

- [ ] **Step 6: Re-run the guide test**

The README and CONTRIBUTING are not read by the guide test, but the guide test is the one this task owns; confirm it is still green.

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and type-check the changed test**

Run: `npx eslint tests/testing-your-pipeline-guide.test.ts && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add docs/testing-your-pipeline.md tests/testing-your-pipeline-guide.test.ts CONTRIBUTING.md README.md .changeset/test-several-tasks-at-once.md
git commit -m "Teach testing several tasks at once in the pipeline testing guide

An extender needs to know how to force which task reaches the merge first
without reading source. The new section and its worked example, run as a
test like the rest of the guide, show one task merged and the other refused
because the base moved on, decided only by each script's delayMs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
