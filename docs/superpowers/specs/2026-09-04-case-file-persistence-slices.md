# Case File Persistence — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-04-case-file-persistence-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item has no end-user product surface yet (the CLI
arrives in Item 8). Per the roadmap's two-audience split, the user for this
item is a **harness extender** — an engineer who will build on this module.
UAT below is written for that audience: each slice ships a small runnable
demo script whose printed output a reviewer reads to confirm the behaviour,
in place of a product UI that doesn't exist yet.

---

## Slice 1: Create, Append To, and Read Back a Case File

**Status:** ✅ Complete — 2026-09-04 — `a23fb6b`
**Tests:** ✅ Recorded — 2026-09-04 — `43802a2` — cli — 1 UAT + 3 AC, 0 skipped

**Delivers:** A developer can create a case file on disk for a new task,
append history entries to it, and read the whole thing back — the
foundational round trip every other capability builds on.

**Operational note:** This slice establishes the project itself: the test
runner (Vitest), the CI pipeline (lint + test on push/PR), and the
CONTRIBUTING guide. Every later slice lands into a repo where CI is already
green and a contributor already knows how to run the suite.

**Build note:** Schema validation uses an existing library (Zod) to define
the case-file schema once and derive both the TypeScript types and the
runtime validator, rather than hand-rolling parsing and validation code.

### Prerequisites

- None (bootstrap slice — the project does not exist yet)

### Acceptance Criteria

- [ ] A new case file can be created for a surface, with header fields set,
      cursor at the initial state, empty history, and no outcome
- [ ] History entries appended after creation are visible when the case file
      is read back, in the order they were appended
- [ ] Reading back a case file returns the same header, cursor, and history
      that were written
- [ ] Reading a case file that does not exist produces a clear, named error
      rather than a crash
- [ ] Reading a case file whose contents don't match the expected structure
      produces a clear, named error rather than a crash
- [ ] The project's automated test suite runs and passes on every push and
      pull request

### UAT

**What you can now do:** Create a task's case file, record a couple of
events against it, and read the full history back.

**How to try it:**
1. Run the included demo script for this slice.
2. The script creates a case file for a sample task, appends two history
   entries, then reads the case file back from disk.
3. Read the printed summary the script produces.

**What you should see:** The printed summary lists the header exactly as
created, and both history entries in the order they were recorded — proving
the state survived a full write-then-read cycle via disk, not memory.

**Why this matters:** Every other harness component will read and write
through this exact round trip; if it isn't solid, nothing built on it can be
trusted.

---

## Slice 2: Resume Correctly After a Crash

**Status:** ✅ Complete — 2026-09-04 — `ed67c71`
**Tests:** ✅ Recorded — 2026-09-04 — `515f3da` — cli — 1 UAT + 5 AC, 0 skipped

**Delivers:** A developer can simulate a crash at any point in writing a case
file and confirm that resuming reads back a consistent prior state, with the
log — not the cached cursor — treated as the source of truth.

### Prerequisites

- A case file can be created, appended to, and read back (Slice 1)

### Acceptance Criteria

- [ ] Interrupting a case-file write partway through leaves the previously
      saved state readable, not a half-written file
- [ ] Interrupting a history append partway through a line leaves the prior
      complete history intact when read back; the incomplete line is ignored
- [ ] When the cached cursor and the history log disagree, rebuilding from
      the log produces the cursor the log implies, and that becomes the
      saved cursor
- [ ] Rebuilding when the case file is missing or unreadable fails with a
      clear, named error, because the header cannot be recovered from the
      log alone
- [ ] Given any sequence of recorded events, the last entry in the history
      correctly determines what should happen next (retry, re-gate, triage,
      close, or done)

### UAT

**What you can now do:** Deliberately interrupt a case file mid-write and
watch it recover to a consistent state instead of corrupting.

**How to try it:**
1. Run the included crash-recovery demo script.
2. The script writes a sequence of events to a case file, simulating a crash
   at several different points (mid-write, mid-append, and with the cursor
   deliberately made stale).
3. Read the printed report for each simulated crash.

**What you should see:** For every simulated crash point, the report shows
the case file was recovered to the last fully-written state, and the
resume action recommended for each recovery matches the last complete event
recorded — never a corrupted or ambiguous result.

