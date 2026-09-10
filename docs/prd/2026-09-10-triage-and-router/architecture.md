# Architecture: Triage and Deterministic Router (Item 5)

Grounded throughout in `docs/prd/2026-09-10-triage-and-router/research.md` (cited
`research.md §N`) and `docs/prd/2026-09-10-triage-and-router/product-design.md`
(cited `product-design.md`, flow/journey names). Settled mechanism decisions from
`docs/single-surface-control-flow.md` §Triage and `docs/agent-interface.md` are
restated, not re-litigated. Format follows
`docs/prd/2026-09-09-agent-invocation-primitive/architecture.md`'s precedent.

This item extends two existing, shipped seams (`TriagePort`, `AgentPort`) rather
than replacing either. `src/router.ts`'s `deterministicRouter` keeps running
unmodified for the cases that need no judgement; the whole of this document is
about what sits *around* it, not a rewrite of it.

## 1. Module structure and seams

Three new files, following the codebase's existing flat `src/*.ts` +
`src/*.test.ts` layout (the pattern Item 4's `role-config.ts` /
`prompt-assembly.ts` / `agent-invoke.ts` already established):

```
src/triage-role-config.ts   # TriageEnvelope + the four payload schemas + triageRoleConfig
src/triage.ts                # createAgentTriage(agent): TriagePort — the fast-path/agent-path
                              # boundary, legal-verdict-per-trigger enforcement, and the
                              # envelope->TriageVerdict mapping (including the safe-escalate path)
src/triage-brief.test.ts     # (and the usual sibling .test.ts files for the two modules above)
```

Four existing files change, each a targeted extension, not a rewrite:

- `src/ports.ts` — `AgentPort.invoke` becomes generic over role (§2); `TriageInput`
  gains a `ctx: AgentContext` field (§4); `TriageVerdict` gains two optional
  fields: `viaAgent?: boolean` (§8 — did this verdict reach a real agent
  envelope, as opposed to the deterministic table; read by `surface.ts`,
  never persisted) and its `verdict` enum gains `recheck_gate` (§7,
  SHOULD-tier). Both are additive and optional, so `router.ts`'s existing
  returns (which set neither) keep type-checking with no edit to that file.
- `src/router.ts` — the `rules` table gains a `gate_error` row (§7); everything
  else in this file is untouched.
- `src/schema.ts` — `TriageEntry.verdict` gains `recheck_gate` (§7); no other
  schema shape changes (the ref-file payload behind `artifactRef` grows richer
  content, but `TriageEntry` itself, `DispatchEntry`, and `HistoryEntry` keep
  their existing field sets, per `research.md §1,§5`'s finding that the schema
  already reserves the slots this item fills).
- `src/surface.ts` — `triage()` gains one line constructing `ctx` for the
  `TriagePort` call (§4); `dispatchSession()` gains one line populating
  `DispatchEntry.briefRef` on an agent-path reroute (§5, closing the concrete gap
  `research.md §3` names).

Nothing in `src/agent-invoke.ts`, `src/prompt-assembly.ts`, or
`src/tool-authority.ts` changes its runtime logic. `agent-invoke.ts`'s `invoke()`
becomes generic in its type signature only (§2) — the function body (assemble
prompt, spawn session, validate envelope, map to terminus) is exactly what triage
reuses unmodified, which is the entire point of "one primitive, roles are
configs" (`agent-interface.md`, governing decision 1).

## 2. `AgentPort.invoke()` widening — the highest-leverage decision (`research.md §10.1`)

**Decision: triage goes through the same `AgentPort.invoke()`, via a
role-keyed generic result type — not a separate, parallel invocation path.**
`agent-interface.md`'s roles table already lists triage as a third row of the
*same* primitive with its own payload/status set; building a second caller
that re-implements prompt assembly, envelope validation, and terminus mapping
would duplicate `agent-invoke.ts`'s tested logic for no reason a reader could
justify (this is exactly the hand-rolling the "buy-vs-build" lens rejects —
see §9). `product-design.md`'s "Architecture decisions" section confirms
this was shared with and accepted by the product view before this draft.

The concrete widening, chosen to satisfy "worker/gate-maintenance's contracts
must not change" literally (not just behaviourally — the existing exported
`Terminus` type keeps its current shape and existing call sites keep their
current inferred types with zero edits):

```ts
// src/ports.ts

export type Incomplete = Extract<Terminus, { status: "incomplete" }>; // unchanged shape,
                                                                        // now named so
                                                                        // TriageTerminus can
                                                                        // reuse it without
                                                                        // re-deriving it

export type Terminus =              // UNCHANGED — worker / gate-maintenance
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | { status: "incomplete"; rationale: string };

export type TriageTerminus =        // NEW — triage only
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

// TriagePort's own return type, unchanged in shape apart from one optional,
// in-memory-only field — see §8 for why it exists and where it stops.
export interface TriageVerdict {
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort" | "recheck_gate";
  rationale: string;
  /**
   * True only when this verdict came from a real, validated agent envelope
   * (createAgentTriage's agent path), never from the deterministic table or
   * the authority pass-through. Read once, by surface.ts's `triage()`, to
   * decide whether a `reroute` carries a real SharpenedBrief worth threading
   * onto the next dispatch (§8) — never written to TriageEntry or any
   * persisted artefact, so it adds nothing to the case-file schema and
   * nothing a resumed surface needs to reconstruct (a resumed surface
   * re-derives it fresh, by calling triage() again, exactly like every
   * other in-flight decision this driver makes).
   */
  viaAgent?: boolean;
}

export interface AgentPort {
  invoke<R extends AgentRole>(
    roleCfg: RoleHandle & { role: R },
    ctx: AgentContext,
  ): Promise<RoleTerminusMap[R]>;
}
```

