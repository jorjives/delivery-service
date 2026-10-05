# Pre-Built Task Packs — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-03-task-packs-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** as with Items 8 to 11, this item's product surface is the `delivery` command,
so the terminal is the product UI. UAT is written for a person using it (Dana, Marcus or Priya
from `docs/personas.md`): typing a `delivery` command and reading what it prints is using the
product. A real review needs the Claude Code CLI and a sign-in on the demo machine; recorded
regression tests route the agent to the vendored `claude-mock` instead. The example repository
with planted flaws that ships with this item is the demo project for every UAT below.

**Decided without a human (unattended run):** the slice boundaries were chosen by the autonomous
run, not confirmed by a person. Order follows the spec's journeys and dependency: first the
owner's first review (the "what can this do for me right now?" moment, and the slice that
establishes the pack format, the read-only scan and the review record every later slice reads);
then choosing problems and having them fixed through the existing queue; then the
anti-weakening guarantee, the roadmap's central promise, as its own slice so it is proved
adversarially rather than buried; then the security review with sign-off, which needs the fix
path and the guards; then the return to the report, placed after sign-off so it shows every
owner-facing state; then the project with no tests, which reuses the hold; then pack authoring
for Priya, placed after the two built-in packs so the format it checks has been exercised by
both. The three SHOULD slices follow. Degraded states are acceptance criteria of the slice whose
surface first meets them. The COULD tier (third-party discovery, SARIF and detector ingest,
agent-written change summaries, `packs new`, HTML findings, more packs, stronger check kinds) is
not sliced.

---

## Slice 1: Ask for a Code Review and Read the Problems in Plain Words

**Status:** ✅ Complete — 2026-10-05 — `a33c530`

**Delivers:** A project owner with no configuration file types `delivery review code` and reads a numbered list of problems in her project, each with where it is, what is wrong, why it matters, what fixed looks like and how the harness will know it is fixed, without anything in her project being changed.

**Operational note:** Introduces a review record kept inside the project's existing self-ignoring harness folder, written with the same crash-safe discipline as run records, so a review interrupted part-way is recovered by running the command again. Built-in packs ship inside the published package, so the package contents change. An example repository with planted flaws ships alongside the existing examples, and a scripted-agent demo of a review sits with the existing demos so the output can be seen with no agent and no sign-in. Introduces the owner guide for task packs. A behaviour-preserving extraction from the agent invocation primitive lets a session run without a case file; the existing invocation tests prove it unchanged.

**Build note:** The scan reuses the existing agent invocation primitive's structured-output enforcement and re-validation, the read-only tool list and tool guard that triage already relies on, and worktree provisioning; it is a new role, not a new agent mechanism. The review record reuses the existing journal module, not a database. The finding schema is a small validated schema published as JSON Schema the way the report's is, not SARIF. Finding identity is a hash from the platform's crypto library. Pattern checks are compiled and matched by git's own grep with a timeout, never the harness's own regular-expression engine. The interactive choice reuses the prompt library `delivery init` already uses. Wording comes from closed phrase tables, not a model summary. No dependency is added.

### Prerequisites

- `delivery` can provision a worktree at the base branch tip and run a read-only agent session in it with a validated structured reply
- The project's harness folder exists and ignores itself, so nothing new shows as a change in the owner's project
- The agent mock can script a session's structured reply, for demos and recorded tests

### Acceptance Criteria

