---
"delivery-service": minor
---

A project can now list what it wants done, in plain words, and have the harness work down the
list. A `tasks` list in `delivery.config.json` holds a sentence per thing to do, or an object
carrying that sentence and any fields of your own; `delivery run` with no `--task` runs the first
task with no finished run, then the next, each as an ordinary run with its own branch and its own
record, announced as "Task N of M" in your own wording. Progress is worked out afresh every time
from the runs already in the repository, so an interrupted list picks up the task it was on and
carries on, and the list is yours to edit in between: a new entry runs in its place, reordering
changes only the order they are visited in, deleting one leaves its run in the history, and
rewording one makes it a new task, which is also how a finished task is deliberately run again. A
task that needs a decision, or whose run stopped, stops the list there and stops there again next
time, with the exit code a single run already uses. A file that sets both `task` and `tasks`, an
empty list, an empty entry or two entries meaning the same task is refused before anything runs.
`delivery status` says which task of how many a run is, and `delivery run --task "..."` still
runs exactly that one task and leaves the list alone.
