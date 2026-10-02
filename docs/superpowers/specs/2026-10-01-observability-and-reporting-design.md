---
type: phase-design
created: 2026-10-01
roadmap_item: 11
seeded_by: [50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md]
---

# Observability and Reporting — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 11.
> Extends: `2026-09-14-cli-and-configuration-design.md` (Item 8: the `delivery` CLI, exit codes, `--json`, `delivery status`, the terminal renderer), `2026-09-26-multi-surface-supervisor-design.md` (Item 10: the run file, breaker and repair entries, the supervised `status` view).
> Builds on: `2026-09-04-case-file-persistence-design.md` (three-part persistence, log-tail authority), `2026-09-10-triage-and-router-design.md` (triage entries, `EscalationPacket`), `2026-09-17-project-configuration-design.md` (the task list, content identity via `findQueueRun`), `2026-09-13-agent-mock-design.md` (the scripted mock stack).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed; Dana, Marcus and Priya each gain a goal extension in place from this run).
> Audit trail: `docs/prd/2026-10-01-observability-and-reporting/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md). Citations of the form "research A.6" point into that research file.
> Produced by an autonomous design-team run (`20261001T131757Z`); no human reviewed it. One idea from the operator's pool seeded part of this work (`seeded_by` above): its question "should a repair's change to the check be shown to the owner" is answered here as a SHOULD-tier capability. The idea's two control-flow questions (owner approval, refusing a weakened check) are explicitly not in this phase.

## Problem

With Item 10 shipped, an owner can hand the harness a list of tasks, let several run at
once, and walk away. What they come back to does not yet answer the question they have.
The roadmap's own framing: "An adopter running 20 tasks overnight needs to come back to a
clear summary: what succeeded, what escalated, why, and what to do about the escalations",
and for a non-technical owner "the reporting surface may be the only window into what the
harness did."

Today's surfaces, verified against the code (research A):

- **A terminal renderer for the driving process** (`src/cli/report.ts`: `plainReporter`,
  `jsonReporter`). It serves only the process that started the run; someone who comes
  back later, or a second terminal, gets nothing from it.
- **`delivery status`** (`src/cli/status-command.ts`): one run, `--all`, `--json`, and a
  supervised view with a standing per task. It prints a stopped run's escalation packet
  verbatim. It does not show retry budgets (other than the run-level repair limit in
  `--json`), does not show any triage decision, and for an in-flight task of a supervised
  run prints only "not finished yet" although the state is on disk.
- **No view of the task list at the default concurrency of 1.** A sequential list has no
  run-level record and stops at the first task that does not close (`src/cli/queue.ts`),
  so the overnight owner on the default setting has no single thing to read.
- **The escalation packet speaks the harness's language** ("No correction budget remains
  (2/3 used)", "authority"), which is right for an on-call engineer and wrong for an owner
  who, per `docs/personas.md`, "would not know what a 'budget' means".

The roadmap says "the case file already serialises everything needed". That is mostly
true, with four verified gaps (research headlines 2, 3, 5; A.6):

| Roadmap criterion | Already persisted | Gap |
|---|---|---|
| State of every active surface | The log tail is the authority (`deriveStateFromEntry`, `resumeAction`); the run log has slot and breaker entries | **No timestamps**: neither `HistoryEntry` nor `RunEntry` carries a time. Only `outcome.at` and the stamp in the run id exist, so "since when", "how long" and a time-ordered feed cannot be derived |
| Budget per surface and per run | `deriveBudgetsFromLog` gives `{used, max}` for five retry populations; `repairsUsed` and `runBudgetMax` for the run | Persisted, not surfaced. These are retry caps; **no cost or duration is recorded**, though `invoke()` holds the SDK result message carrying both |
| Triage decisions and rationales | `TriageEntry` has trigger, verdict, rationale and `artifactRef` | Persisted, not surfaced: no command shows them |
| Terminal outcomes with reasons | `CaseFileOutcome` (`kind`, `source`, `reason`, `at`, `packetRef`); `RunOutcome` with a `cause` on run-level escalation | A task's outcome has **no machine-readable cause**: `EscalationCause` is never persisted, so any "what to do" advice would have to parse prose |
| Escalation packets | `refs/escalation.json`, read by `packetOf` | None for the technical reader; no plain-language rendering for the owner |
| What a repair changed (SHOULD) | `repair_dispatch`/`repair_terminus` and per-surface gate-maintenance entries record a rationale only | **Recorded nowhere.** A repair's edits are swept into the task's single accepted-work commit, unattributable, or lost when the working copy is removed on escalate or abort |

So this phase is a read model with several renderings, plus small optional recording
additions. It adds no control flow.

## Personas

`docs/personas.md` is the source of truth. This phase appends a labelled goal extension
to each persona in place (assumed, not human-confirmed).

- **Dana Okafor, non-technical owner.** Come back to a whole task list and know, from the
  first screen, what landed, what needs her, and what to do next; glance at a run in
  progress; keep a copy she can forward. She never needs the words "surface", "budget",
  "triage", "verdict" or "breaker".
- **Marcus Webb, on-call engineer.** Read the triage history, the retry budgets and any
  repair changes behind an escalation in one place, and watch a live run without
  attaching to its process. His existing bar (verbatim evidence, no transcripts first)
  is unchanged.
- **Priya Shah, extender.** Inspect budget use and every triage decision to tune her gate
  and role configuration; consume the same facts as versioned machine-readable output;
  see what a repair changed in her check.

## Scope

### Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The floor is the team-lead's inference, refined by the
product-designer and scrutinised by the critic: roadmap Item 11's five success criteria,
each reachable by a named persona without reading the case file by hand.

| # | Criterion (roadmap) | Persona and goal | Reached by |
|---|---|---|---|
| 1 | Current state of every active surface during a run | Dana, Marcus: watch a run in progress | `delivery status`, `status --watch` |
| 2 | Budget per surface and per run | Priya: tune from budget use; Marcus: budgets at the moment of stopping | `status <id>`, `report`, `--json` |
| 3 | Triage decisions and rationales inspectable | Priya, Marcus | `status <id>`, `status <id> --decisions`, `--json` |
| 4 | Terminal outcomes summarised with reasons, across a whole run | Dana: the overnight return | `delivery report` |
| 5 | Escalation packets accessible, presenting the decision in plain language | Dana, Marcus | `report`, `status <id>` |

Four things beyond the literal criteria are in the floor, because a criterion cannot be
met for the default user without them:

- **A report over the task list, not only over a supervised run** (criterion 4). At the
  default concurrency of 1 there is no run-level record; without a list view the overnight
  owner has nothing to read.
- **Timestamps on log entries** (criteria 1 and 4). "In this step since", "finished at"
  and a time-ordered live feed are impossible without them.
- **A recorded cause on outcomes** (criteria 4 and 5). The plain headline and the "what
  to do" advice need a code, not parsed prose.
- **A durable report written when a run ends** (criterion 4, for the owner who returns
  later; it is also the artefact Item 13's scheduled runs will hand over).

Not in the floor: cost and duration, repair changes, a full-screen view, OpenTelemetry.

### MUST

1. **The read model.** One derived document per task, per supervised run and per task
   list; a pure function of the on-disk record; byte-identical for the same record. Every
   rendering below reads it. It includes the in-flight state of each task.
2. **Task-list report: `delivery report`.** The returning owner's summary: a plain
   headline, then "Needs you", "Stopped, for your engineers", "Done" and "Not started",
   each item saying who must act and what to do. [Dana]
3. **Per-task and per-run detail in `delivery status [id]`**: state, attempts, retry
   budgets per task and rolled up per run, one line per triage round, the terminal
   outcome with its reason and what to do. [Marcus, Priya]
4. **`delivery status --decisions`**: every triage round in full (trigger, verdict,
   rationale verbatim, the brief or packet it produced). [Priya, Marcus]
5. **`delivery status --watch`**: an attach-free live view, append-only lines. [Dana,
   Marcus]
6. **The plain-language block `plain`**: per stopped task,
   `{group, audience, sentence, agentSaid, next}`, built from the recorded cause and the
   log through a total phrase table, never from the packet's `decision` text. `audience`
   (owner or engineer) is how Dana tells "needs me" from "needs the engineers". [Dana]
7. **Machine-readable output for everything above**: `--json` on `status` and `report`,
   NDJSON events from `status --watch --json`, versioned as `delivery.report/1` and
   `delivery.event/1`, with a stated stability promise and a printable JSON Schema.
   Existing `status --json` shapes remain valid. [Priya]
8. **Recording additions**, all optional and additive: a time on every log entry, a cause
   on task outcomes, and the usage-limit fact on a session's terminus entry. An absent
   value renders as "not recorded", never as zero.
9. **A durable report artefact**: `.delivery/last-report.json` and
   `.delivery/last-report.txt`, written when `delivery run` or `delivery resume` ends.
   [Dana; Item 13]
10. **Degraded states handled**: no runs, a run in progress, liveness unknown, a torn or
    damaged record, records from before this phase.

### SHOULD

11. **What a repair changed** (seeded by the gate-maintenance idea; visibility only). A
    changed-file list per repair, the patch on request, and a plain note when a repair
    changed a file the check runs. [Marcus, Priya; one line for Dana]
12. **Session cost and duration**: per session, summed per task and per run, always with
    "recorded for n of m sessions" so a partial figure is never shown as whole. SHOULD
    rather than MUST because "budget" in the harness means retries, and the roadmap
    frames this item as surfacing rather than capturing. [Priya, Dana]
13. **Report text a person can forward**: `last-report.txt` is self-contained plain text
    that also reads acceptably as Markdown.

### COULD

14. A full-screen live view over the same read model (the append-only view stays the
    default and always works).
15. A self-contained HTML report.
16. A `TRACEPARENT` per run so agent-session OpenTelemetry nests under it; the harness
    itself emits nothing.
17. Cross-run trends.
18. Collapsing a long "Done" list, with a flag to expand it.
19. An agent-written plain summary at triage time (an optional `plainSummary` on the
    packet), preferred by the renderer when present.

## UX / Product

### Vision

An owner who hands the harness a list and goes to bed wakes to one answer in their own
words: what was done and landed, what needs them and what the decision is, and what to do
next. An engineer pulled in at short notice finds in one place why a task stopped. A
person watching a run sees which tasks are working, waiting or stuck without attaching to
anything. A script gets all of it as versioned data. These are renderings of one document,
so Dana's sentence and Priya's JSON cannot disagree.

One honest limit: the product reports what the harness did and decided. It does not know
whether an agent's change was a good one. Where it quotes the agent it says so, and it
never paraphrases evidence.

### Decisions on the questions the roadmap leaves open

**What is the reporting surface?** A combination over one read model: a post-run report
(`report`, the owner's front door), a point-in-time detail view (`status`), an
append-only live feed (`status --watch`) and structured output (`--json`, NDJSON). Not a
full-screen terminal interface: the return-after-hours journey is the one the roadmap
names as the trust-maker, and the live feed must work in logs, pipes and screen readers,
which the existing renderer already prizes.

**Is non-technical reporting a different view of the same data, or a summary generated at
triage time?** A different view of the same data, deterministic, with the agent's own
words quoted and labelled. In every CLI run triage is the deterministic router
(`src/cli/drive.ts`), so there is no agent at triage time to ask; a generated summary
would add a model call per escalation, be non-deterministic, be able to disagree with the
evidence beside it, and be untestable with the scripted stack. The one thing a table
cannot do is restate task-specific content; that content already exists as the worker's
own rationale and is shown verbatim under "The agent said:". Accepted risk: for a library
user who configures agent triage, the quoted text is the model's.

**How does an owner get from "a task needs your decision" to the decision and the next
step?** The report names each such task, says in fixed words what kind of stop it was and
who must act, quotes the agent, says where the work is, then gives a numbered "To act"
list using the route that actually works. That route is narrower than it looks. An
escalated or aborted task is a finished run, so `delivery resume` refuses it. Running
`delivery run` again on an unchanged list entry does not start a fresh run either: the
harness finds the earlier run by task content (`findQueueRun`) and retells its outcome,
and a one-at-a-time list stops at the same task. A fresh run starts only when the owner
amends the task wording or removes the entry (or runs an ad hoc `delivery run --task`).
The decision therefore lives in the task text: "yes" is said by changing the task, "no"
by removing it; then `delivery run`. `delivery resume <id>` is advised only for a run
that did not finish. The harness never records the owner's decision and never approves
anything for her.

### Vocabulary

Owner-facing text (`report`, and the plain block of `status`) uses only the left column.
The right column appears only in JSON, `--decisions`, `--repairs` and the technical
sections of `status`, where those words are the point.

| Say | Never say |
|---|---|
| task | surface |
| needs your decision | ESCALATED, authority-class terminus |
| stopped after 3 attempts | correction budget exhausted |
| retries, attempts | budget, slot, population |
| the check | gate, gate assertion |
| repair of the check, of the setup | gate maintenance, breaker, DEGRADED |
| the agent | worker, triage, router |

The phrase tables are closed and total over their enums, as `src/cli/output.ts`'s are
today, and one test scans every owner-facing phrase for the forbidden words.

### Commands and exit codes

One surface, extending `status` rather than adding a parallel command family.

| Command | Purpose |
|---|---|
| `delivery report [id] [--write]` | No id: the task list. With an id: that task or supervised run. Prints; `--write` also writes the artefact pair |
| `delivery report --schema` | Print the JSON Schema for `delivery.report/1` and `delivery.event/1` |
| `delivery status [id]` | Existing, same default (most recently touched). Gains in-flight state, budgets, one line per triage round, repairs, and the "To act" line |
| `delivery status --all` | Existing; each line gains the headline counts |
| `delivery status --watch [id] [--interval <s>]` | Append-only live feed, polling the record; default interval 2 s. No id: the task list, as `report` (falling back to the most recent run when the project has no list). With an id: that task or supervised run |
| `delivery status --decisions`, `--repairs` | Full triage rounds; repair patches |
| `--json` (global, existing) | One document from `status` and `report`; NDJSON events from `status --watch` |

**Exit codes, one rule.** `status` and `report` exit ok whenever the report could be
made, whatever it says. This is the existing contract (the code says whether the report
could be made, never what the run decided), and a scheduler reading `last-report.json`
relies on it to tell a broken reader from a run that needs a person; the decision is in
the document (`counts`, `plain.audience`). `run` and `resume` keep today's codes (4 when a
task needs a person). `status --watch` mirrors the code its subject ended with, so a
script can wait on it: for a task or a supervised run, the code that run ended with; for
a task list, the code `delivery run` itself ends with for a list in that state.

### What a person sees

Layout rule for all human output: one layout, plain lines, no box drawing, no columns
that rely on alignment, no cursor movement, one fact per line, so it reads correctly at 60
columns, in a pipe and in a screen reader. Times are 24-hour UTC. The text rendering
never reads the terminal width. Ids below are illustrative. Every sentence not in
quotation marks comes from a fixed phrase table; task-specific words appear only inside
quotation marks, labelled as the agent's.

**`delivery report`, a run of several tasks at once:**

```
$ delivery report

