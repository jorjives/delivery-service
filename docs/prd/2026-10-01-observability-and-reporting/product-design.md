# Product design: Observability and Reporting (Roadmap Item 11)

Status: draft for critic review. Grounded in `research.md` (cited `research §n`),
`architecture.md` (cited `arch §n`; command names and shapes agreed with the
architect), `review-log.md`, `docs/personas.md`, and roadmap Items 11 to 14. Style and
altitude follow `docs/prd/2026-09-26-multi-surface-supervisor/product-design.md`. This
describes the product as it will exist, not the order of building it.

## Vision

An owner who hands the harness a list of tasks and goes to bed should wake to one
answer, in their own words: what was done and landed, what needs them and what the
decision is, and what to do next. An engineer pulled in at 3am should find, in one
place, why a task stopped: the decision asked, the verbatim evidence, every triage
round that led there, the retries spent, and anything a repair changed. A person
watching a run should see which tasks are working, waiting or stuck without
attaching to anything. A script should get all of it as versioned data.

The harness already records almost everything (`research` headline 2). So this phase
is a **read model with several renderings**, not a new subsystem: one derived
document per run, task or task list, rendered as plain language for Dana, as detail
for Marcus and Priya, as versioned JSON for tools, and as a durable report file. The
renderings are siblings of one document, so Dana's sentence and Priya's JSON can
never disagree.

The one honest limit: the product reports what the harness *did and decided*. It
does not know whether an agent's change was a good one. Where it quotes the agent it
says so, and it never paraphrases evidence (an existing rule, `research` D7).

## Personas (by reference)

`docs/personas.md` is the source of truth. This phase appends a goal extension to
each of the three, in place (labelled, assumed). Every journey and feature below
cites persona and goal as **[Dana: ...]**, **[Marcus: ...]**, **[Priya: ...]**.

- **Dana Okafor, non-technical owner.** Extended goal: come back to a whole list and
  know, from the first screen, what landed, what needs her, what to do next; glance
  at a run in progress; keep a durable copy. Never needs "surface", "budget",
  "triage", "verdict", "breaker".
- **Marcus Webb, on-call engineer.** Extended goal: read the triage history, retry
  budgets and any repair changes behind an escalation in one place, and watch a live
  run without attaching to its process. Existing bar (verbatim evidence, no
  transcripts first) unchanged.
- **Priya Shah, extender.** Extended goal: inspect budget use and every triage
  decision to tune her gate and role configuration; consume the same facts as
  versioned machine-readable output; see what a repair changed in her check.

## Derived minimum scope (assumed, not human-confirmed)

The floor is derived, not confirmed by a human: the team-lead's inference
(`review-log.md`) that roadmap Item 11's five success criteria, each reachable by a
named persona without reading the case file by hand, are the least this phase must
deliver. Refined here, conservatively, to the smallest set that lets each persona
complete the primary journey end to end. The critic is asked to attack this.

| # | Criterion (roadmap) | Persona and goal | Reached by |
|---|---|---|---|
| 1 | Current state of every active surface during a run | Dana, Marcus: watch a run in progress | `delivery status`, `status --watch` |
| 2 | Budget per surface and per run | Priya: tune from budget use; Marcus: budgets at the moment of stopping | `status <id>`, `report` ("For whoever tunes this" section), `--json` |
| 3 | Triage decisions and rationales inspectable | Priya, Marcus | `status <id>`, `status <id> --decisions`, `--json` |
| 4 | Terminal outcomes summarised with reasons, across a whole run | Dana: the overnight return | `delivery report` |
| 5 | Escalation packets accessible, presenting the decision in plain language | Dana, Marcus | `report`, `status <id>` |

Four things beyond the literal criteria are in the floor because a criterion cannot
be met for the default user without them. Each is justified here so the critic can
test it:

- **A report over the task list, not only over a run** (criterion 4). Default
  concurrency is 1, where a list is just separate runs with no run-level record, and
  the list stops at the first task that is not closed (`research` A.2; `queue.ts`
  `listStopped`). Without a list view the overnight owner has nothing to read. It is
  derived from the project's task list plus each task's latest record, exactly as
  `status` counts queued tasks today; no new record is needed.
