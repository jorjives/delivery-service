---
type: phase-design
created: 2026-09-10
roadmap_item: 5
---

# Triage and Deterministic Router — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 5.
> Mechanism spec this design implements: `docs/single-surface-control-flow.md` §Triage, `docs/agent-interface.md`.
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed).
> Audit trail: `docs/prd/2026-09-10-triage-and-router/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).

## Problem

Today `TriagePort` is a lookup table (`src/router.ts`): trigger, budget check,
helpful verdict or escalate. It synthesises nothing and judges nothing. Two
consequences follow for the people using the harness:

- **Retries are blind.** A reroute re-dispatches a fresh worker with the same
  task and the raw gate delta. Nothing tells it what the previous attempts
  tried and why they missed, which is "the one thing a fresh reconstructed
  session cannot derive for itself" (control-flow doc). `DispatchEntry.briefRef`
  exists in the schema and is never populated.
- **Escalations are opaque.** An escalation reaches a human as a rationale
  string and a stub artefact (`{ trigger, rationale }`). The human must
  reconstruct what was tried, what the evidence was, and what decision is
  being asked of them, usually by reading transcripts.

Item 3 shipped the deterministic half deliberately and deferred the rest here;
Item 4 shipped the invocation primitive and deferred triage's agent invocation
and the `AgentPort.invoke()` return-type widening here. Both dependencies are
complete, so this is the next phase.

## Personas and goals

Full derivation in `docs/personas.md`.

- **Priya Shah, harness extender.** Wires triage once via a `role_cfg`, trusts
  that the cheap path stays cheap, and debugs a routing decision from the case
  file alone.
- **Marcus Webb, on-call engineer.** Opens a case file at `ESCALATED` and,
  from the escalation packet alone, states the decision asked of him, the
  evidence behind it, and what already failed.
- **Dana Okafor, non-technical project owner.** COULD-tier this phase: the
  packet must not mislead or block her if she opens it; her full reporting
  experience is Item 11's.

## Goals and success metrics

- **Informed retries.** For an agent-path reroute, the next worker's assembled
  prompt contains the prior round's `dead_ends` content. Proven by an
  automated test, not by the existence of a brief object.
- **Actionable escalations.** Every `ESCALATED` case file carries an
  `EscalationPacket` stating decision, verbatim evidence, dead ends, why now,
  and session references. Proven by a test per escalation path (agent,
  deterministic at-cap, authority pass-through, invalid triage output).
- **Fast path stays cheap.** A `gate_fail` with more than one correction slot
  remaining produces zero agent invocations. Proven by a spy `AgentPort` that
  throws if called.
- **Legality is structural.** A triage agent emitting `reroute` for a
  `close_failure` produces a safe escalate, not a misroute. Proven by test.
- **Extender cold start.** Priya goes from no triage `role_cfg` to a working
  triage invocation returning a typed verdict using the reference config and
  the guide chapter, without reading `src/router.ts`, `src/surface.ts` or
  `agent-interface.md`.

## Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope; the MUST tier below is the derived minimum,
recorded by the team-lead in `review-log.md` and scrutinised by the critic
against the personas. It is conservative (every item traces to Priya's or
Marcus's journey, or to a preservation requirement the roadmap already
imposes) and it is usable: it leaves Marcus able to act on a packet and a
retried worker able to see what failed.

## Capabilities

### MUST

1. **Triage agent role** through the existing invocation primitive:
   `triageRoleConfig`, read-only (`Read`, `Glob`, `Grep`), triage-only
   envelope vocabulary.
2. **Deterministic router retained** as the first check; the agent is engaged
   only where a real decision exists (the fast-path rule below).
3. **`SharpenedBrief` reaches the next worker dispatch** on an agent-path
   reroute, via `DispatchEntry.briefRef`. A deterministic reroute is unchanged:
   rationale string, no brief, no new cost.
4. **`EscalationPacket` persisted with real content on every escalate verdict**,
   whichever path produced it.
5. **Prior triage rationales** fed into later triage rounds.
6. **Authority-class pass-through** preserved exactly, checked before any
   table or agent call.
7. **Close-triage structurally restricted** to `retry_close`/`escalate`
   (plus `abort`), by a legal-verdict-per-trigger check.
8. **Invalid or out-of-scope triage output** resolves to escalate, never a
   default reroute, with a state, cause and next-action rationale.
9. **Crash-safe replay of triage**: no side effect before the single
   `TriageEntry` append.

### SHOULD

- A "Triage" chapter in `docs/configuring-a-role.md`, shaped like the Worker
  and Gate-maintenance chapters.
- The agent-free `gate_error` re-check verdict (`recheck_gate`) using the
  reserved `gateError` budget.
- A runnable demo against `claude-mock`, matching the existing
  `demos/agent-invocation-slice-N-*.ts` pattern.

### COULD

- A one-sentence, jargon-free summary prepended to the `EscalationPacket` for
  Dana (additive; Marcus's content is never diluted). Feeds Item 11.

## Architecture

### Module structure

Two new modules in the flat `src/*.ts` layout, each with a sibling test file:

- `src/triage-role-config.ts`: `TriageEnvelope`, the payload schemas,
  `triageRoleConfig`, and the deterministic `buildEscalationPacket`.
- `src/triage.ts`: `createAgentTriage(agent): TriagePort`, holding the
  fast-path rule (`needsJudgement`), the legal-verdict table, and the
  envelope-to-verdict mapping (`toTriageVerdict`).

Existing modules change by targeted extension: `ports.ts` (types),
`router.ts` (`gate_error`'s dispatch becomes a two-step budget check instead
of the single-row lookup every other trigger uses — see `recheck_gate`
below), `schema.ts` (one verdict enum
value), `case-file.ts` (one `triageState` entry), `surface.ts` (`triage()`
builds `ctx` and writes the verdict's artefact; `dispatchSession()` accepts a
`briefRef`), `prompt-assembly.ts` (a triage-only setback slot),
`agent-invoke.ts` and `role-config.ts` (type parameters only; runtime logic
unchanged). `tool-authority.ts` is untouched.

### `AgentPort.invoke()` widening

Triage goes through the same `AgentPort.invoke()` as every role, via a
role-keyed result type. Worker and gate-maintenance keep `Terminus` exactly;
existing call sites infer the same types with no edit.

```ts
export type Incomplete = Extract<Terminus, { status: "incomplete" }>;

export type Terminus =              // unchanged
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | { status: "incomplete"; rationale: string };

export type TriageTerminus =
  | { status: "reroute"; rationale: string; payload: SharpenedBrief }
  | { status: "escalate"; rationale: string; payload: EscalationPacket }
  | { status: "fix_the_gate"; rationale: string; payload: GateRepairBrief }
  | { status: "retry_close"; rationale: string; payload: CloseRepairBrief }
  | { status: "abort"; rationale: string; payload: { reason: string } }
  | Incomplete;

interface RoleTerminusMap {
  worker: Terminus;
  "gate-maintenance": Terminus;
  triage: TriageTerminus;
}

export interface AgentPort {
  invoke<R extends AgentRole>(
    roleCfg: RoleHandle & { role: R },
    ctx: AgentContext,
  ): Promise<RoleTerminusMap[R]>;
}
```

`agent-invoke.ts`'s `invoke()` becomes generic over its envelope type
(`invoke<E>(roleCfg: RoleConfig<E>, ...): Promise<E | Incomplete>`), and
`RoleConfig` gains a defaulted type parameter (`RoleConfig<E = Envelope>`), so
the existing worker and gate-maintenance configs compile unchanged.
`RoleConfigShape` needs no change: it validates structure, not which envelope
a schema encodes.

**`status` at the SDK boundary, `verdict` in the case file.** The agent's
structured output uses the universal envelope field `status`
(`agent-interface.md`). Item 3's `TriageVerdict`/`TriageEntry` use `verdict`.
`toTriageVerdict` in `src/triage.ts` is the single translation point; neither
side's schema changes name.

### Payload schemas

zod, as `WorkerEnvelope` already does:

```ts
export const SharpenedBrief = z.object({
  problem: z.string().min(1),      // what is failing and what it implies
  dead_ends: z.string().min(1),    // what prior attempts tried and why each missed
  scope: z.string().min(1),        // what to touch, what to leave
  references: z.array(z.string()), // session keys for on-demand lookup
  diagnosis: z.string().min(1),    // a hypothesis, rendered as such
});
export const GateRepairBrief = SharpenedBrief;   // same job, next session is a different role
export const CloseRepairBrief = SharpenedBrief;

export const EscalationPacket = z.object({
  decision: z.string().min(1),   // stated as a decision, never merely "escalated"
  evidence: z.string().min(1),   // verbatim: newly-failing assertions, the worker's own
                                 // escalate rationale, or the close report detail
  dead_ends: z.string().min(1),
  why_now: z.string().min(1),    // which trigger and budget state forced this
  references: z.array(z.string()),
});

export const TriageEnvelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reroute"),      rationale: z.string().min(1), payload: SharpenedBrief }),
  z.object({ status: z.literal("escalate"),     rationale: z.string().min(1), payload: EscalationPacket }),
  z.object({ status: z.literal("fix_the_gate"), rationale: z.string().min(1), payload: GateRepairBrief }),
  z.object({ status: z.literal("retry_close"),  rationale: z.string().min(1), payload: CloseRepairBrief }),
  z.object({ status: z.literal("abort"),        rationale: z.string().min(1), payload: z.object({ reason: z.string().min(1) }) }),
]);

export const triageRoleConfig: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: /* read-only classifier; never overturns a PASS or an
                           authority-class escalate; diagnosis is a hypothesis */,
  envelopeSchema: TriageEnvelope,
  allowedTools: ["Read", "Glob", "Grep"],
};
```

`SharpenedBrief` deliberately has no `evidence` field. The worker prompt's
`## Gate evidence` slot already renders the newly-failing assertions verbatim
on every dispatch (`prompt-assembly.ts`), so the worker can never receive
triage's synthesis without the ground truth beside it: "synthesis augments
evidence, never replaces it" holds structurally, and there is no second copy
to drift. `EscalationPacket` does carry `evidence`, because a human reading
the case file has no such slot.

