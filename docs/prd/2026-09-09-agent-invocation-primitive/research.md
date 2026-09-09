# Research: Agent Invocation Primitive

Factual foundation for the PRD. Every claim below is cited to a file path (+ line where useful)
or a package name + version actually present on disk. Open questions this PRD must resolve are
listed at the end, cross-referenced to their source.

## 1. What `docs/agent-interface.md` already settles

Settled (do not re-litigate in the PRD):

- **One primitive, three role configs.** `invoke(role_cfg, ctx) -> Terminus` — mechanism is
  identical across roles; only `role_cfg` content (system-prompt fragment, payload schema,
  `allowedTools`, budget knobs) varies. (`docs/agent-interface.md:34-38,51-72`)
- **Envelope is harness-owned and non-negotiable**: `{status, rationale, payload?}`, validated by
  one code path regardless of role. (`docs/agent-interface.md:24-26,117-133`)
- **Prompt is a pure function of serialised case-file state** — five fixed slots (system-prompt
  fragment, `task_def`, distilled brief, verbatim gate evidence, envelope instruction), project
  supplies content only, never structure or ordering. (`docs/agent-interface.md:85-113`)
- **Status is strict at the schema boundary, flat in storage** — a role emitting another role's
  status is an invalid envelope → `INCOMPLETE_TERMINUS`, not a silent misroute.
  (`docs/agent-interface.md:134-147`)
- **Terminus mapping is defined negatively**: anything short of a valid, role-legal,
  schema-conforming envelope is `INCOMPLETE_TERMINUS` — crash, cap, malformed output, illegal
  status, and schema failure all collapse to the same edge. (`docs/agent-interface.md:150-166`)
- **Tool authority enforced at the SDK seam via pinned `allowedTools`**, not requested in prose.
  Gate-maintenance's finer "environment, not assertions" boundary is enforced by physical
  location (assertion definitions live outside every agent-reachable worktree), not a path guard.
  (`docs/agent-interface.md:168-186`)
- **Mock correspondence is exact**: one `invoke` ↔ mock's scripted turn; envelope ↔ mock's `json`
  field; worktree edits ↔ mock's `effects`; terminus mapping ↔ what the harness does with the
  mock's reply. (`docs/agent-interface.md:188-203`)

## 2. Open items (the PRD's actual scope)

Verbatim from `docs/agent-interface.md:205-219`, this is the gap this PRD must close:

1. **`ctx` shape** — how worktree location, case-file reference, and `session_key` thread into
   the SDK's `query()` options. "Spec-level, but unspecified."
2. **Worker completion payload** — whether `completed` carries anything beyond `rationale`. Doc
   leans toward "nothing load-bearing" since a payload the harness trusts over the gate would
   violate the gate's authority (control-flow invariant 1, referenced but not reproduced here).
3. **Schema definition mechanism** — how each role's payload schema is declared and reaches the
   SDK as an output constraint (inline / referenced / generated).
4. **Budget knob placement** — whether the per-role budget fields live in `role_cfg`, in the case
   file, or split; deferred to "the budget design."

`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:213-215` (Item 4 notes) confirms
these are implementation detail the spec is expected to resolve, not blockers: "Open items (ctx
shape, schema definition mechanism) are implementation detail that can be resolved during the
spec without blocking."

## 3. Current codebase seam this primitive must slot into

`src/ports.ts` already declares the stub interfaces Item 3 built against
(`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:97` — Item 3 status not shown in
excerpt but roadmap marks it dependency-satisfied for Item 4; state-machine design doc confirms
stubbing, see below):

```ts
// src/ports.ts:5-25
export type AgentRole = "worker" | "triage" | "gate-maintenance";
export interface RoleConfig { role: AgentRole; }          // Item 4 owns what else lives here
export interface AgentContext { worktreePath: string; dir: string; sessionKey: string; }
export type Terminus =
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | { status: "incomplete"; rationale: string };
export interface AgentPort { invoke(roleCfg: RoleConfig, ctx: AgentContext): Promise<Terminus>; }
```

Two things this PRD must reconcile:

- `AgentContext` today has no case-file reference field — only `worktreePath`, `dir`,
  `sessionKey`. Open item 1 (`ctx` shape) is exactly "how does the case file get in here."
