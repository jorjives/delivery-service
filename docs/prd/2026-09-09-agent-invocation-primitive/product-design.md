# Product Design: Agent Invocation Primitive

Grounding: `docs/prd/2026-09-09-agent-invocation-primitive/research.md`,
`docs/agent-interface.md`, `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`
(Item 4, "Two audiences"), `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`.
Every claim below either restates something the mechanism spec already settles or is cited to a
research.md finding; nothing here re-derives the personas or invents new facts about the SDK/mock.

## Derived minimum scope (assumed, not human-confirmed)

No human supplied a scope floor for this phase. In its absence, the smallest conservative scope
that lets both personas below reach their goal end-to-end is:

> Resolve `docs/agent-interface.md`'s open items enough to implement `invoke(role_cfg, ctx)` for
> all three roles, with envelope+payload validation and tool-authority enforcement, replacing the
> state machine's `AgentPort`/`TriagePort` stubs (`src/ports.ts`).

**Resolved with the architect, narrowing the floor above**: `src/ports.ts`'s `Terminus` is a 3-way
union (`completed`/`escalate`/`incomplete`) with no room for triage's verdict vocabulary
(`reroute`/`fix_the_gate`/`retry_close`/`abort`), and the architect's decision is not to
role-parameterise it in this item. This item's `invoke()` genuinely serves **worker and
gate-maintenance only** — both share the shipped 3-way `Terminus` as-is. The primitive's internals
(envelope validation, tool authority) are built generically, parameterised by `role_cfg`'s own
schema rather than hardcoded to the 3-way union, so a future triage `role_cfg` can be handed to the
*same machinery* — but `AgentPort.invoke()`'s TypeScript return type will need widening to carry
triage's verdict vocabulary, and that widening is explicitly Item 5's to make, not this item's. "For
all three roles" in the quoted floor above is therefore honoured at the mechanism level, not at the
concrete typed-`invoke()` level — this document's journeys and MUST tier below reflect that
narrower, accurate scope.

This is deliberately narrow. It excludes:
- Item 5's agent-judgement triage (sharpened briefs, exhaustion-vs-retry judgement) **and** the
  `AgentPort.invoke()` return-type widening triage's verdict vocabulary needs — both are Item 5's,
  per the architect's decision above.
- Item 9's declarative/natural-language authoring surface for `role_cfg` — this phase's harness
  extender writes `role_cfg` as code/config, not prose. A non-technical authoring layer is future
  work that builds on a stable contract this phase establishes.
