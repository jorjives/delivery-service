# Single-Surface State Machine — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface yet (a real
agent, real triage judgement, and a real closer arrive in Items 4, 5, 6; CLI
configuration arrives later still). Per the roadmap's two-audience split, the
user for this item is a **harness extender** — an engineer building on the
state machine who needs to see it drive a surface through its states
correctly, using scripted ports as stand-ins for the real ones. UAT below is
written for that audience: each slice ships a runnable demo script whose
printed output a reviewer reads to confirm the behaviour, in place of a
product UI that doesn't exist yet — matching the pattern already established
for Item 2 (`2026-09-05-gate-interface-slices.md`).

---

## Slice 1: Provision a Surface and Reach Its First Decision Point

**Status:** ✅ Complete — 2026-09-08 — `091a924`
**Tests:** ✅ Recorded — 2026-09-08 — `787eff4` — cli — 4 UAT + 6 AC, 0 skipped

**Delivers:** A harness extender can hand the driver a bare directory and a
fresh worktree location and watch it create a real git worktree, capture a
baseline gate report against it, and land on either "ready for a worker" or
"the gate itself needs repair first" — the entry ramp every surface takes
before any agent work happens.

**Operational note:** this slice introduces the state machine's first error
paths (a failed provision, an unrecognised cursor state). Per the roadmap's
DX decision for this item, these errors must name the state and the attempted
edge, not surface as a raw stack trace — this is the baseline every later
slice's error messages build on.

### Prerequisites

- None

### Acceptance Criteria

- [ ] Given a fresh case file directory and no existing worktree, running the
      driver creates a real git worktree on a branch derived from the
      surface's id, off the repository's default branch
- [ ] Once the worktree exists, the surface automatically records a baseline
      gate report against it without any further input
- [ ] When the baseline gate report comes back healthy or with pre-existing
      failures, the surface lands in the state that's ready to dispatch a
      worker
- [ ] When the baseline gate report comes back with an error (the gate itself
      couldn't run), the surface instead dispatches a repair attempt against
      a scripted agent, and a repair that succeeds re-baselines and reaches
      the same "ready to dispatch a worker" state
- [ ] A repair attempt that fails outright, or that exhausts its repair
      budget, ends the surface in an escalated state instead of looping
      forever
- [ ] A worktree creation failure (e.g. an unusable base path) ends the
      surface in an aborted state with a reason, rather than crashing the
      driver

### UAT

**How to try it:**
1. Run the included provisioning demo script.
2. The script points the driver at a fresh directory and a real temporary
   git repository, once with a project whose gate passes cleanly and once
   with a project whose gate is broken until a scripted repair agent fixes
   it, then once more with a repair agent that never fixes it.
3. Read the printed sequence of states the driver moves through for each
   run.

**What you should see:** The healthy-gate run shows a worktree created, a
baseline captured, and the surface landing on "ready for a worker" with no
repair dispatched. The broken-then-fixed run shows a repair session
dispatched, the gate re-baselined after it succeeds, and the same "ready for
a worker" landing. The never-fixed run shows repeated repair attempts up to
the cap, then an escalated outcome.

**Why this matters:** Nothing downstream — dispatching a worker, gating its
work — can happen until a surface has a real worktree and a trustworthy
baseline to measure against; this is the ground every later slice stands on.

---

## Slice 2: Drive a Worker's Change Through the Gate to a Decision

**Status:** ✅ Complete — 2026-09-08 — `e574130`
**Tests:** ✅ Recorded — 2026-09-08 — `be3a906` — cli — 1 UAT + 4 AC, 0 skipped

**Delivers:** A harness extender can watch the driver dispatch a scripted
worker session, gate its result against the recorded baseline, and reach a
close decision on a clean success — the full happy-path loop from "ready for
a worker" through to a completed surface.

### Prerequisites

- A surface can reach "ready to dispatch a worker" from a fresh provision
  (Slice 1)

### Acceptance Criteria

- [ ] Dispatching a scripted worker session that completes cleanly runs the
      gate against the surface's recorded baseline
- [ ] A gate result with no new failures moves the surface to closing, and a
      scripted closer that accepts the work ends the surface in a closed
      state
- [ ] A worker session that ends without a valid result (crash, cap, timeout)
      is retried once against the same attempt, and repeated exhaustion of
      that retry budget ends the surface in an escalated state
- [ ] A worker session that reports it cannot proceed and is confident that's
      a genuine authority limit (not something retrying could fix) ends the
      surface in an escalated state directly
- [ ] Running the same happy-path scenario twice produces the same sequence
      of states both times, given the same scripted responses

### UAT

**How to try it:**
1. Run the included happy-path demo script.
2. The script provisions a fresh surface against a real temporary git
   repository, dispatches a scripted worker that produces a clean change,
   and lets the driver run to completion unattended.
3. Read the printed sequence of states the driver moves through, ending in
   the closed outcome.

**What you should see:** A single printed run showing every state from
provisioning through to closed, with no manual intervention between them —
proving a surface can go from nothing to done end to end.

**Why this matters:** This is the core delivery loop the whole harness exists
to run — every other slice is either a variation the happy path must also
survive, or a way of recovering from it going wrong.

---

## Slice 3: Route a Setback Back Into the Loop Instead of Giving Up

**Status:** ✅ Complete — 2026-09-08 — `e9fad5b`

**Delivers:** A harness extender can watch a gate failure, a close failure,
or a worker's own "I'm stuck but this might just need another try" signal
get routed by the deterministic triage router back into another worker
attempt, a gate repair, or another close attempt — instead of the surface
escalating on the first thing that goes wrong.

### Prerequisites

- A worker's clean completion can be gated and closed (Slice 2)
- A surface can dispatch and resolve a gate-repair attempt (Slice 1)

### Acceptance Criteria

- [ ] A gate failure caused by the worker's own change (not an infrastructure
      error) routes to another worker attempt, using the next attempt number
