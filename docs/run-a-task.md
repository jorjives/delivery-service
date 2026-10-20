# Run a task from the command line

This guide shows how to hand one task to the agent and find out how it ended. You need the command installed (see [Get started](getting-started.md)), Node 22 or later, git, and a signed-in Claude Code.

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
follow [Getting started](getting-started.md): it packs this checkout and installs the
result, because the package is not on the public registry until a licence is chosen.

Each run keeps its record in `.delivery/runs/` in your repository (the folder ignores everything in it except `.delivery/backlog/`, your work items,
so `git status` does not change) and its working copy under
`~/.local/state/delivery-service/worktrees/` (or `$XDG_STATE_HOME`, when set). The item ledger,
which remembers how each backlog item's runs ended, is kept beside them in
`~/.local/state/delivery-service/ledger/`, on this machine only.

`delivery --help` and `delivery run --help` list the options; `--no-color`, or setting
`NO_COLOR`, turns colour off.

To try it on something small first, use the [sample project](https://github.com/jorjives/delivery-service/tree/main/examples/sample-project).

## Next steps

- [Work through a task list](run-a-task-list.md): run several tasks in order
- [Command reference](cli-reference.md): exit codes and `--json` output
