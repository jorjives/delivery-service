---
type: phase-design-architecture
created: 2026-09-13
roadmap_item: 7
---

# Agent Mock — Architecture

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 7.
> Mechanism spec this design extends: `docs/agent-interface.md` ("Relationship to the mock").
> Builds on: `2026-09-09-agent-invocation-primitive-design.md` (Item 4, `invoke`/`AgentPort`),
> `2026-09-11-close-interface-design.md` (Item 6, closers, temp-repo testing pattern).
> Grounded in: `docs/prd/2026-09-13-agent-mock/research.md` (all citations below refer to it
> unless a repo path is given directly).

This is a TypeScript testing-library design, not a service. The usual platform/auth/API-layer
headings mostly don't apply; what follows covers the parts of the template that do.

## 1. Public testing API surface and module boundary

One new barrel, `src/testing.ts`, mirroring the existing `src/index.ts` convention (research
§1.9, `src/index.ts`): the runtime barrel is the harness's public contract, the testing barrel
is the testing seam's. It re-exports from three new flat `src/*.ts` files, no directory nesting
introduced:

| File | Exports | Job |
|---|---|---|
| `src/agent-port-double.ts` | `fakeAgentPort` | the honest, cast-free `AgentPort` double (§2) |
| `src/mock-script.ts` | `MockExpectation`, `MockScript`, `writeMockScript`, `JournalEvent`, `readJournal`, `assertFullyConsumed`, `expectEnvelope` (SHOULD) | typed view over claude-mock's own script/journal JSON (§4, §5, §9) |
| `src/mock-session.ts` | `mockSessionEnvironment` | resolves the vendored binary + wires `SessionEnvironment` and env vars (§3) |
| `src/scripted-surface-run.ts` | `runSurfaceAgainstMock` | composes the above with real gates/closers/temp repos into one end-to-end run (§6) |

`src/index.ts` gains no new exports; nothing in it changes shape, matching the precedent both
shipped specs set (Item 4 and Item 6 additions were new files plus additive-only barrel
changes).

**Stability contract.** This package has no `main`/`exports` field yet and no independent
subpath-publishing scheme (`package.json`, checked directly) — that is Item 8/9's packaging
concern, not invented here. Until then, `src/testing.ts`'s exports carry the same contract as
`src/index.ts`'s: documented, adopter-facing, breaking changes named in the adopter guide the
same way `docs/configuring-a-role.md` documents `role_cfg`. Nothing outside `src/index.ts` and
`src/testing.ts` is public; everything else in `src/` stays free to change, as today.

## 2. The honest role-typed double: removing the cast, `AgentPort` unchanged

**`AgentPort` itself does not change.** `invoke<R extends AgentRole>(roleCfg: RoleHandle & {
role: R }, ctx): Promise<RoleTerminusMap[R]>` is the correct contract — it is what gives a
worker double that returns a triage shape a compile error today would be a real regression, and
the generic method is load-bearing for production (`createAgentPort` itself, `src/ports.ts`,
research §1.1). Widening it to a role-scoped `AgentPort<R>` or an overload set (research §3,
options 1–2) would ripple into `SurfacePorts`, `createAgentPort`, and every driver call site for
a testing-only concern, and research's own caution (microsoft/TypeScript#50050, research §3.1)
flags the overload route as carrying a real assignability trap.

The design instead follows research §3's option 3 — a mapped handler record, the same pattern
`RoleConfigs` already uses in production (`src/agent-invoke.ts:153-157`) — and confines the one
structurally-unavoidable cast to a single, shared factory:

```ts
type RoleHandlers = { [R in AgentRole]?: (ctx: AgentContext) => Promise<RoleTerminusMap[R]> };

export function fakeAgentPort(handlers: RoleHandlers): AgentPort {
  function dispatch(roleCfg: RoleHandle, ctx: AgentContext) {
    switch (roleCfg.role) {
      case "worker": return (handlers.worker ?? reject(roleCfg.role))(ctx);
      case "triage": return (handlers.triage ?? reject(roleCfg.role))(ctx);
      case "gate-maintenance": return (handlers["gate-maintenance"] ?? reject(roleCfg.role))(ctx);
    }
  }
  // One cast, same root cause as createAgentPort's own (src/agent-invoke.ts:169):
  // TypeScript cannot correlate a switch's per-branch return with the generic
  // RoleTerminusMap[R] at the AgentPort boundary. Owned here, once, not at 23 call sites.
  return { invoke: dispatch as AgentPort["invoke"] };
}
```

