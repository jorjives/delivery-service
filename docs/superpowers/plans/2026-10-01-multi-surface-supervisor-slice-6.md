# Multi-Surface Supervisor — Slice 6: Treat the Same Check Error in Two Tasks as a Shared Problem

> **Status:** ✅ Complete — 2026-10-01 — `32778a5`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 6 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** In a run of several tasks at once, a task whose check keeps erroring until its own re-checks run out no longer trips the run by itself: it deals with it as a task on its own would, and only when a second, different task does the same (since the environment was last healthy) does the run treat it as a broken shared environment and repair it once. An agent session stopped by an API rate limit or spend limit is described as that, in fixed plain words, never as a broken environment, and never counts as evidence.

**Architecture:** The run's breaker (`src/breaker.ts`) gains a second way to trip. A task that exhausts its check-error re-checks (the `fix_the_gate` triage verdict, which only ever follows a `gate_error`) calls a new `RepairCoordinator.reportCheckErrors`. The breaker records a `gate_error_signal` run-file entry at most once per task per healthy window, counts distinct tasks since the last `breaker_healthy` (a pure fold of the run file, like everything else the breaker knows), and answers `"alone"` below the threshold of two or trips with a new `gate_error_aggregate` cause, runs the existing single repair, and answers `"shared"`. The task state machine (`src/surface.ts`) acts on the answer: `"shared"` re-checks the same attempt; `"alone"` or no coordinator dispatches the task's own gate-maintenance repair on its own limit, exactly as at concurrency 1. A check that cannot run before a task starts (baseline ERROR) stays slice 5's direct trip. Usage limits are classified at the one session seam (`invoke()` in `src/agent-invoke.ts`) from the SDK's typed signals and the API's own machine identifiers; the terminus carries a `limit` mark, and a run-level repair stopped by one makes the run stop naming the limit rather than the environment.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`, `.js` import suffixes), zod v4, vitest, `@anthropic-ai/claude-agent-sdk` (types only, already a dependency), the vendored `claude-mock` through the existing `DELIVERY_TEST_MOCK_SCRIPT` seam. No new dependency.

## Global Constraints

- Node ≥22; `strict` and `noUncheckedIndexedAccess` are on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new dependency. No circuit-breaker library (they are in-memory and do not survive a crash).
- Exit codes unchanged (`src/cli/failures.ts` `EXIT`).
- With `concurrency` 1 (the default) nothing a user sees or finds on disk changes, except the wording of an incomplete session that a usage limit stopped (Task 5).
- A check that cannot run before a task has started (baseline ERROR) still trips the breaker at once, exactly as slice 5 shipped it. Every existing test of that path (`src/cli/run-command.test.ts` "when the shared environment breaks", `tests/multi-surface-supervisor/5-*.test.ts`, `tests/shared-environment-guide.test.ts` steps 2 to 4) must keep passing unchanged, apart from the mechanical edits each task names.
- Human-readable output never shows an internal state or entry name (`HEALTHY`, `DEGRADED`, `REPAIRING`, `GATE_MAINTENANCE`, `ESCALATED`, `gate_error_signal`, `gate_error_aggregate`). `--json` uses the harness's own names, every key present, `null` where it does not apply.
- The two usage-limit phrases are fixed and exact: `the AI service is limiting requests` and `the spending limit has been reached`. They live in one table (`USAGE_LIMIT_WORDS`, Task 5) and nowhere else.
- User-facing copy (messages, README, guides, changeset): controlled British English, plain words, no em-dashes (colons, semicolons, commas instead).
- Tests are offline: agents are `fakeAgentPort` doubles or the vendored `claude-mock`; nothing pays for a session. The vendored mock is never edited (`vendor/README.md`).
- Every path in a command is relative to the repository root; run every command from there. Never `cd` elsewhere.
- **Buy-vs-build:** reuse the breaker's fold-over-history pattern, its one coalesced repair (`ensureRepair`), `servedAlready`/`requestedInOpenTrip` for crash safety, the task's existing own-repair edge (`dispatchSession` on the `gateMaintenance` budget), and the SDK's own typed error signals. Nothing here is hand-rolled that the codebase already has.
- **Operability/DX (Operational note):** the threshold is fixed at two distinct tasks since the environment was last healthy, with no time window, so behaviour is reproducible under the scripted mock. It is one named constant (`SHARED_ERROR_THRESHOLD`) carrying a `ponytail:` comment marking it for retuning once real flake rates are known. Every report that counts is a run-file entry, readable after the fact through `delivery status <run> --json` (`trips[].cause`).
- Targeted verification only: each task runs its own test files (or a `-t` name filter) with `npx vitest run` and `npx tsc --noEmit`. The full suite runs once in final review.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **A post-task `fix_the_gate` is no longer a direct trip.** The design spec says any entry to gate maintenance trips the breaker, and also that a second task "exhausting `recheck_gate` retries" trips it. Exhausted re-checks are exactly what produces `fix_the_gate` (`src/router.ts`; `src/triage.ts` `legalVerdicts` allows `fix_the_gate` only for `gate_error`), so read literally the aggregate rule could never fire. The slice's first acceptance criterion settles it: one task exhausting its re-checks "does not affect any other task". Pre-task (baseline ERROR) stays a direct trip: no task's own work can explain it.
  - **A task told it is alone repairs its own check on its own limit** (its per-task `gateMaintenance` budget), exactly as a task on its own does. That is what "stays that task's own business" means, it keeps a lone flaky task at concurrency N behaving as it does at concurrency 1, and it gives "the same task erroring twice counts once" a real path (own repair, re-check errors, reports again). It knowingly amends the design's "a supervised surface never dispatches its own repair" for the uncorroborated post-task case; `docs/multi-surface-control-flow.md` is updated to say so (Task 3). Rejected: escalating the first task unrepaired (punishes a one-off), parking it until a second arrives (may never come), re-checking without bound (no limit), spending the run's limit on one task's hiccup (the cost the slice exists to avoid).
  - **The coordinator is asked only at the two points where a task learns its check cannot run:** a baseline ERROR (`requestRepair`, pre-task) and a `fix_the_gate` tail (`reportCheckErrors`, post-task). Once a task has started a repair of its own, that repair's own tails (a session that ended without a result, a completed or escalated one) follow single-task handling and never consult the run again. Otherwise an own repair that ended without a result would trip the run directly.
  - **`RepairRequest` loses `key`.** After this slice `requestRepair` is pre-task only and its key is always `null`: a parameter that can hold one value is a lie in the interface. The crash-safety check it served (`servedAlready`) moves to `reportCheckErrors`, whose `key` is the `fix_the_gate` triage entry's `artifactRef`. The run file's `repair_request.key` stays nullable (`null` pre-task).
  - **A task's own repair is not run inside a hold.** It works inside its own copy with the gate-maintenance role's confined tools, as a worker session does, so it touches nothing shared and the run's repair need not wait for it. Wrapping it would also make a task that was just told "alone" wait for a trip another task opened a moment later, then spend its own limit anyway.
  - **Both breaker causes carry `surfaceId`** (the task whose report tripped it, in whose copy the repair runs), so `tripsOf`, the repair dispatch and `status` need no branching to find it. `gate_error_aggregate` adds `surfaceIds` (every task counted, in the order reported) and has no `reason`: `status` words it from the kind.
  - **Looking back, `status` says a healthy run was repaired:** `Environment: healthy (repaired once during this run)`. Slice 5 showed nothing for a repaired run; the slice's UAT reads `delivery status` for "the repair in the run's history". The suffix is only added when the environment is healthy, so the gave-up report and every slice 5 line are unchanged.
  - **Usage limits are classified from signals, never from prose:** the assistant message's typed `error` (`rate_limit`, `billing_error`), the result's `api_error_status` (429), then the API's own identifiers in the error text (`rate_limit_error`, `enforced_spend_limit_reached`, `billing_error`), because the vendored mock's `fail.message` can only produce result text. A spend cap is also a 429, so it is looked for first.
  - **No backoff or governor.** A task session stopped by a limit is retried on the `terminus` budget as any incomplete session is; the Claude Code runtime already retries the API with backoff inside a session, and the design defers a rate-aware governor (spec §9). `ponytail:` comment at the classification site names the upgrade path. A run-level repair stopped by a limit is different: the next attempt would meet the same limit and burn the run's repair limit, so the run stops at once, naming the limit.
  - **The example's intermittent fault is a switch in the fixture's own check** (`shared/outage.json`), counted per copy, not a timing trick. Under the mock, sessions end in milliseconds, so nothing a person does by hand can land between a baseline and a check; a count shared across tasks would depend on which task reached its check first. Per-copy counting gives the same story on every run.

## Scaffolding Impact

- **Reactive:**
  - `docs/multi-surface-control-flow.md` "Shared-environment failure" mechanics say a surface hitting `GATE_MAINTENANCE` never dispatches its own repair, and "Open items" lists the aggregate threshold as untuned → Task 3.
  - `README.md` "several tasks at once": the paragraph saying the run repairs the environment when the check cannot run "for a task that has not started or one whose work is being checked", and the `budgets` row saying `gateMaintenance` is one limit for the whole run → Task 3.
  - `README.md` "A run of several tasks at once" (status): "A run that repaired its environment and carried on says only `Environment: healthy`" → Task 4; the `--json` sentence on `cause` → Task 6.
  - `docs/shared-environment.md` "When the repair can fix it" quotes `Environment: healthy` → Task 7 (rewritten with the new sections).
  - `docs/testing-your-pipeline.md` "When a reply ends as incomplete" table: a scripted `fail` whose message names a usage limit now reads differently → Task 5.
  - `docs/agent-interface.md` (`INCOMPLETE_TERMINUS` paragraph and the scripted-`fail` sentence) → Task 5.
  - `src/schema.ts` `BreakerCause` comment "One kind so far; repeated check errors across tasks are the next" → Task 1.
- **Proactive:** `.changeset/tell-a-one-off-check-error-from-a-shared-one.md` (every user-visible change gets a changeset here) → created in Task 3, extended in Tasks 4, 5, 6 and 7. The run/verify story for the new behaviour is the existing "one fixture, one guide, one test": the example's check gains the outage switch, the guide gains two sections, and the guide test runs them → Task 7.
- **Inherited (Operational note):** threshold of two, no window, one constant marked for retuning → Task 2; reproducible under the scripted mock → Task 3's integration tests and Task 7's fixture.
- Checked and unchanged: `docs/single-surface-control-flow.md` (a task on its own is unchanged); `docs/configuring-a-role.md` (the gate-maintenance role is unchanged); `docs/project-configuration.md`; `delivery run --help` (no new flag); `vendor/` (never edited); the design spec and slice scope (dated records; the amendment is recorded above). No `CLAUDE.md` in this repo.

---

### Task 1: Record a task's exhausted check errors, and a trip they caused, in the run file

**Files:**
- Modify: `src/schema.ts` (the supervised run file section: `BreakerCause`, `RunEntry`)
- Modify: `src/breaker.ts` (`BREAKER_EDGES`, new `SHARED_ERROR_THRESHOLD`, new `signalsSinceHealthy`)
- Modify: `src/cli/status-command.ts` (`environmentNarration`)
- Test: `src/breaker.test.ts`, `src/cli/status-command.test.ts`

