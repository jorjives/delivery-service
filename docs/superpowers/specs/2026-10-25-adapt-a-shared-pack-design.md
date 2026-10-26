# Delivery Service: Adapt a Shared Pack to My Project: Design

> **Roadmap:** `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` — Item 4
> **Status:** Draft, awaiting slicing
> **Created:** 2026-10-25
> **Builds on:** packs for any workflow (`2026-10-23-packs-for-any-workflow-design.md`, the `/3` format and section 6.7), inspect a pack (`2026-10-23-inspect-a-pack-design.md`), install a pack from elsewhere (`2026-10-24-install-a-pack-from-elsewhere-design.md`).
> **Audit trail:** `docs/prd/2026-10-25-adapt-a-shared-pack/` (`research.md` cited as R§n, `product-design.md` as P§n, `architecture.md` as A§n). Where this document and an approved artefact differ in detail, the artefact wins.

## 1. Problem

A pack written for someone else's project says things that are true only there: the module being retired, the folder that holds the documents, how serious a change must be before it waits for sign-off. Today an owner can only edit or fork the pack, which defeats install-at-a-pinned-version (Item 3) and the approval that Item 2 inspection supports. Items 5 (publish) and 6 (editor support) both depend on the answer.

Opportunity: a pack declares what varies; the owner answers in the configuration file they already have; the tool refuses, in words, when an answer is missing; inspection shows what the pack asks and what it would be told. Packs stay data (roadmap lines 16-18; Item 1 Constraints).

## 2. Personas and goals

From `docs/personas.md` (team-derived, not human-confirmed; no persona was added or changed).

| Persona | Goal | Success |
|---|---|---|
| Dana Okafor, non-technical owner | Make someone else's pack work in her project without editing it | Adds named lines to her configuration; reads a refusal that names the missing one; sees on one screen what each setting changes |
| Priya Shah, extender | Write one pack that fits many projects | Declares settings with defaults; a wrong declaration or placeholder is refused by file and field; proves the pack with the scripted agent |
| Marcus Webb, on-call engineer | Know which values the agent was given for a held change | Inspection and preview show each value in effect and whether it came from the default or the configuration |

## 3. Goals and success metrics

Checkable in the repository (P§9):

1. A fixture pack with one required and one defaulted setting: with no value a run exits 2 before any scripted-agent call, naming pack, setting, summary and the lines to add; with a value, the pinned prompt contains it byte for byte.
2. Every refusal in section 5.3 and 5.4 is a test with its exact sentence; all problems at once.
3. A hold taken from a setting gives the expected `heldFor` result for the default, an owner value and a changed default.
4. `packs`, `packs inspect`, `add`, `update`, `restore`, `remove`, `approve` exit 0 with a required setting unset; `run`, `review`, `validate` refuse.
5. Inspection text and `--json` carry the same settings facts; new keys are in the published-keys files and none is optional.
6. Owner values never change a pack's hash; a declaration change does.
7. A value of shell metacharacters through a full scripted run writes no marker file, and no command the harness ran differs from the one it would have run without the value. A value or default with `{{`, `}}`, a line break or a hidden character is refused, and a tracker-written task field never appears inside a bound setting value.
7a. Setting names that are not kebab-case are refused by the pack loader with the existing `Slug` sentence; every example in the docs uses kebab-case.
7b. An unset required setting in a pack the project uses stops `run`, `review` and `validate` for a workflow of a different pack; `packs`, `packs inspect`, `add`, `update`, `restore`, `remove` and `approve` still exit 0.
7c. The vocabulary test forbids "safe", "valid", "verified" in new output; lines are at most 60 columns.
8. Every pack and fixture without `settings` is unchanged in hash, inspection and run. A resumed run after a configuration change reproduces its original prompt.
9. Docs tests: the packs page and `writing-a-pack.md` name `packSettings`, `{{settings.` and the limits in M12.

## 4. Scope

### 4.1 Derived minimum scope (assumed, not human-confirmed)

M1 to M14 below are the derived minimum scope. They were inferred from the four Item 4 success criteria (roadmap lines 155-161) and Notes (169-173), not confirmed by a human.

