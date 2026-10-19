# Delivery Service: Stacked Delivery Pull Requests — Design

> **Status:** Approved
> **Created:** 2026-10-19
> **Approved:** 2026-10-19
> **Builds on:** `2026-10-06-course-correction-design.md` §5.5 (landed, not yet merged) and §5.7
> (the delivery branch). Rolling mode, described there, is unchanged and stays the default.

## 1. Why

With the `open-pr` closer, `delivery run --sources` already keeps work moving while the owner
reviews: every item lands on one delivery branch, `delivery/<base>`, each built on the item
before it, and the closer keeps **one** pull request open for that branch, growing its list of
items run by run. Once the owner merges it, the next run starts again from the base.

That single, growing pull request is the wrong unit of review for work delivered slice by slice:

- **Review and UAT are per item.** A slice has its own acceptance criteria and its own human UAT
  script. Reviewing slices 1 to 4 in one diff mixes four UATs together, and the diff grows every day it
  waits.
- **Merging is all or nothing.** The owner cannot merge slice 1, which is ready, while slice 3
  waits for a question to be answered. Value that is ready waits for value that is not.

**Stack mode** keeps the delivery branch exactly as it is (the line every task starts from and
lands on) and publishes it as a **stack of pull requests, one per landed item**. Item *k*'s
pull request targets item *k−1*'s branch, and the bottom one targets the base. The owner reviews,
UATs and merges them one at a time, bottom first. Work continues on top meanwhile. When a pull
request merges, or is closed, the next run rebuilds the rest of the stack on the base.

## 2. Scope

**In scope:** an opt-in stack mode for the `open-pr` closer; reconciling the stack with GitHub at
the start of every `--sources` run (merged, closed, and owner-amended pull requests); restacking
by rebase, with every remaining level re-checked; publishing the stack; the ledger, status and
report changes those need; fetching the base from `origin` for the `open-pr` closer in both modes;
ordered sequences in dispatch, so dependent items never run ahead of the item they build on
(§5.10, in both modes).

**Not in scope:**

- **Rework inside the stack by the harness.** A reviewer's "changes requested" on a mid-stack
  pull request is the owner's to act on. The owner may push commits to that pull request's
  branch (§5.4) or close it (§5.3); the harness does not read review comments.
- Stacks for any closer other than `open-pr`, or any host other than GitHub.
- Several stacks per base (for example one per spec). There is one line of work per base, as
  today.
- A limit on stack depth. If long stacks prove painful, a `maxOpen` that stops dispatch is the
  obvious addition.
- Merging pull requests. The owner merges, using whatever merge method the repository allows.

## 3. Concepts

| Term | Meaning |
|---|---|
| **Delivery branch** | `delivery/<base>`, unchanged: the local line tasks start from and land on. In stack mode its tip is always the top level's commit, or the base's tip when the stack is empty. It is not pushed in stack mode. |
| **Level** | One landed item in the stack: its run id, item key, intent, task text, `closes` reference, its **level ref** and the commit that ref points at. Ordered by landing. |
| **Level ref** | `delivery-stack/<base>/<runId>`, a local branch pointing at the delivery-branch commit at which that item landed, pushed to `origin` as the pull request's head. (`delivery/<base>/…` cannot be used: git refuses a ref under an existing branch name.) |
| **Parent** | The base for the bottom level; otherwise the level below. A level's pull request targets its parent. |
| **Fork point** | The commit the stack's bottom level was built on: the base's tip when the stack was opened or last restacked. |

The stack is a projection of the delivery ledger (`delivery.jsonl`), folded like the rest of
`DeliveryState`. The ledger, not the refs or GitHub, is the record of which levels exist; refs
and pull requests are made to match it.

## 4. Configuration

```json
"closer": { "type": "open-pr", "stack": true }
```

`stack` exists only on the `open-pr` variant of `CloserRef`, defaulting to `false` (rolling
mode). Schema validation rejects it elsewhere. Turning stack mode on while a rolling pull
request is open is refused at run start with a setup error (exit 2) that names that pull request: merge or close it
first. Switching modes mid-stream is not supported.

Stack mode requires git 2.38 or later (for `rebase --update-refs`, §5.5). An older git is a
setup error at run start, naming the version found.

## 5. Design

### 5.1 Landing (unchanged, with one tightening)

