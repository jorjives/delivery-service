---
"delivery-service": patch
---

A workflow step's prompt can use `{{task.<field>}}`, as the guide always said: the harness now fills it in with that field's own value from the task, instead of sending the placeholder text to the agent unchanged.
