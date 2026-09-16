# CLI and Configuration — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** this item's product surface is the `delivery` command itself, so the
terminal is the product UI. UAT is written for a person using that command (Dana, Priya or
Marcus from `docs/personas.md`): typing a `delivery` command and reading what it prints is
using the product, not inspecting its internals. A real run needs the Claude Code CLI and a
sign-in on the demo machine; recorded regression tests route the agent to the vendored
`claude-mock` instead, so they need no network and no API key.

**Decided without a human (unattended run):** the slice boundaries below were chosen by the
autonomous run, not confirmed by a person. Order follows the personas' journeys and
dependency: Dana's first run with defaults first (the adoption floor, and the run loop every
later slice reuses), then Priya's own configuration, then resuming an interrupted run, then
reading a finished run later, then installing the published-shape package and following the
guide, then the two SHOULD-tier additions. The COULD tier (`doctor`, shell completion, a
public rehearsal mode) is not sliced.

---

## Slice 1: Run a Task From the Command Line With Nothing Configured

**Status:** ✅ Complete — 2026-09-15 — `6c490c9`
**Tests:** ✅ Recorded — 2026-09-15 — `38d3aa5` — cli — 2 UAT + 13 AC, 1 skipped
**Delivers:** A person inside a git repository with a test script can type one `delivery run` command with a task description and get a finished run, with plain-language progress and a plain-language outcome, without writing any configuration or code.

