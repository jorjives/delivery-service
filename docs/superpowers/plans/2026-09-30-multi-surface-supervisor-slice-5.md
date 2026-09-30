# Multi-Surface Supervisor — Slice 5: Have a Broken Shared Environment Repaired Once, Not by Every Task

> **Status:** ✅ Complete — 2026-09-30 — `ae4b22b`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** In a run of several tasks at once, the first task to find its check environment broken (a red-by-ERROR starting point, or triage's `fix_the_gate`) trips a run-wide breaker; every task about to check or hand off its work is held; exactly one gate-maintenance repair runs once nothing is mid-check or mid-hand-off, on one run-wide repair limit; success prints "Fixed. Resuming." and releases every held task; failure stops the run with exit 4, counts, and a run outcome naming the shared environment as the cause; `delivery status` leads with that narration; the whole thing survives a crash.

**Architecture:** The single-task state machine gains two optional seams through a new optional `SurfacePorts.repairCoordinator` port: its three shared steps (baseline, check, accepted close) run inside `awaitClearance`, and its gate-maintenance edge asks `requestRepair` instead of dispatching its own session. Absent port, behaviour is today's exactly. `src/breaker.ts` holds the breaker: a total transition table over run-file entries (the breaker's state is a pure fold of the run file's history, as a task's position is a fold of its log), the fold helpers `status` reads, and `createRunBreaker`, the in-process coordinator that records every trip, hold, request and repair attempt in the run file, coalesces concurrent requests onto one repair, waits for quiescence, and dispatches the existing gate-maintenance role in the working copy and record of the task that tripped it. `src/cli/queue.ts` creates one breaker per run of several at once and hands it to each task; a `RunHalted` thrown at a hold point after the run gives up is caught at the top and turned into the environment stop. `delivery status` derives the environment from the same fold. A new example fixture, guide and test demonstrate a check that depends on a helper outside every task's copy.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`), zod, vitest, the vendored `claude-mock` through the existing `DELIVERY_TEST_MOCK_SCRIPT` seam. No new dependency.

## Global Constraints

