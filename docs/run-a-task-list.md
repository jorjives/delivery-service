# Work through a task list

This guide shows how to keep a list of tasks in `delivery.config.json` and have the agent work down it, one at a time or several at once. It assumes you have [set up a project](project-configuration.md).

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

By default it works down the list one task at a time. Each task is an ordinary run with its own
branch and record, and the command says which task it is on:

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

Run it again whenever you like. It works out where it got to from the runs already in the
repository, so an interrupted list picks up the task it was on. A task that needs a decision from
you stops the list there rather than being skipped, and running the command again stops in the
same place until you deal with it.

To work on several tasks at the same time, add `"concurrency": 2` (or more) to the file,
or pass `--concurrency 2` for one run. Each task still gets its own copy, branch and record,
and the next task on the list starts as soon as one finishes. Every line names its task:

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
report, and the command that prints the rest. The command saves the report as it ends, as
`.delivery/last-report.txt` and `.delivery/last-report.json`, replacing the previous pair, so the
result waits as a file for whoever was not there. If the save fails, the run ends as it would
have, with its usual exit code and one line saying so.

With several at once, a task that needs a decision from you does not hold up the others. The next
task takes its place, and the run ends by naming each task that needs you. The exit code is 0
only if every task was delivered, and 4 if any needs a decision. Setting up and removing working
copies, and merging finished work back, take turns in your checkout, so two tasks finishing
together both close properly. With the `merge-back` closer, the second merge is refused because
the first moved the base branch on, and the task is handed back to you in the usual way. Each
run of several at once also keeps a small record of its own under `.delivery/supervised/`.

If the environment your tasks share breaks during a run of several at once, the run does not let
every task discover it, retry and fight over it. A check that cannot run at all before a task has
started is treated as shared straight away. A check that keeps erroring on a task's finished work
(the check itself erroring, not a failing test) is first that task's own business: the task
re-checks, then repairs its own check on its own limit, and no other task is affected. The run
treats the problem as shared only when a second, different task hits it. The same task erroring
again does not count twice, and a successful repair starts the count afresh. Once the problem is
shared, the run holds any task about to check or hand off its work, leaves work already under way
alone, and repairs the environment once, with the same agent that repairs a check for a single
task:

```text
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
```

Repair attempts share one limit for the whole run, `budgets.gateMaintenance` (2 unless you set
it). If the repair cannot fix the problem within that limit, the run stops and exits 4. It says
how many tasks were waiting on the repair, had finished and are still queued, and its record names
the shared environment, not any task, as the cause. The tasks it held keep their place: once you
have fixed the environment, `delivery run` carries them on.

Edit the list between runs as you like. A new entry anywhere runs in its place. Reordering changes
only the order of the visits. Deleting an entry leaves its run in the history. Rewording an entry
makes it a new task, which is also how you deliberately run a finished task again.
`delivery run --task "..."` always runs exactly that one task and leaves the list alone.

## Next steps

- [Read the report](read-a-report.md): see what happened and what to do next
- [When the shared environment breaks](shared-environment.md): what several tasks at once do when their shared setup fails
- [Pick up an interrupted run](resume-a-run.md): carry on after a stop
