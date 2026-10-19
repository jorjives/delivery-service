---
"delivery-service": minor
---

`delivery findings` and `delivery fix` are removed: a review's problems are backlog ideas, chosen with `delivery approve` and fixed by `delivery run --sources`. Pack manifests must be `delivery.pack/2`, and a pack's folder is listed under `packs` in your configuration. `delivery review` and `delivery packs check` return in a later change, rebuilt on the backlog.