- Node ≥22; `noUncheckedIndexedAccess` is on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new dependency. Do **not** adopt a circuit-breaker library (Opossum, Cockatiel): they are in-memory and do not survive a crash.
- Exit codes unchanged (`src/cli/failures.ts` `EXIT`): a run that gives up on the shared environment exits `EXIT.escalated` (4).
- With `concurrency` 1 (the default) nothing a user sees or finds on disk changes: no breaker is created, the port is absent, a task repairs its own gate on its own `gateMaintenance` budget exactly as today. Every existing test in `src/surface.test.ts`, `src/cli/queue.test.ts` and `src/cli/run-command.test.ts` must keep passing unchanged, except for the mechanical `runBudgetMax` addition to `RunHeader` literals in Task 1.
- Human-readable output never shows an internal state name (`HEALTHY`, `DEGRADED`, `REPAIRING`, `GATE_MAINTENANCE`, `ESCALATED`); closed-set tables translate. `--json` uses the harness's own names, every key present, `null` where it does not apply; stdout under `--json` holds only JSON.
- User-facing copy (messages, README, guide, changeset): controlled British English, plain words, no em-dashes (colons, semicolons, commas instead).
- Tests are offline: agents are `fakeAgentPort` doubles or the vendored `claude-mock`; nothing pays for a session.
- **Buy-vs-build (Build note):** the breaker is a transition table over the run record's history, the pattern `deriveStateFromEntry` is for a task; no circuit-breaker library. The repair is the existing gate-maintenance role, prompt assembly and tool authority (`createAgentPort(rolesFor(...))`), dispatched by the run; no new agent role. Concurrent requests share the one repair in flight (one promise, `??=`). Persistence reuses `appendRunEntry`/`setRunOutcome` (`src/run-file.ts`, over `src/journal.ts`).
- **Operability/DX (Operational note):** one repair limit per run of several at once, taken from the project's existing `budgets.gateMaintenance` (default 2) and pinned in the run header at start, as a task pins its budgets; a single task keeps its per-task limit. Every trip, hold, request and repair attempt is a run-file entry, readable after the fact through `delivery status <run> --json` (`trips`, `runBudgets`). The demonstration needs a check that depends on something outside the tasks' copies: a new fixture `examples/shared-environment-example/`, guide `docs/shared-environment.md` and test `tests/shared-environment-guide.test.ts` ("one fixture, one guide, one test"); slice 6 reuses the fixture.
- Targeted verification only: each task runs its own test files with `npx vitest run <file>` and `npx tsc --noEmit`. The full suite runs once in final review.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **No breaker cursor in `run.json`.** The breaker's state is `breakerOf(history)`, a fold through a total transition table. A cursor rewritten on every transition would be a second read-modify-write writer to `run.json` beside `setRunOutcome`, and could disagree with the history; the design already says "history wins". The table is the "field and transition table" of the Build note; the design's own NFR ("the breaker trigger is a pure function of run history") holds by construction.
  - **The repair runs in the copy and against the record of the task whose report tripped the breaker** (`trip.cause.surfaceId`), with that task's own pinned roles. That is the only context the existing prompt assembly (`load(ctx.dir)`) and tool authority (confined to `ctx.worktreePath`) accept, so no trust boundary moves. Running it in the shared checkout instead would put a custom gate's module (resolved from the repository root) inside the repair agent's reach, which the gate-maintenance role exists never to allow. Consequence, stated plainly in the guide: a repair agent can fix what is inside a copy; something shared outside every copy (the fixture's helper) generally cannot be fixed by it, and the run then stops naming the environment, which is the correct outcome.
  - **Run-file entries added** (the design's set, trimmed): `breaker_degraded {cause: {kind: "gate_maintenance", surfaceId, reason}}` (the design's cause shape, so slice 6 adds `gate_error_aggregate` as a second variant), `repair_request {surfaceId, key}`, `held {surfaceId}`, `repair_dispatch {attempt, sessionKey, surfaceId}`, `repair_terminus {attempt, sessionKey, status, rationale}`, `breaker_healthy`, `run_escalated {reason}`. `held` and `repair_request` are what let `status` name "which tasks it held" after the fact; `gate_error_signal` is slice 6's.
  - **A request after a crash is not repaired twice.** A post-task request carries `key` = the `fix_the_gate` triage entry's `artifactRef` (unique per round). If the run file already has that `(surfaceId, key)` request followed by `breaker_healthy`, the coordinator answers "already repaired" and the task goes straight to its re-check. A pre-task request carries `key: null`: re-taking the baseline is itself the check, so no marker is needed, and a key there would loop.
  - **Repair attempts are counted by `repair_dispatch` entries, run-wide.** The dispatch entry is the burn, as for a task. A dangling dispatch on resume is recorded as an incomplete terminus ("recovered on resume") and re-dispatched on the same limit within the same trip: the run resumes into the repair rather than losing it, and never opens a second trip for it. That the resumed dispatch counts again mirrors a task's own dangling repair exactly.
  - **The run gives up** when a trip finds the limit spent, or at once when the repair session escalates or never started (`notRun`), mirroring a task's own repair edge. It records `run_escalated`, and every waiting and later hold throws `RunHalted`. Tasks mid-agent-session carry on until their next hold point, then stop without an outcome of their own (resumable later). `supervise` already lets running tasks end before rethrowing a task's throw, so it needs no change; `runQueue` catches `RunHalted`, writes the outcome `{kind: "escalated", cause: "shared_environment", reason}`, says the counts and exits 4. A later `delivery run` starts a new run that picks the held tasks up by content identity.
  - **Hold points wrap only the shared operation** (the gate's `baseline`/`check` and the accepted close), not the whole step, so a task whose own baseline errors has left the hold before it asks for the repair; otherwise it would wait for itself to go idle.
  - **Live narration:** DEGRADED, REPAIRING (with "attempt n of m") and HEALTHY ("✓ Fixed. Resuming.") are run-scope reporter events; the give-up sentence is a note from `runQueue`, which alone knows the counts. `BREAKER_PHRASES` (one closed-set table in `src/cli/output.ts`) replaces slice 4's `ENVIRONMENT_WORDS`, so "Environment: healthy" is unchanged and the live DEGRADED line is built from the same phrase.
  - **`status`:** a new standing `paused` ("paused until the shared environment is fixed") for an unfinished task the unresolved trip holds; the narration leads the report while a trip is unresolved (live and not healthy, or given up); a repaired run shows none. The JSON document gains `reason`, `cause`, `runBudgets` and `trips`.
  - **`runSupervisorAgainstMock` is not wired to the breaker in this slice**: a scripted task whose check cannot run is still repaired on its own there. Wiring it needs the per-task agent port exposed out of `runSurfaceAgainstMock`; nobody needs breaker behaviour in the scripted runner yet. The testing guide says so in one sentence (Task 6). `ponytail:` add the coordinator to the scripted runner when an extender asks to test a trip.
  - **`RunHeader.runBudgetMax` is required**, not optional-with-fallback: a run pins its limit at start as a task pins its budgets, and the package is unpublished, so no run file on a user's disk lacks it. Every `RunHeader` literal in tests gains `runBudgetMax: { gateMaintenance: 2 }`.

## Scaffolding Impact

- **Reactive:**
  - `README.md` "several tasks at once" section: gains what happens when the shared environment breaks, with example output; the `budgets` row in the settings table notes that `gateMaintenance` is one limit per run of several at once; the `--json` paragraph names the environment run records and `affected` → Task 6.
  - `README.md` "A run of several tasks at once" status section: the lead narration, the `paused` count and the new JSON keys → Task 7.
  - `README.md` guides list: link to the new guide → Task 8.
  - `docs/multi-surface-control-flow.md` "Shared-environment failure" says full stop-the-world and "its case file records blocked on run maintenance"; the settled behaviour holds only checks and hand-offs and records holds in the run file → Task 4.
  - `docs/testing-your-pipeline.md` "Testing several tasks at once": one sentence that the scripted runner still repairs each task on its own → Task 6.
  - `src/schema.ts` `BreakerState` carries a `ponytail:` comment promising slice 5; removed when the enum widens → Task 1.
- **Proactive:** `.changeset/repair-a-broken-shared-environment-once.md` (every user-visible change gets a changeset here) → created in Task 6, extended in Tasks 7 and 8. The new fixture, guide and guide test are the run/verify story for the behaviour → Task 8.
- **Inherited (Operational note):** run-wide repair limit → Tasks 1 (pinned in header) and 6 (taken from `project.budgets`); trip diagnosable from `delivery status` → Task 7; shared-environment example variant, one fixture/guide/test → Task 8.
- Checked and unchanged: `docs/configuring-a-role.md` and `docs/agent-interface.md` describe the gate-maintenance role, which is unchanged; `docs/single-surface-control-flow.md` describes a single task, unchanged; `docs/project-configuration.md` (its example is untouched); `delivery run --help` (no new flag). No `CLAUDE.md` in this repo.

---

### Task 1: Record the breaker, its repairs and a run that gave up in the run file

**Files:**
- Modify: `src/schema.ts` (the "Supervised run file" section, lines ~299-344)
- Modify: `src/cli/output.ts` (add `BREAKER_PHRASES`)
- Modify: `src/cli/status-command.ts` (replace `ENVIRONMENT_WORDS` with `BREAKER_PHRASES`)
- Modify: `src/cli/queue.ts` (`createRunFile` call passes `runBudgetMax`)
- Modify (mechanical, `runBudgetMax: { gateMaintenance: 2 }` in every `RunHeader` literal): `src/run-file.test.ts`, `src/supervisor.test.ts`, `src/cli/supervised-view.test.ts`, `src/cli/runs.test.ts`, `src/cli/status-command.test.ts`, `src/cli/queue.test.ts`, `src/cli/run-command.test.ts` (find them with `grep -rn "concurrency: [0-9], tasks" src`)
- Test: `src/run-file.test.ts`, `src/cli/output.test.ts`

**Interfaces:**
- Produces (in `src/schema.ts`):
  - `BreakerState = z.enum(["HEALTHY", "DEGRADED", "REPAIRING"])`
  - `RunHeader` gains `runBudgetMax: { gateMaintenance: number }` (whole, positive).
  - `RepairStatus = z.enum(["completed", "escalate", "incomplete"])`
  - `BreakerCause` = discriminated union on `kind` with one variant `{ kind: "gate_maintenance", surfaceId: string, reason: string }`.
  - `RunEntry` gains: `{ t: "breaker_degraded", cause: BreakerCause }`, `{ t: "repair_request", surfaceId: string, key: string | null }`, `{ t: "held", surfaceId: string }`, `{ t: "repair_dispatch", attempt: number, sessionKey: string, surfaceId: string }`, `{ t: "repair_terminus", attempt: number, sessionKey: string, status: RepairStatus, rationale: string }`, `{ t: "breaker_healthy" }`, `{ t: "run_escalated", reason: string }`.
  - `RunOutcome` = discriminated union on `kind`: `{ kind: "drained", at }` | `{ kind: "escalated", cause: "shared_environment", reason: string, at }`.
- Produces (in `src/cli/output.ts`): `BREAKER_PHRASES: Record<BreakerState, string>` = `{ HEALTHY: "healthy", DEGRADED: "something in the shared environment looks broken", REPAIRING: "the shared environment is being repaired" }`.

- [ ] **Step 1: Write the failing tests**

In `src/run-file.test.ts` add (merge imports; reuse the file's existing temp-dir helper and header literal, adding `runBudgetMax`):

```ts
describe("the breaker and its repairs, in the run file", () => {
  const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } };

  it("reads back every breaker entry exactly as it was appended", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-breaker-"));
    await createRunFile(dir, header);
    const entries: RunEntry[] = [
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "the shared helper is missing" } },
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "held", surfaceId: "b" },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "a" },
      { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored it" },
      { t: "breaker_healthy" },
      { t: "run_escalated", reason: "the shared environment could not be repaired after 2 attempts" },
    ];
    for (const entry of entries) await appendRunEntry(dir, entry);
    expect((await loadRunFile(dir)).history).toEqual(entries);
  });

  it("keeps a run that gave up on the shared environment as its outcome, naming the cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-escalated-"));
    await createRunFile(dir, header);
    const outcome = { kind: "escalated", cause: "shared_environment", reason: "could not be repaired", at: "2026-09-30T10:00:00.000Z" } as const;
    await setRunOutcome(dir, outcome);
    expect((await loadRunFile(dir)).outcome).toEqual(outcome);
  });

  it("refuses a header that does not pin the run's repair limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-no-limit-"));
    const { runBudgetMax: _dropped, ...withoutLimit } = header;
    await expect(createRunFile(dir, withoutLimit as RunHeader)).rejects.toThrow();
  });
});
```

In `src/cli/output.test.ts` add:

```ts
describe("the shared environment, in words", () => {
  it("has words for every state and never the state's own name", () => {
    expect(Object.keys(BREAKER_PHRASES).sort()).toEqual(["DEGRADED", "HEALTHY", "REPAIRING"]);
    for (const phrase of Object.values(BREAKER_PHRASES)) expect(phrase).not.toMatch(/HEALTHY|DEGRADED|REPAIRING/);
    expect(BREAKER_PHRASES.HEALTHY).toBe("healthy");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/run-file.test.ts src/cli/output.test.ts`
Expected: FAIL: `RunEntry.parse` rejects `breaker_degraded`; `BREAKER_PHRASES` is not exported.

- [ ] **Step 3: Implement**

In `src/schema.ts`, replace the `BreakerState` block (and its `ponytail:` comment) and extend the section:

```ts
/**
 * Whether the environment every task of a run shares is fit to use. Never
 * stored: it is what the run file's history says, folded through the
 * transition table in `src/breaker.ts`, as a task's position is its log's.
 */
export const BreakerState = z.enum(["HEALTHY", "DEGRADED", "REPAIRING"]);
export type BreakerState = z.infer<typeof BreakerState>;

export const RunHeader = z.object({
  runId: z.string().min(1),
  repoPath: z.string().min(1),
  concurrency: z.number().int().positive(),
  // How many tasks the list held when the run started: the M in "[n/M]".
  tasks: z.number().int().nonnegative(),
  // One repair limit for the whole run, pinned when it starts, as a task pins its budgets.
  runBudgetMax: z.object({ gateMaintenance: z.number().int().positive() }),
});
export type RunHeader = z.infer<typeof RunHeader>;

const Slot = z.number().int().positive();
const SurfaceId = z.string().min(1);

export const RepairStatus = z.enum(["completed", "escalate", "incomplete"]);
export type RepairStatus = z.infer<typeof RepairStatus>;

/** What tripped the breaker. One kind so far; repeated check errors across tasks are the next. */
export const BreakerCause = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gate_maintenance"), surfaceId: SurfaceId, reason: z.string() }),
]);
export type BreakerCause = z.infer<typeof BreakerCause>;

export const RunEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("slot_fill"), slot: Slot, surfaceId: SurfaceId, taskDef: TaskDef }),
  z.object({ t: z.literal("slot_free"), slot: Slot, surfaceId: SurfaceId, outcome: SlotOutcome }),
  // A task found the shared environment broken while it was healthy.
  z.object({ t: z.literal("breaker_degraded"), cause: BreakerCause }),
  // A task asked for the shared environment to be repaired; `key` names the setback it asked about, when it has one.
  z.object({ t: z.literal("repair_request"), surfaceId: SurfaceId, key: z.string().nullable() }),
  // A task was held before checking or handing off its work.
  z.object({ t: z.literal("held"), surfaceId: SurfaceId }),
  // The dispatch entry is the burn on the run's repair limit.
  z.object({ t: z.literal("repair_dispatch"), attempt: z.number().int().positive(), sessionKey: z.string().min(1), surfaceId: SurfaceId }),
  z.object({ t: z.literal("repair_terminus"), attempt: z.number().int().positive(), sessionKey: z.string().min(1), status: RepairStatus, rationale: z.string() }),
  z.object({ t: z.literal("breaker_healthy") }),
  z.object({ t: z.literal("run_escalated"), reason: z.string().min(1) }),
]);
export type RunEntry = z.infer<typeof RunEntry>;

export const RunOutcome = z.discriminatedUnion("kind", [
  // Every task the run could take was taken and has ended.
  z.object({ kind: z.literal("drained"), at: z.string() }),
  // The shared environment could not be repaired, so the run stopped; no task caused it.
  z.object({ kind: z.literal("escalated"), cause: z.literal("shared_environment"), reason: z.string().min(1), at: z.string() }),
]);
export type RunOutcome = z.infer<typeof RunOutcome>;
```

In `src/cli/output.ts` (import `BreakerState` type from `../schema.js`):

```ts
/**
 * The environment every task of a run shares, as a person reads it. The state
 * set is closed, so the table is total: a new state does not compile until it
 * has words. `status` says "Environment: <phrase>"; the live line when it
 * breaks is built from the DEGRADED phrase.
 */
export const BREAKER_PHRASES: Record<BreakerState, string> = {
  HEALTHY: "healthy",
  DEGRADED: "something in the shared environment looks broken",
  REPAIRING: "the shared environment is being repaired",
};
```

In `src/cli/status-command.ts`: delete `ENVIRONMENT_WORDS`, import `BREAKER_PHRASES` from `./output.js`, and change the report line to `` `Environment: ${BREAKER_PHRASES[view.breaker]}` ``.

In `src/cli/queue.ts`, the new-run `createRunFile` call becomes:

```ts
await createRunFile(dir, { runId, repoPath, concurrency, tasks: tasks.length, runBudgetMax: { gateMaintenance: project.budgets.gateMaintenance.max } });
```

Add `runBudgetMax: { gateMaintenance: 2 }` to every `RunHeader` literal listed under **Files**.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/run-file.test.ts src/cli/output.test.ts src/cli/status-command.test.ts src/cli/supervised-view.test.ts src/cli/runs.test.ts src/supervisor.test.ts src/cli/queue.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/cli/output.ts src/cli/output.test.ts src/cli/status-command.ts src/cli/queue.ts src/run-file.test.ts src/supervisor.test.ts src/cli/supervised-view.test.ts src/cli/runs.test.ts src/cli/status-command.test.ts src/cli/queue.test.ts src/cli/run-command.test.ts
git commit -m "Record the shared environment's breaker and repairs in the run file

A run of several tasks at once needs one repair of its shared environment
rather than one per task, and that has to survive a crash and be readable
afterwards. The run file gains the entries a trip, a hold, a request and each
repair attempt leave, the run's pinned repair limit, and an outcome for a run
that gave up on its environment. The breaker's words become one closed table.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Work out the breaker's state and every trip from the run's history

**Files:**
- Create: `src/breaker.ts`
- Test: `src/breaker.test.ts`

**Interfaces:**
- Consumes: `BreakerState`, `BreakerCause`, `RepairStatus`, `RunEntry` from `src/schema.ts` (Task 1).
- Produces (all exported from `src/breaker.ts`, all pure):
  - `nextBreaker(state: BreakerState, entry: RunEntry): BreakerState`
  - `breakerOf(history: readonly RunEntry[]): BreakerState`
  - `repairsUsed(history: readonly RunEntry[]): number`
  - `openDispatch(history: readonly RunEntry[]): Extract<RunEntry, { t: "repair_dispatch" }> | undefined`
  - `servedAlready(history: readonly RunEntry[], surfaceId: string, key: string): boolean`
  - `requestedInOpenTrip(history: readonly RunEntry[], surfaceId: string, key: string | null): boolean`
  - `interface RepairAttempt { attempt: number; sessionKey: string; surfaceId: string; status: RepairStatus | null; rationale: string | null }`
  - `interface Trip { cause: BreakerCause; held: string[]; repairs: RepairAttempt[]; ended: "repaired" | "gave_up" | null; reason: string | null }`
  - `tripsOf(history: readonly RunEntry[]): Trip[]`
  - `openTrip(history: readonly RunEntry[]): Trip | undefined` (the last trip, while `ended === null`)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { RunEntry } from "./schema.js";
import { breakerOf, nextBreaker, openDispatch, openTrip, repairsUsed, requestedInOpenTrip, servedAlready, tripsOf } from "./breaker.js";

const degraded = (surfaceId: string, reason = "the shared helper is missing"): RunEntry => ({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
const dispatch = (attempt: number, surfaceId = "a"): RunEntry => ({ t: "repair_dispatch", attempt, sessionKey: `run-repair-${attempt}`, surfaceId });
const terminus = (attempt: number, status: "completed" | "escalate" | "incomplete" = "completed"): RunEntry => ({ t: "repair_terminus", attempt, sessionKey: `run-repair-${attempt}`, status, rationale: `attempt ${attempt}` });
const healthy: RunEntry = { t: "breaker_healthy" };

describe("how each entry moves the breaker", () => {
  it("trips from healthy, repairs, and comes back healthy", () => {
    expect(nextBreaker("HEALTHY", degraded("a"))).toBe("DEGRADED");
    expect(nextBreaker("DEGRADED", dispatch(1))).toBe("REPAIRING");
    expect(nextBreaker("REPAIRING", terminus(1))).toBe("DEGRADED");
    expect(nextBreaker("DEGRADED", healthy)).toBe("HEALTHY");
  });

  it("stays broken once the run gives up", () => {
    expect(nextBreaker("DEGRADED", { t: "run_escalated", reason: "gave up" })).toBe("DEGRADED");
  });

  it("is not moved by slots, holds or requests", () => {
    const quiet: RunEntry[] = [
      { t: "slot_fill", slot: 1, surfaceId: "a", taskDef: { intent: "x" } },
      { t: "slot_free", slot: 1, surfaceId: "a", outcome: "closed" },
      { t: "held", surfaceId: "b" },
      { t: "repair_request", surfaceId: "a", key: null },
    ];
    for (const entry of quiet) expect(nextBreaker("DEGRADED", entry)).toBe("DEGRADED");
  });

  it("is healthy for a run with no history, and follows the history otherwise", () => {
    expect(breakerOf([])).toBe("HEALTHY");
    expect(breakerOf([degraded("a"), dispatch(1)])).toBe("REPAIRING");
    expect(breakerOf([degraded("a"), dispatch(1), terminus(1), healthy])).toBe("HEALTHY");
  });
});

describe("the run's repairs", () => {
  it("counts every dispatch across every trip against the one limit", () => {
    expect(repairsUsed([degraded("a"), dispatch(1), terminus(1), healthy, degraded("b"), dispatch(2, "b")])).toBe(2);
  });

  it("finds a dispatch that never recorded a terminus, and only that", () => {
    expect(openDispatch([degraded("a"), dispatch(1)])).toMatchObject({ attempt: 1 });
    expect(openDispatch([degraded("a"), dispatch(1), terminus(1)])).toBeUndefined();
  });
});

describe("every trip, as status tells it", () => {
  it("names the cause, every task held once in the order held, each attempt, and how it ended", () => {
    const [trip] = tripsOf([
      degraded("a"),
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "held", surfaceId: "b" },
      { t: "repair_request", surfaceId: "c", key: "triage-3" },
      { t: "held", surfaceId: "b" },
      dispatch(1),
      terminus(1, "incomplete"),
      dispatch(2),
      terminus(2),
      healthy,
    ]);
    expect(trip).toEqual({
      cause: { kind: "gate_maintenance", surfaceId: "a", reason: "the shared helper is missing" },
      held: ["a", "b", "c"],
      repairs: [
        { attempt: 1, sessionKey: "run-repair-1", surfaceId: "a", status: "incomplete", rationale: "attempt 1" },
        { attempt: 2, sessionKey: "run-repair-2", surfaceId: "a", status: "completed", rationale: "attempt 2" },
      ],
      ended: "repaired",
      reason: null,
    });
  });

  it("opens a new trip after a repair, and records why the run gave up", () => {
    const trips = tripsOf([degraded("a"), dispatch(1), terminus(1), healthy, degraded("b"), { t: "run_escalated", reason: "could not be repaired" }]);
    expect(trips.map((trip) => [trip.cause.surfaceId, trip.ended, trip.reason])).toEqual([
      ["a", "repaired", null],
      ["b", "gave_up", "could not be repaired"],
    ]);
    expect(openTrip([degraded("a"), dispatch(1), terminus(1), healthy])).toBeUndefined();
    expect(openTrip([degraded("a")])?.cause.surfaceId).toBe("a");
  });
});

describe("whether a request has already been answered", () => {
  it("is answered once a repair finished after that same request", () => {
    const asked: RunEntry = { t: "repair_request", surfaceId: "a", key: "triage-3" };
    expect(servedAlready([degraded("a"), asked, dispatch(1), terminus(1), healthy], "a", "triage-3")).toBe(true);
    expect(servedAlready([degraded("a"), asked, dispatch(1)], "a", "triage-3")).toBe(false);
    expect(servedAlready([degraded("a"), asked, dispatch(1), terminus(1), healthy], "a", "triage-4")).toBe(false);
  });

  it("knows a request already made in the trip still open", () => {
    const history: RunEntry[] = [degraded("a"), { t: "repair_request", surfaceId: "a", key: null }];
    expect(requestedInOpenTrip(history, "a", null)).toBe(true);
    expect(requestedInOpenTrip(history, "b", null)).toBe(false);
    expect(requestedInOpenTrip([...history, dispatch(1), terminus(1), healthy], "a", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/breaker.test.ts`
Expected: FAIL: cannot resolve `./breaker.js`.

- [ ] **Step 3: Implement**

```ts
import type { BreakerCause, BreakerState, RepairStatus, RunEntry } from "./schema.js";

/**
 * How each run-file entry moves the shared environment's breaker. Total over
 * the entry kinds, so a new kind does not compile until it says how it moves
 * the breaker. The breaker is never stored: it is this table folded over the
 * run's history, as a task's position is its log folded through
 * `deriveStateFromEntry`, so a resumed run and a live one cannot disagree.
 */
const BREAKER_EDGES: Record<RunEntry["t"], (state: BreakerState) => BreakerState> = {
  slot_fill: (state) => state,
  slot_free: (state) => state,
  held: (state) => state,
  repair_request: (state) => state,
  breaker_degraded: (state) => (state === "HEALTHY" ? "DEGRADED" : state),
  repair_dispatch: () => "REPAIRING",
  repair_terminus: () => "DEGRADED",
  breaker_healthy: () => "HEALTHY",
  // A run that gave up leaves its environment broken: that is what it gave up on.
  run_escalated: () => "DEGRADED",
};

export function nextBreaker(state: BreakerState, entry: RunEntry): BreakerState {
  return BREAKER_EDGES[entry.t](state);
}

export function breakerOf(history: readonly RunEntry[]): BreakerState {
  return history.reduce<BreakerState>(nextBreaker, "HEALTHY");
}

/** Repair attempts spent, over the whole run: the dispatch entry is the burn. */
export function repairsUsed(history: readonly RunEntry[]): number {
  return history.filter((entry) => entry.t === "repair_dispatch").length;
}

type Dispatch = Extract<RunEntry, { t: "repair_dispatch" }>;

/** The repair dispatched but never answered: what a crash in the middle of a repair leaves. */
export function openDispatch(history: readonly RunEntry[]): Dispatch | undefined {
  const last = history.findLast((entry): entry is Dispatch => entry.t === "repair_dispatch");
  if (last === undefined) return undefined;
  const answered = history.some((entry) => entry.t === "repair_terminus" && entry.sessionKey === last.sessionKey);
  return answered ? undefined : last;
}

export interface RepairAttempt {
  attempt: number;
  sessionKey: string;
  /** Whose copy and record the repair ran in: the task whose report tripped the breaker. */
  surfaceId: string;
  status: RepairStatus | null;
  rationale: string | null;
}

/** One time the shared environment broke: what broke it, every task it held, each repair, and how it ended. */
export interface Trip {
  cause: BreakerCause;
  /** Every task it held, each once, in the order held, the one that found it first. */
  held: string[];
  repairs: RepairAttempt[];
  ended: "repaired" | "gave_up" | null;
  /** Why the run gave up, when it did. */
  reason: string | null;
}

export function tripsOf(history: readonly RunEntry[]): Trip[] {
  const trips: Trip[] = [];
  for (const entry of history) {
    const last = trips.at(-1);
    const open = last !== undefined && last.ended === null ? last : undefined;
    switch (entry.t) {
      case "breaker_degraded":
        if (open === undefined) trips.push({ cause: entry.cause, held: [entry.cause.surfaceId], repairs: [], ended: null, reason: null });
        break;
      case "repair_request":
      case "held":
        if (open !== undefined && !open.held.includes(entry.surfaceId)) open.held.push(entry.surfaceId);
        break;
      case "repair_dispatch":
        open?.repairs.push({ attempt: entry.attempt, sessionKey: entry.sessionKey, surfaceId: entry.surfaceId, status: null, rationale: null });
        break;
      case "repair_terminus": {
        const attempt = open?.repairs.findLast((repair) => repair.sessionKey === entry.sessionKey);
        if (attempt !== undefined) {
          attempt.status = entry.status;
          attempt.rationale = entry.rationale;
        }
        break;
      }
      case "breaker_healthy":
        if (open !== undefined) open.ended = "repaired";
        break;
      case "run_escalated":
        if (open !== undefined) {
          open.ended = "gave_up";
          open.reason = entry.reason;
        }
        break;
      default:
        break;
    }
  }
  return trips;
}

/** The trip still unresolved, if any. */
export function openTrip(history: readonly RunEntry[]): Trip | undefined {
  const last = tripsOf(history).at(-1);
  return last?.ended === null ? last : undefined;
}

/** Whether this task's request about this setback was already answered by a repair: a crash landed between the repair and the task's re-check. */
export function servedAlready(history: readonly RunEntry[], surfaceId: string, key: string): boolean {
  const asked = history.findLastIndex((entry) => entry.t === "repair_request" && entry.surfaceId === surfaceId && entry.key === key);
  return asked !== -1 && history.slice(asked).some((entry) => entry.t === "breaker_healthy");
}

/** Whether this task already asked, about this setback, in the trip still open: a resumed task asking again adds nothing. */
export function requestedInOpenTrip(history: readonly RunEntry[], surfaceId: string, key: string | null): boolean {
  const opened = history.findLastIndex((entry) => entry.t === "breaker_degraded");
  if (opened === -1 || openTrip(history) === undefined) return false;
  return history.slice(opened).some((entry) => entry.t === "repair_request" && entry.surfaceId === surfaceId && entry.key === key);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/breaker.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/breaker.ts src/breaker.test.ts
git commit -m "Work out the shared environment's state and trips from the run's history

The breaker must survive a crash and be read back by status, so it is never
stored: a total transition table folded over the run file's history gives its
state, and the same history gives every trip, the tasks it held and each
repair attempt, as a task's position comes from its own log.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Repair the shared environment once for the whole run

**Files:**
- Modify: `src/ports.ts` (add `RepairRequest`, `RepairCoordinator`; `SurfacePorts.repairCoordinator?`)
- Modify: `src/errors.ts` (add `RunHalted`)
- Modify: `src/breaker.ts` (add `createRunBreaker`)
- Modify: `src/index.ts` (export the two port types beside `SurfacePorts`)
- Test: `src/breaker.test.ts`

**Interfaces:**
- Consumes: Task 2's helpers; `appendRunEntry`, `createRunFile`, `loadRunFile` (`src/run-file.ts`); `Terminus` (`src/ports.ts`).
- Produces:
  - In `src/ports.ts`:
    ```ts
    export interface RepairRequest { surfaceId: string; key: string | null; reason: string }
    export interface RepairCoordinator {
      awaitClearance(surfaceId: string): Promise<() => void>;
      requestRepair(request: RepairRequest): Promise<void>;
    }
    // SurfacePorts gains: repairCoordinator?: RepairCoordinator;
    ```
  - In `src/errors.ts`: `class RunHalted extends Error { readonly reason: string }`.
  - In `src/breaker.ts`:
    ```ts
    export interface BreakerChange { state: BreakerState; affected: string[]; repair?: { attempt: number; of: number } }
    export interface RunBreakerOptions {
      dir: string; history: readonly RunEntry[]; limit: number;
      dispatch(surfaceId: string, sessionKey: string): Promise<Terminus>;
      onChange(change: BreakerChange): void;
    }
    export interface RunBreaker extends RepairCoordinator { readonly gaveUp: string | undefined }
    export const RECOVERED_REPAIR: string;
    export function couldNotRepair(attempts: number): string;
    export function createRunBreaker(options: RunBreakerOptions): RunBreaker;
    ```

- [ ] **Step 1: Write the failing tests**

Append to `src/breaker.test.ts` (merge imports: `mkdtempSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, `createRunFile`, `loadRunFile` from `./run-file.js`, `RunHalted` from `./errors.js`, `Terminus` from `./ports.js`, `createRunBreaker`, `couldNotRepair`, `RECOVERED_REPAIR`, `BreakerChange` from `./breaker.js`):

```ts
/** Let every promise callback already queued run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A run file on disk, a breaker over it, and a repair whose answers the test gives one at a time. */
async function breakerOver(history: RunEntry[] = [], limit = 2) {
  const dir = mkdtempSync(join(tmpdir(), "breaker-"));
  await createRunFile(dir, { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: limit } });
  const { appendRunEntry } = await import("./run-file.js");
  for (const entry of history) await appendRunEntry(dir, entry);
  const dispatched: string[] = [];
  const answers: PromiseWithResolvers<Terminus>[] = [];
  const changes: BreakerChange[] = [];
  const breaker = createRunBreaker({
    dir,
    history,
    limit,
    dispatch: (surfaceId, sessionKey) => {
      dispatched.push(`${surfaceId}:${sessionKey}`);
      const answer = Promise.withResolvers<Terminus>();
      answers.push(answer);
      return answer.promise;
    },
    onChange: (change) => changes.push(change),
  });
  const answer = async (terminus: Terminus) => {
    answers.at(-1)?.resolve(terminus);
    await settle();
  };
  const entries = async () => (await loadRunFile(dir)).history;
  return { dir, breaker, dispatched, changes, answer, entries };
}

const fixed: Terminus = { status: "completed", rationale: "restored the helper" };
const nothing: Terminus = { status: "incomplete", rationale: "ended without a result" };

describe("one repair of the shared environment for the whole run", () => {
  it("lets a task check its work straight away while the environment is healthy, recording nothing", async () => {
    const { breaker, entries } = await breakerOver();
    const leave = await breaker.awaitClearance("a");
    leave();
    expect(await entries()).toEqual([]);
  });

  it("runs one repair however many tasks ask, counts it once, and releases them all when it works", async () => {
    const { breaker, dispatched, answer, entries, changes } = await breakerOver();
    const first = breaker.requestRepair({ surfaceId: "a", key: null, reason: "the shared helper is missing" });
    const second = breaker.requestRepair({ surfaceId: "b", key: "triage-2", reason: "triage routed the setback to a gate repair" });
    const held = breaker.awaitClearance("c");
    await settle();
    expect(dispatched).toEqual(["a:run-repair-1"]);

    await answer(fixed);
    await Promise.all([first, second]);
    (await held)();

    expect((await entries()).map((entry) => entry.t)).toEqual([
      "breaker_degraded", "repair_request", "repair_request", "held", "repair_dispatch", "repair_terminus", "breaker_healthy",
    ]);
    expect(changes).toEqual([
      { state: "DEGRADED", affected: ["a"] },
      { state: "REPAIRING", affected: ["a", "b", "c"], repair: { attempt: 1, of: 2 } },
      { state: "HEALTHY", affected: ["a", "b", "c"] },
    ]);
  });

  it("waits for a task already checking its work before starting the repair", async () => {
    const { breaker, dispatched } = await breakerOver();
    const leave = await breaker.awaitClearance("b");
    const asked = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    await settle();
    expect(dispatched).toEqual([]);

    leave();
    await settle();
    expect(dispatched).toEqual(["a:run-repair-1"]);
    void asked.catch(() => undefined);
  });

  it("tries again after a repair that ended without a result, within the run's limit", async () => {
    const { breaker, dispatched, answer } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    await settle();
    await answer(nothing);
    await answer(fixed);
    await asked;
    expect(dispatched).toEqual(["a:run-repair-1", "a:run-repair-2"]);
  });

  it("gives up once the run's limit is spent, stopping every held task and every later one", async () => {
    const { breaker, answer, entries } = await breakerOver([], 1);
    const asked = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    const held = breaker.awaitClearance("b");
    await settle();
    await answer(nothing);

    await expect(asked).rejects.toBeInstanceOf(RunHalted);
    await expect(held).rejects.toBeInstanceOf(RunHalted);
    await expect(breaker.awaitClearance("c")).rejects.toBeInstanceOf(RunHalted);
    expect(breaker.gaveUp).toBe(couldNotRepair(1));
    expect((await entries()).at(-1)).toEqual({ t: "run_escalated", reason: couldNotRepair(1) });
  });

  it("counts repairs across trips against the one limit", async () => {
    const { breaker, answer, dispatched } = await breakerOver([], 2);
    const one = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    await settle();
    await answer(fixed);
    await one;
    const two = breaker.requestRepair({ surfaceId: "b", key: null, reason: "broken again" });
    await settle();
    await answer(fixed);
    await two;

    await expect(breaker.requestRepair({ surfaceId: "a", key: null, reason: "and again" })).rejects.toBeInstanceOf(RunHalted);
    expect(dispatched).toEqual(["a:run-repair-1", "b:run-repair-2"]);
  });

  it("gives up at once when the repair says only a change to the check would fix it", async () => {
    const { breaker, answer } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    await settle();
    await answer({ status: "escalate", category: "authority", rationale: "the only fix is to the check" });
    await expect(asked).rejects.toThrow("the only fix is to the check");
  });

  it("gives up at once on a repair session that never started", async () => {
    const { breaker, answer, dispatched } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", key: null, reason: "broken" });
    await settle();
    await answer({ status: "incomplete", rationale: "the runtime would not start", notRun: true });
    await expect(asked).rejects.toBeInstanceOf(RunHalted);
    expect(dispatched).toHaveLength(1);
  });

  it("answers a request already repaired before a crash without tripping again", async () => {
    const history: RunEntry[] = [
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "broken" } },
      { t: "repair_request", surfaceId: "a", key: "triage-2" },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "a" },
      { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "fixed" },
      { t: "breaker_healthy" },
    ];
    const { breaker, dispatched, entries } = await breakerOver(history);
    await breaker.requestRepair({ surfaceId: "a", key: "triage-2", reason: "broken" });
    expect(dispatched).toEqual([]);
    expect(await entries()).toEqual(history);
  });

  it("resumes into a repair a crash interrupted, in the same trip, rather than losing it", async () => {
    const history: RunEntry[] = [
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "broken" } },
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "a" },
    ];
    const { breaker, dispatched, answer, entries } = await breakerOver(history);
    const held = breaker.awaitClearance("b");
    await settle();
    expect(dispatched).toEqual(["a:run-repair-2"]);
    await answer(fixed);
    (await held)();

    const after = await entries();
    expect(after.filter((entry) => entry.t === "breaker_degraded")).toHaveLength(1);
    expect(after.filter((entry) => entry.t === "repair_terminus")).toMatchObject([
      { attempt: 1, status: "incomplete", rationale: RECOVERED_REPAIR },
      { attempt: 2, status: "completed" },
    ]);
  });

  it("stays stopped when picked up after it gave up", async () => {
    const { breaker } = await breakerOver([
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "broken" } },
      { t: "run_escalated", reason: "gave up" },
    ]);
    expect(breaker.gaveUp).toBe("gave up");
    await expect(breaker.awaitClearance("a")).rejects.toBeInstanceOf(RunHalted);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/breaker.test.ts`
Expected: FAIL: `createRunBreaker` is not exported.

- [ ] **Step 3: Implement**

In `src/errors.ts`:

```ts
/**
 * The run of several tasks at once has given up on the environment its tasks
 * share. Thrown at a task's next check or hand-off, so the task stops where it
 * is without an outcome of its own: nothing it did caused this, and a later
 * run picks it up from there.
 */
export class RunHalted extends Error {
  constructor(readonly reason: string) {
    super(`The run stopped: ${reason}`);
    this.name = "RunHalted";
  }
}
```

In `src/ports.ts`, after `CloserPort`:

```ts
// --- RepairCoordinator (createRunBreaker in breaker.ts; absent for a task run on its own) ---

/** A task asking for the environment every task shares to be repaired. `key` names the setback it is asking about, when it has one. */
export interface RepairRequest {
  surfaceId: string;
  key: string | null;
  reason: string;
}

/**
 * How a task in a run of several at once shares one environment with the
 * others. A task checks and hands off its work only once cleared, and asks the
 * run to repair a broken environment rather than repairing it itself. Absent,
 * a task behaves exactly as it does on its own.
 */
export interface RepairCoordinator {
  /** Wait until the shared environment may be used, then return the function that says this task is done with it. */
  awaitClearance(surfaceId: string): Promise<() => void>;
  /** Resolve once the run's one repair has fixed it; rejects with `RunHalted` if the run gave up. */
  requestRepair(request: RepairRequest): Promise<void>;
}
```

and `SurfacePorts` gains `repairCoordinator?: RepairCoordinator;` with a one-line comment ("Set only for a task of a run of several at once.").

In `src/index.ts`, add `RepairCoordinator` and `RepairRequest` to the type export list from `./ports.js`.

In `src/breaker.ts`, add (imports: `appendRunEntry` from `./run-file.js`, `RunHalted` from `./errors.js`, `RepairCoordinator`, `Terminus` types from `./ports.js`):

```ts
export const RECOVERED_REPAIR = "the repair session ended without recording a result (recovered on resume)";

export const couldNotRepair = (attempts: number): string =>
  `the shared environment could not be repaired after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}; no task caused this`;

/** A change in the shared environment's state, and every task it affects. */
export interface BreakerChange {
  state: BreakerState;
  affected: string[];
  repair?: { attempt: number; of: number };
}

export interface RunBreakerOptions {
  /** The run's own record. */
  dir: string;
  /** What that record already holds: empty for a new run, the stopped run's history when picked up. */
  history: readonly RunEntry[];
  /** Repair attempts the whole run may spend. */
  limit: number;
  /** One gate-maintenance session, in the copy and record of the task named. */
  dispatch(surfaceId: string, sessionKey: string): Promise<Terminus>;
  onChange(change: BreakerChange): void;
}

export interface RunBreaker extends RepairCoordinator {
  /** Why the run gave up on the shared environment, once it has: start nothing more. */
  readonly gaveUp: string | undefined;
}

/**
 * The one coordinator of a run's shared environment. Everything it decides is
 * written to the run file first, in the order it was decided, so a crash
 * leaves a history the next process folds back into the same state.
 *
 * A trip holds every check and hand-off; the repair starts only once no task
 * is mid-check or mid-hand-off, and every request while it is pending shares
 * it. A task picked up while its run was repairing finds the repair started
 * again here at its first hold, since nobody else would start it.
 */
export function createRunBreaker({ dir, history, limit, dispatch, onChange }: RunBreakerOptions): RunBreaker {
  const log: RunEntry[] = [...history];
  let state = breakerOf(log);
  let gaveUp = log.findLast((entry) => entry.t === "run_escalated")?.reason;
  let writing: Promise<void> = Promise.resolve();
  const inFlight = new Set<string>();
  let idleWaiters: (() => void)[] = [];
  let repairing: Promise<void> | undefined;

  // In memory at once, so two tasks asking in the same instant see one trip; on disk in the same order.
  function record(entry: RunEntry): Promise<void> {
    log.push(entry);
    state = nextBreaker(state, entry);
    writing = writing.then(() => appendRunEntry(dir, entry));
    return writing;
  }

  const affected = (): string[] => [...(openTrip(log)?.held ?? [])];

  function whenIdle(): Promise<void> {
    if (inFlight.size === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function leave(surfaceId: string): void {
    inFlight.delete(surfaceId);
    if (inFlight.size > 0) return;
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  }

  async function giveUp(reason: string): Promise<never> {
    await record({ t: "run_escalated", reason });
    gaveUp = reason;
    throw new RunHalted(reason);
  }

  async function repair(): Promise<void> {
    await whenIdle();
    const trip = openTrip(log);
    if (trip === undefined) return;
    for (;;) {
      const dangling = openDispatch(log);
      if (dangling !== undefined) {
        await record({ t: "repair_terminus", attempt: dangling.attempt, sessionKey: dangling.sessionKey, status: "incomplete", rationale: RECOVERED_REPAIR });
      }
      const used = repairsUsed(log);
      if (used >= limit) return giveUp(couldNotRepair(used));
      const attempt = used + 1;
      const sessionKey = `run-repair-${attempt}`;
      await record({ t: "repair_dispatch", attempt, sessionKey, surfaceId: trip.cause.surfaceId });
      onChange({ state: "REPAIRING", affected: affected(), repair: { attempt, of: limit } });
      const terminus = await dispatch(trip.cause.surfaceId, sessionKey);
      await record({ t: "repair_terminus", attempt, sessionKey, status: terminus.status, rationale: terminus.rationale });
      if (terminus.status === "completed") {
        const released = affected();
        await record({ t: "breaker_healthy" });
        onChange({ state: "HEALTHY", affected: released });
        return;
      }
      // As for a task's own repair: an escalate, or a session that never started, will not go better next time.
      if (terminus.status === "escalate" || terminus.notRun) {
        return giveUp(`the repair could not fix the shared environment: ${terminus.rationale}; no task caused this`);
      }
    }
  }

  const ensureRepair = (): Promise<void> =>
    (repairing ??= repair().finally(() => {
      repairing = undefined;
    }));

  return {
    get gaveUp() {
      return gaveUp;
    },

    async awaitClearance(surfaceId) {
      for (;;) {
        if (gaveUp !== undefined) throw new RunHalted(gaveUp);
        if (state === "HEALTHY") {
          inFlight.add(surfaceId);
          return () => leave(surfaceId);
        }
        if (!affected().includes(surfaceId)) await record({ t: "held", surfaceId });
        await ensureRepair();
      }
    },

    async requestRepair({ surfaceId, key, reason }) {
      if (gaveUp !== undefined) throw new RunHalted(gaveUp);
      if (key !== null && servedAlready(log, surfaceId, key)) return;
      if (state === "HEALTHY") {
        const tripped = record({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
        onChange({ state: "DEGRADED", affected: [surfaceId] });
        await tripped;
      }
      if (!requestedInOpenTrip(log, surfaceId, key)) await record({ t: "repair_request", surfaceId, key });
      await ensureRepair();
    },
  };
}
```

Note on `terminus.notRun`: `Terminus`'s incomplete variant declares `notRun?: true`; after the `escalate` check the remaining non-completed variant is `incomplete`, so `terminus.notRun` narrows cleanly. If the compiler cannot narrow it inside the `||`, write `(terminus.status === "incomplete" && terminus.notRun === true)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/breaker.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts src/errors.ts src/breaker.ts src/breaker.test.ts src/index.ts
git commit -m "Repair a run's shared environment once, whoever asks

Several tasks meeting one broken environment would each dispatch their own
repair and fight over it. One coordinator per run now records the trip, holds
every check and hand-off, waits for the tasks already mid-check, runs one
gate-maintenance repair on one run-wide limit for every request, and stops the
run when it cannot repair it, picking an interrupted repair back up on resume.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hold a task's checks and hand-off, and ask the run for repairs

**Files:**
- Modify: `src/surface.ts` (`preGating`, `gating`, `closing`, `dispatchGateMaintenance`, `gateMaintenance`, `advance`)
- Modify: `docs/multi-surface-control-flow.md` ("Shared-environment failure" section)
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `RepairCoordinator`, `RepairRequest` (`src/ports.ts`), `RunHalted` (`src/errors.ts`), from Task 3.
- Produces: no new exports. `gating` gains a `ports` parameter (internal). Behaviour with `ports.repairCoordinator` set:
  - the gate's `baseline`, its `check` and the accepted `closer.close` each run between `awaitClearance(surfaceId)` and its release;
  - a gate-maintenance edge calls `requestRepair({ surfaceId, key, reason })` (key = the log tail's triage `artifactRef`, else `null`), writes no dispatch or terminus into the case file and spends none of the task's own `gateMaintenance` budget, then re-takes the baseline (no baseline yet) or re-checks the same attempt;
  - a `RunHalted` propagates out of `advance` and no outcome is written.

- [ ] **Step 1: Write the failing tests**

Append to `src/surface.test.ts` (merge imports: `RepairCoordinator`, `RepairRequest` from `./ports.js`; `RunHalted` from `./errors.js`):

```ts
/** A coordinator that clears at once and records what it was asked, with `repair` standing in for the run's one repair. */
function fakeCoordinator(repair: () => void = () => undefined) {
  const events: string[] = [];
  const requests: RepairRequest[] = [];
  const coordinator: RepairCoordinator = {
    awaitClearance: (surfaceId) => {
      events.push(`enter ${surfaceId}`);
      return Promise.resolve(() => {
        events.push(`leave ${surfaceId}`);
      });
    },
    requestRepair: (request) => {
      requests.push(request);
      events.push(`repair ${request.surfaceId}`);
      repair();
      return Promise.resolve();
    },
  };
  return { coordinator, events, requests };
}

describe("a task of a run of several at once", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-supervised-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  it("takes its baseline only once cleared, and lets go before anything else", async () => {
    const { coordinator, events } = fakeCoordinator();
    const ports = { ...portsWith(unusedAgent()), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect(await advance(dir, location, ports)).toEqual({ state: "AGENT_ACTIVE", done: false });
    expect(events).toEqual(["enter surface-1", "leave surface-1"]);
  });

  it("asks the run to repair a gate that cannot run, instead of dispatching its own repair, then re-takes the baseline", async () => {
    let location: SurfaceLocation = { repoPath: "", worktreePath: "" };
    const { coordinator, events, requests } = fakeCoordinator(() => writeFileSync(join(location.worktreePath, "report.tap"), PASSING_TAP));
    const ports = { ...portsWith(unusedAgent()), repairCoordinator: coordinator };
    location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    expect(await advance(dir, location, ports)).toEqual({ state: "AGENT_ACTIVE", done: false });
    expect(requests).toEqual([{ surfaceId: "surface-1", key: null, reason: expect.any(String) }]);
    // The hold was let go before the request: the task must not wait on itself.
    expect(events).toEqual(["enter surface-1", "leave surface-1", "repair surface-1", "enter surface-1", "leave surface-1"]);
    const { history } = await load(dir);
    expect(history.some((entry) => entry.t === "dispatch")).toBe(false);
    expect(deriveBudgetsFromLog(history, budgets).gateMaintenance.used).toBe(0);
  });

  it("asks about a repair triage ordered by naming that round, then re-checks the same attempt", async () => {
    const breaks = (ctx: AgentContext): Promise<Terminus> => {
      rmSync(join(ctx.worktreePath, "report.tap"));
      return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
    };
    let location: SurfaceLocation = { repoPath: "", worktreePath: "" };
    const { coordinator, requests } = fakeCoordinator(() => writeFileSync(join(location.worktreePath, "report.tap"), PASSING_TAP));
    const ports = { ...portsWithTriage(sessionAgent((_role, ctx) => breaks(ctx))), repairCoordinator: coordinator };
    location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    const { history } = await load(dir);
    const fix = history.find((entry) => entry.t === "triage" && entry.verdict === "fix_the_gate");
    expect(fix).toBeDefined();
    expect(requests).toEqual([{ surfaceId: "surface-1", key: fix?.t === "triage" ? fix.artifactRef : "", reason: expect.any(String) }]);
    expect(history.filter((entry) => entry.t === "dispatch")).toMatchObject([{ role: "worker" }]);
    expect(history.filter((entry) => entry.t === "gate").at(-1)).toMatchObject({ attempt: 1, status: "PASS" });
  });

  it("hands off its accepted work only once cleared", async () => {
    const { coordinator, events } = fakeCoordinator();
    const closer = { close: (_ctx: CloseContext) => { events.push("close"); return Promise.resolve({ status: "DONE" as const, detail: "closed" }); } };
    const ports = { ...portsWithTriage(sessionAgent(() => Promise.resolve({ status: "completed", rationale: "done" })), closer), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");
    // baseline, check, close: each inside its own hold.
    expect(events).toEqual([
      "enter surface-1", "leave surface-1",
      "enter surface-1", "leave surface-1",
      "enter surface-1", "close", "leave surface-1",
    ]);
  });

  it("stops where it is, with no outcome of its own, when the run has given up", async () => {
    const coordinator: RepairCoordinator = {
      awaitClearance: () => Promise.reject(new RunHalted("the shared environment could not be repaired")),
      requestRepair: () => Promise.reject(new RunHalted("the shared environment could not be repaired")),
    };
    const ports = { ...portsWith(unusedAgent()), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await expect(advance(dir, location, ports)).rejects.toBeInstanceOf(RunHalted);
    expect((await load(dir)).outcome).toBeUndefined();
  });
});
```

(`provisioned` runs the first advance, provisioning, which takes no hold, so each test's `events` start at the baseline. If the worker's `writeFileSync` import is missing, it is already imported at the top of the file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "a task of a run of several at once"`
Expected: FAIL: no `enter`/`repair` events; a gate-maintenance dispatch is made through `unusedAgent`, which rejects.

- [ ] **Step 3: Implement**

In `src/surface.ts`, add after `locationOf`:

```ts
/**
 * Run `work`, a step that touches what every task of a run shares (taking
 * the baseline, checking the work, handing it off), once the run clears it.
 * Only the shared operation is held, so a task has let go before it asks for
 * a repair and never waits on itself. A task on its own has no coordinator
 * and runs `work` at once.
 */
async function onSharedGround<T>(ports: SurfacePorts, caseFile: CaseFile, work: () => Promise<T>): Promise<T> {
  const leave = await ports.repairCoordinator?.awaitClearance(caseFile.header.surfaceId);
  try {
    return await work();
  } finally {
    leave?.();
  }
}
```

Change the three shared steps:

```ts
// preGating
const report = await onSharedGround(ports, caseFile, () => recordBaseline(dir, locationOf(caseFile, location)));

// gating: add the ports parameter
async function gating(dir: string, caseFile: CaseFile, location: SurfaceLocation, ports: SurfacePorts): Promise<AdvanceResult> {
  const { delta } = await onSharedGround(ports, caseFile, () =>
    runCheck(dir, locationOf(caseFile, location), workerAttempt(caseFile.history)),
  );
  ...unchanged
}

// closing
const report = await onSharedGround(ports, caseFile, () => ports.closer.close(ctx, { kind: "accepted" }));
```

and pass `ports` at the two `gating(...)` call sites (`gateMaintenance`'s completed branch and `advance`'s `GATING` case).

At the top of `dispatchGateMaintenance`, before the budget check:

```ts
  // In a run of several at once the environment is shared, so the run repairs it, once, on its own limit.
  const coordinator = ports.repairCoordinator;
  if (coordinator) {
    const tail = logTail(caseFile);
    await coordinator.requestRepair({
      surfaceId: caseFile.header.surfaceId,
      // A post-task request names the triage round that ordered it, so a crash after the repair is not repaired twice.
      key: tail?.t === "triage" ? tail.artifactRef : null,
      reason,
    });
    return caseFile.header.baseline === null ? preGating(dir, caseFile, location, ports) : gating(dir, caseFile, location, ports);
  }
```

Update `dispatchGateMaintenance`'s doc comment with one sentence: "A task of a run of several at once asks the run instead, and spends none of its own budget."

In `docs/multi-surface-control-flow.md`, in "Shared-environment failure", replace the "A surface hitting `GATE_MAINTENANCE` ..." and "**Full stop-the-world**" bullets with:

```markdown
- A surface hitting `GATE_MAINTENANCE` does **not** dispatch its own repair agent.
  It asks the run, which trips the breaker to `DEGRADED` and records the trip,
  the request and every task it holds in the run file (not the case file).
- **Checks and hand-offs are held, nothing else.** While the breaker is not
  `HEALTHY`, a surface about to take its baseline, check its work or hand it off
  waits; an agent session or triage call already under way carries on, since
  neither touches the shared environment. The one repair starts once no surface
  is mid-check or mid-hand-off, runs the existing gate-maintenance role in the
  copy of the surface that tripped it, and every request meanwhile shares it.
  (Settled in the multi-surface supervisor design, replacing the earlier
  full stop-the-world window.)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts src/surface-close.test.ts && npx tsc --noEmit`
Expected: PASS, including every existing surface test unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts docs/multi-surface-control-flow.md
git commit -m "Hold a task's checks and hand-off, and ask its run for repairs

A task in a run of several at once shares its environment with the others,
so it must not check or hand off work while that environment is broken, and
must not repair it on its own. Through the optional coordinator port it waits
for clearance around exactly those steps and asks the run for the repair; a
task on its own behaves as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Say when the shared environment breaks, is repaired and is fixed

**Files:**
- Modify: `src/cli/report.ts`
- Modify: `src/cli/output.ts` (the live sentences)
- Test: `src/cli/report.test.ts`

**Interfaces:**
- Consumes: `BreakerState` (`src/schema.ts`), `BREAKER_PHRASES` (Task 1).
- Produces:
  - `RunState = "STARTED" | "RESUMED" | "DRAINED" | "ESCALATED" | BreakerState`
  - `RunEvent { runId: string; state: RunState; affected?: readonly string[]; repair?: { attempt: number; of: number } }`
  - `RunEventRecord` gains `affected: string[] | null`; `done` is true for `DRAINED` and `ESCALATED`.
  - In `src/cli/output.ts`: `ENVIRONMENT_BROKE: string`, `repairingLine(repair?: { attempt: number; of: number }): string`, `FIXED_RESUMING = "✓ Fixed. Resuming."`.

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/report.test.ts` (reuse its existing capture helpers; if it has none, collect lines into arrays as below):

```ts
describe("the shared environment, as a run of several at once tells it", () => {
  const runId = "run-20260930T090000Z";

  it("says in plain words that it broke, one repairing line per attempt, and that it is fixed", () => {
    const lines: string[] = [];
    const report = plainReporter((line) => lines.push(line), false);
    report.run({ runId, state: "DEGRADED", affected: ["a"] });
    report.run({ runId, state: "REPAIRING", affected: ["a", "b"], repair: { attempt: 1, of: 2 } });
    report.run({ runId, state: "HEALTHY", affected: ["a", "b"] });
    expect(lines).toEqual([
      "! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.",
      "  - repairing (attempt 1 of 2)",
      "✓ Fixed. Resuming.",
    ]);
    expect(lines.join("\n")).not.toMatch(/DEGRADED|REPAIRING|HEALTHY/);
  });

  it("says nothing of its own for the run starting, finishing or giving up: those are notes", () => {
    const lines: string[] = [];
    const report = plainReporter((line) => lines.push(line), false);
    for (const state of ["STARTED", "RESUMED", "DRAINED", "ESCALATED"] as const) report.run({ runId, state });
    expect(lines).toEqual([]);
  });

  it("writes one run-scope record per change under --json, naming the tasks affected, null where none", () => {
    const records: string[] = [];
    const now = () => new Date("2026-09-30T09:00:00.000Z");
    const report = jsonReporter((line) => records.push(line), () => undefined, now);
    report.run({ runId, state: "STARTED" });
    report.run({ runId, state: "DEGRADED", affected: ["a"] });
    report.run({ runId, state: "ESCALATED", affected: ["a", "b"] });
    expect(records.map((line) => JSON.parse(line))).toEqual([
      { scope: "run", runId, state: "STARTED", done: false, affected: null, at: "2026-09-30T09:00:00.000Z" },
      { scope: "run", runId, state: "DEGRADED", done: false, affected: ["a"], at: "2026-09-30T09:00:00.000Z" },
      { scope: "run", runId, state: "ESCALATED", done: true, affected: ["a", "b"], at: "2026-09-30T09:00:00.000Z" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/report.test.ts`
Expected: FAIL: `"DEGRADED"` is not assignable to `RunState` (type error at transform) or no lines are written.

- [ ] **Step 3: Implement**

In `src/cli/output.ts`:

```ts
/** The first letter of a phrase made a capital, for a phrase that opens a sentence. */
const opening = (phrase: string): string => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** What a run of several at once says when a task finds the shared environment broken. */
export const ENVIRONMENT_BROKE =
  `! ${opening(BREAKER_PHRASES.DEGRADED)}. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.`;

/** One line per repair attempt. */
export const repairingLine = (repair?: { attempt: number; of: number }): string =>
  `  - repairing${repair === undefined ? "" : ` (attempt ${repair.attempt} of ${repair.of})`}`;

export const FIXED_RESUMING = "✓ Fixed. Resuming.";
```

In `src/cli/report.ts`:

```ts
import type { BreakerState, SurfaceState } from "../schema.js";
import { ENVIRONMENT_BROKE, FIXED_RESUMING, paint, putRight, repairingLine, STEP_PHRASES } from "./output.js";

/**
 * What a run of several tasks at once says of itself: that it has started, been
 * picked up, finished every task it could take or given up on its shared
 * environment, and each change in that environment's state.
 */
export type RunState = "STARTED" | "RESUMED" | "DRAINED" | "ESCALATED" | BreakerState;
export interface RunEvent {
  runId: string;
  state: RunState;
  /** The task run ids a change in the shared environment affects. */
  affected?: readonly string[];
  /** Which repair attempt of how many, for a repair starting. */
  repair?: { attempt: number; of: number };
}

export interface RunEventRecord {
  scope: "run";
  runId: string;
  state: RunState;
  done: boolean;
  affected: string[] | null;
  at: string;
}
```

`plainReporter`'s `run`:

```ts
    // The run's shape and its end are notes; only the shared environment's changes are said here, untagged, as they are the run's own.
    run(event) {
      if (event.state === "DEGRADED") writeLine(paint(colour, "attention", ENVIRONMENT_BROKE));
      else if (event.state === "REPAIRING") writeLine(paint(colour, "quiet", repairingLine(event.repair)));
      else if (event.state === "HEALTHY") writeLine(paint(colour, "done", FIXED_RESUMING));
    },
```

`jsonReporter`'s `run`:

```ts
    run(event) {
      write({
        scope: "run",
        runId: event.runId,
        state: event.state,
        done: event.state === "DRAINED" || event.state === "ESCALATED",
        affected: event.affected === undefined ? null : [...event.affected],
        at: now().toISOString(),
      });
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/report.test.ts src/cli/output.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/report.ts src/cli/output.ts src/cli/report.test.ts
git commit -m "Say when a run's shared environment breaks, is repaired and is fixed

An owner watching a run of several at once needs one plain message that the
shared environment is broken and why tasks are held, one line per repair, and
that it is fixed; a script needs one run-scope record per change naming the
tasks it affects. Internal state names stay out of the human stream.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Give every run of several at once one breaker, and stop the run when it gives up

**Files:**
- Modify: `src/cli/context.ts` (`repairCoordinator?` on `CommandContext`)
- Modify: `src/cli/drive.ts` (`driveToOutcome` passes the coordinator; add `dispatchRepair`)
- Modify: `src/cli/queue.ts` (create the breaker, stop filling, catch `RunHalted`, the environment stop, resume of a run that gave up)
- Modify: `src/supervisor.ts` (doc comment only: a throw may also be the run halting)
- Modify: `src/cli/command-fixtures.ts` (`writeRunRecord` takes an optional `gate`)
- Modify: `README.md`, `docs/testing-your-pipeline.md`
- Create: `.changeset/repair-a-broken-shared-environment-once.md`
- Test: `src/cli/run-command.test.ts`, `src/cli/queue.test.ts`

**Interfaces:**
- Consumes: `createRunBreaker`, `repairsUsed`, `openTrip`, `tripsOf` (`src/breaker.ts`); `RunHalted`; `RunEvent` states (Task 5); `RunOutcome` escalated (Task 1).
- Produces:
  - `CommandContext.repairCoordinator?: RepairCoordinator` ("Set only for a task of a run of several at once").
  - `dispatchRepair(record: RunRecord, sessionKey: string, session: SessionEnvironment, env: NodeJS.ProcessEnv): Promise<Terminus>` in `src/cli/drive.ts`.
  - In `src/cli/queue.ts`: `interface ListStandings { waiting: number; finished: number; queued: number }`, `listStandings(records: RunRecord[], tasks: TaskDef[]): ListStandings`, `environmentGaveUp(attempts: number, standings: ListStandings, of: number): string`.
  - `writeRunRecord(repo, { ..., gate?: GateRef })`.

- [ ] **Step 1: Write the failing tests**

In `src/cli/queue.test.ts`:

```ts
describe("what a run of several at once says when it gives up on its shared environment", () => {
  it("says how many attempts it made, and how many tasks were waiting, had finished and are still queued", () => {
    expect(environmentGaveUp(2, { waiting: 2, finished: 5, queued: 3 }, 10)).toBe(
      "Couldn't fix it after 2 attempts. Stopping the run. 2 of 10 tasks were waiting on this and need your attention; 5 had already finished, 3 are still queued.",
    );
    expect(environmentGaveUp(1, { waiting: 1, finished: 0, queued: 1 }, 2)).toBe(
      "Couldn't fix it after 1 attempt. Stopping the run. 1 of 2 tasks was waiting on this and needs your attention; 0 had already finished, 1 is still queued.",
    );
  });

  it("counts a list task with an unfinished run as waiting, one with an ended run as finished, and one with none as queued", async () => {
    const repo = await scratchRepo(); // the helper this file already uses for records
    await writeRunRecord(repo, { runId: "add-a-hello-20260930T090000Z", task: "add a hello" });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260930T090000Z", task: "add a goodbye", outcome: { kind: "closed", source: "closer", reason: "done", at: "2026-09-30T09:10:00.000Z" } });
    const tasks = [{ intent: "add a hello" }, { intent: "add a goodbye" }, { intent: "add a shout" }];
    expect(listStandings(await allRuns(repo), tasks)).toEqual({ waiting: 1, finished: 1, queued: 1 });
  });
});
```

In `src/cli/run-command.test.ts`, inside `describe("delivery run with several tasks at once", ...)` add a nested describe (imports: `writeFileSync`, `mkdirSync` if missing; `RECOVERED_REPAIR` from `../../src/breaker.js` path as the file already imports from `../`):

```ts
  describe("when the shared environment breaks", () => {
    /**
     * A check whose shared helper is missing until some task's repair leaves a
     * `.restored` marker in its copy; once any gate run sees one it stays
     * restored for the rest of the process, as a helper put back would. Custom
     * gates load from the repository root, outside every task's copy.
     */
    const RESTORABLE_GATE = [
      'import { existsSync, readdirSync } from "node:fs";',
      'import { dirname, join } from "node:path";',
      "let restored = false;",
      "const restoredIn = (copy) => readdirSync(dirname(copy)).some((other) => existsSync(join(dirname(copy), other, \".restored\")));",
      "const measure = async ({ worktreePath }) => {",
      "  restored ||= restoredIn(worktreePath);",
      '  return restored ? { status: "PASS", assertions: [{ id: "shared-helper", outcome: "PASS", detail: "answered" }] } : { status: "ERROR", assertions: [], detail: "the shared helper is missing" };',
      "};",
      "export default { baseline: measure, check: measure };",
    ].join("\n");
    const BROKEN_GATE = 'const measure = async () => ({ status: "ERROR", assertions: [], detail: "the shared helper is missing" });\nexport default { baseline: measure, check: measure };\n';
    const gateRef: GateRef = { type: "custom", modulePath: "./gates/shared.mjs" };

    const brokenRepo = (prefix: string, gate: string, tasks: string[]) => {
      const repo = initTempRepo(prefix, {
        "package.json": PACKAGE,
        "gates/shared.mjs": gate,
        "delivery.config.json": JSON.stringify({ tasks, concurrency: 2, gate: gateRef }),
      });
      return repo;
    };
    /** Every session, worker or repair, writes the task's file; a repair's `.restored` is what puts the helper back. */
    const restores: MockScript = {
      expectations: [{
        effects: [
          { write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } },
          { write: { path: ".restored", content: "yes\n" } },
        ],
        json: { status: "completed", rationale: "did it" },
      }],
    };
    const ofType = <T extends RunEntry["t"]>(history: RunEntry[], t: T) => history.filter((entry): entry is Extract<RunEntry, { t: T }> => entry.t === t);

    it(
      "holds the tasks, repairs once, says it is fixed, and finishes every task",
      async () => {
        const repo = brokenRepo("run-command-breaker-fixed-", RESTORABLE_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(restores) } });

        expect(exitCode).toBe(EXIT.ok);
        const lines = stdout.split("\n");
        expect(lines.filter((line) => line.startsWith("! Something in the shared environment looks broken"))).toHaveLength(1);
        expect(lines.filter((line) => line === "  - repairing (attempt 1 of 2)")).toHaveLength(1);
        expect(lines.filter((line) => line === "✓ Fixed. Resuming.")).toHaveLength(1);
        expect(lines.at(-2)).toBe(EVERY_TASK_DONE);
        expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|GATE_MAINTENANCE/);

        const { history } = await theRunFile(repo);
        expect(ofType(history, "breaker_degraded")).toHaveLength(1);
        expect(ofType(history, "repair_dispatch")).toHaveLength(1);
        expect(ofType(history, "breaker_healthy")).toHaveLength(1);
        for (const record of await allRuns(repo)) {
          expect(record.caseFile.history.filter((entry) => entry.t === "dispatch" && entry.role === "gate-maintenance")).toEqual([]);
        }
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "stops the run when it cannot repair it, naming the environment as the cause, and exits needing a decision",
      async () => {
        const repo = brokenRepo("run-command-breaker-gave-up-", BROKEN_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.escalated);
        expect(stdout.trimEnd().split("\n").at(-1)).toBe(environmentGaveUp(2, { waiting: 2, finished: 0, queued: 1 }, 3));
        expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);

        const runFile = await theRunFile(repo);
        expect(runFile.outcome).toMatchObject({ kind: "escalated", cause: "shared_environment" });
        expect(ofType(runFile.history, "repair_dispatch")).toHaveLength(2);
        expect(fillsOf(runFile.history)).toHaveLength(2);
        // The held tasks stop where they are, with no outcome of their own: nothing they did caused this.
        for (const record of await allRuns(repo)) expect(record.caseFile.outcome).toBeUndefined();
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "under --json writes a run-scope record for each change in the environment, with the tasks affected",
      async () => {
        const repo = brokenRepo("run-command-breaker-json-", BROKEN_GATE, [PAGE, SWAP]);

        const { exitCode, stdout } = await delivery(["run", "--json"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.escalated);
        const runRecords = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as RunEventRecord | SurfaceStepRecord).filter((record): record is RunEventRecord => record.scope === "run");
        expect(runRecords.map((record) => record.state)).toEqual([
          "STARTED", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "ESCALATED",
        ]);
        const taskIds = (await allRuns(repo)).map((record) => record.runId);
        expect(runRecords[1]?.affected).toHaveLength(1);
        expect(taskIds).toContain(runRecords[1]?.affected?.[0]);
        expect(runRecords.at(-1)).toMatchObject({ done: true });
        expect(runRecords[0]?.affected).toBeNull();
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "picks a run stopped in the middle of a repair back up into that repair, in the same trip",
      async () => {
        const repo = brokenRepo("run-command-breaker-resume-", RESTORABLE_GATE, [PAGE]);
        const state = mkdtempSync(join(tmpdir(), "command-state-"));
        const taskId = "add-a-hello-function-20260930T090000Z";
        await writeRunRecord(repo, { runId: taskId, task: PAGE, gate: gateRef });
        await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
          { t: "slot_fill", slot: 1, surfaceId: taskId, taskDef: { intent: PAGE } },
          { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: taskId, reason: "the shared helper is missing" } },
          { t: "repair_request", surfaceId: taskId, key: null },
          { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: taskId },
        ]);

        const { exitCode } = await delivery(["run"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(restores) } });

        expect(exitCode).toBe(EXIT.ok);
        const { history } = await loadRunFile(supervisedPlace(repo, RUN));
        expect(ofType(history, "breaker_degraded")).toHaveLength(1);
        expect(ofType(history, "repair_terminus")).toMatchObject([
          { attempt: 1, status: "incomplete", rationale: RECOVERED_REPAIR },
          { attempt: 2, status: "completed" },
        ]);
        expect(ofType(history, "breaker_healthy")).toHaveLength(1);
      },
      RUN_TIMEOUT * 2,
    );

    it("finishes a run picked up after it gave up but before it could say so, without starting anything", async () => {
      const repo = brokenRepo("run-command-breaker-resume-gave-up-", BROKEN_GATE, [PAGE]);
      const taskId = "add-a-hello-function-20260930T090000Z";
      await writeRunRecord(repo, { runId: taskId, task: PAGE, gate: gateRef });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: taskId, taskDef: { intent: PAGE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: taskId, reason: "the shared helper is missing" } },
        { t: "run_escalated", reason: "the shared environment could not be repaired after 2 attempts; no task caused this" },
      ]);

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain("Stopping the run.");
      expect((await loadRunFile(supervisedPlace(repo, RUN))).outcome).toMatchObject({ kind: "escalated", cause: "shared_environment" });
    });
  });
```

`RUN`, `theRunFile`, `fillsOf`, `PAGE`, `SWAP`, `WAVE` are this describe's existing helpers and constants; reuse them. `EVERY_TASK_DONE` is the last line before the trailing newline split, hence `lines.at(-2)`; if `stdout` has no trailing blank, use `stdout.trimEnd().split("\n").at(-1)` as the neighbouring tests do.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts -t "shared environment"`
Expected: FAIL: `environmentGaveUp`/`listStandings` not exported; the runs repair per task (gate-maintenance dispatches appear in case files) and escalate tasks instead.

- [ ] **Step 3: Implement**

`src/cli/context.ts`: add to `CommandContext`:

```ts
  /** The run's one coordinator of its shared environment. Set only for a task of a run of several at once. */
  repairCoordinator?: RepairCoordinator;
```

`src/cli/drive.ts`: in `driveToOutcome`, build ports as

```ts
  const ports: SurfacePorts = {
    agent,
    triage: deterministicRouter,
    closer: resolveCloser(header.closerRef ?? DEFAULT_CLOSER, repoPath),
    ...(ctx.repairCoordinator === undefined ? {} : { repairCoordinator: ctx.repairCoordinator }),
  };
```

and add:

```ts
/**
 * One repair of the environment every task of a run shares: the existing
 * gate-maintenance role, its instructions and its tools, run in the copy and
 * against the record of the task that found it broken, with that task's own
 * roles. Nothing about what the repair may touch changes because the run asked.
 */
export function dispatchRepair(record: RunRecord, sessionKey: string, session: SessionEnvironment, env: NodeJS.ProcessEnv): Promise<Terminus> {
  const { location } = runPlace(record.repoPath, record.runId, env);
  const agent = createAgentPort(rolesFor(record.caseFile.header.roleOverrides), session);
  return agent.invoke(
    { role: "gate-maintenance" },
    { worktreePath: record.caseFile.cursor.worktreeRef || location.worktreePath, dir: record.dir, sessionKey },
  );
}
```

`src/cli/queue.ts` (imports: `createRunBreaker`, `openTrip`, `repairsUsed`, `tripsOf`, `type RunBreaker` from `../breaker.js`; `RunHalted` from `../errors.js`; `loadRunFile` from `../run-file.js`; `dispatchRepair` from `./drive.js`; `readRun` from `./runs.js`):

```ts
/** How the tasks on the list stand when a run stops: a run under way, a run that ended, or none yet. */
export interface ListStandings {
  waiting: number;
  finished: number;
  queued: number;
}

export function listStandings(records: RunRecord[], tasks: TaskDef[]): ListStandings {
  const standings: ListStandings = { waiting: 0, finished: 0, queued: 0 };
  for (const taskDef of tasks) {
    const record = findQueueRun(records, taskDef);
    if (record === undefined) standings.queued += 1;
    else if (record.caseFile.outcome === undefined) standings.waiting += 1;
    else standings.finished += 1;
  }
  return standings;
}

/** What a run of several at once says when it gives up on the environment its tasks share. */
export function environmentGaveUp(attempts: number, { waiting, finished, queued }: ListStandings, of: number): string {
  const tries = `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
  const were = waiting === 1 ? "was waiting on this and needs" : "were waiting on this and need";
  const is = queued === 1 ? "is" : "are";
  return `Couldn't fix it after ${tries}. Stopping the run. ${waiting} of ${of} tasks ${were} your attention; ${finished} had already finished, ${queued} ${is} still queued.`;
}

/**
 * End a run that gave up on its shared environment: write its outcome, naming
 * the environment as the cause, say how the list stands, and exit needing a
 * decision. The held tasks keep no outcome of their own, so the next
 * `delivery run` picks them up.
 */
async function stopForEnvironment(repoPath: string, dir: string, runId: string, tasks: TaskDef[], ctx: CommandContext): Promise<ExitCode> {
  const { history } = await loadRunFile(dir);
  const reason = history.findLast((entry) => entry.t === "run_escalated")?.reason ?? "the shared environment could not be repaired; no task caused this";
  await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason, at: new Date().toISOString() });
  ctx.report.note(environmentGaveUp(repairsUsed(history), listStandings(await allRuns(repoPath), tasks), tasks.length));
  ctx.report.run({ runId, state: "ESCALATED", affected: tripsOf(history).at(-1)?.held ?? [] });
  return EXIT.escalated;
}
```

Wiring in `runQueue`:

1. Right after `unfinished` is read and the lock is taken, before the "nothing left" check:

```ts
    // A run that gave up on its environment but was stopped before it could say so ends now, starting nothing.
    if (unfinished?.runFile.history.some((entry) => entry.t === "run_escalated")) {
      return await stopForEnvironment(repoPath, unfinished.dir, unfinished.runFile.header.runId, tasks, ctx);
    }
