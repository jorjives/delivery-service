---
"delivery-service": minor
---

A run of several tasks at once that was stopped part way, by Ctrl-C, a kill or the machine going
down, is carried on by running `delivery run` again. It keeps the run's id, record and number of
tasks at once, says which run it is picking up, and carries each task that was under way on from
its own last step: a task already delivered is not redone, no working copy is set up twice and
no finished work is merged twice. Under `--json` the run's first record says `RESUMED` rather
than `STARTED`.

While a run of several at once is going, starting another `delivery run` or `delivery resume` in
the same repository, at any concurrency, is refused before anything starts, with exit code 2 and
a message naming the live run, when it started, its shape and how to look at it. The run holds a
lock on the repository under `.delivery/`; a lock left by a killed run is taken over by the next
run, with no unlock step.

Pressing Ctrl-C, or sending the process SIGTERM, stops a run of several tasks at once straight away
with exit code 5 ("stopped before it could finish"), saying how to carry on, and lets the
repository's lock go. A run of one task at a time stops on Ctrl-C as it always has.
