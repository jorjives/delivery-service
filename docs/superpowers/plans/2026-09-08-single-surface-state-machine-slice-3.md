# Single-Surface State Machine — Slice 3: Route a Setback Back Into the Loop Instead of Giving Up

> **Status:** ✅ Complete — 2026-09-08 — `e9fad5b`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Goal:** Give the surface its `TRIAGE` edge and a deterministic triage router, so a failed gate, an errored gate, a rejected close, or a worker's "stuck, but a retry might help" signal is routed back into another worker attempt, a gate repair, or another close attempt instead of escalating on the first setback.

**Architecture:** Three additions on top of the machine Slices 1 and 2 already ship. (1) `src/router.ts` holds the deterministic `TriagePort` — a pure per-trigger lookup that returns the helpful verdict when the trigger's budget is under cap and `escalate` when it is at cap. (2) `src/surface.ts` gains a `TRIAGE` edge that reads the trigger off the log tail, calls the port, writes a stub artefact ref, appends the `triage` entry (which *is* the budget burn), and routes the verdict through the `triageState` table `case-file.ts` already owns. (3) `GATE_MAINTENANCE` learns its post-task entry: dispatching from a `fix_the_gate` triage tail, and resolving a completed repair to a re-check against the existing baseline rather than a re-baseline. `src/run-gate.ts`'s failure-ref key is widened first so a re-checked attempt cannot overwrite refs a live history entry still points at.

**Tech Stack:** TypeScript (ESM, `node:` builtins), Zod schemas, Vitest, `tsx` for demos.

## Global Constraints

- Node `>= 22`; TypeScript ESM with `.js` import specifiers on every relative import.
- Every gate that matters runs through `make verify` = `npm ci && npm run lint && npm test`; `npm run lint` is `eslint . && tsc --noEmit`, and `tsc` covers `src/*.test.ts`, so test files must typecheck.
- **Buy-vs-build:** no new dependencies. Zod is the only schema library, `node:child_process`/`node:fs` the only process and filesystem surface. The deterministic router is not a rules engine — it is a lookup table.
- **Reuse over re-derive:** state mapping stays in `case-file.ts`'s `deriveStateFromEntry` / `triageState` table, and budget counts stay in `deriveBudgetsFromLog`. No edge may re-implement either.
- **Budgets are log-derived, never incremented.** `cursor.budgets[*].used` is a stale denormalisation; only `max` is read from the cursor. The single write an edge performs (a `triage` entry, a `dispatch` entry) *is* the burn.
- **Operability/DX:** every error names the state and the attempted edge (`IllegalStateTransition`), never a raw stack trace — the baseline set in Slice 1. Each slice ships a runnable demo script (`npm run demo:surface-slice-N`) whose printed output is the harness extender's UAT surface, matching Slices 1 and 2.
- Slice 3 carries no explicit Build note or Operational note of its own; it inherits the item-wide ones above.

## Scaffolding Impact

- `package.json` `scripts` — new `demo:surface-slice-3` entry, the run story for this slice's UAT → added in Task 5.
- `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md` — the `TriagePort` router table's `worker_escalate (exhaustion)` row and the paragraph defending it describe a behaviour this slice's acceptance criteria contradict (see Task 2). The spec's description of the router is stale the moment the router is built → corrected in Task 2, in the same commit as the router it describes.
- `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md` — the `TRIAGE` edge says `fix_the_gate` appends the repair dispatch "right here"; Tasks 3 and 4 leave that dispatch solely to the `GATE_MAINTENANCE` edge → corrected in Task 4, in the same commit as the edge it describes.
- `src/index.ts` — `deterministicRouter` is this item's built-in `TriagePort`, the counterpart of the already-exported `noopCloser` → exported in Task 2.
- `src/run-gate.ts`'s `ponytail:` ceiling comment documents the ref-key collision this slice removes → deleted in Task 1 alongside the fix.
- `src/surface.test.ts:99` asserts `advance` throws on a TRIAGE position — a pre-slice-3 expectation the edge makes obsolete → deleted in Task 3.

No README, CONTRIBUTING or embedded-skill text describes the triage router, the gate ref-key scheme, or the demo list; `README.md` and `CONTRIBUTING.md` were checked and reference no `demo:*` script by name.

---

## Task 1: Widen the gate-failure ref key with a re-check counter ✅ DONE (deliver-slice)

The post-task repair path re-checks the **same** attempt against the pinned baseline. Today `runCheck` keys failure refs `gate-<attempt>-<index>`, so the second check for an attempt overwrites the ref files the first check's `gate` entry still points at — triage would read another check's detail. Widening the key to `gate-<attempt>-<recheckCount>-<index>` removes the collision before any edge can reach it.

