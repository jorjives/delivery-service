# Observability and Reporting — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-01-observability-and-reporting-design.md`
> **Status:** ✅ Complete — 2026-10-03 — all 7 slices delivered
> Next step: invoke writing-plans with this document

**Audience note:** as with Items 8 to 10, this item's product surface is the `delivery` command,
so the terminal is the product UI. UAT is written for a person using it (Dana, Marcus or Priya
from `docs/personas.md`): typing a `delivery` command and reading what it prints is using the
product. A real run needs the Claude Code CLI and a sign-in on the demo machine; recorded
regression tests route the agent to the vendored `claude-mock` instead. Reading a report needs
neither: every reporting command works on runs already on disk.

**Decided without a human (unattended run):** the slice boundaries below were chosen by the
autonomous run, not confirmed by a person. Order follows the journeys in the spec and
dependency: first the returning owner's report over a task list (the journey the roadmap names
as the trust-maker, and the one that establishes the single read model every later slice
renders); then the engineer's detail behind a stop; then watching a run in progress, which is
where times start being recorded; then the kept report file; then the versioned data for
tools, placed after the three human views so it publishes a document whose shape they have
already exercised; then the two SHOULD capabilities, each of which records something new. The
degraded states (no runs, damaged or old records, unknown liveness) are acceptance criteria of
the slice whose surface first meets them, not a slice of their own. The COULD tier
(full-screen view, HTML report, trace parent, cross-run trends, collapsing a long Done list,
agent-written plain summary) is not sliced.

---

## Slice 1: Come Back to Your Task List and See What Happened and What to Do

**Status:** ✅ Complete — 2026-10-02 — `f608aaa`
**Tests:** ✅ Recorded — 2026-10-02 — `8c0c721` — cli — 1 UAT + 3 AC, 4 skipped
**Delivers:** A project owner types `delivery report` and reads, in plain words, how many tasks landed, which need her, which need an engineer, which were not started, and the next step for each.

**Operational note:** No set-up change and no configuration key: the report works on any runs already on disk, including ones made before this slice, and reads without taking the lock, so it is safe during a run. Reports are a pure reading of the record, so a problem a user hits can be reproduced from a copy of their run folder. A reporting demo built on the scripted agent sits with the existing demos, so the output can be seen with no agent and no sign-in. The reason a task stopped starts being recorded with each outcome from this slice on; nothing that decides what a run does next reads it.

**Build note:** One read model, kept in the library and apart from the code that prints it, following the owner's autoloop precedent of separating a console's model from its views; the command line renders it and later slices add renderings, never a second derivation. States, retries and standings are worked out by the same folds that resuming a run already uses, not by a parallel reporting fold that could disagree with them. Wording comes from closed phrase tables that cover every case, as today's output phrases do, never from a model-written summary. Layout is plain lines as `delivery status` prints today, with no table or colour library; colour and tone reuse the existing rule. Stripping terminal control characters from quoted text is one small purpose-built function, not a dependency. No dependency is added.

### Prerequisites

- A project's configuration file can hold an ordered list of tasks, and `delivery run` works through it, one at a time or several at once
- Each task's run leaves a record on disk that `delivery status` can read, including the escalation packet of a task that stopped
- A task that has an earlier run is recognised by its wording, so an unchanged task is not run again

### Acceptance Criteria