`surface.ts:211` (`ports.agent.invoke({ role }, ctx)`, called with
`role: "worker" | "gate-maintenance"`) type-checks exactly as it does today —
TypeScript infers `R` from the literal passed at each call site, so
`dispatchSession`'s existing two call sites (worker, gate-maintenance) keep
inferring `Promise<Terminus>` with no annotation change. A new call site
passing `{ role: "triage" }` infers `Promise<TriageTerminus>`. This is the
"role-keyed result-type map" `product-design.md`'s "Architecture decisions"
section already names as this document's plan, made concrete.

`src/agent-invoke.ts`'s exported `invoke()` function widens the same way, at
the type level only:

```ts
// src/agent-invoke.ts — signature widens, body unchanged
export async function invoke<E extends { status: string; rationale: string }>(
  roleCfg: RoleConfig<E>,
  ctx: AgentContext,
  session: SessionEnvironment = {},
): Promise<E | Incomplete> { /* body identical to today's */ }
```

`src/role-config.ts`'s `RoleConfig` interface gains a default type parameter
(`RoleConfig<E = Envelope>`), so `workerRoleConfig: RoleConfig` and
`gateMaintenanceRoleConfig: RoleConfig` compile unchanged — this is the literal
"without breaking Item 4's worker/gate-maintenance contracts" requirement,
satisfied by TypeScript generics defaulting rather than by any runtime
branch. `RoleConfigShape` (the runtime zod validator `validateRoleConfig`
checks every role config against) needs no change: it already validates
structurally (`role` enum, non-empty `systemPromptFragment`, a zod schema
instance, non-empty `allowedTools`) without caring which envelope shape a
particular `envelopeSchema` encodes.

**`status`, not `verdict`, at the SDK boundary.** The agent's structured
output — what `envelopeSchema` validates and what the SDK's `outputFormat`
constrains — uses the harness's universal envelope field name `status`
(`agent-interface.md`: "Envelope = {status, rationale, payload?}", the exact
same contract `WorkerEnvelope` already implements). The existing
`TriagePort`/`TriageVerdict`/`TriageEntry` machinery from Item 3 uses the
field name `verdict`. Rather than rename one to match the other (which would
touch Item 3's shipped, tested schema for no functional gain, or break the
uniform-envelope contract every other role already relies on), the mapping
from `TriageTerminus` to `TriageVerdict` is one small, explicit function
(§4) at the one seam that already has to exist regardless — `src/triage.ts`.
`status` is what the SDK session emits and what `agent-invoke.ts` validates;
`verdict` is what the case file persists and what `router.ts`/`surface.ts`
already read. Two field names, one clearly-scoped translation point, zero
schema churn on either side of it.

## 3. Payload schemas: `SharpenedBrief`, `EscalationPacket`, `GateRepairBrief`, `CloseRepairBrief`

New module `src/triage-role-config.ts`, using zod exactly as
`WorkerEnvelope` does (`research.md §8`: no new schema library, zod's
`z.discriminatedUnion` and `z.toJSONSchema()` already do everything needed).

```ts
export const SharpenedBrief = z.object({
  problem: z.string().min(1),      // crisp statement of what is failing and what it implies
  dead_ends: z.string().min(1),    // what prior attempts tried and why it missed
  scope: z.string().min(1),        // what to touch / what to leave
  references: z.array(z.string()), // session_keys for on-demand deep lookup
  diagnosis: z.string().min(1),    // hypothesis — rendered to the worker flagged as such
});
export type SharpenedBrief = z.infer<typeof SharpenedBrief>;

// Same informational job for the next agent dispatched, different role. Reusing
// the identical shape rather than inventing two near-duplicate schemas: both
// exist to brief the next session, neither needs a field the other lacks.
export const GateRepairBrief = SharpenedBrief;
export type GateRepairBrief = SharpenedBrief;
export const CloseRepairBrief = SharpenedBrief;
export type CloseRepairBrief = SharpenedBrief;

export const EscalationPacket = z.object({
  decision: z.string().min(1),   // stated as a decision, never merely "escalated"
  evidence: z.string().min(1),   // verbatim newly-failing assertions or the worker's own
                                  // escalate rationale — unlike the brief, the packet is read
                                  // directly by a human with no separate always-rendered
                                  // "## Gate evidence" slot, so it must carry its own copy
  dead_ends: z.string().min(1),
  why_now: z.string().min(1),    // which trigger + budget state forced the escalation
  references: z.array(z.string()),
});
export type EscalationPacket = z.infer<typeof EscalationPacket>;

export const TriageEnvelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reroute"), rationale: z.string().min(1), payload: SharpenedBrief }),
  z.object({ status: z.literal("escalate"), rationale: z.string().min(1), payload: EscalationPacket }),
  z.object({ status: z.literal("fix_the_gate"), rationale: z.string().min(1), payload: GateRepairBrief }),
  z.object({ status: z.literal("retry_close"), rationale: z.string().min(1), payload: CloseRepairBrief }),
  z.object({ status: z.literal("abort"), rationale: z.string().min(1), payload: z.object({ reason: z.string().min(1) }) }),
]);
export type TriageEnvelope = z.infer<typeof TriageEnvelope>;

export const triageRoleConfig: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [ /* role identity: read-only classifier, never overturns a PASS,
                              never overturns an authority-class escalate — see role-config.ts's
                              existing fragments for house style */ ].join("\n"),
  envelopeSchema: TriageEnvelope,
  allowedTools: ["Read", "Glob", "Grep"],
};
```

