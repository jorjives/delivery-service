# Adapt a Shared Pack to My Project — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-design.md` (references such as M6 and S3 are that spec's items; A§n is `docs/prd/2026-10-25-adapt-a-shared-pack/architecture.md`, which holds the detail the spec summarises)
> Next step: invoke writing-plans with this document
> Authored unattended: the ordering and the tier of each slice (MUST first, SHOULD after) are assumptions, not human-confirmed.

---

## Slice 1: Give a pack a setting and see it in the agent's instructions

**Status:** ✅ Complete — 2026-10-25 — `e1e06a2`

**Tests:** ✅ Recorded — 2026-10-25 — `cb1dd23` — cli — 1 UAT + 2 AC, 3 skipped

**Delivers:** A pack author can declare a setting with a default, a project owner can override it in their configuration, and both can see the value in the instructions the agent will be given.

**Operational note:** The configuration file gains one new key and the pack format gains new published keys, so the format-stability checks and the changeset (a minor release) must be updated in this slice. Every built-in pack and fixture without settings must stay unchanged in hash, listing and run; a scripted run proves a value of shell metacharacters writes nothing outside the prompt.

**Build note:** Reuse the existing validation library and the existing placeholder substitution; extend that one substitution into a module that owns both placeholder kinds. Do not add a template engine, a configuration-layering library or an environment-variable source (spec section 7).

### Prerequisites

- Packs can be written in the `/3` format and loaded, with their approved fingerprint (packs for any workflow, Item 1; inspect a pack, Item 2).
- A project's packs, built-in, listed and installed, are bound to the project when it loads.
- The preview command shows the exact text an agent will be given for a step.

### Acceptance Criteria

- [ ] A `/3` pack can declare settings of types `text`, `path`, `paths` and `severity`, each with a one-line summary and an optional default; a setting with no default is required.
- [ ] A project owner can give values under a `packSettings` entry keyed by pack name, and it works the same for a built-in, a listed and an installed pack.
- [ ] A `{{settings.<name>}}` placeholder in a pack prompt shows the owner's value, else the default, in the step text the agent is given, and a resumed run keeps the text it started with after the configuration changes.
- [ ] A value or default containing `{{`, `}}`, a line break or a hidden character is refused, and a value of shell characters never leads to a command being run.
- [ ] Preview prints the resolved step text and a line naming each value used and whether it came from the default or the configuration.
- [ ] Every pack and fixture without settings behaves exactly as before.

### UAT

**What you can now do:** Change what a shared pack tells the agent by editing one line of your own configuration.

**How to try it:**
1. Open the example pack that declares a folder setting with a default, and note the default folder.
2. Run preview for one of its workflows and read the step text and the line saying the folder came from the default.
3. Add a `packSettings` entry for that pack with a different folder to `delivery.config.json`.
4. Run preview again.

**What you should see:** The step text now names your folder, and the line beneath it says the value came from your configuration.

**Why this matters:** An owner can adapt a pack to their project without editing or forking it.

---

## Slice 2: Be told in plain words when a setting is missing or wrong

**Status:** ✅ Complete — 2026-10-25 — `a2ce901`
**Tests:** ✅ Recorded — 2026-10-25 — `c87e7cd` — cli — 1 UAT + 4 AC, 4 skipped
**Delivers:** A project owner who forgets or mistypes a setting is refused before any agent runs, with the pack, the setting and the lines to add; a pack author who declares one badly is told the file and field.

### Prerequisites

- Packs can declare settings and owners can supply values, with the value reaching the agent's instructions.

### Acceptance Criteria

- [ ] An unset required setting stops `run`, `review` and `validate` for the whole project, including a workflow of a different pack, with exit code 2, before any agent call; the message names the pack, the setting, its summary and the exact lines to add, and says the whole project is stopped and why.
- [ ] `packs`, `packs inspect`, `add`, `update`, `restore`, `remove` and `approve` still work with a required setting unset.
- [ ] Several unset settings are listed together, one block each.
- [ ] A `packSettings` entry naming a pack the project does not use, a setting the pack does not declare (listing the declared names), a value of the wrong type, a value that is not a severity, or a path that is absolute, leaves the project or names `.git` is refused, all problems at once.
- [ ] A `packSettings` entry for a pack that has been removed is refused, not ignored.
- [ ] A pack author sees file-and-field messages for: a setting with no summary, a default that fails its own type, a placeholder naming an undeclared setting, a declared setting nothing uses, a `/3` prompt using `{{settings.` without declaring it, and more than 32 settings.
- [ ] A scheduled run is refused in the same way.

### UAT

**What you can now do:** Find out exactly what is missing from your configuration before anything runs.

