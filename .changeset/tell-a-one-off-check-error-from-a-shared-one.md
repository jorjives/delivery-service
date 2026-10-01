---
"delivery-service": minor
---

In a run of several tasks at once, a check that keeps erroring on one task's finished work is now
that task's own business: it re-checks, then repairs its own check on its own limit, and no other
task is held. Only when a second, different task hits the same thing does the run treat the shared
environment as broken and repair it once. The same task erroring again counts once, and a
successful repair starts the count afresh. A check that cannot run before a task has started still
stops the run for one repair straight away. A run of one task at a time is unchanged.

`delivery status` for a run that repaired its shared environment and carried on now says so beside the environment line: "Environment: healthy (repaired once during this run)". `--json` names every task whose check errors led to a repair under `trips[].cause`.

An agent session stopped by an API rate limit or a spending limit is now described as that, in plain words: "the AI service is limiting requests" or "the spending limit has been reached". It is never counted as a check error or as a sign that the shared environment is broken.

If a usage limit stops the run's one repair, the run stops at once rather than spending its repair limit, and says the limit, not the environment, was why. The run's record and `delivery status --json` give `cause: "usage_limit"`.

The shared-environment example and its guide, `docs/shared-environment.md`, now also show a helper that comes and goes: one task's error handled by that task, a second task's making it a shared repair.