- Any change to `tools/claude-mock` itself (Item 7's concern) beyond staying compatible with what
  it already expects (research.md §4).

The critic should treat this floor as the thing to pressure-test hardest: is it small enough, and
does resolving exactly these open items (and no more) actually get both personas to a working,
legible first invocation.

## The two personas (as defined in the roadmap; not re-derived here)

- **Harness extender**: an engineer wiring gate/closer/agent config for their project. Comfortable
  with code, contracts, schemas. This phase's primary user for *configuring* the seam.
- **Project owner**: uses the harness to deliver work, may be non-technical. Does not read
  `role_cfg` or source; encounters this phase only through run output — specifically
  `INCOMPLETE_TERMINUS` and escalation packets when something goes wrong.

## Vision

For the **harness extender**, this phase delivers a `role_cfg` they can write once per role this
item serves (worker, gate-maintenance) — a system-prompt fragment, a payload schema, an
`allowedTools` set (enforced at the SDK seam; the specific SDK mechanism is the architect's to pin
— see architecture.md), and budget knobs — and hand to `invoke(role_cfg, ctx)` to get a real,
SDK-backed agent turn that ends in exactly one typed `Terminus`. They should be able to go from "no
`role_cfg`" to "first successful invocation" by reading this phase's own reference `role_cfg`s and
their accompanying guide, not by reading `src/agent-*.ts` source or the SDK's own `.d.ts` file.
Triage's `role_cfg` follows the identical shape but is not exercised through this item's typed
`invoke()` — Item 5 owns making that call, per the architect's scope decision above.

For the **project owner**, this phase delivers nothing they configure directly — it delivers
*legible failure*. When a worker's envelope is malformed, or a role calls a tool it wasn't granted,
the case file must carry a message a non-engineer can read and act on: what state the run was in,
what the agent tried to do or emit, and why the harness stopped it — never a raw SDK exception or a
stack trace. This is the roadmap's Item 3 DX principle ("error messages are the user's primary
debugging surface") applied to the agent seam specifically.

## Primary journeys

### Journey A — harness extender defines a `role_cfg` and gets a working invocation

1. Extender reads the reference `role_cfg` for the worker role (ships with this phase) and copies
   its shape for their own project: a domain system-prompt fragment, `allowedTools`
   (edit + shell, per `agent-interface.md`'s roles table), and the payload schema for `completed`/
   `escalate` — the latter is a zod schema, matching the codebase's existing convention
   (research.md §6; `src/schema.ts` already uses zod for the case-file schema).
2. Extender does **not** write a JSON Schema by hand — the primitive derives the SDK's
   `outputFormat.schema` from the zod schema via `z.toJSONSchema()` (research.md §5–6). This is the
   single most important simplification this phase makes visible to the extender: one schema
   language, not two.
3. Extender calls `invoke(role_cfg, ctx)` against a real (or `claude-mock`-faked) SDK session. On
   the happy path they get back a typed `Terminus` (`completed` / `escalate(category)` /
   `incomplete`) with no manual parsing of raw SDK output.
4. Extender repeats for the gate-maintenance role config, changing only `role_cfg`'s content
   (system-prompt fragment, `allowedTools`, payload schema) — never the call shape. This is the
   mechanism spec's non-negotiable governing decision 1 ("one primitive, roles are configs"), made
   concrete as a journey: the extender's second `role_cfg` costs them a config file, not a new code
   path. (Triage's `role_cfg` would follow the same shape, but this item's `invoke()` does not serve
   it — see Derived minimum scope above. An extender wiring triage waits for Item 5.)
5. If the extender's `role_cfg` is malformed (bad schema, empty `allowedTools`, missing required
   field) they get a validation error *before* any SDK call is made, naming the field and the
   `role_cfg` — not a runtime failure three steps into an agent session.

**End-to-end means**: steps 1–4 — worker and gate-maintenance, the two roles this item's `invoke()`
actually serves — complete without the extender reading `src/ports.ts`, `agent-interface.md`, or the
SDK's `.d.ts` file — the reference `role_cfg`s plus a short guide are sufficient. (Mirrors the
roadmap's Item 2/Item 6 "ships with a guide, reference impl doubles as the example" pattern — Item 4
needs the same, since it is a plug point of equal weight.) Triage is explicitly out of this claim.

### Journey B — project owner reads a malformed-envelope or tool-authority-refusal output

**Scenario 1: malformed envelope.** A worker's session ends but emits no valid envelope (crashed,
hit a cap, or emitted JSON that fails the payload schema). The primitive maps this to
`INCOMPLETE_TERMINUS` (`agent-interface.md`'s terminus-mapping table, lines 150-166) — a single
edge regardless of cause. The project owner, looking at the case file / run log, needs to see:
- **State**: which state the surface was in (`AGENT_ACTIVE`, worker attempt N).
- **Cause class**: crash, timeout/cap, or "the agent's output didn't match what we expect" — the
  three collapse to one edge internally, but the *message* should still distinguish them where the
  SDK reports which one happened, so the owner isn't left guessing whether a retry is likely to
  help.
- **What happens next**: retried (budget remaining) or escalated (budget exhausted), stated plainly
  — "attempt 2 of 3 retries" not "terminus budget 2/3."
- **No stack trace, no SDK internals.** The rationale field and any `INCOMPLETE_TERMINUS` message
  are prose, not a dump of the SDK's error payload.

**Scenario 2: tool-authority refusal.** A role's session attempts a tool call outside its pinned
`allowedTools`. The SDK-level refusal (which SDK option(s) implement it are architecture.md's call,
see MUST 4 above) must surface to the project owner as: which role, which tool it attempted, and
that this was refused by design ("gate-maintenance tried to edit a test file — this role is only
permitted to edit environment/config files, not assertions") — not a generic permission-denied
error. This maps directly to `agent-interface.md`'s "environment, not assertions" boundary (lines
179-186): the owner should be able to tell this was the harness's security boundary working as
intended, not a bug.

**End-to-end means**: the project owner can determine, from the case file log alone — without
asking an engineer or reading source — (a) what went wrong, (b) whether it's a transient issue
being retried or a terminal escalation, and (c) if it's an authority refusal, that it was
intentional and why.

## MVP capability set

Both journeys require more than plumbing. The following is the smallest set that makes each
journey complete, not merely possible.

### MUST (this phase does not ship without these)

1. **`invoke(role_cfg, ctx)` implemented against the real Claude Agent SDK** for the worker and
   gate-maintenance roles, replacing `src/ports.ts`'s `AgentPort` stub. The internals (envelope
   validation, tool authority) are built generically against `role_cfg`'s own schema, not hardcoded
   to these two roles, so Item 5 can hand the same machinery a triage `role_cfg` later — but the
   typed `invoke()` return this item ships only covers worker/gate-maintenance's shared 3-way
   `Terminus`; widening it for triage's verdict vocabulary is Item 5's. Spawns a fresh session per
   invocation (SDK default: omit `resume`/`continue`/`sessionId` — research.md §5).
