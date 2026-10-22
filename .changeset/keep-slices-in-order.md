---
"delivery-service": minor
---

Items can belong to a named sequence: a `sequence` field on a backlog item or a command source's
task, or a `sequence:<name>` label on a GitHub issue. `delivery run --sources` takes only the
earliest item of a sequence that is not yet delivered, and nothing later in it while that item is
parked, waiting for your answer or being worked; everything else carries on. A source of slices
that names each slices file as the sequence keeps each spec's slices in order. `delivery status`
and `delivery report` name each held sequence, the item holding it and why, and the report's data
carries them as `held`.