- [ ] `delivery review code` runs in a repository with no configuration file, says before it starts that it reads the project and writes nothing to it, and on finishing says how long it took and how many problems it found
- [ ] Each problem is a numbered block with a plain title, a severity word, where (file and line), what is wrong, why it matters, what fixed looks like, and "How we will know" naming its check level ("checked: the flagged code is gone", "checked: the risky pattern no longer appears", or "tests only: no check of this specific problem")
- [ ] The list ends with how many problems have a specific check, a line saying nothing has changed and nothing will until the owner approves, and the exact next commands
- [ ] The review states that it is an agent's opinion; agent-written titles and sentences are the only task-specific wording, and no owner-facing sentence uses the harness's internal words
- [ ] The review reads only what is committed and says so when the project has uncommitted changes; the owner's files, branches and working copy are unchanged afterwards
- [ ] The review agent cannot edit files, run commands or read outside the project: an attempt is refused as for any other role, and a pack cannot widen this
- [ ] A problem whose file does not exist, whose path leads outside the project, or whose flagged text cannot be found in the file is not offered: it is listed under "could not be confirmed" (`delivery findings --unconfirmed`), never silently dropped
- [ ] A problem whose pattern check does not match the code as it stands is not offered with that check
- [ ] Two reported problems at the same flagged code are shown once; the same problem found again by a later review, even with different wording or after lines have moved, has the same identity
- [ ] More problems than the pack's limit are cut to the limit with a visible "N more not shown" line
- [ ] With no problems found the review says it found none and that this is not proof there are none, naming how many files it looked at; exit is success
- [ ] A review that could not run (no sign-in, no network, usage limit, a reply that is not a valid list) says so in one plain sentence with one next step, saves no partial review, and exits with the existing failure codes
- [ ] On a terminal the review offers an interactive choice of problems and "Fix now / Not now"; in a pipe or with `--json` it never prompts
- [ ] `delivery findings` lists the latest review's problems with their severity and "not yet decided"; `delivery findings <n>` shows one problem in full followed by a FOR ENGINEERS block with category, file range, check kind and parameters
- [ ] `delivery packs` lists the reviews available with a plain sentence each; an unknown pack name lists the available ones
- [ ] `delivery review ./path-to-a-pack` runs a pack from a folder exactly as a built-in one
- [ ] With no review yet, `delivery findings` says so and how to start one; a damaged review record names the file and offers a re-run, with no stack trace
- [ ] A review interrupted after the agent finished but before the review was recorded is completed by running the command again without a second agent session; one interrupted mid-session is redone

### UAT

**What you can now do:** Ask the harness to review your project's code and read what it found, in plain words, without anything being changed.

**How to try it:**
1. Open a terminal in the example project with planted flaws that ships with the harness.
2. Type `delivery review code` and wait for it to finish.
3. Read the numbered list of problems; choose "Not now" when asked whether to fix them.
4. Type `delivery findings 1` to see the first problem in full, including the part for engineers.
5. Look at the project's files and history: nothing has changed.

**What you should see:** A short list of real problems from the example project, each explained in everyday words with where it is, why it matters and how the harness would know it was fixed, followed by a line saying nothing has been changed and the commands to run next.

**Why this matters:** This is the first answer to "what can this tool do for me right now?": a useful, readable review from one command and no setup.

---

## Slice 2: Choose Which Problems to Fix and Have Them Fixed and Merged

**Delivers:** The owner approves some problems and skips others, types `delivery fix`, and each approved problem is fixed by an agent in its own working copy, checked by its own specific check plus the project's existing tests, and merged into the main copy, with problems the agent cannot fix explained rather than dropped.

**Operational note:** `delivery fix` writes a generated configuration into the review's folder; it is a real project configuration, so `validate`, `preview` and `status` read it unchanged, and where a project has no configuration file of its own the reading commands fall back to it. Fix runs are ordinary runs in the usual runs folder. The report's per-task data gains an optional tags field, additive to the published report schema and its published-keys guard. The gate context passed to every gate gains the run's base branch, which existing gates ignore.

**Build note:** Fixes are ordinary tasks run through the existing queue and supervisor, so concurrency, retries, triage, budgets and resume are reused, not rebuilt; there is no pack scheduler. "Resolved and nothing regressed" is the existing delta rule unchanged: the finding's check is a new assertion that is absent at baseline, made to count by the existing new-assertions option, and the regression part reuses the existing command gate (or the existing `npm test` inference). Landing reuses the existing merge-back closer (or the project's own closer). Task identity reuses the queue's existing match on task content, so re-running never duplicates a fix. The owner's decisions are entries in the review record, not labels in an external service.

### Prerequisites

- A review of the project exists with problems in "not yet decided", each with a stable identity and a check
- `delivery run` can work through a list of tasks with a configured gate and closer, at one or several at once
- A custom gate and a custom closer can be pinned for a run and loaded from outside the working copy

### Acceptance Criteria