**Assumed reading of criterion 3** ("values reach the pack's prompts and checks", line 160): in `/3` a pack owns no check. Item checks are harness-owned and written by the scan agent; guards are a closed list; a pack carries no gate (D1 from the packs-for-any-workflow design, line 198, an inherited decision no human confirmed). So "checks" is read as: values reach the **prompts** (including the scan prompt, which is how a path setting tells the scanner where a check applies) and the **hold threshold**. A value never becomes a command the harness runs. The documentation and inspection say this in these words (M12).

### 4.2 MUST

| # | Capability |
|---|---|
| M1 | **Declare.** `/3` gains an optional top-level `settings` map. Each setting has a kebab-case name (the existing `Slug` rule), a one-line `summary`, a `type` and an optional `default`. No default means required. MUST types: `text` (one line, at most 200 characters), `path`, `paths`, `severity`. Hidden characters, line breaks, `{{` and `}}` are refused in declarations, defaults and values |
| M2 | **Supply.** A new `packSettings` key in `delivery.config.json`, keyed by pack name then setting name, working for built-in, listed and installed packs (none of the last two are named in the configuration, so the existing `packs` list cannot carry values) |
| M3 | **Unset required is refused, naming it.** At configuration load, before any agent call, exit 2. The refusal stops **every** command that loads the project for work (`run`, `review`, `validate`), including scheduled runs, not only the pack's own workflows. `packs`, `packs inspect`, `add`, `update`, `restore`, `remove`, `approve` never refuse for it |
| M4 | **Owner-side errors, all at once:** a pack the project does not use, an undeclared setting (lists the declared names), a wrong type, a value that is not a severity (and, with S1, outside a `choice` list or not a whole number), a path that is absolute, leaves the project or names `.git`, a value with `{{`, `}}`, a line break or a hidden character. A value for a pack not in the project is refused, never ignored |
| M5 | **Values reach prompts.** `{{settings.<name>}}` is replaced when the pack is bound to the project, before the run pins its workflow. `{{settings.x}}` for an undeclared x is refused at pack load by file and field |
| M6 | **Hold severity is a setting** through a new optional act key `holdSetting` naming a `severity` setting. `hold` and `holdSetting` are mutually exclusive on one act. The only new published pack line for this is `workflows.*.holdSetting` (a union or an optional `atOrAbove` would lose a promised line; researcher's test; A§4) |
| M7 | **A value is data, never a command.** Inserted into prompt text and hold only; never passed to a shell, never chooses a gate, closer, tool or agent option |
| M8 | **Inspection shows settings and what would apply:** a Settings section after "In short" with name, summary, type, default, value in effect, source, and what it changes; the instructions show the resolved text with the placeholder visible beside it. JSON gains an always-present `settings` array |
| M9 | **The update report covers settings:** new required setting, new optional setting, removed setting, changed default, hold defaults with a direction |
| M10 | **Fixtures can prove a pack with settings:** `delivery packs check` takes values from an optional `fixtures/settings.json`; a required setting with no fixture value is a named problem, never a bare internal error |
| M11 | **Settings and task fields: one placeholder syntax and one renderer module, two data models.** A setting is declared, typed, validated, owner-written and trusted; a task field is free-form, per task and untrusted. Neither can read the other |
| M12 | **Honest limits, in words:** a setting changes what the agent is told and when a change waits; it does not change the project's own check; a "test command" setting is text the agent is told about, not the command the harness runs; owner values are outside the approval fingerprint, version control is the record |
| M13 | **Documentation** (section 5.8) and the glossary word "pack setting" |
| M14 | **Existing behaviour unchanged:** every pack without `settings` loads, inspects, hashes and runs as before |

### 4.3 SHOULD

- S1: types `choice`, `number` (whole numbers), `boolean`. First to be cut if the build must shrink.
- S2: `delivery packs` marks packs that need an answer.
- S3: a "Before you run this" block on `packs add` and a ready-to-paste snippet in `packs inspect` for each unset setting.
- S4: `delivery preview` shows the resolved step text and which values came from defaults.
- S5: built-in `deprecations` gains `old-module`, `new-module`, `hold-from` settings, as the worked example (anticipated by the packs-for-any-workflow design line 252).
- S6: `--json` of `packs add` and `update` carries setting changes.

### 4.4 COULD

C1 longer `paths` renderings or structured settings; C2 a run-time warning for a task placeholder with no field; C3 `delivery packs settings <pack>`; C4 a second built-in (documentation drift) using a `path` setting; C5 per-workflow scoping; C6 a boolean setting that switches a named guard on; C7 task fields reaching the project's own command gate as environment variables (designed in A§15, not built).

### 4.5 Non-goals (what this design does not include)

- Secrets or credentials as settings, and values from environment variables: they conflict with a committed configuration and with prompts shown by inspection and preview (A§5).
- A pack choosing or changing a gate, closer, tools or agent options through a setting; a setting used as a shell command.
- Task fields as a declared, validated mechanism; task fields reaching the project's command gate (C7); any re-scoping of Item 9. Settings alone remove no custom gate: the surveyed gates read per-task fields (R§3.3, A§3).
- Guards switched by a setting (C6); per-workflow scoping, list-valued or structured settings beyond `paths` (C1, C5).
- Gate-carrying packs and code plugins (Items 7 to 9); editor completion for `packSettings` (Item 6; the declarations stay schema-friendly); scaffolding and publishing (Item 5).
- Interactive prompting for missing values; a command that writes the configuration for the owner.
- Owner values in the approval fingerprint or lock, or recording who set them.
- Editing an installed pack's settings in place; installed packs change only through `update`.
- Any claim that a pack with settings, or an owner's values, is safe.

## 5. UX / Product

All output: plain lines, no box drawing, no colour carrying meaning, readable at 60 columns, British English, glossary vocabulary, cause first, never "safe", "valid", "verified".

### 5.1 Journeys

- **J1 Dana adds a pack that needs answers.** `packs add` prints the Item 3 account, then a block listing each setting with no default and the lines to add. She edits `delivery.config.json`, runs `delivery validate`, then her usual run.
- **J2 Dana forgets one.** The run is refused before any agent call, naming pack, setting, its purpose and the lines to add.
- **J3 Dana checks before trusting.** `packs inspect` shows the settings table, each value and its source, and the instructions as the agent would be given them.
- **J4 Priya declares settings.** She adds `settings` to `pack.json`, uses `{{settings.docs-folder}}` in a prompt, and `packs check` proves it with fixture values.
- **J5 Dana updates a pack whose settings changed.** `packs update` reports new required settings, changed defaults and removed settings in the existing report, with direction for hold.
- **J6 Marcus reads a held change.** Inspection shows the hold threshold in effect and its source.
- **J7 Priya wants per-task values.** She keeps `{{task.file}}`; the documentation explains why that is not a setting.

### 5.2 Add (S3) and unset required setting (M3)

```text
Added docs-drift 1.0.0.
It will not run until you give it 1 setting.
  docs-folder: the folder that holds your documentation.
Add this to delivery.config.json, replacing the dots:
  "packSettings": { "docs-drift": { "docs-folder": "..." } }
Then run: delivery validate
```

```text
Nothing can run yet: the pack docs-drift needs a setting you have not given.
This stops every run in this project, not only docs-drift,
so that a half-set-up project never starts.
  docs-folder: the folder that holds your documentation.
Add this to delivery.config.json, replacing the dots:
  "packSettings": { "docs-drift": { "docs-folder": "..." } }
Nothing was run.
```

Exit 0 for add (the pack was added); exit 2 for the refusal, which also applies to scheduled runs. Several unset settings are listed together.

### 5.3 Bad values and names (M4)

```text
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

A wrong type: `docs-drift.max-ideas: "ten" is not a number. Give a whole number, such as 10.`

### 5.4 Pack author errors (J4)

```text
packs/docs-drift/pack.json: settings.docs-folder
  has no summary. Say in one line what it is for.
packs/docs-drift/docs.md: uses {{settings.docs-foldr}}
  but pack.json declares no setting of that name.
  Declared: docs-folder.
```

An unknown key inside a declaration keeps the existing "not part of the pack format" sentence.

### 5.5 Inspection (M8)

```text
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

States: unset required prints `Your value: not set. Required: this pack will not run until you give one.` plus the snippet; a pack the project does not use prints `Values shown are the pack's defaults. This project does not use the pack.`; outside a project `No project found. Values shown are defaults.`; a code (`.js`) configuration prints `Your configuration is code, so its values were not read.` A pack with no settings prints `This pack has no settings.` once.

### 5.6 Update (M9) and preview (S4)

Within the existing report: `New, needs a value: docs-folder.` (ending with `Until you add it, every run in this project will stop, including scheduled runs.`); `New, has a default: max-ideas (10).`; `Default changed: hold-from, high to critical. A change now waits for sign-off only at critical: this lets more through.`; `Removed: old-folder. Your configuration still names it: remove that line.` `delivery preview` prints the resolved step text and `Settings used: docs-folder = docs (your configuration).`

### 5.7 Empty, error and edge states

| Situation | What happens |
|---|---|
| All settings have defaults, no `packSettings` | Pack runs; inspection says every value is the default |
| Pack removed but `packSettings` still names it | Refused with the M4 sentence; `remove` names the lines to delete |
| Value with a line break or hidden character | Refused naming pack and setting; the text is not printed |
| `packs check` with a required setting and no fixture value | Names the setting and the fixture file to add |
| Pack updated adds a required setting | Update succeeds; run refused until a value is given (5.1, 5.2) |
| Configuration is `.js` | Values read at run; inspection says not read |
| Configuration changed mid-run | The run keeps its pinned text |

### 5.8 Documentation

Packs page gains a Settings section (first paragraph says what a setting is and is not); `writing-a-pack.md` (declaring, placeholders, defaults, the M12 limits, setting versus task field with the M11 reasoning); configuration reference (`packSettings`); glossary ("pack setting" versus the project configuration, which the code calls "settings"); `delivery packs` and CLI help; the `deprecations` worked example; a changeset (minor); the new `/3` keys under the published-keys promise.

## 6. Architecture

### 6.1 Position

A pack declares settings. The owner supplies values in `delivery.config.json`. When a project's packs are loaded each pack is **bound** to its values by one pure function, which renders `{{settings.<name>}}` in the authored prompt text and resolves a `severity` setting into the act's hold. The result is the `WorkflowConfig` the engine already runs. **No change to the engine, guards, case file, report or run record.** A run pins the bound workflow at create, so a resumed run is byte-identical whatever the configuration says later. A pack without `settings` binds to itself unchanged (A§1).

### 6.2 Constraints and provenance

| Constraint | Source |
|---|---|
| Packs are data only | Roadmap lines 16-18; Item 1 Constraints (line 87); `DATA_ONLY` (`manifest.ts:114-115`) |
| A pack names no gate, agent, closer or `after` | Not a governing constraint: D1 of the packs-for-any-workflow design (line 198), inherited, unconfirmed; roadmap lines 17-18 arguably allow "choices from built-in gates and closers". Kept, not reopened; settings cannot reach a gate under either reading |
| Settings additive within `/3`, not a second format | Roadmap Item 4 Notes (line 169); packs-for-any-workflow M9 and 6.7 |
| Additive: new optional key, new `kind`, new enum member, relaxed rule | Packs-for-any-workflow design line 206 |
| Published-keys promise holds per version; every promised line stays | Packs-for-any-workflow design line 39; `pack-published-keys.txt` |
| Inspection keys are published and none may be optional | `inspection-schema.test.ts:32-38` |
| Fingerprint covers `pack.json` and prompts; approval binds to it | `digests.ts:7`, `lock.ts:12-34`; install design lines 60-63 |
| `assemblePrompt` is pure of the case file | `prompt-assembly.ts:189-191` |

### 6.3 Settings and task fields (decision, M11)

One placeholder grammar `{{<namespace>.<name>}}` and one module (`src/placeholders.ts`, extracted from `interpolateTask` and `unmatchedPlaceholders`) owning a pattern for each namespace; two data models. Settings are rendered at bind time over the pack's authored text; task fields keep rendering at assembly. Merging the models would give untrusted tracker text the validation path of owner text, or give owner values the no-validation path of task text. Settings never reach a command gate. The roadmap's claim that a shared mechanism "removes the commonest reason for a custom gate" (Notes lines 171-173) holds only for per-task fields reaching the project's own command gate (R§3.3); that engine change is C7, designed in A§15 (fields as environment variables, never spliced into command text) and not built. Item 9 is not re-scoped.

### 6.4 Manifest

New optional `settings` map (additive within `/3`), plus the act key `holdSetting`:

```json
"settings": {
  "old-module": { "type": "path",     "summary": "The module the project is moving away from." },
  "hold-from":  { "type": "severity", "summary": "Moves rated this serious or more wait for your sign-off.", "default": "high" }
},
"workflows": { "code": { "kind": "act", "prompt": "code.md", "holdSetting": "hold-from" } }
```

A prompt says `Move uses of {{settings.old-module}} to {{settings.new-module}}.` The new published lines (under `delivery.pack/3.`) are `settings`, `settings.*`, `settings.*.type` with one value line per shipped type, `settings.*.summary`, `settings.*.default` per type branch, `settings.*.values`, `settings.*.values[]` and `workflows.*.holdSetting`; none removed or changed. The reserved-key sentence for `settings` goes. `/2` is untouched and still refuses `settings`.

### 6.5 Types and validation

| Tier | Type | Value rules | Rendered as |
|---|---|---|---|
| MUST | `text` | `Sentence` rules, at most 200 characters, no `{{`/`}}` | as written |
| MUST | `path` | project-relative, `/`-separated, normalised, no `..` or `.git` segment | as written |
| MUST | `paths` | non-empty array of `path`, no duplicates, at most 32 | joined with `", "` in the owner's order |
| MUST | `severity` | a `Severity` | as written |
| SHOULD | `choice` | one of declared unique `values` | as written |
| SHOULD | `number` | integer | decimal digits |
| SHOULD | `boolean` | boolean | `true` / `false` |

A pure `settingValueSchema(declaration)` builds the zod validator; bind, `packs check`, inspection and the Item 6 schema fragment all call it. Declaration rules, reported with the other cross-reference rules and all at once: a default satisfies its own type; a `choice` default is a member; every `{{settings.<n>}}` names a declared setting; every declared setting is used by a prompt or a `holdSetting`; a `holdSetting` names a `severity` setting; an act has at most one of `hold` and `holdSetting`; at most 32 settings per pack. No `secret` type and no environment-variable values (A§5).

### 6.6 Owner values and binding

`packSettings` is a new top-level key keyed by pack name (a new key because `packs` is a list of folder paths and built-in and installed packs are never named in the configuration). The word "settings" already means the whole parsed configuration in code, hence the `pack` prefix. The static schema accepts the generic shape; per-pack typing happens at bind.

`bindSettings(pack, values)` is pure (`src/packs/settings.ts`): the applied value is the owner's, else the default, else a `missing` problem; each owner value is checked; an undeclared setting lists the declared names. On success the returned `Pack` carries rendered workflows and the resolved hold; `instructions` and `hash` are untouched. Rendering is one pass over the authored half only (the harness half is never rendered), and a value cannot contain `{{`, so it cannot re-expand into a task field.

Binding runs inside `projectPackStates` (`pack-workflows.ts:12-18`). `projectPacks` (used by `loadConfigAndPacks`, `validate`, `review`, `run`) throws one `Refusal` (`EXIT.configuration`) naming every problem at once, the same class as the clash refusal. `loadConfigAndPackStates` (used by `packs`, `add`, `update` and the other pack commands) refuses nothing. A lazy per-workflow refusal was rejected: it needs an "unconfigured pack" state in every lookup and yields a misleading "unknown workflow". `unmetSettings(pack, values)` is the one list of required settings with no value, rendered by the refusal, the add block, the inspect snippet, the listing marker and the update warning.

### 6.7 Safety

Trust order: the owner (trusted), the approved pack author (trusted after approval), a tracker task field (untrusted). The owner can already put free text before every agent (`domain`, `agent.append`), so the rules guard against accident, review evasion and cross-namespace surprise. Prompt text: single line, no hidden characters, no `{{`/`}}`, bounded length. Shell, gate, setup, teardown, closer, `after`: no path exists; primary evidence is a behavioural test (section 3, metric 7), with a structural import check as secondary. Paths: the rules make `path` honest for a later consumer.

### 6.8 Approval and pinning (decision)

Owner values do not alter the fingerprint or the lock. The fingerprint covers `pack.json` (every declaration, type, default and `holdSetting`) and the prompts, so everything the author controls about settings is approved, and a pack update that changes it goes through `update` and re-approval. Owner values are the owner's committed configuration, reviewed in version control, comparable to `domain`. Putting them in the lock was rejected (it would make the owner's own words need approval and split one configuration across two files). Inspection shows applied values with their source and the prompt as given, so the bridge between what was approved and what runs is visible. Built-in packs bind the same way.

