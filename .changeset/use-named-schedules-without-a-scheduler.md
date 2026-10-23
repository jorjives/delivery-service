---
"delivery-service": patch
---

On a machine with no scheduler backend yet, such as macOS or Windows, `delivery schedule enable` now says so plainly, rather than that systemctl is missing, and prints the crontab line for the schedule being enabled, with its interval, its settings and `--if-idle`, so you can add it to your own crontab. Cron skips a run missed while the machine is off. `delivery schedule status` and `disable` there say scheduling is off. The scheduling guide now works through an example of two schedules on one project and explains what happens when runs overlap.
