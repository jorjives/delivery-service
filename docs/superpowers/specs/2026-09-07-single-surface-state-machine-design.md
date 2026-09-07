---
status: draft
---

# Single-Surface State Machine — Design

The core delivery loop for one surface: provision a worktree, capture a
baseline, dispatch an agent, gate the result, and route to a terminal state,
with deterministic budget enforcement and crash recovery throughout. This
document covers the driver that walks a case file through the states in
[single-surface-control-flow.md](../../single-surface-control-flow.md), the
three pluggable seams it drives through (agent, triage, closer), and how those
seams are stubbed for this item so that later items (4, 5, 6) can supply real
implementations without changing the driver's calling contract.

## Decisions

**The driver is a step function plus a loop, not a monolithic run.** `advance`
performs exactly one transition — the next thing the case file's current
position calls for — and commits it. `run` calls `advance` until the surface
reaches a terminal state. This matches invariant 4 (every transition is a
commit point, idempotent under replay): a test can call `advance` once to
inspect a single edge, or simulate a crash by stopping the loop between calls
and resuming with a fresh `run`.

**Three pluggable ports, not one implementation.** `AgentPort`,
`TriagePort`, and `CloserPort` are function-shaped seams the driver calls
through. Their contracts are fixed here so Items 4, 5, and 6 slot in real
implementations later without touching the driver. This item ships one
built-in implementation of each — the minimum that proves the loop end to
end — not the final version:

- **`AgentPort`** — no real implementation ships with this item. Item 4
  builds the SDK-backed primitive described in `agent-interface.md`. Tests
  and the demo use a scripted test double.
- **`TriagePort`** — this item ships the deterministic-router half only:
  budget-aware routing with no agent call. Item 5 adds the agent-judgement
  half (overruling an exhaustion-class escalate downward, sharpened briefs)
  in front of this same port.
- **`CloserPort`** — this item ships a trivial no-op closer (reports `DONE`,
  does no infra work). Item 6 builds real closers (merge-back, open-PR,
  teardown).

**Provisioning is real, not stubbed.** Creating a worktree is simple enough
(shell out to `git worktree add`/`remove`) that stubbing it would leave the
loop untestable against a real filesystem. The repo-level lock that
`provisioning.md` specifies for concurrent access is multi-surface concern
(Item 10) — this item runs one surface at a time, so no lock is needed yet.

**Pre-first-entry resume is driven by cursor + header, not the log tail.**
`resumeAction` (built in Item 1) maps a log tail to a resume action, but
`PROVISIONING` and `PRE_GATING` write no history entries — provisioning
commits by writing the case file header, baselining commits by writing the
immutable `header.baseline` field. Before the first `dispatch` entry exists,
the log tail is empty and gives no information. The driver's pre-dispatch
resume logic reads `cursor.state` and `header.baseline` directly: this is the
one segment of the loop where the cursor, not the log, is authoritative,
because no log entries exist yet to disagree with it.

**PRE_GATING only routes to GATE_MAINTENANCE on gate-level ERROR.** The
control-flow doc allows a red-but-running baseline ("green or known-red") to
proceed straight to `AGENT_ACTIVE`. Defining a further "red beyond tolerance"
threshold is left as future work (noted as an open item in the control-flow
doc); this item implements the concrete, unambiguous half: `status: ERROR`
(the gate could not run) sends the surface to `GATE_MAINTENANCE`, anything
else (`PASS` or `FAIL`) proceeds to `AGENT_ACTIVE`.

## The driver

```
advance(dir, worktreePath, ports) -> { state: SurfaceState, done: boolean }
run(dir, worktreePath, ports)     -> { state: SurfaceState, outcome? }
```

`ports` bundles the three seams:

```
SurfacePorts = {
  agent:  AgentPort,
  triage: TriagePort,
  closer: CloserPort,
}
```

`advance` loads the case file, determines the current position, performs the
one next action, and returns. `run` loops `advance` until `done` is true
(state is `CLOSED`, `ESCALATED`, or `ABORTED`), then reads back `outcome`.
Both functions are safe to call from a fresh process against an existing
`dir`: every branch below either reads pre-entry state (cursor/header) or the
log tail, so `advance` after a crash always resumes onto a legal edge.