- **Timestamps on log entries** (criterion 1, and the ordering in 4). Nothing is
  timestamped today (`research` headline 3), so "stuck since", "finished at 05:47"
  and a time-ordered live feed are impossible without them. Cheap, optional, additive
  (`arch §2.3`).
- **A recorded cause code on outcomes** (criteria 4 and 5). The "what to do" advice
  and the plain headline ("stopped after 3 attempts" versus "needs your decision")
  need a code, not parsed prose (`arch §2.3`).
- **A durable report written when a run ends** (criterion 4 for the owner who does
  not come back until later, and the same artefact Item 13 sends from a schedule).

Not in the floor: spend and cost, repair diffs, a full-screen view, OpenTelemetry
spans. They are SHOULD or COULD below.

## Tiering

### MUST

1. **The read model.** One derived document per task, run and task list, pure over the
   on-disk record, byte-identical for the same record (`arch §2`). All renderings
   below read it. Includes in-flight state per task in the human view, which the
   supervised view omits today (`research` A.2 gap).
2. **Task-list report: `delivery report`.** The returning-owner summary: headline in
   plain language, then "Needs you", "Stopped, for your engineers", "Done", "Not
   started", each item tagged by who must act and with what to do. With no id it
   reports the task list (`kind: list`); with an id, that task or run. [Dana: return to
   an overnight run, and tell "needs me" from "needs the engineers".]
3. **Per-task and per-run detail in `delivery status [id]`**: state, attempts, retry
   budgets per task and rolled up per run, triage rounds (one line each), terminal
   outcome with reason and what to do. [Marcus, Priya.]
4. **`delivery status --decisions`**: every triage round in full (trigger, verdict,
   rationale verbatim, the brief or packet it produced). [Priya, Marcus: criterion 3.]
5. **`delivery status --watch`**: attach-free live view, append-only lines, exits with
   the run's own code. [Dana, Marcus: criterion 1.]
6. **Plain-language view, `plain`.** A deterministic block per stopped task:
   `{group, audience, sentence, agentSaid, next}`, from the recorded outcome cause and
   the log through a total phrase table, never from the packet's own `decision` text
   (which carries "budget" and "authority"); the agent's own words quoted and labelled
   (`arch §4.1`). `audience` (owner or engineer) is how Dana tells "needs me" from
   "needs the engineers". [Dana, Marcus: criterion 5.]
7. **Machine-readable output for everything above**: `--json` on `status` and
   `report`, NDJSON from `--watch --json`, `schema: "delivery.report/1"` and
   `delivery.event/1`, additive-only within a major, `--schema` to print the JSON
   Schema. Existing `status --json` shapes remain valid. [Priya.]
8. **Recording additions** (all optional, additive): `at` on every log entry, and
   `cause` on outcomes. Absent values render as "not recorded", never as zero.
9. **Durable report artefact**: one fixed pair, `.delivery/last-report.json` and
   `.delivery/last-report.txt`, written when `delivery run` or `delivery resume` ends
   and overwritten by the next; `report --write [id]` writes the pair for any other
   subject. `last-report.txt` omits patches. [Dana: keep or forward; Item 13.]
10. **Degraded states handled** (below): no runs, a run in progress, a damaged
    record.

### SHOULD

11. **What a repair changed** (seeded by the gate-maintenance idea; visibility only).
    A changed-file list per repair, a patch on `--repairs`, and a plain note when a
    repair changed a file the check runs. [Marcus, Priya; Dana sees one line under
    "Worth a look".] Needs a capture step because a repair's edits are otherwise lost
    (`research` A.6, `arch §5`).
12. **Session spend and duration**: cost (labelled an estimate by the SDK) and
    duration per session, summed per task and run, with "recorded for 4 of 5
    sessions" so a partial figure is never shown as whole (`arch §2.3`). [Priya,
    Dana: "how much did that cost".] SHOULD, not MUST, because the roadmap frames this
    item as surfacing not capturing and "budget" in the harness means retries.
13. **Report text a person can forward**: `last-report.txt` is self-contained plain
    text (and reads acceptably as Markdown), so Dana can paste it into a message.

### COULD

14. Full-screen live view behind the same read model (`status --watch` stays the
    default and always works; the redraw view only ever adds).
15. Self-contained HTML report.
16. W3C `TRACEPARENT` / OpenTelemetry parent span per run so agent-session telemetry
    nests under it (`research` headline 7); the harness itself emits nothing.
