# delivery-service

A deterministically gated agent delivery harness.

## Quick start

New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project. Then [Setting up a project](docs/project-configuration.md)
sets up a whole project, with a description and a list of tasks, in a complete example.

Working on the harness itself:

```bash
npm install
npm test
```

## Run a task from the command line

In a git repository whose `package.json` has a `test` script:

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

The harness hands the task to an agent working on a separate copy of your repository, checks
the result with `npm test`, and, unless you configure otherwise, commits the work to a new branch
without touching your base branch. It prints a line for each step and ends by naming the branch or, if the agent needs a
decision from you, by saying what that decision is.

You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`). The command checks the sign-in before it starts. To install the command,
follow [Getting started](docs/getting-started.md): it packs this checkout and installs the
result, because the package is not on the public registry until a licence is chosen.

Each run keeps its record in `.delivery/runs/` in your repository (the folder ignores itself,
so `git status` does not change) and its working copy under
`~/.local/state/delivery-service/worktrees/` (or `$XDG_STATE_HOME`, when set).

| Exit code | Meaning |
|---|---|
| 0 | The run finished and the work was delivered |
| 1 | Something unexpected went wrong |
| 2 | Something about the setup or the command needs fixing |
| 3 | The agent could not start: Claude Code is missing or not signed in |
| 4 | The run stopped because it needs a decision from you |
| 5 | The run stopped before it could finish |

For a script or a CI step, add `--json`:

```bash
delivery run --json --task "add a function that says hello to a name, with a test"
```

Instead of the plain-language lines, each step prints as one JSON object on its own line, with
the harness's own state name, whether the run is over, anything the step had to put right, and
when it happened:

```text
{"state":"PROVISIONING","done":false,"at":"2026-09-16T12:00:00.000Z"}
{"state":"AGENT_ACTIVE","done":false,"at":"2026-09-16T12:00:11.284Z"}
{"state":"CLOSED","done":true,"at":"2026-09-16T12:01:39.002Z"}
```

The exit codes are the same ones in the table above, so a script reads the outcome from the exit
code and the detail from `delivery status --json`. Everything that is not a step, such as which
run started, any warning and the closing sentence, goes to standard error, so standard output is
only ever JSON.

When several tasks run at once, each object also says what it is about: `"scope": "run"` for the
run starting and finishing, and `"scope": "surface"` for a task's step, with the run's id and a
`surface` object giving the task's place in the list, how many there are, and the task's own run
id. Every key is present, `null` where it does not apply. A run of several at once also writes a
`scope: "run"` object each time its shared environment changes state (`DEGRADED`, `REPAIRING`,
`HEALTHY`, and `ESCALATED` when it gives up), with `affected` listing the task run ids it
concerns (`null` on the run starting and finishing).

`--json` works on `delivery resume`, `delivery status` and `delivery validate` too. Without it the output is
plain-language lines everywhere, piped or in CI included: nothing switches format on its own.

`delivery --help` and `delivery run --help` list the options; `--no-color`, or setting
`NO_COLOR`, turns colour off.

To try it on something small first, use the [sample project](examples/sample-project/README.md).

## Work through a list of tasks

Put the things you want done in your `delivery.config.json`, in the order you want them:

```json
{
  "tasks": [
    "add a page that shows who's on call today",
    "let someone swap their on-call day with a teammate",
    "send a reminder the morning before someone's on-call day starts"
  ]
}
```

Then:

```bash
delivery run
```

By default it works down the list one task at a time, each as an ordinary run with its own branch and its
own record, and says which task it is on:

```text
Task 1 of 3: add a page that shows who's on call today
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
Done: the change for "add a page that shows who's on call today" passed `npm test` and is
committed on branch surface/add-a-page-that-shows-20260917T090000Z.

Task 2 of 3: let someone swap their on-call day with a teammate
…
```

Run it again whenever you like: it works out where it got to from the runs already in the
repository, so an interrupted list picks up the task it was on and carries on from there. A task
that needs a decision from you stops the list there rather than skipping past it, and running the
command again stops in the same place until you deal with it.

To have several tasks worked on at the same time, add `"concurrency": 2` (or more) to the file,
or pass `--concurrency 2` for one run. Each task still gets its own copy, branch and record,
and as soon as one finishes the next task on the list starts in its place. Every line says
which task it is about:

```text
Starting run run-20260926T090000Z: 3 tasks, up to 2 at once
[1/3] Starting run add-a-page-that-shows-20260926T090000Z: add a page that shows who's on call today
[1/3] - setting up
[2/3] Starting run let-someone-swap-their-on-20260926T090000Z: let someone swap their on-call day with a teammate
[2/3] - setting up
…
[1/3] Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/add-a-page-that-shows-20260926T090000Z.
[3/3] Starting run send-a-reminder-the-morning-20260926T090412Z: send a reminder the morning before someone's on-call day starts
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 3 of 3 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

