---
"delivery-service": minor
---

`delivery status` now shows what each repair changed in a task's working copy, whether it was the
task's own repair of its check or its run's repair of the setup every task shares: one line per
repair with how many files it changed, the lines added and removed, and the file names, marking
a file the check itself runs. `delivery status <run-id> --repairs` prints every changed file's
patch, a file the repair added in full. What a repair changed is captured with git before the
task carries on, without staging or committing anything, so what a task lands is unchanged; up
to 256 KiB of patches is kept per repair with the run's record, and a larger or binary file keeps
its name and counts. Nothing about a run depends on what a repair changed: it is shown, never
judged. The report document gains `surfaces[].repairs`.
