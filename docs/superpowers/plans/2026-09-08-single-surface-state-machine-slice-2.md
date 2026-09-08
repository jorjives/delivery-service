# Single-Surface State Machine — Slice 2: Drive a Worker's Change Through the Gate to a Decision

> **Status:** ✅ Complete — 2026-09-08 — `e574130`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Goal:** Close the happy path — from the `AGENT_ACTIVE` state Slice 1 lands on,
dispatch a worker session, gate its result against the recorded baseline, hand the
accepted work to the closer, and reach `CLOSED`, with a bounded same-attempt retry
for sessions that end without a valid result and a direct escalate for an authority
limit.

**Architecture:** Four new edges on the existing `advance` step function
(`AGENT_ACTIVE`, `INCOMPLETE_TERMINUS`, `GATING`, `CLOSING`), plus `run`, the loop
that calls `advance` until the surface is terminal. The worker and gate-maintenance
dispatches collapse onto one shared `dispatchSession` helper: append the `dispatch`
entry, invoke the `AgentPort`, append the `terminus` entry, and route on
`deriveStateFromEntry` of that entry — so the state a live run moves to and the state
a resumed run derives from the log are the same computation. Slice 1's
pre-first-worker-dispatch position rule gains its second half: once a worker
`dispatch` entry exists, position comes from `deriveStateFromEntry(logTail)`.

**Tech Stack:** TypeScript (ES2024, Node16 modules, strict), Node ≥22, zod for the
persisted schema, vitest for tests, `tsx` for the demo script, `git` CLI via
`node:child_process`.

## Global Constraints

- **Node ≥22**, ESM only (`"type": "module"`), all intra-`src` imports use the
  `.js` extension (Node16 module resolution).
- **TypeScript strict** with `noUncheckedIndexedAccess`; `npm run lint` runs
  `eslint . && tsc --noEmit` and must stay green. `tsc` only compiles `src`
  (`rootDir: "src"`, `include: ["src"]`) — no file under `src` may import from
  `tests/` or `demos/`.
- **Errors follow `src/errors.ts` convention**: named class, `readonly code`
  literal, constructor args kept as readonly fields, `this.name` set. This slice
  adds no new error class — `IllegalStateTransition` (Slice 1) already covers the
  states this slice still cannot advance from.
- **Persisted shapes are zod schemas in `src/schema.ts`**; in-memory port contracts
  are plain TypeScript types. This slice adds **no** schema fields — `role`,
  `category` and `CloseEntry.detailRef` all already exist.
- **Buy-vs-build (spec: "Three pluggable ports"):** the driver never calls an agent,
  triage or closer implementation directly; it calls through `AgentPort` /
  `TriagePort` / `CloserPort`, so Items 4/5/6 slot in without touching the driver.
  Tests and the demo supply scripted doubles; `noopCloser` (already shipped in
  `src/ports.ts`) is the closer this item ships.
- **Buy-vs-build (spec: "no new recovery mechanism"):** reuse the already-shipped
  `case-file.ts` primitives (`load`, `appendEntry`, `updateCursor`, `setOutcome`,
  `writeRef`, `logTail`, `deriveStateFromEntry`, `deriveBudgetsFromLog`) and Item 2's
  `runCheck` for gating. This slice adds no new persistence, no new gate runner and
  no second copy of the dispatch/terminus pairing.
- **Budgets have no separately-mutated live counter.** Never call
  `incrementBudget`. Every budget check derives fresh from the log immediately
  before the single write that is simultaneously the action and the burn.
- **Errors name the state and the attempted edge** (Slice 1's Operational note,
  still the baseline here): `IllegalStateTransition` carries `dir`, `state`, `edge`;
  a budget-exhaustion escalation names the population and its cap in the outcome
  `reason`.
- **Additive-only schema changes**, and every existing case file from Items 1–2 stays
  valid: an entry with no `role` is a worker entry.

## Scaffolding Impact

- `package.json` `scripts` — new `demo:surface-slice-2` entry, the run story for this
  slice's demo → added in Task 7.
- `src/index.ts` — the package's public surface gains `run` and its `RunResult`
  type → updated in Task 6.
- `docs/single-surface-control-flow.md` — checked and **not** changed: its
  `AGENT_ACTIVE`/`GATING`/`CLOSING`/terminus-retry edges and its budget-population
  descriptions already describe exactly the behaviour this slice implements; this
  slice implements documented behaviour rather than changing it.
- `docs/provisioning.md`, `README.md`, `CONTRIBUTING.md` — untouched: no new
  command beyond the demo script, no new dependency, no change to setup, test or
  lint.

---

## Out of scope for this slice (deliberate, do not build)

These are in the design spec but belong to later slices. Do **not** implement them
here, and do not write tests for them:

- **The `TRIAGE` edge.** Four of this slice's paths can *reach* `TRIAGE` (a failing
  gate, an erroring gate, a failing close, an exhaustion-class worker escalate).
  Each of those returns `{ state: "TRIAGE", done: false }` and the next `advance`
  throws `IllegalStateTransition` naming `TRIAGE`. That is the correct Slice 2
  behaviour: the deterministic router is Slice 3's. Do not add a `TRIAGE` case to
  `advance`'s switch.
- **The deterministic `TriagePort` router implementation.** Its type is already
  declared; Slice 3 ships the router.
- **The `correction`-budget cap check and attempt advance on reroute.** No triage
  entry is ever written in this slice, so `workerAttempt` is always 1 in practice.
  Implement the rule (it is one `filter`), but do not build a reroute path to
  exercise it.
- **`runCheck`'s widened gate-failure ref key** (`gate-<attempt>-<recheck>-<index>`).
  This slice checks each attempt at most once, so the collision the existing
  `ponytail:` comment names is unreachable here. Leave `run-gate.ts` alone.
- **`resumeAction`'s role-awareness.** Nothing consumes `resumeAction`; the driver
  routes on `deriveStateFromEntry`. Leave it as shipped.
- **Exact-cap independence across all five populations** and the stop-and-resume
  equivalence suite. Slice 2 enforces the `terminus` cap because its own retry path
  needs it; Slices 4 and 5 own the per-population and crash-recovery guarantees.
