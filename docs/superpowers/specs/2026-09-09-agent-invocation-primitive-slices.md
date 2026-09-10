# Agent Invocation Primitive — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`
> **Status:** ✅ Complete — 2026-09-10 — all 3 slices delivered
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface — a CLI (Item 8) and
project-level configuration authoring (Item 9) arrive later. Per the roadmap's
two-audience split, the primary user for this item is a **harness extender**: an
engineer wiring `role_cfg` for their project. UAT below is written for that audience:
each slice ships a runnable demo script (against `claude-mock`, no live API call) whose
printed output a reviewer reads to confirm the behaviour — matching the pattern already
established for Items 2, 3, and 6.

---

## Slice 1: Wire a Worker to a Real Invocation and Get Back a Typed Result

**Status:** ✅ Complete — 2026-09-09 — `bde4e8d`
**Tests:** ✅ Recorded — 2026-09-09 — `916c8ad` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** A harness extender can hand a worker `role_cfg` and a run context to the
real invocation primitive and watch it spawn an actual agent session, validate whatever
the agent emitted, and hand back exactly one typed result — whether the agent finished
cleanly, escalated, or never produced a usable answer at all.

**Operational note:** this slice's local-run story depends on `claude-mock` (a sibling
project, not vendored into this repo) being resolvable on the extender's machine; the
demo and its guide must say so plainly rather than assume the mock is present, and must
not claim tool-authority enforcement is verified by this slice's own tests (that
guarantee rests on the real SDK, not the mock — see Slice 2).

**Build note:** schema definition for the agent's expected reply reuses the schema
library already used elsewhere in this codebase (no second schema language, no new
dependency) — this is a reuse decision the plan must honour, not a hand-rolled validator.

### Prerequisites

- None (this is the first slice of this item; it does not depend on triage or
  gate-maintenance, which are separate roles handled in later slices/items)

### Acceptance Criteria

- [ ] Given a worker `role_cfg` (system-prompt fragment, expected-reply shape,
      permitted-tools list) and a run context pointing at an existing case file, invoking
      the primitive against a scripted agent session that replies cleanly returns a
      single "completed" result carrying the agent's explanation
- [ ] A scripted agent session that reports it cannot proceed, and is confident that's a
      genuine limit rather than something worth retrying, returns a single "escalate"
      result naming the category
- [ ] A scripted agent session that crashes, is cut off, or replies with something that
      doesn't match the expected shape all return the same single "did not complete"
      result — the extender sees one consistent outcome regardless of which of those three
      things actually happened, plus a plain-English reason distinguishing which one it
      was
- [ ] The "did not complete" result never exposes a raw system error or technical stack
      trace — it names the run's state and what happened in plain terms
- [ ] Running the same scenario twice, from the same starting case file, produces the
      exact same request sent to the agent both times

### UAT

**What you can now do:** Watch a worker role go from a written configuration to a real,
validated agent turn and a single typed result — the first concrete instance of "one
seam drives every agent role" actually working.

**How to try it:**
1. Run the included worker-invocation demo script.
2. The script provisions a fresh case file, supplies the worker's reference
   configuration, and runs the primitive three times against a scripted mock agent: once
   where the agent finishes cleanly, once where it escalates, and once where it replies
   with something that doesn't match what was expected.
3. Read the printed result for each of the three runs.

**What you should see:** The first run prints a clean "completed" result with the
agent's note. The second prints an "escalate" result naming the category. The third
prints a "did not complete" result with a plain-English reason — no raw error dump.

**Why this matters:** Every later item that dispatches a worker depends on this seam
producing one reliable, typed answer instead of a wall of unparsed agent output — this is
the point where the harness stops simulating a worker and starts actually running one.

---

## Slice 2: A Role Cannot Act Outside What It Was Given Permission to Touch

**Status:** ✅ Complete — 2026-09-10 — `c155a01`
**Tests:** ✅ Recorded — 2026-09-10 — `677aadd` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** A harness extender can watch a role attempt something outside its
permitted-tools list and see the harness refuse the attempt — with a message that says
which role, which action, and that this was refused on purpose, not a malfunction.

**Operational note:** this slice's automated test coverage cannot fully verify the
refusal through `claude-mock` (the mock does not model tool permissions), so this
slice's demo and guide must say plainly that the enforcement guarantee rests on the real
agent runtime, and that only a smoke-level check is possible without it — this is a
known, documented gap, not a silent hole.

**Build note — the enforcement point is `canUseTool`, and only `canUseTool`.** The SDK
offers two ways to bound a session's tools, and they are alternatives, not layers:
`tools` removes a name from the session's base set so the model never sees it, and
`canUseTool` is consulted before each tool execution and can allow or deny. Narrowing
`tools` to the role's list makes the attempt in this slice's own title *impossible* — the
model never issues the call, so nothing is ever refused and nothing can be reported. This
slice's whole point is the observable refusal, so authority is enforced at `canUseTool`:
it allows exactly `role_cfg.allowedTools`, denies everything else with the plain-English
message, and records the attempt itself. Three consequences the build must honour:

- **`tools` is not narrowed to the role's list.** Narrowing it silences the guard.
- **`allowedTools` is not set to the role's list.** A bare `allowedTools` entry
  auto-approves the tool *before* `canUseTool` is consulted — the SDK warns about exactly
  this at runtime — so setting both to the same list makes the guard dead code.
  `canUseTool` is itself the programmatic prompt surface, so an unattended run still
  never stalls, which was `allowedTools`' only job here.
- **The guard must be the only decision point, closed by construction.** Pin
  `settingSources: []` and the permission mode, accept no hooks or plugins, and narrow
  the caller's session-options parameter to an allowlist of the executable path and its
  environment. A spread of caller options with permission fields written back over it is
  a deny-list and is forbidden: the next SDK release adds a widening option and nothing
  fails.

`result.permission_denials` is read as a second source, because denials resolved before
the callback never reach it — but it is **classified, never trusted wholesale**. Only a
denial whose `tool_name` is outside `role_cfg.allowedTools` is a role-authority refusal
and earns the message above; an in-role denial is an ordinary "did not complete" and
carries no claim about authority.

### Prerequisites

- A worker `role_cfg` can be handed to the invocation primitive and produce a typed
  result (Slice 1)

### Acceptance Criteria

- [ ] A role's `role_cfg` names the specific set of tools it is permitted to use
- [ ] When a session attempts to use a tool outside that permitted set, the attempt is
      refused before it can take effect — not merely discouraged in the prompt
- [ ] The refusal is reflected back to the harness as a single, consistent kind of
      outcome (the same "did not complete" shape used elsewhere), with a plain-English
      message naming the role, the tool it tried to use, and that this is a permission
      boundary working as intended
- [ ] The refusal message never reads as an unexplained failure — a reader can tell it
      was the harness's security boundary functioning correctly

### UAT

**What you can now do:** Confirm that a role genuinely cannot exceed the authority its
configuration grants it, and see that confirmed with a message that explains itself.

**How to try it:**
1. Run the included tool-authority demo script.
2. The script configures a role with a narrow permitted-tools list, then scripts the
   mock agent to attempt an action outside that list.
3. Read the printed outcome.

**What you should see:** The attempted action is refused, and the printed message names
the role, the attempted action, and states plainly that this was blocked by design.

**Why this matters:** This is the harness's core safety guarantee for every role it will
ever drive — a role's blast radius is enforced by the seam itself, not by hoping the
agent behaves. An extender configuring a new project needs to see this proven before
trusting the harness with real changes.

---

## Slice 3: Configure a Second Role Using the Same Seam, Nothing Rebuilt

**Status:** ✅ Complete — 2026-09-10 — `ce6c20c`
**Tests:** ✅ Recorded — 2026-09-10 — `fd66a9795e1e98ebec9506c5801e7d64478d5742` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** A harness extender can configure the gate-maintenance role — a role with a
narrower job than the worker (repair the environment, never the checks themselves) —
using the exact same invocation seam as Slice 1, changing only what the configuration
says, and see the harness enforce that role's tighter boundary automatically.

### Prerequisites

- A worker role can be invoked and its tool authority enforced (Slices 1–2)
- The case file records a gate/maintenance decision point a role can be dispatched
  against (delivered by the already-complete state machine item)

### Acceptance Criteria

- [ ] The gate-maintenance role can be invoked through the identical seam used for the
      worker in Slice 1 — the extender writes a new configuration, not new code
- [ ] A gate-maintenance session that repairs the environment cleanly returns a
      "completed" result, exactly as the worker's clean-completion case does
- [ ] Gate-maintenance's configuration grants it permission to edit files, but it cannot
      reach the project's actual checks/assertions — only the surrounding environment —
      even though "editing files" is within its permitted tools
- [ ] A reference configuration and a short written guide exist for **both** roles this
      item covers (worker and gate-maintenance), and following the guide alone — without
      reading any source code — is enough to get a first successful invocation for either
      role

### UAT

**What you can now do:** Stand up a second, differently-scoped role (gate-maintenance)
without writing any new invocation code — proving the seam genuinely generalises across
roles, and that an extender can follow a guide alone to configure it.

**How to try it:**
1. Run the included gate-maintenance demo script.
2. The script supplies the gate-maintenance reference configuration and runs a scripted
   session that repairs a broken environment file.
3. Separately, attempt (via the demo's second scenario) to have the gate-maintenance role
   edit a file that represents one of the project's actual checks, and observe it refused
   by the same boundary proven in Slice 2.
4. Read through the written "configuring a role" guide and confirm it covers both roles
   with no source-reading required.

**What you should see:** The environment repair completes cleanly and returns the same
kind of result as a worker's clean completion. The attempt to edit an actual check is
refused. The guide document itself is readable end to end and names both roles.

**Why this matters:** This is the proof that "one primitive, roles are configuration"
holds in practice, not just in the design document — and it closes out this item's
commitment that an extender never has to read source to configure either role it
delivers.

---