Provisioning, landing onto the delivery branch, rebuilding a task whose tip moved, and the item
ledger's "landed, not yet merged" rule all stay as §5.7 of the course-correction design
describes them.

One tightening: the commit recorded for a landed item must be **the delivery-branch commit at
which that item landed**, taken from the landing itself. Today it is read at settle time and
may include a later item's landing when several land in one run. In rolling mode this was
harmless. In stack mode it would put two items in one pull request. Each landing creates its
level, with its level ref at that commit.

### 5.2 Reconciling the stack at run start

In stack mode, `reconcileDeliveryBranch` is replaced by stack reconciliation. It runs on
**every** `--sources` run while the stack has levels, including a run with nothing to claim, so
merges are acted on even when the backlog is empty. It has three parts.

**Observe.** Fetch the base from `origin` (remote-tracking ref only; no local branch other than
the delivery branch and level refs is ever moved). For each level, ask GitHub for its pull
request through `gh` (state `OPEN`, `MERGED` or `CLOSED`, URL, head commit, base branch).
GitHub's state is authoritative: it reports a merge the same way whether it was a merge commit,
a squash or a rebase-merge, which ancestry cannot.

**Plan.** A pure function from the ledger's levels and the observed states to one action:

| Observed | Action |
|---|---|
| Every level `OPEN`, heads as the ledger expects | **None.** |
| A prefix of levels (bottom first) `MERGED`, the rest `OPEN` | **Restack** the remaining levels onto the base's tip, from the top merged level's commit (§5.5). If none remain, the stack is empty: the delivery branch resets to the base's tip, as today's `opened`. |
| Level *j* `CLOSED` without merging | **Drop** level *j* and every level above it (§5.3), then restack what remains if anything below merged. |
| A level's remote head has commits beyond the ledger's commit, descending from it | **Adopt** the owner's commits into that level and restack the levels above onto it (§5.4). |
| A level's remote head does not descend from the ledger's commit (rewritten by someone else) | **Blocked.** |
| A level `MERGED` while a level below it is `OPEN` (merged into its parent on GitHub) | **Blocked**, saying so. This resolves itself: once the parent merges, both form a merged prefix. |
| A level whose pull request does not exist yet (the closer has not published it) | Treated as `OPEN`; the closer publishes it at the end of the run. |

Plan rows combine in one fixed order: drop, then adopt, then restack, then any merged prefix.

**Act.** The action runs, its outcome is recorded in the delivery ledger, and only then are tasks
claimed. A blocked stack starts no task and reports why, with the existing `blocked` semantics:
the same attempt is not repeated until the base, the stack or a pull request moves. A plain
"base has new commits", with nothing merged, triggers **no** restack (§9, decision 4).

### 5.3 Dropping levels

Closing a pull request without merging it is the owner saying no to that level. Every level
above it is built on it, so they go too, and the next item continues from what remains, which
is the base when the bottom was closed.

- Each dropped level above *j* has its pull request closed, with a comment saying it was built on
  level *j*'s pull request, which was closed, and that its item will be delivered again.
- Each dropped level's ref is deleted locally and on `origin`. The delivery branch moves to the
  highest remaining level, or to the base's tip.
- In the item ledger, the item at *j* is recorded as **rejected**: an attempt that counts
  towards parking, so an item whose pull request keeps being closed parks under the existing
  `parkAfter` rule rather than looping. Items above *j* are released without an attempt. All of them become
  dispatchable again, because their work no longer awaits merge.

When the items are in a sequence (§5.10), the closed item is the earliest undelivered one in it,
so it is dispatched again first, built on level *j−1*, and the items above it wait. Work
continues from the base only when the bottom level itself was closed.

### 5.4 Adopting the owner's commits

An owner who answers review by pushing a fix to a level's branch has moved the remote head
beyond the ledger's commit. Pushing the harness's version over it would destroy their work, and
ignoring it would leave the levels above built on a stale parent.

When the remote head descends from the ledger's commit, the harness fetches it, checks it
against the parent's baseline as a landing is checked, and on a pass records it as the level's
new commit. The levels above are then restacked onto it (§5.5, with the old commit as the
upstream). A failing check, or a remote head that does not descend from the ledger's commit, blocks the
stack, naming the level and its pull request.

### 5.5 Restacking

