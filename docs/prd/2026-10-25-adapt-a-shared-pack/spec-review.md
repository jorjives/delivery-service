# Spec review, round 1

Spec: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-design.md. Read against product-design.md (P) and architecture.md (A).

## Verdict
APPROVED. No blocking findings. Citations spot-checked in the repository (DATA_ONLY, Slug, reserved `settings` sentence, inspection no-optional test): they hold.

## Applied fixes
1. M6 cited "R§-verified experiment" (no such section): now "researcher's test; A§4". restored-from P§M6.
2. M13 pointed at "section 8" (Operability); documentation is section 5.8. restored-from P§M13 (corrected for the spec's numbering).
3. Success metrics dropped P§9 items 7 (task-field clause), 7a, 7b, 8. Restored as 7, 7a, 7b, 7c (renumbered 7c so metric 8 and "metric 7" references stay stable). restored-from P§9. 7b matters: it is the only check of the global-refusal scope in M3.
4. Edge-state table dropped the `.js` configuration and "update adds required setting" rows. restored-from P§6.
5. Buy-vs-build ledger dropped P§7 rows: declared/typed/defaulted parameters (Helm, Terraform, VS Code shape), refusal wording, and the `runShell` / Actions-injection note on task fields. restored-from P§7. A§16's 11 rows were otherwise all present.

## Checked and sound
- Operability / DX (A§20, P§10) survived: environment, harness, scaffolding, local-run story, deploy target, failure modes, testing.
- No contradiction between P and A found; label differences (P source labels vs A `source` enum, P S-tiers vs A "Designed, MUST") are consistent mappings.
- Ownership, claim truth and interface fit: binding sits in `projectPackStates`; refusing and non-refusing paths are distinct; `unmetSettings` is the single list.

## Noted, not raised
- Spec 6.9 omits A§11 detail (`holdKnown` and `given` semantics, `usedBy`, `Change` direction table). Header says the artefact wins, so acceptable; the slicer must read A§11.
- Mild repetition of the Item 9 outcome (4.5, 6.3, 6.12, 10); consistent, left alone.