```

2. After `record` is set (both the picked-up and the new branch), create the breaker:

```ts
    let session: ... // unchanged `agent()` helper above is reused
    const breaker: RunBreaker | undefined =
      record === undefined || runId === undefined
        ? undefined
        : createRunBreaker({
            dir: record.dir,
            history: unfinished?.runFile.history ?? [],
            limit: unfinished?.runFile.header.runBudgetMax.gateMaintenance ?? project.budgets.gateMaintenance.max,
            dispatch: async (surfaceId, sessionKey) => dispatchRepair(await readRun(repoPath, surfaceId), sessionKey, await agent(), ctx.env),
            onChange: (change) => ctx.report.run({ runId, ...change }),
          });
```

   Because `drive` closes over `breaker`, declare `drive` after it (move the `drive` definition below the record/breaker block), and give each task's context the coordinator:

```ts
      const taskCtx: CommandContext = { ...ctx, report, ...(breaker === undefined ? {} : { repairCoordinator: breaker }) };
```

3. In `next`, first line: `if (breaker?.gaveUp !== undefined) return undefined;` (a slot freed after the run gave up starts nothing). `next` is also called once before the breaker exists (the "nothing left" check); declare `let breaker: RunBreaker | undefined;` before `next` and assign it in step 2, so `next` reads the current value.

4. Around `supervise`:

```ts
    try {
      settled = await supervise({ slots: concurrency, next, drive, waitOnSetback: runId === undefined, record });
    } catch (err) {
      // A task stopped at its next check or hand-off because the run gave up on the shared environment.
      if (err instanceof RunHalted && record !== undefined && runId !== undefined) {
        return await stopForEnvironment(repoPath, record.dir, runId, tasks, ctx);
      }
      throw err;
    } finally {
      disarm?.();
    }
