# Review Log — Triage and Deterministic Router (Item 5)

## Selected phase (derived)

Recorded by the team-lead (autonomous run `20260910T141630Z`, design-team-auto) before the team was spawned.

**Survey.**
- `docs/superpowers/specs/`: roadmap Items 1–4 are specced and complete (case file persistence, gate interface, single-surface state machine, agent invocation primitive). No `*-design.md` carries `seeded_by`.
- `.autoloop/ideas/`: empty. No operator seed ideas.
- Non-goals backlog: the agent invocation primitive design (Item 4) explicitly defers "triage's agent-backed invocation and the `AgentPort.invoke()` return-type widening its verdict vocabulary needs" to Item 5. The single-surface state machine design (Item 3) ships a deterministic-router-only `TriagePort` and defers `SharpenedBrief`/`EscalationPacket` synthesis and the `gate_error` agent-free re-check verdict to Item 5.

**Selection: roadmap Item 5, Triage and Deterministic Router.** It is the next roadmap item, `ready-to-spec`, and both dependencies (Items 3 and 4) are complete. It is grounded in the established direction (the roadmap and `docs/single-surface-control-flow.md` §Triage specify the mechanism) and non-duplicate (only the deterministic half exists today). Items 6 (Close Interface) is also unblocked; Item 5 is chosen because it is ordered first and because two completed specs name it as the owner of explicitly deferred work.

**User value.** Today a failed attempt re-dispatches the same brief (the router adds no information), and an escalation reaches a human as bare internal state. Item 5 makes retries informed (a sharpened brief carrying verbatim gate evidence plus a hypothesis) and makes escalations actionable (a packet naming the decision the human must make).

**Intended shape.**
- MUST (derived minimum scope, assumed, not human-confirmed): triage agent role via the existing invocation primitive with read-only authority and a triage-only verdict vocabulary; deterministic fast path retained for judgement-free cases; `SharpenedBrief` payload reaching the next worker dispatch with verbatim gate evidence; `EscalationPacket` payload persisted for human review; prior triage rationales fed into later rounds; authority-class pass-through and exhaustion-class overrule-down preserved; close-triage restricted to `retry_close`/`escalate`; a defined, safe outcome for invalid triage output; crash-safe replay of triage.
- SHOULD: reference triage `role_cfg` and a chapter in `docs/configuring-a-role.md`; the agent-free `gate_error` re-check verdict and `gateError` budget use; a runnable demo.
- COULD: plain-language summary in the escalation packet for non-technical owners (feeds Item 11).
- Non-goals: real closers (Item 6), CLI (Item 8), multi-surface/breaker (Item 10), reporting surface (Item 11).

Critic: the phase choice and its MUST/SHOULD/COULD split are within your remit.

