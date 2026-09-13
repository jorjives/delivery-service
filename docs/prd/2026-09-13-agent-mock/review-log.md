# Review log — agent-mock-design

Autonomous run `20260913T211119Z` (design-team-auto). No human reviewed this run.

## Selected phase (derived)

**Phase:** Roadmap Item 7, Agent Mock: a first-class, adopter-facing testing seam for the
delivery harness, so a harness extender can test their gate/closer/role-config pipeline
end to end, deterministically, with no live API calls.

**Discovery survey (team-lead):**

- Roadmap `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`: Items 1-6 are
  marked complete with specs. Item 7 (Agent Mock, detail level `brief`) is the next item in
  sequence and its only dependency (Item 4, agent invocation primitive) has shipped.
  Items 8+ (CLI) depend on Items 3/2/6 only, so Item 8 is also unblocked; Item 7 is chosen
  because the roadmap orders it first and because every later item's tests and demos
  (CLI, project config, multi-surface, packs) inherit the testing story it sets.
- No existing spec has `seeded_by` front matter; no prior work drew on the ideas pool.
- Ideas pool holds one idea, `50-20260912T085724Z-agent-port-test-doubles-need-a-cast.md`:
  every hand-written `AgentPort` double needs `as AgentPort["invoke"]` because `invoke` is
  generic over role, which silences exactly the role/terminus type checking the generic
  exists for. Confirmed in 20+ sites across `src/*.test.ts` and `demos/*.ts`, and in
  `createAgentPort` itself. This is squarely Item 7's territory: the honest in-process
  double is part of the testing seam.
- Backlog from existing specs: `docs/agent-interface.md` says "`claude-mock` is a sibling
  project, not vendored into this repo ... Vendoring it is Item 7's." Items 4 and 5 both
  record the known gap that `claude-mock` does not model tool permissions. The gate-interface
  spec defers "end-to-end testing of the gate" to Item 7. Mock-backed tests and demos skip
  or refuse when `claude-mock` is not on `PATH` (installed via `npm link`), so an adopter
  cannot run them from a plain `npm install`.
- Estate prior art: `claude-mock` exists (`/usr/bin/claude-mock`, sibling project, has an
  `understanding-claude-mock` skill): a scripted fake `claude` CLI the SDK's
  `pathToClaudeCodeExecutable` points at, with `json`, `effects`, and a journal. The design
  must build on it (buy-vs-build: reuse-estate), not re-specify it.

**Why now / what it unblocks:** Items 8-12 all need deterministic end-to-end tests and an
adopter testing story; every current demo hand-rolls a cast double; the mock is only
reachable via `npm link`. Fixing the seam now is a refactor that simplifies every later item.

**Persona:** primarily Priya Shah (Harness Extender, `docs/personas.md`): wants to test her
own gate + closer + role configs without API spend and without reading harness internals.
Secondary: harness contributors (same persona class) writing the harness's own tests.

**Intended shape (team to verify and refine):**

- MUST (derived minimum scope, assumed, not human-confirmed): a public, documented testing
  API for adopters; honest role-typed agent doubles without casts; a scripted end-to-end
  surface run (worker → gate → close) using real gate/closer against a temp repo with no
  API calls; mock reachable from a plain `npm install` (no `npm link`); journal-based
  assertions on prompts sent and expectations consumed; unmatched/malformed reply exercises
  `INCOMPLETE_TERMINUS`; an adopter-facing "testing your delivery pipeline" guide.
- SHOULD/COULD: tool-authority modelling in the mock; migrating existing demos/tests off
  the cast; multi-surface interleavings (Item 10's, likely non-goal).
- Non-goals: re-specifying `claude-mock`'s internals; multi-surface; CLI.

## Critic: phase-choice verdict

**Verdict: APPROVED.** Item 7 is the right next phase, correctly scoped.

- **Sequencing.** Roadmap lists Items 1-6 complete; Item 7's only dependency (Item 4,
  agent invocation primitive) has shipped a design spec
  (`2026-09-09-agent-invocation-primitive-design.md`). Nothing in the roadmap or shipped
  specs suggests Item 8+ should jump the queue — Item 8 (CLI) explicitly builds on the
  testing story this item sets, per the roadmap's own Item 7 DX note. No pivot.
