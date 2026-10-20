# Pick up an interrupted run

This guide shows how to carry on a run that stopped before it finished, whether you closed the terminal, pressed Ctrl-C or the machine restarted.

If a run stops before it finishes, because you closed the terminal, pressed Ctrl-C or the
machine restarted, run the same command again in the same repository:

```bash
delivery run
```

It finds the run that did not finish, says what it is picking up, and carries on from there
rather than starting over. `delivery resume` does the same and never starts a new run: give it
a run id, or `--last` for the run touched most recently. If more than one run did not finish, it
lists them and asks which one. In a script or a CI step, where nobody can answer, it prints the
list and stops.

A run of several tasks at once is picked up the same way, with `delivery run`. It says which run
it is carrying on (`Picking up run run-20260926T090000Z: 4 tasks, up to 2 at once`). Every task
that was under way carries on from its own last step, delivered tasks are left alone, and the
rest of the list starts as slots free up. The run keeps the number of tasks at once that it
started with, whatever the setting says now. Ctrl-C stops a run of several tasks at once straight
away with exit code 5, and says how to carry on.

While a run of several tasks at once is going, a second `delivery run` or `delivery resume` in the
same repository is refused straight away with exit code 2. The refusal names the running run and
suggests `delivery status` to see how it is getting on. The run holds a lock on the repository
for as long as it runs. If the command is killed or the machine goes down, the next `delivery run`
takes the lock over by itself, so there is never anything to unlock by hand.

A run keeps the task, the check and the closing action it started with, so it ignores a flag
asking for something else and says so in a note. Asking for a different task while a run is
unfinished stops the command. Finish that run with `delivery resume`, or add `--fresh` to start
the new task and leave the old run to pick up later.

`--workflow <name>` does the task in the steps of a workflow from your config file; see
[Workflows](project-configuration.md#workflows).

## Next steps

- [See what happened to a run](check-a-run.md): read a run without changing it
- [How it works](concepts.md): why a run can be picked up