A restack moves levels *a..n* from an old upstream commit *U* onto a new parent *P*: the base's
tip after merges, or an adopted level's new commit.

- **Rebase, never merge.** `git rebase --onto P U <delivery branch> --update-refs`, in a scratch
  worktree of the delivery branch, replays only the commits of *a..n*, and `--update-refs` carries
  each level ref along. Merging the base in instead conflicts whenever a level edits lines that
  a squash-merged level below it introduced, which is the usual case for consecutive slices.
- **When the merged level is already an ancestor of the base** (a merge-commit merge) and
  nothing was adopted or dropped, the rebase is skipped: retargeting the new bottom pull request
  is enough, since GitHub's diff against the base then shows only that level's own commits.
- **Every remaining level is re-checked.** Each level is independently mergeable, so each must
  pass. Level *k*'s new commit is checked against level *k−1*'s new commit as its baseline (the
  base's tip for the bottom), using the existing delta rule. That is *n−a+2* gate runs per restack.
- **All or nothing.** Level refs and the delivery branch move to their new commits only when
  every level passes, in one `git update-ref --stdin` transaction. A conflict or failed check
  leaves every ref, and every pull request, as it was, and blocks the stack with a reason that
  names the level, its pull request and the conflicting files or newly failing assertions. The
  owner's way out is to resolve it on that pull request (adopted next run) or to close it
  (dropped next run).
- The ledger records `restacked`, with the new parent and each level's new commit. The fork point
  becomes *P*.

### 5.6 Publishing the stack (the closer)

The closer stays a publisher: the harness decides what the stack is, and the closer makes GitHub
match it. `CloseContext.delivery` gains `stack`: the levels in order, each with its level ref,
commit, parent ref, the commit the closer last pushed for it (or none), item key, intent, task
text and `closes`. `branch` is the top level ref; `baseBranch` is the base.

For each level, bottom up, the stack-mode `open-pr` closer:

1. Pushes its level ref: plain push when new, `--force-with-lease=<ref>:<last pushed commit>`
   when restacked. All pushes of one close go in a single `git push --atomic`. A lease that
   fails means someone pushed meanwhile: the close is an `ERROR`, and the next run adopts or
   blocks (§5.4).
2. Opens its pull request when none is open for the ref, with `--base=<parent ref>`. The title is
   the item's intent and the body its task text (for a slice, whatever the source put in the
   brief, which is where its UAT belongs), a `Closes #n` line when set, and a line naming
   the levels below it that must merge first.
3. When one is open, sets its base to the parent ref (`gh pr edit --base`) if it differs, and
   refreshes the body.

Every step is idempotent, so a failed close is retried whole on the next run, as today. The closer
does not rely on GitHub's automatic retargeting, which only happens when a merged pull request's
branch is deleted.

### 5.7 Item ledger: awaiting merge

`awaitsMerge` reads an item's commit and asks whether its branch still holds it. A restack
changes every remaining level's commit, so in stack mode the question is answered from the
stack instead: an item awaits merge while it is a live level. A merged level's item no longer
awaits merge; the base now carries its resolution (backlog `status: resolved`, a ✅ slice marker,
or a closed issue), so the source does not list it. A dropped level's item is dispatchable.

### 5.8 Fetching the base (both modes)

With the `open-pr` closer, merges happen on GitHub, and nothing on the machine fetches them, so
today's rolling mode can miss that its pull request merged and land more work on a branch
whose pull request is gone. With either mode of the `open-pr` closer, the run fetches the base from `origin`
before reconciling. `baseTip` already prefers the remote-tracking ref when it is ahead. A failed
fetch is not fatal: the run reconciles against what it has, and says it could not fetch.

### 5.9 Status and report

`delivery status` and `delivery report` show the stack bottom up: each level's item, intent,
pull request URL and state, and a blocked reason when there is one. In the report's versioned
data, `delivery` gains `stack`: an array of `{ run, item, intent, ref, commit, pr }`, empty in
rolling mode, plus the existing `blocked`. `docs/reporting.md` documents the field, and
`docs/project-configuration.md` gains a "Stacked pull requests" section beside "The delivery
branch".

### 5.10 Ordered sequences

