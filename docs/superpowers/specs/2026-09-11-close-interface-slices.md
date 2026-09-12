# Close Interface — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-11-close-interface-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface yet; a CLI (Item 8) and
reporting (Item 11) arrive later. Following the Item 4 and Item 5 precedent, UAT is
written for a harness extender (Priya), an on-call reader (Marcus) and, where the output
is plain prose, a project owner (Dana): each slice ships a runnable demo script against a
real temporary git repository (no network, no live API call) whose printed output a
reviewer reads to confirm the behaviour.

**Decided without a human (unattended run):** the slice boundaries below were chosen by
the autonomous run, not confirmed by a person. Order follows the spec's value: accepted
work landing first (the roadmap's headline value), then tidy terminals and the
branch-only strategy, then close failures a human can act on, then the extender's
custom-closer path with its guide, then the SHOULD-tier pull request closer.

---

## Slice 1: Accepted Work Is Merged Into the Base Branch

**Status:** ✅ Complete — 2026-09-12 — `be223a1`

**Delivers:** When a surface's work is accepted, a project configured with the
merge-back closer gets that work committed and fast-forwarded into the branch the
surface was started from, with the scratch worktree and surface branch cleaned up and a
plain-prose account of what happened.

**Operational note:** the demo and tests need only a system `git`, as provisioning
already does; no network and nothing to skip. The demo must say plainly that the merge
lands on the local base branch and is not pushed anywhere.

**Build note:** git is driven by the codebase's own existing process-spawning helpers,
shared out of provisioning rather than copied, with the existing clean git environment
applied to every call and arguments passed as a list, never through a shell. No git
library and no new dependency. Closer selection mirrors the gate's existing
reference-plus-resolver shape exactly, with no registry, and the reference is validated
with the codebase's existing schema library.

### Prerequisites

- A surface can be provisioned into its own worktree and branch, gated, and accepted
- The surface driver already calls a closer on acceptance and records its report
- Case files can hold set-once header values and survive a crash and resume

### Acceptance Criteria

- [ ] A project names the merge-back closer as data, with no closer code written, and an
      accepted surface ends closed with its work on the base branch
- [ ] The base branch merged into is the one the surface was started from, captured when
      the surface was provisioned, and does not change if the repository's default
      branch changes later
- [ ] Provisioning a surface twice after a crash does not fail on the already-captured
      base branch
- [ ] The worker's uncommitted changes are committed before merging; a surface with no
      changes still closes cleanly
- [ ] After a successful merge the worktree is removed and the surface branch deleted,
      unless the project asked to keep it
- [ ] The closing report says in plain prose which branch was updated and to which
      commit, with no raw git output
- [ ] A crash after the merge but before cleanup, replayed, reports done without merging
      twice
- [ ] A crash after full cleanup but before the close is recorded, replayed, reports
      "already closed" without erroring on the missing worktree
- [ ] An unreadable or unknown closer reference produces an error report, never a crash
- [ ] If the main checkout is not on the base branch, the closer refuses with an error
      naming the problem and does not switch the checkout
- [ ] The closer named for a surface is pinned in its case file header at provisioning
      and resolved from there, so changing the project's configuration afterwards cannot
      redirect an in-flight surface to a different closer
      (added after the slice closed: the spec pins `closerRef` in the header, and no
      slice below asked for it; delivered separately)

### UAT

**What you can now do:** Watch an accepted surface's work land on the main branch by
naming a closer, not writing one.

**How to try it:**
1. Run the included merge-back demo script.
2. The script creates a scratch repository, starts a surface, writes a change into its
   worktree as a stand-in worker, and accepts it with the merge-back closer selected.
3. Read the printed closing report and the repository history that follows it.
4. Read the final part of the output, where the script replays the close as if the
   process had crashed just after merging.

**What you should see:** The report says the main branch was fast-forwarded to a named
commit; the history shows the change on main; the worktree and surface branch are gone.
The replayed close reports that the work was already merged and the history shows no
second merge.

**Why this matters:** This is the first time a harness run produces work a project owner
can use, rather than an accepted change stranded in a scratch directory.

---

## Slice 2: Work Can Be Left on Its Own Branch, and Stopped Surfaces Tidy Up

**Delivers:** A project can choose to have accepted work committed to the surface's own
branch without merging, and every surface that ends escalated or aborted has its scratch
worktree removed while its branch is kept for whoever takes it over.

**Operational note:** as Slice 1, the demo needs only a system `git`. Teardown failures
on a stopped surface are logged, never re-triaged; the demo must show that a second
teardown is harmless.

**Build note:** teardown is one shared routine used by every built-in closer, not a copy
per closer, and reuses the tolerant worktree-removal behaviour provisioning already has.

### Prerequisites

- Projects can select a built-in closer by name, and accepted work can be committed from
  a worktree
- The surface driver already calls the closer, fire-and-log, when a surface ends
  escalated or aborted

### Acceptance Criteria

- [ ] A project names the commit-to-branch closer as data; an accepted surface ends
      closed with its work committed on the surface branch and the base branch untouched
- [ ] The closing report names the branch holding the work, in plain prose
- [ ] The commit-to-branch closer never deletes the surface branch, on any outcome
- [ ] Replaying the commit-to-branch close after its worktree is already gone reports
      "already closed"
- [ ] A surface that ends escalated has its worktree removed and its branch kept, whichever
      built-in closer was selected
- [ ] A surface that ends aborted has its worktree removed and its branch kept, whichever
      built-in closer was selected
- [ ] Tearing down the same stopped surface twice succeeds both times and leaves the
      branch untouched
- [ ] A teardown failure on a stopped surface is logged and does not change its outcome

### UAT

**What you can now do:** Keep accepted work on a reviewable branch, and stop leaking
scratch directories when a surface gives up.

**How to try it:**
1. Run the included branch-and-teardown demo script.
2. The script closes one accepted surface with the commit-to-branch closer, then runs a
   second surface that escalates.
3. Read the printed report for the first surface and the branch listing after it.
4. Read the second surface's outcome and the worktree and branch listings after it.

**What you should see:** The first report names the branch holding the work, and main is
unchanged. After the escalation the second surface's worktree is gone but its branch is
still listed, ready to be inspected.

**Why this matters:** Owners who want to review before anything merges get a branch per
task, and a person picking up an escalation always finds the work where it was left.

---

## Slice 3: A Close That Cannot Complete Is Retried, Then Handed to a Person With the Reason

**Delivers:** When a closer cannot finish, for example because the base branch has moved
on, the harness retries the real close while budget remains and then escalates with a
packet whose evidence says in plain prose what blocked it, never sending the accepted work
back to a worker.

**Operational note:** the demo simulates a diverged base branch inside its own scratch
repository by committing to main before the close; no external state is involved.

### Prerequisites

- Accepted work can be merged back, and a merge that cannot fast-forward is refused
  without touching the repository
- Close-triage already routes a failed close to retry or escalate within the close budget,
  and escalations already carry a five-part packet

### Acceptance Criteria

- [ ] A merge-back close whose base branch has diverged reports a failure naming the base
      branch's current tip, and leaves the repository and worktree untouched
- [ ] A failed close is retried by re-running the real closer while close budget remains,
      and each retry is safe to repeat
- [ ] A close that succeeds on retry, because the base moved back into a mergeable state,
      ends closed normally
- [ ] At the close budget's last slot the surface escalates, and the packet's evidence is
      the closer's own plain-prose report
- [ ] Both kinds of close problem, a refusal and an environment error, reach the same
      close-failure handling; neither ever returns the work to a worker
- [ ] When triage's agent path produces repair guidance for a retry, that guidance is
      available to the closer on the retried close; the built-in closers behave the same
      with or without it

### UAT

**What you can now do:** See exactly why accepted work could not land, and what decision
is being asked of you.

**How to try it:**
1. Run the included close-failure demo script.
2. The script accepts a surface, then moves the main branch on so the work can no longer
   fast-forward.
3. Read the printed retries and the final escalation packet.
4. Read the repository history printed at the end.

**What you should see:** Each retry reports that main has moved on and names its current
commit; the packet asks the reader to resolve the divergence or choose another close, with
the closer's report as evidence. The history shows main unchanged by the harness and the
surface branch still present.

**Why this matters:** An on-call engineer can act on a failed close from the packet alone,
and accepted work is never quietly thrown back into a retry loop it cannot fix.

---

## Slice 4: An Extender Writes Their Own Closer From the Guide

**Delivers:** An extender can write a closer for their project, reference it by module
path, and have any failure in it reported safely, working only from a "writing a closer"
guide whose worked example is the merge-back closer.

**Operational note:** the guide ships as a document beside the existing role
configuration guide, not only as code comments, and must be followable without reading
the surface driver or provisioning code.

**Build note:** loading and guarding a custom closer reuses the custom gate's existing
dynamic-load-and-guard mechanism, shared out into one small common routine that both use,
not a second copy. The existing custom gate tests, run unchanged, prove the gate behaves
exactly as before.

### Prerequisites

- Built-in closers can be selected by name and cover accept, escalate and abort outcomes
- Close failures reach close-triage and can end in an escalation packet

### Acceptance Criteria

- [ ] A project references its own closer module by path, and an accepted surface closes
      using it
- [ ] A custom closer that throws, rejects, or returns a malformed report produces an error
      report naming the cause, never a crash of the surface
- [ ] A module that cannot be loaded, or that lacks a close action, produces an error that
      names the module and what is missing
- [ ] Custom gates behave exactly as they did before the loading mechanism was shared
- [ ] The guide explains what a closer is given, the three outcomes it must handle, when
      to report a refusal versus an environment error, that it must detect "already done"
      itself on replay, and that it must never echo secrets in its report
- [ ] The guide's worked example is the merge-back closer, and following the guide alone
      produces a working custom closer

### UAT

**What you can now do:** Write a closer for your own project from a guide, without reading
harness internals.

**How to try it:**
1. Open the "writing a closer" guide and read its contract and worked example.
2. Run the included custom-closer demo script, which uses a small example closer that
   announces what it would do for each outcome.
3. Read the printed report, then the second part of the output, where the script swaps in
   a deliberately broken closer.

**What you should see:** The example closer's own report appears as the surface's closing
report. The broken closer produces a clear error report naming what went wrong, and the
surface still reaches close-triage rather than crashing.

**Why this matters:** Projects with needs the built-ins do not cover, such as a
notification or a non-GitHub host, can plug in their own close step as safely as they
already plug in a gate.

---

## Slice 5: Accepted Work Opens a Pull Request

**Delivers:** A project can choose to have accepted work pushed and opened as a GitHub
pull request, with the pull request's address as the closing report, a repeat attempt
reusing the existing pull request, and missing or expired GitHub access reported as a
specific, fixable problem.

**Operational note:** only projects that select this closer need the GitHub command-line
tool installed and signed in; the demo and tests use a stand-in executable in its place
so they need no network and no GitHub account, and the demo must say so. The worktree is
left in place after the pull request opens.

**Build note:** use the GitHub command-line tool with the operator's own sign-in, not a
GitHub API client library, and no token is ever stored in the case file or written into a
report. The test stand-in follows the same swap-the-executable approach the codebase
already uses for its agent mock.

### Prerequisites

- Accepted work can be committed from a worktree and the base branch is known to the closer
- Close failures reach close-triage with the closer's report as evidence

### Acceptance Criteria

- [ ] A project names the open-pull-request closer as data; an accepted surface ends
      closed with its branch pushed and a pull request opened against the base branch
- [ ] The closing report is the pull request's address
- [ ] A repeat close for a branch that already has an open pull request reports that pull
      request and does not open a second
- [ ] The GitHub tool missing, not signed in, or lacking permission produces an error report
      naming the specific problem and how to fix it
- [ ] A pull request refused for a content reason, such as branch protection, is reported
      as a refusal
- [ ] Pull request titles and bodies derived from task content cannot be interpreted as
      commands
- [ ] Escalated and aborted surfaces are torn down exactly as with the other built-ins

### UAT

**What you can now do:** Have accepted work arrive as a pull request for review.

**How to try it:**
1. Run the included pull-request demo script.
2. The script accepts a surface with the open-pull-request closer selected, using a
   stand-in for GitHub.
3. Read the printed closing report, then the part where the close is repeated.
4. Read the final part, where the stand-in behaves as if GitHub access has expired.

**What you should see:** The first report is a pull request address; the repeat reports the
same address and says no new pull request was opened; the expired-access case reports that
GitHub sign-in is needed and how to do it.

**Why this matters:** Most project owners want a person to review before anything merges,
and this is the close they will reach for first.
