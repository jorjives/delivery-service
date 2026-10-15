---
"delivery-service": minor
---

Every task's work is now checked for weakened tests, not only a review's fixes: a deleted or
renamed test, a change to how tests run, a new skip marker, or a test setting hidden from git is
refused by name, even when your own check passes. Editing an existing test is allowed by default.
A task written as an object can change this with `guards`, for example
`"guards": { "add": ["tests-unchanged"] }` or `"guards": { "off": ["tests-untouched"] }`.
