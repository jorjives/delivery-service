# Command reference

Every `delivery` command, its options, its exit codes and its machine-readable output. For
the settings in `delivery.config.json`, see the [configuration reference](configuration-reference.md).
For `delivery --help` and `delivery <command> --help`, the text on the command line is the
authority; this page groups it by what you are trying to do.

## Commands

| Command | What it does | Guide |
|---|---|---|
| `delivery init` | Writes a `delivery.config.json` by asking you a few questions | [Set up with questions](set-up-with-init.md) |
| `delivery validate` | Checks the config file is ready to run, with no agent, sign-in or network | [Check your setup](check-your-setup.md) |
| `delivery preview` | Prints what the agent will be told for the next task | [Check your setup](check-your-setup.md) |
| `delivery run` | Works the task, the task list or the backlog, or picks up a run that stopped | [Run a task](run-a-task.md) |
| `delivery resume` | Picks up a run that did not finish, and never starts a new one | [Pick up an interrupted run](resume-a-run.md) |
| `delivery status` | Says what happened to a run; follows one with `--watch`; lists them with `--all` | [See what happened to a run](check-a-run.md) |
| `delivery report` | Says in plain words what happened to the task list and what to do next | [Read the report](read-a-report.md) |
| `delivery review` | Has an agent review the project and add ideas to the backlog | [Review your project](task-packs.md) |
| `delivery packs` | Lists the available reviews; `packs check` tests one of your own | [Write a pack](writing-a-pack.md) |
| `delivery backlog` | Lists the ideas, open, held and parked items; shows one in full | [Work through a backlog](work-a-backlog.md) |
| `delivery approve` | Chooses ideas to be fixed by the next `run --sources` | [Review your project](task-packs.md) |
| `delivery decline` | Sets ideas aside | [Review your project](task-packs.md) |
| `delivery sign-off` | Lands a serious fix that waits for you | [Review your project](task-packs.md) |
| `delivery reject` | Sets a serious fix aside, leaving its work on its branch | [Review your project](task-packs.md) |
| `delivery answer` | Answers the question a parked item is waiting on | [Work through a backlog](work-a-backlog.md) |
| `delivery unpark` | Puts a parked item back in the queue | [Work through a backlog](work-a-backlog.md) |
| `delivery drop-after` | Gives up after-landing steps that are waiting, such as a deploy you cannot fix | [Set up a project](project-configuration.md) |
| `delivery schedule enable \| status \| disable` | Runs `delivery run --sources` on a timer | [Run on a schedule](run-on-a-schedule.md) |

## Options for `delivery run`

| Option | What it does |
|---|---|
| `--task <text>` | Runs exactly this task and leaves the list alone |
| `--task-file <path>` | Reads the task from a file |
| `--workflow <name>` | Does the task in the steps of a [workflow](project-configuration.md#workflows) |
| `--gate-command <command>` | Sets the check: it passes when the command exits 0 |
| `--closer <type>` | Sets what happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--concurrency <n>` | Sets how many tasks from the list run at once (default 1) |
| `--sources` | Works the backlog and the other work sources, in order, instead of one task |
| `--max <n>` | With `--sources`, how many items to take in this run (default 1) |
| `--config <path>` | Uses this config file instead of searching for `delivery.config.json` |
| `--repo <path>` | Works on this git repository (default: the current folder) |
| `--fresh` | Starts a new run even though one did not finish |

## Options for the other commands

| Command | Option | What it does |
|---|---|---|
| `resume` | `--last` | Picks up the run touched most recently, without asking |
| `status` | `--last` | Reads the run touched most recently (the default) |
| `status` | `--all` | Lists every run, newest first |
| `status` | `--decisions` | Prints every triage round in full |
| `status` | `--repairs` | Prints what each repair changed |
| `status` | `--watch`, `--interval <seconds>` | Follows a run as it happens, looking every 2 seconds unless told otherwise |
| `report` | `--write` | Saves the report as `.delivery/last-report.txt` and `.delivery/last-report.json` |
| `report` | `--schema` | Prints the JSON Schema of the report and of the watch events |
| `preview` | `--task <text>`, `--step <name>`, `--workflow <name>` | Previews a typed task, or one step of a workflow |
| `preview` | `--queue-index <n>` | Shows the nth task on the list, counted from 1 |
| `preview` | `--role <role>` | Shows `worker` (the default) or `gate-maintenance` instructions |
| `review` | `--path <part>` | Reviews only this folder or file |
| `review` | `--preview` | Shows what the review agent would be told, and starts nothing |
| `approve` | `--all`, `--workflow <name>` | Approves every idea; names the workflow to fix them through |
| `decline` | `--all` | Declines every idea |
| `packs` | `--schema` | Prints the JSON Schema of a review folder's `pack.json` |

`--config` and `--repo` mean the same on every command that takes them. Every command also
takes the global options `--json`, `--no-color` and `--version`.

## Exit codes

The exit codes below are the run's own, reported by `delivery run` and `delivery resume`.
`status`, `report` and the other read-only commands exit 0 whenever they could do what you asked
and 2 when they could not (for example, a run id that names nothing).

| Exit code | Meaning |
|---|---|
| 0 | The run finished and the work was delivered |
| 1 | Something unexpected went wrong |
| 2 | Something about the setup or the command needs fixing |
| 3 | The agent could not start: Claude Code is missing or not signed in |
| 4 | The run stopped because it needs a decision from you |
| 5 | The run stopped before it could finish |

## Machine-readable output

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

When several tasks run at once, each object also says what it is about: `"scope": "run"` for the
run starting and finishing, and `"scope": "surface"` for a task's step, with the run's id and a
`surface` object giving the task's place in the list, how many there are, and the task's own run
id. Every key is present, `null` where it does not apply. A run of several at once also writes a
`scope: "run"` object each time its shared environment changes state (`DEGRADED`, `REPAIRING`,
`HEALTHY`, and `ESCALATED` when it gives up), with `affected` listing the task run ids it
concerns (`null` on the run starting and finishing).

`--json` works on `delivery resume`, `delivery status`, `delivery report`, `delivery validate` and `delivery packs` too. Without it the output is
plain-language lines everywhere, piped or in CI included: nothing switches format on its own.
The lines above are the running command's own account of itself and carry no version. To build
on what a run did, use the versioned data described in [Reports as data](reporting.md).