- **Ambitious-but-grounded, not slice-starved.** The derived MUST list is not a single
  slice: public testing API + honest role-typed doubles + a real end-to-end scripted
  surface run + npm-installable mock + journal assertions + INCOMPLETE_TERMINUS coverage
  + an adopter guide is several slices' worth of work, all traceable to the roadmap's five
  literal success criteria for Item 7 (checked line by line — every one is covered by a
  MUST, none invented). Not gold-plated: SHOULD/COULD correctly defers tool-authority
  modelling in the mock (a known, explicitly-stated gap in `docs/agent-interface.md`,
  not this item's job to close) and multi-surface interleavings (Item 10's).
- **No duplication with shipped specs.** Grepped `docs/superpowers/specs/*.md` for prior
  Agent Mock work: the only hits (`gate-interface-design.md`,
  `close-interface-slices.md`) defer end-to-end/mock-backed testing to Item 7 — they do
  not specify it. No shipped `-design.md` spec covers this item's ground already.
- **No duplication with `claude-mock`.** Read `claude-mock`'s own skill doc
  (`~/.claude/skills/understanding-claude-mock/SKILL.md`) and `docs/agent-interface.md`'s
  "Relationship to the mock" section. `claude-mock` already owns: the scripted
  expectation format (`when`/`effects`/`reply`/`json`/`fail`), the journal
  (`matched`/`unmatched`/`effect_failed`/`finished` events), and CLI-seam faking. The
  derived scope correctly treats this as build-on, not rebuild: "vendor claude-mock so
  a plain `npm install` reaches it" is exactly what `docs/agent-interface.md` already
  flags as this item's job ("Vendoring it is Item 7's"), not a re-specification of its
  matching/effects engine. Watch item for the drafts: the "public testing API for
  adopters" and "adopter-facing guide" MUST items must be documented as a thin
  harness-side wrapper over claude-mock's existing script/journal contract (helpers for
  constructing `role_cfg`-shaped expectations, wiring the honest cast, asserting on the
  journal) — if either draft re-derives its own expectation matcher or journal format
  instead of reusing claude-mock's, that is a build-vs-buy violation and blocks approval.
- **Persona coverage.** Priya Shah (Harness Extender) is the right primary: her
  `docs/personas.md` entry already names "trust the harness without reading `src/*.ts`"
  as her bar, which this item's adopter-facing testing API directly serves. No
  Dana/Marcus involvement expected or claimed (correct — they are downstream escalation
  readers, not harness integrators).

No changes requested to the phase choice. Proceeding to review product-design.md and
architecture.md against this scoping once drafted.

## Critic: product-design.md, round 1

**Verdict: APPROVED.**

Checked against the phase-choice scoping above and the review remit (internal
consistency, two-sided scope discipline, feasibility, buy-vs-build, operability/DX):

- **Derived minimum scope is genuinely conservative.** Its seven MUST bullets map
  1:1 to the review-log's own "Intended shape" MUST list — no additions, no
  narrowing to a single slice. Cross-checked against the roadmap's five literal
  Item 7 success criteria: all five are covered, none invented.
- **Two-sided scope discipline holds.** Not value-starved: J1 (script → real gate →
  real closer → journal proof) is Priya's primary journey and is fully covered by
  MUST items end to end, not by a SHOULD/COULD stub. Not gold-plated: the typed
  expectation builder and the CI cast-grep are correctly SHOULD-tier — both are
  enforcement/ergonomics on top of a floor that already works via the documented
  raw-JSON fallback and manual migration discipline; neither blocks the primary
  journey if deferred.
- **Buy-vs-build lens: exemplary, not just present.** Names `claude-mock` as
  reuse-estate with a direct citation to the research's trade-off table (CLI-seam
  fidelity vs in-process fake drift, e.g. Vercel AI SDK's `V2`→`V3` break), states
  the competitive scan found no first-party alternative, and correctly scopes what
  is genuinely new build (the cast-free double, packaging) versus what is buy
  (everything claude-mock already does). No commodity is being hand-rolled.
- **Operability/DX lens: present and concrete**, not falling out of implementation —
  environment, local-run story, verification mechanism, deploy target (none — a
  test-time-only library), and scaffolding reuse (existing `demos/*.ts` convention)
  are all named explicitly.
