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

---

## Item 1: Case File Persistence

**Delivers:** A serialisable, crash-recoverable state container that every
other component reads and writes, enabling resume from disk alone.

**Success criteria:**
- A case file can be created, appended to, and read back from disk
- The log tail determines the correct resume action after a simulated crash
- The immutable header cannot be mutated after creation
- Budget counters increment and enforce caps

**Dependencies:** None

**Detail level:** ready-to-spec

**Notes:** The case file schema is fully specified in the single-surface doc.
This is the foundation: every other item writes to or reads from this
structure. Implementing it first means every subsequent item has real
persistence from day one, and crash recovery can be tested against the actual
serialised format rather than mocked.

---

## Item 2: Gate Interface

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

---

## Item 3: Single-Surface State Machine

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

---

## Item 4: Agent Invocation Primitive

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

---

## Item 5: Triage and Deterministic Router

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

---

## Item 7: Agent Mock

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

**Dependencies:**
- Agent invocation primitive (the mock fakes this seam)

**Detail level:** brief

**Notes:** The agent interface doc references claude-mock and describes the
correspondence. The mock's own design (expectation format, journal shape,
effect application) needs its own spec.

---

## Item 8: CLI and Configuration

**Delivers:** A command-line interface for configuring and launching harness
runs: pointing at a repo, registering a gate and closer, supplying a task
queue, and setting budget caps.

**Success criteria:**
- A user can start a single-surface run from the command line with a gate, a
  closer, and a task
- Configuration can be supplied via file or flags
- Run progress is reported to the terminal
- A crashed run can be resumed from the command line

**Dependencies:**
- Single-surface state machine (the CLI drives the machine)
- Gate interface (the CLI registers a gate)
- Close interface (the CLI registers a closer)

**Detail level:** brief

**Notes:** This is the first item that requires design work beyond the existing
docs. The existing specs describe the internal machinery; they say nothing
about how a user configures and launches it. The scope should be minimal: just
enough to make the harness invocable.

---

## Item 9: Multi-Surface Supervisor

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

---

## Item 10: Observability and Reporting

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

---

## Deferred

_None yet._
