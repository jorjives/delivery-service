# Spec review: install a pack from elsewhere, pinned

Reviewer: spec-reviewer. Spec read against `product-design.md` (P) and `architecture.md` (A), and the critiquing-a-design-spec checklist.

## Verdict: REVISE (2 items)

Buy-vs-build ledger and Operability / DX survived assembly (ledger had 17 rows in A§14, 12 in the spec after merging; one dropped row restored below). No procedure-as-defect findings raised.

## Applied fixes (mechanical)

1. restored-from A§14: ledger row "Version and range resolution" (buy: npm itself) added to spec §5.
2. restored-from P§4 M10, A§6.4: pack-name clash (twice used, or equal to a built-in) added to spec §4.
3. restored-from P§4 M15, A§5.4: `remove` names affected workflows and refuses while config names one; added to spec §4.
4. restored-from A§5.1 step 2: idempotent add (same fingerprint exits 0; different points to `update`); added to spec §4 J1.
5. restored-from A§11: determinism NFR added to spec §6.
6. new (factual typo): spec §10 said "two REVISE rounds each"; `review-log.md` shows product design had one, architecture two. Corrected, and pointer to this file added.

## REVISE items (not mine to edit)

1. A folder under `.delivery/packs/` with no record entry (the crash state after `add`, and P§5.6 row "A kept copy with no record entry"). A§4.3 says it "is not loaded" (silent). A§11 and P§5.6 say it is refused at load ("Not run ... Add it again", exit 2). The five states in A§6.3 do not include it. The spec says only "refused safely at load". Decide: silently ignored, or a refusal with a named state; and add the state to the table if refused.
2. `update` where the fetched fingerprint equals the recorded one but the version differs (A§5.3 step 3). The text contradicts itself: "write nothing" versus "version and integrity rewritten only with approval". P§4 M6 does not cover it. Decide: is there a question and a record rewrite, or a plain "already at this content" with no write? This forks the record's behaviour and the A§13 test "identical fingerprint writes nothing".

## Non-blocking notes

- P non-goals say the record "names a kind"; A§6.1 has `source: "npm"` as a literal that a later discriminated union extends. Spec follows A. Fine, noting for slicing.
- P§10 cites "allowlist (C7)"; it is C9. Artefact typo, not carried into the spec.
- `update` of a pack in state `changed` diffs against the hand-edited copy, not the approved bytes (A§5.3a). Defensible and consistent; flagging so slicing keeps it.
