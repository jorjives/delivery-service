# Spec review: Pre-Built Task Packs

Reviewer: spec-reviewer (fresh reader). Round 1. Verdict: APPROVED, no blocking findings.

## Method
Read the compiled spec against itself (ownership, claim truth, interface fit, contradiction, forks, coverage, YAGNI) and against `product-design.md` and `architecture.md` for dropped, contradicted or duplicated content. Spot-checked code: `GateContext` (`src/command-gate.ts`) carries `taskDef`, so the gate and closer can read `taskDef`; `GateContext.baseBranch` is genuinely absent today, as the spec says; the tool guard's lexical ceiling is pre-existing.

## Survived assembly
- Buy-vs-build ledger: all 26 architecture rows present, decisions and alternatives intact.
- Operability / DX: environment, harness, scaffolding, local-run, deploy, verification all present.
- Tier map, states, check kinds, sign-off on a moved base, no-tests rule, secrets rule, testing list: consistent with both sources. Assembly resolutions (five) are sound and reversible.

## Non-blocking fixes applied to the spec
1. Interface gap: the gate's guards need `testGlobs`, `protectedGlobs`, `skipMarkers`, the `anchor-gone` scope and the `tests` category exemption, but the task shape carried only `finding` and `authorisation`, and the gate sees only `taskDef`. Added `taskDef.guards` (resolved by the plan generator, in task identity) and `allowTestEdits` in `authorisation` and the `authorise` entry. The architecture shared this gap.
2. Report example arithmetic was inconsistent (approved 4, "Problem 1 of 5", 3+1 outcomes). Now approved 5, skipped 1, 3 fixed, 1 waiting, 1 unfixable.
3. `needs_decision` was called terminal yet overridable by `--allow-unchecked`; wording now "terminal until the owner overrides".
4. "Fixed and merged" is untrue for an `open-pr` landing; added the phrase "fixed, pull request opened".
5. Dropped from product design: the "approval rate" success metric; restored.

## Noted, not changed
- Product design's pack manifest listed a plain-language example finding; spec omits it. Cosmetic.
- Header says "Status: Approved" before this review; harmless in an autonomous run.
- Lexical tool-guard ceiling means "the fix agent can neither read nor edit the gate" rests on existing precedent for every gate, not new work.

## Unresolved
None.
