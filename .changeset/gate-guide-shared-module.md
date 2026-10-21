---
"delivery-service": patch
---

The "writing a gate" guide now says that one custom gate module serves every task in a run, possibly at the same time, and shows state carried from `baseline` to `check` keyed by `ctx.worktreePath`.
