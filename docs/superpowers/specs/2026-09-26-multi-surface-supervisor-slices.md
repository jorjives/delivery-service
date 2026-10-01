# Multi-Surface Supervisor — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`
> **Status:** ✅ Complete — 2026-10-01 — all 7 slices delivered
> Next step: invoke writing-plans with this document

**Audience note:** as with Items 8 and 9, this item's product surface is the `delivery` command
and the `delivery.config.json` file a project owner checks in, so the terminal and that file are
the product UI. UAT is written for a person using them (Dana or Priya from `docs/personas.md`):
editing the configuration file, typing a `delivery` command and reading what it prints is using
the product. A real run needs the Claude Code CLI and a sign-in on the demo machine; recorded
regression tests route the agent to the vendored `claude-mock` instead.

**Decided without a human (unattended run):** the slice boundaries below were chosen by the
autonomous run, not confirmed by a person. Order follows Dana's journey and dependency: first
run several tasks at once safely (the core value); then Priya's way to test that, which every
later slice's regression tests lean on; then surviving a crash and refusing a second
concurrent run; then reading a supervised run with `delivery status`; then the shared
environment being repaired once; then repeated check errors across tasks counting as shared
breakage; then the `delivery init` suggestion. The COULD tier (host governor, priority
ordering, finer-grained hold) is not sliced.

---

## Slice 1: Run Several Tasks From Your List at Once

**Status:** ✅ Complete — 2026-09-30 — `8d4143c`
**Tests:** ✅ Recorded — 2026-09-30 — `9eee97b` — cli — 1 UAT + 4 AC, 4 skipped (already covered)

**Delivers:** A project owner sets how many tasks may run at once, and one `delivery run` works through the list with that many going at the same time, each on its own copy, with every line of output saying which task it is about.

**Operational note:** With the setting at 1 (the default) nothing a user sees or finds on disk changes: no run record of its own, no lock, no tagged lines, and the existing queue tests pass unchanged against the one scheduler. A run with more than one task at once gets its own identifier and a run record kept beside, not inside, the per-task records.

**Build note:** The pool of slots is a small purpose-built launcher, not a general concurrency library, because every launch must record which task took which slot and work out the next task afresh. The in-process lock around git work on the shared checkout is a plain promise chain, not a mutex library, and it guards every git call made against the shared checkout (decided by where the call runs, not by a list of commands). Which task is next is still decided by comparing task content against existing run records, extended to skip a task already claimed by a live slot; no list position is stored. The single-task state machine is not changed beyond the optional lock hook. The run record reuses the case file's crash-safe write-and-append discipline, extracted into one shared piece rather than copied.

### Prerequisites

- A project's configuration file can hold an ordered list of tasks, and `delivery run` works through it one at a time, picking up where it left off
- Each task's run provisions its own separate working copy and closes by committing or merging its work

### Acceptance Criteria

- [ ] A configuration file may carry a `concurrency` whole number; `--concurrency` and `DELIVERY_CONCURRENCY` override it with the same precedence as every other setting; the default is 1
- [ ] `delivery validate` shows the setting in its tick list ("up to 3 tasks at once (10 queued)") and rejects zero, negatives and non-whole numbers with a one-fix message and the configuration-problem exit code
- [ ] With concurrency above 1, up to that many tasks run at the same time; when one finishes, the next unfinished task on the list starts in its place, in list order
- [ ] No task is ever started twice in one run, and a task already finished by an earlier run is skipped, exactly as the sequential list does
- [ ] Setting up and tearing down working copies, and merging finished work back, never overlap between tasks; two tasks finishing together both close correctly, and if one's merge is refused because the other moved the base on, that task reports it through the existing close path rather than damaging the checkout
- [ ] The run opens with one line naming the run and its shape ("10 tasks, up to 3 at once"); every following line is prefixed with the task's position, such as `[2/10]`, never distinguished by colour alone, and output is append-only
- [ ] With `--json`, each line is one JSON object carrying `scope` (`surface` or `run`) and, for task lines, the task's position, total and run identifier; standard output holds only JSON
- [ ] One task escalating does not stop or slow the others; its slot is refilled with the next task
- [ ] The run's exit code is 0 only if every task was delivered, 4 if any task needs a decision, following the existing table
- [ ] With concurrency at 1, output, exit codes and files on disk are exactly as before this slice