**`SharpenedBrief.evidence` does not exist** — this is `product-design.md`'s
resolution of `research.md §10.2` verbatim: the always-present `## Gate
evidence` prompt slot (`prompt-assembly.ts:70-75`) already renders the
newly-failing assertions verbatim on every worker dispatch, brief or not.
Adding a second verbatim copy inside the brief would either drift from the
gate's own copy across rounds or force a second invariant to maintain for no
reader benefit. `EscalationPacket.evidence` is different and does need its
own copy: nothing else renders a "## Gate evidence" slot for a human reading
the case file's JSON directly, so the packet's `evidence` field is the only
place verbatim evidence reaches Marcus (`product-design.md` flow 2, point 2).

## 4. `TriagePort`: the fast-path/agent-path composition

New module `src/triage.ts`. `TriageInput` (`src/ports.ts`) gains one field:

```ts
export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  remainingBudgets: BudgetSet;
  ctx: AgentContext;   // NEW — what the agent path needs to call AgentPort.invoke
}
```

This is a deliberate, minimal extension of Item 3's contract, not a
preservation of it byte-for-byte — `deterministicRouter` (`router.ts`)
simply never reads the new field, so it is unaffected. `surface.ts`'s
`triage()` function already has everything needed to populate it: `dir`,
`worktreeOf(caseFile, location)`, and a session key built the same
deterministic way `dispatchSession` already builds one —
`sessionKey = "triage-${priorTriages}"`, reusing the exact round-index
`surface.ts:563` already computes for the ref key, so the ref filename and
the session/journal key are the same string for the same round (one less
thing to keep in sync, not a new counter).

```ts
export function createAgentTriage(agent: AgentPort): TriagePort {
  return {
    async triage(input: TriageInput): Promise<TriageVerdict> {
      // 1. Authority-class pass-through: unconditional, before any table or
      //    agent call, exactly as router.ts checks it today. This is the one
      //    behaviour this item must not regress (product-design.md flow 4).
      if (input.trigger === "worker_escalate" && input.category === "authority") {
        return deterministicRouter.triage(input); // router.ts already returns this verdict
      }

      // 2. Fast-path rule (§5): does this trigger, at this budget state,
      //    need judgement at all?
      if (!needsJudgement(input.trigger, input.category, input.remainingBudgets)) {
        return deterministicRouter.triage(input);
      }

      // 3. Agent path: one invoke() call, the same primitive every role uses.
      const terminus = await agent.invoke({ role: "triage" }, input.ctx);

      // 4. Map to the existing TriageVerdict shape, enforcing per-trigger
      //    legality and the safe-escalate default (§6).
      return toTriageVerdict(terminus, input.trigger);
    },
  };
}
```

`needsJudgement`, `toTriageVerdict`, and the legal-verdict table live in the
same file, each small enough to unit-test with hand-built `TriageInput`/
`TriageTerminus` values and no SDK/mock involvement (§10, tier 1).

## 5. The fast-path rule

The deterministic router already answers "reroute or escalate, given a
budget" for every trigger. What this item adds is *when to ask the agent
instead of trusting that table blindly* — the single cost-control decision
the roadmap names as this item's job ("agent calls only where a real
decision exists").