**Why this matters:** Crash recovery from disk alone, with no external
coordinator, is the entire value proposition of the case file; a gap here
means a machine restart could silently lose or corrupt a task's progress.

---

## Slice 3: Fields That Cannot Be Changed Twice Are Protected

**Status:** ✅ Complete — 2026-09-04 — `ecb8a52`
**Delivers:** A developer can attempt to change a case file's fixed
identity (its header) or its write-once fields (baseline, outcome) and see
the attempt rejected, instead of silently succeeding and corrupting the
task's record.

### Prerequisites

- A case file can be created, appended to, and read back (Slice 1)

### Acceptance Criteria

- [ ] The header (task identity, gate reference, domain prompt) is unchanged
      after any number of cursor updates or history appends
- [ ] Setting the baseline succeeds exactly once; a second attempt is
      rejected with a clear, named error
- [ ] Setting the outcome succeeds exactly once; a second attempt is
      rejected with a clear, named error

### UAT

**What you can now do:** Try to overwrite a task's baseline or final outcome
a second time and see it refused.

**How to try it:**
1. Run the included immutability demo script.
2. The script creates a case file, sets a baseline, then attempts to set it
   again; it then sets an outcome and attempts to set that again too.
3. Read the printed result of each attempt.

**What you should see:** Both first attempts succeed and both second
attempts are rejected with a clear message naming what was already set —
confirming these facts can't quietly change after the fact.

**Why this matters:** The baseline and outcome are the record other harness
components trust as fixed truth; if they could be overwritten, decisions
made from them earlier in a task's life would become unverifiable.

---

## Slice 4: Budgets Track Usage and Signal When Exhausted

**Delivers:** A developer can increment any of the task's budget counters
(correction, gate error, gate maintenance, terminus, close) and see the
running total and whether the cap has been reached.

### Prerequisites

- A case file can be created, appended to, and read back (Slice 1)

### Acceptance Criteria

- [ ] Incrementing a budget's usage raises its counter by one and persists
      the new value
- [ ] Each of the five budget populations tracks its usage independently of
      the others
- [ ] The result of an increment reports whether the cap has now been
      reached
- [ ] Incrementing past the cap is not blocked by this layer — it still
      records the increment and reports the cap as reached

### UAT

**What you can now do:** Increment a task's budget counters and watch them
approach, then reach, their caps.

**How to try it:**
1. Run the included budget demo script.
2. The script increments each of the five budget populations for a sample
   task, one at a time, up to and past its configured cap.
3. Read the printed table of results after each increment.

**What you should see:** Each population's usage rises by one per
increment, tracked separately from the others, and the report flags exactly
the increment at which each population's cap is reached.

**Why this matters:** Budgets are how the harness guarantees a task can't
loop forever; accurate, independent counters are what makes that guarantee
real.

---

## Slice 5: Large Referenced Data Can Be Stored and Retrieved Separately

**Delivers:** A developer can write a large piece of task data (a gate
failure detail, a triage brief) to its own file and later retrieve it by the
reference recorded in the task's history.

### Prerequisites

- A case file can be created, appended to, and read back (Slice 1)

### Acceptance Criteria

- [ ] Writing a reference blob for a task produces a reference ID that can
      be used to read it back later
- [ ] Reading back a reference blob by its ID returns the same content that
      was written
- [ ] A history entry that points at a reference (e.g. a gate failure
      detail) can be followed to retrieve the full referenced content

### UAT

**What you can now do:** Store a large piece of supporting detail for a task
and retrieve it later using the pointer recorded in the task's history.

**How to try it:**
1. Run the included reference-storage demo script.
2. The script writes a sample gate-failure detail as a reference, records a
   history entry pointing at it, then follows that pointer back to the
   original content.
3. Read the printed comparison between what was written and what was
   retrieved.

**What you should see:** The retrieved content matches exactly what was
originally written, reached purely by following the pointer recorded in the
task's history.

**Why this matters:** Keeping bulky detail out of the frequently-read cursor
and history keeps the task's core state fast to read while still preserving
full evidence for later review (e.g. an escalation packet a human will read).

---