- **Honest about the tool-authority gap.** The empty/error-states table's last row
  states plainly that the mock cannot prove tool-authority refusal and points at
  where that guarantee actually is tested. This directly satisfies the phase-choice
  watch item above — no papering over a known limit.
- **No claude-mock re-specification.** The non-goals section explicitly excludes
  modifying claude-mock's script/journal/matching internals; the document only
  builds harness-side wiring atop the existing contract, consistent with the
  phase-choice verdict's build-vs-buy condition.
- **No HARD-BOUNDARY violation.** No command lists, setup sequences, or ordering
  of work found in the document — it describes the finished API surface, journeys,
  and states throughout, not a build sequence.
- **On the product-designer's specific self-doubt points:**
  1. Derived scope: conservative, confirmed above — no smuggled additions.
  2. Persona non-extension: correct call. The review-log itself named the
     contributor audience "same persona class" as Priya; forking a new persona
     entry for an audience already collapsed into an existing one would be
     speculative, not derived. No change requested.
  3. MUST/SHOULD/COULD tiering: correct as drafted (see two-sided scope note
     above) — neither the typed builder nor the CI gate needs promotion to MUST.
  4. Empty/error-states honesty: good, no papering over — see above.
  5. "Two building blocks, one story": the framing is honest rather than
     over-claimed — it unifies documentation and vocabulary, not mechanism (the
     honest double and the claude-mock run are genuinely different mechanisms
     with different cost/fidelity trade-offs, and the journeys correctly keep them
     distinct per use case: J1/J2 for full-surface, J3/J4 for unit-grain). This
     reads as accurate rather than as two APIs papered over with one name.

No unverified factual claims requiring the researcher: all buy-vs-build and
packaging claims trace directly to `research.md`, which the researcher already
produced and cited with `file:line` references. Reply sent to product-designer:
APPROVED. Now waiting on `architecture.md`.

## Critic: architecture.md, round 1

**Verdict: REVISE.**

