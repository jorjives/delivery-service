# Gate Interface — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-04-gate-interface-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface yet (gate
configuration via CLI or project config arrives in Items 8/9, out of scope
for this spec). Per the roadmap's two-audience split, the user for this item
is a **harness extender** — an engineer who will build gates and wire the
gate contract into the state machine. UAT below is written for that
audience: each slice ships a small runnable demo script whose printed output
a reviewer reads to confirm the behaviour, in place of a product UI that
doesn't exist yet.

---

## Slice 1: Compute a Regression Verdict from Two Gate Reports

**Status:** ✅ Complete — 2026-09-05 — `dacf633`
**Tests:** ✅ Recorded — 2026-09-05 — `b327777` — cli — 1 UAT + 8 AC, 0 skipped

**Delivers:** A developer can feed the delta rule a baseline report and a
check report and get back a verdict — pass or fail, which assertions newly
broke, and whether the failure is worker-caused or infrastructure-caused —
without needing a real gate or a real project to produce those reports.

### Prerequisites

- None

### Acceptance Criteria

- [ ] Given a baseline and check report with identical passing assertions,
      the verdict passes with no new failures
- [ ] Given an assertion that passed at baseline and fails or errors at
      check, it is reported as a new failure with both outcomes recorded
- [ ] Given an assertion that passed at baseline and is missing from the
      check report, it is reported as a new failure with an `ABSENT` outcome
- [ ] An assertion that was already failing or erroring at baseline is never
      reported as a new failure, regardless of its check outcome
- [ ] An assertion present at check but absent from baseline is never
      reported as a new failure by default
- [ ] When the `failOnNewAssertions` option is set, a failing assertion with
      no baseline counterpart is reported as a new failure
- [ ] When the check report's gate-level status is `ERROR`, the verdict
      fails and is classed as an infrastructure error, regardless of
      individual assertion outcomes
- [ ] When there are new failures but the gate-level status is not `ERROR`,
      the verdict fails and is classed as a worker-caused failure

### UAT

**What you can now do:** Feed the delta rule a pair of before/after gate
reports and read back exactly which assertions regressed and why.

**How to try it:**
1. Run the included delta-rule demo script.
2. The script runs a series of baseline/check report pairs through the delta
   rule — no regressions, a genuine regression, a vanished assertion,
   pre-existing red noise, a brand-new failing assertion, and a gate-level
   error — and prints the verdict for each.
3. Read the printed verdict for each scenario.

**What you should see:** Each scenario's printed verdict matches its label —
the "no regressions" case passes, the "regression" and "vanished assertion"
cases fail and name the exact assertion, the "pre-existing red" case passes
despite the ambient failure, the "gate error" case fails and is classed as
infrastructure rather than worker-caused.

**Why this matters:** This is the logic that decides whether a worker's
change gets blamed for breaking something — it has to be trustworthy before
any real gate is wired up to it.

---

## Slice 2: Gate a Real Project with a Shell Command

**Status:** ✅ Complete — 2026-09-05 — `6b92b9d`
**Tests:** ✅ Recorded — 2026-09-06 — `a301b93` — cli — 1 UAT + 6 AC, 0 skipped

**Delivers:** A developer can point the built-in command gate at a real
shell command in a real worktree and get back a `GateReport` with one
assertion per test — for TAP output, JUnit XML output, or a plain exit code
— instead of hand-writing a parser for their project's test runner.

**Build note:** TAP and JUnit parsing is hand-written rather than pulled in
from a library — per the spec's explicit decision, both formats are simple
enough that a small focused parser is more predictable than a
general-purpose dependency. Do not add a TAP or JUnit library for this.

### Prerequisites

- The delta rule can classify baseline/check report pairs (Slice 1) — so the
  reports this gate produces can immediately be fed into it

### Acceptance Criteria

- [ ] Running a command whose output is TAP-formatted produces one assertion
      per `ok`/`not ok` line, each with a stable ID derived from the test
      number and description
- [ ] Running a command whose output is JUnit XML produces one assertion per
      test case, each with a stable ID derived from the class and test name
- [ ] Running a command in exit-code mode produces exactly one assertion,
      passing on exit code 0 and failing otherwise
- [ ] Running the same command twice against unchanged code produces the
      same set of assertion IDs both times
- [ ] A command that cannot be found, times out, or produces output that
      can't be parsed in the selected mode produces a report with an error
      status and a diagnostic detail — never a crash
- [ ] A command that reports the same assertion ID twice produces a report
      with an error status and a diagnostic detail

### UAT

**What you can now do:** Point the command gate at a real test suite and see
its results turned into a structured report.

**How to try it:**
1. Run the included command-gate demo script.
2. The script runs the command gate against a small sample project once in
   TAP mode, once in JUnit mode, and once in exit-code mode, then again
   against a version of the same project with one test deliberately broken.
3. Read the printed report for each run.

**What you should see:** Each parse mode produces a report listing the
sample project's tests with the correct pass/fail outcome, and the "broken"
run's report shows the one deliberately failed test as `FAIL` while every
other test still shows `PASS`.

**Why this matters:** This is the gate most projects will actually use — a
non-technical owner only has to name a test command, not write a parser.

---

## Slice 3: Gate a Project with a Custom, Hand-Written Gate

