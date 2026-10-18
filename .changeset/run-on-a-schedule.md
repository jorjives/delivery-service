---
"delivery-service": minor
---

`delivery schedule enable --every <interval>` has `delivery run --sources` run by itself for a project, on a systemd user timer, and runs a schedule missed while the machine was off as soon as it is back. On a machine without systemd user timers it refuses and prints the equivalent crontab line instead.
