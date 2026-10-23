# Spec review: inspect-a-pack-design.md (round 1)

Reviewer: spec-reviewer. Read against product-design.md (P) and architecture.md (A).

## Survived assembly
- Buy-vs-build ledger: all A§12 rows that shape the system survive in spec §7 (command wiring and test harness rows omitted as trivial reuse; acceptable, A§12 is cited).
- Operability / DX: spec §8 carries Environment, Harness, Local-run, Deploy target, Failure modes from A§13.
- Code claims checked at HEAD: only `guards.add` exists in the format (`pack-format.ts`), `bypassPermissions` at `agent-invoke.ts:246-247`, `afterFor` falls back to project `after`. "Every loading pack can only be stricter" holds.

## Mechanical fixes applied
1. M8 omitted the dimensions compared and "must be read": restored-from P§4 M8.
2. M8 omitted "stricter differences are plain facts, not flags" and the empty-state sentence ("Nothing unusual was found... not a guarantee"), the main false-comfort mitigation: restored-from P§4 M8.
3. S4 vanished from the numbering without trace: restored-from A§5 ("S4 dropped") as a one-line "Dropped" entry.
4. Success metric P§7.7 (comprehension fixture, the only evidence for roadmap criterion 4) was dropped: restored-from P§7.7 into spec §3.
5. Spec had no testing section (A§11 only cited): restored-from A§11 as new spec §9 "Testing" (condensed bullets; sections 9 to 11 renumbered 10 to 12).

## REVISE items (not mine to edit)
1. Ordering ambiguity that forks the build (A§3 / spec 5.1 / M9 vs M10). "The folder check runs first" but it needs the manifest to know which prompts are "named" and which are strays, so the manifest must be parsed before the check can finish; and M10 promises "all problems at once" for manifest refusals while a folder refusal "stops before any prompt text". State which wins when both fail (e.g. manifest problems and folder problems reported together, or manifest first then folder), and that `pack.json` itself being a symlink is covered.
2. Spec 5.2 says `Pack` gains `texts` and `declared`; A§4 says the loader "already holds `texts` and discards" it and A§5 adds `declared`. Fine, but A§9's JSON sketch (the `Inspection` shape) is entirely absent from the spec, so slicing has no stated model shape beyond a prose list. Either cite A§9 explicitly as the model sketch in 5.2 or include it.
3. Minor, for decision: spec 5.1 says a `/3` pack with a stray file "does not inspect clean" while M9 says documentation files are allowed; reword to "a stray unnamed file" to avoid contradiction with allowed README etc.

# Round 2

Round-1 items 1 to 3 verified applied (5.1 three-step order and D6; A§9 sketch in 5.2; "stray unnamed file" wording).

## Mechanical fix applied
- D6: trimmed the process note ("the orchestrator's resolution of the spec-reviewer's round-1 item 1") from the decision text. Tag: new (procedure trimming only; no decision changed).

## Non-blocking, unresolved
- 5.1/D6 say no prompt file is read when a refusal occurs, but the loader reads prompts while cross-checking the manifest (A§3) and the non-UTF-8 refusal can only arise from reading one. Read it as "no prompt text is printed or shown"; plan-time wording can settle it. Does not change the system built.
- D6 sits before D4 and D5 in section 10 (cosmetic).

Verdict: APPROVED.
