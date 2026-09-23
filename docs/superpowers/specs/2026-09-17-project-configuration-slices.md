# Project Configuration — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-17-project-configuration-design.md`
> **Status:** ✅ Complete — 2026-09-23 — all 9 slices delivered
> Next step: invoke writing-plans with this document

**Audience note:** as with Item 8, this item's product surface is the `delivery` command and
the `delivery.config.json` file a project owner checks in, so the terminal and that file are
the product UI. UAT is written for a person using them (Dana or Priya from
`docs/personas.md`): editing the project's configuration file, typing a `delivery` command
and reading what it prints is using the product, not inspecting its internals. A real run
needs the Claude Code CLI and a sign-in on the demo machine; recorded regression tests route
the agent to the vendored `claude-mock` instead, so they need no network and no API key.
Checking and previewing a configuration need neither.

**Decided without a human (unattended run):** the slice boundaries below were chosen by the
autonomous run, not confirmed by a person. Order follows Dana's journey and dependency:
describe the project once and have agents hear it (the cheapest, highest-leverage step, and
the first new key in the file); then queue tasks in plain words and run them; then check a
configuration for free; then preview what agents will be told; then Priya's role overrides;
then the example project and unified guide, which need every MUST capability to exist; then
the three SHOULD-tier additions. The COULD tier (agent-driven onboarding, per-task metadata)
is not sliced.

---

## Slice 1: Describe Your Project Once and Every Agent Hears It

**Status:** ✅ Complete — 2026-09-17 — `4ba5827`
**Tests:** ✅ Recorded — 2026-09-17 — `c1351a8` — cli — 1 UAT + 4 AC, 1 skipped
**Delivers:** A project owner writes a sentence or two about their project in the checked-in configuration file, and every run from then on tells the agent that context, without retyping it per task.

**Build note:** Reuse the domain-prompt field the case file and prompt assembly already carry; this slice adds only a producer for it from the configuration file. Do not add a second route for getting project context into a prompt. Extend the existing configuration schema and its existing plain-language problem describer rather than adding a loader or an error-formatting library.

### Prerequisites

- The `delivery run` command reads a `delivery.config.json` and completes a single-task run
- Prompt assembly already places a run's pinned domain text ahead of each role's own instructions when that text is present

### Acceptance Criteria

- [ ] A configuration file may carry a project description as one plain prose value, alongside the existing task, gate, closer and limits
- [ ] A run started with a project description present pins that description into the run's record at the start, and the agent's instructions for that run include it, for the worker and for gate maintenance alike
- [ ] Resuming that run, or advancing it again, sends the agent the same instructions as before: editing the description in the file afterwards does not alter a run already started
- [ ] A configuration file with no project description behaves exactly as it did before this slice
- [ ] A project description that is empty or only whitespace stops the command with a plain-language message naming the field and the fix, and the configuration-problem exit code
- [ ] A long description can be supplied through the existing script form of the configuration file; no separate description file is read

### UAT

**What you can now do:** Tell the harness about your project once, in your own words, and have every agent start with that context.

**How to try it:**
1. In a copy of the sample project, open `delivery.config.json` (create it if there is none) and add a `domain` line describing the project, including one distinctive instruction such as "All user-facing messages are written in French."
2. Type `delivery run --task "add a function that greets a user by name, with a test"` and press Enter.
3. When the run finishes, open the branch it names and read the new function.
4. Remove the text inside the `domain` quotes so it is empty, run the same command again, and read the message.

**What you should see:** The finished work follows the distinctive instruction from your description (the greeting is in French). With the description emptied, the command stops at once with a short message saying the description is empty and to write a sentence or remove the line.

**Why this matters:** Project context stated once and applied everywhere is what turns a one-off command into a project setup, and it stops owners retyping the same background into every task.

---

## Slice 2: Queue Several Tasks in Plain Words and Run Them in Order

