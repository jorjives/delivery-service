---
"delivery-service": minor
---

`delivery run` and `delivery resume` now end with the report's first sentence ("Your task list: 3
of 4 tasks completed and merged; 1 needs your decision.") and a pointer to `delivery report`, and
leave the report saved as `.delivery/last-report.txt` and `.delivery/last-report.json`, replacing
the pair from the run before. The result of a run is waiting as a file for whoever was not there
when it ended. Under `--json` the two lines go to standard error, so standard output stays data
only. A run whose report cannot be saved ends with its usual outcome and exit code, and one line
saying it was not saved and why.

The report's text now reads the same when it is pasted into a message or opened in a Markdown
viewer. Two of its instructions used to put a placeholder in angle brackets, which such a viewer
hides; they now read `delivery run --task "the reworded task"` and
`delivery run --task "the task, exactly as it is written"`.

`delivery report --write` saves the report it prints, for your list or for the run you name, as
`.delivery/last-report.txt` (the same text, without colour) and `.delivery/last-report.json` (the
same report as data). Each save replaces the pair before it; the files are readable only by you
and are never committed with your project's work. While the saved copy is the report you are
looking at, the report names it under "For whoever tunes this". If the files cannot be written,
the report is still printed, with one line saying it was not saved and why.
