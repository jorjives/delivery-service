# Single-Surface Control Flow

Design notes for one delivery surface of a deterministically gated agent delivery
harness. A surface takes a single task, drives an agent to complete it, and holds
the line that a deterministic gate must pass before the work is accepted. This
document covers the state machine, the gate interface, the close interface, triage,
and the serialised state the whole thing reads and writes.

Scope: one surface in isolation. Close/teardown is covered via the close interface;
the `PROVISIONING` entry edge is covered in [provisioning](provisioning.md); other
multi-surface concerns are out of scope here.

## Core concepts

- **Surface**: the unit that owns one task from dispatch to a terminal outcome. It
  provisions an isolated worktree once and releases it once.
- **Attempt**: one agent session (run to a structured-output terminus) plus one
  gate run against the resulting world state.
- **Gate**: a deterministic assertion about world state after the task. Its
  pass/fail verdict is authoritative.
- **Triage**: a bounded classifier that decides routing on the non-pass edges and
  distils accumulated history into a focused artifact for the next handler.
- **Case file**: the serialised state for the surface. It is what the machine
  resumes from, what triage reads, and what an escalation hands to a human.

## Governing invariants

1. **The gate's pass/fail is authoritative.** No classifier may overturn a PASS,
   and none may push a completion up into a failure. Determinism lives in the
   acceptance decision; judgement lives only in the recovery decision.
2. **Sessions are reconstructed, not resumed.** Each attempt is a fresh agent
   session primed with distilled history. Context bloat kills success, so we never
   carry a live agent context between attempts.
3. **All surface state is serialised; there is no warm-memory dependency.** The
   surface is a resumable state machine. A crash mid-attempt is recoverable from
   disk alone.
4. **Every state transition is a commit point.** Node actions are idempotent under
   replay, so re-running a node on resume is always safe.
5. **The gate is out of the agent's reach to alter, never out of its sight.** The agent is told
   what the check is and may run it. The gate definition is pinned by the harness and loaded from
   the main checkout, a custom gate's module is verified unchanged on every round, and the guards
   refuse a change to how tests run.
6. **The agent runs as the operator's Claude Code would.** Their settings, CLAUDE.md,
   skills, plugins, hooks and MCP servers load, and every tool is available. The harness
   appends its context to Claude Code's own system prompt; it never replaces it.
7. **Prohibitions are checks, not prose.** What the agent may not do to the tests is refused by a
   guard at acceptance, by name, on every run; the agent is told what will judge its work, not
   given a list of rules to obey. A gate repair is judged by the same guards when it ends, on its
   own change: its change to how tests run is accepted and reported, anything else the guards
   refuse stops the run there. Judgement, not just retry: a round that fails on the settings guard
   alone is put to triage immediately, not only on the last correction slot, because no retry
   changes that verdict by itself.

## State machine

```
PROVISIONING
  worktree created, task injected
  → PRE_GATING              (ready)
  → ABORTED                 (provision failed)

PRE_GATING                  (gate runs to establish the baseline fingerprint)
  → AGENT_ACTIVE            (baseline captured — green or known-red)
  → GATE_MAINTENANCE        (gate could not run / red beyond tolerance)

GATE_MAINTENANCE            (repair agent; environment/harness only, NOT assertions)
  → PRE_GATING              (entered pre-task: re-baseline, no baseline exists yet)
  → GATING                  (entered post-task via fix_the_gate: re-check, baseline is immutable)
  → ESCALATED               (unrepairable)

AGENT_ACTIVE               (fresh reconstructed session, driven via SDK)
  → GATING                 (structured output, status = completed)
  → ESCALATED              (structured output, status = escalate, authority-class)
  → TRIAGE                 (structured output, status = escalate, exhaustion-class)
  → INCOMPLETE_TERMINUS    (session ended with no valid output: crash, cap, timeout, idle)

INCOMPLETE_TERMINUS        (abnormal — agent never cleanly signalled; also the crash path)
  → AGENT_ACTIVE           (terminus-retry budget remains)
  → ESCALATED              (exhausted, or the runtime never started a session)

GATING                     (post-task gate; compared against the baseline fingerprint)
  → CLOSING                (accepted — no new failures)
  → TRIAGE                 (new failures, or gate error)

CLOSING                    (variable close action: merge / open PR / cleanup / infra teardown)
  → CLOSED                 (closer DONE)
  → TRIAGE                 (closer FAIL/ERROR — infra-class; narrow router, no reroute)

TRIAGE                     (router + classifier; typed verdict; never overturns a PASS)
  → AGENT_ACTIVE           (reroute; burns a correction slot; emits a sharpened brief)
  → GATING                 (recheck_gate — gate error, re-run free against the same baseline; burns a gate-error slot; router only, no agent)
  → GATE_MAINTENANCE       (fix_the_gate — environment only; once gate-error rechecks are spent)
  → CLOSING                (retry_close — post-acceptance close failure; burns a close slot)
  → ESCALATED              (escalate)
  → ABORTED                (abort)

CLOSED     (terminal) — close action completed (merged / PR opened / cleaned up)
ESCALATED  (terminal) — worktree + case file retained for a human
ABORTED    (terminal) — infra failure; worktree may be torn down
```

