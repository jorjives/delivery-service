# Review log: inspect a pack before trusting it

## Selected phase (derived by orchestrator)

Seed: `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, Item 2 "Inspect a pack before trusting it".
It is the first ready item in document order: Item 1 (its only dependency) carries a completion line (commit 44d2205 on this branch),
all five of its slices are delivered. Harness roadmap Items 13/14 carry no completion line and are not ready/in scope.
The ideas pool holds only operator issue-style notes (none about packs inspection); none seeds this PRD, so no `seeded_by`.

Intended shape: MUST = a command that renders, for a pack (built-in, local folder), its workflows, full prompts, guards, hold policy,
and the gates/closers it selects; flags anything widening agent power beyond project defaults; refuses packs carrying unnamed content
with a plain explanation; output legible to a non-author. SHOULD/COULD tiered by the product-designer. Install, pinning, settings,
publishing, code plugins are non-goals (Items 3-9).

## Derived minimum scope (assumed, not human-confirmed)

The MUST tier above, taken from the roadmap Item 2 success criteria.

## Critic log

### Phase selection check (critic)
- Provenance verified: roadmap Item 2 success criteria (four bullets), dependency (Item 1) and "inspection before install" note match the orchestrator's MUST tier.
- Not duplicate: `delivery packs` lists name/summary only; `delivery packs check` and `inspectPack` (src/packs/manifest.ts) validate structure and refuse unnamed content. Nothing renders prompts, guards, hold policy or selected gates/closers, or flags widened power. Drafts must build on `inspectPack` and not re-implement the refusal.
- Scope: install, pinning, settings display (Item 4 adds settings to inspection later), publishing, code plugins excluded. Because Item 3 (install) does not exist yet, "before installing" can only mean built-in and local-folder packs; MUST scope is usable on that basis. Awaiting drafts.

### Round 1 (critic)
- architecture.md: REVISE. (1) findings model lacks home for product flags (sign-off, hold critical-only, /2 effective guards); (2) size cap untraced; (3) git/OS metadata handling in folder check; (4) build-order procedure in sections 3 and 14; (5) raw U+202E in file, unify display form with product M3; (6) --workflow filter unaccommodated; (7) cite full path src/schema.ts. Accepted: gate/closer "project's own"; doc-file allowance; folder check outside run loader; readPack rename; JSON stability promise.
- product-design.md: REVISE. (1) README allowance aligned to architecture; (2) symlink-anywhere and non-UTF-8 refusals; (3) M8 vs criterion 2 and agreed flag list; (4) drop M8(d)/C5; (5) drop S4 heuristics; (6) "job" collides with glossary; (7) remove D5 assumption; (8) S2/Marcus. Accepted: D1, tiering, journeys, buy/build.

### Round 2 (critic)
- architecture.md: REVISE. Round 1 items resolved. Remaining: drop prompt-empty/prompt-long notes (untraced, aligned with product-design M8(d) removal); convert accepted open questions to recorded decisions.

### Round 3 (critic)
- architecture.md: APPROVED (sha256 ef5930dc...e2ae). Prompt-length notes gone, decisions recorded, no raw bidi characters, no build-order text. Condition for the gate: product-design.md M8 must match the code list (lands-without-sign-off, hold-only-critical, hidden-characters, older-format-guards, plus wider rows).

### Round 2, product-design.md (critic)
- product-design.md: APPROVED (sha256 9072d2da...0d9a). M8 list matches architecture (lands-without-sign-off, hold-only-critical, hidden-characters, older-format-guards, plus wider); M9 folder set, symlink and UTF-8 refusals match architecture section 3; heuristics and prompt-length flags removed; glossary vocabulary used; no procedure.
- QUALITY GATE COMPLETE: architecture.md (ef5930dc...e2ae) and product-design.md (9072d2da...0d9a) both approved in final form. Any later edit returns to critic.

### Spec re-review (critic)
- docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md: REVISE (1 item). Approved artefacts unchanged (hashes as above). 5.1 wording fix, 5.2 model sketch (matches A§9) and the restorations are fine.
- D6 / 5.1: "the manifest is parsed for its problems but no prompt file is read" and "no prompt file is opened until the first two pass" require a loader that parses and cross-checks without reading prompts. A§3 says inspection "reuses [the loader] unchanged", and that loader reads every prompt file and reports missing or unreadable ones. So D6 contradicts A§3 and weakens M10 ("every problem at once"): a missing or non-UTF-8 prompt could not be reported alongside a stray file. The safety invariant in A§3 and M9 is that no pack text is produced on any refusal (and symlinks are never followed), not that no file is opened. Fix: restate D6 and 5.1 as "no prompt text is printed on any refusal; a prompt file is not read where the folder check found a link; otherwise the unchanged loader runs and its problems are merged with the folder problems", or, if the parse-without-read split is intended, state it as a loader change and carve prompt-read problems out of M10.

### Spec re-review, final bytes (critic)
- docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md: APPROVED (sha256 97861a62...dedce2... full: 97861a62821bfdb2836007f25e4db8d4ab38c9b54b0b2cdba96a4f56f4aedce2). 5.1 and D6 now state "no prompt text is printed" on any refusal, consistent with A§3 (unchanged loader) and P§4 M9/M10. Approved artefacts unchanged.

### Spec approval status correction (critic)
- The APPROVED entry for sha256 97861a62821bfdb2836007f25e4db8d4ab38c9b54b0b2cdba96a4f56f4aedce2 is SUPERSEDED: the file was edited afterwards (now 950c6e3998dc737526a4cb8c4c5c3ee6a94098647ed03f1c5abb2a03b1fbe3aa) and the abbreviated hash in that entry was mistyped.
- Current bytes 950c6e39...: REVISE (1 item). 5.1 step 3 has the unchanged loader read the prompts, yet step 2 says "a prompt that is a link is never read" and D6 says "links are never followed"; the unchanged loader follows symlinks (R§3), so both cannot hold. Smallest fix keeping M10 intact: say links are never printed (no pack text is shown on any refusal) and drop "never read"/"never followed". Not approved until resubmitted.

### Spec final approval (critic)
- docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md: APPROVED, sha256 7f32ee579b5ae5c9fdbbc9341635f188d62de3c403f34870881dce12a2b97c3d. 5.1 and D6 are now consistent with A§3 (unchanged loader) and P§4 M9/M10: one loader pass plus folder check, problems merged, no pack text printed on any refusal. Approved artefacts unchanged (architecture ef5930dc..., product-design 9072d2da...). Earlier hashes 97861a62... and 950c6e39... are superseded.