### 6.9 Owner surfaces

All render data from `bindSettings` and `unmetSettings`, so none can disagree with a run.

- **Inspection** gains only always-present keys: `settings[]` of `{ name, type, summary, required, default, value, source, usedBy }` with `source` one of `default`, `configuration`, `unset`, `not-read`; per workflow `holdSetting` and `holdKnown`; per step `given` and `uses[]`. `hold` keeps its published type. Inspection reads data only and never runs code, hence `not-read` for `.js` configuration, no project, or a pack the project does not use.
- **Listing** `PackRow` gains an always-present `needs: string[]` (S2).
- **Add** prints the "will not run until" block and exits 0 (S3, S6).
- **Update** `Change` gains `setting-added` (with `required`), `setting-removed`, `setting-default-changed`, `setting-type-changed`; a default change that moves an applied hold is also reported through the existing `hold` kind with its direction.
- **Preview** prints `Settings used:` from the bound pack's `applied` list (S4).

### 6.10 `packs check` and fixtures

An optional fixture file `fixtures/settings.json` supplies values; `checkPack` writes it into the scratch configuration as `packSettings.<name>`, so the check passes through the door an owner uses. A pack whose settings all have defaults needs no file. `settings.json` joins the fixture file list; fixtures stay outside the fingerprint. Built-in `deprecations` gains `old-module`, `new-module`, `hold-from` (default `high`, reproducing today's behaviour; its equivalence tests stay green).

### 6.11 Errors

Pack-author faults keep `PackProblem { file, field, message }`; owner faults are `Refusal`s listing every problem. Exit 2 for refusals, 1 for unexpected faults. Content per fault is fixed in A§14; exact wording is in section 5.

### 6.12 Extensibility

Item 5: scaffold starts from `deprecations`; `settings.json` is the fixture contract. Item 6: `settingsSchemaOf(pack)` emits a JSON Schema fragment from the same zod objects, and the key shape (pack name to fixed object) lets an editor complete names and values. Item 9: settings do not remove the need for a custom gate; evidence for re-scoping is whether C7 meets the surveyed per-task cases. Later additive changes: a `none`-able severity, guard switching (C6), per-workflow scoping, more types.

## 7. Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Declared, typed, defaulted parameters | Commodity (Helm values schema, Terraform variables, VS Code `contributes.configuration`): copy the shape, not the code | Embedded Helm schema; a bought library | Required-by-absent-default from Terraform; type, summary and default from VS Code; declaration expressible as a JSON Schema fragment as in Helm (P§7) |
| Placeholder rendering | build, thin: extend `interpolateTask` into `src/placeholders.ts` | Mustache, Handlebars, Nunjucks, JS template literals | Two namespaces and one fixed grammar; a template engine brings logic and a second syntax beside `{{task.x}}`; the packs-for-any-workflow design rejected the same for the same reason |
| Declaration and value validation | reuse-estate: zod 4, one `settingValueSchema` | Embedded JSON Schema per setting (Helm), ajv | One validator already feeds manifest, config, `--schema` and the promise test; embedded JSON Schema admits regex (ReDoS) and `$ref` |
| Required vs optional | reuse prior art: Terraform's "no default means required" | Explicit `required` flag (Actions, Helm schema) | One rule, no contradictory states |
| Config layering, env-var and `.env` values | not built | `cosmiconfig`, `convict`, `dotenv` | One committed JSON source; environment values bring secrets and non-determinism |
| Owner values key | reuse-estate: `config.ts` zod and sentence style | Separate settings file; values in the lock | One configuration file; the lock stays the pack's record |
| Editor schema for settings | reuse-estate: `z.toJSONSchema` over the declarations | Hand-written JSON Schema | Single source (Item 6) |
| Path validation | build, about 10 lines on `node:path` | A path-safety package | Tiny fixed rule set |
| Refusal wording | reuse-estate: the clash and unusable-pack sentences, same class and exit code | New error class | One house style (P§7) |
| Secret handling | not built | Sensitive-value type (Terraform `sensitive`) | Sensitivity there is display-only; a committed configuration is the wrong place |
| Inspection, comparison, fixtures, scripted agent | reuse-estate: `inspectionOf`, `comparePacks`, `checkPack`, claude-mock | New settings-specific views | Extended in place |
| Approval and pinning | reuse-estate: fingerprint and lock unchanged | Include values in the fingerprint | Section 6.8 |
| Task fields to command gates | defer, decision recorded (C7); later reuses `runShell` positional parameters | Splicing into command text (Actions' script injection is the cautionary tale) | Environment-variable delivery is the safe form; separate engine change |

## 8. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git) and the vendored claude-mock. No service, credential, network or new dependency. A pack author uses a pack folder and an editor with the published pack schema through `$schema`, which now completes `settings`. An owner uses `delivery.config.json`; the project configuration has no schema yet (Item 6), so owner completion is not part of this item.

**Harness.** The single existing gate: lint, build, vitest. Every built-in pack folder runs through `checkPack` by the existing enumerating test, now with `fixtures/settings.json` where required settings exist, so a broken built-in fails the build. Third-party authors call the same `checkPack` from `delivery-service/testing`. The no-path-to-a-shell test and the published-keys tests (pack, inspection, listing, `Change`) are part of the gate.

**Scaffolding.** A new pack is a copy of `deprecations`, now the worked example of settings, a `severity` setting named by `holdSetting`, a prompt using values and a settings fixture. No scaffold command (Item 5).

**Local-run story.** An author declares a setting, sees every manifest fault by file and field at once, gives the fixture its values and watches the scripted run apply them with no key. An owner adds a pack, reads the account and the "before you run this" block, pastes the snippet, runs `inspect` to see applied values and the prompt as given, and `preview` for the exact request. A teammate pulls the repository and runs with nothing fetched.

**Deploy target.** The npm package `delivery-service`, released as a changeset minor (additive format keys, new inspection keys, new `Change` kinds, one configuration key). Nothing hosted.

**Failure modes.** Every refusal is a plain sentence naming pack, setting and the thing to add; pack commands and `inspect` keep working with a setting unset; a `.js` configuration binds at run and shows `not-read` in inspection; a stale `packSettings` entry is refused, not ignored.

**Testing.** Red first, offline through the agent mock: compatibility (existing `/2` and `/3` fixtures deep-equal, `bindSettings(pack, undefined)` identity); per-type `settingValueSchema`; each declaration rule; bind (default, override, missing, unknown, hold resolution, single-pass rendering, hash and `instructions` unchanged); configuration (`packSettings` parse, unknown pack refused, refusing versus non-refusing paths, `.js` binds at run); determinism and pinning; behavioural safety; hold; surfaces rendered from `unmetSettings`; published keys; inspection golden per `source`; `comparePacks` per change; `packs check`; docs tests. Not provable by scripted tests, and said so: how a real agent uses a rendered value.

## 9. Risks

- **Configuration bricking, including unattended runs.** A global refusal on an unset required setting stops `run`, `review` and `validate`, so an `update` that adds a required setting stops scheduled and CI runs until the owner adds a line. Accepted (section 6.6 gives the alternative's cost). Mitigations: the update sentence driven by `setting-added.required`; the add block and inspect snippet; pack commands never refuse; the change is a visible pull request.
- **Behaviour change for a `/3` pack already containing `{{settings.`:** refused after release. No built-in uses it; the reservation was documented but unenforced (R§4).
- **Task-field notice gap:** a `{{task.x}}` in the Step slot places untrusted tracker text there without the untrusted-task notice (R§1.4, inference). Not changed here; the shared module makes it a one-place fix.
- **Approved pack, owner value changes behaviour:** accepted and made visible (section 6.8).

## 10. Assumptions and open questions

Assumptions (no human confirmed any): the derived minimum scope M1 to M14 (section 4.1); the reading of criterion 3 as prompts plus hold; D1 inherited from the packs-for-any-workflow design; the key name `packSettings` and the owner word "pack setting"; size bounds (32 settings, 200 characters, 32 paths); that refusing a stale `packSettings` entry is wanted; that a global refusal on an unset required setting is acceptable (section 9); the 4,096-byte cap in the designed-not-built C7. The critic recorded no unresolved disagreement (`review-log.md`). Open for slicing: whether the SHOULD types (S1) ship in the first slice; whether Item 9 should be revisited once C7 is evaluated.