**Status:** ✅ Complete — 2026-09-17 — `65dea82`
**Tests:** ✅ Recorded — 2026-09-17 — `24bcc49` — cli — 1 UAT + 4 AC, 2 skipped
**Delivers:** A project owner lists the things they want done as plain sentences in the configuration file, and one `delivery run` works through them in order, picking up where it left off after an interruption or an edit to the list.

**Operational note:** Queue progress is never stored anywhere of its own; it is worked out afresh on every command from the records of the runs that already exist. There is no queue state file or lock to back up, migrate or repair, and a queue's history is inspected with the existing run listing.

**Build note:** The queue is an ordered list in the existing configuration file, not a queue engine or a second file. Turning a sentence into a task is a small deterministic step with no agent call. Which run answers for which entry is decided by comparing task content against existing run records, not by list position and not by a new field in the run record. The driver is a thin loop around the existing single-run start and resume; nothing inside the single-run machinery changes.

### Prerequisites

- A single-task run can be started and resumed from the command line, leaving one record per run in the repository
- Every run record keeps the task it was started with

### Acceptance Criteria

- [ ] A configuration file may carry an ordered list of tasks, each either a plain sentence or a task object with an intent and any extra fields, which pass through untouched
- [ ] `delivery run` with no task flag and a task list present runs the first task that has no finished run, then the next, one at a time, each as its own ordinary run
- [ ] Each task's progress is introduced by a "Task N of M" line with the owner's own wording, around the same plain-language step lines a single run already prints
- [ ] An explicit task flag still runs exactly one ad-hoc task and ignores the list
- [ ] After an interruption, `delivery run` again resumes the unfinished task and then continues down the list
- [ ] Inserting a new entry anywhere runs it in its place and does not disturb the others; reordering changes only the order of visiting; deleting a finished entry leaves its run in history; rewording an entry makes it a new task that runs, which is also how a finished task is deliberately run again
- [ ] "Task N of M" always reflects the list as currently written
- [ ] When a task's run escalates or is aborted, the list stops there, the message names that task and what is needed, and the exit code is the one a single escalated or aborted run already uses; running the command again stops at the same task rather than skipping past it
- [ ] When every listed task is closed, the command says so plainly, suggests adding more or reviewing what ran, and exits successfully
- [ ] A configuration carrying both a single task and a task list, an empty list, an empty entry, or two entries that are the same task is refused before anything runs, by every command that reads the file, with a plain-language message naming the entries and the fix
- [ ] `delivery status` for a run that answers a current list entry says which task of how many it is

### UAT

**What you can now do:** Write a short to-do list for your project in plain English and have the harness work through it, one verified piece of work at a time.

**How to try it:**
1. In a copy of the sample project, put three short sentences under `tasks` in `delivery.config.json`, each describing a small function to add with a test.
2. Type `delivery run` and press Enter; while the second task is running, press Ctrl+C to interrupt it.
3. Type `delivery run` again and watch where it picks up.
4. When it finishes, add a new sentence at the top of the list, reword the last one slightly, and type `delivery run` once more.
5. Type `delivery run` a final time.

**What you should see:** The first run announces "Task 1 of 3", then "Task 2 of 3". After the interruption, the second run does not redo task 1; it carries on with task 2, then task 3, each ending with a sentence naming its branch. After your edits, only the new top entry and the reworded entry run, framed as tasks "of 4". The final command says every queued task is done.

**Why this matters:** A real project is more than one task; a list that survives interruptions and everyday edits is what makes the harness something an owner can leave working.

---

## Slice 3: Check Your Setup for Free Before Spending Anything

**Status:** ✅ Complete — 2026-09-22 — `727b5d5`
**Tests:** ✅ Recorded — 2026-09-22 — `a8d05b5` — cli — 1 UAT + 7 AC, 0 skipped
**Delivers:** A project owner types `delivery validate` and learns, offline and with no agent involved, either that their configuration is ready to run or the one thing to fix.

