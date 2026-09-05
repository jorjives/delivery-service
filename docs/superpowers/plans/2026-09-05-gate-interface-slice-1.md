# Gate Interface — Slice 1: Compute a Regression Verdict from Two Gate Reports

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-05-gate-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-04-gate-interface-design.md`

**Goal:** Implement the delta rule — a pure function that compares a baseline `GateReport` and a check `GateReport` and returns a `DeltaResult` with pass/fail, new failures, and failure classification.

**Architecture:** The delta rule is a pure, synchronous function with no I/O. It lives in its own module (`src/delta-rule.ts`) and operates on typed `GateReport` values. The gate report and delta result types are added to the existing `src/schema.ts` as zod schemas with inferred TypeScript types, following the established pattern. The existing `GateState` type (opaque `Record<string, unknown>`) is left untouched — its refinement to `GateReport` is deferred to Slice 5 where case-file integration happens.

**Note:** The `NewFailure` type defined here uses `{ id, baselineOutcome, checkOutcome, detail }`, which differs from the existing `GateEntry.newFailures` shape (`{ id, detailRef }`). These types serve different purposes — `NewFailure` is the delta rule's output, `GateEntry` is the persistence shape. Slice 5 will bridge the two when integrating with the case file.

**Tech Stack:** TypeScript, zod (already installed), vitest (already installed)

## Global Constraints

- Node >= 22, TypeScript 6, ESM (`"type": "module"`)
- zod is the only runtime dependency; no new dependencies
- TAP and JUnit parsers are hand-written per spec Build note (not relevant to this slice, but inherited)
- Co-located tests (`*.test.ts` next to source), vitest runner
- `noUncheckedIndexedAccess: true` in tsconfig — all indexed access may be `undefined`

## Scaffolding Impact

- `src/index.ts` re-exports → updated in Task 1 (new types) and Task 2 (new function)
- No new build/test/deploy steps (vitest auto-discovers `.test.ts` files)
- No existing docs, README sections, or skills describe delta-rule behaviour yet — nothing to update

---

### Task 1: Add gate report and delta result types to schema.ts ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `Assertion` — zod schema and type: `{ id: string; outcome: "PASS" | "FAIL" | "ERROR"; detail: string }`
  - `GateReport` — zod schema and type: `{ status: "PASS" | "FAIL" | "ERROR"; assertions: Assertion[]; detail?: string }`
  - `NewFailure` — zod schema and type: `{ id: string; baselineOutcome: "PASS"; checkOutcome: "FAIL" | "ERROR" | "ABSENT"; detail: string }`
  - `DeltaResult` — zod schema and type: `{ pass: boolean; newFailures: NewFailure[]; class: "fail" | "error" | null }`
  - `DeltaOptions` — zod schema and type: `{ failOnNewAssertions?: boolean }`

- [ ] **Step 1: Add Assertion and GateReport schemas to schema.ts**

Add after the existing `GateState` definition (around line 40):

```typescript
export const Assertion = z.object({
  id: z.string(),
  outcome: z.enum(["PASS", "FAIL", "ERROR"]),
  detail: z.string(),
});
export type Assertion = z.infer<typeof Assertion>;

export const GateReport = z.object({
  status: z.enum(["PASS", "FAIL", "ERROR"]),
  assertions: z.array(Assertion),
  detail: z.string().optional(),
});
export type GateReport = z.infer<typeof GateReport>;
```

- [ ] **Step 2: Add NewFailure, DeltaResult, and DeltaOptions schemas to schema.ts**

Add immediately after the `GateReport` definition:

```typescript
export const NewFailure = z.object({
  id: z.string(),
  baselineOutcome: z.literal("PASS"),
  checkOutcome: z.enum(["FAIL", "ERROR", "ABSENT"]),
  detail: z.string(),
});
export type NewFailure = z.infer<typeof NewFailure>;