### `TriagePort` contract changes

```ts
export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  remainingBudgets: BudgetSet;
  ctx: AgentContext;             // NEW: what the agent path needs to invoke
}

export type TriageArtifact = SharpenedBrief | EscalationPacket | { reason: string };

export interface TriageVerdict {
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort" | "recheck_gate";
  rationale: string;
  artifact?: TriageArtifact;     // NEW, in memory only: what surface.ts writes to the ref
}
```

`surface.ts`'s `triage()` builds `ctx` from `dir`, the provisioned worktree,
and `sessionKey = "triage-${priorTriages}"`, the same round index it already
uses for the ref key, so the ref name and the session key are one string per
round. `deterministicRouter` ignores `ctx` and never sets `artifact`.

*(Team-lead assembly decision: `architecture.md` carried an in-memory
`viaAgent?: boolean` flag and left the ref payload as a placeholder. A verdict
must carry its payload to the ref regardless, so `artifact` replaces
`viaAgent`: one optional field answers both "what is written" and "is there a
brief to thread". Same in-memory-only, never-persisted scoping the critic
approved.)*

### `createAgentTriage` and the fast-path rule

```ts
export function createAgentTriage(agent: AgentPort): TriagePort {
  return {
    async triage(input) {
      if (input.trigger === "worker_escalate" && input.category === "authority") {
        return withPacket(await deterministicRouter.triage(input), input);  // pass-through
      }
      if (!needsJudgement(input)) {
        return withPacket(await deterministicRouter.triage(input), input);
      }
      const terminus = await agent.invoke({ role: "triage" }, input.ctx);
      return withPacket(toTriageVerdict(terminus, input), input);
    },
  };
}
```

