# Single-Surface State Machine — Slice 4: Stop Cleanly When a Retry Budget Runs Out

> **Status:** ✅ Complete — 2026-09-09 — `f6c93b5`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Goal:** Make every budget cap the surface enforces stop the run at exactly its cap, say which population ran out in one uniform, greppable sentence, and prove — by test and by demo — that each population is burned only by the kind of setback it belongs to, live and on resume.

**Architecture:** The enforcement itself is already in place from Slices 1–3: `dispatchGateMaintenance` caps `gateMaintenance`, `incompleteTerminus` caps `terminus`, and `deterministicRouter` caps `correction` and `close` from the log-derived budgets `TRIAGE` hands it. This was verified empirically before planning (see "What already works", below) — all four scenarios already escalate at exactly their cap. What is missing is the slice's own two deliverables: (1) the DX contract the Operational note demands — today the three exhaustion messages are three hand-rolled strings in two modules with two different shapes, so a reader cannot reliably tell "ran out of retries" from any other escalation; (2) the evidence, since only one of the four caps has a test and none of the independence or resume claims does. So this slice adds one shared `budgetExhausted` formatter, converts the three call sites to it, locks all four caps plus independence plus resume under test, and ships the demo that prints the counts against the caps.

**Tech Stack:** TypeScript (ESM, `node:` builtins), Zod schemas, Vitest, `tsx` for demos.

### What already works (verified before planning, not assumed)

A throwaway script ran all four exhaustion scenarios against `run()` on the
current HEAD. Every one terminated at its cap. These are the numbers the plan's
tests and demo assert, and they are observations, not predictions:

| Scenario | Final state | Population spent | Other populations | Structure |
|---|---|---|---|---|
| Worker always returns an exhaustion-class escalate | `ESCALATED` | `correction` 3/3 | all 0 | 4 worker dispatches, 4 triage entries (3 `reroute` + 1 `escalate`) |
| Worker's change breaks the gate; repair never fixes it | `ESCALATED` | `gateMaintenance` 2/2 | `gateError` 3/3 (tracked, never gated — see below) | 1 worker + 2 repair dispatches, 3 `gate` ERROR entries, 3 triage entries |
| Worker session always ends `incomplete` | `ESCALATED` | `terminus` 5/5 | all 0 | 5 worker dispatches, 0 triage entries |
| Closer always rejects the work | `ESCALATED` | `close` 3/3 | all 0 | 1 worker dispatch, 4 `close` entries, 4 triage entries |

Two facts a reader of the tests and the demo must not misread, both of which
the plan surfaces explicitly rather than papering over:

- **`gateError` is counted but never gated in this item.** The design spec's
  Budgets section says so outright: it is reserved for a future bounded,
  agent-free re-check fast path that needs a `TriageVerdict` case Item 5 owns,
  and a gate that cannot run is routed to `GATE_MAINTENANCE` on the
  `gateMaintenance` budget instead. So the gate-error scenario legitimately
  shows `gateError` at 3/3 next to the `gateMaintenance` 2/2 that actually
  stopped the run. The demo labels this; nothing in the plan gates on it.