Your task list: 3 of 5 tasks completed and merged; 1 needs your decision;
1 failed after 3 attempts.
Run 20261001T020114Z, 1 Oct 02:01 to 05:47 UTC (3 h 46 min), up to 2 tasks at once.

NEEDS YOU (2)
  Task 4 of 5: "Replace the old homepage with the new design"
    Needs your decision. The agent stopped and said it could not go on without
    your say-so.
    The agent said: "Removing legacy-home.html also breaks 3 inbound links; I did
    not want to do that without confirmation."
    Where the work is: this task's changes were not added to main.
    To act: 1. Decide. To say yes, add the permission to the task wording. To say
               no, remove the task from your list.
            2. Run: delivery run
    Full account: delivery status 20261001T020114Z-4

  Task 2 of 5: "Fix the broken footer links"
    Failed after 3 attempts. The agent tried 3 times and the check you set up
    still does not pass.
    The agent said: "footer-links still reports 2 broken links after my third
    change."
    Where the work is: this task's changes were not added to main.
    To act: 1. Reword the task, or remove it from your list.
            2. Run: delivery run
    Full account: delivery status 20261001T020114Z-2

DONE (3)
  Task 1 of 5: "Add a contact form": merged into main at 02:19
  Task 3 of 5: "Update the pricing table": merged into main at 03:02
  Task 5 of 5: "Rename the About page": merged into main at 03:40