### UAT

**What you can now do:** Have several tasks from your list worked on at the same time instead of one after another.

**How to try it:**
1. In a copy of the example project, make sure `delivery.config.json` lists at least four tasks, and add `"concurrency": 2`.
2. Type `delivery validate` and read the line about how many tasks run at once.
3. Type `delivery run` and watch the output until it finishes.
4. Follow one task's lines by its `[n/4]` prefix from start to finish.

**What you should see:** Validate reports "up to 2 tasks at once". During the run, lines from two different tasks interleave, each clearly prefixed; as soon as one task finishes, another starts. The run ends saying every task on the list is done, naming the branch for each.

**Why this matters:** Most of a task's time is an agent working on its own copy; running several at once turns a list that took an afternoon into one that takes an hour, without giving up the check on every task.

---

## Slice 2: Test Your Setup With Several Tasks Running Together

**Status:** ✅ Complete — 2026-09-30 — `ff58e12`
**Tests:** ✅ Recorded — 2026-09-30 — `7e25dfc` — cli — 1 UAT + 2 AC, 3 skipped (already covered)
**Delivers:** A harness extender writes a test that drives several scripted tasks through the real supervisor with an order of events she chooses, and checks the resulting repository, with no real agent and no network.

**Operational note:** The testing guide gains a section on testing several tasks at once; like the existing guide, its example is run as a test, so the guide cannot drift from the product.

**Build note:** Reuse the existing scripted mock, its script vocabulary and its per-reply delay to force an order of events; do not add a second mocking vocabulary or a new synchronisation primitive. The multi-task runner sits beside the existing single-task scripted runner and uses the real provisioning, check and closer resolution.

### Prerequisites

- Several tasks from a list can run at once through one run
- An extender can already script a single task's agent replies and run it against a temporary repository through the public testing entry point

### Acceptance Criteria

- [ ] The public testing entry point exposes a way to run several scripted tasks through the supervisor against one temporary repository, with a chosen number of slots
- [ ] Staggering reply delays reliably decides which task reaches a given step first, so the same test gives the same result every time
- [ ] A test can script two tasks reaching the merge together and observe one merged and one refused because the base moved on
- [ ] The run's journal of prompts sent and scripted replies consumed is available per task, as for a single task
- [ ] The testing guide explains how to script several tasks with a chosen interleaving, and its worked example passes as a test

### UAT

**What you can now do:** Prove your own check and closer behave when several tasks run together, without a real agent.

**How to try it:**
1. Open the testing guide and find the section on testing several tasks at once.
2. Copy its worked example into your own project's tests and run your test command.
3. Change the delays in the example so the other task reaches the merge first, and run it again.

**What you should see:** The example passes; after swapping the delays, the other task is the one merged and the first is refused with "the base moved on", every time you run it.

**Why this matters:** An extender cannot trust concurrency they cannot test cheaply and repeatably; this gives them that without spending on real agent calls.

---

## Slice 3: Pick Up a Running-at-Once Run After a Crash, and Refuse a Second One

**Status:** ✅ Complete — 2026-09-30 — `46d0895`
**Tests:** ✅ Recorded — 2026-09-30 — `0a528f1` — cli — 1 UAT (covers 4 AC inline) + 1 AC, 1 skipped (already covered)
**Delivers:** If the machine or the command dies mid-run, running `delivery run` again carries on from where every task was, and a second `delivery run` against the same project while one is live is refused with a plain explanation.

