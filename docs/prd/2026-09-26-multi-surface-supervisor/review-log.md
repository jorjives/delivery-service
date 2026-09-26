# Review log: multi-surface-supervisor

## Selected phase (derived)

**Phase:** Roadmap Item 10, Multi-Surface Supervisor: run the project's task queue
concurrently, N surfaces against one target repository, with a shared queue, a
worktree pool, serialised ref-mutating git operations, breaker-based shared-fate
handling, run-level budgets, and crash recovery from a run file.

**Rationale (team-lead discovery, 2026-09-26):**
- Items 1–9 of `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md` are
  complete; Item 10 is the next item, marked `ready-to-spec`, and has no design spec.
- The project-configuration design (Item 9) ships a *sequential* queue and names
  "Multi-surface concurrency for the queue (Item 10)" as its first non-goal.
- `docs/multi-surface-control-flow.md` is an existing plan (not a finished design)
  with open items (host resource governor, merge serialisation, breaker tuning) that
  this phase must resolve.
- Items 11–14 depend on it (observability spans the full run; task packs fan out
  across surfaces).
- Ideas pool (`.autoloop/ideas/`): two ideas already seeded prior specs; the remaining
  two (git test-wrapper dedupe, claude-mock argv) are test-hygiene issues, not phase
  seeds. This phase is **not seeded by any idea**.

**Intended shape:** MUST = concurrent queue execution with a bounded surface count,
per-surface worktrees, serialised ref mutation/merge, run file + crash resume, run-level
budgets, breaker stop-the-world for shared-environment failure, terminal/`status`
visibility sufficient for a project owner to know what each surface did. SHOULD/COULD
to be set by the product-designer. Non-goals include Item 11's full reporting surface,
task packs, scheduling.

**Derived minimum scope (assumed, not human-confirmed):** the MUST tier above.

## Critic: phase selection verdict (2026-09-26)

**Verdict: APPROVED.** The phase choice is correct and the derived minimum scope is
sound. Checked against the roadmap source (`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`
Item 10, lines 443–470):

- Items 1–9 are confirmed complete (existing specs under `docs/prd/`); Item 10 is the
  next `ready-to-spec` item with no prior spec of its own — verified no
  `multi-surface-supervisor` spec exists elsewhere in `docs/superpowers/specs/` or
  `docs/prd/`. No duplication.
- The roadmap's own success criteria for Item 10 (concurrent surfaces each in a
  worktree, freed-slot provisioning, serialised ref-mutating git ops under a repo
  lock, breaker-based stop-the-world, run-level `gate_maintenance` budget, crash
  resume from run file) match the team-lead's derived MUST tier one-for-one. Not
  scope-starved: nothing in the roadmap's Item 10 success criteria is missing from
  the derived MUST.
  Not gold-plated: the derived MUST introduces nothing beyond what the roadmap
  names for this item.
- Correctly excludes Item 11 (Observability and Reporting — explicitly listed as
  depending on Item 10, "observability spans the full run") and Item 12 (Pre-Built
  Task Packs) from scope. This is not a pivot: it continues directly from Item 9's
  sequential-queue baseline, whose own non-goals section named "multi-surface
  concurrency for the queue (Item 10)" as future work — i.e. Item 9 was written
  anticipating this exact phase.
- `docs/multi-surface-control-flow.md` is rightly treated as an unfinished plan to
  resolve during the spec, not a design to rubber-stamp; the roadmap's own notes
  for Item 10 name the same open items (host resource governor, merge
  serialisation, breaker tuning) that the team-lead flagged.

No blocking findings on phase/scope. Proceeding to review product-design.md and
architecture.md against this scope once drafts arrive.

## Critic: round 1 on product-design.md and architecture.md (2026-09-26)

Verified citations in both drafts against real src/ (queue.ts, provision.ts,
merge-back-closer.ts, case-file.ts) and against docs/personas.md's diff — all
accurate. Buy-vs-build ledger in architecture.md is well-grounded in
research.md §2.1/§2.3/§2.4/§2.5; no further researcher verification needed.

**product-design.md: REVISE.** One gap: the cross-process repo lock (MUST 4)
introduces a new failure mode — two `delivery run` invocations racing the same
repo — that the doc never addresses. MUST 9 claims exit codes are unchanged
and Empty/error states doesn't cover this scenario. Architecture.md §14
independently flagged this as needing the product-designer's decision.
Suggested resolution given: map to existing exit code 2, no new code.
Minor non-blocking note: journey 3's "pausing every task" narration slightly
overstates the mechanism (AGENT_ACTIVE/TRIAGE sessions keep running) —
optional wording tightening.

Five scrutiny questions from product-designer all answered APPROVED:
MUST-tier scope is a genuine floor (incl. MUST 10, Priya's only test route);
terminology decision sound; default concurrency=1 is the right choice per an
explicit right-vs-easy check; non-goals honestly conservative against the
roadmap's own success criteria; persona goal extensions warranted, not creep.

**architecture.md: REVISE, but only for the shared coordination gap above** —
no defect found in the document's own content. Confirmed the architect's
deferral of the runQueue→runSupervisor(poolSize=1) behaviour-preservation
check to the plan phase is correct scoping (verification work, not a design
claim), not "dodging" — told the architect to keep it as written.

Both agents notified via SendMessage with specific, actionable feedback.
Waiting on revised product-design.md; expect architecture.md to need no
content change once the exit-code decision lands.

## Critic: round 2 — both APPROVED (2026-09-26)

product-designer closed the exit-code gap: the cross-process lock refusal
reuses `EXIT.configuration` (2), same shape as the existing `unfinishedRunFound`
refusal, plus a closed-set `BREAKER_PHRASES` table for breaker narration.
Verified the citation against real source: `src/cli/runs.ts:117`
(`unfinishedRunFound`), `src/cli/run-command.ts:51`
(`throw new Refusal(unfinishedRunFound(mostRecent), EXIT.configuration)`),
`src/cli/failures.ts:29` (`configuration: 2`) — exact match, no drift. No new
exit code introduced; MUST 9's "no new code is added" claim now holds without
exception.

**Verdict: product-design.md APPROVED. architecture.md APPROVED** (no content
change was needed on the architect's side once the CLI-output decision landed,
as the architect correctly predicted).

Task #4 complete: both drafts approved after one revision round.
