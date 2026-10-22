---
"delivery-service": minor
---

`delivery schedule enable --name <name>` adds a schedule alongside the others on your project, each at its own interval, such as an hourly pass and a nightly one. Enabling a name again replaces only that schedule. The schedule you get without `--name` keeps its timer and keeps working untouched until you enable it again. `delivery schedule status` lists every schedule with its interval, last and next run and log command, and `--name <name>` shows just one. Every scheduled run now passes `--if-idle`, so a run that would overlap another is skipped quietly.
