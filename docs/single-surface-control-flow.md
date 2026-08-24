# Single-Surface Control Flow

Design notes for one delivery surface of a deterministically gated agent delivery
harness. A surface takes a single task, drives an agent to complete it, and holds
the line that a deterministic gate must pass before the work is accepted. This
document covers the state machine, the gate interface, triage, and the serialised
state the whole thing reads and writes.

Scope: one surface in isolation. Provisioning/teardown detail and multi-surface
concerns are out of scope here.

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
5. **The gate is out of the worker's reach.** Whatever an agent can freely edit, it
   can neuter. The gate definition and assertion set are pinned by the harness, not
   discovered from inside the worktree.

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
  → PRE_GATING              (re-baseline)
  → ESCALATED               (unrepairable)

AGENT_ACTIVE               (fresh reconstructed session, driven via SDK)
  → GATING                 (structured output, status = completed)
  → ESCALATED              (structured output, status = escalate, authority-class)
  → TRIAGE                 (structured output, status = escalate, exhaustion-class)
  → INCOMPLETE_TERMINUS    (session ended with no valid output: crash, cap, timeout, idle)

INCOMPLETE_TERMINUS        (abnormal — agent never cleanly signalled; also the crash path)
  → AGENT_ACTIVE           (terminus-retry budget remains)
  → ESCALATED              (exhausted)

GATING                     (post-task gate; compared against the baseline fingerprint)
  → PASSED                 (no new failures)
  → TRIAGE                 (new failures, or gate error)

TRIAGE                     (router + classifier; typed verdict; never overturns a PASS)
  → AGENT_ACTIVE           (reroute; burns a correction slot; emits a sharpened brief)
  → GATE_MAINTENANCE       (fix_the_gate — environment only)
  → ESCALATED              (escalate)
  → ABORTED                (abort)

PASSED     (terminal) — worktree retained for merge/handoff
ESCALATED  (terminal) — worktree + case file retained for a human
ABORTED    (terminal) — infra failure; worktree may be torn down
```

Notes:

- **The terminus is a discriminated union**, not a boolean: `completed` vs
  `escalate`, and `escalate` carries a category (`exhaustion` vs `authority`).
- **"Agent finished" and "structured output received" are different events.** A
  session can end without valid output. That is `INCOMPLETE_TERMINUS`, distinct
  from both escalation and gate failure, and it doubles as the crash-recovery path.
- **Gate fail and gate error are separate edges.** A fail routes back to the worker
  and burns a correction slot. An error (the gate could not run) is not the agent's
  fault: it re-runs the gate or routes to gate-maintenance, on a different budget.
- **Three budgets**, each an independent deterministic counter: correction attempts
  (worker), gate-error retries (infra), terminus retries (abnormal ends). Hitting a
  cap forces escalation regardless of any classifier opinion.

## Pre-flight gate and regression attribution

The gate runs **before** dispatch to capture a per-assertion baseline fingerprint,
not just an aggregate pass/fail. This buys two things:

1. **Regression attribution.** After the task, only assertions that **passed at
   baseline and now fail** route back to the worker. Pre-existing red is never
   blamed on the agent, so the correction task is genuine regressions, not the
   gate's ambient noise.
2. **A pre-task repair branch.** A red baseline routes to a gate-maintenance agent
   before the worker starts.

Reward-hacking guard: gate-maintenance may fix the environment/harness so the gate
can *run*; it may not weaken the assertions to turn baseline green. The same limit
applies to the worker on the post-task gate. Assertion definitions are pinned; what
an agent can freely edit, it can neuter.

## Gate interface

A gate is a stateless callable pair plus a typed report. No registry, no config
surface, no lifecycle hooks. The harness supplies context and owns the diff; the
gate answers "what is true now" honestly and comparably.

```
gate.baseline(ctx)         -> GateState     # before dispatch; read-only, idempotent
gate.check(ctx, baseline)  -> GateReport    # after task;      read-only, idempotent
```

`ctx` is a handle to the work location plus task metadata. Both calls are read-only
and side-effect free: a gate that mutates the world it judges is not a gate. The
`GateState` is **serialised**, so the surface survives connection drops and machine
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
- triggering event           # gate fail-delta | gate error | worker escalate(category)
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

Triage is read-only over the case file and produces a verdict with no side effect
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
  baseline                    # serialised GateState fingerprint (per-assertion)

  # ── cursor: mutable, the resume marker ──
  state                       # PRE_GATING | AGENT_ACTIVE | GATING | TRIAGE
                              # | GATE_MAINTENANCE | PASSED | ESCALATED | ABORTED
  budgets                     # correction: {used, max}
                              # gate_error: {used, max}
                              # terminus:   {used, max}
  worktree_ref

  # ── history: append-only ordered log of typed entries ──
  history: [ Entry ]

  # ── outcome: written once, on a terminal state ──
  outcome?                    # {kind: passed|escalated|aborted, source, reason, at}
}
```

```
Entry =
  | { t:"dispatch", attempt, session_key, brief_ref? }
        # written WHEN the session starts. brief_ref null on a raw reroute / attempt 1.
  | { t:"terminus", attempt, session_key,
        status: completed|escalate|incomplete,
        category?,             # for escalate: exhaustion | authority
        rationale }
  | { t:"gate", attempt,
        status: PASS|FAIL|ERROR,
        new_failures: [{id, detail_ref}],   # empty on the PASS that ends the run
        class: fail|error }
  | { t:"triage", after_attempt, trigger,
        verdict: reroute|escalate|fix_the_gate|abort,
        rationale, artifact_ref }            # artifact_ref → the brief or packet
```

### The log tail is the crash detector

Entries are written at their event boundaries (dispatch at session start, terminus
at session end, gate after it runs, triage after it decides). A resume reads the
tail; each tail type maps to exactly one action:

```
tail = dispatch, no terminus     → session died → treat as INCOMPLETE_TERMINUS (existing edge)
tail = terminus(completed)       → died before/during gate → re-run gate (idempotent, safe)
tail = gate(fail|error)          → died in routing → run triage
tail = triage(verdict)           → died before acting → act on the recorded verdict
tail = gate(PASS) / terminal     → done
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

- Surface lifecycle boundary: provisioning and teardown of the worktree, and what
  each terminal state hands off to.
- Lifting from a single surface to many.