17. Cross-run trends ("escalations per week").
18. Large-run collapsing of the Done list with an expand flag (the roadmap's scale is
    about 20 tasks; every task is listed in full until that proves too long).
19. Agent-written plain summary at triage time (`plainSummary`, optional on the
    packet; compatible upgrade path, `arch §4`).

### Explicitly not in this phase

Task packs (Item 12). Scheduling, triggers and missed-run detection (Items 13 and
14; this phase only guarantees the report they will send exists and is stable). A
hosted dashboard, web console or daemon. **Owner approval of repairs, and refusing a
repair that drops assertions** (control-flow changes from the gate-maintenance idea;
this phase only shows). Notifications or paging (push to email or chat). Licence
choice and first publication. Changing what triage decides, wiring agent triage into
the CLI, or any new agent call.

## Decisions on the questions the roadmap leaves open

**D1. What is the reporting surface?** A combination, built on one read model, not
three subsystems: a **post-run report** (`report`, the owner's front door), a
**point-in-time detail view** (`status`), an **append-only live feed**
(`status --watch`), and **structured output** (`--json`, NDJSON). Not a full-screen
TUI (COULD). Why: the return-after-hours journey is the one the roadmap names as the
trust-maker; the live feed must work in logs, pipes and screen readers, which the
existing renderer already prizes (`report.ts` doc comment); and `status` is safe to
read mid-run (`research` A.2), so the live feed is a reader of the record, which also
serves a person who was not the one who started the run. We considered the estate's
Ink console (`research` C.3): it earns its place only for an interactive board, which
is not what any persona's primary journey needs; it is the COULD.

**D2. Is non-technical reporting a different view of the same data, or a summary
generated at triage time?** A **different view of the same data, deterministic**,
with the agent's own words quoted and labelled. Why: in every CLI run triage is the
deterministic router, so every packet is harness-built with fixed plain sentences
(`research` headline 1); a generated summary would be a new model call per escalation,
non-deterministic, able to disagree with the evidence beside it, and untestable with
the scripted stack. The one thing a table cannot do is restate task-specific content
("the agent wasn't sure whether to delete the old homepage"); that content already
exists as the worker's own rationale and is shown verbatim under "The agent said:".
The risk we accept: for an agent-triage library user, text is the model's. The
optional `plainSummary` is the upgrade path, not built.

**D3. How does an owner get from "a task needs your decision" to the decision and to
what to do next?** The report names each such task, states in fixed words what kind
of stop it was and who must act (`audience`), quotes what the agent said, says where
the work is (keyed on the pinned closer), then gives a numbered "To act" list using
the route that actually works. That route is narrower than it looks, so it is stated
exactly (`arch §4.1`): an escalated or aborted task is a *finished* run, so
`delivery resume` refuses it; and running `delivery run` again on a task whose entry
is unchanged does not start a fresh run, it retells the old outcome and a one-at-a-time
list stops at the same task (`findQueueRun` matches by task content, `queue.ts`). A
fresh run starts only when the owner **amends the task wording or removes the entry**
from the list (or runs an ad hoc `delivery run --task "..."`). The decision therefore
lives in the task text: an owner who decides "yes, let it" says so by changing the
task; one who decides "no" removes it. Then `delivery run`. `delivery resume <id>` is
advised only for a run that did not finish. The harness never records the owner's
decision and never approves anything for her.

## Vocabulary for Dana (and the table that enforces it)

Owner-facing text, including `report` and the plain block of `status`, uses only:

| Say | Never say (appears only in JSON, `--decisions`, and the "For engineers" sections) |
|---|---|
| task | surface |
| needs your decision | ESCALATED, authority-class terminus |
| stopped after 3 attempts | correction budget exhausted |
| retries, attempts | budget, slot, population |
| the check | gate, gate assertion |
| repair of the check / of the setup | gate maintenance, breaker, DEGRADED |
| the agent | worker, triage, router |

This is enforced the way existing phrase tables are: closed enums, total tables
(`output.ts`), plus one test that scans every owner-facing phrase for the forbidden
words. Marcus's and Priya's views keep the harness's own words, because there they are
the point.

## Primary journeys

### J1. Dana returns to an overnight run [Dana: return to a whole run]

Dana ran a five-task list at 02:00 with `delivery run`. At 08:30 she opens a terminal
in the project folder and types the one command the end of the run told her:

```
$ delivery report
```

She reads the top line and knows the state of the world. Sections follow in the order
she needs to act: what needs her, what is for her engineers, what is done, what has
not started. Each item says who must act. The first screen answers "what succeeded,
what needs me, what do I do". Per item the next step is printed. After she decides
she amends or removes the task entry, runs `delivery run`, then `delivery report`
again.

Success: the owner has the right next action for every item without reading a case
file, a transcript or a flag.

### J2. Dana or Marcus watches a run in progress [Dana, Marcus: current state of every active task]

From a second terminal (or later, from a different session), `delivery status --watch`
prints a "Right now" snapshot, then one line per change as it is recorded, until the
run ends. It needs no handle on the process that drives the run. For a one-at-a-time run nothing
records whether it is still going, so it says "last activity HH:MM UTC" and keeps
waiting for the next entry or an outcome; only a run of several tasks that is
detectably not live ends the watch, saying so. Ctrl-C stops watching and never
touches the run.

### J3. Marcus reads an escalation and its history [Marcus: decide from the packet; understand how it got there]

`delivery status <run-id>` opens with the decision asked, the verbatim evidence, the
retry budgets at the moment it stopped, and a one-line-per-round history. If that is
not enough, `--decisions` expands every round and `--repairs` any repair's changes.
Session keys are named for the rare case a transcript is needed.

### J4. Priya tunes her configuration and integrates [Priya: understand why triage decided as it did; consume machine-readable output]

Priya runs a batch, then `delivery report` and `delivery status <id> --decisions` to
see which retry budgets ran out, how often, and each round's rationale. For tooling
she runs `delivery report --json` (a versioned document) or `delivery status --watch
--json` (events), and reads the schema with `delivery report --schema`. She builds a
dashboard on documents, never on prose.

## Key UX flows: what a person sees

Layout rule for all human output: one layout, plain lines, no box drawing, no
columns that rely on alignment, no cursor movement; fact-per-line so it reads
correctly at 60 columns, in a pipe, and in a screen reader. Times are 24-hour UTC with
the date where it matters. The text rendering never reads terminal width (so output is
deterministic and byte-identical for the same record).

### How report sections map to the data

One table, so the words Dana reads and the keys a script reads stay joined
(`arch §4.1`):

| Report section | Dana's words for it | Holds | `plain.group` / standing |
|---|---|---|---|
| Needs your decision | the agent stopped and a person must say what happens | `needs_your_decision` | agent stopped for permission or a credential |
| Failed after attempts | the check still fails after N tries; reword or drop the task | `failed_after_attempts` | retries spent on fixing |
| Abandoned | the harness gave the task up | `abandoned` | triage abort |
| Stopped, for your engineers | something in the setup, the check or the landing needs an engineer | `needs_an_engineer`, `stopped` | audience engineer, or no cause recorded |
| Done | landed | standing `closed` | |
| Not started | left alone | standing `not_started` | |

The first three share one section heading, **NEEDS YOU**, because they share an
`audience` of owner; the item's first line says which kind. "Stopped, for your
engineers" is how a task that needs engineering (a broken check, a repair that gave up,
a hand-off that could not land) is shown to Dana: not as her decision, with a line she
can pass on as written. Exit codes are not part of any of this: see "Commands and exit
codes".

