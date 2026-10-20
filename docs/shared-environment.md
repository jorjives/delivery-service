# When the shared environment breaks

This guide shows what happens when files that several tasks share break during a run of a task list. You break a shared helper on purpose, watch the run stop with that named as the cause, read what happened, repair it and carry on. It is for anyone running a [task list](run-a-task-list.md) with `concurrency` above 1, and it assumes you have completed [Set up a project](project-configuration.md).

A run of several tasks at once uses one [shared environment](glossary.md#shared-environment): files in the repository outside every task's working copy. When something there goes missing or becomes unusable, the first task to notice stops the whole run. The environment is then repaired once, not by every task.

## What you need

- The `delivery` command and a checkout of the harness, as [Set up a project](project-configuration.md#what-you-need) describes: step 1 copies the example from its `examples/` folder.
- Node.js 22 or later, and `git`.
- Claude Code, signed in (check with `claude auth status`). The runs below start real agent sessions and cost what any run costs. The output shown here was produced with the [scripted agent](glossary.md#scripted-agent) instead, whose sessions always report that they finished; [Test your pipeline](testing-your-pipeline.md) explains it.

In the output below, `<run-id>`, `<when>`, `<path>` and `<task-pos>` stand for values specific to your run.

## 1. Get the example project

From the root of your harness checkout, copy the example outside it and set it up as a git repository:

```bash
cp -r examples/shared-environment-example ~/shared-environment-example
cd ~/shared-environment-example
git init -b main
git add .
git commit -m "start"
```

This example is a library of text helpers. Its check lives in the repository at `check.mjs`. On every run it reads a shared helper, `shared/helper.json`, which names the command that runs the tests. Every task's check reads the same helper, so if it goes missing, no task can check its work: the shared environment is broken.

The example runs four tasks two at a time.

## 2. Break the shared helper and run the list

Delete the helper and run the list. The deletion is not committed, so the run prints a note that the agent works from your last commit; that is expected here.

```bash
rm shared/helper.json
delivery run
```

```text
Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.
Starting run <run-id>: 4 tasks, up to 2 at once
…
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
…
✓ Fixed. Resuming.
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 2 of 2)
✓ Fixed. Resuming.
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
Couldn't fix it after 2 attempts. Stopping the run. 2 of 4 tasks were waiting on this and need your attention; 0 had already finished, 2 are still queued.
Your task list: 4 tasks: 2 not finished, 2 not started.
Run `delivery report` for what to do.
```

Three things happen:

1. The run notices the shared environment is broken (the helper is missing).
2. It holds any task about to check or hand off its work. Tasks already running keep going, so their work is not lost.
3. It sends an agent to repair the environment. A repair can change files inside a task's own working copy, but not the shared files outside every copy, so the helper stays missing. After two attempts the run stops, names the shared environment as the cause, and exits with code 4, the code for a run that needs you ([Command reference](cli-reference.md#exit-codes)).

The scripted agent says "done" after each repair, which is why "Fixed. Resuming." appears even though nothing was fixed. A real agent usually reports that it cannot reach the helper, and the run stops after fewer attempts.

## 3. See what stopped it

```bash
delivery status
```

```text
The shared environment could not be fixed after 0 attempts, so the run stopped; no task caused this.
It was first noticed by [<task-pos>/4] add a function that shortens long text to a given length, with a test: the shared helper <path>/shared/helper.json is missing, so the check cannot run.
Held: [<task-pos>/4] add a function that shortens long text to a given length, with a test, [<task-pos>/4] add a function that turns a title into a URL slug, with a test.
Once it is fixed, `delivery run` carries the held tasks on.

Run <run-id>, started <when>: 4 tasks, up to 2 at once
Environment: something in the shared environment looks broken
2 paused until the shared environment is fixed, 2 queued
…
```

The report opens with what broke, which task found it first, and which tasks it held. The summary calls those tasks "paused"; they are the ones on the `Held` line. They wait until the environment is fixed.

To look back afterwards, run `delivery status <run-id> --json` and read the `trips` key: each time the shared environment broke, the task that found it, the tasks it held and the repair attempts. [Reports as data](reporting.md) describes the output.

## 4. Put it back and carry on

Restore the helper and run the list again:

```bash
git checkout -- shared/helper.json
delivery run
```

```text
Starting run <run-id>: 4 tasks, up to 2 at once
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 4 of 4 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

A new run picks up the held tasks from the stopped run and starts the queued ones. Each task runs, checks its work and closes. The run finishes cleanly.

## 5. A helper that comes and goes

When the check cannot run at a task's starting point, as in step 2, the run treats the cause as shared at once. A helper that fails now and then, while a task's finished work is being checked, looks like a one-off hiccup. The run waits for a second, different task to hit it before calling it shared.

The example's check can act this out. Start again from a fresh copy of the example (step 1), with the helper in place, then tell the check that the helper must not answer the first two tasks that check their work, four times each:

```bash
echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json
delivery run
```

```text
Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.
Starting run <run-id>: 4 tasks, up to 2 at once
…
! Something in the shared environment looks broken. Holding any task about to check or hand off its work while it is repaired; work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
…
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 4 of 4 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

Four is one check plus the three free re-checks every task gets (the `gateError` setting under `budgets`; see [Configuration reference](configuration-reference.md#budgets)). What happens:

1. The first task to run out of re-checks is on its own. The run says nothing and holds no other task. The task repairs its own check on its own limit, as a task run by itself would.
2. When a second, different task runs out too, two tasks have the same problem. The run says the shared environment looks broken, holds checks and hand-offs, repairs once and carries on.
3. The same task erroring again does not count twice. Once a repair has worked, the count starts afresh.

With `"tasks": 1` only one task is affected. It sorts itself out and you see no run-wide message.

A session stopped by a usage limit never counts here. The run reports it as what it is: "the AI service is limiting requests" or "the spending limit has been reached".

When what broke is something the repair can reach, a file inside a task's own working copy, the run says "Fixed. Resuming." and the held tasks carry on where they left off.

## 6. Look back at the repair

```bash
delivery status
```

```text
Run <run-id>, started <when>: 4 tasks, up to 2 at once
Environment: healthy (repaired once during this run)
4 done
```

The environment line says the run repaired it. `delivery status <run-id> --json` has the detail under `trips`: for this run, `cause.surfaceIds` names the two tasks whose check kept erroring.

To see what the repair changed, read the task it ran in:

```bash
delivery status <task-id> --repairs
```

`<task-id>` is the run id shown beside the task in `delivery status`. The command lists every file the repair changed in that task's working copy, with the lines added and removed and the patch, and marks a file the check itself runs. When a repair changed such a file, `delivery report` says so under "Worth a look", names the task and the file, and gives this command. It cannot tell you whether the change was safe; you must read it.

When you finish, remove the outage file:

```bash
rm shared/outage.json
```

## Next steps

- [See what happened to a run](check-a-run.md) covers `delivery status` in full.
- [Work through a task list](run-a-task-list.md) explains running several tasks at once.
- [Command reference](cli-reference.md) lists every command and exit code.
