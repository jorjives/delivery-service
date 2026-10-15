---
"delivery-service": minor
---

A repair of your project's check is now judged by the same test guards when it ends. One that
deletes or skips a test, or hides a test from git, stops the run for you to look at. A repair that
changes how tests run (a runner setting, a CI file, the test script) is allowed, appears under
"Worth a look" in the report, and is no longer counted against the next attempt at the task.