WORTH A LOOK
  A repair of the check changed a file the check runs (shared/helper.json) during
  task 2. This report shows what changed; it cannot tell you whether the change
  was safe. See it: delivery status 20261001T020114Z-2 --repairs

FOR WHOEVER TUNES THIS
  Retries used across the run: agent corrections 7 of 15; check re-runs 0 of 15;
  check repairs 1 of 2; agent restarts 0 of 25; hand-off retries 0 of 15.
  Time and cost: not recorded for 1 of 14 agent sessions; estimated cost so far
  USD 4.12 for the other 13 (an estimate from the agent runtime).
  Saved to: .delivery/last-report.txt and .delivery/last-report.json

Next: delivery status 20261001T020114Z (detail), delivery report --json (data)
```

"Where the work is" and the landing words ("merged into main", "committed on branch X",
"pull request open") are keyed on the run's pinned closer and are per task, as
`outcome.ts`'s landing table is today. A custom closer gets "Your own closer handled this
task; check what it did"; the report never says "your work was kept" or "nothing changed"
in general. "Worth a look" appears only when SHOULD 11 recorded a changed check file. The
cost line appears only when SHOULD 12 recorded something; otherwise "Time and cost were
not recorded for this run."

A task that needs an engineer is shown to Dana as not her decision, with a line she can
pass on as written:

```
STOPPED, FOR YOUR ENGINEERS (1)
  Task 6 of 7: "Update the sitemap"
    The check you set up could not be repaired automatically. This is a problem
    with the setup, not a decision for you.
    To act: pass this to whoever maintains your checks:
            delivery status 20261001T020114Z-6
```

**`delivery report` after a one-at-a-time list (the default).** The list stops at the
first task that does not close, so tasks the harness left alone have their own section:

```
Your task list: 2 of 5 tasks completed and merged; 1 needs your decision;
2 not started.
Started 1 Oct 02:01 UTC; last activity 02:58 UTC.

NEEDS YOU (1)
  Task 3 of 5: "Rename the About page" ...

DONE (2)
  Task 1 of 5: ...
  Task 2 of 5: ...

NOT STARTED (2)
  Task 4 of 5: "Add a cookie banner"
  Task 5 of 5: "Update the footer year"
  These are waiting behind task 3. The harness does not skip a task that needs
  you, so it left these alone. Amend or remove task 3, then run `delivery run`
  to carry on with them.
```

**`delivery status --watch`:**

```
$ delivery status --watch
Watching run 20261001T020114Z: 5 tasks, up to 2 at once. Ctrl-C stops watching;
the run is not affected.

Right now (02:41 UTC): 1 of 5 tasks done, 2 working, 2 waiting to start.
  Task 1 of 5: done, merged into main at 02:19.
  Task 2 of 5: working. Checking the agent's work (attempt 2; 1 retry used of 3).
    In this step since 02:38.
  Task 3 of 5: working. The agent is making changes. In this step since 02:40.
  Task 4 of 5: waiting to start.
  Task 5 of 5: waiting to start.

02:43 Task 2 of 5: the check failed again; the agent is trying once more.
02:49 Task 3 of 5: done, merged into main.
02:49 Task 4 of 5: started.
03:12 ! The setup the checks need looks broken. Holding tasks about to check or
      hand over their work while it is repaired (repair 1 of 2).
03:20 The setup is repaired; tasks carry on.
05:47 Run finished: 3 of 5 tasks completed and merged; 1 needs your decision;
      1 failed after 3 attempts. Run `delivery report` for what to do.
$ echo $?
4
```

Change lines are append-only and never redrawn. Every line begins with the time and the
task's place in the list, never colour alone. `--watch --json` emits one
`delivery.event/1` object per recorded entry instead. For a record with no times, lines
drop the time and say once "times were not recorded for this run".

The sample above is a supervised run. Watching a one-at-a-time list reads the same way,
task by task, with two differences: the opening line is "Watching your task list: 5
tasks, one at a time", and the closing line is "Your task list has stopped: ..." (or
"Every task on your list is done: ...") followed by the same headline counts. "Run
finished" is said only of a supervised run, because only that has a run of its own to
finish.

**`delivery status <id>` for an escalated task (the technical reader):**

```
$ delivery status 20261001T020114Z-4
Run 20261001T020114Z-4, task 4 of 5: Replace the old homepage with the new design
Stopped 05:12 UTC after 2 h 2 min. Outcome: escalated (authority), needs a person.

DECISION ASKED
  The worker stopped because it judged it lacked authority. Decide whether to
  grant that authority or take the action yourself.

WHAT THE HARNESS SAW (verbatim)
  <evidence, unchanged>

HOW IT GOT HERE (triage rounds; --decisions for full text)
  After attempt 1: gate_fail: reroute (correction 1/3)
  After attempt 2: authority limit: escalate (the worker reported no retry can
                   resolve this)

RETRY BUDGETS AT STOP
  correction 1 of 3, gate recheck 0 of 3, gate repair 0 of 2,
  session retry 0 of 5, close retry 0 of 3

REPAIRS
  None ran for this task.

WHERE TO LOOK
  Branch surface/20261001T020114Z-4 was kept; the working copy was cleared away.
  Session keys for transcripts: sess-8f2a, sess-91c0
  Everything this run recorded: .delivery/runs/20261001T020114Z-4

TO ACT
  Decide. To say yes, put the permission in the task wording; to say no, remove the
  task from your list. Then: delivery run
  (An unchanged task on the list is not run again: `delivery run` would retell this
  outcome. `delivery resume` does not apply: this run is finished.)
