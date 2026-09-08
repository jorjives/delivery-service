---
status: approved
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
`PROVISIONING` and `PRE_GATING` write no history entries — the case file
header already exists before the driver runs (`create`, Item 1, writes it and
sets `cursor.state: "PROVISIONING"`), so provisioning commits by advancing the
cursor to `PRE_GATING`, and baselining commits by writing the immutable
`header.baseline` field. Before the first `dispatch` entry exists,
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

**`DispatchEntry`/`TerminusEntry` gain an optional `role` field.** The
schema Item 1 shipped models one implicit role (the worker): attempt
numbers, `resumeAction`, and `deriveBudgetsFromLog` all assume every
dispatch is a worker attempt. `GATE_MAINTENANCE` dispatches a repair agent
through the same `AgentPort` primitive and needs the same crash-recoverable
dispatch → terminus pairing (a repair session can crash mid-session exactly
like a worker session can), so it needs to write entries too — but a
gate-maintenance dispatch is not a worker attempt and must not be counted as
one. Rather than invent a parallel, unrecoverable path for this one role,
this item adds `role?: "worker" | "gate-maintenance"` to both entry types
(absent = `"worker"`, so every existing test and case file stays valid) and
makes resume/budget derivation switch on it. This is additive schema work
inside Item 1's already-shipped file, done here because Item 3 is the first
consumer that actually drives a second role through the dispatch/terminus
pair; see "Schema extension" below for the full detail.

