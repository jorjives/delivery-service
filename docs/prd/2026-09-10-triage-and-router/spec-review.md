# Spec review: Triage and Deterministic Router

Reviewer: spec-reviewer (fresh read, no prior involvement in this document).
Target: `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`, compiled
from `product-design.md` and `architecture.md`.

## Method

Read the compiled spec against itself (ownership, claim truth, interface fit,
contradiction, ambiguity, missing decisions, coverage, scope) per
`critiquing-a-design-spec`. Additionally checked each of the four flagged
"Team-lead assembly decision" callouts against `architecture.md`,
`product-design.md`, and the current code (`src/ports.ts`, `src/router.ts`,
`src/surface.ts`, `src/prompt-assembly.ts`, `src/case-file.ts`,
`src/agent-invoke.ts`, `src/role-config.ts`) and against
`docs/single-surface-control-flow.md` / `docs/agent-interface.md`. Confirmed
the buy-vs-build ledger and Operability/DX sections survived compilation.

## The four team-lead assembly decisions — verified against the approved artefacts

1. **`artifact` replaces `viaAgent`.** Architecture.md's `viaAgent?: boolean`
   plus an unpopulated ref placeholder is replaced with one optional
   `artifact` field carrying both "what to write" and "is there a brief to
   thread". Checked against `surface.ts`'s current ref-write and
   `deriveStateFromEntry`'s handling of `triage` entries: nothing about the
   ref layer requires the extra field name, and the compiled version is
   strictly simpler (one field, not two) while preserving the "never
   persisted, always re-derived on resume" property architecture.md argued
   for. Sound.
2. **Budget guards added to `needsJudgement`.** Architecture.md's version
   would call the agent unconditionally for `worker_escalate`(exhaustion) —
   including when `correction` is already exhausted — and for `gate_error`
   whenever `gateError` was spent, regardless of `gateMaintenance`. Traced
   this against `case-file.ts`'s `deriveBudgetsFromLog`: nothing on the agent
   path re-checks a budget cap before honouring a legal verdict, so
   architecture.md's version would let an agent-issued `reroute` burn a
   `correction` slot past `max` with nothing to stop it. The compiled
   version's guards close a real bug, not just an optimisation. Sound, and
   an improvement worth keeping.
3. **`gate_error` two-step rule.** Architecture.md's plan replaces the
   `gate_error` row outright with `{budget: "gateError", helpful:
   "recheck_gate"}`. Confirmed against `router.ts`'s current single-row
   lookup (`rules[trigger]`, one budget, one verdict, escalate at cap) that
   this row-replacement would mean a deterministic-only harness (no triage
   agent wired) escalates the instant `gateError` is spent — the harness
   never reaches `GATE_MAINTENANCE` again for a broken gate, a regression
   from today. The compiled two-step rule fixes this. One gap found and
   fixed directly (non-blocking): the compiled spec's "Module structure"
   section described this as "one `gate_error` rule change" as if it were a
   table-row edit, but a two-step check cannot be expressed inside
   `router.ts`'s existing single-row lookup — it needs a `gate_error`-only
   branch in the dispatch function itself. Edited both the module-structure
   line and the `recheck_gate` section to say so explicitly.
4. **`buildEscalationPacket` on every escalate path.** Confirmed
   architecture.md has no such function — its `TriageVerdict` carries only
   `viaAgent`, and `surface.ts`'s stub ref write (`{trigger, rationale}`) is
   untouched by it. This means architecture.md, as written, does not satisfy
   `product-design.md`'s MUST 4 / flow 2 ("`EscalationPacket` persisted with
   real content on every escalate verdict") for the authority and
   budget-exhausted paths — a real, load-bearing gap between the two
   approved documents. The compiled spec's `buildEscalationPacket` +
   `withPacket` closes it with no new agent cost. Sound, and necessary for
   the compiled document to actually satisfy the product design it claims to
   implement.

## Other checks

- **Fast-path table vs. code.** The `needsJudgement` prose table and its
  code block agree exactly, trigger by trigger.
- **Legal-verdict table vs. control-flow doc.** `close_failure`'s
  `{retry_close, escalate, abort}` and the exclusion of `reroute` matches
  `single-surface-control-flow.md`'s Close interface section and the
  roadmap's stated success criterion.
- **`SharpenedBrief` has no `evidence` field** — checked against
  `prompt-assembly.ts`'s `## Gate evidence` slot, which already renders
  verbatim newly-failing assertions unconditionally on every worker
  dispatch. The omission is real, not asserted: a second copy would in fact
  duplicate what's already always present.
- **Ref/session-key reuse** (`triage-${priorTriages}` as both ref key and
  session key) — checked against `surface.ts:563`'s existing round-index
  computation; the claim is accurate to the current code.
- **Buy-vs-build ledger and Operability/DX**: both survived compilation from
  `architecture.md` intact, with the ledger correctly gaining one new row
  (the escalation-packet builder) that only exists because of assembly
  decision 4 above. Nothing else was dropped from either section.
- **Minor, non-blocking observation, not fixed**: `architecture.md` §12
  ("Extensibility" — how a fifth role would be added later) was not carried
  into the compiled spec. This is forward-looking commentary about a future
  item, not a description of this system's components or interfaces, so its
  omission does not affect what gets built here — left as-is rather than
  padding the document with speculative content the critiquing skill's YAGNI
  check would otherwise flag if added back in.

## Fixes applied directly

- Corrected the "Module structure" line and the `recheck_gate` (SHOULD)
  section to state that `router.ts`'s `gate_error` handling needs a
  dedicated two-budget branch in the dispatch function, not a single
  table-row edit — the previous wording implied a smaller change than the
  two-step rule actually requires.

## Blocking findings

None. Every discrepancy found between the compiled spec and its source
documents (architecture.md, product-design.md) had exactly one defensible
resolution, and in each case the team-lead's assembly decision was the
correct one — three of the four fix real defects in architecture.md itself
(an unbounded budget overrun, a gate-maintenance regression, and a
product-design MUST left unsatisfied). The one wording gap found (item 3
above) has been corrected in place.

Verdict: APPROVED