- [ ] `delivery report` with no run named reports the project's task list: a headline sentence counting tasks by what happened ("3 of 5 tasks completed and merged; 1 needs your decision; 1 failed after 3 attempts"), then sections "Needs you", "Stopped, for your engineers", "Done" and "Not started", each present only when it has tasks
- [ ] The report works for a list run one task at a time, which has no run of its own: tasks left alone behind one that stopped appear under "Not started" with a sentence saying why they were left and how to carry on
- [ ] `delivery report` with a run named reports that task, or that run of several tasks; where the project has no task list, a bare `delivery report` reports the most recent run and says so in one line
- [ ] Every stopped task says what kind of stop it was and who must act: a task the agent would not finish without permission or a credential reads "Needs your decision"; a task whose check still fails after the agent's attempts reads "Failed after N attempts", N being how many times the agent tried; a task stopped by a problem with the check, its repair or landing the work appears under "Stopped, for your engineers" with a line the owner can pass on
- [ ] Every stopped task quotes the agent's own last explanation, in quotation marks and labelled as the agent's; no other sentence in the report contains task-specific wording
- [ ] Every stopped task has a "To act" list with a route that works: for a finished task it says to amend the task wording or remove it from the list and then run `delivery run`; it never advises `delivery resume` for a finished task and never advises simply running again with the task unchanged; a run that did not finish is advised `delivery resume` with its id
- [ ] "Where the work is" and the landing words ("merged into main", "committed on branch ...", "pull request open") follow the way the project lands work; a project with its own closer is told to check what its closer did, and the report never claims in general that work was kept or that nothing changed
- [ ] A task that stopped because a usage limit was reached says so in those words
- [ ] No sentence of `delivery report` uses the harness's internal words (surface, budget, gate, triage, authority, terminus, breaker, escalated); a "For whoever tunes this" block gives retries used across the run in the owner's vocabulary
- [ ] A run made before this slice still reports: its stopped tasks appear under "Stopped, for your engineers" with the reason the run recorded and no advice the record cannot back; nothing is shown as zero or blank, missing facts read "not recorded"
- [ ] With no runs in the folder the report says so and how to start one; with a run still going it says the run is still going and never prints a final-sounding headline; where nothing records whether a one-at-a-time run is still going it says exactly that rather than guessing
- [ ] One damaged task record does not stop the report: that task is named as damaged with its file, the other tasks are reported, and the top line marks the report incomplete; no stack trace
- [ ] Escape sequences and other control characters in quoted agent or check output cannot change the terminal: they are removed from the printed text while line breaks are kept
- [ ] `delivery report` exits 0 whenever the report could be made, whatever it says; the exit codes of `delivery run` and `delivery resume` are unchanged
- [ ] The same record always prints the same report, byte for byte, at any terminal width, piped or not; every report ends with a "Next:" line naming real commands

### UAT

**What you can now do:** Come back after a list of tasks has run and learn from one command what landed, what needs you and what to do about it.

**How to try it:**
1. In a copy of the example project, set up a list of four tasks where one asks for something the agent should not do without permission, and run `delivery run` until it stops.
2. Type `delivery report` and read the top line.
3. Read the task under "Needs you": what the agent said, where the work is, and the "To act" steps.
4. Follow the steps: reword that task to give the permission (or remove it), run `delivery run`, then `delivery report` again.

**What you should see:** The first report's top line counts the tasks done, the one that needs your decision and those not started, with no technical vocabulary. The task under "Needs you" quotes the agent's own explanation and tells you to amend or remove the task and run again. After you do, the second report shows that task done and the tasks behind it carried on.

**Why this matters:** The report is the only window many owners have into what the harness did overnight; if it does not say what to do next in their own words, they stop trusting the tool.

---

## Slice 2: See Why a Task Stopped, With Every Decision and Retry Behind It

**Status:** ✅ Complete — 2026-10-02 — `50bc3a1`
**Tests:** ✅ Recorded — 2026-10-02 — `68d3410` — cli — 1 UAT + 5 AC, 3 skipped
**Delivers:** An engineer types `delivery status` for a stopped or running task and reads the decision asked, the retry budgets at that moment, and each triage round that led there, with the full text of every round on request.

**Build note:** The detail is another rendering of the read model the report already uses, not a second derivation; the existing escalation packet rendering at the top of `delivery status` is kept as it is. Budget figures and triage rounds come from the record the harness already keeps and the folds that resuming uses.

### Prerequisites

- `delivery report` can report a task list, a run of several tasks and a single task, and points each stopped task at `delivery status` for the full account
- The reason a task stopped is recorded with its outcome
- Each triage round's trigger, verdict and reasoning are kept in the task's record

### Acceptance Criteria

- [ ] `delivery status` for one task shows, beneath the existing account of a stopped run, the retry budgets at the moment it stopped (used and allowed, for each of the five kinds of retry) and the number of attempts the agent made
- [ ] It shows one line per triage round: after which attempt, what set it off, and what was decided
- [ ] `delivery status --decisions` prints every triage round in full: the trigger, the verdict, the reasoning word for word, and the brief or packet that round produced, so a reader sees exactly what the next attempt was told
- [ ] `delivery status` for a run of several tasks shows what each in-flight task is doing right now, in place of "not finished yet", and the retry budgets rolled up across the run alongside the run's shared repair limit
- [ ] A stopped task's status ends with the same "To act" advice the report gives, and states plainly that an unchanged task on the list is not run again and that `resume` does not apply to a finished run
- [ ] `delivery status --all` shows the headline counts on each run's line
- [ ] The technical sections use the harness's own words (correction, gate, triage) deliberately; evidence is shown word for word, never paraphrased
- [ ] A task with no triage rounds, or no stop, says so in one line rather than showing an empty section; a run made before this slice shows what its record holds and "not recorded" for the rest
- [ ] Everything `delivery status` printed before this slice is still printed, and its exit codes are unchanged
- [ ] Every status output ends with a "Next:" line naming `--decisions` and `delivery report` where they apply

