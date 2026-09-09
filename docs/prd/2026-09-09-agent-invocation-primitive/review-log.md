# Review Log — Agent Invocation Primitive (Item 4)

Critic: reviewing `product-design.md` and `architecture.md` against
`docs/agent-interface.md`, the roadmap (Item 4), and the single-surface state
machine design. Gate criteria: internal consistency, two-sided scope
discipline, feasibility, product/architecture coherence, the two design
lenses (buy-vs-build, operability/DX). Unverified factual/technical claims are
routed to researcher before approval.

Status: awaiting architecture.md.

## product-design.md — Round 1 — REVISE

Verification performed independently (not just trusting research.md citations):
- `src/ports.ts` matches research.md §3 exactly (Terminus 3-way union, no case-file ref on
  AgentContext).
- `package.json` has `zod@^4.5.4`; confirmed `z.toJSONSchema` is a real function on the zod
  installed in the sibling claude-mock project (v4.4.3).
- `sdk.d.ts` (claude-agent-sdk@0.3.245, sibling claude-mock's node_modules) confirmed:
  `outputFormat`, `allowedTools`, `disallowedTools`, `structured_output`,
  `error_max_structured_output_retries`, `structured_output_retry_exhausted` all present at the
  cited lines.
- `grep -rn "allowedTools" src/*.ts` in claude-mock returns no hits — confirmed the mock does not
  enforce tool authority.
- No `@anthropic-ai/claude-agent-sdk` in this repo's `node_modules` — confirmed not yet a
  dependency here.
All technical claims check out. No routing to researcher needed this round.

**Finding 1 (blocking):** Internal inconsistency between the MUST/SHOULD tiering and Journey A's
own completion claim. Journey A's "End-to-end means" (line 83) and the first Success metric
(line 274) both assert that steps 1–4 — which explicitly include repeating the process for the
triage and gate-maintenance roles (step 4) — complete "without the extender reading
`src/ports.ts`, `agent-interface.md`, or the SDK's `.d.ts` file," using only "the reference
`role_cfg` and its guide." But the MUST tier (item 6) only commits to a reference `role_cfg` for
the worker role, and the guide itself is SHOULD (not MUST). As written, the MUST-only scope does
not actually deliver what the journey and success metric promise for step 4. This is a
two-sided scope problem: the derived minimum scope is not, in fact, sufficient for the persona
journey it's justified against — pick one:
  (a) promote a minimal triage/gate-maintenance reference `role_cfg` and the guide to MUST (this
      would also align with the roadmap's Item 2/6 precedent, where the guide is presented as an
      expected deliverable of the item, not optional), or
  (b) narrow Journey A's "end-to-end" claim and the success metric to the worker role only for
      this phase, and state explicitly that triage/gate-maintenance role_cfgs follow the same
      shape but ship without a worked example until the SHOULD items land.
Either is fine; leaving the mismatch as-is is not.

**On the PM's three questions:**
1. Scope is otherwise appropriately narrow — the exclusions (Item 5 judgement logic, Item 9
   authoring surface, mock changes) are correctly justified and not silently smuggled back in via
   MUST. The one over-reach is indirect: Journey A's own success criteria claim more than the MUST
   tier delivers (Finding 1), not that a SHOULD item was mislabelled.
2. No unsourced technical claims found; everything traces to a research.md citation and every one
   spot-checked against source matched.
3. Flagging (not deciding) the Terminus/triage-verdict shape and allowedTools/disallowedTools is
   correct for a product-design doc — both are type-shape/enforcement-mechanism decisions that
   belong to architecture. The product framing given for each (the commitment "all three roles"
   is conditional on the mismatch being resolved; the refusal message must be identical regardless
   of which SDK mechanism is chosen) is exactly the right altitude — keep both, don't decide them
   here.

No other blocking issues. Buy-vs-build ledger is real (not hand-rolled: zod reuse, SDK-native
structured output, SDK-native tool authority, prior-art conformance to the gate/close shape) and
every claim in it is verified. Operability/DX gaps (mock doesn't verify `allowedTools`, mock can't
exercise budget-cap/timeout paths) are surfaced explicitly, not papered over. No procedure-as-defect
findings — the numbered journeys describe persona usage, not a build sequence.

## architecture.md — Round 1 — REVISE

Verification performed independently against the sibling claude-mock project's installed
`@anthropic-ai/claude-agent-sdk@0.3.245` (the same package research.md cites):
- `src/case-file.ts` confirmed: `dir` is used as the case-file directory throughout (`load`,
  `atomicWriteJson`, `readCaseJson`, etc.) — the "no ctx schema change" decision (§1) is sound.
  `atomicWriteJson` does write `JSON.stringify(data, null, 2)` as claimed (§3).
- `src/schema.ts` confirmed: `GateRef` and `HistoryEntry` both use `z.discriminatedUnion`, so
  the `envelopeSchema` pattern in §1 is genuine reuse of an established local pattern, not a new
  one.
- `src/surface.ts` confirmed: there is exactly one `ports.agent.invoke` call site
  (`dispatchSession`, line ~211), shared by both `"worker"` and `"gate-maintenance"` roles and by
  every dispatch edge the state-machine design specifies. §2's "no change to `src/surface.ts`"
  claim is accurate — the plural "driver call sites" language refers to logical edges sharing one
  physical call site, which is correct given the shared `sessionKey` formula
  (`${role}-${attempt}-${retriesOf(...)}`) matches the state-machine design exactly.

**Finding 1 (blocking, feasibility): §4's tool-authority mechanism does not work as specified, and
misses a better native option already in the SDK.** §4 decides: `role_cfg.allowedTools` stays
authored (positive), and the primitive computes the SDK's `disallowedTools` as "the complement of
`role_cfg.allowedTools` against the SDK's own enumerable built-in tool set." I checked
`sdk.d.ts`/`sdk-tools.d.ts` directly for such an enumeration: there is none. `ToolInputSchemas`
(`sdk-tools.d.ts:11-53`) is a compile-time-only type union (auto-generated from JSON Schema), not
a runtime array of tool-name strings — nothing in the SDK's exports gives the primitive a list to
compute a complement against at runtime. §4 itself hedges on this ("should be pulled from the
installed SDK's own exported types at implementation time... did not enumerate them
exhaustively") but the problem isn't incomplete research — there is nothing to pull. Implementing
§4 as written would force exactly the hand-maintained, SDK-version-drifting tool-name list the
document explicitly says it wants to avoid.

There is a simpler, already-native fix, and it was sitting in the same file section of `sdk.d.ts`
I checked (lines 1469-1481, immediately below `disallowedTools`): a `tools` option — "Specify the
base set of available built-in tools... `string[]` - Array of specific tool names... `[]` -
Disable all built-in tools." Its doc comment is also where `allowedTools`'s own doc comment points
("To restrict which tools are available, use the `tools` option instead" — `sdk.d.ts:1418`,
quoted accurately elsewhere in research.md §5, but its implication for §4 wasn't followed
through). Passing `tools: role_cfg.allowedTools` restricts the *base set* directly — a true
positive allow-list, not a computed deny-list — with zero enumeration problem, because it doesn't
need to know what to exclude. `allowedTools` would still be passed alongside it (same list) purely
for its documented purpose, auto-approving those tools so the unattended harness doesn't stall on
a permission prompt for a tool that is legitimately in scope.

Recommend: replace §4's "authored allow-list, computed deny-list complement" mechanism with
`tools: role_cfg.allowedTools` (restriction) + `allowedTools: role_cfg.allowedTools` (auto-approve
for unattended running). This also changes §9's buy-vs-build ledger: the "Tool authority (allow/
deny)" row currently marked **Build** becomes pure **Buy** (an existing SDK option, no
enumeration, no complement function, no drift risk) — which is a stronger position for this
document to be in, not a weaker one. Re-check whether `disallowedTools` still earns a place as
defence-in-depth once `tools` is doing the real restriction, or whether it becomes redundant.

