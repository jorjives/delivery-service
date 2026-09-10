---
type: phase-design
created: 2026-09-09
roadmap_item: 4
---

# Agent Invocation Primitive — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 4.
> Mechanism spec this design implements: `docs/agent-interface.md`.
> Audit trail: `docs/prd/2026-09-09-agent-invocation-primitive/` (research.md, product-design.md, architecture.md, review-log.md).

## Derived minimum scope (assumed, not human-confirmed)

No human supplied a scope floor for this phase (autonomous run). The team derived a
conservative floor and scrutinised it through three critic revision rounds:

> Resolve `docs/agent-interface.md`'s four open items (`ctx` shape, worker completion
> payload, schema definition mechanism, budget knob placement) enough to implement
> `invoke(role_cfg, ctx) -> Terminus` against the real Claude Agent SDK, with
> envelope+payload validation and tool-authority enforcement, replacing the single-surface
> state machine's `AgentPort` stub (`src/ports.ts`) — for the **worker and
> gate-maintenance roles**.

**Narrowing resolved during design, not assumed at the outset**: `src/ports.ts`'s
`Terminus` is a fixed 3-way union (`completed`/`escalate`/`incomplete`), shared as-is by
worker and gate-maintenance. Triage's verdict vocabulary
(`reroute`/`escalate`/`fix_the_gate`/`retry_close`/`abort`) is structurally different and
would need `AgentPort.invoke()`'s TypeScript return type widened to carry it — that
widening is explicitly **Item 5's** to make (triage's own item), not this item's. This
item's `invoke()` therefore serves **worker and gate-maintenance only**; its internals
(envelope validation, tool authority) are built generically against `role_cfg`'s own
schema, not hardcoded to these two roles, so Item 5 can hand the same machinery a triage
`role_cfg` later without rebuilding the mechanism.

## Problem