Next: delivery status 20261001T020114Z-4 --decisions, delivery report
```

The packet rendering at the top is the existing one, kept as is. `--decisions` prints
each triage round in full: after which attempt, what set it off, the verdict, the
rationale verbatim, and the brief or packet it produced, so Priya sees exactly what the
next worker was told. `--repairs` prints each repair's changed files and patch; a patch
over the recorded cap prints "patch too large to keep; the list of files is above".

**Repair visibility (SHOULD).** `status` shows one line per repair: `Repair 1 (of the
check, attempt 1 of 2) changed 2 files, +14 -3: shared/helper.json (the check runs this
file), notes.txt`. The wording says a repair changed a file the check runs, and nothing
about whether that was safe.

**The same data for two readers:**

| Question | Dana reads (`report`) | Marcus and Priya read (`status`, JSON) |
|---|---|---|
| Why did task 2 stop? | "Failed after 3 attempts. The agent tried 3 times and the check you set up still does not pass." | `outcome.cause = {kind: budget, population: correction}`; budgets row `correction 3/3`; the rounds |
| What did triage decide? | Not shown except as the result | Each round: trigger, verdict, rationale verbatim, brief or packet |
| What did it cost? | One estimate line, if recorded | Per-session `usage`, "recorded for n of m" |
| What did a repair do? | One "Worth a look" line | File list, counts, patch, `touchesCheck` |

### Form factors

| Form | Behaviour |
|---|---|
| Wide or narrow terminal | The same single layout; wrapping is left to the terminal. No width-dependent variation, so output is reproducible |
| Non-TTY or piped | Identical text, no colour. Nothing switches format on its own; only `--json` changes format |
| `--json` | One document (`status`, `report`) or NDJSON events (`--watch`); never coloured; prose on stderr only |
| `--no-color`, `NO_COLOR` | Honoured by the existing `useColour` rule. Meaning is carried by words and a leading `!` on attention lines |
| Durable artefact | `.delivery/last-report.txt` (no patches, safe to paste into a message) and `.delivery/last-report.json` |
| Library | The read model and schemas are exported, so Items 13 and 14 and adopters' dashboards reuse them |

### Navigation

Every human output ends with a `Next:` line naming real commands. The end of
`delivery run` (today's `EVERY_TASK_DONE` and `STOPPED_PART_WAY` lines in `queue.ts`)
gains the headline sentence and points to `delivery report`. `report` points each item at
`delivery status <id>`; `status <id>` points at `--decisions`, `--repairs` and back to
`report`; `--watch` ends by pointing at `report`. A finished task that needs a person is
always advised "amend the task or remove it from your list, then `delivery run`", never
`resume`; an unfinished or killed run is advised `delivery resume <id>`.

### Empty and error states

| State | What the person sees |
|---|---|
| No runs yet | "No runs yet in this folder. Start one with: delivery run". Exit ok |
| No task list but runs exist | `report` falls back to the most recent run and says so in one line |
| Run in progress | "This run is still going (5 tasks: 1 done, 2 working, 2 waiting). Last activity 02:41. Follow it: delivery status --watch". Never a final-sounding headline for an unfinished run |
| Unfinished run, liveness unknown (one task at a time) | "This run has not finished. Last activity 02:41 UTC; nothing records whether it is still going. If it is not, carry on with: delivery resume <id>". Never guessed. `--watch` keeps waiting |
| Unfinished run of several tasks, not live | "This run stopped part way. To carry on: delivery resume <id>". `--watch` ends with that sentence, exit ok |
| Half-written record | A torn final journal line is dropped and the state one entry earlier is shown; the next read catches up |
| Damaged record | That one task reads "The record for task 3 is damaged (file named); the other 4 tasks are reported below". The report is marked incomplete in its top line and in `--json`; the read exits ok. Never a stack trace |
| Records from before this phase | Rendered from what exists; each missing fact says "not recorded"; no invented advice |
| Report file cannot be written | The run's outcome is unaffected; `report` still prints; one line says the file was not saved and why |

### Accessibility

No spinners, redraws, box drawing or alignment-dependent columns. Section headings are
plain capitalised lines; each line stands alone (the `Task N of M` prefix repeats rather
than relying on position). Watch output is append-only, so a screen reader never has to
re-read the screen. Tone is carried by a word or a leading `!`; colour is decoration.
Reading order is the point first, then detail. Missing data reads "not recorded", never a
blank or a zero.

### Success metrics

Measured by scripted acceptance tests and, once a human reviews, by UAT; the harness
collects no telemetry.

- **Time to the answer (Dana):** one command, and the first screen of its output says
  what landed, what needs her and what to do.
- **Coverage of "what to do":** every stopped task in a report carries an audience and a
  "To act" line with a real route; no advice to `resume` a finished run and none to "just
  run again" for an unchanged listed task.
- **No harness vocabulary in Dana's text:** the forbidden-word scan passes over every
  phrase in `report` and in `plain`, the "For whoever tunes this" block included.
- **Criteria reachability:** each of the five roadmap criteria is answered by a named
  command without opening `log.jsonl` or `case.json`.
- **Determinism and honesty:** the same record renders byte-identical output; every
  missing fact renders "not recorded".
- **Machine contract:** the schema goldens pass; fixtures of existing `status --json`
  consumers still parse.
- **Priya's question:** "which retry budget ran out, on which tasks, after which triage
  rounds" is answerable from one command, in text and in JSON.

## Architecture

### 1. Where reporting lives

- **Library first.** A `src/report/` module owns the read model and the document schema,
  exported from `src/index.ts`. Today the derivation lives inside `src/cli/`
  (`outcome.ts`, `status-command.ts`), where a library user cannot reach it; the read
  model lives in the library and `src/cli/` renders it.
- **CLI.** `delivery status` is extended; `delivery report` is the one new command.
- **Files on disk.** `.delivery/last-report.json` and `.delivery/last-report.txt` are
  caches of a pure function of the record. Nothing reads them back as truth.
- **The live view reads the on-disk record; it is not a renderer over an in-process
  event stream.** The person who comes back, a second terminal, and Item 13's scheduler
  are all different processes from the one driving the run. The record is already
  crash-safe and append-only, so a live run, a finished run and a crashed run report
  through one code path. The in-process `RunReporter` (`src/cli/report.ts`) stays exactly
  as it is, as the driving process's own console.
- **TTY versus piped.** The existing stance holds: no cursor movement, spinners or box
  drawing. `status --watch` appends change lines on a TTY and when piped alike.

### 2. Liveness

Whether a run is going is not in the record. The one existing signal is the repository
lock (`repoLocked`, `src/cli/repo-lock.ts`), and it is taken only when concurrency is
above 1; a one-at-a-time list and a single `--task` run take none. So at the default
concurrency nothing outside the process can tell a running task from a killed one.

The document carries `live: true | false | null`: `true` and `false` mean a run of
several tasks does or does not hold the lock; `null` means not determinable. It is never
guessed from file ages. What the record does give, once entries carry a time, is
`lastActivityAt`, stated as a fact for the reader to judge. No heartbeat and no new lock
is added: either would put writes on the hot path or change the concurrency-1 behaviour
this phase must not touch.

`--watch` follows from that. With `live` true, or null with no outcome, it polls until an
outcome is recorded or the user stops it; for null it says once that nothing can tell
whether the run is still going, and never exits on a guess. With `live` false and no
outcome (a killed run of several tasks) it says the run stopped part way and how to carry
it on, and exits ok, since there is no outcome to mirror.

**When a watch ends** depends on its subject:

| Subject | Ends when | Exit code | `stream_ended` carries |
|---|---|---|---|
| One task (an id of a single run) | That run records an outcome | The code that run ended with | The task's outcome |
| A supervised run (an id, or a list whose tasks a supervised run claimed) | The run records its outcome | The code that run ended with | The run outcome and `counts` |
| A one-at-a-time task list (`kind: list`, no run file) | Every task on the list has closed, or a task records an outcome that is not closed (the list stops there, as `queue.ts` stops it) | The code `delivery run` ends with for a list in that state | `counts` and the standing of the task that stopped the list, or `null`; no run outcome, because there is no run |

A one-at-a-time list has a moment between tasks when one has closed and the next has not
started. That is not an ending: the watch keeps waiting, and if the driving process died
in that gap it waits until the user stops it, for the reason above (liveness is `null`
and is never guessed).

### 3. The read model

```
loadSnapshot(repoPath, subject, { live })  // the only I/O: case.json, log.jsonl, run.json, refs
   -> RecordSnapshot                       // plain data