### UAT

**What you can now do:** Open a task that stopped and see, in one place, what decision is being asked, how many retries were spent and what was decided at each step on the way.

**How to try it:**
1. In the example project, run a list where one task's check cannot pass, and let `delivery run` finish.
2. Type `delivery report` and copy the `delivery status ...` command printed under the failed task.
3. Run that command and read "How it got here" and "Retry budgets at stop".
4. Run it again with `--decisions` added and read the full text of each round.

**What you should see:** The status shows the evidence from the check unchanged, one line for each time the harness sent the agent back, and the correction budget fully used. With `--decisions` each round expands to its reasoning and the exact brief the next attempt was given.

**Why this matters:** Whoever is pulled in to deal with a stopped task was not watching; if they must reconstruct what happened from raw records, the harness has handed them work instead of an answer, and whoever tunes the checks cannot see where retries are being spent.

---

## Slice 3: Watch a Run in Progress From Another Terminal

**Status:** ✅ Complete — 2026-10-02 — `a3fcefd`
**Tests:** ✅ Recorded — 2026-10-02 — `030ff01` — cli — 1 UAT + 2 AC, 6 skipped
**Delivers:** Anyone types `delivery status --watch` in a second terminal and sees what each task is doing now and each change as it happens, with times, until the run ends, without touching the run.

**Operational note:** From this slice on every step the harness records carries the time it was recorded; nothing that decides what a run does next reads those times, and records made earlier read as "times were not recorded". The harness's own tests that compare recorded steps exactly must compare them without the time, through one shared helper, and tests that need times fix the clock rather than reading the real one. Watching reads the record on disk and takes no lock, so it works from any terminal, for any run, including one started by someone else.

**Build note:** The watch is a small purpose-built poll of the record's files with a remembered position per file, not a file-watching library and not the operating system's change notifications, which are unreliable on network and container file systems. Output is append-only lines as the run's own output is today; no cursor movement, redraw or terminal-interface library. Whether a run is live comes only from the existing repository lock, which runs of several tasks hold; no heartbeat, process file or new lock is added, and liveness is never guessed from file ages.

### Prerequisites

- `delivery status` shows what each in-flight task of a run is doing
- `delivery report` reports a task list run one at a time as well as a run of several tasks
- A run of several tasks holds the repository lock while it is going; a one-at-a-time run holds none

### Acceptance Criteria

- [ ] `delivery status --watch` opens by naming what it is watching and saying that Ctrl-C stops watching without affecting the run, then prints a "Right now" picture of every task, then one line per change as it is recorded
- [ ] Every change line starts with the time and the task's place in the list; lines are only ever added, never redrawn, and read the same in a terminal, a pipe or a log file; attention lines are marked with a word or symbol, not colour alone
- [ ] A working task says which step it is in and since when; the report and status of an unfinished run state the last recorded activity as a time
- [ ] With no run named, the watch follows the project's task list, as `delivery report` does (or the most recent run when there is no list); with a run named it follows that task or that run of several tasks
- [ ] Watching a run of several tasks ends when the run finishes, with the headline counts and a pointer to `delivery report`; "Run finished" is said only of a run of several tasks
- [ ] Watching a one-at-a-time list ends when every task is done or when a task stops the list, with "Your task list has stopped" or "Every task on your list is done" and the headline counts; the moment between one task finishing and the next starting does not end the watch
- [ ] When the watch ends because its subject finished, its exit code is the one that run, or `delivery run` for that list, ended with, so a script can wait on it
- [ ] For a one-at-a-time run the watch says once that nothing records whether the run is still going, shows the last activity time, and keeps waiting; it never decides by itself that the run is dead
- [ ] A run of several tasks that was killed is recognised: the watch says the run stopped part way, how to carry it on, and exits 0
- [ ] Shared-environment trouble and its repair appear as plain lines saying that tasks are being held while the setup is repaired, and when they carry on
- [ ] `--interval` changes how often the record is checked; the default is every two seconds
- [ ] A run recorded before this slice can still be watched and reported: lines drop the time and it says once that times were not recorded for this run
- [ ] A line caught half-written is never shown as damage: the watch shows the state one step earlier and catches up on the next check

