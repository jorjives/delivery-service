# delivery-service

A deterministically gated agent delivery harness.

## Quick start

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
`ANTHROPIC_API_KEY`). The command checks the sign-in before it starts. Until the package is
published, build and link the command from this checkout with `npm run build && npm link`.

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

- [Design docs](docs/)
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent
- [Contributing](CONTRIBUTING.md)