| Trigger | Judgement needed? | Rule |
|---|---|---|
| `worker_escalate` (authority) | Never | Unconditional pass-through, before any table (§4 step 1) |
| `worker_escalate` (exhaustion) | Always | The whole point of this item: triage may overrule an exhaustion escalate downward, and only judgement can tell a genuinely-stuck session from one a fresh attempt would resolve |
| `gate_error` | Only once the cheap recheck is exhausted | See §7 — a bounded, agent-free re-check is tried first; the agent classifies "fixable environment issue vs. give up" only after that budget is spent |
| `gate_fail` | Only at the last correction slot | Every gate_fail with budget remaining stays 100% deterministic (`product-design.md` Journey A, matches the roadmap's cost-control success criterion literally); at the last remaining slot, judgement decides whether the last attempt is worth spending, rather than mechanically spending it |
| `close_failure` | Only at the last close slot | Same reasoning as `gate_fail` — close-failure judgement is low-value in general (`product-design.md` Journey A does not list it among the always-agent triggers) but the last-slot boundary applies uniformly across populations, not just to the two triggers the control-flow doc names by example |

"Last remaining slot" is `used === max - 1` (one attempt left before the cap
forces escalation regardless) — this is the concrete form of the control-flow
doc's own reasoning: "with one slot left, a clean escalation beats a
long-shot reroute," which is a judgement call, not a lookup. Once a
population is fully exhausted (`used >= max`), no judgement can change the
outcome — the router's existing at-cap branch already escalates
unconditionally and correctly, so there is nothing for the agent to decide;
`needsJudgement` returns `false` there and the deterministic path (which
already escalates at cap) is used, saving an agent call whose answer cannot
matter.

```ts
function needsJudgement(
  trigger: TriageInput["trigger"],
  category: TriageInput["category"],
  budgets: BudgetSet,
): boolean {
  const lastSlot = (b: Budget) => b.used === b.max - 1;
  switch (trigger) {
    case "worker_escalate": return category !== "authority"; // exhaustion only reaches here
    case "gate_error":      return budgets.gateError.used >= budgets.gateError.max;
    case "gate_fail":       return lastSlot(budgets.correction);
    case "close_failure":   return lastSlot(budgets.close);
  }
}
```

This function is pure, has no I/O, and is the entire "keep the agent off the
fast path" decision — testable with plain data (§10).

## 6. Invalid and out-of-scope triage output

`product-design.md` flow 5's requirement: **the safe outcome is always
escalate, never a default reroute**, whether the cause is a malformed/absent
envelope or a legal-but-illegal-for-its-trigger verdict. `toTriageVerdict`
is where both are decided, because it is the one point through which every
agent-path result must pass before anything is acted on (closing
`research.md §10.3`'s open question: validation happens here, not at
`writeRef`/`readRef`, which stay exactly as generic and unvalidated as they
are today for every other artefact type).

```ts
const legalVerdicts: Record<TriageInput["trigger"], Set<TriageTerminus["status"]>> = {
  gate_fail:       new Set(["reroute", "escalate", "abort"]),
  gate_error:      new Set(["fix_the_gate", "escalate", "abort"]),
  worker_escalate: new Set(["reroute", "escalate", "abort"]),
  close_failure:   new Set(["retry_close", "escalate", "abort"]), // reroute is NOT legal here
};

function toTriageVerdict(terminus: TriageTerminus, trigger: TriageInput["trigger"]): TriageVerdict {
  if (terminus.status === "incomplete") {
    return { verdict: "escalate", rationale:
      `triage did not produce a usable verdict: ${terminus.rationale}. Escalating rather than guessing.`,
      viaAgent: true };
  }
  if (!legalVerdicts[trigger].has(terminus.status)) {
    return { verdict: "escalate", rationale:
      `triage returned '${terminus.status}', which is not a legal verdict for a ${trigger} setback ` +
      `(legal: ${[...legalVerdicts[trigger]].join(", ")}). Escalating rather than acting on an ` +
      `out-of-scope verdict.`, viaAgent: true };
  }
  return { verdict: terminus.status, rationale: terminus.rationale, viaAgent: true };
}
```

`viaAgent: true` is set on every branch that reached this function at all —
including the two safe-escalate branches — because the defining question is
"did this verdict come from a real agent call," not "did it produce a brief."
The deterministic table's and the authority pass-through's returns
(`deterministicRouter.triage(input)`, called directly in §4, never passed
through `toTriageVerdict`) simply never set the field, so it is `undefined`
there — no edit to `router.ts` needed for this to be correct.

`abort` is legal for every trigger — it is the one verdict the control-flow
doc does not scope to a specific trigger (it maps to `ABORTED`, an
infra-class terminal state, not a human-owned `ESCALATED` one), so it is
treated as a general escape hatch rather than added to every trigger's list
by exception.

This single function is `product-design.md` flow 3's ("close-triage offers
only `retry_close`/`escalate`") and flow 5's ("invalid triage output")
enforcement point, both closed by the same table and the same fallback —
not two separate mechanisms. `research.md §2/§10.4`'s gap ("nothing stops a
`close_failure` trigger from receiving a `reroute` verdict except the
router's own table happening not to emit one") is closed structurally: even
if `triageRoleConfig`'s system prompt is imperfect or the agent is
adversarial, an out-of-scope verdict cannot reach `deriveStateFromEntry`
because `toTriageVerdict` never returns it.

## 7. `gate_error`'s agent-free re-check (SHOULD)

Reserved since Item 3 (`gateError` budget population, `research.md §1`) and
named as this item's to decide (`docs/superpowers/specs/2026-09-07-...md:564-572`).
**Shipped, because the implementation cost is genuinely low** —
`product-design.md`'s stated bar for shipping it: it reuses `runCheck` (the
exact call `gating()` already makes) and needs exactly one new verdict, not
a new mechanism.