- **A population's cap is a count of burns, not of retries.** `correction`,
  `gateMaintenance` and `close` burn on the entry that *authorises* the retry,
  so burns and retries are equal. `terminus` burns on the incomplete session
  *itself* (design spec: "`terminus` ← count of `terminus` entries with
  `status: "incomplete"`"), and the last one is never retried — so a cap of 5
  means 5 incomplete sessions and 4 retries. The demo prints both numbers with
  their labels so the reviewer reads `5/5 spent` and is not left computing.

## Global Constraints

- Node `>= 22`; TypeScript ESM with `.js` import specifiers on every relative import.
- Every gate that matters runs through `make verify` = `npm ci && npm run lint && npm test`; `npm run lint` is `eslint . && tsc --noEmit`, and `tsc` covers `src/*.test.ts` and `demos/*.ts`, so tests and demos must typecheck.
- **Buy-vs-build:** no new dependencies. Zod is the only schema library, `node:child_process`/`node:fs` the only process and filesystem surface.
- **Reuse over re-derive:** budget counts come from `case-file.ts`'s `deriveBudgetsFromLog` and nowhere else; state mapping stays in `deriveStateFromEntry` / `triageState`. No edge, test or demo may re-implement either.
- **Budgets are log-derived, never incremented.** `cursor.budgets[*].used` is a stale denormalisation; only `max` is read from the cursor. The single write an edge performs (a `triage` entry, a `dispatch` entry, an `incomplete` terminus) *is* the burn.
- **Operability/DX (this slice's Operational note):** an escalation caused by a budget cap must name the population that was exhausted and its cap. This slice makes that one format, produced in one place: `<population> budget exhausted (<used>/<max>): <detail>`. Every other error still names the state and the attempted edge (`IllegalStateTransition`), the baseline set in Slice 1.
- Each slice ships a runnable demo script (`npm run demo:surface-slice-N`) whose printed output is the harness extender's UAT surface, matching Slices 1–3.
- Slice 4 carries no Build note of its own; it inherits the item-wide one above.

## Scaffolding Impact

- `package.json` `scripts` — new `demo:surface-slice-4` entry, the run story for this slice's UAT → added in Task 4.
- `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`, Budgets section — describes how each population is counted but says nothing about what an exhaustion escalation *says*, which is exactly the DX contract this slice lands → one sentence added in Task 1, in the same commit as the formatter it describes.
- `src/run-gate.ts`'s `recordBaseline` doc comment claims "The caller retries on the gateError budget" — false for this item's driver, which routes a baseline ERROR to `GATE_MAINTENANCE` on the `gateMaintenance` budget, and misleading in exactly the way this slice exists to prevent → corrected in Task 1, the task that fixes the budget vocabulary.
- `README.md`, `CONTRIBUTING.md`, `Makefile` — checked: none mentions budgets or names any `demo:*` script, so `package.json` is the only place the new command appears. No new env var, no new dependency, no change to `make verify` or CI.

---

## Task 1: One sentence for "this budget ran out"

Three call sites escalate on a spent budget today, in two shapes:
`src/router.ts:47` writes `worker_escalate: correction budget exhausted (3/3)`,
while `src/surface.ts:243` and `src/surface.ts:414` write
`gateMaintenance budget exhausted (2/2): <detail>`. A reader scanning a
surface's history for "did this run out of retries, or fail for some other
reason?" has to know both shapes. This task gives them one, produced in one
place, so the Operational note is a property of the code rather than of three
strings that happen to agree today.

**Files:**
- Create: `src/budgets.ts`
- Test: `src/budgets.test.ts`
- Modify: `src/router.ts:40-50` (the at-cap branch)
- Modify: `src/surface.ts:238-251` (`dispatchGateMaintenance`), `src/surface.ts:405-417` (`incompleteTerminus`)
- Modify: `src/run-gate.ts:11-20` (the stale `recordBaseline` doc comment)
- Modify: `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md` (Budgets section)

**Interfaces:**
- Consumes: `Budget`, `BudgetPopulation` types from `src/schema.ts`.
- Produces: `export function budgetExhausted(population: BudgetPopulation, budget: Budget, detail: string): string` — returns `` `${population} budget exhausted (${budget.used}/${budget.max}): ${detail}` ``. Tasks 2 and 3 assert against this exact prefix; Task 4's demo prints the reason it produces.

- [ ] **Step 1: Write the failing test**

Create `src/budgets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { budgetExhausted } from "./budgets.js";

describe("budgetExhausted", () => {
  it("names the population, the cap and the setback that ran out of retries", () => {
    expect(budgetExhausted("correction", { used: 3, max: 3 }, "the worker is still stuck")).toBe(
      "correction budget exhausted (3/3): the worker is still stuck",
    );
  });

  it("uses the same shape for every population", () => {
    expect(budgetExhausted("terminus", { used: 5, max: 5 }, "hit the turn cap")).toBe(
      "terminus budget exhausted (5/5): hit the turn cap",
    );
    expect(budgetExhausted("gateMaintenance", { used: 2, max: 2 }, "the gate still cannot run")).toBe(
      "gateMaintenance budget exhausted (2/2): the gate still cannot run",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/budgets.test.ts`
Expected: FAIL — `Cannot find module './budgets.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/budgets.ts`:

```ts
import type { Budget, BudgetPopulation } from "./schema.js";

/**
 * The one sentence a budget cap escalates with.
 *
 * The roadmap's DX decision for this item is that a reader of a surface's
 * history must be able to tell "it ran out of retries" from every other kind
 * of escalation, and tell *which* retries ran out. That is a property of the
 * message, so there is exactly one message: every edge that caps a population
 * — the driver's gate-maintenance and incomplete-terminus edges, and the
 * deterministic router's at-cap branch — routes its reason through here.
 *
 * It lives in its own module rather than in `case-file.ts` (which owns
 * `deriveBudgetsFromLog`, the counting) so that `router.ts` — a pure lookup
 * table with no persistence dependency of its own — can use it without
 * importing the persistence layer for a string.
 */
export function budgetExhausted(
  population: BudgetPopulation,
  budget: Budget,
  detail: string,
): string {
  return `${population} budget exhausted (${budget.used}/${budget.max}): ${detail}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/budgets.test.ts`
Expected: PASS.

- [ ] **Step 5: Route the router's at-cap branch through it**

In `src/router.ts`, add the import below the existing type imports:

```ts
import { budgetExhausted } from "./budgets.js";
```

and replace the at-cap branch (currently `src/router.ts:43-49`):

```ts
    if (used >= max) {
      return Promise.resolve({
        verdict: "escalate",
        rationale: `${input.trigger}: ${budget} budget exhausted (${used}/${max})`,
      });
    }
```

with:

```ts
    if (used >= max) {
      return Promise.resolve({
        verdict: "escalate",
        rationale: budgetExhausted(
          budget,
          { used, max },
          `no retry remains for a ${input.trigger} setback`,
        ),
      });
    }
```

- [ ] **Step 6: Route the driver's two at-cap branches through it**

In `src/surface.ts`, add to the imports:

```ts
import { budgetExhausted } from "./budgets.js";
```

In `dispatchGateMaintenance`, replace:

```ts
    return escalate(
      dir, caseFile, location, ports, "gate-maintenance",
      `gateMaintenance budget exhausted (${used}/${max}): ${reason}`,
    );
```

with:

```ts
    return escalate(
      dir, caseFile, location, ports, "gate-maintenance",
      budgetExhausted("gateMaintenance", { used, max }, reason),
    );
```

In `incompleteTerminus`, replace:

```ts
    return escalate(
      dir, caseFile, location, ports, "worker",
      `terminus budget exhausted (${used}/${max}): ${tail.rationale}`,
    );
```

with:

```ts
    return escalate(
      dir, caseFile, location, ports, "worker",
      budgetExhausted("terminus", { used, max }, tail.rationale),
    );
```

- [ ] **Step 7: Run the affected tests to verify nothing regressed**

Run: `npx vitest run src/budgets.test.ts src/router.test.ts src/surface.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck. The two pre-existing assertions that read these
strings still hold: `src/surface.test.ts:498` expects
`"terminus budget exhausted (2/2)"` (unchanged by this task), and
`src/router.test.ts`'s at-cap case expects the rationale to contain the
population name (still true, now as the leading word).

- [ ] **Step 8: Correct the stale `recordBaseline` comment**

In `src/run-gate.ts`, the `recordBaseline` doc comment ends:

```
 * An ERROR report is returned but never stored — the baseline is immutable for
 * the surface's lifetime, so pinning a failed run would be unrecoverable. The
 * caller retries on the gateError budget.
```

That last sentence is wrong for this item's driver, which routes a baseline
ERROR to `GATE_MAINTENANCE` and pays for it on `gateMaintenance`; `gateError`
is counted but gated by nothing. Replace the sentence with:

```
 * An ERROR report is returned but never stored — the baseline is immutable for
 * the surface's lifetime, so pinning a failed run would be unrecoverable. What
 * the caller does with it is the caller's: this item's driver routes it to
 * gate maintenance, on the gateMaintenance budget.
```

- [ ] **Step 9: State the message contract in the design spec**

In `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`,
in the `## Budgets` section, immediately after the paragraph ending
"...it remains available for a future caller that needs a live counter outside
this derive-then-write pattern.", add:

```
Every escalation caused by a cap — the driver's `GATE_MAINTENANCE` and
`INCOMPLETE_TERMINUS` edges, and `TriagePort`'s own at-cap branch — writes its
reason in one shape, produced by a single formatter: `<population> budget
exhausted (<used>/<max>): <detail>`. This is the roadmap's DX decision for this
item made structural: a reader of a surface's outcome can tell "it ran out of
retries" from every other escalation, and tell which population ran out, by the
first two words, rather than by recognising one of several hand-written
sentences.
```

- [ ] **Step 10: Commit**

```bash
git add src/budgets.ts src/budgets.test.ts src/router.ts src/surface.ts src/run-gate.ts docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md
git commit -m "Escalate every spent budget with one named, capped sentence

The three at-cap branches wrote three hand-rolled strings in two shapes, so
'this ran out of retries, and it was this population' was a coincidence of
wording rather than a property of the code. One formatter now produces all
three, which is what the item's DX decision asks for: a reader of a
surface's history can tell an exhausted budget from any other escalation.
Also drops the recordBaseline comment's claim that a baseline ERROR retries
on the gateError budget — this item's driver routes it to gate maintenance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Every cap stops the run at exactly the cap, and only its own

Four populations are enforced, and exactly one of them (`terminus`) has a test.
This task locks all four, each with the structural count that proves the run
stopped at the cap rather than near it, plus the independence claim for the
`correction` scenario.

**Read this before starting.** These tests are expected to pass the moment they
compile: the enforcement they describe already exists (see "What already works"
in the header, where every number below was observed). That does not make them
redundant — an unasserted cap is one refactor away from being an infinite loop,
and the slice's acceptance criteria are these numbers. If any assertion fails,
you have found a real defect: fix the driver, never the assertion. Do not
"discover" the expected numbers by running first and writing the constants
afterwards; the numbers in Step 1 are the specification.

**Files:**
- Test: `src/surface.test.ts` (new `describe("budget caps", ...)` block, appended at the end of the file)

**Interfaces:**
- Consumes: `budgetExhausted` from Task 1 (via the escalation reason it produces); the existing `src/surface.test.ts` helpers `budgets`, `gateRef`, `PASSING_TAP`, `scriptedAgent`, `portsWithTriage`, `provisioned`, and `noopCloser`.
- Produces: no exports. Task 3 appends its resume test to the same `describe` block and reuses this task's `runToEnd` helper.

- [ ] **Step 1: Write the failing test**

First extend two existing import lines at the top of `src/surface.test.ts`.
Add `deriveBudgetsFromLog` to the `./case-file.js` import:

```ts
import { create, load, setBaseline, setOutcome, updateCursor, appendEntry, readRef, deriveBudgetsFromLog } from "./case-file.js";
```

and add `BudgetPopulation` and `HistoryEntry` to the schema type import:

```ts
import type { BudgetPopulation, BudgetSet, GateRef, HistoryEntry, SurfaceState } from "./schema.js";
```

Then append this block at the end of the file:

```ts
describe("budget caps", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision, run to a terminal state, and read back what the log says was spent. */
  async function runToEnd(
    ports: SurfacePorts,
  ): Promise<{ state: SurfaceState; reason: string; spent: BudgetSet; history: HistoryEntry[] }> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    const result = await run(dir, location, ports);
    const caseFile = await load(dir);
    return {
      state: result.state,
      reason: caseFile.outcome?.reason ?? "",
      spent: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
      history: caseFile.history,
    };
  }

  function countOf(history: HistoryEntry[], t: HistoryEntry["t"]): number {
    return history.filter((e) => e.t === t).length;
  }

  /** The reason a cap escalation must carry, per the item's DX decision. */
  function exhaustedPrefix(population: BudgetPopulation): string {
    const { max } = budgets[population];
    return `${population} budget exhausted (${max}/${max})`;
  }

  it("spends exactly the correction cap when the worker is always stuck, and nothing else", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck, try again" },
    ]);

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("correction"));
    expect(spent.correction.used).toBe(budgets.correction.max);

    // Exactly the cap: the first attempt plus one retry per correction spent,
    // and a final triage round that refused to spend a fourth.
    expect(countOf(history, "dispatch")).toBe(budgets.correction.max + 1);
    expect(
      history.filter((e) => e.t === "triage" && e.verdict === "reroute"),
    ).toHaveLength(budgets.correction.max);

    // Independence: a scenario that only ever burns corrections burns nothing else.
    expect(spent.gateError.used).toBe(0);
    expect(spent.gateMaintenance.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
    expect(spent.close.used).toBe(0);
  });

  it("spends exactly the gate-maintenance cap when the gate never runs again", async () => {
    // The worker deletes the file the gate reads, so the gate ERRORs rather
    // than failing; every repair session reports success without restoring it.
    const agent: SurfacePorts["agent"] = {
      invoke: (roleCfg, ctx) => {
        if (roleCfg.role === "worker") {
          rmSync(join(ctx.worktreePath, "report.tap"), { force: true });
          return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
        }
        return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
      },
    };

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("gateMaintenance"));
    expect(spent.gateMaintenance.used).toBe(budgets.gateMaintenance.max);

    // One repair session per gateMaintenance spent, and no more.
    expect(
      history.filter((e) => e.t === "dispatch" && e.role === "gate-maintenance"),
    ).toHaveLength(budgets.gateMaintenance.max);
    expect(
      history.filter((e) => e.t === "dispatch" && e.role === "worker"),
    ).toHaveLength(1);

    // The worker's own populations are untouched: a broken gate is not the
    // worker's setback to pay for.
    expect(spent.correction.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
    expect(spent.close.used).toBe(0);
  });

  it("spends exactly the terminus cap when the worker never returns a result", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("terminus"));
    expect(spent.terminus.used).toBe(budgets.terminus.max);

    // Each incomplete session IS the burn, so the cap is the session count —
    // the last one is never retried, and no triage round is ever reached.
    expect(countOf(history, "dispatch")).toBe(budgets.terminus.max);
    expect(countOf(history, "triage")).toBe(0);
    expect(spent.correction.used).toBe(0);
    expect(spent.gateMaintenance.used).toBe(0);
  });

  it("spends exactly the close cap when the closer always rejects the work", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "clean change" }]);
    const rejectingCloser: SurfacePorts["closer"] = {
      close: (_ctx, outcome) =>
        Promise.resolve(
          outcome.kind === "accepted"
            ? { status: "FAIL", detail: "not ready to close" }
            : { status: "DONE", detail: "torn down" },
        ),
    };

    const { state, reason, spent, history } = await runToEnd(
      portsWithTriage(agent, rejectingCloser),
    );

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("close"));
    expect(spent.close.used).toBe(budgets.close.max);

    // The first close plus one retry per close spent; the worker ran once.
    expect(countOf(history, "close")).toBe(budgets.close.max + 1);
    expect(countOf(history, "dispatch")).toBe(1);
    expect(spent.correction.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/surface.test.ts -t "budget caps" && npx tsc --noEmit`
Expected: PASS, clean typecheck — the caps these assert are already enforced,
and Task 1 gave them the reason string they match on. A failure here is a real
defect in `src/surface.ts` or `src/router.ts`: fix the driver, not the test. A
*hang* is the most serious possible failure — it means a population is not
being burned by the path that spends it — and must be fixed in the driver
before this task is committed.

- [ ] **Step 3: Commit**

```bash
git add src/surface.test.ts
git commit -m "Pin every enforced budget to its exact cap under test

Only the terminus cap had a test; correction, gateMaintenance and close were
enforced but unasserted, and nothing asserted that one population's setback
cannot drain another's budget. Each scenario now scripts a double that never
resolves, and pins both the population spent and the structural count that
proves the run stopped at the cap rather than near it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A cap reached across a restart is the same cap

The budgets are derived from the log at every check, so a run stopped partway
and picked up by a fresh process should reach the same escalation at the same
count. That is the whole reason for deriving rather than incrementing, and
nothing asserts it. The test stops a correction-burning run mid-flight, calls
`rebuild` (which rewrites the cursor from the log, the strongest available
stand-in for a new process adopting the directory), builds fresh scripted
doubles, and compares the resumed run against an uninterrupted one.

**Files:**
- Test: `src/surface.test.ts` (appended inside the `describe("budget caps", ...)` block from Task 2)

**Interfaces:**
- Consumes: `runToEnd` and `exhaustedPrefix` from Task 2's block; `rebuild` from `src/case-file.js`.
- Produces: no exports.

- [ ] **Step 1: Write the failing test**

Add `rebuild` to the `./case-file.js` import at the top of `src/surface.test.ts`:

```ts
import { create, load, setBaseline, setOutcome, updateCursor, appendEntry, readRef, deriveBudgetsFromLog, rebuild } from "./case-file.js";
```

Then append inside the `describe("budget caps", ...)` block, after the four
cap tests:

```ts
  it("reaches the same cap when the run is stopped partway and resumed from the directory", async () => {
    const stuck = (): Terminus => ({
      status: "escalate",
      category: "exhaustion",
      rationale: "stuck, try again",
    });

    // Reference: the whole scenario in one go.
    const straightThrough = await runToEnd(portsWithTriage(scriptedAgent([stuck()])));

    // The same scenario, stopped after four transitions and picked up again.
    const resumedDir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(
      resumedDir,
      { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef },
      budgets,
    );
    const firstProcess = portsWithTriage(scriptedAgent([stuck()]));
    const location = await provisioned(resumedDir, { "report.tap": PASSING_TAP }, firstProcess);
    // PRE_GATING -> AGENT_ACTIVE -> TRIAGE -> AGENT_ACTIVE -> TRIAGE: stopped
    // with one of three corrections spent.
    for (let step = 0; step < 4; step++) {
      await advance(resumedDir, location, firstProcess);
    }
    const midRun = await load(resumedDir);
    expect(midRun.outcome).toBeUndefined();
    expect(
      deriveBudgetsFromLog(midRun.history, midRun.cursor.budgets).correction.used,
    ).toBe(1);

    // A fresh process: the cursor rebuilt from the log, and doubles that share
    // no state with the ones that ran before the stop.
    await rebuild(resumedDir);
    const secondProcess = portsWithTriage(scriptedAgent([stuck()]));
    const result = await run(resumedDir, location, secondProcess);
    const resumed = await load(resumedDir);

    expect(result.state).toBe(straightThrough.state);
    expect(resumed.outcome?.reason).toContain(exhaustedPrefix("correction"));
    expect(
      deriveBudgetsFromLog(resumed.history, resumed.cursor.budgets),
    ).toEqual(straightThrough.spent);
    // Not later and not sooner: the same number of worker sessions either way.
    expect(resumed.history.filter((e) => e.t === "dispatch")).toHaveLength(
      straightThrough.history.filter((e) => e.t === "dispatch").length,
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/surface.test.ts -t "stopped partway" && npx tsc --noEmit`
Expected: PASS, clean typecheck. As in Task 2, a failure is a real defect —
most likely a budget read from `cursor.budgets[*].used` instead of from
`deriveBudgetsFromLog` — and is fixed in the driver, not in the assertion.

- [ ] **Step 3: Commit**

```bash
git add src/surface.test.ts
git commit -m "Assert a stopped-and-resumed run hits the same cap at the same count

Deriving budgets from the log instead of incrementing a counter exists so a
crash cannot move a cap, and nothing tested it. The scenario now runs twice
— once straight through, once stopped mid-flight, rebuilt from the log and
finished by fresh doubles — and the two must agree on the outcome, the
reason, every population's count and the number of sessions dispatched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The budget-exhaustion demo

The harness extender's UAT surface for this slice: one scenario per enforced
budget, each scripted so the relevant port never resolves, printing what was
spent against the cap, what every other population did (nothing), and the
escalation reason. A fifth block runs the correction scenario stopped and
resumed, printing both outcomes side by side.

**Files:**
- Create: `demos/single-surface-slice-4-budgets.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `run` and `advance` from `src/surface.js`; `create`, `load`, `deriveBudgetsFromLog`, `rebuild` from `src/case-file.js`; `initTempRepo` from `src/temp-repo.js`; `deterministicRouter` from `src/router.js`; `noopCloser` and the port types from `src/ports.js`; `BudgetPopulation`, `BudgetSet`, `GateRef` types from `src/schema.js`.
- Produces: `npm run demo:surface-slice-4`.

- [ ] **Step 1: Write the demo script**

Create `demos/single-surface-slice-4-budgets.ts`:

```ts
/**
 * UAT demo for Single-Surface State Machine Slice 4: Stop Cleanly When a Retry
 * Budget Runs Out.
 *
 * One scenario per enforced budget, each scripted so the relevant port never
 * produces a resolving result, printing what the scenario spent against that
 * budget's cap, what every other population did, and the escalation reason.
 * A final block runs one scenario twice — straight through, and stopped
 * partway then resumed from the same directory — to show the cap does not move.
 *
 * Usage: npx tsx demos/single-surface-slice-4-budgets.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load, deriveBudgetsFromLog, rebuild } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, CloserPort, SurfaceLocation, SurfacePorts, Terminus } from "../src/ports.js";
import type { BudgetPopulation, BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

/** A fresh case directory, temp repo and worktree path for one scenario. */
async function freshSurface(surfaceId: string): Promise<{ dir: string; location: SurfaceLocation }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-case-"));
  const repoPath = initTempRepo("budget-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "budget-tree-")), "wt");
  await create(dir, { surfaceId, taskDef: { intent: "add a feature" }, gateRef }, budgets);
  return { dir, location: { repoPath, worktreePath } };
}

/** What the log says about a finished surface. */
async function summarise(dir: string): Promise<{
  outcome: string;
  reason: string;
  spent: BudgetSet;
  dispatches: number;
  closes: number;
}> {
  const caseFile = await load(dir);
  return {
    outcome: caseFile.outcome?.kind ?? "none",
    reason: caseFile.outcome?.reason ?? "",
    spent: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
    dispatches: caseFile.history.filter((e) => e.t === "dispatch").length,
    closes: caseFile.history.filter((e) => e.t === "close").length,
  };
}

function budgetLine(spent: BudgetSet): string {
  return (Object.keys(spent) as BudgetPopulation[])
    .map((p) => `${p} ${spent[p].used}/${spent[p].max}`)
    .join(", ");
}

interface Scenario {
  title: string;
  scripted: string;
  population: BudgetPopulation;
  /** What one unit of this population buys, so the printed count reads plainly. */
  burn: string;
  ports: SurfacePorts;
}

async function runScenario(scenario: Scenario): Promise<void> {
  const { dir, location } = await freshSurface(scenario.title.toLowerCase().replace(/\W+/g, "-"));
  await run(dir, location, scenario.ports);
  const { outcome, reason, spent, dispatches, closes } = await summarise(dir);
  const { used, max } = spent[scenario.population];

  console.log(`\n=== ${scenario.title} ===`);
  console.log(`Scripted:  ${scenario.scripted}`);
  console.log(`Capped by: ${scenario.population}, cap ${max}`);
  console.log(`Spent:     ${used} of ${max} (one per ${scenario.burn})`);
  console.log(`Sessions:  ${dispatches} agent session(s), ${closes} close attempt(s)`);
  console.log(`Budgets:   ${budgetLine(spent)}`);
  console.log(`Outcome:   ${outcome} — ${reason}`);
}

/** A worker that always reports the same terminus, whatever the role. */
function alwaysWorker(terminus: Terminus): AgentPort {
  return { invoke: () => Promise.resolve(terminus) };
}

async function main(): Promise<void> {
  console.log("Budget caps for these runs:", budgetLine(budgets));
  console.log(
    "Note: gateError is counted but gated by nothing in this item (design spec, Budgets):",
  );
  console.log(
    "      a gate that cannot run is routed to gate maintenance and paid for there.",
  );

  // 1. correction — the worker is always stuck but says a retry might help.
  await runScenario({
    title: "Correction budget: a worker that is always stuck",
    scripted: "every worker session returns an exhaustion-class escalate",
    population: "correction",
    burn: "retried worker attempt the router authorises",
    ports: {
      agent: alwaysWorker({
        status: "escalate",
        category: "exhaustion",
        rationale: "stuck, try again",
      }),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 2. gateMaintenance — the gate can never run again, and no repair fixes it.
  await runScenario({
    title: "Gate-repair budget: a gate that always errors",
    scripted:
      "the worker deletes the file the gate reads; every repair session reports success without restoring it",
    population: "gateMaintenance",
    burn: "repair session dispatched",
    ports: {
      agent: {
        invoke: (roleCfg, ctx) => {
          if (roleCfg.role === "worker") {
            fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
            return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
          }
          return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
        },
      },
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 3. terminus — every worker session ends without a valid result.
  await runScenario({
    title: "Incomplete-terminus budget: a worker that never returns a result",
    scripted: "every worker session ends incomplete (crash, cap or timeout)",
    population: "terminus",
    burn: "incomplete session, the last of which is not retried",
    ports: {
      agent: alwaysWorker({ status: "incomplete", rationale: "hit the turn cap" }),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 4. close — the work is fine, the closer never accepts it.
  const rejectingCloser: CloserPort = {
    close: (_ctx, outcome) =>
      Promise.resolve(
        outcome.kind === "accepted"
          ? { status: "FAIL", detail: "not ready to close" }
          : { status: "DONE", detail: "torn down" },
      ),
  };
  await runScenario({
    title: "Close-retry budget: a closer that always rejects the work",
    scripted: "the worker's change passes the gate; every close attempt is rejected",
    population: "close",
    burn: "retried close the router authorises",
    ports: {
      agent: alwaysWorker({ status: "completed", rationale: "clean change" }),
      triage: deterministicRouter,
      closer: rejectingCloser,
    },
  });

  // 5. The same cap, reached across a restart.
  const ports = (): SurfacePorts => ({
    agent: alwaysWorker({
      status: "escalate",
      category: "exhaustion",
      rationale: "stuck, try again",
    }),
    triage: deterministicRouter,
    closer: noopCloser,
  });

  const straight = await freshSurface("resume-reference");
  await run(straight.dir, straight.location, ports());
  const reference = await summarise(straight.dir);

  const stopped = await freshSurface("resume-interrupted");
  const firstProcess = ports();
  for (let step = 0; step < 5; step++) {
    await advance(stopped.dir, stopped.location, firstProcess);
  }
  const midway = await summarise(stopped.dir);
  await rebuild(stopped.dir);
  await run(stopped.dir, stopped.location, ports());
  const resumed = await summarise(stopped.dir);

  console.log("\n=== The same cap, reached across a restart ===");
  console.log(`Stopped at:   ${budgetLine(midway.spent)}`);
  console.log(`Uninterrupted: ${reference.outcome} — ${reference.reason}`);
  console.log(`               ${budgetLine(reference.spent)}, ${reference.dispatches} session(s)`);
  console.log(`Stop + resume: ${resumed.outcome} — ${resumed.reason}`);
  console.log(`               ${budgetLine(resumed.spent)}, ${resumed.dispatches} session(s)`);
}

await main();
```

- [ ] **Step 2: Add the run story to package.json**

In `package.json`, add to `scripts`, immediately after the
`demo:surface-slice-3` line:

```json
    "demo:surface-slice-4": "npx tsx demos/single-surface-slice-4-budgets.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:surface-slice-4`
Expected: five blocks. Each of the first four prints `Spent: N of N`, where N
is that population's cap (`correction` 3, `gateMaintenance` 2, `terminus` 5,
`close` 3), a `Budgets:` line showing every other population at `0/<max>`
(except the gate-repair block, where `gateError` is also spent — counted, gated
by nothing, as the header note says), and an `Outcome: escalated —
<population> budget exhausted (N/N): ...` line naming the population that ran
out. The fifth block prints the uninterrupted and the stop-and-resume runs with
identical outcomes, identical budget lines and identical session counts. No
block hangs.

