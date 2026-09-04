# Case File Persistence — Design

The serialisable, crash-recoverable state container that every harness component
reads and writes. A surface resumes from its case file alone; no warm memory, no
external coordinator.

## Decisions

**Language: TypeScript.** The harness drives agents through the Anthropic SDK
(TypeScript-native), ships as a CLI installed from a package registry (npm), and
serialises structured data (JSON-native). TypeScript is the path of least
friction across the full roadmap.

**Persistence: atomic whole-file writes.** The case file is a single JSON file,
rewritten atomically (write-to-temp, fsync, rename) on every mutation. The design
docs mandate that the case file stays lean — large data lives by reference — so
rewrites are cheap. This is simpler than append-only storage (JSONL) and provides
the same crash-safety guarantee: a crash mid-write leaves the prior version
intact.

**Immutability: enforced by the API, not the format.** The `CaseFile` type
exposes no method to mutate header fields after creation. The header is
structurally immutable through the interface, not through a separate file or
permission scheme.

## Data model

The case file has four sections with distinct mutability rules, exactly as the
single-surface control flow specifies.

### Header (immutable after creation)

```typescript
type CaseFileHeader = {
  surfaceId: string
  taskDef: TaskDef           // original intent (opaque to persistence; defined by Item 4)
  gateRef: GateRef           // pinned gate identity + version (opaque to persistence; defined by Item 2)
  domainPrompt?: string      // domain system-prompt fragment
  baseline: GateState | null // per-assertion fingerprint; null until PRE_GATING captures it
}
```

`baseline` is the one field written after initial creation: it is set exactly
once during `PRE_GATING` and is immutable thereafter. The API enforces this by
accepting the baseline only when the field is currently null.

### Cursor (mutable)

```typescript
type CaseFileCursor = {
  state: SurfaceState
  budgets: BudgetSet
  worktreeRef: string
}

type SurfaceState =
  | 'PROVISIONING' | 'PRE_GATING' | 'AGENT_ACTIVE' | 'GATING'
  | 'GATE_MAINTENANCE' | 'TRIAGE' | 'CLOSING' | 'INCOMPLETE_TERMINUS'
  | 'CLOSED' | 'ESCALATED' | 'ABORTED'

type BudgetSet = {
  correction:      Budget
  gateError:       Budget
  gateMaintenance: Budget
  terminus:        Budget
  close:           Budget
}

type Budget = { used: number; max: number }
```

### History (append-only)

```typescript
type HistoryEntry =
  | DispatchEntry
  | TerminusEntry
  | GateEntry
  | TriageEntry
  | CloseEntry

type DispatchEntry = {
  t: 'dispatch'
  attempt: number
  sessionKey: string
  briefRef?: string          // null on first attempt or raw reroute
}

type TerminusEntry = {
  t: 'terminus'
  attempt: number
  sessionKey: string
  status: 'completed' | 'escalate' | 'incomplete'
  category?: 'exhaustion' | 'authority'
  rationale: string
}

type GateEntry = {
  t: 'gate'
  attempt: number
  status: 'PASS' | 'FAIL' | 'ERROR'
  newFailures: Array<{ id: string; detailRef: string }>
  class: 'fail' | 'error'
}

type TriageEntry = {
  t: 'triage'
  afterAttempt: number
  trigger: string
  verdict: 'reroute' | 'escalate' | 'fix_the_gate' | 'retry_close' | 'abort'
  rationale: string
  artifactRef: string        // pointer to brief or escalation packet
}

type CloseEntry = {
  t: 'close'
  status: 'DONE' | 'FAIL' | 'ERROR'
  detailRef: string
}
```

### Outcome (written once)

```typescript
type CaseFileOutcome = {
  kind: 'closed' | 'escalated' | 'aborted'
  source: string
  reason: string
  at: string                 // ISO 8601 timestamp
}
```

### The composed type

```typescript
type CaseFile = {
  header: CaseFileHeader
  cursor: CaseFileCursor
  history: HistoryEntry[]
  outcome?: CaseFileOutcome
}
```

## File layout

Each surface gets a directory. The case file and its referenced blobs live
together.

```
<run-dir>/
  surfaces/
    <surface-id>/
      case.json              # the CaseFile, atomically rewritten
      refs/
        <ref-id>.json        # referenced blobs (details, briefs, packets)
```

Reference IDs are deterministic: `<entry-type>-<attempt>` for entry-scoped
refs (e.g. `gate-detail-2`, `triage-artifact-1`), sequential for others.
A ref file is written before the history entry that points to it, so a crash
between the two leaves an orphan ref (harmless) rather than a dangling pointer.

## API surface

The case file module exposes five operations. All disk I/O is internal;
consumers work with typed data.

### `create(dir, header, budgetDefaults) → CaseFile`

Write the initial case file: header fields set, cursor at `PROVISIONING` with
budget maxima from defaults, empty history, no outcome.

### `load(dir) → CaseFile`

Read and parse the case file from disk. Returns the typed `CaseFile`. Fails if
the file does not exist or is malformed.

