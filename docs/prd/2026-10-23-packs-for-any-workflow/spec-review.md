# Spec review: packs for any workflow (round 1)

Reviewer: spec-reviewer. Spec read against product-design.md (P) and architecture.md (A) as a stranger.

## Verdict

APPROVED. No blocking findings.

## Checks

- Ownership: each decision has one owner (loader owns cross-reference rules; JSON Schema shape only; strings owned by named printers). No gaps found.
- Claim truth: loader described as authority for cross-reference rules, not the schema; consistent with 6.5. The find's generated form and hash formula match A§4, A§5.
- Interface fit, contradiction: no internal contradiction between sections 4, 5, 6, 7, 9. P and A do not contradict each other (P§6 records the `migrate` to `deprecations` rename; spec uses `deprecations` throughout).
- Dropped: none that change the system. Three small omissions restored (below).
- Contradicted: none. Duplicated: none that matters (limits in 6.6 and 7 are distinct sets).
- Buy-vs-build ledger: all 11 rows of A§12 present (section 8), decisions and alternatives intact.
- Operability / DX: environment, harness, scaffolding, local-run, deploy target and name-reservation decision (all four parts) present (section 9); testing approach present.
- Boundary: no procedure demanded; no build-order content found. Section 9 "Surfaces touched" is an inventory (A§14), not a sequence; left in.

## Applied fixes (mechanical)

1. Error table row "Act-only key on a find": restored `(hold, guards, summary)` and the note that it replaces the generic data-only sentence. restored-from A§8
2. Section 6.5: restored that the `/2` schema and its 26 published-keys lines stay, `/3` lines are added, `PACK_SCHEMA` (index.ts:117) becomes `/3` and a new constant lists readable versions. This is a public-export value change that had been dropped. restored-from A§5
3. Section 7 owner text: restored "that the list is the agent's opinion" at start of run. restored-from P§6

## Noted, not actioned (non-blocking)

- Section 11 says "The critic recorded no unresolved disagreement"; review-log.md shows approvals at round 3 for both artefacts, consistent.
- A§13 point 3's example clash wording and the "future built-in names" remark were condensed in spec section 9; the decision is intact, wording belongs to slicing.

Unresolved: none. Rounds used: 1 of 3.
