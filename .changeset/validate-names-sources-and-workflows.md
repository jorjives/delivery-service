---
"delivery-service": patch
---

`delivery validate` now describes a project that works from `sources`: it lists where the work
comes from and says to run it with `delivery run --sources`, instead of suggesting `--task`. It
also lists the project's workflows with their step counts, and says "no tasks listed" only when
a project has neither tasks nor sources.