**Files:**
- Modify: `src/run-gate.ts:41-88`
- Test: `src/run-gate.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `runCheck(dir: string, worktreePath: string, attempt: number): Promise<{ report: GateReport; delta: DeltaResult }>` — signature unchanged. Failure refs are now keyed `gate-<attempt>-<recheckCount>-<index>`, where `recheckCount` is the number of `gate` entries already in the log for that `attempt`.

- [ ] **Step 1: Write the failing test**

Add to `src/run-gate.test.ts`, inside the existing `describe("runCheck", ...)` block:

```ts
  it("keys a re-check of the same attempt separately from the first check", async () => {
    await tap(GREEN);
    await recordBaseline(surfaceDir, worktree);

    await tap("1..2\nok 1 - alpha\nnot ok 2 - beta\n");
    await runCheck(surfaceDir, worktree, 1);

    await tap("1..2\nnot ok 1 - alpha\nok 2 - beta\n");
    await runCheck(surfaceDir, worktree, 1);

    const { history } = await load(surfaceDir);
    const gates = history.filter((e) => e.t === "gate");
    expect(gates).toHaveLength(2);

    const [first, second] = gates as Extract<typeof gates[number], { t: "gate" }>[];
    expect(first.newFailures[0].detailRef).toBe("gate-1-0-0");
    expect(second.newFailures[0].detailRef).toBe("gate-1-1-0");

    // The first check's detail must still be readable and still be its own.
    expect(await readRef(surfaceDir, first.newFailures[0].detailRef))
      .toMatchObject({ id: "2 - beta" });
    expect(await readRef(surfaceDir, second.newFailures[0].detailRef))
      .toMatchObject({ id: "1 - alpha" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/run-gate.test.ts -t "keys a re-check of the same attempt"`
Expected: FAIL — both refs come back as `gate-1-0`, and the first ref's contents have been overwritten with `1 - alpha`.

- [ ] **Step 3: Write minimal implementation**

In `src/run-gate.ts`, change the `load` destructure at the top of `runCheck` to also take the history:

```ts
  const { header, history } = await load(dir);
```

Then replace the `ponytail:` comment block and the `newFailures` mapping (currently `src/run-gate.ts:64-76`) with:

```ts
  // Keyed by attempt AND by how many times this attempt has already been
  // checked: a gate-maintenance repair re-checks the SAME attempt against the
  // immutable baseline, and a bare `gate-<attempt>-<index>` key would overwrite
  // the ref files the earlier check's `gate` entry still points at.
  const recheckCount = history.filter((e) => e.t === "gate" && e.attempt === attempt).length;

  const newFailures: GateEntry["newFailures"] = await Promise.all(
    failures.map(async (failure, index) => ({
      id: failure.id,
      detailRef: await writeRef(dir, `gate-${attempt}-${recheckCount}-${index}`, failure),
    })),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/run-gate.test.ts`
Expected: PASS — the new test plus every pre-existing `runCheck` test. If an older test asserts a literal `gate-1-0` ref id, update that literal to `gate-1-0-0`; the key scheme is the intended behaviour, the old literal is the stale expectation.

- [ ] **Step 5: Commit**

```bash
git add src/run-gate.ts src/run-gate.test.ts
git commit -m "Key gate failure refs by re-check count as well as attempt

A gate-maintenance repair re-checks the same attempt against the pinned
baseline, so the previous gate-<attempt>-<index> key overwrote ref files
that the earlier check's history entry still pointed at. Widening the key
removes the collision before the post-task repair path can reach it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The deterministic triage router ✅ DONE (deliver-slice)

The item ships the deterministic half of `TriagePort` only: a per-trigger lookup with no agent call and no brief synthesis. Its whole rule is "if the trigger's budget is under cap, return the verdict that helps; otherwise escalate."

**Files:**
- Create: `src/router.ts`
- Test: `src/router.test.ts`
- Modify: `src/index.ts` (re-export `deterministicRouter`, alongside `noopCloser`)
- Modify: `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md` (the `worker_escalate (exhaustion)` router row, the paragraph defending it, and the `TriagePort` bullet in Decisions)

**Interfaces:**
- Consumes: `TriagePort`, `TriageInput`, `TriageVerdict` from `src/ports.ts`; `BudgetPopulation`, `BudgetSet` from `src/schema.ts`.
- Produces: `export const deterministicRouter: TriagePort` — the value Task 3's tests and Task 5's demo pass as `ports.triage`.

**Spec correction this task carries.** The design spec's router table says `worker_escalate (exhaustion)` returns `escalate` both under cap and at cap, while naming `correction` as the budget it checks — a budget check with no consequence. Slice 3's AC ("a worker's 'I'm stuck, but retrying might help' signal is retried by the deterministic router as another worker attempt, up to its own cap") and Slice 4's AC ("a worker that always reports 'stuck, try again' exhausts the **correction** budget at exactly its cap and escalates") both require `reroute` under cap. The slice scope is the coherent, later artefact and is what this plan implements; the spec's row and its defending paragraph are corrected to match in this task's commit.

- [ ] **Step 1: Write the failing test**

Create `src/router.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deterministicRouter } from "./router.js";
import type { TriageInput } from "./ports.js";
import type { BudgetSet, CaseFile } from "./schema.js";

const fresh: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

/** The router reads only `remainingBudgets`; the case file is inert padding. */
const caseFile = { history: [] } as unknown as CaseFile;

function input(
  trigger: TriageInput["trigger"],
  budgets: BudgetSet = fresh,
  category?: TriageInput["category"],
): TriageInput {
  return { trigger, caseFile, remainingBudgets: budgets, ...(category ? { category } : {}) };
}

function atCap(population: keyof BudgetSet): BudgetSet {
  return { ...fresh, [population]: { used: fresh[population].max, max: fresh[population].max } };
}

describe("deterministicRouter", () => {
  it("routes a gate failure back to another worker attempt while corrections remain", async () => {
    expect(await deterministicRouter.triage(input("gate_fail"))).toMatchObject({
      verdict: "reroute",
    });
  });

  it("routes a gate error to a gate repair while repair budget remains", async () => {
    expect(await deterministicRouter.triage(input("gate_error"))).toMatchObject({
      verdict: "fix_the_gate",
    });
  });

  it("routes a close failure back to another close attempt while close budget remains", async () => {
    expect(await deterministicRouter.triage(input("close_failure"))).toMatchObject({
      verdict: "retry_close",
    });
  });

  it("retries an exhaustion-class worker escalate as another worker attempt", async () => {
    expect(await deterministicRouter.triage(input("worker_escalate", fresh, "exhaustion")))
      .toMatchObject({ verdict: "reroute" });
  });

  it("never overrules an authority-class worker escalate, even with budget to spare", async () => {
    expect(await deterministicRouter.triage(input("worker_escalate", fresh, "authority")))
      .toMatchObject({ verdict: "escalate" });
  });

  it.each([
    ["gate_fail", "correction"],
    ["gate_error", "gateMaintenance"],
    ["close_failure", "close"],
    ["worker_escalate", "correction"],
  ] as [TriageInput["trigger"], keyof BudgetSet][])(
    "escalates %s once its %s budget is at cap",
    async (trigger, population) => {
      const verdict = await deterministicRouter.triage(input(trigger, atCap(population)));
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toContain(population);
    },
  );

  it("reads only the budget its trigger owns", async () => {
    // Every population except `correction` is spent; a gate failure still reroutes.
    const spent: BudgetSet = {
      correction: { used: 0, max: 3 },
      gateError: { used: 3, max: 3 },
      gateMaintenance: { used: 2, max: 2 },
      terminus: { used: 5, max: 5 },
      close: { used: 3, max: 3 },
    };
    expect(await deterministicRouter.triage(input("gate_fail", spent))).toMatchObject({
      verdict: "reroute",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router.test.ts`
Expected: FAIL — `Cannot find module './router.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/router.ts`:

```ts
import type { TriageInput, TriagePort, TriageVerdict } from "./ports.js";
import type { BudgetPopulation } from "./schema.js";

/**
 * The whole deterministic rule, one row per trigger: the budget that gates the
 * helpful verdict, and the verdict itself. At cap, every trigger escalates.
 *
 * `gateError` is deliberately absent. It is reserved for a future bounded,
 * agent-free re-check fast path, which needs a `TriageVerdict` case this item
 * does not add; a gate that could not run is routed to `GATE_MAINTENANCE` on
 * the `gateMaintenance` budget, exactly like the pre-task case.
 */
const rules: Record<
  TriageInput["trigger"],
  { budget: BudgetPopulation; helpful: TriageVerdict["verdict"] }
> = {
  gate_fail: { budget: "correction", helpful: "reroute" },
  gate_error: { budget: "gateMaintenance", helpful: "fix_the_gate" },
  worker_escalate: { budget: "correction", helpful: "reroute" },
  close_failure: { budget: "close", helpful: "retry_close" },
};

/**
 * This item's built-in `TriagePort`: the deterministic router only — no agent
 * call, no brief or escalation-packet synthesis (Item 5's concern). It reads
 * nothing but the trigger, the escalate category, and the log-derived budgets
 * the caller computed immediately before calling it.
 */
export const deterministicRouter: TriagePort = {
  triage(input: TriageInput): Promise<TriageVerdict> {
    // An authority limit is the worker's own judgement that no retry can help.
    // Nothing in a lookup table is entitled to overrule it, and no budget makes
    // it retryable — this is checked before the table, not inside it.
    if (input.trigger === "worker_escalate" && input.category === "authority") {
      return Promise.resolve({
        verdict: "escalate",
        rationale: "authority limit: the worker reported no retry can resolve this",
      });
    }

    const { budget, helpful } = rules[input.trigger];
    const { used, max } = input.remainingBudgets[budget];

    if (used >= max) {
      return Promise.resolve({
        verdict: "escalate",
        rationale: `${input.trigger}: ${budget} budget exhausted (${used}/${max})`,
      });
    }

    return Promise.resolve({
      verdict: helpful,
      rationale: `${input.trigger}: ${helpful} (${budget} ${used}/${max})`,
    });
  },
};
```

- [ ] **Step 4: Export it from the package surface**

`src/index.ts` already exports `noopCloser`, this item's built-in `CloserPort`.
The router is the built-in `TriagePort` and belongs on the same surface — a
consumer wiring `SurfacePorts` needs both. Add to `src/index.ts`, next to the
`noopCloser` line:

```ts
export { deterministicRouter } from "./router.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/router.test.ts && npx tsc --noEmit`
Expected: PASS, and a clean typecheck.

- [ ] **Step 6: Correct the design spec's router table**

In `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`, in the `TriagePort` router table, replace the `worker_escalate` (exhaustion) row:

```
| `worker_escalate` (exhaustion) | `correction` | `escalate` (this item never overrules downward — that judgement needs an agent, Item 5) | `escalate` |
```

with:

```
| `worker_escalate` (exhaustion) | `correction` | `reroute` | `escalate` |
```

Then replace the paragraph that begins "The `worker_escalate` (exhaustion) row is the one place this item is strictly more conservative than the target design:" and runs to "...is exactly the behaviour Item 5 replaces." with:

```
An exhaustion-class escalate is the worker saying "I stopped, but another
attempt might get there" — the one escalate class a retry can resolve — so the
router spends a `correction` and reroutes, exactly as it does for a gate
failure, and escalates once that budget is at cap. This is a bounded,
judgement-free rule: what Item 5's real triage agent adds is the judgement to
tell an exhaustion worth retrying from one that is not, and to synthesise a
sharpened brief for the retry rather than re-dispatching the same one.
An authority-class escalate is never rerouted at any budget.
```

Finally, in the Decisions section's `TriagePort` bullet, the parenthetical
listing what Item 5 adds is stale for the same reason. Replace:

```
  half (overruling an exhaustion-class escalate downward, sharpened briefs)
```

with:

```
  half (judging *which* exhaustion-class escalates are worth rerouting,
  sharpened briefs)
```

- [ ] **Step 7: Commit**

```bash
git add src/router.ts src/router.test.ts src/index.ts docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md
git commit -m "Add the deterministic triage router

The item's built-in TriagePort: one lookup row per trigger, returning the
verdict that helps while that trigger's budget is under cap and escalating
at cap. Corrects the spec's worker_escalate (exhaustion) row, which named
correction as the budget checked while returning escalate either way — the
slice scope requires a reroute under cap, and Slice 4 measures the
correction budget being exhausted by exactly that path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The TRIAGE edge ✅ DONE (deliver-slice)

`advance` currently falls through to `IllegalStateTransition` when the surface reaches `TRIAGE`. This task builds the edge: read the trigger off the log tail, derive budgets, call the port, write the stub artefact, append the `triage` entry (which is the `correction` / `close` burn), and route the verdict through `case-file.ts`'s existing `triageState` table.

`fix_the_gate` routes to `GATE_MAINTENANCE` and stops there — this task does not dispatch the repair. Task 4 owns the dispatch, on the `GATE_MAINTENANCE` edge that already exists to recover exactly that crash window.

**Files:**
- Modify: `src/surface.ts` (add the `triage` edge and its trigger derivation; add `case "TRIAGE"` to `advance`)
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `deterministicRouter` from `src/router.ts` (Task 2), for tests; the edge itself calls `ports.triage.triage`. Existing `src/surface.ts` internals: `escalate`, `terminate`, `workerAttempt`, `worktreeOf`, and the imports `logTail`, `deriveBudgetsFromLog`, `deriveStateFromEntry`, `appendEntry`, `updateCursor`, `writeRef` from `./case-file.js`.
- Produces: `advance(dir, location, ports)` now handles `TRIAGE`, appending a `TriageEntry` `{ t, afterAttempt, trigger, verdict, rationale, artifactRef }` with `artifactRef` keyed `triage-<count of prior triage entries>` holding `{ trigger, rationale }`. Task 4 relies on a `fix_the_gate` triage entry being the log tail when it takes over.

- [ ] **Step 1: Write the failing test**

Add to `src/surface.test.ts`. First a helper near the existing `unusedTriage` / `portsWith` helpers:

```ts
/** Ports whose triage is the real deterministic router. */
function portsWithTriage(
  agent: SurfacePorts["agent"],
  closer: SurfacePorts["closer"] = noopCloser,
): SurfacePorts {
  return { agent, triage: deterministicRouter, closer };
}
```

and the import at the top of the file:

```ts
import { deterministicRouter } from "./router.js";
```

Then a new `describe` block:

```ts
describe("TRIAGE", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Drive a surface to TRIAGE by letting a worker break the gate. */
  async function toTriageOnGateFail(): Promise<{
    location: SurfaceLocation;
    ports: SurfacePorts;
  }> {
    const agent = {
      invoke: (_roleCfg: { role: string }, ctx: { worktreePath: string }) => {
        writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
        return Promise.resolve({ status: "completed", rationale: "broke it" } as Terminus);
      },
    };
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    const gated = await advance(dir, location, ports); // GATING -> TRIAGE
    expect(gated.state).toBe("TRIAGE");
    return { location, ports };
  }

  it("routes a gate failure to another worker attempt on the next attempt number", async () => {
    const { location, ports } = await toTriageOnGateFail();

    const step = await advance(dir, location, ports);
    expect(step.state).toBe("AGENT_ACTIVE");
    expect(step.done).toBe(false);

    const { history } = await load(dir);
    const entry = history.at(-1);
    expect(entry).toMatchObject({
      t: "triage",
      trigger: "gate_fail",
      verdict: "reroute",
      afterAttempt: 1,
      artifactRef: "triage-0",
    });
    expect(await readRef(dir, "triage-0")).toMatchObject({ trigger: "gate_fail" });

    // The reroute entry IS the correction burn, and it advances the attempt.
    await advance(dir, location, ports); // AGENT_ACTIVE dispatches attempt 2
    const after = await load(dir);
    const dispatches = after.history.filter((e) => e.t === "dispatch");
    expect(dispatches.at(-1)).toMatchObject({ attempt: 2, role: "worker" });
  });

  it("escalates a gate failure once the correction budget is at cap", async () => {
    const { location, ports } = await toTriageOnGateFail();

    // The worker never fixes the gate, so every attempt returns to TRIAGE.
    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");
    expect(result.outcome).toMatchObject({ kind: "escalated", source: "triage" });

    const { history } = await load(dir);
    const reroutes = history.filter((e) => e.t === "triage" && e.verdict === "reroute");
    expect(reroutes).toHaveLength(budgets.correction.max);
  });

  it("routes a close failure back to another close attempt", async () => {
    const cleanWorker = {
      invoke: () =>
        Promise.resolve({ status: "completed", rationale: "clean" } as Terminus),
    };
    let closes = 0;
    const fussyCloser: SurfacePorts["closer"] = {
      close: (_ctx, outcome) => {
        if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
        closes += 1;
        return Promise.resolve(
          closes === 1
            ? { status: "FAIL", detail: "not ready yet" }
            : { status: "DONE", detail: "merged" },
        );
      },
    };
    const ports = portsWithTriage(cleanWorker, fussyCloser);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");
    expect(closes).toBe(2);

    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "close_failure", verdict: "retry_close" },
    ]);
  });

  it("retries an exhaustion-class worker escalate as another worker attempt", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck, maybe retry" },
      { status: "completed", rationale: "got there on the retry" },
    ]);
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");

    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "worker_escalate", verdict: "reroute" },
    ]);
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-2-0"]);
  });

  it("ends the surface with no further dispatch when the router escalates", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck for good" },
    ]);
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");

    const { cursor, history } = await load(dir);
    expect(cursor.state).toBe("ESCALATED");
    // The last triage entry is the escalate; nothing was dispatched after it.
    const lastTriage = history.map((e) => e.t).lastIndexOf("triage");
    expect(history.slice(lastTriage).filter((e) => e.t === "dispatch")).toEqual([]);
  });

  it("ends the surface as ABORTED when the port returns an abort verdict", async () => {
    const abortingTriage: SurfacePorts["triage"] = {
      triage: () =>
        Promise.resolve({ verdict: "abort", rationale: "the task itself is unsound" }),
    };
    const agent = {
      invoke: (_roleCfg: { role: string }, ctx: { worktreePath: string }) => {
        writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
        return Promise.resolve({ status: "completed", rationale: "broke it" } as Terminus);
      },
    };
    const ports: SurfacePorts = { agent, triage: abortingTriage, closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ABORTED");
    expect(result.outcome).toMatchObject({ kind: "aborted", source: "triage" });

    const { history } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "triage", verdict: "abort" });
  });

  it("names the state and the edge when TRIAGE is reached with no routable tail", () => {
    // Defensive guard: no tail `position()` derives TRIAGE from can fail to
    // yield a trigger, so it is exercised directly rather than through advance.
    expect(() => triageTrigger(dir, undefined)).toThrow(IllegalStateTransition);
    expect(() => triageTrigger(dir, { t: "baseline", status: "PASS" })).toThrow(/TRIAGE/);
  });
});
```

Note on the last test: it exercises the guard through an exported helper, imported statically at the top of the file alongside `advance`/`run`:

```ts
import { advance, run, triageTrigger } from "./surface.js";
```

Export `triageTrigger` from `src/surface.ts` for exactly this reason (Step 3), and keep it the only export added.

- [ ] **Step 1b: Remove the test the edge makes obsolete**

`src/surface.test.ts:99` currently asserts that `advance` *throws* on a TRIAGE
position (`"throws IllegalStateTransition naming the state it cannot advance
from"`, whose comment already says "whose edge is slice 3's"). That is a
pre-slice-3 expectation, not intended behaviour: with the edge built it fails
with `"triage was not expected here"` from `unusedTriage`. Delete it — the
`IllegalStateTransition` message contract it guarded is now covered by the
`triageTrigger` test above and by the existing `GATE_MAINTENANCE` /
`INCOMPLETE_TERMINUS` guard tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "TRIAGE"`
Expected: FAIL — the first tests throw `IllegalStateTransition: TRIAGE / advance` from `advance`'s `default` branch, and the last one cannot import `triageTrigger`.

- [ ] **Step 3: Write minimal implementation**

In `src/surface.ts`, add the trigger derivation and the edge. Place them immediately after `closed` and before `advance`:

```ts
/**
 * The trigger `TriagePort` reads, derived from the entry that routed the
 * surface into `TRIAGE`. The state alone does not carry it, and the tail is the
 * same thing a resumed run reads — so a live route and a resumed one classify
 * the setback identically.
 */