Notes:

- **The terminus is a discriminated union**, not a boolean: `completed` vs
  `escalate`, and `escalate` carries a category (`exhaustion` vs `authority`).
- **"Agent finished" and "structured output received" are different events.** A
  session can end without valid output. That is `INCOMPLETE_TERMINUS`, distinct
  from both escalation and gate failure, and it doubles as the crash-recovery path.
  Its definition is negative: *any* session that ended without emitting valid
  structured output — crash, token/turn cap, timeout, idle, or output that failed
  schema validation. On the other two edges the agent signalled intent (completed,
  or escalate-with-category) and you can route on it; here there is no signal, so
  the only moves are retry-on-terminus-budget or give up.
- **A session the runtime never started is not retried.** The retry budget exists
  because a further attempt might land differently, and for a session that was
  refused before its first token nothing between attempts can differ — so those
  spawns cost real money and real delay to reach the same end. That terminus
  carries `notRun`, and both edges that retry an incomplete terminus (this one and
  `GATE_MAINTENANCE`'s) check it ahead of their budget, exactly as an authority
  limit is checked ahead of the router's table. It escalates after one attempt,
  naming the runtime rather than a budget. The other causes above keep their retries.
- **A retried terminus re-dispatches into the tree as it was left.** A crashed
  session may have made partial worktree edits before dying. The fresh worker treats
  that dirty tree as found-state (plus its distilled history), exactly as it treats
  external side-effects: the gate is ground truth for what is still red. The
  worktree is not reset between terminus retries.
- **Gate fail and gate error are separate edges.** A fail routes back to the worker
  and burns a correction slot. An error (the gate could not run) is not the agent's
  fault: it re-runs the gate or routes to gate-maintenance, on a different budget.
- **Budgets are independent deterministic counters**, one per failure population so
  each gets a cap that fits its cost:
  - **correction** (worker) — genuine regressions rerouted for a fix.
  - **gate-error retries** (infra) — the gate flaked; cheap, stateless, re-run it.
    Each `recheck_gate` triage verdict is one burn; the errored gate entry itself
    costs nothing. Only once these are spent does a gate error reach gate-maintenance.
  - **gate-maintenance** (agent) — the environment is broken; dispatch a repair
    agent. Expensive and stateful, so a *low* cap: a repair agent that fails once
    rarely succeeds on the third.
  - **terminus retries** (abnormal ends).
  - **close retries** (infra) — a post-acceptance close that flaked; bounded so a
    transient docker hiccup cannot escalate a good CLOSED to a human.

  Hitting any cap forces escalation regardless of any classifier opinion.
  gate-error and gate-maintenance are kept separate on purpose: one says "run the
  gate again", the other says "send an agent to fix the box" — different cost,
  different sensible cap, so a shared counter would serve both badly.

## Pre-flight gate and regression attribution

The gate runs **before** dispatch to capture a per-assertion baseline fingerprint,
not just an aggregate pass/fail. This buys two things:

1. **Regression attribution.** After the task, only assertions that **passed at
   baseline and now fail** route back to the worker. Pre-existing red is never
   blamed on the agent, so the correction task is genuine regressions, not the
   gate's ambient noise.
2. **A pre-task repair branch.** A red baseline routes to a gate-maintenance agent
   before the worker starts.

**The baseline is captured exactly once per surface, before the first dispatch, and
is immutable thereafter** (it lives in the immutable header of the case file). This
is why gate-maintenance has two exits. Entered *pre-task* it returns to `PRE_GATING`
to establish the baseline that does not yet exist. Entered *post-task* via
`fix_the_gate`, the worker has already changed the world, so re-running `baseline`
would bake the worker's edits into the fingerprint and destroy the attribution
reference. It must instead return to `GATING` and re-check against the original,
sacred baseline. Post-task maintenance repairs the box so the pinned assertions can
*run*; it never re-establishes what "before" meant.

Reward-hacking guard: gate-maintenance may fix the environment/harness so the gate
can *run*; it may not weaken the assertions to turn baseline green. The same limit
applies to the worker on the post-task gate. Assertion definitions are pinned; what
an agent can freely edit, it can neuter.

## Gate interface

A gate is a stateless callable pair plus a typed report. No registry, no config
surface, no lifecycle hooks. The harness supplies context and owns the diff; the
gate answers "what is true now" honestly and comparably.

```
gate.baseline(ctx)         -> GateReport    # before dispatch; read-only, idempotent
gate.check(ctx)            -> GateReport    # after task;      read-only, idempotent
```

`ctx` is a handle to the work location plus task metadata. Both calls are read-only
and side-effect free: a gate that mutates the world it judges is not a gate. The
baseline `GateReport` is **serialised**, so the surface survives connection drops and machine
restarts without dropping warm work.

```
GateReport = {
  status: PASS | FAIL | ERROR,          # gate-level: did it even run?
  assertions: [
    { id: stable-string,
      outcome: PASS | FAIL | ERROR | ABSENT,
      detail: string }
  ]
}
```

- **`status` is tri-state.** The fail-vs-error distinction is structural, not
  inferred from an exit code.
- **Assertions carry stable IDs.** This is the entire regression-attribution
  mechanism: an ID must be the same at baseline and at check. A gate that cannot
  produce stable IDs degrades gracefully to `n=1` (one aggregate assertion) and
  simply loses per-item attribution.

### The delta rule (harness-owned)

The harness computes the verdict; the gate only reports current state.

```
newFailures = { a.id : baseline[a.id] == PASS  and  check[a.id] ∈ {FAIL, ERROR, ABSENT} }

surface PASS  ⟺  newFailures is empty  AND  gate-level status ≠ ERROR
otherwise     → TRIAGE, carrying newFailures and whether it is fail-class or error-class
```

### Consequences

- **No-op detection is free.** "Expected effect occurred" is just another
  assertion (`email:sent → FAIL` when nothing was sent). It was PASS-able at
  baseline and FAILs now, so it counts as a new failure. No separate mechanism.
- **`ABSENT` closes the delete-the-test exploit.** `baseline == PASS and
  check == ABSENT` counts as a new failure. A test that passed at baseline and has
  vanished is a regression, not a neutral. Pin the assertion *set* at baseline too,
  so IDs cannot be renamed to dodge the match.
- **Flakiness is the residual risk.** The baseline halves it (ambient red is
  ignored), but an assertion green at baseline that flakes red at check is
  mis-attributed to the worker. This is a gate-quality problem, not an interface
  one. Mitigations: quarantine a known-flaky ID via gate-maintenance, or an
  optional bounded re-check of *only* the newly-failing assertions (off by default).
- **The gate's subject is variable, not just its scope.** It may assert over a
  worktree diff, a database row, or an outbox record. Whatever the subject, it must
  expose a before-snapshot (`baseline`) and an after-check (`check`).

### Side-effecting tasks

For a task whose effect is external (sent an email, charged a card), re-dispatch
after a crash could repeat the action. This is an at-least-once vs exactly-once
question that belongs to the task, not the machine. The lever the interface already
gives: `baseline`/`check` can detect "already done" (e.g. an outbox high-water
mark), so a well-written gate lets the reconstructed worker see the effect already
happened and skip it. This is a documented obligation on whoever writes such gates,
not something the harness enforces generically.

## Close interface

Acceptance and close are separate events. `GATING` decides the work is *good*;
`CLOSING` does something *with* it. Splitting them keeps invariant 4 intact — the
accept decision and the close land as two commits, so a crash between them re-runs
close idempotently against an already-accepted case file.

Close is variable in the same way the gate is: the harness owns *when* it runs and
*that its verdict is acted on*; it does not own *what* closing means. Injected and
pinned by the harness, opaque to the worker.

```
closer.close(ctx, outcome) -> CloseReport { status: DONE | FAIL | ERROR, detail }
```

- **The strategy is keyed on `outcome`.** Merge back, open a PR, cleanup-only,
  docker teardown: all just closer implementations, or a composed chain. The harness
  never inspects the strategy. Infra teardown (removing container traces, releasing
  the worktree) is the closer's business, not the harness's.
- **Close failure is infra-class, not worker-class.** The work is already accepted
  and correct, so rerouting to a fresh worker is meaningless. Close-triage is a
  *narrow* router: its only live verdicts are `retry_close` (repair/retry, bounded
  by the close budget) or `escalate`. No `reroute`.
- **CLOSING is on the accept path.** `ESCALATED` and `ABORTED` may also need infra
  teardown, handled by invoking the closer with that outcome, but as a fire-and-log
  step: they are already terminal or human-owned, so a teardown failure there is
  surfaced, not re-triaged. Only the accept-path close routes back into triage.

## Triage

Triage's job, stated once: **compress the accumulated mess into a focused artifact
for whoever handles the next step.** Same skill, two audiences: a fresh worker (a
sharpened brief) or a human (an escalation packet).

### Authority model

The worker's `escalate` is advisory and categorised:

- **authority-class** (needs a human decision, a credential, or sign-off on a
  destructive action): passes straight through, triage cannot overrule it. A fresh
  worker would hit the same wall.
- **exhaustion-class** ("stuck / I don't see how"): triage may overrule it
  *downward* to a reroute, because most such escalations are context exhaustion, and
  a fresh reconstructed session primed with a distilled brief often walks straight
  to the fix.

The asymmetry is the safety property: triage can pull an exhaustion escalation down
into another attempt, but can never push a completion up into a failure, and never
overturn the gate. Overrules are **bounded by the correction cap** — every reroute
burns a slot, so worker-escalate / triage-reroute cannot ping-pong forever. At the
cap, escalation is forced.

### Input contract

Triage reads, it does not touch:

```
- task definition            # original intent — for plausibility and the brief
- case file                  # prior attempts: index, session_key, terminus, gate_delta, prior triage rationales
- triggering event           # gate fail-delta | gate error | worker escalate(category) | close failure
- current gate report        # the concrete newly-failing assertions, verbatim
- remaining budgets          # how close to the cap
```

Two load-bearing inputs: **prior triage rationales** stop triage looping its own
wrong call, and **remaining budgets** change the verdict (with one slot left, a
clean escalation beats a long-shot reroute).

### Output contract

One agent call, structured output, discriminated on verdict. `rationale` is always
recorded, because it is the input the next triage round reads.

```
{ verdict: "reroute",      brief:  SharpenedBrief,   rationale }
{ verdict: "escalate",     packet: EscalationPacket, rationale }
{ verdict: "fix_the_gate", brief:  GateRepairBrief,  rationale }
{ verdict: "retry_close",  brief:  CloseRepairBrief, rationale }   # close-failure trigger only
{ verdict: "abort",        reason,                   rationale }
```

### The sharpened brief

```
SharpenedBrief = {
  problem:     crisp statement of what is actually failing and what it implies,
  evidence:    the raw newly-failing assertions, VERBATIM,   # not paraphrased
  dead_ends:   what prior attempts tried and why it missed,  # so the fresh agent doesn't repeat them
  scope:       what to touch / what to leave,
  references:  session_keys for on-demand deep lookup,
  diagnosis:   triage's hypothesis of root cause — flagged AS a hypothesis
}
```

Two rules, both guarding against triage confidently sending a fresh agent down a
wrong path:

- **Synthesis augments evidence, never replaces it.** The brief carries triage's
  read *and* the verbatim gate output, so the worker has ground truth plus direction
  and can disagree with the direction.
- **Diagnosis is a hypothesis, not a verdict.** Evidence governs; triage suggests.

`dead_ends` is the highest-value field: it is the one thing a fresh reconstructed
session cannot derive for itself, and the reason a clean agent with the brief beats
the exhausted agent that gave up.

### Keep the agent off the fast path

Most non-pass events need no judgement. Split it:

- **Deterministic router** handles the common case: fail-class + budget remaining +
  no escalate → reroute with the raw delta and appended history. No agent call.
- **Triage agent** engages only where there is a real decision or real distillation
  value: a worker escalate to possibly overrule, a gate error to classify as
  fixable, the cap boundary, or history deep enough that a brief beats the raw
  delta. Treat the depth threshold as a tuning knob.

### Recoverability

Triage works in a disposable copy, so it leaves nothing behind, and produces a verdict with no side effect
until the harness acts. The transition (record verdict + act) is the commit point,
exactly like the gate: a crash before recording re-runs triage harmlessly; a crash
after reads the recorded verdict and proceeds.

## Case file

The serialised state for a surface, split by mutability: an immutable header, a
mutable cursor, and an append-only log.

```
CaseFile = {

  # ── header: identity + pinned inputs, immutable for the run ──
  surface_id
  task_def                    # original intent
  gate_ref                    # pinned gate identity + version
  baseline                    # serialised baseline GateReport (per-assertion)

  # ── cursor: mutable, the resume marker ──
  state                       # PRE_GATING | AGENT_ACTIVE | GATING | TRIAGE
                              # | GATE_MAINTENANCE | CLOSING
                              # | CLOSED | ESCALATED | ABORTED
  budgets                     # correction:       {used, max}
                              # gate_error:        {used, max}
                              # gate_maintenance:  {used, max}
                              # terminus:          {used, max}
                              # close:             {used, max}
  worktree_ref

  # ── history: append-only ordered log of typed entries ──
  history: [ Entry ]

  # ── outcome: written once, on a terminal state ──
  outcome?                    # {kind: closed|escalated|aborted, source, reason, at, packet_ref?, cause?}
                              # packet_ref: escalated only → the EscalationPacket a person reads
                              # (decision, verbatim evidence, dead ends, why now, session keys)
                              # cause: escalated and aborted only → {kind, role?, population?}, why the
                              # task stopped, as a closed set. Read only by reporting, never by routing.
}
```

```
Entry =
  | { t:"dispatch", attempt, session_key, brief_ref?, role? }
        # written WHEN the session starts. brief_ref null on a raw reroute / attempt 1.
        # role: worker (default, may be absent) | gate-maintenance — a repair
        # session records the same crash-recoverable dispatch/terminus pair as a
        # worker, on the gate_maintenance budget rather than the worker's.
  | { t:"terminus", attempt, session_key,
        status: completed|escalate|incomplete,
        category?,             # for escalate: exhaustion | authority
        rationale, role?,      # role as above; must match its dispatch
        limit?,                # for incomplete: rate | spend, the usage limit that stopped the
                               # session. Read only by reporting, never by routing.
        changes_ref? }         # gate-maintenance only → RepairChanges: what the repair changed
                               # in the working copy (files, counts, touches_check, capped
                               # patches), captured read-only before this entry. Read only by
                               # reporting, never by routing.
  | { t:"gate", attempt,
        status: PASS|FAIL|ERROR,
        new_failures: [{id, detail_ref}],   # empty on the PASS that ends the run
        class: fail|error }
  | { t:"triage", after_attempt, trigger,
        verdict: reroute|escalate|fix_the_gate|retry_close|abort|recheck_gate,
        rationale, artifact_ref }            # artifact_ref → the brief or packet
  | { t:"close",
        status: DONE|FAIL|ERROR,
        detail_ref }                         # written after the closer runs
```

### The log tail is the crash detector

Entries are written at their event boundaries (dispatch at session start, terminus
at session end, gate after it runs, triage after it decides). A resume reads the
tail; each tail type maps to exactly one action:

```
tail = dispatch, no terminus     → session died → treat as INCOMPLETE_TERMINUS (existing edge)
tail = terminus(completed)       → died before/during gate → re-run gate (idempotent, safe)
tail = gate(fail|error)          → died in routing → run triage
tail = gate(PASS)                → accepted, died before/during close → run closer (idempotent)
tail = triage(verdict)           → died before acting → act on the recorded verdict
tail = close(FAIL|ERROR)         → died in routing → run close-triage
tail = close(DONE) / terminal    → done
```

There is no separate recovery subsystem: the structure of the log *is* the recovery
logic, and it reuses edges that already exist. Each append is a commit; the tail is
always a legal resume point. The `state` cursor is a denormalisation for fast reads;
if it ever disagrees with the tail, the log wins.

### Inline vs reference

Keep the case file lean so appends stay cheap and the whole thing stays comfortably
serialisable.

- **Inline**: small structured data — indices, session keys, statuses, categories,
  short rationales, assertion IDs, budget counters.
- **By reference**: anything that can balloon — full session transcripts (external,
  keyed by `session_key`), sharpened-brief / escalation-packet prose
  (`artifact_ref`), and raw failing-assertion output (`detail_ref`).

The case file holds the skeleton and the pointers; big blobs live beside it. Triage
dereferences a `detail_ref` when it needs verbatim evidence; a human dereferences a
transcript when the packet is not enough.

### Session keys

Each attempt records its `session_key`. This is a pointer for inspection and an
optional deep-link, **not** the continuity mechanism: continuity flows through the
distilled history. Transcript lookup is pull, not push — a fresh worker gets the
brief by default and may look up a specific transcript for a specific detail. Auto-
pulling a full prior transcript would reconstruct the bloat we chose to avoid.

## Open items

- Lifting from a single surface to many: scheduling, the shared worktree/resource
  pool, concurrency caps, and whether the budgets stay per-surface.
