# Architecture: Multi-Surface Supervisor (Roadmap Item 10)

Grounded in `docs/multi-surface-control-flow.md`, `docs/single-surface-control-flow.md`,
`docs/provisioning.md`, the Item 1–9 specs, the real `src/`, and
`docs/prd/2026-09-26-multi-surface-supervisor/research.md`. Every claim about existing
code below is checked against the file it names; research.md citations are marked
`[research §n.n]`.

## 1. Component structure

The supervisor is a **new layer above `surface.ts`, not a rewrite of it**
`[research §1.7]`. `advance()`/`run()` (`src/surface.ts`) stay exactly as they are:
pure, disk-driven, one transition per call, no shared mutable state. That purity is
why N of them can run concurrently in one process at all — this design leans on it
rather than working around it.

```
delivery run  (CLI, src/cli/run-command.ts)
  └─ startQueue()                              — unchanged entry point
       └─ runSupervisor(tasks, project, caps)   — NEW: replaces runQueue's for-loop
            ├─ RunFile (src/run-file.ts)        — NEW: run-level persistence
            ├─ Breaker (src/breaker.ts)         — NEW: HEALTHY/DEGRADED/REPAIRING
            ├─ RepoLock (src/repo-lock.ts)       — NEW: cross-process + in-process lock
            └─ N × surface.run()/advance()       — UNCHANGED, one per live slot
                    └─ SurfacePorts { agent, triage, closer, repoLock?, repairCoordinator? }
                                                  — ports gain two OPTIONAL fields,
                                                    no-op when absent (single-surface
                                                    behaviour is byte-for-byte unchanged)
```

Everything below the `SurfacePorts` line is Items 1–9, untouched in its default
(no-op ports) configuration. Everything above the `advance()`/`run()` calls is new.
This is the whole architectural bet: **the supervisor is an orchestration layer that
injects two new pluggable ports into an unmodified state machine**, not a fork of the
state machine.

### New modules and why each exists

| Module | Owns | Reuses |
|---|---|---|
| `src/journal.ts` | The atomic-write + append + truncated-line-tolerant-read primitive, extracted from `case-file.ts` | — (tidy-first refactor, see §12) |
| `src/run-file.ts` | RunFile persistence: `create`/`load`/`appendEntry`/`rebuild`, mirroring `case-file.ts`'s three-part split | `journal.ts` |
| `src/breaker.ts` | The run-level HEALTHY/DEGRADED/REPAIRING transition table, the gate_error aggregate signal, the `RepairCoordinator` | `run-file.ts` for persistence; the same role/prompt/tool-authority config the single-surface `GATE_MAINTENANCE` node already uses for its repair agent |
| `src/repo-lock.ts` | The two-layer lock (§5): cross-process (guards two supervisor invocations) and in-process (serialises ref-mutating git calls within one run) | `proper-lockfile` (buy, §12) for the outer layer; a hand-rolled promise-chain mutex for the inner layer |
| `src/supervisor.ts` | The scheduler: pool of slots, task selection, the fill/drive/free loop | `cli/queue.ts`'s `findQueueRun`/`isClosed`/`queueTasks` for task identity (§8), `case-file.ts`'s `create`/`load`/`advance` for driving each surface |

### Changed modules (all additive, ported-gated)

- `src/ports.ts` — `SurfacePorts` gains `repoLock?: RepoLockPort` and
  `repairCoordinator?: RepairCoordinatorPort`. Both optional; absent means today's
  behaviour exactly.
- `src/provision.ts`, `src/merge-back-closer.ts`, `src/closer-support.ts` — the
  ref-mutating git calls (`worktree add/remove/prune`, `branch -D`, `merge --ff-only`)
  each get wrapped `await (ports.repoLock ?? passthrough)(() => git(...))`. Mechanical,
  one wrap per call site; nothing about *what* they do changes.
- `src/surface.ts` — the `GATE_MAINTENANCE` handler gets one new guard at its top:
  if `ports.repairCoordinator` is present, delegate to it instead of dispatching its
  own repair agent (§7). The `PRE_GATING`/`GATING`/`CLOSING` handlers each gain one
  `await ports.repairCoordinator?.awaitClearance()` call before doing anything that
  touches the shared repo (the park point, §7). Both are no-ops when the port is
  absent.
- `src/schema.ts` — new `RunFile`/`RunHeader`/`RunCursor`/`RunEntry` Zod schemas,
  shaped like `CaseFile`/`CaseFileHeader`/`HistoryEntry` (§2).
- `src/budgets.ts` — new `DEFAULT_RUN_BUDGETS` (`{ gateMaintenance: { used: 0, max } }`)
  alongside the existing per-surface `DEFAULT_BUDGETS`.