**Operational note:** This slice introduces a compiled build of the harness with a runnable `delivery` command, and a regression harness that drives the compiled command against scratch repositories with the agent routed to the vendored scripted agent through a contributor-only test seam (documented for contributors, never shown in the command's help). CI must build before those tests run. Runs keep their record inside the repository in a self-ignoring folder and their working copy outside the repository under the user's state directory, following the estate's autoloop convention.

**Build note:** Compile with the TypeScript compiler already in the project, following the vendored claude-mock package's precedent; no bundler. Use commander for argument parsing and help. Terminal progress is a small line renderer, not ora or listr2. The default budget set is the literal the demos already share, lifted once into an exported library constant rather than invented.

### Prerequisites

- The single-surface run loop, built-in gates and closers, the SDK-backed agent port and the deterministic router exist as library functions
- The vendored scripted agent and its session environment helper are available to tests

### Acceptance Criteria

- [ ] In a clean git repository whose package has a test script, running with only a task description starts a run using the test script as the check, commits the work to a branch without touching the base branch, and finishes
- [ ] While running, the command prints one plain-language line per step ("setting up", "the agent is working", "checking the agent's work", and so on) and never prints a raw internal state name
- [ ] A closed run ends with a sentence naming what was done and the branch it is on, and the command exits with the "closed" code
- [ ] An escalated run ends by leading with the plain-language decision being asked of a human, and exits with the distinct "escalated" code; an aborted run exits with the distinct "aborted" code
- [ ] Before anything is set up, a missing Claude Code executable or a missing sign-in stops the command with a message naming which one and how to fix it, with the "agent runtime" exit code, and nothing is left behind in the repository
- [ ] Running outside a git repository, or in one with no test script and no gate given, stops with a plain-language message naming the one missing thing and the "configuration" exit code
- [ ] Uncommitted changes in the repository produce a plain-language note that the agent works from the last commit, and the run proceeds
- [ ] Starting a run does not change anything the user's `git status` reports: the run's record folder ignores itself, and the working copy lives outside the repository
- [ ] Every known harness error reaches the terminal as its plain-language rendering and mapped exit code, never as a stack trace; an unrecognised failure prints its message with an honest "this is unexpected, please file an issue" footer
- [ ] Colour is never the only carrier of meaning, and no colour is printed when `NO_COLOR` is set, `--no-color` is passed, or output is not a terminal
- [ ] `delivery --help` and `delivery run --help` describe the command; `delivery --version` prints the package version
- [ ] A sample project ships with the harness: a small git-ready project with a trivial test script that a first run can target

### UAT

**What you can now do:** Hand the harness a task in plain English from the command line and get the work done on a branch, with nothing to configure.

**How to try it:**
1. Open a terminal in a copy of the sample project that ships with the harness, with the Claude Code CLI installed and signed in.
2. Type `delivery run --task "add a function that says hello to a name, with a test"` and press Enter.
3. Watch the lines that appear as the run progresses.
4. When it finishes, read the final message and note the branch name it gives.
5. Now try the same command from a folder that is not a git repository, and read the message.

**What you should see:** Progress lines in plain English, a closing sentence saying the work is done and naming a branch, and that branch listed when you look at the project's branches. From the non-repository folder, a short message explaining the folder needs to be a git repository and how to fix that, with no stack trace.

**Why this matters:** This is the adoption floor: a project owner who is not an engineer gets verified work from one command, without learning the harness's internals.

---

## Slice 2: Choose Your Own Check, Closing Action and Limits

**Status:** ✅ Complete — 2026-09-15 — `a55de17`
**Tests:** ✅ Recorded — 2026-09-15 — `a4f8f1f` — cli — 1 UAT + 8 AC, 1 skipped
**Delivers:** An extender can name their own gate, closer and attempt limits, either in a `delivery.config.json` checked into their repository or as flags and environment variables for a single run, including their own custom gate and closer modules.

**Build note:** Validate the configuration with the zod schemas the library already defines for tasks, gates and closers, composed rather than re-described. Find and load the config file with the standard library (walk up to the repository root); do not add a multi-format config loader.

### Prerequisites

- A person can start a run from the command line with defaults and see plain-language progress and outcomes
- Custom gate and closer modules can be loaded by the library from a local path

### Acceptance Criteria

- [ ] A `delivery.config.json` (or `.js` / `.mjs`) at or above the working folder, up to the repository root, is found and used without being named; `--config` or `DELIVERY_CONFIG` names a different file
- [ ] The config file accepts exactly `task`, `gate`, `closer` and `budgets`; `gate` and `closer` take the same shapes the library already documents, including custom modules
- [ ] `budgets` accepts a whole-number cap per attempt category; unset categories keep their defaults
- [ ] `--gate-command` sets a pass/fail-by-exit-code check; `--closer` selects `commit-to-branch`, `merge-back` or `open-pr`; `--task-file` reads the task from a file
- [ ] A flag beats its environment variable (`DELIVERY_TASK`, `DELIVERY_GATE_COMMAND`, `DELIVERY_CLOSER`), which beats the config file, which beats the default
- [ ] An unknown key in the config file, or a malformed value, stops the command naming the key or value in plain language, with the "configuration" exit code
- [ ] An unknown closer type stops the command listing the built-in options and how to point at a custom one
- [ ] A custom gate or closer that cannot be loaded, or does not export what its contract needs, stops the command naming the module path and the guide that describes the contract, with no stack trace

### UAT

**What you can now do:** Tell the harness how to check and deliver work on your project once, in a file that lives with your code, and override it for a single run when you need to.

**How to try it:**
1. In the sample project, create `delivery.config.json` naming the `merge-back` closer and a correction limit of 5.
2. Run `delivery run --task "add a function that says goodbye to a name, with a test"` and wait for it to finish.
3. Read the closing message: it should say the work landed on the project's main branch rather than a separate branch.
4. Change the closer in the file to `teleport` and run the same command again.
5. Run once more with the file restored but with `--closer commit-to-branch` added, and read the closing message.

**What you should see:** The first run's work merged into the main branch as the file asked. The misspelt closer stops at once with a message listing the valid choices. The flag overrides the file, so the last run's work sits on its own branch.

**Why this matters:** Extenders configure their pipeline once, alongside their code, without writing glue, and the same file is the base that project configuration (Item 9) later extends.

---

## Slice 3: Pick Up a Run That Was Interrupted

**Status:** ✅ Complete — 2026-09-16 — `c064b18`
**Tests:** ✅ Recorded — 2026-09-16 — `baedef8` — cli — 1 UAT + 5 AC, 0 skipped
**Delivers:** If a run is interrupted (the terminal closed, the machine restarted, Ctrl-C), the person runs the same command again, or `delivery resume`, and the run carries on from where it stopped instead of starting over.

### Prerequisites

- A person can start a run from the command line and each run keeps its record inside the repository
- Runs are identified by a generated run id printed when they start

### Acceptance Criteria

- [ ] Re-running `delivery run` with no task, or with the same task, when one unfinished run exists resumes it and says in plain language what it is picking up ("picking up where it left off: checking the agent's work")
- [ ] When the resumed run had to put something right, that explanation is printed
- [ ] `delivery resume` resumes without ever starting a new run, accepts a run id or `--last` (the most recently touched unfinished run), and says plainly when there is nothing to resume
- [ ] Re-running with a different task while an unfinished run exists stops, names the unfinished run (start time and task) and offers `delivery resume` or `--fresh`; `--fresh` starts the new run and leaves the old one resumable
- [ ] With several unfinished runs and no run id, an interactive terminal lists them (run id, start time, task) and asks which to resume; a non-interactive one prints the list and stops with the "configuration" exit code
- [ ] A resumed run keeps the gate, closer and task it started with; flags that conflict produce a note naming what was ignored
- [ ] Re-running a task whose earlier run already finished starts a new run rather than reopening the finished one
- [ ] A run record that cannot be read back produces a plain-language message naming the folder and that removing it starts afresh

### UAT

**What you can now do:** Stop worrying about interruptions: an interrupted run finishes when you run the command again.

**How to try it:**
1. In the sample project, start `delivery run --task "add a function that reverses a word, with a test"`.
2. As soon as the line saying the agent is working appears, press Ctrl-C.
3. Run `delivery run` again with no task.
4. Read the first line it prints, then let it finish.
5. Start a new task, interrupt it the same way, then run `delivery run --task "something different"` and read the message.

**What you should see:** The second command says it is picking up the interrupted run rather than starting over, and finishes it, naming its branch. The different task is refused with a message naming the unfinished run and how to resume it or start fresh.

**Why this matters:** Long unattended runs survive real-world interruptions, and nobody has to remember where a run's record lives to recover it.

---

## Slice 4: See What Happened to a Run After the Fact

**Status:** ✅ Complete — 2026-09-16 — `f802401`
**Tests:** ✅ Recorded — 2026-09-16 — `8405fa7` — cli — 1 UAT + 5 AC, 0 skipped

**Delivers:** Someone who was not watching when a run ended can type `delivery status` in the repository and read the outcome, and for an escalated run the full escalation packet, in plain language.

### Prerequisites

- Runs keep their record inside the repository, identified by a run id
- A run can finish closed, escalated or aborted, and an escalated run records an escalation packet

### Acceptance Criteria

- [ ] `delivery status --last` and `delivery status <run-id>` read a run without changing it
- [ ] For an unfinished run, it prints in plain language what will happen next when it resumes
- [ ] For a closed run, it prints the outcome sentence, when it finished and the branch the work is on
- [ ] For an escalated run, it leads with the packet's plain-language decision, then prints the evidence, what was already tried, why now, and the references verbatim, followed by where the retained branch and working copy are
- [ ] For an aborted run, it prints the reason in plain language
- [ ] A run id that does not exist, or a repository with no runs, produces a plain-language message suggesting how to start one, with the "configuration" exit code

### UAT

**What you can now do:** Find out what happened to a run, including exactly what decision it needs from you, without having watched it.

**How to try it:**
1. In the sample project, run a task the agent cannot complete without a human decision, such as `delivery run --task "delete the existing greeting function and everything that uses it"`, wait for it to end, then close the terminal.
2. Open a new terminal in the sample project.
3. Type `delivery status --last` and press Enter.
4. Read the output from the top.

**What you should see:** A plain-English statement of the decision the run needs from a person at the top, followed by the evidence from the failed checks quoted exactly, what the agent already tried, and where its work was kept for inspection.

**Why this matters:** Escalations are only useful if the person who must act on them can read them later; this is how on-call engineers and project owners get that handoff.

---

## Slice 5: Install the Harness Like Any Other Tool and Follow the Guide

**Status:** ✅ Complete — 2026-09-16 — `7bdfff8`
**Delivers:** A newcomer installs the harness as a package, follows `docs/getting-started.md` from a fresh folder to a finished run against the sample project, and the package is ready to publish the moment a licence is chosen.

**Operational note:** This slice changes how the harness is released and verified. CI gains three checks: the getting-started guide executed as a test against the built command and the sample project (the agent routed to the scripted agent, as the testing guide's own test already does), an install from a locally packed copy with the installed command run, and a publish dry-run. A release job versions the package and writes the changelog from changeset entries on merges to the main branch; its publish step stays disabled, and no licence field is added, until a human chooses a licence. Contributors gain a step for describing their change in a changeset.

**Build note:** Use changesets for versioning and the changelog, which suits the project's prose commit messages; not semantic-release or release-please. Keep the TypeScript compiler as the only build tool.

### Prerequisites

- The `delivery` command can run, resume and report on runs against a repository
- The sample project exists and a first run against it succeeds with defaults

### Acceptance Criteria

- [ ] The package exposes the `delivery` command, the library as its main import and the testing API as a separate import, and ships only its built output, readme and changelog
- [ ] Installing from a packed copy into an empty folder gives a working `delivery` command, and running it through `npx` without installing works too
- [ ] `docs/getting-started.md` takes a reader from install to a finished run against the sample project, and a test runs its instructions and fails if the documented output no longer appears
- [ ] The existing guides no longer say the harness is unpublished and show imports from the package name
- [ ] The version starts at 0.1.0, `CHANGELOG.md` exists in Keep a Changelog form, and contributors are told how to add a changeset
- [ ] A publish dry-run succeeds; the actual publish step is disabled and the package declares no licence

### UAT

**What you can now do:** Install the harness from its package and get from nothing to a finished run by following one guide.

**How to try it:**
1. Open `docs/getting-started.md` and, in a new empty folder, follow its install step using the packed copy of the harness.
2. Type `delivery --version` and note the number.
3. Continue through the guide's steps against the sample project until the guide says the run is finished.
4. Open `CHANGELOG.md` and read the latest entry.

**What you should see:** The version prints as 0.1.0, every guide step produces what the guide says it will, the run finishes with its branch named, and the changelog describes the release in plain sentences.

**Why this matters:** This turns the harness from a code library into a tool people can adopt, and keeps the guide honest because it is tested against the real command.

---

## Slice 6: Script Against Runs With Machine-Readable Output

**Delivers:** An engineer can list every run in a repository and get run progress and status as JSON, so scripts and CI steps can act on outcomes without parsing prose.

### Prerequisites

- The `delivery` command reports progress while running and can report any single run's status
- Distinct exit codes exist for closed, escalated, aborted, configuration, agent-runtime and unexpected outcomes

### Acceptance Criteria

- [ ] `delivery run --json` prints one JSON object per step (state, whether done, any recovery note, timestamp) instead of the plain-language lines, with the same exit codes
- [ ] `delivery status --json` prints the same information as the plain-language status, as one JSON document, including the escalation packet fields for an escalated run
- [ ] `delivery status --all` lists every run in the repository with run id, task, start time and outcome (or "unfinished"), newest first, in plain language or JSON
- [ ] Without `--json`, output is plain-language lines in every environment, including when piped or run in CI

### UAT

**What you can now do:** See every run in a project at a glance, and feed run results into your own scripts.

**How to try it:**
1. In the sample project, after a few runs from earlier slices, type `delivery status --all`.
2. Read the list of runs and their outcomes.
3. Type `delivery status --last --json` and read the output.
4. Start a new run with `--json` added and watch the output.

**What you should see:** A list of every run with its task and whether it closed, escalated, aborted or is unfinished; then the latest run's details as structured JSON; then one structured record per step of the new run.

**Why this matters:** Teams wrapping the harness in CI or checking many runs need outcomes they can act on automatically, not text to scrape.

---

## Slice 7: Set Up a Project by Answering a Few Questions

**Delivers:** A project owner types `delivery init` and answers prompts for the check, the closing action and a first task, and gets a `delivery.config.json` that the next `delivery run` uses.

**Build note:** Use @inquirer/prompts for the prompts, following the estate precedent of autoloop's setup wizard; not @clack/prompts or a hand-rolled prompt loop.

### Prerequisites

- The `delivery` command reads a `delivery.config.json` from the repository
- Default gate inference from the project's test script exists

### Acceptance Criteria

- [ ] `delivery init` offers the inferred test command as the check when one exists, or asks for a command when none does
- [ ] It offers the three built-in closing actions with a one-line plain-language description of each, defaulting to committing to a branch
- [ ] It asks for a first task in plain language and writes a config file containing the chosen check, closer and task
- [ ] When a config file already exists, it asks before overwriting and leaves the file untouched if declined
- [ ] Run outside an interactive terminal, it stops with a plain-language message saying it needs one
- [ ] A `delivery run` with no flags afterwards uses the written file

### UAT

**What you can now do:** Set up a project for the harness by answering questions instead of writing a file.

**How to try it:**
1. In a fresh copy of the sample project, type `delivery init`.
2. Accept the suggested check, choose "commit to a branch", and type a first task.
3. Open the `delivery.config.json` it created and read it.
4. Type `delivery run` with nothing else and let it finish.

**What you should see:** Three short questions in plain English, a config file containing exactly your answers, and a run that uses them and finishes with its branch named.

**Why this matters:** A non-technical owner can set up a project confidently without knowing the configuration format.