- [ ] A gate that errors out during the post-worker check routes to a repair
      attempt, and a successful repair returns the surface to re-checking the
      gate against the same baseline (not re-baselining)
- [ ] A closer that reports the surface isn't actually ready routes back to
      another close attempt
- [ ] A worker's "I'm stuck, but retrying might help" signal is retried by
      the deterministic router as another worker attempt, up to its own cap
- [ ] Each of these routes eventually reaches a closed, escalated, or
      aborted outcome — none of them can loop without ever reaching a
      terminal state, given the scripted double's caps
- [ ] A verdict that ends the surface outright (whether from a triage
      decision or the router refusing to help further) leaves the surface in
      the matching terminal state with no further dispatch

### UAT

**How to try it:**
1. Run the included setback-routing demo script.
2. The script runs four scenarios against fresh surfaces: a worker change
   that fails the gate once then passes on retry, a gate that errors after a
   worker attempt and needs repair before a re-check passes, a closer that
   rejects once then accepts, and a worker that reports it's stuck but
   succeeds on a retried attempt.
3. Read the printed sequence of states for each scenario.

**What you should see:** Each scenario shows the setback (failed gate,
errored gate, rejected close, or stuck worker), the router's routing
decision, the retried or repaired attempt, and a final closed outcome — no
scenario ends early or loops indefinitely.

**Why this matters:** Real work rarely succeeds on the first try; this is
what keeps a surface progressing through ordinary setbacks instead of
escalating to a human for problems a retry or a repair would have solved.

---

## Slice 4: Stop Cleanly When a Retry Budget Runs Out

**Delivers:** A harness extender can watch each of the surface's five retry
budgets (worker corrections, gate repairs, incomplete-terminus retries,
close retries, and gate errors) get enforced independently — a scripted
double that never produces a resolving result exhausts its specific budget
and the surface escalates, rather than retrying forever or draining a budget
that belongs to a different kind of setback.

**Operational note:** escalation triggered by a budget cap must say which
population was exhausted and its cap, per the roadmap's DX decision for this
item — this is what lets an extender immediately tell "ran out of retries"
apart from any other kind of escalation when reading the surface's history.

