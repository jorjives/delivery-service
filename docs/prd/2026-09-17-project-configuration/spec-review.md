---
type: spec-review
reviews: docs/superpowers/specs/2026-09-17-project-configuration-design.md
against: docs/prd/2026-09-17-project-configuration/{product-design.md,architecture.md}
---

# Spec review: Project Configuration (Roadmap Item 9)

Reviewer joined fresh, with no part in authoring product-design.md,
architecture.md or the compiled spec. Read against `critiquing-a-design-spec`
plus two assembly-specific checks: (1) anything the compile step dropped,
contradicted or duplicated relative to the two source artefacts, and (2)
whether the buy-vs-build ledger and Operability/DX decisions survived
assembly.

## Method

- Read all three documents in full.
- Cross-checked load-bearing factual claims directly against `src/`:
  `DeliveryConfig` schema and `describeProblem` (`src/cli/config.ts`),
  `CaseFileHeader.domainPrompt` and `TaskDef` (`src/schema.ts`),
  `assemblePrompt`'s use of `domainPrompt` (`src/prompt-assembly.ts`),
  `RoleConfig`/`validateRoleConfig`/`READ_ONLY_TOOLS` (`src/role-config.ts`),
  `allRuns`/`unfinishedRuns` (`src/cli/runs.ts`), `NO_TASK`/`taskFrom`
  (`src/cli/settings.ts`), `runIdFor` (`src/cli/run-location.ts`),
  `checkCustomModules`/`loadPlugin` (`src/cli/settings.ts`,
  `src/plugin-loader.ts`). All matched the spec's and both artefacts'
  descriptions; no researcher escalation was needed.
- Diffed the buy-vs-build ledger and Operability/DX section against both
  source documents row-for-row and bullet-for-bullet: both survived
  assembly intact (the spec's ledger is a clean union of product-design's
  and architecture's tables, with no row dropped; Operability/DX matches
  architecture's section near-verbatim).
- Diffed the "Assembly resolutions" and "Open questions" sections against
  product-design's "Coordination record" (round 2, 5 defects) and
  architecture's "Open questions" / "Resolved during critic review" notes.

## Findings applied directly (non-blocking)

1. **Duplicate-entry detection was scoped to the `validate` command only,
   while the queue driver's correctness depends on it holding universally.**
   The compiled spec's "Task structuring" section said "`validate` refuses
   any two entries whose structured `TaskDef`s are deep-equal... Queue
   identity depends on this" — attributing the check to the `validate`
   command's own composition, not to config load itself. The Queue driver's
   pseudocode (which `run` executes) never performs a duplicate check, and
   `run` does not require `validate` to have been invoked first. A user who
   ran `delivery run` directly with two identically-worded queue entries
   would hit exactly the silent-skip failure mode the content-identity
   design was built to prevent (§6.2's own rationale), just via an
   unenforced invariant instead of position-keyed identity. This also
   contradicted the spec's own Error model section, which states "all
   configuration problems exit 2" for any command that loads a bad
   config — implying universal enforcement was already the intent, just
   not what the Task-structuring prose said. Traced this to both source
   artefacts: neither product-design.md nor architecture.md is unambiguous
   on this point either (architecture's §3.2 and §5.1 pseudocode read the
   same way), so this is a genuine compile-time gap, not a single
   mis-transcription.
   **Fix applied:** reworded "Task structuring" so duplicate detection is
   enforced once at config load, in the same `superRefine` as the
   `task`/`tasks` mutual-exclusion check, so it applies to every command
   that loads the config, not only `validate`. Reworded the `validate`
   composition list to match (loadConfig already enforces mutual exclusion
   and duplicate refusal; `validate` adds the per-entry empty checks on top).
   This is the one defensible, reversible resolution: it changes nothing
   about the check's rule or its message, only where it is wired in, and it
   aligns with how the mutual-exclusion check already works.

2. **Architecture's open question about exposing `buildPreviewCaseFile` was
   dropped during assembly.** architecture.md's "Open questions" §1 asks
   whether `preview`'s synthetic `CaseFile` construction should be exported
   as a helper for extenders, or kept CLI-internal, and explicitly leaves it
   unresolved ("no persona need identified yet"). The compiled spec's Open
   questions list (5 items) omitted it entirely, with no resolution recorded
   elsewhere in the document.
   **Fix applied:** re-added it as Open question 6, wording preserved from
   the source.

## Buy-vs-build ledger and Operability/DX: survived

- The spec's buy-vs-build table (12 rows) is a clean union of
  product-design's table (6 rows, product-level) and architecture's ledger
  (10 rows, implementation-level): every row from both sources is present,
  none dropped, none contradicted. Rows that appear in both sources under
  different names (e.g. product-design's "Task queue storage" vs.
  architecture's "Queue progress persistence / identity") are correctly
  kept as two distinct rows in the spec, because they are two distinct
  decisions (storage format vs. identity mechanism), not a duplicate.
- Operability/DX matches architecture.md's section near-verbatim
  (environment, harness layout, scaffolding, local-run story, deploy
  target, diagnosability) — nothing dropped, nothing added that isn't in
  the source.

## Other checks performed, no defect found

- **Assembly resolutions (1–9) vs. product-design's round-2 coordination
  record and architecture's critic-round notes**: all five of
  product-design's round-2 defects (queue identity, unknown-tool-name
  overstatement, preview flags, example project, duplicate entries) are
  reflected in the spec's resolutions 1–5. The team-lead-settled items
  (6–9) are consistent with what each source artefact actually says
  elsewhere (verified the queue-driver pseudocode literally implements
  resolution 6's "only closed is skipped" fix, not just claims it).
- **Closed questions** (product-design's "Questions the critic has ruled
  on", 3 items) are correctly *not* repeated in the spec's Open questions —
  each one's resolution is instead reflected as settled design elsewhere in
  the spec (escalation-stops-the-queue behaviour, presets staying SHOULD,
  domain staying a single prose string).
- **Contradiction check** across Problem/Scope/UX/Architecture/Error model:
  no other cross-section disagreement found. `--config` on `preview` (added
  at assembly per resolution 9) is consistent throughout the rest of the
  document.
- **Ownership**: each resource (config file, case file, queue identity,
  domain prompt) has exactly one named owner throughout, with the one
  exception fixed above.
- **YAGNI/scope**: MUST/SHOULD/COULD tiering and the reshaped-brief
  rationale (task structuring, presets) both survived from product-design
  without inflation or unrequested abstraction.

## Verdict

Two findings, both non-blocking and fixed directly in the spec. No blocking
findings remain.