### UAT

**What you can now do:** Keep an eye on a run from a second terminal, or check on one you did not start, and see each task's progress as it happens.

**How to try it:**
1. In the example project, with a list of four tasks set to run two at once, type `delivery run` in one terminal.
2. In a second terminal in the same folder, type `delivery status --watch`.
3. Read the "Right now" picture, then watch the lines that follow as tasks start, are checked and finish.
4. Press Ctrl-C in the second terminal part way through, confirm the first terminal carries on, then start watching again.

**What you should see:** The second terminal lists all four tasks with what each is doing and since when, then adds a timed line for every change. Stopping the watch does not disturb the run; starting it again shows the current picture. When the run ends the watch prints the final counts, points you to `delivery report`, and stops by itself.

**Why this matters:** A long run should not need its starting terminal to be understood; a person who can glance at progress, or an engineer who can look in on someone else's run, does not have to interrupt it to find out whether it is stuck.

---

## Slice 4: Find a Saved Report After a Run Ends

**Status:** ✅ Complete — 2026-10-02 — `e4386b8`
**Tests:** ✅ Recorded — 2026-10-02 — `ebee7a8` — cli — 1 UAT + 3 AC, 2 skipped

**Delivers:** When `delivery run` or `delivery resume` ends, the report is saved as a plain-text file and a data file in a fixed place, and the run's last lines say what happened and where to read more.

**Operational note:** Every run and resume now leaves two files in the project's `.delivery` folder, replaced by the next run; they sit inside the folder that already keeps itself out of version control, are readable only by the user who ran the command, and are written whole or not at all. They are copies for convenience: every command still reads the record, never these files. This fixed pair is what a scheduled run will hand over in Item 13. A run whose report cannot be saved still ends with its normal outcome and exit code.

**Build note:** The files are written with the same write-then-rename discipline the record's own files use, not written in place.

### Prerequisites

- `delivery report` produces the plain-text report for a task list, a run of several tasks and a single task
- The read model behind the report can also be produced as a data document
- `delivery run` and `delivery resume` end by printing a closing line for the list

### Acceptance Criteria

- [ ] When `delivery run` or `delivery resume` ends, a text report and a data report for what was just run are saved at one fixed place in the project's `.delivery` folder, replacing any earlier pair
- [ ] The closing lines of `delivery run` and `delivery resume` state the headline sentence and point to `delivery report`
- [ ] The report's "For whoever tunes this" block names where the files were saved
- [ ] The saved text report is the same text `delivery report` prints, stands alone, contains no patches and no full triage text, and reads sensibly when pasted into a message or viewed as Markdown
- [ ] `delivery report --write`, with or without a run named, saves the pair for that subject
- [ ] If the files cannot be written, the run's outcome and exit code are unaffected, `delivery report` still prints, and one line says the file was not saved and why
- [ ] A run that crashes before saving leaves no partial file, and `delivery report` still answers from the record
- [ ] The saved files are never committed with the project's work

### UAT

**What you can now do:** Find the report of the last run waiting as a file, ready to read or forward, without running anything.

**How to try it:**
1. In the example project, run `delivery run` on a short list and read its final lines.
2. Open the `.delivery` folder and open `last-report.txt` in any text editor.
3. Compare it with what `delivery report` prints.
4. Paste the file's contents into a message to a colleague.

**What you should see:** The run ends with the one-sentence summary and a pointer to `delivery report`. The text file holds the same report, complete and readable on its own, with no terminal colour codes and no code patches.

**Why this matters:** An owner who was not there when the run ended, and later a schedule that runs with nobody there at all, both need the result to be somewhere known rather than scrolled off a terminal.

---

## Slice 5: Build Your Own Tools on Versioned Report Data

**Status:** ✅ Complete — 2026-10-02 — `6a6f4a7`
**Tests:** ✅ Recorded — 2026-10-03 — `9974cc1` — cli — 1 UAT + 6 AC, 5 skipped
**Delivers:** An extender gets everything the reports say as versioned data, as one document from `delivery report --json` and `delivery status --json` and as a stream of events from `delivery status --watch --json`, with a published schema and a stated promise about what will not change.

