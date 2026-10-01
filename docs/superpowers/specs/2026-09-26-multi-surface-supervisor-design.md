---
type: phase-design
created: 2026-09-26
roadmap_item: 10
---

# Multi-Surface Supervisor — Design

> **Status:** ✅ Complete — 2026-10-01 — all 7 slices delivered
> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 10.
> Resolves: the open items of `docs/multi-surface-control-flow.md` (host resource governor, merge serialisation detail, breaker signal tuning).
> Extends: `2026-09-17-project-configuration-design.md` (Item 9: the sequential task queue, content identity via `findQueueRun`), `2026-09-14-cli-and-configuration-design.md` (Item 8: the `delivery` CLI, exit codes, `--json`, `delivery status`).
> Builds on: `2026-09-07-single-surface-state-machine-design.md` (`advance()`/`run()`), `2026-09-04-case-file-persistence-design.md` (three-part persistence, log-tail resume), `2026-09-11-close-interface-design.md` (merge-back closer's `--ff-only` probe), `2026-09-13-agent-mock-design.md` (scripted mock, `src/testing.ts`), `docs/provisioning.md`.
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed; Dana, Priya and Marcus each gain a goal extension in place from this run).
> Audit trail: `docs/prd/2026-09-26-multi-surface-supervisor/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).
> Produced by an autonomous design-team run (`20260926T192253Z`); no human reviewed it. No idea file from the operator's pool seeded this work: it is the next unstarted roadmap item.

## Problem

Item 9 gave a project owner a list of tasks in `delivery.config.json`, and
`delivery run` works through it **one task at a time** (`src/cli/queue.ts`: a
sequential `for` loop over `queueTasks(config)`, identifying each task's run by
content via `findQueueRun`, from one `allRuns()` snapshot per invocation;
research §1.1). A ten-task list takes ten tasks' wall-clock time, although almost
all of that time is an agent session waiting on I/O in its own isolated worktree.

Nothing in the harness is ready to run two tasks at once today (research §1.2–§1.6):

- **Ref-mutating git operations are unguarded.** `provisionWorktree`
  (`src/provision.ts:44-61`: `worktree remove`/`prune`, `branch -D`, `worktree add`),
  `closeAccepted` (`src/merge-back-closer.ts:74-113`: `merge --ff-only` against the
  checked-out base) and `removeWorktree` (`src/closer-support.ts:26-29`) all run
  against the shared checkout with no lock. Two concurrent calls race on git's
  shared `.git/` metadata. There is no locking dependency anywhere in `src/` or
  `package.json`.
- **Budgets are per-case-file only.** `gate_maintenance` is counted per surface
  (`src/budgets.ts`), so N surfaces meeting one broken environment would each
  dispatch their own repair agent against the same box, fighting each other.
- **No run-level record.** Crash recovery is per case file; nothing records which
  tasks a concurrent run had in flight, or that the environment was being repaired.
- **Nothing stops two invocations racing one repository.**

The roadmap names this item as the step that turns the queue into throughput,
and Items 11 (observability spans the full run) and 12 (task packs fan findings
out across surfaces) build on it. Item 9's own non-goals list "multi-surface
concurrency for the queue (Item 10)" first.

## Personas

`docs/personas.md` is the source of truth. No new persona; this phase extends
three existing goals in place (flagged there as assumed):

- **Dana Okafor, non-technical project owner.** Understand, from the terminal or
  `delivery status` and in her own words, what is happening to several tasks
  running together, and, if the shared environment breaks, that the run paused
  the affected steps to fix it. Drives journeys 1–4.
- **Priya Shah, harness extender.** Prove her gate, closer and role configuration
  behave correctly under several concurrent surfaces with the existing scripted
  mock, without a real concurrent run. Drives journey 5.
- **Marcus Webb, on-call engineer.** When the *run* escalates (repair exhausted)
  rather than one task, the packet and status say so plainly, so he does not
  diagnose a task that was never the cause. Drives journey 3's post-mortem.

## Scope

### Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The team-lead derived it from roadmap Item 10's
success criteria; the critic approved it as neither starved nor gold-plated
(review-log, "phase selection verdict"). The **MUST tier below is that derived
floor**, and is an assumption a human may revise.

### MUST

1. **A `concurrency` setting**: config key `concurrency`, flag `--concurrency <n>`,
   environment variable `DELIVERY_CONCURRENCY`, same precedence as every other
   setting (flag > env > file > default). A whole number ≥ 1, **default 1**.
   `delivery validate` rejects anything else in the existing one-fix style.
   At 1, observable behaviour is today's, byte for byte (see Assembly resolution 1).
2. **A run file** for any run with `concurrency > 1`, reusing the case file's
   three-part split (immutable header, denormalised cursor, append-only history,
   written-once outcome) with its own log-tail resume table.
3. **A fixed pool of `concurrency` slots.** A freed slot selects the next task by
   the existing content-identity rule, generalised to "first unclosed *and
   unclaimed* task", and provisions it.
4. **A repo lock**: cross-process (one supervised run per repository) plus
   in-process (serialising every git call that runs against the shared checkout:
   `worktree add/remove/prune`, `branch -D`, the merge-back merge). Everything else
   (agent sessions, gate runs, in-worktree edits) runs fully parallel.
5. **The breaker** (`HEALTHY | DEGRADED | REPAIRING`) and a **run-level
   `gate_maintenance` budget**: a supervised surface never dispatches its own
   repair; the supervisor runs one exclusive repair; success releases every held
   surface; exhaustion escalates the run.
6. **Supervisor crash resume from the run file alone.** Re-running `delivery run`
   in the same repository resumes: no surface double-provisioned, no merge run twice.
7. **Legible interleaved terminal output**: every line tagged with its task's
   ordinal, plain language, `NO_COLOR`-safe, append-only; one JSON object per line
   under `--json` with a `scope` field distinguishing surface steps from run events.
8. **`delivery status` extended** for a supervised run: run-level summary
   (environment state, counts, budget headroom) then one line per task, in plain
   language and `--json`. A single-surface id reports exactly as today.
9. **Exit codes unchanged** in number and meaning. A second supervised run against
   a repository that already has a live one is refused on exit code 2.
10. **Testing API extended** so an extender can drive several scripted surfaces
    through the real supervisor with a chosen interleaving and assert on the
    resulting git state (the roadmap DX note: "how to mock N surfaces with
    scripted interleavings"), with a section in `docs/testing-your-pipeline.md`.

### SHOULD

- `delivery init`, on detecting more than one task, offers a conservative
  concurrency value as an explicit choice rather than changing the default.
- `delivery status` leads with the breaker narration when the environment is not
  healthy, before the per-task list.
- A task waiting only because the pool is full is shown as "queued, waiting for a
  free slot" in `delivery status` (silent in the live stream).
- Wording distinguishes an API rate-limit or spend-cap symptom (research §2.4) from
  a broken shared environment, so an owner is not told their project is broken
  when the cause is a 429.

### COULD

- A host-level governor across several concurrent runs on one machine (see
  Architecture §9 for why it is a different control).
- Priority ordering beyond list order.
- A finer-grained pause than the current gate/close hold, if repair frequency is
  ever shown to hurt throughput.

## UX / Product

### Vision

Still one repository, one gate, one `delivery.config.json`, one verb and the same
six exit codes. The one new idea an owner must be able to understand is the one
new failure mode concurrency introduces: the project's shared environment can
break in a way no single task caused, and the harness then holds the steps that
touch it and repairs it once, rather than letting every task rediscover and fight
over the same broken box.

### Vocabulary

"Run" keeps meaning one invocation of `delivery run`. "Surface" stays an internal
word; the user-facing unit inside a supervised run is "task", addressed by its
ordinal (`[3/10]`) and by the per-task run id it already has today. A supervised
run gets its own id (`run-<UTC second>`, for example `run-20260926T090000Z`),
distinct from every per-task id, so `delivery status <id>` can tell which kind of
thing it was given from what is on disk, without new addressing syntax.

### Configuration

| Setting | What it says | Default |
|---|---|---|
| `concurrency` | How many tasks may run at once against this project. | `1` |

| Flag | Environment variable | Sets |
|---|---|---|
| `--concurrency <n>` | `DELIVERY_CONCURRENCY` | `concurrency`, for one run |

**Why default 1.** Raising it means more simultaneous API spend, a worktree per
slot on disk, and a code path (run file, lock, breaker) a project has never
exercised. A non-technical owner should never be surprised by a cost or failure
mode she did not ask for, and every existing project must behave identically on
upgrade. Picking a friendlier-looking default such as 3 would silently change the
cost profile of every user who already has a list.

`delivery validate` reports it in the existing tick-list style:
`✓ concurrency: up to 3 tasks at once (10 queued)`.

### Terminal output

Append-only, one event per line, the tag a bracketed ordinal (never colour
alone), so a screen reader and `grep '\[1/10\]'` both follow one task
deterministically. The task text appears at a task's start and at its done or
needs-you line, where today's output already puts it. At `concurrency: 1` no tag
is printed.

```text
Starting run run-20260926T090000Z: 10 tasks, up to 3 at once
[1/10] Starting: add a page that shows who's on call today
[2/10] Starting: let someone swap their on-call day with a teammate
[1/10] setting up
[2/10] setting up
[1/10] the agent is working
[3/10] Starting: send a reminder the morning before someone's on-call day starts
[1/10] checking the agent's work
[1/10] Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/add-a-page-20260926T090000Z.
```

Breaker narration follows `cli/output.ts`'s closed-set `STEP_PHRASES` pattern, so
a new state does not compile without a phrase:

```ts
export const BREAKER_PHRASES: Record<BreakerState, string> = {
  HEALTHY: "running normally",
  DEGRADED: "something in the shared environment looks broken",
  REPAIRING: "fixing the shared environment",
};
```

Repair's two exits carry variable data, so they are constructed sentences
wrapping those phrases, as `CLOSED`'s "Done: …" already is.

Under `--json`, stdout stays only JSON, one object per line; every key present,
`null` where it does not apply:

```json
{"scope":"surface","surface":{"ordinal":1,"of":10,"id":"add-a-page-20260926T090000Z"},"state":"PROVISIONING","done":false,"at":"2026-09-26T09:00:00.000Z"}
{"scope":"run","state":"DEGRADED","affected":["add-a-page-20260926T090000Z"],"at":"2026-09-26T09:03:11.000Z"}
{"scope":"run","state":"HEALTHY","affected":null,"at":"2026-09-26T09:04:02.000Z"}
```

### `delivery status`

For a supervised run id: the run line, the environment, the counts, then one line
per task; any task needing a decision is followed by the existing escalation
packet rendering, unchanged.

```text
Run run-20260926T090000Z, started 2026-09-26 09:00 UTC: 10 tasks, up to 3 at once
Environment: healthy
6 done, 1 needs your decision, 1 paused (waiting on a repair), 2 queued

  [1/10] add a page that shows who's on call today: done, committed on branch surface/add-a-page-20260926T090000Z
  [3/10] send a reminder the morning before someone's on-call day starts: needs your decision (see below)
  …

