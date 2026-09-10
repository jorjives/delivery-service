# Product Design: Triage and Deterministic Router

Grounding: `docs/prd/2026-09-10-triage-and-router/research.md`,
`docs/single-surface-control-flow.md` §Triage, `docs/agent-interface.md`,
`docs/prd/2026-09-10-triage-and-router/review-log.md` (phase selection and
MUST/SHOULD/COULD shape), `docs/personas.md` (this run's persona derivation),
`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md` Item 5. Every
factual claim below is either restated from the mechanism spec or cited to a
`research.md` finding; nothing here re-derives SDK facts or invents new claims
about the codebase.

## Personas

Full derivation in `docs/personas.md` (team-derived and assumed, not
human-confirmed). Summary, referenced throughout below by name:

1. **Priya Shah — Harness Extender.** Configures triage's `role_cfg`, reads
   `triage` log entries to understand routing decisions, tunes budgets.
2. **Marcus Webb — On-call Engineer (technical triage reader).** Reads an
   `EscalationPacket` cold, decides what a human must do, without reading
   transcripts. The MUST-tier reader.
3. **Dana Okafor — Non-technical Project Owner.** Wants a plain-language
   verdict on whether an escalation needs her. The COULD-tier reader (Item
   11 builds her full reporting surface; this item's obligation is narrower —
   see the escalation-packet accessibility section below).

## Vision

Today (`research.md` §1) `TriagePort` is a pure lookup table: trigger →
budget check → helpful verdict or escalate, with no synthesis and no
judgement. Two things are true and load-bearing for what this phase adds:

- **The deterministic router stays.** It already implements the roadmap's
  "simple gate failures with remaining budget route back to the worker
  without an agent call" success criterion, and the review-log's MUST tier
  explicitly retains it. This phase does not replace `router.ts`; it adds an
  agent path alongside it for the triggers that need judgement.
- **The wiring for richer artefacts already exists, unused.** `TriageEntry.artifactRef`
  is a generic ref pointer today holding an unvalidated stub (`research.md`
  §1, §5); `DispatchEntry.briefRef` exists in the schema but nothing populates
  it (`research.md` §3). This phase's job is largely to fill in slots the
  prior phase already reserved, not to invent new persistence.

For **Priya**, this phase delivers a triage `role_cfg` (read-only: `Read`,
`Glob`, `Grep`, per `agent-interface.md`'s roles table) she configures the
same way she already configures worker/gate-maintenance, plus a router that
keeps the cheap path cheap — she does not pay an agent call for every gate
failure, only for the triggers that carry real judgement (worker escalate,
gate error, the cap boundary).

For **Marcus**, this phase delivers an `EscalationPacket` that states the
decision he must make, backed by verbatim gate evidence and the `dead_ends`
of what already failed — so he can act from the case file alone, matching
the Item 3 DX principle ("error messages are the user's primary debugging
surface") extended to triage's own output.

For **Dana**, this phase's obligation is narrow and explicitly COULD-tier
per the review-log: an escalation packet that does not actively block or
mislead a non-technical reader who happens to open it, not a fully authored
non-technical experience (that is Item 11's).

## Derived minimum scope (assumed, not human-confirmed)

Recorded in `docs/prd/2026-09-10-triage-and-router/review-log.md` by the
team-lead before this team was spawned; restated here because the critic
must scrutinise it directly against the personas above, and because it is
the floor this document's MVP tier builds on, not a ceiling.

> MUST: triage agent role via the existing invocation primitive with
> read-only authority and a triage-only verdict vocabulary; deterministic
> fast path retained for judgement-free cases; `SharpenedBrief` payload
> reaching the next worker dispatch with verbatim gate evidence;
> `EscalationPacket` payload persisted for human review; prior triage
> rationales fed into later rounds; authority-class pass-through and
> exhaustion-class overrule-down preserved; close-triage restricted to
> `retry_close`/`escalate`; a defined, safe outcome for invalid triage
> output; crash-safe replay of triage.

Checked against the personas: this floor gets Priya a working triage role
and a router that stays cheap; it gets Marcus a packet with real content
(not a stub); it does **not**, by itself, get Dana anything — her bar is
explicitly COULD-tier (plain-language summary), and the review-log is
correct to place it there: without a working packet first, a plain-language
gloss on top of nothing has no content to summarise. The floor is therefore
internally ordered correctly — Marcus before Dana — and is not padded with
anything Priya or Marcus don't need to complete their journey. One place
this document extends past a literal reading of the floor: "a defined, safe
outcome for invalid triage output" is treated below as requiring the same
`INCOMPLETE_TERMINUS`-style discipline (state + cause + next-action, no raw
SDK error) the agent-interface doc already demands for worker/gate-maintenance
— not a new, weaker bar invented for triage specifically.

## Primary journeys

### Journey A — Priya configures triage and trusts the fast path

*Persona: Priya Shah. Goal: wire triage once, trust routing without
per-surface hand-holding.*

1. Priya copies the reference `triageRoleConfig` (read-only tools, per
   `research.md` §7's confirmation that no new authority mechanism is
   needed beyond a new `allowedTools` list) the same way she already copies
   the worker/gate-maintenance reference configs (`docs/configuring-a-role.md`
   precedent).
2. She does not need to reason about when the agent runs versus when the
   deterministic table alone decides — the boundary is spec'd, not
   discovered: `gate_fail` with budget remaining is deterministic, always
   (matches the review-log's MUST and the roadmap's cost-control framing).
   `worker_escalate`, `gate_error`, and the budget-cap boundary are the
   triggers that engage the agent (aligned with the architect; see
   Architecture decisions below).
3. When a surface loops or she wants to understand a routing decision, she
   reads the case file's `triage` log entries (`verdict` + `rationale` +
   `artifactRef`, unchanged shape per `research.md` §1) — she does not need
   to read `src/router.ts` or a new triage-specific source file to
   understand what happened.

**End-to-end means**: Priya can wire triage, understand its two paths
(deterministic / agent), and debug a routing decision from the case file
alone, using only the reference `role_cfg` and (SHOULD-tier) a
"configuring triage" guide chapter — not by reading `src/*.ts`.

### Journey B — Marcus reads an escalation packet cold

*Persona: Marcus Webb. Goal: decide what a human must do, from the packet
alone.*

Covered in detail as the "escalation handoff" key flow below. Summary:
Marcus opens a case file at `ESCALATED`, reads the `EscalationPacket`
behind the terminal `triage` entry's `artifactRef`, and can state the
decision being asked of him, the evidence behind it (verbatim), and what
already failed (`dead_ends`) — without reading a prior session transcript.

### Journey C — a fresh worker receives a sharpened brief

*Persona: none directly (the reader is an agent session), but the journey
exists to serve Priya's goal of "retries are informed, not blind
re-dispatch" (review-log's stated user value) and is a precondition for
Marcus's journey ever reaching a good escalation rather than a premature
one.* Covered in detail as the "retry with sharpened brief" key flow below.

## Key flows

### 1. Retry with a sharpened brief

**Trigger**: triage verdict is `reroute`, produced **by the agent path
only**. This flow does not apply to a deterministic-router reroute.

**Scoping this explicitly, because it is a real fork, not wording**:
`single-surface-control-flow.md` §Triage is precise that a `SharpenedBrief`
is "one agent call, structured output" and that the deterministic path is
"reroute with the raw delta and appended history. **No agent call.**" A
lookup table has no basis to write `problem`, `dead_ends`, or a `diagnosis`
hypothesis — those require judgement the table doesn't have. So:

- **A deterministic-router reroute** (plain `gate_fail` or plain
  `worker_escalate`-exhaustion, budget remaining, no judgement needed)
  produces exactly what it produces today: a rationale string in the
  `TriageEntry`, and `DispatchEntry.briefRef` stays unset (`research.md`
  §3's own wording — "a brief payload" — already implies a reroute without
  one is legal). No new artefact, no new cost. This matches the "Fast path
  with no judgement needed" empty-state bullet below verbatim.
- **An agent-path reroute** (triage engaged the agent because the trigger
  needed judgement — see the deterministic/agent boundary in Journey A)
  produces a real `SharpenedBrief` and populates `briefRef`. Everything
  below in this flow describes this case only.

**What happens on an agent-path reroute** (grounded in `research.md` §2–3):

1. Triage writes its verdict's artefact to `refs/triage-${n}.json` (existing
   keying convention, `surface.ts:563`), then appends the `TriageEntry`
   pointing at it — ref-then-entry ordering already in place and unaffected
   by richer payload content (`research.md` §2, crash leaves an orphan ref,
   never a dangling entry).
2. On the next dispatch, `dispatchSession()` (`surface.ts:200-232`) must
   pass the new ref through as `DispatchEntry.briefRef` — the schema field
   already exists (`schema.ts:118`) and is currently always empty
   (`research.md` §3). **This is the one concrete wiring gap this flow
   closes**: today an agent-path reroute produces a brief that nothing
   forwards to the dispatch record, so `resolveEvidence()` can't find it.
3. The fresh worker's prompt renders the brief in the `## Brief` slot and
   the verbatim newly-failing assertions in the always-present
   `## Gate evidence` slot (`prompt-assembly.ts`, `research.md` §3) — two
   separate slots, not one merged blob, so the worker sees ground truth and
   triage's read as visibly distinct sources.

**Design decision this document takes** (resolving `research.md` open
question §10.2): `SharpenedBrief.evidence` does **not** re-carry the
newly-failing assertions. `## Gate evidence` already renders them verbatim,
unconditionally, on every worker dispatch, brief or no brief
(`prompt-assembly.ts:70-75`) — duplicating them inside the brief would
either drift from the gate's own copy over multiple rounds or force a
second verbatim-copy invariant to maintain for no reader benefit. The brief
instead carries exactly what the gate-evidence slot cannot: `problem`,
`dead_ends`, `scope`, `references`, `diagnosis` (flagged as hypothesis).
This keeps `SharpenedBrief`'s schema smaller and keeps "synthesis augments
evidence, never replaces it" true structurally (the worker literally cannot
receive triage's read without also receiving the verbatim delta in the same
prompt) rather than true only by convention.

**Why this matters to Priya**: `dead_ends` is, per the control-flow doc,
"the one thing a fresh reconstructed session cannot derive for itself" —
it's the field that makes a second attempt actually different from a blind
re-dispatch, which is the roadmap's stated user value for this whole item.

### 2. Escalation handoff

**Trigger**: triage verdict is `escalate` (agent-decided, budget-exhausted,
or authority-class pass-through).

**What the packet must contain, in order, for Marcus** (grounded in
`single-surface-control-flow.md` §Triage's `EscalationPacket` job and the
prior-art synthesis in `research.md` §9 — escalation literature converges
on "goal, what has been attempted, what is likely required next"):

1. **The decision being asked of a human** — stated as a decision, not a
   status ("approve deleting the staging database" / "provide a credential
   for X" / "no budget remains, judge whether to keep trying manually"),
   never merely "escalated."
2. **Verbatim evidence** — the newly-failing gate assertions or the
   worker's own escalate rationale, unparaphrased, matching the brief's own
   rule.
3. **`dead_ends`** — what prior attempts tried and why it missed, carried
   the same way it feeds a `SharpenedBrief` (the control-flow doc names
   triage's job as one skill serving two audiences — this is the shared
   half).
4. **Why now** — which trigger and budget state forced the escalation
   (authority pass-through vs. exhaustion-at-cap vs. gate-error-at-cap are
   different situations and should read differently, not collapse to one
   sentence).
5. **`session_key` references** for Marcus to pull a transcript if the
   packet genuinely isn't enough — pull, not push, matching the control
   flow doc's existing session-key philosophy (never auto-attach a full
   transcript).

**End-to-end means for Marcus**: he can state the decision, the evidence,
and what already failed, from the case file alone — no source access, no
colleague consulted, matching this item's success metric below.

### 3. Close-triage

**Trigger**: a `close_failure` (`CLOSING` → `TRIAGE`).

**Product requirement**: the roadmap's success criterion — "close-failure
triage offers only `retry_close` or `escalate` (no reroute)" — must be
**structurally enforced**, not left to the triage agent's system prompt.
`research.md` §2/§10.4 found this has no code path today: nothing stops a
`close_failure` trigger from receiving a `reroute` verdict except the
router's own table happening not to emit one, and an agent-backed triage
introduces exactly the risk a prompt-only constraint can't close (a
confused or adversarial triage session emitting an out-of-scope verdict).
This mirrors the exact reasoning `agent-interface.md` already applies to
worker/triage envelope statuses generally ("a worker that emits `reroute`
produces an *invalid* envelope... this closes a real exploit"): the same
discipline must extend to *per-trigger* legal verdicts, not just per-role
legal statuses. Concretely, this means a `close_failure` triage call whose
resulting verdict is not in `{retry_close, escalate}` is treated as invalid
triage output (see flow 5) — the work already lives in the same trigger
that later routes it, so "close is already accepted, correct, and infra-
class only" (control-flow doc, Close interface) holds by construction, not
by convention.

### 4. Authority pass-through

**Trigger**: `worker_escalate` with `category: "authority"`.

**Product requirement**: unconditional, and this is the one place this
phase's agent path must not add discretion where the deterministic router
already removes it. The existing router's own comment states the reasoning
precisely (`router.ts:32-34`): "An authority limit is the worker's own
judgement that no retry can help. Nothing in a lookup table is entitled to
overrule it, and no budget makes it retryable." **This stays true when the
agent path replaces the table**: an authority-class escalate must be
checked and passed through *before* any triage agent call is made, exactly
as it is checked before the deterministic table today — not handed to the
triage agent as one more input it could theoretically overrule. This is
not a new product requirement; it is a preservation requirement, called out
because it is the one behaviour this phase could regress by routing
everything through "ask the agent" once an agent path exists.

### 5. Invalid triage output

**Trigger**: the triage agent's session ends without a valid, legal,
schema-conforming envelope, or (per flow 3) with a legal-but-out-of-scope
verdict for its trigger.

**Product requirement**: this must resolve to a **defined, safe outcome**,
stated at the same bar `agent-interface.md` sets for `INCOMPLETE_TERMINUS`
generally — state + cause class + what happens next, never a raw SDK
exception (this document's one deliberate extension past a literal reading
of the review-log's MUST wording, justified above). Concretely:

- No valid envelope, malformed payload, or illegal status for triage → the
  same `INCOMPLETE_TERMINUS`-shaped terminus the other two roles already
  produce (the mechanism doc's terminus-mapping table is role-general, and
  `research.md` §4 confirms nothing SDK-specific is needed beyond what
  Item 4 already wired).
- A legal envelope with a **verdict illegal for its trigger** (flow 3's
  case, and more generally: `fix_the_gate` for a non-`gate_error` trigger,
  or any verdict the mechanism doc doesn't license for that trigger) is
  treated the same way — an invalid triage output, not a silent misroute.
  This is the same "strict at the boundary" principle `agent-interface.md`
  already applies to worker statuses, extended to triage's per-trigger
  verdict legality.
- **The safe outcome is escalate, never a default reroute.** A reroute
  burns a correction slot and dispatches a fresh worker on triage's own say-
  so; defaulting an ambiguous or invalid triage result to "try again" risks
  masking a genuine problem as a retry loop, the same risk the flaky-test
  prior art (`research.md` §9) warns against ("automatic retries can mask
  genuine regressions"). Escalating on invalid triage output costs a human
  a look; defaulting to reroute costs nothing until the correction budget
  is silently exhausted on a triage bug.

This closes `research.md`'s open question §10.3 (where is the payload
schema validated) as a corollary: validation must happen before the
verdict is acted on — i.e. at the point the harness turns the agent's
envelope into a `TriageVerdict` — because that is the only point that can
produce the "invalid → safe escalate" outcome this flow requires. Whether
that is also enforced again at `writeRef`/`readRef` is an implementation
choice for the architect; the product requirement is that it happens
*before* a verdict is acted on, not that it happens at a specific file.

## Escalation packet: accessibility for a non-technical reader

Per the review-log, a plain-language summary for Dana is explicitly
**COULD**-tier for this item (it "feeds Item 11"). This document's product
requirement at the MUST tier is narrower and deliberately so: the packet
built for Marcus (flow 2) must not contain anything that actively misleads
or blocks Dana if she is the one who opens it — no raw stack traces, no bare
internal enum values presented as the entire message (matching the same "no
stack trace" bar the roadmap already sets in Item 3's DX principle, applied
here to the packet's own prose fields, which are human-authored strings by
construction since they come from an LLM's `rationale`/`problem`/`diagnosis`
fields, not a machine error dump).

At the SHOULD/COULD tier, this document specifies what a future
plain-language layer (this item, if time allows, or Item 11) should add on
top rather than instead of the technical packet: one short, jargon-free
sentence stating what happened and what decision is being asked, prepended
to (not replacing) the technical content Marcus needs. This is deliberately
additive — Marcus's packet does not get diluted to serve Dana; Dana gets a
layer on top when it ships.

## Empty / error states

- **No prior triage rounds** (first `TRIAGE` entry for a surface): the
  agent's prompt has no prior rationale to read. The control-flow doc's
  input contract already lists "prior triage rationales" as an optional
  accumulating input, not a required one — the triage prompt template
  renders a fixed "no prior triage rounds" sentence rather than an empty
  section, matching the worker prompt's existing "no brief" sentence
  pattern (`prompt-assembly.ts`, `research.md` §3).
- **Fast path with no judgement needed**: no agent call, no artefact beyond
  the router's existing rationale string — this is not a degraded case, it
  is the intended common path and must stay indistinguishable in cost from
  today's deterministic-only router.
- **Invalid triage output**: covered by flow 5 above — always escalate,
  never a silent default.
- **Budget exhausted at the moment triage would otherwise ask the agent a
  question**: per the control-flow doc, "remaining budgets" is one of the
  two load-bearing triage inputs specifically because "with one slot left,
  a clean escalation beats a long-shot reroute" — the packet in this case
  should say plainly that no budget remains, not just that triage decided
  to escalate, so Marcus knows a human decision is now load-bearing, not
  optional.
- **Corrupted or unreadable artefact ref** (`readRef` throws
  `CorruptCaseFile`, `research.md` §5): this is an existing case-file-level
  failure mode, not new to this item; this document does not add a new
  recovery path for it beyond what `case-file.ts` already does, since
  nothing about triage's payload richness changes the ref layer's own
  integrity guarantees.

## Non-goals

- **Real closers** (Item 6) — close-triage routes to `retry_close`, it does
  not implement what a retry does.
- **CLI** (Item 8) — no command-line surface for inspecting triage output;
  the case file JSON is the only interface this item ships.
- **Multi-surface / breaker** (Item 10) — this item's escalation and
  budgets are per-surface, as today.
- **Reporting surface** (Item 11) — Dana's full plain-language experience,
  dashboards, and any cross-run view of escalation rates are explicitly
  out of scope; this item only ensures the underlying packet has legible
  content for such a surface to eventually format.
- **The `gate_error` agent-free re-check fast path** — reserved (`gateError`
  budget, unused since Item 3) but SHOULD-tier per the review-log, not
  MUST. See Architecture decisions below for this document's position on
  shipping it.
- **A declarative/natural-language authoring surface for triage's `role_cfg`**
  — Priya writes it as code/config, matching Item 4's identical non-goal
  for worker/gate-maintenance (`docs/prd/2026-09-09-agent-invocation-primitive/product-design.md`).

## MVP capability set

### MUST

1. **A `triageRoleConfig`** (read-only: `Read`, `Glob`, `Grep`, per the
   roles table) an extender can adopt unmodified or copy, matching the
   existing worker/gate-maintenance reference pattern (Journey A).
2. **The deterministic router is retained as the first check**, unchanged
   in behaviour for `gate_fail` with budget remaining and for the
   authority-class pass-through (flow 4) — the agent path is additive, not
   a replacement of the cheap path.
3. **`SharpenedBrief` reaches the next worker dispatch, on an agent-path
   reroute.** This requires closing the concrete wiring gap `research.md`
   identifies: `dispatchSession()` must populate `DispatchEntry.briefRef`
   on an agent-path reroute (flow 1, step 2) — without this, "the sharpened
   brief carries verbatim gate evidence" (roadmap success criterion) has no
   path to the worker at all, regardless of how well-formed the brief's own
   schema is. A deterministic-router reroute is unaffected and continues to
   produce only its existing rationale string (flow 1's scoping note) —
   this MUST item does not require the deterministic router to synthesise
   a brief.
4. **`EscalationPacket` persisted with real content** (flow 2's five
   elements: decision, verbatim evidence, dead_ends, why-now, session
   references) — not the current stub.
5. **Prior triage rationales feed later rounds** — the empty-state fallback
   above for round one, and the accumulating input for round two-plus, per
   the control-flow doc's input contract.
6. **Authority pass-through preserved exactly** (flow 4) — checked before
   any triage-agent call, not delegated to it.
7. **Close-triage structurally restricted** to `retry_close`/`escalate`
   (flow 3) — a legal-verdict-per-trigger check, not a prompt instruction
   alone.
8. **Invalid triage output resolves to a safe, defined outcome** — escalate,
   never a default reroute, with a state+cause+next-action message (flow 5).
9. **Crash-safe replay of triage** — preserved from today's read-only-until-
   the-single-append discipline (`research.md` §2); an agent-backed triage
   must not introduce any side effect before the `TriageEntry` append, the
   same recoverability property the control-flow doc already states
   verbatim for triage generally.

### SHOULD

- Reference triage `role_cfg` accompanied by a "configuring triage" guide
  chapter (mirrors Item 2/4/6's established pattern; Journey A's "no
  source-reading" bar depends on this existing, not just the config).
- The `gate_error` agent-free re-check verdict and `gateError` budget use
  (reserved since Item 3, review-log SHOULD-tier). Product position: ship
  it if the architect's implementation cost is low, because it is the
  cheapest way to keep the fast-path/agent-path cost split honest for a
  trigger class (`gate_error`) that today pays the same cost as
  `worker_escalate` despite usually needing no judgement at all — but this
  document does not treat it as blocking Marcus's or Priya's primary
  journey, both of which are already served by routing `gate_error` to the
  agent path (flow described in Journey A) if the re-check doesn't ship
  this phase.
- A runnable demo (matching the review-log SHOULD and the established
  Item-2/4/6 pattern of a working example alongside the guide).

### COULD

- Plain-language summary layer on the `EscalationPacket` for Dana (feeds
  Item 11, per the escalation-packet accessibility section above).

## Success metrics

- **Priya (harness extender)**: can go from "no triage `role_cfg`" to "a
  working triage invocation returning a typed verdict" using only the
  reference `triageRoleConfig` and (SHOULD) the guide — zero reads of
  `src/router.ts`, `src/surface.ts`, or `agent-interface.md` during that
  path. Verifiable the same way Item 4 verified its analogous metric: a
  cold-start walkthrough test, not self-report.
- **Marcus (on-call reader)**: given a case file at `ESCALATED`, can state
  (a) the decision being asked of him, (b) the evidence behind it, and (c)
  what already failed — using only the case file's `EscalationPacket`, no
  source access, no transcript pull required for the common case.
- **Fast path stays cheap**: an automated test proves a plain `gate_fail`
  with budget remaining produces zero agent invocations — the deterministic
  router's existing behaviour, regression-tested once an agent path exists
  alongside it (this is the concrete, testable form of "simple gate
  failures... route back... without an agent call").
- **Close-triage legality is enforced, not just documented**: an automated
  test proves a triage agent emitting `reroute` for a `close_failure`
  trigger produces an invalid-triage-output outcome (flow 5), not a
  silent misroute — this is the roadmap's own success criterion made
  concrete as a regression test, mirroring how Item 4's product-design
  turned "a worker cannot emit triage-only statuses" into a named test
  obligation.
- **An agent-path reroute genuinely differs from a blind re-dispatch**: an
  automated test proves that, for a reroute the *agent* produced, the next
  attempt's assembled prompt contains the prior round's `dead_ends` content
  (not merely that a brief object exists) — the roadmap's stated user value
  ("retries are informed") is otherwise unfalsifiable for the cases where a
  brief exists at all. This metric does not apply to a deterministic-router
  reroute, which carries no brief by design (flow 1).

## Buy-vs-build

- **Structured output / schema definition for `SharpenedBrief`/
  `EscalationPacket`/`GateRepairBrief`/`CloseRepairBrief`**: buy — reuse
  zod, already the codebase's pattern for exactly this class of problem
  (`research.md` §8), converted to JSON Schema via the same
  `z.toJSONSchema()` bridge Item 4 already established. No new schema
  library; `ajv`/`joi`/`yup` etc. would validate the same data twice with
  no gained guarantee (`research.md` §8).
- **Invocation mechanism**: reuse the existing invocation primitive and
  tool-authority machinery (`agent-invoke.ts`, `tool-authority.ts`) rather
  than a bespoke triage caller — `research.md` §7's conclusion is that "the
  SDK offers nothing triage-specific to design against beyond what Item 4
  already wired up." Whether triage goes through a role-widened
  `AgentPort.invoke()` or a separate `TriagePort` implementation that wraps
  `invoke()` internally is the architect's call (`research.md` §10.1 is the
  single highest-leverage open question, explicitly not a product
  decision) — this document's position, stated for the architect's
  benefit: either resolution is acceptable to both personas above, because
  neither Priya's nor Marcus's journey depends on which internal seam
  carries the call, only on the observable contract (a typed verdict, a
  legible packet, enforced authority). See Architecture decisions below.
- **Prior art in the estate**: this item's "one interface, variable
  subject" shape for a triage role config is the same shape the gate and
  close interfaces already use, and the same shape Item 4 already applied
  to worker/gate-maintenance — conforming to it rather than inventing a
  differently-shaped triage-specific config is the established internal
  pattern (`agent-interface.md`'s own framing, echoed in `research.md` §4
  and Item 4's product-design "One shape across roles" buy-vs-build entry).
  No case in this item's scope calls for a new external dependency.

## Operability / DX

- **Local-run story**: Priya develops and verifies triage `role_cfg`
  against `claude-mock` before spending a real API call, exactly as
  worker/gate-maintenance already do (`research.md` §6). Triage's read-only
  authority means its mock scripts need **no** `write`/`edit` effects at
  all — a smaller mock surface than the worker/gate-maintenance tests
  already exercise, worth stating explicitly as a DX win of choosing a
  read-only role.
- **Test structure**: follow the existing three-tier pattern
  (`agent-invoke.test.ts`, `research.md` §6) — mock-gated behavioural
  tests, a determinism test (byte-identical prompt across two invocations
  from the same case file, extended to triage's own prompt), and a pure
  `buildSessionOptions`/role-config test needing no mock at all for
  authority wiring.
- **Known gap, stated not papered over**: `claude-mock` does not enforce
  `allowedTools` (`research.md` §6). A test asserting "triage cannot write
  files" is provable only via a unit test on `triageRoleConfig.allowedTools`
  and `tool-authority.ts`'s deny behaviour, not via a mock-scripted attempted
  write being refused — same known gap Item 4 already documented for its
  own roles, now extended to triage.
- **Deploy target**: none — this is a library-level extension of the same
  in-process seam Item 4 shipped (`ports.ts`'s `TriagePort`/`AgentPort`),
  consumed by the state-machine driver. No new deployment surface.

## Architecture decisions this document depends on

One open question is explicitly the architect's, not this document's, per
`research.md` §10.1 and confirmed by direct coordination (`SendMessage` with
architect, this session): **does `TriagePort`'s real implementation call a
role-widened `AgentPort.invoke()`, or wrap `invoke()` behind a separate
interface, keeping `Terminus` untouched?** The architect's current plan
(shared during this design) is a role-keyed result-type map so worker/
gate-maintenance's `Terminus` is unchanged and triage gets its own
`TriageTerminus`. This document takes no position on which shape wins,
because neither persona's journey depends on it — see Buy-vs-build above.
What this document does hold firm regardless of the architect's mechanism:
the product-facing packet/brief content (flow 1's fields, flow 2's five
elements) is unaffected by which internal seam produced them, and the
`triage` log entry's existing `verdict`/`rationale`/`artifactRef` shape
(`research.md` §1) does not change — only the *source* of a non-fast-path
verdict does (agent, not just table lookup), confirmed with the architect
directly as consistent with this document's flows.

The architect's proposed agent-engagement boundary — deterministic for
plain `gate_fail` with budget remaining, agent-engaged for `worker_escalate`,
`gate_error`, and the cap boundary — matches this document's Journey A and
the review-log's cost-control framing exactly, confirmed via direct
coordination. This document does not require the alternative ("always ask
the agent past attempt N by history depth") as MVP scope; the control-flow
doc itself names that as a tuning knob, not a requirement, and neither
Priya's nor Marcus's primary journey needs it to succeed.

## Still open (genuinely deferred, not this phase's to default)

- **Whether `SharpenedBrief`/`EscalationPacket` validation happens at
  `writeRef`, at the point the harness turns an agent envelope into a
  verdict, or both** — this document requires validation to happen
  *before* a verdict is acted on (flow 5), but the specific file/function
  is the architect's implementation choice.
- **The `gate_error` agent-free re-check verdict's exact shape** if it
  ships this phase (SHOULD-tier) — the budget population and its intent
  are already named (`research.md` §1), the verdict's schema is not.
