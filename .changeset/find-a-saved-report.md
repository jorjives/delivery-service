---
"delivery-service": minor
---

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
