---
"delivery-service": minor
---

`delivery validate` now names each setting that only takes effect with `delivery run --sources` (`closer.stack`, `after`, `parkAfter`, and a workflow's `after` and `hold`) when the project sets no `sources`, instead of saying nothing while a task run ignores it. The configuration reference says which settings need `--sources`.
