# Research: Agent Mock (Roadmap Item 7)

Sources are cited inline as `file:line` for repo facts and as bare URLs for external facts.
All repo paths are relative to the worktree root
(`/home/jorjives/.local/state/autoloop/home-jorjives-dev-delivery-service-.claude-worktrees-autoloop-main/worktrees/20260913T211119Z`)
unless stated otherwise.

## 1. Current state: the harness's own agent seam

### 1.1 `AgentPort` and the role/terminus mapping

`src/ports.ts:6` defines the three roles as a literal union:

```ts
export type AgentRole = "worker" | "triage" | "gate-maintenance";
```

`src/ports.ts:34-38` maps each role to its terminus type:

```ts
export interface RoleTerminusMap {
  worker: Terminus;
  "gate-maintenance": Terminus;
  triage: TriageTerminus;
}
```

`src/ports.ts:40-42` is the port itself — one generic method, keyed by role:

```ts
export interface AgentPort {
  invoke<R extends AgentRole>(roleCfg: RoleHandle & { role: R }, ctx: AgentContext): Promise<RoleTerminusMap[R]>;
}
```

`RoleHandle` (`src/ports.ts:14-16`) is just `{ role: AgentRole }` — the driver's handle for
"which role", never the full pinned config (prompt fragment, envelope schema, tool authority),
which lives in `role-config.ts` per the doc comment at `src/ports.ts:8-13`. `SurfacePorts`
(`src/ports.ts:126-130`) bundles `agent: AgentPort` with `triage: TriagePort` and
`closer: CloserPort` — the three ports a surface run needs.

### 1.2 `createAgentPort` and `SessionEnvironment`

`src/agent-invoke.ts:41-44` defines the only session settings a caller may supply:

```ts
export interface SessionEnvironment {
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string | undefined>;
}
```

The doc comment (`src/agent-invoke.ts:33-40`) explains why this is an allowlist rather than
`Partial<Options>`: a deny-list would silently widen the day the SDK adds an option, and the
point of the seam is that a role's authority cannot be widened from outside. `buildSessionOptions`
(`src/agent-invoke.ts:57-75`) assembles the full SDK `Options`, pinning `settingSources: []`,
`permissionMode: "default"`, `permissionPrompts: "host"`, and passing `session.pathToClaudeCodeExecutable`
/ `session.env` straight through — the only two fields a test or demo can vary.

`createAgentPort` (`src/agent-invoke.ts:164-170`):

```ts
export function createAgentPort(configs: RoleConfigs, session: SessionEnvironment = {}): AgentPort {
  // One cast: TypeScript cannot correlate `configs[role]`'s envelope type with
  // RoleTerminusMap[R] across a generic key. RoleConfigs pins that mapping.
  const run = (roleCfg: RoleHandle, ctx: AgentContext) =>
    invoke(configs[roleCfg.role] as RoleConfig<unknown>, ctx, session);
  return { invoke: run as AgentPort["invoke"] };
}
```

This is the **one cast the harness's own production code carries**, and its comment already
names the root cause every hand-written double also hits: TypeScript cannot correlate a value
indexed by a generic key (`configs[roleCfg.role]`) with a generic return type
(`RoleTerminusMap[R]`) at the call site, even though `RoleConfigs` (`src/agent-invoke.ts:153-157`)
pins the very same correlation one level up, per-field.

### 1.3 Every `as AgentPort["invoke"]` cast site

Grepping `src`, `demos`, and `tests` for the literal cast (23 hits, one is the production
cast above):