**Delivers:** A developer can author their own gate as a small module
exposing `baseline` and `check`, point the harness at it, and have it run
exactly like a built-in gate — for the cases the command gate can't cover.

### Prerequisites

- A `GateReport` from any gate can be fed into the delta rule (Slice 1)

### Acceptance Criteria

- [ ] A user-supplied module exporting an object with `baseline` and `check`
      methods is loaded and both methods run successfully against a
      worktree
- [ ] A named export other than the default can be selected and loaded
      correctly
- [ ] A module path that doesn't resolve produces a report with an error
      status and a diagnostic detail — never a crash
- [ ] A module whose export is missing `baseline` or `check` is rejected
      with a clear, named configuration error at load time, before either
      method is ever called
- [ ] An uncaught exception thrown by a custom gate's `baseline` or `check`
      is caught and turned into a report with an error status, never
      propagated to the caller

### UAT

**What you can now do:** Write a small custom gate module and have the
harness load and run it exactly as it would a built-in gate.

**How to try it:**
1. Run the included custom-gate demo script.
2. The script loads a sample custom gate module, runs `baseline` then
   `check` against a worktree, then repeats the load against a deliberately
   broken module (wrong path, and one missing the `check` method) and a gate
   that throws.
3. Read the printed report for each attempt.

**What you should see:** The working custom gate's reports list its
assertions correctly; the broken-path and missing-method attempts are
rejected with a clear message naming the problem; the throwing gate's
exception surfaces as an error report rather than crashing the script.

**Why this matters:** Not every project's success criteria can be expressed
as a shell command; custom gates are the escape hatch, and they need to be
exactly as safe to run as the built-ins.

---

## Slice 4: Resolve a Pinned Gate Reference into a Running Gate

**Delivers:** A developer can hand the resolver the same `GateRef` value
that lives in a case file header — a plain description of "command" or
"custom" plus its parameters — and get back a working gate, without needing
to know at the call site which built-in type it is or write any
type-specific wiring.

### Prerequisites

- The command gate can produce a report from its parameters (Slice 2)
- The custom gate can be loaded and run from its parameters (Slice 3)

### Acceptance Criteria

- [ ] A `command`-type gate reference resolves to a working command gate
      configured with that reference's command and parse mode
- [ ] A `custom`-type gate reference resolves to a working custom gate
      loaded from that reference's module path
- [ ] A gate reference naming an unsupported parse mode is rejected with a
      report carrying an error status and a diagnostic detail, not a crash
- [ ] Resolution failures (bad module path, unsupported parse mode) produce
      the same error-report shape a running gate would produce, so callers
      don't need to distinguish "failed to resolve" from "failed to run"

### UAT

**What you can now do:** Hand the resolver a single gate reference — the
same shape stored in a case file — and get back a gate ready to call,
regardless of which built-in type it names.

**How to try it:**
1. Run the included gate-resolution demo script.
2. The script resolves a command-type reference and a custom-type reference,
   runs `baseline` on each resolved gate, then resolves a reference with a
   bad module path and one with an unsupported parse mode.
3. Read the printed outcome of each resolution.

**What you should see:** Both valid references resolve to gates that
produce real reports when run; both invalid references fail resolution with
a report naming what was wrong, rather than throwing or hanging.

**Why this matters:** This is the single door the rest of the harness walks
through — it never needs to know whether a surface's gate is a shell command
or hand-written code, only that it has a `GateRef`.

---

## Slice 5: A Gated Surface's Baseline and History Survive on Disk

**Delivers:** A developer can run a gate's baseline once for a surface, run
`check` after a simulated attempt, and see the delta result recorded in that
surface's case file — the full pipeline from a pinned gate reference through
to a persisted verdict a later process could resume from.

### Prerequisites

- A gate reference resolves to a running gate (Slice 4)
- The delta rule can classify a baseline/check pair (Slice 1)
- The case file can store a baseline once and append history entries
  (existing case-file persistence capability)

### Acceptance Criteria

- [ ] Resolving a surface's gate reference, running baseline, and storing it
      in the case file succeeds exactly once; a second attempt to store a
      baseline for the same surface is rejected
- [ ] Running `check` after an attempt, computing the delta against the
      stored baseline, and appending the result produces a history entry
      recording the verdict, the new failures, and the failure class
- [ ] Reading a surface's case file back after this round trip shows the
      original baseline unchanged and the check's verdict present in history
- [ ] A gate-level error during `check` is recorded as an error-class entry
      in history, distinct from a worker-caused failure entry

### UAT

**What you can now do:** Watch a surface go from "no baseline" through a
gated attempt to a recorded, re-readable verdict on disk.

**How to try it:**
1. Run the included end-to-end gating demo script.
2. The script resolves a gate for a sample surface, records its baseline,
   simulates an attempt, runs `check`, and appends the resulting verdict —
   then reads the case file back from disk.
3. Read the printed summary of what was stored and re-read.

**What you should see:** The printed summary shows the baseline stored once,
a history entry recording the check's verdict (pass/fail, new failures,
class), and confirms the re-read case file matches exactly what was
written — proving the gate result survives a real write-then-read cycle.

**Why this matters:** This is the gate interface doing its actual job inside
the system it was built for — everything upstream (state machine
transitions, triage routing) will build on this exact round trip.

---
