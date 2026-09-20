# Agent Interface

Design notes for the seam between the harness and the agents it drives. The
[single-surface control flow](single-surface-control-flow.md) leans on this seam
everywhere it says "driven via SDK", "structured-output terminus", or "fresh
reconstructed session primed with distilled history", but never pins it down. This
document does: the one invocation primitive, the three roles that instantiate it,
how prompts are assembled, how structured output is shaped and validated, and how
tool authority is enforced.

Scope: the contract for invoking an agent and turning its session into a terminus.
The states that *call* this seam (`AGENT_ACTIVE`, `TRIAGE`, `GATE_MAINTENANCE`) and
the edges they route to are the control-flow doc's; how those states drive an agent
is here. The gate and closer are not agents and are out of scope (see the gate and
close interfaces). This is the seam claude-mock fakes.

## Core concepts

- **Role**: worker, triage, or gate-maintenance. A role is a *configuration* of the
  one primitive, not a distinct interface. The closer and the deterministic router
  are not agents and never enter this seam.
- **Invocation**: one call into the primitive. It spawns a fresh SDK session, feeds
  a harness-assembled prompt, awaits a validated envelope, and returns a terminus.
- **Envelope**: the harness-fixed outer shape every agent must emit — a `status`
  discriminator plus a `rationale`. It is the harness's contract with every agent;
  its absence *is* `INCOMPLETE_TERMINUS`.
- **Payload**: the role-specific body carried inside the envelope. Where the roles
  legitimately diverge.
- **Terminus**: the typed result the primitive hands back to the control flow — a
  validated envelope mapped to an edge, or `INCOMPLETE_TERMINUS`.

## Governing decisions

1. **One primitive, roles are configs.** The three roles differ in *content*
   (schema, prompt, tools) not in *mechanism* (spawn fresh, feed prompt, await
   validated envelope, map to terminus). Forcing them through one primitive is what
   makes the whole thing mockable at a single seam. This mirrors the gate and close
   interfaces: one interface, variable subject.
2. **The envelope is non-negotiable and harness-owned.** No role, and no project,
   may omit or reshape it. This is what keeps `INCOMPLETE_TERMINUS` meaning exactly
   "crash / cap / timeout / no valid output" and never "misconfigured prompt".
3. **The prompt is a pure function of serialised case-file state.** Same case file →
   byte-identical prompt. Follows from the control flow's invariants 2 and 3
   (reconstructed sessions, all state serialised) and the standing preference for
   determinism.
4. **Authority is enforced at the seam, not requested in prose.** A role's tool set
   is pinned config passed to the SDK; a role cannot act outside its authority
   because the seam refuses, not because the prompt asks nicely. Same philosophy as
   pinning the gate out of the worker's reach (invariant 5).

## The invocation primitive

One call, identical mechanism for every role.

```
invoke(role_cfg, ctx) -> Terminus
```

- **`role_cfg`** is pinned configuration for the role: the system-prompt fragment,
  the payload schema, the `allowedTools` set, and the role's budget knobs. It is
  fixed for the run, out of any agent's reach.
- **`ctx`** is the per-invocation handle: the worktree location, the case file to
  assemble the prompt from, and the `session_key` under which the transcript is
  recorded. It is the same kind of handle the gate's `ctx` is.
- **`Terminus`** is the discriminated result (below). The primitive's whole job is
  to turn one agent session into exactly one terminus.

The mechanism is fixed across roles: construct the prompt from `ctx`, spawn a fresh
SDK session with `role_cfg`'s system prompt and `allowedTools`, run it to session
end, validate whatever it emitted against the envelope + role payload schema, and
map the result to a terminus. Nothing about this loop varies by role; only the
config it is handed does.

## Roles as configs

| Role | Blast radius | Payload on the happy path | Notable statuses |
|---|---|---|---|
| **worker** | edits the worktree | completion note | `completed`, `escalate(category)` |
| **triage** | read-only over the case file | `SharpenedBrief` / `EscalationPacket` | `reroute`, `escalate`, `fix_the_gate`, `retry_close`, `abort` |
| **gate-maintenance** | edits environment/harness, never assertions | repair note | `completed`, `escalate` |

Each row is one `role_cfg`. The divergence between them lives entirely in the four
config fields; the primitive does not branch on role.

For the extender's how-to, with both reference configurations, see
[Configuring a role](configuring-a-role.md).

## Prompt assembly

