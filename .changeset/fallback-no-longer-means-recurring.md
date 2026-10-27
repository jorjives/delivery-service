---
"delivery-service": minor
---

A `fallback` source now only decides when it is read: its items are delivered once, a command source is told when one is done, and a `sequence` on them is kept. Previously a fallback source's items were taken again on every idle run. To keep that for a source that derives new work, add `"recurring": true` to the `list` or `command` source.
