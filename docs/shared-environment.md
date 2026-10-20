# When the shared environment breaks

A run of several tasks at once uses one shared environment: files in the repository outside every task's copy. When something in that environment goes missing or becomes unusable, the first task to notice stops the entire run. The environment is then fixed once, not by every task.

This guide walks through a concrete example. You break the shared helper that the checks rely on, watch the run stop with that named as the cause, read what happened, fix it and carry on. The last two steps show a helper that comes and goes, and how the run tells one task's hiccup from a problem every task shares.

## 1. Get the example project

Copy the example and set it up as a git repository:

```text
$ cp -r examples/shared-environment-example .
$ cd shared-environment-example
$ git init -b main
$ git add .
$ git commit -m "start"
```

This example is a library of text helpers. Its check lives in the repository at `check.mjs`. On every run it reads a shared helper, `shared/helper.json`, which names the command that runs the tests. Every task's check reads the same helper, so if it goes missing, no task can check its work: the shared environment is broken.

The example runs four tasks two at a time.

## 2. Break the shared helper and run the list

Delete the helper and run the list:

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
✓ Fixed. Resuming.
…
Couldn't fix it after 2 attempts. Stopping the run. 2 of 4 tasks were waiting on this and need your attention; 0 had already finished, 2 are still queued.
Your task list: 4 tasks: 2 not finished, 2 not started.
Run `delivery report` for what to do.
```

Three things happen at once:
1. The run notices the shared environment is broken (the helper is missing).
2. It holds any task about to check or hand off its work. Tasks already running keep going, so your work is not lost.
3. It runs one repair, to try to restore the helper. The repair can change files inside a task's own copy, but not outside every copy. After two attempts it stops, names the shared environment as the cause, and exits with code 4.

With a real agent, there can be fewer attempts, since the agent may say at once that it cannot reach the helper. The mock says "done" every time.

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
```

The report opens with what broke, which task found it first, and which tasks it held. Those tasks stay "paused" until the environment is fixed.

To look back afterwards, run `delivery status <run-id> --json` and read the `trips` key. It names every time the shared environment broke, the task that found it, the tasks it held, and each repair attempt.

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

A helper missing from the start is found before any task begins, so the run treats it as shared at once. A helper that fails now and then, while a task's finished work is being checked, looks like a one-off hiccup. The run waits for a second, different task to hit it before calling it shared.

The example's check can act this out. Start again from a fresh copy of the example (step 1), then tell the check that the helper must not answer the first two tasks that check their work, four times each:

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

Four is one check plus the three free re-checks every task gets (`budgets.gateError`). What happens:

1. The first task to run out of re-checks is on its own. The run says nothing and holds no other task. The task repairs its own check on its own limit, as a task run by itself would.
2. When a second, different task runs out too, two tasks have the same problem. The run says the shared environment looks broken, holds checks and hand-offs, repairs once and carries on.
3. The same task erroring again does not count twice. Once a repair has worked, the count starts afresh.

With `"tasks": 1` only one task is affected. It sorts itself out and you see no run-wide message.

A session stopped by a usage limit never counts here. The run reports it as what it is: "the AI service is limiting requests" or "the spending limit has been reached".

## 6. Look back at the repair

```bash
delivery status
```

```text
Run <run-id>, started <when>: 4 tasks, up to 2 at once
Environment: healthy (repaired once during this run)
4 done
```

The environment line says the run repaired it. `delivery status <run-id> --json` has the detail under `trips`: for this run, `cause.surfaceIds` names the two tasks whose check kept erroring. Remove `shared/outage.json` when you finish.

To see what the repair changed, read the task it ran in:

```bash
delivery status <task-id> --repairs
```

It lists every file the repair changed in that task's copy, with the lines added and removed and
the patch, and marks a file the check itself runs. When a repair changed such a file, `delivery
report` says so under "Worth a look", names the task and the file, and gives this command. It
cannot tell you whether the change was safe; you must read it.

## When the repair can fix it

If what broke is something the repair can reach (a file inside a task's own copy), the run says "Fixed. Resuming.", held tasks carry on, and `delivery status` shows "Environment: healthy (repaired once during this run)". The shared environment is back in use, and your tasks finish where they left off.