export function triageTrigger(
  dir: string,
  tail: HistoryEntry | undefined,
): Pick<TriageInput, "trigger" | "category"> {
  if (tail?.t === "gate") {
    return { trigger: tail.status === "ERROR" ? "gate_error" : "gate_fail" };
  }
  if (tail?.t === "close") return { trigger: "close_failure" };
  if (tail?.t === "terminus" && tail.status === "escalate") {
    return { trigger: "worker_escalate", category: tail.category };
  }
  throw new IllegalStateTransition(dir, "TRIAGE", "triage");
}

/**
 * Ask the router what to do about the setback on the log tail, and carry out
 * its verdict.
 *
 * The `triage` entry appended here IS the `correction`/`close` burn for a
 * `reroute`/`retry_close` verdict — there is no separate increment, and the
 * budgets handed to the router are derived from the log immediately before the
 * call, never read from the cursor's stale copy. Routing then goes through
 * `deriveStateFromEntry` on the entry just appended, so a live route and a
 * resumed one are the same computation rather than two rules that can drift.
 *
 * `fix_the_gate` deliberately stops at `GATE_MAINTENANCE` without dispatching:
 * that edge already has to dispatch from a `fix_the_gate` tail to recover the
 * crash window between the two writes, so doing it here as well would be a
 * second copy of the same code guarded by nothing.
 */