To read one task in full: delivery status send-a-reminder-20260926T090005Z
```

`--json` gives one document: run-level fields (`runId`, `concurrency`, `breaker`,
`runBudgets`, `outcome`) and a `surfaces` array whose entries are exactly today's
single-run `--json` document, nested rather than re-schemed. With no id, `status`
reports the most recently touched run of either kind. `delivery status --all`
stays an index: a supervised run is one summarising line ("10 tasks: 8 done, 1
needs your decision, 1 queued").

### Exit codes

The existing table, unchanged. For a supervised run: 0 only if every task closed;
4 if any task, or the run itself, escalated; 5 if it stopped before finishing
(resumable); 2 for a refused start; 1 and 3 as today.

### Key flows

1. **Dana runs ten tasks, three at once** (Dana). She adds `"concurrency": 3`,
   `validate` confirms it, `delivery run` prints the interleaved stream above and
   ends "Every task on your list is done" or names which tasks need her.
2. **Crash and resume** (Dana). The machine restarts mid-run. She runs `delivery
   run` again in the same folder, as she already does for a sequential list. The
   supervisor reclaims the lock, reads its run file's tail, picks up every live
   task from its own case file's tail, and says what it is picking up.
3. **A breaker trip** (Dana, Marcus). Two tasks hit the same broken database
   container:

   ```text
   ! Something in the shared environment looks broken (2 of 3 running tasks hit
     the same problem). Holding any task about to check or hand off its work while
     it is repaired; work already under way carries on.
     - repairing (attempt 1 of 2)
   ✓ Fixed. Resuming.
   ```

   If repair fails its budget, the run stops: "Couldn't fix it after 2 attempts.
   Stopping the run. 2 of 10 tasks were waiting on this and need your attention;
   5 had already finished, 3 are still queued." `status` leads with the cause, and
   the run's outcome states it is a run-wide environment failure, not a defect in
   any held task.
4. **One task escalates, the rest carry on** (Dana, Marcus). A task exhausts its
   own correction budget on a real regression. It alone reaches `ESCALATED`; its
   slot frees and the next task starts; nothing else is slowed.
5. **Priya tests N surfaces** (Priya). With the same `delivery-service/testing`
   imports, she scripts two surfaces that reach closing together and asserts one
   clean merge and one `FAIL` from the moving base, with no real agent.

### Empty and error states

- **Empty list** with `concurrency > 1`: as today.
- **Pool full**: silent in the stream; visible in `status` (SHOULD).
- **One task's worktree cannot be created**: `ABORTED` for that task, as today; no
  run-wide effect (see Open questions).
- **Run-level escalation**: flow 3.
- **A second run against a repository with a live supervised run**: refused before
  anything starts, exit 2, in the shape of today's `unfinishedRunFound`: "Another
  run is already going here (started `<when>`, 10 tasks, up to 3 at once:
  `run-…`). Run `delivery status run-…` to see it, or wait for it to finish."

### Accessibility

Internal state names (`GATE_MAINTENANCE`, `DEGRADED`) never reach the
human-readable path; the phrase tables translate. Colour is decoration only.
No redrawing progress bars or panes (Item 11's territory).

### Success metrics

1. A ten-task list at `concurrency: 3` finishes in materially less wall-clock time
   than at 1, with no orphaned worktree after a clean run (the provisioning orphan
   sweep finds nothing).
2. A supervisor killed mid-run and restarted reaches the same outcome as an
   uninterrupted run, with no duplicate merge or double-provisioned worktree,
   proven by a scripted crash-and-resume test.
3. From `delivery status` alone, Dana can say which tasks are done, which need
   her, and whether anything is held for an environment reason, without meeting
   an internal state name.
4. A breaker trip's cause, affected tasks and repair outcome are readable from
   `delivery status <run-id> --json` after the fact, with no source reading.
5. Priya can script several surfaces with a chosen interleaving and assert on git
   state using only the public testing API.
6. One task escalating never stops or slows an unrelated running task.

## Architecture

### 1. Component structure

The supervisor is a new orchestration layer **above an unmodified state
machine**. `advance()`/`run()` in `src/surface.ts` are pure and disk-driven, with no
hidden shared state (research §1.7), which is what lets N of them run in one
process.

```text
delivery run  (src/cli/run-command.ts → startQueue, unchanged entry)
  └─ runSupervisor(tasks, project, { concurrency })   NEW: src/supervisor.ts
       ├─ RunFile   src/run-file.ts    NEW  run-level persistence (concurrency > 1)
       ├─ Breaker   src/breaker.ts     NEW  states, aggregate signal, RepairCoordinator
       ├─ RepoLock  src/repo-lock.ts   NEW  outer cross-process + inner in-process
       └─ N × surface.run()/advance()  UNCHANGED
              └─ SurfacePorts { agent, triage, closer, repoLock?, repairCoordinator? }
