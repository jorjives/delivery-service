# Pick up an interrupted run

This guide shows how to pick up a run that stopped before it finished, whether you closed the terminal, pressed Ctrl-C or the machine restarted. It does not start the agent again from scratch: the run carries on from its last step.

## Pick up a single run

Run the same command again in the same repository:

```bash
delivery run
```

If you started the run with `--task` and your configuration file has a `tasks` list, `delivery run` works the list instead, so repeat the same `--task`, or use `delivery resume`.

`delivery resume` never starts a new run: give it a run id, or `--last` for the run touched most
recently.

```bash
delivery resume --last
```

Either command says what it is picking up, then carries on from there:

```text
Picking up where it left off: checking the agent's work.
```

If more than one run did not finish, it lists them and asks which one:

```text
More than one run didn't finish. Which one should I pick up?
  1. <run-id>, started <when>: add a page that shows who's on call today
  2. <run-id>, started <when>: let someone swap their on-call day with a teammate
Type its number and press Enter.
```

In a script or a CI step, where nobody can answer, it prints the list, with the line
``Say which one to pick up: `delivery resume <run-id>`, or `delivery resume --last` for the one touched most recently.``
and exits with code 2.

## Pick up a run of several tasks at once

Use `delivery run`; `delivery resume` does not pick these up. It says which run it is picking up
(`Picking up run run-20260926T090000Z: 4 tasks, up to 2 at once`). Every task that was under way
carries on from its own last step, delivered tasks are left alone, and the rest of the list starts
as slots free up. The run keeps the number of tasks at once that it started with, whatever the
setting says now. Ctrl-C stops a run of several tasks at once straight away with exit code 5, and
says how to pick it up.

While a run is going in a repository, any other `delivery run`, `delivery resume`, `delivery sign-off`
or `delivery review` there is refused straight away with exit code 2, whether that run works one task
at a time or several at once. The refusal names the running run when it is one of several at once,
and suggests `delivery status` to see how it is getting on. If the command is killed or the machine
goes down, the next `delivery run` takes over by itself; there is nothing to unlock by hand.

## Change the task of an unfinished run

A run keeps the task, the check and the closing action it started with, so it ignores a flag
asking for something else and says so in a note. Asking for a different task while a run is
unfinished stops the command. Finish that run with `delivery resume`, or add `--fresh` to start
the new task and leave the old run to pick up later.

## If there is nothing to pick up

A run that has ended, whether it was delivered, needs your decision or stopped, is finished, and
`delivery resume` refuses it:

```text
There's no run here that didn't finish, so there is nothing to pick up. Start one with `delivery run --task "..."`.
```

```text
The run `<run-id>` has already finished, so there is nothing to pick up. Start a new one with `delivery run --task "..."`.
```

Both exit with code 2. Read a finished run with `delivery status` or `delivery report`. If a task
on your list needs a decision from you, deal with it as the report says, then run `delivery run`
again.

## Next steps

- [See what happened to a run](check-a-run.md): read a run without changing it
- [How it works](concepts.md): why a run can be picked up