- `src/cli/queue.ts` — `runQueue`'s sequential for-loop is replaced by a call into
  `supervisor.ts` with `poolSize` defaulted to `1` (§8). Existing callers and tests see
  the same sequential behaviour; a project that sets `concurrency > 1` gets N slots.
- `src/cli/config.ts`, `src/cli/status-command.ts`, `src/cli/report.ts` — a new
  `concurrency` config key, and run-level fields (breaker, active slots) rendered
  alongside the existing per-surface status/step output. Exact key names, flags, and
  output shape are the product-designer's to pin down (§13 coordination note);
  nothing here invents a second output renderer (§10).

## 2. The run file: data model and log-tail resume table

The multi-surface doc's own draft (`multi-surface-control-flow.md:27-48`) sketches a
`queue_cursor` field holding "position in the task queue." That contradicts Item 9's
own settled design: `cli/queue.ts` explicitly rejects position-as-identity ("a
checked-in list is inserted into, reordered and trimmed, and a remembered index would
silently skip a new entry or repeat an old one") in favour of content identity via
`findQueueRun`. Carrying a second, index-based identity mechanism into the run file
would let the two disagree. **Resolution: the run file carries no `queue_cursor`.**
"Which task is next" is a pure function computed fresh at every slot-fill, the same
way `findQueueRun`/`isClosed` compute it today (§8) — the run file's job is recording
what already happened (slot assignments, breaker transitions, repair attempts), not
duplicating a position that content identity already answers.

```
RunFile = {
  # ── header: identity + pinned config, immutable for the run ──
  runId
  repoPath                    # the one target repo/checkout this run drives
  gateRef, closerRef          # pinned, shared by every surface (ProjectSettings today)
  poolSize                    # the worktree-pool cap = per-run concurrency cap
  runBudgetMax                # { gateMaintenance: number } — the cap only; used is log-derived

  # ── cursor: mutable, denormalised for fast reads; log wins on disagreement ──
  breaker                     # HEALTHY | DEGRADED | REPAIRING
  slots                       # slot index -> surfaceId, rebuilt from the log on resume
  runBudgets                  # { gateMaintenance: {used, max} }, rebuilt from the log

  # ── history: append-only, one supervisor process is ever the writer (§6) ──
  history: [ RunEntry ]

  # ── outcome: written once, on a terminal state ──
  outcome?                    # {kind: drained | escalated | aborted, reason, at}
}

RunEntry =
  | { t:"slot_fill", slot, surfaceId, taskDef }
        # the supervisor's own commit point for "this slot now drives this surface"
  | { t:"slot_free", slot, surfaceId, outcome: closed|escalated|aborted }
  | { t:"gate_error_signal", surfaceId }
        # monotonic evidence: this surface hit gate_error since the breaker was last
        # HEALTHY. Appended at most once per surface per healthy window (the
        # supervisor checks before appending — deduping is a read, not a lock).
  | { t:"breaker_degraded", cause: {kind:"gate_maintenance", surfaceId}
                                  | {kind:"gate_error_aggregate", surfaceIds} }
  | { t:"repair_dispatch", attempt, sessionKey }
        # the burn: mirrors case-file's own rule that "the dispatch entry IS the
        # budget burn" (case-file.ts:352-357)
  | { t:"repair_terminus", attempt, sessionKey, status: completed|escalate|incomplete }
  | { t:"breaker_healthy" }             # repair succeeded; clears gate_error_signal evidence
  | { t:"run_escalated", reason }
  | { t:"run_drained" }                 # every task answered by a closed run, pool empty
  | { t:"run_aborted", reason }         # e.g. the cross-process lock could not be taken
```

### The log tail is the crash detector, exactly as the case file's is

Same discipline as `case-file.ts`'s `resumeAction` (`case-file.ts:412-442`): the tail
type maps to exactly one resume action, and the cursor (`breaker`, `slots`,
`runBudgets`) is rebuilt from the log rather than trusted, mirroring `case-file.ts`'s
`rebuild()`.

| Tail | Resume action |
|---|---|
| `slot_fill` with no matching later `slot_free` for that `(slot, surfaceId)` | That surface is live. Re-add it to the in-memory pool and call `surface.advance()`/`run()` on it — its **own** case file's log tail decides what it resumes into; the run file only needs to know the slot is occupied. |
| `slot_free` | That slot is free; eligible for the next fill. |
| `gate_error_signal` | Informational. Recompute the distinct-surface count; if it now meets the threshold, proceed as `breaker_degraded` below. |
| `breaker_degraded`, no later `breaker_healthy`/`run_escalated` | DEGRADED. Before any surface's next PRE_GATING/GATING/CLOSING step, ensure a repair is in flight (resume as `repair_dispatch` below, or start one if none exists yet). |
| `repair_dispatch`, no `repair_terminus` | The repair session died mid-flight. Treat exactly like a worker's `INCOMPLETE_TERMINUS`: re-dispatch on the `gateMaintenance` budget (same idempotent-resume pattern as `provision.ts`'s "call it again" recovery, not a new mechanism). |
| `repair_terminus(completed)` | Append `breaker_healthy`; unpark; resume normal scheduling. |
| `repair_terminus(escalate\|incomplete)`, budget now exhausted | Append `run_escalated`; stop filling new slots. Live surfaces are left exactly where they are (§7). |
| `breaker_healthy` / no `breaker_*` since | HEALTHY. Normal fill-and-drive loop. |
| `run_escalated` / `run_aborted` / `run_drained` (outcome set) | Terminal. Report the outcome (same `reportOutcome` pattern `cli/queue.ts` already uses for a closed run); do not resume scheduling. |