2. **Envelope + payload validation as one code path**, using zod schemas converted to the SDK's
   `outputFormat: {type: 'json_schema', schema}` via `z.toJSONSchema()` (research.md §5–6) — no
   hand-rolled JSON Schema, no second schema language for the extender to learn.
3. **Terminus mapping exactly as specified**: valid+legal envelope → typed terminus;
   no/malformed/illegal-status/schema-failing/crashed/capped → `INCOMPLETE_TERMINUS`, one edge
   (`agent-interface.md` lines 150-166).
4. **Tool authority enforced at the SDK seam, from `role_cfg.allowedTools`**: a role literally
   cannot act outside its authority because the seam refuses the call, not because the prompt asks
   nicely (`agent-interface.md` governing decision 4). `role_cfg.allowedTools` is the single
   authored (positive) field — matching `agent-interface.md`'s settled name and the shape a future
   declarative authoring surface needs. Which specific SDK option(s) implement the refusal is an
   architecture decision, not a product one, and is resolved in architecture.md rather than restated
   here (research.md §5 surfaced more than one SDK mechanism that could do this; picking between
   them is the architect's call, and this document should not go stale if that pick changes). The
   one requirement this document holds firm regardless of mechanism: the refusal message to the
   project owner (Journey B scenario 2) is uniform — the terminus mapping only ever sees "the tool
   call didn't happen," never which SDK field blocked it.
5. **`ctx` shape resolved**: extend `AgentContext` (`src/ports.ts`) with a case-file reference field
   so prompt assembly can read the five fixed slots from the case file (research.md §1, §5 summary
   item 1). Without this, "prompt is a pure function of serialised case-file state" has no
   implementation.
6. **A reference `role_cfg` for both roles this item's `invoke()` serves (worker and
   gate-maintenance), plus a short "writing a `role_cfg`" guide**, matching the roadmap's
   established pattern (Item 2's reference gate, Item 6's reference closer, each shipped with a
   guide as an expected deliverable, not an optional extra). This is what Journey A's steps 1–4 and
   its end-to-end claim actually depend on — without both reference configs and the guide, the
   "extender never reads source" claim only holds for one role, not the two this item covers.
7. **`INCOMPLETE_TERMINUS` and tool-authority-refusal messages carry state + cause + next-action**,
   no stack traces, per Journey B and the roadmap's Item 3 DX note applied to this seam.
8. **Worker completion payload is `rationale`-only** — nothing load-bearing beyond it, per the
   mechanism spec's own lean and research.md's confirmation that nothing in the SDK/mock requires
   more (research.md §2 item 2, §5 summary item 2). This keeps the gate as the sole judge of
   acceptance (control-flow invariant 1).
9. **Determinism is testable**: same case file → byte-identical prompt, verifiable via
   `claude-mock`'s journal (research.md §4) even though this phase's own automated tests may need to
   add coverage the mock doesn't yet have for cap/timeout paths.

### SHOULD (materially improves either journey; ship if time allows without slipping MUST)

- A `role_cfg` validation step that runs before any SDK call and names the offending field (Journey
  A step 5) — cheap to add given zod is already in use, high value for extender trust.