**Operational note:** This command needs no Claude Code executable, no sign-in and no network, and it never sets anything up or changes anything on disk. It is safe to run in CI on every push, and safe to run while a run is in progress.

**Build note:** Compose checks the estate already has: the configuration loader, the existing role-configuration validator, and the existing "load but do not run" check for custom gate and closer modules. Failures go through the existing plain-language problem describer, extended; do not add a generic validation-error library.

### Prerequisites

- A configuration file can carry a project description and a task list, and problems with them are already refused at load with plain-language messages
- Custom gate and closer modules can already be loaded without being run

### Acceptance Criteria

- [ ] `delivery validate` on a complete configuration prints one plain line per thing it checked (the description, how many tasks are queued, what the check runs, what the closing action does) and ends with "Ready to run", exiting successfully
- [ ] On a configuration with a problem it prints one problem, naming the field and the fix in everyday words with no schema vocabulary, and exits with the configuration-problem code
- [ ] It reports every refusal from the earlier slices (empty description, empty list, empty entry, duplicate entries, both single task and list) and also a custom gate or closer module that cannot be loaded
- [ ] With no configuration file it says none was found and points to `delivery init` and the getting-started guide
- [ ] It succeeds on a machine with no Claude Code executable and no sign-in, and leaves the repository and its run records untouched
- [ ] It accepts the same options for naming the configuration file and the repository that `delivery run` does
- [ ] An existing four-key configuration from before this phase validates cleanly

### UAT

**What you can now do:** Find out in a second, at no cost, whether your project setup is complete, and be told exactly what to fix if it is not.

**How to try it:**
1. In a project with a description, three tasks, a check and a closing action in `delivery.config.json`, type `delivery validate`.
2. Replace the second task's sentence with empty quotes and type `delivery validate` again.
3. Put the sentence back, copy the first task's sentence over the third so two are identical, and type `delivery validate` again.
4. Restore the file and type `delivery validate` once more.

**What you should see:** First a short list of ticks ending "Ready to run". Then a single line saying item 2 of your tasks is empty and to add a sentence or remove it. Then a single line saying tasks 1 and 3 are the same and to reword or remove one. Finally the ticks again. At no point does anything start running.

**Why this matters:** Catching a broken setup before a run starts saves agent spend and, more importantly, saves an owner from discovering a typo an hour into an unattended run.

---

## Slice 4: See Exactly What the Agent Will Be Told

**Status:** ✅ Complete — 2026-09-22 — `997d56d`
**Tests:** ✅ Recorded — 2026-09-22 — `8fc8d82` — cli — 1 UAT + 6 AC, 0 skipped

**Delivers:** A project owner types `delivery preview` and reads the exact instructions the agent would receive for a queued task, with their project description in place, before any run starts.

**Operational note:** Like `validate`, this command needs no agent runtime or sign-in, writes nothing, and is safe alongside an active run. Its truthfulness is protected by a regression test that compares what it prints with what a real run actually sends to the scripted agent.

**Build note:** Preview must call the library's own prompt assembly on a stand-in run record; it must not contain a second renderer of the prompt. That is the whole guarantee that what is previewed is what is sent.

### Prerequisites

- A configuration file can carry a project description and a task list
- Runs started from the configuration pin the project description so that the agent's instructions include it

### Acceptance Criteria

- [ ] `delivery preview` names the next task the queue would run, then prints the worker's instructions for it exactly as a run would send them, including the project description and the task in the owner's words
- [ ] Below the instructions it lists what the agent may do in everyday phrases ("read files", "edit files", "run commands"); a tool with no everyday phrase is printed as written
- [ ] An option selects a particular task by its number as shown in "Task N of M"; an option selects the gate-maintenance role instead of the worker
- [ ] A number beyond the end of the list is refused with a message saying how many tasks there are
- [ ] For a configuration with a single task rather than a list it previews that task and refuses a task number; with no task at all it gives the same "no task" message `delivery run` gives
- [ ] Any configuration problem produces the same single plain-language message `delivery validate` would give
- [ ] The instructions shown for a task are identical to those a real run of that task sends on its first dispatch
- [ ] None of the output uses harness vocabulary such as "worktree", "envelope", "surface" or "role config"

