# Research: Triage and Deterministic Router (Item 5)

Factual foundation for the PRD. Every code claim is cited `file:line`; every external claim is
cited to a source. Open questions this PRD must resolve are called out inline and summarised at
the end.

## 1. What exists today: `TriagePort` and the deterministic router

`src/ports.ts:34-49` declares the interface Item 5 extends, not replaces:

```ts
export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  remainingBudgets: BudgetSet;   // log-derived {used, max}, computed immediately before the call
}
export interface TriageVerdict {
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort";
  rationale: string;
}
export interface TriagePort {
  triage(input: TriageInput): Promise<TriageVerdict>;
}
```

`src/router.ts:1-61` is the deterministic implementation. It is a single lookup table
(`rules`, `router.ts:14-22`) keyed by `trigger`, naming which `BudgetPopulation` gates the
"helpful" verdict:

| Trigger | Budget | Helpful verdict |
|---|---|---|
| `gate_fail` | `correction` | `reroute` |
| `gate_error` | `gateMaintenance` | `fix_the_gate` |
| `worker_escalate` | `correction` | `reroute` |
| `close_failure` | `close` | `retry_close` |

Two things are hard-coded ahead of the table (`router.ts:35-40`): an authority-class
`worker_escalate` always escalates, unconditionally, before the table is even consulted — "Nothing
in a lookup table is entitled to overrule it, and no budget makes it retryable." At cap
(`used >= max`) every trigger escalates with a message from `budgetExhausted()`
(`src/budgets.ts:18-24`: `"<population> budget exhausted (<used>/<max>): <detail>"`).

**What is explicitly absent, and whose job it is.** `router.ts:5-12`'s own comment: `gateError`
(the budget population) is reserved for "a future bounded, agent-free re-check fast path" that
needs a `TriageVerdict` case the schema does not yet have — the control-flow doc's "cheap,
stateless, re-run it" idea — and this is "Left to Item 5, which owns the verdict vocabulary's
evolution alongside the real triage agent"
(`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md:564-572`). Today
`gate_error` and `gate_fail` both route through the same `TRIAGE` edge and the same `correction`/
`gateMaintenance` budgets with no re-check verdict in between.

**`TriageEntry` (the persisted history record)** — `src/schema.ts:144-152`:

```ts
export const TriageEntry = z.object({
  t: z.literal("triage"),
  afterAttempt: z.number().int().positive(),
  trigger: z.string(),
  verdict: z.enum(["reroute", "escalate", "fix_the_gate", "retry_close", "abort"]),
  rationale: z.string(),
  artifactRef: z.string(),
});
```

`artifactRef` is a **string pointer to a ref file, not the payload itself**. Today's router writes
only a stub there — `surface.ts:562-567`: `writeRef(dir, "triage-${priorTriages}", { trigger,
rationale: verdict.rationale })` — but the field's presence is deliberate and future-proofed:
"This item's router synthesises nothing richer than the stub, but the field is never omitted —
Item 5 replaces the contents, not the schema" (`surface.ts:562-563`). **This means Item 5 can grow
`SharpenedBrief`/`EscalationPacket` payloads inside the existing ref file without touching
`TriageEntry`'s shape** — the schema question this PRD must still resolve is what JSON goes
*inside* that ref, not whether a new field is needed on the entry.

## 2. How the router is wired into `surface.ts`

`triageTrigger()` (`src/surface.ts:514-526`) derives `{trigger, category}` purely from the log
tail that routed the surface into `TRIAGE` — never from `state` alone, so a resumed run classifies
identically to a live one:

- tail is a `gate` entry → `"gate_error"` if `status === "ERROR"`, else `"gate_fail"`
- tail is a `close` entry → `"close_failure"`
- tail is a `terminus` entry with `status === "escalate"` → `"worker_escalate"` + its `category`
- anything else throws `IllegalStateTransition`

The `triage()` function (`surface.ts:544-588`) is the entire integration point Item 5 must extend:

