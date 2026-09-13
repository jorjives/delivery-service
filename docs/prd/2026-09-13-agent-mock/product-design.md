# Product design: Agent Mock (Roadmap Item 7)

Status: draft, pending critic approval. Team-derived, not human-confirmed (per
`review-log.md`).

This is a library/tooling product. There is no screen, no layout, no form
factor — "UX" here means the developer-facing API, how an adopter authors a
script and an expectation, what a failure message says when something goes
wrong, and what the testing guide teaches. Every design decision below is
judged against that, not against visual affordances.

## Vision

Today, testing a delivery-harness integration means either spending real API
credits against a live agent, or hand-rolling a hand-cast `AgentPort` double
that silences the exact type-checking (`invoke<R>`'s role/terminus
correlation) that would catch a wrong integration. Item 7 replaces both with
one first-class, adopter-facing testing seam: a harness extender scripts what
the agent does and says, runs their real gate and real closer against it, and
gets back a deterministic, zero-cost, zero-API-key proof that their pipeline
does what they think it does — including proof that it survives an agent
behaving badly.

The mock is not an internal test helper that happens to be reachable. It is
documented, typed, and supported exactly like the gate and closer interfaces
already are (`docs/writing-a-gate.md`, `docs/writing-a-closer.md`): a guide
that gets an adopter from nothing to a passing scripted run without reading
harness source.

## Personas

Source of truth: `docs/personas.md` (team-derived, not human-confirmed).

- **Primary: Priya Shah, Harness Extender.** Every journey below serves her.
  Item 5's phase named her goal as "trust that routing happens sensibly
  without her hand-holding each surface"; Item 7 is the DX that lets her
  *earn* that trust for her own gate/closer/role config before she ever runs
  a live surface, without reading `src/*.ts`.
- **Secondary: harness contributors writing the harness's own tests**
  (review-log, "Discovery survey"). This is *not* a new persona — the
  review-log names them explicitly as "same persona class" as Priya: an
  engineer comfortable with TypeScript who does not want to fight the type
  system to write a test. `docs/personas.md` is not extended for this phase;
  the contributor is Priya using the same seam on the harness's own codebase
  instead of hers, and the "honest doubles without casts" journey (J4 below)
  serves both identically. Forking a persona for an audience the review-log
  already collapsed into an existing one would be speculative, not derived.