`withPacket` attaches `buildEscalationPacket(input, rationale)` to any
`escalate` verdict that has no agent-supplied packet (see Escalation packets).

The rule for when judgement is needed, one row per trigger:

| Trigger | Agent engaged when | Otherwise |
|---|---|---|
| `worker_escalate` (authority) | never | escalate, unconditionally, before any table |
| `worker_escalate` (exhaustion) | `correction` has a slot left | escalate at cap (deterministic) |
| `gate_fail` | exactly one `correction` slot left | reroute while more remain; escalate at cap |
| `close_failure` | exactly one `close` slot left | `retry_close` while more remain; escalate at cap |
| `gate_error` | `gateError` spent **and** `gateMaintenance` has a slot left | `recheck_gate` while `gateError` remains; escalate when both are spent |

```ts
function needsJudgement({ trigger, category, remainingBudgets: b }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate": return category !== "authority" && left(b.correction) > 0;
    case "gate_fail":       return left(b.correction) === 1;
    case "close_failure":   return left(b.close) === 1;
    case "gate_error":      return left(b.gateError) <= 0 && left(b.gateMaintenance) > 0;
  }
}
```

The last-slot boundary is the control-flow doc's own example of judgement:
"with one slot left, a clean escalation beats a long-shot reroute". Once a
population is spent, no judgement can change the outcome, so no agent call is
made.