**Operational note:** A supervised run holds a lock on the repository for its lifetime. After a hard kill, running the command again reclaims its own stale lock automatically; there is never a manual unlock step. The sequential path takes no lock but respects a live one.

**Build note:** Use `proper-lockfile` for the cross-process repository lock, for its stale-lock detection after an abrupt kill; do not write a lock by hand. Resume reads the run record's last entry and takes the one action it implies, the same discipline the per-task record already uses; the git set-up and merge steps are already safe to repeat, so no new recovery mechanism is added.

### Prerequisites

- Several tasks from a list can run at once through one run, with the run keeping its own record of which task holds which slot
- A single task's run already resumes correctly from its own record after a crash

### Acceptance Criteria

- [ ] Interrupting a supervised run (Ctrl-C or the process being killed) and running `delivery run` again resumes it: every task that was in progress continues from its own last step, finished tasks are not redone, and the run says what it is picking up
- [ ] After resume, no task's working copy is set up twice and no finished work is merged twice
- [ ] An interrupted supervised run exits with the "stopped before it could finish" code
- [ ] Starting `delivery run` while a supervised run is live in the same repository, at any concurrency, is refused before anything starts, with the configuration-problem exit code and a message naming the live run, when it started, its shape, and how to look at it
- [ ] A lock left behind by a killed process does not block the resume that follows it

### UAT

**What you can now do:** Stop a run that has several tasks going, start it again, and have it carry on; and be told plainly if you try to start a second run on top of a live one.

**How to try it:**
1. In the example project with four tasks and `"concurrency": 2`, type `delivery run`.
2. While two tasks are going, open a second terminal in the same folder and type `delivery run`; read the message.
3. In the first terminal, press Ctrl-C to stop the run.
4. Type `delivery run` again and let it finish.

**What you should see:** The second terminal is refused straight away with a message naming the run already going and suggesting `delivery status`. After Ctrl-C, the restarted run says which tasks it is picking up, carries on, and ends with every task done once, each on its own branch.

**Why this matters:** A laptop that sleeps or a terminal closed by mistake must not cost an owner the work already done, or leave two runs fighting over one project.

---

## Slice 4: See Where a Running-at-Once Run Has Got To

**Status:** ✅ Complete — 2026-09-30 — `cb732b6`
**Tests:** ✅ Recorded — 2026-09-30 — `8012e1a` — cli — 1 UAT + 2 AC, 2 skipped (already covered)
**Delivers:** A project owner asks `delivery status` about a run with several tasks and gets a plain summary of the whole run followed by one line per task, and can read any one task in full by its own name.

**Operational note:** This is the post-mortem surface the roadmap asks for: the whole run record is readable through `delivery status <run> --json`, nesting each task's existing report rather than inventing a second shape.

**Build note:** Reuse the existing status command, run reporter and closed-set plain-language phrase tables; no second renderer.

### Prerequisites

- A run with several tasks at once keeps its own record, including which tasks it started and how each ended
- `delivery status` already reports on a single task's run in plain language and `--json`

### Acceptance Criteria

- [ ] `delivery status <run id>` for a supervised run shows the run line (identifier, start time, number of tasks, how many at once), the environment state, counts (done, needs your decision, paused, queued), then one line per task with its position, text and outcome
- [ ] A task needing a decision is followed by the existing decision rendering, unchanged
- [ ] A task waiting only because every slot is busy shows as "queued, waiting for a free slot"
- [ ] `delivery status <task run id>` for any one task reports exactly as today
- [ ] With no identifier, `delivery status` reports the most recently touched run, of either kind
- [ ] `--json` returns one document with the run-level fields and a list whose entries are today's per-task document; every key is present, `null` where it does not apply
- [ ] `delivery status --all` lists a supervised run as one summarising line
- [ ] An identifier that names nothing gives the existing "nothing here" style message

### UAT

**What you can now do:** Check on a run with several tasks and see at a glance what is done and what needs you.

