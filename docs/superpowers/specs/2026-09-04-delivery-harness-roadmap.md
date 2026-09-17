# Delivery Harness — Roadmap

> **Type:** new-project
> **Created:** 2026-09-04

## Context

The delivery harness is a deterministically gated system that drives agents to
complete tasks, holding the line that a deterministic gate must pass before
work is accepted. Four design documents exist covering the single-surface state
machine, multi-surface supervisor, provisioning, and agent interface. No
implementation code exists yet.

This roadmap orders the capabilities that take the harness from design
documents to a usable open-source tool. Some items are ready to build from
existing designs; others need a design spec first (marked `brief`). The order
prioritises a working single-surface loop as early as possible, then layers
concurrency and operational concerns on top.

Success at the roadmap level: a user can point the harness at a repo with a
gate definition, hand it a queue of tasks, and get back accepted work or
structured escalation packets, with crash recovery throughout.

### Two audiences

The harness serves two distinct personas, and the roadmap must hold both:

- **Harness extenders** build new gate types, closer types, and custom
  integrations. They are engineers comfortable with code, contracts, and
  schemas. The pluggable interfaces (Items 2, 4, 6) are their surface.
- **Project owners** use the harness to deliver work on their projects. Many
  will be non-technical users leveraging AI agents to build something without
  an engineering team. They should not need to write code to set up a project,
  define tasks, or understand what happened during a run.

This distinction is not about dumbing down the tool. It is about recognising
that the value of an AI delivery harness is precisely that it lets people who
are not engineers ship verified work. If the setup surface requires engineering
skill, the tool solves a problem only for people who could already solve it
themselves.

The roadmap threads this by ensuring that every user-facing surface (gate
selection, task authoring, agent context, configuration, reporting) has a
declarative, code-free path alongside the extensible, code-first path. Early
items build the contracts and reference implementations; later items (notably
Item 9) compose them into a guided experience that a non-technical project
owner can navigate.

### Developer experience as a cross-cut

This is an open-source project. Trust and adoption depend on DX landing at the
right moments, not as an afterthought. DX concerns (CI, testing, packaging,
documentation, error quality, contributor onboarding) are threaded through the
items below at the point each becomes relevant. They appear as success criteria
and notes, not as a separate layer.

---

## Item 1: Case File Persistence

**Status:** ✅ Complete — 2026-09-04 — spec: `docs/superpowers/specs/2026-09-04-case-file-persistence-design.md`

**Delivers:** A serialisable, crash-recoverable state container that every
other component reads and writes, enabling resume from disk alone.

**Success criteria:**
- A case file can be created, appended to, and read back from disk
- The log tail determines the correct resume action after a simulated crash
- The immutable header cannot be mutated after creation
- Budget counters increment and enforce caps
- CI pipeline runs tests on every push and PR (established here, inherited by
  every subsequent item)
- A CONTRIBUTING guide covers: how to clone, run tests, and submit a PR

**Dependencies:** None

**Detail level:** ready-to-spec

**Notes:** The case file schema is fully specified in the single-surface doc.
This is the foundation: every other item writes to or reads from this
structure. Implementing it first means every subsequent item has real
persistence from day one, and crash recovery can be tested against the actual
serialised format rather than mocked.

**DX:** This item establishes the project's test runner, CI pipeline, and
contributor onboarding. Every subsequent item lands into a repo where CI is
already green and a new contributor knows how to run the suite. Getting this
right at the foundation is cheaper than retrofitting it later.

---

## Item 2: Gate Interface

**Status:** ✅ Complete — 2026-09-07 — spec: `docs/superpowers/specs/2026-09-04-gate-interface-design.md`

**Delivers:** A pluggable gate that captures a baseline fingerprint before
dispatch and checks world state after, with the harness computing the
regression delta.

**Success criteria:**
- A gate implementation can be registered and invoked by the harness
- Baseline fingerprint is captured and persisted immutably
- The delta rule correctly identifies new failures (passed at baseline, failing
  at check)