**Interfaces:**
- Produces (in `src/schema.ts`):
  - `RunEntry` gains `{ t: "gate_error_signal", surfaceId: string }`.
  - `BreakerCause` gains `{ kind: "gate_error_aggregate", surfaceId: string, surfaceIds: string[] }` (`surfaceIds` at least two).
- Produces (in `src/breaker.ts`):
  - `export const SHARED_ERROR_THRESHOLD = 2`
  - `export function signalsSinceHealthy(history: readonly RunEntry[]): string[]` (each task once, in the order first reported, since the last `breaker_healthy`).

- [ ] **Step 1: Write the failing tests**

In `src/breaker.test.ts`, change the imports to add `signalsSinceHealthy` and `SHARED_ERROR_THRESHOLD` from `./breaker.js`, and import the schema value as well as the type:

```ts
import { RunEntry } from "./schema.js";
```

(`RunEntry` is both a zod schema and a type under one name, so the value import serves both; delete the old `import type { RunEntry }` line.)

Add beside the existing `degraded` helper:

```ts
const signal = (surfaceId: string): RunEntry => ({ t: "gate_error_signal", surfaceId });
const aggregate = (surfaceId: string, surfaceIds: string[]): RunEntry => ({ t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId, surfaceIds } });
```

In the describe "how each entry moves the breaker", add `signal("a")` to the `quiet` array of the test "is not moved by slots, holds or requests".

Add a new describe after "the run's repairs":

```ts
describe("the tasks whose check kept erroring", () => {
  it("names each task once, in the order they first reported", () => {
    expect(signalsSinceHealthy([signal("a"), signal("b"), signal("a")])).toEqual(["a", "b"]);
    expect(signalsSinceHealthy([])).toEqual([]);
  });

  it("forgets every report made before the environment was last healthy", () => {
    expect(signalsSinceHealthy([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy, signal("c")])).toEqual(["c"]);
    expect(signalsSinceHealthy([signal("a"), degraded("z"), dispatch(1, "z"), terminus(1), healthy])).toEqual([]);
  });

  it("takes two different tasks to call it shared", () => {
    expect(SHARED_ERROR_THRESHOLD).toBe(2);
  });

  it("records a trip those reports caused, in the copy of the task that reached the threshold", () => {
    const [trip] = tripsOf([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy]);
    expect(trip).toMatchObject({
      cause: { kind: "gate_error_aggregate", surfaceId: "b", surfaceIds: ["a", "b"] },
      held: ["b"],
      repairs: [{ attempt: 1, surfaceId: "b", status: "completed" }],
      ended: "repaired",
    });
  });

  it("refuses a trip that names fewer than two tasks", () => {
    expect(RunEntry.safeParse(aggregate("a", ["a"])).success).toBe(false);
    expect(RunEntry.safeParse(aggregate("b", ["a", "b"])).success).toBe(true);
  });
});
```

In `src/cli/status-command.test.ts`, inside the describe "when the shared environment broke", add:

```ts
    it("says the check could not run in two different tasks when that is what tripped it", async () => {
      const repo = initTempRepo("status-breaker-aggregate-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const reason = "the shared environment could not be repaired after 1 attempt; no task caused this";
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 1 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "gate_error_signal", surfaceId: HELLO_RUN },
        { t: "gate_error_signal", surfaceId: GOODBYE_RUN },
        { t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId: GOODBYE_RUN, surfaceIds: [HELLO_RUN, GOODBYE_RUN] } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: "triage-3" },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "incomplete", rationale: "ended without a result" },
        { t: "run_escalated", reason },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason, at: "2026-09-30T10:00:00.000Z" });

      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(stdout.split("\n").slice(0, 3)).toEqual([
        "The shared environment could not be fixed after 1 attempt, so the run stopped; no task caused this.",
        "The check could not run in 2 different tasks: [1/3] add a hello, [2/3] add a goodbye.",
        "Held: [2/3] add a goodbye.",
      ]);
      expect(stdout).not.toMatch(/gate_error|aggregate/);

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);
      expect(document.trips[0].cause).toEqual({ kind: "gate_error_aggregate", surfaceId: GOODBYE_RUN, surfaceIds: [HELLO_RUN, GOODBYE_RUN] });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/breaker.test.ts src/cli/status-command.test.ts -t "check kept erroring|check could not run in two|not moved by slots"`
Expected: FAIL (`signalsSinceHealthy` is not exported; `gate_error_signal` is not a valid run entry).

- [ ] **Step 3: Implement**

In `src/schema.ts`, replace the `BreakerCause` block and add the entry to `RunEntry` (after the `breaker_degraded` line):

```ts
/** What tripped the breaker. Both kinds name `surfaceId`: the task whose report tripped it, in whose copy the repair runs. */
export const BreakerCause = z.discriminatedUnion("kind", [
  // A task found the check could not run before it had started.
  z.object({ kind: z.literal("gate_maintenance"), surfaceId: SurfaceId, reason: z.string() }),
  // The check kept erroring in different tasks: `surfaceIds` is every task counted, in the order reported.
  z.object({ kind: z.literal("gate_error_aggregate"), surfaceId: SurfaceId, surfaceIds: z.array(SurfaceId).min(2) }),
]);
```

```ts
  // A task's check kept erroring until its own re-checks ran out. At most one per task since the environment was last healthy.
  z.object({ t: z.literal("gate_error_signal"), surfaceId: SurfaceId }),
```

In `src/breaker.ts`, add to `BREAKER_EDGES` (after `repair_request`):

```ts
  // Evidence, not a trip: the trip it may lead to is its own `breaker_degraded` entry.
  gate_error_signal: (state) => state,
```

and add after `repairsUsed`:

```ts
/**
 * How many different tasks must each run out of re-checks on a check that
 * keeps erroring, since the environment was last healthy, before the run
 * treats it as shared.
 */
// ponytail: M=2 and no time window, so a scripted run reproduces it; retune (and consider a window) once real flake rates are known.
export const SHARED_ERROR_THRESHOLD = 2;

/** Every task that has reported since the environment was last healthy, each once, in the order first reported. */
export function signalsSinceHealthy(history: readonly RunEntry[]): string[] {
  const since = history.slice(history.findLastIndex((entry) => entry.t === "breaker_healthy") + 1);
  return [...new Set(since.flatMap((entry) => (entry.t === "gate_error_signal" ? [entry.surfaceId] : [])))];
}
```

In `src/cli/status-command.ts`, import `BreakerCause` (type) from `../schema.js`, add above `environmentNarration`:

```ts
/** What tripped the breaker, as a person reads it. Total over the kinds, so a new one does not compile until it has words. */
function whatBroke(view: SupervisedView, cause: BreakerCause): string {
  switch (cause.kind) {
    case "gate_maintenance":
      return `It was first noticed by ${taskLabel(view, cause.surfaceId)}: ${cause.reason}.`;
    case "gate_error_aggregate":
      return `The check could not run in ${cause.surfaceIds.length} different tasks: ${cause.surfaceIds.map((surfaceId) => taskLabel(view, surfaceId)).join(", ")}.`;
  }
}
```

and replace the "It was first noticed by" line in `environmentNarration`'s returned array with `whatBroke(view, trip.cause),`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/breaker.test.ts src/cli/status-command.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/breaker.ts src/breaker.test.ts src/cli/status-command.ts src/cli/status-command.test.ts
git commit -m "Record a task's exhausted check errors and a trip they caused

Telling a one-off check error from a problem every task shares needs the
evidence on record: which tasks ran out of re-checks since the environment was
last healthy. The run file gains that entry and a second cause for a trip, the
count is a fold of the history like the rest of the breaker, and status words
the new cause.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Trip the run on a second, different task, and tell the first it is alone

**Files:**
- Modify: `src/ports.ts` (two new types beside `RepairRequest`)
- Modify: `src/breaker.ts` (`RunBreaker`, `createRunBreaker`)
- Test: `src/breaker.test.ts`

**Interfaces:**
- Consumes: `signalsSinceHealthy`, `SHARED_ERROR_THRESHOLD`, the `gate_error_signal` entry and `gate_error_aggregate` cause (Task 1); the existing `servedAlready`, `requestedInOpenTrip`, `record`, `ensureRepair`.
- Produces (in `src/ports.ts`):
  - `export interface CheckErrorReport { surfaceId: string; key: string }`
  - `export type CheckErrorAnswer = "shared" | "alone"`
- Produces (in `src/breaker.ts`): `RunBreaker.reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>`. `"shared"`: the run repaired the environment (or already had, for this `key`); check again. `"alone"`: no other task has reported since the environment was last healthy; the task deals with it itself. Rejects with `RunHalted` once the run has given up. Task 3 moves the method's declaration from `RunBreaker` to `RepairCoordinator`.

- [ ] **Step 1: Write the failing tests**