async function triage(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const { trigger, category } = triageTrigger(dir, logTail(caseFile));
  const remainingBudgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);

  const verdict = await ports.triage.triage({
    trigger,
    ...(category ? { category } : {}),
    caseFile,
    remainingBudgets,
  });

  // Keyed by prior triage count so repeated rounds never overwrite each other's
  // artefacts. This item's router synthesises nothing richer than the stub, but
  // the field is never omitted — Item 5 replaces the contents, not the schema.
  const priorTriages = caseFile.history.filter((e) => e.t === "triage").length;
  const artifactRef = await writeRef(dir, `triage-${priorTriages}`, {
    trigger,
    rationale: verdict.rationale,
  });

  const entry: HistoryEntry = {
    t: "triage",
    afterAttempt: workerAttempt(caseFile.history),
    trigger,
    verdict: verdict.verdict,
    rationale: verdict.rationale,
    artifactRef,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  if (state === "ESCALATED") {
    return escalate(dir, caseFile, location, ports, "triage", verdict.rationale);
  }
  if (state === "ABORTED") {
    return terminate(dir, caseFile, location, ports, "ABORTED", {
      kind: "aborted",
      source: "triage",
      reason: verdict.rationale,
      at: new Date().toISOString(),
    });
  }
  await updateCursor(dir, { state });
  return { state, done: false };
}
```

Add `case "TRIAGE"` to `advance`'s switch, between `case "GATING"` and `case "CLOSING"`:

```ts
    case "TRIAGE":
      return triage(dir, caseFile, location, ports);