- **A closer that throws.** `CloserPort.close` rejecting on the accept path
  propagates out of `advance`. The fire-and-log wrapper exists only on the terminal
  teardown path (Slice 1's `terminate`). Do not add a second one.
- **A step cap or livelock guard inside `run`.** Every non-terminal `advance` either
  appends an entry or throws; the budget caps bound the loop. Do not add a max-steps
  parameter.

---

## Task 1: Correct the log-derived state and budget attribution ✅ DONE (deliver-slice)

Slice 1 shipped `deriveStateFromEntry` and `deriveBudgetsFromLog` with the
gate-maintenance half correct and the worker half still as Item 1 left it. Slice 2 is
the first slice that writes worker `dispatch`, worker `terminus` and `close` entries,
so the worker half has to be right before any edge reads it — the driver routes on
`deriveStateFromEntry` and checks the `terminus` cap through `deriveBudgetsFromLog`,
and a resumed run derives its position and budgets through the same two functions.

Three corrections, all from the design spec ("Schema extension" and "Attempt
numbering and budget derivation"):

1. A worker `dispatch` that is still the tail has no terminus — that is the
   dangling-dispatch case the spec defines as an incomplete terminus. It derives to
   `INCOMPLETE_TERMINUS`, not `AGENT_ACTIVE`. Left as shipped, a resume would
   dispatch a second session for the same attempt, record no `incomplete` terminus,
   burn no budget, and retry unboundedly.
2. A worker `escalate` terminus branches on `category`: `"authority"` is terminal
   (`ESCALATED`), `"exhaustion"` still gets the deterministic router's first look
   (`TRIAGE`).
3. Budget populations are attributed to the entry that records the triggering event,
   not to a blanket per-entry count:
   - `correction` ← `triage` entries with `verdict: "reroute"`
   - `close` ← `triage` entries with `verdict: "retry_close"`
   - `terminus` ← worker-role `terminus` entries with `status: "incomplete"`
   - `gateMaintenance` ← `dispatch` entries with `role: "gate-maintenance"`
     (unchanged from Slice 1)

   The blanket counts this replaces over-charged every `completed` terminus and every
   accepted `close` against budgets that exist only to cap retries — which this
   slice's happy path would hit on its very first run.

**Files:**
- Modify: `src/case-file.ts` (`terminusState` table, `deriveStateFromEntry`,
  `deriveBudgetsFromLog`)
- Test: `src/case-file.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `deriveStateFromEntry(entry: HistoryEntry) => SurfaceState` and
  `deriveBudgetsFromLog(history: HistoryEntry[], maxima: BudgetSet) => BudgetSet`
  with the corrected worker semantics above. Both are already exported from
  `case-file.ts` and re-exported from `index.ts`; signatures do not change.

- [ ] **Step 1: Write the failing tests**

REVIEW FIX (the original plan was wrong here): `src/case-file.test.ts` has **no**
`describe("deriveStateFromEntry")` block today, and imports neither
`deriveStateFromEntry` nor `deriveBudgetsFromLog`. Slice 1's role-awareness tests
("derives GATE_MAINTENANCE from a gate-maintenance dispatch tail", "…terminus of any
status") live inside `describe("rebuild")` and assert through `rebuild`. So add a
**new** `describe("deriveStateFromEntry")` block after the `rebuild` one, calling the
function directly (it is pure — no temp directory needed):

```ts
describe("deriveStateFromEntry", () => {
  it("derives INCOMPLETE_TERMINUS from a worker dispatch that is still the tail", () => {
    // A dispatch with no terminus is a session that ended without a valid
    // result — not a session to resurrect by dispatching a second one.
    expect(deriveStateFromEntry({
      t: "dispatch", attempt: 1, sessionKey: "worker-1-0",
    })).toBe("INCOMPLETE_TERMINUS");
    expect(deriveStateFromEntry({
      t: "dispatch", attempt: 1, sessionKey: "worker-1-0", role: "worker",
    })).toBe("INCOMPLETE_TERMINUS");
  });

  it("derives ESCALATED from an authority-class worker escalate", () => {
    expect(deriveStateFromEntry({
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "authority", rationale: "needs a credential I do not hold",
    })).toBe("ESCALATED");
  });

  it("derives TRIAGE from an exhaustion-class worker escalate", () => {
    // The deterministic router still gets first look at an exhaustion-class
    // escalate; only an authority limit is terminal on the spot.
    expect(deriveStateFromEntry({
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "exhaustion", rationale: "out of ideas",
    })).toBe("TRIAGE");
  });
});
```

Then add a second new `describe` block at the end of `src/case-file.test.ts` for the
budget attribution. It builds a history array directly and calls
`deriveBudgetsFromLog` — again no temp directory, because the function is pure:

```ts
describe("deriveBudgetsFromLog attribution", () => {
  const maxima: BudgetSet = {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  };

  it("charges nothing for a worker session that resolved", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "done" },
      { t: "close", status: "DONE", detailRef: "close-0" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    // Budgets cap RETRIES. A clean run through burns none of them.
    expect(budgets.terminus.used).toBe(0);
    expect(budgets.close.used).toBe(0);
    expect(budgets.correction.used).toBe(0);
  });

  it("charges the terminus budget once per worker session that ended without a result", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "incomplete", rationale: "crashed" },
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-1" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-1", status: "incomplete", rationale: "capped" },
    ];

    expect(deriveBudgetsFromLog(history, maxima).terminus.used).toBe(2);
  });

  it("never charges a repair session's incomplete terminus to the worker's budget", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" },
      { t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0", status: "incomplete", rationale: "crashed" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    // The repair session's cost is burned on gateMaintenance by its own
    // dispatch entry — counting it twice would charge a repair to the worker.
    expect(budgets.terminus.used).toBe(0);
    expect(budgets.gateMaintenance.used).toBe(1);
  });

  it("charges correction and close to the triage verdicts that caused them", () => {
    const history: HistoryEntry[] = [
      { t: "triage", afterAttempt: 1, trigger: "gate_fail", verdict: "reroute", rationale: "regression", artifactRef: "triage-0" },
      { t: "triage", afterAttempt: 2, trigger: "close_failure", verdict: "retry_close", rationale: "flaked", artifactRef: "triage-1" },
      { t: "triage", afterAttempt: 2, trigger: "gate_fail", verdict: "escalate", rationale: "out of road", artifactRef: "triage-2" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    expect(budgets.correction.used).toBe(1);
    expect(budgets.close.used).toBe(1);
  });
});
```

Fix the imports at the top of `src/case-file.test.ts` to match: add
`deriveStateFromEntry` and `deriveBudgetsFromLog` to the `./case-file.js` import (they
are **not** there today); `BudgetSet` and `HistoryEntry` are already on the
`./schema.js` type import.

Finally, **correct the existing test that asserts the old blanket count.** In
`src/case-file.test.ts`, the test `"reconstructs budget used counts from the log"`
asserts `expect(rebuilt.cursor.budgets.terminus.used).toBe(1)` for a history whose
only terminus is `status: "completed"`. That asserts the behaviour being replaced.
Change the assertion and its comment to:

```ts
    // A completed terminus resolves its attempt and costs nothing — the
    // terminus budget caps sessions that ended WITHOUT a valid result.
    expect(rebuilt.cursor.budgets.terminus.used).toBe(0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/case-file.test.ts`
Expected: FAIL — the three new `deriveStateFromEntry` tests report `AGENT_ACTIVE`
instead of `INCOMPLETE_TERMINUS` and `ESCALATED` for the exhaustion case; the
attribution tests report `terminus.used` of 1 and 2 where 0 is expected, and
`correction.used`/`close.used` of 0 where 1 is expected; the amended existing test
reports 1 where 0 is expected.

- [ ] **Step 3: Correct `deriveStateFromEntry`**

In `src/case-file.ts`, replace the `terminusState` table and the `dispatch`/`terminus`
arms of `deriveStateFromEntry` with:

```ts
const terminusState: Record<string, SurfaceState> = {
  completed: "GATING", incomplete: "INCOMPLETE_TERMINUS",
};
```

```ts
export function deriveStateFromEntry(entry: HistoryEntry): SurfaceState {
  switch (entry.t) {
    case "dispatch":
      // A dispatch that is still the tail has no terminus — a session that
      // ended without emitting a valid result, whichever role ran it. A repair
      // session's recovery is GATE_MAINTENANCE's own edge; a worker's is the
      // INCOMPLETE_TERMINUS edge, which records the missing terminus and
      // retries on the terminus budget rather than dispatching unboundedly.
      return entry.role === "gate-maintenance" ? "GATE_MAINTENANCE" : "INCOMPLETE_TERMINUS";
    case "terminus":
      // A repair session's terminus of ANY status stays inside GATE_MAINTENANCE:
      // its edge decides between re-baselining, redispatching and escalating.
      if (entry.role === "gate-maintenance") return "GATE_MAINTENANCE";
      // An authority limit is terminal on the spot; an exhaustion-class
      // escalate still gets the deterministic router's first look, so a crash
      // between the terminus and the triage entry cannot skip triage entirely.
      if (entry.status === "escalate") {
        return entry.category === "authority" ? "ESCALATED" : "TRIAGE";
      }
      return terminusState[entry.status] as SurfaceState;
    case "gate": return gateState[entry.status] as SurfaceState;
    case "triage": return triageState[entry.verdict] as SurfaceState;
    case "close": return closeState[entry.status] as SurfaceState;
  }
}
```

- [ ] **Step 4: Correct `deriveBudgetsFromLog`**

In `src/case-file.ts`, replace the body of the `for` loop in `deriveBudgetsFromLog`
with direct attribution to the entry that records the triggering event:

```ts
  for (const entry of history) {
    switch (entry.t) {
      case "dispatch":
        // The dispatch entry IS the gateMaintenance burn: the count is derived
        // from the log, and the entry appended only if under cap, so "burned
        // live" and "derived on rebuild" are the same computation.
        if (entry.role === "gate-maintenance") used.gateMaintenance++;
        break;
      case "terminus":
        // `terminus` caps WORKER retries, so only a worker session that ended
        // without a valid result burns it. A completed or escalated terminus
        // resolved its attempt and costs nothing; a repair session's terminus
        // is already paid for on gateMaintenance by its own dispatch entry.
        if (entry.role !== "gate-maintenance" && entry.status === "incomplete") used.terminus++;
        break;
      case "gate":
        if (entry.status === "ERROR") used.gateError++;
        break;
      case "triage":
        // The triage entry IS the burn for the verdict it records — not the
        // dispatch or close that follows it, which a crash could land before.
        if (entry.verdict === "reroute") used.correction++;
        else if (entry.verdict === "retry_close") used.close++;
        break;
      case "close":
        break;
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/case-file.test.ts`
Expected: PASS (all tests in the file, including the Slice 1 gate-maintenance ones).

- [ ] **Step 6: Commit**

```bash
git add src/case-file.ts src/case-file.test.ts
git commit -m "Attribute budgets and worker resume states to the entry that caused them

A worker dispatch still at the tail is a session that ended without a
result, and an exhaustion-class escalate still needs triage's first look —
the shipped table would resume a crash into a duplicate dispatch or a
skipped triage. The blanket terminus and close counts likewise charged a
clean run's completed terminus and accepted close against budgets that
exist only to cap retries, which slice 2's happy path hits on its first
run."
```

---

## Task 2: Position past the first worker dispatch, and the `AGENT_ACTIVE` edge ✅ DONE (deliver-slice)

The driver's position rule gains its second half: once a worker `dispatch` entry
exists, position comes from `deriveStateFromEntry(logTail)`. The `AGENT_ACTIVE` edge
then dispatches the worker session.

Worker and gate-maintenance dispatch are the same three writes (append `dispatch`,
invoke the port, append `terminus`) followed by the same routing question, so this
task extracts Slice 1's `dispatchGateMaintenance` body into a shared
`dispatchSession` and has both callers use it. Routing goes through
`deriveStateFromEntry` on the terminus entry that was just appended — so the state a
live run moves to is, by construction, the state a resumed run derives from the log.

`advance` also gains an `ESCALATED` position case: an authority-class terminus derives
to `ESCALATED`, so a crash between appending that terminus and writing the outcome
must resume onto a legal edge rather than throwing.

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `deriveStateFromEntry` and `deriveBudgetsFromLog` with Task 1's corrected
  worker semantics.
- Produces, all module-private in `src/surface.ts`:
  - `workerAttempt(history: HistoryEntry[]) => number` — the worker attempt in
    flight, `1 + count of triage entries with verdict "reroute"`.
  - `retriesOf(history: HistoryEntry[], role: "worker" | "gate-maintenance", attempt: number) => number`
    — prior same-role, same-attempt `terminus` entries with `status: "incomplete"`.
  - `dispatchSession(dir: string, caseFile: CaseFile, location: SurfaceLocation, ports: SurfacePorts, role: "worker" | "gate-maintenance", attempt: number) => Promise<AdvanceResult>`
    — appends the dispatch, invokes the agent, appends the terminus, and routes on
    `deriveStateFromEntry` of that terminus (terminating if it derives `ESCALATED`).
  - `escalateFromTail(dir, caseFile, location, ports, source: string) => Promise<AdvanceResult>`
    — terminal `ESCALATED` handling that reads its reason off the tail terminus.

- [ ] **Step 1: Write the failing tests**

First **amend the existing Slice 1 test** `"throws IllegalStateTransition naming the
state it cannot advance from"` in `src/surface.test.ts`. It currently reaches
`AGENT_ACTIVE`, which this task implements. Point it at `TRIAGE`, which this slice
still cannot advance from:

```ts
  it("throws IllegalStateTransition naming the state it cannot advance from", async () => {
    // An exhaustion-class escalate sits at TRIAGE, whose edge is slice 3's.
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "exhaustion", rationale: "out of ideas",
    });

    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      IllegalStateTransition,
    );
    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      /TRIAGE/,
    );
  });
```

Then add a new `describe` block at the end of `src/surface.test.ts`. It reuses the
file's existing `budgets`, `gateRef`, `scriptedAgent`, `portsWith`, `provisioned` and
`PASSING_TAP` helpers:

```ts
describe("the AGENT_ACTIVE edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision + baseline a healthy surface, leaving it at AGENT_ACTIVE. */
  async function readyForWorker(ports: SurfacePorts): Promise<SurfaceLocation> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    return location;
  }

  it("dispatches a worker session and records the dispatch/terminus pair", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "wrote the feature" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATING", done: false });
    expect(agent.calls).toEqual(["worker:worker-1-0"]);
    const { history, cursor } = await load(dir);
    expect(history).toEqual([
      { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" },
      {
        t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
        status: "completed", rationale: "wrote the feature",
      },
    ]);
    expect(cursor.state).toBe("GATING");
  });

  it("ends the surface in ESCALATED when the worker reports an authority limit", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "authority", rationale: "needs a credential I do not hold" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("ESCALATED");
    expect(reloaded.outcome?.kind).toBe("escalated");
    expect(reloaded.outcome?.source).toBe("worker");
    expect(reloaded.outcome?.reason).toContain("credential");
    // The terminus already evidences the escalate — no extra entry is written.
    expect(reloaded.history).toHaveLength(2);
  });

  it("routes an exhaustion-class escalate to TRIAGE rather than straight out", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "out of ideas" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    // The deterministic router gets first look; its edge is slice 3's.
    expect(result).toEqual({ state: "TRIAGE", done: false });
    expect((await load(dir)).outcome).toBeUndefined();
  });

  it("routes a session that ended without a result to INCOMPLETE_TERMINUS", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "INCOMPLETE_TERMINUS", done: false });
  });

  it("resumes an authority escalate recorded before the outcome was written", async () => {
    // The crash window between appending the terminus and writing the outcome.
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "authority", rationale: "needs an owner's sign-off",
    });

    const result = await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    expect((await load(dir)).outcome?.reason).toContain("sign-off");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts`
Expected: FAIL — the new tests throw `IllegalStateTransition` from `advance`'s default
arm (`AGENT_ACTIVE` has no case yet).

- [ ] **Step 3: Implement the position rule, the shared dispatch, and the edge**

In `src/surface.ts`:

Replace `position` with the full rule (the pre-first-worker-dispatch segment is
unchanged; the `else` half is new). Note the ordering: the baseline check must stay
*above* the tail read for the no-worker-dispatch case, so a pre-task repair that has
already re-baselined lands on `AGENT_ACTIVE` rather than re-entering
`GATE_MAINTENANCE` and calling `recordBaseline` a second time.

```ts
/**
 * Where the surface actually is, derived rather than trusted.
 *
 * Before the first worker dispatch there are no worker log entries to read, so
 * the header's set-once `baseline` and the cursor are authoritative — this is
 * the one segment of the loop where that is true. Once a worker dispatch entry
 * exists the log tail is authoritative, which is what makes a resumed position
 * and a rebuilt cursor incapable of disagreeing.
 */
function position(caseFile: CaseFile): SurfaceState {
  const tail = logTail(caseFile);
  const workerStarted = caseFile.history.some(
    (e) => e.t === "dispatch" && e.role !== "gate-maintenance",
  );
  if (workerStarted && tail) return deriveStateFromEntry(tail);
  if (caseFile.header.baseline === null) {
    if (tail) return deriveStateFromEntry(tail);
    return caseFile.cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING";
  }
  return "AGENT_ACTIVE";
}
```

Replace `gateMaintenanceRetries` with a role-general helper, and add the worker
attempt counter:

```ts
/**
 * Prior same-role, same-attempt sessions that ended without a valid result.
 * Log-derived, so a crashed dispatch's own re-run computes the same sessionKey
 * and stays idempotent, while a genuine retry after a recorded incomplete
 * terminus gets a new one.
 */
function retriesOf(
  history: HistoryEntry[],
  role: "worker" | "gate-maintenance",
  attempt: number,
): number {
  return history.filter(
    (e) =>
      e.t === "terminus" &&
      (e.role ?? "worker") === role &&
      e.attempt === attempt &&
      e.status === "incomplete",
  ).length;
}

/**
 * The worker attempt in flight. Only a reroute verdict advances it: a
 * terminus-retry re-dispatches the SAME attempt, which is what keeps its cost
 * attributed to the terminus population rather than to corrections.
 */
function workerAttempt(history: HistoryEntry[]): number {
  return 1 + history.filter((e) => e.t === "triage" && e.verdict === "reroute").length;
}
```

Add the terminal `ESCALATED` helper (it replaces the inline `terminate` calls that
read a tail rationale):

```ts
/** Terminal escalation whose reason is the tail terminus's own rationale. */
function escalateFromTail(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);
  return terminate(dir, caseFile, location, ports, "ESCALATED", {
    kind: "escalated",
    source,
    reason: tail?.t === "terminus" ? tail.rationale : "the session escalated",
    at: new Date().toISOString(),
  });
}
```

Add the shared dispatch, and rewrite `dispatchGateMaintenance` to use it:

```ts
/**
 * Dispatch one agent session and route on what it returned.
 *
 * The dispatch entry, the invoke and the terminus entry are one edge: routing
 * goes through `deriveStateFromEntry` on the terminus just appended, so the
 * state a live run moves to and the state a resumed run derives from the log
 * are the same computation rather than two rules that can drift apart.
 */
async function dispatchSession(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  role: "worker" | "gate-maintenance",
  attempt: number,
): Promise<AdvanceResult> {
  const sessionKey = `${role}-${attempt}-${retriesOf(caseFile.history, role, attempt)}`;

  await appendEntry(dir, { t: "dispatch", role, attempt, sessionKey });
  const terminus = await ports.agent.invoke(
    { role },
    { worktreePath: worktreeOf(caseFile, location), dir, sessionKey },
  );
  const entry: HistoryEntry = {
    t: "terminus",
    role,
    attempt,
    sessionKey,
    status: terminus.status,
    ...(terminus.status === "escalate" ? { category: terminus.category } : {}),
    rationale: terminus.rationale,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  if (state === "ESCALATED") {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: role,
      reason: terminus.rationale,
      at: new Date().toISOString(),
    });
  }
  await updateCursor(dir, { state });
  return { state, done: false };
}

/**
 * Dispatch one repair session, or escalate if the gate-maintenance budget is
 * spent. The dispatch entry IS the budget burn: the count is derived from the
 * log first, and the entry appended only if under cap, so "burned live" and
 * "derived from the log on rebuild" are the same computation by construction.
 */
async function dispatchGateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  reason: string,
): Promise<AdvanceResult> {
  const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
  const { used, max } = budgets.gateMaintenance;
  if (used >= max) {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: "gate-maintenance",
      reason: `gateMaintenance budget exhausted (${used}/${max}): ${reason}`,
      at: new Date().toISOString(),
    });
  }

  return dispatchSession(
    dir, caseFile, location, ports,
    "gate-maintenance", gateMaintenanceAttempt(caseFile.history),
  );
}
```

`gateMaintenanceAttempt` still needs `isGateMaintenanceTerminus`, so leave both in
place; delete `gateMaintenanceRetries`, which `retriesOf` replaces.

Add the edge, and wire it plus the `ESCALATED` resume case into `advance`'s switch:

```ts
/**
 * Dispatch the worker session for the attempt in flight. Every terminus this
 * can return is routed by `dispatchSession`: completed to GATING, an authority
 * limit straight out, an exhaustion-class escalate to the deterministic
 * router, and a session that ended without a result to INCOMPLETE_TERMINUS.
 */
function agentActive(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  return dispatchSession(
    dir, caseFile, location, ports, "worker", workerAttempt(caseFile.history),
  );
}
```

```ts
    case "AGENT_ACTIVE":
      return agentActive(dir, caseFile, location, ports);
    case "ESCALATED":
      // The crash window between recording an authority-class terminus and
      // writing the outcome: resume onto the terminal edge, not into a throw.
      return escalateFromTail(dir, caseFile, location, ports, "worker");
```

In the `gateMaintenance` edge's existing `case "escalate":` arm, replace the inline
`terminate(...)` call with
`escalateFromTail(dir, caseFile, location, ports, "gate-maintenance")` so both
escalate paths read their reason the same way.

Check the imports at the top of `src/surface.ts`: `deriveStateFromEntry`,
`deriveBudgetsFromLog`, `appendEntry`, `updateCursor`, `logTail` and `load` are
already imported from `./case-file.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS — the new `AGENT_ACTIVE` block and every Slice 1 test in the file,
including the amended `IllegalStateTransition` one.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Dispatch a worker session and route on its terminus

Worker and repair dispatch are the same three writes and the same routing
question, so they collapse onto one helper that routes through
deriveStateFromEntry — making the state a live run moves to and the state a
resumed run derives from the log the same computation rather than two rules
that can drift."
```

---

## Task 3: The `INCOMPLETE_TERMINUS` edge ✅ DONE (deliver-slice)

A session that ended without a valid result is retried against the **same** attempt —
onto the worktree as the crashed or capped session left it, with a fresh `sessionKey`
— on the `terminus` budget, and escalates at cap.

The edge covers two entry points with one rule. If the tail is a worker `dispatch`
with no terminus, the session ended without recording anything (a crash observed only
on the next process's resume): append the missing `incomplete` terminus and return, so
the next `advance` sees the entry present exactly once and derives the budget with it
counted. If the tail is already the `incomplete` terminus (the crash was observed
within the live process), retry or escalate directly. This mirrors the shape Slice 1
gave `gateMaintenance`.

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `dispatchSession`, `retriesOf`, `terminate` (Task 2);
  `deriveBudgetsFromLog` (Task 1).
- Produces: module-private
  `incompleteTerminus(dir, caseFile, location, ports) => Promise<AdvanceResult>`,
  wired into `advance`'s switch under `case "INCOMPLETE_TERMINUS"`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/surface.test.ts`:

```ts
describe("the INCOMPLETE_TERMINUS edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  async function readyForWorker(ports: SurfacePorts): Promise<SurfaceLocation> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports);
    return location;
  }

  it("retries the same attempt with a fresh session key", async () => {
    const agent = scriptedAgent([
      { status: "incomplete", rationale: "hit the turn cap" },
      { status: "completed", rationale: "finished on the retry" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);
    await advance(dir, location, ports); // AGENT_ACTIVE -> INCOMPLETE_TERMINUS

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATING", done: false });
    // Same attempt — a retry of the attempt that produced no valid result, not
    // a new one — and a distinct session, because sessions are reconstructed.
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-1-1"]);
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "dispatch").every((e) => e.attempt === 1)).toBe(true);
  });

  it("escalates once the terminus budget is spent, naming the population and cap", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);
    const ports = portsWith(agent);
    // A cap of 2 makes the whole scenario short: two incomplete sessions, then out.
    await updateCursor(dir, { budgets: { ...budgets, terminus: { used: 0, max: 2 } } });
    const location = await readyForWorker(ports);

    let result = await advance(dir, location, ports);
    for (let step = 0; step < 10 && !result.done; step++) {
      result = await advance(dir, location, ports);
    }

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.outcome?.kind).toBe("escalated");
    // REVIEW FIX: the source is the ROLE whose retries ran out (matching slice
    // 1's "gate-maintenance"); the population and cap are named in the reason.
    expect(reloaded.outcome?.source).toBe("worker");
    expect(reloaded.outcome?.reason).toContain("terminus budget exhausted (2/2)");
    // Exactly the cap: two sessions dispatched, no third.
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-1-1"]);
  });

  it("records the missing terminus for a dispatch that never recorded one", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "finished on the retry" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);
    // A crash between appending the dispatch and appending its terminus.
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });

    const recorded = await advance(dir, location, ports);

    expect(recorded).toEqual({ state: "INCOMPLETE_TERMINUS", done: false });
    const { history } = await load(dir);
    const tail = history.at(-1);
    expect(tail?.t).toBe("terminus");
    expect(tail).toMatchObject({ status: "incomplete", attempt: 1, sessionKey: "worker-1-0" });
    // No duplicate session was dispatched for the crashed one.
    expect(agent.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "INCOMPLETE_TERMINUS edge"`
Expected: FAIL with `IllegalStateTransition` naming `INCOMPLETE_TERMINUS` — the edge
has no case in `advance`'s switch yet.

- [ ] **Step 3: Implement the edge**

In `src/surface.ts`, add:

```ts
/**
 * Retry a worker session that ended without a valid result, or escalate.
 *
 * A dangling dispatch is not a session to resurrect — sessions are
 * reconstructed, never resumed — so the missing terminus is recorded first and
 * the ordinary bounded retry handles it from there. That terminus is the one
 * and only one ever written for the dispatch, so no double burn arises whether
 * the crash was observed live or only on the next process's resume.
 */
async function incompleteTerminus(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "dispatch") {
    await appendEntry(dir, {
      t: "terminus",
      role: "worker",
      attempt: tail.attempt,
      sessionKey: tail.sessionKey,
      status: "incomplete",
      rationale: "worker session ended without recording a terminus (recovered on resume)",
    });
    return { state: "INCOMPLETE_TERMINUS", done: false };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "INCOMPLETE_TERMINUS", "retry-worker");
  }

  // The terminus entry that triggered this edge is already in the log, so the
  // count is correct with zero additional writes — including at cap, where no
  // redispatch ever follows to record the final burn.
  const { used, max } = deriveBudgetsFromLog(
    caseFile.history,
    caseFile.cursor.budgets,
  ).terminus;
  if (used >= max) {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: "worker",
      reason: `terminus budget exhausted (${used}/${max}): ${tail.rationale}`,
      at: new Date().toISOString(),
    });
  }

  // Re-dispatch onto the worktree as the crashed or capped session left it,
  // with the SAME attempt number: this is a retry of that attempt, not a new
  // one, which is what keeps its cost on terminus rather than correction.
  return dispatchSession(dir, caseFile, location, ports, "worker", tail.attempt);
}
```

Wire it into `advance`'s switch:

```ts
    case "INCOMPLETE_TERMINUS":
      return incompleteTerminus(dir, caseFile, location, ports);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Retry a worker session that ended without a result, bounded by its budget

A crash, cap or timeout is a retry of the same attempt onto the tree as it
was left, not a new attempt — reusing the attempt number is what keeps the
cost on the terminus population instead of draining corrections."
```

---

## Task 4: The `GATING` edge ✅ DONE (deliver-slice)

Run the surface's pinned gate against the recorded baseline and route on the delta.
`runCheck` (Item 2) already runs the gate, computes the delta, writes the failure refs
and appends the `gate` entry, so this edge is the attempt number plus the routing.

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `workerAttempt` (Task 2); `runCheck(dir, worktreePath, attempt) => Promise<{ report: GateReport; delta: DeltaResult }>`
  from `./run-gate.js` (that module is already imported in `src/surface.ts` for
  `recordBaseline`).
- Produces: module-private
  `gating(dir, caseFile, location) => Promise<AdvanceResult>`, wired into `advance`'s
  switch under `case "GATING"`. It takes no `ports` — the gate is not a port.

- [x] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/surface.test.ts`. `FAILING_TAP` is
already defined in the file:

```ts
describe("the GATING edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision, baseline and run one worker session that writes `after`. */
  async function workerWrote(after: string): Promise<{ location: SurfaceLocation; ports: SurfacePorts }> {
    const agent: SurfacePorts["agent"] = {
      invoke: (_roleCfg, ctx) => {
        writeFileSync(join(ctx.worktreePath, "report.tap"), after);
        return Promise.resolve({ status: "completed", rationale: "made the change" });
      },
    };
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    return { location, ports };
  }

  it("gates a clean change against the baseline and moves to CLOSING", async () => {
    const { location, ports } = await workerWrote(PASSING_TAP);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "CLOSING", done: false });
    const { history, cursor } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "gate", attempt: 1, status: "PASS" });
    expect(cursor.state).toBe("CLOSING");
  });

  it("routes a change that broke the gate to TRIAGE", async () => {
    const { location, ports } = await workerWrote(FAILING_TAP);

    const result = await advance(dir, location, ports);

    // The router's edge is slice 3's; slice 2 only has to reach it.
    expect(result).toEqual({ state: "TRIAGE", done: false });
    const { history } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "gate", attempt: 1, status: "FAIL" });
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "GATING edge"`
Expected: FAIL with `IllegalStateTransition` naming `GATING`.

- [x] **Step 3: Implement the edge**

In `src/surface.ts`, add:

```ts
/**
 * Judge the worker's change against the recorded baseline. `runCheck` writes
 * the gate entry and the failure refs itself; the attempt it judges is the one
 * in flight, which is the same attempt the terminus just recorded — a
 * terminus-retry re-checks the attempt it retried, never a new one.
 */
async function gating(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
): Promise<AdvanceResult> {
  const { delta } = await runCheck(
    dir,
    worktreeOf(caseFile, location),
    workerAttempt(caseFile.history),
  );
  const state: SurfaceState = delta.pass ? "CLOSING" : "TRIAGE";
  await updateCursor(dir, { state });
  return { state, done: false };
}
```

Wire it into `advance`'s switch:

```ts
    case "GATING":
      return gating(dir, caseFile, location);
```

Add `runCheck` to the existing `./run-gate.js` import in `src/surface.ts`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Gate a worker's change against the surface's recorded baseline

The gate judges the attempt in flight, not a fresh one: a terminus retry
re-checks the attempt it retried, so the gate entry and the terminus that
produced it always name the same attempt."
```

---

## Task 5: The `CLOSING` edge ✅ DONE (deliver-slice)

Hand the accepted work to the `CloserPort`, record what it reported, and either close
the surface or route the failure to the router. `CloseEntry.detailRef` is required, so
the report's detail is written with `writeRef` first — keyed by the count of prior
`close` entries, so a future `retry_close` cycle cannot overwrite the ref an earlier
entry still points at.

REVIEW ADDITION: the edge also gets a `CLOSED` resume case, for exactly the reason
Task 2 gave `ESCALATED` one. `setOutcome` lands *after* the `close` entry, so a crash
in between leaves a surface whose tail derives `CLOSED` with no outcome written;
without the case that resume throws `IllegalStateTransition` instead of finishing.

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `worktreeOf` (Slice 1); `writeRef(dir, refId, data) => Promise<string>`
  and `setOutcome(dir, outcome) => Promise<void>` from `./case-file.js`.
- Produces: module-private
  `closing(dir, caseFile, location, ports) => Promise<AdvanceResult>` and
  `closed(dir, reason) => Promise<AdvanceResult>`, wired into `advance`'s switch
  under `case "CLOSING"` and `case "CLOSED"`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/surface.test.ts`:

```ts
describe("the CLOSING edge", () => {
  let dir: string;
  const location: SurfaceLocation = { repoPath: "/unused", worktreePath: "/unused" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    // A baselined surface whose attempt 1 passed the gate sits at CLOSING.
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "completed", rationale: "made the change",
    });
    await appendEntry(dir, { t: "gate", attempt: 1, status: "PASS", newFailures: [] });
  });

  it("closes the surface when the closer accepts the work", async () => {
    const ports = portsWith(unusedAgent());

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "CLOSED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("CLOSED");
    expect(reloaded.outcome?.kind).toBe("closed");
    const tail = reloaded.history.at(-1);
    expect(tail).toMatchObject({ t: "close", status: "DONE", detailRef: "close-0" });
    expect(await readRef(dir, "close-0")).toMatchObject({ status: "DONE" });
  });

  it("routes a close that failed to TRIAGE with the report recorded", async () => {
    const failingCloser = {
      close: () => Promise.resolve({ status: "FAIL" as const, detail: "the merge conflicted" }),
    };

    const result = await advance(
      dir, location,
      { agent: unusedAgent(), triage: unusedTriage(), closer: failingCloser },
    );

    expect(result).toEqual({ state: "TRIAGE", done: false });
    const reloaded = await load(dir);
    expect(reloaded.outcome).toBeUndefined();
    expect(reloaded.history.at(-1)).toMatchObject({ t: "close", status: "FAIL" });
    expect(await readRef(dir, "close-0")).toMatchObject({ detail: "the merge conflicted" });
  });

  it("resumes an accepted close recorded before the outcome was written", async () => {
    // The crash window between appending the close entry and setOutcome.
    await appendEntry(dir, { t: "close", status: "DONE", detailRef: "close-0" });

    const result = await advance(dir, location, portsWith(unusedAgent()));

    expect(result).toEqual({ state: "CLOSED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("CLOSED");
    expect(reloaded.outcome?.kind).toBe("closed");
    // No second close was attempted: the log already carries the accepted one.
    expect(reloaded.history.filter((e) => e.t === "close")).toHaveLength(1);
  });
});
```

Add `readRef` to the `./case-file.js` import at the top of `src/surface.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "CLOSING edge"`
Expected: FAIL with `IllegalStateTransition` naming `CLOSING` (and `CLOSED` for the
resume test).

- [ ] **Step 3: Implement the edge**

In `src/surface.ts`, add:

```ts
/**
 * Do something with the accepted work. Acceptance and close are separate
 * events: GATING decided the change is good, this decides what happens to it.
 *
 * The ref key counts prior close entries so a retried close cannot overwrite
 * the detail an earlier close entry still points at.
 */
