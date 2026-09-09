# Architecture: Agent Invocation Primitive

Resolves `docs/agent-interface.md`'s four open items and specifies how
`invoke(role_cfg, ctx) -> Terminus` is actually built against
`@anthropic-ai/claude-agent-sdk`, wired into the existing `src/ports.ts`
`AgentPort` seam, and tested. Grounded throughout in
`docs/prd/2026-09-09-agent-invocation-primitive/research.md` (cited as
`research.md §N`); settled decisions from `agent-interface.md` are restated,
not re-litigated.

## 1. `invoke(role_cfg, ctx)` implementation shape

### `ctx` shape (open item 1)

`AgentContext` (`src/ports.ts:12-16`) is **not extended**. Its three existing
fields already carry what the primitive needs:

```ts
export interface AgentContext {
  worktreePath: string;  // -> SDK cwd; the agent's edit surface
  dir: string;            // already the case-file directory everywhere else
                           // in this codebase (case-file.ts's `dir` param) —
                           // it *is* the case-file reference
  sessionKey: string;      // harness journal/transcript key, not an SDK id
}
```

`research.md §3` flagged this as a gap ("no case-file reference field"), but
`dir` already is that reference by the codebase's own established convention
— every `case-file.ts` function (`load`, `appendEntry`, `writeRef`, …) takes
`dir` as the case-file directory. The primitive calls `case-file.ts`'s
existing `load(ctx.dir)` internally to get the `CaseFile` for prompt
assembly. Adding a second field for the same thing would be a duplicate
source of truth. **Decision: no `ctx` schema change.**

`sessionKey` maps to the SDK as follows (`research.md §5`):

