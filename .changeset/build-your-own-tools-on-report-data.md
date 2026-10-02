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