```

| Module | Owns | Reuses |
|---|---|---|
| `src/journal.ts` | Atomic write, append, truncated-final-line-tolerant read, extracted from `case-file.ts` | (behaviour-preserving extraction) |
| `src/run-file.ts` | `create`/`load`/`appendEntry`/`rebuild` for the run file | `journal.ts` |
| `src/breaker.ts` | Breaker transition table, gate_error aggregate signal, `RepairCoordinator` | `run-file.ts`; existing gate-maintenance role config |
| `src/repo-lock.ts` | The two-layer lock (§4) | `proper-lockfile` (outer); a promise-chain mutex (inner) |
| `src/supervisor.ts` | Slot pool, task selection, fill/drive/free loop | `cli/queue.ts`'s `findQueueRun`/`isClosed`/`queueTasks`; `case-file.ts` |
| `src/scripted-supervisor-run.ts` | Runs N `MockScript`s through the real supervisor | `scripted-surface-run.ts`, `mock-session.ts` |

Changed, all additive:

- `src/ports.ts`: `SurfacePorts` gains optional `repoLock` and
  `repairCoordinator`. Absent means today's behaviour exactly.
- `src/provision.ts`, `src/merge-back-closer.ts`, `src/closer-support.ts`: each
  shared-checkout git call is wrapped by `ports.repoLock` (passthrough when absent).
- `src/surface.ts`: the `GATE_MAINTENANCE` handler delegates to
  `ports.repairCoordinator` when present; `PRE_GATING`, `GATING` and `CLOSING`
  call `await ports.repairCoordinator?.awaitClearance()` before touching the
  shared repository. No-ops when absent.
- `src/schema.ts`: `RunFile`/`RunHeader`/`RunCursor`/`RunEntry` Zod schemas.
- `src/budgets.ts`: `DEFAULT_RUN_BUDGETS` beside `DEFAULT_BUDGETS`.
- `src/cli/queue.ts`: `runQueue`'s loop becomes a call into the supervisor.
- `src/cli/config.ts`, `settings.ts`, `status-command.ts`, `report.ts`,
  `output.ts`, `validate-command.ts`: the `concurrency` key, `BREAKER_PHRASES`,
  run-scope events, supervised status rendering. No second renderer.

### 2. Run file and log-tail resume

The control-flow plan's draft `queue_cursor` (a list position) contradicts Item 9's
settled rule that a checked-in list is edited, so position is not identity.
**The run file carries no queue cursor**; "next task" is recomputed at every fill
(§7).

```text
RunFile = {
  header:  { runId, repoPath, gateRef, closerRef, concurrency, runBudgetMax: { gateMaintenance } }
  cursor:  { breaker, slots: slot -> surfaceId, runBudgets }   # rebuilt from history; history wins
  history: [ RunEntry ]                                        # one writer: the supervisor
  outcome?: { kind: drained | escalated | aborted, reason, at }
}