```

`src/supervisor.ts`: extend the `drive` doc comment: "A throw is a broken harness or setup, or the run giving up on its shared environment (`RunHalted`), never a task's own setback." No code change.

`src/cli/command-fixtures.ts`: `writeRunRecord`'s options gain `gate?: GateRef` (default `GATE`), passed as `gateRef: gate` to `create`.

`README.md`:
- After the paragraph ending "...under `.delivery/supervised/`." in the several-at-once section, add:

```markdown
If the environment your tasks share breaks during a run of several at once (the check cannot
run at all, for a task that has not started or one whose work is being checked), the run does
not let every task discover it, retry and fight over it. It holds any task about to check or
hand off its work, leaves work already under way alone, and repairs the environment once, with
the same agent that repairs a check for a single task:

```text
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
```

The number of repair attempts is one limit for the whole run, `budgets.gateMaintenance`
(2 unless you set it). If the repair cannot fix it within that limit, the run stops, says how
many tasks were waiting on it, had finished and are still queued, and exits 4; its record says
the shared environment, not any task, was the cause. The tasks it held keep where they got to:
once you have fixed the environment, `delivery run` carries them on. See
[When the shared environment breaks](docs/shared-environment.md).
```

- In the `--json` paragraph ("When several tasks run at once, each object also says what it is about ..."), add: "A run of several at once also writes a `scope: \"run\"` object each time its shared environment changes state (`DEGRADED`, `REPAIRING`, `HEALTHY`, and `ESCALATED` when it gives up), with `affected` listing the task run ids it concerns (`null` on the run starting and finishing)."
- In the settings table's `budgets` row, append: "With several tasks at once, `gateMaintenance` is one limit for the whole run: how many times it may repair the environment the tasks share."