```

Extend the type import at the top of the file:

```ts
import type { SurfaceLocation, SurfacePorts, TriageInput } from "./ports.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/surface.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Route a setback through the TRIAGE edge instead of throwing

TRIAGE previously fell through advance's default branch, so a failed gate,
a rejected close or an exhaustion-class worker escalate ended the run with
an illegal-transition throw. The edge now reads the trigger off the log
tail, asks the router, and carries out the verdict; the triage entry it
appends is simultaneously the correction/close burn.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The post-task gate repair — dispatch from triage, re-check without re-baselining ✅ DONE (deliver-slice)

`GATE_MAINTENANCE` today only knows its pre-task entry: it assumes a dispatch or terminus tail, and a completed repair always re-baselines. This task adds the two post-task cases: dispatching when the tail is the `fix_the_gate` triage entry, and resolving a completed repair to a re-check of the same attempt against the baseline already pinned.

**Files:**
- Modify: `src/surface.ts` (the `gateMaintenance` function)
- Test: `src/surface.test.ts`
- Modify: `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md` (the `TRIAGE` edge's `fix_the_gate` sentence)

**Interfaces:**
- Consumes: `triage` edge from Task 3 (a `fix_the_gate` triage entry is the tail it dispatches from); `runCheck`'s widened ref key from Task 1 (the re-check writes refs for an attempt already checked).
- Produces: no new exports. `gateMaintenance` now resolves `completed` to `GATING` when `header.baseline !== null`, and to `PRE_GATING` only when no baseline exists.

- [ ] **Step 1: Write the failing test**

Add to `src/surface.test.ts`, inside the `describe("TRIAGE", ...)` block from Task 3:

```ts
  it("repairs an errored gate and re-checks the same attempt against the same baseline", async () => {
    const worker = (ctx: { worktreePath: string }): Promise<Terminus> => {
      // The worker's change removes the file the gate reads: the gate can no
      // longer run at all, which is an ERROR, not a regression.
      rmSync(join(ctx.worktreePath, "report.tap"));
      return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
    };
    const repair = (ctx: { worktreePath: string }): Promise<Terminus> => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    };
    const agent: SurfacePorts["agent"] = {
      invoke: (roleCfg, ctx) =>
        roleCfg.role === "gate-maintenance" ? repair(ctx) : worker(ctx),
    };
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    // Capture the baseline the moment it is pinned, before any worker runs.
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    const pinned = (await load(dir)).header.baseline;
    expect(pinned).not.toBeNull();

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");

    const { header, history } = await load(dir);

    // The baseline is the one captured pre-task — never recaptured.
    expect(history.filter((e) => e.t === "baseline")).toHaveLength(1);
    expect(header.baseline).toEqual(pinned);

    // gate_error routed to a repair, and the re-check judged the SAME attempt.
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "gate_error", verdict: "fix_the_gate" },
    ]);
    expect(history.filter((e) => e.t === "gate")).toMatchObject([
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "PASS" },
    ]);
    expect(history.filter((e) => e.t === "dispatch")).toMatchObject([
      { role: "worker", attempt: 1 },
      { role: "gate-maintenance", attempt: 1 },
    ]);
  });

  it("dispatches the repair on resume when the fix_the_gate verdict was the last thing recorded", async () => {
    const agent: SurfacePorts["agent"] = {
      invoke: (roleCfg, ctx) => {
        if (roleCfg.role === "gate-maintenance") {
          writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
          return Promise.resolve({ status: "completed", rationale: "restored" });
        }
        rmSync(join(ctx.worktreePath, "report.tap"));
        return Promise.resolve({ status: "completed", rationale: "broke the gate" });
      },
    };
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    await advance(dir, location, ports); // GATING -> TRIAGE
    const routed = await advance(dir, location, ports); // TRIAGE -> GATE_MAINTENANCE
    expect(routed.state).toBe("GATE_MAINTENANCE");

    // Nothing dispatched yet — the triage entry is the tail. A fresh process
    // resuming here must dispatch the repair rather than throw.
    const mid = await load(dir);
    expect(mid.history.at(-1)).toMatchObject({ t: "triage", verdict: "fix_the_gate" });

    const step = await advance(dir, location, ports);
    expect(step.state).toBe("GATE_MAINTENANCE");
    const after = await load(dir);
    expect(after.history.filter((e) => e.t === "dispatch").at(-1))
      .toMatchObject({ role: "gate-maintenance" });
  });
```

Add `rmSync` to the `node:fs` import at the top of `src/surface.test.ts`:

```ts
import { writeFileSync, rmSync } from "node:fs";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "gate"`
Expected: FAIL — `IllegalStateTransition: GATE_MAINTENANCE / resolve-repair`, because the `gateMaintenance` edge rejects a `triage` tail.

- [ ] **Step 3: Write minimal implementation**

In `src/surface.ts`, update the `gateMaintenance` function's doc comment and body:

```ts
/**
 * Route a repair session's outcome.
 *
 * Three tails can land here. A `triage` entry means `fix_the_gate` was recorded
 * but the repair it pays for was not yet dispatched — the crash window between
 * those two writes, and also the ordinary post-task hand-off, since `TRIAGE`
 * deliberately leaves the dispatch to this edge. A `dispatch` with no terminus
 * is a session that ended without a result. A `terminus` is a session to route.
 *
 * A completed repair resolves differently by entry point, and the log — not the
 * cursor — must carry the distinction, or a crash right after would re-derive
 * `GATE_MAINTENANCE` with no way to tell the exits apart. Pre-task (no baseline
 * yet) re-baselines, appending a `baseline` entry. Post-task re-checks the
 * attempt that triggered the repair against the baseline already pinned,
 * appending a `gate` entry. The baseline is never recaptured post-task.
 */
async function gateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "triage") {
    return dispatchGateMaintenance(
      dir, caseFile, location, ports, "triage routed the setback to a gate repair",
    );
  }

  if (tail?.t === "dispatch") {
    // A dispatch with no terminus is a session that ended without emitting a
    // valid result — an incomplete terminus, not a session to resurrect. Record
    // it and let the ordinary incomplete handling redispatch or escalate.
    await recordMissingTerminus(dir, tail, "gate-maintenance");
    return { state: "GATE_MAINTENANCE", done: false };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "GATE_MAINTENANCE", "resolve-repair");
  }

  switch (tail.status) {
    case "completed":
      return caseFile.header.baseline === null
        ? preGating(dir, caseFile, location, ports)
        : gating(dir, caseFile, location);
    case "escalate":
      return escalateFromTail(dir, caseFile, location, ports, "gate-maintenance");
    case "incomplete":
      return dispatchGateMaintenance(
        dir,
        caseFile,
        location,
        ports,
        "the repair session ended without a result",
      );
  }
}
```

`gating` is declared below `gateMaintenance` in the file; both are function declarations, so hoisting makes the forward reference legal. Leave the ordering as it is — moving `gating` would churn the diff for nothing.

- [ ] **Step 4: Correct the design spec's `TRIAGE` edge description**

The spec's `TRIAGE` edge says `fix_the_gate` "appends the post-task
`dispatch`/`terminus` pair with `role: "gate-maintenance"` right here ... and
routes to `GATE_MAINTENANCE`", with the `GATE_MAINTENANCE` edge recovering the
crash window between the two writes. Tasks 3 and 4 keep the observable
behaviour and drop the duplicate: only `GATE_MAINTENANCE` dispatches. In
`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`,
replace that clause with:

```
`fix_the_gate` routes to `GATE_MAINTENANCE`, whose edge appends the post-task
`dispatch`/`terminus` pair with `role: "gate-maintenance"` (that append is the
`gateMaintenance` burn, per Decisions above — same pattern as `PRE_GATING`'s
pre-task case). `TRIAGE` records the verdict and stops: since that edge must
dispatch from a `fix_the_gate` tail anyway to recover the crash window between
the two writes, dispatching here as well would be a second copy of the same
code, and leaving it out closes the window by construction;
```

Leave the `GATE_MAINTENANCE` edge section as it is — it already specifies
exactly this dispatch-from-a-triage-tail behaviour.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/surface.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/surface.ts src/surface.test.ts docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md
git commit -m "Resolve a post-task gate repair by re-checking, not re-baselining

GATE_MAINTENANCE only knew its pre-task entry: it rejected a fix_the_gate
triage tail outright and always re-baselined a completed repair. Post-task
the baseline is already pinned and immutable, so the repair must resolve to
a re-check of the attempt that triggered it. Dispatching from the triage
tail here rather than in TRIAGE also closes the crash window between the
verdict and the dispatch that pays for it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The setback-routing demo ✅ DONE (deliver-slice)

The harness extender's UAT surface for this slice: four scenarios against fresh surfaces, each printing its state sequence, the router's verdicts, and its final outcome.

**Files:**
- Create: `demos/single-surface-slice-3-setbacks.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `advance` from `src/surface.js` (the demo steps the surface itself, so it can print every state); `deterministicRouter` from `src/router.js` (Task 2); `create`/`load` from `src/case-file.js`; `initTempRepo` from `src/temp-repo.js`; `noopCloser`, `AgentPort`, `SurfaceLocation`, `SurfacePorts`, `CloserPort` from `src/ports.js`.
- Produces: `npm run demo:surface-slice-3`.

- [ ] **Step 1: Write the demo script**

Create `demos/single-surface-slice-3-setbacks.ts`:

```ts
/**
 * UAT demo for Single-Surface State Machine Slice 3: Route a Setback Back Into
 * the Loop Instead of Giving Up.
 *
 * Four scenarios against fresh surfaces — a gate failure, a gate error, a
 * rejected close, and a stuck worker — each printing the states the driver
 * moves through, the router's verdicts, and the final outcome.
 *
 * Usage: npx tsx demos/single-surface-slice-3-setbacks.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, CloserPort, SurfaceLocation, SurfacePorts, Terminus } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";

/** Write the gate's input file in the worktree. */
function tap(worktreePath: string, contents: string): void {
  fs.writeFileSync(path.join(worktreePath, "report.tap"), contents);
}

/**
 * An agent that runs the next scripted worker step per worker dispatch, and a
 * fixed repair step for every gate-maintenance dispatch.
 */
function agentOf(
  workerSteps: ((worktreePath: string) => Terminus)[],
  repair?: (worktreePath: string) => Terminus,
): AgentPort {
  let i = 0;
  return {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "gate-maintenance") {
        if (!repair) throw new Error("no repair step scripted");
        return Promise.resolve(repair(ctx.worktreePath));
      }
      const step = workerSteps[Math.min(i, workerSteps.length - 1)];
      i += 1;
      return Promise.resolve(step(ctx.worktreePath));
    },
  };
}