*(Team-lead assembly decision: `architecture.md`'s rule engaged the agent for
exhaustion-class escalates and for `gate_error` even when the budget the agent
would spend was already exhausted. The rule above adds the budget guard, so
the agent is never asked a question whose only legal answer is escalate.)*

### Legality and invalid output

```ts
const legalVerdicts: Record<TriageInput["trigger"], ReadonlySet<TriageTerminus["status"]>> = {
  gate_fail:       new Set(["reroute", "escalate", "abort"]),
  gate_error:      new Set(["fix_the_gate", "escalate", "abort"]),
  worker_escalate: new Set(["reroute", "escalate", "abort"]),
  close_failure:   new Set(["retry_close", "escalate", "abort"]),
};
```

`toTriageVerdict(terminus, input)`:

- `incomplete` terminus (no valid envelope, malformed payload, illegal status):
  escalate, rationale "triage did not produce a usable verdict: <cause>.
  Escalating rather than guessing."
- A status not in `legalVerdicts[trigger]`: escalate, rationale naming the
  status, the trigger, and the legal set.
- Otherwise: the terminus's status as the verdict, its rationale, and its
  payload as `artifact`.

The safe outcome is always escalate: a default reroute would burn correction
slots on a triage bug and mask it as a retry loop. `abort` is legal for every
trigger; it maps to `ABORTED`, an infra-class terminal. Validation happens
here, before any verdict is acted on; `writeRef`/`readRef` stay generic.
`recheck_gate` is not in `TriageEnvelope`: it is a router-only verdict,
because re-running a gate needs no judgement.

### Escalation packets on every path

Every `escalate` verdict carries an `EscalationPacket`. On the agent path the
agent authors it. On every other path (authority pass-through, deterministic
at-cap, invalid or illegal triage output) `buildEscalationPacket` assembles it
deterministically from the case file:

- `decision`: fixed per cause. Authority: "The worker stopped because it
  judged it lacked authority: <worker rationale>. Decide whether to grant it
  or take the action yourself." At cap: "No <population> budget remains
  (<used>/<max>). Decide whether to continue manually, amend the task, or
  abandon it." Invalid triage: "Triage could not reach a verdict. Decide how
  to proceed from the evidence below."
- `evidence`: verbatim newly-failing assertions from the latest gate entry,
  the worker's escalate rationale, or the latest close report detail,
  according to the trigger.
- `dead_ends`: the prior triage rationales, oldest first, or "No prior
  attempts were triaged."
- `why_now`: trigger, category if any, and the relevant budget as used/max.
- `references`: the session keys of every prior dispatch.

*(Team-lead assembly decision: `architecture.md` typed the packet only on the
agent's `escalate` envelope, leaving authority and budget-exhausted
escalations with the Item 3 stub, although `product-design.md` flow 2 and
MUST 4 require a packet for exactly those cases. The builder closes that gap
with no judgement and no agent cost.)*

### State-machine integration

`triage()` keeps today's sequence: call the port, write the ref, append the
`TriageEntry`, derive state. Two changes:

- The ref written at `triage-${priorTriages}` is `{ trigger, rationale,
  artifact }` when the verdict has an artifact, else today's `{ trigger,
  rationale }`. `TriageEntry` is unchanged in shape.
- When the derived state is `AGENT_ACTIVE` and the verdict carried a
  `SharpenedBrief`, the next worker dispatch records `briefRef` pointing at
  that ref. `dispatchSession()` takes an optional `briefRef`; a deterministic
  reroute passes none. `resolveEvidence` already reads `dispatch.briefRef` and
  renders it into `## Brief`; it does not re-validate, because the harness
  wrote the ref from an envelope `TriageEnvelope` already validated.

The same threading applies to `fix_the_gate` (a `GateRepairBrief` reaching the
gate-maintenance dispatch). `retry_close`'s `CloseRepairBrief` is persisted in
the ref only: the closer is not an agent, so there is no dispatch to thread it
to until Item 6 decides otherwise.

