---
"delivery-service": minor
---

`delivery backlog` now also lists the open issues a configured `github` source would supply to the
next `delivery run --sources`, marking those that are parked, instead of reporting an empty backlog
when the work is all in GitHub issues.
