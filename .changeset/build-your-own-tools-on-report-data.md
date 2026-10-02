---
"delivery-service": minor
---

`delivery report --json` prints the report as one JSON document instead of text, for a dashboard
or a script. The document names its format and version (`"schema": "delivery.report/1"`) and
carries everything the report says: how many tasks stand where, and for each task its standing,
its state history, how many attempts and retries it used, every triage round with its reasoning
and the brief or packet it produced, the recorded reason and cause of a stop, the stop in plain
words with who must act, the escalation packet word for word, and whether the work is still
going (`true`, `false`, or `null` when nothing records it). Every key is always present, `null`
or `[]` where it does not apply. A damaged record is named under `incomplete`, and every task
that could be read is still there. Standard output holds only the document: no colour and no
sentence for a person. With `--write` it is exactly what is saved as `.delivery/last-report.json`.

The document gains three keys, which the saved `last-report.json` carries too: each task's
`escalation` (the packet it stopped with), a run's `breaker` (how the setup its tasks share
stands) and `trips` (each time that setup broke, with every repair tried).

`delivery status --json` still prints every key it printed before, with the same names and
meanings, for one run and for a run of several tasks at once, and now carries one more: `report`,
the same versioned document `delivery report <run-id> --json` prints for that run. A script that
already reads `status --json` finds the retry budgets, the state history and every triage round
there. `delivery status --decisions --json` is no longer refused: it prints that same document,
which holds every round in full.

`delivery status --watch --json` follows a run as data: one JSON event to a line, each naming its
format and version (`"schema": "delivery.event/1"`). The first line says what is being followed
(`stream_started`), then comes one event for every step the record already holds and one for
each step as it is recorded (a task entering a step, a triage round with its reasoning, a task
ending, the setup a run's tasks share breaking and being repaired, a run ending), and the last
line says how it ended (`stream_ended`), so a reader knows when to stop. A list worked one task
at a time, or since a run of several tasks took one of its tasks, is marked as having no run of
its own (`"run": null`); the document says the same with `run.governs`, which is `false` once a
task of the list has been worked on its own after the run began. It exits with the code the
watch in words exits with. Replaying a finished run prints exactly the lines that following it
live printed. Standard output holds only events. The watch in words now ends a finished run's task
list as it ends one followed while the run went: by that run's own outcome.

`delivery report --schema` prints the JSON Schema of both formats, generated from the same
definitions the harness validates its data with. Every document and event the commands print is
valid against it. The schema is open: it accepts a key, a name or an event type it does not
know, so data from a later release still passes. Within a version (`/1`) no key is ever removed,
renamed or given another type and no name a value can take is removed; the test suite fails if
one is. Consumers should ignore keys and names they do not know, and should not parse the
sentences meant for people. The step-by-step lines `delivery run --json` prints are outside this
promise and stay as they are. Every key of the document is always present, `null` where it does
not apply: a task's `cause` and a trip's `cause` each name every key their kinds can have, with
`null` where the kind has none.

The functions the commands are built on are now part of the package: `loadSnapshot` (read a
project's records), `deriveReport` (the document), `eventsOf` (its events), `renderText` (the
report in words), `streamStarted` and `streamEnded` (the two marker events), `publishedSchema`,
`repoLocked`, and the `ReportDocument` and `ReportEvent` schemas with their types.