Every `delivery run` and `delivery resume` ends with those two lines: the first sentence of the
report, and the command that prints the rest. The report is saved as the command ends, as
`.delivery/last-report.txt` and `.delivery/last-report.json`, replacing the pair from the run
before, so the result is waiting as a file for whoever was not there. If it cannot be saved, the
run ends exactly as it would have, with its usual exit code and one line saying so.

With several at once, a task that needs a decision from you does not hold up the others: its
place goes to the next task, and the run ends by naming each task that needs you. The exit code
is 0 only if every task was delivered, and 4 if any needs a decision. Setting up and removing
working copies, and merging finished work back, take turns in your checkout, so two tasks
finishing together both close properly; with the `merge-back` closer, the second one's merge is
refused because the first moved the base branch on, and it is handed back to you in the usual
way. Each run of several at once also keeps a small record of its own under
`.delivery/supervised/`.

If the environment your tasks share breaks during a run of several at once, the run does not let
every task discover it, retry and fight over it. A check that cannot run at all before a task has
started is treated as shared straight away. A check that keeps erroring on a task's finished work
(the check itself erroring, not a failing test) is first that task's own business: it re-checks,
then repairs its own check on its own limit, and no other task is affected. Only when a second,
different task hits the same thing does the run treat it as shared; the same task erroring again
does not count twice, and a successful repair starts the count afresh. Once it is shared, the run
holds any task about to check or hand off its work, leaves work already under way alone, and
repairs the environment once, with the same agent that repairs a check for a single task:

```text
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
```

The number of repair attempts is one limit for the whole run, `budgets.gateMaintenance`
(2 unless you set it). If the repair cannot fix it within that limit, the run stops, says how
many tasks were waiting on it, had finished and are still queued, and exits 4; its record says
the shared environment, not any task, was the cause. The tasks it held keep where they got to:
once you have fixed the environment, `delivery run` carries them on.

The list is yours to edit between runs. A new entry anywhere runs in its place; reordering
changes only the order they are visited in; deleting an entry leaves its run in the history; and
rewording an entry makes it a new task, which is also how you deliberately run a finished task
again. `delivery run --task "..."` always runs exactly that one task and leaves the list alone.

## Pick up a run that was interrupted

If a run stops before it finishes, because you closed the terminal, pressed Ctrl-C or the
machine restarted, run the same command again in the same repository:

```bash
delivery run
```

It finds the run that didn't finish, says what it is picking up, and carries on from there
rather than starting over. `delivery resume` does the same and never starts a new run: give it
a run id, or `--last` for the run touched most recently. If more than one run didn't finish, it
lists them and asks which one; in a script or a CI step, where nobody can answer, it prints the
list and stops.

A run of several tasks at once is picked up the same way, with `delivery run`. It says which run
it is carrying on (`Picking up run run-20260926T090000Z: 4 tasks, up to 2 at once`), every task
that was under way carries on from its own last step, tasks already delivered are left alone,
and the rest of the list starts as slots free up. It keeps the number of tasks at once it started
with, whatever the setting says now. Pressing Ctrl-C stops a run of several tasks at once straight away with exit code 5, saying how to carry on.

While a run of several tasks at once is going, a second `delivery run` or `delivery resume` in the
same repository is refused straight away with exit code 2, naming the run that is going and
suggesting `delivery status` to see how it is getting on. The run holds a lock on the repository
for as long as it runs; if the command is killed or the machine goes down, the next `delivery run`
takes the lock over by itself, so there is never anything to unlock by hand.

A run keeps the task, the check and the closing action it started with, so a flag asking for
something else is ignored with a note saying so. Asking for a different task while a run is
unfinished stops the command: finish that run with `delivery resume`, or add `--fresh` to start
the new task and leave the old run to pick up later.

## Come back to your task list

