# Triage and Deterministic Router — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface; a CLI (Item 8) and
reporting (Item 11) arrive later. Following the Item 4 precedent, UAT is written for a
harness extender (Priya) and an on-call reader (Marcus): each slice ships a runnable
demo script against `claude-mock` (no live API call) whose printed output a reviewer
reads to confirm the behaviour.

**Decided without a human (unattended run):** the slice boundaries below were chosen
by the autonomous run, not confirmed by a person. Order follows the spec's value: an
informed retry first (the roadmap's headline user value), then actionable escalations,
then the budget-boundary and gate-error refinements with the extender guide.

---

## Slice 1: A Stuck Worker's Retry Is Informed by Triage, Not Re-dispatched Blind

**Status:** ✅ Complete — 2026-09-11 — `df74624`
**Tests:** ✅ Recorded — 2026-09-11 — `4477d17` — cli — 1 UAT + 5 AC, 4 skipped
**Delivers:** When a worker gives up but another attempt might succeed, a read-only
triage agent decides whether to retry and, if it does, the fresh worker receives a
sharpened brief saying what was tried, why it missed, and what to try next, while plain
gate failures keep routing without any agent call.

**Operational note:** the demo and tests depend on `claude-mock` being resolvable on
the machine, as for Item 4; the demo must say so plainly. Triage's read-only role means
mock scripts need no file-editing effects. Tool-authority enforcement for triage rests
on the real SDK; the mock does not enforce it, and nothing in this slice may claim
otherwise.

**Build note:** triage must reuse the existing single invocation seam, role
configuration shape, prompt assembler and tool-authority guard from Item 4, and the
codebase's existing schema library for its reply shapes. No second invocation path, no
second prompt assembler, no new dependency.

### Prerequisites

- A worker can be dispatched through the real invocation seam and return a typed result
- A surface can reach triage after a setback and route on the deterministic router's verdict
- Case files can store and read back referenced artefacts

### Acceptance Criteria

- [ ] A worker that escalates as "stuck" with correction budget left is triaged by the
      triage agent, not by the lookup table alone
- [ ] When triage decides to retry, the next worker's prompt contains triage's brief
      (problem, dead ends, scope, references, and a diagnosis marked as a hypothesis)
      alongside the verbatim gate evidence, as two visibly separate sections
- [ ] The retried worker's prompt contains the previous round's dead ends, not merely
      an empty brief
- [ ] A plain gate failure with more than one correction slot left is routed with no
      agent call at all, exactly as before, and its retry carries no brief
- [ ] A worker that escalates for lack of authority is passed straight to escalation;
      triage is never asked
- [ ] Triage's own prompt shows the setback, the remaining budgets, and the rationales
      of earlier triage rounds, or a fixed sentence saying there were none
- [ ] Triage is given read-only tools and cannot be configured into editing the worktree
- [ ] Assembling triage's prompt twice from the same case file produces the identical
      request; worker and gate-maintenance prompts are unchanged from before this item
- [ ] A crash mid-triage resumes to the same triage round and produces the same request

### UAT

**What you can now do:** Watch a stuck worker get a second attempt that knows what the
first one tried.

**How to try it:**
1. Run the included triage demo script.
2. The script runs a surface where a scripted worker gives up as "stuck", a scripted
   triage agent decides to retry, and a second worker is dispatched.
3. Read the printed triage prompt, the triage verdict, and the second worker's prompt.
4. Read the final part of the output, where the script runs a plain gate failure.

**What you should see:** The second worker's prompt has a Brief section naming what the
first attempt tried and why it missed, with the diagnosis labelled as a hypothesis, and
a separate Gate evidence section. The plain gate failure prints that no triage agent was
called.

**Why this matters:** Retries stop being blind re-runs of the same brief, which is the
whole reason the harness triages instead of just counting attempts.

---

## Slice 2: Every Escalation Hands a Human a Decision, Not Internal State

**Status:** ✅ Complete — 2026-09-11 — `8c13b87`
**Delivers:** Whenever a surface escalates, whatever caused it, the case file carries an
escalation packet stating the decision a human must make, the verbatim evidence, what
already failed, why it escalated now, and which sessions to consult; and triage can
never act on a verdict that is illegal for its setback.

### Prerequisites

- A triage agent can be invoked for a setback and return a typed verdict with its payload
- Triage artefacts are written to the case file for every triage round

### Acceptance Criteria

- [ ] An escalation decided by the triage agent stores the agent's packet with all five
      parts: decision, verbatim evidence, dead ends, why now, session references
- [ ] An authority escalation, an escalation because a budget ran out, and an escalation
      caused by unusable triage output each store a packet with all five parts, built
      without any agent call
- [ ] Each packet's decision reads as a question for a human, and differs by cause:
      authority, no budget left, and triage failure read differently
- [ ] A packet produced because a budget ran out says plainly that no budget remains and
      shows it as used out of maximum
- [ ] Triage output that is missing, malformed, or of the wrong shape escalates with a
      plain-English reason; it never defaults to a retry and never shows a raw error
- [ ] A triage agent that answers "retry the worker" to a failed close is escalated
      instead, with a reason naming the verdict and the verdicts that were allowed
- [ ] A failed close can end only in a close retry, an escalation, or an abort
- [ ] No packet contains a stack trace or a bare internal code presented as the message

### UAT

**What you can now do:** Open any escalated case and read what you are being asked to
decide.

**How to try it:**
1. Run the included escalation demo script.
2. The script drives four surfaces to escalation: the triage agent escalates; the worker
   hits an authority limit; the correction budget runs out; the triage agent replies with
   something unusable.
3. It then drives a failed close where the triage agent wrongly answers "retry the worker".
4. Read the packet printed for each case.

**What you should see:** Five packets, each opening with a decision addressed to a
person, followed by the evidence, what was already tried, and why it escalated now. The
budget case says no budget remains. The failed-close case says the verdict was not
allowed for a close failure.

**Why this matters:** An escalation is the handoff to a human; if the human cannot act
on it without reading transcripts, they stop trusting the harness.

---

## Slice 3: Triage Judges the Last Attempt and Rechecks Broken Gates for Free

**Delivers:** On the last remaining attempt, triage decides whether a final retry is
worth spending or a clean escalation is better; a gate that errors is first re-run
for free before anything else is spent, and a gate repair session receives triage's
brief; and an extender can configure triage from the guide alone.

**Operational note:** adds a Triage chapter to the configuring-a-role guide, matching
the Worker and Gate-maintenance chapters, and a demo runnable in the existing demo
naming convention. The guide must state that triage's tool list is read-only by design.

**Build note:** the gate recheck reuses the existing gate check against the same
immutable baseline; no new gate mechanism and no flaky-assertion quarantine.

### Prerequisites

- A triage agent can decide retries with a sharpened brief, and every escalation stores a packet
- Budgets are tracked per population from the case file's log

### Acceptance Criteria

- [ ] A gate failure with exactly one correction slot left engages the triage agent,
      which may retry or escalate
- [ ] A close failure with exactly one close slot left engages the triage agent
- [ ] With a population's budget spent, no triage agent is called and the surface
      escalates with a packet
- [ ] A gate that errors is re-run against the same baseline while its recheck budget
      lasts, with no agent call and no gate-maintenance session
- [ ] Once rechecks are spent and gate-maintenance budget remains, triage decides
      whether to repair the gate; a repair session receives triage's brief
- [ ] Without a triage agent wired in, a gate that keeps erroring still reaches gate
      maintenance after its rechecks, as it did before this item
- [ ] When both recheck and gate-maintenance budgets are spent, the surface escalates
- [ ] Following only the guide's Triage chapter, an extender can configure triage and
      get a typed verdict back without reading the harness source

### UAT

**What you can now do:** See triage spend judgement only where it changes the outcome,
and set triage up from the guide.

**How to try it:**
1. Run the included last-attempt demo script.
2. The script runs a surface down to its last correction slot and shows the triage
   agent choosing between one more retry and escalating.
3. It then runs a surface whose gate errors once and then passes on recheck, followed by
   one whose gate keeps erroring until a repair session is dispatched.
4. Open the Triage chapter of the configuring-a-role guide and follow it.

**What you should see:** Triage is consulted only on the last slot; the flaky gate
recovers on its free recheck with no agent involved; the broken gate reaches a repair
session carrying triage's brief. The guide's example produces a typed triage verdict.

**Why this matters:** Agent calls cost money; spending them only where a decision exists
keeps the harness affordable to leave running while still handling the hard cases well.
