---
"delivery-service": patch
---

`delivery packs update` now says when an act's sign-off becomes one that cannot be known, because the new version takes it from a setting that has no value, or from a different setting. `changes` gains a `hold-unknown` kind, with `workflow` and a `wider` direction, and the summary names it under Sign-off. New published key value `delivery.pack-decision/1.changes[].kind = "hold-unknown"`.