**GATE_MAINTENANCE re-dispatches on its own budget, not a separate `terminus`
one.** A repair session can crash/cap/timeout exactly like a worker session,
but routing that failure onto the worker's `terminus` population or into
`AGENT_ACTIVE` would dispatch the wrong session type onto an environment
whose gate still cannot run. Instead, an `incomplete` terminus from a
gate-maintenance dispatch increments `gateMaintenance` again and re-dispatches
within `GATE_MAINTENANCE` at the same attempt — mirroring how a worker
terminus-retry reuses its attempt number — and escalates at cap. This keeps
every repair-agent session, clean or crashed, on the single cost centre the
Budgets table already documents for it ("expensive and stateful, so a low
cap").

**Triage entries always carry a real `artifactRef`, even when this item's
router has nothing to synthesise.** `TriageEntry.artifactRef` is required in
Item 1's shipped schema, and weakening it to optional would push a permanent
"was there an artefact" check onto every future reader, including Item 5's
real triage agent. Instead every `TRIAGE` edge writes a stub artefact
(`{ trigger, rationale }`) via `writeRef` before appending the entry — exactly
as `runCheck` already writes gate-failure detail — and stores the resulting
id as `artifactRef`. Item 5 replaces the stub's contents
(`SharpenedBrief`/`EscalationPacket`) without touching the schema or this
item's callers.

**Branch and base-ref are derived from `surfaceId`, not new state.**
`provisioning.md` leaves the `surface_id → branch` scheme open ("likely
`surface_id`-derived"); this item settles it: `branchName(surfaceId)` is a
pure deterministic function (`surface/<surfaceId>`), and the base ref is the
repo's default branch resolved at provision time
(`git symbolic-ref refs/remotes/origin/HEAD` or equivalent) — neither is
stored anywhere. Storing either in `CaseFileHeader` would create a second
source of truth that can drift from `surfaceId`; passing them as `run`/
`advance` arguments would violate invariant 3 (resumable from disk alone) — a
replay called with different arguments could diverge from the first run.

**`runCheck`'s gate-failure ref key is widened to include a re-check
counter.** Item 2's shipped `run-gate.ts` keys failure refs
`gate-<attempt>-<index>`, which collides when the same attempt is checked
twice — exactly what `GATE_MAINTENANCE → GATING`'s post-task re-check does
(baseline is immutable, so the re-check reuses the attempt that triggered
`fix_the_gate`). Left alone, the second `runCheck` overwrites the first
call's ref files while both `GateEntry` history entries still point at those
ids, so triage can read stale or dangling detail — a correctness break, not a
stylistic one, since this item's own state machine exercises the collision on
its first repair-then-recheck cycle. This item widens the key to
`gate-<attempt>-<recheckCount>-<index>` (`recheckCount` = count of prior
`gate` entries for this attempt) in Item 2's already-shipped file — the same
"additive change to a shipped file" pattern as the `role` schema extension
below. The existing `ponytail:` comment marking this as a ceiling is removed
along with the fix.

**Budgets have no separately-mutated live counter — every check derives
fresh from the log.** The first cut of this design called `incrementBudget`
as a mutation timed independently of the entry that evidences the burn (e.g.
gate-maintenance incremented the budget, *then* appended the dispatch entry;
`INCOMPLETE_TERMINUS` incremented the budget but appended no entry of its
own at all). A crash between those two independent writes leaves the live
counter and a log-derived recount disagreeing — and for `terminus` at cap,
where no further entry is ever appended, the final burn is permanently
underivable from the log. Rather than try to make two separate writes
atomic, this item removes the second write: **the entry that records the
triggering event *is* the burn**, and nothing else is. Each population is
counted by deriving straight from the log, at the moment it's needed, off
the entry that directly evidences it:

- `terminus` ← count of `terminus` entries with `status: "incomplete"` and
  worker role (`role` absent or `"worker"`), not a subsequent redispatch. A
  gate-maintenance `incomplete` terminus is never counted here: its cost is
  burned on `gateMaintenance` by the redispatch's own `dispatch` entry, so
  counting it would charge a repair session to the worker's population.
  `INCOMPLETE_TERMINUS` derives the
  count *before* deciding to redispatch — the terminus entry that triggered
  this edge is already in the log, written by the edge before it, so the
  count is correct with zero additional writes, including at cap where no
  redispatch ever follows.
- `correction` ← count of `triage` entries with `verdict: "reroute"`, and
  `close` ← count of `triage` entries with `verdict: "retry_close"` — both
  directly off the `triage` entry `TRIAGE` already appends, not off the
  dispatch/close entry that follows it. `TriagePort` already receives
  `remainingBudgets` (derived before the call) and is the thing that
  refuses `reroute`/`retry_close` at cap per its own trigger table, so no
  separate cap check is needed after the fact.
- `gateMaintenance` ← count of `dispatch` entries with `role:
  "gate-maintenance"`, derived *before* appending a new one: the driver
  checks the cap, and only if under it does it append the dispatch entry —
  the append is the only write, and it is simultaneously the burn and the
  crash-recoverable record of it. Both the `PRE_GATING → GATE_MAINTENANCE`
  entry point and a same-attempt `incomplete`-terminus redispatch (see
  below) follow this rule identically; there is no separate `incrementBudget`
  call left in either path.

This makes "burned live" and "derived from log" the same computation by
construction, not two commit points a crash can land between — `incrementBudget`
(Item 1) is no longer called from these four edges; `exhausted` is read
straight off `deriveBudgetsFromLog`'s result.

**`sessionKey` includes a retry count, not just role and attempt.** Two
edges deliberately redispatch at the same attempt number — a worker
`INCOMPLETE_TERMINUS` retry and a gate-maintenance `incomplete`-terminus
retry — so `role`+`attempt` alone produces the same key for two genuinely
different sessions, which breaks the "the dispatch/terminus pair must
agree" pairing invariant `sessionKey` exists to serve (see invariant 2:
sessions are reconstructed, never resumed, so a key that meant "reuse this
session" would be a contradiction, not a valid reading). `sessionKey` is
`${role}-${attempt}-${retryCount}`, where `retryCount` is the count of
prior same-role, same-attempt `terminus` entries with `status: "incomplete"`
already in the log — log-derivable, so a crashed dispatch's own re-run
(before any terminus for it exists) still computes the same key and stays
idempotent, while a genuine retry after a recorded `incomplete` terminus
gets a new one.

**A repair session's resolution must be recoverable from the log alone, not
the cursor.** `GATE_MAINTENANCE`'s two success exits (pre-task → re-baseline,
post-task → re-check) must not be considered complete until the log itself
carries enough information for `deriveStateFromEntry` to reach the correct
next state on resume. A cursor-only write is not sufficient: `rebuild`
recomputes the cursor from the log, not the reverse, so a crash immediately
after such a write would leave the log tail unchanged and every resumed
`advance` would re-derive `GATE_MAINTENANCE` and re-enter it — a livelock,
since both exits otherwise look identical to the driver once entered. This
item requires every `GATE_MAINTENANCE` exit to leave the log itself able to
distinguish "resolved onward to `PRE_GATING`" from "resolved onward to
`GATING`" from "still repairing." The exact encoding is a planning decision,
not a design one: this document fixes the requirement, not the mechanism.

**A dangling dispatch on resume is an incomplete terminus, not a session to
resurrect.** A `dispatch` entry with no matching `terminus` is exactly what
this document already defines a terminus as covering when its status is
`incomplete`: "any session that ended without emitting valid structured
output — crash, token/turn cap, timeout, idle, or output that failed schema
validation" (control-flow doc). It is not a new case needing its own
recovery path, and control-flow doc already says so directly: `tail =
dispatch, no terminus → treat as INCOMPLETE_TERMINUS (existing edge)`.
Resume therefore appends an `incomplete` terminus for the dangling dispatch
(this is the one and only terminus ever written for that dispatch, so no
double-burn arises) and proceeds through the existing `INCOMPLETE_TERMINUS`/
`GATE_MAINTENANCE`-incomplete edges — the same bounded redispatch-or-escalate
logic already specified above for a crash observed *within* a live process,
now also covering a crash observed only on the *next* process's resume. No
new recovery path, no new budget, and no unbounded retry: the existing cap
applies either way.

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

`worktreePath` is a caller argument only at first provision, where it seeds
`cursor.worktreeRef`. `create` (Item 1) writes `worktreeRef: ""`, so the
empty string is the "not yet provisioned" sentinel: the driver uses the
argument only while `cursor.worktreeRef` is empty, and once the provisioning
cursor write has landed `cursor.worktreeRef` is authoritative and the driver
prefers it over the argument, so invariant 3 holds (a replay called with a different path cannot divert an already-
provisioned surface). This is why the path, unlike branch and base-ref, may be
an argument: `CaseFileCursor` already has a field for it.

`advance` loads the case file, determines the current position, performs the
one next action, and returns. `run` loops `advance` until `done` is true
(state is `CLOSED`, `ESCALATED`, or `ABORTED`), then reads back `outcome`.
Both functions are safe to call from a fresh process against an existing
`dir`: every branch below either reads pre-entry state (cursor/header) or the
log tail, so `advance` after a crash always resumes onto a legal edge.

An already-terminal surface is recognised before any position is derived: if
`outcome` is set, `advance` returns `{ state: cursor.state, done: true }`
without touching the log or the budgets. This matters because escalation and
abort do not always append an entry (see "Escalation and abort" below), so the
log tail of a terminal surface can still look mid-flight — re-running the loop
without this guard would re-enter the machine, re-burn a budget, and fail on
`setOutcome`'s `setOnce` immutability check. For the same reason, terminal
handling writes `updateCursor(dir, { state })` alongside `setOutcome`, so the
cursor names the terminal state the outcome records.

### Determining position

```
if history has no worker-role dispatch entry yet:
  if header.baseline === null:
    if last entry (if any) is a gate-maintenance dispatch or terminus:
      position = "GATE_MAINTENANCE"          # the edge routes on by terminus status
    else:
      position = cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING"
  else:
    position = "AGENT_ACTIVE"     # baselined, no worker dispatch entry yet
else:
  position = deriveStateFromEntry(logTail(history), role-aware)  # Item 1 function, extended below
```

`position` is a `SurfaceState` in every branch. Past the first worker
dispatch it comes from `deriveStateFromEntry`, which already returns a
`SurfaceState` and is what `rebuild` uses, so a resumed position and a rebuilt
cursor can never disagree. The `TriageInput` trigger, which the state alone
does not carry, is read off the tail entry that produced the `TRIAGE`
position: a `gate` entry gives `"gate_fail"` or `"gate_error"` by its
`status`, a `close` entry gives `"close_failure"`, and an `escalate` terminus
gives `"worker_escalate"` plus its `category`. `resumeAction` returns a
different vocabulary (`ResumeAction`) and is not what the driver routes on;
its `triage`/`close_triage` split is a coarser view of the same tail read.
The pre-task versus post-task
`GATE_MAINTENANCE` disambiguation stays in the driver, which reads
`header.baseline`; `deriveStateFromEntry` sees only an entry and cannot make
that call (see "Schema extension" below).

`cursor.state` starts at `"PROVISIONING"` (set by `create`, Item 1) and the
driver advances it to `"PRE_GATING"` once the worktree exists — this is the
one cursor write that happens before any history entry. It plays the role
`provisioning.md` gives the header write: because this design creates the case
file first and provisions second, the commit point for "the worktree exists and
belongs to this surface" is the cursor advance, not the header write.

### Edges

Each edge is one `advance` call. All calls are idempotent under replay per
invariant 4; re-running a completed edge either no-ops (the underlying
Item 1/2 functions already guard `setOnce` fields) or safely repeats a
read-only action (a re-run gate check, a re-dispatch onto a dirty tree).

**PROVISIONING → PRE_GATING | ABORTED**

```
git worktree add <path> -b <branch> <base-ref>   # under try/catch
```

`branch` is `branchName(header.surfaceId)`; `base-ref` is the repo's resolved
default branch at provision time (see Decisions above). Neither is read from
or written to the case file.

On success: `updateCursor(dir, { state: "PRE_GATING", worktreeRef: path })`.
On failure: `appendEntry` is not used here (no PROVISIONING entry type
exists in the schema — provisioning has no history representation, matching
`provisioning.md`'s "the worktree is an orphan with no owning surface" case);
the driver sets `outcome` directly via `setOutcome(dir, { kind: "aborted", source: "provisioning", reason, at })`,
writes `updateCursor(dir, { state: "ABORTED" })` alongside it (per the terminal
rule above, so the terminal guard reports `ABORTED` rather than the stale
`PROVISIONING`), and returns `{ state: "ABORTED", done: true }`. A crash before this point
resumes provisioning idempotently — `git worktree add` on an existing branch
name fails cleanly and the driver tears down and retries once (matching
provisioning.md's "partial worktree" recovery), rather than looping forever.

**PRE_GATING → AGENT_ACTIVE | GATE_MAINTENANCE**

Calls `recordBaseline(dir, worktreePath)` (Item 2, already built). On
`status !== "ERROR"`: `updateCursor(dir, { state: "AGENT_ACTIVE" })`. On
`status === "ERROR"`: derive the current `gateMaintenance` count from the
log; if at cap, escalate (see Escalation below) without appending anything;
otherwise append a `dispatch` entry with `role: "gate-maintenance"` (this
append is the burn — see Decisions above), call
`agent.invoke(gateMaintenanceRoleCfg, ctx)`, append the resulting `terminus`
entry (also `role: "gate-maintenance"`), and update the cursor to
`"GATE_MAINTENANCE"`. Writing the dispatch/terminus pair here — rather than
calling the agent with nothing recorded — is what makes a crash mid-repair
resumable (see "Determining position" above) and what makes the
`gateMaintenance` budget derivable from the log on rebuild, matching every
other population.

**GATE_MAINTENANCE → PRE_GATING | GATING | GATE_MAINTENANCE | ESCALATED**

If the position is `GATE_MAINTENANCE` but no `role: "gate-maintenance"`
dispatch entry follows the entry that routed the surface here, the repair
session was never dispatched — the crash window between `TRIAGE` appending a
`fix_the_gate` triage entry and appending the dispatch that pays for it. This
edge covers that case itself: derive the `gateMaintenance` count, and under cap
append the dispatch (the burn), invoke, and append the terminus, exactly as the
`TRIAGE` edge would have; at cap, escalate. Without this the surface would
resume into `GATE_MAINTENANCE` with no terminus for the edge below to route on.
If instead a `role: "gate-maintenance"` dispatch exists with no matching
terminus, the same "dangling dispatch is an incomplete terminus" rule from
Decisions above applies: this edge appends the missing `incomplete` terminus
for it before doing anything else, then falls into the ordinary
incomplete-terminus handling below.

Entered pre-task (no baseline yet): on the repair agent's `completed`
terminus, resolves to `"PRE_GATING"` to re-baseline. Entered post-task
(triage verdict was `fix_the_gate`): on `completed`, resolves to `"GATING"`
to re-check against the existing baseline — the baseline is never recaptured
post-task. Either entry's `escalate` terminus, or the budget already being
exhausted on entry, resolves to `ESCALATED`. The post-task entry pair also
carries `role: "gate-maintenance"`, for the same resumability and
derivation reasons as the pre-task case. Per Decisions above, "resolves to"
here means the log itself must carry the distinction — a plain
`updateCursor` is not sufficient on its own, since a crash right after it
would leave `deriveStateFromEntry` re-deriving `GATE_MAINTENANCE` on resume
with no way to tell the exits apart.

An `incomplete` terminus (either entry point) derives the current
`gateMaintenance` count from the log; under cap it re-dispatches within
`GATE_MAINTENANCE` at the **same** attempt (mirroring
`INCOMPLETE_TERMINUS`'s same-attempt re-dispatch for workers — see Decisions
above), minting a new `sessionKey` with the incremented `retryCount` (also
Decisions above) — the redispatch's own `dispatch` entry is the burn, exactly
as in the pre-task/post-task entry case; at cap it escalates without
appending one. This never routes through `AGENT_ACTIVE` or a
worker-population budget: a crashed repair session is still a repair-agent
cost, not a worker one.

**AGENT_ACTIVE → GATING | ESCALATED | TRIAGE | INCOMPLETE_TERMINUS**

Determines the attempt number (`1 + count of prior "triage" entries with
verdict "reroute"` — counting terminus entries instead would overcount,
since a terminus-retry reuses its attempt number rather than advancing it,
per "Attempt numbering" below), appends a `dispatch` entry (`role: "worker"`,
or omitted — worker is the default),
calls `agent.invoke(workerRoleCfg, ctx)`, appends the resulting `terminus`
entry. Maps the terminus per `case-file.ts`'s `terminusState` table:
`completed → GATING`, `escalate → ESCALATED` (authority-class) or `TRIAGE`
(exhaustion-class — the deterministic router still gets first look, per
control-flow doc), `incomplete → INCOMPLETE_TERMINUS`. The shipped table maps
`escalate` to `ESCALATED` unconditionally, so it is extended here to branch on
`TerminusEntry.category` — see "Schema extension" below; without that, a crash
between an exhaustion-class terminus and the triage entry would resume into
`ESCALATED` and skip triage entirely.

**INCOMPLETE_TERMINUS → AGENT_ACTIVE | ESCALATED**

If the dispatch that put the surface here has no `terminus` entry yet (a
crash resumed rather than observed live — see "A dangling dispatch on
resume is an incomplete terminus" above), first appends one
(`status: "incomplete"`) for it; if a `terminus` entry is already present
(the crash was observed within the same live process, before this edge's
own `advance` call), nothing further is appended. Either way, the `terminus`
count is then derived from the log — the entry is now present exactly once
regardless of which path wrote it (see Decisions above: burns have no
separate live counter). Under cap: returns to `AGENT_ACTIVE`, re-dispatching
onto the worktree as the crashed/capped session left it, with the **same
attempt number** as the terminus entry just recorded and a new `sessionKey`
(incremented `retryCount`) — this is a retry of that attempt, not a new one
(no reset — control-flow doc, "a retried terminus re-dispatches into the
tree as it was left"). At cap: escalate. Reusing the attempt number (rather
than incrementing it) is what keeps this edge's cost attributed to
`terminus`, not `correction` — see "Attempt numbering and budget
derivation" below.

**GATING → CLOSING | TRIAGE**

Calls `runCheck(dir, worktreePath, attempt)` (Item 2, already built, appends
its own `gate` entry). `delta.pass → CLOSING`. Otherwise `TRIAGE`, carrying
the trigger (`"gate_fail"` or `"gate_error"`) that `TriagePort` reads.

**CLOSING → CLOSED | TRIAGE**

Calls `closer.close(ctx, { kind: "accepted" })`. The `CloseReport`'s `detail`
is written with `writeRef` and the resulting id stored as the entry's required
`detailRef`, matching how `runCheck` stores gate failure detail. The ref key
is `close-<count of prior close entries>`, so a `retry_close` cycle cannot
overwrite the ref an earlier `close` entry still points at — the same
collision `runCheck`'s widened gate key fixes above. `DONE`:
appends a `close` entry, calls `setOutcome(dir, { kind: "closed", ... })`, returns `CLOSED`.
`FAIL`/`ERROR`: appends the `close` entry, routes to `TRIAGE` with trigger
`"close_failure"` (the narrow router — only `retry_close` or `escalate` are
legal verdicts here, enforced by `TriagePort`'s own contract, not by this
driver).

**TRIAGE → AGENT_ACTIVE | GATE_MAINTENANCE | CLOSING | ESCALATED | ABORTED**

Assembles a `TriageInput` (trigger, escalate category if any, case file,
remaining budgets — the latest gate report is reached through the case file's
last `gate` entry and its refs, so it is not a separate field) and calls
`triage(input)` (`TriagePort`). Writes a stub
artefact `{ trigger, rationale }` via `writeRef`, keyed
`triage-<count of prior triage entries>` so repeated triage rounds never
overwrite each other's refs, and appends a `triage` entry
with `afterAttempt` (the worker attempt in flight), the trigger, the verdict,
rationale, and the resulting `artifactRef` (see Decisions
above — this item's router synthesises no richer artefact, but the field is
never omitted). The triage entry just appended **is** the `correction`/
`close` burn for `reroute`/`retry_close` verdicts (see Decisions above) —
there is no separate increment call; `TriagePort` already refused those
verdicts once `remainingBudgets` (derived before the call) showed cap. Maps
verdict to state via `case-file.ts`'s existing `triageState` table: `reroute`
advances the attempt number and returns to `AGENT_ACTIVE` (the next `advance`
call dispatches `attempt + 1`, per "Attempt numbering" below); `fix_the_gate`
appends the post-task `dispatch`/`terminus` pair with `role:
"gate-maintenance"` right here (that append is the `gateMaintenance` burn,
per Decisions above — same pattern as `PRE_GATING`'s pre-task case; a crash
between the triage entry and that append is recovered by the
`GATE_MAINTENANCE` edge's no-dispatch-yet case above) and
routes to `GATE_MAINTENANCE`; `retry_close` returns to `CLOSING`;
`escalate`/`abort` go straight to their terminal states.

### Escalation and abort

Both are terminal and handled the same way. No extra entry is appended: when
the escalate/abort came from a `TriagePort` verdict, the `TRIAGE` edge has
already appended the `triage` entry that records it; when it came from an
authority-class worker escalate or a budget exhaustion, the `terminus` and
prior entries already evidence it. The terminal handling is therefore just:
call `setOutcome`, write `updateCursor(dir, { state })` alongside it, and
fire-and-log the closer with the non-accept outcome
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
primitive with no shape change here. `sessionKey` is the driver's to mint —
`DispatchEntry` and `TerminusEntry` both require it, and the pair must
agree — so it is derived deterministically as `${role}-${attempt}-${retryCount}`
(see Decisions above), which gives a genuine same-attempt retry (one that
follows a recorded `incomplete` terminus) a distinct key from the attempt it
retries. A crash before any terminus is recorded for a dispatch never mints
a *second* `sessionKey` for that same dispatch either: per "A dangling
dispatch on resume is an incomplete terminus" above, resume appends the
missing `incomplete` terminus for the existing dispatch/`sessionKey` pair,
then lets the normal `INCOMPLETE_TERMINUS` edge mint the next retry's key —
there is no separate "complete the old session" path for `AgentPort` to
support. This item's own tests supply a scripted stub implementing the same
signature.

### `TriagePort`

```
triage(input: TriageInput) -> Promise<TriageVerdict>

TriageInput = {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure",
  category?: "exhaustion" | "authority",   # present when trigger is worker_escalate
  caseFile: CaseFile,
  remainingBudgets: BudgetSet,   # the log-derived {used, max} per population,
                                 # computed immediately before this call
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
| `gate_error` | `gateMaintenance` | `fix_the_gate` | `escalate` |
| `worker_escalate` (authority) | — | `escalate` (never overruled) | `escalate` |
| `worker_escalate` (exhaustion) | `correction` | `escalate` (this item never overrules downward — that judgement needs an agent, Item 5) | `escalate` |
| `close_failure` | `close` | `retry_close` | `escalate` |

`gate_error` has no legal verdict that just silently re-runs the check —
the schema's `TriageEntry.verdict` enum has no such case, and control-flow
doc's own TRIAGE output contract doesn't offer one either. A gate that could
not run needs `GATE_MAINTENANCE` to fix the environment, exactly like the
pre-task case; this item routes both through the same edge and the same
budget. The `gateError` population (already in `BudgetSet`, Item 1) is
reserved for a future *bounded, agent-free* re-check fast path — control-flow
doc calls this out as "cheap, stateless, re-run it" — which needs a
`TriageVerdict` case this item does not add. Left to Item 5, which owns the
verdict vocabulary's evolution alongside the real triage agent.

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

Four of the five populations (`correction`, `gateMaintenance`, `terminus`,
`close`) are enforced purely by deriving from the log, per Decisions above —
no separate `incrementBudget` mutation is called from this item's edges;
each edge derives the current count, checks it against `max`, and only then
performs the single write (a `dispatch` or `triage` entry) that is
simultaneously the action and the burn. `gateError` is tracked the same way
(`deriveBudgetsFromLog`, counting `gate` entries with `status: "ERROR"`) but
not gated on by this item's `TriagePort` — see the `gate_error` row above —
so it is visible in the case file for reporting but has no cap enforcement
in this item. `incrementBudget` (Item 1) is unused by this item's driver;
it remains available for a future caller that needs a live counter outside
this derive-then-write pattern.

Because nothing increments it, `cursor.budgets[*].used` is a denormalisation
and not authoritative — it holds whatever `create` seeded until a `rebuild`
refreshes it from the log. Only `max` is read from the cursor. This is the same
rule the control-flow doc already states for `cursor.state` ("if it ever
disagrees with the tail, the log wins"), extended to the budget counters.
Every reader that acts on a budget — this item's edges, `TriagePort` via
`TriageInput.remainingBudgets`, and Item 5's real triage agent, which sees the
same case file — must use the log-derived values, never the cursor's copy.

### Schema extension: `role` on dispatch/terminus entries

```
DispatchEntry.role?:  "worker" | "gate-maintenance"   # default "worker"
TerminusEntry.role?:  "worker" | "gate-maintenance"   # default "worker"
```

Additive and optional, so every existing case file and test (Items 1-2) is
still valid — an entry with no `role` is a worker entry. `deriveStateFromEntry`
and `resumeAction` (`case-file.ts`, Item 1) both switch on `entry.t` today;
this item extends them to also switch on `entry.role` for `dispatch` and
`terminus`, so a `gate-maintenance`-role dispatch resumes into
`GATE_MAINTENANCE` rather than `AGENT_ACTIVE` (and, in `resumeAction`'s
vocabulary, not into `incomplete_terminus`), and a `gate-maintenance`-role
`terminus` of any status resumes into `GATE_MAINTENANCE` — the edge that then
routes on to `PRE_GATING`, `GATING`, a re-dispatch or `ESCALATED` — rather
than into `GATING`/`INCOMPLETE_TERMINUS`/`ESCALATED` by the worker table.

`deriveStateFromEntry`'s worker `terminus` mapping is extended in the same
change to branch on `category`: an `escalate` terminus resolves to `TRIAGE`
when `category` is `"exhaustion"` and to `ESCALATED` when it is `"authority"`.
The shipped table returns `ESCALATED` for both, which contradicts the
`AGENT_ACTIVE` edge above and would make a crash between an exhaustion-class
terminus and its triage entry resume straight into a terminal state, silently
losing the reroute the deterministic router would have chosen. Since `rebuild`
writes this state into the cursor, the fix belongs in the derivation, not in a
driver-side override. The pre- versus post-task choice
between those two is the driver's, not the derivation's: `deriveStateFromEntry`
is given one entry and has no visibility of `header.baseline`, so widening its
signature to take the header would put a header read inside a pure function
that `rebuild` calls per entry. `deriveBudgetsFromLog` is extended the same
way — see below.

### Attempt numbering and budget derivation

Two rules pin down how `attempt` behaves across the worker/gate-maintenance
split and the reroute/retry split, because `deriveBudgetsFromLog`
(`case-file.ts`, Item 1) is now the *only* thing the driver ever checks a
budget against (see Decisions above — no live counter to keep in sync), so
it must count each population off exactly the entry this item's edges treat
as that population's burn, or a crash-resumed surface would enforce
different caps than a never-crashed one — silently breaking the "each
population enforces its cap independently" success criterion.

1. **`attempt` only advances on a worker-role reroute.** A `TRIAGE` verdict
   of `reroute` dispatches the next worker attempt (`attempt + 1`). An
   `INCOMPLETE_TERMINUS` retry re-dispatches the **same** attempt number —
   it is a retry of the attempt that produced no valid terminus, not a new
   one. Gate-maintenance dispatches carry their own attempt count (`1 +
   count of prior gate-maintenance-role terminus entries with status
   "completed" or "escalate"`), entirely separate from the worker's counter —
   the two never interact. A gate-maintenance `incomplete` terminus
   re-dispatches the **same** gate-maintenance attempt, exactly as
   `INCOMPLETE_TERMINUS` does for workers.

2. **`deriveBudgetsFromLog`'s existing `entry.attempt > 1` check is
   replaced with direct attribution to the cause entry** — not, as an
   earlier version of this design had it, to the redispatch/close entry
   that follows. Attributing to the entry *after* the cause creates exactly
   the crash window "Budgets have no separately-mutated live counter" (see
   Decisions above) exists to close, and for `terminus` at cap it is worse
   than a window: no redispatch ever follows, so that final burn would be
   permanently unrecoverable from the log. The corrected rule counts each
   population directly off the entry that recorded the triggering event:
   - `correction` ← `triage` entries with `verdict: "reroute"`
   - `close` ← `triage` entries with `verdict: "retry_close"`
   - `terminus` ← `terminus` entries with `status: "incomplete"` and worker
     role (`role` absent or `"worker"`)
   - `gateMaintenance` ← `dispatch` entries with `role: "gate-maintenance"`
     (covers both the pre-task `PRE_GATING` entry and the post-task
     `fix_the_gate` entry uniformly, since both are plain
     `role: "gate-maintenance"` dispatches, and covers an
     `incomplete`-terminus redispatch for free, since each redispatch is
     its own dispatch entry with the same role)

   This also removes the existing blanket `terminus`/`close` counts (one
   per `terminus`/`close` entry regardless of status/verdict) — those
   over-counted every `completed` terminus and every accepted close against
   budgets that exist only to cap retries.

   This is a change to `deriveBudgetsFromLog` in Item 1's already-shipped
   `case-file.ts`, made here because Item 3 is the first caller that
   exercises more than one attempt and more than one role; it is covered by
   new tests in this item's suite (crash mid-reroute, crash mid-terminus-
   retry, crash mid-gate-maintenance, crash mid-close-retry, crash between
   deriving a count and appending the entry that would have burned it),
   each asserting that the budgets a `rebuild` derives equal the budgets an
   uninterrupted run would have enforced — not a silent behind-the-scenes
   patch.

## Crash recovery

No new recovery mechanism — this item composes what Items 1 and 2 already
built. A crash at any point is recovered by calling `run(dir, worktreePath,
ports)` again:

- **Before the first history entry** (during `PROVISIONING`/`PRE_GATING`):
  resumed via `cursor.state` + `header.baseline`, per the Decisions section
  above.
- **After the first history entry**: resumed via the role- and category-aware
  `deriveStateFromEntry(logTail(...))`, per "Determining position" above.
  `resumeAction` as shipped is *not* sufficient on its own here: it is not
  role-aware (a gate-maintenance dangling dispatch must resume into
  `GATE_MAINTENANCE`, not `incomplete_terminus`, per the Schema extension
  above), though its worker dangling-dispatch → `incomplete_terminus`
  mapping is exactly right and is what "A dangling dispatch on resume is an
  incomplete terminus" (Decisions above) relies on.

The only genuinely new recovery case this item introduces is the
`PROVISIONING` partial-worktree window (`git worktree add` succeeded, the
cursor advance to `PRE_GATING` did not) — handled per `provisioning.md`: on
re-entry, the driver checks for an existing worktree at the surface's expected
path; if one is found while `cursor.state` is still `"PROVISIONING"`, it tears
down and recreates rather than adopting found state.

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
  corrupted or hand-edited case file). Carries `dir`, `state` and `edge`, and
  is thrown rather than silently ignored, per the roadmap's DX note on this
  item: name the state, the attempted edge, what went wrong.

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
