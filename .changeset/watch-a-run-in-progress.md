---
"delivery-service": minor
---

Every step a run records now carries the time it was recorded: each line of a run's `log.jsonl`
has an `at` field, an ISO 8601 UTC instant. Records made by an earlier version stay valid and
are read exactly as before; where a time is missing, the commands that report on a run say it
was not recorded. Nothing that decides what a run does next reads the time.
