# Multi-Surface Control Flow

Planning notes for lifting the delivery harness from one surface to many. The
[single-surface control flow](single-surface-control-flow.md) is the unit; this
document plans the supervisor that runs N of them against one target. It is a
plan, not a finished design: it records the decisions taken so far, the reasoning
behind them, and what is still open.

## Runtime scope

A run is scoped to **one target**. Targets are chosen and configured per run, so
the supervisor is always single-target at runtime: N surfaces sharing one repo,
one gate definition, one environment. Multi-target usage is a *fleet of
independent runs*, not a scheduling concern. Nothing shares git or gate logic
across targets. The only thing shared across concurrent runs is **host
resources** (tokens, SDK concurrency, docker, disk).

This boundary is load-bearing: it keeps the supervisor's git and gate reasoning
single-target, and pushes all cross-target concerns into host-level resource
governing, where they are simple.

## The supervisor is another state machine

The supervisor reuses the surface's persistence and recovery model one level up.
No new machinery: a **run file** with the same three-part split as the case file.

```
RunFile = {

  # ── header: identity + pinned config, immutable for the run ──
  run_id
  target_ref                  # the one repo / target this run drives
  gate_ref                    # pinned gate identity + version (shared by all surfaces)
  caps                        # worktree-pool size, per-run concurrency, host-governor handle
  run_budgets                 # gate_maintenance: {used, max}   # run-level, shared-fate

  # ── cursor: mutable, the resume marker ──
  breaker                     # environment health: HEALTHY | DEGRADED | REPAIRING
  slots                       # slot -> surface_id assignment (the live pool)

  # ── history: append-only ordered log of typed entries ──
  history: [ RunEntry ]       # surface lifecycle, breaker trips, maintenance runs

  # ── outcome: written once, on a terminal state ──
  outcome?                    # {kind: drained | escalated | aborted, reason, at}
}
```

The same invariants carry up:

- **All run state is serialised; no warm-memory dependency.** A supervisor crash
  mid-run is recoverable from the run file alone.
- **Every transition is a commit point; the log tail is the crash detector.** A
  resume reads the tail and each tail type maps to one action, exactly as the case
  file's log tail does.
- **The `breaker` and `slots` cursor are denormalisations for fast reads.** If they
  ever disagree with the log, the log wins.
- **No queue position is stored.** The next task is recomputed at every fill from the
  task list and the runs on disk (content identity, `findQueueRun`), skipping any task a
  slot has already taken in this run, because a checked-in list is edited between runs.

Surfaces are unchanged. The supervisor owns the queue, the pool, the caps, and the
shared-fate state above the surfaces; each surface still owns its own case file and
its task-local budgets.

## Scheduling

A task queue for the target feeds a **fixed pool of surface slots**. When a slot
frees (its surface reaches a terminal state), the supervisor pulls the next task
and provisions a surface into the slot.

- No dependency graph. The shared repo already forces the only real ordering, at
  close (merges serialise). A DAG scheduler is deferred until a task genuinely
  blocks on another task's merge; the queue is FIFO/priority until then.
- Backpressure is the queue: when every slot is busy, tasks wait. No task is
  dropped.

## Worktree / resource pool

All worktrees descend from the one repo, so the contention is not the parallel
work. `gate.baseline`, `gate.check`, and the agent session are read-write only
*inside* a worktree and never contend. The contention is the **ref-mutating ops**:
`worktree add`, `worktree remove`, and the merge at `CLOSING`.

- A **single repo-level lock** serialises ref-mutating ops. Everything else runs
  fully parallel. The serialised critical sections are brief (provision, release,
  the close/merge), so throughput is dominated by parallel in-worktree work.
- Pool sized to the per-run concurrency cap. Branch-per-task.
- `ponytail: single repo lock around ref-mutating ops; shard per-ref only if merge
  throughput ever measurably bites.`

## Concurrency caps

Two independent layers, deliberately not conflated:

- **Per-run cap** = worktree-pool size. This is about git contention against the
  one repo. The queue holds tasks when the pool is full.
- **Host cap** = a separate resource governor (token budget / SDK concurrency /
  docker / disk) spanning all concurrent runs on the machine. This is about machine
  resources, orthogonal to any single run's git contention.

