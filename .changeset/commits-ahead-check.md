---
"delivery-service": minor
---

A new ready-made check, `{ "type": "commits-ahead" }`, passes once the work has added at least one
commit. Every gate command can now read `DELIVERY_STEP_START`, the commit the work started from.