Verified by compiling both directions against `--strict` (this session, not claimed from the
pattern alone, per research §6's flag to validate before committing): a handler returning the
correct role's shape type-checks; a `worker` handler returning `{ status: "reroute" }` (a triage
shape) is rejected with `Property 'rationale' is missing`. The honesty the idea document asked
for holds.

This removes the cast from all 22 non-production call sites (research §1.3's table: `src/*.test.ts`
doubles, `demos/*.ts` doubles) by construction — every one becomes `fakeAgentPort({ worker: ... })`
or similar, with no `as AgentPort["invoke"]` of their own. The migration of existing call sites is
delivery work, not this document's concern (see "What this does not include").

`RoleHandlers` intentionally matches `RoleConfigs`'s shape (a record keyed by role, each value's
type pinned to that key) rather than inventing a new pattern — an extender who has read one
already knows the other.

## 3. Relationship to `claude-mock`: process-level seam vs in-process double

Two doubles exist for two different jobs; the design does not collapse them into one.

| | `fakeAgentPort` (in-process) | `claude-mock` (process/CLI seam) |
|---|---|---|
| What it exercises | Nothing below `AgentPort.invoke` — no prompt assembly, no schema validation, no SDK, no tool authority | The real `invoke()` → real SDK → stream-json over stdio → real envelope/schema validation (research §2.5, `docs/agent-interface.md:216-223`) |
| Speed | Fastest — no process spawn | Slower — one real subprocess per invocation (research §4) |
| Proves an adopter's own `role_cfg` works | No — bypasses it entirely | Yes — this is the only double that runs the adopter's actual system-prompt fragment, envelope schema, and tool list through the real wiring |
| Right for | Surface/router/triage-level tests that need precise control of a Terminus and don't care how it was produced (this repo's own `surface.test.ts`, `triage.test.ts` style tests) | The roadmap's actual ask: "test your gate/closer/role-config pipeline end to end" (roadmap Item 7; `docs/agent-interface.md`'s "Relationship to the mock") |

Using `fakeAgentPort` for the adopter's own end-to-end pipeline test would prove nothing about
their `role_cfg` — it never reaches `invoke()`. Using `claude-mock` for every driver-logic unit
test would be needless process-spawn cost for tests that only need "worker terminus is
`completed`". Both stay in the public testing API; the guide (product-designer's concern) states
this decision table so an adopter picks correctly first time, not through trial and error.

## 4. Reaching `claude-mock` without `npm link`

**Scope of this decision: today's clone-based adopter model.** `docs/configuring-a-role.md:27-29`
states the harness's current distribution reality directly: "the harness is not published as a
package yet" — an adopter works from a clone of this repo, importing from `./src/index.js`, not
from an installed npm package. Everything below satisfies the reachability MUST *for that model*:
a clone's `npm install` reaching a working `claude-mock` binary with no `npm link` step. It does
not yet answer what happens once Item 8/9 publishes this harness as an installable package — see
the residual noted at the end of this section and in "Operability / DX".

Research §5 rules out three of four packaging options on their own evidence: a registry publish
needs unsetting `claude-mock`'s `"private": true`, adding a license, and a release process for a
sibling project (highest upstream cost); a git dependency needs a `prepare` script or committed
`dist/` that doesn't exist upstream today; a workspace needs a repo-layout decision outside this
item's scope. The review-log's own scoping (`docs/prd/2026-09-13-agent-mock/review-log.md`)
names the fourth directly: "vendor `claude-mock` so a plain `npm install` reaches it" — option 4,
vendoring.

**Decision: vendor a copy under `vendor/claude-mock/`, wired as a `file:` devDependency.**

- `vendor/claude-mock/` holds both the source (`src/cli.ts`, `src/mock.ts`, for anyone who needs
  to read what a scripted turn actually does) and a committed, prebuilt `dist/cli.js`
  (executable bit set), matching what `claude-mock`'s own `bin` field already points at
  (research §2.2). Committing the build output, rather than relying on an install-time build
  step, sidesteps the exact uncertainty research flagged for the git-dependency option (no
  verified `prepare` hook) — zero external dependency and zero install-time build risk.