export const DeltaResult = z.object({
  pass: z.boolean(),
  newFailures: z.array(NewFailure),
  class: z.enum(["fail", "error"]).nullable(),
});
export type DeltaResult = z.infer<typeof DeltaResult>;

export const DeltaOptions = z.object({
  failOnNewAssertions: z.boolean().optional(),
});
export type DeltaOptions = z.infer<typeof DeltaOptions>;
```

- [ ] **Step 3: Export new types from index.ts**

Add the new types to the existing type export block in `src/index.ts`:

```typescript
export type {
  CaseFile,
  CaseFileHeader,
  CreateHeader,
  CaseFileCursor,
  CaseFileOutcome,
  HistoryEntry,
  DispatchEntry,
  TerminusEntry,
  GateEntry,
  TriageEntry,
  CloseEntry,
  SurfaceState,
  BudgetSet,
  Budget,
  BudgetPopulation,
  TaskDef,
  GateRef,
  GateState,
  Assertion,
  GateReport,
  NewFailure,
  DeltaResult,
  DeltaOptions,
} from "./schema.js";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/index.ts
git commit -m "Add gate report and delta result types to schema

The delta rule (Slice 1) needs typed GateReport, Assertion, NewFailure,
DeltaResult, and DeltaOptions schemas. These are added alongside the
existing GateState, which remains untouched until Slice 5 refines it
for case-file integration."
```

---

### Task 2: Implement the delta rule — no regressions and basic regressions ✅ DONE (deliver-slice)

**Files:**
- Create: `src/delta-rule.ts`
- Create: `src/delta-rule.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `GateReport`, `NewFailure`, `DeltaResult`, `DeltaOptions` from `src/schema.ts`
- Produces: `computeDelta(baseline: GateReport, check: GateReport, options?: DeltaOptions): DeltaResult`

- [ ] **Step 1: Write failing test — identical passing assertions produce a passing verdict**

Create `src/delta-rule.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeDelta } from "./delta-rule.js";
import type { GateReport } from "./schema.js";

describe("computeDelta", () => {
  it("passes when baseline and check have identical passing assertions", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });

  it("reports a new failure when an assertion passes at baseline and fails at check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "expected 200, got 500" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-2",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "expected 200, got 500",
    });
    expect(result.class).toBe("fail");
  });

  it("reports a new failure when an assertion passes at baseline and errors at check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "ERROR", detail: "timeout" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-1",
      baselineOutcome: "PASS",
      checkOutcome: "ERROR",
      detail: "timeout",
    });
    expect(result.class).toBe("fail");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: FAIL — `computeDelta` cannot be resolved

- [ ] **Step 3: Write minimal implementation**

Create `src/delta-rule.ts`:

```typescript
import type { GateReport, DeltaResult, DeltaOptions, NewFailure } from "./schema.js";