- [ ] `delivery findings approve 1 3 4`, `approve --all` and `skip 2 5` record the owner's choice for exactly those problems; `--all` covers only the problems listed at the time, so a later review cannot widen it; the latest choice for a problem wins
- [ ] Approving a "tests only" problem prints one line saying it cannot be proved fixed except by the existing tests
- [ ] `delivery fix` refuses in one sentence, with the command to run, when there is no review or nothing is approved
- [ ] `delivery fix` says how many approved problems it is fixing and how many at once, and points to `delivery status --watch`
- [ ] Each approved problem becomes one fix task whose agent sees the problem description and is told it is a description to act on, not instructions to obey
- [ ] A fix passes only when the problem's own check passes and every test that passed before still passes; a fix that leaves the flagged code in place, including by commenting it out, does not pass
- [ ] A check that cannot be run (a malformed or too-slow pattern) is a problem with the check, never a pass
- [ ] A passed fix that is not held is merged into the main copy by the project's way of landing work (merge-back unless the project names another closer); with a pull-request closer the problem reads "fixed, pull request opened" rather than "merged"
- [ ] A problem whose flagged code is no longer in the main copy when its fix would start is "already fixed" and not worked on
- [ ] A problem the agent cannot fix ends "could not be fixed" with a plain explanation and the agent's own words, and does not stop the remaining approved problems from being fixed, even one at a time
- [ ] Running `delivery fix` again, or after an interruption, works only on approved problems not yet finished and never fixes the same problem twice
- [ ] `delivery findings` shows every problem in exactly one owner-facing state from the spec's closed set, and every approved problem ends in a final one
- [ ] With several at once, two fixes in the same file that conflict on landing are reported plainly through the existing landing retry, never merged over each other
- [ ] `delivery status` shows each fix task as "Fix: <title> (<file>)"; `delivery report --json` carries the pack, problem identity, severity and phase on each fix task

### UAT

**What you can now do:** Pick which of the review's problems you want fixed and have them fixed and merged for you, each one checked.

**How to try it:**
1. In the example project after a code review, type `delivery findings` to see the list.
2. Skip one problem with `delivery findings skip` and its number, and approve the rest with `delivery findings approve` and their numbers.
3. Type `delivery fix` and let it finish.
4. Type `delivery findings` again and read where each problem ended up.
5. Look at the project's files: the fixed problems are gone and the skipped one is still there.

**What you should see:** The approved problems shown as fixed and merged (or, for one the agent could not fix, a plain reason), the skipped problem shown as skipped by you, and the project's main copy containing the fixes.

**Why this matters:** The owner decides what is fixed, and every fix is proved against its own check and the project's tests before it reaches the main copy.

---

## Slice 3: A Fix That Weakens the Tests Is Refused

**Delivers:** A fix that "passes" by deleting, editing or skipping the project's tests, or by changing how the tests are run, is refused and the agent is told why, whatever kind of test output the project produces.

**Operational note:** The pack format gains the test, protected and skip-marker lists each pack adds to the harness's defaults; they travel with each fix task so the check can read them. The adversarial scripted tests that prove this guarantee become part of the suite every change runs, and a scripted demo of cheating fixes against the example project ships with the existing demos so the guarantee can be watched with no agent and no sign-in.

**Build note:** Guards are worked out by git, against the change since the fix branched, with git's own path patterns doing the matching; no glob library is added and no test-output parser is involved, which is what closes the gap for projects whose tests report only pass or fail as a whole.

### Prerequisites

- Approved problems are fixed as gated tasks that compare the working copy with the point it branched from
- The check for a fix is loaded from outside the agent's working copy and cannot be read or edited by it

### Acceptance Criteria

