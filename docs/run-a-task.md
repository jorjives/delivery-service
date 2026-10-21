# Run a task

This guide shows how to hand one task to the agent and find out how it ended. You need the command installed and Claude Code signed in; see [Get started](getting-started.md). To try it on something small first, use the [sample project](https://github.com/jorjives/delivery-service/tree/main/examples/sample-project).

In a git repository whose `package.json` has a `test` script:

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

`delivery` hands the task to an agent working on a separate copy of your repository and checks the
result with `npm test`. Unless you configure otherwise, the harness commits the work to a new branch
and leaves your base branch alone. It prints a line for each step, and ends by naming the branch
or, if the agent needs a decision from you, by naming the decision:

```text
Starting run <run-id>: add a function that says hello to a name, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that says hello to a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
This run: 1 of 1 task completed and committed to its own branch.
Run `delivery report <run-id>` for what to do.
```

The exit code says how it ended; see the [Command reference](cli-reference.md) for the codes and
for `--json` output. Each run keeps its record in `.delivery/runs/`, which git ignores, so
`git status` does not change. The agent's working copy lives under
`~/.local/state/delivery-service/worktrees/` (or `$XDG_STATE_HOME`, when set).

## If it does not start

If the command refuses to start, it prints one of these messages and exits with code 2.

- It cannot start the agent because Claude Code is not signed in:

    ```text
    I can't start the agent that does the work: you're not signed in. Run `claude auth login`, or set `ANTHROPIC_API_KEY`, then try again.
    ```

- You are not in a git repository. Run `git init` there, or point `--repo <path>` at one:

    ```text
    This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.
    ```

- Your `package.json` has no `test` script, so there is nothing to check the work with. Name a
  command with `--gate-command`, or add a `test` script:

    ```text
    I couldn't find a command to check the agent's work with. Tell me what marks a change as good, for example `--gate-command "npm test"`, or add a `test` script to your `package.json`.
    ```

    ```bash
    delivery run --task "add a function that says hello to a name, with a test" --gate-command "npm test"
    ```

    `--closer` chooses what happens to work that passes: `commit-to-branch`, `merge-back` or
    `open-pr`.

If you have uncommitted changes, the run still starts but first prints a note, because the agent
works from your last commit and will not see them:

```text
Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.
```

For other messages, see [Troubleshooting](troubleshooting.md).

## Next steps

- [Work through a task list](run-a-task-list.md): run several tasks in order
- [Pick up an interrupted run](resume-a-run.md): carry on after a stop
- [Command reference](cli-reference.md): every option, the exit codes and `--json` output
