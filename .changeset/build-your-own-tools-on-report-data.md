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