| File:line | Context |
|---|---|
| `src/agent-invoke.ts:169` | production `createAgentPort` (see 1.2) |
| `src/triage.test.ts:41` | test double factory, `return { calls, invoke: run as AgentPort["invoke"] }` |
| `src/triage.test.ts:46` | inert double: `invoke: (() => Promise.reject(...)) as AgentPort["invoke"]` |
| `src/surface.test.ts:50` | test double factory, `return { invoke: run as AgentPort["invoke"] }` |
| `src/surface-close.test.ts:42` | double literal cast |
| `src/surface-close.test.ts:199` | inline role-branching closure cast |
| `demos/single-surface-slice-1-provisioning.ts:49,55` | two double literals |
| `demos/single-surface-slice-2-happy-path.ts:42` | double literal |
| `demos/single-surface-slice-3-setbacks.ts:66` | double literal |
| `demos/single-surface-slice-4-budgets.ts:102,142` | two double literals |
| `demos/single-surface-slice-5-crash-recovery.ts:103,207` | two double literals |
| `demos/close-interface-slice-1-merge-back.ts:48` | double literal |
| `demos/close-interface-slice-2-branch-and-teardown.ts:49,67` | two double literals |
| `demos/close-interface-slice-3-close-failure.ts:51` | double literal |
| `demos/close-interface-slice-4-custom-closer.ts:66` | double literal |
| `demos/close-interface-slice-5-open-pr.ts:51` | double literal |
| `demos/triage-slice-1-informed-retry.ts:139` | double literal |
| `demos/triage-slice-2-escalation-packets.ts:127` | double literal |
| `demos/triage-slice-3-last-attempt.ts:133` | double literal |

Every hand-written `AgentPort` double in the estate carries this cast — confirming the idea
`50-20260912T085724Z-agent-port-test-doubles-need-a-cast.md`'s claim of "20+ sites" (23 counted
here, including the one production site). The cast silences exactly the role/terminus
correlation the generic `invoke<R>` signature exists to enforce: a double that returns a
`worker` `Terminus` when asked for `triage` type-checks today.

### 1.4 How mock-backed tests/demos skip without `claude-mock` on PATH

`src/on-path.ts:5-9` is the detection primitive:

```ts
export function isOnPath(name: string): boolean {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && existsSync(join(dir, name)));
}
```

Two distinct skip mechanisms are used:

1. **Vitest-level skip**, e.g. `src/agent-invoke.test.ts:19` (`const hasMock = isOnPath("claude-mock")`)
   and `src/surface.test.ts:1564` (`describe.skipIf(!isOnPath("claude-mock"))("triage by agent
   through the real invocation seam", ...)`) — the suite is not run at all.
2. **Demo-level refusal**, e.g. `demos/agent-invocation-slice-1-worker-invocation.ts:59-61`:
   the demo calls `isOnPath("claude-mock")` itself, and if absent prints
   `"claude-mock is not on PATH.\n\n"` plus guidance and exits non-zero (pattern repeated across
   every `demos/*.ts` that touches the real invocation seam — 7 files). The UAT tests in
   `tests/agent-invocation-primitive/*.test.ts` and `tests/triage-and-router/*.test.ts` then
   assert on that exact string (e.g.
   `tests/agent-invocation-primitive/1-wire-a-worker-to-a-real-invocation-and-get-back-a-typed-result.test.ts:48`)
   rather than skipping — the demo itself degrades gracefully and the UAT test accepts either
   outcome (`const mockMissing = stdout.includes("claude-mock is not on PATH")`, same file:38).

Net effect: **no test or demo in this repo fails outright when `claude-mock` is missing**, but
a plain `npm install` (no `npm link`) never exercises the real invocation path at all — every
mock-gated suite silently skips and every real-seam demo prints a refusal and exits 1. This is
exactly the packaging gap Item 7 is scoped to close (see §6).

### 1.5 `docs/agent-interface.md` — "Relationship to the mock"

`docs/agent-interface.md:180-224` states the correspondence claude-mock is built to satisfy:
one `invoke` ↔ the mock's scripted turn loop; envelope ↔ the expectation's `json` field;
worktree edits ↔ `effects` (`write`/`edit`, applied for real inside `cwd`); terminus mapping ↔
unmatched/malformed replies exercising `INCOMPLETE_TERMINUS`; verification ↔ the journal.
Because the mock sits at the CLI seam the SDK itself spawns, "an SDK shape change surfaces as a
parse failure against the real primitive rather than a passing fiction"
(`docs/agent-interface.md:222-223`).

`docs/agent-interface.md:234-236` states the vendoring status directly:

