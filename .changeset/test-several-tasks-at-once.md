---
"delivery-service": minor
---

The testing API can now run several scripted tasks at once. `runSupervisorAgainstMock` from
`delivery-service/testing` drives a list of tasks through the same supervisor `delivery run` uses
with `concurrency` above 1, against one scratch repository, with a chosen number of slots; each
task has its own script and its own journal, and each script's `delayMs` decides which task
reaches a step first, so a test of two tasks finishing together gives the same result every time.
The testing guide has a new section, "Testing several tasks at once", whose worked example shows
one task merged and the other refused because the base moved on.
