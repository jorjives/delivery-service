# Read the report

This guide shows how to read `delivery report`, the plain-words account of your task list: what landed, what needs you and what was not started. Run it after a list has run, overnight or while you were elsewhere. It assumes you have run a [task list](run-a-task-list.md).

```bash
delivery report
```

```text
Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 not started.
Started 1 Oct 02:01 UTC; last activity 1 Oct 03:04 UTC.
Your main folder was protected while the agent worked.

NEEDS YOU (1)
  Task 3 of 4: "Remove every page under the old news section"
    Needs your decision. The agent stopped and said it could not go on without your say-so.
    The agent said: "This would delete 14 published pages. I need the owner to confirm before I remove them."
    Where the work is: this task's changes were not added to main.
    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.
            2. Run: delivery run
    Full account: delivery status remove-every-page-under-the-20261001T030000Z

DONE (2)
  Task 1 of 4: "Add a contact form to the site": merged into main at 02:19
  Task 2 of 4: "Update the prices page for October": merged into main at 02:31

NOT STARTED (1)
  Task 4 of 4: "Show a cookie banner on first visit"
  These are waiting behind task 3. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 3, then run `delivery run` to carry on with them.

FOR WHOEVER TUNES THIS
  Retries used across these tasks: agent corrections 0 of 9; check re-runs 0 of 9; check repairs 0 of 6; agent restarts 0 of 15; hand-off retries 0 of 9.
  Time and cost, recorded for 3 of 3 agent sessions: 3 min 41 s of session time; USD 0.50, estimated by the agent runtime.
  Saved to: .delivery/last-report.txt and .delivery/last-report.json

Next: delivery status --all (every run)
```

The first line counts your tasks by what happened to them. Under it, each part appears only when
it has tasks in it:

- **Needs you:** a task that stopped for something only you can settle. It says what kind of stop
  it was ("Needs your decision", "Failed after 3 attempts", a usage limit), quotes what the agent
  itself said, says where the work is, and lists what to do under "To act".
- **Stopped, for your engineers:** a task stopped by a problem with the check, its repair or
  handing the work off. It is not a decision for you; it gives one line to pass on.
- **Done:** each finished task and where its work went, in the words of how your project lands
  work: merged, committed on a branch, or a pull request open.
- **Not finished:** tasks of a run that is still going, or that stopped part way.
- **Not started:** tasks nothing has run yet, with why they were left and how to carry on.
- **Worth a look:** a repair that changed a file the check runs (the guards accept it, so this is
  where you review it), and a task that ran with a test guard turned off, naming the guards.

Under the start and last-activity times, a line says whether your main folder was protected while
the agent worked, and why not when it was not.

Words taken from a run (your task, what the agent said) are always in quotation marks. Every other
sentence is the harness's own and is the same for every project. "For whoever tunes this" is for
the person who sets the limits. It counts the retries used (`agent corrections`, `check re-runs`, `check repairs`, `agent restarts` and `hand-off retries`: the five [`budgets`](configuration-reference.md#budgets); [`delivery status`](check-a-run.md) names the same five `correction`, `gate recheck`, `gate repair`, `session retry` and `close retry`), says how long the agent sessions took
and roughly what they cost (an estimate from the agent runtime, with how many sessions it covers,
or "not recorded"), and names the saved copy of the report when there is one.

`delivery report <run-id>` reports one task's run, or one run of several tasks at once, instead
of the list. In a project with no `tasks` list, `delivery report` reports the most recent run and
says so in its first line.

It never changes a run or its record and takes no lock, so you can run it while a run is going. In
that case it says the run is still going, rather than giving a final count, and how to follow it
("Follow it: delivery status --watch"). For work that has not finished, its second line gives the last
time the record shows anything happening ("last activity 1 Oct 02:22 UTC"). That time comes from
the record for you to judge by; the report never guesses whether the work is still going. Where
nothing records whether a task worked one at a time is still going, the report says exactly that
and how to carry on if it is not. If one run's record is damaged, the report names that task and
the file, says at the top that it is incomplete, and still reports the rest. A run made by an
earlier version still reports. Where its record does not say why a task stopped, the task appears
under "Stopped, for your engineers" with the reason the run recorded.

`delivery run` and `delivery resume` save the report when they end, and `delivery report --write`
saves the one it prints, for your list or for the run you name. The save makes two files in your
project's `.delivery` folder: `last-report.txt`, the same text without colour, ready to open or
paste into a message, and `last-report.json`, the same report as data. Each save replaces the
previous pair. The files are copies for your convenience: only you can read them, they are never
committed with your project's work, and no command reads its answer from them, so deleting them
loses nothing. While the saved copy is the report you are looking at, the report's last section
names it ("Saved to: ..."). If the files cannot be written, the report is still printed, with one
line in that place saying it was not saved and why.

`report` exits 0 whenever the report could be made, whatever it says, and 2 when it could not. For
a run id that names nothing it prints "I couldn't find that run's record" and the path it looked in.

To get the same report as data for a dashboard or a script, add `--json`; `delivery report
--schema` prints the schema of that document. Standard output holds only the data, and with
`--write` it is exactly what is saved as `last-report.json`. [Reports as data](reporting.md) lists
every key, the schema, and what is promised not to change.

To see a report without an agent or a sign-in, run `npm install` in a checkout of this repository,
then `npm run demo:report-slice-1`. It runs a list of four tasks against a [scripted
agent](glossary.md#scripted-agent), prints the report, follows its advice, and prints the report
again.

## Next steps

- [See what happened to a run](check-a-run.md): the full account of one run
- [Reports as data](reporting.md): the same report as versioned JSON
