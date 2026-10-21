# Delivery Service: Stacked Delivery Pull Requests — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-19-stacked-delivery-prs-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** as in the earlier scopes, the product surface is the `delivery` command, so
the terminal and the GitHub pull request page are the product UI. UAT is written for the operator
persona (`docs/personas.md`): typing a `delivery` command, reading what it prints, and reviewing
or merging pull requests on GitHub is using the product. Recorded regression tests use temporary
repositories and the extended `gh` stand-in instead of a real GitHub account.

**Assumptions (decided unattended, conservative):**

- **§5.8 and §5.10 are sliced first and on their own.** Both apply to rolling mode as well as stack
  mode, so they ship and are useful before any stack exists. Stack mode then builds on them.
- **The stack arrives in three steps:** publish it (3), keep it right as levels merge (4), then
  handle the owner pushing back by closing or amending a level (5, 6). Slices 3 and 4 are the
  smallest steps that each leave the operator with something whole: a stack that can be reviewed,
  then a stack that survives its first merge.
- **Rolling mode must not regress.** Every slice that touches shared code carries the existing
  rolling-mode behaviour as an acceptance criterion.
- **The `gh` stand-in extensions (§8) are test support,** carried in whichever slice first needs
  each one, not a slice of their own.

**Ordering rationale:** Slice 1 fixes a gap that exists today in rolling mode and that stack mode
would otherwise inherit. Slice 2 is independent of stacks and protects slices 3 to 6 from building
on the wrong parent. Slice 3 delivers the stack itself. Slice 4 is the reason the stack is worth
having (merge bottom first, work continues). Slices 5 and 6 handle the two ways an owner reacts
during review, and are independent of each other.

---

## Slice 1: A Merge on GitHub Is Noticed Without Pulling

**Delivers:** With the `open-pr` closer, the operator merges a delivery pull request on GitHub and
the next `delivery run --sources` knows it merged, without the operator updating the repository by
hand first.

### Prerequisites

- The `open-pr` closer exists and keeps one rolling pull request open for the delivery branch.

### Acceptance Criteria

- [ ] A run using the `open-pr` closer in rolling mode fetches the base from the remote before it
      reconciles the delivery branch.
- [ ] After the rolling pull request is merged on GitHub, the next run starts again from the base
      rather than landing more work on a branch whose pull request is gone.
- [ ] If the fetch fails (for example offline), the run carries on against what it already has and
      says it could not fetch.
- [ ] Other closers do not fetch.

### UAT

**What you can now do:** Merge a delivery pull request on GitHub and trust the next run to see it.

**How to try it:**
1. In the demo project with the `open-pr` closer, run `delivery run --sources` so a delivery pull
   request is opened on GitHub.
2. Merge that pull request on GitHub. Do not update the local repository.
3. Run `delivery run --sources` again.
4. Run `delivery status`.

**What you should see:** The status shows the delivery branch has started again from the base, and
the merged item is no longer listed as awaiting merge. A new item, if one is claimed, opens a fresh
pull request rather than adding to the merged one.

**Why this matters:** The operator never has to remember a manual update step, and work is never
silently stacked on a pull request that has already gone.

---

## Slice 2: Slices Run in Order, and a Stalled Slice Holds Only Its Own Spec

**Delivers:** Work items can belong to a named sequence, and the run never starts a later item of a
sequence while an earlier one is parked, waiting for an answer, or in flight; other work carries on.

### Prerequisites

- A work source can supply a list of items for the run to claim, with a parked state and a waiting
  for an answer state.
- `delivery status` and `delivery report` exist and show the state of work items.

### Acceptance Criteria

- [ ] An item can declare a sequence name from a backlog item, a command source's task, or a GitHub
      issue label; items sharing a name form one sequence in the source's order.
- [ ] Within a sequence, only the earliest item not yet delivered is taken; an item counts as
      delivered once it has landed, even if its pull request is not yet merged.
- [ ] If the earliest undelivered item is parked, waiting for an answer, or in flight, nothing later
      in that sequence is taken.
- [ ] Items without a sequence, and items in other sequences, are taken as usual.
- [ ] With `--max` above one, at most one item of a sequence is taken in a run.
- [ ] The slices work source gives each slices file its own sequence.
- [ ] `delivery status` names each held sequence, the item holding it, and why (parked, waiting for
      an answer, or in flight).
- [ ] The report's versioned data carries a `held` list of sequence, item and reason, and the
      reporting reference documents it.
- [ ] Without any sequence declared, dispatch behaves exactly as before.

### UAT

**What you can now do:** Park one slice and see that only its own spec waits.