## 3. Concurrency model: in-process async, bounded by pool size

**Decision: N surfaces run as concurrent async tasks inside one Node process, bounded
by a slot count, not as N OS processes.**

Why this is the right rung, not the easy one:

- `advance()`/`run()` have no hidden state (`[research §1.7]`): each call loads
  everything it needs from `dir` and returns. Node's event loop already interleaves
  I/O-bound awaits (git `execFile`, the agent SDK's subprocess) for free — this is the
  ordinary Node concurrency model, not a novel one.
- The workload is I/O/latency-bound (git calls, agent sessions), not CPU-bound. Extra
  OS processes would buy parallelism the workload cannot spend, at the cost of a real
  problem it does not have today: coordinating the breaker and the repo lock *across*
  processes needs IPC or file-polling, duplicating what a single process gets from a
  plain in-memory mutex.
- The run file already assumes a single writer — **the supervisor process itself**
  `[research §1.6]`. Spreading surfaces across processes would need every one of them
  to write shared run state, which the run file's design explicitly does not support
  (only the supervisor loop may append a `RunEntry`); keeping everything in one
  process makes that constraint trivially true rather than something to enforce.
- Multiple processes would also double the failure domains (a surface's own process
  crashing vs. the supervisor's) for no corresponding gain, since the case file's
  crash-recovery model already assumes "whichever process runs `advance()` next" —
  that already works unchanged inside one process running N concurrent loops.

The pool itself is a hand-rolled bounded launcher (see the buy-vs-build ledger, §12,
for why not `p-limit`/`p-queue`): a `Set` of in-flight `Promise`s, launch up to
`poolSize`, on any settling free the slot and launch the next eligible task. This is
not a generic concurrency primitive — it needs to write a `slot_fill`/`slot_free`
`RunEntry` and check the breaker before every launch, bookkeeping a generic limiter
does not give for free.

## 4. Git lock design

`git-exec.ts`'s `git()` (`src/git-exec.ts:13-16`) is a thin, stateless wrapper with no
serialisation of its own `[research §1.2]`. `provision.ts` and `merge-back-closer.ts`
each make several sequential, unguarded calls against the shared repo checkout —
`worktree remove`/`prune`, `branch -D`, `worktree add` in `provisionWorktree`
(`provision.ts:44-61`); `merge --ff-only` against the checked-out `HEAD` in
`closeAccepted` (`merge-back-closer.ts:74-113`); `worktree remove`/`prune` again in
`removeWorktree` (`closer-support.ts:26-29`). Two concurrent calls into any of these
race on git's own shared `.git/` metadata `[research §1.3, §2.2]`.

**The lock keys on *where* a git call runs, not on *which* subcommand it is.** Every
git call the harness makes is either against a surface's own worktree (isolated: its
own index, its own `HEAD`, never contended) or against the shared `repoPath` checkout
(`worktree add/remove/prune`, `branch -D`, the merge — all of `provision.ts`'s and
`merge-back-closer.ts`'s ref-mutating calls happen to run with `cwd === repoPath`).
Classifying by subcommand would need an allow-list that a future ref-mutating call
could be added without updating (an incompleteness bug waiting to happen); classifying
by "is this the shared checkout" is correct by construction and needs no list at all.

Two layers, for two different failure modes (`[research §2.1]`):

1. **Outer, cross-process** (`proper-lockfile`, bought — §12): acquired once when the
   supervisor starts or resumes a run against `repoPath`, held for the run's whole
   lifetime, released on any terminal outcome. Guards against a *second* `delivery
   run` invocation against the same repo — the scenario a crash-and-restart makes
   real, since nothing today stops two processes from racing the same repo
   `[research §1.6]`. `proper-lockfile`'s mtime-based staleness detection is what lets
   a resumed supervisor safely reclaim the lock after its own prior process was
   `SIGKILL`ed, rather than requiring a manual unlock step.
2. **Inner, in-process** (hand-rolled promise-chain mutex): serialises the N
   concurrent surfaces' calls into `provisionWorktree`/`removeWorktree`/the merge
   *within* the one process already holding the outer lock. No staleness problem here
   — it lives and dies with the process, and the outer lock already ensures there is
   only ever one such process per run.

As defence in depth (not a new subsystem): a transient `index.lock` collision from
something *outside* the harness's own serialisation (a person running git in the
checkout, a stray process) is a documented, real failure mode for exactly this
worktree-plus-concurrent-agents shape `[research §2.1, §2.2]`. The inner lock's
wrapped calls get one short retry-with-backoff (e.g. 200ms → 400ms, up to 3 attempts)
before surfacing the failure — cheap insurance the research directly names, not a new
mechanism.

### Merge serialisation onto a moving base

This is largely already solved, not newly built. `merge-back-closer.ts`'s existing
`--ff-only` merge *is* the conflict probe: it either advances the base or refuses,
and on refusal distinguishes "the base diverged since this surface started" (`FAIL`,
human-decidable) from "something in the checkout is in the way" (`ERROR`)
(`merge-back-closer.ts:85-113`). Every external precedent for serialising merges onto
a moving base (GitHub Merge Queue, Bors, Mergify) revalidates against the *current*
tip at merge time rather than trusting a stale pre-computed diff — which is exactly
what `--ff-only` plus the ancestry probe already does `[research §2.5]`. **Item 10's
job here is the queueing discipline around that existing, already-correct operation
(the repo lock, §above), not new merge mechanics.**

Concretely, what happens when surface B's accepted work conflicts with A's
already-merged work: the repo lock means A's merge and B's merge can never interleave
— they run one at a time against the shared checkout. If A merged first, B's
`--ff-only` sees a base that has moved on. If B's branch descends from the
pre-A base and A's change and B's don't textually conflict, git may still refuse a
fast-forward (the base is no longer an ancestor of B's tip) — this is the `FAIL` path
that already exists today for a single surface whose base moved on for any reason
(someone else pushed). `close`-triage's narrow router (`retry_close` or `escalate`,
no reroute — `docs/single-surface-control-flow.md:255-263`) is unchanged: a
close failure is infra-class, and the harness deliberately has no automatic rebase or
conflict-resolution capability. Concurrency does not need one either — it needs the
repo lock so "A merged, B's ff-only fails" is the whole story, not a race that could
also corrupt the checkout. Bounded by the existing per-surface `close` budget; at cap,
B escalates to a human with the same packet shape a single surface's close failure
produces today. No new mechanism, no new budget population.

## 5. Breaker: signals, states, exclusive repair

States and transitions as `multi-surface-control-flow.md:126-162` already specifies
(HEALTHY → DEGRADED → REPAIRING → HEALTHY|ESCALATED). What's resolved here is the
concrete trigger conditions the doc left open.

**Direct trip (M=1):** any surface entering `GATE_MAINTENANCE` — pre-task red baseline
or a post-task `fix_the_gate` verdict — is *direct* evidence of shared breakage (the
single-surface machine already treats gate-maintenance as an environment/harness
concern, never an assertion concern). One occurrence is enough; there is no aggregate
threshold on this path.

**Aggregate trip (M=2, no time window):** a *distinct second* surface independently
hitting `gate_error` (its `recheck_gate` retries exhausted, about to route to
`GATE_MAINTENANCE`) while a first surface's `gate_error` episode is still on record
since the breaker was last HEALTHY. Reasoning, taken directly from the doc's own
framing: one surface hitting `gate_error` is exactly what the per-surface `gateError`
budget already exists to absorb cheaply (a flake, re-run it); a *second*, independent
surface doing the same is evidence of shared breakage, not coincidence. `M=2` is the
smallest number that distinguishes those two stories.

Deliberately **no time window**: a wall-clock threshold is nondeterministic and hard
to test reproducibly against the scripted mock. Tying the evidence set to the
breaker's own state ("distinct surfaces since last HEALTHY," cleared on
`breaker_healthy`) keeps the trigger a pure function over the run file's history,
exactly like `deriveStateFromEntry`/`deriveBudgetsFromLog` are pure functions over a
case file's history. A false trip costs one repair attempt (one `gateMaintenance`
budget unit) against a healthy box; that is an acceptable, cheap cost for a
deliberately conservative default.