async function runScenario(
  title: string,
  setback: string,
  ports: SurfacePorts,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setback-case-"));
  const repoPath = initTempRepo("setback-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "setback-tree-")), "wt");
  const location: SurfaceLocation = { repoPath, worktreePath };

  await create(dir, { surfaceId: title.toLowerCase().replace(/\W+/g, "-"), taskDef: { intent: "add a feature" }, gateRef }, budgets);

  console.log(`\n=== ${title} ===`);
  console.log(`Setback:  ${setback}`);
  const states = ["PROVISIONING"];
  let done = false;
  while (!done) {
    const step = await advance(dir, location, ports);
    states.push(step.state);
    done = step.done;
  }

  const caseFile = await load(dir);
  const verdicts = caseFile.history
    .filter((e) => e.t === "triage")
    .map((e) => `${e.trigger} -> ${e.verdict}`);

  console.log(`States:   ${states.join(" -> ")}`);
  console.log(`Router:   ${verdicts.length ? verdicts.join(", ") : "(never consulted)"}`);
  console.log(`Attempts: ${caseFile.history.filter((e) => e.t === "dispatch").length} dispatched`);
  console.log(`Outcome:  ${caseFile.outcome?.kind ?? "none"} — ${caseFile.outcome?.reason ?? ""}`);
}

async function main(): Promise<void> {
  // 1. The worker's change fails the gate; the router reroutes; attempt 2 passes.
  await runScenario(
    "Gate failure, fixed on the retried attempt",
    "the worker's first change regresses a passing assertion",
    {
      agent: agentOf([
        (wt) => { tap(wt, FAILING_TAP); return { status: "completed", rationale: "broke beta" }; },
        (wt) => { tap(wt, PASSING_TAP); return { status: "completed", rationale: "fixed beta" }; },
      ]),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );

  // 2. The worker's change stops the gate running at all; a repair restores it,
  //    and the SAME attempt is re-checked against the SAME baseline.
  await runScenario(
    "Gate error, repaired then re-checked",
    "the worker's change removes the file the gate reads, so the gate cannot run",
    {
      agent: agentOf(
        [(wt) => { fs.rmSync(path.join(wt, "report.tap")); return { status: "completed", rationale: "worked, broke the gate" }; }],
        (wt) => { tap(wt, PASSING_TAP); return { status: "completed", rationale: "restored report.tap" }; },
      ),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );

  // 3. The closer rejects the first close, accepts the retried one.
  let closes = 0;
  const fussyCloser: CloserPort = {
    close: (_ctx, outcome) => {
      if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
      closes += 1;
      return Promise.resolve(
        closes === 1
          ? { status: "FAIL", detail: "the surface is not ready to close yet" }
          : { status: "DONE", detail: "closed on the retried attempt" },
      );
    },
  };
  await runScenario(
    "Close rejected once, accepted on retry",
    "the closer reports the surface is not actually ready",
    {
      agent: agentOf([() => ({ status: "completed", rationale: "clean change" })]),
      triage: deterministicRouter,
      closer: fussyCloser,
    },
  );

  // 4. The worker reports it is stuck but retryable; the retried attempt lands.
  await runScenario(
    "Stuck worker, succeeds on the retried attempt",
    "the worker reports an exhaustion-class escalate — stuck, but a retry might help",
    {
      agent: agentOf([
        () => ({ status: "escalate", category: "exhaustion", rationale: "ran out of road, a retry might get there" }),
        () => ({ status: "completed", rationale: "got there on the retried attempt" }),
      ]),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );
}

await main();
```

- [ ] **Step 2: Add the run story to package.json**

In `package.json`, add to `scripts`, immediately after `demo:surface-slice-2`:

```json
    "demo:surface-slice-3": "npx tsx demos/single-surface-slice-3-setbacks.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:surface-slice-3`
Expected: four blocks. Each prints a `States:` line that contains `TRIAGE`, a `Router:` line naming the trigger and the verdict (`gate_fail -> reroute`, `gate_error -> fix_the_gate`, `close_failure -> retry_close`, `worker_escalate -> reroute`), and `Outcome: closed`. No block ends escalated, and none hangs.

- [ ] **Step 4: Verify the script typechecks and lints**

Run: `npm run lint`
Expected: clean. `demos/` is inside the tsconfig/eslint scope, so an unused import or a loose type fails here.

- [ ] **Step 5: Commit**

```bash
git add demos/single-surface-slice-3-setbacks.ts package.json
git commit -m "Add the setback-routing demo

The harness extender's UAT surface for this slice: four scenarios — failed
gate, errored gate, rejected close, stuck worker — each printing its state
sequence, the router's verdicts and its final outcome, so a reviewer can
read the routing decisions rather than infer them from test names.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| A gate failure caused by the worker's change routes to another worker attempt, using the next attempt number | Task 3 (`routes a gate failure to another worker attempt on the next attempt number`) |
| A gate that errors post-worker routes to a repair, and a successful repair re-checks against the same baseline | Tasks 1 + 4 (`repairs an errored gate and re-checks the same attempt against the same baseline`) |
| A closer that reports the surface isn't ready routes back to another close attempt | Task 3 (`routes a close failure back to another close attempt`) |
| A worker's "stuck, but retrying might help" is retried as another worker attempt, up to its own cap | Task 2 (router row) + Task 3 (`retries an exhaustion-class worker escalate...`) |
| Each route eventually reaches closed / escalated / aborted — none can loop forever | Task 3 (`escalates a gate failure once the correction budget is at cap` uses `run`, which is unbounded and terminates only because the budget caps it) |
| A verdict that ends the surface leaves it in the matching terminal state with no further dispatch | Task 3 (`ends the surface with no further dispatch when the router escalates`, plus `ends the surface as ABORTED when the port returns an abort verdict` for the other terminal verdict) |

No gaps.

**2. Placeholder scan** — every step carries the literal code or the literal command. No "similar to Task N", no "add error handling", no unnamed types. The one forward reference (`gating` used above its declaration in `gateMaintenance`) is called out as hoisting, with the reason for not reordering.

**3. Type consistency** — `deterministicRouter` (Task 2) is the name used in Tasks 3 and 5. `triageTrigger(dir, tail)` returns `Pick<TriageInput, "trigger" | "category">`, and `TriageInput`/`TriageVerdict`/`BudgetPopulation` are the existing names in `src/ports.ts` / `src/schema.ts`. `runCheck`'s signature is unchanged by Task 1. `TriageEntry` fields (`afterAttempt`, `trigger`, `verdict`, `rationale`, `artifactRef`) match `src/schema.ts:144-152` exactly. Budget population keys (`correction`, `gateError`, `gateMaintenance`, `terminus`, `close`) match `BudgetSet`.

**4. Right choice re-audit**

| Decision | Easy choice | What the plan does | Easy or Right? |
|---|---|---|---|
| Where the router lives | Append it to `ports.ts` next to `noopCloser` | Own file `src/router.ts` with its own test file — it has a rule table and real branching, unlike the two-line no-op closer | Right |
| Router shape | `switch` over trigger with a budget check per arm | A `Record<trigger, {budget, helpful}>` table plus one shared cap check — the rule is data, and the spec states it as a table | Right |
| Who dispatches the repair after `fix_the_gate` | Dispatch in `TRIAGE` *and* recover in `GATE_MAINTENANCE`, as the spec's prose describes | Only `GATE_MAINTENANCE` dispatches; `TRIAGE` records the verdict and stops. Same observable behaviour, one code path instead of two, and the crash window is closed by construction rather than by a recovery branch that needs its own test to stay honest | Right |
| The exhaustion-class contradiction | Implement the spec's `escalate`-always row and leave the slice ACs failing, or implement the ACs and leave the spec contradicting the code | Implement the ACs (reroute under `correction` cap) and correct the spec's row and its defending paragraph in the same commit as the router | Right |
| Pre-task vs post-task repair exit | `updateCursor` to `GATING` post-task | Call `gating`, which appends a `gate` entry — the log carries the distinction, so a crash straight after cannot re-derive `GATE_MAINTENANCE` and loop | Right |
| Ref-key widening | Leave the documented `ponytail:` ceiling in place, since the only same-attempt re-check today (post `gate_error`) writes zero failure refs | Widen the key and delete the ceiling comment. Three lines, and it is the difference between "no collision because of an unrelated fact about ERROR reports" and "no collision by construction" | Right |
| Budget accounting | Call `incrementBudget` from the `TRIAGE` edge | Derive from the log; the `triage` entry is the burn. Matches every other edge and keeps a live run and a rebuild computing the same number | Right |
| The router's authority-class guard, unreachable from this driver | Drop it as dead code (`deriveStateFromEntry` sends authority escalates straight to `ESCALATED`) | Keep it. `TriagePort` is a seam; a caller passing `worker_escalate` + `authority` would otherwise get `reroute` from the `correction` row — a wrong answer at a boundary, not unused scaffolding | Right |
| Demo structure | Four copy-pasted `main` bodies | One `runScenario` plus a scripted-step `agentOf`, matching the `runSurface` shape the Slice 1 demo already uses | Right |

No new dependency, no new abstraction with a single call site, no hand-rolled commodity. The buy-vs-build constraint (no new deps; reuse `deriveStateFromEntry`, `triageState`, `deriveBudgetsFromLog`, `runCheck`) is honoured by every task. The operability constraint is honoured by Task 5's demo and by the `IllegalStateTransition(dir, "TRIAGE", "triage")` guard naming the state and the edge.

**5. Scaffolding drift check**

Behaviours this slice changes, and where each is described:
- **`TRIAGE` is now a live edge rather than a throw** — described in the design spec's control-flow section, which specifies it correctly except for placing the `fix_the_gate` repair dispatch inside `TRIAGE` → corrected in Task 4. `src/surface.test.ts`'s "throws IllegalStateTransition naming the state it cannot advance from" encodes the old throw → deleted in Task 3. No README, CONTRIBUTING or skill text describes the state machine's edges.
- **The exhaustion-class routing rule** — described in the design spec's router table and its defending paragraph, both now stale → corrected in Task 2, the task that builds the router.
- **The gate failure ref-key format** — described only in `src/run-gate.ts`'s own `ponytail:` comment → deleted in Task 1, the task that changes the format.
- **A post-task repair re-checks rather than re-baselines** — described in the design spec's `GATE_MAINTENANCE` section, which already specifies this behaviour correctly. No update needed.
- **New command `npm run demo:surface-slice-3`** → added in Task 5. `README.md` and `CONTRIBUTING.md` list no `demo:*` script by name (checked), so `package.json` is the only place it needs to appear. No new env var, no new dependency, no change to `make verify` or the CI job.