- [ ] **Step 4: Verify the script typechecks and lints**

Run: `npm run lint`
Expected: clean. `demos/` is inside the tsconfig and eslint scope, so an unused
import or a loose type fails here.

- [ ] **Step 5: Commit**

```bash
git add demos/single-surface-slice-4-budgets.ts package.json
git commit -m "Add the budget-exhaustion demo

The harness extender's UAT surface for this slice: one scenario per enforced
budget, each scripted so the relevant port never resolves, printing what it
spent against that budget's cap and leaving every other population visibly
untouched, plus the same scenario stopped and resumed to show the cap does
not move across a restart.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| A worker that always reports "stuck, try again" exhausts the correction budget at exactly its cap and escalates | Task 2 (`spends exactly the correction cap...`, asserting 3 reroutes and 4 dispatches), demo scenario 1 |
| A gate that always errors out exhausts the gate-repair budget at exactly its cap and escalates | Task 2 (`spends exactly the gate-maintenance cap...`, asserting 2 repair dispatches), demo scenario 2 |
| A worker session that always ends without a valid result exhausts the incomplete-terminus retry budget at exactly its cap and escalates | Task 2 (`spends exactly the terminus cap...`, asserting 5 dispatches, 0 triage), demo scenario 3 |
| A closer that always rejects the work exhausts the close-retry budget at exactly its cap and escalates | Task 2 (`spends exactly the close cap...`, asserting 4 close entries), demo scenario 4 |
| Exhausting one budget never consumes another | Task 2 (the correction test asserts all four other populations at 0; the other three tests each assert the populations they must not touch), demo `Budgets:` line in every block |
| Stopping the driver partway and resuming from the same directory reaches the same escalation at the same cap | Task 3, demo block 5 |
| Operational note: a cap escalation names the exhausted population and its cap | Task 1 (`budgetExhausted`, all three call sites, spec sentence); asserted in Tasks 2 and 3 via `exhaustedPrefix` |

No gaps. The slice's "five budgets" framing is honoured by the demo printing
all five, with `gateError` labelled as counted-but-not-gated per the design
spec's Budgets section — this plan does not invent enforcement the spec
deliberately defers to Item 5.

**2. Placeholder scan** — every step carries literal code or a literal command.
No "similar to Task N", no "add error handling", no undefined types. Tasks 2
and 3 are explicitly labelled as green-on-write regression locks with the
instruction to fix the driver rather than the assertion if they fail, so no
step hides a "figure out the numbers" instruction: the numbers are stated and
were observed before planning.

**3. Type consistency** — `budgetExhausted(population: BudgetPopulation,
budget: Budget, detail: string): string` is the signature used at all three
call sites, and `Budget`/`BudgetPopulation` are the existing exported names in
`src/schema.ts`. `deriveBudgetsFromLog(history, maxima): BudgetSet` and
`rebuild(dir): Promise<CaseFile>` match `src/case-file.ts`. `HistoryEntry["t"]`
is the discriminant used by `countOf`. Budget population keys (`correction`,
`gateError`, `gateMaintenance`, `terminus`, `close`) match `BudgetSet`. The
demo's `Scenario.population` and `budgetLine`'s key iteration both use
`BudgetPopulation`.

**4. Right choice re-audit**

| Decision | Pre-planning choice | What the plan does | Easy or Right? |
|---|---|---|---|
| What this slice actually builds | Write four tests over behaviour that already works and call the slice done | Verify empirically first, then land the one thing genuinely missing (the uniform cap-escalation message the Operational note demands) alongside the evidence | Right |
| Where the message formatter lives | Inline the template in each of the three branches, as today | `src/budgets.ts`, one function, three call sites — the DX contract becomes a property of the code rather than of three strings agreeing by luck | Right |
| Which module hosts it | `case-file.ts`, next to `deriveBudgetsFromLog` | Its own module, so `router.ts` (a pure lookup table with no persistence dependency) can use it without importing the persistence layer for a string | Right |
| `gateError` enforcement | Add a `gateError` cap so "all five budgets are enforced" reads cleanly | Leave it counted and ungated, as the design spec deliberately specifies, and label it in the demo — inventing a cap here would mean inventing the `TriageVerdict` case Item 5 owns | Right |
| The terminus cap's off-by-one appearance | Quietly print "4 retries" against a cap of 5 and hope nobody checks | Print the burn count with what burns it ("one per incomplete session, the last of which is not retried"), matching the spec's definition of the population | Right |
| Test placement | New `src/budget-caps.test.ts` | The existing `describe` blocks in `src/surface.test.ts`, reusing its `provisioned` / `scriptedAgent` / `portsWithTriage` helpers rather than duplicating them into a new file | Right |
| Resume simulation | Re-run `run()` in the same process and call it a resume | Stop mid-flight, `rebuild` the cursor from the log, and finish with doubles that share no state with the first process — the strongest in-process stand-in for a new one | Right |
| The existing terminus cap test | Delete it as duplicated by Task 2 | Keep it: it asserts the session-key sequence at a cap of 2, which Task 2's test does not, and Task 2's adds the independence claim it does not | Right |

No new dependency, no new abstraction with a single call site, no hand-rolled
commodity. The buy-vs-build constraint is honoured (nothing added; budget
counting still comes only from `deriveBudgetsFromLog`). The operability
constraint is landed by Task 1 and printed by Task 4.

**5. Scaffolding drift check**

Behaviours this slice changes, and where each is described:
- **The wording of a budget-cap escalation** — the design spec's Budgets
  section describes how populations are counted but not what an exhaustion
  says → the contract is added there in Task 1, the task that creates it. No
  README, CONTRIBUTING, Makefile or skill text describes budgets (checked).
- **`recordBaseline`'s claim that a baseline ERROR retries on the `gateError`
  budget** — described in its own doc comment in `src/run-gate.ts`, and false
  for this item's driver → corrected in Task 1, the task that fixes the budget
  vocabulary.
- **New command `npm run demo:surface-slice-4`** → added to `package.json` in
  Task 4. `README.md`, `CONTRIBUTING.md` and `Makefile` name no `demo:*`
  script (checked), so `package.json` is the only place it appears.
- No new env var, no new dependency, no change to `make verify` or CI. Tasks 2
  and 3 add no behaviour and so change nothing documented.