export function computeDelta(
  baseline: GateReport,
  check: GateReport,
  options?: DeltaOptions,
): DeltaResult {
  const checkById = new Map(check.assertions.map((a) => [a.id, a]));
  const newFailures: NewFailure[] = [];

  for (const baseAssertion of baseline.assertions) {
    if (baseAssertion.outcome !== "PASS") continue;

    const checkAssertion = checkById.get(baseAssertion.id);

    if (!checkAssertion) {
      newFailures.push({
        id: baseAssertion.id,
        baselineOutcome: "PASS",
        checkOutcome: "ABSENT",
        detail: `Assertion "${baseAssertion.id}" was present at baseline but missing from check`,
      });
    } else if (checkAssertion.outcome === "FAIL" || checkAssertion.outcome === "ERROR") {
      newFailures.push({
        id: baseAssertion.id,
        baselineOutcome: "PASS",
        checkOutcome: checkAssertion.outcome,
        detail: checkAssertion.detail,
      });
    }
  }

  if (options?.failOnNewAssertions) {
    const baselineIds = new Set(baseline.assertions.map((a) => a.id));
    for (const checkAssertion of check.assertions) {
      if (!baselineIds.has(checkAssertion.id) && checkAssertion.outcome !== "PASS") {
        // baselineOutcome is "PASS" by convention — the assertion has no actual
        // baseline, but the NewFailure type constrains this field to "PASS".
        newFailures.push({
          id: checkAssertion.id,
          baselineOutcome: "PASS",
          checkOutcome: checkAssertion.outcome as "FAIL" | "ERROR",
          detail: checkAssertion.detail,
        });
      }
    }
  }

  const isGateError = check.status === "ERROR";
  const hasNewFailures = newFailures.length > 0;
  const pass = !hasNewFailures && !isGateError;

  let deltaClass: "fail" | "error" | null = null;
  if (isGateError) {
    deltaClass = "error";
  } else if (hasNewFailures) {
    deltaClass = "fail";
  }

  return { pass, newFailures, class: deltaClass };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Export computeDelta from index.ts**

Add to `src/index.ts`:

```typescript
export { computeDelta } from "./delta-rule.js";
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/delta-rule.ts src/delta-rule.test.ts src/index.ts
git commit -m "Add delta rule with basic regression detection

Implements computeDelta — a pure function that compares baseline and
check GateReports and returns a DeltaResult. Covers the core path:
identical assertions pass, a regression from PASS to FAIL or ERROR
is reported as a new failure with both outcomes recorded."
```

---

### Task 3: ABSENT handling and pre-existing red noise ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/delta-rule.test.ts`

**Interfaces:**
- Consumes: `computeDelta` from Task 2
- Produces: nothing new (tests only — the implementation already handles these cases)

Note: The implementation in Task 2 already handles ABSENT detection and
pre-existing red filtering. This task adds the tests that prove it.

- [ ] **Step 1: Write test — assertion passed at baseline and missing from check is ABSENT**

Add to the `computeDelta` describe block in `src/delta-rule.test.ts`:

```typescript
  it("reports ABSENT when an assertion passed at baseline but is missing from check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        // test-2 is gone
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-2",
      baselineOutcome: "PASS",
      checkOutcome: "ABSENT",
      detail: 'Assertion "test-2" was present at baseline but missing from check',
    });
    expect(result.class).toBe("fail");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS (implementation already handles this)

- [ ] **Step 3: Write test — pre-existing failure at baseline is never reported**

Add to the `computeDelta` describe block:

```typescript
  it("never reports a pre-existing failure as a new failure regardless of check outcome", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "known broken" },
        { id: "test-3", outcome: "ERROR", detail: "known error" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "still broken" },
        { id: "test-3", outcome: "PASS", detail: "fixed now" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/delta-rule.test.ts
git commit -m "Add tests for ABSENT detection and pre-existing red filtering

Proves the delta rule reports ABSENT when a baseline-passing assertion
vanishes from the check report, and never blames the worker for
assertions that were already failing or erroring at baseline."
```

---

### Task 4: New assertions and failOnNewAssertions option ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/delta-rule.test.ts`

**Interfaces:**
- Consumes: `computeDelta` from Task 2, `DeltaOptions` from Task 1
- Produces: nothing new (tests only)

Note: The implementation in Task 2 already handles the `failOnNewAssertions`
option. This task adds the tests that prove it.

- [ ] **Step 1: Write test — new assertion at check with no baseline counterpart is ignored by default**

Add to the `computeDelta` describe block in `src/delta-rule.test.ts`:

```typescript
  it("ignores a new assertion at check that has no baseline counterpart", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "FAIL", detail: "new test, not passing yet" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS

- [ ] **Step 3: Write test — failOnNewAssertions reports a failing new assertion**

Add to the `computeDelta` describe block:

```typescript
  it("reports a failing new assertion when failOnNewAssertions is set", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "FAIL", detail: "new and broken" },
      ],
    };

    const result = computeDelta(baseline, check, { failOnNewAssertions: true });

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-new",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "new and broken",
    });
    expect(result.class).toBe("fail");
  });

  it("does not report a passing new assertion even when failOnNewAssertions is set", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "PASS", detail: "new and passing" },
      ],
    };

    const result = computeDelta(baseline, check, { failOnNewAssertions: true });

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/delta-rule.test.ts
git commit -m "Add tests for new-assertion handling and failOnNewAssertions

