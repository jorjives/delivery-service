# Spec Review — Agent Invocation Primitive Design

Reviewer: spec-reviewer (fresh read, no part in authoring).
Target: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`,
compiled from `product-design.md` + `architecture.md` (both critic-APPROVED per
`review-log.md`).

## Verdict

**APPROVED**, with two non-blocking fixes already applied directly to the spec file.
No blocking findings.

## What was checked

- The compiled spec read cold, against itself, for ownership gaps, contradictions,
  ambiguity that forks the build, missing decisions, and scope creep — per
  `critiquing-a-design-spec`.
- The compiled spec diffed against `product-design.md` and `architecture.md` for
  anything the assembly dropped, contradicted, or duplicated.
- The buy-vs-build ledger (9 rows) and Operability/DX section checked line-by-line
  against both source documents' equivalents.
- `review-log.md` cross-checked to confirm both round-1/round-2/round-3 fixes (the
  Journey A MUST-scope finding, and the `disallowedTools`→`tools` mechanism finding)
  survived correctly into the compiled document.

No factual/technical claim in the compiled spec goes beyond what the critic already
independently verified against `src/ports.ts`, `src/schema.ts`, `src/surface.ts`, the
installed SDK's `sdk.d.ts`/`sdk-tools.d.ts`, and `claude-mock`'s source (see
`review-log.md`). Nothing new was introduced during compilation that needed routing to
the researcher.

## Findings applied (non-blocking, fixed directly)

1. **Ambiguity: guide's MUST/SHOULD status.** The SHOULD list's bullet on the "writing a
   `role_cfg`" guide was carried over from `product-design.md` without its
   "(MUST item 6)" cross-reference. Read on its own, in a document where MUST 6 already
   commits to "plus a short guide," this read as if the guide's existence were still
   optional — it isn't; only its format (standalone chapter vs. README) is SHOULD.
   Fixed: reinstated the cross-reference so the split is explicit in the compiled doc,
   not only recoverable by reading `product-design.md` alongside it.

2. **Assembly-introduced duplication: tool-authority mock gap stated twice.** Both
   source documents state, independently and correctly (once in `architecture.md`'s
   Testing strategy §6, once in `product-design.md`'s Operability/DX), that
   tool-authority enforcement cannot be verified through `claude-mock` today. Compiling
   both into one document produced two near-verbatim statements of the same gap
   (Testing strategy point 3, and the Operability/DX section) sitting a few hundred
   lines apart. Fixed: trimmed the Operability/DX restatement to a pointer at Testing
   strategy point 3, keeping the one full statement of the gap and its resolution.

## Things checked and found sound (no action needed)

- **Ownership**: every resource/decision has exactly one named owner — `invoke()` owns
  the SDK call, the driver owns retry/budget logic, the gate owns acceptance judgement
  (worker's `completed` payload is rationale-only by design, precisely so it can't
  usurp that). No double-ownership or orphaned decisions found.
- **Claim truth**: spot-checked the load-bearing claims (fresh session per invoke,
  `dir` reused rather than `ctx` extended, `tools`+`allowedTools` dual-purpose,
  determinism via disk-derived pure inputs) against the Architecture section's own
  detail — all consistent with what they're claimed to do.
- **Interface fit**: `RoleConfig` shape, the `AgentPort.invoke` seam, and the
  `Terminus` 3-way union are used consistently everywhere they appear; the
  triage/Terminus mismatch is correctly scoped out (Item 5's), not silently smuggled
  back into this item's MUST tier.
- **Contradiction**: none found between the Capability set (MUST/SHOULD/COULD), the
  Architecture section, and the Buy-vs-build ledger — including the one place they
  most plausibly could clash (tool authority: MUST 4's altitude-neutral requirement
  vs. the Architecture section's pinned `tools`/`allowedTools` mechanism) — this is a
  deliberate what/how layering carried over correctly from the source docs' review
  history, not an oversight.
- **Missing decisions**: budget knobs are explicitly and consistently deferred
  everywhere they're mentioned (Capability set, Architecture, ledger) — reserved as a
  typed slot, not silently defaulted.
- **Buy-vs-build ledger fidelity**: all 9 rows trace cleanly to `architecture.md`'s
  ledger; the 9th row ("one config shape across pluggable seams") is a faithful merge
  of a `product-design.md` prose bullet into the table, not a new claim.
- **Operability/DX fidelity**: the compiled section correctly merges
  `architecture.md`'s structural bullets (environment, scaffolding, local-run story,
  deploy target) with `product-design.md`'s DX-gap bullets (claude-mock's relative
  path, budget-cap/timeout paths not yet exercisable) — nothing dropped, one
  duplication trimmed (finding 2 above).
- **YAGNI/scope**: the MUST/SHOULD/COULD tiering and "What this design does not
  include" section correctly keep triage, declarative authoring, and mock-vendoring
  out of this item's scope, consistent with both source documents and the roadmap.
- No procedure-as-defect findings raised — the document describes a system, not a
  build sequence, throughout.

## Not routed to researcher

Every claim in the compiled spec that could plausibly need fact-checking (SDK option
behaviour, zod's `z.toJSONSchema`, `claude-mock`'s lack of `allowedTools` handling,
the single `ports.agent.invoke` call site in `src/surface.ts`) was already
independently verified by the critic against source during the three-round review
recorded in `review-log.md`, and nothing new was introduced during compilation. No
new verification request was needed this round.
