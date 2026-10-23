# Packs for Any Workflow — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`
> Next step: invoke writing-plans with this document

Slices are ordered so each leaves the existing review packs working unchanged (spec M3). Personas are Dana (project owner), Priya (extender) and Marcus (on-call engineer), as in the spec.

---

## Slice 1: Write a pack with workflows of your own and have mistakes named plainly

**Tests:** ✅ Recorded — 2026-10-23 — `dd6b7fc` — cli — 1 UAT + 7 AC groups, 2 AC skipped

**Delivers:** Priya can write a pack that names its own find and act workflows (each with its own prompt, guards and hold), list it, and be told by file and field when she gets it wrong; her existing review packs and the built-in `code` and `security` packs are listed and behave exactly as before.

**Operational note:** Compatibility of the new format is enforced from its first release by the published-keys promise, per format version. Existing review packs are proved unchanged by a characterisation captured against today's behaviour before any change is made.

**Build note:** Reuse the existing manifest validation, schema generation, stability promise and error-rendering machinery; do not introduce a second validator. Reading the old format is one thin, pure conversion into the same model, not a rewrite of users' files.

### Prerequisites

- Packs in the current format can be listed, checked and run from project configuration
- Backlog items naming a review pack's fix workflow run

### Acceptance Criteria

- [ ] A pack declaring one find and several act workflows, each with its own prompt, optional extra guards and optional hold, is accepted and listed by `delivery packs`
- [ ] A pack in the current format, including the built-in `code` and `security` packs, is listed, checked and run with identical results, workflow names and pack identity as before
- [ ] A backlog item naming `code:fix` or `security:fix` still runs
- [ ] A pack with no find, two finds, an idea target that is not an act workflow, an act no find offers, an act-only key on a find, a missing summary where several targets exist, a reserved `settings` key, an unknown key or a wrong `kind` is refused with a sentence naming the file and field
- [ ] A pack declaring a format version the build does not read is refused with a sentence naming the readable versions
- [ ] A pack cannot supply a gate, an agent, tools, a closer or commands; such keys are refused with the existing data-only explanation
- [ ] The machine-readable pack schema describes the new format, flags unknown keys inside each kind of workflow, and the published-keys promise holds for both format versions
- [ ] Two packs defining the same workflow name are reported by the existing clash sentence

### UAT

**What you can now do:** Write a pack with workflows of your own and get plain feedback on it, while your existing review pack carries on working.

**How to try it:**
1. Copy the example pack from the documentation into a folder, list it under `packs` in a project's configuration and run `delivery packs`
2. Open its manifest, delete the line that says which workflows the find offers, and run `delivery packs` again
3. Put the line back, then run `delivery packs` and `delivery review code` on a project that already used the built-in `code` pack

**What you should see:** Step 1 lists your pack. Step 2 names the file and the field at fault in plain words. Step 3 lists your pack again and the built-in review runs exactly as it did before.

**Why this matters:** Authors can describe jobs other than reviews without risking the packs people already rely on.

---

## Slice 2: Run a pack that is not a review, in its own words

**Delivers:** Dana can see any pack's start command in `delivery packs`, start its find with `delivery review <pack>`, approve ideas that route to different act workflows, and have each idea acted on under that workflow's own prompt, guards and hold, with output that speaks of the pack and never of a "review".

**Operational note:** Owner-facing wording is chosen by the pack's declared format, so existing review packs keep every current sentence byte for byte; the new sentences come from fixed text with the pack's own title and summary slotted in.

### Prerequisites

- Packs with named find and act workflows can be written, listed and validated (Slice 1)

### Acceptance Criteria

- [ ] `delivery packs` shows each pack with one plain sentence and the command that starts it
- [ ] `delivery review <pack>` starts the find of any pack, including one whose find is not called `scan`, with `--path` and `--preview` working as for a review
- [ ] Output for a new-format pack uses the pack's title and summary and never says "review found problems" or quotes agent text as its own words
- [ ] Output for existing review packs is unchanged
- [ ] When the find adds nothing, the owner sees a plain line saying so that adds it is the agent's reading and not a guarantee
- [ ] When the find adds as many ideas as the cap allows, the owner sees a line saying there may be more and to run it again once these have landed
- [ ] A pack that is not listed in the project is refused with a message naming the pack and saying to list it, not mentioning "the review"
- [ ] An approved idea runs under the workflow it names; two ideas naming different act workflows run under different guards and hold
- [ ] A high-severity idea in an act workflow with a hold waits for sign-off; an idea in an act workflow without a hold does not
- [ ] Sign-off, reject, backlog and report behave as for any item

### UAT

**What you can now do:** Start and finish a job that is not a review using the commands you already know.

**How to try it:**
1. Run `delivery packs` and read the line for the pack you want
2. Run the start command it shows, then `delivery backlog` to see the ideas
3. Approve two ideas that belong to different act workflows and run them with `delivery run --sources`
4. Run `delivery backlog` and `delivery report`

**What you should see:** The pack is listed with its start command; the ideas appear in plain words; the riskier idea waits for your sign-off and the other lands; the report says what moved, what waits and what could not be done.

**Why this matters:** One set of commands covers every kind of job, so owners learn the loop once.

---

## Slice 3: Prove a pack works end to end before sharing it

**Delivers:** Priya can run `delivery packs check` on a pack of the new format and watch the scripted find, approval and every act run, with a refused cheat, using no real agent and in the pack's own workflow names.