- The "writing a `role_cfg`" guide (MUST item 6) written as a standalone chapter, ready to be
  absorbed into Item 9's unified onboarding docs later, rather than a one-off README.

### COULD (explicitly out of scope for this phase, noted so it isn't silently lost)

- A reference triage `role_cfg` and the `AgentPort.invoke()` return-type widening to carry its
  verdict vocabulary — explicitly Item 5's, per the architect's scope decision above.
- Deterministic `sessionId` tied to the case file (vs. harness-only journal key) — research.md §5
  notes the SDK supports this but it's not required for either journey to succeed.
- `toolAliases` for a narrower gate-maintenance edit boundary than allow/deny lists give
  (research.md §5) — only needed if the physical-location enforcement already specified in
  `agent-interface.md` (assertions live outside the worktree) proves insufficient in practice.
- Any authoring surface beyond code/config (Item 9's concern).

## Error/output legibility: what INCOMPLETE_TERMINUS and tool-authority messages must communicate

Both message classes are the project owner's *only* window into this seam (they don't read
`role_cfg` or source). Each message must answer, in this order:

1. **Where**: surface state and worker/role attempt number.
2. **What happened**: one of a small, fixed set of cause classes (crashed, hit a turn/token cap,
   emitted no envelope, emitted an envelope that failed schema validation, attempted a
   disallowed tool) — never a raw exception message or stack trace, matching the Item 3 DX
   precedent ("name the state, the attempted edge, what went wrong, not a stack trace").
3. **What happens next**: retry-with-budget-remaining vs. escalate-at-cap, stated in plain terms
   ("this will be retried, 2 attempts remain" / "no attempts remain, this needs your decision").
4. **For tool-authority refusals specifically**: which role, which tool, and that the refusal is by
   design — this is a security boundary functioning correctly, and the message should read that
   way rather than as an unexplained failure.

This is a message-contract requirement on the primitive, not a reporting-surface feature (Item 11
builds the full reporting UI later) — but the underlying message must exist and be legible now,
because Item 11 can only format what this phase already produces in the case file.

## Buy-vs-build

- **Schema definition mechanism (open item 3)**: buy — reuse zod, already a dependency and already
  the codebase's established pattern for case-file validation (research.md §6). zod v4's native
  `z.toJSONSchema()` is the direct bridge to the SDK's `outputFormat.schema` requirement. No new
  library, no hand-rolled JSON Schema generation. This is the clearest case in this phase: the
  alternative (a second schema DSL, or hand-written JSON Schema per role) would be pure
  duplication of a solved problem already in the estate.
- **Structured output enforcement**: buy — the SDK's own `outputFormat: json_schema` support
  (research.md §5) does schema validation and retry server/CLI-side before the harness ever sees a
  malformed envelope. Building a freeform-text-parsing fallback on top would duplicate what the
  SDK already does, and would weaken rather than strengthen the "envelope is harness-owned,
  non-negotiable" guarantee.
- **Tool authority**: buy — the SDK's own tool-restriction options (research.md §5) are the
  enforcement primitives; `agent-interface.md` already commits to "enforced at the SDK seam, not
  requested in prose." `role_cfg` authors `allowedTools` only; which SDK option(s) the primitive
  passes to enforce the restriction is the architect's call (see architecture.md) — nothing in this
  phase's scope calls for a bespoke enforcement layer or a new dependency either way.
- **One shape across roles**: prior art already exists inside this repo — the gate and close
  interfaces use the identical "one interface, variable subject" shape (`agent-interface.md:37-38`,
  echoed in research.md §7). This phase should conform to that existing internal pattern rather than
  invent a differently-shaped config object for agents; consistency across the three pluggable
  seams (gate, close, agent) is itself a DX asset for the extender who has already learned one.

No case in this phase's scope calls for a new external dependency or a hand-rolled solution to a
problem the SDK or an existing dependency already solves.

## Operability / DX

- **Local-run story**: extenders develop and verify `role_cfg` against `claude-mock`
  (research.md §4) before ever spending a real API call — the mock fakes exactly this seam
  (`invoke` ↔ scripted turn, envelope ↔ `json` field, worktree edits ↔ `effects`). This phase's
  own test suite should follow the existing project pattern (`vitest`, temp-dir-per-test, scripted
  port doubles) already established by Items 1–3.