No other blocking issues found. Everything else checked (ctx/dir reuse, envelopeSchema pattern,
single dispatch call site, sessionKey formula, testing-tier honesty about the mock's
`allowedTools` gap, deferred budget-knob field) is accurate and consistent with both
product-design.md and the state-machine design. Coherence with product-design.md (round 1) holds:
architecture correctly treats the Terminus/triage-verdict mismatch as scoped-not-resolved, matches
product's "message must be identical regardless of mechanism" requirement in spirit (once §4 is
fixed, the refusal is still uniform), and implements exactly the two roles (worker,
gate-maintenance) product's derived minimum scope commits to for this phase.

## product-design.md — Round 2 — REVISE

Finding 1 (from round 1) is fixed cleanly: Journey A, its end-to-end line, MUST 1/6, the SHOULD/
COULD lists, and the first success metric are correctly narrowed to worker + gate-maintenance,
with a reference role_cfg + guide for both promoted to MUST. Consistent with the architect's scope
decision, well-cited, no gaps.

**Finding 2 (blocking): this revision bakes in an architecture decision I have since found to be
infeasible, and specifies SDK mechanism detail a product doc shouldn't own in the first place.**
MUST 4, the Vision section, the Buy-vs-build "Tool authority" bullet, and "Architecture decisions"
item 2 all now assert as settled fact: "the primitive computes the SDK's `disallowedTools` as the
complement against the SDK's built-in tool set." I independently checked the installed SDK's
`sdk.d.ts`/`sdk-tools.d.ts` (same package research.md cites) while reviewing architecture.md: there
is no runtime-enumerable built-in tool set anywhere in the SDK's exports to compute a complement
against — `ToolInputSchemas` is a compile-time-only type union. I've already sent this back to the
architect as a blocking finding (architecture.md round 1), recommending `tools: role_cfg.
allowedTools` (a native SDK option that restricts the base tool set directly, no enumeration
needed) alongside `allowedTools` for auto-approval, dropping the complement computation entirely.