Add to `src/breaker.test.ts`, after the describe "one repair of the shared environment for the whole run" (the `signal` and `aggregate` helpers are Task 1's):

```ts
describe("a check that keeps erroring", () => {
  it("is the task's own business while no other task has reported it: nothing trips, nobody is held", async () => {
    const { breaker, dispatched, changes, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");

    expect(await entries()).toEqual([signal("a")]);
    expect(dispatched).toEqual([]);
    expect(changes).toEqual([]);
    (await breaker.awaitClearance("b"))();
    expect(await entries()).toEqual([signal("a")]);
  });

  it("counts the same task once however often it reports", async () => {
    const { breaker, dispatched, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");
    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-5" })).toBe("alone");

    expect(await entries()).toEqual([signal("a")]);
    expect(dispatched).toEqual([]);
  });

  it("is shared once a second, different task reports it: one repair, in that task's copy", async () => {
    const { breaker, dispatched, changes, answer, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");
    const second = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["b:run-repair-1"]));
    await answer(fixed);

    expect(await second).toBe("shared");
    expect(await entries()).toEqual([
      signal("a"),
      signal("b"),
      aggregate("b", ["a", "b"]),
      { t: "repair_request", surfaceId: "b", key: "triage-3" },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "b" },
      { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored the helper" },
      healthy,
    ]);
    expect(changes).toEqual([
      { state: "DEGRADED", affected: ["b"] },
      { state: "REPAIRING", affected: ["b"], repair: { attempt: 1, of: 2 } },
      { state: "HEALTHY", affected: ["b"] },
    ]);
  });

  it("no longer counts earlier reports once a repair has worked", async () => {
    const { breaker, dispatched } = await breakerOver([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy]);

    expect(await breaker.reportCheckErrors({ surfaceId: "c", key: "triage-3" })).toBe("alone");
    expect(dispatched).toEqual([]);
  });

  it("shares a repair already pending, without counting as evidence of its own", async () => {
    const { breaker, dispatched, answer, entries } = await breakerOver();
    const first = breaker.requestRepair({ surfaceId: "a", key: null, reason: "the shared helper is missing" });
    const joined = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["a:run-repair-1"]));
    await answer(fixed);

    await first;
    expect(await joined).toBe("shared");
    expect((await entries()).map((entry) => entry.t)).toEqual(["breaker_degraded", "repair_request", "repair_request", "repair_dispatch", "repair_terminus", "breaker_healthy"]);
  });

  it("answers a report already repaired before a crash, without counting or repairing again", async () => {
    const history: RunEntry[] = [signal("a"), signal("b"), aggregate("b", ["a", "b"]), { t: "repair_request", surfaceId: "b", key: "triage-3" }, dispatch(1, "b"), terminus(1), healthy];
    const { breaker, dispatched, entries } = await breakerOver(history);

    expect(await breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" })).toBe("shared");
    expect(dispatched).toEqual([]);
    expect(await entries()).toEqual(history);
  });

  it("trips when picked up after a crash that landed between the second report and the trip", async () => {
    const { breaker, dispatched, answer } = await breakerOver([signal("a"), signal("b")]);

    const again = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["b:run-repair-1"]));
    await answer(fixed);
    expect(await again).toBe("shared");
  });

  it("is refused once the run has given up", async () => {
    const { breaker } = await breakerOver([degraded("a"), { t: "run_escalated", reason: "gave up" }]);
    await expect(breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" })).rejects.toBeInstanceOf(RunHalted);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/breaker.test.ts -t "a check that keeps erroring"`
Expected: FAIL with "breaker.reportCheckErrors is not a function".

- [ ] **Step 3: Implement**

In `src/ports.ts`, add after `RepairRequest`:

```ts
/** A task saying its check kept erroring until its own re-checks ran out. `key` names the setback, so a report answered before a crash is not answered twice. */
export interface CheckErrorReport {
  surfaceId: string;
  key: string;
}

/** "shared": the run repaired the environment every task shares, so check again. "alone": no other task has hit it, so deal with it as a task on its own would. */
export type CheckErrorAnswer = "shared" | "alone";
```

In `src/breaker.ts`, import the two types from `./ports.js`, and extend `RunBreaker`:

```ts
export interface RunBreaker extends RepairCoordinator {
  /** Why the run gave up on the shared environment, once it has: start nothing more. */
  readonly gaveUp: string | undefined;
  /** A task's check kept erroring until its re-checks ran out: is that its own problem, or everyone's? */
  reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>;
}
```

Add the method to the object `createRunBreaker` returns, after `requestRepair`:

```ts
    async reportCheckErrors({ surfaceId, key }) {
      if (gaveUp !== undefined) throw new RunHalted(gaveUp);
      if (servedAlready(log, surfaceId, key)) return "shared";
      if (state === "HEALTHY") {
        // One task's check erroring is that task's business; the same thing in a second, different task is the
        // environment's. The same task counts once. No await before the trip: as in `requestRepair`, two tasks
        // reporting in the same instant must see one count and one trip.
        if (!signalsSinceHealthy(log).includes(surfaceId)) void record({ t: "gate_error_signal", surfaceId });
        const surfaceIds = signalsSinceHealthy(log);
        if (surfaceIds.length < SHARED_ERROR_THRESHOLD) {
          // On disk before the task acts on the answer, like everything else decided here.
          await writing;
          return "alone";
        }
        void record({ t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId, surfaceIds } });
        onChange({ state: "DEGRADED", affected: [surfaceId] });
      }
      // A trip already open, whatever opened it, is repaired once for everyone: this report shares it.
      if (!requestedInOpenTrip(log, surfaceId, key)) await record({ t: "repair_request", surfaceId, key });
      await ensureRepair();
      return "shared";
    },
```

Extend the doc comment on `createRunBreaker` with one paragraph:

```ts
 * A trip opens two ways: a task finds the check cannot run before it has
 * started (`requestRepair`), or a second, different task reports that its
 * check kept erroring until its re-checks ran out (`reportCheckErrors`). One
 * such report alone trips nothing.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/breaker.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts src/breaker.ts src/breaker.test.ts
git commit -m "Trip the run only when a second task's check keeps erroring too

Reacting to every flaky check with a run-wide repair wastes the run's repair
limit, and ignoring the same error across tasks lets every task fail. The
breaker now answers a task that ran out of re-checks: alone while no other
task has reported since the environment was last healthy, shared (after the
one repair) once a second, different task has. The same task counts once and
a successful repair clears the count.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Have a task ask whether its check errors are shared, and deal with them itself when they are not ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/ports.ts` (`RepairRequest`, `RepairCoordinator`)
- Modify: `src/breaker.ts` (`RunBreaker`, `requestRepair`)
- Modify: `src/surface.ts` (`dispatchGateMaintenance` → `dispatchOwnRepair`, `preGating`, `gateMaintenance`)
- Modify: `docs/multi-surface-control-flow.md`, `README.md`
- Create: `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`
- Test: `src/surface.test.ts`, `src/breaker.test.ts`, `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `CheckErrorReport`, `CheckErrorAnswer`, `RunBreaker.reportCheckErrors` (Task 2).
- Produces (in `src/ports.ts`):
  - `RepairRequest` is `{ surfaceId: string; reason: string }` (no `key`).
  - `RepairCoordinator` gains `reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>`; `RunBreaker` no longer declares it separately.
- Behaviour of a task with a coordinator: baseline ERROR calls `requestRepair` then re-takes the baseline (unchanged); a `fix_the_gate` tail calls `reportCheckErrors({ surfaceId, key: <that triage entry's artifactRef> })`; `"shared"` re-checks the same attempt with no dispatch of its own; `"alone"` dispatches its own gate-maintenance session on its own `gateMaintenance` budget. Its own repair's later tails never call the coordinator.

- [ ] **Step 1: Write the failing tests**

In `src/surface.test.ts`, add `CheckErrorReport` to the type import from `./ports.js`, and replace `fakeCoordinator` with:

```ts
/** A coordinator that clears at once and records what it was asked. `repair` stands in for the run's one repair; `answer` is what it says to a task whose check kept erroring. */
function fakeCoordinator(repair: () => void = () => undefined, answer: "shared" | "alone" = "shared") {
  const events: string[] = [];
  const requests: RepairRequest[] = [];
  const reports: CheckErrorReport[] = [];
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
    reportCheckErrors: (report) => {
      reports.push(report);
      if (answer === "shared") repair();
      return Promise.resolve(answer);
    },
  };
  return { coordinator, events, requests, reports };
}
```

In the describe "a task of a run of several at once":

- in "asks the run to repair a gate that cannot run, instead of dispatching its own repair, then re-takes the baseline", change the expectation to `expect(requests).toEqual([{ surfaceId: "surface-1", reason: expect.any(String) }]);`
- in "stops where it is, with no outcome of its own, when the run has given up", add to the coordinator literal: `reportCheckErrors: () => Promise.reject(new RunHalted("the shared environment could not be repaired")),`
- add these tests at the end of the describe:

```ts
  /** A worker whose change removes the file the check reads: the check can no longer run at all, an ERROR, not a failing test. */
  const breaksTheCheck = (ctx: { worktreePath: string }): Promise<Terminus> => {
    rmSync(join(ctx.worktreePath, "report.tap"));
    return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
  };
  const gateRepairs = (history: HistoryEntry[]) => history.filter((entry) => entry.t === "dispatch" && entry.role === "gate-maintenance");

  it("repairs its own check, on its own limit, when the run says no other task has hit the same error", async () => {
    const { coordinator, requests, reports } = fakeCoordinator(undefined, "alone");
    const agent = sessionAgent((role, ctx) => {
      if (role === "worker") return breaksTheCheck(ctx);
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    });
    const ports = { ...portsWithTriage(agent), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    const { history } = await load(dir);
    const ordered = history.findLast((entry) => entry.t === "triage");
    expect(ordered).toMatchObject({ trigger: "gate_error", verdict: "fix_the_gate" });
    // Asked once, about the round that ordered the repair, and only after its own three re-checks.
    expect(reports).toEqual([{ surfaceId: "surface-1", key: ordered?.t === "triage" ? ordered.artifactRef : "" }]);
    expect(requests).toEqual([]);
    expect(gateRepairs(history)).toMatchObject([{ attempt: 1 }]);
    expect(deriveBudgetsFromLog(history, budgets).gateMaintenance.used).toBe(1);
  });

  it("checks the same attempt again, with no repair of its own, when the run says it was shared and repaired", async () => {
    let location: SurfaceLocation = { repoPath: "", worktreePath: "" };
    const { coordinator, reports } = fakeCoordinator(() => writeFileSync(join(location.worktreePath, "report.tap"), PASSING_TAP));
    const agent = sessionAgent((role, ctx) =>
      role === "worker" ? breaksTheCheck(ctx) : Promise.reject(new Error("no repair of its own was expected")),
    );
    const ports = { ...portsWithTriage(agent), repairCoordinator: coordinator };
    location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    const { history } = await load(dir);
    expect(reports).toHaveLength(1);
    expect(gateRepairs(history)).toEqual([]);
    expect(deriveBudgetsFromLog(history, budgets).gateMaintenance.used).toBe(0);
    expect(history.filter((entry) => entry.t === "gate")).toMatchObject([
      { attempt: 1, status: "ERROR" }, { attempt: 1, status: "ERROR" }, { attempt: 1, status: "ERROR" }, { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "PASS" },
    ]);
  });

  it("reports each new round of errors, and stops on its own limit while it stays alone", async () => {
    const { coordinator, reports } = fakeCoordinator(undefined, "alone");
    const agent = sessionAgent((role, ctx) =>
      role === "worker" ? breaksTheCheck(ctx) : Promise.resolve({ status: "completed", rationale: "tried, changed nothing" }),
    );
    const ports = { ...portsWithTriage(agent), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("ESCALATED");

    const { history } = await load(dir);
    expect(reports).toHaveLength(2);
    expect(new Set(reports.map((report) => report.key)).size).toBe(2);
    expect(gateRepairs(history)).toHaveLength(2);
  });

  it("finishes a repair of its own without asking the run again when that repair ends without a result", async () => {
    const { coordinator, requests, reports } = fakeCoordinator(undefined, "alone");
    let repairs = 0;
    const agent = sessionAgent((role, ctx) => {
      if (role === "worker") return breaksTheCheck(ctx);
      repairs += 1;
      if (repairs === 1) return Promise.resolve({ status: "incomplete", rationale: "the repair session ended without a result" });
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    });
    const ports = { ...portsWithTriage(agent), repairCoordinator: coordinator };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    expect(reports).toHaveLength(1);
    expect(requests).toEqual([]);
    expect(gateRepairs((await load(dir)).history)).toHaveLength(2);
  });
```

In `src/breaker.test.ts`:

- remove `key: null, ` from every `requestRepair` call (they become `{ surfaceId, reason }`):

  ```bash
  sed -i 's/\(requestRepair({ surfaceId: "[a-z]"\), key: null,/\1,/' src/breaker.test.ts
  ```

- in "runs one repair however many tasks ask, counts it once, and releases them all when it works", the second task now asks the way a post-task request does. Replace its `second` line with:

  ```ts
      const second = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-2" });
  ```

  (the expected entries and changes are unchanged: a report made while a trip is open shares it.)
- delete the test "answers a request already repaired before a crash without tripping again": Task 2's "answers a report already repaired before a crash, without counting or repairing again" covers the keyed path, which is now the only one.

In `src/cli/run-command.test.ts`, inside the describe "when the shared environment breaks", after the `ofType` helper, add:

```ts
    /**
     * A check that runs at the start but, for the first `affected` copies to check their work, does not answer four
     * times each (a check and its three re-checks), then answers. Counted per copy, so which task reaches its check
     * first changes nothing.
     */
    const comesAndGoes = (affected: number) => [
      "const refused = new Map();",
      'const answered = { status: "PASS", assertions: [{ id: "shared-helper", outcome: "PASS", detail: "answered" }] };',
      "const check = async ({ worktreePath }) => {",
      "  const times = refused.get(worktreePath) ?? 0;",
      `  if (times >= 4 || (times === 0 && refused.size >= ${affected})) return answered;`,
      "  refused.set(worktreePath, times + 1);",
      '  return { status: "ERROR", assertions: [], detail: "the shared helper did not answer" };',
      "};",
      "export default { baseline: async () => answered, check };",
    ].join("\n");
    const ownRepairs = async (repo: string) =>
      (await allRuns(repo)).filter((record) => record.caseFile.history.some((entry) => entry.t === "dispatch" && entry.role === "gate-maintenance")).map((record) => record.runId);

    describe("when a check keeps erroring after a task has done its work", () => {
      it(
        "leaves one task's errors to that task: no run-wide message, no hold, no run repair",
        async () => {
          const repo = brokenRepo("run-command-errors-alone-", comesAndGoes(1), [PAGE, SWAP, WAVE]);

          const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

          expect(exitCode).toBe(EXIT.ok);
          expect(stdout).not.toContain("shared environment");
          const { history } = await theRunFile(repo);
          const signals = ofType(history, "gate_error_signal");
          expect(signals).toHaveLength(1);
          expect(ofType(history, "breaker_degraded")).toEqual([]);
          expect(ofType(history, "held")).toEqual([]);
          expect(ofType(history, "repair_dispatch")).toEqual([]);
          // That task repaired its own check, on its own limit.
          expect(await ownRepairs(repo)).toEqual([signals[0]?.surfaceId]);
        },
        RUN_TIMEOUT * 2,
      );

      it(
        "treats a second, different task hitting it as the shared environment: says so, repairs once, and finishes every task",
        async () => {
          const repo = brokenRepo("run-command-errors-shared-", comesAndGoes(2), [PAGE, SWAP, WAVE]);

          const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

          expect(exitCode).toBe(EXIT.ok);
          const lines = stdout.split("\n");
          expect(lines.filter((line) => line.startsWith("! Something in the shared environment looks broken"))).toHaveLength(1);
          expect(lines.filter((line) => line === "  - repairing (attempt 1 of 2)")).toHaveLength(1);
          expect(lines.filter((line) => line === "✓ Fixed. Resuming.")).toHaveLength(1);
          expect(lines.at(-2)).toBe(EVERY_TASK_DONE);
          expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|GATE_MAINTENANCE|gate_error/);

          const { history } = await theRunFile(repo);
          const reported = ofType(history, "gate_error_signal").map((entry) => entry.surfaceId);
          expect(new Set(reported).size).toBe(2);
          expect(ofType(history, "breaker_degraded").map((entry) => entry.cause)).toEqual([
            { kind: "gate_error_aggregate", surfaceId: reported[1], surfaceIds: reported },
          ]);
          expect(ofType(history, "repair_dispatch")).toMatchObject([{ attempt: 1, surfaceId: reported[1] }]);
          // The first to report was told it was alone and repaired its own check; the second was repaired by the run.
          expect(await ownRepairs(repo)).toEqual([reported[0]]);
        },
        RUN_TIMEOUT * 2,
      );
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts src/cli/run-command.test.ts -t "a task of a run of several at once|when a check keeps erroring after a task has done its work"`
Expected: FAIL. The surface tests fail because a task with a coordinator never dispatches its own repair and never calls `reportCheckErrors`; the run tests fail because the first task to run out of re-checks trips the run directly (no `gate_error_signal` entries, a `gate_maintenance` cause).

- [ ] **Step 3: Implement**

`src/ports.ts`: replace the `RepairRequest` and `RepairCoordinator` declarations with:

```ts
/** A task that found the check could not run before it had started, asking for the environment every task shares to be repaired. */
export interface RepairRequest {
  surfaceId: string;
  reason: string;
}
```

```ts
/**
 * How a task in a run of several at once shares one environment with the
 * others. A task checks and hands off its work only once cleared. A check that
 * cannot run before the task has started is the environment's, and the run
 * repairs it. A check that keeps erroring on the task's own finished work may
 * be the task's or the environment's, so the task asks which. Absent, a task
 * behaves exactly as it does on its own.
 */
export interface RepairCoordinator {
  /** Wait until the shared environment may be used, then return the function that says this task is done with it. */
  awaitClearance(surfaceId: string): Promise<() => void>;
  /** Resolve once the run's one repair has fixed it; rejects with `RunHalted` if the run gave up. */
  requestRepair(request: RepairRequest): Promise<void>;
  /** A check kept erroring until this task's re-checks ran out: shared and now repaired, or this task's alone? Rejects with `RunHalted` if the run gave up. */
  reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>;
}
```

(move the `CheckErrorReport` and `CheckErrorAnswer` declarations above `RepairCoordinator` if they are below it.)

`src/breaker.ts`: `RunBreaker` goes back to declaring only `gaveUp` (delete its `reportCheckErrors` member and the now-unused type imports if the compiler says so), and `requestRepair` becomes:

```ts
    async requestRepair({ surfaceId, reason }) {
      if (gaveUp !== undefined) throw new RunHalted(gaveUp);
      // No await between the trip and its request: both land in the log before any other task's request or hold,
      // so the trip's own request is recorded first (the order the first test asserts). `record` chains the writes.
      if (state === "HEALTHY") {
        void record({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
        onChange({ state: "DEGRADED", affected: [surfaceId] });
      }
      // Asked before the task has started, so there is no setback to name: taking the baseline again is itself the check.
      if (!requestedInOpenTrip(log, surfaceId, null)) await record({ t: "repair_request", surfaceId, key: null });
      await ensureRepair();
    },
```

`src/surface.ts`: replace `dispatchGateMaintenance` (doc comment included) with:

```ts
/**
 * Dispatch one repair session on this task's own limit, or escalate if that
 * limit is spent. The dispatch entry IS the budget burn: the count is derived
 * from the log first, and the entry appended only if under cap, so "burned
 * live" and "derived from the log on rebuild" are the same computation by
 * construction. Whether the task should be repairing at all, in a run of
 * several at once, is decided by the two callers that learn the check cannot
 * run, never here.
 */
async function dispatchOwnRepair(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  reason: string,
): Promise<AdvanceResult> {
  const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
  const { used, max } = budgets.gateMaintenance;
  if (used >= max) {
    return escalate(
      dir, caseFile, location, ports, "gate-maintenance",
      budgetExhausted("gateMaintenance", { used, max }, reason),
      await packetFor(dir, { kind: "budget", population: "gateMaintenance", budget: { used, max }, detail: reason }),
    );
  }

  return dispatchSession(
    dir, caseFile, location, ports,
    "gate-maintenance", gateMaintenanceAttempt(caseFile.history),
  );
}
```

In `preGating`, replace everything after the `if (report.status !== "ERROR") { ... }` block with:

```ts
  // recordBaseline stores nothing on ERROR, so `caseFile` is still current.
  const reason = report.detail ?? "the gate could not run";
  // In a run of several at once, a check that cannot run before this task has done anything is the environment
  // every task shares: the run repairs it, once, on its own limit, and the baseline is taken again.
  if (ports.repairCoordinator) {
    await ports.repairCoordinator.requestRepair({ surfaceId: caseFile.header.surfaceId, reason });
    return preGating(dir, caseFile, location, ports);
  }
  return dispatchOwnRepair(dir, caseFile, location, ports, reason);
```

In `gateMaintenance`, replace the `if (tail?.t === "triage") { ... }` block with:

```ts
  if (tail?.t === "triage") {
    // The check kept erroring until this task's re-checks ran out. In a run of several at once that may be this
    // task's own doing or the environment every task shares, so the run is asked: shared means it has been
    // repaired, once, for everyone, and the same attempt is checked again; alone means this task deals with it
    // exactly as a task on its own does. The round's ref names the setback, so a crash after the run's repair
    // does not have it repaired twice.
    const answer = await ports.repairCoordinator?.reportCheckErrors({ surfaceId: caseFile.header.surfaceId, key: tail.artifactRef });
    if (answer === "shared") return gating(dir, caseFile, location, ports);
    return dispatchOwnRepair(dir, caseFile, location, ports, "triage routed the setback to a gate repair");
  }
```

and in the `"incomplete"` case replace `dispatchGateMaintenance(` with `dispatchOwnRepair(` (same arguments). Add one sentence to the end of `gateMaintenance`'s doc comment:

```ts
 *
 * Only the `triage` tail asks the run anything. A repair this task has already
 * dispatched is its own, and its later tails are routed as a single task's are.
```

`docs/multi-surface-control-flow.md`, "Shared-environment failure: breaker + stop-the-world repair": in the state block, change the `→ DEGRADED` line to

```
  → DEGRADED           (a surface's baseline cannot be taken, or a second distinct surface exhausts its gate_error rechecks)
```

replace the first Mechanics bullet with

```markdown
- A surface whose **baseline** cannot be taken (the gate ERRORs before any worker
  has run) does **not** dispatch its own repair agent. Nothing the surface did can
  explain it, so it asks the run, which trips the breaker to `DEGRADED` and
  records the trip, the request and every task it holds in the run file (not the
  case file).
```

and the last Mechanics bullet with

```markdown
- `gate_error` keeps its cheap per-surface re-run. A surface that exhausts those
  re-runs reports it to the run, which records one `gate_error_signal` per surface
  since the breaker was last `HEALTHY`. The first such surface is told it is alone
  and repairs its own gate on its own `gate_maintenance` budget, exactly as a
  single surface does: one surface's error is that surface's business. A second,
  *distinct* surface reporting trips the breaker (`gate_error_aggregate`) and the
  run repairs once. The same surface reporting twice counts once, and a successful
  repair clears the count. So `gate_maintenance` is run-level for a shared
  breakage and stays per-surface for an uncorroborated one.
```

In the budget table, change the `gate_maintenance` row to `| `gate_maintenance` | the shared environment is broken, or one surface's own gate is | **run-level** once shared (pre-task, or two distinct surfaces); per-surface while uncorroborated |`. In "Open items", replace the "Breaker signal tuning" bullet with

```markdown
- **Breaker signal tuning**: the `gate_error` aggregate threshold is fixed at two
  distinct surfaces since the breaker was last `HEALTHY`, with no time window
  (`SHARED_ERROR_THRESHOLD` in `src/breaker.ts`). Retune it, and consider a
  window, once real flake rates are known.
```

`README.md`, in the several-at-once section, replace the paragraph that begins "If the environment your tasks share breaks during a run of several at once" (up to and including "with the same agent that repairs a check for a single task:") with:

```markdown
If the environment your tasks share breaks during a run of several at once, the run does not let
every task discover it, retry and fight over it. A check that cannot run at all before a task has
started is treated as shared straight away. A check that keeps erroring on a task's finished work
(the check itself erroring, not a failing test) is first that task's own business: it re-checks,
then repairs its own check on its own limit, and no other task is affected. Only when a second,
different task hits the same thing does the run treat it as shared; the same task erroring again
does not count twice, and a successful repair starts the count afresh. Once it is shared, the run
holds any task about to check or hand off its work, leaves work already under way alone, and
repairs the environment once, with the same agent that repairs a check for a single task:
```

and in the settings table's `budgets` row replace the last sentence with: "With several tasks at once, `gateMaintenance` is also one limit for the whole run: how many times it may repair the environment the tasks share. A task still has its own for a check error only it has hit."

Create `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`:

```markdown
---
"delivery-service": minor
---

In a run of several tasks at once, a check that keeps erroring on one task's finished work is now
that task's own business: it re-checks, then repairs its own check on its own limit, and no other
task is held. Only when a second, different task hits the same thing does the run treat the shared
environment as broken and repair it once. The same task erroring again counts once, and a
successful repair starts the count afresh. A check that cannot run before a task has started still
stops the run for one repair straight away. A run of one task at a time is unchanged.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts src/breaker.test.ts && npx vitest run src/cli/run-command.test.ts -t "when the shared environment breaks" && npx tsc --noEmit`
Expected: PASS, no type errors (the `-t` filter runs slice 5's four integration tests in that block as well as the two new ones: all must pass).

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts src/breaker.ts src/breaker.test.ts src/surface.ts src/surface.test.ts src/cli/run-command.test.ts docs/multi-surface-control-flow.md README.md .changeset/tell-a-one-off-check-error-from-a-shared-one.md
git commit -m "Leave one task's check errors to that task until a second task hits them

A task whose check kept erroring after its work used to stop the whole run for
a repair, spending the run's limit on what may be one task's own doing. It now
asks the run whether the error is shared: alone, it repairs its own check on
its own limit as a single task does; shared, the run repairs once and the task
checks again. A check that cannot run before a task starts still trips the run
at once, so that request no longer carries a setback key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show a repair in the run's history when looking back ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/status-command.ts` (`supervisedReport`)
- Modify: `README.md`, `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `tripsOf` (`src/breaker.ts`), `BREAKER_PHRASES` (`src/cli/output.ts`).
- Produces: the supervised report's environment line is `Environment: healthy (repaired once during this run)` (or `twice`, or `N times`) when the environment is healthy and the run repaired it at least once; every other environment line is unchanged.

- [ ] **Step 1: Write the failing test**

In `src/cli/status-command.test.ts`, in the describe "when the shared environment broke", rename the test "says nothing of a trip the run repaired" to "leads with nothing for a trip the run repaired, and says beside the environment that it was repaired", and replace its last assertion (`expect(stdout).toContain("Environment: healthy");`) with:

```ts
      expect(stdout.split("\n")).toContain("Environment: healthy (repaired once during this run)");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/status-command.test.ts -t "says beside the environment that it was repaired"`
Expected: FAIL (the line reads `Environment: healthy`).

- [ ] **Step 3: Implement**

In `src/cli/status-command.ts`, add above `supervisedReport`:

```ts
/** Beside a healthy environment, how often the run repaired it: looking back, a repair is part of the run's history. Nothing while it is broken, where the report already leads with that. */
function repairedDuringRun(view: SupervisedView): string {
  const repaired = tripsOf(view.runFile.history).filter((trip) => trip.ended === "repaired").length;
  if (view.breaker !== "HEALTHY" || repaired === 0) return "";
  return ` (repaired ${repaired === 1 ? "once" : repaired === 2 ? "twice" : `${repaired} times`} during this run)`;
}
```

and change the environment line in `supervisedReport` to:

```ts
    `Environment: ${BREAKER_PHRASES[view.breaker]}${repairedDuringRun(view)}`,
```

`README.md`, "A run of several tasks at once" (status): replace the sentence "A run that repaired its environment and carried on says only "Environment: healthy"." with: "A run that repaired its environment and carried on says so beside it: "Environment: healthy (repaired once during this run)"; `--json` has the detail under `trips`."

Append to the changeset:

```markdown

`delivery status` for a run that repaired its shared environment and carried on now says so beside the environment line: "Environment: healthy (repaired once during this run)". `--json` names every task whose check errors led to a repair under `trips[].cause`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts README.md .changeset/tell-a-one-off-check-error-from-a-shared-one.md
git commit -m "Say beside a healthy environment that the run repaired it

A run that repaired its shared environment and carried on left no trace in the
report a person reads afterwards, only in --json. The environment line now says
how often it was repaired, so the repair is part of the run's visible history.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Describe a session stopped by a usage limit as that ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (new `UsageLimit`)
- Modify: `src/ports.ts` (`Terminus` incomplete variant, new `USAGE_LIMIT_WORDS`)
- Modify: `src/agent-invoke.ts` (`incomplete`, `invoke`, `lastResult`, new `usageLimitOf`)
- Modify: `src/cli/command-fixtures.ts` (new `rateLimited` script)
- Modify: `docs/testing-your-pipeline.md`, `docs/agent-interface.md`, `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`
- Test: `src/agent-invoke.test.ts`, `src/cli/run-command.test.ts`

**Interfaces:**
- Produces (in `src/schema.ts`): `export const UsageLimit = z.enum(["rate", "spend"])` and its type.
- Produces (in `src/ports.ts`):
  - `export const USAGE_LIMIT_WORDS: Record<UsageLimit, string>` = `{ rate: "the AI service is limiting requests", spend: "the spending limit has been reached" }`.
  - the incomplete `Terminus` variant gains `limit?: UsageLimit` (in memory only; never persisted in a case file).
- Produces (in `src/agent-invoke.ts`): `export function usageLimitOf(end: { apiError: string | undefined; status: number | null | undefined; text: string }): UsageLimit | undefined`. An incomplete terminus for a limit-stopped session has rationale `` `${role} session did not complete: ${USAGE_LIMIT_WORDS[limit]}` `` and `limit` set.
- Produces (in `src/cli/command-fixtures.ts`): `export const rateLimited: MockScript` (every session ends with the API's rate-limit error).

- [ ] **Step 1: Write the failing tests**

In `src/agent-invoke.test.ts`, add `usageLimitOf` to the import from `./agent-invoke.js`, `import { USAGE_LIMIT_WORDS } from "./ports.js";`, and at the end of the file:

```ts
/** What the runtime reports when the API refuses a request for its rate, and for a spend cap: the API's own error bodies. */
const RATE_LIMITED = 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}';
const SPEND_CAPPED = 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Usage limit","details":{"error_code":"enforced_spend_limit_reached"}}}';

describe("a session stopped by a usage limit", () => {
  it("says the AI service is limiting requests, and marks the terminus so a caller can tell", async () => {
    await script([{ fail: { message: RATE_LIMITED } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: "worker session did not complete: the AI service is limiting requests",
      limit: "rate",
    });
  });

  it("says the spending limit has been reached when that is what stopped it", async () => {
    await script([{ fail: { message: SPEND_CAPPED } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: "worker session did not complete: the spending limit has been reached",
      limit: "spend",
    });
  });

  it("leaves any other error as an error, unmarked", async () => {
    await script([{ fail: { message: "TypeError: the session blew up while talking about a rate limit" } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: `worker session did not complete: ${DID_NOT_COMPLETE.errored}`,
    });
  });

  it("keeps the service's own words beside the case file", async () => {
    await script([{ fail: { message: RATE_LIMITED } }]);
    await invoke(workerRoleConfig, ctx, useMock());
    expect(await readRef(dir, sessionErrorRef(ctx.sessionKey))).toEqual({
      sessionKey: "worker-1-0",
      role: "worker",
      reason: USAGE_LIMIT_WORDS.rate,
      cause: RATE_LIMITED,
    });
  });
});

describe("telling a usage limit from any other error", () => {
  it("reads what the runtime types before any text", () => {
    expect(usageLimitOf({ apiError: "rate_limit", status: null, text: "" })).toBe("rate");
    expect(usageLimitOf({ apiError: undefined, status: 429, text: "" })).toBe("rate");
    expect(usageLimitOf({ apiError: "billing_error", status: null, text: "" })).toBe("spend");
  });

  it("treats a spend cap, which is also a 429, as the spending limit", () => {
    expect(usageLimitOf({ apiError: "rate_limit", status: 429, text: SPEND_CAPPED })).toBe("spend");
  });

  it("is not a limit for an overloaded or failing service, nor for prose that mentions one", () => {
    expect(usageLimitOf({ apiError: "overloaded", status: 529, text: "Overloaded" })).toBeUndefined();
    expect(usageLimitOf({ apiError: "server_error", status: 500, text: "we hit the rate limit of our patience" })).toBeUndefined();
    expect(usageLimitOf({ apiError: undefined, status: undefined, text: "" })).toBeUndefined();
  });
});
```

In `src/cli/command-fixtures.ts`, add after `completes`:

```ts
/** A scripted agent whose every session is stopped by the API's rate limit, in the API's own words. */
export const rateLimited: MockScript = {
  expectations: [
    { fail: { message: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}' } },
  ],
};
```

In `src/cli/run-command.test.ts`, import `rateLimited` from `./command-fixtures.js`, and add inside the describe that holds the supervised tests (the one defining `PAGE`, `SWAP`, `WAVE`, `listRepo` and `theRunFile`), after the first test:

```ts
  it(
    "describes tasks stopped by a usage limit as that, never as a broken shared environment, and counts none of it as evidence",
    async () => {
      // One try each: the point is the wording and the run file, not the retries.
      const repo = listRepo("run-command-rate-limited-", { tasks: [PAGE, SWAP], concurrency: 2, budgets: { terminus: 1 } });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(rateLimited) } });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain("the AI service is limiting requests");
      expect(stdout).not.toContain("shared environment");
      const { history } = await theRunFile(repo);
      expect(history.filter((entry) => entry.t === "gate_error_signal" || entry.t === "breaker_degraded")).toEqual([]);
    },
    RUN_TIMEOUT * 2,
  );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent-invoke.test.ts src/cli/run-command.test.ts -t "usage limit"`
Expected: FAIL (`usageLimitOf` is not exported; the rationale reads "the session ended in an error before it reported a result").

- [ ] **Step 3: Implement**

`src/schema.ts`, beside `RepairStatus`:

```ts
/** A usage limit that can stop an agent session: the API's request rate, or the account's spending cap. */
export const UsageLimit = z.enum(["rate", "spend"]);
export type UsageLimit = z.infer<typeof UsageLimit>;
```

`src/ports.ts`: add `UsageLimit` to the type import from `./schema.js`; add to the incomplete `Terminus` variant, after `notRun`:

```ts
      /**
       * Set when a usage limit stopped the session. Like `notRun`, the fact for
       * a caller that cannot read prose: a limit says nothing about the task,
       * its check or the environment, and must never be reported as any of them.
       */
      limit?: UsageLimit;
```

and add below the `Incomplete` type:

```ts
/** The plain words a usage limit is always described with. One table, so every place that names a limit names it the same way. */
export const USAGE_LIMIT_WORDS: Record<UsageLimit, string> = {
  rate: "the AI service is limiting requests",
  spend: "the spending limit has been reached",
};
```

`src/agent-invoke.ts`:

- change the SDK import to `import { query, type CanUseTool, type Options, type SDKAssistantMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";`, add `import type { UsageLimit } from "./schema.js";`, and import `USAGE_LIMIT_WORDS` (a value) from `./ports.js` alongside the existing type imports.
- replace `incomplete` with:

```ts
function incomplete(roleCfg: RoleConfig<unknown>, reason: string, limit?: UsageLimit): Incomplete {
  return {
    status: "incomplete",
    rationale: `${roleCfg.role} session did not complete: ${reason}`,
    ...(reason === DID_NOT_COMPLETE.notRun ? { notRun: true as const } : {}),
    ...(limit ? { limit } : {}),
  };
}
```

- add after `errorTextOf`:

```ts
/**
 * Whether a usage limit is what stopped the session, and which. Read from what
 * the runtime types (the assistant message's `error`, the result's API status)
 * and then from the API's own machine identifiers in the error text, which is
 * all a scripted session can produce. Never from prose: a session that merely
 * talks about limits is not stopped by one. A spend cap is also a 429, so it is
 * looked for first; an overloaded or failing service is not a usage limit.
 */
// ponytail: classification only. A limited session is retried like any incomplete one, with no backoff; add
// retry-after backoff with the host resource governor the design defers (spec section 9).
export function usageLimitOf({ apiError, status, text }: { apiError: string | undefined; status: number | null | undefined; text: string }): UsageLimit | undefined {
  if (apiError === "billing_error" || /enforced_spend_limit_reached|billing_error/.test(text)) return "spend";
  if (apiError === "rate_limit" || status === 429 || text.includes("rate_limit_error")) return "rate";
  return undefined;
}
```

- replace `lastResult` with:

```ts
/**
 * Drive the session to its end and keep the result message, and the last
 * error the runtime typed on an assistant message. The stream is drained
 * rather than broken out of, so the child process is never left behind.
 */
async function sessionEnd(prompt: string, options: Options): Promise<{ result: SDKResultMessage | undefined; apiError: SDKAssistantMessage["error"] }> {
  let result: SDKResultMessage | undefined;
  let apiError: SDKAssistantMessage["error"];
  for await (const message of query({ prompt, options })) {
    if (message.type === "assistant" && message.error !== undefined) apiError = message.error;
    if (message.type === "result") result = message;
  }
  return { result, apiError };
}
```

- in `invoke`, replace the `let result ... try { result = await lastResult(prompt, options); } catch` opening with:

```ts
  let result: SDKResultMessage | undefined;
  let apiError: SDKAssistantMessage["error"];
  try {
    ({ result, apiError } = await sessionEnd(prompt, options));
  } catch (err) {
```

(the catch body is unchanged), and replace the `if (result.subtype !== "success" || result.is_error) { ... }` block with:

```ts
  if (result.subtype !== "success" || result.is_error) {
    const cause = errorTextOf(result);
    const limit = usageLimitOf({ apiError, status: result.subtype === "success" ? result.api_error_status : undefined, text: cause });
    const reason = limit ? USAGE_LIMIT_WORDS[limit] : DID_NOT_COMPLETE.errored;
    await recordFailureCause(roleCfg, ctx, reason, { cause });
    return incomplete(roleCfg, reason, limit);
  }
```

- add one paragraph to the end of the `DID_NOT_COMPLETE` doc comment:

```ts
 *
 * A session that ended in an error because a usage limit stopped it is not
 * reported with `errored` but with the limit's own fixed words
 * (`USAGE_LIMIT_WORDS`), and carries the `limit` mark: it is the service
 * declining, not the session failing.
```

`docs/testing-your-pipeline.md`, "When a reply ends as incomplete": add two rows to the end of the table:

```markdown
| `fail: { message }` whose message carries the API's rate-limit identifier, `rate_limit_error` | `worker session did not complete: the AI service is limiting requests` | the terminus is marked `limit: "rate"`; a usage limit is never counted as a broken check or environment |
| `fail: { message }` whose message carries the API's spend-cap identifier, `enforced_spend_limit_reached` | `worker session did not complete: the spending limit has been reached` | the terminus is marked `limit: "spend"` |
```

`docs/agent-interface.md`: after the paragraph that ends "the rationale a person reads is the same fixed sentence either way." add:

```markdown
A session stopped by a usage limit is the other end that is not uniform. The
primitive recognises it from the runtime's typed error (`rate_limit`,
`billing_error`), the API status (429) or the API's own identifiers in the error
text, never from prose, and reports it in fixed words of its own: "the AI
service is limiting requests" or "the spending limit has been reached". The
terminus carries `limit` (`"rate"` or `"spend"`). A task retries it as any
incomplete session; a run of several at once never counts it as evidence that
the shared environment is broken.
```

and in the "Terminus mapping" bullet, after "only the journal's `unmatched` event tells them apart." add: " A scripted `fail` whose message carries `rate_limit_error` or `enforced_spend_limit_reached` reads as a usage limit instead."

Append to the changeset:

```markdown

An agent session stopped by an API rate limit or a spending limit is now described as that, in plain words: "the AI service is limiting requests" or "the spending limit has been reached". It is never counted as a check error or as a sign that the shared environment is broken.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agent-invoke.test.ts && npx vitest run src/cli/run-command.test.ts -t "usage limit" && npx vitest run tests/testing-your-pipeline-guide.test.ts -t "ends as incomplete" && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/ports.ts src/agent-invoke.ts src/agent-invoke.test.ts src/cli/command-fixtures.ts src/cli/run-command.test.ts docs/testing-your-pipeline.md docs/agent-interface.md .changeset/tell-a-one-off-check-error-from-a-shared-one.md
git commit -m "Describe a session stopped by a usage limit as that

A rate limit or spend cap read as \"the session ended in an error\", which says
nothing a project owner can act on and invites blaming the project. The session
seam now recognises a limit from the runtime's typed signals and the API's own
identifiers, never from prose, reports it in two fixed phrases and marks the
terminus, so nothing downstream can mistake it for a broken check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stop the run naming the limit when a usage limit stops the shared repair ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (`run_escalated`, `RunOutcome`)
- Modify: `src/breaker.ts` (`Trip`, `tripsOf`, `giveUp`, `repair`, new `stoppedByLimit`)
- Modify: `src/cli/queue.ts` (`environmentGaveUp`, `stopForEnvironment`)
- Modify: `src/cli/status-command.ts` (`SupervisedStatusDocument.cause`, `environmentNarration`)
- Modify: `README.md`, `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`
- Test: `src/breaker.test.ts`, `src/cli/queue.test.ts`, `src/cli/status-command.test.ts`, `src/cli/run-command.test.ts`

**Interfaces:**
- Consumes: `UsageLimit` (`src/schema.ts`), `USAGE_LIMIT_WORDS` and `Terminus.limit` (`src/ports.ts`), `rateLimited` (`src/cli/command-fixtures.ts`), all from Task 5.
- Produces:
  - `RunEntry` `run_escalated` gains optional `limit: UsageLimit`.
  - `RunOutcome` escalated `cause` is `"shared_environment" | "usage_limit"`.
  - `Trip` gains `limit: UsageLimit | null` (set from the `run_escalated` entry that ended it).
  - `export const stoppedByLimit = (limit: UsageLimit): string` in `src/breaker.ts`.
  - `environmentGaveUp(attempts: number, standings: ListStandings, of: number, limit: UsageLimit | null = null): string`.
  - `SupervisedStatusDocument.cause: "shared_environment" | "usage_limit" | null`.

- [ ] **Step 1: Write the failing tests**

`src/breaker.test.ts`: add `stoppedByLimit` to the import from `./breaker.js`. In "names the cause, every task held once in the order held, each attempt, and how it ended", add `limit: null,` to the expected trip (after `reason: null,`). In the describe "one repair of the shared environment for the whole run", add:

```ts
  it("gives up at once, naming the limit and not the environment, when a usage limit stops the repair", async () => {
    const { breaker, answer, dispatched, entries } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer({ status: "incomplete", rationale: "gate-maintenance session did not complete: the AI service is limiting requests", limit: "rate" });

    await expect(asked).rejects.toThrow("the AI service is limiting requests");
    expect(breaker.gaveUp).toBe(stoppedByLimit("rate"));
    expect(breaker.gaveUp).not.toContain("could not be repaired");
    // The next attempt would meet the same limit: the run's repair limit (2 here) is not spent finding that out.
    expect(dispatched).toHaveLength(1);
    const history = await entries();
    expect(history.at(-1)).toEqual({ t: "run_escalated", reason: stoppedByLimit("rate"), limit: "rate" });
    expect(tripsOf(history).at(-1)).toMatchObject({ ended: "gave_up", limit: "rate" });
  });
```

`src/cli/queue.test.ts`, in the describe "what a run of several at once says when it gives up on its shared environment":

```ts
  it("names a usage limit, and no number of attempts, when that is what stopped the repair", () => {
    expect(environmentGaveUp(1, { waiting: 2, finished: 0, queued: 1 }, 3, "rate")).toBe(
      "The repair could not run because the AI service is limiting requests. Stopping the run. 2 of 3 tasks were waiting on this and need your attention; 0 had already finished, 1 is still queued.",
    );
    expect(environmentGaveUp(1, { waiting: 1, finished: 0, queued: 1 }, 2, "spend")).toBe(
      "The repair could not run because the spending limit has been reached. Stopping the run. 1 of 2 tasks was waiting on this and needs your attention; 0 had already finished, 1 is still queued.",
    );
  });
```

`src/cli/status-command.test.ts`: in "gives the trip, the run's repair limit and why it stopped in --json, for looking back", add `limit: null,` to the expected trip (after its `reason`). In the same describe add:

```ts
    it("leads with the usage limit, not the environment, when a limit stopped the repair", async () => {
      const repo = initTempRepo("status-breaker-limit-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const reason = "the repair could not run because the AI service is limiting requests; no task caused this";
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: null },
        { t: "held", surfaceId: HELLO_RUN },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "incomplete", rationale: "gate-maintenance session did not complete: the AI service is limiting requests" },
        { t: "run_escalated", reason, limit: "rate" },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "usage_limit", reason, at: "2026-09-30T10:00:00.000Z" });

      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(stdout.split("\n").slice(0, 4)).toEqual([
        "The AI service is limiting requests, so the run stopped before it could repair the shared environment; no task caused this.",
        "It was first noticed by [2/3] add a goodbye: the shared helper is missing.",
        "Held: [2/3] add a goodbye, [1/3] add a hello.",
        "Once the limit no longer applies, `delivery run` carries the held tasks on.",
      ]);
      expect(stdout).not.toContain("could not be fixed");

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);
      expect(document.cause).toBe("usage_limit");
      expect(document.trips[0].limit).toBe("rate");
    });
```

`src/cli/run-command.test.ts`, in the describe "when the shared environment breaks", after "stops the run when it cannot repair it, naming the environment as the cause, and exits needing a decision":

```ts
    it(
      "stops the run naming the usage limit, not the environment, when a limit stops the repair",
      async () => {
        const repo = brokenRepo("run-command-breaker-limited-", BROKEN_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(rateLimited) } });

        expect(exitCode).toBe(EXIT.escalated);
        expect(stdout.trimEnd().split("\n").at(-1)).toBe(
          "The repair could not run because the AI service is limiting requests. Stopping the run. 2 of 3 tasks were waiting on this and need your attention; 0 had already finished, 1 is still queued.",
        );
        expect(stdout).not.toContain("Couldn't fix it");

        const runFile = await theRunFile(repo);
        expect(runFile.outcome).toMatchObject({ kind: "escalated", cause: "usage_limit", reason: expect.stringContaining("the AI service is limiting requests") });
        expect(ofType(runFile.history, "repair_dispatch")).toHaveLength(1);
      },
      RUN_TIMEOUT * 2,
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/breaker.test.ts src/cli/queue.test.ts src/cli/status-command.test.ts src/cli/run-command.test.ts -t "usage limit|names the cause, every task held|gives the trip, the run's repair limit"`
Expected: FAIL (`stoppedByLimit` is not exported; `limit` is not a key of `run_escalated`, of a trip, or an argument of `environmentGaveUp`).

- [ ] **Step 3: Implement**

`src/schema.ts`: the `run_escalated` entry and the escalated outcome become:

```ts
  // `limit` is set when a usage limit, not the environment, is why the run stopped.
  z.object({ t: z.literal("run_escalated"), reason: z.string().min(1), limit: UsageLimit.optional() }),
