---
"delivery-service": minor
---

A new ready-made check, `{ "type": "fails-with-new-test" }`, passes when the work changed a test
file, your tests pass on the commit the step started from, and they fail on the work's commit. Use it
on the reproduce step of a reproduce-then-fix workflow.
