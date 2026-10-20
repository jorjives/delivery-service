# Configuration reference

This page lists every setting in `delivery.config.json`, and the flags and environment variables that override them for one run.

Settings that belong to a project live in a `delivery.config.json` beside your code. The
command looks for one in the folder you run from and each folder above it, up to the top of
the repository, so you never have to name it. A `delivery.config.js` or `.mjs` exporting the
same object works too, for a project that needs to compute a value.

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

| Setting | What it says |
|---|---|
| `task` | One thing you want done, when it is the same every run. Use this or `tasks`, not both. |
| `tasks` | A list of things you want done, in the order you want them, each a sentence in your own words. `delivery run` with no `--task` works down the list, one run at a time. Editing the list between runs is expected: a new entry runs in its place, a reworded entry is a new task, and an entry you delete leaves its run in the history. |
| `domain` | What your project is, in your own words: every agent on every run of it is told this before its own instructions. A run keeps the description it started with, so editing it changes the next run, not one already going. A long one is easiest in a `delivery.config.js` with a template literal. `delivery preview` shows it in place. |
| `gate` | What decides whether a change is good. The simplest is a ready-made check chosen by name: `{ "type": "test-runner" }` runs your tests (add `"command"` if they are not run with `npm test`), `{ "type": "file-exists", "path": "CHANGES.md" }`, `{ "type": "command-succeeds", "command": "npm run lint" }`, or `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`, or `{ "type": "commits-ahead" }` (the work added at least one commit). `delivery validate` says what the chosen check does. To write one out in full, or write your own, see [Writing a gate](writing-a-gate.md). |
| `closer` | What happens to accepted work: see [Writing a closer](writing-a-closer.md) |
| `budgets` | How many attempts each kind of setback gets before the run asks a person: `correction`, `gateError`, `gateMaintenance`, `terminus` and `close`, each a whole number. Anything you leave out keeps its default (3, 3, 2, 5 and 3). With several tasks at once, `gateMaintenance` is also one limit for the whole run: how many times it may repair the environment the tasks share. A task still has its own for a check error only it has hit. |
| `concurrency` | How many tasks from your list may run at once, a whole number. The default, 1, works down the list one task at a time. 2 or more starts that many, each on its own copy with its own branch and record, and starts the next task on the list as soon as one finishes. |
| `fence` | Whether the agent works inside a fence that keeps your main folder read-only while it works in its own copy: `"preferred"` (the default: used wherever it works, otherwise the run goes ahead and says so first), `"required"` (a run will not start without it), or `"off"`. An object such as `{ "mode": "required", "devices": ["/dev/kvm"] }` also passes host devices through. The fence needs bubblewrap (`bwrap`), on Linux. |
| `workflows` | Named ways of doing a task in more than one checked step. Each is a list of `steps` run in order; a step has a `name`, a `prompt`, and optionally its own `gate`, `agent` options, `guards`, and `continue: true` to pick up the previous step's session. Run one with `delivery run --task "..." --workflow <name>`. See [Setting up a project](project-configuration.md#workflows). |
| `notify` | A command of your own, run at the end of every run with the run's report as JSON on its standard input, parked items and their questions included, so you can send it wherever you read messages. |

A gate or closer of your own is named here rather than on the command line, because it needs a
module path: `{ "type": "custom", "modulePath": "./gates/mine.mjs" }`.

For a single run, a flag or an environment variable overrides the file. A flag beats an
environment variable, which beats the file, which beats the built-in default.

| Flag | Environment variable | What it sets |
|---|---|---|
| `--task "..."` or `--task-file <path>` | `DELIVERY_TASK` | What you want done |
| `--gate-command "npm test"` | `DELIVERY_GATE_COMMAND` | A check that passes when the command exits 0 |
| `--closer commit-to-branch` | `DELIVERY_CLOSER` | What happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--concurrency 3` | `DELIVERY_CONCURRENCY` | How many tasks from your list may run at once |
| `--config <path>` | `DELIVERY_CONFIG` | A config file somewhere else |

An unknown setting, a limit or a concurrency that is not a whole number, a closer type the harness doesn't know,
a role override that is empty or names a role that can't be changed, or a custom module it can't
load all stop the command before it starts, naming what to fix.
`delivery validate` finds the same mistakes without starting anything.

## Next steps

- [Set up a project](project-configuration.md): a worked example
- [Command reference](cli-reference.md): every command and option
