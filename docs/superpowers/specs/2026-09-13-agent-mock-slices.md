# Agent Mock — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-13-agent-mock-design.md`
> **Status:** ✅ Complete — 2026-09-14 — all 5 slices delivered
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface; a CLI (Item 8) and
reporting (Item 11) arrive later. Following the Items 4–6 precedent, UAT is written for
a harness extender (Priya): each slice ships a runnable demo script or a documented
walkthrough, needing no network and no API key, whose printed output a reviewer reads to
confirm the behaviour.

**Decided without a human (unattended run):** the slice boundaries below were chosen by
the autonomous run, not confirmed by a person. Order follows dependency and value: honest
in-process doubles first (the seed idea, and independent of the mock), then a mock that
is always present, then a whole pipeline proved against it, then proof that the pipeline
survives a misbehaving agent, then the adopter guide that stitches both doubles into one
story.

---

## Slice 1: Write an Agent Stand-in the Compiler Checks

**Status:** ✅ Complete — 2026-09-14 — `b480ebe`
**Tests:** ✅ Recorded — 2026-09-14 — `f6fba69` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** An extender or contributor can stand in for any agent role in a test with a
double whose replies the type checker verifies against that role, with no cast, and every
existing stand-in in the harness is written this way.

**Build note:** the double reuses the role-keyed record shape the production role
configuration already uses; the agent port's own contract does not change. No test-double
library is introduced.

**Operational note:** a new public testing entry point appears beside the existing one,
carrying the same stability promise; nothing else in the source becomes public.

### Prerequisites

- The surface driver accepts an agent port and drives worker, triage and
  gate-maintenance roles through it
- Existing tests and demos stand in for agents with hand-written doubles

### Acceptance Criteria

- [ ] A stand-in is built by supplying a reply only for the roles a test exercises, and
      is accepted wherever the harness expects an agent port, with no cast at the call
      site
- [ ] A stand-in whose worker reply has the shape of a triage reply is rejected by the
      type checker
- [ ] Invoking a role the stand-in has no reply for fails the test with a message naming
      that role and saying the test must supply it
- [ ] Every existing hand-written stand-in in the harness's tests and demos uses the new
      double, with no change in what those tests and demos observe
- [ ] Outside the production agent port and the new double itself, no cast to the agent
      port's invoke signature remains
- [ ] (SHOULD) A check in the normal test or lint run fails if a new such cast is added
      elsewhere

### UAT

**What you can now do:** Stand in for an agent in a test and have the compiler catch a
reply of the wrong shape.

**How to try it:**
1. Run the included honest-double demo script.
2. Read the first part of the output, where a surface is driven to a decision by a
   stand-in worker built from a single reply.
3. Read the next part, where the same demo invokes a role it gave no reply for.
4. Read the closing note, which shows the type error the compiler reports for a stand-in
   that returns a triage-shaped reply as a worker.

**What you should see:** The surface reaches its decision; the missing role fails with a
sentence naming the role; the wrong-shaped reply is shown as a compile error, not a
passing run.

**Why this matters:** A test double that cannot lie about its shape means a test that
passes is evidence, not luck, for every extender and for every later roadmap item's tests.

---

## Slice 2: The Scripted Agent Is There After a Plain Install

**Status:** ✅ Complete — 2026-09-14 — `6730b5e`
**Tests:** ✅ Recorded — 2026-09-14 — `a37e82b` — cli — 1 UAT + 3 AC, 0 skipped
**Delivers:** On a fresh clone, installing dependencies is enough to run every
scripted-agent test and demo; none of them skips or refuses for want of a separately
linked tool.

**Build note:** the scripted agent is the estate's existing claude-mock project, vendored
into the repository unchanged, with its prebuilt output committed so installation needs
no build step. Its script format, matching, effects and journal are not modified, and no
new fake agent is written.

**Operational note:** installation now provides the scripted agent, so the continuous
integration run exercises suites it previously skipped, with no new pipeline step. The
repository owns keeping the vendored copy in step with the sibling project; the licence
position is as stated in the spec's Security section.

