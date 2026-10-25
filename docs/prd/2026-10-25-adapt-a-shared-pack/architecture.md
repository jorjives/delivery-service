# Architecture: Adapt a shared pack to my project (roadmap Item 4)

Architect: `architect`. Date: 2026-10-25. `R§n` is a section of `research.md` in this folder; `PD§n` a section of `product-design.md` (M, S, C numbers are its MUST, SHOULD, COULD items). Roadmap = `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` (Item 4, lines 150-173). Packs-for-any-workflow design = `...2026-10-23-packs-for-any-workflow-design.md` (cited "PFAW"). Provenance rule: a constraint cites a governing document and location; anything else is marked DECISION or ASSUMPTION.

## 1. Position

A pack declares **settings**: named, typed, documented values with optional defaults. The owner supplies values in `delivery.config.json`. At the moment a project's packs are loaded, each pack is **bound** to its values by one pure function. Binding replaces `{{settings.<name>}}` in the pack's authored prompt text and resolves a severity setting into the act's hold. The result is the same `WorkflowConfig` shape the engine already runs. **No change to the engine, the guards, the case file, the report or the run record** (PFAW 6.1 position, kept). A run pins the bound workflow at create (`workflowFrom`, `src/cli/settings.ts:133-138`; R§1.4), so a resumed run is byte-identical whatever the configuration says later.

A pack with no `settings` key is bound to itself unchanged. Every `/2` pack and every existing `/3` pack runs, hashes and inspects exactly as before.

## 2. Constraints and provenance

| Constraint | Source |
|---|---|
| Packs are data only: no code, no commands | Roadmap lines 16-18 ("Packs stay data (prompts, guards, hold policy, choices from built-in gates and closers)") and Item 1 "Constraints: Packs remain data only in this phase" (line 87); `DATA_ONLY` (`manifest.ts:114-115`; R§1.1) |
| A pack names no gate, agent, closer or `after` | **Not a governing constraint.** PFAW "D1" (line 198), an inherited decision no human confirmed; roadmap lines 17-18 arguably allow "choices from built-in gates and closers". This design keeps D1 and does not reopen it |
| Settings are additive within `/3`, not a second format | Roadmap Item 4 Notes line 169; PFAW 6.7 and M9 (R§0, R§4 A1) |
| Additive means: new optional key, new `kind`, new enum member, relaxed rule; breaking means retype, remove, make required, change meaning | PFAW line 206 (R§0) |
| Published-keys promise holds per version from first `/3` release; every promised line must stay | PFAW line 39; `pack-format.test.ts`; `pack-published-keys.txt` (R§1.1) |
| `{{settings.` is reserved in `/3` prompts and documented | PFAW 6.7 item 3; `docs/writing-a-pack.md:128` (R§1.1) |
| `hold` is an object `{ atOrAbove }` | PFAW 6.7 item 1 (this design does not use the object for the reference; see section 4) |
| Settings with defaults (test command, file layout, hold severity); owner supplies values "in the project's configuration"; unset required refused naming it; values reach prompts and checks; inspection shows settings and applying values | Roadmap lines 155-161 (examples at 156-157) |
| Inspection keys are published and none may be optional | `inspection-schema.test.ts:32-38` (R§1.7) |
| Fingerprint covers `pack.json` and prompts only; approval binds to it | `digests.ts:7`, `lock.ts:12-34` (R§1.2); install design lines 60-63 |
| A run never needs the network; approval is not re-asked at run | Install design section 8, item 8 |
| `assemblePrompt` is pure of the case file | `prompt-assembly.ts:189-191` (R§1.4) |
| Item 3 `update` compares two inspections with a direction per change | Install design line 61; `compare.ts` (R§1.7) |
| Item 6 needs settings in a project-config schema; Item 5 depends on settings | Roadmap lines 200-215, 188-190 |

## 3. Decision: do settings and task fields share one mechanism?

**One grammar and one renderer; two data models. Settings never reach a command gate.**

| Dimension | Task field `{{task.x}}` | Pack setting `{{settings.x}}` |
|---|---|---|
| Declared | No | Yes, by the pack |
| Written by | Scan agent, owner or tracker user | Owner |
| Trust | Untrusted for tracker items (R§1.4) | Trusted: committed by the owner |
| Validated | No | Yes, before any run |
| Known | Run start | Config load, before pinning |
| Rendered | At assembly, from the case file | At bind, before pinning |

Shared: the placeholder syntax `{{<namespace>.<name>}}` and a single module that owns the pattern for each namespace (`src/placeholders.ts`, extracted from `interpolateTask` and `unmatchedPlaceholders` in `prompt-assembly.ts:100-117`). The settings pass runs at bind time over the pack's authored text; the task pass keeps running at assembly. Not shared: declaration, validation, trust, lifecycle. A merged model would give untrusted tracker text the validation path of owner text, or give owner values the no-validation path of task text. Neither is acceptable.