- Marcus Webb and Dana Okafor (personas.md #2, #3) are not relevant to Item 7:
  neither reads triage packets or escalations produced by a *mocked* run any
  differently than a real one, and this phase adds no new artefact for them
  to read.

## Buy-vs-build lens

`claude-mock` (`/home/jorjives/dev/tools/claude-mock`) already exists,
already implements the exact seam `docs/agent-interface.md` says it fakes,
and is already exercised by this repo's own demos and skip-gated tests
(research.md §1.4-§1.6, §2). It is estate prior art in the strongest sense:
same team, same repo family, already the documented "relationship to the
mock" in `docs/agent-interface.md`. Re-deriving a second scripted-CLI fake, or
switching to an in-process port-level fake (Vercel AI SDK's
`MockLanguageModelV2`/`V3`, LangChain's `FakeListChatModel` — research.md §4),
would be hand-rolling a commodity this estate already solved, and would trade
away the one property that matters most for this seam: exercising the *real*
SDK code path (message parsing, tool transcript, structured-output
validation) so an SDK shape change breaks as a parse failure, not a silently
passing fiction (research.md §4's trade-off table). Item 7 does not
re-specify `claude-mock`'s internals (script format, journal shape, matching
rule) — it builds the harness-side wiring, packaging, and typed ergonomics
around a seam that already works. The competitive scan (research.md §4) found
no first-party alternative worth adopting instead.

Two things genuinely are this repo's to build, because no commodity solves
them:
1. **An honest, cast-free way to write a role-typed `AgentPort` double.**
   This is specific to *this* harness's `invoke<R>` generic signature; no
   external library has an opinion on it.
2. **Reaching `claude-mock` without a machine-local `npm link`.** A packaging
   decision the architect owns (research.md §5 lists four options); this
   document states the adopter-facing requirement it must satisfy, not which
   option wins.

## Derived minimum scope (assumed, not human-confirmed)

Carried forward from `review-log.md`'s "Intended shape", kept conservative —
the smallest set of capabilities that lets Priya complete her primary journey
(script a pipeline, run it, prove it, prove it survives misbehaviour) without
reading harness internals:

- A public, documented testing API for adopters (not an internal test-only
  helper).
- Honest, role-typed `AgentPort` doubles — no `as AgentPort["invoke"]` cast
  required to write one.
- A scripted end-to-end surface run (worker → gate → close) that runs the
  adopter's **real** gate and **real** closer against a temp repo, driven by
  a mocked agent, with no live API calls.
- `claude-mock` reachable from a plain `npm install` — no manual `npm link`
  step for any adopter.
- Journal-based assertions: what prompt the harness actually sent, and which
  scripted expectations were consumed.
- An unmatched or malformed scripted reply exercises the `INCOMPLETE_TERMINUS`
  path, provably, from a test.
- An adopter-facing "testing your delivery pipeline" guide, in the same style
  as `docs/writing-a-gate.md` and `docs/writing-a-closer.md`.

Nothing above this line is speculative: every clause maps to one of Item 7's
stated success criteria or DX note in
`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`.

## Primary journeys

Each cites the persona and goal it serves.

**J1 — Prove the happy path, end to end.** *Priya, primary goal: trust her
pipeline without hand-holding each surface.* Priya writes a `claude-mock`
script for her project's worker (one `write` effect plus a `completed`
envelope) and runs a full surface: her real gate measures the mocked change,
her real closer lands it. She asserts, from the journal, that the prompt the
harness sent contained her task's intent, and that no scripted expectation
was left unconsumed. No API key, no network, sub-second.

**J2 — Prove misbehaviour is handled, not just success.** *Priya, primary
goal: prove her pipeline escalates when the agent misbehaves* (brief's own
framing). Priya scripts a worker that emits `escalate` with category
`authority`, and separately a gate that fails after a scripted edit. She
asserts the surface reaches the escalation/retry path her `role_cfg` budgets
predict — without ever running a live agent that might or might not choose
to misbehave on cue.

**J3 — Fast unit tests for the gate/closer alone.** *Priya, same goal, but at
unit-test grain.* Priya does not want a subprocess per assertion. She builds
an honest in-process `AgentPort` double for just the role she's testing
around (e.g. `worker`), hands it a canned terminus, and asserts her gate's
verdict or her closer's report directly — no `claude-mock` binary involved,
no cast, full type-checking on the terminus shape for that role.

**J4 — Delete the cast.** *Harness contributor, same persona class as Priya.*
A contributor migrating one of the 23 existing `as AgentPort["invoke"]` sites
(research.md §1.3) replaces it with the new honest-double helper and deletes
the cast, with no behaviour change and no loss of type-checking — proving the
new API is a strict upgrade, not an alternative dialect.

**J5 — Diagnose a broken script quickly.** *Priya, goal: work this out
herself without asking a colleague* (mirrors her `docs/personas.md`
"understand why... without asking a colleague" bar). Priya's script has a
typo in `promptContains`; nothing matches. The failure she sees names what
the harness actually sent and which expectations were still waiting, so she
fixes her script from the failure message alone.

## Key developer-experience flows

**Two building blocks, one story.** The mock is not one API — it is the
existing `claude-mock` CLI seam (for real, end-to-end runs) plus a new
in-process honest double (for fast, unit-grain tests), unified by one guide
and one vocabulary, because Priya should never have to learn "which mock do
I use" as a separate decision from "what am I testing."

1. **The honest double, for unit-grain tests (J3, J4).** A role-keyed record
   — `{ worker?, triage?, "gate-maintenance"? }`, each entry typed to that
   role's own `Terminus` — mirrors the shape `RoleConfigs` already uses for
   real role configs (research.md §3 point 3: "the natural sibling"). One
   shared dispatch helper (written once, in a test-support module, per
   research.md §3 point 5) turns the record into a real `AgentPort`, with no
   cast anywhere a test author touches. Filling in only the roles a test
   exercises is enough; an un-filled role that gets invoked is a test setup
   bug, and should fail loudly rather than fall through to a stub.

2. **The scripted end-to-end run, for full-surface tests (J1, J2).** Priya
   points `createAgentPort`'s existing `SessionEnvironment` at `claude-mock`
   (already possible today per `docs/configuring-a-role.md`'s "Trying it
   offline") and wires the real gate and real closer alongside it, following
   the guide's worked example. The requirement this design places on
   packaging (architect's ledger, research.md §5): this must work after a
   plain `npm install`, with no global `npm link` step, from a fresh
   checkout or CI. `SessionEnvironment.pathToClaudeCodeExecutable` already
   accepts an arbitrary path, so whichever packaging option is chosen only
   needs to guarantee a resolvable path (e.g.
   `node_modules/.bin/claude-mock`) — the seam itself needs no change.

3. **Assertion helpers on the journal, not raw JSONL.** `claude-mock`'s
   journal is already the source of truth for what was sent and consumed
   (research.md §2.3). The guide teaches two named assertions rather than
   raw journal parsing: "assert the harness sent a prompt matching X" and
   "assert every scripted expectation was consumed" (the leftover-expectation
   check, MUST-tier per the derived scope). These read naturally in any test
   framework the adopter already uses; they are documentation and a thin
   convenience, not a new runtime.

4. **A typed expectation shape, SHOULD-tier.** Hand-writing raw `claude-mock`
   JSON (`{"json": {"status": "completed", "rationale": "..."}}`) risks a
   typo the mock cannot catch until run time. Because every role's envelope
   is already a zod schema (`docs/agent-interface.md`'s "Schema definition
   mechanism"), a thin builder that validates a scripted reply against the
   *same* schema the harness will validate at run time catches a malformed
   script at author time instead of at assertion time. This is optional
   value above the floor: the raw JSON format works without it and remains
   the documented fallback.

## Accessibility of docs and messages

The bar this repo has already set (`docs/configuring-a-role.md`,
`docs/writing-a-gate.md`, `docs/writing-a-closer.md`) is "no source-reading
required," and the new guide holds the same bar:

- Plain English, one worked example per concept, runnable with `npx tsx`
  exactly like the existing guides.
- Every failure message names the *fix*, not the mechanism: "the harness sent
  a prompt that matched no scripted expectation; here is what it sent" reads
  the same register as the existing "a sentence naming the role, the tool,
  and that the boundary worked as intended" pattern the agent-interface
  already commits to for `INCOMPLETE_TERMINUS`. No stack traces, no raw zod
  validation dumps, in any adopter-facing message this design adds.
- The guide is additive to, not a replacement for, `docs/configuring-a-role.md`'s
  existing "Trying it offline" section — that section stays the single-role
  quickstart; the new guide is the full-surface (worker → gate → close)
  companion the roadmap's DX note asks for.

## Empty, loading, and error states

For a library, these are the failure and boundary conditions a script author
hits, not screens:

| State | What happens | What the adopter sees |
|---|---|---|
| No scripted expectation matches the prompt sent | `claude-mock` returns an error result (existing behaviour, research.md §2.3) | The assertion helper's failure message shows the actual prompt sent and the remaining unconsumed expectations, so the fix is visible without re-running with debug logging |
| Scripted reply is malformed or violates the role's envelope schema | The harness's own validation fails it | `INCOMPLETE_TERMINUS`, with the existing plain-English rationale (`docs/configuring-a-role.md`'s "replied in the wrong shape") — this path is a *feature* to test against (J2), not a bug to hide |
| Script left expectations unconsumed at the end of a run | The journal's `finished` event lists them (existing behaviour) | The "assert everything was consumed" helper fails naming which expectations were never matched, by index and `when` clause |
| `claude-mock` is not resolvable (packaging misconfigured) | `pathToClaudeCodeExecutable` cannot be spawned | A named, first-line fix ("`claude-mock` was not found at `<path>`; run `npm install`" or equivalent for the chosen packaging option) — never a raw `ENOENT`/spawn stack trace |
| An honest double is invoked for a role nobody filled in | The dispatch helper has no handler for that role | A thrown error naming the missing role and the test file's own responsibility to fill it in — fails the test loudly, never silently returns a wrong-shaped terminus |
| Tool-authority refusal (out-of-role tool call) | Not modelled by the mock at all (stated gap, research.md §1.8, §2.5) | The guide says so explicitly, pointing at the harness's own direct unit tests of the `canUseTool` decision as where that guarantee is actually tested — no adopter should believe the mock proves this and be wrong |

The last two rows matter as much as the first four: an honest testing seam
must be honest about what it *cannot* prove, not just what it can.

## Success metrics

- **Time to first green scripted end-to-end test**, from a fresh `npm
  install` on this repo (or an adopter's own repo depending on `claude-mock`
  as a dependency), with zero manual `npm link` steps and zero API key
  configuration. This is the single number that proves the packaging
  requirement was met, not just designed.
- **Zero remaining `as AgentPort["invoke"]` casts** across `src/`, `demos/`,
  and `tests/` (23 sites counted in research.md §1.3) once existing tests are
  migrated to the honest-double helper — mechanically checkable by grep.
- **No mock-gated suite silently skips in CI.** Today, `describe.skipIf` and
  `isOnPath` checks (research.md §1.4) mean a plain `npm install` runs zero
  real-invocation-seam coverage. Post-Item-7, CI should run these suites for
  real, every time.
- **A first failure message is enough.** An adopter debugging an unmatched
  expectation or a leftover expectation fixes it from the assertion failure
  text alone, without opening `claude-mock`'s own source or this harness's.

## Operability / DX lens

- **Environment.** Node ≥ 20 (matching `claude-mock`'s own `engines` field,
  research.md §2.2) with `npm`; no additional runtime beyond what this repo
  already needs. The honest double has zero new runtime dependencies — it is
  TypeScript over the existing `AgentPort`/`RoleTerminusMap` types.
- **Local-run story.** `npx tsx` for one-off scripts, matching every existing
  guide's convention; the full end-to-end journey (J1/J2) runs as an ordinary
  test-runner test once `claude-mock` is a resolvable dependency rather than
  a global link — no bespoke CLI or launcher this design introduces.
- **Verified by.** The honest double is verified by TypeScript itself (no
  cast compiles to no cast — a `tsc --noEmit` check that greps clean for `as
  AgentPort["invoke"]` outside the one production dispatch site is a
  legitimate, cheap CI gate). The end-to-end journey is verified by the
  journal's own `matched`/`unmatched`/`finished` events, already emitted by
  `claude-mock` today with no new instrumentation needed.
- **Deploy target.** None — this ships as part of the harness's own package
  (or its own devDependency reference to `claude-mock`, per whichever
  packaging option the architect selects). Nothing here runs in production;
  it exists entirely inside adopters' and this harness's own test suites and
  CI.
- **Scaffolding.** No new demo *framework* is needed — the existing
  `npm run demo:*` convention (`demos/*.ts`, one file per behaviour, per the
  pattern already used for gate, closer, and agent-invocation demos) is the
  right home for a "full surface, scripted, no API calls" demo. This is
  reuse of an existing pattern, not new scaffolding.

## MUST / SHOULD / COULD

**MUST** (the derived floor, restated as shippable capabilities):
- Public, documented testing API: the honest double helper, exported from the
  harness's entry point alongside `RoleConfigs`/`createAgentPort`.
- `claude-mock` reachable from a plain `npm install`, no `npm link`.
- A worked, adopter-facing "testing your delivery pipeline" guide covering
  both building blocks (unit-grain honest double, full-surface scripted run).
- Journal-based "what was sent" / "what was consumed" assertion helpers.
- A worked example of an unmatched/malformed reply exercising
  `INCOMPLETE_TERMINUS`, in the guide and as a demo.
- Migration of at least the harness's own hand-rolled doubles (or a clear
  statement that they are migrated incrementally) so the new API is proven
  against real, not hypothetical, usage.

**SHOULD:**
- A typed expectation builder validated against each role's own zod envelope
  schema, catching a malformed script at author time.
- A CI check that fails on any new `as AgentPort["invoke"]` cast outside the
  one named production dispatch site.
- A demo mirroring J2 (misbehaviour → escalation) alongside the happy-path
  demo, since "prove it escalates" is named explicitly in the brief.

**COULD:**
- A `delayMs`-driven demo showing the mock's timing knobs in a budget-related
  scenario (e.g. showing a scripted retry sequence's ordering, per the
  "nudge case is ordering, not call counts" note in research.md §2.3).
- Tooling to auto-generate a starter `claude-mock` script from a project's
  `RoleConfigs` (scaffolds the envelope shape the agent must emit) — genuinely
  useful, but speculative until an adopter asks for it.

**Non-goals** (explicit, from the review-log and this design's own scope):
- Re-specifying or modifying `claude-mock`'s internals (script format,
  journal shape, matching rule, effect application) — it is reuse-estate,
  not this phase's to redesign.
- Modelling tool-authority (`allowedTools`/`canUseTool`) inside the mock.
  Stated, known gap (research.md §1.8, §2.5); the real runtime remains the
  only place that guarantee is actually tested. This design does not attempt
  to close it.
- Multi-surface interleavings (Item 10's territory).
- The CLI (Item 8's territory).
- Publishing `claude-mock` to a public npm registry, or any change to its
  license/visibility beyond what internal-estate reuse needs — an external
  distribution decision nobody has asked for yet.
