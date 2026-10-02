---
"delivery-service": minor
---

Every step a run records now carries the time it was recorded: each line of a run's `log.jsonl`
has an `at` field, an ISO 8601 UTC instant. Records made by an earlier version stay valid and
are read exactly as before; where a time is missing, the commands that report on a run say it
was not recorded. Nothing that decides what a run does next reads the time.

`delivery report` and `delivery status` use those times for work that has not finished. The
report's second line gives the last time the record shows anything happening ("last activity
1 Oct 02:22 UTC") where it used to say "not recorded" until every task had ended, and a run that
is still going ends its first line with how to follow it ("Follow it: delivery status --watch").
`delivery status` adds a "Last recorded activity:" line to a run that has not finished, and for
a run of several tasks at once says since when each task under way has been in its step. These
are times from the record, never a guess at whether the work is still going.