After a list of tasks has run, overnight or while you were elsewhere, one command says what
happened and what to do about it, in plain words:

```bash
delivery report
```

```text
Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 not started.
Started 1 Oct 02:01 UTC; last activity 1 Oct 03:04 UTC.

NEEDS YOU (1)
  Task 3 of 4: "Remove every page under the old news section"
    Needs your decision. The agent stopped and said it could not go on without your say-so.
    The agent said: "This would delete 14 published pages. I need the owner to confirm before I remove them."
    Where the work is: this task's changes were not added to main.
    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.
            2. Run: delivery run
    Full account: delivery status remove-every-page-under-the-20261001T030000Z

DONE (2)
  Task 1 of 4: "Add a contact form to the site": merged into main at 02:19
  Task 2 of 4: "Update the prices page for October": merged into main at 02:31

NOT STARTED (1)
  Task 4 of 4: "Show a cookie banner on first visit"
  These are waiting behind task 3. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 3, then run `delivery run` to carry on with them.

FOR WHOEVER TUNES THIS
  Retries used across these tasks: agent corrections 0 of 9; check re-runs 0 of 9; check repairs 0 of 6; agent restarts 0 of 15; hand-off retries 0 of 9.
  Time and cost were not recorded for this run.
  Saved to: .delivery/last-report.txt and .delivery/last-report.json

Next: delivery status --all (every run)
```

The first line counts your tasks by what happened to them. Under it, each part appears only when
it has tasks in it:

- **Needs you:** a task that stopped for something only you can settle. It says what kind of stop
  it was ("Needs your decision", "Failed after 3 attempts", a usage limit), quotes what the agent
  itself said, says where the work is, and lists what to do under "To act".
- **Stopped, for your engineers:** a task stopped by a problem with the check, its repair or
  handing the work off. It is not a decision for you; it gives one line to pass on.
- **Done:** each finished task and where its work went, in the words of how your project lands
  work: merged, committed on a branch, or a pull request open.
- **Not finished:** tasks of a run that is still going, or that stopped part way.
- **Not started:** tasks nothing has run yet, with why they were left and how to carry on.

Words taken from a run (your task, what the agent said) are always in quotation marks; every other
sentence is the harness's own and is the same for every project. "For whoever tunes this" counts
the retries used, for the person who sets the limits, and names the saved copy of the report when
there is one.

`delivery report <run-id>` reports one task's run, or one run of several tasks at once, instead
of the list. In a project with no `tasks` list, `delivery report` reports the most recent run and
says so in its first line.

