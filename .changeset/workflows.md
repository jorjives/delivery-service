---
"delivery-service": minor
---

Workflows: name an ordered list of steps under `workflows` in your config file, each with its own
instruction, and run a task through it with `delivery run --task "..." --workflow <name>`. Each
step is checked on its own, by the project's check or its own, and the next starts only once it is
accepted. A step can continue the previous step's agent session, change its guards, or use its own
agent options. The task is delivered once, after the last step. A task run without `--workflow`
works exactly as before.