**Operational note:** The two data formats carry a version and a stability promise that the test suite enforces: a test fails if a published key disappears or changes type. The promise, and the fact that the older step-by-step output of `delivery run --json` is outside it, are stated in the project's documentation. The read model and schemas are part of the package's public library surface, which Items 13 and 14 will build on.

**Build note:** The published schema is generated from the same schema definitions that validate the data, using the validation library already in the project, so there is one source and no hand-written schema or second schema library. The event stream is versioned newline-delimited JSON with a start and an end marker, the convention `delivery run --json` already follows; no OpenTelemetry or other exporter is built, and no test-report format such as JUnit. Extension is by consuming these documents, not by a reporter plug-in interface.

### Prerequisites

- `delivery report`, `delivery status` (with its budgets and triage rounds) and `delivery status --watch` each render the same read model as text
- `delivery status --json` already prints a document for a single run and for a run of several tasks
- A data report is saved beside the text report when a run ends

### Acceptance Criteria

- [ ] `delivery report --json` and `delivery status --json` print one document that names its format and version, covering a task list, a run of several tasks or a single task; every key is always present, with an explicit empty value where it does not apply
- [ ] The document carries everything the text views say: counts by standing, each task's state history, attempts, retry budgets, every triage round with its reasoning and brief or packet, the recorded reason for a stop, the plain-language block with who must act, the escalation packet word for word, and whether the run is live, not live or not determinable
- [ ] Everything `delivery status --json` printed before this item is still there with the same names and meanings
- [ ] `delivery status --watch --json` prints one event per line: a first line announcing the stream and its version, one event per recorded step, and a final line saying how the subject ended; a list run one at a time is marked as having no run of its own
- [ ] Replaying a finished run produces exactly the events that watching it live produced
- [ ] `delivery report --schema` prints the schema for both formats, and every document and event the commands print is valid against it
- [ ] A document with an unexpected extra key is still accepted by the published schema, and the documentation tells consumers to ignore unknown keys and unknown values and not to parse sentences meant for people
- [ ] With `--json`, standard output holds only data, never colour or prose
- [ ] A damaged task record is marked in the document as making it incomplete, with the other tasks present
- [ ] The functions that load a record, derive the document, list its events and render it as text, with the schemas, are available to code that imports the package

### UAT

**What you can now do:** Feed a dashboard or a script from the harness's reports without scraping text, and know which parts are promised not to change.

**How to try it:**
1. In the example project, after a run with one stopped task, type `delivery report --json` and read the counts and the stopped task's entry.
2. Type `delivery report --schema` and find the same keys described there.
3. Start another run and, in a second terminal, type `delivery status --watch --json`.
4. Open the reporting page in the project's documentation and read the stability promise.

**What you should see:** The first command prints one structured document naming its version, with the stopped task carrying a reason code, who must act and its retry budgets. The schema describes that document. The watch prints one structured line per change, beginning with a stream-started line and ending with a stream-ended line. The documentation states what will never be removed within this version.

**Why this matters:** The roadmap promises adopters they can build their own dashboards and integrations; that only holds if the data has a version and a promise, rather than a shape that silently changes under them.

---

## Slice 6: See What a Repair Changed in Your Check

**Status:** ✅ Complete — 2026-10-03 — `51b8982`
**Tests:** ✅ Recorded — 2026-10-03 — `c9fe9ca` — cli — 1 UAT + 1 AC, 4 skipped
**Delivers:** When the harness repairs a broken check or shared setup, the report and status show which files that repair changed, flag a change to a file the check itself runs, and show the patch on request.

**Operational note:** From this slice on, each repair's changes are captured before the task carries on and kept with the run's record, up to a fixed size; this is the only newly recorded free text in this item, and it is as sensitive as the rest of the record. The capture only reads the working copy: it stages and commits nothing, so what a task finally lands is unchanged, and it happens whichever way the project lands work. This slice shows; it never approves, refuses or judges a repair.

**Build note:** The change is captured with git itself, through the harness's existing git wrapper, covering both edited files and newly added ones; no file-hashing or working-copy snapshot of its own. One capture serves both kinds of repair, a task's own and the run-wide one.

### Prerequisites

- The harness dispatches a repair when a check cannot run, for one task or for the shared environment of a run of several tasks, and records that the repair happened
- `delivery report` and `delivery status` render one read model as text, and `--json` prints it as a versioned document
- The text report saved when a run ends omits patches