- The ABSENT exploit is closed: a vanished assertion counts as a new failure
- Gate errors are distinguished from gate failures

**Dependencies:** Case file persistence (baseline and gate reports are
serialised into the case file)

**Detail level:** ready-to-spec

**Notes:** The gate interface is fully specified. A reference gate
implementation (e.g. wrapping a test runner) would make the harness immediately
usable for the most common case.

**DX:** Ships with a "writing a gate" guide: the contract, a minimal example,
and what baseline/check must guarantee. The reference gate implementation
doubles as the example. Without this, adopters hit the pluggable interface and
have to reverse-engineer the contract from source. The gate is the first of
several authoring surfaces that Item 9 (Project Configuration) will unify into
a coherent onboarding experience; the guide written here becomes a chapter in
that larger surface.

**Accessibility:** The reference gate is not just an example for extenders; it
is the gate most non-technical project owners will use. It must be usable
through configuration alone (e.g. "run this test command and treat the exit
code as pass/fail"), not only through code. The spec should consider what a
small library of built-in, configurable gates covers: test-runner, file-exists,
command-succeeds, schema-validates. A project owner who can describe their
acceptance criteria in plain terms should be able to select and configure a gate
without writing an implementation.

---

## Item 3: Single-Surface State Machine

**Status:** ✅ Complete — 2026-09-09 — spec: `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Delivers:** The core delivery loop: provision a worktree, dispatch an agent,
gate the result, and route to a terminal state, with deterministic budget
enforcement and crash recovery.

**Success criteria:**
- A task progresses through PROVISIONING → PRE_GATING → AGENT_ACTIVE → GATING
  → CLOSING → CLOSED on the happy path
- Gate failure routes back through TRIAGE to AGENT_ACTIVE with a correction
  slot burned
- INCOMPLETE_TERMINUS retries on budget, escalates at cap
- A crash at any point resumes correctly from the case file log tail
- All five budget populations (correction, gate_error, gate_maintenance,
  terminus, close) enforce their caps independently

**Dependencies:**
- Case file persistence (state transitions are case file appends)
- Gate interface (gating requires a pluggable gate)

**Detail level:** ready-to-spec

**Notes:** This is the largest single item but it is well-specified. The agent
interface (Item 4) and triage (Item 5) are conceptually part of this loop but
are separated because they each have enough surface area for their own spec.
The state machine can be built with stub agent/triage implementations initially.

**DX:** Error messages from the state machine are the user's primary debugging
surface. Every illegal transition, budget exhaustion, and crash recovery should
produce a message that names the state, the attempted edge, and what went
wrong, not a stack trace. This is where adopters will spend their time when
things go sideways; investing in error quality here pays for every subsequent
item.

---

## Item 4: Agent Invocation Primitive

**Status:** ✅ Complete — 2026-09-10 — spec: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`

**Delivers:** The single seam through which the harness drives all agent
roles (worker, triage, gate-maintenance), with prompt assembly from case file
state, structured output validation, and tool authority enforcement.

**Success criteria:**
- One invocation primitive handles all three roles via configuration, not
  branching
- Prompts are assembled deterministically from serialised case file state (same
  case file produces byte-identical prompt)
- The envelope (status + rationale) is validated; any invalid or missing output
  produces INCOMPLETE_TERMINUS
- A worker cannot emit triage-only statuses and vice versa
- Tool authority is enforced at the SDK seam, not requested in prose

**Dependencies:**
- Case file persistence (prompt assembly reads from the case file)
- The agent invocation primitive can be built against the Claude SDK

**Detail level:** ready-to-spec

**Notes:** The agent interface doc specifies the mechanism fully. Open items
(ctx shape, schema definition mechanism) are implementation detail that can be
resolved during the spec without blocking.

**DX:** The domain system-prompt fragment and task_def are project-owner
authored content that reaches agents through this primitive. The spec should
document what the project owner controls (domain context, task intent) versus
what the harness owns (envelope instruction, template order), so Item 9
(Project Configuration) can build an authoring surface on a stable contract.

---

## Item 5: Triage and Deterministic Router

**Status:** ✅ Complete — 2026-09-11 — spec: `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`

**Delivers:** The routing layer that compresses accumulated failure history
into focused artefacts (sharpened briefs for agents, escalation packets for
humans), with a fast deterministic path for common cases and an agent path for
genuine decisions.

**Success criteria:**
- Simple gate failures with remaining budget route back to the worker without
  an agent call
- Worker exhaustion-class escalations can be overruled downward to a reroute
- Worker authority-class escalations pass through unconditionally
- The sharpened brief carries verbatim gate evidence alongside triage's
  synthesis
- Prior triage rationales are available to subsequent triage rounds
- Close-failure triage offers only retry_close or escalate (no reroute)

**Dependencies:**
- Single-surface state machine (triage is a node in the machine)
- Agent invocation primitive (triage agent uses the same primitive)

**Detail level:** ready-to-spec

---

## Item 6: Close Interface

**Status:** ✅ Complete — 2026-09-13 — spec: `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Delivers:** A pluggable close action that runs after acceptance, separating
the "work is correct" decision from the "do something with it" action (merge,
open PR, cleanup, teardown).

**Success criteria:**
- A close implementation can be registered and invoked by the harness
- Close failure routes to close-triage, not back to the worker
- Close is idempotent under replay (crash between accept and close re-runs
  close safely)
- Non-accept terminals (ESCALATED, ABORTED) can invoke the closer for teardown
  as fire-and-log

**Dependencies:**
- Single-surface state machine (closing is a node in the machine)

**Detail level:** ready-to-spec

**Notes:** A reference closer (merge-back or open-PR) would make the harness
useful out of the box.

**DX:** Ships with a "writing a closer" guide, mirroring the gate guide from
Item 2. The reference closer is the example. Together, Items 2 and 6 give
adopters the two plug points they must understand to use the harness; both need
documented contracts and working examples. Like the gate guide, this becomes a
chapter in Item 9's (Project Configuration) unified onboarding surface.

**Accessibility:** As with gates, the built-in closers (merge-back, open-PR,
commit-to-branch) must be selectable by configuration, not only by writing
code. A non-technical project owner should be able to say "when work is
accepted, open a pull request" without implementing the closer interface.

---

## Item 7: Agent Mock

**Status:** ✅ Complete — 2026-09-14 — spec: `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Delivers:** A testing seam that replaces the real agent SDK with scripted
expectations, enabling deterministic end-to-end tests of the entire harness
without live API calls.

**Success criteria:**
- The mock sits at the same seam as the real SDK invocation
- Scripted expectations define structured output, worktree effects, and
  envelope responses
- An unmatched or malformed mock reply exercises the INCOMPLETE_TERMINUS path
- A journal records what prompts the harness sent and which expectations were
  consumed
- Adopters can write their own mock expectations for their gate/closer
  combinations without reading harness internals

**Dependencies:**
- Agent invocation primitive (the mock fakes this seam)

**Detail level:** brief

**Notes:** The agent interface doc references claude-mock and describes the
correspondence. The mock's own design (expectation format, journal shape,
effect application) needs its own spec.