async function closing(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const report = await ports.closer.close(
    { worktreePath: worktreeOf(caseFile, location), dir },
    { kind: "accepted" },
  );

  const priorCloses = caseFile.history.filter((e) => e.t === "close").length;
  const detailRef = await writeRef(dir, `close-${priorCloses}`, report);
  await appendEntry(dir, { t: "close", status: report.status, detailRef });

  if (report.status !== "DONE") {
    await updateCursor(dir, { state: "TRIAGE" });
    return { state: "TRIAGE", done: false };
  }

  return closed(dir, report.detail);
}

/**
 * Record the terminal CLOSED outcome. Split out so the resume case can reuse
 * it without re-running the closer.
 */
async function closed(dir: string, reason: string): Promise<AdvanceResult> {
  await setOutcome(dir, {
    kind: "closed",
    source: "closer",
    reason,
    at: new Date().toISOString(),
  });
  await updateCursor(dir, { state: "CLOSED" });
  return { state: "CLOSED", done: true };
}
```

Wire both into `advance`'s switch:

```ts
    case "CLOSING":
      return closing(dir, caseFile, location, ports);
    case "CLOSED":
      // The crash window between appending an accepted close entry and writing
      // the outcome. The close already happened — never re-run the closer.
      return closed(dir, "the closer accepted the work (outcome recorded on resume)");