```

```ts
  // The run stopped and no task caused it: its shared environment could not be repaired, or a usage limit stopped the repair.
  z.object({ kind: z.literal("escalated"), cause: z.enum(["shared_environment", "usage_limit"]), reason: z.string().min(1), at: z.string() }),
```

(`UsageLimit` must be declared above `RunEntry`; move its declaration up if Task 5 placed it below.)

`src/breaker.ts`: add `UsageLimit` to the type import from `./schema.js` and import `USAGE_LIMIT_WORDS` (a value) from `./ports.js`. Then:

- `Trip` gains, after `reason`:

```ts
  /** The usage limit that stopped the repair, when that, not the environment, is why the run gave up. */
  limit: UsageLimit | null;
```

- in `tripsOf`, the `breaker_degraded` case pushes `limit: null` with the other initial fields, and the `run_escalated` case adds `open.limit = entry.limit ?? null;`
- add beside `couldNotRepair`:

```ts
export const stoppedByLimit = (limit: UsageLimit): string =>
  `the repair could not run because ${USAGE_LIMIT_WORDS[limit]}; no task caused this`;
```

- `giveUp` becomes:

```ts
  async function giveUp(reason: string, limit?: UsageLimit): Promise<never> {
    // Set before the write, so a request or hold arriving while it is written is refused, not queued on a dead repair.
    gaveUp = reason;
    await record({ t: "run_escalated", reason, ...(limit ? { limit } : {}) });
    throw new RunHalted(reason);
  }