### F1. `delivery report` (list; run of several at once)

(Run and task ids in these examples are illustrative; real ids are whatever the harness
assigns. Every sentence that is not in quotation marks comes from a fixed phrase table
over the recorded cause and the log; task-specific words appear only inside quotation
marks, labelled as the agent's.)

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

Notes. "Where the work is" is keyed on the pinned closer and per task: the line above is
what the built-in closers guarantee for a task that did not close; a custom closer
gets "Your own closer handled this task; check what it did", and the report never says
"your work was kept" or "nothing changed" in general. "Merged into main" versus
"committed on branch X" versus "pull request open" is likewise keyed on the closer,
as `outcome.ts` `landing` does today. "Worth a look" appears only when SHOULD item 11
recorded a changed check file. The cost line appears only when SHOULD item 12
recorded something; otherwise "Time and cost were not recorded for this run."

An item that needs an engineer instead reads, in its own section:

```
STOPPED, FOR YOUR ENGINEERS (1)
  Task 6 of 7: "Update the sitemap"
    The check you set up could not be repaired automatically. This is a problem
    with the setup, not a decision for you.
    To act: pass this to whoever maintains your checks:
            delivery status 20261001T020114Z-3
```

### F2. `delivery report` after a one-at-a-time list (the default, concurrency 1)

The list stops at the first task that is not closed, so there is a section for tasks
the harness left alone, with the reason in her words:

```
Your task list: 2 of 5 tasks completed and merged; 1 needs your decision;
2 not started.
Started 1 Oct 02:01 UTC; last activity 02:58 UTC.

NEEDS YOU (1)
  Task 3 of 5: "Rename the About page" ...
  (same layout as F1)

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

### F3. `delivery status --watch`

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

Rules: change lines are append-only and never redrawn, so a pipe, a log file or a
screen reader reads exactly what a terminal shows. Every line begins with the time and
the task's place in the list (`Task 2 of 5`), never colour alone (colour only adds
tone). `--watch --json` emits one `delivery.event/1` object per recorded entry
instead. For a run with no recorded times (an old record), lines drop the time and
say "times were not recorded for this run". Exit code is the run's own, so a script
can wait on it (see "Commands and exit codes").

Liveness is only knowable for a run of several tasks at once, which holds the
repository lock. A one-at-a-time run takes no lock, so a running task and a killed one
look alike except for the last recorded activity. For those runs the snapshot says
"Last activity 02:41 UTC; nothing records whether it is still going" and `--watch`
keeps waiting for the next entry or an outcome; it never decides on its own that the
run is dead. Only a killed run of several tasks, which is detectably not live, ends
the watch, with "This run stopped part way. To carry on: delivery resume <id>" and exit
ok.

### F4. `delivery status <run-id>` for an escalated task (technical reader)

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
  correction 2 of 3, gate recheck 0 of 3, gate repair 0 of 2,
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

Here the harness's own words (worker, triage, correction) are deliberate; it is
Marcus's view of the same data F1 shows Dana. The top block is the existing escalation
rendering, kept as is.

### F5. `delivery status <id> --decisions` and `--repairs`

`--decisions` prints each triage round in full: after which attempt, what set it off,
verdict, rationale verbatim, and the brief or packet it produced, so Priya can see
exactly what the next worker was told. `--repairs` prints each repair's changed files
and its patch. A patch over the recorded cap prints "patch too large to keep; the list
of files is above". Both are plain text; both also exist as keys in `--json`.

### F6. Machine-readable [Priya: consume output]

```
$ delivery report --json | jq '.counts, [.surfaces[].budgets[] | select(.used==.max)]'
```
`report --json` is one `delivery.report/1` document with every key always present
(`null` or `[]` where not applicable). `report --schema` prints the JSON Schema.
Stability promise (`arch §3.2`): within `/1` keys are never removed or renamed;
consumers ignore unknown keys; prose fields (`summary`, `plain`) are not part of the
promise and must not be parsed. Existing `status --json` consumers keep working
unchanged.

### F7. Repair visibility (SHOULD) [Marcus, Priya]

Per task and per run, `status` shows one line per repair:
`Repair 1 (of the check, attempt 1 of 2) changed 2 files, +14 -3: shared/helper.json
(the check runs this file), notes.txt`. `--repairs` adds the patch. The wording says a
repair changed a file the check runs and nothing about whether that was safe. Old
records and mock sessions say "what this repair changed was not recorded".

## How the same data reads for a technical reader

| Question | Dana reads (report) | Marcus / Priya read (status, JSON) |
|---|---|---|
| Why did task 2 stop? | "The check still failed after 3 attempts (3 of 3 allowed)." | `outcome.cause = {kind: budget, population: correction}`; budgets row `correction 3/3`; rounds list |
| What did triage decide? | Not shown except as the result | each round: trigger, verdict, rationale verbatim, brief or packet |
| What did it cost? | one estimate line, if recorded | per-session `usage`, "recorded for n of m" |
| What did a repair do? | one "Worth a look" line | file list, counts, patch, `touchesCheck` flag |

## Commands and exit codes

One surface, extending `status` rather than adding a parallel family (agreed with the
architect, `arch §3.1`):

| Command | Purpose |
|---|---|
| `delivery report [id] [--write]` | No id: the task list (`kind: list`). With an id: that task or supervised run. Prints; `--write` also writes `.delivery/last-report.{json,txt}`. |
| `delivery report --schema` | Print the JSON Schema for `delivery.report/1` and `delivery.event/1`. |
| `delivery status [id]` | Existing default (most recently touched). Gains in-flight state, budgets, one-line triage rounds, repairs, and the plain "To act" line. |
| `delivery status --all` | Existing; each line gains the headline counts. |
| `delivery status --watch [--interval <s>]` | Append-only live feed; default 2 s. |
| `delivery status --decisions`, `--repairs` | Full triage rounds; repair patches. |

**Exit codes, one rule:** `status` and `report` exit ok whenever the report could be
made, whatever it says (the existing contract: the code says whether the report could
be made, never what the run decided), so a scheduler reading `last-report.json` can tell
a broken reader from a run that needs a person; the decision is in the document
(`counts`, `plain.audience`). `run` and `resume` keep today's codes (4 when a task needs
a person). `status --watch` mirrors the code the run itself ended with.

## Form factors

| Form | Behaviour |
|---|---|
| Wide terminal | Same single layout as everywhere; long lines are left to the terminal to wrap. No width-dependent variation, so output is reproducible. |
| Narrow terminal (about 60 columns) | Same layout; facts are one per line and sentences short, so wrapping stays legible. No columns or tables to break. |
| Non-TTY or piped | Identical text, no colour. Nothing switches format on its own (existing README rule); only `--json` changes format. |
| `--json` | One document (`status`, `report`) or NDJSON events (`--watch`); never coloured; prose on stderr only. |
| `--no-color`, `NO_COLOR` | Honoured by the existing `useColour` rule. Meaning is carried by words ("needs your decision", "done", "!" on attention lines), never colour. |
| Durable artefact | `.delivery/last-report.txt` and `.delivery/last-report.json`, written when `delivery run` or `delivery resume` ends; `report --write [id]` writes the pair for another subject. `last-report.txt` is self-contained plain text (no patches) safe to paste into a message. HTML is a COULD. |
| Library | The read model and schemas are exported so Items 13 and 14 and adopters' dashboards reuse them (`arch §3.3`). |

## Navigation

Every human output ends with a `Next:` line naming real commands, so nobody needs
the manual:

```
delivery run -> (end of run says) "run `delivery report`"
delivery report -> per item: "Full account: delivery status <id>"
delivery status <id> -> "--decisions" / "--repairs" / "delivery report"
delivery status --watch -> at the end: "run `delivery report`"
delivery status --all -> one line per run; "delivery status <id>" or "delivery report"
a finished task that needs a person -> "To act: amend the task or remove it from
  your list, then delivery run"   (never `resume`; an unchanged entry is retold)
an unfinished or killed run -> "To finish it: delivery resume <id>"
```

The end of `delivery run` today prints `EVERY_TASK_DONE` / `STOPPED_PART_WAY` lines
(`queue.ts`); they gain the headline sentence and point to `delivery report`, so the
first thing an owner reads at the end of a run is already the answer.

## Accessibility

- **Screen readers.** No spinners, redraws, box drawing, or alignment-dependent
  columns. Section headings are plain capitalised lines; items are numbered lists;
  each line stands alone (the `Task N of M` prefix repeats rather than relying on
  position). Watch output is append-only so a reader never has to re-read the screen.
- **Colour independence.** Tone is carried by a word or a leading `!`; colour is
  decoration (`output.ts` `paint`).
- **Plain language.** Reading order is the point first, then detail (BLUF, `research`
  B). Numbers are written as "3 of 5", durations as "3 h 46 min", times as 24-hour with
  the UTC label. No abbreviations, no jargon in Dana's sections, enforced by the
  vocabulary scan above.
- **Not alarming.** The harness did not lose anything: the report says what was and
  was and was not added to main, per task, in words the pinned closer guarantees.
- **Honesty about gaps.** Missing data reads "not recorded", never a blank or a zero.

## Empty, loading and error states

| State | What the person sees |
|---|---|
| No runs yet | `No runs yet in this folder. Start one with: delivery run` (and for `report`, the same). Exit ok. |
| No task list but runs exist | `report` falls back to the most recent run and says so in one line. |
| Run in progress | `report` and `status` say "This run is still going (5 tasks: 1 done, 2 working, 2 waiting). Last activity 02:41. Follow it: delivery status --watch". It never prints a final-sounding headline for an unfinished run. |
| Unfinished run, liveness unknown | The default (one task at a time) takes no lock, so nothing records whether it is still going. `report` and `status` say: "This run has not finished. Last activity 02:41 UTC; nothing records whether it is still going. If it is not, carry on with: delivery resume <id>". Never guessed (`arch §1`). `--watch` keeps waiting. |
| Unfinished run of several tasks, not live | "This run stopped part way. To carry on: delivery resume <id>". `--watch` ends with that sentence, exit ok. |
| Half-written record | A torn final journal line is dropped silently and the state one entry earlier is shown (existing behaviour, `arch §2.4`); the next read catches up. |
| Corrupt record | That one task reads "The record for task 3 is damaged (file named); the other 4 tasks are reported below". The report is marked incomplete in its top line and in `--json`; exit is ok for reads. Never a stack trace. |
| Old records (no times, no cause, no usage) | Rendered from what exists; each missing fact says "not recorded"; no invented advice (the packet's own decision sentence is shown alone). |
| Report file cannot be written | The run's outcome is unaffected; `delivery report` still prints; a one-line note says the file was not saved and why. |

## Operability and developer experience

- **How it is verified.** Reports are pure over the record, so each rendering is
  tested with golden text and JSON from scripted runs on the existing scripted-agent
  stack (`./testing`), with fake timers for `at`. A golden test per document fails if a
  JSON key disappears (the promise). A scan test enforces the vocabulary table. No
  real model, no network, no new infrastructure.
- **Local run story.** `delivery report` and `status` work on any `.delivery/`
  directory, including one copied from a colleague (read-only, no lock needed), which
  is how Marcus reproduces an issue and how Priya tests her configuration: run a
  scripted batch, read the report.
- **Dependencies.** None added for MUST or SHOULD: plain text, Markdown-safe, NDJSON,
  and the existing zod for the schema (`research` C.5). The architect owns the
  buy-versus-build ledger; the product position is that Ink, listr2, OpenTelemetry
  packages and CTRF/JUnit are COULD or rejected, for the reasons in `research` C.
- **Deploy target.** None: this ships in the existing `delivery` package; there is no
  service, daemon or hosting.

## Success metrics

Measured by scripted acceptance tests and, once a human reviews, by UAT; none is a
telemetry metric because the harness collects none.

- **Time to the answer (Dana):** from "I have returned" to knowing what landed, what
  needs her and what to do, in one command and the first screen of its output.
- **Coverage of "what to do":** 100% of stopped tasks in a report carry an audience
  and a "To act" line with a real route; 0 uses of `resume` for a finished run and 0
  advice to "just run again" for an unchanged listed task.
- **No harness vocabulary in Dana's text:** the forbidden-word scan (architect's
  list: budget, gate, triage, authority, surface, terminus, repair session, escalat)
  passes over every phrase in `report` and in `plain`, the "For whoever tunes this"
  block included, which is deliberately worded in the same vocabulary. Harness words
  live only in `status`, `--decisions`, `--repairs` and `--json`.
- **Criteria reachability:** each of the five roadmap criteria is answered by a
  named command without reading `log.jsonl` or `case.json` (a scripted test per
  criterion).
- **Determinism and honesty:** the same record renders byte-identical output; every
  missing fact renders "not recorded".
- **Machine contract:** golden JSON for `delivery.report/1` and `delivery.event/1`
  passes; existing `status --json` consumers' fixtures still parse.
- **Priya's question:** "which retry budget ran out, on which tasks, after which
  triage rounds" is answerable from one command in each of text and JSON.

## Assumptions and open points for the team

- Persona goal extensions are assumed, not human-confirmed.
- That an owner prefers an on-demand `report` plus a file over a push notification is
  assumed (notifications are a non-goal here; Item 13 may add them).
- Marking "stopped after N attempts" and "needs your decision" as two phrasings of the
  same escalated standing is a presentation choice; exit codes and `TaskStanding`
  are unchanged.
- Cost capture is SHOULD, not MUST: if the critic finds the roadmap's "budget
  consumption" must include spend, item 12 moves up (the design already handles it).
- The list report is derived, not recorded. If matching tasks by content
  (`findQueueRun`) is ever replaced, the list report follows it.