Keeping them separate matters: raising the per-run cap trades git contention for
throughput within one target; the host cap protects the box regardless of how many
runs are live.

## Budgets: task-local vs shared-fate

The single-surface doc splits budgets by failure population so each gets a cap that
fits its cost. Lifting to many surfaces adds a second axis: **is the failure
population local to the task, or shared across the run's environment?** The
environment (services, containers, harness) is **shared by every surface in the
run**, so an environment breakage is *shared-fate*.

| Budget | Population | Home |
|---|---|---|
| `correction` | task-local (a genuine regression in this task) | per-surface, unchanged |
| `terminus` | task-local (this session ended abnormally) | per-surface, unchanged |
| `close` | task-local (this accepted work failed to close) | per-surface, unchanged |
| `gate_error` | flake, but aggregates into a shared signal | per-surface counter **+** run-level health signal |
| `gate_maintenance` | the shared environment is broken, or one surface's own gate is | **run-level** once shared (pre-task, or two distinct surfaces); per-surface while uncorroborated |

The rule: **task-local budgets stay per-surface; environment-facing budgets lift
to the run.** Per-surface counters on a shared-fate population are actively wrong.
If the box is broken, N surfaces would each independently burn a maintenance
attempt rediscovering the same breakage, and N repair agents would race to mutate
one shared environment and fight each other.

## Shared-environment failure: breaker + stop-the-world repair

Because the environment is shared, a real breakage escalates the **run**, not the
surface.

```
HEALTHY     normal operation; surfaces run in parallel
  → DEGRADED           (a surface's baseline cannot be taken, or a second distinct surface exhausts its gate_error rechecks)

DEGRADED    breakage suspected/confirmed; new gating and closing blocked
  → REPAIRING          (supervisor begins the exclusive repair)

REPAIRING   stop-the-world: no worker may mutate the shared box; one repair agent runs
  → HEALTHY            (repair DONE — blocked surfaces resume; run_budgets.gate_maintenance.used++)
  → run ESCALATED      (repair exhausts run-level gate_maintenance cap — the whole run escalates)
```

Mechanics:

- A surface whose **baseline** cannot be taken (the gate ERRORs before any worker
  has run) does **not** dispatch its own repair agent. Nothing the surface did can
  explain it, so it asks the run, which trips the breaker to `DEGRADED` and
  records the trip, the request and every task it holds in the run file (not the
  case file).
- **Checks and hand-offs are held, nothing else.** While the breaker is not
  `HEALTHY`, a surface about to take its baseline, check its work or hand it off
  waits; an agent session or triage call already under way carries on, since
  neither touches the shared environment. The one repair starts once no surface
  is mid-check or mid-hand-off, runs the existing gate-maintenance role in the
  copy of the surface that tripped it, and every request meanwhile shares it.
  (Settled in the multi-surface supervisor design, replacing the earlier
  full stop-the-world window.)
- `gate_error` keeps its cheap per-surface re-run. A surface that exhausts those
  re-runs reports it to the run, which records one `gate_error_signal` per surface
  since the breaker was last `HEALTHY`. The first such surface is told it is alone
  and repairs its own gate on its own `gate_maintenance` budget, exactly as a
  single surface does: one surface's error is that surface's business. A second,
  *distinct* surface reporting trips the breaker (`gate_error_aggregate`) and the
  run repairs once. The same surface reporting twice counts once, and a successful
  repair clears the count. So `gate_maintenance` is run-level for a shared
  breakage and stays per-surface for an uncorroborated one.

## Open items

- **Host resource governor**: the concrete mechanism for the host-level cap (token
  budget / SDK concurrency / docker / disk) across concurrent runs. A semaphore /
  env cap is the likely starting point; the detail is unwritten.
- **Merge serialisation detail**: the exact critical section and lock granularity
  for the close/merge under the single repo-lock, once real merge throughput is
  observed.
- **Breaker signal tuning**: the `gate_error` aggregate threshold is fixed at two
  distinct surfaces since the breaker was last `HEALTHY`, with no time window
  (`SHARED_ERROR_THRESHOLD` in `src/breaker.ts`). Retune it, and consider a
  window, once real flake rates are known.