1. Compute `{trigger, category}` via `triageTrigger`, and `remainingBudgets` via
   `deriveBudgetsFromLog` (never the cursor's stale copy — `case-file.ts:300-336` is the
   authoritative deriver, per the state-machine design doc's explicit rule that
   `cursor.budgets[*].used` is a denormalisation, "Only `max` is read from the cursor" —
   `2026-09-07-single-surface-state-machine-design.md` around the Budgets section).
2. Call `ports.triage.triage(input)`.
3. Write the ref (`writeRef`, keyed `triage-${priorTriages}` so repeated rounds never collide)
   **before** appending the `TriageEntry` — the ref is written first, then the entry that points
   at it (`surface.ts:564-577`), so a crash between the two leaves an orphan ref, never a
   dangling entry pointing nowhere.
4. Append the `TriageEntry`, derive the next state via `deriveStateFromEntry` (`case-file.ts:270-298`,
   `triageState` table at `:262-265`: `reroute→AGENT_ACTIVE, escalate→ESCALATED,
   fix_the_gate→GATE_MAINTENANCE, retry_close→CLOSING, abort→ABORTED`), and either terminate
   (`escalate`/`abort`) or `updateCursor` and return.

**Recoverability property already in place, unaffected by Item 5's payload richness**: triage is
read-only until the entry is appended (`surface.ts:544-549` reads only; nothing is mutated before
the single `appendEntry` call), matching `docs/single-surface-control-flow.md`'s "Recoverability"
section verbatim — "a crash before recording re-runs triage harmlessly; a crash after reads the
recorded verdict and proceeds."

**Close-triage restriction** is not yet enforced structurally. Today's router only ever considers
one trigger→verdict mapping per call (`router.ts:18-21`); nothing in `TriagePort`'s type or
`surface.ts`'s call site stops a `close_failure` trigger from receiving a `reroute` verdict except
the router's own table happening not to emit one. If Item 5's agent-backed triage is asked "what
verdicts are legal for trigger X," that constraint currently lives nowhere machine-checked —
**this is a real gap the design should close, likely with a per-trigger legal-verdict set
validated after the agent call, not just documented in prose** (the roadmap success criterion
"Close-failure triage offers only retry_close or escalate (no reroute)" has no code path enforcing
it today).

## 3. How the worker prompt is assembled — where a `SharpenedBrief` enters

`src/prompt-assembly.ts` is the single deterministic assembler, used for every role.
`resolveEvidence()` (`:26-41`) is the only I/O: it reads the **most recent** `dispatch` entry's
optional `briefRef` (`history.find(...)`, most-recent-first via `[...history].reverse()`,
`:27,37-38`) and resolves it via `readRef`. `DispatchEntry.briefRef` already exists in the schema
(`schema.ts:114-121`, `briefRef: z.string().optional()`) — **the wiring for a brief to reach a
dispatched worker already exists; nothing dispatches with one yet.** `dispatchSession()`
(`surface.ts:200-232`) calls `appendEntry(dir, { t: "dispatch", role, attempt, sessionKey })`
with no `briefRef` — **Item 5 must add `briefRef` to this call when the triage verdict is
`reroute` with a brief payload.**

`assemblePrompt()` (`prompt-assembly.ts:54-102`) is a pure function (no I/O, no clock — the
module's own doc comment says the same case file yields a "byte-identical request" so a
reconstructed session after a crash is the same session, `:50-52`). It renders exactly the five
slots `docs/agent-interface.md:96-103` specifies:

```
[systemPromptFragment + optional domainPrompt]   -> systemPrompt
## Task            <- caseFile.header.taskDef
## Brief           <- evidence.brief (JSON.stringify, or a fixed "no brief" sentence if null)
## Gate evidence   <- evidence.newFailures, verbatim (id, baselineOutcome->checkOutcome, detail)
## Reply format    <- z.toJSONSchema(roleCfg.envelopeSchema), plus a fixed refusal sentence
```

Two facts that directly shape the `SharpenedBrief` design:

- **The brief slot is currently opaque** (`PromptEvidence.brief: unknown`, `:9`) — whatever JSON is
  behind `briefRef` is `JSON.stringify`'d verbatim into the prompt (`prompt-assembly.ts:65-68`, `88`).
  There is no `SharpenedBrief` zod schema yet; Item 5 must add one and decide whether
  `resolveEvidence`/`assemblePrompt` validate it (currently they trust the ref's contents blindly)
  or stay permissive and let a malformed brief render as raw JSON (worse UX, no crash).
- **`newFailures` is already verbatim, independently of the brief.** `resolveEvidence` reads the
  `gate` entry's `newFailures` refs (each `{id, detailRef}`, `schema.ts:135-141`) and parses them
  as `NewFailure` (`schema.ts:71-77`: `id`, `baselineOutcome`, `checkOutcome`, `detail`) — the
  **same verbatim assertion detail is rendered into every worker prompt today, brief or no
  brief** (`prompt-assembly.ts:70-75`). This means the control-flow doc's rule "Synthesis augments
  evidence, never replaces it" (`single-surface-control-flow.md` §Triage, "The sharpened brief")
  is **already structurally true for the gate-evidence slot** — a `SharpenedBrief`'s `evidence`
  field, if it duplicates the same `newFailures` inside the brief JSON, would be redundant with
  the `## Gate evidence` slot the template renders unconditionally. **Design question for the
  PRD**: does `SharpenedBrief.evidence` need to re-carry the assertions, or can it omit them and
  rely on the always-present `## Gate evidence` slot, keeping the brief itself for `problem`,
  `dead_ends`, `scope`, `references`, `diagnosis` only?

## 4. `AgentPort.invoke()` — what it returns today and what widening triage needs

`src/ports.ts:23-29`:

```ts
export type Terminus =
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | { status: "incomplete"; rationale: string };
export interface AgentPort { invoke(roleCfg: RoleHandle, ctx: AgentContext): Promise<Terminus>; }
```

`Terminus` is a **3-way union carrying no triage-only status** (`reroute`, `fix_the_gate`,
`retry_close`, `abort` belong to the separate `TriageVerdict` union, `ports.ts:42-45`). The Item 4
design doc (`2026-09-09-agent-invocation-primitive-design.md:23,28-34`) states this explicitly:
the SDK-backed `AgentPort` implementation Item 4 shipped covers **worker and gate-maintenance
only**; the doc's own words: "Triage's verdict vocabulary … would need `AgentPort.invoke()`'s
TypeScript return type widened to carry it — that widening is explicitly **Item 5's** to make
(triage's own item), not this item's" (`:28-31`), and again at `:374-376`: "Triage remains a
deterministic-router-only `TriagePort` for now, unaffected by this item."

`src/role-config.ts:12` independently derives the legal envelope shape from `Terminus`:
`export type Envelope = Exclude<Terminus, { status: "incomplete" }>` — i.e. an agent may emit
`completed` or `escalate`, never `incomplete` (`incomplete` is the harness's own verdict on a
session that produced nothing usable, "never something an agent may claim for itself",
`role-config.ts:6-11`). **If Item 5 widens `Terminus` to add triage's five statuses
(`reroute|escalate|fix_the_gate|retry_close|abort`), this `Exclude<>` derivation and the worker's
`WorkerEnvelope` (`role-config.ts:22-32`, a `z.discriminatedUnion("status", …)` over exactly
`completed`/`escalate`) both need to keep excluding triage-only statuses from the worker's
own envelope** — otherwise the very exploit `agent-invoke.test.ts:95-100` currently guards
("a worker emitting a triage-only status" becomes `INCOMPLETE_TERMINUS`, not a route) regresses.
The clean way to widen without breaking that guard is a **role-parameterised discriminant**
(e.g. `Terminus` becomes a union of role-scoped envelope shapes, and `WorkerEnvelope`/a new
`TriageEnvelope` each remain a strict subset) rather than one flat `status` enum shared by every
role — this is the exact ambiguity the Item 4 research flagged and explicitly left to this item
(`docs/prd/2026-09-09-agent-invocation-primitive/research.md:75-85`).

**Open design question, not yet resolved anywhere in this codebase or its specs**: does the triage
agent go through `AgentPort.invoke()` at all (making `TriagePort`'s real implementation a wrapper
around `invoke()` with a `triage` `RoleConfig`, matching `agent-interface.md`'s "one primitive,
three role configs" framing, `agent-interface.md:19-21,34-38,76-83` — the roles table already
lists `triage` as a row with payload `SharpenedBrief`/`EscalationPacket` and statuses
`reroute, escalate, fix_the_gate, retry_close, abort`), or does `TriagePort.triage()` remain a
**separate interface** that internally calls `invoke()` and translates the result, keeping
`AgentPort`'s `Terminus` untouched? `agent-interface.md`'s roles table (`:76-83`) treats triage as
just another row of the *same* primitive, which argues for widening `Terminus` (or making it
role-generic) rather than leaving `TriagePort` as a hand-rolled parallel caller. This is the single
highest-leverage open question for the architect: it determines whether Item 5 touches
`src/agent-invoke.ts`/`src/ports.ts` (shared, tested seam) or adds a net-new, separate invocation
path duplicating `agent-invoke.ts`'s prompt-assembly-then-validate-envelope logic.

## 5. Case-file schema: triage entries and artefact refs

Already covered in §1/§2 for `TriageEntry`. The artefact-ref mechanism itself
(`src/case-file.ts:234-254`, `writeRef`/`readRef`) is generic and role-agnostic:

- `writeRef(dir, refId, data)` — validates `refId` is a bare filename with no path traversal
  (`safeRefId`, `:228-231`), writes `refs/<refId>.json` atomically (temp file + rename,
  `atomicWriteJson`, `:16-20`), returns the `refId` string to store in the entry.
- `readRef(dir, refId)` — reads and `JSON.parse`s; throws `CorruptCaseFile` on malformed content.
- **No schema validation happens at the ref layer itself** — `data: unknown` in, `unknown` out.
  Whatever shape `SharpenedBrief`/`EscalationPacket`/`GateRepairBrief`/`CloseRepairBrief` take is
  validated (if at all) by the caller, not by `case-file.ts`. This means Item 5's PRD must specify
  *where* the payload schema lives and *whether* it is validated on write, on read, or both —
  today's router writes an untyped stub with no validation either way.

The existing ref-key convention Item 5 should follow: `triage-${priorTriages}` where
`priorTriages = caseFile.history.filter(e => e.t === "triage").length` (`surface.ts:563`) — "Keyed
by prior triage count so repeated rounds never overwrite each other's artefacts." A richer payload
changes what is written under that same key, not the keying scheme.

## 6. The claude-mock offline testing seam used by existing tests

`claude-mock` (sibling project at `/home/jorjives/dev/tools/claude-mock`, installed via
`npm link`, **not vendored into this repo** — `docs/agent-interface.md:232-234`, vendoring is
Item 7's) is a scripted fake `claude` CLI binary the SDK's `pathToClaudeCodeExecutable` option
points at. From `/home/jorjives/dev/tools/claude-mock/README.md`:

- Expectations are a JSON array matched in order against the **first unconsumed** expectation;
  `when.promptContains`/`when.promptMatches` gate a match, an expectation with no `when` matches
  anything.
- `json` sets `structured_output` on the SDK's result message — the mechanism the mock uses to
  fake structured output, matching the real SDK's `ResultMessage.structured_output?: unknown`.
- `effects` (`write`/`edit`) are applied for real inside the session's `cwd`, each emitting a
  matching `tool_use`/`tool_result` pair so the transcript looks real.
- `fail.message` sets `is_error: true` with that text as the result.
- `CLAUDE_MOCK_JOURNAL` records `matched`/`unmatched`/`effect_failed`/`finished` events — the
  verification surface for "what prompt did the harness actually send" and "were all scripted
  turns consumed."
- **Deliberately unbuilt**: recorded-fixture replay, `error_max_turns`/mid-stream truncation,
  shell-command effects, permission-prompt flows — "Add each when a harness test actually needs
  it." Triage is read-only (`Read`, `Glob`, `Grep` only, per the roles table,
  `agent-interface.md:76-83`) — no `Write`/`Edit`/`Bash` effects are needed for triage's own mock
  scripts, which is a smaller mock surface than the worker/gate-maintenance tests already use.
- **The mock does not enforce `allowedTools`** — confirmed by the Item 4 research
  (`docs/prd/2026-09-09-agent-invocation-primitive/research.md:123-128`, no `allowedTools` hits in
  the mock's source) and independently by `docs/agent-interface.md:187-191`: "claude-mock models no
  tool permissions, so no offline test can drive a real out-of-role call through it... the
  end-to-end guarantee rests on the real agent runtime." **This matters directly for triage**: a
  test asserting "triage cannot write files" cannot be proven via a mock-scripted attempt at a
  write being refused — it can only assert that `triage-role-config`'s `allowedTools` list omits
  `Write`/`Edit`/`Bash` and that `createToolAuthority` (`src/tool-authority.ts:88-105`, already
  role-agnostic and reused verbatim for any new role) denies them, exactly as the existing
  `tool-authority.ts` unit tests do for the worker/gate-maintenance roles today.

**Existing test structure to follow** (`src/agent-invoke.test.ts:1-232`,
`tests/helpers.ts:1-24`): `isOnPath("claude-mock")` gates a `describe.skipIf(!hasMock)` tier so
CI without the mock installed skips rather than fails those suites; a `script()` helper writes the
expectation JSON; `useMock()` returns the `{pathToClaudeCodeExecutable, env}` pair
`SessionEnvironment` accepts (`src/agent-invoke.ts:40-43`). Tests assert on the returned
`Terminus`/verdict shape, on `journal.jsonl` for prompt determinism (byte-identical prompt across
two invocations from the same starting case file, `agent-invoke.test.ts:111-131`), and on
`buildSessionOptions()`'s output directly for authority wiring (no SDK call needed,
`agent-invoke.test.ts:147-196`) — Item 5's triage tests should follow the same three-tier pattern:
mock-gated behavioural tests, a determinism test, and a pure `buildSessionOptions`/role-config
test needing no mock at all.

## 7. Claude Agent SDK — structured-output facts (installed version, cited `.d.ts` lines)

**Not present in this worktree's `node_modules`** (`npm ls @anthropic-ai/claude-agent-sdk` →
empty) despite `src/agent-invoke.ts` importing from it — the dependency is declared in
`package.json` (`"@anthropic-ai/claude-agent-sdk": "^0.3.266"`) but `npm install` has not been run
in this worktree. To verify the exact shape against the pinned version, I installed
`@anthropic-ai/claude-agent-sdk@0.3.266` (matching `package.json`'s pin exactly) into a scratch
directory outside the repo and read its bundled `sdk.d.ts` (8,881 lines):

- **`OutputFormat`** — `sdk.d.ts:2290`: `export declare type OutputFormat = JsonSchemaOutputFormat;`
  and `sdk.d.ts:968-971`: `JsonSchemaOutputFormat = { type: 'json_schema'; schema: ... }` — a bare
  JSON Schema object, no SDK-specific DSL. `Options.outputFormat?: OutputFormat` at
  `sdk.d.ts:1821` (usage example at `:1815-1820` matches exactly what
  `src/agent-invoke.ts:66` already does: `outputFormat: { type: "json_schema", schema:
  z.toJSONSchema(roleCfg.envelopeSchema) }`).
- **`ResultMessage.structured_output?: unknown`** at `sdk.d.ts:5073` — confirmed present in this
  exact pinned version, matching `src/agent-invoke.ts:128` (`result.structured_output ===
  undefined` check) and the mock's `json` field semantics (§6).
- **SDK-side retry against the schema, and a terminal failure mode for it**:
  `ResultMessage.subtype` includes `'error_max_structured_output_retries'` (`sdk.d.ts:4985`), and
  `TerminalReason` includes `'structured_output_retry_exhausted'` (`sdk.d.ts:8636`) — the SDK
  itself retries the model against the JSON Schema and can terminate the session on repeated
  schema failure *before* the harness ever inspects `structured_output`. `agent-invoke.ts:125-127`
  already treats any non-`"success"` subtype as `DID_NOT_COMPLETE.errored` — this SDK-level retry
  exhaustion is one instance of that path, requiring no new code for triage specifically, but is
  worth naming in the PRD as *why* `INCOMPLETE_TERMINUS`'s "did not complete" bucket already
  absorbs "the model could not produce a schema-conforming reply even with the SDK's own retries."
- **`allowedTools`/`disallowedTools`/`canUseTool`** — unchanged from the Item 4 research's
  findings (`sdk.d.ts:1449` `allowedTools?: string[]`, `sdk.d.ts:1469` `disallowedTools?:
  string[]`, `sdk.d.ts:1454` `canUseTool?: CanUseTool`) — `src/tool-authority.ts` already
  implements the harness-side enforcement Item 5's triage role reuses unmodified: a new
  `triageRoleConfig.allowedTools = ["Read", "Glob", "Grep"]` is sufficient, no new authority
  mechanism needed.
- **`SDKPermissionDenial`** (`sdk.d.ts:4872`) and `permission_denials: SDKPermissionDenial[]` on
  the result message (`sdk.d.ts:5004,5068`) — unchanged from Item 4; `authorityRefusal()`
  (`src/tool-authority.ts:117-128`) is role-agnostic already and needs no change for a read-only
  role beyond the new `allowedTools` list itself.

**Conclusion for the PRD**: the SDK offers nothing triage-specific to design against beyond what
Item 4 already wired up. Triage's read-only authority, structured output, and terminus mapping are
all already-generalised code paths (`tool-authority.ts`, `agent-invoke.ts`'s `invoke()`); the real
design work is entirely in `role-config.ts` (a new `triageRoleConfig` + envelope schema),
`ports.ts`/`Terminus` widening (§4), and the new `SharpenedBrief`/`EscalationPacket` payload
schemas and their consumption in `prompt-assembly.ts`/`surface.ts`.

## 8. Existing dependency: zod (already installed, already the codebase's pattern)

`package.json` (`dependencies`): `"zod": "^4.5.4"`. Already used throughout `src/schema.ts` and
`src/role-config.ts` for exactly this class of problem: `z.discriminatedUnion` for variant types
(`WorkerEnvelope`, `GateRef`), `z.infer<>` for single-source-of-truth type derivation,
`z.toJSONSchema()` to bridge a zod schema to the SDK's `outputFormat.schema` requirement
(already used at `agent-invoke.ts:66` and `prompt-assembly.ts:80`). **No new schema library is
needed for `SharpenedBrief`/`EscalationPacket`/`GateRepairBrief`/`CloseRepairBrief`** — each is a
natural `z.object`/`z.discriminatedUnion` alongside the existing ones in `schema.ts` or
`role-config.ts`, validated the same way, converted to JSON Schema the same way. No other
schema-validation library (`ajv`, `joi`, `yup`, `superstruct`, `io-ts`) appears anywhere in
`package.json` or `node_modules` (checked via the same `npm ls` used for the SDK in §7). This
mirrors the Item 4 research's identical conclusion (`docs/prd/2026-09-09-agent-invocation-primitive/research.md:203-222`)
— reuse zod, don't add a library.

**Candidate library trade-off, stated for completeness though the answer is clear**: a JSON Schema
validator like `ajv` would be redundant — zod v4's native `z.toJSONSchema()` already produces the
schema the SDK wants, and zod already validates the *parsed* response harness-side
(`envelopeSchema.safeParse`, `agent-invoke.ts:132`), so adding `ajv` would mean validating the same
data twice with two different libraries for no gained guarantee. The only real trade-off in this
item is schema **shape** design (how nested `SharpenedBrief`/`EscalationPacket` get, whether
`diagnosis`/`dead_ends` are free-text or structured), not library choice.

## 9. Prior art: failure triage, retry-with-feedback, and escalation handoff in agent harnesses

This item's own design doc (`docs/single-surface-control-flow.md` §Triage) already states the
target shape precisely — a fast deterministic path plus an agent path that "compresses the
accumulated mess into a focused artefact," and the rule "Synthesis augments evidence, never
replaces it." External prior art largely confirms this shape and its central tension (verbatim
evidence vs. summarised feedback) rather than contradicting it.

**Reflexion (Shinn et al., 2023) — the closest architectural analogue to triage-as-a-role.**
Reflexion runs three cooperating roles — an actor, an evaluator, and a self-reflection module — in
a loop: the actor acts, the evaluator scores the result, and *if the score is insufficient* the
self-reflection module "diagnoses the issue, proposes a fix, and appends both the failed output
and the suggested correction to the input context" for the next episode
([promptingguide.ai/techniques/reflexion](https://www.promptingguide.ai/techniques/reflexion)).
This is structurally identical to this harness's worker→gate→triage→worker loop, with one
difference this item's design deliberately keeps: Reflexion's self-reflection module always runs;
this harness's deterministic router exists precisely to **skip the agent call** for the common
case (`single-surface-control-flow.md` §Triage, "Keep the agent off the fast path" — "Most
non-pass events need no judgement"), trading Reflexion's uniform LLM-mediated reflection for a
cheaper, deterministic majority path plus an agent path only where "there is a real decision or
real distillation value." Reflexion's own description of what crosses into the next attempt —
"both the failed output and the suggested correction" — is exactly the two-part
evidence-plus-hypothesis structure `SharpenedBrief` specifies (`evidence` verbatim, `diagnosis` as
hypothesis).

**SWE-agent and neighbouring SWE-bench-era agents — evidence toward curated/trimmed, not raw
verbatim, feedback.** Search results describe SWE-agent's own error-feedback design choosing
condensed feedback over raw output (a bash syntax error surfaces to the agent as "Your bash
command contained syntax errors and was NOT executed," not the raw shell error) and a broader
pattern in agent frameworks of trimming exception output before forwarding it — "tracebacks are
truncated to the final exception type, message, and offending source line, with surrounding
interpreter frames discarded"
([dev.to/truongpx396](https://dev.to/truongpx396/swe-agent-deep-dive-build-your-own-guide-ade)).
A 2026 arXiv paper on structured recovery for coding agents ("Debugging the Debuggers:
Failure-Anchored Structured Recovery for Software Engineering Agents") frames this as converting
"multi-signal evidence into a structured diagnosis and admitting only grounded, actionable,
in-scope guidance into the subsequent attempt" and classifies failed trajectories into named
categories (residual env/harness failure, submit-gating/no-valid-diff failure,
search/localization failure, patch quality failure) to target feedback by failure type
([arxiv.org/html/2605.08717](https://arxiv.org/html/2605.08717)). **This is real tension with
`single-surface-control-flow.md`'s "verbatim, not paraphrased" instruction for gate evidence** —
but it is not a contradiction once the two evidence types are distinguished: the SWE-agent/2605.08717
trimming is aimed at *tool-execution* noise (stack traces, interpreter frames — accidental
verbosity that carries no signal), whereas this harness's "newly-failing assertions verbatim" is
the *gate's own judgement* (assertion id, outcome, a human-authored `detail` string) — already the
minimal, curated signal, not raw log noise. The categorisation-by-failure-type idea from
2605.08717 is directly analogous to this harness's existing `trigger`/`category` split
(`gate_fail`/`gate_error`/`worker_escalate(exhaustion|authority)`/`close_failure`) — the prior art
supports refining that taxonomy further inside the triage agent's own reasoning, not abandoning
verbatim evidence at the gate-report level.

**CI flaky-test triage — evidence for "classify, don't blindly retry."** Practitioner and vendor
material on flaky-test triage converges on the same principle this item's `TriagePort` already
encodes structurally: "Automatic retries can mask genuine regressions, so some platforms' design
philosophy is to classify and report rather than silently re-run," and "preserve evidence,
classify failures, retry only when there is a reason, and make the result visible enough that the
team can act on it"
([contextqa.com](https://contextqa.com/blog/flaky-tests-in-ci-cd-without-retries/)). This maps
directly onto the asymmetry `single-surface-control-flow.md` names as "the safety property":
triage can pull an exhaustion-class escalation down into a retry, but "can never push a completion
up into a failure, and never overturn the gate" — i.e. the gate's own verdict (pass/fail) is never
softened by triage, only the *routing* after a fail is judged. Flaky-test literature's
"require positive, multi-signal evidence to call a test flaky" is the same caution this item's
design already bakes in via the `correction`/`gateMaintenance` budget caps — a bounded number of
"maybe it's transient, try again" attempts, never unbounded automatic retry.

**Human escalation-handoff design — confirms `EscalationPacket`'s job, not its shape.** General
escalation-design literature (not agent-specific, but directly relevant to what an
`EscalationPacket` must contain) converges on: escalation must communicate "the [agent's] goal,
what has been attempted, and what is likely required next" so a human reviewer is not left
reconstructing context
([augmentcode.com](https://www.augmentcode.com/guides/agent-handoff-patterns-human-agent-interface)),
and that escalation types cluster into confidence-based, permission-based, conflict-based, and
capability-based
([aiuxdesign.guide](https://www.aiuxdesign.guide/patterns/escalation-pathways)) — which maps
cleanly onto this harness's existing taxonomy: `authority`-class escalate is permission-based,
`exhaustion`-class is confidence-based, a `gate_error` at cap is capability-based (the environment
itself is broken), and budget exhaustion generally is the harness's own "handoff, not agent
judgement" boundary. One caution worth carrying into the PRD: the same literature notes
"escalation rates above 20% overwhelm human reviewers... a 10–15% rate generally achieving
effective engagement"
([digitalapplied.com](https://www.digitalapplied.com/blog/human-in-the-loop-escalation-design-ai-agents-2026))
— a data point supporting the roadmap's own design instinct (overrule exhaustion-class escalations
downward where safe) but not something this internal harness can measure without production usage
data; flag as a COULD-tier metric for Item 11 (reporting), not this item's to enforce.

**Net verdict on verbatim vs. summary, for the PRD to state as a resolved design position**: the
prior art does not argue against verbatim evidence — it argues against verbatim *noise*
(tracebacks, interpreter frames). This harness's gate evidence is already pre-filtered to
assertion-level deltas before triage ever sees it (`GateEntry.newFailures`, `schema.ts:135-141`,
populated by the gate's own delta computation, out of scope for this research), so "verbatim" here
means "the gate's own curated verdict, unparaphrased" — which is exactly what the strongest prior
art (flaky-test triage, structured-recovery-for-coding-agents) recommends preserving, while
reserving summarisation/trimming for *incidental* execution noise the harness does not surface to
triage in the first place.

## 10. Open questions for the design team (cross-referenced to source)

1. **Does the triage agent go through `AgentPort.invoke()` (role-generic `Terminus`), or is
   `TriagePort` a separate caller?** — §4. Determines whether Item 5 widens shared,
   heavily-tested code (`ports.ts`, `agent-invoke.ts`) or adds a parallel path.
2. **Does `SharpenedBrief.evidence` duplicate the `## Gate evidence` prompt slot, or omit it and
   rely on the slot already being unconditionally rendered?** — §3.
3. **Where is `SharpenedBrief`/`EscalationPacket`/`GateRepairBrief`/`CloseRepairBrief` validated —
   on write (`writeRef`), on read (`resolveEvidence`), both, or neither?** — §5. Today's ref layer
   validates nothing; the router's own stub is unvalidated by construction.
4. **How is "close-triage may only emit `retry_close`/`escalate`" enforced in code, not just in the
   agent's system-prompt fragment?** — §2. No structural check exists today; the roadmap names this
   as a success criterion with no current enforcement point.
5. **Does the `gate_error` agent-free re-check fast path (the `gateError` budget, reserved but
   unused since Item 3) ship in this item, or stay deferred again?** — §1, confirmed as explicitly
   this item's to decide by the Item 3 design doc.
