---
"delivery-service": minor
---

`delivery status` now says why a task stopped, beneath the account it already gave. For one task
it lists each triage round in one line (the attempt it followed, what set it off, the verdict),
the retries used of those allowed for each of the five kinds with the number of attempts, and,
for a task that stopped, the same "To act" steps `delivery report` gives, followed by two plain
statements: an unchanged task on your list is not run again, and `delivery resume` does not apply
to a finished run. A task with no triage rounds, or no stop, says so in one line; a run made by an
earlier version shows what its record holds and "not recorded" for the rest. Its last line,
`Next:`, names the commands that go further.

`delivery status --decisions` prints every triage round in full: what set it off, the verdict,
the reasoning word for word, and the brief or packet the round produced. It cannot be combined
with `--all` or, for now, with `--json`.

Every line `status` printed before is still printed, and its exit codes and `--json` output are
unchanged.