### UAT

**What you can now do:** Read, before anything runs, precisely what the agent will be told about your project and your task.

**How to try it:**
1. In a project whose `delivery.config.json` has a description and three tasks, type `delivery preview`.
2. Change a few words of the description in the file and type `delivery preview` again.
3. Type `delivery preview --queue-index 3`, then `delivery preview --queue-index 9`.

**What you should see:** A framed block of instructions containing your description word for word and your first task's sentence, followed by a plain list of what the agent may do. After your edit, the block shows the new wording. The third command shows the third task's sentence instead; the last says there is no task 9 and that your queue has 3.

**Why this matters:** Owners trust what they can inspect; seeing the agent's brief in advance turns the project description from a hopeful note into something they can tune deliberately.

---

## Slice 5: Tune a Role's Instructions and Tools From the Configuration File

**Status:** ✅ Complete — 2026-09-22 — `5bd1868`
**Tests:** ✅ Recorded — 2026-09-22 — `4d5dabe` — cli — 1 UAT + 7 AC, 1 skipped
**Delivers:** An extender changes what the worker or gate-maintenance agent is told, and which tools it may use, by editing the configuration file rather than writing and importing code, and can check and preview the result before a run.

**Operational note:** A misspelled tool name is not caught by `validate`; it shows up during a run as that tool being refused. The role guide must say so plainly so extenders know where to look.

**Build note:** Merge the file's overrides over the shipped role configurations and pass the result through the existing role-configuration validator; do not write a parallel validator, and do not invent a list of valid tool names. What a role can actually do remains bounded by the existing tool-authority enforcement whatever the file lists.

### Prerequisites

- `delivery validate` and `delivery preview` exist and read the project configuration
- Runs started from the command line use the shipped worker and gate-maintenance role configurations

### Acceptance Criteria

- [ ] A configuration file may override, for the worker and for gate maintenance separately, the role's instructions and its list of permitted tools; anything not overridden keeps its shipped value
- [ ] Runs started from that configuration, whether a single task or a list, use the overridden roles; triage is unaffected and cannot be overridden from the file
- [ ] `delivery preview` shows the overridden instructions and the overridden permitted-tools list for the chosen role
- [ ] `delivery validate` refuses an override naming an unknown role, an unknown field, empty instructions, or an empty tools list, each with a plain-language message naming the field and offering "remove it to keep the built-in one"
- [ ] A tool the file does not permit is refused to the agent during a run exactly as the shipped tool enforcement already refuses tools
- [ ] A configuration with no overrides behaves exactly as before this slice
- [ ] The role guide documents the override keys and states that misspelled tool names surface at run time, not in `validate`

### UAT

**What you can now do:** Sharpen what an agent is told, or narrow what it may touch, for your project, by editing one file.

**How to try it:**
1. In a project with a working configuration, add a `roles` section giving the worker the instruction "Never modify anything under the ops folder." and a tools list without `Bash`.
2. Type `delivery validate`, then `delivery preview`.
3. Empty the instruction's quotes and type `delivery validate` again.

**What you should see:** Validation passes; the preview's instructions now begin with your sentence and the list of what the agent may do no longer includes running commands. With the instruction emptied, a single line says the worker's instructions are empty and to write a sentence or remove the field to keep the built-in one.

**Why this matters:** Extenders get real control over agent behaviour without forking code, and the change is reviewable in the same pull request as the project it governs.

---

## Slice 6: Set Up a Whole Project by Following One Guide

**Status:** ✅ Complete — 2026-09-22 — `db78ca75fa2f0ca78b1ca2a5f43632fda20ec22b`
**Tests:** ✅ Recorded — 2026-09-22 — `db78ca75fa2f0ca78b1ca2a5f43632fda20ec22b` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** A new adopter follows a single project-configuration guide, working in a complete example project that ships with the harness, from an empty configuration to a checked, previewed and completed queue, with the gate, closer and role guides linked as chapters.