**How to try it:**
1. In the demo project, set up two specs of three slices each and one unrelated backlog item.
2. Park the second slice of the first spec, then run `delivery run --sources --max 3`.
3. Run `delivery status`.
4. Unpark that slice and run `delivery run --sources` again.

**What you should see:** The first run takes the unrelated item and the second spec's first slice,
but not the first spec's third slice. The status names the first spec as held by its second slice
and says it is parked. After unparking, the second slice is taken before the third.

**Why this matters:** Slices that build on each other never run on the wrong foundation, and a
stall in one spec does not stop everything else, nor does it hide.

---

## Slice 3: Review Delivered Work as a Stack of Pull Requests

**Delivers:** With stack mode switched on, each item that lands gets its own pull request, each
targeting the one below it, so the operator can review and try each item separately.

**Operational note:** Stack mode is an opt-in setting on the `open-pr` closer, off by default.
Turning it on while a rolling pull request is open, or running it on a git too old to support it,
stops the run at start with a setup error that says what to do. `delivery status` and
`delivery report` show the stack bottom up and the project configuration reference gains a
"Stacked pull requests" section beside "The delivery branch".

**Build note:** Built on the existing delivery branch and landing rather than beside it. Git's own
rebase and the `gh` command are the only tools used; no stacking tool is adopted (git-spice and
others were assessed and rejected in the design). The pull request lookup shared by the closer and
the landed-outside check is widened once, not duplicated.

### Prerequisites

- The `open-pr` closer in rolling mode works and delivery items land on the delivery branch.
- Slice 1 is in place so the run sees the base as GitHub has it.

### Acceptance Criteria

- [ ] The `open-pr` closer accepts a `stack` setting, off by default, rejected on any other closer.
- [ ] With stack mode on, each landed item produces its own pull request containing only that
      item's changes, even when several items land in one run.
- [ ] The bottom pull request targets the base; every other targets the pull request below it.
- [ ] Each pull request's title is the item's intent; its body is the task text, a closing line when
      the item closes an issue, and a line naming the pull requests below it that must merge first.
- [ ] Running the closer again changes nothing that is already correct and repairs anything missing.
- [ ] Turning stack mode on while a rolling pull request is open fails at start, naming that pull
      request, and starts no work.
- [ ] An older git than the stack needs fails at start, naming the version found.
- [ ] `delivery status` shows each level bottom up with item, intent, pull request link and state.
- [ ] The report's versioned data carries a `stack` list (empty in rolling mode) and the reporting
      reference documents it.
- [ ] Rolling mode behaves exactly as before.

### UAT

**What you can now do:** Turn on stack mode and get one pull request per delivered item.

**How to try it:**
1. In the demo project, add the stack setting to the `open-pr` closer.
2. Run `delivery run --sources --max 3` with three items available.
3. Run `delivery status`.
4. Open the three pull requests on GitHub, starting from the bottom.

**What you should see:** Three pull requests. The first targets the base, the second targets the
first, the third the second. Each shows only its own item's changes, with its description and a
note of what must merge first. The status lists the same three bottom up.

**Why this matters:** The operator can review, try and judge each slice on its own instead of
facing one growing diff.

---

## Slice 4: Merge the Bottom Pull Request and the Rest Follow

**Delivers:** After the operator merges pull requests from the bottom, the next run moves the
remaining ones onto the new base, checks each, retargets them on GitHub, and carries on delivering
on top.

### Prerequisites

- A stack of more than one pull request can be published and is shown by `delivery status`.
- The run fetches the base from the remote before reconciling.

### Acceptance Criteria

- [ ] At the start of every run that has stack levels, even one with nothing to claim, the run asks
      GitHub for the state of every level's pull request in a single request.
- [ ] Merging the bottom pull request by squash, by rebase, or by merge commit is each recognised as
      merged; GitHub's state decides, not the shape of history.
- [ ] After a merge, the remaining levels are moved onto the base's new tip, and each one is
      re-checked against the level below it; the bottom remaining pull request is retargeted to
      the base and the others keep targeting the level below.
- [ ] A level that edits lines introduced by a squash-merged level below it moves cleanly.
- [ ] When the merged level is already part of the base's history and nothing else changed, no
      rewrite happens and the bottom remaining pull request is only retargeted.
- [ ] If every level has merged, the stack is empty and the next item starts from the base.
- [ ] If any level conflicts or fails its check, nothing is changed: no branch, no pull request,
      and the run starts no task, saying which level, which pull request and what conflicted or
      failed.
- [ ] A merge into a pull request that is itself still open below it is reported as blocked until
      the one below merges, and then resolves without help.
