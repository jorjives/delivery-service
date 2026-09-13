---
type: phase-design
created: 2026-09-13
roadmap_item: 7
seeded_by: [50-20260912T085724Z-agent-port-test-doubles-need-a-cast.md]
---

# Agent Mock — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 7.
> Mechanism spec this design extends: `docs/agent-interface.md` §Relationship to the mock.
> Builds on: `2026-09-09-agent-invocation-primitive-design.md` (Item 4: `invoke`, `AgentPort`, `SessionEnvironment`), `2026-09-07-single-surface-state-machine-design.md` (surface driver, `SurfacePorts`), `2026-09-04-gate-interface-design.md` (defers end-to-end gate testing to this item), `2026-09-11-close-interface-design.md` (Item 6: closers, real-temp-repo testing pattern).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed).
> Audit trail: `docs/prd/2026-09-13-agent-mock/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).
> Produced by an autonomous design-team run (`20260913T211119Z`); no human reviewed it.

## Problem

The harness can be driven end to end, but an extender cannot *test* their
delivery pipeline honestly without either paying for live agent sessions or
working around the type system. Three concrete gaps:

1. **Every in-process agent double lies to the compiler.** `AgentPort.invoke`
   is generic over the role (`invoke<R extends AgentRole>(roleCfg: RoleHandle &
   { role: R }, ctx): Promise<RoleTerminusMap[R]>`, `src/ports.ts:40-42`), so no
   concrete fake satisfies it. All 23 doubles in the repo (one in production,
   `src/agent-invoke.ts:169`; 22 across `src/*.test.ts` and `demos/*.ts`) cast
   with `as AgentPort["invoke"]`. The cast disables exactly the role/terminus
   correlation the generic exists for: a worker double returning a triage shape
   type-checks silently. (Seed idea:
   `50-20260912T085724Z-agent-port-test-doubles-need-a-cast.md`.)
2. **The real-seam mock is unreachable from a plain install.** `claude-mock`, a
   sibling estate project, already fakes the exact CLI seam the SDK spawns
   (`docs/agent-interface.md` §Relationship to the mock). It is reachable only
   through a machine-local `npm link`, so every mock-backed suite is gated with
   `it.skipIf(mockMissing)` (e.g. `tests/agent-invocation-primitive/1-*.test.ts`,
   `tests/triage-and-router/2-*.test.ts`) and silently runs nothing in CI or in
   a fresh clone. `docs/agent-interface.md` records: "Vendoring it is Item 7's."
3. **There is no adopter testing story.** The roadmap asks for "a first-class
   public API with its own documentation, not an internal testing detail" and
   "how to test your delivery pipeline". Today an extender who has written a
   gate, a closer and role configs has no documented way to prove worker →
   gate → close works without reading `src/`, and no named assertions over what
   the harness sent or what the script consumed.

**Why now.** Items 1–6 have shipped; Item 7's only dependency (Item 4) is done.
Items 8–12 all need deterministic end-to-end tests and inherit whatever testing
story this item sets, and every new demo currently copies the cast idiom.
Fixing the seam now is a refactor that simplifies every later item.

## Personas and goals

- **Primary: Priya Shah, Harness Extender** (`docs/personas.md` §1). Goal: earn
  trust in her own gate, closer and role configs *before* running a live
  surface, without reading `src/*.ts` and without API spend.
- **Harness contributors** writing the harness's own tests are the same persona
  class as Priya (an engineer who should not fight the type system to write a
  test); `docs/personas.md` is deliberately not extended for them.
- Marcus Webb and Dana Okafor are not served by this item: a mocked run produces
  no artefact they read differently from a real one.

### Primary journeys

- **J1: prove the happy path end to end.** Priya scripts her worker (one `write`
  effect and a `completed` envelope), runs a full surface in which her real gate
  measures the scripted change and her real closer lands it, and asserts from
  the journal that the prompt carried her task intent and that no expectation
  was left unconsumed. No API key, no network.
- **J2: prove misbehaviour is handled.** Priya scripts a worker that escalates
  with category `authority`, and separately one whose edit fails the gate, and
  asserts the surface reaches the escalation or retry path her budgets predict.
- **J3: fast unit tests at driver grain.** Priya (or a contributor) builds an
  in-process double for just the role a test needs, hands it a canned terminus,
  and asserts the driver's behaviour, with no subprocess and no cast.
- **J4: delete the cast.** A contributor replaces a hand-cast double with the
  honest double, with no behaviour change and no loss of type checking.
- **J5: diagnose a broken script from the failure alone.** A typo in
  `promptContains` means nothing matches; the failure names what the harness
  actually sent and which expectations were still waiting.

## Goals and success metrics

- **Time to first green scripted end-to-end test** from a fresh clone and
  `npm install`, with zero `npm link` steps and zero API-key configuration.
- **Zero `as AgentPort["invoke"]` casts** outside the two named dispatch sites
  (`createAgentPort` and `fakeAgentPort`), mechanically checkable by grep.
- **No mock-backed suite skips.** Every suite currently gated on
  `claude-mock` being on `PATH` runs unconditionally, locally and in CI.
- **A first failure message is enough.** An unmatched or unconsumed expectation
  is fixable from the assertion's message without opening `claude-mock`'s or the
  harness's source.

## Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The MUST tier below is the derived minimum,
recorded by the team-lead in `review-log.md` ("Selected phase (derived)") and
checked by the critic line by line against the roadmap's five Item 7 success
criteria: each criterion is covered, none is invented. It is scoped to today's
**clone-based adopter model**: the harness "is not published as a package yet"
(`docs/configuring-a-role.md`), so an adopter's `npm install` is this repo's
`npm install`. Reachability for a future *published* package is a named residual
for Items 8/9, not claimed here (see Operability / DX).

## Capabilities

### MUST

1. **A public testing barrel, `src/testing.ts`**, the testing seam's counterpart
   to `src/index.ts`, carrying the same documented, adopter-facing stability
   contract. Nothing else in `src/` becomes public.
2. **`fakeAgentPort(handlers)`**: an honest, role-typed in-process `AgentPort`
   double built from a role-keyed handler record. No call site needs a cast;
   a handler returning another role's terminus is a compile error. Invoking a
   role with no handler fails loudly, naming the role.
3. **`claude-mock` reachable from a plain `npm install`**: vendored into the
   repository and wired as a `file:` devDependency, with
   `mockSessionEnvironment` as the single place that resolves the binary and
   builds a `SessionEnvironment` (script and journal paths included). If the
   binary cannot be resolved, it throws a named error stating the path it tried
   and that `npm install` provides it, never a raw spawn `ENOENT`.
4. **`runSurfaceAgainstMock`**: one scripted end-to-end surface run (worker →
   gate → close) composed entirely from unchanged production primitives, with
   the caller's real gate, real closer, role configs and triage port, against
   a real temp git repo. Returns the `RunResult` and the parsed journal.
5. **Typed script and journal helpers**: `MockExpectation`, `MockScript`,
   `JournalEvent`, `writeMockScript`, `readJournal`, and
   `assertFullyConsumed`, which fails naming every unconsumed expectation by
   index and its `when` clause, and, where the journal holds `unmatched` events,
   the prompt that matched nothing.
6. **Proven `INCOMPLETE_TERMINUS` paths**: unmatched prompt, missing envelope,
   wrong-shaped envelope and scripted failure each demonstrably reach
   `INCOMPLETE_TERMINUS` through the real `invoke()`, in the testing API's own
   tests and in the guide.
7. **The harness's own doubles use the new API**: the 22 non-production
   hand-cast doubles move to `fakeAgentPort`, and the mock-backed suites move to
   `mockSessionEnvironment` and stop skipping. This is what proves the API
   against real rather than hypothetical usage, and it is the seed idea's
   actual ask.
8. **A "testing your delivery pipeline" guide** (`docs/testing-your-pipeline.md`),
   in the register of `docs/writing-a-gate.md` and `docs/writing-a-closer.md`:
   when to use which double (the decision table below), a worked J1 and J2,
   the journal assertions, the `INCOMPLETE_TERMINUS` cases, and an explicit
   statement of what the mock cannot prove (tool authority). The existing
   "Trying it offline" section of `docs/configuring-a-role.md` stays as the
   single-role quick start and points to the guide.

### SHOULD

- **`expectEnvelope(roleCfg, envelope)`**: validates a scripted `json` payload
  against the role's own `envelopeSchema` at authoring time, so an accidental
  malformed envelope fails where it is written rather than surfacing as an
  unintended `INCOMPLETE_TERMINUS`. Deliberately malformed scripts bypass it.
- **A lint/test guard** that fails on any new `as AgentPort["invoke"]` outside
  the two named dispatch sites.
- **Runnable demos** for J1 and J2, following the `demos/*-slice-N-*.ts` and
  `npm run demo:*` convention.

### COULD

- A demo using `delayMs` to show retry ordering in a budget scenario.
- Generating a starter script from a project's `RoleConfigs` (envelope shapes
  pre-filled). Speculative until an adopter asks.

## Architecture

### Module structure

| File | Exports | Job |
|---|---|---|
| `src/testing.ts` | re-exports the four modules below | public testing barrel |
| `src/agent-port-double.ts` | `fakeAgentPort`, `RoleHandlers` | honest in-process double |
| `src/mock-script.ts` | `MockExpectation`, `MockScript`, `JournalEvent`, `writeMockScript`, `readJournal`, `assertFullyConsumed`, `expectEnvelope` (SHOULD) | typed view over claude-mock's own script and journal JSON |
| `src/mock-session.ts` | `mockSessionEnvironment` | resolves the vendored binary; builds `SessionEnvironment` |
| `src/scripted-surface-run.ts` | `runSurfaceAgainstMock` | end-to-end composition |
| `vendor/claude-mock/` | — | vendored source plus committed prebuilt `dist/cli.js` |

`src/index.ts` gains no exports and nothing in it changes shape, matching the
additive precedent of Items 4 and 6.

### The honest double: `AgentPort` unchanged

`AgentPort`'s generic contract is correct and load-bearing for production; it
does not change. Widening it to `AgentPort<R>` or an overload set would ripple
through `SurfacePorts`, `createAgentPort` and every driver call site for a
testing-only concern, and overload assignability carries a known TypeScript
trap (microsoft/TypeScript#50050, research §3).

Instead, a mapped handler record, the shape `RoleConfigs` already uses in
production (`src/agent-invoke.ts`), is turned into an `AgentPort` by one shared
factory:

```ts
type RoleHandlers = { [R in AgentRole]?: (ctx: AgentContext) => Promise<RoleTerminusMap[R]> };
export function fakeAgentPort(handlers: RoleHandlers): AgentPort;
```

Inside, a `switch` on `roleCfg.role` dispatches to the matching handler or
rejects naming the missing role. The single structurally unavoidable cast lives
in that dispatch, for the same reason as `createAgentPort`'s: TypeScript cannot
correlate a switch's per-branch return with `RoleTerminusMap[R]`. One owned cast
replaces 22. The architect compiled both directions under `--strict`: a correct
handler type-checks, and a `worker` handler returning `{ status: "reroute" }` is
rejected.

### Two doubles, two jobs

| | `fakeAgentPort` (in-process) | `claude-mock` (CLI seam) |
|---|---|---|
| Exercises | nothing below `AgentPort.invoke`: no prompt assembly, schema validation, SDK or tool authority | the real `invoke()`, real SDK, stream-json over stdio, real envelope validation |
| Cost | no process spawn | one subprocess per invocation |
| Proves the adopter's `role_cfg` | no | yes: the only double that runs the system-prompt fragment, envelope schema and tool list through the real wiring |
| Right for | driver, router and triage tests needing precise terminus control (J3, J4) | pipeline tests of gate, closer and role configs (J1, J2, J5) |

Both stay public; the guide carries this table so the choice is made correctly
first time.

### Vendoring `claude-mock`

Four options were weighed (research §5). A registry publish needs the sibling
project to drop `"private": true`, gain a licence and a release process; a git
dependency needs a remote and a `prepare` build the project lacks; a workspace
needs a repo-layout decision outside this item. **Vendoring** needs no upstream
change.

`vendor/claude-mock/` holds the source (for readers who need to see what a
scripted turn does) and a committed, prebuilt, executable `dist/cli.js`, the
path its own `bin` field names, so installation involves no build step.
`package.json` declares `"claude-mock": "file:./vendor/claude-mock"` under
`devDependencies`, which populates `node_modules/.bin/claude-mock` on
`npm install` and `npm ci`. `mockSessionEnvironment` resolves
`pathToClaudeCodeExecutable` to that location, so no test or demo hard-codes
`"claude-mock"` or depends on `PATH`, and the `isOnPath`-based skipping
(`src/on-path.ts`) has nothing left to gate for these suites.

Accepted cost: this repository owns keeping the vendored copy in step with the
sibling project. The `claude-mock` script format, matching rule, effects and
journal are **not** changed.

### Scripted end-to-end run

`runSurfaceAgainstMock({ dir, repoPath, worktreePath, roleConfigs, triage,
gateRef, closerRef, script })` introduces no driver logic. `triage` is the
caller's own `TriagePort` — `deterministicRouter` or a `createAgentTriage(...)`
wrapping the same mocked `AgentPort` — passed in like every other port, not
chosen internally: `runSurfaceAgainstMock` has no basis for picking between
them on the caller's behalf. It writes the script to a temp path, builds the
session with `mockSessionEnvironment({ scriptPath, journalPath })`, and hands
the surface driver (`run` in `src/surface.ts`) the same ports production uses:
`createAgentPort(roleConfigs, session)`, the caller's `triage`,
`resolveCloser(closerRef, repoPath)` and a gate from `resolveGate(gateRef,
repoPath)`, over a worktree provisioned by `src/provision.ts` against a real
temp git repo. It calls `run` once and returns `{ result: RunResult, journal:
JournalEvent[] }`. Any retry observed is the driver's own budget logic. This
extends Item 4's "one implementation of `AgentPort`, not two" principle to the
whole surface, and reuses Item 6's "real temp git repos, no mocked git"
pattern.

### Script and journal data model

No new wire format. The types mirror claude-mock's existing JSON exactly, so a
generated script is byte-identical to a hand-written one:

```ts
interface MockExpectation {
  when?: { promptContains?: string } | { promptMatches?: string };
  effects?: Array<{ write: { path: string; content: string } } | { edit: { path: string; old: string; new: string } }>;
  reply?: string;
  json?: unknown;
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

These are plain TypeScript types, not zod schemas, as a deliberate exception to
the codebase convention: they describe an external project's format for
authoring ergonomics, and claude-mock validates its own script. The harness's
runtime validation boundary remains the role's `envelopeSchema`, which
`expectEnvelope` (SHOULD) reuses rather than duplicates.

`assertFullyConsumed(journal, script)` takes the script as well as the journal
so it can name each unconsumed expectation's `when` clause, not only its index.
It is opt-in rather than enforced by `runSurfaceAgainstMock`, because a
legitimate script may hold expectations for a branch a given run never takes.

### Failure semantics: no new mapping

`invoke()`'s existing terminus rules already give the right outcome, because the
mock answers over the same stdio as the real CLI:

| Scripted behaviour | Result seen by `invoke()` | Outcome |
|---|---|---|
| prompt matches no expectation | error result; journal `unmatched` | `INCOMPLETE_TERMINUS` (errored) |
| `reply` with no `json` | no structured output | `INCOMPLETE_TERMINUS` (no envelope) |
| `json` failing the role's `envelopeSchema` | structured output fails `safeParse` | `INCOMPLETE_TERMINUS` (wrong shape) |
| `fail.message` | `is_error: true` | `INCOMPLETE_TERMINUS` (errored) |
| expectations left over at the end | journal `finished.unconsumed` | not an `invoke()` outcome; an authoring signal asserted by `assertFullyConsumed` |

### Tool authority: out of scope

claude-mock models no `allowedTools`, a gap already stated in Items 4 and 5 and
in `docs/agent-interface.md`. This design does not add permission modelling:
doing so would change the mock's matching engine, the guarantee already rests on
the real SDK's `canUseTool` enforcement and the harness's direct unit tests of
that decision, and no test in scope needs it. If a later item must prove a
refusal through the mock, the extension point is claude-mock's own expectation
vocabulary, built in that project. The guide says plainly that the mock cannot
prove tool authority.

### Security

- **No network, no keys.** claude-mock has no runtime dependencies and makes no
  outbound calls; the SDK is pointed at it via `pathToClaudeCodeExecutable`. The
  whole testing story runs with zero secrets configured.
- **Provenance.** The committed `dist/cli.js` is built from the source committed
  beside it, so the vendored directory diffs and audits like any other file.
- **Licence, stated.** claude-mock is `"private": true` with no `license`
  field, and this repository has no `LICENSE` yet. Both projects share one
  author, so vendoring raises no third-party rights question. The vendored copy
  inherits whatever licence this repository adopts; if the harness is
  open-sourced (the roadmap's stated direction), licensing the vendored copy for
  redistribution is a decision to make explicitly then.

### NFRs

- **Determinism.** `fakeAgentPort` is deterministic by construction. Mock-backed
  runs are deterministic in outcome (scripted, first-unconsumed-match); tests
  assert on journal content and terminus, never on wall-clock timing.
- **Speed.** Unchanged per call: no spawn for the in-process double, one
  subprocess per invocation for the mock. Vendoring changes reachability, not
  cost.

### Testing

The testing API is product code, tested at Item 4's two tiers:

1. **Pure unit tests, no spawn:** `fakeAgentPort` dispatch and missing-role
   rejection (plus a type-level test that a wrong-role handler does not
   compile); `writeMockScript` / `readJournal` / `assertFullyConsumed` against
   hand-built fixtures, including their failure messages.
2. **Real-mock integration, never skipped:** `runSurfaceAgainstMock` against a
   real temp git repo, a real command gate and a real closer, reaching `CLOSED`
   on a scripted happy path and `INCOMPLETE_TERMINUS` for each failure-semantics
   row, with no live API call.

## UX and key flows

"UX" for a testing library is the authoring API, the failure messages and the
guide. There are no screens or layouts.

**Honest double (J3, J4).** The author passes `{ worker: async () => ({ status:
"completed", rationale: "…" }) }`, filling only the roles the test exercises.
The editor offers the role's own terminus shape; a wrong shape is a compile
error.

**Pipeline test (J1, J2, J5).** The author writes a `MockScript` (optionally
through `expectEnvelope`), calls `runSurfaceAgainstMock` with their real
`gateRef`, `closerRef` and `roleConfigs`, then asserts on `result` and calls
`assertFullyConsumed(journal, script)`. Prompt content is asserted by finding a
`matched` event whose `prompt` contains the expected intent.

**Error states.**

| State | What the author sees |
|---|---|
| no expectation matches | the run reaches `INCOMPLETE_TERMINUS`; `assertFullyConsumed` names the prompt that matched nothing and the expectations still waiting |
| malformed or wrong-role envelope | `INCOMPLETE_TERMINUS` with the existing plain-English "replied in the wrong shape" rationale: a path to test against, not hide |
| expectations left unconsumed | `assertFullyConsumed` fails listing each by index and `when` clause |
| mock binary not resolvable | named error from `mockSessionEnvironment` with the path tried and the fix |
| `fakeAgentPort` invoked for an unfilled role | rejection naming the role and that the test must supply it |
| tool-authority refusal | not modelled; the guide says so and points to where it is tested |

**Messages** follow the house rule from `docs/configuring-a-role.md` and the
Item 3 DX note: name the fix, not the mechanism; no stack traces or raw zod
dumps in anything this item adds.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Scripted CLI-seam fake (matching, effects, journal) | **Reuse-estate**: `claude-mock`, unchanged | new in-process or process fake; Vercel AI SDK `MockLanguageModel`, LangChain `FakeListChatModel` | Purpose-built for this exact seam and already load-bearing in Items 4–6. In-process model fakes skip the SDK path, so SDK shape changes would pass silently (research §4). |
| Reaching the mock without `npm link` | **Vendor**, `file:` devDependency with committed `dist/` | registry publish; git dependency; npm workspace | Only option needing no change to the sibling project. Cost: owning the sync. |
| Honest role-typed double | **Build**: `fakeAgentPort` over a mapped handler record | widen `AgentPort` to `AgentPort<R>` or overloads; keep 22 casts | Widening ripples through production for a test concern and meets TS#50050; keeping casts leaves the seed problem. Reuses `RoleConfigs`' shape. |
| Script and journal typing | **Build (thin)**: TS types mirroring claude-mock's JSON | zod schemas | External format, validated by claude-mock itself; a second validator duplicates it. |
| Journal assertions | **Build**: `readJournal`, `assertFullyConsumed` | general JSONL/log assertion library | Four fixed event shapes; a dependency for a few lines of parsing is not justified. |
| End-to-end composition | **Reuse-estate**: `createAgentPort`, `run`, `resolveGate`, `resolveCloser`, `provision` unchanged | a parallel "test-mode" runner | Running the real driver is what makes drift a failing test. |
| Temp-repo fixtures | **Reuse-estate**: Item 6's real temp git repos | in-memory git | Proven, and the codebase's stated preference. |

## Operability / DX

- **Environment.** Unchanged: Node ≥ 22 (`package.json` engines), TypeScript,
  the existing ESLint config, Vitest. One new devDependency (the vendored
  `claude-mock`); no new runtime dependency.
- **Scaffolding.** Four flat `src/*.ts` modules plus a barrel, and one new
  top-level `vendor/` directory alongside `demos/` and `tests/`.
- **Local-run story.** A clone plus `npm install` is sufficient: `npm test`
  runs every tier with no skips, and demos drive `runSurfaceAgainstMock`
  through the existing `npm run demo:*` convention.
- **CI.** The existing workflow (`.github/workflows/ci.yml`) needs no new step;
  vendoring is what makes the previously skipped suites run there.
- **Distribution.** None beyond the repository: today every adopter works from a
  clone, and the vendored `dist/` travels with it. **Residual for Items 8/9:**
  devDependencies are not installed for a published package's consumers, and
  whether `vendor/` ships in a tarball is an unmade `files` decision, so
  publishing the harness unmodified would drop `claude-mock` for external
  adopters. Items 8/9 must decide whether it becomes a `dependency` and whether
  `vendor/` is published.

## Extensibility

A new role adds one optional field to `RoleHandlers` and one `case` in
`fakeAgentPort`. Item 10's multi-surface interleavings would be a later
composition over `runSurfaceAgainstMock`, which runs exactly one surface against
one temp repo; nothing here precludes it.

## What this design does not include

- Changes to `claude-mock`'s internals: script format, matching rule, effects or
  journal.
- Tool-authority modelling in the mock.
- Multi-surface scripted interleavings (Item 10).
- A CLI, or declarative script authoring in project configuration (Items 8, 9).
- Publishing `claude-mock` to a registry, moving it into a workspace, or
  choosing licences for either project.
- Making the mock reach consumers of a future published harness package (the
  Items 8/9 residual above).
- Recorded-fixture replay, mid-stream truncation or shell-command effects:
  claude-mock's own non-goals.

## Open questions

- **Vendored-copy drift.** Nothing detects the vendored copy falling behind the
  sibling project. Accepted for this item; revisit if claude-mock changes often
  or when Items 8/9 settle distribution.
- **Licensing on open-sourcing.** Deferred explicitly (Security).