(The guide link resolves once Task 8 creates `docs/shared-environment.md`; if a link checker runs in this task's targeted tests, add the link in Task 8 instead.)

`docs/testing-your-pipeline.md`, at the end of the "Testing several tasks at once" introduction paragraphs (before the code), add one sentence: "One difference from `delivery run`: here a task whose check cannot run is repaired on its own, as a single task is; the single repair for the whole run that `delivery run` makes is not part of this runner yet."

`.changeset/repair-a-broken-shared-environment-once.md`:

```markdown
---
"delivery-service": minor
---

When the environment the tasks of a run of several at once share breaks, the run repairs it
once rather than letting every task find it, retry and fight over it. It holds any task about to
check or hand off its work, leaves work already under way alone, runs one repair with the
existing gate-maintenance agent once nothing is mid-check, and says "Fixed. Resuming." when it
works. `budgets.gateMaintenance` becomes one limit for the whole run. If the repair cannot fix
it, the run stops with exit code 4, says how many tasks were waiting, had finished and are still
queued, and records the shared environment as the cause; the held tasks carry on with the next
`delivery run`. Under `--json`, each change in the environment's state is a `scope: "run"` record
naming the tasks it affects. A run of one task at a time is unchanged.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/queue.test.ts src/cli/run-command.test.ts src/cli/report.test.ts src/supervisor.test.ts && npx tsc --noEmit`
Expected: PASS, including every existing queue and run-command test (the concurrency-1 path creates no breaker).

- [ ] **Step 5: Commit**

```bash
git add src/cli/context.ts src/cli/drive.ts src/cli/queue.ts src/cli/queue.test.ts src/cli/run-command.test.ts src/cli/command-fixtures.ts src/supervisor.ts README.md docs/testing-your-pipeline.md .changeset/repair-a-broken-shared-environment-once.md
git commit -m "Repair a run's broken shared environment once, and stop the run when it cannot

delivery run now gives every run of several tasks at once one coordinator of
its shared environment, dispatching the gate-maintenance repair in the copy of
the task that found it broken, on one limit for the whole run. When it gives
up, the run stops with the needs-a-decision code, counts the list, and records
the environment as the cause, leaving the held tasks for the next run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lead `delivery status` with what broke and which tasks it held

**Files:**
- Modify: `src/cli/supervised-view.ts`
- Modify: `src/cli/status-command.ts`
- Modify: `README.md` ("A run of several tasks at once" status section)
- Modify: `.changeset/repair-a-broken-shared-environment-once.md`
- Test: `src/cli/supervised-view.test.ts`, `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `breakerOf`, `openTrip`, `tripsOf`, `repairsUsed`, `Trip` (Task 2); `BREAKER_PHRASES` (Task 1); `RunOutcome` escalated (Task 1).
- Produces:
  - `TaskStanding` gains `"paused"`; `STANDINGS` = `["closed", "escalated", "aborted", "paused", "unfinished", "queued"]`.
  - `SupervisedView` gains `trip: Trip | undefined` (the unresolved trip: open, or the one the run gave up on); `breaker` is `breakerOf(runFile.history)`.
  - `overallOutcome` returns `"escalated"` for a run whose outcome is `escalated`.
  - `SupervisedStatusDocument` gains `reason: string | null`, `cause: "shared_environment" | null`, `runBudgets: { gateMaintenance: { used: number; max: number } }`, `trips: Trip[]`.
  - `environmentNarration(view: SupervisedView): string[]` in `src/cli/status-command.ts` (empty when there is no unresolved trip).

- [ ] **Step 1: Write the failing tests**

In `src/cli/supervised-view.test.ts` (reuse the file's helpers for run files and records; `header` literals already carry `runBudgetMax` from Task 1):

```ts
describe("the shared environment, in a run's view", () => {
  const trip = (surfaceId: string): RunEntry[] => [
    { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason: "the shared helper is missing" } },
    { t: "repair_request", surfaceId, key: null },
  ];

  it("follows the run's history, and shows a held task that has not finished as paused", async () => {
    // records: A unfinished (held), B closed; list [A, B, C]
    const view = supervisedView(runFileWith([fill(1, A), fill(2, B), ...trip(A.runId)]), [A, B], LIST, true);
    expect(view.breaker).toBe("DEGRADED");
    expect(view.trip?.cause.surfaceId).toBe(A.runId);
    expect(standingOf(view, A)).toBe("paused");
  });

  it("forgets a trip once the environment is repaired", async () => {
    const history = [...trip(A.runId), { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: A.runId }, { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "fixed" }, { t: "breaker_healthy" }] as RunEntry[];
    const view = supervisedView(runFileWith([fill(1, A), ...history]), [A], LIST, true);
    expect(view.breaker).toBe("HEALTHY");
    expect(view.trip).toBeUndefined();
    expect(standingOf(view, A)).toBe("unfinished");
  });

  it("keeps the trip a run gave up on, and says the run needs a decision", async () => {
    const view = supervisedView(
      runFileWith([fill(1, A), ...trip(A.runId), { t: "run_escalated", reason: "could not be repaired" }], { kind: "escalated", cause: "shared_environment", reason: "could not be repaired", at: "2026-09-30T10:00:00.000Z" }),
      [A], LIST, false,
    );
    expect(view.trip?.ended).toBe("gave_up");
    expect(standingOf(view, A)).toBe("paused");
    expect(overallOutcome(view)).toBe("escalated");
  });
});
```

Write `runFileWith(history, outcome?)`, `fill(slot, record)`, `standingOf(view, record)`, `A`, `B`, `LIST` against the fixtures this test file already builds for slice 4 (it constructs `RunFile` objects and `RunRecord`s in memory); keep them local to this describe if the file has no equivalents.

In `src/cli/status-command.test.ts`, extend the supervised block (reuse `writeSupervisedRun`, `writeRunRecord`, `SUPERVISED`, `takeRepoLock`):

```ts
  describe("when the shared environment broke", () => {
    // HELLO and GOODBYE are this file's task words; these are the runs made for them.
    const HELLO_RUN = "add-a-hello-20260930T090000Z";
    const GOODBYE_RUN = "add-a-goodbye-20260930T090100Z";
    const gaveUp = async (prefix: string) => {
      const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: null },
        { t: "held", surfaceId: HELLO_RUN },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "escalate", rationale: "the helper is outside my copy" },
        { t: "run_escalated", reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this" },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this", at: "2026-09-30T10:00:00.000Z" });
      return repo;
    };

    it("leads with what broke, which task found it and which tasks it held, before the run line", async () => {
      const repo = await gaveUp("status-breaker-gave-up-");

      const { stdout, exitCode } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(exitCode).toBe(EXIT.ok);
      const lines = stdout.split("\n");
      expect(lines.slice(0, 4)).toEqual([
        "The shared environment could not be fixed after 1 attempt, so the run stopped; no task caused this.",
        "It was first noticed by [2/3] add a goodbye: the shared helper is missing.",
        "Held: [2/3] add a goodbye, [1/3] add a hello.",
        "Once it is fixed, `delivery run` carries the held tasks on.",
      ]);
      expect(stdout).toContain("Environment: something in the shared environment looks broken");
      expect(stdout).toContain("2 paused until the shared environment is fixed, 1 queued");
      expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);
    });

    it("leads with the repair under way while the run is going", async () => {
      const repo = initTempRepo("status-breaker-live-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: HELLO_RUN, reason: "the shared helper is missing" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: HELLO_RUN },
      ]);
      const release = await takeRepoLock(repo);
      try {
        const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });
        expect(stdout.split("\n")[0]).toBe("The shared environment is being repaired: any task about to check or hand off its work is held until it is fixed.");
      } finally {
        await release?.();
      }
    });

    it("says nothing of a trip the run repaired", async () => {
      const repo = initTempRepo("status-breaker-repaired-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO, outcome: CLOSED });
      await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: HELLO_RUN, reason: "the shared helper is missing" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: HELLO_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored it" },
        { t: "breaker_healthy" },
        { t: "slot_free", slot: 1, surfaceId: HELLO_RUN, outcome: "closed" },
      ]);
      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });
      expect(stdout.split("\n")[0]).toMatch(/^Run run-/);
      expect(stdout).toContain("Environment: healthy");
    });

    it("gives the trip, the run's repair limit and why it stopped in --json, for looking back", async () => {
      const repo = await gaveUp("status-breaker-json-");

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);

      expect(document).toMatchObject({
        breaker: "DEGRADED",
        outcome: "escalated",
        cause: "shared_environment",
        runBudgets: { gateMaintenance: { used: 1, max: 2 } },
      });
      expect(document.reason).toContain("no task caused this");
      expect(document.trips).toEqual([{
        cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" },
        held: [GOODBYE_RUN, HELLO_RUN],
        repairs: [{ attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN, status: "escalate", rationale: "the helper is outside my copy" }],
        ended: "gave_up",
        reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this",
      }]);
    });
  });
```

Also update the existing slice-4 key-set assertion (`"gives one JSON document: ..."`) to the new sorted list: `["breaker", "cause", "concurrency", "finishedAt", "live", "outcome", "queued", "reason", "runBudgets", "runId", "startedAt", "surfaces", "tasks", "trips"]`, and add `cause: null, reason: null, trips: []` to its `toMatchObject`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/supervised-view.test.ts src/cli/status-command.test.ts`
Expected: FAIL: `breaker` is always `HEALTHY`; no `paused` standing; no narration; missing JSON keys.

- [ ] **Step 3: Implement**

`src/cli/supervised-view.ts` (imports `breakerOf`, `openTrip`, `tripsOf`, `type Trip` from `../breaker.js`):

```ts
export type TaskStanding = SlotOutcome | "paused" | "unfinished" | "queued";
export const STANDINGS: readonly TaskStanding[] = ["closed", "escalated", "aborted", "paused", "unfinished", "queued"];

export interface SupervisedView {
  runFile: RunFile;
  live: boolean;
  breaker: BreakerState;
  /** The shared environment's trip still unresolved: under repair, or the one the run gave up on. */
  trip: Trip | undefined;
  tasks: ViewTask[];
}

/** The trip a person still needs to hear about: the open one, or the one the run gave up on. */
function unresolvedTrip(runFile: RunFile): Trip | undefined {
  if (runFile.outcome?.kind === "escalated") return tripsOf(runFile.history).at(-1);
  return openTrip(runFile.history);
}
```

In `supervisedView`: compute `const trip = unresolvedTrip(runFile);`, and a taken task's standing becomes:

```ts
      standing:
        record === undefined
          ? "queued"
          : (record.caseFile.outcome?.kind ?? (trip?.held.includes(surfaceId) ? "paused" : "unfinished")),
```

and return `{ runFile, live, breaker: breakerOf(runFile.history), trip, tasks }`. `standingCounts` initial record gains `paused: 0`. `overallOutcome`: after the unfinished check, `if (view.runFile.outcome.kind === "escalated") return "escalated";`.

`src/cli/status-command.ts`:

- `STANDING_WORDS` gains `paused: "paused until the shared environment is fixed"`.
- Add:

```ts
/** A task as the narration names it: its place and words, or its id when the list no longer has it. */
function taskLabel(view: SupervisedView, surfaceId: string): string {
  const task = view.tasks.find((candidate) => candidate.record?.runId === surfaceId);
  if (task === undefined) return surfaceId;
  const tag = task.position ? `[${task.position.task}/${task.position.of}] ` : "";
  return `${tag}${taskIntent(task.taskDef)}`;
}

/**
 * What a person reads first when the shared environment is not healthy: that
 * it broke and what is happening about it, which task found it and why, and
 * which tasks it held. Nothing for a run whose environment is healthy.
 */
export function environmentNarration(view: SupervisedView): string[] {
  const { trip } = view;
  if (trip === undefined) return [];
  const opening =
    trip.ended === "gave_up"
      ? `The shared environment could not be fixed after ${trip.repairs.length} ${trip.repairs.length === 1 ? "attempt" : "attempts"}, so the run stopped; no task caused this.`
      : `${view.breaker === "REPAIRING" ? "The shared environment is being repaired" : "Something in the shared environment looks broken"}: any task about to check or hand off its work is held until it is fixed.`;
  return [
    opening,
    `It was first noticed by ${taskLabel(view, trip.cause.surfaceId)}: ${trip.cause.reason}.`,
    `Held: ${trip.held.map((surfaceId) => taskLabel(view, surfaceId)).join(", ")}.`,
    ...(trip.ended === "gave_up" ? ["Once it is fixed, `delivery run` carries the held tasks on."] : []),
    "",
  ];
}
```

  Note: `trip.repairs.length` counts this trip's attempts; the run-wide count is in `runBudgets`. The opening for a live trip reuses `BREAKER_PHRASES` wording; if you prefer, build it as `opening(BREAKER_PHRASES[view.breaker])` so the table stays the only source (then change the REPAIRING phrase test expectation to match). Keep whichever form, but the expected strings in the tests above are the contract.

- `supervisedReport` starts `const lines = [...environmentNarration(view), `Run ${header.runId}, ...`, ...]`.
- `SupervisedStatusDocument` gains the four fields; `supervisedDocument` fills them:

```ts
    reason: outcome?.kind === "escalated" ? outcome.reason : null,
    cause: outcome?.kind === "escalated" ? outcome.cause : null,
    runBudgets: { gateMaintenance: { used: repairsUsed(view.runFile.history), max: header.runBudgetMax.gateMaintenance } },
    trips: tripsOf(view.runFile.history),
```

`README.md`, in "### A run of several tasks at once": after the paragraph describing the report, add:

```markdown
If the environment the tasks share broke, the report opens with that before anything else:
whether it is being repaired or could not be fixed, which task found it and why, and which tasks
it held. Those tasks count as "paused until the shared environment is fixed". A run that
repaired its environment and carried on says only "Environment: healthy".
```

and in the `--json` paragraph after "... how it ended and when," insert: "why it stopped and whether the shared environment was the cause (`reason`, `cause`), how many repairs it used of its limit (`runBudgets`), every time its environment broke with the task that found it, the tasks it held and each repair attempt (`trips`),".

Changeset: append a paragraph: "`delivery status` for such a run leads with what broke, which task found it and which tasks it held; a held task counts as paused. `--json` adds `reason`, `cause`, `runBudgets` and `trips`, so a trip can be diagnosed after the fact."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/supervised-view.test.ts src/cli/status-command.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/supervised-view.ts src/cli/supervised-view.test.ts src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/repair-a-broken-shared-environment-once.md
git commit -m "Lead delivery status with what broke in a run's shared environment

An owner looking at a run whose shared environment broke must read that first,
in plain words, with the task that found it and the tasks it held, and a script
must be able to diagnose the trip after the fact. The view now follows the
breaker in the run file, counts held tasks as paused, and the JSON document
carries every trip and the run's repair limit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: An example whose check depends on something shared, with its guide and test

**Files:**
- Create: `examples/shared-environment-example/` with `README.md`, `delivery.config.json`, `package.json`, `text.js`, `text.test.js` (copies of `examples/project-configuration-example/`'s `package.json`, `text.js`, `text.test.js`), `check.mjs`, `shared/helper.json`
- Create: `docs/shared-environment.md`
- Create: `tests/shared-environment-guide.test.ts`
- Modify: `README.md` (guides list), `.changeset/repair-a-broken-shared-environment-once.md`

**Interfaces:**
- Consumes: the compiled `delivery` (`runDelivery` in `tests/helpers.ts`), `TEST_MOCK_SCRIPT`, `outputBlock`, `documented`, `sectionOf`, `git`, `useScratch`, `REPO_ROOT` (`tests/helpers.ts`), `writeMockScript` (re-exported from `src/testing.ts`).
- Produces: the fixture slice 6 reuses. Its check reads `shared/helper.json` from the repository root on every run; missing, the check reports ERROR ("the shared helper … is missing").

- [ ] **Step 1: Write the failing test**

`tests/shared-environment-guide.test.ts`, modelled on `tests/project-configuration-guide.test.ts` (read it first; reuse its `missingFrom` approach, moving it to `tests/helpers.ts` if you need it in both files):

```ts
// Multi-surface supervisor, slice 5: an owner sees a broken shared environment
// repaired once for the whole run by following docs/shared-environment.md in
// examples/shared-environment-example. This runs the guide's own commands, in
// order, against the compiled command and a copy of the example, with the agent
// routed to the vendored scripted agent, and checks what the guide says you will
// see is what the command prints. The fixture's own shape is checked here too:
// one fixture, one guide, one test.

import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { writeMockScript } from "../src/testing.js";
import type { MockScript } from "../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { documented, git, outputBlock, REPO_ROOT, runDelivery, sectionOf, useScratch } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/shared-environment.md"), "utf-8");
const EXAMPLE = join(REPO_ROOT, "examples", "shared-environment-example");
const RUN_TIMEOUT = 180_000;
const STEP = {
  get: "## 1. Get the example project",
  break: "## 2. Break the shared helper and run the list",
  status: "## 3. See what stopped it",
  fix: "## 4. Put it back and carry on",
} as const;

