---
"delivery-service": minor
---

A project can now have several tasks from its list worked on at the same time. Set
`concurrency` in `delivery.config.json`, or pass `--concurrency` or `DELIVERY_CONCURRENCY` for
one run, to say how many may run at once; the default stays 1, which works down the list exactly
as before. With more than one, `delivery run` starts that many tasks, each on its own copy with
its own branch and record, and starts the next task on the list as soon as one finishes. Every
line says which task it is about, such as `[2/10]`, and under `--json` every object carries a
`scope` of `run` or `surface`, with the task's place, the total and the run's id. A task that
needs a decision no longer holds up the others: its place goes to the next task, and the run ends
by naming each task that needs you, exiting 4. Setting up and removing working copies and merging
finished work take turns in the checkout, so two tasks finishing together both close properly.
`delivery validate` reports the setting, such as "up to 3 tasks at once (10 queued)", and refuses
a value that is not a whole number of 1 or more.
