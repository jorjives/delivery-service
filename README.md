# delivery-service

A deterministically gated agent delivery harness.

## Quick start

New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project.

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

`delivery --help` and `delivery run --help` list the options; `--no-color`, or setting
`NO_COLOR`, turns colour off.

To try it on something small first, use the [sample project](examples/sample-project/README.md).

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

A run keeps the task, the check and the closing action it started with, so a flag asking for
something else is ignored with a note saying so. Asking for a different task while a run is
unfinished stops the command: finish that run with `delivery resume`, or add `--fresh` to start
the new task and leave the old run to pick up later.

## See what happened to a run

To find out how a run ended, in a new terminal or days later:

```bash
delivery status
```

It reads the run touched most recently and says what happened to it. `delivery status <run-id>`
names a run instead, and `delivery status --last` is the explicit form of the default. It only
ever reads: it never moves a run on, so it is safe to run while one is still going.

What you get depends on how the run ended:

- **Finished:** what was done, when it finished, and the branch the work is on.
- **Stopped for a decision:** the decision it needs from you first, then the evidence behind it,
  what had already been tried, why it stopped when it did, and the agent sessions it covers, all
  in the harness's own words. Then where its branch, its working copy and its record are.
- **Stopped for another reason:** why, in plain language.
- **Not finished yet:** what picking it up will carry on with, and the command to do that.

`status` exits 0 whenever it could read the run and 2 when it could not find one, so a run that
needs your decision is still a successful read. The exit codes in the table above are the run's
own, reported by `delivery run`.

## Configure it once

Settings that belong to a project live in a `delivery.config.json` beside your code. The
command looks for one in the folder you run from and each folder above it, up to the top of
the repository, so you never have to name it. A `delivery.config.js` or `.mjs` exporting the
same object works too, for a project that needs to compute a value.

```json
{
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

| Setting | What it says |
|---|---|
| `task` | What you want done, when it is the same every run |
| `gate` | What decides whether a change is good: see [Writing a gate](docs/writing-a-gate.md) |
| `closer` | What happens to accepted work: see [Writing a closer](docs/writing-a-closer.md) |
| `budgets` | How many attempts each kind of setback gets before the run asks a person: `correction`, `gateError`, `gateMaintenance`, `terminus` and `close`, each a whole number. Anything you leave out keeps its default (3, 3, 2, 5 and 3). |

A gate or closer of your own is named here rather than on the command line, because it needs a
module path: `{ "type": "custom", "modulePath": "./gates/mine.mjs" }`.

For a single run, a flag or an environment variable overrides the file. A flag beats an
environment variable, which beats the file, which beats the built-in default.

| Flag | Environment variable | What it sets |
|---|---|---|
| `--task "..."` or `--task-file <path>` | `DELIVERY_TASK` | What you want done |
| `--gate-command "npm test"` | `DELIVERY_GATE_COMMAND` | A check that passes when the command exits 0 |
| `--closer commit-to-branch` | `DELIVERY_CLOSER` | What happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--config <path>` | `DELIVERY_CONFIG` | A config file somewhere else |

An unknown setting, a limit that is not a whole number, a closer type the harness doesn't know
or a custom module it can't load all stop the command before it starts, naming what to fix.

## Documentation

- [Getting started](docs/getting-started.md): install the command and finish your first run
- [Design docs](docs/)
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent
- [Contributing](CONTRIBUTING.md)
