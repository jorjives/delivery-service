# Gate Interface — Design

The pluggable gate that captures a baseline fingerprint before dispatch, checks
world state after, and lets the harness compute the regression delta. This
document covers the gate contract, the delta rule, assertion identity, error
handling, and the reference gate implementations that ship with the harness.

## Decisions

**The gate is a pair of functions, not a class.** `baseline` and `check` are
stateless callables. No registry, no lifecycle, no inheritance hierarchy. A gate
is an object with two methods; anything that satisfies the interface is a gate.
This matches the single-surface design doc and avoids framework-shaped overhead
for what is fundamentally two pure functions.

**The delta rule lives in the harness, not the gate.** The gate reports current
state honestly; the harness owns the comparison logic. This separation means
gate authors never implement diff logic, and the regression-attribution
semantics are consistent across all gate types.

**Built-in gates are configuration-driven.** A non-technical project owner
selects a gate by name and supplies parameters (e.g. a test command). No code
authorship required for the common cases. Custom gates are authored by
implementing the same two-function interface.

**GateRef becomes a discriminated union.** The case file header's `gateRef`
field (currently an opaque `Record<string, unknown>`) becomes a typed
discriminated union on a `type` field. Built-in gate types are known
discriminants; custom gates use `type: "custom"` with an implementation path.

**TAP and JUnit parsers are hand-written, not library dependencies.** Both
formats are simple enough that a focused parser (TAP: line-by-line regex; JUnit:
minimal XML extraction) is smaller and more predictable than pulling in a
general-purpose library. The parser only needs to extract test IDs and
pass/fail/error outcomes; it does not need to handle the full format spec.

## Gate contract

### The interface

```typescript
interface GateContext {
  /** Absolute path to the worktree the gate inspects. */
  worktreePath: string;
  /** The task definition from the case file header. */
  taskDef: TaskDef;
  /** The pinned gate reference from the case file header. */
  gateRef: GateRef;
}

interface Assertion {
  /** Stable identifier — same string at baseline and check. */
  id: string;
  /** What happened. */
  outcome: "PASS" | "FAIL" | "ERROR";
  /** Human-readable detail for triage and escalation packets. */
  detail: string;
}

interface GateReport {
  /** Did the gate itself run successfully? */
  status: "PASS" | "FAIL" | "ERROR";
  /** Per-assertion results. */
  assertions: Assertion[];
  /** Diagnostic detail when status is ERROR. Undefined otherwise. */
  detail?: string;
}

type GateState = GateReport;

interface Gate {
  baseline(ctx: GateContext): Promise<GateReport>;
  check(ctx: GateContext): Promise<GateReport>;
}
```

### Semantics

Both `baseline` and `check` are **read-only and idempotent**. A gate that
mutates the world it judges is not a gate. Both return the same `GateReport`
shape: the gate does not know whether it is being called for baseline or check
purposes; the harness decides what to do with the result.

`baseline` is called once, before the first dispatch. Its report is serialised
into the case file header and is immutable for the lifetime of the surface. This
is the reference against which all subsequent checks are compared.

`check` is called after each agent attempt that produces a `completed` terminus.
Its report is compared against the baseline by the delta rule.

### Assertion identity

The `id` field on each assertion is the mechanism that makes regression
attribution work. The contract:

- **Stable across calls.** The same logical assertion produces the same `id` at
  baseline and at check. If a gate cannot produce stable IDs (e.g. it wraps a
  tool that emits only aggregate pass/fail), it degrades to a single assertion
  with a synthetic ID and loses per-item attribution.
- **Unique within a report.** Duplicate IDs within a single report are a gate
  error.
- **Deterministic.** The same world state produces the same set of IDs. A gate
  whose IDs change non-deterministically (random suffixes, timestamps) breaks
  the delta rule.

For the reference test-runner gate, the natural stable ID is the fully qualified
test name as reported by the test framework.

### ABSENT outcome

An assertion present at baseline but missing from a check report has outcome
`ABSENT`. The gate does not emit this; the delta rule infers it. This closes the
"delete the test" exploit: if an assertion passed at baseline and is absent at
check, that counts as a new failure. The assertion set is pinned at baseline; IDs
cannot be renamed to dodge the match.

## The delta rule

The harness owns this logic. The gate supplies raw reports; the harness computes
the verdict.