```

- in `repair()`, immediately after the `if (terminus.status === "completed") { ... }` block and before the escalate/`notRun` check, add:

```ts
      // A usage limit says nothing about the environment, and the next attempt would meet the same limit:
      // stop now, and say that, rather than spend the run's repair limit and report the environment unfixable.
      if (terminus.status === "incomplete" && terminus.limit) return giveUp(stoppedByLimit(terminus.limit), terminus.limit);
```

`src/cli/queue.ts`: import `UsageLimit` (type) from `../schema.js` and `USAGE_LIMIT_WORDS` from `../ports.js`. `environmentGaveUp` becomes:

```ts
/** What a run of several at once says when it gives up on the environment its tasks share, or when a usage limit stops its repair. */
export function environmentGaveUp(attempts: number, { waiting, finished, queued }: ListStandings, of: number, limit: UsageLimit | null = null): string {
  const tries = `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
  const opening = limit === null ? `Couldn't fix it after ${tries}.` : `The repair could not run because ${USAGE_LIMIT_WORDS[limit]}.`;
  const were = waiting === 1 ? "was waiting on this and needs" : "were waiting on this and need";
  const is = queued === 1 ? "is" : "are";
  return `${opening} Stopping the run. ${waiting} of ${of} tasks ${were} your attention; ${finished} had already finished, ${queued} ${is} still queued.`;
}
```

and in `stopForEnvironment` replace the `setRunOutcome` and `ctx.report.note` lines with:

```ts
  const limit = trip?.limit ?? null;
  await setRunOutcome(dir, { kind: "escalated", cause: limit === null ? "shared_environment" : "usage_limit", reason, at: new Date().toISOString() });
  ctx.report.note(environmentGaveUp(repairsUsed(history), listStandings(await allRuns(repoPath), tasks), tasks.length, limit));
