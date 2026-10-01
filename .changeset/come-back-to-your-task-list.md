---
"delivery-service": minor
---

`delivery report` says in plain words what happened to your list of tasks and what to do next. Its
first line counts the tasks by what happened ("3 of 5 tasks completed and merged; 1 needs your
decision; 1 failed after 3 attempts"), then it lists the tasks that need you, the ones stopped for
your engineers, the ones done, and the ones not started. Each stopped task says what kind of stop
it was, quotes what the agent itself said, says where the work is, and gives the steps to take.
`delivery report <run-id>` reports one run instead; a project with no list gets its most recent
run. It only reads, so it is safe while a run is going, it works on runs made by earlier versions,
and it exits 0 whenever the report could be made. One damaged record no longer hides the others:
it is named, with its file, and the rest is reported.

A run's record now says why a task stopped (`cause` on its outcome) and which usage limit stopped
an agent session (`limit` on that session's entry). Both are optional, so older records read as
before, and nothing that decides what a run does next reads them.