**How to try it:**
1. In the example project with `"concurrency": 2`, add a task you expect to need a decision (for example, one asking the agent to delete a file it should not), and type `delivery run`.
2. When it ends, type `delivery status`.
3. Copy the name of one finished task from the list and type `delivery status` followed by that name.
4. Type `delivery status --all`.

**What you should see:** A summary line with counts ("3 done, 1 needs your decision"), one line per task, and the decision the stuck task needs, in plain words with no internal state names. The single task's report looks exactly as it always has. The full history shows the run on one line.

**Why this matters:** An owner who runs ten tasks overnight needs one place to see what happened, in her own words, before she can trust leaving it running.

---

## Slice 5: Have a Broken Shared Environment Repaired Once, Not by Every Task

**Status:** ✅ Complete — 2026-09-30 — `ae4b22b`
**Tests:** ✅ Recorded — 2026-10-01 — `ad67e95` — cli — 1 UAT + 6 AC, 0 skipped

**Delivers:** When the project's shared environment breaks under a run with several tasks, the harness holds the tasks about to check or hand off their work, repairs the environment once, carries on, and, if repair fails, stops the run with a plain statement that the environment, not any task, is the cause.

**Operational note:** The limit on repair attempts becomes one limit for the whole run rather than per task, for runs with more than one task at once; a single-task run keeps today's per-task behaviour. The breaker's state and every repair attempt are recorded in the run record, so a trip can be diagnosed after the fact from `delivery status`. Demonstrating a trip needs an example whose check depends on something shared outside the tasks' own copies; this slice adds that as a variant of the existing example project, following the "one fixture, one guide, one test" convention, and slice 6 reuses it.

**Build note:** The breaker is a field and transition table in the run record, the same pattern the per-task record uses for its state; do not adopt a circuit-breaker library (the available ones are in-memory and do not survive a crash). The repair is done by the existing gate-maintenance role with its existing instructions and tool permissions, dispatched by the run; no new agent role. Concurrent requests for repair share the one repair in flight.

### Prerequisites

- Several tasks can run at once, with a run record that survives a crash and a status view of the whole run
- A single task that finds its check environment broken already dispatches a gate-maintenance repair

### Acceptance Criteria

- [ ] Any task in a supervised run finding the check environment broken (a failing starting point, or triage deciding the check itself needs fixing) puts the whole run into "something in the shared environment looks broken"
- [ ] While in that state, no task begins checking or handing off its work; tasks with an agent working or being triaged carry on untouched; nothing is force-stopped
- [ ] Exactly one repair runs once no task is mid-check or mid-hand-off, however many tasks asked for it; it counts against one run-wide repair limit
- [ ] A successful repair prints "Fixed. Resuming." and every held task carries on from where it was held
- [ ] If repair fails within the run-wide limit, the run stops, says how many tasks were waiting, finished and still queued, exits with the "needs a decision" code, and the run's outcome says the shared environment is the cause
- [ ] `delivery status` leads with the environment narration when it is not healthy, naming what broke and which tasks it held
- [ ] Human-readable output never shows internal state names; `--json` carries a run-scope line for each change in the environment's state with the tasks affected
- [ ] A crash during a repair resumes into the repair rather than losing it or starting a second

### UAT

**What you can now do:** Trust that one broken piece of shared set-up is fixed once for the whole run, and be told plainly when it cannot be.

**How to try it:**
1. Use the example project's shared-environment variant, whose check depends on a shared helper outside the tasks' own copies, with four tasks and `"concurrency": 2`, and type `delivery run`.
2. While two tasks are going, remove the shared helper the variant's guide names.
3. Watch the output until the run ends, then type `delivery status`.

**What you should see:** A plain message that something in the shared environment looks broken and that tasks about to check their work are being held, one "repairing" line, then "Fixed. Resuming." and the remaining tasks finishing. `delivery status` shows the run as healthy and every task done. (If the repair cannot restore the helper, the run instead stops with a message that the environment could not be fixed, and `status` leads with that cause.)

