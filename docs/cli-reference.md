# Command reference

Every `delivery` command, its options, its exit codes and its machine-readable output. For
the settings in `delivery.config.json`, see the [configuration reference](configuration-reference.md).
For `delivery --help` and `delivery <command> --help`, the text on the command line is the
authority; this page groups it by what you are trying to do. The check that decides whether
work is good is called the gate in option names and settings, such as `--gate-command`.

## Commands

| Command | What it does | Guide |
|---|---|---|
| `delivery init` | Writes a `delivery.config.json` by asking you a few questions | [Set up with questions](set-up-with-init.md) |
| `delivery validate` | Checks the config file is ready to run, with no agent, sign-in or network | [Check your setup](check-your-setup.md) |
| `delivery preview` | Prints what the agent will be told for the next task | [Check your setup](check-your-setup.md) |
| `delivery run` | Works the task, the task list or the backlog, or picks up a run that stopped | [Run a task](run-a-task.md) |
| `delivery resume [run-id]` | Picks up a run that did not finish, and never starts a new one | [Pick up an interrupted run](resume-a-run.md) |
| `delivery status [run-id]` | Says what happened to a run; follows one with `--watch`; lists them with `--all` | [See what happened to a run](check-a-run.md) |
| `delivery report [run-id]` | Says in plain words what happened to the task list and what to do next | [Read the report](read-a-report.md) |
| `delivery review <pack> [repo]` | Starts a pack's find: an agent reads the project and adds ideas to the backlog | [Review your project](task-packs.md) |
| `delivery packs` | Lists the packs you can use | [Packs](packs.md) |
| `delivery backlog [id]` | Lists the ideas, open, held and parked items; shows one in full | [Work through a backlog](work-a-backlog.md) |
| `delivery approve [ids...]` | Chooses ideas to be fixed by the next `run --sources` | [Review your project](task-packs.md) |
| `delivery decline [ids...]` | Sets ideas aside | [Review your project](task-packs.md) |
| `delivery sign-off <item>` | Lands a serious fix that waits for you | [Review your project](task-packs.md) |
| `delivery reject <item>` | Sets a serious fix aside, leaving its work on its branch | [Review your project](task-packs.md) |
| `delivery answer <item> <answer>` | Answers the question a parked item is waiting on | [Work through a backlog](work-a-backlog.md) |
| `delivery unpark <item>` | Puts a parked item back in the queue | [Work through a backlog](work-a-backlog.md) |
| `delivery drop-after [batch]` | Gives up after-landing steps that are waiting, such as a deploy you cannot fix | [Set up a project](project-configuration.md) |
| `delivery packs check <path>` | Checks a pack folder of your own, then runs its fixtures against a scripted agent | [Write a pack](writing-a-pack.md) |
| `delivery packs inspect <pack>` | Shows what a pack will do before you use it, for a built-in pack or any pack folder: what each workflow is for, how far it goes before it asks you, and every instruction it gives the agent; `--json` gives the same account as a versioned document for scripts | [Packs](packs.md) |
| `delivery schedule enable` | Turns on a timer that runs `delivery run --sources` with its own config file, workflow, item cap and concurrency, or changes how often it runs. On a platform that has no scheduler backend yet, refuses and prints the crontab line to use instead: see [Use cron where there is no scheduler](run-on-a-schedule.md#use-cron-where-there-is-no-scheduler) | [Run on a schedule](run-on-a-schedule.md) |
| `delivery schedule status` | Says, for every schedule the project has, whether it is on, when it last ran and will next run, and shows each schedule's run settings | [Run on a schedule](run-on-a-schedule.md) |
| `delivery schedule disable` | Turns the default schedule off, the one `--name` names, or every schedule with `--all`; `delivery run --sources` still works by hand | [Run on a schedule](run-on-a-schedule.md) |

## Options for `delivery run`

| Option | What it does |
|---|---|
| `--task <text>` | Runs exactly this task and leaves the list alone |
| `--task-file <path>` | Reads the task from a file |
| `--workflow <name>` | Does the task in the steps of a [workflow](configuration-reference.md#workflows); with `--sources`, the workflow for items that do not name one |
| `--gate-command <command>` | Sets the check: it passes when the command exits 0 |
| `--closer <type>` | Sets what happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--concurrency <n>` | Sets how many tasks from the list run at once (default 1) |
| `--sources` | Works the backlog and the other work sources, in order, instead of one task |
| `--max <n>` | With `--sources`, how many items to take in this run (default 1) |
| `--config <path>` | Uses this config file instead of searching for `delivery.config.json` |
| `--repo <path>` | Works on this git repository (default: the current folder) |
| `--fresh` | Starts a new run even though one did not finish |
| `--if-idle` | If another run is already going in this repository, prints "Skipped: another run is going here" and exits 0 instead of refusing. For any run nobody is watching: a timer, cron or CI |

Every run holds the repository while it runs, so a second run started while one is going is refused. `--if-idle` turns that refusal into a quiet skip, which is what every scheduled run uses. See [when runs overlap](run-on-a-schedule.md#when-runs-overlap).

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
| `review` | `--path <part>` | Looks only at this folder or file |
| `review` | `--preview` | Shows what the find's agent would be told, and starts nothing |
| `approve` | `--all`, `--workflow <name>` | Approves every idea; names the workflow to fix them through |
| `decline` | `--all` | Declines every idea |
| `packs` | `--schema` | Prints the JSON Schema of a pack folder's `pack.json` |
| `packs check` | `--yes` | Skips the question about trusting the pack's code before its fixtures run; needed when there is no terminal |
| `packs inspect` | `--schema` | Prints the JSON Schema of the document `--json` prints, `delivery.pack-inspection/1` |
| `schedule enable` | `--every <interval>` | Sets how often it runs: minutes that divide an hour (such as `5m`, `15m` or `30m`), hours that divide a day (such as `1h`, `6h` or `12h`), or `1d` (the default) |
| `schedule enable` | `--name <name>` | Names the schedule, so a project can have several: 1 to 32 lowercase letters, digits or hyphens. Without it, sets up the project's default schedule. Refused when another project already holds that schedule's timer. For a worked example, see [two schedules on one project](run-on-a-schedule.md#worked-example-two-schedules-on-one-project) |
| `schedule enable` | `--config <path>` | The config file each scheduled run uses (default: the project's own) |
| `schedule enable` | `--workflow <name>` | The workflow for items that do not name one |
| `schedule enable` | `--max <n>` | How many items each scheduled run takes (default 1) |
| `schedule enable` | `--concurrency <n>` | How many items each scheduled run works at once (default 1) |
| `schedule status` | `--name <name>` | Shows only this schedule |
| `schedule disable` | `--name <name>` | Turns off only this schedule. Without it, turns off the default schedule |
| `schedule disable` | `--all` | Turns off every schedule this project has. Refused together with `--name` |

`--config` and `--repo` mean the same on every command that takes them (`delivery --help` shows
which). `review` takes the repository as an argument, `delivery review <pack> [repo]`, not as
`--repo`. Every command also takes the global options `--json`, `--no-color` and `--version`.

## Exit codes

These exit codes are the run's own, reported by `delivery run` and `delivery resume`.
`status`, `report` and the other read-only commands exit 0 whenever they could do what you asked
and 2 when they could not (for example, a run id that names nothing). The exception is
`status --watch`, which exits with the code the run it followed ended with (see the `ending`
table in [Reports as data](reporting.md#the-event-stream)).

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

Instead of the plain-language lines, each step prints as one JSON object on its own line. The
object holds these keys: `state` (the harness's own state name), `done` (whether the run is over),
`at` (when it happened) and `recovery` (what the step had to put right; present only when it put
something right):

```text
{"state":"PROVISIONING","done":false,"at":"2026-09-16T12:00:00.000Z"}
{"state":"AGENT_ACTIVE","done":false,"at":"2026-09-16T12:00:11.284Z"}
{"state":"CLOSED","done":true,"at":"2026-09-16T12:01:39.002Z"}
```

The exit codes are those in the "Exit codes" table, so a script reads the outcome from the exit
code and the detail from `delivery status --json`. Everything that is not a step goes to standard
error: which run started, any warning and the closing sentence. Standard output is only ever JSON.

When several tasks run at once, each object also carries a `scope`, and every key is present,
`null` where it does not apply:

- `"scope": "surface"` (the harness's word for one task; see the [glossary](glossary.md#surface))
  is a task's step. Its keys are `scope`, `runId`, `surface` (`ordinal`, `of` and `id`: the task's
  place in the list, how many there are, and the task's own run id), `state`, `done`, `recovery`
  and `at`.
- `"scope": "run"` is the run as a whole. Its keys are `scope`, `runId`, `state`, `done`,
  `affected` and `at`. Its `state` is `STARTED`, `RESUMED` or `DRAINED` as the run starts, resumes
  and finishes, and `DEGRADED`, `REPAIRING`, `HEALTHY` or `ESCALATED` as the shared environment
  changes (see [When the shared environment breaks](shared-environment.md)). `done` is `true` on
  `DRAINED` and `ESCALATED`. `affected` lists the task run ids a change concerns, and is `null`
  on the run starting and finishing.

`--json` is a global option. It changes the output of `run`, `resume`, `status`, `report`,
`validate`, `packs`, `packs check` and `packs inspect`; other commands ignore it. Without it the output is
plain-language lines everywhere, piped or in CI included: nothing switches format on its own.
The step lines are the running command's own account of itself and carry no version. To build
on what a run did, use the versioned data in [Reports as data](reporting.md).

## See also

- [Configuration reference](configuration-reference.md): the settings in `delivery.config.json`.
- [Reports as data](reporting.md): the versioned report and event formats.
- [Get started](getting-started.md): install the command and run a first task.