- [ ] A fix that deletes an existing test file is refused
- [ ] A fix that modifies an existing test file is refused; a fix that adds a new test file is allowed
- [ ] A fix that adds a skip marker (such as `.skip(`, `xit(`, `@Ignore`, `pytest.mark.skip`, or one the pack adds) is refused
- [ ] A fix that changes test-runner or CI configuration, or changes the project's test command, is refused
- [ ] Each refusal holds whether the project's tests report individual results or only a single pass or fail
- [ ] The agent is told its fix was refused because it removed, changed or skipped existing tests, and retries within the normal retry limit
- [ ] The owner sees "The agent's fix was rejected because it removed or skipped existing tests" in the problem's history
- [ ] For a problem in the pack's "tests" category, modifying an existing test is allowed and deleting one is still refused; the review shows such a problem as "this fix will change your tests" before it is approved
- [ ] A problem that can only be fixed by changing an existing test ends "could not be fixed", counted separately as "needs a change to one of your tests, which this review does not let an agent do"

### UAT

**What you can now do:** Trust that a "fixed" problem was not fixed by quietly removing or switching off the tests that judge it.

**How to try it:**
1. Open the example project's scripted demo of a cheating fix, which ships with the harness, and run it as its guide describes.
2. Read the demo's output for the fix that deleted a test, the one that skipped a test, and the one that changed the test command.
3. Type `delivery findings` in the demo project and read where those problems ended up.

**What you should see:** Each cheating fix refused with the plain reason that it removed, changed or skipped existing tests, and none of them shown as fixed or merged.

**Why this matters:** This is the harness's central promise: a fix that games the check is caught, not waved through.

---

## Slice 4: Run a Security Review and Sign Off Serious Fixes Before They Land

**Delivers:** The owner types `delivery review security`, reads problems grouped by how serious they are with what could happen in plain words, and serious fixes (high or critical) are fixed and checked but wait for her sign-off, which re-checks the fix on her current main copy before landing it.

**Operational note:** Sign-off takes the same repository lock as runs of several tasks, so it is safe to run while a fix phase is going. Records that must hold a secret the review found are written readable only by the owner, under the self-ignoring harness folder, and never printed. The second built-in pack ships in the package.

**Build note:** A held fix reuses the existing commit-to-branch closer behaviour; landing after sign-off composes git's own rebase, the same pack check, the existing delta rule and the existing merge-back closer under the existing repository lock, adding no new landing code. Severity words follow the standard CVSS qualitative bands, not a new scale or score. The vulnerable-version check reads the npm lockfile directly; no resolver or advisory database is added in this slice.

### Prerequisites

- A code review can be run, chosen from, fixed and landed, with fixes refused when they weaken the tests
- Fixes can be committed to a kept branch without touching the main copy
- Several runs and closes can be serialised by the repository lock

### Acceptance Criteria

- [ ] `delivery review security` runs with no configuration and opens with the count of problems by severity (critical, high, medium, low)
- [ ] It says that high and critical problems are fixed and checked but wait for sign-off before reaching the main copy
- [ ] Each problem says "What could happen" in plain words; a problem about an out-of-date library is labelled as coming from the reviewer's knowledge, not an advisory database, and possibly out of date or wrong
- [ ] A problem about a vulnerable library version is checked by that version no longer being installed
- [ ] A problem that leaves something only a person can do (such as changing a leaked password at the provider) shows a "one thing is left for you" note beside it, and appears under "needs you" after its fix
- [ ] A leaked secret's text never appears in any output: the review, `delivery findings`, `--json`, `status`, `report`, error text and escalation text all show it masked as its first four characters, an ellipsis and its length
- [ ] A secret moved to another file is not "fixed": a secret problem's check looks across the whole project
- [ ] A fix at or above the threshold passes its checks and then waits: it is kept on a named branch, the main copy is untouched, and the problem reads "waiting for your sign-off"
- [ ] `delivery findings <n> --changes` shows the changed files and the change, prefixed by a note that it shows what changed and cannot say it is safe
- [ ] `delivery findings sign-off <n>` says it is checking the fix still works on the current main copy, then lands it and reads "fixed and merged"; this works when other fixes have landed since the held fix was made
- [ ] If the held fix conflicts with the current main copy, or no longer passes its check there, nothing is merged, the branch is kept, and the problem reads "signed off but could not be merged" with the plain reason
- [ ] `delivery findings reject <n>` declines the fix, keeps the branch for an engineer, and the problem reads "declined at sign-off"
- [ ] Running sign-off again after it landed changes nothing; nothing at or above the threshold reaches the main copy without a recorded sign-off
- [ ] On the code review pack nothing is held for severity