Strong document otherwise: §2's cast-removal fix is compiled and verified rather than
merely asserted (a real strength — matches this remit's "never approve unverified
claims" bar since the author did the verification, not just cited the pattern), the
two-doubles decision table (§3) is a coherent read against product-design.md's J1-J4
journeys, the buy-vs-build ledger is thorough and correctly refuses to re-derive
claude-mock's matcher/journal, and §7/§8 correctly ground `INCOMPLETE_TERMINUS`
coverage and the tool-authority non-goal in existing, shipped decisions rather than
re-litigating them. Two findings raised by team-lead, both confirmed on inspection and
both blocking:

1. **Adopter-reachability claim is imprecise about *which* adopter, and overstates the
   future case.** Verified directly: `docs/configuring-a-role.md:27-29`,
   `docs/writing-a-gate.md:24`, `docs/writing-a-closer.md:27` all state today's adopter
   model plainly — "the harness is not published as a package yet"; an adopter works
   from a clone of *this* repo and imports `./src/index.js` directly. Under that model,
   vendoring `claude-mock` as a `file:` devDependency of `delivery-service` genuinely
   satisfies product-design.md's MUST ("reachable from a plain `npm install`, no `npm
   link`") today, because Priya's `npm install` *is* this repo's `npm install`. §4's
   decision is sound for the current adopter model, but the document never states that
   grounding fact, so the reachability claim reads as if it holds unconditionally. It
   does not: §"Distribution / deploy target" claims `vendor/claude-mock/`'s committed
   `dist/` "travels with...any future published package built from it, Item 8/9,
   exactly as any other committed source does" — this is not accurate as written.
   `devDependencies` are not installed for a package's own downstream consumers; once
   Item 8/9 publishes this harness to a registry, an external adopter's `npm install
   delivery-service` would **not** receive `claude-mock` unless it is redeclared as a
   `dependency` (or `optionalDependency`) at publish time, and whether `vendor/` itself
   is even included in the published tarball is a `files`/`.npmignore` decision nobody
   has made. Fix: (a) ground §4's reachability decision explicitly in the "not published
   as a package yet" fact (cite it), stating this design's MUST is scoped to today's
   clone-based adopter; (b) correct the "Distribution / deploy target" claim to name the
   devDependency-to-dependency migration as a stated, unresolved residual for Item 8/9,
   not something today's wiring already achieves. This is a factual precision fix, not
   a re-architecture — the vendoring decision itself stands.
2. **Licensing of the vendored copy is unaddressed.** Verified directly: `claude-mock`'s
   `package.json` is `"private": true` with no `license` field (research §2.2, and
   independently re-confirmed); this repo has no `LICENSE` file either (checked directly,
   `ls LICENSE*` in the worktree root returns nothing), despite the roadmap
   (`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:15,51`) describing
   this as heading toward "a usable open-source tool" where "trust and adoption depend
   on DX." §10 "Security" covers provenance (the vendored `dist/` is built from source
   committed alongside it) but says nothing about licensing. Copying private, unlicensed
   source from a sibling project into a repo whose own roadmap names an open-source
   destination is exactly the kind of decision this design must state, not leave silent
   — even though the resolution is straightforward (both projects share one author, per
   `git config user.name`/`user.email` in this worktree, so there is no third-party
   rights question). Fix: add one explicit statement — e.g., "both projects share sole
   authorship; the vendored copy carries no third-party licensing obligation and will
   inherit whatever license this repo adopts; this is not a decision this item makes
   final, only one it does not leave unstated." Product-design.md's non-goal ("any
   change to its license/visibility beyond what internal-estate reuse needs") is not
   contradicted by this — vendoring by the same owner is arguably exactly "what
   internal-estate reuse needs" — but the architecture must say so rather than let the
   silence read as an oversight.

Both findings are precision/completeness fixes to claims already made in the document,
not new scope and not procedure (no HARD-BOUNDARY issue) — reported to the architect as
REVISE with the above two numbered items. Team-lead's concerns are confirmed valid on
direct inspection of `docs/configuring-a-role.md`, this repo's own missing `LICENSE`,
and `claude-mock`'s `package.json`; no researcher routing needed, both facts checked
directly against primary sources.

## Critic: architecture.md, round 2

**Verdict: APPROVED.**

Both round-1 findings checked against the revised text:

1. §4 now opens "Scope of this decision: today's clone-based adopter model," cites
   `docs/configuring-a-role.md:27-29` directly, and closes with a "Residual, stated not
   solved" paragraph naming the devDependency-vs-`dependency` gap and the unmade
   `files`/`.npmignore` decision as Item 8/9's to resolve. The "Distribution / deploy
   target" line in Operability/DX is corrected in step: it now states the residual
   plainly ("publishing this harness as an installable package, unmodified, would
   silently drop `claude-mock` for an external adopter") rather than claiming it already
   travels forward. This is exactly the precision fix asked for — no re-architecture,
   no new scope, and it does not overcorrect into speculative Item 8/9 design.
2. §10 gains the licensing bullet: names claude-mock's `private`/no-license state and
   this repo's own missing `LICENSE`, states the same-author rationale plainly, and
   correctly declines to resolve open-sourcing as a future, separate decision rather
   than inventing a license here. Matches the ask exactly.

No new issues introduced by the revision. Both artefacts (`product-design.md`,
`architecture.md`) are now APPROVED. Task #4 complete — notifying "main".



## Team-lead: assembly reconciliations

Assembling `docs/superpowers/specs/2026-09-13-agent-mock-design.md` from the two approved
artefacts required three reconciliations, recorded here so the spec-reviewer can check them:

1. **Migration of the existing hand-cast doubles.** `product-design.md` puts it in MUST;
   `architecture.md` lists it under "does not include" as delivery work. The spec keeps it as
   MUST capability 7 (the harness's own doubles and mock-backed suites use the new API), because
   it is the seed idea's actual ask and the product's success metric ("zero casts", "no suite
   skips"). The architecture's point stands in spirit: it is described as an outcome, not a step.
2. **`assertFullyConsumed` signature.** Architecture has `assertFullyConsumed(events)`, naming
   indices; product design requires naming the `when` clause and the unmatched prompt. The spec
   uses `assertFullyConsumed(journal, script)` so both hold.
3. **Node version.** Product design says Node ≥ 20 (claude-mock's engines); the repo requires
   ≥ 22 (`package.json`). The spec uses ≥ 22.