Item 3 (Single-Surface State Machine, complete) drives every agent-role dispatch through
`AgentPort.invoke(role_cfg, ctx) -> Terminus`, but ships that seam **stubbed** — a
placeholder that lets the state machine's control flow be built and tested without a real
agent behind it (per that item's own scope note: "seams are stubbed for this item so that
later items (4, 5, 6) can supply real implementations"). `docs/agent-interface.md` fully
specifies the intended mechanism (one `invoke` primitive, roles as configuration, a
harness-owned envelope, deterministic prompt assembly, tool authority enforced at the SDK
seam) but leaves four items explicitly open, and no code implementing any of it exists yet.
Until this gap closes, the harness cannot actually dispatch a real agent — it can only
simulate one.

## Target users

- **Harness extender** — an engineer wiring gate/closer/agent configuration for their
  project. Comfortable with code, contracts, schemas. This phase's primary configurer of
  the seam: writes a `role_cfg` per role and calls `invoke`.
- **Project owner** — uses the harness to deliver work; may be non-technical. Never reads
  `role_cfg` or source; meets this phase only through run output, specifically
  `INCOMPLETE_TERMINUS` and tool-authority-refusal messages in the case file log when
  something goes wrong.

(Both personas as defined in the roadmap's "Two audiences" section — not re-derived here.)

## Goals & success metrics

- A harness extender can go from "no `role_cfg`" to "first successful invocation
  returning a typed `Terminus`" for worker or gate-maintenance using only that role's
  reference `role_cfg` and a shared guide — zero reads of `src/ports.ts`,
  `agent-interface.md`, or the SDK's `.d.ts` file, verified by a cold-start walkthrough
  test.
- A project owner, given a case file with an `INCOMPLETE_TERMINUS` or
  tool-authority-refusal entry, can state from the log alone: what state the run was in,
  whether it will retry or has escalated, and — for an authority refusal — that it was
  intentional. No source access, no engineer consulted.
- Determinism: two runs against a byte-identical case file produce byte-identical
  prompts, proven by an automated test against `claude-mock`'s journal, not a manual
  check.
- Schema-boundary strictness holds: an automated test proves a worker emitting a
  triage-only status produces `INCOMPLETE_TERMINUS`, not a silent misroute (the roadmap's
  own Item 4 success criterion, made concrete as a regression test).

## Capability set

### MUST

1. `invoke(role_cfg, ctx)` implemented against the real Claude Agent SDK for worker and
   gate-maintenance, replacing `src/ports.ts`'s `AgentPort` stub, spawning a fresh SDK
   session per invocation.
2. Envelope + payload validation as one code path: zod schemas converted to the SDK's
   `outputFormat: {type: 'json_schema', schema}` via `z.toJSONSchema()` — one schema
   language, not two.
3. Terminus mapping exactly as `agent-interface.md` specifies: valid+legal envelope →
   typed terminus; no/malformed/illegal-status/schema-failing/crashed/capped →
   `INCOMPLETE_TERMINUS`, one edge regardless of cause.
4. Tool authority enforced at the SDK seam from `role_cfg.allowedTools` (the single
   authored, positive field) — a role cannot act outside its authority because the seam
   refuses the call. The refusal message to the project owner is uniform regardless of
   which SDK option implements it.
5. `ctx` shape resolved: `AgentContext`'s existing `dir` field serves as the case-file
   reference (no schema change needed) so prompt assembly can read the case file's state.
6. A reference `role_cfg` for both roles this item serves, plus a short "writing a
   `role_cfg`" guide — matching the roadmap's established pattern (Item 2's reference
   gate, Item 6's reference closer). Without both the reference configs and the guide, the
   "extender never reads source" claim only holds for one role, not the two this item
   covers.
7. `INCOMPLETE_TERMINUS` and tool-authority-refusal messages carry state + cause class +
   next-action, never a stack trace or raw SDK exception (Item 3's DX precedent, applied
   to this seam).
8. Worker completion payload is `rationale`-only — nothing load-bearing beyond it, keeping
   the gate the sole judge of acceptance.
9. Determinism is testable: same case file → byte-identical prompt, verifiable via
   `claude-mock`'s journal.

### SHOULD

- A `role_cfg` validation step that runs before any SDK call and names the offending
  field — cheap given zod is already in use, high value for extender trust.
- The "writing a `role_cfg`" guide (its existence is MUST 6; only its format is SHOULD)
  written as a standalone chapter, ready to be absorbed into Item 9's unified onboarding
  docs later, rather than a one-off README.

### COULD (explicitly out of scope for this phase)

- A reference triage `role_cfg` and the `AgentPort.invoke()` return-type widening its
  verdict vocabulary needs — Item 5's.
- Deterministic `sessionId` tied to the case file (vs. harness-only journal key) — the SDK
  supports it but neither journey requires it.
- `toolAliases` for a narrower gate-maintenance edit boundary — only needed if the
  physical-location enforcement already specified in `agent-interface.md` proves
  insufficient in practice.
- Any authoring surface beyond code/config (Item 9's concern).

## Architecture

### `invoke(role_cfg, ctx)` implementation shape

`AgentContext` (`src/ports.ts`) is **not extended**: its existing `dir` field already is
the case-file directory by this codebase's established convention (every `case-file.ts`
function takes `dir`), so the primitive calls the existing `load(ctx.dir)` internally.
`sessionKey` is never passed as the SDK's `sessionId`/`resume`/`continue` — every invoke
spawns a fresh session by omitting those options — and is used only as the harness/mock
journal key, deliberately excluded from prompt content so retries with different
`sessionKey`s but identical case-file state still produce byte-identical prompts.

`RoleConfig` (new module `src/role-config.ts`):

```ts
interface RoleConfig {
  role: AgentRole;
  systemPromptFragment: string;       // role identity + domain context
  envelopeSchema: z.ZodType;          // this role's {status, rationale, payload?}
  allowedTools: string[];             // authored, positive list
  budgets?: Record<string, unknown>;  // reserved; see Budget knobs below
}
```

`envelopeSchema` is a zod discriminated union over the role's legal statuses, matching
the existing `GateRef` pattern in `src/schema.ts` — reuse, not a new pattern. The
primitive validates the SDK's `structured_output` against `role_cfg.envelopeSchema.parse`
(harness-side, defence in depth) *and* passes the zod-derived JSON Schema to the SDK's
`outputFormat` (server/CLI-side constraint) — belt and braces: the SDK's constraint
reduces how often a malformed reply reaches the harness; the harness's own parse is what
deterministically produces `INCOMPLETE_TERMINUS` regardless of SDK version drift.

**Worker completion payload**: `completed` carries nothing beyond `rationale` — matches
`src/ports.ts`'s `Terminus` exactly as shipped, no code or schema change.

**Budget knobs**: genuinely deferred. The case file's five existing `BudgetSet`
populations already govern *how many invocations* of a role a surface may make
(unchanged by this item). `role_cfg.budgets?: Record<string, unknown>` reserves a landing
spot for *how much a single invocation may do internally* (session-level SDK caps),
without this item guessing at unverified SDK field names.

### State model / data flow

The single-surface driver (`src/surface.ts`) already calls `ports.agent.invoke(roleCfg,
ctx)` at every dispatch edge the state-machine design specifies. This item supplies a real
implementation — `createClaudeAgentPort(sdkOptions): AgentPort` in a new
`src/agent-invoke.ts` — that plugs into `SurfacePorts.agent` in place of the stub, **with
no change to `src/surface.ts`**: this is the entire point of the ports being fixed ahead
of implementation.

```
driver (surface.ts)
  -> roleCfg = workerRoleConfig | gateMaintenanceRoleConfig   (src/role-config.ts)
  -> ctx = { worktreePath, dir, sessionKey }
  -> agent.invoke(roleCfg, ctx)
       -> caseFile = load(ctx.dir)
       -> prompt = assemblePrompt(caseFile, roleCfg)          (pure, see below)
       -> query({ cwd: ctx.worktreePath,
                  systemPrompt: roleCfg.systemPromptFragment + prompt,
                  canUseTool: role's tool-authority guard,   // tools/allowedTools unset
                  outputFormat: { type: "json_schema",
                    schema: z.toJSONSchema(roleCfg.envelopeSchema) } })
       -> result.structured_output validated against roleCfg.envelopeSchema
       -> mapped to Terminus
  <- Terminus
  -> driver appends the `terminus` HistoryEntry (existing case-file.ts machinery)
```

Nothing about the case-file log format, budget derivation, or resume logic changes.

### Prompt assembly

New module `src/prompt-assembly.ts`: `assemblePrompt(caseFile: CaseFile, roleCfg:
RoleConfig): string`. Reads only from `caseFile` (serialised state) and `roleCfg` (pinned
config) — no clock, no randomness, no I/O of its own. Concatenates the five fixed slots
`agent-interface.md` specifies, in fixed order: system-prompt fragment, immutable
`task_def`, distilled brief, verbatim gate evidence, envelope instruction (not authorable).
Determinism holds structurally because `caseFile` and `roleCfg` are both derived
deterministically from disk, and the JSON serialiser's stable key ordering matches on
write and read.

### Tool authority enforcement

> **Superseded during delivery.** The mechanism below (`tools` + `allowedTools`)
> was settled against itself in the slice scope's Slice 2 Build note: narrowing
> `tools` makes the refusal unobservable, and a matching `allowedTools` makes the
> guard dead code. Enforcement is at `canUseTool`, and only there. See
> `2026-09-09-agent-invocation-primitive-slices.md`, Slice 2.

`role_cfg.allowedTools` (the single authored, positive list) is passed to the SDK call
**twice, for two distinct jobs**: as `tools: role_cfg.allowedTools` (the actual
restriction — the base tool set the session has access to at all) and as `allowedTools:
role_cfg.allowedTools` (auto-approval, so the unattended harness never stalls on a
permission prompt for a tool it's already entitled to). This distinction matters: the
SDK's `allowedTools` option alone is an auto-approve list, not a restriction — an unlisted
tool would still be *offered* in an interactive session, just not auto-approved, which is
meaningless in an unattended harness with no human to reject the prompt. `tools` is the
SDK's actual base-set restriction. One authored field, two SDK options, no computed
complement, no drift risk.

Gate-maintenance's finer "environment, not assertions" boundary is **not** a tool
restriction: assertion definitions live outside every agent-reachable worktree, physically
outside the directory tree `ctx.worktreePath` (the SDK's `cwd`) points into. A file that is
not present under the agent's working directory cannot be edited by it, regardless of tool
authority.

### Security & compliance

Blast radius per role is enforced twice, at two different layers, for two different
failure modes: the `canUseTool` tool-authority guard (SDK-level — may this role use tool
X; `tools` and `allowedTools` are deliberately left unset, so the session's base tool set
is *not* narrowed) and worktree scoping via `cwd` (filesystem-level — can an edit tool
this role does have reach file Y). Neither substitutes for the other.

One residual the guard cannot close: `canUseTool` is consulted only for calls the runtime
would otherwise prompt about. A tool the runtime auto-approves under the pinned permission
mode — the read-only family — never reaches the guard, so an out-of-role *read-only* call
is neither refused nor reported. Closing it would need the computed deny-list rejected in
the buy/build table below. Every mutating tool, where a role's blast radius actually lives,
goes through the guard. See `docs/agent-interface.md`.

No secrets or credentials pass through the
prompt — the five-slot template only ever carries case-file-derived content and authored
domain fragments.

### Testing strategy

There is **one implementation of `AgentPort`, not two** — `createClaudeAgentPort` is not
swapped for a separate mock double in tests; the same code path runs whether
`pathToClaudeCodeExecutable` points at the real `claude` binary or at `claude-mock`'s,
which is what makes an SDK shape change surface as a parse failure against the real
primitive rather than a passing fiction.

Two test tiers, following the codebase's existing pattern:

1. **Pure-function unit tests** (no SDK/process): `assemblePrompt` determinism and slot
   content, envelope validation against hand-built valid/invalid payloads including the
   "worker emits a triage-only status" exploit case.
2. **`AgentPort` integration tests against `claude-mock`**: exercises the real `query()`
   call path. `claude-mock` is a sibling project, not vendored in this repo (Item 7's
   concern, not yet spec'd) — this item's CI-enforced suite does not take a hard
   dependency on it being present at a fixed path; tier 1 is what CI enforces
   unconditionally, tier 2 runs when the mock is resolvable.
3. **Tool-authority enforcement is not verifiable through the mock today** —
   `claude-mock`'s source has no `allowedTools`/`tools` handling at all. This is a known
   testing gap: the mock-based tier proves envelope shape, prompt determinism, and
   terminus mapping; it does not prove a restricted tool call is actually refused. That
   guarantee rests on the SDK's own enforcement, exercised (if at all, within this item's
   scope) by a small number of real-SDK integration tests.

A demo (`demos/agent-invocation-slice-N-*.ts`, matching the existing
`demos/single-surface-slice-*.ts` pattern) drives one real `invoke()` call against
`claude-mock` end to end, proving the wiring without a live API call.

### NFRs

- **Determinism**: byte-identical prompts for identical case-file state, achieved
  structurally, not by convention.
- **No hidden retries inside the primitive**: `invoke()` calls the SDK exactly once and
  returns exactly one `Terminus`. All retry/redispatch logic lives in the driver, gated by
  the case file's population budgets (unchanged).
- **Observability**: every invocation's prompt and structured output are independently
  reconstructable from the case file and `assemblePrompt` — no new persisted artefact
  type.
- **Cost/latency**: exactly one SDK session per `invoke` call, no speculative parallel
  sessions.

### Extensibility

Adding a role means authoring one more `RoleConfig` and one more driver call site —
`invoke()` itself does not change. The one condition a fourth role must satisfy: its
`envelopeSchema`'s status vocabulary must be expressible as a zod discriminated union the
same way worker/gate-maintenance's is; a role whose result shape doesn't fit that pattern
hits the same `Terminus`-type-widening question flagged for triage above.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Envelope + payload schema validation | **Reuse-estate** — zod (already a dependency) | Add `ajv`/`joi`/`yup`/`io-ts` | zod is already the codebase's exclusive schema-validation library, used for the structurally identical "discriminated union" problem (`GateRef`). No other schema library exists in `package.json`. |
| JSON Schema generation for `outputFormat` | **Reuse-estate** — zod v4's native `z.toJSONSchema()` | Hand-write JSON Schema per role; add a conversion library | The SDK wants a plain JSON Schema object; zod v4 (confirmed installed) converts natively. Hand-authoring would be a duplicate, driftable source of truth. |
| SDK session spawn / process management | **Buy** — `@anthropic-ai/claude-agent-sdk` (new dependency) | Shell out to the `claude` CLI and parse stdout by hand | The SDK is the first-party, versioned interface to exactly this; hand-rolling would duplicate what it does and lose its schema-retry behaviour. |
| Structured-output constraint enforcement | **Buy** — SDK's `outputFormat: json_schema`, server/CLI-side | Freeform text + harness-side regex/parsing | First-party version of "forced-shape output"; reimplementing constrained decoding would be strictly worse. |
| Tool authority (allow/deny) | **Buy** — the SDK's native `canUseTool` callback, refusing any tool not in `role_cfg.allowedTools`; `tools` and `allowedTools` left unset | A computed `disallowedTools` complement against "the SDK's built-in tool set"; `tools` + `allowedTools` set from `role_cfg.allowedTools` | Complement rejected during review: no runtime enumeration of the SDK's built-in tool names exists to complement against. `tools` + `allowedTools` superseded during delivery: narrowing `tools` makes the refusal unobservable, and a matching `allowedTools` auto-approves before the guard runs, making it dead code. Known residual: out-of-role read-only calls are auto-approved and never reach `canUseTool` (see "Security & compliance"). |
| Prompt template assembly | **Build** — pure function, five fixed slots | A templating library (Handlebars, Mustache) | Five concatenated slots, fixed order, no conditionals/loops/partials — a templating engine adds a dependency and indirection for what string concatenation already does exactly. |
| Test double for the SDK seam | **Reuse-estate** (partial) — `claude-mock`, sibling project; formal vendoring deferred to Item 7 | Hand-write a bespoke `AgentPort` test double | `claude-mock` is the exact, purpose-built fake for this seam at the CLI/stdio boundary the SDK itself spawns; a hand-written double would exercise a weaker code path and wouldn't surface SDK shape changes. |
| Per-invocation SDK-level resource caps (budget knobs) | **Deferred** — no decision in this item | — | Genuinely unresolved by research; `agent-interface.md` itself defers this to "the budget design." This item reserves the field without guessing at unverified SDK option names. |
| One config shape across pluggable seams | **Reuse-estate** — conform to the gate/close interfaces' existing "one interface, variable subject" shape | A differently-shaped config object for agents | Prior art already exists inside this repo; consistency across the three pluggable seams (gate, close, agent) is a DX asset for an extender who has already learned one. |

## Operability / DX

**Environment**: Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint` config,
`vitest` — unchanged from the rest of the codebase. One new runtime dependency:
`@anthropic-ai/claude-agent-sdk`. No new devDependency required.

**Harness / scaffolding**: three new files in the existing flat `src/*.ts` +
`src/*.test.ts` layout — `src/role-config.ts`, `src/prompt-assembly.ts`,
`src/agent-invoke.ts` — plus their tests. `src/ports.ts` and `src/index.ts` gain new
exports alongside existing ones; no existing export changes shape.

**Local-run story**: `npm test` runs the full suite (tier 1 always; tier 2 when
`claude-mock` resolves on `PATH`). A new demo script drives one real `invoke()` call
end-to-end against `claude-mock`, printing the assembled prompt and resulting `Terminus`
— the same "prove the seam without a live API call" property the state machine's own
demos already have.

**Known gap, flagged not silently worked around**: `docs/agent-interface.md` links to
`../../tools/claude-mock` as a relative path, but the mock lives in a sibling project
outside this repo, installed via `npm link`. This phase's extender-facing docs must not
assume that relative link resolves inside this repo; either the guide states the actual
install story, or this is called out as a dependency on Item 7 vendoring the mock.

**Tool-authority enforcement cannot be verified through the mock today** — see Testing
strategy, point 3, for the gap and its resolution (trusted to the SDK's own enforcement,
exercised by a small number of real-SDK integration tests within this item's scope).

**Budget-cap/timeout paths of `INCOMPLETE_TERMINUS` are not yet exercisable via the
mock** — this phase's tests for those paths need either a scripted-double extension
beyond the mock's current capability, or a documented manual-verification step.

**Deploy target**: none — this is a library-level primitive consumed in-process by the
state machine driver, not a service with its own deployment.

## Key flows

See **Primary journeys** in `docs/prd/2026-09-09-agent-invocation-primitive/product-design.md`:

- **Journey A** — a harness extender defines a `role_cfg` for worker, then repeats for
  gate-maintenance, changing only the config's content, never the call shape, and gets a
  working invocation without reading source.
- **Journey B** — a project owner reads a malformed-envelope (`INCOMPLETE_TERMINUS`) or
  tool-authority-refusal case-file entry and determines, from the log alone, what
  happened, whether it will retry or has escalated, and — for a refusal — that it was
  intentional.

## What this design does not include

- **Triage's agent-backed invocation** and the `AgentPort.invoke()` return-type widening
  its verdict vocabulary needs — Item 5's, per the scope decision above. Triage remains a
  deterministic-router-only `TriagePort` for now, unaffected by this item.
- **Declarative/natural-language authoring** of `role_cfg` — this phase's extender writes
  `role_cfg` as code/config; a non-technical authoring layer is Item 9's, built on the
  stable contract this phase establishes.
- **Vendoring or formally distributing `claude-mock`** into this repo — Item 7's concern;
  this phase stays compatible with what the mock already expects but does not change it.
- **Budget knob values or the SDK option(s) that enforce per-invocation resource caps** —
  genuinely deferred to a future budget design; this item only reserves the field.
- **A CLI or project-level configuration surface** for registering `role_cfg` — Items 8
  and 9, downstream of this item.

## Open questions / unresolved

None outstanding — both `product-design.md` and `architecture.md` reached critic
`APPROVED` (product-design.md after three revision rounds: a scope/journey-consistency
fix, then two mechanism-detail cleanups as the architect's tool-authority decision
propagated; architecture.md after one revision round correcting an infeasible
`disallowedTools`-complement mechanism to the SDK's native `tools` option). Full trail in
`docs/prd/2026-09-09-agent-invocation-primitive/review-log.md`. The spec-reviewer pass
(task #6, run before commit) may surface additional findings — see that section if
present in the review log.