Proves new assertions without a baseline counterpart are ignored by
default, and that failOnNewAssertions reports only failing new
assertions (passing new ones are always fine)."
```

---

### Task 5: Gate-level error and failure classification ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/delta-rule.test.ts`

**Interfaces:**
- Consumes: `computeDelta` from Task 2
- Produces: nothing new (tests only)

- [ ] **Step 1: Write test — gate-level ERROR overrides to error class**

Add to the `computeDelta` describe block in `src/delta-rule.test.ts`:

```typescript
  it("fails with error class when check report status is ERROR, regardless of assertions", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "ERROR",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
      detail: "test runner crashed",
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("error");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS

- [ ] **Step 3: Write test — new failures with non-ERROR status are fail class**

Add to the `computeDelta` describe block:

```typescript
  it("classifies as fail when there are new failures and gate status is not ERROR", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "FAIL", detail: "broke" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("fail");
  });

  it("classifies as error even when there are also new assertion failures", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "ERROR",
      assertions: [
        { id: "test-1", outcome: "FAIL", detail: "broke" },
      ],
      detail: "partial run",
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("error");
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/delta-rule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/delta-rule.test.ts
git commit -m "Add tests for gate-level error and failure classification

Proves gate-level ERROR always produces error class (even with passing
assertions or concurrent assertion failures), and non-ERROR status
with new failures produces fail class."
```

---

### Task 6: UAT demo script ✅ DONE (deliver-slice)

**Files:**
- Create: `demos/gate-interface-slice-1-delta-rule.ts` (moved from the
  plan's original `src/delta-rule-demo.ts` — the repo already has a
  `demos/` directory holding one runnable script per slice, so this
  follows that established convention instead of introducing a new one)

**Interfaces:**
- Consumes: `computeDelta` from `src/delta-rule.ts`, `GateReport` from `src/schema.ts`
- Produces: nothing (prints to stdout)

This task delivers the UAT demo script required by the slice scope. The
script runs a series of baseline/check report pairs through the delta rule
and prints the verdict for each scenario, so a reviewer can read the output
and confirm every acceptance criterion.

- [ ] **Step 1: Create the demo script**

Create `src/delta-rule-demo.ts` — a runnable script (`npx tsx src/delta-rule-demo.ts`)
that exercises each scenario named in the UAT section of the slice scope:
1. No regressions (identical passing assertions) — should pass
2. A genuine regression (PASS → FAIL) — should fail, naming the assertion
3. A vanished assertion (PASS → ABSENT) — should fail, naming the assertion
4. Pre-existing red noise (baseline FAIL stays FAIL) — should pass
5. A brand-new failing assertion (no baseline counterpart) — should pass (default)
6. A gate-level ERROR — should fail with error class

Each scenario prints a label, the verdict, and the new failures (if any).
No assertions or test framework — this is a human-readable demo, not an
automated test.

- [ ] **Step 2: Run the demo and verify output**

Run: `npx tsx src/delta-rule-demo.ts`
Expected: each scenario's printed verdict matches its label per the slice
scope UAT section.

- [ ] **Step 3: Commit**

```bash
git add src/delta-rule-demo.ts
git commit -m "Add delta-rule UAT demo script

Runnable script that exercises every Slice 1 acceptance scenario
and prints human-readable verdicts. A reviewer reads the output
to confirm the delta rule behaves correctly without needing to
run the test suite."
```