**Why this matters:** Without this, every task would independently fail, retry and fight over the same broken box, wasting the owner's money and burying the one real problem under many false task failures.

---

## Slice 6: Treat the Same Check Error in Two Tasks as a Shared Problem

**Status:** ✅ Complete — 2026-10-01 — `32778a5`
**Tests:** ✅ Recorded — 2026-10-01 — `fabd4bc` — cli — 1 UAT + 1 AC, 3 skipped

**Delivers:** When two different tasks in one run each keep hitting errors running the check (not failing tests, but the check itself erroring), the run treats it as a broken shared environment and repairs it once, while a single task's one-off error stays that task's own business; and an API rate or spend limit is described as that, not as a broken project.

**Operational note:** The threshold is fixed at two distinct tasks since the environment was last healthy, with no time window, so behaviour is reproducible under the scripted mock; it is marked for retuning once real flake rates are known.

### Prerequisites

- A broken shared environment can already be repaired once for the whole run, with held tasks resuming afterwards
- A single task already retries a check error within its own limit before asking for gate maintenance

### Acceptance Criteria

- [ ] One task exhausting its check-error retries, with no other task having done so since the environment was last healthy, does not affect any other task
- [ ] A second, different task exhausting its check-error retries in that window puts the run into the broken-environment state and triggers the single repair
- [ ] The same task erroring twice counts once
- [ ] After a successful repair, earlier check-error evidence no longer counts towards the threshold
- [ ] An agent session stopped by an API rate limit or spend limit is described in plain words as that ("the AI service is limiting requests" or "the spending limit has been reached") and never as the shared environment being broken, and does not count towards the threshold

### UAT

**What you can now do:** Rely on the harness to tell a one-off hiccup apart from a problem every task is hitting, and to name a usage limit for what it is.

**How to try it:**
1. Use the example project's shared-environment variant with four tasks and `"concurrency": 2`, and make the shared helper intermittently unavailable as its guide describes.
2. Type `delivery run` and watch the output.
3. When it ends, type `delivery status` and read the environment line and each task's outcome.

**What you should see:** A single task's error is retried on its own without a run-wide message; once a second task hits the same error, the run shows the "shared environment looks broken" message, repairs once, and carries on. Status shows the repair in the run's history.

**Why this matters:** Reacting to every flake with a run-wide repair would waste money; ignoring a pattern across tasks would let every task fail. Two independent occurrences is the smallest signal that tells the stories apart.

---

## Slice 7: Be Offered a Sensible Number of Tasks at Once During Set-Up

**Status:** ✅ Complete — 2026-10-01 — `1672989`
**Delivers:** When `delivery init` sets up a project with more than one task, it asks whether to run some at the same time and offers a conservative number, instead of silently choosing.

### Prerequisites

- `delivery init` walks an owner through setting up a project and can write a task list
- The configuration file accepts a number of tasks to run at once

### Acceptance Criteria

- [ ] With more than one task entered, `init` asks whether to run some at once, explains in one sentence that it costs more at the same time and uses a working copy per task, and offers a conservative suggestion
- [ ] Accepting writes the setting into the configuration file; declining writes nothing, leaving the default of one at a time
- [ ] With one task or none, `init` does not ask
- [ ] A value typed in place of the suggestion is checked with the same rule `validate` uses

### UAT

**What you can now do:** Decide during set-up whether tasks should run at the same time, with a safe suggestion.

**How to try it:**
1. In an empty copy of a small project, type `delivery init`.
2. Enter three tasks when asked.
3. Accept the suggested number of tasks at once, then open `delivery.config.json`.

**What you should see:** A plain question explaining the trade-off with a suggested number; after accepting, the configuration file contains that number. Running `init` again and declining leaves the setting out.

**Why this matters:** Owners discover the feature at the moment it is useful, and nobody's costs change without their say-so.
