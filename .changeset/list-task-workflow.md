---
"delivery-service": minor
---

A `tasks` entry that names a `workflow` is now done in that workflow by `delivery run`, and shown in it by `delivery preview`, as it already was with `delivery run --sources`. `delivery validate` refuses an entry that names a workflow the project does not define. `delivery run --workflow <name>` with a list no longer refuses: it is the workflow for the entries that name none.