```ponytail: M=2, no window — retune (a higher M, or a bounded window) only once real
flake rates from production runs show this over- or under-trips; the doc's own style
already tags equivalent simplifications this way (e.g. the stop-the-world window).```

**Exclusive repair.** DEGRADED blocks *new* PRE_GATING/GATING/CLOSING entries (the
`awaitClearance()` port call in §1); it does not interrupt an AGENT_ACTIVE session or
a TRIAGE call already in flight, since neither touches the shared repo. REPAIRING
begins once no surface is mid-gate/mid-close (the in-flight ones finish naturally;
nothing is force-cancelled). Exactly one repair session runs, dispatched by the
supervisor using the **same role, prompt-assembly and tool-authority configuration**
the single-surface `GATE_MAINTENANCE` node already uses (`src/role-config.ts`,
`src/prompt-assembly.ts`) — no new agent role, no new trust boundary (§9). Concurrent
`requestRepair` calls from several parked surfaces are coalesced into the one
in-flight repair's promise (a memoised-promise pattern, not a new primitive): the
first caller starts it, every other caller awaits the same result. On success, every
parked surface resumes exactly where it was parked. On the run-level `gateMaintenance`
budget's exhaustion, the run escalates (§2's `run_escalated`); a permanently broken
shared box dooms every surface, so escalating one at a time would be meaningless, as
the doc already argues.