**No new state and no dispatch/terminus pair for triage's own session.**
Triage is read-only until its single append, so a crash mid-session leaves no
write; resume derives `TRIAGE`, mints the same session key, assembles the
same prompt, and calls again. A crash between ref write and entry append
leaves an orphan ref that the re-run overwrites at the same key.

**`recheck_gate` (SHOULD).** `router.ts`'s `gate_error` rule becomes two-step:
`recheck_gate` while `gateError` has a slot, else `fix_the_gate` while
`gateMaintenance` has a slot, else escalate. This is not a table-row edit:
every other trigger's verdict comes from a single `{budget, helpful}` lookup,
so `deterministicRouter`'s dispatch function gains a `gate_error`-only branch
that checks the two budgets in sequence before falling through to that
lookup for every other trigger. `triageState` maps `recheck_gate`
to `GATING`, re-running the same check against the same immutable baseline.
`gateError` already counts `gate` entries with status `ERROR`
(`case-file.ts`), so each failed recheck spends it with no new counter.
*(Team-lead assembly decision: `architecture.md` replaced the `gate_error`
row outright, which would have made a deterministic-only harness escalate
instead of reaching gate maintenance once `gateError` was spent. The two-step
rule keeps today's behaviour after the recheck.)*

### Prompt assembly

Worker and gate-maintenance prompts are unchanged. A triage invocation
renders the same five slots plus a `## Setback` slot, placed between
`## Gate evidence` and `## Reply format` and rendered only when `roleCfg.role`
is `"triage"`:

- the trigger and category;
- remaining budgets as `used/max` per population;
- the setback's own evidence not already in `## Gate evidence`: the worker's
  escalate rationale, or the close report detail;
- prior triage rationales, oldest first, or the fixed sentence "No prior
  triage rounds on this surface."

`PromptEvidence` gains the fields this slot needs, populated by
`resolveEvidence` from the case file; `assemblePrompt` stays pure and the
same case file yields a byte-identical triage prompt.

*(Team-lead assembly decision: `architecture.md` added the prior-rationale
slot to every role's prompt and did not render trigger or budgets for triage,
although the control-flow doc names remaining budgets as one of triage's two
load-bearing inputs. Scoping the slot to triage keeps Item 4's prompts
byte-identical.)*

### Security

No new authority mechanism. `tool-authority.ts` is role-agnostic and is reused
verbatim; `triageRoleConfig.allowedTools = ["Read", "Glob", "Grep"]` is the
whole authority surface. Triage has no write, edit or shell tool, and its
reads are confined to the worktree by the existing `canUseTool` guard.
Known gap, unchanged from Item 4: `claude-mock` does not enforce
`allowedTools`, so "triage cannot write" is proven by unit tests on the role
config and the authority guard, with the real guarantee resting on the SDK.

### Non-functional requirements

- **Determinism.** Triage prompts and session keys are pure functions of the
  case file.
- **Cost.** Zero agent calls for the common path; agent calls only for
  exhaustion-class escalates with budget left and the last-slot boundaries.
  `recheck_gate` turns flaky gate errors into free re-runs instead of
  gate-maintenance dispatches.
- **No hidden retries.** One `invoke()` per triage round; an `incomplete`
  triage escalates rather than retrying.
- **Observability.** Every triage decision is reconstructable from the case
  file: the entry, the ref, and the prompt reassembled from log state. The
  fast-path/agent split and illegal-verdict escalates are derivable from the
  log (agent-path refs carry an `artifact`; illegal-verdict rationales have a
  fixed shape), so Item 11 needs no schema change.

### Testing

1. **Pure unit tests:** `needsJudgement` over every trigger and budget state;
   `toTriageVerdict` over every legal and illegal (status, trigger) pair and
   `incomplete`; `buildEscalationPacket` per cause; payload schema
   round-trips; triage prompt determinism and worker prompt unchanged.
2. **Integration against `claude-mock`** (mock-gated, as existing suites):
   an agent-path reroute's `dead_ends` appears in the next worker's assembled
   prompt; a plain `gate_fail` with budget produces no invocation (spy port
   that throws); every `ESCALATED` path leaves a valid `EscalationPacket` in
   the ref; a crash between ref write and entry append replays to the same
   verdict.
3. **Tool authority:** the existing test shape, applied to
   `triageRoleConfig`.

## UX / Product: key flows

1. **Retry with a sharpened brief (agent path).** Triage writes its
   `SharpenedBrief` to the round's ref, appends the entry, and the next worker
   dispatch records `briefRef`. The worker sees `## Brief` (problem, dead ends,
   scope, references, diagnosis flagged as hypothesis) and `## Gate evidence`
   (verbatim) as distinct sources.
2. **Escalation handoff.** Marcus opens the terminal triage entry's ref and
   reads, in order: the decision, verbatim evidence, dead ends, why now,
   session references to pull a transcript only if needed. Authority,
   exhaustion-at-cap and gate-error-at-cap read differently in `why_now` and
   `decision`.
3. **Close-triage.** A `close_failure` can yield only `retry_close`, `escalate`
   or `abort`; anything else from the agent becomes a safe escalate.
4. **Authority pass-through.** Checked before any agent call; no budget and no
   agent can overrule it.
5. **Invalid triage output.** Escalate with a rationale naming state, cause
   and next action; never a raw SDK error.

Empty states: a first triage round renders "No prior triage rounds on this
surface."; a deterministic reroute is the intended common path, not a
degraded one; a packet produced because no budget remains says so plainly, so
Marcus knows his decision is now load-bearing.

Accessibility: packet fields are prose (agent-authored or fixed sentences),
never stack traces or bare enum values. Dana's plain-language summary is
COULD-tier and additive.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Triage agent invocation | Reuse estate: `AgentPort.invoke()` / `agent-invoke.ts`, widened generically | A triage-specific invocation path | "One primitive, roles are configs" (`agent-interface.md`); the SDK offers nothing triage-specific beyond what Item 4 wired (`research.md` §7) |
| Payload and envelope schemas | Reuse estate: zod v4 and `z.toJSONSchema()` | ajv, joi, yup, hand-written JSON Schema | Already the codebase's only schema library; a second would validate the same data twice |
| Read-only tool authority | Reuse estate: `tool-authority.ts` unmodified | A triage-specific deny-all guard | The general mechanism already branches only on `allowedTools` and the worktree |
| Legal verdict per trigger | Build: one `Record<trigger, Set<status>>` and one mapping function | Prompt-only instruction; a rules engine | Roadmap requires structural enforcement; a dependency for one table fails the overcomplication test |
| Deterministic escalation packet | Build: one pure function over the case file | Leave non-agent escalations with the stub; call the agent for every escalate | The stub fails Marcus; an agent call to restate known facts costs money for no judgement |
| `gate_error` re-check | Build: one verdict, one rule step, reusing `gating()` | A flaky-assertion quarantine mechanism; defer | Low cost, reuses the existing check path |
| Triage prompt | Build: one role-scoped slot in `assemblePrompt` | A second assembler | Keeps one pure, determinism-tested assembler |
| Test double | Reuse estate: `claude-mock` | Hand-written `AgentPort` double | Same reasoning as Item 4's ledger: the mock exercises the production path |

## Operability / DX

- **Environment:** unchanged; Node 22+, TypeScript, eslint, vitest. No new
  package dependency.
- **Harness and scaffolding:** two new modules and their tests in the
  existing flat layout; no new build step or directory convention.
- **Local-run story:** the full suite runs offline; mock-gated integration
  tests run when `claude-mock` is on `PATH`, as today. Triage's read-only role
  means mock scripts need no write or edit effects. A demo script, named in
  the existing `demo:` convention, prints the assembled triage prompt, the
  verdict, and the following worker's `## Brief`.
- **Guide:** a Triage chapter in `docs/configuring-a-role.md`: the reference
  config, the four-field table, and a note that triage's tool list is
  read-only by design rather than a knob to widen.
- **Deploy target:** none new; an npm-installable library running triage
  in-process like every other role.

## What this design does not include

- Real closers and what `retry_close` actually does (Item 6). The
  `CloseRepairBrief` is persisted, not threaded.
- CLI surfaces for inspecting triage output (Item 8).
- Multi-surface concerns, breaker, run-level budgets (Item 10).
- Reporting surfaces, dashboards, cross-run escalation metrics, and Dana's
  plain-language experience beyond the COULD summary (Item 11).
- A declarative or natural-language authoring surface for `triageRoleConfig`
  (Item 9).
- A history-depth tuning knob ("always ask the agent after attempt N"); the
  last-slot boundary is the only depth rule.
- A flaky-assertion quarantine mechanism beyond `recheck_gate`.

## Open questions

None blocking. The team-lead assembly decisions above are recorded for the
spec-reviewer to check against the approved artefacts.