### Prerequisites

- Every routing path that can burn a budget (worker retry, correction,
  gate repair, close retry) is exercised by the loop (Slice 3)

### Acceptance Criteria

- [ ] A worker that always reports "stuck, try again" exhausts the
      correction budget at exactly its cap and escalates — not one attempt
      before or after
- [ ] A gate that always errors out exhausts the gate-repair budget at
      exactly its cap and escalates
- [ ] A worker session that always ends without a valid result exhausts the
      incomplete-terminus retry budget at exactly its cap and escalates
- [ ] A closer that always rejects the work exhausts the close-retry budget
      at exactly its cap and escalates
- [ ] Exhausting one budget never consumes another — running a scenario that
      only ever burns the correction budget leaves every other budget
      unburned when the surface escalates
- [ ] Stopping the driver partway through a budget-exhausting scenario and
      resuming it from the same directory reaches the same escalation at the
      same cap, not later and not sooner

### UAT

**How to try it:**
1. Run the included budget-exhaustion demo script.
2. The script runs one scenario per budget, each scripted so the relevant
   port never produces a resolving result, and prints the number of retries
   observed before escalation for each.
3. Read the printed retry count against each budget's known cap.

**What you should see:** Each scenario's printed retry count exactly matches
that budget's cap before the surface escalates — no scenario retries once
too many or gives up early, and no scenario's retries show up against the
wrong budget.

**Why this matters:** Without independently enforced caps, a stuck surface
could retry indefinitely and never reach a human, or give up on a setback a
single retry would have solved — these caps are what makes "escalate to a
person" a bounded, trustworthy guarantee.

---

## Slice 5: Resume a Surface After a Crash to the Same Outcome

**Delivers:** A harness extender can stop the driver at any point in a
surface's run — mid-provision, mid-repair, mid-worker-attempt, mid-triage —
throw away everything except what's on disk, and resume it, and see it reach
exactly the outcome an uninterrupted run of the same scenario would have
reached.

**Operational note:** resumed runs must be indistinguishable in outcome from
uninterrupted ones, and any resume-time recovery step (an interrupted
provision restarted, a dangling attempt turned into a recorded retry) should
be visible in what gets printed, per the roadmap's DX decision that crash
recovery is a primary debugging surface for this item.

### Prerequisites

- Every state along the happy path and its setback routes exists and is
  reachable (Slices 1-3)
- Budget caps are enforced identically however a surface reaches them
  (Slice 4)

### Acceptance Criteria

- [ ] Stopping and resuming before a worktree has been created re-attempts
      provisioning cleanly rather than adopting a half-created worktree
- [ ] Stopping and resuming after a worker session started but before its
      result was recorded treats that session as unresolved and retries it,
      rather than dispatching a duplicate session or losing the attempt
- [ ] Stopping and resuming after a repair session started but before its
      result was recorded behaves the same way for repair sessions
      specifically, without being mistaken for a worker retry
      or consuming a worker budget
- [ ] Stopping and resuming after a triage decision but before its
      consequence was carried out (a repair dispatch, a retried close)
      completes that consequence on resume rather than repeating the triage
      decision itself
- [ ] For every scenario above, running the whole thing uninterrupted and
      running it with a stop-and-resume in the middle produce the same final
      outcome and the same budget counts

### UAT

**How to try it:**
1. Run the included crash-recovery demo script.
2. The script runs each scenario from Slices 1 through 4 twice: once
   straight through, and once stopped after a fixed number of steps and
   resumed fresh against the same directory as if a new process had picked
   it up.
3. Read the two printed outcomes side by side for each scenario.

**What you should see:** For every scenario, the uninterrupted run and the
stop-and-resume run print the identical final outcome and the identical
final budget counts — proving a crash at any recorded point loses no work
and repeats none.

**Why this matters:** Agent sessions run unattended and can be killed at any
moment by infrastructure outside the harness's control; this is the
guarantee that makes that survivable rather than something a human has to
notice and manually recover from.

---
