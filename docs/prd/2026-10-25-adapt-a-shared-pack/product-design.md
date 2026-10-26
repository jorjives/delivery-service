# Product design: adapt a shared pack to my project (roadmap Item 4)

Author: `product-designer`. Date: 2026-10-25. Citations: `R§n` is `research.md` in this folder; `Roadmap` is `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`; `P1§6.7` is `docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md` section 6.7. Personas are from `docs/personas.md` (team-derived, not human-confirmed). Architecture is `architecture.md` (architect); where this file and it differ on mechanism, they are reconciled in the review log.

## 1. Vision

A pack someone else wrote should work in my project after I add a few lines to my own configuration, never after I edit or fork the pack (Roadmap Item 4 "Delivers", lines 152-153). The pack says what it needs to know about my project and offers a default where a sensible one exists. I answer in one place I already use. If I forget a required answer, the tool stops before any agent is called, says which pack and which setting, and shows me the lines to add. Inspection shows me, before I trust anything, what the pack asks and what it would be told with my answers.

The word the owner sees is **pack setting** (Roadmap's word). A glossary entry separates it from `delivery.config.json` as a whole, which the code already calls "settings" (R§1.3, A7).

## 2. Personas and goals

| Persona | Goal in this item | Success |
|---|---|---|
| Dana Okafor, non-technical owner | Make a pack someone else wrote work in her project without editing it, and know what her answers change | She adds named lines to her configuration, reads a refusal that names the missing one, sees on one screen what each setting changes ("what the agent is told", "how far it goes before it asks you") |
| Priya Shah, extender and pack author | Write one pack that fits many projects: declare what varies, with defaults, and be refused in her terms when a declaration or a placeholder is wrong | The refusal names the file and field; `{{settings.x}}` for an undeclared x is refused; she can prove the pack with the scripted agent without guessing values |
| Marcus Webb, on-call engineer | When a held change from a pack reaches him, know which values the agent was given | Inspection and preview show the value in effect and whether it came from the default or the project's configuration |

Proposed persona goal extensions (not written into `docs/personas.md`; reuse of existing personas only, per brief): Dana, Priya and Marcus as above.

## 3. Primary journeys

- **J1 Dana adds a pack that needs answers.** `delivery packs add <pack>` prints the Item 3 account, then (S3) a block listing each setting with no default. She edits `delivery.config.json`, runs `delivery validate`, then her usual run. (Dana; goal: work without editing the pack.)
- **J2 Dana forgets one.** She runs the pack. The tool refuses before any agent call, naming pack, setting, what it is for and the lines to add. (Dana; goal: know the one thing to fix.)
- **J3 Dana checks before trusting.** `delivery packs inspect <pack>` shows the settings table, each value that would apply and where it came from, and the instructions as the agent would be given them. (Dana; Marcus.)
- **J4 Priya declares settings.** She adds a `settings` map to `pack.json`, uses `{{settings.docs-folder}}` in a prompt, and `delivery packs check` proves the pack with fixture values. (Priya.)
- **J5 Dana updates a pack whose settings changed.** `delivery packs update` reports new required settings, changed defaults and removed settings in the same report as other changes, with direction for hold. (Dana; Marcus.)
- **J6 Marcus reads a held change.** He inspects the pack and sees the hold threshold in effect and its source. (Marcus.)
- **J7 Priya wants per-task values.** She keeps using `{{task.file}}`; the documentation explains why that is not a setting. (Priya.)

## 4. Capabilities

### Derived minimum scope (assumed, not human-confirmed)

Derived from the four Item 4 success criteria (Roadmap lines 155-161) and the Notes (169-173), made usable by the three personas. Not human-confirmed. It is a floor. Everything the personas need beyond it is in SHOULD and COULD and is not to be dropped for convenience.

**Assumed reading of criterion 3, "values reach the pack's prompts and checks" (line 160):** in `/3` a pack owns no check of its own. Its item checks (`anchor-gone`, `pattern-absent`, `dependency-absent`) are harness-owned and written by the scan agent from the scan prompt, guards are a closed list, and a pack carries no gate (R§1.6, R§4 A3; D1 below). So MUST reads "checks" as: values reach the **prompts** (including the scan prompt, which is how a path setting tells the scanner where a check applies) and the **hold threshold**. A value can never become a command the harness runs. Switching a guard on by a setting is COULD (C6). This reading is an assumption, not confirmed by a human; the documentation and inspection say it in these words (M12).

**Governing text for "data only":** Roadmap line 16-18 ("Packs stay data") and Item 1 "Constraints: Packs remain data only in this phase" (line 87). Separately, **D1 (inherited, assumed)**, packs-for-any-workflow design line 198, excludes a pack choosing a gate or closer; no human confirmed it, and lines 17-18 of the roadmap arguably allow "choices from built-in gates and closers". This design keeps D1 and does not rely on it for anything a human would not accept: settings cannot reach a gate under either reading.

### MUST

- **M1 Declare.** `/3` gains an optional top-level `settings` map in `pack.json` (additive within `/3`: P1 line 206, 6.7 point 4). Each setting has a name, a one-line `summary` (owner-facing), a `type` and an optional `default`. No default means required (one rule; Terraform precedent, R§2 pattern 2, A9). Setting names are lower-case kebab-case (`docs-folder`), the existing `Slug` rule (`pack-format.ts:14`). Types in MUST, traced to the roadmap's three examples (line 156): `text` (one line; this is what "the test command" becomes), `path` and `paths` (one or several project-relative folders or files; "the file layout"), and `severity` ("the hold severity"). Defaults obey the declared type's rules exactly as owner values do. A `text` value is at most 200 characters (a constant, not a declaration key). The declaration is expressible as a JSON Schema fragment so Item 6 can reuse it (R§3.2). Hidden characters and line breaks are refused in declarations, defaults and values by the existing `Sentence`/`hasHidden` rules (R§1.1). A value or default containing `{{` or `}}` is also refused, so an owner's value can never expand into a later `{{task.x}}` and pull untrusted tracker text into an owner-trusted place (architecture section 7, R§1.4).
- **M2 Supply.** One new top-level key in `delivery.config.json`, `packSettings`, keyed by pack name then setting name, working the same for built-in, listed and installed packs (R§1.3: none of the last two are named in the config; `packs` is a list of folder paths and cannot carry values). Values are plain JSON values of the declared type.
- **M3 Unset required is refused, naming it.** Refused at configuration load, before any agent call, exit 2, same class as the existing clash and unusable-pack refusals. The message names the pack, the setting, its summary, and the exact lines to add (roadmap lines 158-159). **Scope, stated plainly:** any unset required setting of any pack the project uses stops **every** command that loads the project for work, `delivery run`, `delivery review` and `delivery validate`, not only that pack's workflows (architecture section 7: a lazy, per-workflow refusal was rejected because it yields a misleading "unknown workflow"). That includes scheduled unattended runs. Commands that never refuse for a missing value: `delivery packs`, `packs inspect`, `packs add`, `packs update`, `packs restore`, `packs remove`, `packs approve`, so the owner can always reach the command that says what to set (J1; R§4 A5).
- **M4 Owner-side errors, all at once.** `packSettings` naming a pack the project does not use; a setting the pack does not declare (lists the declared names); a value of the wrong type; a value that is not a severity (and, with S1, a value outside a `choice` list, or a number that is not a whole number); a `path` that is absolute, leaves the project or names `.git`; a value with `{{`, `}}`, a line break or a hidden character. Each names pack, setting and what is accepted. A value for a pack not in the project is a refusal, never silently ignored (silent ignore hides typos).
- **M5 Values reach the prompts.** `{{settings.<name>}}` in a pack prompt is replaced by the resolved value. Resolved when the pack is bound to the project, before the run pins its workflow, so the pinned prompts and hold hold the values and a resumed run is byte-identical (R§1.4, R§3.1). A `{{settings.x}}` for an undeclared x is refused at pack load by file and field (closes R§4 A12 for new packs; the existing reservation was unenforced). Existing `/2` and `/3` packs without settings are unchanged.
- **M6 Hold severity is a setting.** An act may name a `severity` setting for its hold with a new optional act key `holdSetting` (for example `"holdSetting": "hold-from"`). The author writes no literal `hold` in that act (the two are mutually exclusive, a loader rule); the default lives on the severity setting (`"hold-from": { "type": "severity", "summary": "...", "default": "high" }`). The owner can then raise or lower the point at which a change waits for sign-off (Roadmap lines 156-157). A lowered hold counts as narrower, a lifted one as wider, using the existing direction logic (R§3.1, `compare.ts:28-37`). The only new published pack line is `workflows.*.holdSetting` (optional): a union or optional `atOrAbove` would lose a promised line (researcher's test; architecture section 4).
- **M7 The value is data, never a command.** Resolved values are inserted into prompt text and hold only. They are never passed to a shell, never choose a gate, closer, tool or agent option. Packs stay data only (Roadmap lines 16-18 and Item 1 "Constraints" line 87; `DATA_ONLY`, R§1.1; D1 inherited, assumed).
- **M8 Inspection shows settings and what would apply.** `delivery packs inspect` gains a "Settings" section directly after "In short": per setting, name, plain summary, type, default, value in effect, source ("default" or "your configuration" or "not set: required"), and what it changes ("what the agent is told", "how far it goes before it asks you"). The verbatim instructions show the resolved text with the placeholder visible beside it. For a pack the project does not name, or outside a project: defaults only, saying so. For a `.js` project configuration: "values not read, your configuration is code" (R§1.3). The JSON document gains an always-present `settings` array, empty when none (R§1.7, test forbids optional keys).
- **M9 The update report covers settings.** `delivery packs update` reports a new required setting, a new optional setting, a removed setting and a changed default, each in the same four-part report as other changes, hold defaults with a direction (R§1.7, A13). A new required setting is also listed with the lines to add and the warning that runs will stop until it is given (5.6).
- **M10 Fixtures can prove a pack that has settings.** `delivery packs check` must work for a pack with required settings: it uses the defaults and takes values for required ones from the pack's own fixtures; if none are given, it says which setting needs a fixture value and how. It never fails with a bare internal error (R§1.8, A11; the file layout of fixture values is the architect's).
- **M11 Settings and task fields: decision.** They share **one placeholder syntax and one substitution function** (`{{settings.x}}` beside `{{task.x}}`, R§3.4 mechanical overlap; P1 6.7 point 3) and are **two kinds of data**: a setting is declared, typed, validated, owner-written and trusted, per project; a task field is free-form, per task and untrusted. A pack cannot make a setting read a task field or the reverse. Why: merging the models would put tracker-written text into places the owner trusts (R§1.4 inference, R§2 pattern 5). Documented in the packs page and `writing-a-pack.md`.

**Item 9 outcome, plainly:** the roadmap says a shared mechanism "removes the commonest reason for a custom gate" (lines 171-173). Settings alone remove **no** custom gate: the surveyed gates existed to read per-task fields (`file`, `package`, `to`), and a pack carries no gate (R§3.3). Only per-task fields reaching the **project's** command gate would, and that is an engine change to a separate subsystem that this item does not ship (C7). Item 9 is therefore not re-scoped by this item; the principle for the later change (fields reach a command as parameters or environment variables, never as shell text) is recorded in the architecture.
- **M12 Honest limits, in words.** The documentation and the inspection text say: a pack setting changes what the agent is told and, for hold, when it waits; it does not change the project's own check. A "test command" setting is text the agent is told about running tests; it is not the command the harness runs to judge the work (R§4 A2, D1 (inherited, assumed)). The owner's values are not part of the pack fingerprint: changing them needs no new approval, and version control is the record (R§3.1, install design line 120).
- **M13 Documentation** (section 8) and the glossary word.
- **M14 Existing behaviour proven unchanged.** Every built-in and fixture pack without `settings` loads, inspects, fingerprints and runs as before (Roadmap Item 1 criterion 4 spirit; additive rule P1 line 206).

### SHOULD

- **S1 More types: `choice`, `number`, `boolean`.** Closed and cheap; each is checked by the same declaration rules. Traced to Priya's goal of one pack that fits many projects (a mode switch, a limit, a flag), not to a roadmap example, which is why they are not MUST. If the build must shrink, these go first.
- **S2 `delivery packs` marks packs that need an answer** ("needs setting: docs-folder"), so Dana sees it before running (Dana; J1). Home: architecture section 11 "Listing" (`PackRow.needs`).
- **S3 The "Before you run this" block on `packs add`** and a ready-to-paste snippet in `packs inspect` for every setting with no value (Dana; J1, J3). The refusal in 5.2 already carries the snippet (MUST), so the add-time block is the early warning. Home: architecture sections 7 and 11 (one list of unmet settings feeds the add block, the inspect snippet, the refusal, the listing and update).
- **S4 `delivery preview` shows the resolved step text** and says which values came from the default (Marcus, Dana; R§1.8).
- **S5 The built-in `deprecations` gains `old-module`, `new-module` and `hold-from` settings**, as P1 line 252 promised and the architecture already plans, and is the worked example in the docs. It is the one real exercise of the feature in the product itself (Priya; J4).
- **S6 `--json` from `packs add` and `update` carries the setting changes** (as the Item 3 SHOULD).

### COULD

- **C1** A longer `paths` rendering or structured (object) settings, if a real pack needs them.
- **C2** A warning at run when a task placeholder has no matching field (today only `preview` warns, R§1.4).
- **C3** `delivery packs settings <pack>` printing only the settings section.
- **C4** Second built-in, documentation drift, using a `path` setting (P1 C1).
- **C5** Per-workflow scoping of a setting (the keyed-object shape leaves room, P1 6.7 point 2).
- **C6 A boolean setting switches a named guard on** (`guards.addWhen`). Deferred, not rejected; architecture A3. Reason: no persona example, and hold already gives the owner one real control over how far a pack goes.
- **C7 Task fields visible to the project's command gate.** Beneficiary is the project's own gate, not a pack gate (D1). It is an engine change in a separate subsystem (R§1.5) with its own injection risk, so it should be its own change with its own tests; architecture A5 agrees. Decision on the Item 9 consequence is in M11.

## 5. UX flows

All output: plain lines, no box drawing, no colour carrying meaning, readable at 60 columns, British English, glossary vocabulary, cause first, never "safe", "valid", "verified" (the inspect and install rules, `inspect-a-pack` P§6).

### 5.1 Add (J1; S3, the early warning; the refusal in 5.2 is the MUST)

After the Item 3 account and the question, and only when a required setting has no value:

```
Added docs-drift 1.0.0.
It will not run until you give it 1 setting.
  docs-folder: the folder that holds your documentation.
Add this to delivery.config.json, replacing the dots:
  "packSettings": { "docs-drift": { "docs-folder": "..." } }
Then run: delivery validate
```

Exit 0. The pack was added; it cannot be run yet.

### 5.2 Unset required setting (J2)

```
Nothing can run yet: the pack docs-drift needs a setting you have not given.
This stops every run in this project, not only docs-drift,
so that a half-set-up project never starts.
  docs-folder: the folder that holds your documentation.
Add this to delivery.config.json, replacing the dots:
  "packSettings": { "docs-drift": { "docs-folder": "..." } }
Nothing was run.
```

This applies to scheduled runs as well.
Several unset settings are listed together, one block each. Exit 2.

### 5.3 Bad values and names (M4)

```
delivery.config.json: packSettings
  docs-drift: "docs-foler" is not a setting of this pack.
              Its settings are: docs-folder, hold-from.
  docs-drift.hold-from: "urgent" is not a severity.
              Use one of: low, medium, high, critical.
  docs-drift.docs-folder: "/etc" is not inside this project.
              Give a folder inside the project, such as "docs".
  linter: no pack called linter is used by this project.
              Packs in use: docs-drift, deprecations.
Nothing was run.
```

A value of the wrong type: `docs-drift.max-ideas: "ten" is not a number. Give a whole number, such as 10.`

### 5.4 Pack author errors (J4)

```
packs/docs-drift/pack.json: settings.docs-folder
  has no summary. Say in one line what it is for.
packs/docs-drift/docs.md: uses {{settings.docs-foldr}}
  but pack.json declares no setting of that name.
  Declared: docs-folder.
```

An unknown key inside a setting declaration keeps the existing "not part of the pack format" sentence.

### 5.5 Inspection (J3, J6)

Directly after "In short":

```
Settings (2)
  docs-folder   path, required
    The folder that holds your documentation.
    Your value: docs (your configuration)
    Changes: what the agent is told.
  hold-from     severity, default high
    The point at which a change waits for your sign-off.
    Your value: high (default)
    Changes: how far it goes before it asks you.
These change what the agent is told and when it waits.
They do not change your project's own check.
```

States: unset required prints `Your value: not set. Required: this pack will not run until you give one.` plus the snippet. Pack not used by the project: `Values shown are the pack's defaults. This project does not use the pack.` Outside a project: `No project found. Values shown are defaults.` Code configuration: `Your configuration is code, so its values were not read.` The instructions section shows each resolved line with `{{settings.docs-folder}}` kept visible next to the value, so the reader sees both the pack's words and what the agent gets. A value that holds hidden characters is refused at load, not shown.

### 5.6 Update (J5)

A "Settings" part within the existing report. When the update adds a required setting it ends with: `Until you add it, every run in this project will stop, including scheduled runs.` Entries: `New, needs a value: docs-folder.` `New, has a default: max-ideas (10).` `Default changed: hold-from, high to critical. A change now waits for sign-off only at critical: this lets more through.` `Removed: old-folder. Your configuration still names it: remove that line.` (The last is also a refusal at load, M4.)

### 5.7 Preview (S4)

`delivery preview` prints the step text with values resolved and the line `Settings used: docs-folder = docs (your configuration).`

## 6. Empty, error and edge states

| Situation | What happens |
|---|---|
| Pack has no `settings` | No Settings section noise: inspection prints `This pack has no settings.` once; config needs nothing |
| All settings have defaults, no `packSettings` | Pack runs; inspection says every value is the default |
| Required unset | 5.2; exit 2; no agent call |
| Unknown pack or setting name | 5.3; lists valid names |
| Wrong type or out-of-list value | 5.3; says what is accepted |
| Value with line break or hidden character | Refused naming pack and setting; the text is not printed |
| Pack updated adds required setting | Update succeeds; run refused until value given (5.1, 5.2) |
| Pack removed but `packSettings` still names it | Refused with M4 sentence; `remove` names the lines to delete |
| Configuration is `.js` | Values read at run; inspection says not read |
| `packs check` with required setting and no fixture value | M10: names the setting and how to give a fixture value |
| Config changed mid-run | The run keeps its pinned text (M5) |

## 7. Buy-versus-build (Wardley view)

| Part | Position | Decision |
|---|---|---|
| Declared, typed, defaulted parameters | Commodity: Helm values schema, Terraform variables (no default means required), VS Code `contributes.configuration` (R§2) | Copy the shape, not the code. Required-by-absent-default from Terraform; type plus summary plus default from VS Code; declaration expressible as a JSON Schema fragment as in Helm |
| Validation | Commodity in estate: zod, `Sentence`, `hasHidden` (R§1.1) | Reuse. No new library |
| Placeholder substitution | Estate: `interpolateTask` (R§1.4) | Extend the one function (P1 6.7 point 3); no template engine (Helm's `required`, Jinja, Sprig add power a data-only pack must not have) |
| Refusal wording | Estate: clash and unusable-pack sentences | Same class and exit code |
| Config schema and completion | Item 6 | Not built here; M1 keeps declarations schema-friendly |
| Passing task fields to a gate | Estate: `runShell` positional parameters (R§1.5) | C7, later, reuses it; Actions' script injection (R§2) is the cautionary tale |
| Secrets | Commodity elsewhere; not wanted here | Non-goal |

## 8. Documentation needed

Packs page (new "Settings" section, first paragraph says what a setting is and is not), `writing-a-pack.md` (declaring, placeholders, defaults, the limits in M12, setting versus task field with the M11 reasoning), configuration reference (`packSettings`), glossary ("pack setting" versus project configuration), `delivery packs` and CLI help, worked example from `deprecations` (S5), changeset (minor), and a note on the pack format page listing the new `/3` keys under the published-keys promise.

## 9. Success metrics checkable in the repository

1. A fixture pack declaring one required and one defaulted setting: with no value, a run exits 2 before any scripted-agent call and the output contains pack, setting, summary and the snippet; with the value, the pinned workflow prompt contains it byte for byte.
2. Every refusal in 5.3 and 5.4 is a test with its exact sentence; all problems reported at once.
3. `hold` from a severity setting: default, owner value and a changed default each produce the expected `heldFor` result and update direction.
4. `packs`, `packs inspect`, `add`, `update`, `restore`, `remove` pass with a required setting unset.
5. Inspection text and `--json` carry the same settings facts; the JSON key lines are in the published-keys file; no key is optional.
6. Owner values do not change `Pack.hash`; a declaration change does.
7. No resolved value reaches a shell: a test with a value containing shell metacharacters writes no marker file. A value or default containing `{{task.x}}`, `{{` or `}}` is refused, and a test with a tracker-written task field never appears inside a bound setting value.
7a. Setting names that are not kebab-case are refused by the pack loader with the existing `Slug` sentence; every example in the docs uses kebab-case.
7b. An unset required setting in a pack the project uses stops `run`, `review` and `validate` for a workflow of a different pack; `packs`, `packs inspect`, `add`, `update`, `restore`, `remove` and `approve` still exit 0.
8. The vocabulary test forbids "safe", "valid", "verified" in new output; lines are at most 60 columns.
9. Every pack in `packs/` and fixtures without `settings` is unchanged in hash, inspection and run.
10. A resumed run after a configuration change reproduces the original prompt.
11. Docs build: the packs page and `writing-a-pack.md` mention `packSettings`, `{{settings.`, and the M12 limits (grep test of the existing doc checks).

## 10. Operability and DX

Developed with the existing red/green suite: command tests in process, the scripted agent for end-to-end, no network, no new service. Verified in the existing gate (lint, build, vitest). Deployed in the existing `delivery-service` package through the changeset flow (minor). Runs the same on every machine because values live in the committed configuration and are pinned into the run. Failure always yields one plain sentence and one next action. Reuses the loader, the refusal class, `interpolateTask`, the published-keys tests and `comparePacks`; the ledger is the architect's.

## 11. Assumptions and open points

1. The owner key name `packSettings` (agreed with the architect).
2. Types in MUST are `text`, `path`, `paths`, `severity`: assumed sufficient for the roadmap's three examples (test command as text, file layout as path or paths, hold as severity). `choice`, `number`, `boolean` are S1; the architecture ships all seven types, which is accepted as long as the documents tier them as here.
3. Hold-by-setting uses the act key `holdSetting` (M6); additive in `/3`, one new optional published line. Settled with the architect (architecture section 4).
4. M10: fixture values come from an optional `fixtures/settings.json` (architecture section 12).
5. Reading of roadmap criterion 3 (prompts plus hold) is an assumption; see Derived minimum scope.

## 12. What this design does not include

- Secrets or credentials as settings, and values taken from environment variables: they conflict with a committed configuration and with prompts shown by inspection and preview (R§2 pattern 6, A8).
- A pack choosing or changing the gate, closer, tools or agent options through a setting; a setting used as a shell command (D1 (inherited, assumed); `DATA_ONLY`).
- Task fields as a declared, validated mechanism: they stay free-form and untrusted (M11).
- Task fields reaching the project's command gate (C7), and any claim that this item re-scopes Item 9: it does not (M11).
- Guards switched by a setting (C6).
- Gate-carrying packs and code plugins: Items 7 to 9.
- Editor completion and diagnostics for `packSettings`: Item 6 (M1 keeps the declaration schema-friendly).
- Scaffolding, a starting pack, publishing: Item 5.
- Per-workflow scoping of a setting, list-valued and structured settings (C1, C5 only if pulled in).
- Interactive prompting for missing values; a command that writes the configuration for the owner.
- Putting owner values into the approval fingerprint or recording who set them.
- Changes to the settings of an installed pack's folder in place: an installed pack is edited only through `update`.
- Any claim that a pack with settings, or an owner's values, is safe.
