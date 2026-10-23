# Troubleshooting

This page is for when a `delivery` command refuses to go on or a run stops. Find the message you saw, read why it appeared, and follow the fix. Parts of a message that change from run to run are shown as `<placeholder>`.

Each message ends the command with an exit code. [Exit codes](cli-reference.md#exit-codes) lists them: almost every message here exits 2, which means the setup or the command needs fixing, and the two in "Signing in" exit 3.

## Before a run starts

### This isn't a git repository yet

Full message: `This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.`

**Why.** The folder you ran the command in is not inside a git repository.

**Fix.** Run `git init` and make a first commit, or run the command with `--repo <path>` pointing at your repository.

### I couldn't find a command to check the agent's work with

**Why.** A run needs a [check](glossary.md#check) to judge the agent's work, and the harness found none: no `gate` in your [configuration file](glossary.md#configuration-file), no `--gate-command`, and no usable `test` script in `package.json`. The placeholder `npm init` writes ("no test specified") does not count.

**Fix.** Pass `--gate-command "<command>"`, or set `gate` in `delivery.config.json`. See [`gate`](configuration-reference.md#gate).

### Tell me what to do: add `--task "describe the change you want"`

**Why.** `delivery run` had no task: no `--task`, no `--task-file`, and no `task` or `tasks` in the configuration file.

**Fix.** Add `--task "<what you want done>"`, or list tasks under `tasks`. See [Run a task](run-a-task.md) and [Work through a task list](run-a-task-list.md).

### Use either `--task` or `--task-file`, not both

**Why.** You gave the task twice, and the harness will not guess which you meant. The same applies to `--sources` with a task: "Use either `--sources` or a task (`--task`, `--task-file`), not both: I can't tell which you mean."

**Fix.** Keep one of them.

### There's a run that didn't finish

Full message: `There's a run that didn't finish (started `<time>`, task: `<task>`). Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway.`

**Why.** An earlier run in this repository stopped before it finished, and you gave a different task.

**Fix.** Run `delivery resume` to pick it up, or add `--fresh` to start the new task regardless. See [Pick up an interrupted run](resume-a-run.md).

### Another run is already going here

Full message: `Another run is already going here (started `<time>`, <shape>: `<run-id>`). Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.` The bracketed `(started ..., <shape>: <run-id>)` part appears only when the run going is one of several tasks at once.

**Why.** Another `delivery run`, `resume`, `sign-off` or `review` is under way in this repository, one at a time or several at once, and only one may drive it.

**Fix.** Run `delivery status` to watch it. Start the next command when it has finished. A run started by a timer, cron or CI can pass `--if-idle` to `delivery run` instead, which skips quietly while another run is going.

### `--max` says how many items `--sources` takes

**Why.** You passed `--max` without `--sources`. `--max` must also be a whole number, 1 or more; otherwise the message reads "`--max` is "`<value>`", but it takes a whole number, 1 or more, such as 3".

**Fix.** Add `--sources`, or leave out `--max`. See [Work through a backlog](work-a-backlog.md).

### I can't use --concurrency `<value>`

**Why.** `--concurrency`, the `DELIVERY_CONCURRENCY` environment variable or `concurrency` in the configuration file is not a whole number, 1 or more.

**Fix.** Use a number such as `3`. See [`concurrency`](configuration-reference.md#concurrency).

### There's no workflow called `<name>`

**Why.** `--workflow` names a workflow that neither your configuration file nor any pack you list defines. The message lists the ones that exist.

**Fix.** Use one of the listed names, or add the workflow under [`workflows`](configuration-reference.md#workflows). A workflow also needs a task: "A workflow runs a task you name with `--task`".

### I can't start: your main folder can't be protected on this machine

Full message: `I can't start: your main folder can't be protected on this machine (<reason>), and `fence` is "required" in your configuration. Set it to "preferred" to run without it.`

**Why.** The [fence](glossary.md#fence) keeps the agent from writing to your own folder, and needs bubblewrap (`bwrap`) on Linux. The reason in brackets says what failed, for example "bubblewrap (bwrap) is not installed".

**Fix.** Install bubblewrap, or set `"fence": "preferred"` to run without it. See [`fence`](configuration-reference.md#fence).

### I can't carry on this run: it started with your main folder protected

**Why.** You are picking up a run that began with the fence, and the fence is not available now.

**Fix.** Pick the run up on the machine where it started, or start the task again.

### Note: you have uncommitted changes

Full message: `Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.`

**Why.** This is a note, not a refusal. The agent starts from your last commit, so edits you have not committed are not in its working copy.

**Fix.** Commit the changes first if the agent needs them.

## Signing in

### I can't start the agent that does the work: you're not signed in

Exit code 3.

**Why.** Claude Code, the agent the harness drives, has no login or API key on this machine.

**Fix.** Run `claude auth login`, or set `ANTHROPIC_API_KEY`, then run the command again.

### The Claude Code runtime that comes with the harness is missing or won't start

Exit code 3. Full message: `I can't start the agent that does the work: the Claude Code runtime that comes with the harness is missing or won't start on this machine. Reinstall the harness without `--omit=optional`, then try again.`

**Why.** The runtime is an optional dependency of the package, and an install with `--omit=optional` leaves it out. It also appears when the runtime is there but will not run.

**Fix.** Reinstall without `--omit=optional`. See [Install the command](getting-started.md#1-install-the-command).

## Configuration

### No delivery.config.json found

**Why.** `delivery validate` found no configuration file in this folder or above it.

**Fix.** Run `delivery init` to create one. See [Set up with questions](set-up-with-init.md).

### I couldn't find the config file `<path>`

**Why.** `--config` points at a file that does not exist. Without `--config`, the harness looks for `delivery.config.json` next to your code.

**Fix.** Correct the path, or leave `--config` out.

### I can't read `<file>`: it isn't valid JSON

**Why.** The configuration file has a syntax error; the reason in brackets says where.

**Fix.** Correct the JSON (a trailing comma and a missing quote are the usual causes) and run `delivery validate`. See [Check your setup](check-your-setup.md).

### I can't use `<file>`: there's no setting called `<name>`

**Why.** The configuration file holds a key the harness does not know, usually a typo. The message lists the keys it takes.

**Fix.** Rename or remove the key. See [Configuration reference](configuration-reference.md). A file written for an older version may name `roles`: the message then says where each part now lives.

### I can't use `<file>`: the setting `<name>` is `<value>`

**Why.** A setting has the wrong kind of value. The sentence after the quoted value says what it takes. A `task` that is a string, for example, must be an object with an `intent`; use `tasks` for a list of sentences.

**Fix.** Change the value as the message says. Run `delivery validate` to see the next problem, if any.

### I don't know the check `<name>`

**Why.** `gate.type` is not one of the ready-made checks.

**Fix.** Use `test-runner`, `file-exists`, `command-succeeds`, `schema-validates` or `commits-ahead`, or write your own: see [Write a gate](writing-a-gate.md).

### I don't know the closer type `<name>`

**Why.** `closer.type` is not a built-in [closer](glossary.md#closer).

**Fix.** Use `merge-back`, `commit-to-branch` or `open-pr`, or `{ "type": "custom", "modulePath": "./closers/mine.js" }`. See [`closer`](configuration-reference.md#closer).

## During a run

### I couldn't set up a working copy of the repository

**Why.** The harness makes a [working copy](glossary.md#working-copy) of your repository for each run, and could not. The reason in brackets says why.

**Fix.** Make sure the folder is a git repository with at least one commit, and that you can write to it.

### I couldn't save the run's record

**Why.** The harness could not write to the run's folder under `.delivery`. Exit code 1.

**Fix.** Check there is free disk space and that you can write to that folder.

### The saved run can't be read back

Full message: `The saved run in <folder> can't be read back, usually because the harness was stopped while writing it. Remove that folder to start afresh.`

**Why.** The run was stopped part-way through writing its record. Exit code 1.

**Fix.** Remove the folder the message names, then start the task again.

### There's no run here that didn't finish

Full message: `There's no run here that didn't finish, so there is nothing to pick up. Start one with `delivery run --task "..."`.`

**Why.** `delivery resume` found no unfinished run. A run that closed, or one you have already picked up, is finished.

**Fix.** Start a new run. `delivery status --all` lists every run.

### The run `<run-id>` has already finished

**Why.** `delivery resume <run-id>` names a run that closed.

**Fix.** Start a new run with `delivery run --task "..."`.

### More than one run didn't finish

**Why.** Several runs are unfinished, and there is no terminal to ask which you want. The message lists them.

**Fix.** Run `delivery resume <run-id>`, or `delivery resume --last` for the most recent. In a terminal you are asked to choose; an answer that is not in the list gives "That isn't one of the numbers in the list, so I've left every run alone".

### I couldn't find that run's record

Full message: `I couldn't find that run's record (<path>). Start a new run with `delivery run --task "..."`.`

**Why.** The run id you gave matches no run in this repository. `status`, `report` and `resume` all say this.

**Fix.** Run `delivery status --all` for the ids that exist, and check you are in the right repository or pass `--repo`.

### No runs have been started in this repository yet

**Why.** `delivery status` has nothing to show. (`delivery report` says "No runs yet in this folder" and exits 0.)

**Fix.** Start a run with `delivery run --task "..."`.

### Use either `--all` or a run id, not both

**Why.** `--all` lists every run, and a run id reads one in full. The same wording covers `--all` with `--decisions` or `--repairs`, and `--watch` with `--all`, `--decisions` or `--repairs`.

**Fix.** Drop one of the two. See [See what happened to a run](check-a-run.md).

### Skipped the github source for this run: the GitHub command-line tool (gh) is not installed

**Why.** A `github` [work source](glossary.md#work-source) uses `gh`, and it is missing or not on the `PATH` the harness runs with. The run goes on without that source. Other reasons read "gh is not signed in, or its sign-in has expired", "the account gh is signed in as lacks permission to change this repository's issues", or "gh could not reach GitHub".

**Fix.** Install `gh` from <https://cli.github.com> and run `gh auth login` as the account the harness runs as. For a permission problem, run `gh auth refresh -s repo`. See [Work through a backlog](work-a-backlog.md).

### No item called `<name>` is parked here

**Why.** `delivery answer` or `delivery unpark` was given a name that is not a [parked](glossary.md#parked) item. The message lists those that are.

**Fix.** Use one of the listed names.

### "`<interval>`" isn't an interval I can schedule

**Why.** `--every` must divide an hour or a day evenly.

**Fix.** Use `5m`, `15m`, `30m`, `1h`, `6h`, `12h` or `1d`. See [Run on a schedule](run-on-a-schedule.md).

### "`<name>`" isn't a name I can give a schedule

Full message: `"<name>" isn't a name I can give a schedule. Use 1 to 32 lowercase letters, digits or hyphens, such as nightly, or leave --name out for the default schedule.`

**Why.** `--name` takes 1 to 32 lowercase letters, digits or hyphens. `default` is the name of the schedule you get without `--name`, so it can't name another.

**Fix.** Pick a name such as `nightly` or `hourly`, or leave `--name` out. See [Run on a schedule](run-on-a-schedule.md).

### `--workflow` (or `--config`) is empty

Full message: `` `--workflow` is empty. Give it a value, or leave it out to use the project's own setting. `` (the same for `--config`).

**Why.** `delivery schedule enable` was given `--workflow` or `--config` with nothing after it. An empty setting would not name a workflow or a config file, so the schedule is not changed.

**Fix.** Give the setting a value, or leave the flag out. See [Give a schedule its own settings](run-on-a-schedule.md#give-a-schedule-its-own-settings).

### This machine can't run delivery on a schedule

**Why.** `delivery schedule enable` uses systemd's user timers, and this machine has none; the reason follows.

**Fix.** Add the `cron` line the message prints to your own crontab with `crontab -e`.

### `delivery init` asks you a few questions, so it needs a terminal

**Why.** `delivery init` was run with no terminal on standard input, in a script or a pipe.

**Fix.** Run it in a terminal, or write `delivery.config.json` yourself: see [Configuration reference](configuration-reference.md).

## Extensions

### Couldn't load the custom gate at `<path>`

**Why.** The module named by `modulePath` is missing, will not import, or does not export what the harness expects. The reason is in brackets.

**Fix.** Check the path, which is relative to your repository, and the export. See [Write a gate](writing-a-gate.md). Run `delivery validate` to check without starting a run.

### Couldn't load the custom closer at `<path>`

**Why.** The same, for a closer.

**Fix.** See [Write a closer](writing-a-closer.md).

### The GitHub command-line tool (gh) is not installed, so no pull request could be opened

**Why.** The `open-pr` closer needs `gh`. Related messages say "GitHub sign-in is needed", "that GitHub account lacks permission to open pull requests on this repository", or "gh could not reach GitHub".

**Fix.** Install `gh` from <https://cli.github.com> and run `gh auth login`; for permissions, `gh auth refresh -s repo`; for the network, check it. Then close again.

### This isn't a terminal, so I can't ask whether you trust this pack's code

**Why.** `delivery packs check` runs the pack's code, so it asks first, and cannot ask without a terminal.

**Fix.** Pass `--yes` once you trust the pack. See [Write a pack](writing-a-pack.md).

## See also

- [CLI reference](cli-reference.md), for commands, options and exit codes.
- [Configuration reference](configuration-reference.md), for every setting.
- [Check your setup](check-your-setup.md), to find configuration problems before a run.
- [Glossary](glossary.md).

Still stuck? Open an issue at <https://github.com/jorjives/delivery-service/issues>. For an error that ends "This is unexpected, please file an issue", or "Something went wrong inside the harness", include the message and the run folder it names.