### Prerequisites

- The agent invocation primitive can be pointed at an alternative agent executable and
  environment
- Some tests and demos currently skip or refuse when the scripted agent is not linked on
  the machine

### Acceptance Criteria

- [ ] On a fresh clone with nothing linked globally, installing dependencies makes the
      scripted agent available to the harness
- [ ] One helper gives a test or demo a ready session pointed at the scripted agent, with
      its script and journal locations, so no test names the executable or relies on the
      shell's search path
- [ ] Every test and demo that previously skipped or refused without the linked tool now
      uses that helper and runs unconditionally
- [ ] If the scripted agent cannot be found, the helper fails with a sentence naming where
      it looked and that installing dependencies provides it, never a raw spawn error
- [ ] A session driven through the helper makes no network call and needs no API key

### UAT

**What you can now do:** Clone the harness, install, and run the offline agent demos
without any extra setup.

**How to try it:**
1. Make a fresh clone of the repository on a machine where the scripted agent has never
   been linked.
2. Install dependencies.
3. Run the existing worker invocation demo.
4. Run the test suite and read the summary.

**What you should see:** The demo completes with a typed worker result instead of refusing
for a missing tool, and the test summary reports no skipped scripted-agent tests.

**Why this matters:** A testing story that works only on the author's machine is not one;
this makes offline verification the default for every adopter and every CI run.

---

## Slice 3: Prove a Whole Pipeline Against a Scripted Agent

**Status:** ✅ Complete — 2026-09-14 — `babd20f`
**Tests:** ✅ Recorded — 2026-09-14 — `404c8c0` — cli — 1 UAT + 3 AC, 0 skipped
**Delivers:** An extender can run their real gate, real closer and role configurations
through a complete surface, worker to gate to close, against a scripted agent in a
scratch repository, and assert what the harness sent and that the script was fully used.

**Build note:** the run is composed from the unchanged production pieces (agent port,
surface driver, gate and closer resolution, provisioning) and the existing
real-temporary-git-repository testing pattern; there is no separate test-mode runner.
Script and journal types mirror the scripted agent's existing format exactly, as plain
types rather than a second validator, and journal assertions are small helpers rather than
a log-assertion library.

### Prerequisites

- Agent stand-ins and scripted sessions can be created without casts or global setup
- A gate and a closer can be named as data and resolved against a repository
- A surface can be provisioned into a worktree in a real git repository

### Acceptance Criteria

- [ ] One call runs a single surface to its end with a supplied script, role
      configurations, gate, closer and triage choice, returning the run's result and the
      parsed journal
- [ ] A script whose worker writes a change and reports completion ends with the change
      judged by the real gate and landed by the real closer
- [ ] The journal shows each prompt the harness sent, so a test can assert that the task's
      intent reached the worker
- [ ] A consumption check passes when every scripted expectation was used and otherwise
      fails listing each unused expectation by position and by what it was waiting for
- [ ] When a prompt matched nothing, the consumption check's failure also shows the prompt
      that matched nothing
- [ ] A script written through the typed helpers produces the same file a hand-written
      script would
- [ ] The run makes no network call and needs no API key

### UAT

**What you can now do:** Prove a gate, closer and role configuration work together
before ever running a live agent.

**How to try it:**
1. Run the included scripted-pipeline demo.
2. Read the first part of the output: the script the demo gave the agent, and the
   surface's closing outcome.
3. Read the next part: the prompt the harness sent to the worker, and the consumption
   check passing.
4. Read the last part, where the demo reruns with a script whose trigger phrase has a
   typo.

**What you should see:** The first run ends closed with the change on the base branch and
the task's wording visible in the sent prompt; the typo run fails with a message showing
the prompt actually sent and the expectation still waiting.

**Why this matters:** This is the roadmap's promise for Item 7: an extender tests their
own delivery pipeline end to end, deterministically and at no cost.

---

## Slice 4: Prove the Pipeline Copes When the Agent Misbehaves