It never changes a run or its record, and takes no lock, so it is safe while a run is going: it then says the run is
still going rather than giving a final count, and how to follow it ("Follow it: delivery status
--watch"). For work that has not finished, its second line gives the last time the record shows
anything happening ("last activity 1 Oct 02:22 UTC"): a time from the record for you to judge
by, never a guess at whether the work is still going. Where nothing records whether a task worked one at a
time is still going, it says exactly that and how to carry on if it is not. If one run's record is
damaged, the report names that task and the file, says at the top that it is incomplete, and
still reports the rest. A run made by an earlier version still reports: where its record does not
say why a task stopped, the task appears under "Stopped, for your engineers" with the reason the
run recorded.

`delivery run` and `delivery resume` save the report when they end, and `delivery report --write`
saves the one it prints, for your list or for the run you name, as two files in your project's
`.delivery` folder: `last-report.txt`, the same text without colour, ready to open or paste into a message, and `last-report.json`, the same report as data.
Each save replaces the pair saved before. The files are copies for your convenience: only you can
read them, they are never committed with your project's work, and no command reads its answer
from them, so deleting them loses nothing. While the saved copy is the report you are looking at,
the report's last section names it ("Saved to: ..."). If the files cannot be written, the report
is still printed, with one line in that place saying it was not saved and why.

`report` exits 0 whenever the report could be made, whatever it says, and 2 when it could not (a
run id that names nothing). It prints text only for now: for one JSON document about a run, use
`delivery status --json`.

To see a report without an agent or a sign-in, run `npm run demo:report-slice-1` in a checkout of
this repository: it runs a list of four tasks against a scripted agent, prints the report, follows
its advice, and prints the report again.

## See what happened to a run

To find out how a run ended, in a new terminal or days later:

```bash
delivery status
```

It reads the run touched most recently, a single task's or a run of several at once, and says what
happened to it; while a run of several at once is going, that is the whole run rather than
whichever of its tasks moved last. `delivery status <run-id>`
names a run instead, and `delivery status --last` is the explicit form of the default. It only
ever reads: it never moves a run on, so it is safe to run while one is still going.

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
parts use the harness's own words (triage, gate, correction) on purpose: they are the words to
search the run's record for.

- **How it got here:** one line for each triage round, which is each time the harness had to
  decide what to do after a setback: the attempt it followed, what set it off, and the verdict.
- **Retry budgets:** how many retries of each of the five kinds were used of how many are
  allowed, and how many attempts the agent made.
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
written for a person. A round that wrote no brief says so ("none; this round wrote no brief"); one
whose brief or packet can no longer be read says "not recorded". `--decisions` cannot be
combined with `--all` or, for now, with `--json`: either stops with exit 2.

`status` exits 0 whenever it could read the run and 2 when it could not find one, so a run that
needs your decision is still a successful read. `status --watch` is the exception: it ends with
the code of the run it followed (see "Watch a run as it happens"). The exit codes in the table above are the run's
own, reported by `delivery run`.

Add `--json` to get the account as one JSON document instead of sentences (the triage rounds and
retry budgets are text only for now):

```bash
delivery status --last --json
```

It carries the run id, the task, where that task sits on your list, when it started and finished,
how it ended, the sentences the plain-language report prints about it, the branch, the base
branch, where the run's record is, and, for a run that stopped for a decision, every field of the
escalation packet. Every key is always present: a `null` means "not that kind of run", so
a script never has to check whether a key is there. A run that could not be found is still a
plain-language message on standard error and exit 2, not JSON.

### A run of several tasks at once

A run of several tasks at once has an id of its own, the one it opened with (`run-…`).
`delivery status run-20260930T090000Z` reads the whole run: when it started and its shape,
whether the environment the tasks share is healthy, how many tasks are done, need your
decision, stopped or are still queued, then one line per task in list order, naming the task's
own run id once it has one. A task that needs
your decision is followed by the same account `delivery status` gives of it on its own. A task
waiting only because every slot is busy shows as "queued, waiting for a free slot"; if the run
was stopped part way, it says how to carry it on. While the run is going, a task under way says
what it is doing right now, which attempt it is on and since when ("the agent is working, attempt 2,
since 2026-09-30 09:14 UTC"); once the run has stopped, it says "not finished yet". A run that
has not finished also says when its record last shows anything happening ("Last recorded
activity: 2026-09-30 09:14 UTC."). A run made by an earlier version recorded no times: it leaves
out "since" and says "Last recorded activity: not recorded."
Under the tasks come the retry budgets added up across the tasks the run has taken, beside the
run's own limit on repairs of what its tasks share, and a `Next:` line. With `--decisions`, every
task's triage rounds are printed in full beneath that.

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

To read one task in full: delivery status delete-the-greeting-20260930T090000Z

Next: delivery report run-20260930T090000Z (this run in plain words)
```

Every task keeps its own run id, and `delivery status <task-run-id>` reads it exactly as it
reads any other run.

If the environment the tasks share broke, the report opens with that before anything else:
whether it is being repaired or could not be fixed, which task found it and why, and which tasks
it held. Those tasks count as "paused until the shared environment is fixed". A run that
repaired its environment and carried on says so beside it: "Environment: healthy (repaired once during this run)"; `--json` has the detail under `trips`. If a usage limit stops the repair, the run stops at once and says that instead ("the AI service is limiting requests" or "the spending limit has been reached"); its record names the limit as the cause.

`delivery status run-… --json` gives the whole run as one document, for a script or for looking
back after the fact: the run id, when it started, how many tasks and how many at once, whether it
is going now, the environment, how it ended and when, why it stopped and whether the shared environment or a usage limit was the cause (`reason`, `cause`), how many repairs it used of its limit (`runBudgets`), every time its environment broke with the task that found it, the tasks it held and each repair attempt (`trips`), then `surfaces`, one entry per task it took,
each exactly the document `delivery status <task-run-id> --json` gives, and `queued`, the tasks
it has yet to start with their place on your list. Every key is always present, `null` where it
does not apply yet.

### Watch a run as it happens

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
line for each change: the time it was recorded (UTC), the task's place on your list, and what
the task is now doing, in the words `delivery run` prints. A line that needs your attention is
marked with `!` as well as its words. Lines are only ever added, never redrawn, so the output
reads the same in a terminal, through a pipe and in a log file. Trouble with the setup every
task shares, its repair and the tasks carrying on are told as lines of their own.

With no run id it follows your task list, as `delivery report` does, or the most recent run
when the project has no `tasks` list. `delivery status --watch <run-id>` follows one task's run
or one run of several tasks at once.

The watch ends when what it follows ends, with the counts `delivery report` opens with, and
its exit code is the one that run ended with (the table above), so a script can wait on it. A
list worked one task at a time ends when every task is done or when a task stops the list, with
the code `delivery run` gives for that; the pause between one task finishing and the next
starting does not end it. Nothing records whether such a list is still being worked on, so the
watch says so once, gives the last recorded activity, and keeps waiting: it never decides for
itself that a run has died. A run of several tasks at once does record that it is going; if it
was stopped part way, the watch says so and how to carry on, and exits 0.

It only ever reads the record, and takes no lock. It looks every 2 seconds; `--interval
<seconds>` changes that. A run made by an earlier version recorded no times: it can still be
watched, its lines leave the time out, and the watch says once that times were not recorded.
`--watch` cannot be combined with `--all`, with `--decisions` or, for now, with `--json`, and
`--interval` needs `--watch`: each stops with exit 2.

### See every run

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

A run of several tasks at once is one line: its shape and how its tasks stand. Its tasks are read
with `delivery status run-…`, and each of those by its own run id. Every line ends with the
counts `delivery report` opens with for that run, so a task that failed after its attempts reads
differently from one waiting on your decision.

`--all --json` gives the same list as an array, each entry with the run id, the task, the
instant it started, how it ended and `tasks`: `null` for a single run; for a run of several at
once, whose own `task` is `null`, the same four fields for each task it took. The list is ordered
by when each run started, so it is a history; `delivery status` with no run id reports the run you
were last working on, which is not always the newest one. A repository with no runs yet lists
nothing and exits 0.

## Set it up by answering a few questions

If you would rather not write the config file yourself:

```bash
delivery init
```

It asks a few things: a sentence or two about your project (press Enter to skip), what command
checks the agent's work (offering your project's own `npm test` when it has one), what should
happen to work that passes, and what you would like done, one thing at a time until you press
Enter on an empty answer. When you list more than one thing, it also asks whether to work on
some of them at the same time, saying what that costs and suggesting 2. Say yes and it asks how
many: press Enter for 2 or type another whole number of 1 or more, and it writes that as
`concurrency`. Say no, or press Enter, and it writes nothing about it, so the list is worked
through one at a time. It writes the answers to a `delivery.config.json` at the top of the
repository, which `delivery validate` checks and the next `delivery run` works through with
no flags at all. If there is already a config file there, it asks before replacing it and leaves
it as it was if you say no.

It asks questions, so it needs a terminal. Run in a pipe or in CI it says so and stops, rather
than guessing an answer on your behalf.

## Configure it once

Settings that belong to a project live in a `delivery.config.json` beside your code. The
command looks for one in the folder you run from and each folder above it, up to the top of
the repository, so you never have to name it. A `delivery.config.js` or `.mjs` exporting the
same object works too, for a project that needs to compute a value.

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

| Setting | What it says |
|---|---|
| `task` | One thing you want done, when it is the same every run. Use this or `tasks`, not both. |
| `tasks` | A list of things you want done, in the order you want them, each a sentence in your own words. `delivery run` with no `--task` works down the list, one run at a time. Editing the list between runs is expected: a new entry runs in its place, a reworded entry is a new task, and an entry you delete leaves its run in the history. |
| `domain` | What your project is, in your own words: every agent on every run of it is told this before its own instructions. A run keeps the description it started with, so editing it changes the next run, not one already going. A long one is easiest in a `delivery.config.js` with a template literal. `delivery preview` shows it in place. |
| `roles` | Changes what the worker, or the agent that repairs your check, is told and which tools it may use: `{ "worker": { "systemPromptFragment": "...", "allowedTools": ["Read", "Edit"] } }`, and `gateMaintenance` the same way. Anything you leave out keeps its built-in value. A run keeps the roles it started with. `delivery preview` shows the result. See [Configuring a role](docs/configuring-a-role.md#from-the-configuration-file). |
| `gate` | What decides whether a change is good. The simplest is a ready-made check chosen by name: `{ "type": "test-runner" }` runs your tests (add `"command"` if they are not run with `npm test`), `{ "type": "file-exists", "path": "CHANGES.md" }`, `{ "type": "command-succeeds", "command": "npm run lint" }`, or `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. `delivery validate` says what the chosen check does. To write one out in full, or write your own, see [Writing a gate](docs/writing-a-gate.md). |
| `closer` | What happens to accepted work: see [Writing a closer](docs/writing-a-closer.md) |
| `budgets` | How many attempts each kind of setback gets before the run asks a person: `correction`, `gateError`, `gateMaintenance`, `terminus` and `close`, each a whole number. Anything you leave out keeps its default (3, 3, 2, 5 and 3). With several tasks at once, `gateMaintenance` is also one limit for the whole run: how many times it may repair the environment the tasks share. A task still has its own for a check error only it has hit. |
| `concurrency` | How many tasks from your list may run at once, a whole number. The default, 1, works down the list one task at a time. 2 or more starts that many, each on its own copy with its own branch and record, and starts the next task on the list as soon as one finishes. |

A gate or closer of your own is named here rather than on the command line, because it needs a
module path: `{ "type": "custom", "modulePath": "./gates/mine.mjs" }`.

For a single run, a flag or an environment variable overrides the file. A flag beats an
environment variable, which beats the file, which beats the built-in default.

| Flag | Environment variable | What it sets |
|---|---|---|
| `--task "..."` or `--task-file <path>` | `DELIVERY_TASK` | What you want done |
| `--gate-command "npm test"` | `DELIVERY_GATE_COMMAND` | A check that passes when the command exits 0 |
| `--closer commit-to-branch` | `DELIVERY_CLOSER` | What happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--concurrency 3` | `DELIVERY_CONCURRENCY` | How many tasks from your list may run at once |
| `--config <path>` | `DELIVERY_CONFIG` | A config file somewhere else |

An unknown setting, a limit or a concurrency that is not a whole number, a closer type the harness doesn't know,
a role override that is empty or names a role that can't be changed, or a custom module it can't
load all stop the command before it starts, naming what to fix.
`delivery validate` finds the same mistakes without starting anything.

## Check your setup before a run

```bash
delivery validate
```

It reads your `delivery.config.json` the way `delivery run` would, says what it found, and stops:

```
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

If something is wrong it prints the one thing to fix instead, such as an empty task or two
tasks that say the same thing, and exits 2. It never starts an agent, needs no sign-in and no
network, and changes nothing on disk, so it is safe in CI on every push and safe while a run
is going. `--config <path>` and `--repo <path>` mean what they mean on `delivery run`.

For CI, add `--json` to get every problem at once instead of the first, as one JSON document:

```bash
delivery validate --json
```

```json
{
  "ready": false,
  "problems": [
    { "field": "tasks.1", "message": "I can't use …/delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it." },
    { "field": "domain", "message": "I can't use …/delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it." }
  ]
}
```

Each problem names the setting it concerns (list positions count from 0, and `null` means the
file as a whole) and says it in the same words as the plain form. A clean file gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`.

## See what the agent will be told

```bash
delivery preview
```

It prints, before anything runs, the instructions the next task on your list would be given,
word for word, with your project description in place, and then what the agent may do:

```
Next up is Task 1 of 3: add a page that shows who's on call today

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.

## Task
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run commands.
```

`--queue-index 3` shows the third task on your list instead, numbered as "Task 3 of 3" numbers
it. `--role gate-maintenance` shows what the agent that repairs your check is told when the
check can't run. A project with a single `task` shows that one. Like `delivery validate`, it
needs no agent, no sign-in and no network, changes nothing on disk, reports a problem with your
configuration in the same words, and takes `--config` and `--repo`.

## Documentation

- [Getting started](docs/getting-started.md): install the command and finish your first run
- [Setting up a project](docs/project-configuration.md): describe a project, list its tasks, check, preview and run them
- [When the shared environment breaks](docs/shared-environment.md): what a run of several tasks at once does when the environment its tasks share breaks, with an example to try
- [Design docs](docs/)
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent, one task at a time or several at once
- [Contributing](CONTRIBUTING.md)