**Gates.** A pack owns no gate (D1, inherited and unconfirmed, section 2), so no pack setting can reach one; the project's gate string stays the owner's. The roadmap's claim that a shared mechanism "removes the commonest reason for a custom gate" (Notes lines 171-173) holds only for **per-task** fields (`file`, `package`, `to`) reaching the **project's** command gate (R§3.3, R§1.5). Settings alone remove no custom gate, and a pack-carried gate (Item 9) is excluded by D1, so Item 9 is not re-scoped by this item. DECISION: this item does not change gate behaviour. The later change (PD C7, tiered COULD, agreed with product-designer) is designed in section 15 so it can be taken on evidence: task fields reach the project's command gate as environment variables, never spliced into command text.

## 4. Manifest changes (all additive within `/3`)

New optional top-level key `settings`: a map from a setting name (`Slug`, lower-case kebab-case such as `docs-folder`, `pack-format.ts:14`) to a declaration.

```json
{
  "schema": "delivery.pack/3",
  "name": "deprecations",
  "settings": {
    "old-module": { "type": "path",     "summary": "The module the project is moving away from." },
    "new-module": { "type": "path",     "summary": "The module that replaces it." },
    "hold-from":  { "type": "severity", "summary": "Moves rated this serious or more wait for your sign-off.", "default": "high" }
  },
  "workflows": {
    "code": { "kind": "act", "prompt": "code.md", "holdSetting": "hold-from" }
  }
}
```

A prompt says `Move uses of {{settings.old-module}} to {{settings.new-module}}.`

**Hold by setting.** An act gains an optional key `holdSetting`, naming a `severity` setting. Exactly one of `hold` and `holdSetting` may appear on an act (a loader rule). This is the one form that passes the published-keys promise. Verified by the researcher against `publishedKeys` (`src/report/json-schema.ts`): replacing `hold.atOrAbove`'s `Severity` with a `Severity | { setting }` union turns the promised line `delivery.pack/3.workflows.*.hold.atOrAbove: string` into `...: object|string` (`kindOf` merges branch kinds), losing a promised line; making `atOrAbove` optional turns it into `string (optional)`, also losing it. A sibling key at the act level adds exactly one line and removes none. `hold` stays as it is, so PFAW 6.7 item 1 remains true and unused by this design.

Published lines added (all new; none removed or changed), under `delivery.pack/3.`: `settings: object (optional)`, `settings.*: object`, `settings.*.type: string` with one `= "<type>"` line per shipped type, `settings.*.summary: string`, `settings.*.default: <kind>` per type branch (a union of strict branches publishes per-branch lines as `workflows.*` already does, so a later type adds lines and never alters one), `settings.*.values: array` and `settings.*.values[]: string` (choice), `workflows.*.holdSetting: string (optional)`. Exact text is generated by the test, not hand-written.

Other changes: the reserved-key sentence for `settings` (`pack-rules.ts:68`) goes, because the key now exists; the `{{settings.` reservation becomes enforcement (section 8). `/2` is untouched: `upgradeV2` yields no settings and `/2` still refuses `settings` as an unknown key.

## 5. Setting types and validation