```

Add `writeRef` to the existing `./case-file.js` import in `src/surface.ts`
(`setOutcome` is already imported).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Close an accepted surface through the closer port

The close report's detail is stored as a ref keyed by the count of prior
close entries, so a later retried close cannot overwrite the detail an
earlier entry still points at."
```

---

## Task 6: `run` — the loop over `advance` ✅ DONE (deliver-slice)

`advance` performs exactly one transition; `run` calls it until the surface is
terminal and reads back the outcome. Slice 1 deliberately shipped no `run` because
nothing could reach a terminal state through the loop; with the happy path closed, it
can be written honestly.

**Files:**
- Modify: `src/surface.ts`, `src/index.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `advance(dir, location, ports) => Promise<AdvanceResult>`; `load` from
  `./case-file.js`.
- Produces:
  ```ts
  export interface RunResult {
    state: SurfaceState;
    outcome?: CaseFileOutcome;
  }
  export function run(dir: string, location: SurfaceLocation, ports: SurfacePorts): Promise<RunResult>;
  ```
  Both exported from `src/surface.ts` and re-exported from `src/index.ts`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/surface.test.ts`:

```ts
describe("run", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** A worker that adds a file and leaves the gate passing. */
  function cleanWorker(): SurfacePorts["agent"] {
    return {
      invoke: (_roleCfg, ctx) => {
        writeFileSync(join(ctx.worktreePath, "feature.txt"), "the change\n");
        return Promise.resolve({ status: "completed", rationale: "added the feature" });
      },
    };
  }

  it("drives a fresh surface all the way to CLOSED with no intervention", async () => {
    const ports = portsWith(cleanWorker());
    const repoPath = initTempRepo("surface-repo-", { "report.tap": PASSING_TAP });
    const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");

    const result = await run(dir, { repoPath, worktreePath }, ports);

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.kind).toBe("closed");
    const { history } = await load(dir);
    expect(history.map((e) => e.t)).toEqual(["dispatch", "terminus", "gate", "close"]);
  });

  it("produces the same sequence of states every time, given the same script", async () => {
    async function statesOf(): Promise<SurfaceState[]> {
      const caseDir = await mkdtemp(join(tmpdir(), "surface-case-"));
      await create(caseDir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
      const ports = portsWith(cleanWorker());
      const repoPath = initTempRepo("surface-repo-", { "report.tap": PASSING_TAP });
      const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");
      const seen: SurfaceState[] = [];
      let step: AdvanceResult = { state: "PROVISIONING", done: false };
      while (!step.done) {
        step = await advance(caseDir, { repoPath, worktreePath }, ports);
        seen.push(step.state);
      }
      return seen;
    }

    expect(await statesOf()).toEqual(await statesOf());
    expect(await statesOf()).toEqual([
      "PRE_GATING", "AGENT_ACTIVE", "GATING", "CLOSING", "CLOSED",
    ]);
  });
});
```

