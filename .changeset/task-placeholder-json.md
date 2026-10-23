---
"delivery-service": patch
---

A `{{task.<field>}}` placeholder in a step prompt now fills an object or array field as compact JSON,
and `null` as `null`, instead of `[object Object]` or a comma-joined list. Strings, numbers and
booleans are written as before.
