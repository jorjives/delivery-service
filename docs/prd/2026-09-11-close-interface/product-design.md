# Product Design: Close Interface

Grounding: `docs/prd/2026-09-11-close-interface/research.md`,
`docs/single-surface-control-flow.md` §Close interface, `docs/provisioning.md`,
`docs/superpowers/specs/2026-09-04-gate-interface-design.md` (resolution
precedent), `docs/prd/2026-09-11-close-interface/review-log.md` (phase
selection and MUST/SHOULD/COULD shape), `docs/personas.md` (personas, reused
unchanged from the triage phase), `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`
Item 6. Every factual claim below is either restated from the mechanism spec
or cited to a `research.md` finding; nothing here re-derives git/gh mechanics
or invents new claims about the codebase.

## Personas

Full derivation in `docs/personas.md` (team-derived, assumed, not
human-confirmed; unchanged by this phase, per `research.md` §1 — none of the
three is closer-specific but all three's bars apply directly). Summary,
referenced throughout below by name:

1. **Priya Shah — Harness Extender.** Writes a closer for her project (or
   adopts a built-in one) the same way she already writes a gate or a
   `role_cfg`: from a contract and a reference implementation, without
   reading `src/surface.ts`.
2. **Marcus Webb — On-call Engineer (technical triage reader).** Reads a
   close-failure `EscalationPacket` cold and decides whether to retry the
   close or take it over himself — without reading a git log or a session
   transcript first.
3. **Dana Okafor — Non-technical Project Owner.** Selects "when work is
   accepted, open a pull request" (or merge, or commit-to-branch) by naming a
   built-in closer in configuration, and later sees, in plain terms, whether
   a run's work landed, is stuck, or needs her.

## Vision

Today (`research.md` §2.1–2.2) the harness has the full *shape* of a close
action and none of its substance. `CloserPort`, `CloseContext`,
`CloseOutcome`, and `CloseReport` are typed and wired into all three call
sites the mechanism spec requires (`CLOSING`'s accept path, the fire-and-log
teardown on `ESCALATED`/`ABORTED`, and the crash-resume branch that never
re-invokes an already-completed close) — but the only implementation is
`noopCloser`, which reports `DONE` and does nothing. Two things are true and
load-bearing for what this phase adds:

- **The plumbing is done; the closers are not.** Every success criterion
  about *when* the closer runs, *that* its failure routes to close-triage,
  and *that* a resumed surface never double-closes is already satisfied by
  `src/surface.ts` (`research.md` §2.2). This phase's job is to give the
  seam real closers to resolve to, not to rebuild the seam.
- **There is a precedent for exactly this shape.** The gate interface
  already solved "a discriminated-union ref, a pure resolver, built-in
  variants, and a `custom` escape hatch that guards a third-party module's
  failures into the port's own report shape" (`research.md` §2.3). Close
  resolution is the same problem with a different subject.

For **Priya**, this phase delivers a `CloserRef` she can add a variant to
(or a `custom` entry pointing at her own module) the same way she already
extends `GateRef`, plus a "writing a closer" guide with the reference
merge-back closer as the worked example (roadmap DX note, review-log MUST).

For **Marcus**, this phase delivers a close-failure `EscalationPacket` with
the same five elements Item 5 already built for every escalation path
(decision, verbatim evidence, dead ends, why now, session references) — this
phase's job is to make sure a closer's `CloseReport.detail` is worth reading
when it lands in that packet's evidence field, not to redesign the packet.

For **Dana**, this phase delivers the first half of "select by configuration
alone": a `CloserRef` she (or whoever set up her project) can point at a
named built-in closer and its parameters, with no closer code written. The
guided, natural-language authoring surface for that configuration is Item
9's; this phase's obligation is that the underlying artefact she'd be
pointed at is a name and a few parameters, not an implementation.

## Derived minimum scope (assumed, not human-confirmed)

Recorded in `docs/prd/2026-09-11-close-interface/review-log.md` by the
team-lead before this team was spawned; restated here because the critic
must scrutinise it directly against the personas above, and because it is
the floor this document's MVP tier builds on, not a ceiling.

> MUST: a closer registration/resolution seam mirroring gate resolution;
> built-in merge-back and commit-to-branch closers selectable by
> configuration alone; idempotence under replay (crash between accept and
> close); close failure routed to close-triage with `retry_close` actually
> re-running the closer (with the `CloseRepairBrief` available to it);
> non-accept terminals invoke the closer as fire-and-log teardown; a
> "writing a closer" guide with the reference closer as example.
> SHOULD: open-PR closer (buy: `gh` CLI, not a hand-rolled API client).
> COULD: to be decided.

Checked against the personas: this floor gets Priya a real seam to extend
and a worked example to copy; it gets Dana two working built-in strategies
(merge-back, commit-to-branch) she can select without writing code; it does
**not**, on its own, get Dana the open-PR option most non-technical project
owners will actually want ("when work is accepted, open a pull request" is
the roadmap's own example phrase) — that is SHOULD-tier, correctly, because
it depends on an external CLI (`gh`) whose absence or auth failure is a
project-setup concern outside this item's control, whereas merge-back and
commit-to-branch depend only on git, which the harness already requires for
provisioning (`research.md` §2.4). The floor is honest about that gap rather
than silently degrading Dana's experience: see Non-goals and the escalation
packet section below for what a project owner sees if she selects a closer
whose dependency isn't present.

One place this document extends past a literal reading of the floor: the
review-log's MUST wording does not mention teardown *content* — only that
non-accept terminals "invoke the closer for teardown as fire-and-log,"
which the mechanism already does (`research.md` §2.2, call site 2). But
`research.md` §2.4 is explicit that no teardown code exists at all today —
the call happens, into a no-op. Fire-and-log teardown that does nothing is
not a capability, it is an unimplemented stub with a working error path.
This document treats "the built-in closers implement real teardown
(`git worktree remove`) on escalated/aborted outcomes" as part of the MUST
tier, because without it the roadmap's own success criterion has no
observable effect — a worktree left behind on every escalation is exactly
the "orphan" problem `docs/provisioning.md` names as a *known, deferred*
concern (Item 10's sweep), and this phase should not add to that pile when
the closer is already being invoked at the right moment to prevent it.

## Primary journeys

### Journey A — Priya writes a closer for her project

*Persona: Priya Shah. Goal: give the harness a real close action for her
project without reading `src/surface.ts`.*

1. Priya reads the "writing a closer" guide's contract section: `close(ctx,
   outcome) -> CloseReport`, what `ctx` and `outcome` contain, and what
   `DONE`/`FAIL`/`ERROR` mean for routing (`research.md` §2.1, §2.6).
2. She either selects a built-in closer by adding a `CloserRef` entry (no
   code — see Journey B) or, if her project needs something the built-ins
   don't cover (a Slack notification, a deploy trigger, a non-GitHub host),
   writes a module exporting an object that satisfies `CloserPort`, the same
   shape `custom-gate.ts`'s loader already validates for gates
   (`research.md` §2.3).
3. She points a `CloserRef` at it (`type: "custom", modulePath: "..."`),
   mirroring `GateRef`'s own `custom` variant exactly.
4. If her closer throws, hangs, or returns something that doesn't parse as a
   `CloseReport`, the harness treats that the same way `custom-gate.ts`
   treats a broken gate module: an `ERROR` report, never an uncaught
   exception reaching the surface driver.
5. When a close fails on her project, she reads the close-triage
   `EscalationPacket` (Journey B's flow) to see why — she does not need to
   add her own logging to find out.

**End-to-end means**: Priya can go from "no closer" to "a working, safely
guarded closer resolved by configuration" using only the guide and the
reference merge-back closer as a worked example, the same bar Item 2's gate
guide and Item 4/5's role-config guides already set for their own
extension points.

### Journey B — Dana selects a built-in closer by configuration

*Persona: Dana Okafor. Goal: say what happens when work is accepted, without
writing a closer.*

1. Dana (or whoever set up her project) names a built-in closer and its
   parameters in the project's `CloserRef` — `{ type: "merge-back", base:
   "main" }`, `{ type: "commit-to-branch" }`, or (SHOULD) `{ type:
   "open-pr", base: "main" }` — the same shape as choosing a built-in gate
   by name and parameters (`research.md` §2.3, gate design precedent).
2. She never implements `close()`, never touches `src/*.ts`, and never
   reasons about worktrees, fast-forwards, or fire-and-log — those are the
   closer's business, matching the mechanism spec's own framing ("the
   harness never inspects the strategy," `single-surface-control-flow.md`
   §Close interface).
3. When a run's work is accepted, she eventually sees (via whatever surfaces
   the case file today — full reporting is Item 11's) that the surface
   reached `CLOSED` and what happened: merged into `main`, or a PR opened at
   a URL, or committed to a named branch. The `detail` string a closer
   reports is written in plain, factual prose (never a raw git/gh error
   dump), matching the same "no stack trace" bar Item 3's DX principle
   already sets for state-machine errors, extended here to close outcomes.

**End-to-end means**: a project owner can get accepted work merged, opened
as a PR, or committed to a branch by writing configuration, not code — the
roadmap's own stated measure of this item's value ("this is the step that
makes a harness run produce something usable," review-log rationale).

### Journey C — Marcus triages a close failure

*Persona: Marcus Webb. Goal: decide whether to retry the close or take it
over himself, from the case file alone.*

1. A closer reports `FAIL` or `ERROR`; the surface routes to `TRIAGE` with
   trigger `close_failure` (already built, `research.md` §2.6). Triage's
   only legal verdicts are `retry_close` or `escalate` (Item 5, unaffected
   by this phase).
2. If triage escalates, Marcus reads the same five-element
   `EscalationPacket` Item 5 already built for every escalation path: the
   decision ("the closer could not merge — decide whether to resolve the
   conflict yourself or re-target the merge"), verbatim evidence (the
   closer's own `detail` string — e.g. `git merge --ff-only` failure output,
   or a `gh` auth error), dead ends (prior close attempts, if any, from
   earlier `retry_close` rounds), why now (the close budget's state), and
   session references.
3. Because both `FAIL` and `ERROR` route identically to `close_failure`
   (`research.md` §2.6, §7.1), Marcus cannot tell from the *routing* alone
   whether the closer ran and hit a content problem (a real merge conflict)
   or couldn't run at all (git missing, `gh` not authenticated) — he can
   only tell from the `detail` string's own content. This document's
   position (see "FAIL vs ERROR" below) is that the packet's evidence field
   is where this distinction must live, in prose, because the mechanism
   spec already establishes that close failure is infra-class regardless of
   which of the two it is (`single-surface-control-flow.md` §Close
   interface: "the work is already accepted and correct, so rerouting to a
   fresh worker is meaningless").

**End-to-end means**: Marcus can state what a close attempt actually hit and
what a human should do about it, from the packet's `evidence` field alone —
the same bar Item 5 set for gate-triggered escalations, now proven for the
close path specifically.

## Key flows

### 1. Merge-back (accept path, MUST)

**Trigger**: `CLOSING`, `outcome.kind: "accepted"`.

> **Superseded during delivery.** Step 1 below probes ancestry before the
> worker's changes are committed, which on a first close reports "already
> merged" and sends the closer to cleanup with the accepted work still
> uncommitted. The commit comes first. Corrected in
> `docs/superpowers/specs/2026-09-11-close-interface-design.md`; the rest of
> this flow (ff-only merge, `-d` branch delete, `FAIL` on divergence) stands.

1. Check whether the surface branch is already an ancestor of the base
   branch (`git merge-base --is-ancestor`, `research.md` §3.1, §3.4). If so,
   a prior attempt already merged (e.g. a crash between merge and cleanup on
   a previous close invocation) — skip straight to cleanup and report
   `DONE`. This is the closer's own idempotency, distinct from and
   underneath the surface's replay guarantee (`research.md` §3.4's "the
   `CloseOutcome`/`CloseReport` contract has no resume token" point: a
   closer must derive "already done" from git state itself, the same way
   `provisionWorktree` derives "was there wreckage" from git state).
2. Otherwise, attempt `git merge --ff-only <surface-branch>` against the
   base. A clean fast-forward touches nothing but the ref and never risks a
   half-applied merge (`research.md` §3.1, §3.2) — the safest possible
   default for an unattended closer. A failed fast-forward (history
   diverged) is reported as `FAIL`: the merge did not happen, nothing was
   touched, and the situation needs a human or a `retry_close` after the
   base moves back into a fast-forwardable state.
3. On success (fresh merge or already-merged), remove the worktree
   (`git worktree remove`) and delete the surface branch with the safety
   check (`git branch -d`, not `-D` — `research.md` §3.3's point that `-d`
   is a free, built-in "is this actually merged" guard, the opposite of
   provisioning's own deliberate `-D` for wreckage-clearing). Report `DONE`
   with a plain-prose detail naming the base branch and the merge commit
   (or "already merged").

**Non-goal inside this flow**: automatic conflict resolution. A diverged
history is a `FAIL`, not an attempted three-way merge — `git merge --ff-only`
never leaves a conflicted working tree, so the worktree stays clean and safe
to hand back to a subsequent `retry_close` or a human, matching
`research.md` §3.2's point that a real three-way conflict is unsafe to leave
unattended.

### 2. Commit-to-branch (accept path, MUST)

**Trigger**: `CLOSING`, `outcome.kind: "accepted"`.

The simplest built-in: the work is already committed on the surface branch
by construction (the worker committed to it during `AGENT_ACTIVE`). This
closer's job is only to decide what "done" means without merging: leave the
branch in place (optionally pushing it to a configured remote, if the
project wants the branch visible outside the local worktree — a parameter
on the `CloserRef`, not a second closer type), remove the worktree, and
report `DONE` naming the branch. This is the closer a project owner reaches
for when they want the harness to produce reviewable branches without
merge authority — the lowest-trust, lowest-risk built-in, and (per
`research.md` §6) needs no more mechanism than the `git` calls provisioning
already makes.

### 3. Open-PR (accept path, SHOULD)

**Trigger**: `CLOSING`, `outcome.kind: "accepted"`.

1. Check for an existing open PR for the surface branch first
   (`gh pr list --head <branch> --state open --json url`, `research.md`
   §4.2) — if one exists, this is a repeat close attempt; report `DONE`
   referencing the existing PR URL rather than attempting to create a
   second one.
2. Otherwise, `gh pr create --base <base> --head <branch> ...`
   (`research.md` §4.1). On success, report `DONE` with the PR URL as
   `detail` — the single most useful thing a project owner or a reviewer
   can be shown.
3. `gh` not installed, not authenticated, or lacking scope is its own
   distinguishable failure (`research.md` §4.3): reported as `ERROR`
   (infra-class — no retry of the same kind will fix a missing binary or an
   expired token), with `detail` naming the specific problem (e.g. "`gh` is
   not authenticated — run `gh auth login`") rather than a generic failure
   string. A PR creation rejected for a content reason (e.g. branch protection
   blocking the base) is `FAIL`.
4. This closer does not remove the worktree on success — a PR under review
   may still receive follow-up commits, matching how GitHub's own Copilot
   coding agent and OpenHands' "PR finishing" mode keep working on the same
   branch after opening a PR (`research.md` §5). The worktree is removed
   only when the surface later reaches a true terminal (the PR merging
   externally is outside this harness's own state machine, matching the
   `docs/provisioning.md` framing that orphan collection across such
   externally-resolved surfaces is Item 10's sweep, not this item's).

**Why SHOULD, not MUST**: this is the closer most project owners will
actually want (the roadmap's own example phrase), but it is the only
built-in with an external dependency (`gh`) outside the harness's own
requirements, and its own failure mode (auth) is a project-setup problem
this item cannot fully solve. Shipping merge-back and commit-to-branch as
MUST gives every project a working closer with zero new dependencies;
open-PR is the highest-value addition once `gh` is available, not a
blocker to Dana's first working run.

### 4. Fire-and-log teardown (non-accept terminals, MUST)

**Trigger**: `ESCALATED` or `ABORTED` (`terminate`, already wired,
`research.md` §2.2 call site 2).

Every built-in closer, on `outcome.kind: "escalated"` or `"aborted"`,
performs the same teardown regardless of which accept-path strategy it
implements: `git worktree remove` only. **The branch is deliberately kept**,
never deleted — an escalated or aborted surface's branch is exactly what
Marcus (Journey C) or a human taking over an escalation needs to inspect or
continue from; deleting it would destroy the one artefact a human handoff
depends on. This is the concrete content this phase adds to the mechanism's
already-wired fire-and-log call: a teardown failure here is caught and
logged (`console.warn`, already the behaviour at this call site,
`research.md` §2.2), never re-triaged, because the surface is already
terminal and human-owned.

### 5. Retry with a repair brief (`retry_close`)

**Trigger**: triage verdict `retry_close` (`TRIAGE → CLOSING`, already
built, `research.md` §2.6).

`CloseRepairBrief` is written to the triage ref today but nothing reads it
back (`research.md` §2.6, §7.2 — an explicit open decision the triage design
left for this item). This document's position: `closing()` reads the
verdict's ref when the transition into `CLOSING` came from a `retry_close`
verdict, and passes its contents into `CloseContext` as an optional field. A
built-in closer is not obliged to act on it — merge-back's own idempotency
check (flow 1, step 1) already covers the dominant "already succeeded, crash
before cleanup" case without needing any prose guidance — but a `custom`
closer author may read it (e.g. a closer that shells out to an agent to
resolve a conflict the merge-back closer would only report as `FAIL`, though
building such a closer is explicitly out of this item's scope). Threading
the ref costs one read at a point the harness already has the ref key
available (the same pattern Item 5 used to thread `SharpenedBrief` into a
worker dispatch); leaving it unread would mean the schema field Item 5 added
stays permanently decorative, which is the same "unused wiring" smell this
document's Vision section already flags on the read side (Priya's guide) —
see Derived minimum scope's SHOULD tier below for why this is not MUST.

### 6. Crash between accept and close (idempotent replay)

**Trigger**: crash after `GATING` accepts, before or during `CLOSING`.

Already fully specified by the mechanism and already built
(`research.md` §2.2 call site 3, §2.6): resume derives `CLOSING` from the
log tail and re-invokes the closer exactly once from the point of the last
durable append; a tail that already shows a `DONE` close entry derives
`CLOSED` directly and never re-invokes. What this phase adds is that the
*closer itself* must not assume it is starting clean — flow 1's ancestor
check and flow 3's existing-PR check are precisely how a real closer honours
this guarantee rather than merely benefiting from the surface's own replay
protection (`research.md` §3.4's distinction between the two idempotency
layers).

## FAIL vs ERROR: one signal, prose does the rest

`research.md` §7.1 names an open thread: `FAIL` and `ERROR` route
identically to `close_failure`/`TRIAGE`, unlike the gate, which splits
`FAIL` (content, `correction` budget) from `ERROR` (infra,
`gate_error`/`recheck_gate`). This document's position: **no routing split
is needed**, and this is not a gap relative to the gate's design — it is a
correct difference, because the two subjects are different. The gate's
split exists because a content-class `FAIL` means "the worker's change is
wrong" (reroute to a fresh worker makes sense) while an infra-class `ERROR`
means "the gate itself is broken" (needs gate-maintenance, not the worker).
Close has no analogous "reroute to a fresh worker" option at all —
`single-surface-control-flow.md` §Close interface is explicit that "the
work is already accepted and correct, so rerouting to a fresh worker is
meaningless," for *either* a content problem (a merge conflict) or an infra
problem (`gh` not authenticated). Both are "a human or a retry needs to
sort out the close mechanics," which is exactly `retry_close`/`escalate` —
the same two verdicts regardless of which of `FAIL`/`ERROR` produced them.

The distinction still matters, just not for routing: it belongs in
`CloseReport.detail`'s prose, which becomes the `EscalationPacket`'s
evidence field (Journey C). A closer author should still choose `FAIL` for
"the git/gh operation ran and was refused for a reason a human can act on"
(diverged history, branch protection) and `ERROR` for "the closer could not
even attempt it" (missing binary, expired auth) — this is documented in the
"writing a closer" guide as a message-quality convention, not enforced as a
contract change, because the mechanism spec gives the harness no behavioural
reason to distinguish them once both land at the same narrow router.

## Empty / error states

- **A built-in closer's required external dependency is missing** (`gh` not
  on `PATH`, not authenticated): reported as `ERROR` on the first close
  attempt, with `detail` naming the specific missing precondition
  (`research.md` §4.3) — never a raw CLI error dump. This surfaces through
  the same close-triage path as any other close failure; there is no
  separate "pre-flight check" surface in this item (that belongs to Item
  9's project validation, per its own success criterion "a validation
  command checks the configuration for completeness... before a run
  starts").
- **Already merged / already has an open PR** (flows 1 and 3's idempotency
  checks): not an error at all — reported as `DONE`, with `detail` stating
  plainly that the prior attempt's result was found and nothing further was
  needed. This is the intended common case on a `retry_close` after a crash,
  not a degraded one.
- **Diverged history (merge-back cannot fast-forward)**: `FAIL`, with
  `detail` naming the base branch's current tip so a human can see exactly
  why (someone else merged something in the meantime, most commonly).
- **Custom closer throws, hangs indefinitely, or returns a value that
  doesn't parse as a `CloseReport`**: guarded into `ERROR`, mirroring
  `custom-gate.ts`'s `guard()` exactly (`research.md` §2.3) — a broken
  third-party closer can never crash the surface driver.
- **Teardown failure on an already-terminal surface** (flow 4): logged, not
  re-triaged — the surface is already `ESCALATED`/`ABORTED` and human-owned;
  a second failure mode on top of that is visibility, not a new decision
  point (mirrors the existing `console.warn` behaviour at this call site).
- **`CloseRepairBrief` absent** (a close failure that never went through
  triage's agent path, or a first attempt): `CloseContext`'s optional field
  is simply absent; built-in closers do not require it (flow 5).

## Non-goals

- **A declarative/config-file authoring surface for `CloserRef`** (Item 9) —
  Priya and whoever configures Dana's project write it as code/config data,
  matching Item 2/4/5's identical non-goal for their own reference configs.
  This item's obligation is that the artefact *is* a name-plus-parameters
  data structure a non-code surface could eventually populate, not that
  such a surface exists yet.
- **CLI** (Item 8) — no command-line surface for registering a closer or
  inspecting a close outcome; the case file JSON is the only interface this
  item ships.
- **Multi-surface merge serialisation** (Item 10) — this item's merge-back
  closer assumes it is the only writer of the base ref at the moment it
  runs; concurrent surfaces racing to merge is explicitly Item 10's
  "ref-mutating git operations are serialised under a single repo lock"
  concern.
- **Orphan worktree/branch sweeping** (Item 10) — this item's closers clean
  up after their own surface; a supervisor-level sweep for worktrees left by
  crashes this item's idempotency doesn't cover is out of scope
  (`docs/provisioning.md`'s own deferral, `research.md` §2.4).
- **Reporting surface** (Item 11) — Dana's plain-language "did my work land"
  view, dashboards, and any cross-run summary are Item 11's; this item only
  ensures a closer's `detail` string is legible prose an eventual reporting
  surface can format.
- **Non-GitHub PR hosts** (GitLab, Bitbucket, self-hosted Forgejo) — the
  open-PR closer is GitHub-only via `gh`; `research.md` §4.4 notes the same
  CLI-wrapping shape could extend to `glab` etc., but that is a future
  closer, not this item's.
- **Automatic conflict resolution** — a diverged merge-back is a `FAIL`, not
  an attempted three-way merge or an agent-assisted resolution; the
  worktree is left clean and untouched, matching `research.md` §3.2's
  point about the risk of leaving a conflicted tree for automation to find.
- **An agent-backed closer** — every built-in closer is deterministic code
  (git/gh CLI calls), like the gate; nothing about this item requires or
  ships an LLM-invoking closer, though the `custom` escape hatch does not
  preclude an extender building one.

## MVP capability set

### MUST

1. **`CloserRef` as a discriminated union on `type`**, mirroring `GateRef`
   exactly (`research.md` §2.3): built-in variants (`merge-back`,
   `commit-to-branch`) carry only a name and parameters; a `custom` variant
   carries a `modulePath` and optional `exportName`, resolved the same way
   `resolveGate`/`createCustomGate` resolve gates (Journey A, B).
2. **A pure `resolveCloser` function** that never throws: resolution
   failure (bad ref, missing custom module, missing required method) is
   reported through the same `CloseReport` shape a run-time failure would
   produce, matching `resolveGate`'s "resolution failure and run failure
   reach the caller in the same shape" principle (`research.md` §2.3).
3. **The `merge-back` closer** (flow 1): idempotent ancestor check,
   ff-only merge, safety-checked branch delete, worktree removal.
4. **The `commit-to-branch` closer** (flow 2): the lowest-risk built-in,
   leaves the branch, removes the worktree.
5. **Fire-and-log teardown implemented for real** on `ESCALATED`/`ABORTED`
   (flow 4): `git worktree remove`, branch kept — not a no-op, per the
   Derived minimum scope section's extension of the literal roadmap
   wording.
6. **Custom closer guarding**: a third-party closer module's thrown
   exception or schema-invalid return value becomes an `ERROR` report,
   never an uncaught exception, mirroring `custom-gate.ts`'s `guard()`.
7. **Closer-level idempotency for the two built-ins**, so a crash between
   accept and close re-runs safely (flows 1, 2, 6) — the roadmap's own
   idempotence success criterion, made concrete per closer rather than left
   to the surface driver's replay guarantee alone.
8. **A "writing a closer" guide** with the reference `merge-back` closer as
   the worked example: the contract, what `ctx`/`outcome` carry, the
   `DONE`/`FAIL`/`ERROR` convention (including the message-quality note
   above), and the idempotency obligation on the closer author
   (`research.md` §3.4's point that the contract has no resume token).

### SHOULD

- **The `open-PR` closer** (flow 3): existing-PR check via `gh pr list`,
  `gh pr create`, auth/scope failures reported as `ERROR` with a specific
  cause, content rejections as `FAIL`.
- **`CloseRepairBrief` threaded into `CloseContext`** on a `retry_close`-
  triggered close (flow 5) — cheap, mirrors Item 5's brief-threading
  pattern, but no built-in closer requires it to satisfy its own
  idempotency, so it does not block either persona's primary journey if
  deferred.
- **A runnable demo** against the reference `merge-back` closer, matching
  the established Item 2/4/5 pattern of a working example alongside the
  guide.

### COULD

- **A remote-push parameter on `commit-to-branch`** (flow 2) — pushing the
  surface branch to a configured remote so it is visible outside the local
  worktree without opening a PR. Not required for any persona's primary
  journey (the branch already exists locally, and Priya/Dana's stated goals
  are satisfied by local branch existence); a natural follow-on once a
  project actually asks for it.
- **A `glab`-based open-PR variant** for GitLab, following the same CLI-
  wrapping shape `research.md` §4.4 names as available but not built.

## Success metrics

- **Priya (harness extender)**: can go from "no closer" to "a working,
  resolved closer" using only the guide and the reference `merge-back`
  closer — zero reads of `src/surface.ts` or `src/provision.ts` during that
  path. Verifiable the same way Item 2's gate resolution and Item 4/5's
  role-config metrics were verified: a cold-start walkthrough test, not
  self-report.
- **Dana (project owner)**: a project configured with `{ type:
  "merge-back" }` or `{ type: "commit-to-branch" }` produces, on an accepted
  surface, a `CLOSED` outcome whose `detail` names what happened in plain
  prose (branch merged into `<base>`, or work committed to `<branch>`) — no
  git plumbing terms required to understand the result.
- **Marcus (on-call reader)**: given a case file at `ESCALATED` from a
  `close_failure`, can state (a) the decision being asked of him, (b) the
  evidence (the closer's own `detail`), and (c) what already failed —
  using only the `EscalationPacket`, no source access, no transcript pull
  required for the common case. Proven by a test per close-failure path
  (diverged history, missing `gh` auth, custom closer exception).
- **Idempotency is provably safe, not just claimed.** An automated test
  simulates a crash between a closer reporting `DONE` and the terminal
  outcome write, then a second invocation of the same closer against the
  same (now-merged) state, and asserts it reports `DONE` without attempting
  a second merge or erroring on an already-removed worktree.
- **Non-accept teardown actually tears down.** An automated test proves an
  `ESCALATED` or `ABORTED` surface's worktree is removed and its branch is
  preserved — the roadmap's fire-and-log criterion made concrete, not left
  as "the call happens" (which is already true today against the no-op).
- **Close failure never reroutes to the worker.** Regression-tested already
  by Item 5 for the trigger-legality mechanism; this item adds a test that
  a real closer's `FAIL` and `ERROR` both land at `close_failure`, not two
  different triggers, confirming the "one signal, prose does the rest"
  design decision above is what actually ships.

## Buy-vs-build

- **Git execution mechanism**: reuse the estate's own precedent — raw
  `node:child_process`/`execFile`, promisified, with `cleanGitEnv()`
  applied to every spawned call, exactly as `provision.ts` and
  `command-gate.ts` already do (`research.md` §6). Considered and rejected:
  `execa` (a spawning convenience wrapper with no git-specific benefit over
  the existing hand-rolled `git()` helper, and adopting it now would mean
  either leaving the two existing call sites unmigrated or touching tested
  code outside this item's scope for no benefit tied to this item's own
  success criteria); `simple-git` (still shells out, still needs
  `cleanGitEnv()`, would be the first new runtime dependency where a
  handful of `execFile` calls already does the job — recommended by general
  guidance for exactly this harness's situation, but the repo's own
  precedent already covers it); `isomorphic-git` (a pure-JS reimplementation
  built for browser/sandboxed contexts with no system git binary — the
  opposite of this harness's assumption that a system `git` is already a
  hard requirement for provisioning). This is a product-level note, not the
  ledger: the concrete decision and its file-level shape is the architect's,
  coordinated so both sides agree (`research.md` §6 is the shared factual
  basis).
- **PR creation: `gh` CLI, not Octokit.** `gh` reuses the operator's own
  authenticated session, needs no credential the harness itself must store
  or manage, and matches the repo's existing "shell out to a CLI" shape for
  git itself; Octokit is an in-process HTTP client needing its own token
  plumbing and is GitHub-only in the same way `gh` is, without `gh`'s
  operator-auth convenience (`research.md` §4.4). No case in this item's
  scope favours a library client over the CLI already installed on any
  machine capable of `gh auth login`.
- **Resolution shape: reuse the gate interface's precedent exactly**
  (discriminated-union ref, pure resolver, `custom` escape hatch with a
  guarding wrapper) rather than inventing a differently-shaped closer
  registration mechanism. `research.md` §2.3 confirms this is the closest
  and only relevant in-repo precedent; conforming to it is the established
  internal pattern this item should extend, not reinvent.
- **Schema and validation: zod**, as every other typed contract in the
  codebase (`GateRef`, `TriageEnvelope`, `SharpenedBrief`) already uses —
  no new schema library for `CloserRef` or `CloseReport`.

## Operability / DX

- **Local-run story**: `merge-back` and `commit-to-branch` are testable
  end-to-end against a real local git repository (no mock needed — they are
  deterministic code, not agents, matching how the gate interface is tested
  in isolation per `research.md` §2.3's precedent). `open-pr` needs `gh` on
  `PATH` and an authenticated session to test against a real GitHub repo;
  its own tests should be skippable in an environment without that
  precondition, the same shape mock-gated integration tests already use
  elsewhere in this codebase for an optional external dependency.
- **Test structure**: unit tests per closer against a scratch git repo (a
  temp directory git-inited, a divergent branch created, an already-merged
  state simulated) mirroring how `provision.ts`'s own tests presumably
  exercise real git state rather than mocking it; a guarding-wrapper test
  for the `custom` variant mirroring `custom-gate.test.ts` exactly; a
  resolution test mirroring `resolve-gate.test.ts`.
- **Known gap, stated not papered over**: there is no equivalent of
  `claude-mock` for git/`gh` — a closer's tests exercise real subprocess
  calls against a real scratch repository, which is slower than an agent
  mock but is the correct fidelity for code whose entire job is git/CLI
  side effects; there is nothing to usefully fake here the way an LLM call
  is faked.
- **Guide**: a "writing a closer" document, the roadmap's own explicit MUST.
  `research.md` notes the gate interface's own equivalent guide was never
  actually shipped as a standalone document — the closest existing
  precedent is doc-comments on `custom-gate.ts` plus its tests and demos.
  This document's position: Item 6 should not repeat that gap, because the
  roadmap names the guide as this item's own success criterion, not an
  aspiration Item 2 already discharged informally. Whether it lives as a
  new top-level file (matching `docs/configuring-a-role.md`'s standalone
  precedent) or as a chapter appended to an existing doc is coordinated
  with the architect; either satisfies Priya's journey as long as it is
  discoverable without reading source.
- **Deploy target**: none new — this is a library-level extension of the
  same in-process seam the gate and agent interfaces already use
  (`SurfacePorts.closer`), consumed by the state-machine driver. The only
  new *environmental* requirement is `git` (already required) and,
  SHOULD-tier, `gh` (new, but optional — a project not configuring an
  open-PR closer never needs it).

## Architecture decisions this document depends on

- **Where the ancestor/idempotency check lives and its exact git call
  sequence** (flow 1, flow 6) is the architect's implementation choice; this
  document requires only that the *closer* (not the surface driver) is
  responsible for detecting "already done" from git state, per
  `research.md` §3.4's framing of where that responsibility sits.
- **Whether `CloseContext` gains the repair-brief field now (SHOULD) or is
  deferred** is flagged as SHOULD, not MUST, specifically so the architect
  can size it against `merge-back`/`commit-to-branch`'s own cost without
  that decision blocking either built-in closer's delivery.
- **The exact `CloserRef` parameter shape** for `merge-back` (e.g. whether
  `base` is optional and defaults to the provisioning-resolved base ref
  `docs/provisioning.md` already computes, or must always be supplied) is
  left to the architect; this document's position is only that a project
  owner should not have to restate a base branch the harness can already
  derive, if that derivation is cheap to reuse (`research.md` §2.4's
  `resolveBaseRef`).

## Still open (genuinely deferred, not this phase's to default)

- **The exact file/location of the "writing a closer" guide** — a product
  requirement that it exists and is discoverable, not that it lives at a
  specific path (coordinate with architect).
- **Whether a project can configure more than one closer for different
  outcomes** (e.g. merge-back on accept, a distinct notification-only
  closer on escalate) versus one closer handling all three `CloseOutcome`
  kinds itself, as every built-in in this document does — the mechanism
  spec's `close(ctx, outcome)` signature already supports either reading
  without a contract change; this document assumes one closer per project
  handles all outcomes (simplest, matches every built-in above), and treats
  a per-outcome composition as a future extension, not a gap, since nothing
  in the roadmap's success criteria requires it.