### Determining position

```
if history is empty:
  if header.baseline === null:
    position = cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING"
  else:
    position = "AGENT_ACTIVE"     # baselined, no dispatch entry yet
else:
  position = resumeAction(logTail(history))   # existing Item 1 function
```

`cursor.state` starts at `"PROVISIONING"` (set by `create`, Item 1) and the
driver advances it to `"PRE_GATING"` once the worktree exists — this is the
one cursor write that happens before any history entry, mirroring the header
write in `provisioning.md`'s own crash-recovery story (worktree created →
header written is the commit point; here, header written → cursor advanced
to `PRE_GATING` is the next one).

### Edges

Each edge is one `advance` call. All calls are idempotent under replay per
invariant 4; re-running a completed edge either no-ops (the underlying
Item 1/2 functions already guard `setOnce` fields) or safely repeats a
read-only action (a re-run gate check, a re-dispatch onto a dirty tree).

**PROVISIONING → PRE_GATING | ABORTED**

```
git worktree add <path> -b <branch> <base-ref>   # under try/catch
```

On success: `updateCursor(dir, { state: "PRE_GATING", worktreeRef: path })`.
On failure: `appendEntry` is not used here (no PROVISIONING entry type
exists in the schema — provisioning has no history representation, matching
`provisioning.md`'s "the worktree is an orphan with no owning surface" case);
the driver sets `outcome` directly via `setOutcome(dir, { kind: "aborted", source: "provisioning", reason, at })`
and returns `{ state: "ABORTED", done: true }`. A crash before this point
resumes provisioning idempotently — `git worktree add` on an existing branch
name fails cleanly and the driver tears down and retries once (matching
provisioning.md's "partial worktree" recovery), rather than looping forever.

**PRE_GATING → AGENT_ACTIVE | GATE_MAINTENANCE**

Calls `recordBaseline(dir, worktreePath)` (Item 2, already built). On
`status !== "ERROR"`: `updateCursor(dir, { state: "AGENT_ACTIVE" })`. On
`status === "ERROR"`: increment the `gateMaintenance` budget
(`incrementBudget`); if exhausted, escalate (see Escalation below); otherwise
dispatch the `gate-maintenance` role through `AgentPort` and update the
cursor to `"GATE_MAINTENANCE"`.

**GATE_MAINTENANCE → PRE_GATING | GATING | ESCALATED**

Entered pre-task (no baseline yet): on the repair agent's `completed`
terminus, cursor returns to `"PRE_GATING"` to re-baseline. Entered post-task
(triage verdict was `fix_the_gate`): on `completed`, cursor returns to
`"GATING"` to re-check against the existing baseline — the baseline is never
recaptured post-task. Either entry's `escalate` terminus, or the budget
already being exhausted on entry, routes to `ESCALATED`.

**AGENT_ACTIVE → GATING | ESCALATED | TRIAGE | INCOMPLETE_TERMINUS**

Determines the attempt number (`1 + count of prior "terminus" entries`),
appends a `dispatch` entry, calls `agent.invoke(workerRoleCfg, ctx)`, appends
the resulting `terminus` entry. Maps the terminus per
`case-file.ts`'s existing `terminusState` table (already built in Item 1):
`completed → GATING`, `escalate → ESCALATED` (authority-class) or `TRIAGE`
(exhaustion-class — the deterministic router still gets first look, per
control-flow doc), `incomplete → INCOMPLETE_TERMINUS`.

**INCOMPLETE_TERMINUS → AGENT_ACTIVE | ESCALATED**

Increments the `terminus` budget. Under cap: returns to `AGENT_ACTIVE`,
re-dispatching onto the worktree as the crashed/capped session left it (no
reset — control-flow doc, "a retried terminus re-dispatches into the tree as
it was left"). At cap: escalate.

**GATING → CLOSING | TRIAGE**

Calls `runCheck(dir, worktreePath, attempt)` (Item 2, already built, appends
its own `gate` entry). `delta.pass → CLOSING`. Otherwise `TRIAGE`, carrying
the trigger (`"gate_fail"` or `"gate_error"`) that `TriagePort` reads.

**CLOSING → CLOSED | TRIAGE**

Calls `closer.close(ctx, { kind: "accepted" })`. `DONE`: appends a `close`
entry, calls `setOutcome(dir, { kind: "closed", ... })`, returns `CLOSED`.
`FAIL`/`ERROR`: appends the `close` entry, routes to `TRIAGE` with trigger
`"close_failure"` (the narrow router — only `retry_close` or `escalate` are
legal verdicts here, enforced by `TriagePort`'s own contract, not by this
driver).

**TRIAGE → AGENT_ACTIVE | GATE_MAINTENANCE | CLOSING | ESCALATED | ABORTED**

Assembles a `TriageInput` (trigger, case file, current gate report,
remaining budgets) and calls `triage(input)` (`TriagePort`). Appends a
`triage` entry with the verdict and rationale. Maps verdict to state via
`case-file.ts`'s existing `triageState` table: `reroute` burns a
`correction` budget slot and returns to `AGENT_ACTIVE`; `fix_the_gate` burns
`gateMaintenance` and goes to `GATE_MAINTENANCE`; `retry_close` burns `close`
and returns to `CLOSING`; `escalate`/`abort` go straight to their terminal
states.

### Escalation and abort

Both are terminal and handled the same way: append the relevant entry (a
`triage` entry if the escalate/abort came from a `TriagePort` verdict; none
if it came from an authority-class worker escalate or a budget exhaustion —
those are visible from the `terminus`/prior entries alone), call
`setOutcome`, and fire-and-log the closer with the non-accept outcome
(`{ kind: "escalated" | "aborted" }`) for infra teardown. A teardown failure
here is logged, not re-triaged (control-flow doc: "already terminal or
human-owned").

## Ports

### `AgentPort`

```
invoke(roleCfg: RoleConfig, ctx: AgentContext) -> Promise<Terminus>

RoleConfig = { role: "worker" | "triage" | "gate-maintenance", ... }  # pinned per role, Item 4's concern
AgentContext = { worktreePath: string, dir: string, sessionKey: string }
Terminus =
  | { status: "completed", rationale: string }
  | { status: "escalate", category: "exhaustion" | "authority", rationale: string }
  | { status: "incomplete", rationale: string }
```

This mirrors `agent-interface.md`'s `invoke(role_cfg, ctx) -> Terminus`
exactly, so Item 4 can implement `AgentPort` as its real SDK-backed
primitive with no shape change here. This item's own tests supply a scripted
stub implementing the same signature.

### `TriagePort`

```
triage(input: TriageInput) -> Promise<TriageVerdict>

TriageInput = {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure",
  category?: "exhaustion" | "authority",   # present when trigger is worker_escalate
  caseFile: CaseFile,
  remainingBudgets: BudgetSet,
}
TriageVerdict =
  | { verdict: "reroute", rationale: string }
  | { verdict: "escalate", rationale: string }
  | { verdict: "fix_the_gate", rationale: string }
  | { verdict: "retry_close", rationale: string }
  | { verdict: "abort", rationale: string }
```

This item's built-in `TriagePort` is the deterministic router only —
no agent call, no `SharpenedBrief`/`EscalationPacket` synthesis (those
payload shapes are Item 5's concern and are not modelled in the schema yet).
Its rule, applied per trigger:

| Trigger | Budget checked | Under cap | At cap |
|---|---|---|---|
| `gate_fail` | `correction` | `reroute` | `escalate` |
| `gate_error` | `gateError` (checked, not burned here — `GATING`'s own re-check consumes it) | `reroute` on the check, else `fix_the_gate` if `gateMaintenance` remains | `escalate` |
| `worker_escalate` (authority) | — | `escalate` (never overruled) | `escalate` |
| `worker_escalate` (exhaustion) | `correction` | `escalate` (this item never overrules downward — that judgement needs an agent, Item 5) | `escalate` |
| `close_failure` | `close` | `retry_close` | `escalate` |

The `worker_escalate` (exhaustion) row is the one place this item is
strictly more conservative than the target design: control-flow doc allows
triage to overrule an exhaustion-class escalate down to a reroute, but doing
so needs judgement this item has no agent to supply. Escalating instead is
safe (never loses work, never overturns a PASS) and is exactly the behaviour
Item 5 replaces.

### `CloserPort`

```
close(ctx: CloseContext, outcome: CloseOutcome) -> Promise<CloseReport>

CloseContext = { worktreePath: string, dir: string }
CloseOutcome = { kind: "accepted" | "escalated" | "aborted" }
CloseReport = { status: "DONE" | "FAIL" | "ERROR", detail: string }
```

Matches `single-surface-control-flow.md`'s `closer.close(ctx, outcome) ->
CloseReport` exactly. This item's built-in closer always returns `{ status: "DONE", detail: "no-op closer (Item 6 ships real closers)" }` and performs no
worktree teardown — the worktree is left in place for inspection, matching
this item's "no repo lock, single-surface only" scope decision above; Item 6
and Item 10 own real cleanup.

## Budgets

All five populations (`correction`, `gateError`, `gateMaintenance`,
`terminus`, `close`) are enforced via `incrementBudget` (Item 1, already
built) at the point each is burned, per the table in the Edges section
above. `incrementBudget` returns `{ used, max, exhausted }`; the driver
checks `exhausted` immediately after incrementing and routes to escalation
rather than letting a subsequent edge silently exceed the cap.

## Crash recovery

No new recovery mechanism — this item composes what Items 1 and 2 already
built. A crash at any point is recovered by calling `run(dir, worktreePath,
ports)` again:

- **Before the first history entry** (during `PROVISIONING`/`PRE_GATING`):
  resumed via `cursor.state` + `header.baseline`, per the Decisions section
  above.
- **After the first history entry**: resumed via `resumeAction(logTail(...))`,
  already built in Item 1 and already covering every edge this item drives.

The only genuinely new recovery case this item introduces is the
`PROVISIONING` partial-worktree window (`git worktree add` succeeded, header
write did not) — handled per `provisioning.md`: on re-entry, the driver
checks for an existing worktree at the surface's expected path; if found and
no header exists yet, it tears down and recreates rather than adopting found
state.

## Error handling

New errors, following the existing `errors.ts` convention (named class,
`code`, constructor args as readonly fields):

- **`ProvisioningFailure`** — `git worktree add` failed; carries `dir` and
  `detail`. Caught by the driver, converted to an `ABORTED` outcome (not
  thrown to the caller of `run`), since provisioning failure is infra-class
  and terminal per the control-flow doc.
- **`IllegalStateTransition`** — the case file's `cursor.state` does not
  match any edge the driver knows how to advance from (defensive: should be
  unreachable given the state machine's own construction, but guards a
  corrupted or hand-edited case file). Carries `dir`, `state`, and thrown
  rather than silently ignored, per the roadmap's DX note on this item: name
  the state, the attempted edge, what went wrong.

## Testing

Following the project's existing pattern (`run-gate.test.ts`,
`case-file.test.ts`): unit tests against a temp directory per test, using
`vitest`. Each edge gets a focused test with a scripted `AgentPort`/
`TriagePort`/`CloserPort` double. Crash recovery is tested by running
`advance` a fixed number of times (stopping mid-loop), discarding the
in-memory driver state, and calling `run` fresh against the same `dir` to
confirm it reaches the same terminal outcome a non-interrupted run would.
Budget exhaustion is tested per population by scripting the double to always
return the non-terminal verdict and asserting escalation at the cap, not
before or after.

A demo script (`demos/single-surface-happy-path.ts`, matching the existing
`demos/gate-interface-slice-*.ts` pattern) drives a full
`PROVISIONING → CLOSED` run against a real temp git repo with a scripted
`AgentPort` double, proving the loop end to end without a real SDK call.

## Scope boundaries

- **No repo-level lock.** Single surface, single worktree, no concurrent
  provisioning. Item 10.
- **No real agent, no real triage judgement, no real closer.** The ports and
  their contracts are fixed; the implementations arrive in Items 4, 5, 6.
- **No "red beyond tolerance" baseline threshold.** `PRE_GATING` routes to
  `GATE_MAINTENANCE` only on gate-level `ERROR`. Left as an open item on the
  control-flow doc.
- **No orphan-worktree sweep.** This item's re-provision-on-crash handles
  the case where the *same* surface resumes into a stale partial worktree.
  A periodic sweep for orphans left by a surface that never resumes is
  explicitly deferred in `provisioning.md`.