### `appendEntry(dir, entry) → void`

Append a history entry. Validates that the entry is well-formed. The caller is
responsible for state-transition correctness; persistence does not enforce the
state machine.

### `updateCursor(dir, patch) → void`

Update mutable cursor fields (state, budgets, worktreeRef). Accepts a partial
patch — only the fields present in the patch are changed.

### `setBaseline(dir, baseline) → void`

Set the baseline fingerprint. Fails if the baseline is already set (enforces
write-once semantics).

### `setOutcome(dir, outcome) → void`

Write the terminal outcome. Fails if an outcome is already set.

Each mutation atomically rewrites `case.json`: read current, apply change,
write to temp, fsync, rename over original. A crash at any point leaves either
the prior version or the new version on disk, never a partial write.

## Budget enforcement

Budgets are counters with caps. The case file module provides:

### `incrementBudget(dir, population) → { used, max, exhausted }`

Increment the `used` counter for the named population. Returns the new state
including whether the cap is now reached. Does not prevent incrementing past
the cap — the caller (the state machine) decides what to do when `exhausted`
is true.

This is a convenience that combines `load` + `updateCursor` atomically.

## Crash recovery

The log tail determines the resume action. This mapping is specified in the
single-surface design and implemented by the state machine (a later item), not
by the persistence layer. The persistence layer's contract is simpler: every
write is atomic, so `load` always returns a consistent state.

The state machine reads the tail via:

### `logTail(caseFile) → HistoryEntry | undefined`

Return the last history entry (the tail). The state machine maps this to a
resume action per the table in the single-surface design:

| Tail | Resume action |
|---|---|
| `dispatch`, no `terminus` | Treat as `INCOMPLETE_TERMINUS` |
| `terminus(completed)` | Re-run gate |
| `gate(FAIL\|ERROR)` | Run triage |
| `gate(PASS)` | Run closer |
| `triage(verdict)` | Act on recorded verdict |
| `close(FAIL\|ERROR)` | Run close-triage |
| `close(DONE)` / terminal | Done |
| No entries | Start from current cursor state |

`logTail` is a pure function over the in-memory `CaseFile`; it does no I/O.
The resume logic belongs to the state machine (Item 3), not to persistence.

## Reference storage

Large data lives in `refs/` as individual JSON files, keyed by a deterministic
ID. The persistence module provides:

### `writeRef(dir, refId, data) → string`

Write a reference blob. Returns the ref ID. The write is atomic (same
write-temp-rename pattern). Ref files are written before the history entry that
references them.

### `readRef(dir, refId) → unknown`

Read and parse a reference blob.

## Validation

The persistence layer validates structural correctness on every `load`: the
JSON must parse, and the result must conform to the `CaseFile` schema. A schema
validation library (e.g. Zod) defines the schema once and derives both the
TypeScript types and the runtime validator.

Semantic validation (legal state transitions, budget-cap enforcement, entry
ordering) belongs to the state machine. The persistence layer guarantees
structure; the state machine guarantees meaning.

## Error handling

All persistence errors are typed and distinguishable:

- **FileNotFound**: `load` or `readRef` on a missing path.
- **CorruptCaseFile**: `load` finds JSON that does not match the schema.
- **ImmutabilityViolation**: `setBaseline` or `setOutcome` called when the
  field is already set.
- **WriteFailure**: disk I/O failed (permissions, disk full).

Each error carries the surface directory and enough context to produce a
message that names what went wrong, not a stack trace (per Item 3's DX note).

## Testing

The persistence layer is pure I/O against a directory. Tests use a temporary
directory per test case; no mocks needed.

Coverage:

- **Round-trip**: create → append entries → load → verify all fields.
- **Atomicity**: simulate a crash (kill the write before rename) and verify
  `load` returns the prior state.
- **Immutability**: `setBaseline` twice fails; `setOutcome` twice fails;
  header fields unchanged after cursor updates.
- **Budget counters**: increment each population, verify `used` tracks and
  `exhausted` fires at `max`.
- **Reference lifecycle**: write ref → append entry pointing to it → load →
  dereference → verify content.
- **Corrupt file**: malformed JSON or schema-invalid JSON produces
  `CorruptCaseFile`, not a crash.
- **Log tail**: verify `logTail` returns the correct entry type for each
  append sequence.

Tests run with a standard test runner (Vitest — fast, TypeScript-native, no
config ceremony). CI runs the full suite on every push and PR.

## CI pipeline

This item establishes the project's CI, inherited by every subsequent item:

- **GitHub Actions workflow**: lint (ESLint + strict TypeScript), test (Vitest),
  on push and PR to main.
- **Node version**: LTS (22.x).
- **No build step yet**: the project is a library at this stage; packaging
  and distribution are Item 8's concern.

## CONTRIBUTING guide

A `CONTRIBUTING.md` at the repo root covers:

- Clone, install (`npm install`), run tests (`npm test`).
- How to submit a PR (branch from main, tests must pass, one concern per PR).
- Code style: enforced by the linter, not by convention.

The guide is short. It grows as the project does.