**Operational note:** The guide is executed by a regression test that runs its own commands against the built command and the example project with the scripted agent, so the documentation cannot drift from the tool. The existing sample project is left exactly as it is, because the getting-started guide and its test depend on it as the no-configuration first run. This phase ships as a minor version with a changelog entry: it only adds surface.

**Build note:** Follow the estate's "one fixture, one guide, one test" convention from the getting-started guide. Link to the existing gate, closer and role guides as chapters; do not copy their content into the new guide.

### Prerequisites

- A configuration file can carry a project description, a task list and role overrides
- `delivery validate`, `delivery preview` and queue-driving `delivery run` all work
- The getting-started guide, the gate guide, the closer guide and the role guide exist

### Acceptance Criteria

- [ ] A second example project ships with the harness, with a checked-in configuration that uses a project description, a list of at least two tasks and one worker override
- [ ] In that example, `delivery validate` passes, `delivery preview` shows the description inside the instructions, and `delivery run` closes every listed task in order
- [ ] A project-configuration guide takes a reader through describing a project, listing tasks, choosing a built-in check and closing action, validating, previewing, running the list, and editing the list afterwards, using only prose and built-in components
- [ ] The guide's declarative walkthrough uses none of the harness's internal vocabulary, and sends extenders to the gate, closer and role guides for custom modules and overrides
- [ ] The getting-started guide points to the new guide as the next step, and the existing sample project and its guide still work unchanged
- [ ] Following the guide's commands exactly, as written, produces the output the guide shows
- [ ] The changelog records the new commands and configuration keys as an additive release

### UAT

**What you can now do:** Go from "I have a project" to "my queue of tasks is done and verified" by following one document, without reading any source code.

**How to try it:**
1. Open the project-configuration guide from the harness's documentation and the example project it names.
2. Follow the guide step by step, typing each command it shows: check the setup, preview the first task, then run the list.
3. Follow its final section: add one more task to the list in your own words and run again.

**What you should see:** Each command prints what the guide says it will: the ticks and "Ready to run", the framed instructions with the example's description, "Task 1 of 2" then "Task 2 of 2" each ending with a branch name, and finally just your added task running as "Task 3 of 3".

**Why this matters:** The guide is the adoption path for the non-technical owner this roadmap item exists for; a guide proven by its own test is one that still works when they arrive.

---

## Slice 7: Let the Setup Wizard Ask About Your Project and Tasks

**Status:** ✅ Complete — 2026-09-23 — `d583e21`
**Tests:** ✅ Recorded — 2026-09-23 — `f6ccf21` — cli — 1 UAT + 4 AC, 0 skipped
**Delivers:** A project owner running `delivery init` is also asked to describe their project and to list their first few tasks, and gets a configuration file with those filled in.

**Build note:** Extend the existing wizard and its existing prompt library; do not add another.

### Prerequisites

- `delivery init` already asks for a check, a closing action and a first task and writes a configuration file
- A configuration file can carry a project description and a task list

### Acceptance Criteria

- [ ] The wizard asks for a short project description, which may be skipped
- [ ] The wizard asks for tasks one at a time until the owner stops; one task or several are written as a task list
- [ ] The file it writes passes `delivery validate` and can be run immediately
- [ ] The wizard's questions use everyday words and none of the harness's internal vocabulary
- [ ] Declining to overwrite an existing configuration file leaves it untouched, as today

### UAT

**What you can now do:** Set up a whole small project by answering questions, never opening the configuration file yourself.

**How to try it:**
1. In a fresh copy of the sample project, type `delivery init`.
2. Answer the questions: describe the project in a sentence, accept the suggested check and closing action, and enter two tasks.
3. Type `delivery validate`, then `delivery preview`.