- `router.ts`'s `rules` table gains a row: `gate_error: { budget: "gateError",
  helpful: "recheck_gate" }` — the exact shape every other row already has,
  filling in the comment that has named this gap since Item 3.
- `TriageVerdict["verdict"]` and `TriageEntry.verdict` (`schema.ts`) gain
  `recheck_gate`. `deriveStateFromEntry`'s `triageState` map gains
  `recheck_gate: "GATING"` — routing back to the exact same `gating()`
  function that runs the post-task check, re-checking the same attempt
  against the same immutable baseline (never re-baselining, per the
  control-flow doc's gate-maintenance asymmetry, which this reuses rather
  than re-deriving).
- **`recheck_gate` is router-only — it is not a legal agent output.**
  `TriageEnvelope` (§3) has no `recheck_gate` variant; the agent is never
  asked to decide "should I re-run the gate," because that decision needs no
  judgement (`docs/single-surface-control-flow.md`: "cheap, stateless,
  re-run it"). `needsJudgement`'s `gate_error` case (§5) only returns `true`
  once `gateError` is exhausted — so the *agent* only ever sees a `gate_error`
  trigger after the cheap recheck is spent, and its only legal verdicts
  remain `fix_the_gate`/`escalate`/`abort` (§6's table, unchanged).

This keeps the three-tier `gate_error` handling honest about cost: recheck
(free, mechanical) → classify (agent, judgement) → escalate (forced, at
`gateMaintenance` cap) — never skipping straight to an agent call for a
flake the gate itself would resolve on a second look.

## 8. State-machine integration and prompt assembly for the sharpened retry

**No new `SurfaceState` and no new dispatch/terminus entry pair for
triage's own agent session.** Triage is read-only over the case file and
produces no side effect until its single `TriageEntry` append
(`single-surface-control-flow.md`'s "Recoverability" section, restated
verbatim by `research.md §2`) — this property already holds today and
**continues to hold once the call inside it is a full SDK session**: a crash
mid-triage-invocation leaves no partial write anywhere (no dispatch entry, no
ref, no cursor change), so `position()` still derives `TRIAGE` on resume and
simply calls `triage()` again, minting the same `sessionKey` (deterministic
from `priorTriages`, §4) and the same prompt. This is `product-design.md`'s
MUST #9 ("crash-safe replay of triage") satisfied by construction, not by
new machinery — the worker/gate-maintenance dispatch/terminus split exists
because *their* sessions leave worktree edits behind that must not be lost or
re-run twice; triage's session leaves nothing behind, so it needs none of
that scaffolding.

**Closing the one concrete wiring gap** (`research.md §3`,
`product-design.md` MUST #3): `dispatchSession()` (`surface.ts:200-232`)
gains a `briefRef?: string` parameter, populated only on an agent-path
reroute:

```ts
// triage(): the artifactRef write, the TriageEntry append, and the state
// derivation are exactly today's sequence, unmodified. What's new is reading
// `verdict.viaAgent` — the in-memory-only field from §2 — to decide whether
// this reroute carries a real SharpenedBrief worth threading onto the next
// dispatch.
const verdict = await ports.triage.triage(input); // TriageVerdict, viaAgent set only by the agent path
const artifactRef = await writeRef(dir, `triage-${priorTriages}`, /* payload, richer per §3 */);
const entry: HistoryEntry = {
  t: "triage", afterAttempt: workerAttempt(caseFile.history), trigger,
  verdict: verdict.verdict, rationale: verdict.rationale, artifactRef,
}; // unchanged shape — verdict.viaAgent is never copied onto entry
await appendEntry(dir, entry);

