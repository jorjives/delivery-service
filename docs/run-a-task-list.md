# Work through a list of tasks

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