- `Terminus` today is a **3-way** union (`completed` / `escalate` / `incomplete`) with no
  triage-specific statuses (`reroute`, `fix_the_gate`, `retry_close`, `abort` — those belong to
  `TriagePort`/`TriageVerdict`, a **separate** interface in the same file, `src/ports.ts:37-44`).
  `docs/agent-interface.md`'s roles table (`:76-80`) lists triage statuses as part of the *same*
  `invoke` primitive's role-scoped status space. This is a real seam mismatch: either `Terminus`
  needs a role-parameterised discriminant, or the triage agent (Item 5, not this item) is a
  distinct caller that doesn't go through `AgentPort.invoke` for its verdict shape. Confirmed by
  `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md:531-551`: "This
  item's built-in `TriagePort` is the deterministic router only" — the *agent-backed* triage
  (Item 5) is future work and its relationship to `AgentPort` vs `TriagePort` is unresolved
  upstream of this PRD too. **Recommend flagging, not silently deciding, in the PRD.**

`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md:15,29,36-38,104-107`
confirms the stub state: `AgentPort`, `TriagePort`, `CloserPort` are "function-shaped seams the
driver calls"; `AgentPort`'s real implementation is explicitly deferred to Item 4 ("Item 4 …
builds the SDK-backed primitive described in `agent-interface.md`"); every `TRIAGE` edge
currently writes a stub artefact pending Item 5.

`src/gate-support.ts` was checked and contains no agent-invocation-relevant seam (gate delta/
fingerprint logic only) — no further citation needed there.

## 4. `tools/claude-mock` — what the design must stay compatible with

**Location note:** `tools/claude-mock` does not exist inside this repo/worktree. It is a sibling
project at `/home/jorjives/dev/tools/claude-mock` (confirmed via `find`), installed globally on
this machine (`sudo npm link`) so the `claude-mock` binary is on `PATH`. `docs/agent-interface.md`
links to it as `../../tools/claude-mock` — a relative path that does not currently resolve inside
this repo. **This is a gap the PRD or architect should flag**: either the mock needs vendoring/
submoduling into this repo (Item 7, "brief" detail level, not yet spec'd —
`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md` Item 7), or the doc link is
aspirational. Item 4 depends on being buildable against the real SDK per the roadmap
(`...roadmap.md:198`: "The agent invocation primitive can be built against the Claude SDK") —
it does not list claude-mock as a build dependency, only as the thing that must later fake this
seam.

What the mock actually expects/produces, from its own docs and source
(`/home/jorjives/dev/tools/claude-mock/README.md` via the `understanding-claude-mock` skill,
and `/home/jorjives/dev/tools/claude-mock/src/mock.ts`, `src/cli.ts`):

- It is a **scripted fake `claude` CLI binary**, wired in via the SDK's own
  `pathToClaudeCodeExecutable` option plus two env vars: `CLAUDE_MOCK_SCRIPT` (expectations JSON)
  and `CLAUDE_MOCK_JOURNAL` (optional spy log). It mocks at the CLI/stdio seam, not at `query()`
  or HTTP, so it works from any language and any SDK-shape change surfaces as a parse failure.
- Expectations match on `promptContains` / `promptMatches` against the **first unconsumed**
  expectation; `effects` (`write`/`edit`) are applied for real inside `cwd`; `json` sets
  `structured_output` on the SDK's result message — this is the field the mock uses to fake
  structured output, and it matches the real SDK's `ResultMessage.structured_output?: unknown`
  field (`sdk.d.ts:4683`, see §5).
- **The mock does not itself enforce `allowedTools`.** `grep -rn "allowedTools" src/*.ts` in the
  mock repo returned no hits — the mock scripts replies/effects but never checks the tool set
  passed at invocation. Tool-authority enforcement (open item 4's neighbour, governing decision 4
  in `agent-interface.md`) is therefore **not verifiable through the mock**; it can only be
  tested against the real SDK (or asserted as "trust the SDK's own enforcement"). The PRD/
  architecture should call this out explicitly rather than assume mock-based tests cover it.
- The mock journal records `matched` / `unmatched` / `effect_failed` / `finished` events keyed by
  prompt text and expectation index — this is the "prompt sent" verification surface the
  invocation primitive's determinism claim (open item, byte-identical prompts) will be tested
  against once Item 7 exists.
- Deliberately unbuilt in the mock today: recorded-fixture replay, `error_max_turns` / mid-stream
  truncation, shell-command effects, permission-prompt flows — i.e. today's mock cannot yet
  exercise budget-cap/timeout paths of `INCOMPLETE_TERMINUS` end-to-end; those still need adding
  "when a harness test needs it."

## 5. Claude Agent SDK support (installed version, cited by file + line)

**Not installed in this repo.** `delivery-service/package.json` (`dependencies`/`devDependencies`)
lists no `@anthropic-ai/claude-agent-sdk` entry, and `npm ls zod` here shows an otherwise-empty
`node_modules` — this repo has not yet taken the SDK as a dependency. It must be added when this
item is implemented (roadmap Item 4 dependency: "can be built against the Claude SDK").