Two things follow:
1. As written, this document will be stale the moment architecture.md's round 2 lands with a
   different mechanism — you'd be back for a round-3 edit on a detail that shouldn't have needed
   to change on your side at all.
2. More fundamentally: which SDK field(s) implement tool-authority enforcement is not a product
   decision, and your round-1 instinct was right — "whichever is chosen, the message to the
   project owner must be the same." Recommend reverting to that altitude: state the requirement
   (tool authority enforced at the SDK seam from `role_cfg.allowedTools`, refusal message uniform
   regardless of mechanism) and drop the specific mechanism name from MUST 4, Vision, and
   Buy-vs-build — point those at "resolved with the architect; see architecture.md" rather than
   restating a mechanism. This also makes the doc robust to the mechanism actually landing on
   `tools` instead of a computed `disallowedTools` complement.

Nothing else needs to change. Fix Finding 2 (a wording/altitude fix, not new research) and
resubmit — this should be quick.

## architecture.md — Round 2 — APPROVED

Finding 1 fixed cleanly and fully propagated: §2's data-flow call now passes both `tools:
roleCfg.allowedTools` and `allowedTools: roleCfg.allowedTools`; §4 states the decision plainly
(one authored field, two SDK options, no enumeration, no complement, `disallowedTools` correctly
dropped as redundant once `tools` restricts the base set) and documents why the earlier approach
was rejected, for the record; §5's "enforced twice, at two layers" framing now names `tools`
instead of the old mechanism; §6's mock-coverage caveat and §9's buy-vs-build row are both updated
(the row correctly moved from Build to Buy). Checked all four grep hits of `tools:`/
`disallowedTools` in the file — no stale references to the old mechanism remain anywhere.

architecture.md is APPROVED. Waiting on product-design.md round 3 (Finding 2, an altitude fix
following from this same correction) before the pair is done.

## product-design.md — Round 3 — APPROVED

Finding 2's altitude fix applied correctly in the four spots the product-designer named (Vision,
MUST 4, Buy-vs-build's Tool authority bullet, "Architecture decisions" item 2, retitled) — none of
them restate a specific SDK mechanism any more; all point to architecture.md and hold only the
product-level requirement (uniform refusal message). Found one leftover fifth instance the sweep
missed — Journey B scenario 2 still named `allowedTools`/`disallowedTools` and cited the now-dead
"disallowedTools strips the tool from context" mechanism. Non-blocking (a stray reference, not a
new defect) — fixed directly in the file rather than sending back for a fourth round: reworded to
"pinned `allowedTools`" and "which SDK option(s) implement it are architecture.md's call, see
MUST 4 above," consistent with the other four spots. Verified no other `disallowedTools` mentions
remain in the file.

product-design.md is APPROVED.

## Outcome

Both product-design.md and architecture.md are APPROVED. Coherence holds between them: both scope
`invoke()` to worker + gate-maintenance only for this phase (triage explicitly Item 5's), both
treat the Terminus/triage-verdict mismatch the same way, and product-design.md correctly declines
to pin the tool-authority SDK mechanism, deferring to architecture.md (which settled on
`tools: role_cfg.allowedTools` + `allowedTools: role_cfg.allowedTools`, no `disallowedTools`, after
the round-1 infeasibility finding). All buy-vs-build and operability/DX claims I spot-checked
against the installed SDK, this repo, and the sibling claude-mock project verified true. No open
blocking findings remain. Notifying "main".