### UAT

**What you can now do:** Have a security review of your project, fix what it finds, and decide yourself whether each serious fix goes in.

**How to try it:**
1. In the example project, type `delivery review security` and read the list, noting the critical problem about a password in the code.
2. Approve all the problems and type `delivery fix`.
3. Type `delivery findings` and see the serious one waiting for your sign-off; type `delivery findings` with its number and `--changes` to see what changed.
4. Type `delivery findings sign-off` with its number.
5. Type `delivery findings` again.

**What you should see:** The serious problem explained in everyday words with the password never shown, held until you signed off, then re-checked and merged, with a note that changing the password at the provider is still yours to do.

**Why this matters:** Security fixes an owner does not understand are a liability; she sees and approves every serious one, and none lands unchecked.

---

## Slice 5: Come Back to the Report and See What the Review Fixed and What Needs You

**Delivers:** After a review and fix phase, `delivery report` opens with one sentence about the whole review (found, approved, skipped, fixed, waiting, could not be fixed) and lists each problem by its plain title under who must act.

**Build note:** The report is the existing report, not a new report type: its sections and headline gain the pack's states from a pure reading of the review record alongside the existing reading of the runs, with no second record of what happened. Wording comes from closed phrase tables, and the forbidden-word test that guards the report covers every new phrase.

### Prerequisites

- A review has been run, some problems approved and skipped, and its fix phase has left problems fixed, waiting for sign-off and could not be fixed
- `delivery report` reports a project's task list with Needs you, Stopped for your engineers and Done sections

### Acceptance Criteria