const scratch = useScratch();

describe("the shared-environment example", () => {
  it("checks in four tasks, two at a time, and a check kept outside every task's copy", () => {
    const config = JSON.parse(readFileSync(join(EXAMPLE, "delivery.config.json"), "utf-8"));
    expect(config.tasks).toHaveLength(4);
    expect(config.concurrency).toBe(2);
    expect(config.gate).toEqual({ type: "custom", modulePath: "./check.mjs" });
  });

  it("passes its own check as shipped, and cannot run it once the shared helper is gone", async () => {
    const copy = scratch("shared-environment-shape-");
    cpSync(EXAMPLE, copy, { recursive: true });
    const check = (await import(pathToFileURL(join(copy, "check.mjs")).href)).default;
    expect((await check.baseline({ worktreePath: copy })).status).toBe("PASS");
    rmSync(join(copy, "shared", "helper.json"));
    expect(await check.check({ worktreePath: copy })).toMatchObject({ status: "ERROR", detail: expect.stringContaining("shared helper") });
  });

  it("ships only its source, its check, its helper and its configuration", () => {
    expect(readdirSync(EXAMPLE).sort()).toEqual(["README.md", "check.mjs", "delivery.config.json", "package.json", "shared", "text.js", "text.test.js"]);
  });
});

describe("docs/shared-environment.md", () => {
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    repo = scratch("shared-environment-guide-");
    cpSync(EXAMPLE, repo, { recursive: true });
    git(repo, ["init", "-b", "main"]);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "start"]);
    // Every session answers "done" and writes a small file: a repair that says it fixed things but cannot reach the helper.
    const script: MockScript = { expectations: [{ effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "done" } }] };
    const scriptPath = join(scratch("shared-environment-script-"), "mock.json");
    await writeMockScript(scriptPath, script);
    env = { [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("shared-environment-state-") };
  });

  const expectShown = (stdout: string, section: string) => {
    for (const line of outputBlock(sectionOf(guide, section)).filter((shown) => shown !== "…")) {
      expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
    }
  };

  it("stops the run naming the shared environment when its helper is gone", () => {
    rmSync(join(repo, "shared", "helper.json"));
    const { stdout, status } = runDelivery(["run"], { cwd: repo, env });
    expect(status).toBe(EXIT.escalated);
    expectShown(stdout, STEP.break);
  }, RUN_TIMEOUT);

  it("says what stopped it, first", () => {
    const { stdout } = runDelivery(["status"], { cwd: repo, env });
    expectShown(stdout, STEP.status);
  });

  it("carries the held tasks on once the helper is back", () => {
    git(repo, ["checkout", "--", "shared/helper.json"]);
    const { stdout, status } = runDelivery(["run"], { cwd: repo, env });
    expect(status).toBe(EXIT.ok);
    expectShown(stdout, STEP.fix);
  }, RUN_TIMEOUT);
});
```

Adjust `runDelivery`'s call shape and `sectionOf`'s arguments to their real signatures in `tests/helpers.ts` (read them; `sectionOf(text, from, to?)`), and cut each section at the next `## ` heading.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && npx vitest run tests/shared-environment-guide.test.ts`
Expected: FAIL: the example folder and guide do not exist.