Note: the `TaskCreate`/`TaskUpdate` tools are not available in this session; task dependencies (#1 research blocks #2/#3; #4 gate needs both approved; #5 assembly; #6 spec review) are enforced by the briefs and the team-lead, not a task list.

## Critic review — round 1

### Phase choice and MUST/SHOULD/COULD split (review-log, team-lead)

Sound. Item 5 is the correct next item (both dependencies complete, two prior specs
name it as owner of explicitly deferred work), not a pivot, and not duplicating
shipped work. The MUST tier is a real floor, not padded: every MUST item traces to
either Priya's or Marcus's journey, or to a preservation/safety requirement
(authority pass-through, close-triage legality, crash-safe replay) the roadmap or
`agent-interface.md` already demands elsewhere. Dana (COULD-tier, plain-language
layer) is correctly placed — Item 11 owns her full experience; nothing here should
be pulled forward for her.

### product-design.md — round 1: REVISE

Verified factual/technical claims directly against `src/prompt-assembly.ts`,
`src/router.ts`, `src/ports.ts`, `src/role-config.ts`, `docs/agent-interface.md`,
and `docs/single-surface-control-flow.md` — all citations check out.

Confirmed sound: derived-minimum-scope check against the three personas; the
Dana/Marcus escalation-packet accessibility split (honest, not under-serving —
Dana has no primary journey this phase and the document says so plainly rather
than pretending otherwise); the three product positions on research.md's open
questions (evidence non-duplication, structural close-triage restriction,
invalid-output-always-escalates); and treating "a defined, safe outcome for
invalid triage output" as requiring `INCOMPLETE_TERMINUS`-shaped
state+cause+next-action content (a conservative, non-inventive reading, not
scope creep).

**Blocking finding sent to product-designer:** Flow 1 contradicts both the
mechanism doc and the document's own "Fast path with no judgement needed: ...
no artefact beyond the router's existing rationale string" bullet. Per
`single-surface-control-flow.md` §Triage, `SharpenedBrief` is explicitly the
product of "**One agent call**, structured output"; the deterministic path is
described separately as "reroute with the raw delta and appended history. **No
agent call.**" Flow 1's trigger line ("reroute from either the deterministic
router ... or the agent...") and its three brief-population steps treat both
sources as populating the same `SharpenedBrief`/`briefRef`, which would require
the lookup-table router to fabricate `dead_ends`-as-narrative and a `diagnosis`
hypothesis with no judgement — a materially different (and much larger) build
than "fill in an already-reserved empty field," and in tension with keeping the
fast path exactly as cheap as today. Asked the product-designer to resolve
explicitly whether `SharpenedBrief` is an agent-path-only artefact (deterministic
reroutes keep producing only the existing rationale string, `briefRef` staying
null, per `research.md` §3's own hedge "a brief payload") and to bring Flow 1,
the empty-state bullet, and the "dead_ends in the assembled prompt" success
metric into agreement with whichever answer is chosen.

### product-design.md — round 2: APPROVED

Product-designer scoped `SharpenedBrief`/`briefRef` as agent-path-only: a
deterministic-router reroute now explicitly continues to produce only its
existing rationale string (`briefRef` unset, no new cost), and Flow 1, MUST
item 3, and the "dead_ends in the assembled prompt" success metric all say
so consistently. Verified the edit in place
(`docs/prd/2026-09-10-triage-and-router/product-design.md` Flow 1 scoping
note, MUST item 3, success metrics). **APPROVED.**

### architecture.md — round 1: REVISE

Verified extensively against source: `src/agent-invoke.ts`, `src/role-config.ts`,
`src/tool-authority.ts` (`authorityRefusal`/`incomplete()` both only ever
construct an `{status:"incomplete",...}` value, so the generic `invoke<E>()`
widening in §2 type-checks with no unsafe casts once their declared return
types narrow to `Incomplete` — confirms "body unchanged" is actually true, not
just asserted), `src/router.ts`, `src/case-file.ts` (`deriveStateFromEntry`,
`deriveBudgetsFromLog`), `src/surface.ts` (`triage()`, `dispatchGateMaintenance`
— confirmed the `gateMaintenance` cap is independently re-checked at actual
dispatch time, so §7's repurposing of the router's `gate_error` row for the new
`gateError`-budget recheck does not drop the existing safety property, it only
moves where the audit trail records the eventual escalate — not a defect), and
`docs/prd/2026-09-09-agent-invocation-primitive/architecture.md` (ledger/DX
depth comparison — Item 5's §13/§14 are not under-baked relative to the
precedent).

**Blocking finding sent to architect:** §8's dispatch-site code sketch has a
literal placeholder (`/* agent-path, not deterministic */`) where the actual
condition should be. The stated decision — "thread an explicit flag, not a
schema-sniff" — never says what type or field carries that flag across the
`TriagePort` interface boundary (`deterministicRouter` and
`createAgentTriage(agent)` both implement the same fixed-shape
`Promise<TriageVerdict>` contract, and `createAgentTriage` delegates straight
to `deterministicRouter.triage()` for the fast-path/authority cases). This is
a real fork — widening `TriageVerdict` in-memory, having `surface.ts`
re-derive `needsJudgement` a second time, or something else — each produces a
different system shape and the second option duplicates §5's decision outside
`triage.ts`, which the document's own §12 extensibility argument says should
live in exactly one place. Asked the architect to pick one and make §8 (and
§1/§2/§4 if the interface changes) agree.

### architecture.md — round 2: APPROVED

Architect resolved the blocking finding with `TriageVerdict.viaAgent?: boolean`
(`ports.ts` §2) — in-memory only, set by every branch of `toTriageVerdict`
(§6), never copied onto the persisted `TriageEntry`, read once by
`surface.ts`'s `triage()` (§8) to decide whether to thread `briefRef`. A
resumed surface re-derives it fresh by calling `triage()` again rather than
reconstructing it from the log — consistent with crash-safety elsewhere in
this design. Verified the mechanism end to end against the updated §2/§4/§6/§8
text. **APPROVED.**

Noted one trivial, non-blocking inconsistency for the architect to fix in
passing: §6's prose claims `viaAgent: true` is set on "every branch that
reached this function," but the code sketch's `incomplete`-terminus branch
omits it. Zero behavioural effect (that branch always returns `escalate`,
never `reroute`, so `viaAgent` is never consulted there) — not worth another
round.

## Task #4 complete

Both product-design.md and architecture.md are APPROVED. Notifying team-lead.