**How to try it:**
1. Add a pack that has one required setting and no default to a project, without giving a value.
2. Run the project's usual run command.
3. Read the message, then paste the suggested lines into `delivery.config.json` with a folder name.
4. Run it again, then mistype the setting name and run once more.

**What you should see:** The first run is refused naming the pack and setting and showing the lines to add; the second proceeds; the third is refused listing the settings the pack does have.

**Why this matters:** A half-set-up project never starts, and the owner is never left guessing.

---

## Slice 3: See a pack's settings and what they would do before trusting it

**Delivers:** A project owner or on-call engineer can read, in inspection, each setting a pack asks for, the value that would apply, where that value came from, and what it changes.

### Prerequisites

- Owners can supply values and unset required settings are reported with the lines to add.
- A pack can be inspected, in text and as data, before it is trusted (Item 2).

### Acceptance Criteria

- [ ] `packs inspect` shows a Settings section directly after the summary, with name, plain summary, type, default, the value in effect, its source (default, your configuration, or not set) and what it changes.
- [ ] The instructions show the resolved text with each placeholder kept visible beside the value.
- [ ] A required setting with no value prints "not set" and the lines to add.
- [ ] For a pack the project does not use, outside a project, or with a code (`.js`) configuration, inspection says so and shows defaults only.
- [ ] A pack with no settings says so once.
- [ ] Inspection states in words that settings change what the agent is told and when it waits, and do not change the project's own check.
- [ ] The inspection data gains an always-present settings list, and the same facts appear in text and data; hidden characters in an owner value are refused rather than shown.
- [ ] Owner values do not change the pack's fingerprint or approval; a change to a declaration does.

### UAT

**What you can now do:** Read what a shared pack will ask of you, and what it would do with your answers, before running it.

**How to try it:**
1. Run `packs inspect` on a pack that has a required setting you have filled in and one you have left to its default.
2. Read the Settings section.
3. Remove your value for the required setting and inspect again.

**What you should see:** Each setting with its value and source; after removal, "not set" with the lines to add.

**Why this matters:** An owner can see what they are about to trust without reading the pack's files.

---

## Slice 4: Choose how far a pack goes before it asks you

**Delivers:** A pack author can let the owner set the severity at which a change waits for sign-off, and the owner can raise or lower it.

### Prerequisites

- Packs can declare a `severity` setting and owners can supply values.
- Inspection lists settings with their values and sources.
- Held changes wait for sign-off at a severity threshold (existing hold behaviour).

### Acceptance Criteria

- [ ] An act workflow can name a severity setting for its hold; naming both a literal hold and a setting on one act is refused with a file-and-field message.
- [ ] A setting that is not a severity cannot be named as the hold.
- [ ] With the default, an owner value, and a changed default, a change of a given severity is held or not held as that value says.
- [ ] Inspection shows the hold in effect and its source, and says when it cannot be known because the setting is unset or the configuration is code.
- [ ] The new pack format key is the only addition to the pack's published keys for hold; no existing promised line is removed or changed.

### UAT

**What you can now do:** Make a shared pack ask for your sign-off sooner or later than its author chose.

**How to try it:**
1. Run the example pack's scripted walkthrough with its default threshold and note which change is held.
2. Set the pack's hold setting to a lower severity in `delivery.config.json`.
3. Run the walkthrough again.

**What you should see:** A change that went through before is now held for sign-off.

**Why this matters:** Owners with a lower tolerance for risk can be more careful without editing the pack.

---

## Slice 5: Adding and updating a pack tells you what to set

**Delivers:** A project owner who adds or updates a pack is told which settings need an answer before it can run, and can see it in the pack list.

### Prerequisites

- Unset required settings are reported with the lines to add, and the pack commands work with them unset.
- A pack can be added from elsewhere, pinned, and updated with a report of what changed (install a pack from elsewhere, Item 3).

### Acceptance Criteria

- [ ] After adding a pack with unset required settings, the owner sees how many settings it needs, each with its summary, the lines to add, and "Then run: delivery validate"; the command still succeeds.
- [ ] `delivery packs` marks a pack that needs a setting, naming it.
- [ ] An update reports a new required setting (and that every run, scheduled included, will stop until it is given), a new optional setting, a removed setting (and that the configuration still names it), and a changed default; a default change that moves the hold is also reported with its direction, saying whether it lets more through.
- [ ] A new setting, a removed setting and a changed type are reported without being called safe.
- [ ] The data output of `add` and `update` carries the setting changes.
- [ ] No command in this slice fetches anything new on a run.

### UAT

**What you can now do:** Know what you must do after adding or updating a pack, instead of finding out when a run stops.

**How to try it:**
1. Add the example pack that has a required setting.
2. Read the message, then run `delivery packs`.
3. Update to a newer version of the pack that adds a second required setting.