> `claude-mock` is a **sibling project, not vendored into this repo**. Install it with
> `npm link` from its own checkout so that `claude-mock` resolves on `PATH`; the mock-backed
> tests and the invocation demos skip or refuse to run without it. **Vendoring it is Item 7's.**

The tool-authority gap is also stated here (`docs/agent-interface.md:189-193`): "The runtime is
the enforcer, and the mock is not. `claude-mock` models no tool permissions, so no offline test
can drive a real out-of-role call through it... Known gap, stated rather than papered over."

### 1.6 `docs/configuring-a-role.md` — "Trying it offline"

`docs/configuring-a-role.md:158-186` walks an adopter through pointing `invoke()`'s third
argument at `claude-mock` via `pathToClaudeCodeExecutable` and `CLAUDE_MOCK_SCRIPT`, with a
worked JSON script example, and repeats the same limit: "The mock does not model tool
permissions, so it cannot show a refusal happening inside a live session"
(`docs/configuring-a-role.md:184-186`). This is the closest thing the repo currently has to an
adopter-facing "test your pipeline offline" guide, and it is scoped to one role invocation, not
a full surface run.

### 1.7 Gate-interface spec's deferral to Item 7

`docs/superpowers/specs/2026-09-04-gate-interface-design.md:341`:

> The agent mock (Item 7) will later provide end-to-end testing of the gate within [a full
> surface run].

Confirms the gate-interface spec explicitly punted end-to-end gate testing to this item.

### 1.8 The known tool-authority gap in Items 4/5 specs

- Item 4 (`docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md:281`):
  "`claude-mock`'s source has no `allowedTools`/`tools` handling at all. This is a known [gap]."
  The same design's decision ledger (line 320) records tool authority as **Buy**: the SDK's
  native `canUseTool` callback, with the residual "out-of-role read-only calls are auto-approved
  and never reach `canUseTool`" spelled out as a stated limit, not a bug to fix here.
- Item 5 / triage-and-router (`docs/superpowers/specs/2026-09-10-triage-and-router-design.md:447`):
  "Known gap, unchanged from Item 4: `claude-mock` does not enforce [allowedTools]."
- The enforcement mechanism itself lives in `src/agent-invoke.ts` and `src/tool-authority.ts`
  (not re-derived here — out of Item 7's scope per the review-log's non-goals, which exclude
  "re-specifying `claude-mock`'s internals").

### 1.9 How `surface.ts` wires the three ports, and what a full offline run needs

`src/surface.ts:11` imports `SurfacePorts`, `TriageInput`, `EscalationCause`, `TriageVerdict`,
`CloseContext` from `ports.ts`. `SurfacePorts` (`src/ports.ts:126-130`) is passed into the
surface driver as one bundle: `{ agent: AgentPort; triage: TriagePort; closer: CloserPort }`.
`closeContextOf` (`src/surface.ts:38-46`) and `terminate` (`src/surface.ts:75-91`) show the
closer being invoked with a `CloseContext` built from case-file state, independent of the agent
port. The state machine dispatches to `agent.invoke` for worker/gate-maintenance rounds and to
`triage.triage` for setbacks, per the role-keyed contract in §1.1.