- **Not** passed as the SDK's `sessionId`/`resume`/`continue`. Every invoke
  spawns a fresh session (`agent-interface.md` governing decision 1: "spawns
  a fresh SDK session") by simply omitting those options — the SDK's default.
- Passed through as the mock/harness journal key only: when tests run
  against `claude-mock`, `CLAUDE_MOCK_JOURNAL` records events keyed by prompt
  text and expectation index (`research.md §4`); the primitive additionally
  logs `sessionKey ↔ prompt hash` itself so a resumed surface's reconstructed
  session is traceable back to the `dispatch`/`terminus` pair that minted the
  key (`sessionKey = ${role}-${attempt}-${retryCount}`, already specified by
  the state-machine design).
- `worktreePath` maps to the SDK's working-directory option for the spawned
  session (the standard mechanism for scoping a CLI-backed session to a
  directory); this is the sole channel through which the agent can reach the
  filesystem, matching "the task reaches the agent through a harness-
  constructed prompt, never through the worktree" being about task content,
  not file access.

### Worker completion payload (open item 2)

**Decision: `completed` carries nothing beyond `rationale`.** `research.md
§5` (summary point 2) found nothing in the SDK or the mock that requires a
richer payload, and `agent-interface.md`'s own lean ("nothing load-bearing,
since a payload the harness trusts over the gate would violate invariant 1")
already argues against it. This matches `src/ports.ts:19`'s `Terminus`
exactly as shipped — no code or schema change needed for this item's two
consuming roles (worker, gate-maintenance).

### Schema definition mechanism (open item 3)

**Decision: reuse zod.** `research.md §6` confirms zod v4 (`package.json:32`,
`"zod": "^4.5.4"`) is already the codebase's schema-validation convention
(`src/schema.ts`) and ships native JSON Schema conversion (`z.toJSONSchema()`)
— a direct bridge to the SDK's `outputFormat: { type: 'json_schema', schema:
Record<string, unknown> }` option (`research.md §5`). No new dependency for
schema validation or JSON Schema generation.

Each role's `role_cfg` gains two zod-backed fields, in a new module
`src/role-config.ts`:

```ts
interface RoleConfig {
  role: AgentRole;
  systemPromptFragment: string;       // role identity + domain context
  envelopeSchema: z.ZodType;          // this role's {status, rationale, payload?}
  allowedTools: string[];             // authored, positive list
  // budgets: see §"Budget knobs" below
}
```

`envelopeSchema` is built once per role as a zod discriminated union over
that role's legal statuses, each variant carrying its own payload schema —
e.g. worker: `z.discriminatedUnion("status", [completedSchema,
escalateSchema, incompleteSchema])`. This is the same pattern already used
for `GateRef` (`src/schema.ts:36-49`, `z.discriminatedUnion("type", [...])`)
— reuse, not a new pattern. The primitive validates the SDK's
`structured_output` against `role_cfg.envelopeSchema.parse(...)` (harness
side, defence in depth) *and* passes `z.toJSONSchema(role_cfg.envelopeSchema)`
to the SDK's `outputFormat` (server/CLI-side constraint, `research.md §5`) —
belt and braces, not redundant: the SDK's own constraint reduces how often a
malformed reply reaches the harness at all; the harness's own `parse` is what
actually produces `INCOMPLETE_TERMINUS` deterministically regardless of SDK
version drift.

**Flagging, not silently resolving** (`research.md §3`, §7 point 5): the
`Terminus` type shipped in `src/ports.ts:18-21` is a fixed 3-way union
(`completed`/`escalate`/`incomplete`) shared by worker and gate-maintenance —
both roles this item actually implements, and both legitimately share this
shape per the roles table in `agent-interface.md`. Triage's status vocabulary
(`reroute`/`escalate`/`fix_the_gate`/`retry_close`/`abort`) is structurally
different and is **not** wired through `AgentPort.invoke` today — Item 3's
`TriagePort` is a separate, non-agent interface (deterministic router only).
`agent-interface.md`'s "one primitive, roles are configs" governing decision
implies triage *should* eventually go through the same `invoke()` mechanism
once Item 5 makes it agent-backed. This item does not resolve that: it builds
`invoke()`'s envelope-validation logic generically (parameterised by
`role_cfg.envelopeSchema`, not hardcoded to the 3-way union), so Item 5 can
hand it a triage `role_cfg` with a different `envelopeSchema` later — but the
**TypeScript return type** `AgentPort.invoke(): Promise<Terminus>` will need
widening (a discriminated-by-role return, or a second typed wrapper) at that
point. That widening is explicitly **out of scope for this item and left to
Item 5**, which already owns the triage verdict vocabulary's evolution per
the state-machine design (`research.md §3`, citing
`single-surface-state-machine-design.md:531-551`).

### Budget knobs (open item 4)

**Genuinely deferred**, per `research.md §5` summary point 4 and
`agent-interface.md`'s own text. What this architecture does settle is the
*boundary*, so the eventual budget design has a slot rather than a fresh
decision:

- The case file's five `BudgetSet` populations (`correction`, `gateError`,
  `gateMaintenance`, `terminus`, `close` — `src/schema.ts:18-25`) already
  govern **how many invocations of a role a surface may make** across its
  lifetime. This is derived from the log and enforced by the driver
  (`src/case-file.ts`'s `deriveBudgetsFromLog`) *before* it decides to call
  `agent.invoke` at all — unchanged by this item.
- `role_cfg`'s budget knobs, whatever shape the budget design settles on,
  govern **how much a single invocation is allowed to do internally**
  (session-level resource caps enforced by the SDK within one `invoke` call,
  as distinct from the cross-invocation retry counts above). This item
  reserves a `role_cfg.budgets?: Record<string, unknown>` field (loosely
  typed, deliberately not fleshed out) so the budget design has a landing
  spot without this item guessing at SDK field names it hasn't verified.
- Whatever a single invocation's internal cap yields — a session that
  crashes, is killed on a timeout, or ends without a valid envelope — is not
  a new case for the terminus mapping: it is already `INCOMPLETE_TERMINUS`
  by the existing negative definition (`agent-interface.md:150-166`). The
  budget design's job is to choose *values* and the SDK option(s) that
  enforce them, not a new outcome type.

## 2. State model / data flow

The single-surface driver (`src/surface.ts`, `advance`/`run`) already calls
`ports.agent.invoke(roleCfg, ctx)` at every dispatch edge the state-machine
design specifies: the `PRE_GATING → GATE_MAINTENANCE` pre-task dispatch, the
`GATE_MAINTENANCE` post-task and incomplete-retry dispatches, the
`AGENT_ACTIVE` worker dispatch, and the `INCOMPLETE_TERMINUS` retry dispatch.
This item supplies a real `AgentPort` implementation —
`createClaudeAgentPort(sdkOptions): AgentPort` in a new `src/agent-invoke.ts`
— that plugs into `SurfacePorts.agent` in place of a test double, **with no
change to `src/surface.ts`**. This is the entire point of the ports being
fixed ahead of the implementation (state-machine design, "Three pluggable
ports, not one implementation"): `AGENT_ACTIVE`, `TRIAGE` (unaffected —
still deterministic-router-only per Item 3), and `GATE_MAINTENANCE` all
continue to call the same `AgentPort.invoke` signature; only what answers it
changes.

Data flow per invocation:

```
driver (surface.ts)
  -> roleCfg = workerRoleConfig | gateMaintenanceRoleConfig   (src/role-config.ts)
  -> ctx = { worktreePath, dir, sessionKey }                  (already assembled by the driver)
  -> agent.invoke(roleCfg, ctx)
       -> caseFile = case-file.ts's load(ctx.dir)
       -> prompt = assemblePrompt(caseFile, roleCfg)          (§3, pure)
       -> query({ cwd: ctx.worktreePath, systemPrompt: roleCfg.systemPromptFragment + prompt,
                  tools: roleCfg.allowedTools, allowedTools: roleCfg.allowedTools,
                  outputFormat: { type: "json_schema",
                  schema: z.toJSONSchema(roleCfg.envelopeSchema) } })   (SDK call, see §4)
       -> result.structured_output validated against roleCfg.envelopeSchema
       -> mapped to Terminus
  <- Terminus
  -> driver appends the `terminus` HistoryEntry (existing case-file.ts machinery, unchanged)
