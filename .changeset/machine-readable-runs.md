---
"delivery-service": minor
---

The `delivery` command can now be scripted against. `delivery run --json` prints one JSON object
per step instead of the plain-language lines, with the same exit codes; `delivery status --json`
prints a run's whole status as one JSON document, including every field of the escalation packet
when a run needs a decision; and `delivery status --all` lists every run in the repository,
newest first, with its task and how it ended, in plain language or JSON. Without `--json` the
output is plain-language lines in every environment, piped or in CI included.
