---
"delivery-service": minor
---

`.delivery/` now ignores everything in it except `.delivery/backlog/`, so the work items you keep there are tracked and committed like any other project file. Run records, locks and saved reports stay out of `git status` as before.