deriveReport(snapshot)                     // pure, total, deterministic
   -> ReportDocument                       // zod-defined, versioned
renderText(doc, { colour })                // pure; phrase tables
eventsOf(snapshot)                         // pure; ordered ReportEvent[]
```

The only inputs besides the record are `live` and, for `kind: list`, the resolved task list from configuration, both passed in. `now` is never read: elapsed times are
differences between recorded times, and a run still going shows "last activity at T",
not "idle for N minutes". The snapshot loader resolves every ref the document needs
(packet, triage artefacts, repair changes) so that `deriveReport` does no I/O; today
`summariseOutcome` and `packetOf` interleave reads and rendering, and they are split.

Derivation reuses the folds that resume uses, and adds none in parallel:
`deriveStateFromEntry`, `deriveBudgetsFromLog` (the log wins over a possibly stale
cursor), `setbackOf`, `tripsOf`, `repairsUsed`, `breakerOf`, `claimedBy`,
`supervisedView`. A second fold could disagree with resume; the reporting fold is the
resume fold.

`ReportDocument` (`src/report/document.ts`) is a superset of today's `RunStatusDocument`
and `SupervisedStatusDocument`: every existing key keeps its name, type and meaning. All
keys are always present, with `null` or `[]` where they do not apply.

- `schema: "delivery.report/1"`, `kind: "task" | "run" | "list"`, `live`, and an
  incomplete marker naming any damaged record.
  - `task`: one run of one task.
  - `run`: one supervised run of several tasks (a `run.json` exists).
  - `list`: the project's task list as the owner experiences it. It is derived from the
    configured task list plus the latest record per task (`findQueueRun`, content match),
    exactly as `status` counts queued tasks today. No run object is invented and the
    concurrency-1 behaviour is untouched. A config that will not load yields a report
    with no list annotation, never a refusal.
- `counts`: per standing, the facts the headline sentence is built from. Standings are
  the existing `closed, escalated, aborted, paused, unfinished, queued`, plus
  `not_started` for a task left alone behind one that did not close. `queued` keeps its
  meaning (waiting for a slot in a live run).
- `run` (for `kind: run`): id, `startedAt`, task count, concurrency, `breaker`, `outcome`,
  `finishedAt`, `reason`, `cause`, `lastActivityAt`, the run-level repair budget.
- `surfaces[]`, one per task: the existing fields, plus
  - `states[]`: ordered `{state, at|null}` visits derived from the log;
  - `budgets`: five `{population, used, max}` rows; the run's roll-up sums `used` per
    population and adds the run-level repair cap;
  - `attempts`: worker dispatches;
  - `usage`: `{costUsd, durationMs}` summed over recorded sessions or `null`, with
    `usageRecorded` (n of m sessions);
  - `decisions[]`: one per `TriageEntry`: `afterAttempt`, `trigger`, `verdict`,
    `rationale` verbatim, and the brief or packet resolved from `artifactRef`;
  - `repairs[]` (section 7);
  - `escalation`: the verbatim `EscalationPacket` or `null`, and `plain` (section 6).
- `trips[]` (existing) carries each repair attempt's changes.

### 4. What is newly recorded

Every addition is optional, which is this repository's standing convention for schema
growth (`closerRef`, `roleOverrides`, `notRun`, `packetRef` and `role` all arrived this
way). No new entry kind is added. A reader renders an absent value as "not recorded".

```ts
// src/schema.ts
const At = z.string().datetime();                        // ISO 8601, UTC

// every HistoryEntry variant and every RunEntry variant gains:
at: At.optional()

export const SessionUsage = z.object({
  costUsd: z.number().nonnegative().optional(),          // SDK total_cost_usd, an estimate
  durationMs: z.number().int().nonnegative().optional()  // SDK duration_ms
});
// TerminusEntry, the run log's repair_terminus, and TriageEntry gain:  usage: SessionUsage.optional()
// TerminusEntry gains:  limit: UsageLimit.optional()    // a usage limit stopped the session

export const OutcomeCause = z.object({
  kind: z.enum(["authority", "repair_gave_up", "session_not_run", "budget", "triage_failure",
                "triage_escalated", "triage_abort", "provisioning"]),
  role: z.enum(["worker", "gate-maintenance"]).optional(),                       // authority, session_not_run
  population: z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]).optional(), // budget
});
// CaseFileOutcome gains:  cause: OutcomeCause.optional()

