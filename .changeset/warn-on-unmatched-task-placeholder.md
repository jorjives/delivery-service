---
"delivery-service": minor
---

`delivery preview` now warns when a step's prompt has a `{{task.<field>}}` placeholder that the
task has no field for, such as a typo like `{{task.sepc}}`. Until now the agent was sent the
placeholder as literal text and nothing said so.