```typescript
interface DeltaResult {
  /** Whether the surface passes — no new failures and no gate-level error. */
  pass: boolean;
  /** Assertions that passed at baseline but are now FAIL, ERROR, or ABSENT. */
  newFailures: NewFailure[];
  /** Whether the issue is fail-class or error-class. */
  class: "fail" | "error" | null;
}

interface NewFailure {
  /** The assertion ID. */
  id: string;
  /** What baseline recorded. */
  baselineOutcome: "PASS";
  /** What check found (or ABSENT if the assertion vanished). */
  checkOutcome: "FAIL" | "ERROR" | "ABSENT";
  /** Detail from the check report (or a standard message for ABSENT). */
  detail: string;
}
```

### Rules

1. For each assertion in the baseline where `outcome === "PASS"`:
   - Find the matching assertion in the check report by `id`.
   - If missing: the check outcome is `ABSENT`.
   - If present and outcome is `FAIL`, `ERROR`, or `ABSENT`: this is a new
     failure.
   - If present and outcome is `PASS`: no regression.

2. Assertions in the baseline with outcome `FAIL` or `ERROR` are pre-existing
   red. They are ignored by the delta rule regardless of their check outcome.
   The worker is never blamed for ambient noise.

3. Assertions in the check report that were not in the baseline are new
   assertions. They are not subject to the delta rule (there is no baseline to
   regress from). A new assertion that fails is not a regression; it is a net-new
   failure. Whether to treat net-new failures as regressions is a delta-rule
   option (`failOnNewAssertions`, default `false`), stored on the `GateRef` so
   it is pinned for the surface's lifetime. The common case is that a worker
   adding new tests that don't yet pass is progress, not regression.

4. The surface passes if and only if: `newFailures` is empty AND the check
   report's gate-level `status` is not `ERROR`.

5. If the check report's gate-level `status` is `ERROR`, the delta class is
   `"error"` regardless of assertion-level results. Otherwise, if there are new
   failures, the class is `"fail"`.

### Gate errors vs gate failures

This distinction is structural:

- **Gate failure** (`status: "FAIL"`): the gate ran, assertions were evaluated,
  and some regressed. This is the worker's fault. It routes back via triage and
  burns a correction slot.
- **Gate error** (`status: "ERROR"`): the gate could not run or could not
  produce reliable results. This is not the worker's fault. It re-runs the gate
  on the `gateError` budget, or routes to gate maintenance.

A gate implementation signals error by setting `status: "ERROR"` on the report
and providing detail. The harness never infers error from exceptions; the gate
catches its own exceptions and maps them to a report with `status: "ERROR"`.
Uncaught exceptions from a gate are treated as gate errors with a synthetic
report.

## GateRef — gate identity in the case file

The case file header stores a `GateRef` that pins the gate for the lifetime of
the surface. This becomes a discriminated union:

```typescript
type GateRef =
  | { type: "command"; command: string; parseMode: "tap" | "junit" | "exitcode"; failOnNewAssertions?: boolean }
  | { type: "custom"; modulePath: string; exportName?: string; failOnNewAssertions?: boolean };
```

### Built-in gate types

#### `command` gate

Runs a shell command in the worktree directory and parses its output into
assertions. The simplest gate: point it at a test command and it works.

```typescript
{
  type: "command",
  command: "npm test",        // executed in worktree with shell
  parseMode: "tap"            // how to extract assertions from output
}
```

**Parse modes:**

- **`tap`**: Parses TAP (Test Anything Protocol) output. Each `ok` / `not ok`
  line becomes an assertion with the test number and description as the ID.
  Widely supported: most test runners can emit TAP (Node.js `--test`, `tape`,
  `prove`, `pytest-tap`, `go test` via adapters).

- **`junit`**: Parses JUnit XML output (typically written to a file). Each
  `<testcase>` becomes an assertion with
  `classname::testname` as the ID. The standard CI interchange format; most
  runners emit it natively or via plugin.

- **`exitcode`**: No assertion parsing. The entire command is one assertion:
  exit code 0 is `PASS`, non-zero is `FAIL`. The ID is a stable synthetic
  string derived from the command. Loses per-test attribution but works with
  any command.

The `command` gate wraps all execution errors (command not found, timeout,
permission denied) as `status: "ERROR"` reports, never as uncaught exceptions.