The task reaches the agent through a harness-constructed prompt, never through the
worktree (control flow invariant 5, and the [provisioning](provisioning.md#task-binding)
task-binding rule). The harness owns the assembly end-to-end; the project supplies
only *values*, never the order.

The template per role, every slot read from the case file:

```
[ system-prompt fragment ]     # role identity + domain context (see below)
[ task_def ]                   # original intent, from the immutable header
[ distilled brief ]            # SharpenedBrief on a reroute, raw delta otherwise
[ verbatim gate evidence ]     # the newly-failing assertions, unparaphrased
[ setback ]                    # triage only: trigger, used/max budgets, setback evidence, prior triage rationales
[ envelope instruction ]       # non-negotiable: "emit this envelope, these statuses"
```

- **The project contributes content, not structure.** It supplies the task intent
  and an optional domain system-prompt fragment; it cannot reorder the template or
  drop a slot. This is what keeps the envelope instruction unconditional: if a
  project owned the template, it could tell a worker *not* to emit an envelope, and
  `INCOMPLETE_TERMINUS` would stop meaning "crash".
- **The brief is rendered as labelled fields** (problem, dead ends, scope, references, diagnosis), with the diagnosis labelled as a hypothesis. Worker and gate-maintenance prompts carry no setback slot.
- **The domain system-prompt fragment lives in the immutable header**, alongside
  `task_def` and `gate_ref`. It is pinned run-identity ("this is a Python service,
  these are the domain tools"), immutable, out of the worker's reach, and it
  serialises for free. It does not vary per attempt.
- **Determinism falls out.** The prompt is a pure function of serialised state, so
  the same case file yields a byte-identical prompt. A resumed surface reconstructs
  the same session it would have run before the crash.

## Structured output

A harness-fixed envelope wraps a role-specific payload.

```
Envelope = {
  status:    <role-scoped at the boundary, flat string in storage>,
  rationale: string,          # always present; triage reads prior rationales
  payload?:  <role payload>   # shape governed by role_cfg's schema
}
```

- **The envelope is where the harness's discipline lives.** `status` + `rationale`
  are common to every role; validating them is one code path, not one per role.
- **The payload is where roles diverge.** A triage `reroute` carries a
  `SharpenedBrief`; an `escalate` carries an `EscalationPacket`; a worker
  `completed` carries a short note. Each role's `role_cfg` names the payload schema
  for each of its statuses.

### Status: strict at the boundary, flat in storage

The two properties pull in opposite directions, so we take each where it pays:

- **Strict at the schema boundary.** A role may emit only its own statuses. A worker
  that emits `reroute` produces an *invalid* envelope, which fails validation and
  becomes `INCOMPLETE_TERMINUS` rather than a silent mis-route. This closes a real
  exploit: a confused or adversarial worker cannot route itself.
- **Flat in storage.** The accepted status is persisted as a plain string in the
  case file, so the `status` type stays uniform across roles and the mock's `json`
  envelope is the same shape for every expectation. Terminus mapping reads
  role + status together.

Strictness where it guards an exploit; uniformity where it keeps the plumbing
boring.

### Terminus mapping

The primitive turns one session end into exactly one terminus:

```
valid envelope, legal status   → the typed terminus for (role, status)
no envelope emitted            → INCOMPLETE_TERMINUS
malformed envelope             → INCOMPLETE_TERMINUS
illegal status for the role    → INCOMPLETE_TERMINUS
payload fails its role schema  → INCOMPLETE_TERMINUS
session crashed / cap / idle   → INCOMPLETE_TERMINUS
out-of-role tool attempted     → INCOMPLETE_TERMINUS (authority refusal)
call aimed outside the worktree → INCOMPLETE_TERMINUS (authority refusal)
```

`INCOMPLETE_TERMINUS` is defined negatively and uniformly: *any* end that did not
produce a valid, role-legal, schema-conforming envelope. This is what lets the
control flow treat "the agent never cleanly signalled" as one edge, whether the
cause was a crash or a schema violation.

One end of the list is not uniform in what the edge *does* with it. A session the
runtime refused to start never happened, so no retry of it can land differently;
the primitive marks that terminus `notRun`, and the edge escalates it after one
attempt instead of spending the retry budget. The mark is the fact — no session
ran — and the edge owns the policy; the rationale a person reads is the same
fixed sentence either way.

## Tool authority

Each role's blast radius is a security boundary, not a convention, so it is enforced
at the SDK seam.

- **`allowedTools` is pinned in `role_cfg`** and enforced at the session's
  `canUseTool` callback — the one decision point, consulted before each tool
  execution. Triage gets a read-only set; the worker gets edit + shell;
  gate-maintenance gets edit scoped to the environment. The session's base tool
  set is deliberately *not* narrowed to that list: a role must be able to issue
  an out-of-role call so the seam can refuse it observably and name it in the
  log. The refusal is reported as `INCOMPLETE_TERMINUS` with a sentence naming
  the role, the tool, and that the boundary worked as intended.

- **The runtime is the enforcer, and the mock is not.** `claude-mock` models no
  tool permissions, so no offline test can drive a real out-of-role call
  through it. The harness's own decision path is unit-tested directly; the
  end-to-end guarantee rests on the real agent runtime. Known gap, stated
  rather than papered over.

- **One residual the guard cannot close.** `canUseTool` is consulted only for
  calls the runtime would otherwise prompt about. A tool the runtime
  auto-approves under the pinned permission mode — the read-only family — is
  never put to the guard, so an out-of-role *read-only* call is not refused and
  not reported. Closing it would need a computed deny-list, which this design
  rejected for having nothing to enumerate against. Every mutating tool, which
  is where a role's blast radius actually lives, goes through the guard.

- **No role may act outside its worktree.** Gate-maintenance's "environment, not
  assertions" boundary is finer than a tool list: it needs edit tools but must not
  touch assertion definitions. Those definitions live outside every agent-reachable
  worktree (invariant 5), and the same `canUseTool` guard enforces that location: a
  call whose target path (`file_path`, `notebook_path`, `path`, or the path the runtime
  itself flags as outside its working directory) resolves outside the run's
  worktree is refused, for every role, with a sentence naming the role, the tool,
  the path, and that the boundary worked as intended. The runtime already routes
  such calls to the guard instead of running them; before this rule the guard
  answered "allow" for any permitted tool, so "not present, so not editable" held
  only by luck. Residual: a role granted `Bash` can write wherever its shell can,
  and the runtime does not flag every such command, which is why the reference
  gate-maintenance config does not grant `Bash`.

## Relationship to the mock

This seam is precisely what claude-mock fakes, and the
correspondence is exact:

- **One `invoke`** ↔ the mock's single scripted turn loop.
- **Envelope** ↔ the expectation's `json` field (structured output on the result).
- **Worktree edits** ↔ the expectation's `effects` (`write` / `edit`, applied for
  real inside `cwd`).
- **Terminus mapping** ↔ what the harness does with the mock's reply. A prompt no
  expectation matches, a `reply` with no `json`, a `json` the role's schema rejects, and a
  scripted `fail` each exercise the `INCOMPLETE_TERMINUS` path
  (`src/scripted-surface-run.test.ts` proves each through a whole surface). An unmatched
  prompt and a scripted `fail` both read as a session that ended in an error; only the
  journal's `unmatched` event tells them apart.
- **Verification** ↔ the journal, which records what prompt the harness actually
  sent and which expectations it consumed.

Because the mock sits at the CLI seam the SDK spawns, an SDK shape change surfaces
as a parse failure against the real primitive rather than a passing fiction.

`claude-mock` is **vendored** in `vendor/claude-mock`: the sibling project's source,
unchanged, with its prebuilt `dist/` committed, installed by `npm install`
(`vendor/README.md` records the upstream commit and how to update the copy). Tests and demos
reach it through `mockSessionEnvironment` from `src/testing.ts`, which resolves the installed
copy by absolute path and hands it the script and journal locations, so nothing depends on
`PATH` and no mock-backed suite skips. [Testing your delivery pipeline](testing-your-pipeline.md)
is the adopter's guide to testing a pipeline with it.

## Open items

- **`ctx` shape** — resolved. `AgentContext.dir` is the case-file reference: the primitive
  calls `load(ctx.dir)` itself, `ctx.worktreePath` becomes the session's `cwd`, and
  `ctx.sessionKey` keys the journal and the failure ref a session that produced nothing
  usable leaves behind, and is deliberately kept out of prompt content so a retry
  re-sends a byte-identical request.
- **Worker completion payload** — resolved. `completed` carries `rationale` and nothing else;
  the gate stays the sole judge of the work.
- **Schema definition mechanism** — resolved. Each role's envelope is a zod discriminated union
  in its `role_cfg`, validated harness-side and handed to the SDK's `outputFormat` via
  `z.toJSONSchema()`. One schema language, two enforcement points.
- **Budget knobs in `role_cfg`.** Reserved as `role_cfg.budgets?`, unused until the budget
  design names the fields.