Findings below are from the actual installed package in the sibling `claude-mock` project, which
pins **`@anthropic-ai/claude-agent-sdk@0.3.245`** (`/home/jorjives/dev/tools/claude-mock/package.json:19`,
confirmed installed at `.../claude-mock/node_modules/@anthropic-ai/claude-agent-sdk/package.json`).
This is the version claude-mock's own SDK-facing tests run against (`test/sdk.test.ts` imports
`query` from it) and is the most concrete real-world reference available in this environment.

- **Structured/schema-constrained output** — `query()`'s options take
  `outputFormat?: OutputFormat` where `OutputFormat = JsonSchemaOutputFormat` and
  `JsonSchemaOutputFormat = { type: 'json_schema'; schema: Record<string, unknown> }`
  (`sdk.d.ts:953-956,2169-2171`, option itself at `sdk.d.ts:1761-1773`). The schema is a **plain
  JSON Schema object** — no SDK-specific DSL. The SDK validates the model's output against it
  server/CLI-side: `ResultMessage.subtype` includes `'error_max_structured_output_retries'`
  (`sdk.d.ts:4609`) and `TerminalReason` includes `'structured_output_retry_exhausted'`
  (`sdk.d.ts:8103`) — i.e. **the SDK itself retries against the schema and can terminate the
  session on repeated schema failure**, before the harness ever sees a malformed envelope. The
  successful result carries the validated payload as `ResultMessage.structured_output?: unknown`
  (`sdk.d.ts:4683`), and for end-turn tool sessions using `outputFormat: {type:'json_schema'}` the
  turn ends on a tool_result carrier followed by a `structured_output` attachment holding the
  real output (documented at `sdk.d.ts:1885-1893`, in the `resumeSessionAt` fork-point guidance).
  This directly informs open item 3 (schema definition mechanism): the schema handed to the SDK
  is a JSON Schema object, so the natural implementation is deriving it from the envelope+payload
  zod schemas already used elsewhere in this codebase (see §6) rather than hand-authoring a
  second schema format.
- **`allowedTools` restriction** — `allowedTools?: string[]` (`sdk.d.ts:1422`, doc comment
  `sdk.d.ts:1416-1421`): "List of tool names that are auto-allowed without prompting... To
  restrict which tools are available, use the `tools` option instead." Distinct from
  `disallowedTools?: string[]` (`sdk.d.ts:1442`): tools named there "are removed from the model's
  context and cannot be used, even if they would otherwise be allowed" — i.e. `disallowedTools`
  is the harder guarantee. There's also `toolAliases` (`sdk.d.ts:1444-1465`) for redirecting a
  built-in tool name to a custom implementation (e.g. sandboxed Bash via MCP) — relevant if
  gate-maintenance's "edit scoped to environment" boundary later wants a narrower Edit/Write than
  the worker's, beyond what pure allow/deny lists give. **Note for the architect:**
  `agent-interface.md:172-176` speaks only of `allowedTools`; the SDK's `disallowedTools` may be
  the more precise enforcement primitive for "a role literally cannot call outside its authority"
  since it strips the tool from context entirely rather than merely not auto-approving it — worth
  the PRD/architecture deciding on explicitly rather than assuming `allowedTools` alone suffices.
