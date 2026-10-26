# Review log: install a pack from elsewhere, pinned

## Selected phase (derived, orchestrator)

Source: `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` Item 3 "Install a pack from elsewhere, pinned" (first ready item in document order: Item 2 carries a completion banner, so its dependency is met). Ideas pool holds only issue-style files, none a seed for this; no `seeded_by`.

Scope: Item 3 only. Not Item 4 (settings), 5 (publish), 7+ (code plugins).

Assumed MUST tier (derived minimum, not human-confirmed): add a pack from a public package source; record the exact version and content fingerprint; later runs use only the recorded version; update is deliberate and shows what changed; a changed-since-approved pack is refused until approved; duplicate workflow names reported as for local packs. Constraint from roadmap: discovery uses an existing package ecosystem; no registry hosted. Starting point: task-packs COULD 23.

## Critic log

### Phase choice (critic, 2026-10-24)

Item 3 is the first incomplete item whose dependency (Item 2) is complete; Item 5 depends on it, Items 4/6 do not. Scope is single-item; the derived MUST tier maps one-to-one to the five roadmap success criteria. Sound. Watch-points for drafts: no overlap with Item 2 (inspection) beyond reuse, no settings (Item 4), no publish (Item 5), no code-bearing packs (Items 8/9).

### product-design.md round 1: REVISE
Provenance verified against the cited files. Defects: (1) kept copy under `.delivery/` is git-ignored (src/run-location.ts:62-68), breaking M4/J2/"commit both"/recovery; (2) validate coverage duplicated across M5 and S3; (3) stray-file recovery and approve-on-closed-set-failure unspecified; (4) 17 MUSTs for a brief item, M9/M15 need justification; (5) Dana persona vs typing a package name and needing npm; (6) clash example ambiguous. Researcher asked to verify package.json refusal, npm script behaviour, npm view fields, exit code.

### product-design.md round 1 resubmission: items 1-6 resolved. Pending alignment with architecture (see below); not yet APPROVED.

### architecture.md round 1: REVISE
Provenance spot-checked OK. Researcher executed: package.json refused by readPackFolder; tarball pack runs no scripts; npm view time/integrity available. Defects: (1) product/arch contradictions: vendored location (`delivery-packs/` vs `.delivery/packs/`), approving a changed pack (M8/M9/S3 vs D9; ruling: D9 stands, criterion 4 met via update, restore added to product); (2) "one atomic step" for folder+record is false, crash state unspecified; (3) port lacks publish-age/newest metadata that product M1 needs; (4) update `inspect <staging path>` points at a deleted folder; (5) remove lacks config-names-workflow refusal; (6) add-when-already-recorded behaviour differs; (7) SHOULD coverage (S1, S4) not built, tiers to align; (8) `"."` layout determinism.

### product-design.md round 2: APPROVED (bytes of 15:12:13)
Reconciled with architecture: location `.delivery/` with widened ignore, D9 (changed pack via restore/update, criterion 4 met through update), restore as M8, C5/C7/C8 as COULD, age/newest removed. Derived minimum scope remains conservative and usable: each persona completes add, run, update, refuse, remove.

### architecture.md round 2: REVISE (one item)
Resolved: location, criterion 4 mapping (5.3a), write order, remove refusal, idempotent add, `"."` layout. Open: section 11 Atomicity NFR contradicts 4.3 crash states.

### architecture.md round 3: APPROVED (bytes of 15:19:14)
Crash-safety NFR now matches 4.3. Buy-vs-build ledger present and honest (npm CLI, tar parser only, reuse of readPackFolder, Pack.hash, git diff); operability/DX section deliberate; assumptions (caps, `.delivery/` home, required field, --approve) flagged. Product and architecture agree on location, states, tiers.

### Final: APPROVED lines exist for both product-design.md (15:12:13) and architecture.md (15:19:14), each after its last edit.

### Assembly decisions (orchestrator), from spec-review REVISE round 1
1. Folder with no record entry: refused at load with a named state `unrecorded` (matches P§5.6 and A§11; A§4.3 "not loaded" read as "not loaded as a pack", the owner is told).
2. `update` with identical fingerprint but different version: no write, plain "already at this content" naming both versions.

### Assembled spec review (critic): REVISE (3 mechanical items)
Both assembly decisions are coherent with the approved artefacts: `unrecorded` matches P§5.6 (row "A kept copy with no record entry", exit 2) and A§11 crash-safety; "already at this content, no write" matches A§13 test and the A§5.3 step 3 intent. Nothing material dropped (M1-M17, S1-S5, C1-C9, ledger, operability, non-goals present; age display consistently out). Items: (1) spec section 10 still says two open points were raised for the orchestrator; they are now decided, say so. (2) Spec says the artefact wins on differing detail, but the two decisions supersede A§4.3 ("not loaded") and the A§5.3 step 3 parenthetical (rewrite with approval); record that supersession in section 8 so slicing does not revive them, and note A§6.3's state table gains `unrecorded`. (3) Section 3 should say `unrecorded` detection scans `.delivery/packs/` and excludes `.staging/` (A§4.3 ignores staging). Note: spec section 10's "product design after one REVISE round, architecture after two" is correct; the critic's earlier message to main saying two each was wrong.

### Assembled spec: APPROVED (bytes of 15:23:34)
Items 1-3 applied (sections 3, 8, 10). No further defects.