- `package.json` gains `"claude-mock": "file:./vendor/claude-mock"` under `devDependencies`. A
  plain `npm install` (and `npm ci`) then populates `node_modules/.bin/claude-mock` exactly as
  a registry or git dependency would (research §5, closing paragraph) — no global state, no
  `sudo npm link`, works identically in CI.
- `mockSessionEnvironment` (`src/mock-session.ts`) is the one place that knows the binary's
  location: it resolves `pathToClaudeCodeExecutable` to `node_modules/.bin/claude-mock`
  (README's own documented alternative to a bare `PATH` lookup, research §5's closing note),
  rather than every test or demo hard-coding the string `"claude-mock"` as they do today
  (research §1.9). This is also what makes the existing `isOnPath("claude-mock")` skip
  machinery (`src/on-path.ts`, research §1.4) obsolete for every suite that switches to
  `mockSessionEnvironment` — the binary is now always present after `npm install`, so those
  tiers stop skipping in CI. (Retiring the now-dead `isOnPath` call sites is delivery clean-up,
  not an architectural decision — noted here because it is this decision's direct consequence.)

**Accepted cost, named rather than hidden**: this repo now owns keeping the vendored copy in
sync with the sibling project (research §5, option 4's stated trade-off). That cost is
accepted because every alternative needs a change to a project outside this item's scope
(unpublishing `private`, adding a license, or a repo-layout migration) — see the buy-vs-build
ledger.

**Residual, stated not solved**: a `file:` entry under `devDependencies` is correct for today's
clone-based model, but `devDependencies` are not installed for a package's own downstream
consumers — once Item 8/9 publishes this harness to a registry, an external adopter's
`npm install` of the published package would **not** receive `claude-mock`, because
`devDependencies` are stripped from what a consumer installs and because whether `vendor/` is
even included in the published tarball is a `files`/`.npmignore` decision nobody has made yet.
Closing that gap — moving `claude-mock` to `dependencies` (or a documented peer expectation) and
deciding whether `vendor/` ships in the tarball — is Item 8/9's packaging work, not something
this design can resolve ahead of a distribution model that doesn't exist yet. It is flagged here
so Item 8/9 does not rediscover it from a broken installed package.

## 5. Journal and expectation-consumption assertions

No new journal format: `claude-mock`'s own JSONL events (`matched` | `unmatched` |
`effect_failed` | `finished`, each carrying `session_id`, `prompt`, `expectation` or
`unconsumed`, research §2.3) are the format. `src/mock-script.ts` adds a typed `JournalEvent`
union over exactly those four shapes and two helpers:

- `readJournal(path): JournalEvent[]` — parses the JSONL file line by line.
- `assertFullyConsumed(events): void` — throws naming every entry still listed in the
  `finished` event's `unconsumed` array, so an adopter's under- or over-specified script fails
  loudly with the unmatched expectation's index, not a passing test that quietly proved less
  than intended.

This directly serves the roadmap's "adopters can write their own mock expectations ... without
reading harness internals" criterion: an adopter asserts `assertFullyConsumed(readJournal(path))`
and `events.some(e => e.event === "matched" && e.prompt.includes(...))` without ever parsing
JSONL or knowing the event vocabulary exists beyond these two calls.

## 6. Scripted end-to-end surface runs, with real gates/closers, against temp repos

`runSurfaceAgainstMock` (`src/scripted-surface-run.ts`) is pure composition of existing,
unchanged production primitives — no new state-machine or driver logic:

```
runSurfaceAgainstMock({ dir, repoPath, worktreePath, roleConfigs, gateRef, closerRef, script })
  1. writeMockScript(script) -> a temp CLAUDE_MOCK_SCRIPT path
  2. mockSessionEnvironment({ journalPath }) -> SessionEnvironment
  3. ports.agent  = createAgentPort(roleConfigs, session)   // src/agent-invoke.ts, unchanged
     ports.triage = deterministicRouter | createAgentTriage  // caller's choice, unchanged
     ports.closer = resolveCloser(closerRef, repoPath)        // src/resolve-closer.ts, unchanged
  4. gate resolved via resolveGate(gateRef, repoPath)          // src/resolve-gate.ts, unchanged
  5. provisionWorktree(...) against a real temp git repo       // src/provision.ts, unchanged
  6. run(dir, location, ports)                                 // src/surface.ts, unchanged
  <- { result: RunResult, journal: JournalEvent[] }
```

Every numbered step reuses a primitive already read in this bundle (`src/agent-invoke.ts`,
`src/surface.ts`, `src/resolve-gate.ts`, `src/resolve-closer.ts`, `src/provision.ts`) — this is
the "one implementation of `AgentPort`, not two" principle Item 4's spec already established
(`2026-09-09-agent-invocation-primitive-design.md`, "Testing strategy"), extended one level up
to the whole surface. The temp-repo-with-real-git pattern is Item 6's own testing precedent
("Real temp git repos, no mocked git", `2026-09-11-close-interface-design.md` §Testing), reused
rather than re-derived. This is what makes "worker → gate → close, no live API calls" (the
roadmap's own phrase) an actual, runnable helper rather than an assembly instruction left to
every adopter.

## 7. Unmatched, malformed, and leftover expectations → `INCOMPLETE_TERMINUS`

No new mapping: `agent-invoke.ts`'s existing terminus rules (`DID_NOT_COMPLETE`,
`src/agent-invoke.ts:22-27`) already produce the right outcome for every case claude-mock can
script, because the mock replies over the same stdio the real CLI would:

| Mock behaviour | SDK-level result | `invoke()` outcome |
|---|---|---|
| Prompt matches no expectation | Journal `unmatched`; mock returns an error result (research §2.3) | `result.is_error` → `INCOMPLETE_TERMINUS`, `DID_NOT_COMPLETE.errored` |
| Expectation has `reply` but no `json` | No `structured_output` on the result | `INCOMPLETE_TERMINUS`, `DID_NOT_COMPLETE.noEnvelope` |
| `json` set but fails `roleCfg.envelopeSchema` (e.g. wrong role's status) | `structured_output` present, harness-side `safeParse` fails | `INCOMPLETE_TERMINUS`, `DID_NOT_COMPLETE.wrongShape` |
| `fail.message` | `is_error: true` result | `INCOMPLETE_TERMINUS`, `DID_NOT_COMPLETE.errored` |
| Script has expectations left unconsumed when the run ends | Journal `finished` names them in `unconsumed` | Not an `invoke()` outcome at all — a script-authoring signal, asserted by `assertFullyConsumed` (§5), never surfaced to the harness |

The fourth row matters: "leftover expectations" is not something the harness can observe live
(it has no way to know a script over-specified); it is purely a test-authoring correctness check,
which is why `assertFullyConsumed` is a separate, opt-in assertion rather than something
`runSurfaceAgainstMock` enforces unconditionally — a legitimate script may intentionally leave
unreachable expectations unexercised (e.g. one written for a branch a particular test run never
takes).

## 8. Tool-authority modelling: decision — out of scope

`claude-mock` models no `allowedTools`/`tools` at all (research §2.5, its own "Deliberately not
built" list naming "permission-prompt flows" verbatim), a gap already stated, not silently
worked around, in two shipped specs (`2026-09-09-agent-invocation-primitive-design.md:281`,
`2026-09-10-triage-and-router-design.md:447`) and in `docs/agent-interface.md:189-193`. The
review-log's non-goals name "re-specifying `claude-mock`'s internals" explicitly out of scope.

This design does not add permission modelling to the vendored copy. Reasons:

- It is a change to the mock's own matching/effects engine, which the critic's phase-choice
  review explicitly gates against ("if either draft re-derives its own expectation matcher ...
  that is a build-vs-buy violation and blocks approval", review-log).
- The guarantee it would need to provide — that an out-of-role tool call is refused — already
  rests on the real SDK's `canUseTool` enforcement, exercised by real-SDK integration tests per
  Item 4's own testing strategy; a mock-level model would be a second, weaker copy of the same
  guarantee, not a replacement for it.
- claude-mock's own stated policy is to add such capability "when a harness test needs it — not
  speculatively" (SKILL.md, research §2.5) — no test in this item's scope needs it, since the
  MUST list is about the testing seam's honesty and reachability, not about closing the
  authority-modelling gap.

Residual, named for whoever picks this up later: if a future item genuinely needs to prove a
tool refusal through the mock, the extension point is claude-mock's own expectation vocabulary
(e.g. a scriptable `deniedTools` field), built in the sibling project when that test exists —
not retrofitted here.

## 9. Data model: scripts and journal

No new wire format — `src/mock-script.ts` types exactly claude-mock's existing JSON, so the file
written to `CLAUDE_MOCK_SCRIPT` and the file read from `CLAUDE_MOCK_JOURNAL` are byte-identical
to what a hand-written script/journal would be (research §2.3):

```ts
interface MockExpectation {
  when?: { promptContains?: string } | { promptMatches?: string };
  effects?: Array<{ write: { path: string; content: string } } | { edit: { path: string; old: string; new: string } }>;
  reply?: string;
  json?: unknown;           // set to the role's envelope shape by the caller
  fail?: { message: string };
  delayMs?: number;
}
interface MockScript {
  init?: { slash_commands?: Array<{ name: string; description: string }> };
  delayMs?: number;
  expectations: MockExpectation[];
}
type JournalEvent =
  | { session_id: string; event: "matched"; prompt: string; expectation: number }
  | { session_id: string; event: "unmatched"; prompt: string }
  | { session_id: string; event: "effect_failed"; detail: string }
  | { session_id: string; event: "finished"; turns: number; unconsumed: number[] };
```

`writeMockScript` is `JSON.stringify` to a temp path; `readJournal` is a line-split `JSON.parse`.
Zod is not used to model claude-mock's own wire format, on purpose, breaking from the codebase's
usual convention: these types describe an external project's format for authoring convenience
(editor autocomplete), not a boundary this harness validates at runtime — claude-mock validates
its own script, and a malformed script is claude-mock's concern to reject, not this repo's to
re-validate.

**SHOULD, agreed with the product-designer's independent design**: `expectEnvelope(roleCfg,
envelope)` — a thin helper that runs `roleCfg.envelopeSchema.parse(envelope)` (the adopter's own
existing zod schema, already required by `RoleConfig`, no new schema authored) before assigning
the result to an expectation's `json` field. This is a genuine reuse, not a new validation
boundary: it catches an adopter's authoring typo (a `json` payload that would fail `invoke()`'s
own `safeParse` and silently become an `INCOMPLETE_TERMINUS` the adopter didn't intend) at script
-authoring time instead of at test-run time, using the exact schema `invoke()` will apply later.
Not MUST: a script author who wants to deliberately exercise the malformed-envelope path (§7)
calls `writeMockScript` directly and skips this helper.

## 10. Security

- **No network.** Every call in `runSurfaceAgainstMock` and every `fakeAgentPort` test stays
  local: `claude-mock` makes no outbound calls (confirmed no runtime `dependencies`, research
  §2.2), and the SDK is pointed at it via `pathToClaudeCodeExecutable`, never the real API
  endpoint.
- **No API keys in tests.** `SessionEnvironment.env` (the only environment a test may set,
  `src/agent-invoke.ts:41-44`) never needs an Anthropic API key when pointed at the vendored
  mock; the testing guide states this as a property, not merely a convenience — an adopter's
  CI can run the full testing story with zero secrets configured.
- **Vendored copy provenance.** `vendor/claude-mock/`'s committed `dist/cli.js` is built from
  the source committed alongside it in the same commit, so a diff of the vendored directory is
  auditable the same way any other committed dependency would be; no build step reaches outside
  the repo at test time.
- **Licensing of the vendored copy, stated rather than left silent.** `@jorj/claude-mock`'s
  `package.json` is `"private": true` with no `license` field, and this repo has no `LICENSE`
  file either (checked directly). Copying that source into this repo is a decision this design
  makes explicitly, not by omission: both projects share one author (this repo's git config),
  so vendoring carries no third-party rights question — it is exactly what internal-estate reuse
  by the same owner looks like, not a license violation. The vendored copy inherits whatever
  license this repo itself eventually adopts; it does not need, and this item does not add, a
  license of its own ahead of that. If this harness is ever open-sourced (the roadmap's own
  stated direction) without `claude-mock` itself being licensed for redistribution, that is a
  licensing decision for whoever does the open-sourcing to make explicitly at that time — not a
  gap this design leaves hidden.

## 11. NFRs

- **Determinism**: `fakeAgentPort` is deterministic by construction (a plain async function per
  role). `claude-mock`-backed runs are deterministic in outcome (scripted, first-unconsumed-match
  semantics, research §2.3) but not in wall-clock timing unless `delayMs` is pinned; tests assert
  on journal content and terminus outcomes, never on timing, matching the existing codebase
  convention (no test in this repo asserts wall-clock duration).
- **Speed**: in-process doubles add no process-spawn cost, unchanged from today. `claude-mock`
  runs add one subprocess per invocation, unchanged from today (research §4) — vendoring changes
  reachability, not per-call cost.
- **No hidden retries**: `runSurfaceAgainstMock` calls `run()` exactly once to completion; any
  retry/redispatch behaviour observed is the surface driver's own existing budget logic
  (`src/surface.ts`), not new behaviour introduced here.

## 12. Testing the testing API itself

The testing module is product code and is tested as such, at the same two tiers Item 4
established (`2026-09-09-agent-invocation-primitive-design.md`, "Testing strategy"):

1. **Pure-function unit tests, no process spawn**: `fakeAgentPort`'s dispatch (correct role
   routed, unhandled role rejects with a named error), `mock-script.ts`'s `writeMockScript`/
   `readJournal`/`assertFullyConsumed` round-trip against hand-built JSON/JSONL fixtures.
2. **Real-mock integration test**: one small suite (no longer gated by `isOnPath`, since
   vendoring makes the binary always present, §4) that drives `runSurfaceAgainstMock` against a
   real temp git repo with a real gate and a real closer, proving the composition in §6 actually
   completes a surface to `CLOSED` with no live API call — this is also the demo the guide
   points to, following the existing `demos/*-slice-N-*.ts` convention.

Because `fakeAgentPort` and `mock-script.ts` are pure functions over data, they need no fixture
beyond hand-built JSON — no snapshot testing, no golden files.

## 13. Extensibility

Adding a role (a hypothetical fourth) means one more optional field on `RoleHandlers` — no
change to `fakeAgentPort`'s dispatch shape beyond adding a `case`. Item 10's multi-surface
interleavings (several surfaces sharing a repo lock, concurrent scripted runs) are explicitly
future: `runSurfaceAgainstMock` runs exactly one surface against one temp repo, and nothing in
this design assumes or precludes a later helper that runs several — that composition is Item
10's, built on this one, not designed here.

## Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Scripted CLI-seam fake for the SDK (expectation matching, effects, journal, envelope shaping) | **Reuse-estate** — `claude-mock`, sibling project, unchanged | Hand-roll a new in-process or process-level fake | Already exists, purpose-built for exactly this seam, and already load-bearing in three shipped specs (Items 4–6). Re-deriving its matcher/journal is the review-log's own named build-vs-buy violation. |
| Reaching the mock without `npm link` | **Build (vendor)** — commit source + prebuilt `dist/cli.js` under `vendor/claude-mock/`, wired as a `file:` devDependency | (1) registry publish, (2) git dependency, (3) npm workspace | Registry needs unsetting `private`, adding a license, and a release process upstream (most upstream change). Git dependency needs a `prepare` script or committed `dist/` claude-mock doesn't have. Workspace needs a repo-layout decision outside this item. Vendoring is the review-log's own named expectation and needs zero upstream change, at the accepted cost of owning sync with the sibling project. |
| Honest role-typed test double | **Build** — `fakeAgentPort`, a mapped handler record + one shared dispatch function | (a) widen `AgentPort` to a role-scoped generic or overload set; (b) leave the 22 hand-written casts as-is | (a) ripples into `SurfacePorts`/`createAgentPort`/every call site for a testing-only concern, and carries a validated TypeScript overload-assignability trap (microsoft/TypeScript#50050) the chosen pattern avoids. (b) leaves the exact problem the idea document raised unresolved. The mapped-record shape reuses `RoleConfigs`'s own existing pattern rather than inventing one. |
| Script/journal typing | **Build (thin)** — TS interfaces mirroring claude-mock's existing JSON 1:1, no new format, no runtime validation | zod schemas for the script/journal shape, matching the codebase's usual convention | Deliberate exception: these types describe an external project's wire format for editor ergonomics only; claude-mock already validates its own script, so a second, harness-side validator would duplicate that project's own responsibility for no adopter-visible benefit. |
| Journal-consumption assertions | **Build** — two small helpers (`readJournal`, `assertFullyConsumed`) | A generic JSONL/log-assertion library | The vocabulary (four fixed event shapes) is small, fixed, and specific to claude-mock's own contract; a general-purpose library would add a dependency and indirection for a five-line parse. |
| End-to-end surface composition (worker → gate → close against a temp repo) | **Reuse-estate** — compose existing `createAgentPort`, `run`, `resolveGate`, `resolveCloser`, `provisionWorktree` unchanged | A new, parallel "test-mode" surface runner | Item 4's "one implementation of `AgentPort`, not two" principle extended: reusing the real driver is what makes an SDK or driver-shape change surface as a broken test rather than a passing fiction, exactly as the real primitive's own testing strategy already argues. |
| Temp-repo fixtures for the end-to-end run | **Reuse-estate** — the close-interface's own "real temp git repos, no mocked git" pattern | A fake/in-memory git layer | Already proven and already the codebase's stated preference (`2026-09-11-close-interface-design.md`, Testing). |
| Schema library (where any validation genuinely is this repo's, e.g. none new here) | **Reuse** — zod, where used at all | — | Consistent with every other contract in the codebase; not introduced fresh by this item since §9 deliberately opts out of runtime validation for the external wire format. |

## Operability / DX

- **Environment**: unchanged — Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint`
  config, `vitest`. One new devDependency, `"claude-mock": "file:./vendor/claude-mock"`; no new
  runtime dependency (the vendored mock itself ships no runtime `dependencies`, research §2.2).
- **Harness / scaffolding**: four new flat `src/*.ts` files (§1) plus their tests, and one new
  top-level directory, `vendor/claude-mock/` (source + committed prebuilt `dist/`), sitting
  outside `src/` the way `demos/` and `tests/` already do — an extender who knows the existing
  layout has one new, self-explanatorily-named directory to learn, not a new convention.
- **Local-run story**: `npm install` alone (no `npm link`, no manual step) makes
  `node_modules/.bin/claude-mock` resolvable; `mockSessionEnvironment` resolves it automatically.
  `npm test` runs every tier unconditionally — the `isOnPath`-gated skip/refuse machinery
  (research §1.4) has nothing left to gate once every consumer moves to `mockSessionEnvironment`.
  A new demo (`demo:agent-mock-slice-N`, matching the existing `demo:*` script convention)
  drives `runSurfaceAgainstMock` end to end and prints the resulting `RunResult` and journal.
- **CI story**: `.github/workflows/ci.yml`'s existing `npm ci && npm run lint && npm test` needs
  no new step — vendoring is exactly what makes that true. This closes the concrete operability
  gap research found: every mock-gated suite silently skips in CI today (research §1.4); after
  this design, none do.
- **Distribution / deploy target**: none — this is a library-level testing seam consumed
  in-process by an adopter's own test suite, not a service. Today, per `docs/configuring-a-role.md`'s
  "not published as a package yet," every adopter works from a clone, so `vendor/claude-mock/`'s
  committed `dist/` reaches them the same way every other file in the repo does — no separate
  publish or deploy step. **Stated residual for Item 8/9**: `devDependencies` are not installed
  for a published package's own consumers, and whether `vendor/` even ships in a published
  tarball is an unmade `files`/`.npmignore` decision — so publishing this harness as an
  installable package, unmodified, would silently drop `claude-mock` for an external adopter.
  Item 8/9's packaging work must decide then whether `claude-mock` becomes a `dependency` (not a
  `devDependency`) and whether `vendor/` is included in the published files; this design does not
  resolve that ahead of a distribution model that doesn't exist yet, only names it.

## What this design does not include

- **Migrating the 22 existing hand-cast call sites** (`src/*.test.ts`, `demos/*.ts`) onto
  `fakeAgentPort` — delivery work downstream of this document, not an architectural decision.
- **Tool-authority modelling inside `claude-mock`** — explicitly out of scope, §8.
- **Item 10's multi-surface interleavings** — a later composition on top of
  `runSurfaceAgainstMock`, not built here (§13).
- **A CLI or project-level configuration surface for authoring scripts declaratively** — Items 8
  and 9's concern, consistent with how role/gate/closer authoring is scoped in shipped specs.
- **Publishing `@jorj/claude-mock` to a registry, or moving it into an npm workspace** — both
  rejected in §4 in favour of vendoring, for this item.
- **Recorded-fixture replay, mid-stream truncation, or shell-command effects in the mock** —
  claude-mock's own stated non-goals (research §2.5), unaffected by this item.
