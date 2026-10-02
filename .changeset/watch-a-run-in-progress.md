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

`delivery status --watch` follows a run as it happens, from any terminal, without touching it.
It says what it is watching, gives every task as the record shows it right now, then adds one
line for each change, with the time it was recorded and the task's place on your list; lines
are only ever added, so it reads the same in a terminal, through a pipe and in a log file. With
no run id it follows your task list (or the most recent run when the project has no list), and
with an id that task or that run. It ends when the run ends, with the counts `delivery report`
opens with and the exit code that run ended with, so a script can wait on it. Where nothing
records whether a list worked one task at a time is still going, it says so once, gives the last
recorded activity and keeps waiting; a run of several tasks at once that was stopped part way is
recognised, with how to carry on. `--interval <seconds>` sets how often it looks (default 2).
A run made by an earlier version can be watched too, without times. It prints text only for now.
