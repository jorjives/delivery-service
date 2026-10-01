---
"delivery-service": minor
---

In a run of several tasks at once, a check that keeps erroring on one task's finished work is now
that task's own business: it re-checks, then repairs its own check on its own limit, and no other
task is held. Only when a second, different task hits the same thing does the run treat the shared
environment as broken and repair it once. The same task erroring again counts once, and a
successful repair starts the count afresh. A check that cannot run before a task has started still
stops the run for one repair straight away. A run of one task at a time is unchanged.