**Status:** ✅ Complete — 2026-09-14 — `3fcd776`
**Tests:** ✅ Recorded — 2026-09-14 — `734c1f1` — cli — 1 UAT + 7 AC, 0 skipped
**Delivers:** An extender can script an agent that replies badly, gives up, or produces
work the gate rejects, and see the pipeline take the incomplete, escalation or retry path
it should.

**Build note:** no new failure mapping is added; the existing invocation rules for
unmatched, missing, wrong-shaped and errored replies are exercised through the real
invocation path. Tool-authority refusal is not modelled in the scripted agent.

### Prerequisites

- A whole surface can be run against a scripted agent with its journal returned
- The invocation primitive already maps bad replies to an incomplete terminus

### Acceptance Criteria

- [ ] A prompt matching no expectation ends the invocation as incomplete, with the
      existing plain-English rationale
- [ ] A reply with no structured envelope ends the invocation as incomplete
- [ ] A reply whose envelope has the wrong shape for its role ends the invocation as
      incomplete, stating it replied in the wrong shape
- [ ] A scripted failure ends the invocation as incomplete
- [ ] A worker scripted to escalate with an authority reason brings the surface to
      escalation
- [ ] A worker whose scripted change fails the real gate is routed back for another
      attempt within its budget
- [ ] (SHOULD) Writing an envelope through the authoring helper rejects a malformed
      envelope when the script is written, while a deliberately malformed script can still
      be written directly

### UAT

**What you can now do:** Show that a pipeline escalates or retries correctly when the
agent misbehaves, on cue, every time.

**How to try it:**
1. Run the included misbehaving-agent demo.
2. Read the section for each bad reply: no match, no envelope, wrong shape, scripted
   failure.
3. Read the section where the worker escalates for authority.
4. Read the section where the worker's change fails the gate.

**What you should see:** Each bad reply is reported as an incomplete attempt with a
plain-English reason; the authority escalation ends escalated; the rejected change is
retried rather than accepted.

**Why this matters:** Trust in the harness comes from seeing it refuse bad work, and an
extender can only rely on that if they can provoke failures deterministically.

---

## Slice 5: Test Your Own Pipeline by Following One Guide

**Status:** ✅ Complete — 2026-09-14 — `24d4aae`
**Delivers:** An extender who has written a gate, a closer and role configurations can go
from nothing to passing scripted tests of their own pipeline by following a single guide,
without reading harness source.

**Operational note:** the guide's snippets run in the same way as the existing gate and
closer guides, and the guide is kept honest by a test, following the precedent of the
existing closer-guide test. The role-configuration guide's offline section remains the
single-role quick start and points to the new guide.

### Prerequisites

- Honest agent stand-ins, an always-present scripted agent, whole-pipeline runs and
  misbehaviour scenarios all exist

### Acceptance Criteria

- [ ] The guide explains when to use the in-process stand-in and when to use the scripted
      agent, with the spec's decision table
- [ ] The guide has a worked happy-path pipeline test and a worked misbehaviour test that
      run as written
- [ ] The guide shows how to assert what the harness sent and that a script was fully used
- [ ] The guide lists the ways a reply ends as incomplete and how each looks
- [ ] The guide states plainly that the scripted agent cannot prove tool-permission
      refusals, and where that guarantee is tested instead
- [ ] The guide's examples need no network, no API key and no global setup
- [ ] The role-configuration guide's offline section points to the new guide

### UAT

**What you can now do:** Learn to test a delivery pipeline from one document.

**How to try it:**
1. Open the "testing your delivery pipeline" guide.
2. Follow the happy-path example, copying its snippet and running it as the guide says.
3. Follow the misbehaviour example the same way.
4. Read the section on what the scripted agent cannot prove.

**What you should see:** Both examples run and report the outcomes the guide says they
will, and the limits section tells you plainly where tool permissions are really checked.

**Why this matters:** The roadmap names the mock a first-class public API with its own
documentation; without the guide, extenders reverse-engineer the testing story from
source.