**What you should see:** The wizard finishes by saying it wrote your configuration. Validation shows the ticks with "2 tasks queued", and the preview shows your sentence inside the instructions for your first task.

**Why this matters:** The owner this item serves should never have to hand-write a configuration file to get started.

---

## Slice 8: Pick a Ready-Made Check by Name

**Status:** ✅ Complete — 2026-09-23 — `4025477`
**Tests:** ✅ Recorded — 2026-09-23 — `e090bae` — cli — 1 UAT + 5 AC, 0 skipped
**Delivers:** A project owner chooses how their work is checked by naming a ready-made check (run the tests, a file exists, a command succeeds, a file matches a schema) instead of writing out a gate definition.

**Build note:** Presets are names that resolve to the existing gate definitions; they add no new gate machinery and no change to what a run record stores.

### Prerequisites

- The configuration file's check entry accepts the existing built-in gate definitions
- `delivery validate` summarises the configured check in plain words

### Acceptance Criteria

- [ ] The check may be given as one of four preset names (`test-runner`, `file-exists`, `command-succeeds`, `schema-validates`) with only the detail that preset needs
- [ ] A run using a preset behaves exactly as a run using the equivalent written-out gate definition
- [ ] `delivery validate` describes a preset check in plain words, and refuses an unknown preset name or a preset missing its one needed detail with a message listing the valid names or naming the missing detail
- [ ] Existing written-out gate definitions keep working unchanged
- [ ] The project-configuration guide shows a preset as the simplest way to choose a check

### UAT

**What you can now do:** Say how your work should be checked in a word, not a block of settings.

**How to try it:**
1. In a project configuration, replace the check with the `file-exists` preset naming a file that does not exist yet, such as `CHANGES.md`.
2. Type `delivery validate`.
3. Type `delivery run --task "create a CHANGES.md file with a one-line summary of this project"`.
4. Misspell the preset name and type `delivery validate` again.

**What you should see:** Validation describes the check as "checks that CHANGES.md exists". The run finishes with the work on a branch containing the new file. With the misspelling, a single line lists the four valid names.

**Why this matters:** Choosing acceptance criteria by name is the roadmap's own bar for a non-technical owner selecting a gate.

---

## Slice 9: Get Every Configuration Problem at Once, in a Form Scripts Can Read

**Status:** ✅ Complete — 2026-09-23 — `2c51dac`
**Tests:** ✅ Recorded — 2026-09-23 — `98e6efa` — cli — 1 UAT + 3 AC, 0 skipped
**Delivers:** Someone wiring the harness into CI runs `delivery validate --json` and receives every problem in the configuration in one machine-readable result, rather than one problem per attempt.

**Build note:** Follow the existing `--json` convention on `run` and `status`. If an editor schema for the configuration file is offered alongside, generate it with the schema library's built-in JSON Schema output, which the estate already uses; add no dependency.

### Prerequisites

- `delivery validate` reports the first configuration problem in plain language
- `delivery run` and `delivery status` already offer a `--json` form

### Acceptance Criteria

- [ ] With `--json`, `delivery validate` prints one machine-readable result saying whether the configuration is ready and listing every problem found, each with the field it concerns and the same plain-language message the human form gives
- [ ] The exit codes are the same as without `--json`
- [ ] Without `--json`, behaviour is unchanged: one problem, plain language
- [ ] A clean configuration yields a ready result with an empty problem list

### UAT

**What you can now do:** Have your CI tell you everything wrong with a project configuration in one pass.

**How to try it:**
1. In a project configuration, make two mistakes at once: empty the project description and empty the second task.
2. Type `delivery validate` and note that one problem is shown.
3. Type `delivery validate --json`.

**What you should see:** The plain form shows a single problem. The `--json` form shows a result marked not ready that lists both problems, each naming its field with the same wording as the plain form.

**Why this matters:** Teams that gate merges on a valid configuration need the full list in one run, not a fix-and-retry loop.

---
