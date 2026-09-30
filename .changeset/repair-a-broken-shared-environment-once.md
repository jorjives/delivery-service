---
"delivery-service": minor
---

When the environment the tasks of a run of several at once share breaks, the run repairs it
once rather than letting every task find it, retry and fight over it. It holds any task about to
check or hand off its work, leaves work already under way alone, runs one repair with the
existing gate-maintenance agent once nothing is mid-check, and says "Fixed. Resuming." when it
works. `budgets.gateMaintenance` becomes one limit for the whole run. If the repair cannot fix
it, the run stops with exit code 4, says how many tasks were waiting, had finished and are still
queued, and records the shared environment as the cause; the held tasks carry on with the next
`delivery run`. Under `--json`, each change in the environment's state is a `scope: "run"` record
naming the tasks it affects. A run of one task at a time is unchanged.