Slices build on each other: slice 3 assumes slice 2's work is there. Dispatching slice 3 while
slice 2 is parked builds it on the wrong parent. Either its check fails and it parks too, or,
worse, the agent writes slice 2's missing work into slice 3, and the pull requests, the slices
and their UATs no longer match. Autoloop's stop-the-line veto exists for this reason. A work
source cannot enforce it itself, because it cannot see the item ledger, so dispatch does.

- **A work item may carry `sequence: <name>`**, from any source: a backlog item's front matter,
  a field of a command source's task, or a `sequence:<name>` label on a GitHub issue. Items with
  the same name form one sequence, in the source's order.
- **Within a sequence, dispatch takes only the earliest item not yet delivered.** An item counts
  as delivered once it has landed, so in stack mode the next item stacks on the one before it
  while that one awaits review. If the earliest undelivered item is parked, waiting for the
  operator's answer, or in flight, nothing later in its sequence is dispatched.
- **Nothing else waits.** Items without a `sequence`, and other sequences, are dispatched as
  usual, so a stall in one spec does not stop another spec or the issue backlog.
- **`delivery status` and the report** name each waiting sequence and the item holding it,
  with that item's state (parked, waiting for an answer, or in flight). In the report's
  versioned data this is `held`: an array of `{ sequence, item, reason }`.
- With `--max N` above 1, at most one item of a sequence is taken per run, since the next one
  cannot start until the earlier one lands.

A sequence is ordering only. A dependency between sequences, such as one spec's slices needing
another spec's, is expressed by giving them the same sequence name. Richer dependencies (a
per-item `dependsOn`) are not part of this design.

The slices work source sets `sequence` to the slices file, so each spec is its own sequence.

## 6. Units

| Unit | Does | Depends on |
|---|---|---|
| `delivery-stack.ts` (new) | Folds the levels from the delivery ledger; the pure **plan** function (§5.2) | `delivery-ledger.ts` |
| `stack-pull-requests.ts` (new) | Reads each level's pull request state, head commit and base through `gh`; never throws, reporting "could not ask" as a value | `gh.ts` |
| `restack.ts` (new) | Rebase in a scratch worktree, per-level re-check, single ref transaction (§5.5); adopt (§5.4); drop (§5.3, refs only) | `git-exec.ts`, `disposable-copy.ts`, gate resolution, `delta-rule.ts` |
| `delivery-ledger.ts` | Gains `level` (via `landed`, with its exact commit), `restacked`, `merged`, `dropped` and `adopted` entries | — |
| `open-pr-closer.ts` | Stack publishing (§5.6), when `ctx.delivery.stack` is set | `gh.ts`, `git-exec.ts` |
| `cli/sources-run.ts` | Chooses reconcile by mode; runs it every run while the stack has levels | the above |
| `item-ledger.ts` | `awaitsMerge` consults the stack in stack mode; `rejected` attempt for a closed level | `delivery-stack.ts` |
| `work-sources.ts` | Reads `sequence` from every source type; `chooseWork` applies the sequence hold (§5.10) | `item-ledger.ts` |
| `schema.ts` | `stack` on the `open-pr` closer | — |

The plan function is where the decisions live, and it touches neither git nor GitHub, so every
row of §5.2's table is a unit test.

## 7. Error handling

| Failure | Result |
|---|---|
| `gh` missing, signed out or offline when observing | Stack untouched; run starts no task; the existing access messages name the fix |
| Fetch fails | Note; reconcile against the last fetched base |
| Restack conflicts or fails a check | Blocked, all refs and pull requests unchanged (§5.5) |
| Owner rewrote a level's branch | Blocked, naming the pull request (§5.4) |
| Out-of-order merge | Blocked until the parent merges, then resolves on its own |
| Push lease rejected during close | Close `ERROR`; next run adopts or blocks |
| Close fails part way | Next run retries the whole close; every step is idempotent |
| Crash mid-restack | Refs move in one transaction, recorded after; a restack without its ledger entry is redone from the unchanged refs |
| git older than 2.38, or stack mode turned on over an open rolling pull request | Setup error, exit 2 |

## 8. Testing

- **Plan function:** one test per row of §5.2, plus combinations (a closed level above a merged
  prefix; an adopted level below a merged one).