**Operational note:** Every built-in pack folder is run through the pack check by the normal test suite, so a broken built-in fails the build rather than every user's command. Third-party authors can use the same check from the testing entry point.

**Build note:** Reuse the existing pack-check harness and scripted agent; the fixture contract and its found, fixed and refused rule stay as they are.

### Prerequisites

- A pack's find can be started through `delivery review` whatever it is called (Slice 2)

### Acceptance Criteria

- [ ] `delivery packs check` on a new-format pack runs the find, approves the ideas, runs every act workflow and reports what it proved using the pack's own workflow names
- [ ] A pack with an act workflow that no scripted idea reaches fails the check with a message naming that workflow
- [ ] A pack whose fixtures expect a refused cheat that is not refused fails the check
- [ ] The check for an existing review pack gives the same result and wording as before
- [ ] The check sends nothing to a real agent and needs no sign-in

### UAT

**What you can now do:** See that your pack really works, end to end, before anyone else uses it.

**How to try it:**
1. Run `delivery packs check` on the example pack folder
2. Open its ideas fixture, change one idea so it no longer names one of the act workflows, and run the check again
3. Restore the fixture and run the check once more

**What you should see:** First a pass that names each step it proved; then a failure naming the act workflow nothing reached; then a pass.

**Why this matters:** Authors get honest feedback offline, so shared packs have been shown to run.

---

## Slice 4: Move off deprecated code with the built-in `deprecations` pack

**Delivers:** Dana can run a built-in pack that is not a review: `deprecations` finds places that still use code her team has marked as replaced and moves each to the replacement, with risky moves held for sign-off and a test-editing cheat refused.

**Operational note:** A new built-in loads in every project, so its name and its workflow names are reserved everywhere; the changeset and packs page must say so. The set of built-ins pinned by name in existing tests moves to include it.

**Build note:** Dependency upgrades are left to Renovate and Dependabot; do not build a competing built-in. The pack reuses the existing check kinds, guards, hold and sign-off, and its fixtures adapt the shape of the unmerged migration example without depending on that branch.

### Prerequisites

- Packs of the new format can be run and owner-facing output is pack-neutral (Slice 2)
- The pack check runs new-format packs end to end (Slice 3)

### Acceptance Criteria

- [ ] `delivery packs` lists `deprecations` with the sentence and start command given in the spec, in every project without any configuration
- [ ] Running it against the scripted agent adds three ideas, lands the unheld honest moves, holds the high-severity one for sign-off and refuses the move that edits a test to make itself pass
- [ ] A test edited as part of moving a test file's own calls is accepted under the tests workflow and refused under the code workflow
- [ ] The built-in passes the pack check as part of the normal test suite
- [ ] Owner text for the pack never uses the words "pattern-absent", "guard", "deprecation sweep" or "check kind"
- [ ] A project defining a workflow named like one of the built-in's, or a listed pack itself named `deprecations`, is refused with a sentence naming the built-in and what to rename; other existing projects load as before
- [ ] When the project marks nothing as deprecated, the owner sees the plain nothing-found line

### UAT

**What you can now do:** Hand a deprecation clean-up to the harness and stay in control of the risky parts.

**How to try it:**
1. In a small sample project with an old date-handling module marked as replaced, run `delivery packs`
2. Run `delivery review deprecations`, then `delivery backlog`
3. Approve all ideas and run `delivery run --sources`
4. Read the held move with `delivery backlog`, then sign it off

**What you should see:** The pack is listed; places that still use the old module appear in plain words with how serious a wrong move would be; the safe moves land; the serious one waits for you, then lands after sign-off; the report says what moved.

**Why this matters:** A real clean-up job, not a review, runs on the same trusted loop.

---

## Slice 5: Learn from the documentation that packs cover more than reviews

**Delivers:** Dana and Priya can tell from the documentation, before reading about manifests, that a pack is a repeatable find-then-act job and a review is one kind; Priya can follow a worked example of a non-review pack.

**Operational note:** The documentation tests that assert guide contents are extended to check the opening claim of the packs page and docs index and that the how-to names every command it uses.

### Prerequisites

- The built-in `deprecations` pack exists and runs (Slice 4)

### Acceptance Criteria

- [ ] The first paragraph of the new packs page and of the docs index says a pack is a find-then-act job, reviews are one kind, and names the three built-ins
- [ ] The packs page explains the find, approve, act and sign-off loop (as text as well as any diagram), the limits of an agent's find, the 40-idea cap, and the name-reservation note
- [ ] A how-to for `deprecations` exists, names every command it uses, and teaches how to mark a deprecation so the pack can find it
- [ ] The pack-writing guide documents the new format with `deprecations` as the worked non-review example, states that the old format still works, and says what a scripted check cannot prove
- [ ] The glossary, README, CLI reference, command help and docs navigation no longer call every pack a review
- [ ] The release note states that `delivery review` starts any pack's find and notes the reserved built-in names

### UAT

**What you can now do:** Understand what packs are for and write one of your own from a worked example.

**How to try it:**
1. Open the documentation index and read its first paragraph
2. Open the packs page and follow the `deprecations` how-to
3. Open the pack-writing guide and compare its example with the built-in pack's folder

**What you should see:** The opening paragraph says packs cover more than reviews; the how-to's commands match what you run; the guide's example matches the built-in.

**Why this matters:** People only use what they can see exists, and authors copy what works.
