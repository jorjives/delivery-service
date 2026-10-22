---
"delivery-service": minor
---

`delivery schedule enable --name <name>` adds a schedule alongside the others on your project, each at its own interval, such as an hourly pass and a nightly one. Enabling a name again replaces only that schedule. The schedule you get without `--name` keeps its timer and keeps working untouched until you enable it again. Every scheduled run now passes `--if-idle`, so a run that would overlap another is skipped quietly.