- [ ] `delivery report` after a review's fix phase opens with which review it was and a sentence counting problems found, approved and skipped, then how many are fixed, waiting for sign-off and could not be fixed
- [ ] Problems appear by their plain title and severity ("Problem 1 of 6: ... (high)") in sections by who must act: Waiting for your sign-off, Needs you, Stopped for your engineers, Done, Skipped by you
- [ ] A waiting problem says what the risk was, what the agent changed, how the check knows it is closed, why it needs the owner, and the commands to see the change, sign off or reject
- [ ] A problem that could not be fixed says why in one fixed sentence plus the agent's words, who must act, and what
- [ ] A problem stopped by a setup problem (a broken check) is in the engineers' section as for any task
- [ ] Each "fixed" line names the check's level, so a "tests only" fix is never presented as proved
- [ ] `delivery findings --json` gives one versioned document with every problem, its state, check kind and level, and a pointer to its fix run; `delivery findings --schema` prints its JSON Schema
- [ ] No owner-facing sentence uses the forbidden words (finding, gate, assertion, escalated, held, landed and the rest of the spec's list)
- [ ] The report works the same from another terminal during the fix phase and after an interruption

### UAT

**What you can now do:** Come back after a review and read, in one place, what was fixed, what is waiting for you and what could not be done.

**How to try it:**
1. In the example project after the security review and fix phase from the previous slice (with one fix still waiting), type `delivery report`.
2. Read the first sentence.
3. Read the section waiting for your sign-off and the section of problems that could not be fixed.

**What you should see:** One sentence summing up the review, then each problem by its plain title under the heading that says who needs to act, with what to do next for each.

**Why this matters:** For a non-technical owner the report may be the only window into what the harness did; it has to answer "what happened and what do I do?" in her words.

---

## Slice 6: Review a Project That Has No Tests, Safely

**Delivers:** An owner whose project has no tests is told so at review time, can still approve problems that have a specific check, and every fix waits for her sign-off, so nothing is merged that only an agent has vouched for.

**Operational note:** A second example project, with planted flaws and no tests, ships alongside the first so this case can be demonstrated.

### Prerequisites

- Serious fixes can be held for sign-off and signed off or rejected
- Problems carry a check level that the owner sees before approving

### Acceptance Criteria

- [ ] In a project where no test command can be found, the review says the project has no tests, that nothing will check a fix has not broken something else, and that every fix will wait for sign-off
- [ ] A problem with a specific check can be approved and is shown as "finding check only, no regression tests"
- [ ] Every fix in such a project is held for sign-off whatever its severity, including on the code review pack
- [ ] A problem with no specific check is not offered: it reads "needs your decision" with "cannot be checked"
- [ ] `delivery findings approve <n> --allow-unchecked` approves such a problem, is recorded, prints a one-line warning that nothing will check this fix except you, and its fix is always held
- [ ] A pack that requires a check makes a problem without one "needs your decision" in any project

### UAT

**What you can now do:** Use a review on a project with no tests without anything being merged that has not been checked by you.

**How to try it:**
1. Open the example project without tests that ships with the harness and type `delivery review code`.
2. Read the warning at the top and the "How we will know" line of each problem.
3. Approve the problems that have a specific check and type `delivery fix`.
4. Type `delivery findings`.

**What you should see:** A plain warning that the project has no tests, problems without a specific check set aside as needing your decision, and every fix waiting for your sign-off rather than merged.

**Why this matters:** The harness never pretends a fix is proved when there is nothing to prove it against; the owner stays the final check.

---

## Slice 7: Write Your Own Pack and Prove It Without a Real Agent

**Delivers:** An extender copies a built-in pack, changes it for her own domain, and runs `delivery packs check` to have any mistake named by file and field and the pack run end to end against a scripted agent, with no real agent and no API key.

**Operational note:** The pack conformance suite is exported from the package's testing entry point, and both built-in packs run it as part of the suite every change runs, so a broken built-in pack fails the build. The pack manifest's JSON Schema is published so an editor can validate a pack as it is typed. Introduces the guide to writing a pack, alongside the guides to writing a gate and a closer.

**Build note:** The scripted run reuses the existing agent mock and its script format: a scripted review is a structured reply and a scripted fix is file changes, with no pack-specific mock vocabulary. Manifest validation reuses the validated-schema approach the project configuration uses, so typos are named the same way. Each pack carries its own fixtures folder; there is no separate test framework.

### Prerequisites

- Both built-in packs run reviews and fixes end to end with their own checks, guards and hold policy
- The agent mock can script a review's reply and a fix's file changes

### Acceptance Criteria

- [ ] `delivery packs check <path>` names any manifest problem by file and field in plain words, including an unknown check kind with the available ones listed
- [ ] On a valid pack it runs the pack's fixtures against a scripted agent and reports what the review found, which fix passed its check and which seeded cheat was refused, and says nothing was sent to a real agent
- [ ] A pack whose scripted review does not yield the expected problems, or whose seeded fix fails or seeded cheat passes, fails the check with a plain explanation
- [ ] Exit codes follow `delivery validate`
- [ ] `delivery packs --schema` prints the pack format's JSON Schema; `--json` works on `review`, `findings`, `fix` and `packs`
- [ ] A pack's manifest version and content are recorded with each review, so a review shows which version of a pack produced it
- [ ] A pack cannot give the review agent write tools or commands, and cannot point the fix's check at code of its own; such a manifest is refused
- [ ] Both built-in packs pass the same check

### UAT

**What you can now do:** Write a review pack for your own area and prove it works before pointing it at a real project.

**How to try it:**
1. Copy the built-in code review pack's folder and rename it, following the guide to writing a pack.
2. Change one check kind in its manifest to a made-up name and type `delivery packs check` with the folder's path.
3. Fix the name back and run the same command again.
4. Type `delivery review` with the folder's path in the example project.

**What you should see:** First a plain message naming the file and field that is wrong and the allowed values; then a success message describing the scripted review and fixes with nothing sent to a real agent; then a real review running from your own pack.

**Why this matters:** A stable, provable pack format is what lets teams and the community extend the harness to their own domains without reading its source.

---

## Slice 8: Keep Your Choices Between Reviews

**Delivers:** Running the same review again does not re-propose problems the owner already skipped, declined or had fixed, and points out any fixed problem that has come back; the owner can approve the recommended problems in one step.

### Prerequisites

- Reviews give the same problem the same identity across runs
- The owner's approvals, skips, sign-offs and rejections are recorded per review

### Acceptance Criteria

- [ ] A new review of the same pack in the same project shows problems skipped or declined in earlier reviews as skipped, hidden by default with a line such as "3 declined earlier, not shown"
- [ ] `--include-skipped` shows them
- [ ] A problem fixed earlier whose flagged code is back is shown as "came back"
- [ ] A problem fixed earlier and still gone is not re-proposed
- [ ] `delivery findings approve --recommended` approves the problems with the strongest check that are below the sign-off threshold, and says which it chose

### UAT

**What you can now do:** Run the same review again without being asked about things you have already decided.

**How to try it:**
1. In the example project, after a code review where you skipped one problem and had others fixed, type `delivery review code` again.
2. Read the list and the line about problems declined earlier.
3. Type `delivery findings --include-skipped`.

**What you should see:** Only new problems offered, a line saying how many earlier choices are not shown, and the skipped one visible again when you ask for it.

**Why this matters:** A review that nags about settled decisions will not be run regularly; this makes it a practice rather than a one-off, ready for scheduled reviews.

---

## Slice 9: Choose What Waits for Sign-Off and When Tests May Change

**Delivers:** The owner chooses how serious a problem must be for its fix to wait for her sign-off, and can let a specific fix change existing tests when that is the only way to fix it.

### Prerequisites

- Fixes can be held for sign-off by severity
- Fixes that would change an existing test are refused and counted separately

### Acceptance Criteria

- [ ] `delivery fix` accepts a sign-off threshold of critical, high, medium, low or none; the default stays the pack's; the choice is recorded with the approval
- [ ] With threshold medium, medium, high and critical fixes wait; with none, nothing waits for severity (fixes in a project with no tests still wait)
- [ ] `delivery findings approve <n> --allow-test-edits` lets that problem's fix modify existing tests, is recorded, and its fix always waits for sign-off
- [ ] Deleting an existing test is still refused for such a fix
- [ ] A problem that ended "needs a change to one of your tests" can be approved again with `--allow-test-edits` and fixed on the next `delivery fix`

### UAT

**What you can now do:** Decide how cautious the harness is with your project, and unblock a fix that genuinely needs a test changed.

**How to try it:**
1. In the example project after a code review, approve all problems and type `delivery fix` with a sign-off threshold of medium.
2. Type `delivery findings` and note which fixes are waiting for you.
3. For the problem shown as needing a change to one of your tests, approve it again allowing test edits and type `delivery fix`.

**What you should see:** Medium and more serious fixes waiting for your sign-off, and the previously blocked problem now fixed and waiting for your sign-off.

**Why this matters:** Owners differ in how much they want to see before changes land; the default is safe and the choice is theirs.

---

## Slice 10: Focus, Quieten and Preview a Review, and See What It Cost

**Delivers:** The owner can review just part of a project, see how sure the review was of each problem with the less certain ones set aside, preview what the review agent will be told without signing in, and see what the review and its fixes cost.

**Build note:** Cost and duration come from the session usage the harness already records for every agent session; the preview reuses the existing `delivery preview` approach of showing exactly what will be sent.

### Prerequisites

- Reviews, fixes and the report work end to end for both built-in packs
- Every agent session's usage is recorded

### Acceptance Criteria

- [ ] `delivery review code --path src/auth` reviews only that part of the project and says so
- [ ] Each problem shows how sure the review was (low, medium, high); low-confidence problems are collapsed under "Possibly worth a look"
- [ ] A pack's exclusion list keeps the kinds of problem it names out of the review
- [ ] `delivery review <pack> --preview` shows what the review agent will be told, with no sign-in and no network
- [ ] The report's tuning section and `delivery findings` show the review's and the fixes' cost and duration in the owner's vocabulary; facts not recorded read "not recorded"

### UAT

**What you can now do:** Aim a review at the part of your project you care about, cut the noise, and know what it cost.

**How to try it:**
1. In the example project, type `delivery review code --preview` and read what the review will be told.
2. Type `delivery review code` with `--path` and one folder of the project.
3. Read the list, including the collapsed "Possibly worth a look" part.
4. After fixing some problems, type `delivery report` and read the tuning section.

**What you should see:** A preview with no sign-in, a review limited to the folder you chose with less certain problems set aside, and a report showing how long the review and fixes took and roughly what they cost.

**Why this matters:** Owners pay for every review; focusing it and seeing its cost keeps it worth running.