- [ ] **Step 3: Create the fixture and the guide**

`examples/shared-environment-example/check.mjs`:

```js
// This project's check. It lives in the repository, outside every task's copy,
// and relies on a shared helper beside it: shared/helper.json names the command
// that runs the tests. Every task's check reads the same helper, so if it goes
// missing, no task can check its work: the shared environment is broken.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "shared", "helper.json");

async function measure({ worktreePath }) {
  if (!existsSync(HELPER)) {
    return { status: "ERROR", assertions: [], detail: `the shared helper ${HELPER} is missing, so the check cannot run` };
  }
  const { command, args } = JSON.parse(readFileSync(HELPER, "utf-8"));
  const run = spawnSync(command, args, { cwd: worktreePath, encoding: "utf-8" });
  return {
    status: "PASS",
    assertions: [{ id: `${command} ${args.join(" ")}`, outcome: run.status === 0 ? "PASS" : "FAIL", detail: `${run.stdout}\n${run.stderr}`.trim() }],
  };
}

export default { baseline: measure, check: measure };
```

`examples/shared-environment-example/shared/helper.json`:

```json
{ "command": "npm", "args": ["test"] }
```

`examples/shared-environment-example/delivery.config.json`:

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test",
    "add a function that capitalises the first letter of each word, with a test",
    "add a function that counts the words in a piece of text, with a test"
  ],
  "concurrency": 2,
  "gate": { "type": "custom", "modulePath": "./check.mjs" },
  "closer": { "type": "commit-to-branch" },
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
}
```

`examples/shared-environment-example/README.md`: two short paragraphs: what this variant of the project-configuration example adds (a check that relies on `shared/helper.json`, outside every task's copy, four tasks two at a time), and a link to `../../docs/shared-environment.md`.

`docs/shared-environment.md`, with exactly these `##` headings (the test finds sections by them) and a ```` ```text ```` block in sections 2, 3 and 4 holding lines the command prints (use "…" on its own line for omitted stretches; every other line must appear, in order, in the real output: run the commands once against the mock to copy the lines verbatim):