const state = deriveStateFromEntry(entry);
if (state === "AGENT_ACTIVE") {
  const briefRef = verdict.viaAgent ? entry.artifactRef : undefined;
  return dispatchSession(dir, caseFile, location, ports, "worker", workerAttempt(caseFile.history), briefRef);
}
```

A deterministic-router reroute passes no `briefRef` (`briefRef` is
`undefined`, and `dispatchSession`'s new parameter defaults to `undefined`
when omitted), matching `product-design.md` flow 1's explicit scoping: only
an agent-path reroute produces a real `SharpenedBrief`; a deterministic
reroute continues to produce exactly what it produces today (a rationale
string, no brief, no new cost).

**Why `viaAgent` on `TriageVerdict`, not a schema-sniff or a duplicated
decision function.** Two alternatives were rejected. Re-parsing the stored
ref to decide whether it validates as a `SharpenedBrief` would make a
routing decision depend on a runtime schema check of persisted data —
exactly the kind of implicit coupling this codebase avoids elsewhere
(`deriveStateFromEntry` never re-derives from content it could instead carry
explicitly). Having `surface.ts` call `needsJudgement` a second time,
independently, to re-derive "was this an agent call," would duplicate §5's
decision function outside `triage.ts` and risk the two copies drifting —
precisely the duplication §12's extensibility argument depends on there
being none of. `viaAgent` instead carries the one bit `createAgentTriage`
already knows at the point it decides which branch to take, across the one
interface boundary (`TriagePort.triage`) that already exists between it and
`surface.ts`. It is scoped to `TriageVerdict` (the in-memory return value),
never to `TriageEntry` (the persisted record) — a resumed surface does not
need to reconstruct it from the log, because a resumed surface that lands on
`TRIAGE` calls `triage()` fresh (§8, crash-safety) and gets a fresh
`TriageVerdict` with `viaAgent` computed anew, exactly as it re-derives every
other in-flight fact this driver decides rather than persists.

**Prompt assembly needs no change of its own.** `resolveEvidence()`
(`prompt-assembly.ts:26-41`) already reads `dispatch.briefRef` and resolves
it via `readRef`; `assemblePrompt()` already renders whatever is behind it
into the `## Brief` slot, `JSON.stringify`'d (`prompt-assembly.ts:65-68`).
Once `SharpenedBrief` is a real, validated shape instead of an `unknown`
stub, the rendered JSON is simply richer — `problem`/`dead_ends`/`scope`/
`references`/`diagnosis`, each a named field a reader (or the receiving
agent) can parse structurally rather than a two-field stub. **Decision:
`resolveEvidence` does not validate the brief against `SharpenedBrief`
before rendering it** — it stays exactly as permissive as it is today
(`research.md §3`'s stated trade-off: "trust the ref's contents blindly, or
validate and risk a new failure mode for the worker dispatch path").
Validation already happened once, at the point triage's own envelope was
parsed (§2, §6) — a `SharpenedBrief` reaching `DispatchEntry.briefRef` has
already been through `TriageEnvelope.parse`, since `toTriageVerdict` only
returns a `reroute` verdict for a terminus that already validated. Re-validating
identical, already-trusted data a second time on the read path would be the
double-validation §2 already rejects for the SDK/harness boundary, applied
again here for no new guarantee — the ref is written by the harness itself
from already-validated data, not user input arriving fresh.

**The triage agent's own prompt** reuses `assemblePrompt()` unmodified —
`roleCfg = triageRoleConfig`, and the five-slot template renders identically
for triage: task, prior brief/rationale (here, prior triage rounds' own
rationale strings, since `resolveEvidence` reads whatever the most recent
dispatch's `briefRef` holds — for a triage invocation there is no dispatch
in flight, so this needs one small, explicit addition, not a new module.

**Prior triage rationales, for triage's own prompt.** `resolveEvidence`
resolves *a worker's* brief slot from the most recent `dispatch` entry — it
has no notion of "the triage agent's own prior-round input," because that
input is a different thing: not a brief for a worker, but the running history
of triage's own past verdicts on this surface. `product-design.md`'s empty
state ("no prior triage rounds... renders a fixed 'no prior triage rounds'
sentence") and the control-flow doc's input contract both name this as a
required input, distinct from the worker/gate-maintenance brief slot.
**Decision: a second, triage-only evidence field**, added to
`PromptEvidence` and populated by a small addition to `resolveEvidence`
(both already accept `caseFile`, so no new I/O parameter):

```ts
export interface PromptEvidence {
  brief: unknown;                 // unchanged — a worker/gate-maintenance dispatch's briefRef
  newFailures: NewFailure[];      // unchanged
  priorTriageRationales: string[]; // NEW — every prior `triage` entry's `rationale`, oldest first
}
```

`assemblePrompt` renders this as a sixth, triage-specific slot appended after
`## Gate evidence` and before `## Reply format`, present (and empty-stated,
per `product-design.md`'s empty-state bullet) for every role's prompt for
uniformity, but only ever populated for a `TRIAGE`-state invocation (a
worker/gate-maintenance surface accumulates no `triage` entries until its
first setback, so the slot renders the same "no prior triage rounds" sentence
for them as it would for a first-round triage call — no role-conditional
branching in `assemblePrompt` itself, just a slot that is sometimes empty).

## 9. Security: tool authority for triage

**No new authority mechanism.** `research.md §7` confirms directly against
the pinned SDK version: `tool-authority.ts`'s `createToolAuthority` and
`authorityRefusal` are already role-agnostic (they take a `RoleConfig` and a
`worktreePath`, branch on neither role name nor tool set beyond what
`roleCfg.allowedTools` says) and are reused verbatim. `triageRoleConfig.
allowedTools = ["Read", "Glob", "Grep"]` (`agent-interface.md`'s roles table)
is the entire authority surface this item adds:

- **Tool restriction**: `tools: triageRoleConfig.allowedTools` passed to the
  SDK, per Item 4's already-verified mechanism (`sdk.d.ts:1469-1481`, cited
  in the Item 4 architecture doc and re-confirmed against the same pinned
  version by `research.md §7`) — triage's session has no `Write`/`Edit`/
  `Bash` tool in its base set at all, so it cannot mutate anything even if
  its own reasoning went wrong; refusal is structural, not policed by a
  prompt sentence.
- **Worktree scoping**: unchanged — `createToolAuthority`'s `isInside` check
  applies to triage's `Read`/`Glob`/`Grep` calls exactly as it does to every
  other role's, so triage can inspect files inside the surface's worktree
  (useful context beyond the assembled prompt, since it is read-only and low
  blast-radius to permit) but never outside it, closing the same "the checks
  live outside every agent-reachable worktree" boundary every other role
  already respects.
- **Read-only is the entire boundary; no path-list boundary needed.** Unlike
  gate-maintenance's "environment, not assertions" distinction (a finer cut
  within edit authority, enforced by physical location), triage's boundary
  is simply "may read, may never write" — a strictly smaller authority
  surface with nothing further to carve inside it.
- **Known, stated gap, unchanged from Item 4** (`research.md §6,§7`):
  `claude-mock` does not enforce `allowedTools`, so "triage cannot write
  files" is provable only via a unit test on `triageRoleConfig.allowedTools`
  and `tool-authority.ts`'s deny behaviour (already-existing test pattern,
  reused, not invented for this item) — not via a mock-scripted write being
  refused. The real guarantee rests on the SDK's own enforcement, exactly as
  it does for worker/gate-maintenance today.

## 10. Testing strategy

Follows the exact three-tier pattern `research.md §6` documents for
`agent-invoke.test.ts`, extended to triage's new surfaces — no new testing
mechanism, one more application of the existing one:

1. **Pure-function unit tests, no SDK/process involved.**
   - `needsJudgement` (§5): every trigger × budget-state combination, table-
     driven, asserting the exact boolean — this is the test that makes "fast
     path stays cheap" (`product-design.md`'s success metric) falsifiable
     without a mock at all.
   - `toTriageVerdict` (§6): every `(TriageTerminus, trigger)` pair that
     should map to its verdict unchanged, every illegal-verdict-for-trigger
     pair that must map to a safe escalate (the concrete regression test
     `product-design.md` names for "close-triage legality is enforced"), and
     the `incomplete`-terminus case mapping to escalate.
   - Payload schema round-trips (`SharpenedBrief`/`EscalationPacket`/etc.):
     valid and invalid hand-built payloads against `TriageEnvelope.safeParse`,
     mirroring `agent-invoke.test.ts`'s existing envelope-validation tests.
   - `assemblePrompt`/`resolveEvidence` determinism, extended: two prompt
     assemblies from the same case file (now including `priorTriageRationales`)
     produce byte-identical strings — the same determinism test Item 4
     already runs, exercised against triage's new slot.

2. **`AgentPort`/`TriagePort` integration tests against `claude-mock`**
   (mock-gated, `describe.skipIf`, per the existing pattern), scripting a
   triage session's structured reply and asserting: (a) the resulting
   `TriageVerdict` and its `artifactRef` content, (b) that a scripted
   agent-path reroute's `SharpenedBrief` reaches the next worker dispatch's
   assembled prompt (the concrete test `product-design.md`'s success metrics
   name — "the next attempt's assembled prompt contains the prior round's
   `dead_ends` content"), and (c) that no invocation occurs at all for a
   plain `gate_fail` with budget remaining (a spy `AgentPort` whose `invoke`
   throws if called, wired in place of the real one — proving the fast path
   by absence of a call, not by inspecting one).

3. **Tool-authority enforcement**, unchanged mechanism, one more role:
   `tool-authority.test.ts`-style unit tests asserting `createToolAuthority`
   denies `Write`/`Edit`/`Bash` for `triageRoleConfig` and allows `Read`/
   `Glob`/`Grep` inside the worktree — the same test shape already used for
   worker/gate-maintenance, not a new testing idiom.

A demo, `demos/triage-slice-N-agent-path.ts`, matching the existing
`demos/agent-invocation-slice-N-*.ts` pattern: one real `createAgentTriage`
call against `claude-mock`, printing the assembled triage prompt and the
resulting `TriageVerdict`, then a second `invoke()` call showing the
`SharpenedBrief` rendered into the following worker's `## Brief` slot —
proving the whole "retry is informed" loop end to end without a live API
call, the same "no live API calls" property every existing demo already has.

## 11. NFRs

- **Determinism**: unchanged mechanism, extended scope. The triage prompt is
  a pure function of case-file state (§8) exactly like every other role's;
  `sessionKey` derivation (`triage-${priorTriages}`) is log-derived, so a
  resumed surface mints the identical key and therefore the identical
  prompt on retry — the same property `agent-invoke.ts`'s determinism test
  already proves for worker/gate-maintenance, extended by one more test
  case (§10.1).
- **Cost**: the entire point of §5's fast-path rule. A plain `gate_fail`
  with budget remaining costs zero agent invocations, unchanged from today.
  `gate_error` costs zero agent invocations until its cheap recheck budget
  is spent (§7) — a strict cost *reduction* versus routing every `gate_error`
  straight to gate-maintenance dispatch, which is what happens today. The
  only triggers that always cost an agent call are `worker_escalate`
  (exhaustion) — where the roadmap's entire user-value case for this item
  lives — and the rare last-budget-slot boundary for the other two triggers.
- **No hidden retries inside the primitive**, unchanged from Item 4: `invoke()`
  is called exactly once per triage round; `createAgentTriage` does not loop
  or retry the agent call itself. A triage round that yields `incomplete`
  escalates (§6) rather than retrying — matching the flaky-test prior art's
  caution (`research.md §9`) against masking a genuine problem as an
  automatic retry, applied to triage's own output instead of the worker's.
- **Observability**: every triage round's prompt is reconstructable from the
  case file at that log position (`assemblePrompt` given `caseFile` +
  `triageRoleConfig`, no separate prompt log), exactly like every other
  role's invocation. The `TriageEntry`'s `artifactRef` is the durable record
  of what triage decided and why — a project owner or Marcus reads it
  directly from the case file's `refs/` directory with no transcript pull
  needed for the common case (`product-design.md`'s Marcus success metric).
- **Telemetry hook, not a new subsystem**: `needsJudgement`'s true/false
  result and `toTriageVerdict`'s legal/illegal branch are exactly the two
  facts a future reporting surface (Item 11) would want counted ("how often
  did the fast path fire," "how often did triage produce an illegal
  verdict") — this item does not add a metrics/telemetry emitter (out of
  scope, no roadmap item asks for one yet), but both quantities are already
  derivable from the case file's own `triage` log entries
  (`trigger`/`verdict`/`rationale`) with no new field: an illegal-verdict
  escalate is identifiable by its rationale's fixed sentence shape (§6),
  and a fast-path verdict is identifiable by the absence of an `artifactRef`
  richer than the existing stub shape. Item 11 building on this needs no
  schema change from this item to do so.

## 12. Extensibility

Adding a fifth role (a future item) follows exactly the pattern Item 4's own
architecture doc already states and this item exercises for real: one more
`RoleConfig<E>` instance, one more entry in a role→terminus type map if the
new role's status vocabulary is genuinely distinct, and one more driver call
site. `invoke()` itself does not change for a fifth role, for the same
reason it did not change for triage — the widening in §2 is already
role-generic (`RoleTerminusMap[R]`, not a triage-specific special case), so
this item's own widening is the *general* mechanism a sixth role would reuse,
not a one-off carve-out for triage.

Within triage itself, a project extending `needsJudgement` (§5) to add a new
trigger, or `legalVerdicts` (§6) to add a new verdict, touches exactly those
two small, pure, table-shaped functions — neither `agent-invoke.ts` nor
`tool-authority.ts` needs to know a new trigger or verdict exists, matching
the same "one interface, variable subject" shape the gate and close
interfaces already establish (`product-design.md`'s buy-vs-build entry on
this point).

## 13. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Triage's agent invocation mechanism | **Reuse-estate** — the same `AgentPort.invoke()`/`agent-invoke.ts` primitive every role uses, widened generically (§2) | A separate, triage-specific invocation function duplicating prompt assembly + envelope validation + terminus mapping | `research.md §7`: "the SDK offers nothing triage-specific to design against beyond what Item 4 already wired up." A parallel path would duplicate tested logic (`agent-invoke.test.ts`) for a role that needs none of its own mechanism, only its own config — exactly the "one primitive, roles are configs" governing decision `agent-interface.md` already states |
| `TriageEnvelope`/`SharpenedBrief`/`EscalationPacket`/`GateRepairBrief`/`CloseRepairBrief` schema definition | **Reuse-estate** — zod, already the codebase's exclusive schema library | `ajv`/`joi`/`yup`, or a hand-written JSON Schema per payload | `research.md §8`: zod v4 is already installed and already does exactly this class of problem (`WorkerEnvelope`, `GateRef`); a second library would validate the same data twice with no gained guarantee |
| Tool authority for a read-only role | **Reuse-estate** — `tool-authority.ts`'s existing `createToolAuthority`/`authorityRefusal`, unmodified | A narrower, triage-specific permission callback (e.g. a hard-coded "deny everything" guard bypassing the general mechanism) | `research.md §7`: already role-agnostic, branches only on `roleCfg.allowedTools` and `worktreePath` — a triage-specific guard would duplicate logic for a case the general mechanism already covers correctly (an empty-of-write-tools `allowedTools` list) |
| Legal-verdict-per-trigger enforcement | **Build** — a small, pure lookup table (`legalVerdicts`, §6) plus one mapping function | Enforce it only in the triage agent's system prompt (as today); or a general-purpose rules-engine/validation library | The roadmap's own success criterion needs this *structurally* enforced, not just documented (`research.md §10.4`'s explicit gap). A rules engine would be a dependency for what is, precisely, one `Record<trigger, Set<status>>` and an `if` — matching the "would a senior engineer say this is overcomplicated" bar |
| The `gate_error` agent-free re-check | **Build** — reuse `runCheck`/`gating()` verbatim, one new verdict, one new routing-table row | Ship it as a fuller "flaky assertion quarantine" mechanism (control-flow doc names this as a future mitigation, out of scope); or defer entirely (SHOULD, not MUST) | `product-design.md`'s stated bar for shipping a SHOULD item: ship if implementation cost is low. It is — no new mechanism, one row and one enum value, reusing a function call `gating()` already makes for the ordinary post-task check |
| Prompt template extension (triage's own prompt, the prior-triage-rationale slot) | **Build** — one more field on `PromptEvidence`, rendered by the existing `assemblePrompt` | A second, triage-specific prompt assembler | `assemblePrompt` is already a five-slot pure function taking `caseFile`+`roleCfg`; a second assembler would duplicate the determinism guarantee (§11) that the existing one already provides and tests |
| Test double for the SDK seam (triage's own tests) | **Reuse-estate** — `claude-mock`, same sibling-project dependency Item 4 already established, same "best-effort until Item 7" status | A hand-written `TriagePort`/`AgentPort` test double | Same reasoning as Item 4's own ledger entry (`docs/prd/2026-09-09-agent-invocation-primitive/architecture.md §9`): a hand-written double exercises a weaker path than production and would not need to change on an SDK shape change, which is precisely the property the mock exists to give up |

## 14. Operability / DX

**Environment**: unchanged from Item 4 — Node ≥22, TypeScript, the existing
`eslint`/`typescript-eslint` config, `vitest`. No new runtime dependency: this
item adds zero packages to `package.json` (`research.md §7,§8` confirm the
SDK and zod versions already installed cover everything this item needs).

**Harness / scaffolding**: this item adds two files to the existing flat
`src/*.ts` + `src/*.test.ts` layout (`triage-role-config.ts`, `triage.ts`,
§1) plus their test files, and extends four existing files with small,
targeted diffs (`ports.ts`, `router.ts`, `schema.ts`, `surface.ts`, §1). No
new build step, no new lint config, no new directory convention — an
extender navigating this codebase after this item finds triage's files in
exactly the place `role-config.ts`/`agent-invoke.ts` already taught them to
look.

**Local-run story**: unchanged from Item 4's own local-run story, because
triage now shares its exact mechanism. `npm test` runs the full suite (tier
1 always; tier 2 mock-gated integration tests when `claude-mock` is
resolvable on `PATH`, same `describe.skipIf` gate every other mock-backed
suite already uses). A project owner developing a triage `role_cfg` (Priya,
`product-design.md` Journey A) iterates against `claude-mock` before
spending a real API call — and triage's read-only tool list means her mock
scripts need zero `write`/`edit` effects, a strictly smaller mock surface
than the worker/gate-maintenance tests already exercise
(`product-design.md`'s stated DX win of choosing a read-only role,
restated here because it is a genuine, measurable reduction in test-script
complexity, not just a security property). `npm run demo:triage-slice-N`
(new script, matching the existing `demo:agent-invocation-slice-N` naming)
runs the demo named in §10, printing the assembled prompt and resulting
verdict to the terminal.

**A "configuring triage" guide chapter** (SHOULD, matching the review-log
and `product-design.md`'s SHOULD tier): one more chapter in
`docs/configuring-a-role.md`, following the existing "Worker" / "Gate-
maintenance" chapters' exact shape — the reference `triageRoleConfig`, the
four-field table, and a note that triage's `allowedTools` is fixed
read-only by convention rather than a knob most extenders should turn (unlike
the worker's tool list, which a project owner is expected to narrow or
widen for their own domain).

**Deploy target**: unchanged — this remains an npm-installable TypeScript
library with no server, container, or hosted component. Triage's agent
invocation runs in the same process, on the same machine, as every other
role's — no new deployment surface, no new operational dependency beyond
`claude-mock` for local development (already required by Item 4, not newly
introduced here).