- **Session resumption / fresh sessions** — `resume?: string` ("Session ID to resume. Loads the
  conversation history from the specified session," `sdk.d.ts:1851-1853`),
  `continue?: boolean` ("Continue the most recent conversation... Mutually exclusive with
  `resume`," `sdk.d.ts:1429-1432`), `sessionId?: string` (use a specific session UUID instead of
  auto-generated, `sdk.d.ts:1858-1862`), `forkSession?: boolean` ("resumed sessions will fork to a
  new session ID rather than continuing," `sdk.d.ts:1544-1547`), `resumeSessionAt?: string` (fork
  at a specific point in history, `sdk.d.ts:1867-1876`). A **fresh session** (governing decision
  2/invariant: "spawns a fresh SDK session" per `agent-interface.md:22-23,68-69`) is simply
  omitting `resume`/`continue`/`sessionId` — the SDK's default behaviour, no special flag needed.
  This maps cleanly onto `ctx.sessionKey` in `src/ports.ts:15`: the harness likely uses its own
  `session_key` for the case-file's transcript record while still asking the SDK for a fresh
  session each `invoke` (per "spawn fresh" in the governing decision), which is exactly open item
  1's `ctx`-shape question — the SDK's own `sessionId` field is available if the harness instead
  wants deterministic session IDs tied to the case file rather than SDK-generated ones.
- **System-prompt injection** — `systemPrompt?: string | string[] | {...}` (`sdk.d.ts:2121+`,
  usage examples at `sdk.d.ts:2086-2120`): a plain string replaces the default entirely ("Has no
  effect... when `systemPrompt` is a string (custom prompt)" — i.e. passing a string opts out of
  the CLI's built-in prompt, giving the harness full control, which matches
  `agent-interface.md:85-113`'s "harness owns the assembly end-to-end." This is the mechanism
  that would carry the five-slot template (system-prompt fragment, `task_def`, distilled brief,
  gate evidence, envelope instruction) as one assembled string per invocation.

## 6. Existing schema-validation dependency: zod

`package.json:32` (this repo): `"zod": "^4.5.4"` under `dependencies` — already installed and
already used for exactly this kind of contract:

- `src/schema.ts:1-45` uses zod extensively for the case-file schema: `z.enum`, `z.object`,
  `z.discriminatedUnion("type", [...])` for `GateRef` (a role/config-style variant type, directly
  analogous to what `role_cfg`'s payload-schema-per-status would need), `z.infer<>` for deriving
  TS types from the runtime schema (single source of truth, no drift between compile-time type
  and runtime validator).
- **zod v4 (this is v4, confirmed by the `^4.5.4` range) ships native JSON Schema conversion**
  (`z.toJSONSchema()`), which is the direct bridge to the SDK's `outputFormat: {type:
  'json_schema', schema: Record<string, unknown>}` requirement found in §5 — no extra library
  needed to go from a zod schema (envelope + role payload) to the plain-JSON-Schema object the
  SDK wants. This resolves the buy-vs-build question for open item 3: **reuse zod**, don't add a
  schema library or hand-roll JSON Schema.
- No other schema-validation library (`ajv`, `joi`, `yup`, `superstruct`, io-ts, etc.) appears
  anywhere in `package.json`. zod is the only candidate and it is already the codebase's
  established pattern for exactly this shape of problem (case-file schema today; envelope/payload
  schema is a structurally identical validate-and-infer-a-type problem).

## 7. Prior art / competitive landscape (brief)

This is an internal engineering primitive (one seam, three role configs), not a market-facing
feature, so this is deliberately brief:

- **"One call, config varies by role" is the same shape as this codebase's own gate and close
  interfaces** — `agent-interface.md:37-38` says so explicitly ("This mirrors the gate and close
  interfaces: one interface, variable subject"). The strongest prior art is *in this repo's own
  design language*, not an external framework — consistent with the user's standing instruction
  to prefer sibling/internal precedent over a generic pattern.
- **Structured-output-as-contract with a discriminated envelope** mirrors the general "tool-use /
  function-calling as forced-shape output" pattern common across LLM agent frameworks (e.g.
  OpenAI function calling, Anthropic tool_use, LangChain structured output parsers) — the SDK's
  own `outputFormat: json_schema` (§5) is Anthropic's first-party version of this pattern, so no
  external framework comparison is needed; the primitive should just use the SDK's native
  mechanism rather than reimplementing schema-constrained output on top of freeform text parsing.
- Not pursuing a deeper competitive survey: this is a single internal seam behind one function
  signature, not a product feature with market alternatives to benchmark against.

## Summary for the design team

The open items in `agent-interface.md` (§2 above) are this PRD's real scope. Concrete resolutions
this research surfaces as strong defaults, for the product-designer/architect to accept or
override:

1. **`ctx` shape**: extend `AgentContext` (`src/ports.ts:12-16`) with a case-file reference field;
   decide whether `sessionKey` maps to the SDK's `sessionId` (deterministic) or is a harness-only
   journal key while the SDK session stays anonymous/fresh (§5, session resumption).
2. **Worker completion payload**: doc already leans "nothing load-bearing" — this research found
   nothing in the SDK or mock that requires otherwise; a `rationale`-only `completed` payload is
   consistent with `Terminus`'s existing shape in `src/ports.ts:19`.
3. **Schema definition mechanism**: use zod schemas (already the codebase convention, §6),
   converted via `z.toJSONSchema()` to the SDK's `outputFormat.schema` (§5). No new dependency.
4. **Budget knob placement**: not resolved by this research — genuinely deferred to budget design
   per the doc's own text; flag as still-open rather than defaulting.
5. **Flag, don't silently resolve**: the `Terminus`/triage-status mismatch (§3) and the
   `tools/claude-mock` path-resolution gap (§4) are pre-existing inconsistencies this research
   surfaced but that are not this item's to fix — the architect should decide whether to note them
   as out-of-scope-but-flagged or fold a minimal fix in.
