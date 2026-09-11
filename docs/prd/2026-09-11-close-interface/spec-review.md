---
type: spec-review
created: 2026-09-11
reviewed: docs/superpowers/specs/2026-09-11-close-interface-design.md
round: 1
---

# Spec review: Close Interface design (round 1)

## Verdict

**APPROVED.** No blocking findings. No non-blocking edits were needed either —
the compiled document is a faithful, coherent assembly of the two approved
source artefacts, and its load-bearing claims about the current codebase check
out.

## Checks performed

### 1. Assembly fidelity against `product-design.md` and `architecture.md`

Read the compiled spec section-by-section against both source documents,
looking for anything dropped, contradicted, or duplicated in a way that
disagrees.

- **Personas, goals, journeys, non-goals, success metrics**: carried across
  faithfully, condensed but not altered in substance.
- **Buy-vs-build ledger**: the compiled table's 8 rows match architecture.md
  §12's 7-row ledger plus product-design.md's separate "Schemas: zod" note,
  merged into one row. No decision lost, no alternative-considered rationale
  dropped.
- **Operability/DX**: compiled spec's 5 bullets (Environment, Harness and
  scaffolding, Local-run story, Guide, Deploy target) match architecture.md
  §13's structure. Product-design.md's earlier "known gap: no gh mock
  equivalent" note is correctly absent from the compiled version — it was
  resolved, not dropped, by architecture's fixture-executable test double
  (ledger row "gh test double"), which the compiled spec's Testing section
  §3 and Buy-vs-build row both state.
- **No unresolved contradiction found** between the two source documents that
  the compiled spec silently picked a side on without flagging. The one place
  they genuinely differ — product-design's example `{ type: "merge-back",
  base: "main" }` vs architecture's pinned-`baseBranch`-only schema — is
  exactly what the Open Questions section calls out, and product-design.md's
  own "Architecture decisions this document depends on" section explicitly
  left that parameter shape to the architect, so this is a resolved deferral,
  not an unflagged conflict.

### 2. Open questions (assembly decisions) checked against both artefacts

All three verified as accurate and correctly non-blocking:

1. **`base` param superseded by pinned `baseBranch`** — confirmed:
   product-design.md's Journey B (line ~157) uses `base: "main"`;
   architecture.md §3 explicitly states "No variant takes a `base`
   parameter." Product-design.md's own "Architecture decisions this document
   depends on" section left the exact parameter shape to the architect, so
   this is a deliberate, sanctioned resolution, not a silent override.
2. **`push` on `commit-to-branch` is COULD-tier but present in the MUST-tier
   schema** — confirmed: product-design.md lists it as COULD ("A
   remote-push parameter on commit-to-branch"), architecture.md §3 and §5.2
   already show `push: z.boolean().optional()` in the schema and the closer's
   step 3. Correctly flagged as a tiering note for delivery, not a scope
   creep — the field existing in the type doesn't obligate building the
   behaviour.
3. **Whether `merge-back` pushes the updated base branch to `origin`** —
   confirmed genuinely undecided in both source documents; correctly
   deferred, matching the "What this does not include" section.

### 3. Claims checked against `src/`

Read `src/ports.ts`, `src/provision.ts`, `src/custom-gate.ts`,
`src/case-file.ts`, `src/surface.ts`, `src/schema.ts`, `src/triage.ts`,
`src/errors.ts`, `src/resolve-gate.ts`, `src/gate-support.ts`,
`src/git-env.ts`, `src/prompt-assembly.ts`, `src/triage-role-config.ts`.
Every load-bearing factual claim about current code held up:

- `CloseContext` is exactly `{ worktreePath, dir }` today (`ports.ts:87-90`);
  `noopCloser` reports `DONE` and does nothing (`ports.ts:110-113`) — matches
  the Problem section verbatim.
- `resolveBaseRef` in `provision.ts` today returns a single ref string with no
  `localBranch` — matches the spec's claim that this needs widening.
- `custom-gate.ts`'s `loadCustomGate`/`guard`/`createCustomGate` shape is
  exactly what the spec says will be extracted into `plugin-loader.ts` —
  confirmed method-by-method (dynamic import, `InvalidGateExport` checks,
  per-call guard turning throws/bad shape into an `ERROR` report).
- `case-file.ts`'s `setBaseline`/`setOnce` pattern is exactly what the spec's
  `setBaseBranch` is modelled on, including the "declared `async` deliberately
  so `parse` throws land as a rejection" comment the spec doesn't repeat but
  whose shape it correctly reuses.
- `surface.ts`'s three `ports.closer.close()` call sites (`closing()`,
  `terminate()`'s fire-and-log, the `CLOSED`-resume branch never re-invoking)
  match the spec's Problem section and architecture's module-structure
  section exactly, line for line.
- `triage.ts`'s `legalVerdicts.close_failure = {retry_close, escalate,
  abort}` and `needsJudgement`'s `close_failure` branch (`left(b.close) ===
  1`) match the spec's close-triage/budget claims.
- The `CloseRepairBrief`/`SharpenedBrief` alias chain in
  `triage-role-config.ts` and the `retry_close` verdict's `payload:
  CloseRepairBrief` confirm the repair-brief threading the spec describes is
  wired at the triage layer already, ready for `closing()` to read.
- One precision note, not a defect: the spec's `currentCloseRepairBrief`
  sketch says it "mirrors `currentBriefRef`'s pattern... exactly." The actual
  `currentBriefRef` (`surface.ts:263-272`) returns the **ref key** (a string)
  for later, deferred resolution inside `prompt-assembly.ts`, whereas the
  closer sketch resolves and inlines the **brief content** immediately into
  `CloseContext`. This is the right design for the two different consumers
  (an agent-prompt assembly step vs. a plain data field on a context object
  passed once) and does not change the system's shape, so it is not a
  blocking finding — but "mirrors... exactly" overstates the similarity.
  Noted here rather than edited, since it is prose-precision, not a defect
  that would cause the wrong system to be built, and the plan/implementation
  stage will write the real code against the actual `currentBriefRef`
  function anyway.
- The git behavioural claims underpinning `merge-back`'s idempotence (§5.1) —
  that `git merge-base --is-ancestor` yields exit `0`/`1` for the two normal
  cases and a distinct non-0/1 exit for an unknown revision, and that `git
  branch -d` refuses to delete an unmerged branch — are correct as documented
  git behaviour and don't need external verification.

## Non-blocking fixes applied

None. No typos, contradictions, or excess implementation detail were found
that warranted a direct edit.

## Blocking findings

None.
