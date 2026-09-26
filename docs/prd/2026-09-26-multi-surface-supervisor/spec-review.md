# Spec review: Multi-Surface Supervisor (compiled design)

Reviewer: spec-reviewer (fresh read, no part in drafting). Target:
`docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`, checked
against `product-design.md`, `architecture.md`, `review-log.md`, the real `src/`,
and the referenced planning doc `docs/multi-surface-control-flow.md`.

## Verdict

**APPROVED**, with one non-blocking fix applied directly and one observation
recorded for awareness (not blocking).

## What was checked

- The spec against itself: ownership, claim truth, interface fit, contradiction,
  ambiguity, missing decisions, coverage, scope (per `critiquing-a-design-spec`).
- The "Assembly resolutions" section against `product-design.md` and
  `architecture.md`, for anything dropped, contradicted or duplicated that wasn't
  recorded there.
- The buy-vs-build ledger and Operability/DX sections, for survival into the
  compiled document.
- Code claims against the real `src/`: `queue.ts`, `runs.ts`, `run-location.ts`,
  `provision.ts`, `merge-back-closer.ts`, `closer-support.ts`, `surface.ts`,
  `ports.ts`, `git-exec.ts`, `budgets.ts`, `case-file.ts`, `settings.ts`,
  `failures.ts`.

## Findings

### 1. Fixed directly: an unrecorded terminology reversal

`product-design.md`'s "Terminology decision" section explicitly proposed
promoting "surface" to the user-facing word (`> it needs the architect's
agreement before either side builds against it`), and the review log's round 1
records the critic approving that decision as sound. The compiled spec's
Vocabulary section reverses it: "'Surface' stays an internal word; the
user-facing unit inside a supervised run is 'task'." This reversal is correct —
it matches how both source artefacts actually write for a reader throughout
(Dana's persona goals, the UX flows, the terminal-output examples all already
said "task") — but it was never recorded as an Assembly resolution alongside
the other seven. Added as resolution 8, describing the same reversal and why it
holds. No other change needed: the compiled document is internally consistent
with "task" user-facing / "surface" internal throughout.

### 2. Observation, not a defect: a real but already-reviewed scope narrowing

`docs/multi-surface-control-flow.md` (the planning doc both artefacts are
grounded in) specifies "full stop-the-world" repair — no worker edits at all —
as the baseline, with a `ponytail:` note that a *finer* gate/close-only pause
is a possible future refinement "if repair frequency measurably hurts
throughput." Both `product-design.md` and `architecture.md` independently
already narrowed the MUST-tier default to the finer gate/close-only pause
(agent sessions and triage calls are explicitly untouched), and the review
log's round 1 shows the critic caught and fixed the resulting narration
mismatch before individual approval (Assembly resolution 6, "pause wording",
records the same fix surviving into the compiled doc). Since this was already
caught and resolved before assembly, no further action needed — noted here
only so the record of *why* the compiled doc departs from the older planning
doc's stated default is complete.

### 3. Code claims verified accurate

Checked and confirmed exact against real source, none needing correction:
- `provision.ts:44-61` (`provisionWorktree`), `merge-back-closer.ts:74-113` (the
  merge + ancestry probe inside `closeAccepted`), `closer-support.ts:26-29`
  (`removeWorktree`), `git-exec.ts:13-16` (`git()`) — all line ranges match the
  cited behaviour exactly.
- `cli/queue.ts`'s `findQueueRun`/`isClosed`/`queueTasks`/`nextQueueTask` and the
  one-`allRuns()`-snapshot sequential loop in `runQueue` — matches the spec's
  Problem section and Architecture §7 claim about content identity precisely.
- `cli/runs.ts:117`'s `unfinishedRunFound` and `cli/failures.ts:29`'s
  `EXIT.configuration = 2` — the review log's round 2 already verified this
  citation to the exact call site (`run-command.ts:51`); re-confirmed here.
  Note for awareness only: the real function's message text offers
  `delivery resume`/`--fresh` for a *stale, same-task* run, which differs from
  the new refusal's "another run is live, wait or inspect it" framing — the
  spec only borrows the message *shape* ("name the run, name the escape
  hatch"), never claims to reuse the function, so this is not a defect.
- `cli/settings.ts:158-159`'s stated precedence (flag > env > file > default)
  matches the spec's claim for the new `concurrency` setting exactly.
- `budgets.ts`'s `DEFAULT_BUDGETS` (`correction`, `gateError`,
  `gateMaintenance`, `terminus`, `close`, all per-surface today) matches
  Architecture §6's before-state exactly, supporting the claim that an
  unsupervised surface keeps its existing counter unchanged.
- `ports.ts`'s current `SurfacePorts` (`agent`, `triage`, `closer` only, no
  `repoLock`/`repairCoordinator`) confirms the spec's proposed additions are
  genuinely new, not already present and mis-described.

### 4. Buy-vs-build ledger and Operability/DX: survived

Every row in `architecture.md`'s buy-vs-build ledger appears in the compiled
spec's table with its decision and rationale intact, plus one new row (mock for
N surfaces) that is a legitimate addition, not a substitution. One row's label
changed from "Build" to "Reuse-estate" (the persisted breaker) while keeping
identical rationale and alternatives — a cosmetic relabelling, not a scope or
decision change, not worth a fix.

Both artefacts' Operability/DX sections are present in the compiled document,
restructured under the architecture's six headings with the product design's
content folded in (e.g. "Diagnosability" absorbs the product design's
"Verify/diagnose" bullet one-for-one). Nothing named in either source's
Operability/DX section is missing from the compiled one.

### 5. Assembly resolutions 1–7: each checked and accurate

Spot-checked every existing resolution against both source documents and the
review log; each correctly describes a genuine disagreement or gap between
`product-design.md` and `architecture.md`, and each stated resolution is
consistent with the rest of the compiled document (no resolution introduces a
contradiction elsewhere in the spec).

## Open questions carried forward

Unchanged from the compiled spec's own "Open questions" section — none of my
findings add a new one requiring a human decision.