Add `run` to the `./surface.js` import at the top of `src/surface.test.ts`, along with
`import type { AdvanceResult } from "./surface.js";` and `SurfaceState` on the
existing `./schema.js` type import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "run"`
Expected: FAIL — `run` is not exported from `./surface.js`.

- [ ] **Step 3: Implement `run`**

At the end of `src/surface.ts`:

```ts
export interface RunResult {
  state: SurfaceState;
  outcome?: CaseFileOutcome;
}

/**
 * Advance the surface until it is terminal, then read back its outcome.
 *
 * No step cap: every non-terminal advance either appends an entry or throws,
 * and the budget caps bound how many entries the loop can produce. Safe to
 * call from a fresh process against an existing `dir` — it is just `advance`,
 * which resumes onto a legal edge from whatever is on disk.
 */
export async function run(
  dir: string,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<RunResult> {
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
  } while (!result.done);

  const { outcome } = await load(dir);
  return { state: result.state, outcome };
}
```

REVIEW FIX: in `src/index.ts`, **replace** the two existing surface export lines
(`export { advance } from "./surface.js";` and
`export type { AdvanceResult } from "./surface.js";`) with the two below — adding them
alongside the existing ones is a duplicate-export error:

```ts
export { advance, run } from "./surface.js";
export type { AdvanceResult, RunResult } from "./surface.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts src/index.ts
git commit -m "Add run, the loop that advances a surface to a terminal state