RunEntry =
  | { t: "slot_fill", slot, surfaceId, taskDef }
  | { t: "slot_free", slot, surfaceId, outcome: closed | escalated | aborted }
  | { t: "gate_error_signal", surfaceId }          # at most once per surface per healthy window
  | { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId }
                                  | { kind: "gate_error_aggregate", surfaceIds } }
  | { t: "repair_dispatch", attempt, sessionKey }  # the dispatch entry is the budget burn
  | { t: "repair_terminus", attempt, sessionKey, status: completed | escalate | incomplete }
  | { t: "breaker_healthy" }                       # clears gate_error_signal evidence
  | { t: "run_escalated", reason } | { t: "run_drained" } | { t: "run_aborted", reason }
```

Supervised run files live under `.delivery/supervised/<runId>/`, beside, not
inside, `.delivery/runs/`, so `allRuns()` keeps seeing only case files. Each task's
case file stays exactly where it is today.

| Tail | Resume action |
|---|---|
| `slot_fill` with no later matching `slot_free` | Surface is live: re-add to the pool and drive it; its own case file's tail decides where it resumes. |
| `slot_free` | Slot free; eligible for the next fill. |
| `gate_error_signal` | Recount distinct surfaces; at threshold, act as `breaker_degraded`. |
| `breaker_degraded`, no later `breaker_healthy`/`run_escalated` | DEGRADED: ensure a repair is in flight before any held step proceeds. |
| `repair_dispatch`, no `repair_terminus` | Repair died mid-flight: treat as an incomplete terminus and re-dispatch on the run budget. |
| `repair_terminus(completed)` | Append `breaker_healthy`; release held surfaces. |
| `repair_terminus(escalate \| incomplete)`, budget exhausted | Append `run_escalated`; stop filling; leave live surfaces where they are. |
| `breaker_healthy`, or no breaker entry | HEALTHY: normal fill-and-drive. |
| Outcome set | Terminal: report it; do not schedule. |

### 3. Concurrency model

**N surfaces run as concurrent async tasks in one Node process, bounded by
`concurrency` slots.** The workload is I/O-bound (git `execFile`, the agent SDK's
subprocess); the event loop already interleaves it. Separate processes would buy
CPU parallelism the workload cannot spend, and would force the breaker, lock and
run file into cross-process coordination, when the run file is designed for one
writer (research §1.6). The pool is a small launcher over a `Set` of in-flight
promises that writes `slot_fill`/`slot_free` and checks the breaker at every
launch (ledger: why not `p-limit`).

### 4. Repo lock and merge serialisation

**The inner lock keys on where a git call runs, not which subcommand it is.**
Every call against a surface's own worktree is uncontended; every call with
`cwd === repoPath` (the shared checkout: worktree add/remove/prune, `branch -D`,
the merge) takes the lock. That is correct by construction, with no allow-list for
a future call to slip past.

1. **Outer, cross-process** (`proper-lockfile` on `.delivery/supervisor.lock`):
   taken when a supervised run starts or resumes, held until its outcome, released
   on any terminal. Its mtime staleness detection lets a resumed supervisor reclaim
   the lock of its own `SIGKILL`ed predecessor with no manual unlock. A refused
   acquisition is the exit-2 refusal above. The sequential (`concurrency: 1`) path
   does not take the lock but does check it, and refuses in the same way while a
   supervised run holds it.
2. **Inner, in-process** (a promise-chain mutex): serialises the N surfaces'
   shared-checkout calls inside the one process the outer lock admits. Wrapped
   calls retry a transient `index.lock` collision from outside the harness (a
   person running git in the checkout) a bounded few times with short backoff
   before surfacing it (research §2.1–§2.2).

**Merge onto a moving base is already solved.** The merge-back closer's
`--ff-only` merge plus ancestry probe revalidates against the current tip at merge
time, which is what GitHub Merge Queue, Bors and Mergify do (research §2.5). If A
merges first, B's fast-forward is refused and reported as the existing `FAIL`
("the base moved on"); close-triage's narrow `retry_close | escalate` router and
the per-surface `close` budget handle it exactly as for a single surface whose
base moved. The lock guarantees A's and B's merges never interleave. No rebase, no
new budget, no new merge mechanics.

### 5. Breaker

States and transitions as `docs/multi-surface-control-flow.md` specifies
(HEALTHY → DEGRADED → REPAIRING → HEALTHY or run escalation). Trigger conditions,
resolved here:

- **Direct trip:** any supervised surface entering `GATE_MAINTENANCE` (red
  baseline, or a `fix_the_gate` verdict). One is enough: the single-surface
  machine already treats that as an environment concern.
- **Aggregate trip:** a *second distinct* surface exhausting its `recheck_gate`
  retries on `gate_error` while a first surface's `gate_error_signal` is on record
  since the breaker was last HEALTHY. One is a flake the per-surface budget
  absorbs; two independent ones is shared breakage.
- **No time window.** Evidence resets on `breaker_healthy`, so the trigger is a
  pure function of history and reproducible under the mock. A false trip costs one
  repair unit against a healthy box.
  `ponytail: M=2, no window; retune (higher M or a bounded window) once real flake rates show over- or under-tripping.`

**Exclusive repair.** DEGRADED holds new `PRE_GATING`/`GATING`/`CLOSING` steps at
`awaitClearance()`; it does not interrupt an agent session or triage call already
in flight, since neither touches the shared repository. REPAIRING begins once no
surface is mid-gate or mid-close; nothing is force-cancelled. One repair session
runs, dispatched by the supervisor with the **existing gate-maintenance role,
prompt assembly and tool authority**. Concurrent `requestRepair` calls coalesce
onto the one in-flight promise. Success releases every held surface where it was
held; run-budget exhaustion escalates the run, since a permanently broken shared
box dooms every surface.

### 6. Budgets

| Budget | Home | Change |
|---|---|---|
| `correction`, `terminus`, `close` | Per surface, case file | None. |
| `gateError` | Per surface, case file | Counter unchanged; a separate run-level signal reads it (§5). |
| `gateMaintenance` | **Run file**, for supervised surfaces | A supervised surface delegates to the coordinator and never burns its own. An unsupervised surface (port absent) keeps today's per-surface counter. |

### 7. Task selection and content identity

Content identity (`findQueueRun`: a run answers for a task by `taskDef` equality,
never position) remains the only task-identity mechanism. At every fill the
supervisor:

1. re-reads `allRuns(repoPath)` fresh, so it sees runs its own other slots just
   created (today's one snapshot per invocation is not enough for N slots);
2. walks `tasks` in list order, skipping a task whose answering run is closed
   (`isClosed`) **or** already occupies a live slot;
3. fills the first task clearing both.

This is `nextQueueTask`'s rule generalised from "first unclosed" to "first
unclosed and unclaimed". The set of tasks is the list as read at the run's start,
as for the sequential queue.

### 8. Closers

Every built-in closer keeps its `CloserPort` contract. Only the shared-checkout git
calls inside `merge-back-closer.ts` and `closer-support.ts` are lock-wrapped; a
closer that never touches the shared checkout is unaffected. An extender's custom
closer that makes its own shared-checkout git calls is outside the lock; the
closer guide documents that boundary.

### 9. Host resource governor: deferred

Roadmap Item 10's success criteria do not include a cross-run governor, and the
control-flow plan scopes a run to one target, with cross-run sharing limited to
host resources. The binding API constraint is an org-wide token-bucket rate
(RPM/ITPM/OTPM), not a concurrent-session count, and a 429 from rate differs from
a spend-cap 429 (`enforced_spend_limit_reached`) (research §2.4). That needs a
rate-aware control with `retry-after` backoff, a different variable from the
slot count. Deferred until several runs are seen contending for one host's
credentials; `concurrency` bounds burst sessions for one run meanwhile.

### 10. Security

No new trust boundary. The repair agent is the existing gate-maintenance role with
its pinned prompt and tool authority, dispatched by the run rather than a surface.
The lock file is advisory coordination state, not a credential; its failure mode
is a delayed resume until staleness clears. No new credential, egress or secret.

### 11. Non-functional requirements

- **Determinism.** Task selection is a pure function of `allRuns()` plus slots;
  the breaker trigger is a pure function of run history.
- **Crash safety.** Every transition is a commit point; the log tail is authoritative
  over the cursor; resume is "read the tail, take the one legal action". Underlying
  git operations are already idempotent on replay (`docs/provisioning.md`'s "call
  it again"; the merge-back closer's already-merged handling).
- **Bounded resources.** `concurrency` caps worktrees and open sessions; the run
  budget caps total repair spend. Both sit above the per-surface machine.

### 12. Telemetry

No new observability subsystem (Item 11). The run file is the audit trail. Output
reuses `RunReporter` (`cli/report.ts`) and the closed-set phrase tables.

### 13. Testing

The existing mock stack is reused. `scripted-supervisor-run.ts` runs N
`MockScript`s concurrently against one temp repository through the real supervisor,
provisioning, gate and closer resolution, as `scripted-surface-run.ts` does for one.
Interleavings are forced with `MockScript`'s existing `delayMs` (which session
answers first, which surface trips the breaker first, which reaches the merge
first). Behaviour preservation of the sequential path is verified by Item 9's
existing `queue.test.ts` and `run-command.test.ts` passing unchanged against the
supervisor at `concurrency: 1`.

### 14. Extensibility

The lock and repair coordinator are ports with no-op defaults, the same mechanism
as `AgentPort`/`TriagePort`/`CloserPort`. A host governor, a priority queue or a
finer breaker window slots in as a port implementation or a cursor field, never by
editing `surface.ts`'s transition table.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Bounded slot pool | Build (small launcher) | `p-limit`, `p-queue` | Every launch must write `slot_fill`, check the breaker and re-read `allRuns()`; a generic limiter would only relocate that code behind a dependency. |
| In-process shared-checkout mutex | Build (promise chain) | `async-mutex` | Lives and dies with the one process the outer lock admits; no staleness or timeout needs. A promise chain is the whole non-reentrant mutex. |
| Cross-process repo lock | **Buy**: `proper-lockfile` | `mkdir` lock by hand | Correct stale-lock detection after `SIGKILL`/OOM is a known-hard corner; getting it wrong means two writers to one run file. |
| Persisted breaker | Reuse-estate: run-file cursor field + transition table, as `case-file.ts`'s `cursor.state` | Opossum, Cockatiel | Both are in-process, ephemeral, per-call breakers with no persistence (research §2.3); this breaker must survive a crash. |
| Ref-mutating git operations and merge | Reuse-estate: `provision.ts`, `merge-back-closer.ts`, `closer-support.ts`, lock-wrapped | New merge-queue mechanics | `--ff-only` plus ancestry probe already revalidates at merge time, as every merge queue does (research §2.5). |
| Task identity | Reuse-estate: `findQueueRun`/`isClosed`/`queueTasks` | The control-flow plan's `queue_cursor` | A second, position-based identity could silently disagree with Item 9's. |
| Repair agent | Reuse-estate: gate-maintenance role, prompt assembly, tool authority | A new run-level repair role | No new trust boundary; only who dispatches it and which budget it burns change. |
| Host resource governor | Deferred (§9) | Rate-aware semaphore now | Different control variable; outside Item 10's success criteria. |
| Breaker threshold | Build: M=2, no window | Time-windowed threshold | Wall-clock windows are non-deterministic and hard to test. |
| Journal primitive | Build: extract `journal.ts` from `case-file.ts` | Duplicate into `run-file.ts` | Two copies of the same crash-safety discipline would drift. |
| Mock for N surfaces | Reuse-estate: `MockScript` + `delayMs` | A new interleaving DSL | Existing vocabulary suffices for the named cases. |

One new runtime dependency: `proper-lockfile`.

## Operability / DX

- **Environment.** Not a new service or daemon: a capability of the existing
  `delivery` process (Node ≥22), living as long as the run it drives, wherever
  `delivery` already runs (a laptop, CI, an autoloop worker).
- **Harness.** `vendor/claude-mock` with `mock-session.ts`/`mock-script.ts` stays
  the one harness for single- and multi-surface work; no second mocking vocabulary.
- **Scaffolding.** `concurrency` is validated by the existing Zod config schema
  and `delivery validate`, before any agent spend. `docs/testing-your-pipeline.md`
  gains a multi-surface section, tested as its guides already are.
- **Local-run story.** `delivery run` as before. With `concurrency > 1`, output
  interleaves tagged lines and `status` shows the environment state. After a hard
  kill, the story stays "run it again": staleness detection reclaims the lock.
- **Deploy target.** The same `delivery-service` npm package and `delivery` binary,
  a minor version (additive), gated on the same licence decision as Items 8–9.
- **Diagnosability.** The roadmap DX note's three asks: a breaker trip is
  diagnosed from the narration and `status`; the run file is inspected post-mortem
  through `delivery status <run-id> --json` (and is plain JSON on disk); N
  surfaces are mocked with `scripted-supervisor-run`.

## What this design does not include

- **Item 11's reporting surface**: TUI, dashboards, cross-run trends,
  plain-language packet summaries beyond today's.
- **Task packs** (Item 12), **scheduling and triggers** (Items 13–14).
- **A host-level resource or rate governor** (COULD; §9).
- **Cross-target fleets**: one run, one repository, one gate.
- **Live reload** of the task list mid-run.
- **Dependency-aware (DAG) or priority scheduling**: list order only.
- **Automatic rebase or conflict resolution** when the base moves under an
  accepted task; the existing `FAIL` → close-triage path handles it.
- **Aggregating repeated provisioning failures into the breaker** (see Open questions).
- **Locking inside custom closers' own git calls.**
- **Licence choice and first publication** (human-gated).

## Assembly resolutions

The two role artefacts were critic-approved individually. Side-by-side reading at
assembly found points where they disagreed or were silent; settled here:

1. **One scheduler, not two.** The product design said `concurrency: 1` keeps "the
   existing sequential loop"; the architecture replaces `runQueue`'s loop with the
   supervisor. Settled: one scheduler (the supervisor). At `concurrency: 1` it
   writes no run file, takes no lock, injects no ports, and prints no tags, so
   observable behaviour, on-disk artefacts and per-surface gate maintenance are
   today's. Item 9's existing tests are the proof.
2. **Supervised run identity.** The product design's example reused the first
   task's run id as the run's id, which made `delivery status <id>` ambiguous.
   Settled: a supervised run has its own `run-<UTC second>` id and lives under
   `.delivery/supervised/`; per-task ids are unchanged. The proposed
   `status --surface <n>` flag is dropped: a task is read in full by its own id,
   honouring "no new addressing syntax".
3. **Lock file location** (architecture deferred it): `.delivery/supervisor.lock`,
   repository-scoped because it guards the repository, not a run.
4. **Sequential run versus a live supervised run.** Neither artefact covered a
   `concurrency: 1` queue started while a supervised run is live. Settled: it
   checks the lock and refuses on exit 2 with the same message.
5. **Pool primitive.** The product design leaned towards `p-limit`; the
   architecture's ledger, which owns the decision, builds a small launcher.
   The ledger stands.
6. **Pause wording.** Journey 3 now says "holding any task about to check or hand
   off its work", matching the hold points rather than overclaiming a full stop.
7. **Provisioning-failure aggregation.** The product design asked the architect to
   extend the breaker's aggregate signal to repeated provisioning failures; the
   architecture did not. Left out of this phase and recorded as an open question.
8. **"Surface" stays internal; "task" is the user-facing unit.** The product
   design's own "Terminology decision" section proposed promoting "surface" to
   the user-facing word throughout, flagged as needing the architect's agreement
   before either side built against it; the architecture never took a position
   on user-facing wording, and the product design's own persona goals and UX
   prose used "task" for what a user reads regardless. Settled here in favour of
   how the rest of both artefacts actually write for a reader: "surface" is
   internal vocabulary; "task" is what Dana sees.

## Open questions

- Should repeated provisioning failures (`ABORTED`) across distinct surfaces feed
  the breaker's aggregate signal? Today each is per-task; a disk-full host would
  abort every task one by one.
- Should the breaker threshold (M=2, no window) become configurable once real flake
  rates are observed?
- Would a host governor share state through the filesystem or need a daemon? Not
  needed until multi-run contention is seen.
- Should the `open-pr` closer, which pushes a branch rather than merging locally,
  take the inner lock for its push? It touches remote refs, not the shared
  checkout; the where-it-runs rule says no, and this should be confirmed during
  planning against its real git calls.
