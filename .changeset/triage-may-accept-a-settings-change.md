---
"delivery-service": minor
---

When a run fails only because it changed how tests run (a test-runner setting, a CI file,
`.gitignore`, the `Makefile`), triage is now asked about it straight away instead of after several
blind retries, and may accept it as the task's own legitimate work. A deleted, edited or skipped
test is never accepted this way.