### Acceptance Criteria

- [ ] `delivery status` shows one line per repair: which repair, how many files it changed, lines added and removed, and the file names
- [ ] A changed file that the project's check runs is marked as such on that line, in words that say the repair changed a file the check runs and nothing about whether the change was safe
- [ ] `delivery status --repairs` prints each repair's patch, including the full content of files the repair added
- [ ] `delivery report` gains a "Worth a look" section only when a repair changed a file the check runs, saying which task and file, that the report cannot tell whether the change was safe, and the command that shows it
- [ ] A patch larger than the fixed limit, or a binary file, is listed with its name and counts and a line saying the patch was too large to keep
- [ ] A repair that changed nothing reads "changed no files"; a repair recorded before this slice reads "what this repair changed was not recorded"
- [ ] A repair's changes are still shown for a task that later stopped and whose working copy was cleared away
- [ ] The data document lists each repair's files, counts, check-file marker and patch as recorded; the saved text report carries the summary line only
- [ ] A task's delivered work is exactly what it would have been without the capture
- [ ] No run is paused, refused or altered because of what a repair changed

### UAT

**What you can now do:** Find out what the harness changed when it repaired your check, instead of having that change vanish into the task's work.

**How to try it:**
1. In a copy of the shared-environment example project, run `delivery run` with the shared helper broken so that a repair is needed.
2. When the run ends, type `delivery report` and read the "Worth a look" section.
3. Run the `delivery status ... --repairs` command it names.
4. Read which file the repair changed and the patch beneath it.

**What you should see:** The report says a repair of the check changed a file the check runs, names the file and the task, and says plainly that it cannot tell you whether the change was safe. The status command lists the repair's changed files and shows the exact lines added and removed.

**Why this matters:** A repair is allowed to edit the very check that guards the work, so an owner who cannot see what it changed cannot know whether their check still means what they think it means.

---

## Slice 7: See How Long a Run Took and Roughly What It Cost

**Status:** ✅ Complete — 2026-10-03 — `1712f71`
**Tests:** ✅ Recorded — 2026-10-03 — `1712f71` — cli — 1 UAT + 2 AC, 3 skipped
**Delivers:** The report and status show the time and estimated cost of the agent sessions behind each task and the whole run, and always say how many sessions the figure covers.

**Operational note:** From this slice on each agent session's duration and estimated cost are recorded with the run; earlier runs read "not recorded". The scripted agent used by the test suite gains the ability to script a session's cost and duration, since it reports zero for both today; this is a small addition to the vendored mock that adopters' own scripted tests can use too.

**Build note:** The cost and duration are the figures the agent runtime itself reports for each session, labelled as an estimate; the harness does not count tokens or keep a price list of its own.

### Prerequisites

- `delivery report` has a "For whoever tunes this" block and `delivery status` shows per-task detail
- `--json` prints the read model as a versioned document
- Each agent session's end is recorded in the task's record

### Acceptance Criteria

- [ ] `delivery report` shows the estimated cost and total session time across the run, labelled as an estimate from the agent runtime
- [ ] `delivery status` shows the same per task, and the data document carries it per task and per run
- [ ] A figure covering only some sessions always says how many ("recorded for 13 of 14 agent sessions") and is never presented as the whole
- [ ] A run with nothing recorded reads "Time and cost were not recorded for this run"; nothing is ever shown as zero for lack of data
- [ ] Sessions of every kind count: the agent doing the task, a repair, and an agent-backed triage where one is configured
- [ ] Cost and duration are shown as information only: no run is stopped, slowed or changed because of them
- [ ] A scripted test can give a session a cost and a duration and see them in the report

### UAT

**What you can now do:** See what a list of tasks cost and how long the agent spent on it, with an honest statement of how complete that figure is.

**How to try it:**
1. In the example project, run a short list with `delivery run` and wait for it to finish.
2. Type `delivery report` and read the "Time and cost" line in the "For whoever tunes this" block.
3. Type `delivery status` for one of the tasks and read its time and cost.
4. Type `delivery report --json` and find the same figures for the run and for each task.

**What you should see:** The report gives an estimated cost and a total session time and says how many sessions they cover; the task's status gives its share, and the data document carries the same numbers. Nothing is shown as zero for lack of data.

**Why this matters:** "How much did that cost" is the first question an owner asks about unattended agent work; an estimate that states its own coverage earns more trust than none, or than a confident number that is quietly partial.

---
