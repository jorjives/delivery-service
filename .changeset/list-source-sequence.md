---
"delivery-service": patch
---

A task in the `tasks` list can now name a `sequence` when the list is worked with `delivery run --sources`. As with the backlog, command and GitHub sources, a task in a sequence waits behind an earlier undelivered task of the same sequence.
