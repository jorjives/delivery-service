# Run on a schedule

This guide shows how to have `delivery run --sources` run by itself on a timer, and how to be told when a run ends. On Linux the timer is a systemd user timer. Where there is no scheduler to use, `enable` prints a crontab line instead: see [Use cron where there is no scheduler](#use-cron-where-there-is-no-scheduler). It needs a backlog or other work source: see [Work through a backlog](work-a-backlog.md). Claude Code must be signed in for the scheduled runs to start.

## Turn the schedule on

Run this in the repository (or pass `--repo <path>`):

```bash
delivery schedule enable --every 30m
```

```text
Scheduling is on: delivery run --sources every 30m in <repo>. A run missed while this machine is off happens as soon as it is back.
```

`--every` takes minutes that divide an hour (`5m`, `15m`, `30m`), hours that divide a day (`1h`, `6h`, `12h`) or `1d`, which is the default. Anything else is refused with "isn't an interval I can schedule".

It installs a systemd user timer for the repository, `delivery-<key>.timer` in `~/.config/systemd/user/`; `<key>` identifies your repository. Each run's output goes to the journal, and the run shows in `delivery status` and `delivery report` as if you had typed the command. To change how often it runs, run `enable` again with a new `--every`.

The timer runs with the `PATH` you had when you ran `enable`. Run `enable` again after you move Node or Claude Code.

## Run more than one schedule

A project can keep several schedules, each at its own interval, such as a light frequent pass and a deeper nightly one. Give each a name with `--name`:

```bash
delivery schedule enable --name hourly --every 1h
delivery schedule enable --name nightly --every 1d
```

A name is 1 to 32 lowercase letters, digits or hyphens, such as `nightly`. Anything else, including `default`, is refused with "isn't a name I can give a schedule". Each named schedule has its own timer, `delivery-<key>.<name>.timer`, so enabling a name again changes only that schedule. The schedule you get without `--name` is `default`: it keeps its existing timer, `delivery-<key>.timer`, and keeps working untouched until you enable it again.

Each scheduled run is `delivery run --sources` with the schedule's settings, then `--if-idle`. What that does when runs overlap is set out in [When runs overlap](#when-runs-overlap).

Each schedule belongs to the project whose folder it records, so a project whose path extends another's (`/work/app` and `/work/app.v2`) never lists or turns off the other's schedules. Such projects can need the same timer, though: `/work/app`'s `nightly` and `/work/app.nightly`'s default both use one. So `enable` refuses a schedule whose timer already belongs to another project, with exit code 2, and changes nothing. Choose a different `--name`.

## Give a schedule its own settings

A schedule can run with settings of its own, so one project can run a quick pass and a thorough pass that behave differently:

```bash
delivery schedule enable --name nightly --every 1d --workflow deep --max 3 --config nightly.json
```

- `--config <path>` is the config file each scheduled run uses. Without it, the project's own config applies. A relative path is resolved against the repository, as `delivery run --config` resolves it, and is stored in full. The file must exist when you enable the schedule.
- `--workflow <name>` is the workflow for items that do not name one.
- `--max <n>` is how many items each scheduled run takes (default 1).
- `--concurrency <n>` is how many items each scheduled run works at once (default 1).

A schedule's settings are its whole definition. Enabling a schedule again replaces them, so a setting you leave out is dropped, not kept: run `enable` with every setting the schedule should keep. A setting left empty, such as `--workflow ""`, is refused, and so is a value `--max` or `--concurrency` cannot take. `--task`, `--task-file` and `--fresh` are not accepted by `schedule enable`.

## Worked example: two schedules on one project

A project that wants a light pass every hour and a deeper pass each night enables both. The hourly one needs no settings of its own; the nightly one runs a deep workflow, three items at a time:

```bash
delivery schedule enable --name hourly --every 1h
delivery schedule enable --name nightly --every 1d --workflow deep --max 3
```

Enabling the nightly schedule prints:

```text
Scheduling is on: the nightly schedule, delivery run --sources every 1d in <repo>. A run missed while this machine is off happens as soon as it is back.
```

`delivery schedule status` shows both, each with its own settings. The default schedule would come first if the project had one; the others follow by name.

```bash
delivery schedule status
```

```text
Scheduling is on for the hourly schedule, every 1h.
Run settings: none, so the project's own config file and defaults apply.
Last run: Thu 2026-10-22 10:00:00 BST
Next run: Thu 2026-10-22 11:00:00 BST
Each scheduled run's output: journalctl --user -u delivery-<key>.hourly.service

Scheduling is on for the nightly schedule, every 1d.
Run settings: --workflow deep --max 3.
Last run: not yet
Next run: Fri 2026-10-23 00:00:00 BST
Each scheduled run's output: journalctl --user -u delivery-<key>.nightly.service
```

Then turn the hourly pass off. The nightly schedule is untouched:

```bash
delivery schedule disable --name hourly
```

```text
Scheduling is off for the hourly schedule in <repo>.
```

`delivery run --sources` still works by hand, and the nightly schedule keeps its timer.

## When runs overlap

Every `delivery run` holds the repository for as long as it runs, whatever its concurrency. A second run started while one is going is refused, and the refusal names the first: "Another run is already going here", with a pointer to `delivery status`. A run you start by hand while a scheduled run is going is refused the same way, so wait for the first to finish, or run it again later.

Every scheduled run passes `--if-idle`. When another run is going, it does nothing: it prints `Skipped: another run is going here`, exits 0, and the journal shows the skip. The schedule is not broken, and the next scheduled run goes ahead as usual.

`--if-idle` works for any run nobody is watching, such as a run from cron or a CI job. Add it to `delivery run --sources` to turn the refusal into a skip.

A run that was killed, for example when the machine shut down part way through, leaves its lock behind. The next run takes over once that lock goes stale, about 10 seconds after the killed run stopped renewing it.

## Check or turn it off

```bash
delivery schedule status    # every schedule: on or off, and when it last ran and will next run
delivery schedule disable   # turn the default schedule off; `--name nightly` turns off only that one
delivery schedule disable --all   # turn every schedule on this project off
```

`--all` turns every schedule off, and `--name` with `--all` is refused.

`status` prints one block per schedule, with the exact `journalctl --user -u ...` command that shows that schedule's run output. The [worked example](#worked-example-two-schedules-on-one-project) shows what it prints. `delivery schedule status --name nightly` shows only that one. When the project has no schedule, `status` says `Scheduling is off for <repo>` and how to turn one on, and `--name` for a schedule that is not there says so, with the command that would set it up.

`disable` turns off the default schedule, or with `--name nightly` only that one: it names the schedule it turned off, says a schedule that is not there is already off, and never touches the others; `delivery run --sources` still works by hand.

## Run while you are logged out

The timer runs while you are logged in. To have it run while you are logged out too, run the systemd command `loginctl enable-linger` once.

## Use cron where there is no scheduler

On a platform with no scheduler backend yet (macOS and Windows today), and on Linux without systemd user timers, `enable` refuses with exit code 2, installs nothing, and prints one crontab line for the schedule being enabled. The line carries that schedule's interval, its settings and `--if-idle`. Run `enable` once per schedule to get each line, and add each one to your own crontab with `crontab -e`.

For the `nightly` schedule from the [worked example](#worked-example-two-schedules-on-one-project), on a Mac, `enable` prints:

```text
This machine can't run delivery on a schedule: darwin has no scheduler backend yet.
Add this line to your own crontab (crontab -e) instead. Cron skips a run missed while the machine is off:
0 0 * * * cd '/home/you/app' && PATH='/usr/local/bin:/usr/bin' '/usr/bin/node' '/usr/lib/node_modules/delivery-service/dist/cli/main.js' run --sources --workflow deep --max 3 --if-idle
```

Unlike the timer, cron skips a run missed while the machine is off. The line carries the `PATH` from when `enable` ran, so run `enable` again after you move Node or Claude Code, and replace the line in your crontab with the new one.

## Be told when a run ends

Unattended runs end with nobody watching. `notify` is a command run at the end of every run, however it ended: work delivered, a stop, a run blocked before it started any task, or a run with nothing to do. Set it at the top level of `delivery.config.json`:

```json
{ "notify": "./scripts/post-to-chat.sh" }
```

It runs from the repository folder, with the run's report on its standard input as JSON: the same document `delivery report --json` prints, including `parked`, so the command can say what was done and which item is waiting for your answer. A notify command that fails is reported in one line and never changes the run's outcome or exit code. See [Reports as data](reporting.md) for the document, and the [configuration reference](configuration-reference.md#notify).

## Next steps

- [Read the report](read-a-report.md): check what the scheduled runs did.
- [Run steps after landing](run-after-landing.md): deploy once scheduled work has landed.