```

Nothing about the case-file log format, budget derivation, or resume logic
changes. This item is purely "what answers `AgentPort.invoke`", which is
exactly the seam the state-machine design left open.

## 3. Prompt assembly as a pure function

New module `src/prompt-assembly.ts`, one exported function:

```ts
function assemblePrompt(caseFile: CaseFile, roleCfg: RoleConfig): string
```

It reads only from `caseFile` (already-serialised, already-loaded state) and
`roleCfg` (pinned, run-fixed config) — no clock, no randomness, no I/O of its
own. It concatenates the five fixed slots `agent-interface.md:92-100`
specifies, in fixed order:

1. `roleCfg.systemPromptFragment` (role identity + domain context —
   authored content, not structure, per `agent-interface.md:102-104`)
2. `caseFile.header.taskDef` (immutable, from the header)
3. the distilled brief — `SharpenedBrief` on a reroute (Item 5, not yet
   built) or the raw delta otherwise; this item reads whatever the current
   `TriageEntry.artifactRef` or `GateEntry` detail holds via `readRef`,
   unchanged from Item 3's stub artefact shape
4. verbatim gate evidence — the newly-failing assertions, read via
   `readRef` off the relevant `GateEntry`, unparaphrased
5. the envelope instruction — a fixed string per role, naming
   `roleCfg.envelopeSchema`'s legal statuses; **not authorable**, matching
   `agent-interface.md:102-106`'s "the project contributes content, not
   structure" rule

Because `caseFile` and `roleCfg` are both derived deterministically from disk
(`load(dir)` and a static config object respectively), the same case file at
the same log position always serialises to the same string, and
`JSON.stringify`-shaped slots (e.g. `taskDef`) use stable key ordering (zod's
`z.record` preserves insertion order from the stored JSON, which
`atomicWriteJson` writes with `JSON.stringify(data, null, 2)` — the same
serialiser on write and the same parse-then-restringify shape on read, so no
key-order drift enters between a crash and a resume). `sessionKey` is
deliberately **not** one of the five slots — it never appears in prompt
content, only in the SDK call options and the journal — so two different
retries of the same attempt (different `sessionKey`, same case-file state at
that log position) still produce byte-identical prompts, matching "a resumed
surface reconstructs the same session it would have run before the crash."

## 4. Tool authority enforcement at the SDK seam

`agent-interface.md`'s governing decision 4 is settled: `allowedTools` is
pinned in `role_cfg` and the seam refuses calls outside it, not the prompt.
`research.md §5` surfaces a real gap in *how strong a guarantee `allowedTools`
alone is*: the SDK's `allowedTools` option is documented as an auto-approve
list ("tool names auto-allowed without prompting") — a permission-prompt
bypass, not a restriction. In an interactive session an unlisted tool would
still be *offered*, just not auto-approved; the harness runs unattended,
with no human to reject that prompt.

The SDK ships the actual restriction mechanism next to it: `tools?:
string[]` — "Specify the base set of available built-in tools... `[]` -
Disable all built-in tools" (SDK `sdk.d.ts:1469-1481`, verified directly
against the installed SDK by the critic's review of this draft). This is
also what `allowedTools`'s own doc comment points at: "To restrict which
tools are available, use the `tools` option instead" (`sdk.d.ts:1418`). An
earlier version of this section proposed computing a `disallowedTools`
complement against "the SDK's enumerable built-in tool set" — there is no
such runtime enumeration to compute against (`ToolInputSchemas` is a
compile-time-only type union, not a runtime array of names), so that
approach was infeasible as written and is dropped.

**Decision:** `role_cfg.allowedTools` (the authored, positive list —
matching `agent-interface.md`'s name and the natural shape for Item 9's
future declarative authoring surface) is passed to the SDK call **twice, for
its two distinct jobs**: as `tools: role_cfg.allowedTools` (the actual
restriction — the base tool set the session has access to at all) and as
`allowedTools: role_cfg.allowedTools` (auto-approval — so the unattended
harness never stalls on a permission prompt for a tool it's already
entitled to). One authored field, two SDK options, no enumeration, no
computed complement, no drift risk. `disallowedTools` earns no separate
place here: once `tools` restricts the base set to exactly
`role_cfg.allowedTools`, there is nothing left in context for a deny-list to
additionally strip — passing both would be redundant, not defence-in-depth.
Project-registered MCP/custom tools are handled the same way as before: a
restricted role (triage, gate-maintenance) is simply never given a `query()`
configuration that registers them, so `tools` never includes them to begin
with.

Gate-maintenance's finer "environment, not assertions" boundary is **not** a
tool restriction and is not attempted as one, per `agent-interface.md:179-186`
(settled, restated for completeness): assertion definitions live outside
every agent-reachable worktree — physically outside the directory tree that
`ctx.worktreePath` (the SDK's `cwd`) points into. Gate-maintenance's
`role_cfg.allowedTools` includes edit tools (it must be able to fix
environment files), but the boundary that keeps it off assertion definitions
is that no path under `worktreePath` resolves to them. Nothing here reuses
`toolAliases` (`research.md §5`) — the physical-location mechanism already
gives a correct, simple guarantee; adding a path-guarded tool alias on top
would be exactly the "path guard that has to be correct to be safe" the
design already rejects in favour of reusing worktree scoping.

## 5. Security & compliance

- **Blast radius per role is enforced twice, at two different layers, for
  two different failure modes**: `tools` (SDK-level restriction of the base
  tool set — "can this role invoke tool X at all") and worktree scoping via
  `cwd`
  (filesystem-level, covers "can an edit tool this role *does* have reach
  file Y"). Neither substitutes for the other — a role with edit authority
  still needs the physical-location boundary, and a role confined to the
  right directory still needs the tool restriction (e.g. triage must not be
  able to edit at all, regardless of path).
- **No secrets or credentials pass through the prompt.** The five-slot
  template only ever carries case-file-derived content (task intent, gate
  evidence, prior rationales) and authored domain fragments — nothing from
  the environment is interpolated into prompt text.
- **The primitive trusts the SDK's schema retry but does not rely on it
  being present.** `research.md §5`'s finding that the SDK can itself retry
  against the JSON Schema and terminate on `structured_output_retry_exhausted`
  is treated as a latency/cost optimisation only — the harness's own
  `envelopeSchema.parse()` on whatever `structured_output` the SDK finally
  returns is what actually determines `INCOMPLETE_TERMINUS`, so behaviour is
  identical whether the installed SDK version does or doesn't retry
  server-side.

## 6. Testing strategy

`agent-interface.md`'s "Relationship to the mock" section states the
correspondence is exact because the mock "sits at the CLI seam the SDK
spawns" — `research.md §4` confirms this concretely: `claude-mock` is wired
in via the SDK's own `pathToClaudeCodeExecutable` option plus
`CLAUDE_MOCK_SCRIPT`/`CLAUDE_MOCK_JOURNAL` env vars, mocking at the CLI/stdio
seam rather than at `query()` or HTTP.

**This has one direct architectural consequence: there is one implementation
of `AgentPort`, not two.** `createClaudeAgentPort` is not swapped out for a
separate "mock AgentPort" in tests — the same code path (prompt assembly,
`query()` call, envelope validation, terminus mapping) runs whether
`pathToClaudeCodeExecutable` points at the real `claude` binary or at
`claude-mock`'s. This is what makes an SDK shape change "surface as a parse
failure against the real primitive rather than a passing fiction"
(`agent-interface.md:202-203`) — a hand-written test double for `AgentPort`
would not have this property, since it would never actually construct a
`query()` call or parse a `structured_output` field.

Two test tiers, following the codebase's existing pattern
(`case-file.test.ts`, `run-gate.test.ts`: temp dir per test, vitest, no
process spawn where avoidable):

1. **Pure-function unit tests, no SDK/process involved** — `assemblePrompt`
   (determinism: same case file twice → identical string; slot ordering and
   content), the allow/deny tool-list computation, and envelope validation
   (`envelopeSchema.parse` against hand-built valid/invalid payloads,
   including the "worker emits a triage-only status" exploit case
   `agent-interface.md:140-141` names) are all plain data-in/data-out
   functions and are tested exactly like every other pure function in this
   codebase already is.
2. **`AgentPort` integration tests against `claude-mock`**, exercising the
   real `query()` call path with `pathToClaudeCodeExecutable` pointed at the
   mock binary. `research.md §4` flags that `claude-mock` is a **sibling
   project, not vendored in this repo** — `tools/claude-mock` does not exist
   here yet, and formal vendoring/publishing is Item 7's ("brief" detail
   level, not yet spec'd). **Decision, resolving that gap explicitly rather
   than assuming it away:** this item's own required CI suite does not take
   a hard dependency on `claude-mock` being present at a fixed path — tier 1
   (pure functions) is what CI enforces unconditionally. Tier 2 integration
   tests are written against `claude-mock` and run when it is resolvable
   (e.g. on `PATH`, as it is on this development machine today via `npm
   link`), matching how a contributor's machine may or may not have it
   installed before Item 7 formalises distribution. Item 7 is what upgrades
   this from "best-effort on this machine" to "a first-class, CI-enforced
   dependency" — this item does not pre-empt Item 7's own design by vendoring
   it early.
3. **Tool-authority enforcement itself is not verifiable through the mock**
   (`research.md §4`: `claude-mock`'s source has no `allowedTools`/`tools`
   handling at all — it scripts replies and effects, never checks the tool
   set passed in). This is called out explicitly rather than assumed
   covered: the mock-based test tier proves envelope shape, prompt
   determinism, and terminus mapping; it does **not** prove a restricted
   tool call is actually refused. That guarantee rests on the SDK's own
   enforcement of `tools`, exercised (if at all, within this item's scope)
   by a small number of real-SDK integration tests, not the mock suite.
   This is a known testing gap this document surfaces rather than silently
   treating the mock as full coverage.

A demo (`demos/agent-invocation-slice-N-*.ts`, matching the existing
`demos/single-surface-slice-*.ts` pattern) drives one real `invoke()` call
against `claude-mock` end to end, proving the wiring without a live API call,
the same "no live API calls" property the state-machine's own demo already
has for the rest of the loop.

## 7. NFRs

- **Determinism**: byte-identical prompts for identical case-file state,
  achieved structurally (§3) rather than by convention — no clock/random
  input anywhere in `assemblePrompt`, and `sessionKey` deliberately excluded
  from prompt content.
- **No hidden retries inside the primitive.** `invoke()` calls the SDK
  exactly once per call and returns exactly one `Terminus` (or lets a schema
  failure/crash map to `INCOMPLETE_TERMINUS`) — it does not itself loop or
  retry. All retry/redispatch logic already lives in the driver, gated by
  the case-file's population budgets (Item 3, unchanged). Keeping retries
  out of the primitive is what keeps "one call, identical mechanism" true
  and keeps the driver the single place budget caps are enforced.
- **Observability**: every invocation's prompt and structured output are
  independently reconstructable — the prompt from `assemblePrompt` given the
  case file at that log position (no separate prompt log needed), the
  reply from the case file's own `terminus` entry plus, in tests, the
  mock's journal. No new persisted artefact type is introduced by this item.
- **Cost/latency**: exactly one SDK session per `invoke` call, matching "one
  call, identical mechanism for every role" — no speculative parallel
  sessions, no internal fan-out.

## 8. Extensibility: a fourth role

Adding a role means authoring one more `RoleConfig` (system-prompt fragment,
`envelopeSchema`, `allowedTools`, budget knobs) and one more driver call site
that decides when to reach for it — `invoke()` itself does not change, per
"one primitive, roles are configs" (`agent-interface.md` governing decision
1). The one condition a fourth role must satisfy to fit this item's shipped
code without further change: its `envelopeSchema`'s status vocabulary must
be expressible as a zod discriminated union the same way worker/gate-
maintenance's is. A role whose result shape doesn't fit that pattern hits
the same `Terminus`-type-widening question flagged for triage in §1 above —
not a new problem this item introduces, the same one, now with a name for
when it needs solving.

## 9. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Envelope + payload schema validation | **Reuse-estate** — zod (`^4.5.4`, already a dependency) | Add `ajv`/`joi`/`yup`/`io-ts` | `research.md §6`: zod is already the codebase's exclusive schema-validation library (`src/schema.ts`), used for the structurally identical "discriminated union + `z.infer`" problem (`GateRef`). No other schema library exists anywhere in `package.json`. |
| JSON Schema generation for the SDK's `outputFormat` | **Reuse-estate** — zod v4's native `z.toJSONSchema()` | Hand-write a second schema per role in raw JSON Schema; add a zod-to-JSON-Schema conversion library | `research.md §5`+§6: the SDK wants a plain JSON Schema object; zod v4 (confirmed installed version) converts natively. Hand-authoring a second schema format per role would be a duplicate, driftable source of truth against the zod schema already used for harness-side validation. |
| SDK session spawn / process management | **Buy** — `@anthropic-ai/claude-agent-sdk` (new dependency; not yet in `package.json`, per `research.md §5`) | Shell out to the `claude` CLI directly and parse stdout by hand | The SDK is the first-party, versioned interface to exactly this (`query()`, `outputFormat`, `tools`/`allowedTools`, session options) — hand-rolling CLI stdout parsing would duplicate what the SDK already does and would not benefit from the SDK's own schema-retry behaviour (`research.md §5`). |
| Structured-output constraint enforcement | **Buy** — SDK's `outputFormat: { type: 'json_schema' }`, server/CLI-side | Freeform text output + harness-side regex/parsing to extract structured data | `research.md §5,§7`: this is Anthropic's first-party version of the "forced-shape output" pattern; reimplementing constrained decoding or freeform-text parsing on top would be strictly worse and is exactly the kind of hand-rolling the SDK exists to avoid. |
| Tool authority (allow/deny) | **Buy** — pass `role_cfg.allowedTools` straight through as the SDK's `tools` option (true positive restriction of the base tool set) alongside `allowedTools` (auto-approval) | A computed `disallowedTools` complement against "the SDK's built-in tool set" | Rejected during review: there is no runtime enumeration of the SDK's built-in tool names to complement against (`ToolInputSchemas` is compile-time-only) — that approach would force exactly the hand-maintained, version-drifting tool list this document set out to avoid. `tools` restricts the base set directly, natively, with zero enumeration and zero drift risk — a stronger buy, not a build. |
| Prompt template assembly | **Build** — pure function, five fixed slots | A templating library (Handlebars, Mustache, etc.) | The template is five concatenated slots in a fixed order with no conditionals, loops, or partials — a templating engine would add a dependency and an indirection layer for something string concatenation already does exactly, and would risk non-determinism from library-internal formatting choices. |
| Test double for the SDK seam | **Reuse-estate** (partial — see §6) — `claude-mock`, sibling project, formal vendoring deferred to Item 7 | Hand-write a bespoke `AgentPort` test double for this item | `agent-interface.md`'s "Relationship to the mock" section and `research.md §4` establish `claude-mock` as the exact, purpose-built fake for this seam, mocking at the CLI/stdio boundary the SDK itself spawns — a hand-written double would exercise a different (weaker) code path than production and wouldn't need to change on an SDK shape change, which is precisely the property the mock is designed to give up. |
| Per-invocation SDK-level resource caps (role_cfg budget knobs) | **Deferred** — no decision made in this item | — | `research.md §5` summary point 4: genuinely not resolved by this research; `agent-interface.md` itself defers this to "the budget design." This item reserves the field (§1) without guessing at SDK option names it hasn't verified. |

## 10. Operability / DX

**Environment**: Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint`
lint config, `vitest` as the test runner — unchanged from the rest of the
codebase. One new runtime dependency: `@anthropic-ai/claude-agent-sdk`,
added to `package.json`'s `dependencies` (it is what `src/agent-invoke.ts`
imports `query` from). No new devDependency is required — `claude-mock` is
not vendored by this item (§6); a contributor who has it on `PATH` (as this
development machine does, per `research.md §4`) gets tier-2 integration
coverage locally, and everyone gets tier-1 coverage regardless.

