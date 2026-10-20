# Run on a schedule

This guide shows how to have `delivery run --sources` run by itself on a timer. It needs a backlog or other work source: see [Work through a backlog](work-a-backlog.md).

Turn on a schedule once, and `delivery run --sources` runs by itself for this project from then on:

```sh
delivery schedule enable --every 30m   # or 1h, 6h, 12h, 1d (the default)
```

```sh
delivery schedule status    # on or off, and when it last ran and will next run
delivery schedule disable   # turn it off; `delivery run --sources` still works by hand
```

It installs a systemd user timer for the project, `delivery-<key>.timer` in
`~/.config/systemd/user/`. A run missed while the machine was off happens as soon as it is back.
Each run's output goes to the journal (`journalctl --user -u delivery-<key>.service`), and the run
shows in `delivery status` and `delivery report` as if you had typed the command. To change how
often it runs, run `enable` again with a new `--every`. The timer runs while you are logged in. To
have it run while you are logged out too, run `loginctl enable-linger` once.

On a machine without systemd user timers, `enable` refuses and prints the equivalent line for your
own crontab.

## Next steps

- [Read the report](read-a-report.md): check what the scheduled runs did