**"Which surfaces are currently blocked by the repair" is a derived view, not a
persisted field.** The run file needs no `parkedSurfaces` list: when
`breaker != HEALTHY`, a surface is parked exactly when it is one of the run's current
`slots` occupants *and* its own case file's current derived state
(`deriveStateFromEntry`, unchanged from `case-file.ts`) is `PRE_GATING`, `GATING`, or
`CLOSING` — the three checkpoints that call `awaitClearance()` above. A surface whose
own state is `AGENT_ACTIVE`/`TRIAGE`/`INCOMPLETE_TERMINUS` keeps running regardless of
the breaker, so it is never in this set. `delivery status` computes the list by
cross-referencing the run file's `slots` against each occupant's own case file, with
no new run-file field — one more instance of the "log/case-file is truth, don't
duplicate what's derivable" rule this design applies everywhere else (§2, §6).

## 6. Run-level vs. per-surface budgets

Unchanged from `multi-surface-control-flow.md:104-124`, restated with the concrete
ownership each population now has:

| Budget | Home | Change from today |
|---|---|---|
| `correction`, `terminus`, `close` | Per-surface, in the case file | None — `case-file.ts`'s existing counting is untouched. |
| `gateError` | Per-surface counter, **plus** feeds the run-level aggregate signal (§5) | The counter itself doesn't move; a new, separate signal reads it across surfaces without touching the counter's semantics. |
| `gateMaintenance` | **Run-level only**, in the run file | A supervised surface never dispatches its own repair agent — its `GATE_MAINTENANCE` handler delegates entirely to `ports.repairCoordinator` (§1, §5). An unsupervised single surface (`ports.repairCoordinator` absent) keeps today's behaviour and its own per-surface `gateMaintenance` counter untouched — this is deliberate: a standalone `delivery run` on one task still needs a working gate-maintenance path, and the schema doesn't need a "is this supervised" flag to make that true, only the port's presence. |

## 7. Interaction with existing closers and the sequential queue's content identity

**Closers:** every built-in closer (`merge-back`, `open-pr`, `commit-to-branch`) keeps
its exact `CloserPort` contract — `close(ctx, outcome) -> CloseReport`. The only change
is that the ref-mutating calls inside `merge-back-closer.ts`/`closer-support.ts` are
now lock-wrapped (§4). A closer that doesn't touch the shared repo at all
(`open-pr-closer`, if it merges via a hosted API rather than the local checkout) needs
no change beyond the wrap being a no-op for its calls.