**What you should see:** The add message lists the first setting with the lines to add; the list marks the pack as needing it; the update report says a new setting needs a value and that runs will stop until it is given.

**Why this matters:** Scheduled and unattended runs do not stop without warning.

---

## Slice 6: Prove a pack with settings and ship `deprecations` as the example

**Delivers:** A pack author can prove a pack with settings using the scripted agent, and the built-in `deprecations` pack becomes a working example of a pack with settings.

**Operational note:** The pack check needs an optional fixture file of setting values, and the build's enumerating test must run each built-in pack with it. The `deprecations` defaults must reproduce today's behaviour exactly.

### Prerequisites

- A pack with settings can be loaded, bound and run with an owner's values.
- `deprecations` exists as a built-in pack with fixtures and a pack check (packs for any workflow, Item 1).
- Hold can be taken from a setting.

### Acceptance Criteria

- [ ] `packs check` runs a pack whose settings all have defaults without any extra fixture, and a pack with required settings using values from an optional settings fixture, through the same route an owner's values take.
- [ ] A required setting with no fixture value is reported by name, with the fixture file to add.
- [ ] `deprecations` declares `old-module`, `new-module` and `hold-from` (default high); its existing scripted run, equivalence tests and held-change behaviour are unchanged with defaults.
- [ ] A whole-pack run of `deprecations` with non-default values shows them in the pinned prompts and the hold.
- [ ] A whole-command scripted run refuses with a required setting unset and runs when it is set.
- [ ] Third-party authors can use the same check from the published testing entry point.

### UAT

**What you can now do:** Check a pack that needs settings end to end, without an agent key.

**How to try it:**
1. Run `delivery packs check` on `deprecations`.
2. Copy the pack, remove the default from one setting, and run the check again.
3. Add that setting's value to the pack's settings fixture and run it a third time.

**What you should see:** The first check passes; the second names the missing setting and the fixture file to add; the third passes.

**Why this matters:** Authors can publish packs with settings knowing they work.

---

## Slice 7: Settings of more kinds

**Delivers:** A pack author can ask the owner for a choice from a list, a whole number or a yes/no, in addition to text, folders and severity.

### Prerequisites

- Settings of types `text`, `path`, `paths` and `severity` are declared, validated, bound and inspected.

### Acceptance Criteria

- [ ] `choice` settings take one of the declared values, which must be unique; a default must be one of them; an owner value outside the list is refused naming the accepted values.
- [ ] `number` settings take whole numbers; "ten" or 1.5 is refused with a sentence giving a whole number as an example.
- [ ] `boolean` settings take true or false; other values are refused.
- [ ] The three types render in prompts, inspection, update reports and the pack check as the other types do.
- [ ] Adding a type adds published pack lines and never changes an existing one.

### UAT

**What you can now do:** Fit a pack to your project with a mode, a limit or a switch.

**How to try it:**
1. In a project using the example pack, set its choice setting to a value not on its list.
2. Read the refusal.
3. Set it to a listed value and run preview.

**What you should see:** The first attempt is refused with the accepted values; the second shows the value in the step text.

**Why this matters:** Pack authors can offer real options without code.

---

## Slice 8: A guide that explains pack settings

**Delivers:** An owner and an author can learn what a pack setting is and is not, and how to use one, from the documentation.

### Prerequisites

- Pack settings can be declared, supplied, refused, inspected, updated and checked as described in Slices 1 to 7.

### Acceptance Criteria

- [ ] The packs page has a Settings section whose first paragraph says what a setting is and is not.
- [ ] The guide to writing a pack explains declaring settings, placeholders, defaults, the limits (a setting changes what the agent is told and when it waits, not the project's own check; a "test command" setting is text for the agent, not what the harness runs), and why a setting is different from a task field.
- [ ] The configuration reference documents `packSettings`; the glossary separates "pack setting" from the project configuration; CLI help and the `delivery packs` text use the same word.
- [ ] The `deprecations` how-to shows its settings, and every example uses kebab-case names and validates.
- [ ] The guide says a setting is not a place for a credential, that owner values are outside the approval fingerprint, and that a new required setting stops every run until it is given.
- [ ] The documentation tests check these claims, and the release note (a minor change) lists the new keys.

### UAT

**What you can now do:** Learn pack settings from the docs without reading code.

**How to try it:**
1. Open the packs page and read the Settings section.
2. Follow the `deprecations` how-to to set one of its settings.
3. Open the guide to writing a pack and find where it explains a setting versus a task field.

**What you should see:** Each step is findable from the page, and the how-to's example works as written.

**Why this matters:** A person new to packs can adapt one without asking anyone.