- [ ] A blocked stack does not repeat the same attempt until the base, the stack or a pull request
      changes.
- [ ] The merged items no longer count as awaiting merge, and the remaining items are updated to
      their new commits.
- [ ] New commits on the base with nothing merged do not cause any rewrite.
- [ ] If GitHub cannot be asked, the stack is left alone and no task starts, with the existing
      message about how to fix access.
- [ ] A restack that was interrupted before being recorded is simply done again.
- [ ] `delivery status` shows any blocked reason against the stack, and the report's `blocked`
      carries it.

### UAT

**What you can now do:** Merge slice 1 on GitHub and keep going without touching the rest.

**How to try it:**
1. Start with the three-pull-request stack from the previous slice.
2. Merge the bottom pull request on GitHub using squash.
3. Run `delivery run --sources`.
4. Look at the remaining pull requests on GitHub, then run `delivery status`.

**What you should see:** The second pull request now targets the base and shows only its own
changes; the third still targets the second. A fourth item, if one was available, has opened a
pull request on top. The status lists three levels and no block.

**Why this matters:** Ready work is merged as soon as it is ready, and the work still waiting is
never stranded or made to conflict.

---

## Slice 5: Close a Pull Request to Say No, and the Item Is Done Again

**Delivers:** Closing a stacked pull request without merging it makes the harness drop that level
and everything built on it, and deliver the item again.

### Prerequisites

- A stack can be published, and merged levels are recognised and the rest moved onto the base.
- Items can belong to an ordered sequence, so the closed item is taken again before those after it.

### Acceptance Criteria

- [ ] Closing a level's pull request without merging causes that level and every level above it to
      be dropped on the next run.
- [ ] Each pull request above the closed one is closed with a comment saying it was built on the
      closed one and that its item will be delivered again.
- [ ] The branches of dropped levels are removed locally and on the remote, and the delivery branch
      continues from the highest remaining level, or the base when the bottom was closed.
- [ ] The closed item counts as a rejected attempt, so an item that keeps being closed is parked
      under the existing rule rather than looping.
- [ ] Items above the closed one are released without an attempt and are all deliverable again.
- [ ] When the items are in a sequence, the closed item is delivered again first, on the level
      below it, and the items above it wait.
- [ ] A close combined with a merged level below it drops first, then moves what remains.

### UAT

**What you can now do:** Reject a slice by closing its pull request and watch it redone.

**How to try it:**
1. Start with a stack of four pull requests.
2. Close the second pull request on GitHub without merging it.
3. Run `delivery run --sources`.
4. Look at the pull requests on GitHub, then run `delivery status`.

**What you should see:** The third and fourth pull requests are closed with a comment explaining
why. The first is untouched. The status shows one level, with the second item delivered again
on top of it in a new pull request, and the later items waiting for it.

**Why this matters:** The operator's "no" is respected cleanly, and the work above it is never left
resting on something that was rejected.

---

## Slice 6: Fix a Pull Request in Place and the Stack Keeps Up

**Delivers:** The operator pushes a fix to a stacked pull request's branch and the next run adopts
it and moves the levels above onto it, rather than overwriting it.

### Prerequisites

- A stack can be published and the levels above a changed level can be moved and re-checked.

### Acceptance Criteria

- [ ] When a level's branch has gained commits on top of what the harness recorded, the next run
      adopts them as that level's new content.
- [ ] The adopted content is checked against the level below as a landing is; if it passes, the
      levels above are moved onto it and each is re-checked.
- [ ] If the adopted content fails its check, the stack is blocked, naming the level and its pull
      request.
- [ ] If a level's branch has been rewritten so it no longer contains what the harness recorded, the
      stack is blocked, naming the pull request, and nothing is overwritten.
- [ ] Publishing never overwrites a commit the operator pushed meanwhile: if the branch moved during
      publishing, the close reports an error and the next run adopts or blocks.
- [ ] The operator's pushed commits survive every later publish.
- [ ] An adopted level below a merged one, and a dropped level above a merged prefix, both resolve in
      the fixed order of drop, adopt, move, then merged prefix.

### UAT

**What you can now do:** Answer review comments by pushing a fix, and the rest of the stack follows.

**How to try it:**
1. Start with a stack of three pull requests.
2. On GitHub's branch for the second, add a small fix commit.
3. Run `delivery run --sources`.
4. Open the second and third pull requests on GitHub.

**What you should see:** The second pull request still shows your fix. The third now builds on it
and shows only its own changes. The status shows three levels and no block.

**Why this matters:** Review feedback is handled the way developers already work, and the harness
never throws away the operator's changes.

---