Slice 1 shipped advance alone because nothing could reach a terminal state
through the loop; with the happy path closed, run can be written honestly."
```

---

## Task 7: The happy-path demo script ✅ DONE (deliver-slice)

The runnable artefact the slice's UAT reads: one printed run showing every state from
provisioning through to closed, against a real temporary git repository and a scripted
worker, with no manual intervention between states.

**Files:**
- Create: `demos/single-surface-slice-2-happy-path.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `create`, `load` from `../src/case-file.js`; `initTempRepo` from
  `../src/temp-repo.js`; `advance` from `../src/surface.js`; `noopCloser` and the port
  types from `../src/ports.js`.

- [ ] **Step 1: Write the demo script**

Create `demos/single-surface-slice-2-happy-path.ts`. It uses `advance` in a loop
rather than `run` so every state can be printed as it is reached — that printed
sequence is what the UAT reads:

```ts
/**
 * UAT demo for Single-Surface State Machine Slice 2: Drive a Worker's Change
 * Through the Gate to a Decision.
 *
 * Provisions a fresh surface against a real temporary git repository,
 * dispatches a scripted worker that produces a clean change, and lets the
 * driver run to completion unattended — printing every state on the way.
 *
 * Usage: npx tsx demos/single-surface-slice-2-happy-path.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate is a plain shell command over the project's TAP output.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback in the happy path — triage is slice 3")),
};

/** Adds a file to the worktree and leaves the gate passing. */
const cleanWorker: AgentPort = {
  invoke: (_roleCfg, ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the change\n");
    return Promise.resolve({ status: "completed", rationale: "added the feature" });
  },
};

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-case-"));
  const repoPath = initTempRepo("surface-demo-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-tree-")),
    "wt",
  );
  const location: SurfaceLocation = { repoPath, worktreePath };
  const ports: SurfacePorts = { agent: cleanWorker, triage: unusedTriage, closer: noopCloser };

  await create(
    dir,
    { surfaceId: "demo-happy-path", taskDef: { intent: "add a feature" }, gateRef },
    budgets,
  );

  console.log("=== Happy path: nothing to done, unattended ===");
  console.log("State: PROVISIONING (fresh case file, no worktree)");

  let done = false;
  while (!done) {
    const step = await advance(dir, location, ports);
    console.log(`State: ${step.state}`);
    done = step.done;
  }

  const caseFile = await load(dir);
  console.log(`\nWorktree created:   ${fs.existsSync(worktreePath)}`);
  console.log(`Worker's change:    ${fs.existsSync(path.join(worktreePath, "feature.txt"))}`);
  console.log(`Baseline captured:  ${caseFile.header.baseline?.status ?? "none"}`);
  console.log(`History:            ${caseFile.history.map((e) => e.t).join(" -> ")}`);
  console.log(
    `Outcome:            ${caseFile.outcome?.kind ?? "none"} — ${caseFile.outcome?.reason ?? ""}`,
  );
}

