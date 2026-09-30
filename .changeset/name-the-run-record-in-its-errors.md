---
"delivery-service": patch
---

A missing or damaged record of a run of several tasks (`run.json` and its log) is now reported
as that record, through its own `RunFileNotFound` and `CorruptRunFile` errors, rather than as a
per-task case file. The command's message names the run of several tasks and the folder to
remove, so a damaged run record is no longer mistaken for a damaged task.
