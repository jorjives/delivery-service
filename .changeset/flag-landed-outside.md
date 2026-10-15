---
"delivery-service": minor
---

A task whose branch is found with a pull request open after an agent session is stopped for you,
with the pull request and the session named, rather than treated as landed. `delivery report`
lists it under "needs your decision" and its `cause` carries the new kind
`"landed_outside_closer"` and the `pullRequest`.