- **Known gap to flag, not silently work around**: `docs/agent-interface.md` links to
  `../../tools/claude-mock` as a relative path, but the mock lives in a sibling project outside
  this repo and is installed globally (research.md §4). This phase's extender-facing docs must not
  assume the mock resolves at that path inside this repo — either the guide points at the actual
  install story (global `npm link`), or this is called out as a dependency on Item 7 vendoring the
  mock into the repo. Silently assuming the doc's relative link works would break the "extender
  never reads source" goal on day one.
- **Tool-authority enforcement cannot be verified through the mock today** — research.md §4 found
  no `allowedTools` handling in the mock's source at all. This phase's test story for tool-authority
  refusal (Journey B, scenario 2) must therefore either test against the real SDK, or explicitly
  document that this path is trusted to the SDK's own enforcement and only smoke-tested manually.
  This is a real gap in the local-run story, not a detail to gloss over — the critic should expect
  a stated position here, not silence.
- **Budget-cap/timeout paths of `INCOMPLETE_TERMINUS` are not yet exercisable via the mock**
  (research.md §4: "deliberately unbuilt... today's mock cannot yet exercise budget-cap/timeout
  paths end-to-end"). This phase's own tests for those paths will need either a scripted-double
  extension beyond the mock's current capability or a documented manual-verification step — decide
  which explicitly rather than leaving a silent coverage hole.
- **Deploy target**: none — this is a library-level primitive consumed by the state machine driver
  in-process (`src/ports.ts`'s `AgentPort`), not a service with its own deployment. Its
  "operability" is entirely about local dev/test ergonomics for the extender, covered above.

## Architecture decisions this document depends on

Two open questions were raised with the architect directly rather than decided unilaterally here;
both are now resolved and this document reflects the resolutions throughout (Derived minimum scope,
MUST tier, Buy-vs-build):

1. **`Terminus` vs. triage-verdict shape mismatch** (research.md §3) — resolved: this item's
   `invoke()` serves worker and gate-maintenance only, sharing the shipped 3-way `Terminus` as-is.
   Triage's verdict vocabulary and the `AgentPort.invoke()` return-type widening it needs are
   Item 5's. The primitive's internals stay generic (parameterised by `role_cfg`'s own schema) so
   Item 5 can reuse them without rebuilding the mechanism.
2. **Which SDK mechanism(s) enforce tool authority** (research.md §5 surfaced more than one
   candidate) — deliberately **not** pinned in this document; that choice belongs to architecture.md
   and may still be in motion there. `role_cfg` authors `allowedTools` only. The product requirement
   this document holds regardless of which mechanism is chosen: the refusal message to the project
   owner (Journey B scenario 2) is uniform — the terminus mapping only ever sees "the tool call
   didn't happen," never which SDK field blocked it. See architecture.md for the current mechanism.

## Still open (genuinely deferred, not this phase's to default)

**Budget knob placement** — whether the per-role budget fields live in `role_cfg`, the case file, or
split, per the mechanism spec's own "leave to the budget design" text (research.md §2 item 4, §5
summary item 4). Not defaulted here.

## Success metrics

- **Harness extender**: for either role this item serves (worker or gate-maintenance), can go from
  "no `role_cfg`" to "first successful invocation returning a typed `Terminus`" using only that
  role's reference `role_cfg` and the shared guide — measured by: zero reads of `src/ports.ts`,
  `agent-interface.md`, or the SDK's `.d.ts` file during that path (verifiable via a cold-start
  walkthrough test, not just self-report). Triage is out of scope for this metric.
- **Project owner**: given a case file containing an `INCOMPLETE_TERMINUS` or tool-authority-refusal
  entry, can state (a) what state the run was in, (b) whether it will retry or has escalated, and
  (c) for an authority refusal, that it was intentional — using only the case file log, no source
  access, no engineer consulted.
- **Determinism**: two runs against a byte-identical case file produce byte-identical prompts,
  verified via `claude-mock`'s journal (research.md §4) as an automated test, not a manual check.
- **Schema-boundary strictness holds**: an automated test proves a worker emitting a triage-only
  status produces `INCOMPLETE_TERMINUS`, not a silent misroute — this is the roadmap's Item 4
  success criterion made concrete as a regression test, not just a design claim.
