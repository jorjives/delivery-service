# Run on a schedule

This guide shows how to have `delivery run --sources` run by itself on a timer, on Linux with systemd, and how to be told when a run ends. It needs a backlog or other work source: see [Work through a backlog](work-a-backlog.md). Claude Code must be signed in for the scheduled runs to start.

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

Each scheduled run is `delivery run --sources --if-idle`, so a run that would overlap another run in the repository is skipped quietly.

## Check or turn it off

```bash
delivery schedule status    # on or off, and when it last ran and will next run
delivery schedule disable   # turn it off; `delivery run --sources` still works by hand
```

`status` also prints the exact `journalctl --user -u delivery-<key>.service` command that shows each scheduled run's output. When the schedule is off it says `Scheduling is off for <repo>` and how to turn it on.

## Run while you are logged out

The timer runs while you are logged in. To have it run while you are logged out too, run the systemd command `loginctl enable-linger` once.

## Use cron without systemd

On a machine without systemd user timers, `enable` refuses with exit code 2 and prints the equivalent line for your own crontab. Unlike the timer, cron skips a run missed while the machine is off.

## Be told when a run ends

Unattended runs end with nobody watching. `notify` is a command run at the end of every run, however it ended: work delivered, a stop, a run blocked before it started any task, or a run with nothing to do. Set it at the top level of `delivery.config.json`:

```json
{ "notify": "./scripts/post-to-chat.sh" }
```

It runs from the repository folder, with the run's report on its standard input as JSON: the same document `delivery report --json` prints, including `parked`, so the command can say what was done and which item is waiting for your answer. A notify command that fails is reported in one line and never changes the run's outcome or exit code. See [Reports as data](reporting.md) for the document, and the [configuration reference](configuration-reference.md#notify).

## Next steps

- [Read the report](read-a-report.md): check what the scheduled runs did.
- [Run steps after landing](run-after-landing.md): deploy once scheduled work has landed.