**DX:** This is the harness's testing story for adopters, not just for the
harness's own tests. An adopter who writes a custom gate and closer needs to
test their integration without burning API calls. The mock must be a
first-class public API with its own documentation, not an internal testing
detail. The spec should include an adopter-facing testing guide: "how to test
your delivery pipeline".

---

## Item 8: CLI and Configuration

**Status:** ✅ Complete — 2026-09-17 — spec: `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Delivers:** A command-line interface for configuring and launching harness
runs: pointing at a repo, registering a gate and closer, supplying a task
queue, and setting budget caps.

**Success criteria:**
- A user can start a single-surface run from the command line with a gate, a
  closer, and a task
- Configuration can be supplied via file or flags
- Run progress is reported to the terminal
- A crashed run can be resumed from the command line
- The harness can be installed from a package registry in one command
- A getting-started guide takes a new user from install to a completed run
  against a sample project
- Versioning follows semver; a changelog is maintained

**Dependencies:**
- Single-surface state machine (the CLI drives the machine)
- Gate interface (the CLI registers a gate)
- Close interface (the CLI registers a closer)

**Detail level:** brief

**Notes:** This is the first item that requires design work beyond the existing
docs. The existing specs describe the internal machinery; they say nothing
about how a user configures and launches it. The scope should be minimal: just
enough to make the harness invocable.

**DX:** This is the adoption gate. Everything before this item is usable only
as a library; this item makes it a tool. The spec must cover: packaging and
distribution (how users install it), a sample project (the "hello world" that
proves it works end to end), and a release process (semver, changelog, tagged
releases). The getting-started guide is the single most important document for
adoption; it should be tested by running its own instructions from scratch.

**Accessibility:** The CLI is the first thing a non-technical user touches.
Sensible defaults matter more here than configurability: a user who runs the
tool with a repo and a task description, and nothing else, should get a working
run with a built-in gate and closer, not an error about missing configuration.
The spec should consider an interactive setup mode (`init`) that walks a
project owner through choosing a gate, a closer, and writing their first task
definition via prompts rather than flags. Error messages must assume the reader
does not know what a "worktree" or "structured output envelope" is.

---

## Item 9: Project Configuration

**Delivers:** The management surface through which a project owner onboards
their project to the harness: defining what the gate checks, how close actions
work, what tasks look like, and what context each agent role receives.

**Success criteria:**
- A project owner can define a gate, a closer, and a task queue for their
  project without reading harness source code
- The domain system-prompt fragment (role identity, domain context, domain
  tools) can be authored and previewed before a run
- Task definitions can be authored with the context each agent role needs,
  and validated before dispatch
- A project configuration can be checked into the repo and versioned alongside
  the code it governs
- A validation command checks the configuration for completeness and
  consistency before a run starts (missing gate, malformed task defs, schema
  mismatches)
- An example project demonstrates a complete configuration end to end
- A non-technical project owner can set up a project using only declarative
  configuration and built-in components, without writing any code
- Task definitions can be written in natural language; the harness structures
  them into what each agent role needs

**Dependencies:**
- Gate interface (the configuration surface must express gate definitions)
- Close interface (the configuration surface must express closer definitions)
- Agent invocation primitive (the configuration surface must express the domain
  system-prompt fragment and task context that reach each agent role)
- CLI and configuration (the project configuration is loaded and driven by the
  CLI)

**Detail level:** brief

**Notes:** The existing design docs specify what the harness consumes (gate
contract, closer contract, task_def, domain system-prompt fragment) but say
nothing about how a project owner authors and manages those artefacts. This
item bridges the gap between "the harness can be invoked" (Item 8) and "a
project owner can set up and maintain their project's use of the harness"
without reading internals.

The scope includes: the configuration file format and structure, how gates and
closers are registered and discovered, how task definitions and agent context
are authored, and how the whole thing is validated. It does not include the
harness's own internal configuration (budget caps, concurrency limits), which
is Item 8's concern.

The individual authoring guides from Items 2, 4, and 6 (writing a gate,
writing a closer, assembling agent context) become chapters in this item's
unified onboarding documentation. Those guides are written when their contracts
land; this item stitches them into a coherent project setup experience.

**Accessibility:** This is the item where the two-audience split matters most.
The configuration surface must work at two altitudes:

- **Declarative altitude** (non-technical project owners): select from built-in
  gates and closers by name, write task intent in natural language, describe the
  project's domain in prose. The harness assembles the system-prompt fragment,
  structures the task_def, and selects appropriate tool authority from what the
  project owner describes. No code, no schemas, no knowledge of the harness's
  internal model. Configuration reads like a project brief, not a config file.
- **Programmatic altitude** (extenders): register custom gate/closer
  implementations, author system-prompt fragments directly, define payload
  schemas for structured output. Full control over every contract.

Both altitudes produce the same internal artefacts. The declarative path is a
higher-level interface to the same contracts, not a separate system. This means
the declarative path must be designed alongside the contracts (Items 2, 4, 6),
not bolted on afterwards; if a contract cannot be expressed declaratively, the
contract is too complex for the non-technical path and the spec must decide
whether to simplify the contract or accept that specific capability as
extender-only.

The spec should also consider whether the harness itself can assist with
project setup: an agent-driven onboarding flow where the project owner
describes what they want to build and the harness proposes a configuration
(gate selection, closer selection, task breakdown) that the owner reviews and
approves. This inverts the setup from "fill in this config" to "tell me what
you want and I'll propose how to verify it".

---

## Item 10: Multi-Surface Supervisor

**Delivers:** A supervisor that runs N surfaces concurrently against one
target, with a shared task queue, worktree pool, breaker-based shared-fate
handling, and run-level budgets.

**Success criteria:**
- Multiple tasks run concurrently, each in its own worktree
- A freed slot automatically provisions the next queued task
- Ref-mutating git operations are serialised under a single repo lock
- A shared-environment failure trips the breaker and stops the world for one
  exclusive repair
- Run-level gate_maintenance budget governs all surfaces collectively
- A supervisor crash resumes from the run file

**Dependencies:**
- Single-surface state machine (each surface is an instance of the single-
  surface machine)
- Case file persistence (the run file reuses the same persistence model)

**Detail level:** ready-to-spec

**Notes:** The multi-surface doc is a plan, not a finished design. Open items
(host resource governor, merge serialisation detail, breaker signal tuning)
need resolution during the spec. The stop-the-world repair window is a
deliberate simplification.

**DX:** Concurrency introduces failure modes that are hard to reproduce and
debug. The spec should cover: how a user diagnoses a breaker trip (what
happened, which surface triggered it, what the repair attempted), and how
the run file's state is inspectable post-mortem. The multi-surface case also
needs its own section in the testing guide: how to mock N surfaces with
scripted interleavings.

---

## Item 11: Observability and Reporting

**Delivers:** Structured visibility into what the harness is doing: run
progress, surface states, budget consumption, triage decisions, and terminal
outcomes, available both during and after a run.

**Success criteria:**
- A user can see the current state of every active surface during a run
- Budget consumption is visible per-surface and per-run
- Triage decisions and their rationales are inspectable
- Terminal outcomes (closed, escalated, aborted) are summarised with reasons
- Escalation packets are accessible for human review

**Dependencies:**
- Multi-surface supervisor (observability spans the full run)
- Case file persistence (all observable state is already serialised)

**Detail level:** brief

**Notes:** The case file already serialises everything needed. This item is
about surfacing that data to a user in a useful form, not about capturing it.
The design should decide what the reporting surface is (structured log, live
TUI, post-run report, or all three).

**DX:** This is where the harness becomes trustworthy at scale. An adopter
running 20 tasks overnight needs to come back to a clear summary: what
succeeded, what escalated, why, and what to do about the escalations. The
escalation packet is the handoff to a human; its quality determines whether the
human trusts the harness or stops using it. The spec should also consider
structured output (JSON/machine-readable) alongside human-readable reporting,
so adopters can build their own dashboards or integrate with existing
observability tooling.

**Accessibility:** For a non-technical project owner, the reporting surface may
be the only window into what the harness did. The language must match: "3 of 5
tasks completed and merged; 1 needs your decision (the agent wasn't sure
whether to delete the old homepage); 1 failed after 3 attempts (the tests
still don't pass)." Not "2 surfaces reached ESCALATED, 1 with authority-class
terminus, correction budget exhausted on surface 4." The escalation packet in
particular must present the decision the owner needs to make, not the internal
state that led to it. The spec should consider whether reporting for
non-technical owners is a different view of the same data, or whether the
escalation packet itself needs a plain-language summary generated at triage
time.

---

## Item 12: Pre-Built Task Packs

**Delivers:** Ready-to-use task packs for common scenarios that a project owner
can point at their codebase and run immediately, demonstrating the harness's
value without any custom configuration.

Each pack follows a two-phase pattern:

1. **Scan:** an agent reviews the codebase against a specific lens, producing a
   structured list of findings, each with enough context to be actionable
   independently.
2. **Fix:** each finding becomes a gated delivery task. The gate verifies that
   the specific finding is resolved and that nothing else has regressed. The
   findings fan out across surfaces, so with multi-surface the fixes run
   concurrently.

The scan is discovery; the fix is where the harness's gated delivery earns its
keep. A finding that an agent "fixes" by deleting the test or introducing a new
bug is caught by the gate, not waved through.

**Success criteria:**
- A project owner can run a code review pack against their repo with no
  configuration beyond pointing at the codebase
- The code review scan produces a structured findings list: each finding
  identifies the location, the problem, and why it matters
- Each code review finding becomes a fix task with a gate that verifies the
  specific issue is resolved
- A project owner can run a security review pack with the same ease
- The security review scan produces findings categorised by severity, with
  enough context for a non-technical owner to understand the risk
- Each security finding becomes a fix task with a gate that verifies the
  vulnerability is closed
- Findings that the scan identifies but the fix agent cannot resolve (needs a
  human decision, architectural change, or external action) are escalated with
  a clear explanation, not silently skipped
- A project owner can review the scan output before authorising the fix phase

**Dependencies:**
- Project configuration (packs are pre-built configurations using the
  declarative surface)
- Gate interface (each pack ships with a gate suited to its domain)
- Close interface (each pack ships with a closer suited to its workflow)
- Multi-surface supervisor is not a hard dependency (packs work single-surface,
  sequentially) but is where the fan-out pattern becomes practical

**Detail level:** brief

**Notes:** The two initial packs:

**Code review pack.** The scan agent reviews for: correctness issues, dead
code, missing error handling, inconsistent patterns, and documented technical
debt. Each finding carries the file, location, a description of the problem,
and a description of what "fixed" looks like. The fix gate runs the project's
existing test suite (or a built-in static analysis gate if no tests exist) plus
a targeted check that the specific finding's location has changed.

**Security review pack.** The scan agent reviews for: dependency
vulnerabilities, injection surfaces, authentication/authorisation gaps, secret
exposure, and insecure defaults. Findings are categorised by severity
(critical, high, medium, low). The fix gate verifies the vulnerability is
closed; for dependency updates, this may be as simple as "the vulnerable
version is no longer in the lockfile." Security findings above a configurable
severity threshold default to authority-class escalation (needs human sign-off
before the fix is merged), because a security fix an owner doesn't understand
is a liability, not a feature.

The pack pattern is extensible: the two shipped packs establish the scan→fix
convention, and the project configuration surface (Item 9) lets adopters and
the community author new packs for their own domains (accessibility review,
performance audit, API contract compliance, documentation coverage). The spec
should define what a pack is (a bundle of: scan agent config, finding schema,
fix task template, gate, closer) so the format is stable for community
contributions.

**Accessibility:** These packs are the strongest answer to "what can this tool
do for me right now?" A non-technical project owner who installs the harness
and runs `delivery-service review my-repo` should get a useful result within
minutes. The scan output must be readable by someone who is not an engineer:
"This function doesn't check whether the user is logged in before showing
their data" not "Missing auth middleware on GET /api/users/:id". The fix
phase's progress and outcomes feed through the reporting surface (Item 11)
using the same plain-language approach.

---

## Item 13: Local Scheduling

**Delivers:** The ability to schedule harness runs to happen at a recurring
frequency or at a specific future time, using the machine the harness runs on
as the scheduler.

**Success criteria:**
- A project owner can schedule a recurring run (e.g. "security review every
  Sunday at 02:00") via the CLI or project configuration
- A project owner can schedule a one-off future run (e.g. "run this task
  tomorrow at 09:00")
- A missed run (machine was off, harness was not running) is detected and
  either executed on next start or reported as missed, depending on
  configuration
- Scheduled runs produce the same reporting output as manual runs (Item 11)
- The schedule is inspectable: a project owner can list, edit, and remove
  scheduled runs

**Dependencies:**
- CLI and configuration (scheduling is configured and managed through the CLI)
- Observability and reporting (scheduled runs that happen unattended need
  clear reporting on what happened)

**Detail level:** brief

**Notes:** This is the foundation layer of scheduling: cron-style, local to
the machine, no hosted infrastructure. The mechanism may be as simple as
generating a system cron entry or launchd plist, or a lightweight built-in
scheduler that runs as a daemon. The spec should decide which, but the bias
should be toward the simplest thing that handles missed-run detection.

This is where the task packs (Item 12) become a maintenance practice rather
than a one-off: "run a security review weekly" is the most obvious use, and
it should be expressible in one command.

**Accessibility:** A non-technical project owner should be able to set up a
recurring run without understanding cron syntax. "Every Sunday" or "daily at
midnight" as plain inputs, not `0 2 * * 0`.

---

## Item 14: Managed Scheduling and Event Triggers

**Delivers:** A scheduling and triggering surface that can start harness runs
in response to events (a PR is opened, dependencies change, a deploy
completes) as well as managed time-based schedules with persistence, retry,
and a management surface.

**Success criteria:**
- A project owner can configure a run to trigger on a repository event (PR
  opened, push to a branch, dependency file changed)
- A project owner can configure a run to trigger on an external event via
  webhook
- Event-triggered and time-scheduled runs coexist: "run a code review on
  every PR, and a full security review weekly"
- Trigger configuration is declarative and lives in the project configuration
  (Item 9)
- Trigger history is inspectable: what triggered, when, what run it produced,
  what the outcome was
- Triggers can be filtered: "only on PRs that touch src/auth/**", "only when
  package.json changes"
- A trigger that fires while a previous run is still active either queues or
  skips, configurably

**Dependencies:**
- Local scheduling (the time-based foundation this builds on)
- Project configuration (triggers are expressed in the declarative
  configuration surface)
- Observability and reporting (triggered runs need clear provenance: what
  caused this run)

**Detail level:** brief

**Notes:** This item lifts scheduling from "a clock on your machine" to "a
reactive system that responds to your development workflow." The two trigger
families are:

**Repository events.** PR opened, push, branch created, dependency file
changed, CI status changed. These are the natural triggers for the task packs:
a code review pack triggered on every PR is the most immediately useful
integration. The mechanism depends on where the harness runs: a GitHub
App/webhook listener, a git hook, or polling. The spec should evaluate each
and may support more than one.

**External events.** Webhooks from arbitrary sources: a deploy pipeline, a
monitoring alert, a manual trigger from a chat bot. These extend the harness
beyond code-centric workflows into operational ones (a deploy completes →
run a smoke test pack; a monitoring alert fires → run a diagnostic pack).

The managed scheduling aspect upgrades local scheduling (Item 13) with:
persistence (schedules survive machine restarts without relying on system
cron), retry (a failed scheduled run is retried, not silently lost), and a
management surface (view all schedules and triggers, their history, and their
outcomes in one place).

**Accessibility:** Event triggers are where the harness becomes invisible
infrastructure: "every time someone proposes a change, the harness reviews it
and fixes what it can." A non-technical project owner should be able to set
this up in the same declarative configuration as everything else: "on every
pull request, run the code review pack." The complexity of webhooks, event
filtering, and deduplication should be hidden behind that declaration.

---

## Deferred

_None yet._
