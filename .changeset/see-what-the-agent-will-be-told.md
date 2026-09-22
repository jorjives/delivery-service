---
"delivery-service": minor
---

`delivery preview` prints, before anything runs, exactly what the agent will be told for a task
in `delivery.config.json`: the next one `delivery run` would do, or the one `--queue-index <n>`
names, counted as "Task N of M" counts. The instructions appear word for word, with the project
description in place, followed by what the agent may do in everyday words ("read files", "edit
files", "run commands"). `--role gate-maintenance` shows the instructions for the agent that
repairs a check that can't run. A number past the end of the list is refused with how many tasks
there are; a configuration problem is reported in the same words `delivery validate` uses. It
needs no agent, no sign-in and no network, changes nothing on disk, and takes `--config` and
`--repo`.
