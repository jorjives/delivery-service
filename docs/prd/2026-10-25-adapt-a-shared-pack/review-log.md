# Review log: adapt a shared pack to my project

## Selected phase (derived)

Roadmap `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, Item 4 "Adapt a shared pack to my project". It is the first ready item in document order: Items 1 to 3 carry completion banners, and Item 4 depends only on Items 1 and 2. No spec exists for it. Scope is that single item.

Rationale: Items 5 (publish) and 6 (editor support) depend on Item 4; it removes the commonest reason for a custom gate; the `/3` pack format (packs-for-any-workflow design, section 6.7) already reserves room for it.

Intended shape: MUST = pack declares settings with defaults, owner supplies values in project configuration, unset required setting refused naming it, values reach prompts and checks, inspection shows settings and applicable values, decision on settings vs task fields. SHOULD/COULD to be tiered by the product-designer.

Derived minimum scope is an assumption, not human-confirmed.

## Critic log

(critic appends below)

### Round 1 (2026-10-25)

Provenance checks done against roadmap, PFAW design, install design, personas, compare.ts, pack-format.ts.

- product-design.md: REVISE (8). Mis-cites (hold severity at roadmap 156-157 not 148-149; data-only cited via install design line 50, which is a non-goals list; D1 is an inherited unconfirmed decision, not a constraint); camelCase names refused by `Slug`; "checks" reading not stated in derived minimum scope; `choice` MUST untraced; S2/S6 contradict architecture tiers; refusal scope wording understates whole-project stop; `{{` `}}` injection gap; S3 and add-block unhomed.
- architecture.md: REVISE (7). A1 hold union unverified (researcher asked to test against published-keys generator); same data-only mis-cite; superset of types versus product tiers; no MUST traceability; kebab names; inspection `hold: null` conflation; safety test structural not behavioural; unattended consequence of global refusal not named.
- Accepted with reasons: values outside fingerprint and lock; one grammar, two data models; bind before pin; Terraform rule (no default = required); eager global refusal.

- Researcher experiment (A1): union on `hold.atOrAbove` removes promised line `hold.atOrAbove: string` (becomes `object|string`): breaking under PFAW line 206. Optional `atOrAbove` also fails. A sibling optional key with `atOrAbove` kept required passes. `Slug` refuses camelCase.

### Round 2 (2026-10-25)

- product-design.md: REVISE (3). Round 1 items 1-7 closed. Left: S2/S3 and hold mechanism still conditional on architect; `choice` clause in MUST M4; "Item 1 D1" label.

### Round 3 (2026-10-25)

- product-design.md: REVISE (1). All round-2 points closed and verified (M6 uses `holdSetting`; S2/S3 have homes in architecture sections 7 and 11; D1 labelled). Left: M4 says "number out of bounds" but architecture declares no bounds.
- architecture.md: REVISE (1, round 2). Provenance verified (roadmap 16-18 and line 87; PFAW 198, 206, 39; published-keys line 99; `src/delivery-branch.ts:128`; `src/run-gate.ts:20`; install design line 120 and item 8). A1 resolved by the researcher's experiment. Left: section 18 "out-of-bounds" with no bounds declared; bare file names in section 15.

### Final verdicts (2026-10-25)

- product-design.md: APPROVED (final form, file last modified 17:16:53; M4 now "not a whole number", no residual bounds wording). Derived minimum scope judged conservative and usable: all four roadmap criteria covered, each persona completes their journey (Dana: add, refuse, inspect, update; Priya: declare, check with fixtures; Marcus: inspect value and source); criterion 3 reading stated as an assumption.
- architecture.md: APPROVED (final form, file last modified 17:16:56). Design answers verified present: one grammar and two data models, decided with reasons; values outside the approval fingerprint and lock, pinned at bind; injection rules (`{{ }}`, line breaks, hidden characters, behavioural shell test); inspection via always-present keys; additive within `/3` with published lines stated (`holdSetting`; union rejected on experiment); buy-vs-build ledger and operability sections present. Remaining note, not blocking: section 14 "outside `choice`/bounds" means length caps only.
- Any later edit to either artefact returns here for re-approval.