- **Restack, in temporary repositories:** the motivating case, where the bottom is squash-merged
  and level 2 edits lines that level 1 added, must restack cleanly. Rebase-merge and merge-commit
  (rebase skipped, retarget only) are covered too, as are a conflict at level 2 of 3 leaving every
  ref untouched, a check failing at the top level leaving every ref untouched, and a level that
  becomes empty because the base already holds its change.
- **The `gh` stand-in** learns `pr view` with `state` and `headRefOid`, `pr edit --base`,
  `pr close --comment`, and scripted state changes (merge by method, close, owner push), so
  `sources-run` tests drive whole sequences: three runs make three stacked pull requests; the
  bottom merges by squash; the next run restacks, retargets and lands a fourth on top; closing
  level 2 drops levels 2 to 4 and the next item starts from level 1.
- **Sequences:** in `chooseWork`, a parked, answer-waiting or in-flight earliest item holds its
  sequence and nothing else; a landed-but-unmerged item does not hold it; with `--max 3`, one
  item per sequence is taken; and, end to end in stack mode, closing slice 2's pull request
  redelivers slice 2 on slice 1 before slice 3 is dispatched.
- **Rolling mode regression:** the existing delivery-branch tests run unchanged, plus one for
  §5.8 (a rolling pull request merged on GitHub and seen only through the fetch).

## 9. Decisions

### Buy-vs-build

1. **Built on the existing delivery branch, not beside it.** Provisioning, landing, rebuild on a
   moved tip, the item ledger's awaiting-merge rule, `blocked` semantics and PR detection are all
   reused. The new code is reconcile, restack and publish.
2. **git-spice (`gs`) considered and rejected.** It handles squash-merged stacks well, but it
   would be a new binary for every user of an open-source harness, it keeps its own state in
   `refs/spice/*` as a second source of truth beside the ledger, and it does not re-check after
   a restack, so the harness would still need its own reconcile-and-check loop. Graphite
   needs an account; ghstack and spr assume one pull request per commit, not per item.
3. **`git rebase --update-refs` and `gh` are the primitives.** Both are commodities the harness
   already depends on (git, and `gh` for `open-pr`). `--update-refs` raises the git floor to 2.38
   in stack mode only.

### Behaviour

4. **Restack on merge, not on every base movement.** Restacking force-pushes every level and
   costs a check per level. Doing it whenever anyone commits to the base would churn every open
   pull request in a busy repository. The owner's own commits reach the stack at the next
   restack. Until then, new items build on a stack that may lag the base, and GitHub shows any
   conflict on the pull request.
5. **GitHub's pull request state, not ancestry, decides "merged".** It is the only signal that
   is correct for all three merge methods, and the repository's method is not ours to choose.
6. **Closed means no.** A closed level is rejected and counts as an attempt; levels above are
   released, and with sequences (§5.10) the closed item is redone first, on the level below it,
   which is the base only when the bottom level was closed. Counting the attempt stops a rejected
   item looping.
7. **Force-push with lease, atomically.** Level refs are the harness's branches, so rewriting
   them is expected in a stacked workflow. The lease protects any commit the owner pushed.
8. **Ordered sequences in the harness, not in the source.** Only dispatch can see whether an
   item is parked or waiting, so only dispatch can hold a sequence behind it. A sequence is a
   named order rather than a dependency graph, because slices are a line.

### Operability / DX

- Opt in with one config field. Rolling mode stays the default and is unchanged apart from
  the fetch (§5.8).
- The owner's whole interface is GitHub: review, UAT and merge bottom up, push a fix to a level,
  or close a level. `delivery status` shows the stack and any block.
- Verified offline: temporary repositories, plus the `gh` stand-in extended with pull request
  state, so the suite needs no network and no GitHub account.

## 10. Risks

- **Check cost.** A restack of *n* levels costs *n+1* gate runs. For a slow suite and a deep
  stack this is significant. Mitigation if needed: a depth limit (out of scope, §2).
- **Force-push and review state.** GitHub keeps review comments across force-pushes but resets
  "viewed" markers on changed files. This is inherent in stacked pull requests with squash
  merges.
- **Lagging the base** (decision 4) can surface a conflict only when the bottom merges, which
  then blocks the stack until the owner resolves or closes a level.
- **A held sequence looks idle.** A parked slice stops its spec's sequence until the operator
  unparks or answers it. `delivery status` and `notify` name the held sequence, so the stall is
  visible rather than silent.
