# Spec review — agent-mock-design (assembled)

Reviewer: spec-reviewer (fresh eyes, no part in authoring). Round 1.

**Verdict: APPROVED, with one non-blocking fix applied directly to the spec.**

## Method

Read the compiled spec (`docs/superpowers/specs/2026-09-13-agent-mock-design.md`)
against itself per `critiquing-a-design-spec` (ownership, claim truth, interface
fit, contradiction, ambiguity-that-forks, missing decisions, coverage, YAGNI),
then separately against `product-design.md` and `architecture.md` for anything
assembly dropped, contradicted or duplicated, and against the actual repo code
(`src/ports.ts`, `src/agent-invoke.ts`, `src/surface.ts`, `src/provision.ts`,
`src/resolve-gate.ts`, `src/resolve-closer.ts`, `src/on-path.ts`, `tests/`,
`package.json`) for every checkable factual claim.

## Fixed directly (non-blocking)

**Missing `triage` parameter on `runSurfaceAgainstMock`.** The "Scripted
end-to-end run" section asserted the composition uses "the caller's choice of
`deterministicRouter` or `createAgentTriage`" for `SurfacePorts.triage`, but
the function's own parameter list — `{ dir, repoPath, worktreePath,
roleConfigs, gateRef, closerRef, script }`, inherited verbatim from
`architecture.md` §6's pseudocode — had no field through which a caller could
supply that choice. `SurfacePorts.triage` is a required port
(`src/ports.ts:126-130`); there is no internal basis on which
`runSurfaceAgainstMock` could pick between `deterministicRouter` and
`createAgentTriage` on the caller's behalf. This is a real interface-fit gap
(a claim about the system that the drawn shape doesn't support), not a
build-sequencing complaint, and the fix is a single obvious, reversible
addition, so I applied it rather than raising it as blocking: added `triage`
to the parameter object and to MUST capability 4, and named
`mockSessionEnvironment({ scriptPath, journalPath })`'s two inputs explicitly
(the composition text previously showed only `journalPath`, dropping the
script path MUST capability 3 itself says the function builds in).

## Assembly check (spec vs the two approved artefacts)

- The three reconciliations `review-log.md` records (doubles-migration tier,
  `assertFullyConsumed` signature, Node version) are all present and correctly
  applied — verified `package.json` requires `"node": ">=22"`, matching the
  spec's choice over product-design's stated `≥20`.
- Architecture round-2's two precision fixes (adopter-reachability scoped to
  "today's clone-based adopter model," and the licensing statement) both
  survived into the spec's "Derived minimum scope," "Operability / DX" and
  "Security" sections, word-for-word in substance.
- Buy-vs-build ledger: 7 of architecture's 8 rows carried over intact
  (scripted CLI-seam fake, vendoring, honest double, script/journal typing,
  journal assertions, end-to-end composition, temp-repo fixtures). The eighth
  row ("Schema library — zod, where used at all — Reuse") is a degenerate
  placeholder row in the source ("not introduced fresh by this item"); its
  absence loses no decision. Not a defect.
- Operability/DX: environment, scaffolding, local-run story, CI, and the
  Items-8/9 distribution residual are all present and match architecture's
  text.
- No content found that assembly duplicated or that contradicts between the
  two source documents beyond the three logged reconciliations.

## Code verification (all claims checked, all confirmed accurate)

- `AgentPort.invoke<R>` generic signature quoted correctly
  (`src/ports.ts:40-42`).
- Cast count: grepped `as AgentPort["invoke"]` across `src/`, `demos/`,
  `tests/` — exactly 23 occurrences, exactly 1 in production
  (`src/agent-invoke.ts:169`, inside `createAgentPort`) and exactly 22 across
  `src/*.test.ts` and `demos/*.ts`. Matches the spec's problem statement and
  MUST-7/success-metric claims exactly.
- `createAgentPort`'s own cast and comment match the spec's description of
  "the same root cause as `createAgentPort`'s."
- `resolveGate(gateRef, repoPath)`, `resolveCloser(closerRef, repoPath)`, and
  `run(dir, location, ports)` (`src/surface.ts:782`) exist with exactly the
  signatures the spec's composition step names.
- `deterministicRouter` (`src/router.ts`) and `createAgentTriage`
  (`src/triage.ts:70`) both exist and are exported from `src/index.ts`,
  confirming the triage-port gap above was real rather than a wrong reading.
- `isOnPath` (`src/on-path.ts`) and the `describe.skipIf`/`it.skipIf(mockMissing)`
  gating exist exactly as described, across `src/agent-invoke.test.ts`,
  `src/surface.test.ts`, and the three `tests/triage-and-router/*` and
  `tests/agent-invocation-primitive/*` files cited.
- `docs/agent-interface.md:236` — "Vendoring it is Item 7's" — confirmed
  verbatim.
- Roadmap Item 7's five literal success criteria
  (`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:280-288`)
  are each covered by a MUST capability; none invented.
- No `LICENSE` file in the repo root — confirmed, matching the Security
  section's claim.
- All four cross-referenced sibling specs
  (`2026-09-09-agent-invocation-primitive-design.md`,
  `2026-09-07-single-surface-state-machine-design.md`,
  `2026-09-04-gate-interface-design.md`,
  `2026-09-11-close-interface-design.md`) exist.

No claim required routing to the researcher — everything checkable was
directly verifiable against the repo, and all of it held.

## Spec-quality checks (no other findings)

Ownership, claim truth, contradiction, ambiguity-that-forks, missing
decisions, coverage, and YAGNI/scope were all checked against the assembled
text. No HARD-BOUNDARY violations (no command lists or build ordering found —
the document describes a finished system throughout). No blocking findings
remain.