export const RepairChanges = z.object({                 // the artefact behind changesRef (section 7)
  files: z.array(z.object({ path: z.string(), status: z.enum(["added", "modified", "deleted", "renamed"]),
                            added: z.number().int(), removed: z.number().int(),
                            touchesCheck: z.boolean(),
                            patch: z.string().optional() })),  // absent: binary, or over the cap
  truncated: z.boolean(),
});
// TerminusEntry (role gate-maintenance) and the run log's repair_terminus gain:  changesRef: z.string().optional()
```

**Time.** `appendEntry` (`src/case-file.ts`) and `appendRunEntry` (`src/run-file.ts`) are
the only two writers of a log line, so they own the stamp and no call site changes. No
decision reads `at`, so replay and resume are unaffected. The harness's own test suites
compare log entries exactly in about 45 places; the property this design fixes is that
such comparisons are modulo `at`, through one shared test helper, and that tests needing
times fake only `Date`.

**Cause.** `EscalationCause` (`src/ports.ts`) exists only in memory today, and abort
sites hold nothing comparable. `escalate()` and `abort()` in `src/surface.ts` each take
the `OutcomeCause`, and the mapping is explicit per site:

| Site | `cause` written |
|---|---|
| Authority terminus (`escalateFromTail`, and the terminus-recording edge that routes to ESCALATED) | `authority` + `role` |
| Repair session escalate | `repair_gave_up` |
| `escalateIfNotRun` | `session_not_run` + `role` |
| The two budget-at-cap sites (`dispatchOwnRepair`, the terminus-retry edge) | `budget` + `population` |
| `triage()` escalate verdict carrying a cause (the deterministic router always sets one) | that cause, mapped to the kinds above |
| `triage()` escalate verdict with no cause and an agent-written packet | `triage_escalated` |
| `triage()` escalate verdict whose packet fell back to the failure packet | `triage_failure` |
| `triage()` abort verdict (unreachable from the CLI; library agent triage only) | `triage_abort` |
| Provisioning abort | `provisioning` |
| `closed()` | none |

Run-level escalation needs no new code: `RunOutcome.escalated.cause`
(`shared_environment | usage_limit`) is already persisted and the report passes it
through. A task-level usage limit is not a cause kind either: today the limit is returned
on the in-memory terminus and never persisted, so the task spends its session-retry
budget and ends as `budget` + `terminus`. Recording the fact on the terminus entry
(`limit`) lets the report say "stopped because your usage limit was reached" without a
parallel cause.

A crash between triage writing its round ref and the outcome being written is resumed by
`escalateFromTail`, which cannot recompute a cause that was never persisted. So
`triage()` writes the cause into its round ref, beside `trigger`, `rationale` and
`artifact`, and the resume path reads it back. A record with no cause is grouped as
"stopped" (section 6) and given no advice the record cannot back.

**Usage (SHOULD).** `invoke()` (`src/agent-invoke.ts`) fills `usage` from the SDK result
message and carries it on the terminus the `AgentPort` returns. `costUsd` is
`total_cost_usd`, which the SDK documents as cumulative per `query()` call and covering
subagents and sidechains; the harness never resumes a session, so each invoke's figure is
that session's own. The SDK's `usage` token field covers the main loop only and is not
used. The figure is an estimate and is labelled so.

**Deliberately unrecorded:** per-model token counts, prompts, transcripts. The packet's
`references` already carry session keys for finding a transcript.

### 5. Reading while a run writes

Readers take no lock; if they did, `status` would refuse during a run. The record's
existing write discipline makes that safe:

- `case.json` and `run.json` are replaced whole by rename (`atomicWriteJson`), so they
  are never half-read.
- Journals are append-only. `parseLines` already drops an unparseable final line and
  throws only for an interior one, so a torn tail yields the state one entry earlier. An
  interior bad line is real damage and is reported by name (`CorruptCaseFile`).
- `outcome` is written last, after the final log entry. The loader reads `case.json`
  first, then the log: if it saw an outcome the log is complete; if not, the log may be
  newer than the cursor, which is harmless because derivation uses the log. The
  supervised view reads `run.json`, the run log, then each task's record, for the same
  reason. A snapshot may be a moment stale; it is never torn or self-contradictory.
- A run is tens to low thousands of lines and derivation is linear in entries. `--watch`
  re-reads a source only when its size or modification time changed, and emits only
  entries past a per-source cursor held in memory. No index, cache or database.

### 6. Plain language

Dana's summary is a deterministic view of data that already exists. Nothing is generated
at triage time and no new prose is stored.

Marcus reads the verbatim `EscalationPacket` as today. Dana's `plain` is its own total
phrase table, never a quotation of the packet's `decision`:

```
plain = { group, audience, sentence, agentSaid, next }
```

| `group` | When | `audience` | Report section |
|---|---|---|---|
| `needs_your_decision` | `authority`; `triage_escalated`; `session_not_run` (a credential only the owner can supply) | owner | Needs you |
| `failed_after_attempts` | `budget` on `correction` or `terminus` | owner (reword or drop the task) | Needs you |
| `abandoned` | `triage_abort` | owner | Needs you |
| `needs_an_engineer` | `budget` on `gateError`, `gateMaintenance` or `close`; `repair_gave_up`; `triage_failure`; `provisioning` | engineer | Stopped, for your engineers |
| `stopped` | no cause recorded | unknown: the verbatim `reason` only, no advice | Stopped, for your engineers |

"Done" is the standing `closed`; "Not started" is the standing `not_started`. `group` is
the machine key and the sentence's selector; the section is a rendering of `audience` and
standing. Both are in the document.

- `sentence`: fixed per group and, within it, per last setback (`setbackOf`). "N attempts" is the count of worker dispatches in the log, not the budget cap, so it can exceed the cap by one (the first dispatch is not a retry).
- `agentSaid`: the agent's own last rationale, quoted and labelled. This is the only
  place agent words reach Dana.
- `next`: keyed on `group` and on whether the run is finished, following the re-run
  semantics in "Decisions" above. For a stopped run of several tasks, `delivery run`
  carries on the held tasks, which have no outcome of their own.
- "Where the work is" states only what the pinned closer type guarantees for that task.

Records from before this phase keep rendering exactly as today for Marcus; Dana's `plain`
for them falls to `stopped`. No migration and no rewrite of old records.

### 7. Repair visibility (SHOULD)

Visibility only. Whether a repair weakened a check is not judged, and nothing is
approved or refused.

- After a gate-maintenance session ends and before its terminus entry is appended (the
  ref-before-entry ordering `triage()` already uses, so a crash leaves at most an orphan
  ref that the re-run overwrites), the harness captures the working copy's change against
  its commit: tracked changes, and untracked files rendered as new-file patches. A repair
  that adds a new check file is exactly the case to surface, and a plain diff omits it.
- One helper serves both repair sites (a surface's own repair, and the run-level repair,
  whose session runs in the tripping task's working copy), through `src/git-exec.ts`. It
  is read-only: it stages nothing, so it cannot change what the closer later commits. It
  runs before the closer, so it is independent of which closer a project uses.
- The capture lands in one `RepairChanges` ref named by `changesRef`. Patches are capped
  at 256 KiB in total; a file past the cap, or binary, keeps its path, status and counts
  and omits `patch`, and `truncated` says so.
- `touchesCheck` is a fact about paths: the changed path equals a custom gate's
  `modulePath`, or the command gate's first token where that is a path in the working
  copy. It is not a verdict about weakening.
- A record with no `changesRef` reads "what this repair changed was not recorded"; an
  empty capture reads "changed no files".

### 8. Machine-readable shapes and the stability promise

Two documents, both zod-defined in `src/report/`, both carrying `schema`:

- **`delivery.report/1`**: the point-in-time document of section 3.
- **`delivery.event/1`**: one NDJSON line per recorded entry, produced by `eventsOf`:
  `{schema, run|null, surface|null, seq, at|null, type, ...payload}`, where `type` is one of
  `stream_started, run_started, surface_state, budget_spent, triage_decision,
  repair_started, repair_finished, breaker_changed, surface_outcome, run_outcome,
  stream_ended`. The first line is `stream_started` and the last is `stream_ended`
  (section 2 says what it carries per subject), so a reader knows when to stop without
  watching the process. For a task list, `run` is `null` on list-level events and each
  task's events carry that task's own run id. `seq` is the
  entry's position in its source journal. Events are one-to-one with log entries, not
  differences between documents, so replaying a finished run emits the same events as
  watching it live. Order across tasks is by `at` where present, falling back to journal
  order for old records; within one task it is always exact.

The promise:

1. Within a major (`/1`), keys are never removed, renamed or re-typed and enum values are
   never removed. New keys and enum values may appear; consumers ignore unknown keys and
   treat unknown enum values as "other". The JSON Schema marks enums open.
2. A breaking change is a new major, served only behind an explicit opt-in.
3. The existing `status --json` shapes are grandfathered into `/1` unchanged.
4. The in-process step records of `run --json` (`StepRecord`, `SurfaceStepRecord`,
   `RunEventRecord`) are shipped and unversioned; they stay exactly as they are, as the
   stream of the driving process, and carry no promise.
5. Strings meant for people (`summary`, `plain`'s sentences) are outside the promise.
   Consumers must not parse prose.

`delivery report --schema` prints a JSON Schema generated from the zod schemas, so types,
runtime validation and the published schema have one source.

**Library exports** (`src/index.ts`): `loadSnapshot`, `deriveReport`, `eventsOf`,
`renderText`, the schemas and inferred types, and the JSON Schema. Reporting is extended
by composition over these documents, not by a reporter plugin interface: gate and closer
plugins exist because they run code inside the delivery; a report consumer runs outside
it.

### 9. The report artefact

When `delivery run` or `delivery resume` ends, after the outcome is recorded, the run
process writes `.delivery/last-report.json` and `.delivery/last-report.txt` for the
subject it just ran, replacing the previous pair. `report --write [id]` writes the same
pair for any other subject. One fixed path means a scheduler or a person never has to
find the newest run folder, and there is no per-run copy to keep in step. The files are
written by rename, mode `0600`, inside `.delivery/`, which ignores itself in git. A crash
before the write leaves none, and `report` still answers from the record.

### 10. Security

There is no new trust boundary, credential or network egress. A report can leak what the
record already holds: gate output, agent rationales, paths, session keys, and now repair
patches. Any of these can contain a secret an agent or a test printed.

- **No redaction at record time, deliberately.** Redacting evidence would undermine the
  verbatim-evidence guarantee and could hide the thing an on-call engineer needs;
  redaction by pattern is unreliable as a promise. A report adds nothing the record does
  not hold. The repair patch is the only newly recorded free text; it is bounded and held
  at the case file's trust level.
- **Detail is opt-in.** Patches and full triage artefacts appear only with `--repairs` and
  `--decisions` in text, and as recorded fields in JSON. `last-report.txt` omits them;
  `last-report.json` carries them. A report is as sensitive as the case file.
- **Untrusted text in the terminal.** Evidence and rationales are agent- and
  gate-produced. The text renderer strips ESC and the other C0 and C1 control characters
  from quoted fields, keeping newline and tab, so a gate cannot rewrite the owner's
  screen. JSON output and the record are never altered.

### 11. Non-functional requirements

- **Determinism.** The same record, task list and `live` value give byte-identical text and JSON.
- **Accuracy.** A report never states a figure it cannot derive; partial sums say how
  many sessions they cover.
- **Read cost.** No worse than today's `status`.
- **Compatibility, forward (guaranteed).** A new build reads every old record. Existing
  `status`, `status --all` and `status --json` keys and exit codes are unchanged.
- **Compatibility, backward (best effort).** An older build reading a newer record still
  reads log entries, because entry schemas strip unknown keys and log lines are never
  rewritten. It is not lossless: `case.json` and `run.json` are rewritten whole, so an
  older build that updates a record drops document-level additions such as
  `outcome.cause`. That is why this phase adds no entry kind, and stamps `cause` only
  when the outcome is written, after which a normal run rewrites nothing.

### 12. Telemetry and export formats

No OpenTelemetry or other exporter in this phase. The NDJSON event stream and
`ReportDocument` are the export contract.

- OpenTelemetry needs a collector and a long-lived process to batch and flush. The
  harness is a short-lived CLI with no daemon, and its primary readers read after the
  process has gone; spans would be a second, lossy copy of a record that is already
  complete.
- The roadmap asks for structured output so "adopters can build their own dashboards or
  integrate with existing observability tooling". A stable NDJSON stream is what generic
  log shippers and `jq` ingest directly.
- The agent runtime the harness spawns emits its own OpenTelemetry, and the owner's
  environment (including `OTEL_*`) already passes through to it
  (`src/cli/agent-session.ts`). That end-to-end export works is assumed from the
  research, not run here.
- The harness's own vocabulary has no semantic convention; the GenAI conventions are all
  at Development status (research C.4).
- An exporter, if wanted later, is a consumer of the stream outside this package. Item
  14's push model is where it is revisited.

The harness collects no analytics about its own use.

### 13. Testing

Every report is tested deterministically on the existing scripted stack; no real agent,
network or clock.

- **Fixtures are real records from real runs.** `runSurfaceAgainstMock` and
  `runSupervisorAgainstMock` drive the production driver, router, gate and closer against
  a `MockScript` and leave genuine case and run files. Scenarios: closed; escalated by
  authority; escalated by budget per population; aborted in provisioning; a trip with a
  repair that succeeds; a trip with the repair given up; a usage-limit stop; several
  tasks at once with mixed standings; a sequential list that stops at its second task
  (reports `kind: list` with no run file).
- **Goldens** of text and JSON per scenario, with `Date` faked. `deriveReport` is also
  tested directly on hand-built snapshots.
- **Live-read and crash cases:** a record truncated mid-final-line; an absent outcome;
  `case.json` newer than the log and the reverse.
- **Old records:** fixtures from before this phase read, and render "not recorded",
  never `0`, `NaN` or a throw.
- **Event stream:** `eventsOf(record)` equals the events emitted by `--watch` polling the
  same record grown entry by entry.
- **Promise:** schema goldens fail if a key disappears; a document with an extra key
  still parses; every scenario's output round-trips through the schema.
- **Control-flow non-regression:** the existing surface, supervisor and status suites
  hold; the schema additions are asserted not to alter `deriveStateFromEntry` or
  `deriveBudgetsFromLog` on any existing fixture.
- **Vocabulary:** every `plain` sentence, for every cause, group and closer type, is free
  of the forbidden words; the phrase tables are total by type-check.
- **Repair capture:** a scripted repair that edits a tracked file, one that adds an
  untracked file, and one that does both; the cap truncates; an empty repair records an
  empty list.
- **Usage:** `AgentPort` results with non-zero usage prove the sums and the "n of m"
  label. Capturing usage from a real result message needs the vendored mock to accept a
  scripted `usage` on a reply (today it emits constant zeros); that small additive change
  belongs to the SHOULD tier with usage capture itself.
- **Terminal safety:** control characters in evidence are stripped in text, newline and
  tab survive, and JSON keeps them escaped.

### 14. Extensibility

- **Item 12 (task packs):** a pack's fix phase is more tasks and more events; no new
  report type. A pack tags tasks through `taskDef`, which the document echoes.
- **Item 13 (local scheduling):** a scheduled run is a normal run, so it leaves the same
  `last-report` pair. A missed run is a scheduler fact, not a run fact, and is not forced
  into this schema. `OutcomeCause` and `audience` are what a scheduler decides
  notification on.
- **Item 14 (triggers):** push delivery consumes the document or the stream; the `schema`
  version lets a receiver pin `/1`.
- Cross-run trends are a pure function over several documents. A full-screen view is a
  second renderer over `deriveReport`. `plainSummary` is an optional packet field.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Deriving states, budgets, trips and standings | **Reuse estate**: `deriveStateFromEntry`, `deriveBudgetsFromLog`, `tripsOf`, `supervisedView` | A second fold for reporting | A second fold could disagree with resume |
| Crash-safe, live-readable record | **Reuse estate**: `journal.ts` | SQLite or an event store | The write discipline already gives a reader a consistent view; a database is a second source of truth and a native dependency |
| Live view | **Build**, small: poll, per-source cursor, append lines | `fs.watch`; `chokidar` | `fs.watch` is unreliable on network and some container filesystems and would need a poll fallback anyway; `chokidar` solves directory trees, and this watches two files per task |
| Full-screen live view | **Deferred** (COULD); if built, **buy** `ink` (estate precedent: autoloop's console) as an optional separate entry point | Hand-rolled ANSI redraw; `log-update`; `listr2` (task-tree model does not fit; already rejected by the CLI design); `blessed` (unmaintained) | The accessibility stance forbids cursor movement by default, so no MUST need exists; hand-rolling redraw is the commodity smell |
| Colour and tone | **Reuse estate**: `paint`, `useColour` | `chalk`, `picocolors` | Already solved and tested |
| Plain-language wording | **Reuse estate**: total phrase tables, as `output.ts` | A model-generated summary at triage | Deterministic, free, testable, cannot contradict the evidence |
| Document schema and JSON Schema | **Reuse estate**: zod 4 (already a dependency) and its `z.toJSONSchema` | `ajv` with a hand-written schema; `typebox` | One source for types, validation and the published schema |
| Event stream format | **Reuse convention**: versioned NDJSON with start and end markers (as Terraform and Cargo do; research C.4) | Custom framing; server-sent events | It is what `run --json` already emits and what `jq` and log shippers ingest |
| Cost and duration | **Reuse**: the SDK result message's `total_cost_usd`, `duration_ms` | Counting and pricing tokens | Hand-pricing goes stale with every price change |
| OpenTelemetry export | **Not built** (section 12) | `@opentelemetry/*` in the CLI | Needs a collector and a long-lived process; the agent runtime already emits its own |
| Report layout | **Reuse estate**: line-oriented text, as `statusReport` | `cli-table3`, `marked-terminal` | Tables regress logs and screen readers |
| Repair change capture | **Reuse estate**: git through `git-exec.ts` | A file-hash snapshot; copying the working copy | Git is already the diff engine for the repository the repair edits |
| Liveness | **Reuse estate**: `repoLocked`, plus `lastActivityAt` | Heartbeat or pid file; a file-age guess; locking one-at-a-time runs | A heartbeat adds hot-path writes; a guess is non-deterministic; locking changes behaviour this phase must not touch |
| Report artefact write | **Reuse estate**: the `atomicWriteJson` pattern | Writing in place | Rename gives readers all or nothing |
| Stripping terminal control characters | **Build**: one regular expression | `strip-ansi` | A closed set in one function; a dependency is heavier than the code |
| Model and view kept apart | **Reuse estate (pattern)**: the owner's autoloop separates its console model from its views (research C.3) | One module mixing derivation and rendering, as `outcome.ts` does today | The estate precedent has the same shape; only the structure is shared, not code |
| HTML report | **Deferred** (COULD); a pure render over the document | Markdown; a templating library | Dana is terminal-first; `last-report.txt` is the forwardable artefact |
| JUnit XML, CTRF | **Not built** | `junit-report-builder`; `ctrf` | Escalations, budgets, triage and repairs have no place in a test-result schema |
| Dashboards, hosted UI, daemon | **Not built**: non-goal | Vendor adapters | The stable documents are the integration point |

No dependency is added for the MUST or SHOULD tiers.

## Operability / DX

**Environment.** Reporting is a capability of the existing `delivery` CLI (Node 22 or
later, TypeScript ESM, commander) and the library behind it. There is no service, daemon
or database. It reads `.delivery/` inside the target repository, so it runs wherever
`delivery` runs, offline and without credentials.

**Harness.** The one that exists: `vendor/claude-mock` through `mock-session.ts` and
`mock-script.ts`, driven by `runSurfaceAgainstMock` and `runSupervisorAgainstMock`. A
developer proving a report writes the same `MockScript` as for any other behaviour and
asserts on the document or text produced from the real record it left. There is no
reporting-specific mock vocabulary, and nothing inside a report reads the real clock.

**Scaffolding.** No `init` change and no configuration key. Reporting works on any
existing record, including those from before this phase. `delivery validate` is
unaffected. Extenders get the schemas and `delivery report --schema` rather than prose
lists of key names, and a section in `docs/` stating the stability promise.

**Local-run story.** A developer looks at a run the way an owner does: `status`, or
`status --watch` in a second terminal while `run` is going; `report` for the artefact;
`--json` for a script. A reporting demo on the scripted stack sits with the existing
demos, so the output can be seen with no agent and no API key. Because reports are pure
over the record, a failing case a user hits is reproduced from a copy of their
`.delivery/runs/<id>` folder; no run is needed to debug a report.

**Deploy target.** The npm package `delivery-service` (bin `delivery`, exports `.` and
`./testing`) is the only artefact, and this phase ships inside it. Nothing is hosted.

**Verification.** `npm test` (lint, build, vitest) is the single gate; reporting adds
goldens to it and needs no extra environment.

## What this design does not include

- **Task packs** (Item 12).
- **Scheduling, triggers and missed-run detection** (Items 13 and 14). This phase only
  guarantees that the report they will hand over exists and is stable.
- **Notifications or paging**: pushing a report to email or chat.
- **A hosted dashboard, web console or daemon.**
- **Owner approval of a repair, and refusing a repair that drops or empties
  assertions.** These are the control-flow directions of the seeding idea; this phase
  only shows what a repair changed.
- **Any judgement of whether a repair weakened a check.**
- **Changing what triage decides, wiring agent triage into the CLI, or any new agent
  call.**
- **A heartbeat or lock for one-at-a-time runs**; their liveness stays unknown and is
  reported as such.
- **Versioning the existing `run --json` step stream.**
- **Redaction of evidence.**
- **A reporter plugin interface.**
- **Per-model token counts, prompts or transcripts in the record.**
- **Licence choice and first publication** (human-gated).

## Assembly resolutions

Decisions the team-lead took when compiling this document from the two approved
artefacts, recorded for the spec-reviewer:

- **`TerminusEntry.limit` is MUST-tier.** The architecture specifies it; the product
  design's MUST 8 lists only `at` and `cause`. It is a fact about why a task stopped,
  already held in memory, and the plain sentence for a usage-limit stop depends on it, so
  it sits with `cause`.
- **`touchesCheck` is a field of each `RepairChanges` file.** The architecture describes
  the tag in prose but omits it from the schema block; the product design relies on it.
- **The `stopped` group renders under "Stopped, for your engineers".** Both artefacts
  agree; it is stated once in the section 6 table.
- **`status --watch` over a one-at-a-time list** (spec review, round 1). Neither artefact
  said what a bare `--watch` watches at the default concurrency, where each task is its
  own run. It watches the task list, as `report` does, and section 2 states the ending
  rule, exit code and `stream_ended` payload per subject.
- **The forbidden-word list** is the union of the two artefacts' lists (the vocabulary
  table's right column, and "budget", "gate", "triage", "authority", "surface",
  "terminus", "repair session", "escalat").
- **`status --json` carries the report document under `report`** (slice 5 plan). Section 3
  calls `ReportDocument` a superset of the two shipped `status --json` shapes, but two keys
  collide: a single run's top-level `run` is the run id (a string) where the document's `run`
  is the run block, and a supervised run's `surfaces` holds only the tasks with a record,
  each a `RunStatusDocument`, where the document's holds one entry per task with nulls. A
  top-level merge would re-type a shipped key, which section 8 forbids. So `status --json`
  prints the shipped keys unchanged plus one new key, `report`, holding the
  `delivery.report/1` document for the same subject: the document keeps the key names this
  spec gives it, `report --json` and `status --json`'s `report` are identical, and nothing
  shipped changes. `status --all --json` stays the shipped array.

## Open questions

None blocks the design. Assumptions a human may want to revisit:

1. **The derived minimum scope** (the MUST tier) is assumed, not human-confirmed.
2. **Cost capture is SHOULD.** If "budget consumption" in the roadmap is meant to include
   spend, capability 12 moves up; the design already carries it.
3. **On-demand report plus a file, rather than a push notification**, is assumed to be
   what a returning owner wants. Item 13 may add notification.
4. **"Failed after N attempts" and "needs your decision" are two phrasings of one
   escalated standing.** This is a presentation choice; exit codes and standings are
   unchanged.
5. **The list report is derived from content identity** (`findQueueRun`). If that
   matching rule is ever replaced, the list report follows it.
6. **The persona goal extensions** in `docs/personas.md` are assumed.
