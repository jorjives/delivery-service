# Provisioning

Design notes for the entry edge of a delivery surface: how a worktree is created
and a task bound to it before gating begins. Provisioning is the counterpart to the
[close interface](single-surface-control-flow.md#close-interface): close is how a
surface ends, provisioning is how it starts. This document covers what provisioning
owns, what it deliberately does not, task binding, crash recovery, and how the
supervisor drives it when filling a slot.

Scope: the `PROVISIONING` edge of the [single surface](single-surface-control-flow.md)
and the [supervisor's](multi-surface-control-flow.md) slot-fill that invokes it.

## What provisioning owns

Two things, and no more:

1. **Create the worktree.** One worktree per surface, branch-per-task, descended from
   the run's one repo. This is a ref-mutating op (`worktree add`), so it runs inside
   the supervisor's repo-level lock alongside `worktree remove` and the close/merge.
2. **Write the case file header.** The immutable identity block: `surface_id`,
   `task_def`, `gate_ref`, `worktree_ref`. The `baseline` field is created empty; the
   fingerprint is captured later at `PRE_GATING`, before the first dispatch, never
   here.

On success the surface transitions to `PRE_GATING` with a worktree that exists and a
case file that resumes. That is the whole job.

## What provisioning does not own

- **No environment.** The harness provisions a worktree, full stop. Services,
  containers, databases, compose stacks: all the project's concern, stood up by the
  project's own gate/task setup, not by the harness. This is why the shared-fate
  breaker in the multi-surface doc governs *the project's* shared environment and not
  anything provisioning creates. The closer's "docker teardown" is likewise the
  project's teardown hook; from the harness's side, releasing a surface is
  `worktree remove` and nothing else.
- **No in-tree task.** Provisioning writes nothing into the worktree. The tree is
  handed to the first gate run pristine (see [task binding](#task-binding)).
- **No baseline.** Capturing the per-assertion fingerprint is `PRE_GATING`'s job and
  must stay there: baseline is captured exactly once, immutably, after provisioning
  and before dispatch.

## Task binding

The task lives in the case file header and reaches the agent through its
harness-constructed prompt, assembled from `task_def` plus the distilled brief. The
worktree is never written to.

This is deliberate, on two counts:

- **The gate judges a diff.** Its verdict is the delta between baseline and check. A
  task manifest materialised into the tree is either noise the gate must special-case
  out or contamination in the diff it judges. Keeping the tree pristine keeps ground
  truth clean.
- **The task is pinned out of the worker's reach** (invariant 5). An in-tree task
  file is a file the worker can edit, and a worker that can rewrite its own success
  criteria can neuter them. Delivering the task by prompt, not by filesystem, closes
  that reward-hacking surface.

If a project wants an in-tree task file for its own tooling, that is a project
provisioning hook, on the same footing as its environment: not the harness's
business.

## State and recovery

Provisioning is a replayable node like every other transition (invariant 4), and its
recovery is **idempotent re-provision**. The case file header write is the commit
point; the worktree is created before it.

```
PROVISIONING
  worktree add (under repo lock)  →  write case file header  →  PRE_GATING
                                  ↑
                          commit point
```

Two crash windows, each with one clean resume:

- **Crash after `worktree add`, before the header write.** No case file exists yet, so
  there is nothing to resume *from*; the worktree is an orphan with no owning surface.
  The supervisor GCs it (see below). Re-provision starts clean.
- **Crash after the header write.** A resumable surface exists, its tail is the header,
  its cursor is `PRE_GATING`. This is an ordinary resume into `PRE_GATING`; provisioning
  is already done.

On a re-provision that finds a **partial** worktree for its `surface_id` (a half-created
tree from a torn attempt), it tears the partial down and recreates cleanly rather than
adopting found state. Provisioning is the one node that must start from a known-clean
tree: unlike a retried terminus, which treats a dirty tree as found-state for the gate
to judge, a half-provisioned tree has no baseline yet and no meaning to preserve.

### Orphan collection

A worktree with no owning case file header is unreferenceable and is the supervisor's
to reap. Because worktrees are named by `surface_id` and the header records
`worktree_ref`, the supervisor can diff live worktrees against owning headers and
`worktree remove` any with no owner. This runs under the same repo lock as every other
ref-mutating op.

`ponytail: sweep-on-resume orphan GC; a periodic sweep only if crash-during-provision
turns out frequent enough to strand worktrees between resumes.`

## Failure

Provisioning failure is **infra-class**. A worktree that cannot be created (disk, a
corrupt repo, a lock that never clears) is not a task problem and not something a
fresh worker or triage can help. The edge is `PROVISIONING → ABORTED`, already in the
single-surface machine: infra failure, worktree may be torn down, no case file to
retain because none was completed. There is no provisioning budget or retry beyond the
idempotent resume above; a genuinely unprovisionable target is a run-level problem, not
a per-surface one.

## Supervisor tie-in

Provisioning is where a supervisor slot becomes a live surface. When a slot frees (its
surface reached a terminal state), the supervisor:

1. Pulls the next task from the queue at `queue_cursor`.
2. Takes the repo lock, `worktree add`, writes the case file header, releases the lock.
3. Assigns the slot to the new `surface_id` in the `slots` cursor and advances
   `queue_cursor`.

The slot assignment and the provisioning transition are the supervisor's commit point,
recorded in the run log exactly as the surface records its own: a crash mid-fill is
recovered from the run file's tail, and an orphan worktree from a half-fill is collected
as above. Backpressure needs nothing special here: if the pool is full there is no free
slot, so provisioning simply is not invoked and the task waits in the queue.

The critical section is brief, `worktree add` plus one header write, consistent with
the multi-surface assumption that ref-mutating ops are short and throughput is
dominated by parallel in-worktree work.

## Open items

- **Branch naming and collision.** ~~Open.~~ Settled by the single-surface state
  machine: the branch is `surface/<surface_id>`, computed by a pure function and
  stored nowhere, so it can never drift from the surface id. A branch surviving a
  prior aborted run is force-deleted as part of the same tear-down-and-recreate
  that handles a partial worktree, so provisioning always starts from a clean
  branch as well as a clean tree.
- **Task queue shape.** Provisioning consumes from the queue but the queue's own
  structure (priority, dedup, persistence) is the supervisor's, still open in the
  multi-surface doc.
- **Repo readiness.** Whether the supervisor guarantees a fetched, clean base ref
  before any surface provisions, or each provision fetches. A run-start concern that
  touches provisioning's assumptions.
