# Configuration reference

Every setting in `delivery.config.json`, the format of a backlog item, and the flags and
environment variables that override the file for one run. To set up a project step by step,
follow [Set up a project](project-configuration.md) instead.

## The configuration file

The command looks for `delivery.config.json` in the folder you run it from and in each folder
above it, up to the top of the repository. `--config <path>` names a file somewhere else. A
project that needs to compute a value can use `delivery.config.js` or `delivery.config.mjs`,
exporting the same object as its default export.

Every setting is optional. With none, the check is the `test` script in your `package.json`, and
the work is left on a branch for you.

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "tasks": [
    "add a page that shows who is on call this week, with a test",
    "let someone swap their week with a colleague, with a test"
  ],
  "gate": { "type": "test-runner" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

An unknown setting, or a value of the wrong kind, stops every command before it starts and names
the setting. `delivery validate` finds the same mistakes without starting anything.

## Settings

### `task`

One thing you want done, the same on every run. A sentence, or an object with an `intent`
sentence and any other fields you like. Use `task` or `tasks`, not both.

```json
"task": "update the dependencies and keep the tests passing"
```

### `tasks`

A list of things you want done, in order. `delivery run` with no `--task` works down it. Each
entry is a sentence, or an object with an `intent` sentence plus any fields of your own, such as
`guards`:

```json
"tasks": [
  "add a page that shows who is on call this week, with a test",
  { "intent": "rename the test helpers", "guards": { "off": ["tests-untouched"] } }
]
```

Edit the list between runs. A new entry runs in its place, a reworded entry is a new task, and a
deleted entry leaves its run in the history. An empty entry, or two entries that say exactly the
same thing, stops the command. See [Work through a task list](run-a-task-list.md).

### `domain`

Text. What your project is, in your own words. Every agent on every run is told it before its own
instructions. A run keeps the text it started with, so an edit changes the next run, not one
already going. For a long description, use `delivery.config.js` with a template literal.

### `agent`

An object. Options passed to every agent session as Claude Code options, such as `model`,
`maxTurns` or `mcpServers`, plus two of the harness's own:

| Field | Type | What it does |
|---|---|---|
| `append` | Text | Added to what every agent is told |
| `env` | Object of text | Environment variables for the session, merged with the run's own; the harness's own variables win |

The harness sets `cwd`, `systemPrompt`, `outputFormat`, `resume`, `sessionId`, `permissionMode`,
`allowDangerouslySkipPermissions` and `pathToClaudeCodeExecutable` itself, and refuses a file
that sets any of them. To keep the agent from a tool, add the tool to `permissions.deny` in your
own Claude Code settings.

```json
"agent": { "model": "sonnet", "append": "Keep changes small and explain each one in the commit message." }
```

### `gate`

An object. The check that decides whether the work is good. Default: `npm test`, passing when it
exits 0. With no `test` script in `package.json` and no `gate`, the command stops and asks you to
set one.

Name a [ready-made check](#ready-made-checks), write out a `command` gate, or point to a gate of
your own with `{ "type": "custom", "modulePath": "./gates/mine.mjs" }`. A written-out command gate
takes these fields:

| Field | Type | Default | What it does |
|---|---|---|---|
| `command` | Text | Required | The command to run |
| `parseMode` | `"exitcode"`, `"tap"` or `"junit"` | Required | How its output is read |
| `failOnNewAssertions` | `true` or `false` | `false` | Whether a new failing test that did not exist before counts against the work |
| `checkOnly` | `true` | Not set | Judge only the finished work; nothing runs before the agent starts |
| `setup` | Text | None | A command run first; if it fails, the check could not run |
| `teardown` | Text | None | A command run afterwards, whatever the result |

See [Write a gate](writing-a-gate.md) for each field in use, and for writing your own.

### `closer`

An object. What happens to work that passes. Default: `{ "type": "commit-to-branch" }`.

| `type` | Other fields | What it does |
|---|---|---|
| `commit-to-branch` | None | Leaves the work on its branch for you to merge |
| `merge-back` | `deleteBranch`, default `true` | Merges the work into the branch you started from, then deletes the branch unless `deleteBranch` is `false` |
| `open-pr` | `stack`, default `false` | Opens a pull request with the GitHub command-line tool, `gh`. With `stack`, one pull request per delivered item, each on the one below; see [Stacked pull requests](concepts.md#stacked-pull-requests) |
| `custom` | `modulePath`, required; `exportName`, default `default` | Runs a closer of your own |

See [Write a closer](writing-a-closer.md).

### `budgets`

An object of whole numbers, 1 or more. How many times each kind of setback is retried before the
run stops and asks you. A budget you leave out keeps its default.

| Budget | Default | Counts |
|---|---|---|
| `correction` | 3 | Times the agent is sent back after its work fails the check |
| `gateError` | 3 | Times the check is run again after it could not run at all |
| `gateMaintenance` | 2 | Times an agent repairs a check that cannot run. With several tasks at once, also the limit for repairs to the environment they share |
| `terminus` | 5 | Agent sessions that end without a usable answer |
| `close` | 3 | Times the closer is tried again after it fails |

```json
"budgets": { "correction": 5, "close": 1 }
```

See [When something goes wrong](concepts.md#when-something-goes-wrong).

### `concurrency`

A whole number, 1 or more. Default: 1. How many tasks from `tasks` run at once. Each task gets its
own working copy, branch and record, and the next task on the list starts as soon as one finishes.
See [Work through a task list](run-a-task-list.md).

### `fence`

A mode, or an object with `mode` and `devices`. Whether the agent works inside a fence that keeps
your own folder read-only. The fence needs bubblewrap (`bwrap`), on Linux.

| Value | What it does |
|---|---|
| `preferred` | The default. Uses the fence where it works; otherwise the run goes ahead and says so first |
| `required` | A run will not start without the fence |
| `off` | Never uses the fence |

To pass host devices through, give an object: `{ "mode": "required", "devices": ["/dev/kvm"] }`.

### `workflows`

An object of named workflows: ways of doing a task in more than one checked step. Run one with
`delivery run --task "..." --workflow <name>`. See [Workflows](#workflows) for the fields.

### `packs`

A list of folders, relative to the configuration file, each holding a pack of your own. Each adds
its workflows, named `<pack name>:<workflow name>`: a review pack's are `<name>:scan` and `<name>:fix`. A `delivery.pack/3`
pack names its own workflows in its `pack.json`, and they are added under the same `<pack name>:` prefix.
The built-in `code`, `security` and `deprecations` packs are always available. `delivery packs` lists every pack the
project can use. See [Write a pack](writing-a-pack.md).

```json
"packs": ["./my-pack"]
```

### `packSettings`

Values for the settings a pack asks for, keyed by the pack's name and then the setting's name. It works the same for a
built-in pack, a pack you list in `packs` and a pack you added. A setting you leave out takes the pack's default.
Each value is put into what the agent is told; it is never run as a command. A run keeps the values it started with.
A required setting with no value stops `delivery run`, `delivery review` and `delivery validate` for the whole project, scheduled runs included, before any agent is called, with a message that names the pack, the setting and the line to add; the `delivery packs` commands keep working. An entry for a pack the project does not use, a setting the pack does not declare, or a value of the wrong kind is refused too, with every problem listed at once.

```json
"packSettings": { "docs": { "docs-folder": "handbook" } }
```

### `sources`

A list of places `delivery run --sources` finds work, read in order. Default:
`[{ "type": "backlog" }]`. See [Work sources](#work-sources) for each kind.

### `parkAfter`

A whole number, 1 or more. Default: 3. How many runs in a row an item may end undelivered before it
is parked: skipped until you run `delivery unpark <item>`.

### `after`

A list of steps run once per run, after at least one item has landed and the closer has taken
the delivery branch: a deploy, for example. See [After-landing steps](#after-landing-steps).

### `notify`

A command run at the end of every run, however it ended, from the repository folder. It receives
the run's report on its standard input, as the JSON that `delivery report --json` prints, parked
items and their questions included. A notify command that fails is reported in one line and never
changes the run's outcome or exit code.

```json
"notify": "./scripts/post-to-chat.sh"
```

## Ready-made checks

A ready-made check is a `gate` chosen by name. Each runs a command and passes when it exits 0.

| Check | Fields | Passes when |
|---|---|---|
| `test-runner` | `command`, optional | Your tests pass. Without `command`, runs the `test` script in `package.json` |
| `command-succeeds` | `command` | The command exits 0 |
| `file-exists` | `path` | The file exists after the work |
| `schema-validates` | `file`, `schema` | The JSON file matches the JSON Schema |
| `commits-ahead` | None | The work added at least one commit |
| `fails-with-new-test` | `command`, optional | The work changed a test file (under `test/`, `tests/` or `__tests__/`, or named `*.test.*` or `*.spec.*`), your tests pass on the commit the step started from, and fail on the work's commit. Without `command`, runs the `test` script in `package.json`. Meant for a step that commits a failing test; it runs the start commit in a temporary checkout that shares your `node_modules` |

```json
"gate": { "type": "file-exists", "path": "CHANGES.md" }
```

`delivery validate` prints what the chosen check does.

## Guards

Guards stop the agent passing the check by weakening the tests. They apply whatever the `gate`
is. Turn one on or off for a task, or for a workflow step, with `guards`:

```json
{ "intent": "rename the test helpers", "guards": { "add": ["tests-unchanged"], "off": ["tests-untouched"] } }
```

| Guard | On by default | Refuses work that |
|---|---|---|
| `tests-untouched` | Yes | Deletes or renames a test |
| `check-untouched` | Yes | Changes how the tests run, such as a test-runner setting or a CI file |
| `no-skips` | Yes | Adds a skip marker to a test |
| `ignored` | Yes | Hides a test, test setting or skip from git |
| `backlog` | Yes | Edits or removes an existing backlog item, rather than adding a new one |
| `tests-unchanged` | No | Edits an existing test |
| `backlog-only` | No | Changes anything other than adding ideas to the backlog. A pack's scan workflow turns it on |

The report names any task whose guards differ from the defaults.

## Workflows

Each entry under `workflows` takes these fields:

| Field | Type | What it does |
|---|---|---|
| `steps` | List, at least one | The steps, run in order |
| `after` | List | Replaces the project's `after` steps for tasks delivered through this workflow. `[]` runs none |
| `hold` | `critical`, `high`, `medium` or `low` | Holds a finished item of this severity or worse for `delivery sign-off`, instead of landing it |

Each step takes:

| Field | Type | What it does |
|---|---|---|
| `name` | Text, required | The step's name, unique within the workflow |
| `prompt` | Text, required | What this step's agent is asked to do. It is also told the task |
| `gate` | Object | This step's check. Default: the project's `gate` |
| `agent` | Object | Agent options for this step, laid over the project's `agent` |
| `guards` | Object | `add` and `off` lists of [guards](#guards), for this step only |
| `continue` | `true` or `false` | Picks up the previous step's agent session. Not allowed on the first step |

A step's prompt can use `{{task.<field>}}` for any field of the task, such as `{{task.body}}`. A string is written as it is, and a number or `true` or `false` as written. Any other value, such as an object, an array or `null`, is written as compact JSON, for example `{"id":7}` or `["a","b"]`.

Interpolated text is placed among the step's instructions. When it comes from an issue tracker, where anyone may write, approve the issue with the label as carefully as you would approve an instruction. See [work sources](work-sources.md).

```json
"workflows": {
  "plan-then-build": {
    "steps": [
      { "name": "plan", "prompt": "Write a short plan to PLAN.md.", "gate": { "type": "file-exists", "path": "PLAN.md" } },
      { "name": "build", "prompt": "Carry out PLAN.md.", "continue": true }
    ]
  }
}
```

## Work sources

Each entry under `sources` is an object with a `type`. Every kind also takes `name`, which tells
its items apart in the report (default: the `type`), and `"fallback": true`, which reads it only
when no other source has any work. Two sources with the same name stop the command.

| Type | Fields | Reads |
|---|---|---|
| `backlog` | None | The [backlog items](#backlog-items) in `.delivery/backlog/` |
| `list` | None | The `tasks` in the configuration file |
| `command` | `command`, required; `tracker`, optional | Tasks printed by a command of your own |
| `github` | `label` (default `delivery`), `workflow`, both optional | Open issues carrying the label, through `gh` |

```json
"sources": [
  { "type": "backlog" },
  { "type": "command", "command": "./next-slice.sh", "name": "slices" },
  { "type": "list", "fallback": true }
]
```

### The command source protocol

The harness runs a `command` source with one argument:

| Call | When | Must do |
|---|---|---|
| `<command> list` | Each run | Print a JSON array of tasks. Each task is an object with a string `id`, and optionally `intent`, `body`, `workflow`, `sequence` and any other fields |
| `<command> complete <id>` | After the task is delivered | Mark the task done, wherever the list is kept |
| `<command> raise` | Only with `"tracker": true`, once the closer has taken the work | Read a follow-up item as JSON on standard input (`file`, its front matter and `body`), open it in your tracker, and print the new item's id |

See [Take work from other sources](work-sources.md) for each kind in use, GitHub issues included.

## After-landing steps

Each entry in `after`, or in a workflow's `after`, is a command step or an agent step.

| Field | Step | What it does |
|---|---|---|
| `run` | Command | The command to run |
| `in` | Command | `"worktree"` (default): a throwaway copy of what landed. `"base"`: your own folder |
| `prompt` | Agent | What the agent is asked to do. It is told what landed, and only a new backlog item it writes is kept |
| `check` | Either | A command, run from your folder, whose success confirms the step worked |
| `name` | Either | How the report names the step. Default: the command, or the prompt's first line |

```json
"after": [
  { "name": "deploy", "run": "make deploy", "in": "base", "check": "curl -f http://localhost:8080/health" },
  { "name": "release notes", "prompt": "Write release notes for the landed commits." }
]
```

A step that fails stops the steps after it. The work stays landed, and the next
`delivery run --sources` tries the waiting steps first. `delivery drop-after` gives them up.

## Backlog items

A backlog item is a Markdown file in `.delivery/backlog/`, named `<timestamp>-<slug>.md`, for
example `20261016T090000Z-greet-people.md`. YAML front matter says how it is done; the text after
it is the brief the agent receives. The harness reads items from the last commit on your base
branch, so commit an item, and push it if the repository has an `origin`, before it can be worked.

```markdown
---
status: open
workflow: plan-then-build
priority: 10
cadence: 7d
spec: docs/greeting-spec.md
---
Tidy the greeting copy so it matches the spec.
```

| Field | Type | What it does |
|---|---|---|
| `status` | `open`, `idea`, `resolved` or `declined`, required | Only `open` items are worked. An `idea` waits for `delivery approve` |
| `workflow` | Text | The workflow that delivers the item |
| `priority` | Whole number | Lower goes first; items without one go last |
| `cadence` | A number and `m`, `h`, `d` or `w`, such as `7d` | Makes the item recur: it is due again that long after it last closed |
| `sequence` | Text | Puts the item in a named sequence: items with the same name are worked one at a time, in order. See [Keep items in order](work-sources.md#keep-items-in-order). Not allowed with `cadence` |
| `severity` | `critical`, `high`, `medium` or `low` | How serious the item's problem is; a workflow's `hold` acts on it |
| `check` | Object | How the harness knows the problem is gone. Every step's check then also requires it, as `item:<id>:resolved` |

Any other field is available to step prompts as `{{task.<field>}}`.

`check` is one of:

| Kind | Fields | Passes when |
|---|---|---|
| `anchor-gone` | `path`, `anchor`; optional `scope: repo` and `sensitive: true` | The exact text `anchor` is no longer in `path`. For a password or key, add both options to search the whole project |
| `pattern-absent` | `pattern`, an extended regular expression; `paths` | Nothing in `paths` matches `pattern` |
| `dependency-absent` | `package`, `version` | `package-lock.json` no longer installs that version of that package |

## Overrides for one run

A flag or an environment variable overrides the file for one run. A flag beats an environment
variable, which beats the file, which beats the built-in default.

| Flag | Environment variable | What it sets |
|---|---|---|
| `--task "..."` or `--task-file <path>` | `DELIVERY_TASK` | What you want done |
| `--gate-command "npm test"` | `DELIVERY_GATE_COMMAND` | A check that passes when the command exits 0 |
| `--closer commit-to-branch` | `DELIVERY_CLOSER` | What happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--concurrency 3` | `DELIVERY_CONCURRENCY` | How many tasks from your list run at once |
| `--config <path>` | `DELIVERY_CONFIG` | A configuration file somewhere else |

## Variables the harness sets

Commands you configure can read these:

| Variable | Set for | Holds |
|---|---|---|
| `DELIVERY_STEP_START` | Every gate command, and every agent session | The commit the work, or the current workflow step, started from |
| `DELIVERY_COMMIT` | Command after-landing steps | The commit that landed |
| `DELIVERY_BRANCH` | Command after-landing steps | The delivery branch |

## See also

- [Set up a project](project-configuration.md): the settings in use, step by step
- [Command reference](cli-reference.md): every command and option
- [How it works](concepts.md): what a gate, closer and budget are for