#### `custom` gate

Loads a gate implementation from a user-supplied module:

```typescript
{
  type: "custom",
  modulePath: "./gates/my-gate.js",   // resolved relative to project root
  exportName: "myGate"                 // optional; defaults to "default"
}
```

The module must export an object satisfying the `Gate` interface. The harness
validates at load time that the export has `baseline` and `check` methods; a
missing method is a configuration error, not a runtime surprise.

## Gate resolution

Gate resolution is the process of turning a `GateRef` into a usable `Gate`
instance. It runs once per surface, at the transition into `PRE_GATING`.

```typescript
type GateResolver = (ref: GateRef, ctx: GateContext) => Promise<Gate>;
```

For built-in types, the resolver constructs the appropriate gate from the ref's
parameters. For custom gates, it dynamically imports the module and validates the
export.

Resolution errors (module not found, invalid export, unsupported parse mode) are
gate errors: they produce a `GateReport` with `status: "ERROR"` and route to
gate maintenance, not to the worker.

The resolver is itself pluggable (the harness owns a default resolver; the
multi-surface supervisor or a test harness can substitute one), but this is an
internal extension point, not a user-facing one.

## Integration with the case file

The gate interface reads from and writes to the case file through the existing
persistence layer:

- **Baseline storage:** `setBaseline(dir, gateReport)` stores the baseline
  report in the header. This is a set-once field; `ImmutabilityViolation` if
  called twice.
- **Gate report logging:** `appendEntry(dir, gateEntry)` writes a gate history
  entry after each check. The `GateEntry` schema already exists with `status`,
  `newFailures`, and `class` fields.
- **Gate ref storage:** the `gateRef` field in the header identifies the gate.
  It is set at creation and immutable.

The `GateState` type in `schema.ts` (currently `z.record(z.string(), z.unknown())`)
is refined to match the `GateReport` shape. The `GateRef` type is refined to the
discriminated union above.

## Error model

All gate errors are expressed as `GateReport` values, never as thrown exceptions
reaching the harness. The gate implementation is responsible for catching its own
errors.

| Situation | Report |
|---|---|
| Command not found | `{ status: "ERROR", assertions: [], detail: "..." }` |
| Command timed out | `{ status: "ERROR", assertions: [], detail: "..." }` |
| Output parse failure | `{ status: "ERROR", assertions: [], detail: "..." }` |
| Module not found (custom) | `{ status: "ERROR", assertions: [], detail: "..." }` |
| Duplicate assertion IDs | `{ status: "ERROR", assertions: [], detail: "..." }` |
| Uncaught exception (safety net) | Harness wraps in `{ status: "ERROR", assertions: [] }` |

The `detail` field on a report-level error carries the diagnostic message.
Gate-level errors route to the `gateError` budget for stateless retries, then to
gate maintenance if the budget is exhausted.

## Testing

The gate interface is tested at three levels:

1. **Unit tests for the delta rule.** Pure function, no I/O. Exercises: no
   regressions, new failures, ABSENT detection, pre-existing red ignored,
   gate-level errors, `failOnNewAssertions` flag.
2. **Unit tests for built-in gates.** Each parse mode is tested against known
   output: TAP streams, JUnit XML documents, exit codes. Error cases (malformed
   output, missing command, timeout) produce ERROR reports.
3. **Integration tests with the case file.** A gate report is stored as a
   baseline, a check is run, the delta is computed, and the resulting
   `GateEntry` is appended to the log. Verifies the full round-trip through
   persistence.

The agent mock (Item 7) will later provide end-to-end testing of the gate within
the full state machine loop. This spec covers the gate in isolation.

## Scope boundaries

This spec covers:
- The `Gate` interface contract
- The delta rule (harness-owned comparison logic)
- Assertion identity and ABSENT handling
- `GateRef` as a discriminated union
- The `command` gate (TAP, JUnit, exitcode parse modes)
- The `custom` gate loader
- Gate resolution
- Error model
- Integration with existing case file persistence

This spec does not cover:
- The state machine transitions that invoke the gate (Item 3)
- Gate maintenance agents (Item 3 / Item 5)
- The triage routing that follows a gate failure (Item 5)
- Flaky-test quarantine or re-check mechanisms (future enhancement)
- Gate configuration via CLI or project config file (Items 8, 9)