**Content identity (§2's resolution, restated as the interaction point):** the
sequential queue's rule — a run answers for a task by content equality of
`taskDef`, never by position (`cli/queue.ts:24-38`) — is the *only* task-identity
mechanism in the system, before and after Item 10. The supervisor does not add a
second one. Task selection at every slot-fill:

1. Re-read `allRuns(repoPath)` fresh (fixing the snapshot-once gap `[research §1.1]`:
   `runQueue` takes one snapshot per invocation; a supervisor with N live slots must
   see runs its *own* other slots just created, not only runs that existed at the
   loop's start).
2. Walk `tasks` in list order (unchanged FIFO — no DAG scheduler, per the doc); for
   each, find its answering run via `findQueueRun`. Skip it if that run is closed
   (`isClosed`, unchanged) **or** if that run's `surfaceId` already occupies a live
   slot in this run's own `slots` cursor (the one new check Item 10 needs: two slots
   must never claim the same task).
3. The first task that clears both checks is the next fill.

This is exactly `nextQueueTask`'s rule, generalised from "the first unclosed task" to
"the first unclosed, unclaimed task," because N slots need N different answers to
"what's next" rather than one.

## 8. Security: no new trust boundaries beyond those named here

- The repair agent is not a new capability: it is the existing `gate-maintenance`
  role, with its existing pinned prompt and tool authority (`role-config.ts`,
  `tool-authority.ts`), just dispatched by the run instead of by a surface. Nothing
  about what it may touch changes.
- The one genuinely new on-disk artifact is the cross-process lock file
  (`proper-lockfile`'s lock, likely under `.delivery/<runId>/run.lock` or equivalent —
  the product-designer's call for the exact path). It is advisory, process-local
  coordination state, not a credential and not attacker-facing; its only failure mode
  is "a stale lock delays a legitimate resume until the staleness check clears it,"
  not a security exposure.
- No new credential, no new network egress, no new stored secret. The host resource
  governor (§9) is deferred specifically *because* it would touch shared credentials
  across runs — deferring it means Item 10 introduces no new credential-sharing
  surface at all.

## 9. Host resource governor: explicit deferral

Deferred, not silently dropped. Roadmap Item 10's own success criteria
(`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:443-461`) list the
pool, the repo lock, the breaker, the run-level budget, and crash resume — never a
cross-*run* host governor. The multi-surface control-flow doc's own scoping is
explicit: multi-target/multi-run usage is "a fleet of independent runs," and "the
only thing shared across concurrent runs is host resources" — a deliberately
different, harder problem than anything inside one run.

Why it's genuinely a different shape, not just unstarted: the Claude API's real
constraint is a **token-bucket rate** (RPM/ITPM/OTPM, org-wide, replenished
continuously), not a concurrent-session count `[research §2.4]`. The worktree pool's
cap (§3) is a concurrency-count control; a correct host governor needs a
rate-aware control with its own `retry-after`-driven backoff, and must distinguish a
rate 429 (retryable) from a spend-cap 429 (`enforced_spend_limit_reached`, not
retryable until next month) — neither of which this item's scope touches, since it
governs one run against one target with its own pool cap already bounding how many
sessions are ever concurrently open.

**Deferred until:** multiple independent runs are observed contending for one host's
credentials in practice. Until then, `poolSize` is the only concurrency control that
exists, and it happens to also bound burst request rate as a side effect (not by
design) — good enough for a single run, not a substitute for the real governor when
that need arrives. Extensibility (§11) is what makes adding it later cheap rather than
disruptive.

## 10. NFRs

- **Determinism.** Task selection is a pure function of on-disk state (allRuns() +
  slots), unchanged in kind from today's `nextQueueTask`. The breaker's aggregate
  trigger is a pure function over the run file's own history, not wall-clock time.
  Everything the scripted mock exercises stays reproducible run to run.
- **Crash safety.** The run file inherits the case file's three-part model exactly:
  every transition is a commit point, the log tail is unconditionally authoritative
  over the denormalised cursor, and resume is "read the tail, take the one legal
  action" with no separate recovery subsystem (§2). A supervisor crash at any point —
  mid-fill, mid-repair, mid-merge inside a lock-held section — resumes cleanly because
  the underlying git operations (`provisionWorktree`, the merge) were already designed
  idempotent for exactly this (`docs/provisioning.md`'s "call it again" recovery,
  `merge-back-closer.ts`'s "already merged"/"already closed" replay handling).
- **Bounded resources.** `poolSize` hard-caps concurrent worktrees and open agent
  sessions. The run-level `gateMaintenance` budget hard-caps total repair spend for
  the whole run regardless of how many surfaces trip it. Neither bound can be
  exceeded by a bug in one surface, because both live above the per-surface state
  machine, not inside it.

## 11. Telemetry

No new observability subsystem — Item 11 owns that. The run file *is* the audit
trail: every slot fill/free, breaker transition, and repair attempt is a `RunEntry`,
exactly as the case file already is the single-surface audit trail. Terminal/JSON
output reuses the existing `RunReporter` (`cli/report.ts`) and phrase tables
(`cli/output.ts`'s `STEP_PHRASES`/`RESUME_PHRASES` pattern) — extended with run-level
phrases (breaker trip, repair start/end, slot assignment) in the same total,
closed-set style, not a second renderer. `delivery status` (existing command) reads
the run file when one exists for the repo and shows breaker state plus each active
slot's surface state alongside what it already shows per-surface. Exact wording and
JSON field names are the product-designer's to pin (§13).

## 12. Testing

The existing mock stack — `vendor/claude-mock`, `mock-session.ts`, `mock-script.ts`,
`scripted-surface-run.ts` — is reused, not replaced. A sibling
`scripted-supervisor-run.ts` runs N `MockScript`s concurrently against one shared temp
repo through the supervisor, exactly as `scripted-surface-run.ts` runs one script
through `surface.run()` today: same script vocabulary (`when`, `effects`, `reply`,
`json`, `fail`, `delayMs`), same journal format, same "run the real driver,
provisioning, gate and closer resolution unchanged" principle.

Deterministic interleavings — the property this item specifically needs that a single
surface's tests never did — are driven by `MockScript`'s existing `delayMs`: staggering
which surface's session answers first is enough to force a specific fill order, a
specific breaker-trip order, or two surfaces racing the repo lock's merge step in a
known sequence. This needs no new synchronisation primitive for the cases described
above. If the plan phase finds a lock-contention race that `delayMs` alone can't pin
down precisely enough (e.g. asserting the *exact* interleaving of two `git` calls
inside the lock), that is a small, scoped addition to the mock's existing script
format — flagged here as a possible follow-up, not assumed necessary before it's
proven needed.

**A behaviour-preservation check is required, not assumed:** collapsing `runQueue`
into `runSupervisor(poolSize=1)` (§8) must be verified against Item 9's existing test
suite (`queue.test.ts`, `run-command.test.ts`) before it ships — the architecture
calls for the collapse because two schedulers for one concept is the wrong shape to
carry forward, but "the same tests still pass with the same behaviour" is the plan
phase's job to prove, not this document's to assert.

## 13. Extensibility

The repo lock and the repair coordinator are ports (`SurfacePorts`, §1) with no-op
defaults — the same extension mechanism `AgentPort`/`TriagePort`/`CloserPort` already
establish throughout this codebase (`ports.ts`). A future host resource governor (§9),
a priority or DAG-aware queue (explicitly deferred by the control-flow doc until a
task genuinely blocks on another's merge), or a finer-grained breaker window (than the
coarse stop-the-world one, per its own `ponytail:` note) each slot in as a new port
implementation or a new field on the run file's cursor — never by rewriting
`surface.ts`'s transition table. This mirrors the roadmap's own boundary: later items
build *on* Item 10, not *through* it.

## 14. Coordination note for the product-designer

Needs agreement before this is final: the `concurrency` config key's name and default
(proposed: `concurrency`, default `1`, matching `poolSize`); the exact CLI surface for
setting it (a flag on `delivery run`, a config key, or both); `delivery status`'s
rendering of breaker state and per-slot surfaces; any new exit code for "a run is
already in progress against this repo" (the cross-process lock's refusal, §4); and the
step/note vocabulary for run-level events (breaker trip, repair start/end, slot
assignment) so it reads consistently with the existing per-surface phrase tables.

---

## Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| In-process bounded concurrency (N surface slots) | **Build** — hand-rolled launcher (~15 lines) | `p-limit`/`p-queue` (npm) | Every launch needs bespoke bookkeeping (write a `slot_fill` entry, check the breaker, re-read `allRuns()`) that a generic limiter doesn't give for free `[research §2.1]`; wrapping one would only relocate the same code behind a dependency. |
| In-process ref-mutating-op mutex | **Build** — hand-rolled promise-chain mutex (~10 lines) | `async-mutex` (npm) | No staleness or cross-process concern at this layer — it lives and dies inside the one process the outer lock already serialises. A promise chain *is* the entire implementation of a non-reentrant async mutex; `async-mutex`'s extra surface (`Semaphore`, timeouts) buys nothing here. |
| Cross-process repo-level lock (guards two supervisor invocations against one target) | **Buy** — `proper-lockfile` | Hand-rolled `mkdir`-based lock | Correct stale-lock detection across an abrupt crash (`SIGKILL`, OOM) is a known-hard corner (mtime-based staleness, safe re-acquire) `[research §2.1]`; getting it wrong risks a silent double-writer to the run file — a correctness bug, not a style one. `proper-lockfile` already solves exactly this, cross-process and cross-filesystem. |
| Persisted, crash-recoverable breaker state machine | **Build** — a `RunFile` cursor field + transition table, the same shape `case-file.ts`'s `cursor.state` already uses | Opossum / Cockatiel (circuit-breaker libraries) | Both are in-process, ephemeral, single-outbound-call breakers with no documented persistence or cross-process state `[research §2.3]`; this breaker must survive a supervisor crash as a field in an already-existing persisted structure. Reusing the pattern already in this codebase is strictly simpler than adapting a library built for a materially different shape. |
| Ref-mutating git operations (worktree add/remove, the merge) | **Reuse-estate** — `provision.ts`, `merge-back-closer.ts`, `closer-support.ts` unchanged except for lock-wrapping | New merge-queue mechanics (batching, revalidation) | The existing `--ff-only` + ancestry-probe merge already revalidates against the moving base at merge time, matching every external merge-queue precedent (GitHub Merge Queue, Bors, Mergify) `[research §2.5]`. The gap is queueing discipline, not merge logic. |
| Task queue / content identity | **Reuse-estate** — `cli/queue.ts`'s `findQueueRun`/`isClosed`/`queueTasks` | A second, index-based identity for N slots (the multi-surface doc's own `queue_cursor` draft) | Item 9 already solved "which run answers for which task" by content identity `[research §1.1]`; a second mechanism could silently disagree with it. Resolved by generalising the existing rule (§7), not adding a parallel one. |
| Run-level repair agent dispatch | **Reuse-estate** — the existing `gate-maintenance` role, prompt-assembly and tool-authority config | A new "repair" role/prompt for the run level | No new trust boundary: the repair agent already exists and is already pinned by the harness (§9). Item 10 only relocates *who* dispatches it and *which* budget it burns, not what it is. |
| Host resource governor (token/rate budget across concurrent runs) | **Deferred**, explicitly (§9) | Build a rate-aware semaphore now | The API's real constraint is a token-bucket rate, not a concurrency count — a different control variable from the pool's cap, needing its own `retry-after`-aware backoff and 429-class handling `[research §2.4]`. Not in Item 10's success criteria; deferred until real multi-run contention on one host is observed. |
| Deterministic breaker tuning (`gate_error` aggregate threshold) | **Build** — `M=2`, no time window (§5) | A time-windowed threshold | A wall-clock window is nondeterministic and hard to test reproducibly; tying the count to the breaker's own state keeps it a pure, testable function over the run's history, matching the doc's own established style for exactly this kind of deferred tuning. |
| Extracting the atomic-write/append/truncated-line-tolerant-read primitive shared by `case-file.ts` and `run-file.ts` | **Build** (tidy-first refactor) — one shared `journal.ts` | Duplicate `case-file.ts`'s persistence helpers into `run-file.ts` | Both files need the identical crash-safety discipline (write-tmp-then-rename, `fsync`, tolerate a truncated final log line). Duplicating it risks the two drifting; extracting it is mechanical and behaviour-preserving for `case-file.ts`'s existing callers. |

## Operability / DX

**Environment.** The supervisor is not a new service, daemon, or deploy target — it
is a capability of the existing `delivery` CLI process (Node 22), with the same
lifetime model a single-surface run already has: it starts when `delivery run` is
invoked and ends when the run reaches a terminal outcome (drained/escalated/aborted).
No new infrastructure is stood up to run it; wherever `delivery` already runs today
(a developer's machine, CI, an autoloop worker) is where it runs tomorrow.

**Harness.** `vendor/claude-mock` plus `mock-session.ts`/`mock-script.ts` remain the
one harness for both single- and multi-surface work. A developer testing multi-surface
behaviour writes the same `MockScript` JSON they'd write for a single surface (§12);
there is no second, supervisor-specific mocking vocabulary to learn.

**Scaffolding.** The one new piece of project configuration (`concurrency`, name
pending §13) is validated the same way every other `delivery.config` key is: a Zod
schema in `cli/config.ts`, caught by `delivery validate` before any agent spend, with
no new scaffolding command. `delivery init` needs no change — a project that never
sets `concurrency` gets today's sequential behaviour by default.

**Local-run story.** A developer runs `delivery run` exactly as before. The only
visible difference when `concurrency > 1` is set is that step output shows several
surfaces' progress at once instead of one, and `delivery status` shows the run-level
breaker state alongside per-surface state. After a hard kill, the story stays "run it
again": the cross-process lock's staleness detection reclaims a dead process's lock
automatically, so resuming never needs a manual unlock step.

**Deploy target.** Unchanged — an npm package installed wherever a git checkout and
Node 22 exist. Item 10 adds two npm dependencies (`proper-lockfile`, justified above;
no in-process locking dependency, also justified above) and no new binaries, ports, or
external services.
