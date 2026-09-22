---
"delivery-service": minor
---

`delivery.config.json` takes a `roles` section that changes what the worker, or the agent that
repairs a check, is told (`systemPromptFragment`) and which tools it may use (`allowedTools`),
with no code. Anything left out keeps its built-in value, and triage cannot be changed from the
file. Every run started from the file uses the changed roles and keeps them if it is resumed.
`delivery preview` shows the changed instructions and tools, and `delivery validate` names an
unknown role or setting, empty instructions or an empty tools list, with the way back to the
built-in one. A misspelled tool name is not caught by `delivery validate`: it shows up during a
run as that tool being refused.
