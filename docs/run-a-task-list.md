# Work through a task list

This guide shows how to keep a list of tasks in `delivery.config.json` and have the agent work down it, one at a time or several at once. It assumes you have [set up a project](project-configuration.md) and [checked your setup](check-your-setup.md).

## Work down the list

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

Then run the list:

```bash
delivery run
```

By default it works down the list one task at a time. Each task is an ordinary run with its own
branch and record, and the command says which task it is on. The sample is shortened:

```text
Task 1 of 3: add a page that shows who's on call today
Starting run <run-id>: add a page that shows who's on call today
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Task 2 of 3: let someone swap their on-call day with a teammate
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 3 of 3 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

Run it again whenever you like. It works out where it got to from the runs already in the
repository, so an interrupted list picks up the task it was on. A task that needs a decision from
you stops the list there rather than being skipped, and running the command again stops in the
same place until you deal with it.

Every `delivery run` and `delivery resume` ends with the last two lines: the first sentence of the
report, and the command that prints the rest. The command saves the report as it ends, as
`.delivery/last-report.txt` and `.delivery/last-report.json`, replacing the previous pair, so the
result waits as a file for whoever was not there. If the save fails, the run ends as it would
have, with its usual exit code and one line saying so.

## Work on several tasks at once

Add `"concurrency": 2` (or more) to the file, or pass `--concurrency 2` for one run. Each task
still gets its own working copy, branch and record, and its own agent session, so spend rises with
the number at once. The next task on the list starts as soon as one finishes. Every line names its
task:

```text
Starting run run-20260926T090000Z: 3 tasks, up to 2 at once
[1/3] Starting run <run-id>: add a page that shows who's on call today
[1/3] - setting up
[2/3] Starting run <run-id>: let someone swap their on-call day with a teammate
[2/3] - setting up
…
[1/3] Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/<run-id>.
[3/3] Starting run <run-id>: send a reminder the morning before someone's on-call day starts
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 3 of 3 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

A task that needs a decision from you does not hold up the others. The next task takes its place,
and the run ends by naming each task that needs you. The exit code is 0 only if every task was
delivered, 4 if any needs a decision, and 5 if a task stopped for another reason and none needs a
decision.

Two tasks that finish together take turns closing. With the `merge-back` closer, the second merge
is refused because the first moved the base branch on; that task is handed back to you in the
usual way. Each run of several at once also keeps a small record of its own under
`.delivery/supervised/`.

If a check breaks for every task at once, the run pauses the tasks that are about to check their
work, repairs the environment once, and carries on. See
[When the shared environment breaks](shared-environment.md).

## Change the list between runs

Edit the list between runs as you like:

- Add an entry anywhere: it runs when its turn comes.
- Reorder entries: tasks run in the new order, and finished ones are not repeated.
- Delete an entry: its run stays in the history.
- Reword an entry: it becomes a new task and runs again, which is how you deliberately repeat a
  finished task.

`delivery run --task "<task>"` always runs exactly that one task and leaves the list alone.

## Next steps

- [Read the report](read-a-report.md): see what happened and what to do next
- [When the shared environment breaks](shared-environment.md): what several tasks at once do when their shared setup fails
- [Pick up an interrupted run](resume-a-run.md): pick up a run after a stop