```

Extend its doc comment's first sentence to "End a run that gave up on its shared environment, or whose repair a usage limit stopped: write its outcome, naming which was the cause, ...".

`src/cli/status-command.ts`: import `USAGE_LIMIT_WORDS` from `../ports.js`; change the document's field to

```ts
  cause: Extract<RunOutcome, { kind: "escalated" }>["cause"] | null;
```

and in `environmentNarration` replace the `opening` constant and the "Once it is fixed" line with:

```ts
  const limit = trip.ended === "gave_up" ? trip.limit : null;
  const limitWords = limit === null ? "" : USAGE_LIMIT_WORDS[limit];
  const opening =
    limit !== null
      ? `${limitWords.charAt(0).toUpperCase()}${limitWords.slice(1)}, so the run stopped before it could repair the shared environment; no task caused this.`
      : trip.ended === "gave_up"
        ? `The shared environment could not be fixed after ${trip.repairs.length} ${trip.repairs.length === 1 ? "attempt" : "attempts"}, so the run stopped; no task caused this.`
        : `${view.breaker === "REPAIRING" ? "The shared environment is being repaired" : "Something in the shared environment looks broken"}: any task about to check or hand off its work is held until it is fixed.`;
```

```ts
    ...(trip.ended === "gave_up" ? [`Once ${limit === null ? "it is fixed" : "the limit no longer applies"}, \`delivery run\` carries the held tasks on.`] : []),
