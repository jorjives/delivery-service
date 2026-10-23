# Review log: packs for any workflow

## Selected phase (derived by orchestrator)

Seed: `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, Item 1 "Packs for any workflow"
(first ready item in document order: its only dependency, review packs selectable from project configuration,
exists per `2026-10-03-task-packs-design.md`). No `.autoloop/ideas/` files in this worktree seed it.
No other roadmap has a ready item: harness roadmap Items 13/14 are not marked complete by a banner
and Item 14 is not in scope; pluggable Items 2-15 depend on Item 1 or later.

Intended shape: MUST = a pack format revision that can express workflows other than scan-then-fix
(own prompts, guards, hold policy per workflow), old-format packs still read, one built-in non-review pack
runnable end to end against the scripted agent, docs showing packs cover more than reviews.
SHOULD/COULD to be tiered by the product-designer. Settings (Item 4) are designed so the format does not
change twice, but are NOT delivered here. Inspection, install, publish, plugins are non-goals.

## Critic log

### product-design.md

- Round 1: REVISE (7 findings): S3 and S4 tier contradictions with M1/M2 and metric 4; built-in does not demonstrate hold/multi-act; deletion cheat unnamed; upgrade collision on `docs` name vs criterion 4; M9 deferral; unfalsifiable metric 6. Provenance spot-checked OK (roadmap lines, research claims, packNotListed text).

### architecture.md

- Round 1: REVISE (7 findings): product/architecture incoherence (docs pack vs migrate pack; `delivery find` vs `review`; multi-step and per-step checks MUST vs excluded); name-reservation risk understated (user pack named like a built-in clashes by workflow name, verified `src/cli/pack-workflows.ts`); `find` fixed `after: []` unstated; scan routing limit; hold-as-object justification; criterion 1 test trace. Verified: held counts as fixed in checkPack (research 9); published-keys additive-only claim cited.

- product-design.md round 2: REVISE (5 small): M4 vs packNotListed contradiction; M11 clash-sentence mismatch with A§13; unowned owner strings (40-idea notice, how-to-mark); hold claim overstated (agent-rated severity); wording discriminator for review vs non-review output.
- architecture.md round 2: REVISE (3): ruled that `code`/`security` output stays byte-identical (criterion 4); asked architect to choose mechanism, suggested built-ins staying on /2; align clash sentence with product; own or drop new owner strings. Round-1 items verified resolved.

- architecture.md round 3: APPROVED. Built-ins `code`/`security` stay on /2 (byte-identical output, real /2 consumers); owner strings have named printers; two non-blocking edits by critic (stale "Data:" line, process reference). Verified: guard split (guards.ts:50,74-75), clash by workflow name (pack-workflows.ts), held counts as fixed (research 9).

- product-design.md round 3: APPROVED. All round-2 items resolved and aligned with A§6, A§13, A§14. Two stale lines fixed by critic (metric 4 referenced "migrated /3 built-ins"; clash row lacked the built-in case). Derived minimum scope M1-M11 judged conservative and usable: Dana, Priya and Marcus can each finish their journey; every MUST traces to a roadmap criterion or constraint; S/C items and non-goals stay inside Item 1 (Items 2-9 deferred). Roadmap Item 1 criteria 1-4 each traced to a MUST and a verifiable metric; existing review packs stay on /2 untouched.

- Compiled spec `docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`: APPROVED. Checked against both approved artefacts: M1-M11, metrics, format table, /2 read rule, built-ins staying on /2, wording discriminator, error table, buy-vs-build (11 rows), operability, name-reservation decision, and the three spec-reviewer restorations all faithful; no contradiction, no procedure, no scope leak. One non-blocking edit by critic: M10 now notes M11 adds the built-in clash case (matches A§13).
