# See what happened to a run

This guide shows how to find out how a run ended, follow one while it is going, and list every run in a repository. It is for anyone who has started a run with `delivery run` and assumes one exists: see [Run a task](run-a-task.md). These commands only read: none of them changes a run.

A [run](glossary.md#run) is one go at one task. A run of several tasks at once has an id of its own (`run-…`) and holds one run per task, each with its own id. Where a command takes a `<run-id>`, either kind works.

## Find out how a run ended

In a new terminal, or days later:

```bash
delivery status
```

It reads the run touched most recently, a single task's or a run of several at once, and says what
happened to it. While a run of several at once is going, it reads the whole run, not whichever
task moved last. `delivery status <run-id>` names a run instead, and `delivery status --last` is
the explicit form of the default. It only reads and never moves a run on, so it is safe to use
while a run is going.

What you get depends on how the run ended:

- **Finished:** what was done, when it finished, and the branch the work is on.
- **Stopped for a decision:** the decision it needs from you first, then the evidence behind it,
  what had already been tried, why it stopped when it did, and the agent sessions it covers, all
  in the harness's own words. Then where its branch, its working copy and its record are.
- **Stopped for another reason:** why, in plain language.
- **Not finished yet:** what picking it up will carry on with, when its record last shows anything
  happening ("Last recorded activity: 2026-10-01 02:22 UTC."), and the command to pick it up.

If the run's task is on your `tasks` list, it also says which task of how many it is, worked out
from the list as it is written now.

Beneath that account, `status` says how the task got there, for whoever has to find out why. These
parts use the harness's own words ([triage](glossary.md#triage), gate, correction) on purpose,
because those are the words to search the run's record for. The five retry budgets are named
`correction`, `gate recheck`, `gate repair`, `session retry` and `close retry` here;
[`delivery report`](read-a-report.md) names the same five in plainer words, and
[Configuration reference](configuration-reference.md#budgets) gives the settings behind them.

- **How it got here:** one line for each triage round, which is each time the harness had to
  decide what to do after a setback: the attempt it followed, what set it off, and the verdict.
- **Retry budgets:** how many retries of each of the five kinds were used of how many are
  allowed, and how many attempts the agent made.
- **Time and cost:** how long the task's agent sessions took and roughly what they cost, as the
  agent runtime reported them, and how many sessions that covers. Nothing recorded reads "not
  recorded", never zero. The figures are information only; nothing a run does depends on them.
- **Repairs:** one line for each repair that ran in the task's working copy, whether the task's
  own repair of the check or its run's repair of the setup every task shares. The line gives how
  many files the repair changed, the lines added and removed, and the file names. A file the check
  itself runs is marked "(the check runs this file)". The line says only what changed; nothing
  tells you, or decides, whether the change was safe. A repair that changed nothing says "changed
  no files"; one from before changes were kept says "what this repair changed was not recorded".
- **To act:** for a task that stopped, the same steps `delivery report` gives for it, then two
  things that are easy to get wrong: an unchanged task on your list is not run again, and
  `delivery resume` does not apply to a run that has finished.

```text
How it got here (triage rounds; --decisions for the full text):
  After attempt 1: a gate failure; verdict: reroute
  After attempt 2: a gate failure; verdict: reroute
  After attempt 3: a gate failure; verdict: reroute
  After attempt 4: a gate failure; verdict: escalate

Retry budgets at stop, after 4 attempts:
  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3

Time and cost, recorded for 4 of 4 agent sessions: 9 min 12 s of session time; USD 1.18, estimated by the agent runtime.

Repairs: none ran for this task.

To act: 1. Reword the task, or remove it from your list.
        2. Run: delivery run
An unchanged task on your list is not run again: `delivery run` would retell this outcome.
`delivery resume` does not apply: this run is finished.

Next: delivery status fix-the-broken-footer-links-20261001T022000Z --decisions (every triage round in full), delivery report (your task list)
```

A task with no triage rounds, or one that did not stop, says so in one line. A run made by an
earlier version shows what its record holds and "not recorded" for the rest. The last line,
`Next:`, names the commands that go further.

To read every triage round in full, add `--decisions`:

```bash
delivery status fix-the-broken-footer-links-20261001T022000Z --decisions
```

```text
How it got here (4 triage rounds, in full):
  Round 1, after attempt 1
    Trigger: a gate failure (gate_fail)
    Verdict: reroute
    Rationale: "gate_fail: reroute"
    Brief for the next session:
      Problem: Two footer links point at pages that were removed.
      Dead ends: Attempt 1 rewrote the link text and left the targets alone.
      Scope: Only src/footer.html.
      References: worker-1-0
      Diagnosis (a hypothesis to test, not an established fact): The targets moved under /about.
  …
  Round 4, after attempt 4
    Trigger: a gate failure (gate_fail)
    Verdict: escalate
    Rationale: "gate_fail: escalate"
    Packet for a person:
      Decision: "No correction budget remains (3/3 used). Decide whether to continue manually, amend the task, or abandon it."
      …
```

Each round gives what set it off, the verdict, the reasoning word for word, and what the round
produced: the brief the next session was given, exactly as that session read it, or the packet
written for a person. A round that wrote no brief says so ("none; this round wrote no brief"). A
round whose brief or packet can no longer be read says "not recorded". Combining `--decisions`
with `--all` stops with exit 2 and a message ("Use either `--all` or `--decisions`, not both"). With `--json`, `--decisions` prints the same document
`status --json` does, which already carries every round in full.

To see exactly what each repair changed, add `--repairs`:

```bash
delivery status fix-the-broken-footer-links-20261001T022000Z --repairs
```

```text
Repairs (1, each with what it changed):
  Repair 1 (of the check, attempt 1 of 2) changed 2 files, +3 -1: check.mjs (the check runs this file), notes.txt
    check.mjs (the check runs this file): modified, +2 -1
      diff --git a/check.mjs b/check.mjs
      …
    notes.txt: added, +1 -0
      …
```

A file the repair added is shown in full. Each repair keeps up to 256 KiB of patches. A file past
that limit, or a binary file, keeps its name and counts and says "patch too large to keep".
What a repair changed is kept with the run's record, so you can still read it after the task's
working copy is cleared away. Combining `--repairs` with `--all` or `--watch` stops with exit 2 and a message.

`status` exits 0 whenever it could read the run and 2 when it could not find one ("I couldn't find
that run's record"), so a run that needs your decision is still a successful read. `status
--watch` is the exception: it ends with the code of the run it followed (see [Watch a run as it
happens](#watch-a-run-as-it-happens)). The
[exit codes](cli-reference.md#exit-codes) are the run's own, reported by `delivery run`.

Add `--json` to get the account as one JSON document instead of sentences:

```bash
delivery status --last --json
```

It carries the run id, the task, where that task sits on your list, when it started and finished,
how it ended, the sentences the plain-language report prints about it, the branch, the base
branch, where the run's record is, and, for a run that stopped for a decision, every field of the
escalation packet. Every key is always present, and `null` means "not that kind of run", so
a script never has to check whether a key is there. A run that cannot be found gives a
plain-language message on standard error and exit 2, not JSON.

The document also carries `report`, the versioned document `delivery report <run-id> --json`
prints for that run. [Reports as data](reporting.md) lists its keys.

## A run of several tasks at once

Name the id the run opened with (`run-…`) to read the whole run:

```bash
delivery status run-20260930T090000Z
```

The account gives:

- when the run started and its shape;
- whether the environment the tasks share is healthy;
- how many tasks are done, need your decision, stopped or are still queued;
- one line per task in list order, naming the task's own run id once it has one;
- the retry budgets added up across the tasks the run has taken, beside the run's own limit on
  repairs of what its tasks share, and a `Next:` line.

A task that needs your decision is followed by the same account `delivery status` gives of it on
its own. A task waiting only because every slot is busy shows as "queued, waiting for a free
slot". If the run was stopped part way, the account says how to carry it on. While the run is
going, a task under way says what it is doing right now, which attempt it is on and since when
("the agent is working, attempt 2, since 2026-09-30 09:14 UTC"). Once the run has stopped, it says
"not finished yet". A run that has not finished also says when its record last shows anything
happening ("Last recorded activity: 2026-09-30 09:14 UTC."). A run made by an earlier version
recorded no times, so it leaves out "since" and says "Last recorded activity: not recorded."

With `--decisions`, every task's triage rounds are printed in full beneath that. Any task a repair
ran in is then listed with its repairs, one line each, or with their patches under `--repairs`.

```text
Run run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once
Environment: healthy
3 done, 1 needs your decision

  [1/4] add a hello (add-a-hello-20260930T090000Z): done
  [2/4] delete the greeting (delete-the-greeting-20260930T090000Z): needs your decision (see below)
This needs your decision: …
…
  [3/4] add a goodbye (add-a-goodbye-20260930T090100Z): done
  [4/4] add a shout (add-a-shout-20260930T090200Z): done

Retry budgets across the 4 tasks this run has taken:
  correction 0 of 12, gate recheck 0 of 12, gate repair 0 of 8, session retry 0 of 20, close retry 0 of 12
  shared repair limit for the run: 0 of 2 used

Time and cost, recorded for 4 of 4 agent sessions: 6 min 20 s of session time; USD 0.88, estimated by the agent runtime.

To read one task in full: delivery status delete-the-greeting-20260930T090000Z

Next: delivery report run-20260930T090000Z (this run in plain words)
```

Every task keeps its own run id, and `delivery status <task-run-id>` reads it exactly as it
reads any other run.

If the environment the tasks share broke, the report opens with that before anything else. It
says whether the environment is being repaired or could not be fixed, which task found the
problem and why, and which tasks it held. Those tasks count as "paused until the shared
environment is fixed". A run that repaired its environment and carried on says so beside it:
"Environment: healthy (repaired once during this run)". `--json` has the detail under `trips`. If
a usage limit stops the repair, the run stops at once and says that instead ("the AI service is
limiting requests" or "the spending limit has been reached"). Its record names the limit as the
cause.

`delivery status run-… --json` gives the whole run as one document, for a script or for looking
back after the fact. Every key is always present, `null` where it does not apply yet. It holds:

- the run id, when it started, how many tasks and how many at once, and whether it is going now;
- the environment, how the run ended and when;
- `reason` and `cause`: why it stopped, and whether the shared environment or a usage limit was
  the cause;
- `runBudgets`: how many shared repairs it used, of its limit;
- `trips`: every time its environment broke, with the task that found it, the tasks it held and
  each repair attempt;
- `surfaces`: one entry for each task the run took (`surfaces` is the JSON name for tasks), each
  exactly the document `delivery status <task-run-id> --json` gives;
- `queued`: the tasks it has yet to start, with their place on your list;
- `report`: the versioned document `delivery report run-… --json` prints for the run.

## Watch a run as it happens

To follow a run while it is going, from any terminal, without touching it:

```bash
delivery status --watch
```

```text
Watching run run-20261001T020000Z: 4 tasks, up to 2 at once. Ctrl-C stops watching; the run is not affected.

Right now (last activity 02:22 UTC): 4 tasks: 1 done, 2 working, 1 waiting to start.
  Task 1 of 4: "Add a contact form": merged into main at 02:19
  Task 2 of 4: "Fix the broken footer links": checking the agent's work (attempt 1). In this step since 02:22 UTC.
  Task 3 of 4: "Replace the old homepage": the agent is working (attempt 1). In this step since 02:20 UTC.
  Task 4 of 4: "Add a cookie banner": waiting to start

02:23 Task 2 of 4: wrapping up.
02:24 Task 2 of 4: done, merged into main.
02:24 Task 4 of 4: the agent is working.
02:41 ! Task 3 of 4: needs your decision.
02:57 Task 4 of 4: checking the agent's work.
02:58 Task 4 of 4: wrapping up.
02:58 Task 4 of 4: done, merged into main.
02:58 Run finished: 3 of 4 tasks completed and merged; 1 needs your decision. Run `delivery report` for what to do.
```

It says what it is watching, gives every task as the record shows it right now, then adds one
line for each change. Each line gives the time it was recorded (UTC), the task's place on your
list, and what the task is now doing, in the words `delivery run` prints. A line that needs your
attention is marked with `!` as well as its words. Lines are only ever added, never redrawn, so
the output reads the same in a terminal, through a pipe and in a log file. Trouble with the setup
every task shares, its repair and the tasks carrying on each get lines of their own.

With no run id it follows your task list, as `delivery report` does, or the most recent run
when the project has no `tasks` list. `delivery status --watch <run-id>` follows one task's run
or one run of several tasks at once.

The watch ends when what it follows ends, with the counts `delivery report` opens with, and
its exit code is the one that run ended with (the [exit codes](cli-reference.md#exit-codes)), so a script can wait on it. A
list worked one task at a time ends when every task is done or when a task stops the list, with
the code `delivery run` gives for that; the pause between one task finishing and the next
starting does not end it. Nothing records whether such a list is still being worked on, so the
watch says so once, gives the last recorded activity, and keeps waiting: it never decides for
itself that a run has died. A run of several tasks at once does record that it is going; if it
was stopped part way, the watch says so and how to carry on, and exits 0.

The watch only reads the record, and takes no lock. It looks every 2 seconds; `--interval
<seconds>` changes that. A run made by an earlier version recorded no times. You can still watch
it: its lines leave the time out, and the watch says once that times were not recorded.
Combining `--watch` with `--all`, `--decisions` or `--repairs` stops with exit 2 and a message,
as does `--interval` without `--watch`.

For a script, `delivery status --watch --json` prints the same watch as data, one JSON event to
a line: a first line saying what is being followed (`"type": "stream_started"`), one event for
every step the record holds and then for each step as it is recorded, and a last line saying how
it ended (`"type": "stream_ended"`). It exits with the same code. Replaying a run that has
finished prints exactly the lines that following it live printed. [Reports as data](reporting.md)
lists the events.

## See every run

To see the whole history of runs in a repository:

```bash
delivery status --all
```

```text
3 runs in this repository, newest first:
  add-a-goodbye-20261001T113000Z, started 2026-10-01 11:30 UTC: add a goodbye (hasn't finished yet): 1 task: 1 not finished
  run-20260930T090000Z, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision): 3 of 4 tasks completed and committed to their own branches; 1 needs your decision
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished): 1 of 1 task completed and committed to its own branch
To read one in full: delivery status <run-id>

Next: delivery report (your task list)
```

A run of several tasks at once is one line: its shape and how its tasks stand. Read its tasks with
`delivery status run-…`, and each task by its own run id. Every line ends with the counts
`delivery report` opens with for that run, so a task that failed after its attempts reads
differently from one waiting on your decision.

`--all --json` gives the same list as an array, each entry with the run id, the task, the
instant it started, how it ended and `tasks`: `null` for a single run; for a run of several at
once, whose own `task` is `null`, the same four fields for each task it took. The list is ordered
by when each run started, so it is a history; `delivery status` with no run id reports the run you
were last working on, which is not always the newest one. A repository with no runs yet lists
nothing and exits 0.

## Next steps

- [Read the report](read-a-report.md): the plain-words summary of your task list
- [Pick up an interrupted run](resume-a-run.md): carry on with a run that stopped part way
- [When the shared environment breaks](shared-environment.md): a worked example of a run of several tasks stopping
- [Reports as data](reporting.md): the JSON these commands print
- [Command reference](cli-reference.md): every option
