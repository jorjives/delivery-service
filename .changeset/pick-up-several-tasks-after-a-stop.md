---
"delivery-service": minor
---

A run of several tasks at once that was stopped part way, by Ctrl-C, a kill or the machine going
down, is carried on by running `delivery run` again. It keeps the run's id, record and number of
tasks at once, says which run it is picking up, and carries each task that was under way on from
its own last step: a task already delivered is not redone, no working copy is set up twice and
no finished work is merged twice. Under `--json` the run's first record says `RESUMED` rather
than `STARTED`.