For a **scripted end-to-end offline surface run** (worker → gate → close, no live API calls),
the current pieces that exist are: `createAgentPort` (real SDK, pointable at `claude-mock` via
`SessionEnvironment`), the deterministic router (`TriagePort`, no agent needed for most setbacks
per `docs/configuring-a-role.md`'s "When triage is asked" table), and `noopCloser`
(`src/ports.ts:120-122`) or a real closer run against a temp repo. What is **missing** today,
per the review-log's derived MUST scope, is: (a) a documented, public way to wire all three
against `claude-mock` without `npm link`; (b) an honest (uncast) way to script per-role agent
behaviour for a test's own doubles, since even `RoleConfigs`-based `createAgentPort` still needs
`claude-mock` on PATH to be genuinely end-to-end; (c) no existing demo or test drives all three
ports together through a real gate execution against a mocked agent — the closest is
`src/surface.test.ts:1564`'s `describe.skipIf` block, which mocks only the agent side and uses
the deterministic router for triage, plus `noopCloser`-equivalent doubles.

## 2. The estate `claude-mock` project

### 2.1 Location

`/usr/bin/claude-mock` is a symlink (`lrwxrwxrwx`) to
`../lib/node_modules/@jorj/claude-mock/dist/cli.js`, i.e.
`/usr/lib/node_modules/@jorj/claude-mock/dist/cli.js`. `readlink -f` resolves this to the real
checkout: **`/home/jorjives/dev/tools/claude-mock`**. This confirms it is installed via
`sudo npm link` (global symlink into `/usr/lib/node_modules`, `bin` entry symlinked into
`/usr/bin`) rather than published to a registry.

### 2.2 `package.json` (`/home/jorjives/dev/tools/claude-mock/package.json`)

```json
{
  "name": "@jorj/claude-mock",
  "version": "0.1.0",
  "description": "Scripted fake Claude Code CLI for testing agent harnesses offline",
  "type": "module",
  "bin": { "claude-mock": "./dist/cli.js" },
  "scripts": {
    "build": "tsc && chmod +x dist/cli.js",
    "dev": "tsc --watch",
    "test": "npm run build && vitest run"
  },
  "engines": { "node": ">=20" },
  "private": true,
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.245",
    "@types/node": "^25.5.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.2"
  }
}
```

Key facts for packaging decisions (§6):

- **`"private": true`** — this field, on its own, blocks `npm publish` to any registry until
  removed. It does not block a git dependency or a local `npm install <path>`/workspace
  reference (`private` only gates the `publish` command and accidental publishing, not
  `install`).
- **No `dependencies` field at all** — `@anthropic-ai/claude-agent-sdk` is a **devDependency**,
  used only by its own `test/sdk.test.ts` to drive the real SDK against the built binary. The
  shipped `dist/cli.js` has no runtime npm dependencies of its own (confirmed by the absence of
  a `dependencies` key and by the SDK section being under `devDependencies`).
- **No `license` field present** in `package.json`, and no `LICENSE` file at the repo root
  (`ls /home/jorjives/dev/tools/claude-mock` lists `CLAUDE.md, dist, node_modules, package.json,
  package-lock.json, README.md, skills, src, test, tsconfig.json, vitest.config.ts` — no
  `LICENSE`). Unlicensed and marked private: not currently packagable for public/npm-registry
  distribution as-is; a git dependency or vendoring is unaffected by license absence for
  internal-estate use but would need a license added before any external distribution.
- **`bin.claude-mock`** points at `./dist/cli.js`, a compiled, executable (chmod +x, per the
  README's own build step) single entry point — no other files are required at runtime beyond
  whatever `dist/` produces.

### 2.3 Script format, journal shape, env vars (from the `understanding-claude-mock` skill and README)

Both the skill (`/home/jorjives/.claude/skills/understanding-claude-mock/SKILL.md`) and the
project's own `README.md` describe the same contract; the skill is more complete, so it is
quoted here:

- **Env vars**: `CLAUDE_MOCK_SCRIPT` (required — path to the expectations JSON) and
  `CLAUDE_MOCK_JOURNAL` (optional — path the mock appends verification lines to).
- **Script shape**: a bare array of expectations (backward compatible), or an object
  `{ init?, delayMs?, expectations: [...] }`. `init.slash_commands` is forwarded verbatim into
  the init message; other init fields (tools, skills, agents) "use the same pattern when
  needed" (i.e., not yet built beyond `slash_commands`).
- **Expectation fields**: `when.promptContains` (substring), `when.promptMatches` (regex source
  string), `effects` (`{"write":{path,content}}` or `{"edit":{path,old,new}}`, applied for real
  inside `cwd`, each emitting a `tool_use`/`tool_result` pair), `reply` (assistant text + result
  message text), `json` (sets `structured_output` on the result message), `fail.message` (an
  `is_error: true` result carrying that text), `delayMs` (per-expectation override of the
  script-level default).
- **Matching rule**: "each prompt consumes the first unconsumed expectation that matches it. An
  expectation with no `when` matches anything" — this is the mechanism the skill documents for
  scripting a nudge/retry: put the conditional response first, the unconditional fallback after.
  Identical-prompt retries cannot currently be told apart (stated limit).
- **Journal shape**: one JSON line per turn, e.g.
  `{"session_id":"…","event":"matched","prompt":"summarise the repo","expectation":0}` and
  `{"session_id":"…","event":"finished","turns":1,"unconsumed":[]}`. `event` ∈ `matched` |
  `unmatched` | `effect_failed` | `finished`. An unmatched prompt returns an **error result**
  rather than inventing a reply — this is the mechanism `docs/agent-interface.md` cites for
  exercising `INCOMPLETE_TERMINUS`.

### 2.4 Test coverage

`/home/jorjives/dev/tools/claude-mock/test/sdk.test.ts` is the only test file (confirmed by
`find ... -iname "*.test.*"`). The skill states these tests "drive the **real** SDK against the
built binary — treat them as the contract" (SKILL.md line 113). `npm test` runs `npm run build
&& vitest run` (package.json `scripts.test`), so tests always exercise the compiled artefact,
never source directly. Source is `src/cli.ts` (179 lines — protocol + turn loop) and
`src/mock.ts` (124 lines — matching, effects, SDK message construction), per direct line counts
and the skill's own description of the split.

### 2.5 Limits (stated by the project itself)

The skill's "Deliberately not built" section (SKILL.md lines 120-124) lists, verbatim:
recorded-fixture replay, `error_max_turns` / mid-stream truncation, shell-command effects,
**permission-prompt flows** — i.e. no tool-permission modelling, confirmed independently by
`docs/agent-interface.md:189-191` and the Item 4/5 spec citations in §1.8. The skill states the
policy for these: "Add each in the repo when a harness test needs it — not speculatively,"
meaning the mock project itself, not this repo, is where such additions would land — consistent
with the review-log's non-goal "re-specifying `claude-mock`'s internals."

## 3. TypeScript techniques for honest role-generic test doubles without casts

The idea document's complaint is specific: `AgentPort.invoke<R extends AgentRole>(roleCfg: RoleHandle
& { role: R }, ctx: AgentContext): Promise<RoleTerminusMap[R]>` cannot be implemented by an
object literal whose body branches on `roleCfg.role` without TypeScript widening the return type
to the union of all `RoleTerminusMap` members, which does not structurally match
`RoleTerminusMap[R]` for the caller's `R`. Candidate techniques, in rough order of how directly
each targets the actual cast site:

1. **Overloaded call signatures on the double's `invoke`.** TypeScript overload resolution picks
   the first matching signature by *argument* shape, so a double could declare
   `invoke(roleCfg: RoleHandle & {role: "worker"}, ctx): Promise<Terminus>` and similarly for the
   other two roles, plus a general fallback signature satisfying `AgentPort["invoke"]` for
   assignability. This avoids the cast on the *implementation* side but has a known assignability
   trap noted independently by TypeScript's own issue tracker: "Overloaded function with at least
   one generic overload can be assigned to any function with at least the same number of
   parameters" (microsoft/TypeScript#50050), which is a caution to test explicitly, not a reason
   to avoid the pattern outright.
2. **Role-scoped `AgentPort<R>`.** Define `interface AgentPort<R extends AgentRole = AgentRole> {
   invoke(roleCfg: RoleHandle & {role: R}, ctx: AgentContext): Promise<RoleTerminusMap[R]> }` and
   have `SurfacePorts.agent` accept a union or an intersection of per-role ports, or keep the
   existing generic `AgentPort` for production but let a *test double* be built from three
   single-role ports composed together (e.g. a small `combineAgentPorts({worker, triage,
   "gate-maintenance"})` helper that switches on `roleCfg.role` and dispatches to the
   correctly-typed single-role handler — the switch's each-branch return type is checked against
   that branch's own concrete type, not the generic `RoleTerminusMap[R]`, so no cast is needed
   inside the helper; only the helper's own internal branch dispatch, written once, carries any
   narrowing responsibility, and it can be written without an `as` by returning from inside each
   `case`).
3. **Mapped handler records**: `{ [R in AgentRole]?: (roleCfg: RoleHandle & {role: R}, ctx:
   AgentContext) => Promise<RoleTerminusMap[R]> }`. A test author fills in only the roles their
   test exercises; a thin adapter (written once, in production or a shared test-support module)
   does the same switch-based dispatch as above. This is the shape that best matches how
   `RoleConfigs` (`src/agent-invoke.ts:153-157`) already pins the same correlation for production
   role configs — reusing the *same pattern* (a record keyed by role, each value's type pinned to
   that key) for test doubles is the natural sibling.
4. **`satisfies`** (TypeScript 4.9+) validates that a value conforms to a type without widening
   its inferred type (see §5's citation). Applied here: authoring a handler record `satisfies`
   the mapped-record type in point 3 lets TypeScript both check the record is complete/correctly
   shaped *and* keep each handler's own narrow signature for use elsewhere (e.g. spying on calls
   with the correct per-role argument type), which a `: Type` annotation would not, because it
   would widen every handler to the union.
5. Each of these still needs **one written-once dispatch function** translating "record keyed by
   role" into "the single generic `invoke` method `AgentPort` requires" — this is unavoidable
   given `AgentPort`'s own shape is a single generic method, not a record. The design question
   for Item 7 is whether that one dispatch function is cast-free (achievable, since each branch's
   return type is concrete) and whether it is written once in shared test-support code (so no
   individual test or demo repeats it) rather than at all 22 call sites found in §1.3.

External references on the underlying type-system behaviour:

- TypeScript 4.9 release notes, `satisfies` operator:
  https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html
- Generic-overload assignability gap (a caution for approach 1):
  https://github.com/microsoft/TypeScript/issues/50050
- Mapped types with conditional generics and overload resolution (a caution for combining
  approaches 1 and 3 in one signature):
  https://github.com/microsoft/TypeScript/issues/62377
- Background on function overloads generally: https://oida.dev/typescript-function-overload/

## 4. Prior art / competitive landscape for LLM/agent test doubles

| Project | Seam mocked | Mechanism | Notes |
|---|---|---|---|
| Vercel AI SDK | In-process, the `LanguageModel` interface | `MockLanguageModelV2`/`V3` classes exported from `ai/test`, constructed with scripted `doGenerate`/`doStream` responses | In-process fake; tightly coupled to the SDK's own model-version interface, which has already broken compatibility across major versions (V2 removed in v6, replaced by V3) — see https://ai-sdk.dev/docs/ai-sdk-core/testing and the migration issue https://github.com/vercel/ai/issues/8994. |
| LangChain (JS & Python) | In-process, the `ChatModel`/`LLM` interface | `FakeListChatModel` returns a predefined response list in order, raises/exhausts after the list ends | In-process fake, per-language (a separate class in JS and Python); simplicity trades off against not exercising any transport/serialisation code. See https://python.langchain.com/api_reference/core/language_models/langchain_core.language_models.fake_chat_models.FakeListChatModel.html and https://js.langchain.com/v0.2/docs/integrations/chat/fake/. |
| Claude Agent SDK (community ports) | Varies by language binding | The Elixir binding documents a "Mocking System" enabled via an env var with a local mock server matching prompts to scripted responses (https://hexdocs.pm/claude_agent_sdk/mocking.html); the Go binding's `agenttest` package exports a `MockTransport` at the transport layer (https://pkg.go.dev/github.com/johnayoung/claude-agent-sdk-go/agenttest) | No single first-party (Anthropic) SDK-level mocking layer surfaced in this search; each community/language binding has re-solved this independently, which is exactly the fragmentation `claude-mock`'s CLI-seam choice avoids (one binary serves every language that shells out to `claude`). |
| OpenAI Agents SDK | Tool calls and handoffs | A documented "mock mode" for function tools and direct Agent handoffs; explicitly **fails closed** (does not mock) for explicit `Handoff` objects, MCP servers, hosted tools, sandboxed agent capabilities, reusable prompt templates, or provider data overriding tools/prompt | Guidance quoted in search results: "Mock the model when the test checks your code, tools, state, or a controlled failure," recommending a layered strategy (pure code → tools/state → a small real-model integration tier) rather than one universal fake — see https://www.samuelfaj.com/en/blog/testing-ai-agents-mock-the-model-or-use-the-real-api/. |
| Polly.js / nock / VCR-style tools | HTTP transport | Record real HTTP interactions once, replay deterministically thereafter (HAR format for Polly.js) | General-purpose HTTP record/replay, not agent-specific; would sit *below* an SDK that talks HTTP directly, which the Claude Agent SDK does not do from the harness's perspective — it shells out to the `claude` CLI, so an HTTP-layer mock would need to sit inside a process this harness never spawns directly. See https://github.com/Netflix/pollyjs/ and https://netflix.github.io/pollyjs/. |
| msw (Mock Service Worker) | HTTP transport (network-level interception) | Intercepts `fetch`/XHR at the network layer, in-process or in a service worker | Same transport-layer mismatch as Polly.js/nock for this harness: the seam that needs faking is a spawned CLI process's stdio, not an HTTP call this repo's own process makes. |

**Trade-off: process-level fake (the CLI seam, `claude-mock`'s choice) vs in-process fake (the
port seam, e.g. `MockLanguageModelV2`/`FakeListChatModel`):**

- **Process-level (CLI seam)**: exercises the *entire* real SDK code path — message parsing,
  the tool-use transcript, structured-output validation, the control protocol — because the SDK
  itself spawns the fake binary and talks stream-json over stdio exactly as it would to the real
  `claude` CLI (`docs/agent-interface.md:216-217`, the skill's overview). Language-agnostic: the
  same `claude-mock` binary can serve a TypeScript harness, a Python one, or anything that shells
  out (skill overview, `README.md`). Cost: slower (a real subprocess spawn per test), and cannot
  model behaviour the real CLI implements below the level the fake replicates (tool permissions,
  per the stated gap in §2.5).
- **In-process (port seam)**: faster, trivially scriptable in the test's own language, and
  naturally typed against the port's own interface (`AgentPort` here) — but every SDK version
  bump risks silently drifting from what the real SDK actually does, since the fake never runs
  any of the SDK's own code. The Vercel AI SDK's own mock classes illustrate this cost directly:
  they had to be versioned (`V2` → `V3`) in lockstep with the SDK's own model-interface version,
  and a mismatch produces a runtime break rather than a compile error
  (https://github.com/vercel/ai/issues/8994, https://github.com/vercel/ai/issues/8356).

`claude-mock`'s choice (CLI seam) is the harder-to-build, more-faithful option, and it is
already reuse-estate for this repo (§1.5, §2). The idea and roadmap Item 7 are about the
*harness-side* wiring around that seam (honest doubles, packaging, a documented end-to-end
surface run) — not about replacing the seam choice itself, which the review-log's non-goals
confirm ("re-specifying `claude-mock`'s internals" is out of scope).

## 5. Packaging: reaching `claude-mock` from a plain `npm install`

Current state: `claude-mock` is resolved from `PATH` after a manual, machine-local
`sudo npm link` in its own checkout (§2.1, `docs/agent-interface.md:234-235`). This fails for
any adopter who runs a plain `npm install` on a fresh checkout of this harness, or in CI.

Options, given `@jorj/claude-mock` is `"private": true` with no `dependencies` field, no
`license`, `bin.claude-mock -> ./dist/cli.js` (§2.2):

1. **devDependency from the npm registry.** Requires unsetting `"private": true`, adding a
   `license` field, and running `npm publish` for `@jorj/claude-mock` (scoped package, would
   need `--access public` or a paid private-scope plan). Once published, this repo's
   `package.json` gains `"@jorj/claude-mock": "^0.1.0"` under `devDependencies`, and
   `node_modules/.bin/claude-mock` is populated automatically by npm from the package's `bin`
   field — no `npm link` needed by any adopter. Highest ongoing cost (a release process for a
   sibling project) for the cleanest adopter experience.
2. **Git dependency.** `package.json` devDependency value
   `"github:jorjives/claude-mock#<commit-or-tag>"` (or the full
   `git+ssh://…`/`git+https://…` form) per npm's documented git-URL dependency syntax
   (https://docs.npmjs.com/cli/v10/configuring-npm/package-json#git-urls-as-dependencies).
   `"private": true` does **not** block this — `private` only gates `npm publish`, not
   `npm install` of a git URL or a local path. npm's install step for a git dependency runs
   `prepare`/`build` scripts if present (`package.json`'s `build` script would need to be
   discoverable as `prepare`, or the checkout would need prebuilt `dist/` committed) — the
   current `scripts.build` is named `build`, not `prepare`, so a git-dependency install would
   need either a `prepare` script added upstream or a change to always commit `dist/`. No
   license is required for a private git dependency used internally, though adding one remains
   good practice.
3. **npm workspace.** Only viable if `claude-mock` moves inside this repo's own monorepo root
   (or a shared monorepo containing both) — the review-log's "vendoring" language, and
   `docs/agent-interface.md:234`'s "not vendored into this repo" framing, both point at this as
   the literal meaning of "vendoring": bring the checkout inside the repo (or a workspaces root)
   as a workspace package, so `npm install` at the root links it automatically via npm's own
   workspace symlinking — closest to a real `npm link` but without the manual, global,
   machine-local step.
4. **Vendoring (copy) the built artefact.** Commit a prebuilt `dist/cli.js` (or the whole
   `claude-mock` source) directly into this repo under, e.g., `vendor/claude-mock/` or
   `tools/claude-mock/`, with its own `bin` wiring via a local `package.json` `dependencies`
   entry using a `file:` specifier (`"claude-mock": "file:./vendor/claude-mock"`), which npm
   treats similarly to a local path install and also populates `node_modules/.bin`. Zero
   external dependency at install time, but this repo then owns keeping the vendored copy in
   sync with the sibling project's evolution — a maintenance cost the "sibling project" framing
   was presumably chosen to avoid in the first place.

**How `node_modules/.bin` resolution interacts with `pathToClaudeCodeExecutable`:** any of
options 1-4 that result in an npm-managed dependency (registry, git, workspace, or `file:`) 
causes npm to populate `node_modules/.bin/claude-mock` with a symlink to the package's `bin`
entry, exactly as `npm link` does today for the global case. `SessionEnvironment.pathToClaudeCodeExecutable`
(`src/agent-invoke.ts:42`) already accepts an arbitrary path string, so a test or demo can point
it at `"node_modules/.bin/claude-mock"` (a relative path resolved from the process's cwd) instead
of relying on a global `PATH` entry — the README already documents exactly this alternative
(`pathToClaudeCodeExecutable: 'node_modules/.bin/claude-mock'`, README.md's "Use" section) even
though nothing in this repo currently uses it (`grep` confirms every current
`pathToClaudeCodeExecutable` reference in this repo passes the bare string `"claude-mock"`,
relying on global `PATH`). Switching to a `node_modules/.bin` reference removes the dependency
on a global, machine-local `npm link` entirely, independent of which packaging option (1-4) is
chosen, provided `claude-mock` is an npm dependency of some kind rather than a manually-linked
global.

## 6. Open questions / handoff notes for design

- Which packaging option (§6, i.e. the four listed above) the team picks affects how much of
  Item 7's scope is "harness-side wiring" versus "claude-mock-side changes" (e.g. adding a
  `prepare` script, adding a license, moving the checkout). The review-log's non-goal
  ("re-specifying `claude-mock`'s internals") suggests preferring an option that needs the
  fewest changes to the sibling project itself — options 2 (git dependency, if `dist/` is
  committed or a `prepare` script exists) and 4 (vendoring) need the least upstream change;
  option 1 (registry) needs the most (unsetting `private`, adding a license, a publish process);
  option 3 (workspace) needs a repo-layout decision this research does not make.
- The cast-removal design (§3) has a real TypeScript pitfall (microsoft/TypeScript#50050) worth
  the architect validating with a compiled snippet before committing to an overload-based
  approach, rather than assuming it type-checks from the pattern alone.
- This research does not re-verify claude-mock's own test suite passes today, nor does it
  attempt to modify or extend claude-mock — both are out of scope per the review-log's
  non-goals and this task's own instruction not to edit anything outside this bundle.