**Harness / scaffolding**: this item adds three files to the flat `src/*.ts`
+ `src/*.test.ts` layout the rest of the codebase already uses —
`src/role-config.ts` (the `RoleConfig` instances for worker and
gate-maintenance), `src/prompt-assembly.ts` (`assemblePrompt`), and
`src/agent-invoke.ts` (`createClaudeAgentPort`, implementing `AgentPort`) —
plus their `.test.ts` files. `src/ports.ts` and `src/index.ts` gain the new
exports (`createClaudeAgentPort`, `workerRoleConfig`,
`gateMaintenanceRoleConfig`, `assemblePrompt`) alongside what they already
export; no existing export changes shape.

**Local-run story**: `npm test` runs the full suite (tier 1 always, tier 2
when `claude-mock` resolves — see §6); `npm run demo:agent-invocation-slice-N`
(new script, matching the existing `demo:surface-slice-N` naming) drives one
real `invoke()` call end to end against `claude-mock`, printing the assembled
prompt and resulting `Terminus` to the terminal — the same "prove the seam
without a live API call" property the state-machine's own demos already
have. No new CLI surface, no new configuration file format: this item is a
library addition, consumed the same way every other `src/*.ts` module in
this package already is (imported from `src/index.ts`). A user-facing CLI
(Item 8) and project-level configuration authoring (Item 9) are both
downstream of this item and out of scope here, per the roadmap.

**Deploy target**: unchanged — this remains an npm-installable TypeScript
library with no server, container, or hosted component. `invoke()` runs
wherever the harness process runs (the same machine that owns the worktree),
consistent with every other seam built so far.