Declaration: `{ type, summary, default? }` plus `values` for `choice`. `summary` is a `Sentence` (one line, no hidden characters; `pack-format.ts:15-19`), required because the owner reads it in errors and inspection. **No `default` means required** (Terraform's rule, R§2 pattern 2; resolves R§4 A9 with one rule and no `required` flag).

| Tier (PD) | Type | Value in config | Value rules | Rendered in a prompt as |
|---|---|---|---|---|
| MUST (M1) | `text` | string | `Sentence` rules, at most 200 characters (constant), no `{{` or `}}` | as written |
| MUST | `path` | string | project-relative, `/`-separated, normalised, not absolute, no `..` segment, no `.git` segment, no hidden characters | as written |
| MUST | `paths` | non-empty array of `path` values | each as `path`; no duplicates; at most 32 | joined with `", "` in the owner's order |
| MUST | `severity` | string | a `Severity` (`schema.ts`) | as written |
| SHOULD (S1) | `choice` | string | one of `values` (declared: unique, non-empty, each a `Sentence` without `{{`/`}}`) | as written |
| SHOULD | `number` | integer | integer; no declared bounds | decimal digits |
| SHOULD | `boolean` | boolean | boolean | `true` / `false` |

This design builds MUST and SHOULD together; the SHOULD rows are separable (their branches can be left out without touching the rest) and are cut first if the build must shrink. No declaration keys beyond the table are offered (no `maxLength`, `min`, `max`): each would be speculative and each is additive later. Structured or longer list renderings are PD C1, not built. DECISION: **no `secret` type and no environment-variable values**: the configuration is committed, bound prompts are pinned into the case file, and `preview` and inspection print them (R§4 A8). The guide states that a setting is not a place for a credential. `text` is what "the test command" becomes: prompt text telling the agent how the project runs its tests (R§4 A2); the harness never executes a setting.

Pack-author defaults are held to the value rules too (a default containing `{{` is a declaration fault). One declaration table is the single source: a pure `settingValueSchema(declaration)` builds the zod validator for an owner's value. Bind, `packs check`, inspection and the Item 6 schema fragment (section 15) all call it, so the four cannot disagree. Declaration-time rules are reported by the loader with the other cross-reference rules (`pack-rules.ts`), all at once:

- A `default` satisfies its own type and the value rules.
- A `choice` has unique values and its default is among them.
- Every `{{settings.<n>}}` in an authored prompt names a declared setting.
- Every declared setting is used by a prompt or by a `holdSetting` (a typo guard; relaxable later without a major).
- A `holdSetting` names a `severity` setting; an act has at most one of `hold` and `holdSetting`.
- A pack declares at most 32 settings (a resource bound; ASSUMPTION A2).

## 6. Where owner values live

New top-level key in `delivery.config.json`, keyed by **pack name**, then setting name:

```json
{ "packSettings": { "deprecations": { "old-module": "lib/legacy-dates.js", "new-module": "lib/dates.js", "hold-from": "medium" } } }
```

Why a new key, not an extension of `packs`: `packs` is a list of folder paths (`config.ts:210`) and built-in and installed packs are never named in the config (R§1.3), so only a by-name key covers all three origins. Why `packSettings`: "settings" already means the whole parsed configuration in code (`loadConfigAndPacks` returns `settings`, R§1.3), and the `pack` prefix keeps the two apart; the owner-facing word is "pack setting" (PD, agreed with product-designer). `CONFIG_KEYS` (`config.ts:22`) and the keyed-help table (`config.ts:286-312`) gain it. The static schema accepts `Record<Slug, Record<Slug, string | number | boolean | string[]>>`; the per-pack typing is applied at bind because it depends on which packs the project uses. The `.js` configuration form carries the same key and is bound the same way at run; inspection cannot read it (section 11).

## 7. Binding

```
bindSettings(pack: Pack, values: PackSettingValues | undefined):
  { ok: true; pack: Pack } | { ok: false; problems: SettingProblem[] }
```

Pure, in `src/packs/settings.ts`. Rules:

1. For each declared setting, the applied value is the owner's, else the default, else a `missing` problem.
2. Each owner value is checked with `settingValueSchema`; each fault is a `SettingProblem { pack, setting, kind, message }`.
3. An owner value for an undeclared setting is a problem listing the declared names.
4. On success, the returned `Pack` has `workflows` with the authored text of each step rendered, and `hold` resolved to the applied severity. `instructions` (the authored, unrendered text) and `hash` are untouched, so inspection and the fingerprint still describe what the author wrote.

Rendering is **one pass** over the authored half only. The harness half (`ideaFormat`) is never rendered. A value containing `{{` is refused by the value rules, so the later `{{task.x}}` pass cannot re-expand an owner value, and `String.replace` with a callback does not rescan its output (R§1.4).

**Where it runs.** `readPack`/`loadPack` stay project-independent (R§1.2). Binding runs inside `projectPackStates` (`pack-workflows.ts:12-18`), which already holds the config: it gains `packSettings`, binds every pack, and returns the unbound packs with their problems beside the existing `installed` states. `projectPacks` (the refusing path used by `loadConfigAndPacks`, `validate`, `review`, `run`) throws one `Refusal` (`EXIT.configuration`, field `packSettings.<pack>.<setting>`) naming **every** problem at once, before anything is sent to an agent; this is the same class and seam as the clash refusal (`withWorkflowsOf`) and `refuseUnusable`. `loadConfigAndPackStates`, used by `packs`, `packs add`, `update`, and the other pack commands, refuses nothing, so a freshly added pack with a required setting does not lock the owner out of the commands that tell them what to set (PD agreement, point c). A `packSettings` entry naming a pack that is not in the project is also a refusal, with the names of the project's packs; a stale entry is loud, not silent (config is `.strict()` for the same reason, `config.ts:220`). DECISION on laziness: refusing only when a workflow of the unbound pack is used was rejected: it needs an "unconfigured pack" state in every lookup and yields a misleading "unknown workflow".

`packs check` receives values through the same door (section 12).

**Placeholder patterns.** Setting names are kebab-case, so `{{settings.old-module}}` cannot use the task pattern `[A-Za-z0-9_]+` (`prompt-assembly.ts:100`). `src/placeholders.ts` owns two patterns, `TASK_PLACEHOLDER` (unchanged) and `SETTING_PLACEHOLDER = /\{\{settings\.([a-z0-9][a-z0-9-]*)\}\}/g` (the `Slug` rule), plus the one-pass renderer and the list-of-uses function that inspection and `preview` share. A `{{settings.` that does not match the pattern (for instance `{{settings.Docs_Folder}}`) is a declaration fault, not text left as written.

**Unmet settings as data.** `unmetSettings(pack, values): { setting, summary }[]` is the pure list of required settings with no owner value. The refusal, the `packs add` block, the `packs inspect` snippet, the listing marker and the update warning (section 11) all render this one list, so they cannot disagree about what is missing. The snippet is generated from it: `"packSettings": { "<pack>": { "<setting>": "..." } }` with one line per unmet setting, replacing the dots.

## 8. How values reach prompts, hold and checks

- **Prompts (M5).** Section 7 rendering. The `{{settings.` reservation is enforced at read time (section 5 rules): a `/3` pack that uses it without declaring it is refused. This is a behaviour change only for a hypothetical pack, justified by the documented reservation (R§1.1, R§4 A12); no built-in uses it.
- **Hold (M6).** A `holdSetting` resolves to the applied severity at bind. What an author writes: `"holdSetting": "hold-from"` on the act, with `hold-from` a `severity` setting that carries the default. No literal severity stays alongside: `hold` and `holdSetting` are mutually exclusive, so there is one source of truth for the default. The pinned workflow's `hold` is a plain `Severity` (`schema.ts:215-228`), so `heldFor` (`surface.ts:782-788`) is unchanged. Turning the hold off through a setting is not offered; a severity setting that may be `none` is an additive later change.
- **Guards (PD C6).** Not built. Closed and unchanged (`GuardName`). A later `guardsWhen` (a list of `{ setting, guard }` for boolean settings) is additive and needs only a bind rule that adds the guard.
- **Checks.** Roadmap criterion 3 says "prompts and checks" (line 160). In `/3` a pack's checks are the harness-owned item check kinds, written by the scan agent from the scan prompt (R§1.6, R§4 A3). Values reach them through the scan prompt (a `path` setting tells the scanner which folder a `pattern-absent` check applies to) and through the hold threshold. They cannot reach a gate (section 3). The guide and inspection say so in these terms, so the criterion is met as far as D1 allows and the limit is stated.

## 9. Injection and safety

Trust order: the owner (trusted, commits the value), the approved pack author (trusted after approval), a tracker task field (untrusted). Precedent: `domain` and `agent.append` already let the owner put free text before every agent (`config.ts:176-215`), so an owner value gives the owner no power they lack; the rules guard against **accident, review evasion and cross-namespace surprises**, not against the owner.

| Sink | Rule |
|---|---|
| Prompt text | Single line only (no line break, tab or hidden character; reuse `hasHidden`, `hidden-characters.ts:7-13`), so a value cannot fake a section or hide in a config diff; `{{` and `}}` refused, so no re-expansion; length bounded |
| Shell, gate command, setup, teardown, closer, `after` | **No path exists.** A setting is never an argument, an environment variable or part of a command string. **Primary evidence is behavioural** (section 18): a setting value containing shell metacharacters goes through a full scripted run and writes no marker file, and every command string the harness ran is byte-identical to the one it would have run without the value. A structural check (the settings module is imported by no gate, shell, closer or `after` code) is secondary: it is bypassable because a value travels inside bound prompt text, which is exactly why the behavioural test comes first |
| File paths the harness touches | **None at present.** The `path` rules (relative, no `..`, no `.git`) make the type honest and safe for a later consumer; they are enforced now so no value ever needs retrospective tightening |
| Secrets | Not supported (section 5); the guide says not to |
| Pack author trying to ship a value | Impossible: owner values are in project configuration, not the pack; the author's `default` is in `pack.json` and is under the fingerprint |

The pre-existing observation that a `{{task.x}}` in the Step slot places untrusted tracker text there without the `UNTRUSTED_TASK` notice (R§1.4 INFERENCE) is not changed here; the shared module makes it a one-place fix and it is listed as a risk (section 17). Settings do not worsen it: they are rendered earlier, from trusted text.

## 10. Approval hashing and install pinning

DECISION: **owner values do not alter the fingerprint or the lock record.**

- The fingerprint covers `pack.json` (which holds every declaration, type, default and `hold` reference) and the prompts (`digests.ts:7`). So everything the author controls about settings, including defaults, is approved. A pack update that adds a setting, changes a default or changes a type changes the fingerprint and goes through `update` and re-approval as any change does (R§3.1). No change to `PACK_HASH_LABEL`, `lock.ts` or `packs.lock.json`.
- Owner values are the owner's configuration, committed and reviewed in version control, the audit trail the install design names (design line 120, R§3.1 reading a). They are comparable to `domain`. Putting them in the lock was rejected: it would make a value change need "approval" of the owner's own words, and would split one project's configuration across two files.
- What the owner approved is therefore the pack **as declared, with its defaults**; what runs is that pack with the owner's values. The bridge is visible, not implicit: inspection shows applied values with their source and the bound prompt as the agent would be given it (section 11), and `delivery preview` already shows the exact prompt (R§1.8).
- Pinning: the bound prompts and hold are in the run's pinned workflow. A later configuration change does not reshape a run in progress. Nothing new is recorded; the values are recoverable from the pinned prompt text.
- Built-in packs (not fingerprinted, R§1.2) bind the same way.

## 11. Owner surfaces: inspection, listing, add, update, preview

All five render data the bind step already produced (`bindSettings`, `unmetSettings`), so none re-derives and none can disagree with a run.

**Inspection (M8).** `Inspection` (`inspection.ts:54-76`) gains, under the existing `delivery.pack-inspection/1` promise, only **always-present** keys (R§1.7 forbids optional):

- `settings`: array (empty when none declared) of `{ name, type, summary, required, default, value, source, usedBy }`. `default` and `value` are `null` when absent. `source` is `"default"` (owner gave none; the default applies), `"configuration"`, `"unset"` (required, none given) or `"not-read"` (the owner's values could not be read: a `.js` configuration, an unreadable one, no project, or a pack the project does not use; `ProjectBaseline.config` says which, R§1.3; inspection reads data only and never runs code). Under `not-read`, `value` is the default when one exists, else `null`. `usedBy` lists the local workflows that render or hold-reference the setting.
- Per workflow: `holdSetting: string | null`. `hold` keeps its published type (`null|string`, `pack-inspection-published-keys.txt:99`) and means the severity that applies, `null` for no hold. A new `holdKnown: boolean` is `false` exactly when the hold depends on a setting whose `source` is `unset` or `not-read`: with `unset`, `hold` is `null`; with `not-read`, `hold` is the declared default. So "no hold" is `hold: null, holdKnown: true`, and "cannot be known" is `holdKnown: false`.
- Per step: `given: string | null`, the prompt as the agent would be given it (authored rendered, then the harness half), `null` when any used setting has no value (`unset`, or `not-read` with no default). `instructions` stays the raw authored text. `uses: { placeholder, setting, value }[]` lists, in order of first appearance, each `{{settings.x}}` placeholder with its value, so the text renderer prints the pack's words with the placeholder visible beside what the agent gets (PD M8) and `--json` carries the same facts. The invariant `authored + harness === prompt` becomes `given === render(authored) + harness` for a bound pack and is unchanged for a pack without settings.
- Hidden-character scanning (`hiddenCharactersOf`) covers owner values as well as pack text.
- The text renderer prints the snippet (section 7) for every `unset` setting (PD S3).

`packs inspect` on a folder that is not in the project (R§1.7) shows defaults and `source: "not-read"`, with the reason. Inspection stays a projection of the same `bindSettings` the run uses.

**Listing (PD S2).** `PackRow` gains an always-present `needs: string[]` (names of required settings with no value; empty for a pack that needs none and for an added pack whose state is not readable), under `delivery.packs/1` (`packs-listing-published-keys.txt` gains `packs[].needs: array` and `packs[].needs[]: string`). `packsListing` stays pure; its caller passes the `unmetSettings` result. The plain list prints `needs setting: docs-folder` after the pack's line. Designed, tiered SHOULD.

**Add (PD S3).** After the Item 3 account and answer, `packs add` computes `unmetSettings` for the added pack against the project's `packSettings` and, when non-empty, prints the block "will not run until you give it N settings" with the snippet, then exits 0 (the pack was added). It reads the project through `loadConfigAndPackStates`, which refuses nothing. `--json` carries `needs` (PD S6). Designed, SHOULD.

**Update (M9).** `comparePacks` (`compare.ts`) runs over two inspections made with the **same owner values**. `Change` gains additive union members: `setting-added` (`required: boolean`), `setting-removed`, `setting-default-changed`, `setting-type-changed`. Directions are decided once in `DIRECTION`: `setting-added` and `setting-type-changed` are `neutral`; `setting-removed` is `neutral`; a default change that moves an applied hold is also reported through the existing `hold` kind with its direction (lowering narrows, lifting widens, `compare.ts:28-37`), closing the gap R§3.1 and R§4 A13 name. The `required` flag drives one sentence in the update output: `New, needs a value: <name>. Until you add it, every run stops, including scheduled runs.`, followed by the snippet. A removed setting that the owner's configuration still names is reported by the update (`Your configuration still names it: remove that line.`) and, being a stale entry, is also refused at load (section 7). Designed, MUST (M9).

**Preview (PD S4).** `delivery preview` already renders the exact step (`preview-command.ts:170-180`). The bound `Pack` carries `applied: { setting, value, source }[]`; preview looks up the pack by the workflow's prefix and prints `Settings used: docs-folder = docs (your configuration).` from it. Designed, SHOULD.

## 12. `packs check` and fixtures

`packs check` runs the pack in a scratch project with no configuration (R§1.8). An optional fifth fixture file, `fixtures/settings.json` (an object of setting values), supplies owner values. `checkPack` writes it into the scratch `delivery.config.json` as `packSettings.<name>` beside the existing `packs` entry (`pack-check.ts:151-153`), so the check passes through the exact door an owner uses: config parse, `bindSettings`, pin. A pack whose settings all have defaults needs no file. A required setting with no fixture value is a `packs check` problem naming the setting and the file to add. `settings.json` joins `FIXTURE_FILES` in `pack-folder.ts` and is read by `readFixtures`; fixtures are outside the fingerprint (`digests.ts:7`), correct because they never run on the run path. Built-in `deprecations` gains `old-module`, `new-module` and `hold-from` as its worked example (PFAW 7 line 252 anticipates this); its defaults reproduce today's behaviour (`hold-from` default `high`), and its existing equivalence tests stay green.

## 13. Schema and published-keys

`packSchema()` (`z.toJSONSchema(PackManifest, { io: "input" })`) gains `settings` as an optional key: a `type`-discriminated `oneOf` with strict branches, so an editor flags an unknown key per type. The new lines listed in section 4 are **added** to `pack-published-keys.txt`; no existing line changes (the researcher's run of `publishedKeys` over the union and sibling forms is the evidence for choosing `holdSetting`). `pack-inspection-published-keys.txt` gains the section 11 keys (`settings[]...`, `workflows[].holdSetting`, `workflows[].holdKnown`, `workflows[].steps[].given`, `.uses[]...`), all non-optional; `hold` keeps `null|string`. The `Change` union lines and `packs-listing-published-keys.txt` gain the members described in section 11. The config schema keeps `.strict()` with one new key; the config help text and `CONFIG_KEYS` are updated, and a docs test asserts every `CONFIG_KEYS` entry is documented (existing pattern). Nothing in `delivery.pack-inspection/1` or `delivery.packs-lock/1` changes version.

## 14. Errors

All errors keep the established shapes: pack-author faults as `PackProblem { file, field, message }` field-first (PFAW 6.5); owner faults as `Refusal` in the project configuration's manner ("I can't use <file>: ..."), listing every problem. Exact owner wording is product-designer's (PD); the architecture fixes content and field names:

| Fault | Reported at | Names |
|---|---|---|
| Required setting unset | config load / run (`EXIT.configuration`) | pack, setting, its `summary`, the JSON to add under `packSettings.<pack>` |
| Value of the wrong type or outside `choice`/bounds | same | setting, the value, what is accepted |
| Unknown setting for a pack | same | the setting, the pack's declared names |
| `packSettings` names a pack the project does not use | same | the key, the project's pack names |
| `settings` declaration invalid, `{{settings.x}}` undeclared, setting unused, bad `holdSetting` reference, `hold` with `holdSetting`, default fails own type | pack read (`packs check`, `inspect`, load) | `settings.<name>...` field, one sentence each |
| Fixture settings missing or invalid | `packs check` | `fixtures/settings.json` and the setting |

All problems in one report, never first-only (PFAW M10 precedent). Exit 2 for refusals, 1 for unexpected faults, as `failures.ts` already maps.

## 15. Extensibility

- **Item 5 (publish).** The scaffold starts from `deprecations`, which now shows settings; `settings.json` is the fixture contract for settings; `packs check` is the gate. No further format work.
- **Item 6 (editor).** `settingValueSchema` and the declarations give a pure `settingsSchemaOf(pack)` (a JSON Schema fragment, via `z.toJSONSchema` over the same zod object bind uses). A generator reading the project's packs emits `packSettings.<pack>.properties`. Because the key is `pack name -> fixed object`, a generated schema can complete and flag names and values; a free-form map could not (R§3.2). One zod source means editor and `delivery validate` cannot disagree (roadmap criterion 2). Item 6 needs no change to this design.
- **Item 9 (custom gates).** Settings do not remove the need for a custom gate (section 3). Evidence for re-scoping is whether the survey's per-task cases are met by task fields reaching the project's command gate (the separate engine change), not by settings. Packs stay data only.
- **Item 8 and plugin code.** Nothing here runs code; the "no path to a shell" test (section 9) stands as the guard for any later consumer of a value.
- Later additive changes available without a major: a `none`-able severity, `guardsWhen` (PD C6), per-workflow scoping (workflows are keyed objects, PFAW 6.7 item 2), more types, longer list renderings (PD C1).
- **Task fields to the project's command gate (PD C7), designed, not built here.** A shared `taskEnv(taskDef)` returns `DELIVERY_TASK_<field>` for every task field whose name matches `[A-Za-z0-9_]+`, with the value as `fieldText` renders it (`prompt-assembly.ts:104-110`), omitting a value above 4,096 bytes (ASSUMPTION A7) and warning in `preview`. It is merged into the gate environment where `DELIVERY_STEP_START` is set (`src/run-gate.ts:20`) and, to avoid a gate that passes on the surface and fails on the delivery branch, at `src/delivery-branch.ts:128`, which today carries `taskDef: { intent }` only (R§1.5; threading the run's task def there is part of the change). Values are never part of command text; the owner's command quotes `"$DELIVERY_TASK_file"`. It reaches only the project's own command gate, setup and teardown, never a pack (D1). Untrusted tracker values travel only in environment variables, the safe route GitHub's guidance gives (R§2).

## 16. Buy-vs-build ledger

| Capability | Decision | Alternative | Rationale |
|---|---|---|---|
| Placeholder rendering | build, thin: extend `interpolateTask` into `src/placeholders.ts` | Mustache, Handlebars, Nunjucks, JS template literals | Two namespaces and one fixed grammar; a template engine brings logic, helpers and a second syntax beside `{{task.x}}` (PFAW section 8 rejected Mustache/Handlebars for the same reason); Helm excluding `env` from templates "for security" is the warning (R§2) |
| Setting declaration and value validation | reuse-estate: zod 4, one `settingValueSchema` | Embedded JSON Schema per setting (Helm `values.schema.json`), ajv | One validator already feeds the manifest, config, `--schema` and the promise test; embedded JSON Schema admits arbitrary regex (ReDoS) and `$ref`, and needs a second validator |
| Required vs optional | reuse prior art: Terraform's "no default means required" | Explicit `required` flag (Actions, Helm schema) | One rule, no contradictory states; refusal is the harness's, not left to the author (Actions' failure mode, R§2) |
| Config layering, env-var and `.env` values | not built | `cosmiconfig`, `convict`, `dotenv` | One committed JSON source of truth; environment values would introduce secrets and non-determinism (A8) |
| Owner values key in config | reuse-estate: `config.ts` zod and its sentence style | Separate settings file; values in the lock | One configuration file; the lock stays the pack's record, not the owner's words |
| Editor schema for settings | reuse-estate: `z.toJSONSchema` over the declarations | Hand-written JSON Schema | Single source (Item 6) |
| Path validation | build, 10 lines on `node:path` | A path-safety package | Rule set is tiny and fixed; no dependency for a commodity this small |
| Secret handling | not built; reuse-estate masking (`secrets.ts`) is unchanged | Sensitive-value type (Terraform `sensitive`) | Terraform's own page says sensitivity is display-only (R§2); a committed config is the wrong place for one |
| Inspection, comparison, fixtures, scripted agent | reuse-estate: `inspectionOf`, `comparePacks`, `checkPack`, claude-mock | New settings-specific views | Extended in place, one projection per Item 2 |
| Approval and pinning | reuse-estate: fingerprint and lock unchanged | Include values in the fingerprint | Values are the owner's configuration (section 10) |
| Task fields to command gates | defer, decision recorded | Splicing into command text; a template engine | Env-var delivery is the safe form; separate engine change |

## 17. Risks

- **Behaviour change for a `/3` pack that already contains `{{settings.`**: refused after this release (section 8). Mitigated: no built-in uses it; the reservation was documented.
- **Config bricking, including unattended runs.** A global refusal on an unset required setting stops `run`, `review` and `validate` for the whole project, so an `update` that adds a required setting stops scheduled and CI runs until the owner adds a line. Accepted (the alternative, refusing only when the pack's workflow is used, needs an "unconfigured" state in every lookup and gives a misleading "unknown workflow", section 7). Mitigations: `update` states it in the sentence driven by `setting-added.required` (section 11); `add` and `inspect` print the snippet; the pack commands never refuse; a new required setting is a visible, reviewable pull request because the lock and folder change in version control.
- **Task-field notice gap** (section 9) persists.
- **Approved pack, owner value changes behaviour**: accepted and made visible (section 10); a malicious value implies a malicious owner.

## 18. Testing

Red first; tests state intended behaviour. Offline through the existing agent mock.

- Compatibility: every existing `/2` and `/3` fixture produces deep-equal `WorkflowConfig`s, hashes and inspections (the v2 characterisation tests stay green; `bindSettings(pack, undefined)` is identity for packs without settings).
- `settingValueSchema` per type: accepts the stated forms; refuses hidden characters, line breaks, `{{`, absolute and `..` paths, over-length `text` (above 200 characters), a non-integer `number`, more than 32 `paths`, a non-member `choice`, a wrong JSON type.
- Declaration rules: each rule in section 5 has a failing manifest and a message test; all problems reported together.
- `bindSettings`: default applies; owner overrides; missing required names pack and setting; unknown setting lists declared names; `hold` reference resolves; rendering is single-pass (a value cannot re-expand); harness half untouched; `hash` and `instructions` unchanged.
- Config: `packSettings` parse; unknown pack refused; `projectPacks` refuses with every problem at once; `projectPackStates` refuses nothing; `.js` config binds at run.
- Determinism: the same configuration yields byte-identical pinned prompts; a configuration edit after pin does not change a resumed run.
- Safety, behavioural first: a full scripted run with a setting value of shell metacharacters (`$(touch marker)`, backticks, `; touch marker`) writes no marker file and every command string the harness ran equals the one it ran without the value; a value with a line break, hidden character, `{{task.x}}` or `..` path is refused. Secondary structural test: `settings.ts` is imported by no gate, shell, closer or `after` module.
- Hold: default, owner value and a changed default each give the expected `heldFor` result; `hold` plus `holdSetting` on one act is refused.
- Surfaces: listing `needs`, the `add` block, the inspect snippet and the update sentence are rendered from `unmetSettings` and tested against the same fixture; `holdKnown` is false for unset and `not-read`, true with `hold: null` for no hold.
- Published keys: pack, inspection, listing and `Change` promise files updated; old lines all remain, and the `holdSetting` line is the only hold-related addition.
- Inspection: golden for each `source`; `.js` and no-project give `not-read`; `given` equals the prompt the engine pins (the same function).
- `comparePacks`: new required setting, removed setting, changed default moving the hold, type change, each with direction.
- `packs check`: pack with defaults needs no fixture; required without fixture fails naming it; `settings.json` flows through the config door; `deprecations` whole-pack run with non-default values, and a whole-CLI scripted run (unset required refuses; set runs).
- Docs test: every `/3` key including `settings` is named by `docs/writing-a-pack.md`; guide examples validate.
- Not provable by scripted tests, and said so: how a real agent uses a rendered value.

## 19. Non-functional requirements

- **Determinism.** Binding is pure; lists join in the owner's order; no clock, locale or environment input (Jorj's guidance: be deterministic).
- **Performance.** Binding is a linear pass over a handful of strings per config load; no I/O beyond what loading already does; no network on any run path (install design item 8).
- **Bounds.** At most 32 settings per pack, `text` at most 200 characters, `paths` at most 32 entries (ASSUMPTION A2: constants chosen here, not from a document).
- **Compatibility.** No version bump of `delivery.pack/3`, `delivery.pack-inspection/1`, `delivery.packs-lock/1`; release is a changeset minor.
- **Stability.** All new keys under the published-keys promise from their first release.
- **Accessibility of output.** Errors and inspection text are plain sentences, no colour dependence (existing renderer rules).

## 20. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git) and the vendored claude-mock. No service, credential, network or new dependency. A pack author's environment is a pack folder and an editor with the published pack schema loaded through `$schema`, which now completes `settings` and its types. An owner's environment is `delivery.config.json`; the project configuration has no schema yet (Item 6), so owner completion is not part of this item.

**Harness.** The same single gate: lint, build, vitest. Every built-in pack folder is run through `checkPack` by the existing enumerating test, now with its `fixtures/settings.json` where it has required settings, so a broken built-in fails the build. Third-party authors call the same `checkPack` from `delivery-service/testing`. The safety test of section 9 and the three published-keys tests are part of the gate.

**Scaffolding.** A new pack starts as a copy of `deprecations`, which becomes the worked example of a pack with settings, a `severity` setting that the act's `holdSetting` names, a prompt that uses values and a settings fixture. No scaffold command (Item 5 owns that).

**Local-run story.** An author declares a setting, sees every manifest fault named by file and field at once, gives the fixture its values, and watches the scripted run apply them with no key and nothing sent to an agent. An owner adds a pack, reads the account and the "before you run this" block, pastes the snippet into `delivery.config.json`, runs `inspect` to see applied values and the prompt as given, and `preview` to see the exact request. A teammate pulls the repository and runs with nothing fetched.

**Deploy target.** The npm package `delivery-service`, released through the changeset flow as a minor (additive format keys, new inspection keys, new `Change` kinds, one config key). Nothing hosted.

**Failure modes.** Every refusal is a plain sentence naming the pack, the setting and the exact thing to add or change; the pack commands and `inspect` keep working with a setting unset so the owner can always find out what to set. A `.js` configuration binds at run and shows `not-read` in inspection with the reason. A stale `packSettings` entry is refused, not ignored.

**Verification.** Checkable in the repository: unset required refused naming it; defaults reproduce today's `deprecations` behaviour byte for byte; values appear in the pinned prompt and hold; no value reaches a shell; a fingerprint is identical with and without owner values; an update that changes a default shows in the comparison.

## 21. Assumptions and open points

Not settled by a governing document:

- **A1.** Resolved: `holdSetting` as an act-level sibling (section 4); the union and an optional `atOrAbove` both fail the promise (researcher's run).
- **A2.** The size bounds (section 19).
- **A3.** Guard switching by a setting is deferred (PD C6), not rejected.
- **A4.** The config key name `packSettings` and the owner word "pack setting" (agreed with product-designer; not from a governing document).
- **A5.** The task-field-to-command-gate change is PD C7, COULD, designed in section 15 and not built here; Item 9 is not re-scoped by this item.
- **A7.** The 4,096-byte cap on a task value in the gate environment.
- **A6.** Refusing a stale `packSettings` entry is stricter than ignoring it; chosen to match the strict config.

## 22. Traceability to the product design

| Product item | Delivered by |
|---|---|
| M1 Declare (types text, path, paths, severity) | Sections 4 and 5; `settings` key, `settingValueSchema` |
| M2 Supply (`packSettings`) | Section 6 |
| M3 Unset required refused, scope | Section 7 (refusing path versus non-refusing path), section 14 |
| M4 Owner-side errors, all at once | Sections 7 and 14; `SettingProblem` list |
| M5 Values reach prompts; undeclared placeholder refused | Sections 5 (rules), 7 (rendering, patterns), 8 |
| M6 Hold severity as a setting | Sections 4 (`holdSetting`) and 8 |
| M7 Value is data, never a command | Section 9 (behavioural test first) |
| M8 Inspection shows settings, sources, placeholder beside value | Section 11: `settings[]`, `steps[].uses[]` (placeholder, setting, value), `given`, `holdSetting`, `holdKnown` |
| M9 Update report | Section 11 (Update): new `Change` members and the `required`-driven sentence |
| M10 Fixtures prove a pack with settings | Section 12 |
| M11 One syntax, two data models; Item 9 outcome | Section 3 |
| M12 Honest limits | Sections 8 (checks), 10 (approval); wording is the product's |
| M13 Documentation | Product section 8; docs tests in section 18 |
| M14 Existing behaviour unchanged | Sections 1, 7 (identity bind), 18 (compatibility) |
| S1 choice, number, boolean | Section 5 (SHOULD rows) |
| S2 Listing marker | Section 11 (Listing): `needs` |
| S3 Add block and inspect snippet | Sections 7 (`unmetSettings`) and 11 (Add, Inspection) |
| S4 Preview | Section 11 (Preview) |
| S5 `deprecations` worked example | Section 12 |
| S6 `--json` carries setting changes | Section 11 (Add, Update; `Change` members are published) |
| C1 longer lists / structured | Not built; additive (section 15) |
| C6 Guard switching | Not built; additive (sections 8, 15) |
| C7 Task fields to the command gate | Designed in section 15; not built |
