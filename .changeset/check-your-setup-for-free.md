---
"delivery-service": minor
---

`delivery validate` checks a project's configuration before anything runs. It reads
`delivery.config.json` the way `delivery run` would, then either lists what it found (the project
description, how many tasks are queued, what the check runs and what happens to work that
passes) and ends "Ready to run.", or prints the one thing to fix and exits 2. It catches every
mistake a run would refuse at the start, including an empty description, an empty list or entry,
two entries that are the same task, both `task` and `tasks` set, and a custom check or closing
action whose module can't be loaded. It needs no agent, no sign-in and no network, changes
nothing on disk, and takes the same `--config` and `--repo` options as `delivery run`. A setting
of the wrong kind is now described by what it takes, rather than by the schema's own complaint.