```

`README.md`: in the several-at-once section, after the sentence ending "its record says the shared environment, not any task, was the cause." add: " If a usage limit stops the repair, the run stops at once and says that instead (\"the AI service is limiting requests\" or \"the spending limit has been reached\"); its record names the limit as the cause." In the status section's `--json` sentence, change "why it stopped and whether the shared environment was the cause (`reason`, `cause`)" to "why it stopped and whether the shared environment or a usage limit was the cause (`reason`, `cause`)".

Append to the changeset:

```markdown

If a usage limit stops the run's one repair, the run stops at once rather than spending its repair limit, and says the limit, not the environment, was why. The run's record and `delivery status --json` give `cause: "usage_limit"`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/breaker.test.ts src/cli/queue.test.ts src/cli/status-command.test.ts && npx vitest run src/cli/run-command.test.ts -t "when the shared environment breaks" && npx tsc --noEmit`
Expected: PASS, no type errors. If `tsc` or a test reports another exact-equality `Trip` literal missing `limit` (find them with `grep -rn 'ended: "' src tests`), add `limit: null` to it.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/breaker.ts src/breaker.test.ts src/cli/queue.ts src/cli/queue.test.ts src/cli/status-command.ts src/cli/status-command.test.ts src/cli/run-command.test.ts README.md .changeset/tell-a-one-off-check-error-from-a-shared-one.md
git commit -m "Stop the run naming the limit when a usage limit stops the repair

A repair session stopped by a rate or spend limit was retried until the run's
repair limit was spent, then reported as an environment that could not be
fixed: a usage limit described as a broken project. The run now stops at the
first such repair, records the limit as the cause, and says so in the live
output, in status and in --json.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Show a helper that comes and goes in the example, its guide and its test ✅ DONE (deliver-slice)

This is the fixture's own drift test ("one fixture, one guide, one test"), not the slice's UAT: it checks that what the guide shows is what the command prints.

**Files:**
- Modify: `examples/shared-environment-example/check.mjs`, `examples/shared-environment-example/README.md`
- Modify: `docs/shared-environment.md`
- Modify: `tests/shared-environment-guide.test.ts`
- Modify: `.changeset/tell-a-one-off-check-error-from-a-shared-one.md`

**Interfaces:**
- Consumes: the behaviour of Tasks 3 and 4 through the compiled command.
- Produces: the example's check honours an optional `shared/outage.json` (`{ "tasks": <n>, "checks": <m> }`): while it exists, the first `n` copies to check their work each find the helper does not answer `m` times, then it answers. The baseline never consults it. The file is created by the person trying it out; the example ships without one.

- [ ] **Step 1: Write the failing tests**

In `tests/shared-environment-guide.test.ts`:

- add `writeFileSync` to the `node:fs` import;
- extend `STEP` with

  ```ts
    comesAndGoes: "## 5. A helper that comes and goes",
    lookBack: "## 6. Look back at the repair",
  ```

- in the describe "the shared-environment example", add:

  ```ts
    it("does not answer the first copies to check their work while an outage is set, then answers again", async () => {
      const copy = scratch("shared-environment-outage-");
      const other = scratch("shared-environment-outage-other-");
      cpSync(EXAMPLE, copy, { recursive: true });
      cpSync(EXAMPLE, other, { recursive: true });
      writeFileSync(join(copy, "shared", "outage.json"), JSON.stringify({ tasks: 1, checks: 2 }));
      const check = (await import(pathToFileURL(join(copy, "check.mjs")).href)).default;

      // The starting point is never affected: only a check of finished work is.
      expect((await check.baseline({ worktreePath: copy })).status).toBe("PASS");
      expect(await check.check({ worktreePath: copy })).toMatchObject({ status: "ERROR", detail: expect.stringContaining("did not answer") });
      expect((await check.check({ worktreePath: copy })).status).toBe("ERROR");
      expect((await check.check({ worktreePath: copy })).status).toBe("PASS");
      // One copy was to be affected, and one has been.
      expect((await check.check({ worktreePath: other })).status).toBe("PASS");
    });
  ```

- move the body of the existing `beforeAll` into a function both guide describes use, placed above the describe "docs/shared-environment.md":

  ```ts
  /** A fresh copy of the example as step 1 sets it up, and an agent whose every session answers "done" and writes a small file. */
  async function freshCopy(prefix: string): Promise<{ repo: string; env: NodeJS.ProcessEnv }> {
    const repo = scratch(prefix);
    cpSync(EXAMPLE, repo, { recursive: true });
    git(repo, ["init", "-b", "main"]);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "start"]);
    const script: MockScript = { expectations: [{ effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "done" } }] };
    const scriptPath = join(scratch("shared-environment-script-"), "mock.json");
    await writeMockScript(scriptPath, script);
    return { repo, env: { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("shared-environment-state-") } };
  }
  ```

  and the existing `beforeAll` becomes `beforeAll(async () => { ({ repo, env } = await freshCopy("shared-environment-guide-")); });`

- add at the end of the file:

  ```ts
  describe("docs/shared-environment.md, when the helper comes and goes", () => {
    let repo: string;
    let env: NodeJS.ProcessEnv;

    beforeAll(async () => {
      ({ repo, env } = await freshCopy("shared-environment-outage-guide-"));
    });

    const shown = (section: string) => outputBlock(sectionOf(guide, section)).filter((line) => line !== "…");

    it("treats the second task to hit it as a shared problem, repairs once and finishes the list", () => {
      // The guide's own command: echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json
      expect(sectionOf(guide, STEP.comesAndGoes)).toContain(`echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json`);
      writeFileSync(join(repo, "shared", "outage.json"), '{ "tasks": 2, "checks": 4 }\n');

      const { stdout, status } = runDelivery(["run"], { cwd: repo, env });

      expect(status).toBe(EXIT.ok);
      for (const line of shown(STEP.comesAndGoes)) expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
      expect(stdout.split("\n").filter((line) => line.startsWith("  - repairing"))).toHaveLength(1);
    }, RUN_TIMEOUT);

    it("shows the repair when looking back", () => {
      const { stdout } = runDelivery(["status"], { cwd: repo, env });
      for (const line of shown(STEP.lookBack)) expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx vitest run tests/shared-environment-guide.test.ts`
Expected: FAIL (the check ignores `shared/outage.json`; the guide has no section 5 or 6). The existing tests in the file still pass.

- [ ] **Step 3: Implement**

`examples/shared-environment-example/check.mjs` becomes:

```js
// This project's check. It lives in the repository, outside every task's copy,
// and relies on a shared helper beside it: shared/helper.json names the command
// that runs the tests. Every task's check reads the same helper, so if it goes
// missing, no task can check its work: the shared environment is broken.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = join(dirname(fileURLToPath(import.meta.url)), "shared");
const HELPER = join(SHARED, "helper.json");

// A helper that comes and goes, to try out: while shared/outage.json exists,
// holding { "tasks": 2, "checks": 4 }, the helper does not answer the first
// two copies that check their work, four times each, and then answers again.
const OUTAGE = join(SHARED, "outage.json");
const refused = new Map();

function outOfReach(worktreePath) {
  if (!existsSync(OUTAGE)) return false;
  const { tasks, checks } = JSON.parse(readFileSync(OUTAGE, "utf-8"));
  const times = refused.get(worktreePath) ?? 0;
  if (times >= checks || (times === 0 && refused.size >= tasks)) return false;
  refused.set(worktreePath, times + 1);
  return true;
}

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

async function check(context) {
  if (outOfReach(context.worktreePath)) {
    return { status: "ERROR", assertions: [], detail: `the shared helper ${HELPER} did not answer, so the check cannot run` };
  }
  return measure(context);
}

export default { baseline: measure, check };
```

`examples/shared-environment-example/README.md`: add a final sentence to the first paragraph: "The check can also act out a helper that comes and goes (`shared/outage.json`), to show how a run tells one task's hiccup from a problem every task shares."

`docs/shared-environment.md`: replace the section "## When the repair can fix it" (heading and paragraph) with the following, at the end of the file:

````markdown
## 5. A helper that comes and goes

A helper that is missing from the start is found before any task begins, so the run treats it as shared straight away. One that fails now and then, while a task's finished work is being checked, is harder to tell from a one-off hiccup. The run waits for a second, different task to hit it before calling it shared.

The example's check can act this out. Start again from a fresh copy of the example (step 1), then tell the check that the helper should not answer the first two tasks that check their work, four times each:

```bash
echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json
delivery run
```

```text
Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.
Starting run <run-id>: 4 tasks, up to 2 at once
…
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
```

Four is one check and the three free re-checks every task gets (`budgets.gateError`). What happens:

1. The first task to run out of re-checks is on its own. Nothing run-wide is said and no other task is held: it repairs its own check on its own limit, exactly as a task run by itself would.
2. When a second, different task runs out too, that is two tasks with the same problem. The run says the shared environment looks broken, holds checks and hand-offs, repairs once and carries on.
3. The same task erroring again does not count twice, and once a repair has worked the count starts afresh.

With `"tasks": 1` only one task is affected: it sorts itself out and you see no run-wide message at all.

A session stopped by a usage limit is never counted here. It is reported as what it is: "the AI service is limiting requests" or "the spending limit has been reached".

## 6. Look back at the repair

```bash
delivery status
```

```text
Run <run-id>, started <when>: 4 tasks, up to 2 at once
Environment: healthy (repaired once during this run)
4 done
```

The environment line says the run repaired it. `delivery status <run-id> --json` has the detail under `trips`: for this run, `cause.surfaceIds` names the two tasks whose check kept erroring. Remove `shared/outage.json` when you have finished.

## When the repair can fix it

If what broke is something the repair can reach (a file inside a task's own copy), it says "Fixed. Resuming.", held tasks carry on, and `delivery status` shows "Environment: healthy (repaired once during this run)". The shared environment is back in use, and your tasks finish where they left off.
````

Also change the guide's second paragraph ("This guide walks you through a concrete example. ...") by appending: " The last two steps show a helper that comes and goes, and how the run tells one task's hiccup from a problem every task shares."

Append to the changeset:

```markdown

The shared-environment example and its guide, `docs/shared-environment.md`, now also show a helper that comes and goes: one task's error handled by that task, a second task's making it a shared repair.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && npx vitest run tests/shared-environment-guide.test.ts`
Expected: PASS (all tests in the file, slice 5's included).

- [ ] **Step 5: Commit**

```bash
git add examples/shared-environment-example/check.mjs examples/shared-environment-example/README.md docs/shared-environment.md tests/shared-environment-guide.test.ts .changeset/tell-a-one-off-check-error-from-a-shared-one.md
git commit -m "Show a helper that comes and goes in the shared-environment example

Telling a one-off check error from a shared one cannot be tried by hand: under
the scripted agent nothing a person does lands between a task's start and its
check. The example's check gains a switch that makes the helper not answer the
first tasks to check their work, counted per copy so every run tells the same
story, and the guide and its test walk through what the run then does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Where |
|---|---|
| One task exhausting its check-error retries, no other having done so since last healthy, does not affect any other task | Task 2 ("is the task's own business ...": no trip, no hold); Task 3 (surface repairs its own check; integration "leaves one task's errors to that task") |
| A second, different task doing so in that window puts the run into the broken-environment state and triggers the single repair | Task 2 ("is shared once a second, different task reports it"); Task 3 (integration "treats a second, different task hitting it as the shared environment") |
| The same task erroring twice counts once | Task 1 (`signalsSinceHealthy`); Task 2 ("counts the same task once"); Task 3 ("reports each new round of errors, and stops on its own limit while it stays alone") |
| After a successful repair, earlier evidence no longer counts | Task 1 ("forgets every report made before the environment was last healthy"); Task 2 ("no longer counts earlier reports once a repair has worked") |
| A session stopped by a rate or spend limit is described as that, never as the shared environment being broken, and does not count towards the threshold | Task 5 (wording at the session seam; integration: no `gate_error_signal`, no trip, no "shared environment" in output); Task 6 (a limit stopping the run's repair is named as the cause in live output, status and `--json`) |
| Operational note: threshold two, no window, reproducible under the mock, marked for retuning | Task 1 (`SHARED_ERROR_THRESHOLD` with its `ponytail:` comment); Task 3 and Task 7 (per-copy counting fixtures) |
| UAT support: the guide describes making the helper intermittently unavailable; status shows the repair | Task 7 (guide sections 5 and 6); Task 4 (environment line) |

No gaps.

**2. Placeholder scan:** every code step carries its code; every doc step carries its text. The one conditional instruction (Task 6, Step 4: add `limit: null` to any further exact-equality `Trip` literal) names the exact edit and the command that finds the sites.

**3. Type consistency:** `CheckErrorReport { surfaceId, key: string }` and `CheckErrorAnswer = "shared" | "alone"` (Task 2) are used unchanged in Task 3's port, fake coordinator and surface. `RepairRequest { surfaceId, reason }` (Task 3) matches every `requestRepair` call in Tasks 3 and 6. `UsageLimit` / `USAGE_LIMIT_WORDS` / `Terminus.limit` (Task 5) are used unchanged in Task 6 (`stoppedByLimit`, `giveUp(reason, limit?)`, `Trip.limit`, `environmentGaveUp(..., limit)`). `signalsSinceHealthy` and `SHARED_ERROR_THRESHOLD` (Task 1) are the names Task 2 uses. `rateLimited` (Task 5) is the fixture Task 6 uses. Task 2's breaker tests call `requestRepair` with `key: null` (still required then); Task 3's `sed` removes it from all of them, and Task 6's new test is written without it.

**4. Right-choice re-audit**

| Decision | Pre-planning choice | What the plan actually does | Easy or Right? |
|---|---|---|---|
| Post-task `fix_the_gate` in a supervised run | Aggregate signal, not a direct trip | Task 3 routes it through `reportCheckErrors`; pre-task stays direct | Right |
| What a task told "alone" does | Its own repair on its own limit | Task 3 `dispatchOwnRepair`, the single-task edge unchanged | Right |
| Where the coordinator is consulted | Only where a task learns its check cannot run | Task 3: `preGating` and the `triage` tail only; own-repair tails pinned by a test | Right |
| Dead `key` on `RepairRequest` | Remove it | Task 3 removes it and moves crash safety to the keyed report | Right |
| Threshold | One named constant, marked for retuning | Task 1 | Right |
| Evidence and trip state | Fold of the run file, no new stored counter | Tasks 1 and 2 | Right |
| Limit classification | Typed signals and machine identifiers, never prose | Task 5 `usageLimitOf`, with a test that prose is not matched | Right |
| Limit wording | One table | `USAGE_LIMIT_WORDS`, used by the seam, the breaker, the queue note and status | Right |
| A limit stopping the run's repair | Stop at once, name the limit as the cause | Task 6 | Right |
| Backoff for limited task sessions | Deferred with the governor (spec §9) | Not built; `ponytail:` comment names the upgrade path | Deliberate simplification, recorded |
| Demonstrating an intermittent helper | Deterministic per-copy switch in the fixture | Task 7 | Right |
| Buy-vs-build lens | Reuse breaker folds, the one repair, the task's own repair edge, SDK types | No new dependency, no new role, no new persistence | Honoured |
| Operability lens | Reproducible under the mock; diagnosable from status | Integration tests and the guide run under the mock; `trips[].cause` and the environment line | Honoured |

**5. Scaffolding drift:** every item under Scaffolding Impact has its task (control-flow doc, README several-at-once paragraph and `budgets` row → 3; README status sentence → 4; testing guide and agent-interface → 5; README `cause` sentences → 6; shared-environment guide, example README → 7; changeset → 3 to 7; schema comment → 1). Read from the behaviour: "a supervised task never repairs its own check" (control-flow doc, README) → Task 3; "a repaired run says only `Environment: healthy`" (README, guide) → Tasks 4 and 7; "a scripted `fail` reads as a session that ended in an error" (testing guide, agent-interface) → Task 5; "`cause` is the shared environment" (README) → Task 6. No new command, flag, environment variable, dependency or build step is introduced.
