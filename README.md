# delivery-service

A deterministically gated agent delivery harness.

## Quick start

New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project. Then [Setting up a project](docs/project-configuration.md)
sets up a whole project, with a description and a list of tasks, in a complete example.

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

For a script or a CI step, add `--json`:

```bash
delivery run --json --task "add a function that says hello to a name, with a test"
```

Instead of the plain-language lines, each step prints as one JSON object on its own line, with
the harness's own state name, whether the run is over, anything the step had to put right, and
when it happened:

```text
{"state":"PROVISIONING","done":false,"at":"2026-09-16T12:00:00.000Z"}
{"state":"AGENT_ACTIVE","done":false,"at":"2026-09-16T12:00:11.284Z"}
{"state":"CLOSED","done":true,"at":"2026-09-16T12:01:39.002Z"}
```

The exit codes are the same ones in the table above, so a script reads the outcome from the exit
code and the detail from `delivery status --json`. Everything that is not a step, such as which
run started, any warning and the closing sentence, goes to standard error, so standard output is
only ever JSON.
`--json` works on `delivery resume`, `delivery status` and `delivery validate` too. Without it the output is
plain-language lines everywhere, piped or in CI included: nothing switches format on its own.

`delivery --help` and `delivery run --help` list the options; `--no-color`, or setting
`NO_COLOR`, turns colour off.

To try it on something small first, use the [sample project](examples/sample-project/README.md).

## Work through a list of tasks

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

Then:

```bash
delivery run
```

It works down the list one task at a time, each as an ordinary run with its own branch and its
own record, and says which task it is on:

```text
Task 1 of 3: add a page that shows who's on call today
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
Done: the change for "add a page that shows who's on call today" passed `npm test` and is
committed on branch surface/add-a-page-that-shows-20260917T090000Z.

Task 2 of 3: let someone swap their on-call day with a teammate
…
```

Run it again whenever you like: it works out where it got to from the runs already in the
repository, so an interrupted list picks up the task it was on and carries on from there. A task
that needs a decision from you stops the list there rather than skipping past it, and running the
command again stops in the same place until you deal with it.

The list is yours to edit between runs. A new entry anywhere runs in its place; reordering
changes only the order they are visited in; deleting an entry leaves its run in the history; and
rewording an entry makes it a new task, which is also how you deliberately run a finished task
again. `delivery run --task "..."` always runs exactly that one task and leaves the list alone.

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

If the run's task is on your `tasks` list, it also says which task of how many it is, worked out
from the list as it is written now.

`status` exits 0 whenever it could read the run and 2 when it could not find one, so a run that
needs your decision is still a successful read. The exit codes in the table above are the run's
own, reported by `delivery run`.

Add `--json` to get the same information as one JSON document instead of sentences:

```bash
delivery status --last --json
```

It carries the run id, the task, where that task sits on your list, when it started and finished,
how it ended, the sentences the plain-language report prints about it, the branch, the base
branch, where the run's record is, and, for a run that stopped for a decision, every field of the
escalation packet. Every key is always present: a `null` means "not that kind of run", so
a script never has to check whether a key is there. A run that could not be found is still a
plain-language message on standard error and exit 2, not JSON.

### See every run

To see the whole history of runs in a repository:

```bash
delivery status --all
```

```text
3 runs in this repository, newest first:
  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet)
  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you)
  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)
To read one in full: delivery status <run-id>
```

`--all --json` gives the same list as an array, each entry with the run id, the task, the
instant it started and how it ended, so a script can filter it. The list is ordered by when
each run started, so it is a history; `delivery status` with no run id reports the run you were
last working on, which is not always the newest one. A repository with no runs yet lists nothing
and exits 0.

## Set it up by answering a few questions

If you would rather not write the config file yourself:

```bash
delivery init
```

It asks a few things: a sentence or two about your project (press Enter to skip), what command
checks the agent's work (offering your project's own `npm test` when it has one), what should
happen to work that passes, and what you would like done, one thing at a time until you press
Enter on an empty answer. It writes the answers to a `delivery.config.json` at the top of the
repository, which `delivery validate` checks and the next `delivery run` works through with no
flags at all. If there is already a config file there, it asks before replacing it and leaves
it as it was if you say no.

It asks questions, so it needs a terminal. Run in a pipe or in CI it says so and stops, rather
than guessing an answer on your behalf.

## Configure it once

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
| `roles` | Changes what the worker, or the agent that repairs your check, is told and which tools it may use: `{ "worker": { "systemPromptFragment": "...", "allowedTools": ["Read", "Edit"] } }`, and `gateMaintenance` the same way. Anything you leave out keeps its built-in value. A run keeps the roles it started with. `delivery preview` shows the result. See [Configuring a role](docs/configuring-a-role.md#from-the-configuration-file). |
| `gate` | What decides whether a change is good. The simplest is a ready-made check chosen by name: `{ "type": "test-runner" }` runs your tests (add `"command"` if they are not run with `npm test`), `{ "type": "file-exists", "path": "CHANGES.md" }`, `{ "type": "command-succeeds", "command": "npm run lint" }`, or `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. `delivery validate` says what the chosen check does. To write one out in full, or write your own, see [Writing a gate](docs/writing-a-gate.md). |
| `closer` | What happens to accepted work: see [Writing a closer](docs/writing-a-closer.md) |
| `budgets` | How many attempts each kind of setback gets before the run asks a person: `correction`, `gateError`, `gateMaintenance`, `terminus` and `close`, each a whole number. Anything you leave out keeps its default (3, 3, 2, 5 and 3). |
| `concurrency` | How many tasks from your list may run at once, a whole number. The default, 1, works down the list one task at a time. 2 or more starts that many, each on its own copy with its own branch and record, and starts the next task on the list as soon as one finishes. |

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

## Check your setup before a run

```bash
delivery validate
```

It reads your `delivery.config.json` the way `delivery run` would, says what it found, and stops:

```
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

If something is wrong it prints the one thing to fix instead, such as an empty task or two
tasks that say the same thing, and exits 2. It never starts an agent, needs no sign-in and no
network, and changes nothing on disk, so it is safe in CI on every push and safe while a run
is going. `--config <path>` and `--repo <path>` mean what they mean on `delivery run`.

For CI, add `--json` to get every problem at once instead of the first, as one JSON document:

```bash
delivery validate --json
```

```json
{
  "ready": false,
  "problems": [
    { "field": "tasks.1", "message": "I can't use …/delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it." },
    { "field": "domain", "message": "I can't use …/delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it." }
  ]
}
```

Each problem names the setting it concerns (list positions count from 0, and `null` means the
file as a whole) and says it in the same words as the plain form. A clean file gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`.

## See what the agent will be told

```bash
delivery preview
```

It prints, before anything runs, the instructions the next task on your list would be given,
word for word, with your project description in place, and then what the agent may do:

```
Next up is Task 1 of 3: add a page that shows who's on call today

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.

## Task
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run commands.
```

`--queue-index 3` shows the third task on your list instead, numbered as "Task 3 of 3" numbers
it. `--role gate-maintenance` shows what the agent that repairs your check is told when the
check can't run. A project with a single `task` shows that one. Like `delivery validate`, it
needs no agent, no sign-in and no network, changes nothing on disk, reports a problem with your
configuration in the same words, and takes `--config` and `--repo`.

## Documentation

- [Getting started](docs/getting-started.md): install the command and finish your first run
- [Setting up a project](docs/project-configuration.md): describe a project, list its tasks, check, preview and run them
- [Design docs](docs/)
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent
- [Contributing](CONTRIBUTING.md)