await main();
```

- [ ] **Step 2: Add the run story to `package.json`**

In `package.json`, add to `scripts`, immediately after `demo:surface-slice-1`:

```json
    "demo:surface-slice-2": "npx tsx demos/single-surface-slice-2-happy-path.ts",
```

- [ ] **Step 3: Run the demo and check its output**

Run: `npm run demo:surface-slice-2`
Expected: a single printed run, states in this order and no others:

```
State: PROVISIONING (fresh case file, no worktree)
State: PRE_GATING
State: AGENT_ACTIVE
State: GATING
State: CLOSING
State: CLOSED
```

followed by `Worktree created: true`, `Worker's change: true`,
`Baseline captured: PASS`, `History: dispatch -> terminus -> gate -> close`, and
`Outcome: closed — no-op closer (Item 6 ships real closers)`.

- [ ] **Step 4: Check lint and types**

Run: `npm run lint`
Expected: clean. (`demos/` is linted by ESLint but not compiled by `tsc`'s `include`.)

- [ ] **Step 5: Commit**

```bash
git add demos/single-surface-slice-2-happy-path.ts package.json
git commit -m "Add the happy-path demo for the single-surface driver

The slice's UAT is read off a printed run: every state from provisioning to
closed against a real temporary repo and a scripted worker, with no manual
intervention between them."
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| A clean worker session runs the gate against the recorded baseline | Tasks 2 (dispatch → `GATING`) and 4 (`runCheck` against `header.baseline`) |
| No new failures → closing; an accepting closer → closed | Tasks 4 (`delta.pass → CLOSING`) and 5 (`DONE → CLOSED` + outcome) |
| A session with no valid result is retried once against the same attempt; repeated exhaustion escalates | Task 3 (same-attempt redispatch, `terminus` cap escalation), resting on Task 1's `terminus` attribution |
| A confident authority-limit escalate ends the surface escalated directly | Tasks 1 (`category` branch) and 2 (`dispatchSession`'s terminal route, plus the `ESCALATED` resume case) |
| The same happy-path scenario produces the same state sequence twice | Task 6 (determinism test), resting on `run` and on routing through `deriveStateFromEntry` |
| UAT: one printed run, provisioning through closed, unattended | Task 7 |

No gaps.

**2. Placeholder scan:** none. Every step carries the actual code or the exact command
and expected output; no "handle edge cases", no "similar to Task N", no TBD.

**3. Type consistency:** `dispatchSession`, `retriesOf`, `workerAttempt`,
`escalateFromTail`, `incompleteTerminus`, `gating`, `closing`, `closed`, `run`,
`RunResult` are each defined once and used with the same signature everywhere they
appear. `role` values are the schema's `"worker" | "gate-maintenance"` throughout;
`sessionKey` is `${role}-${attempt}-${retryCount}` in the implementation, in the tests
(`worker-1-0`, `worker-1-1`) and in Slice 1's existing gate-maintenance keys. Budget
population names match `BudgetSet`'s keys exactly.

**4. Right-choice re-audit**

| Decision | Pre-planning choice | What the plan does | Easy or Right? |
|---|---|---|---|
| Worker vs repair dispatch | One shared helper, not a second copy | Task 2 extracts `dispatchSession` and rewrites `dispatchGateMaintenance` onto it | Right |
| Live routing vs resume routing | One computation, not two rules | `dispatchSession` routes through `deriveStateFromEntry` on the entry it just appended | Right |
| Budget attribution | Fix all four populations at once | Task 1 corrects `terminus`, `close` and `correction` together with `gateMaintenance` | Right (the easy choice — fix only `terminus`, which Slice 2 reads — would leave the accepted close over-charged the moment Slice 3 checks that cap) |
| The existing test asserting `terminus.used === 1` for a completed terminus | Amend it | Task 1 Step 1 rewrites the assertion and its comment | Right — it asserts behaviour being replaced, so leaving it green would mean the derivation was not actually corrected |
| Reaching `TRIAGE` with no `TRIAGE` edge | Return the state; let `advance` throw `IllegalStateTransition` naming it | Out-of-scope note plus the amended Slice 1 test | Right — the alternative (a placeholder triage stub) would be dead code Slice 3 deletes |
| `run`'s loop | No step cap | Task 6, with the reason in the doc comment | Right — a cap would be a second, weaker bound competing with the budgets |
| Attempt for `runCheck` | Derive from the log (`workerAttempt`) | Task 4 | Right — passing it down from the dispatch edge would make the gate entry's attempt depend on call order rather than on the log |
| `ESCALATED` and `CLOSED` as resumable positions | Add both cases | Tasks 2 and 5 | Right — both terminal edges write their entry before their outcome, so both leave the identical crash window; closing one and not the other would be arbitrary |

No drift. Both spec lenses hold: nothing is hand-rolled that `case-file.ts`,
`run-gate.ts` or the ports already provide (buy-vs-build), and the slice's run/verify
story is the `demo:surface-slice-2` script plus the existing `npm test` /
`npm run lint` (operability), with error paths that name the state, the attempted
edge, and the exhausted population and its cap.

**5. Scaffolding drift check**

- `package.json` `scripts` → Task 7. Present.
- `src/index.ts` → Task 6. Present.
- Behaviours this slice changes, and what describes them:
  - Budget attribution (`terminus`, `close`, `correction`) — described in
    `docs/single-surface-control-flow.md` only as population *purposes*
    ("terminus retries (abnormal ends)", "close retries — a post-acceptance close
    that flaked"). The corrected attribution makes the code match those descriptions
    rather than contradicting them; no doc edit needed.
  - Worker resume states — `docs/single-surface-control-flow.md` already states
    `tail = dispatch, no terminus → treat as INCOMPLETE_TERMINUS` and documents the
    exhaustion/authority split. No doc edit needed.
  - The `AGENT_ACTIVE` / `GATING` / `CLOSING` / terminus-retry edges — already
    documented in the control-flow doc's state list; this slice implements them
    rather than changing them.
  - `sessionKey`'s shape, the close ref key, and `run` — internal to the driver and
    described only in the design spec, which is the source this plan implements.
- New commands: `npm run demo:surface-slice-2` (Task 7). New dependencies: none. New
  build, test or deploy steps: none.
- No embedded skill in this repo documents the driver's states or budgets (checked
  `docs/`, `README.md`, `CONTRIBUTING.md`; there is no `.claude/` skills directory).

No missing updates.