1. `## 1. Get the example project`: copy `examples/shared-environment-example`, `git init`, commit; say what the check relies on (`shared/helper.json`, beside `check.mjs`, outside every task's copy) and that the list runs two at a time.
2. `## 2. Break the shared helper and run the list`: delete `shared/helper.json` (or delete it while two tasks are going: the messages are the same), run `delivery run`. Explain the three live lines, the one limit for the whole run (`budgets.gateMaintenance`), and why the repair cannot put the helper back here: the repair agent may change files only inside the copy of the task that found the problem, and this helper is outside every copy, so after its attempts the run stops, exits 4, and names the environment as the cause. Text block, for example:

   ```text
   Starting run run-…: 4 tasks, up to 2 at once
   …
   ! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
     - repairing (attempt 1 of 2)
   ✓ Fixed. Resuming.
   …
   Couldn't fix it after 2 attempts. Stopping the run. 2 of 4 tasks were waiting on this and need your attention; 0 had already finished, 2 are still queued.
   ```

   and a sentence: with a real agent the number of attempts can be fewer, since the agent may say at once that it cannot reach the helper.
3. `## 3. See what stopped it`: `delivery status`; text block with the narration's opening line, "It was first noticed by …", "Held: …", "Once it is fixed, `delivery run` carries the held tasks on.", then the "Environment: something in the shared environment looks broken" line. Mention `delivery status <run> --json`'s `trips` for looking back.
4. `## 4. Put it back and carry on`: `git checkout -- shared/helper.json`, `delivery run`; the new run picks up the held tasks and starts the queued ones; text block ending with "Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran." Then a short "## When the repair can fix it" paragraph (no text block): if what broke is something the repair can reach, it says "Fixed. Resuming.", held tasks carry on, and `delivery status` shows "Environment: healthy".

`README.md` guides list: add "- [When the shared environment breaks](docs/shared-environment.md): what a run of several tasks at once does when the environment its tasks share breaks, with an example to try". (If Task 6 did not add the in-text link to `docs/shared-environment.md`, add it now.)

Changeset: append "A new example, `examples/shared-environment-example`, and guide, `docs/shared-environment.md`, show a shared environment breaking under a run of several tasks at once."

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && npx vitest run tests/shared-environment-guide.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/shared-environment-example docs/shared-environment.md tests/shared-environment-guide.test.ts README.md .changeset/repair-a-broken-shared-environment-once.md tests/helpers.ts
git commit -m "Add an example whose check depends on something every task shares

Showing a broken shared environment needs a check that relies on something
outside every task's copy. The new example keeps its check and a shared helper
in the repository; its guide walks an owner through breaking the helper,
reading why the run stopped and carrying on, and its test runs the guide's own
commands so the guide cannot drift from the tool.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
