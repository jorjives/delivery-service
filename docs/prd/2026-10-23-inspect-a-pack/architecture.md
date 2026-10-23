# Architecture: Inspect a pack before trusting it

Roadmap Item 2 (`docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, "Item 2: Inspect a pack before trusting it"). Item 1's architecture (`docs/prd/2026-10-23-packs-for-any-workflow/architecture.md`) is the house style and the source of the pack model this builds on. Facts about the tree are read from the code at HEAD (file named in each claim); "R§n" cites `research.md` in this folder. Scope and the derived MUST tier are in `review-log.md`.

## 1. Position in one paragraph

Inspection is a **pure projection of the loaded pack**. The same loader that `delivery review`, `delivery run` and `delivery packs check` use reads the folder; a new pure function turns the resulting `Pack` (the `WorkflowConfig`s that will actually run, plus the authored prompt text) into an `Inspection` model; one renderer prints that model as text, and the same model is the `--json` document. Nothing about a pack is re-parsed or re-derived for inspection, so what is shown cannot drift from what runs. Nothing is executed. Beside the projection sit two checks the loader does not make: that the pack folder holds **only content the format names**, and a deterministic comparison of each workflow against **the project's own defaults** that flags anything wider. No change to the engine, the pack format, the case file or the report.

## 2. Constraints and where they come from

| Constraint | Source |
|---|---|
| Owner sees, before installing or running: workflows, full prompts, guards, hold policy, and the gates and closers the pack selects | Roadmap Item 2, success criterion 1 |
| Anything that widens what an agent may do beyond the project's own defaults is flagged | Item 2, criterion 2 |
| A pack carrying something the format does not name is refused with a plain explanation | Item 2, criterion 3 |
| An owner who did not write the pack can say, from the output alone, what it will do | Item 2, criterion 4 |
| Packs stay data only in this phase | Roadmap Context lines 16-18; Item 1 Constraints |
| Prompt injection is the real risk; inspection is the first control and precedes install | Item 2 Notes |
| Install, pinning, settings, publishing, code plugins are not this item | Roadmap Items 3-9; `review-log.md` "Intended shape" |
| Item 3 will "refuse a pack changed since approval" and show what changed on update; Item 4 "inspection shows the settings and the values that would apply"; Item 7 and Item 9 "inspection shows which workflows depend on custom code" | Roadmap Item 3 criteria 3-4, Item 4 criterion 4, Item 9 criterion 4. Design pressure only; none is built here |
| A command that "promises only to read" never runs the project's own JavaScript config | Current behaviour: `ConfigLookup.dataOnly`, `src/cli/config.ts:493-495`. Reused, not required by a document |

Not constraints (current behaviour only): the exact set of guard names; `after: []` on a find; `tests-unchanged` being the only default-off guard `/2` fixes add; the 40-idea cap.

## 3. Reading and refusing: one loader, then a folder check

**Rule: inspection loads a pack with the loader every other command uses, and adds one folder check that only inspection (and, later, install) applies.**

**Order matters.** The folder check runs first, because the loader follows symlinks when it reads a prompt (`readFile`, R§3), so a symlinked prompt would otherwise be read and its content shown as the pack's own. A refusal from either stage stops before any prompt text is produced.

The loader (`inspectPack` in `src/packs/manifest.ts`) already: reads `pack.json`, dispatches on `schema` (`delivery.pack/2` through `upgradeV2`, `/3` directly), refuses any version it does not read before parsing further, refuses any key the strict zod schemas do not name with the `DATA_ONLY` sentence, runs the cross-reference rules, reads every prompt file and names every problem by file and field. Inspection reuses that unchanged; it therefore **cannot accept what `delivery run` refuses**, and cannot present a pack the runtime would read differently.

**Naming.** The loader's function is named `readPack` (today `inspectPack`), because "inspect" names the command and the projection here and must not also name the loader. `loadPack` keeps its name. Built-in pack folders are expected to pass the folder check.

**Versions.** A manifest whose `schema` this build does not read is refused whole, never shown best-effort: its keys may mean something else (the existing refusal, `manifest.ts` "A manifest in a format this build does not read is refused"). For a newer format than the build reads the sentence says so, so the owner is told to upgrade the harness and not that the pack is bad. Strictness is a property of the format version: `/2` and `/3` stay as strict as they are; a later additive key in `/3` is shown by a harness that knows it and refused as "not part of the pack format" by an older one, which is the correct, safe direction for a trust command (inspection must never silently drop a key it cannot describe). The output names the format the pack declares.

**Folder check (new, `src/packs/pack-folder.ts`).** The manifest and the prompt files it names are the whole of what the loader reads. A folder can hold more: a script, a hook, a dotfile, a symlink out of the folder, a prompt file no workflow names. None of that reaches the agent today (the agent works in the project's worktree, never the pack folder), so this is not a runtime hazard; it is a **trust and completeness** one: the owner is told "this is the whole pack", and Item 3's pin must cover the whole pack. The check lists the folder without following symbolic links and refuses, naming each path, anything outside this closed set:

| Allowed | Why |
|---|---|
| `pack.json` | the manifest |
| each file a workflow's `prompt` names | the prompts |
| `fixtures/project/**`, `fixtures/review.json`, `fixtures/fixes.json`, `fixtures/expect.json` | the four parts `FIXTURES` names (`src/packs/pack-fixtures.ts`), shown as files and sizes only |
| `README*`, `LICENSE*`, `CHANGELOG*` at the top level, regular files | inert documentation every shared package carries; listed in the output as "not read by the harness" |
| top-level `.git/` (a directory, not descended into), `.gitignore`, `.gitattributes`, `.DS_Store`, `Thumbs.db` | the commonest folder a colleague hands over is a git checkout on a desktop. These are version-control and operating-system metadata the harness never reads or runs (it never invokes git inside a pack folder); listed as "not read", not part of the pack, and excluded from what Item 3 pins. Anything else dotted is refused like any unnamed file |

Refused, each with its own sentence (R§3 records symlinks and stray files as the two gaps in the existing strictness, which is otherwise complete at the manifest level, R§0.3): a symbolic link anywhere; any other path (named); a prompt file that is not valid UTF-8. A pack that fails any rule is **refused whole**: no prompts, no summary, exit code 2 (`EXIT.configuration`, as `packs check` uses for a pack problem), because a partly understood pack must not look reviewed. Decision: documentation and version-control metadata files are allowed, because refusing every unnamed file would refuse most real packages; no governing document settles the list, so it is a closed, named set that a later format version can extend.

**Where it applies, and why not in the run-time loader.** Applying the closed-set rule when `delivery run` loads a pack would refuse `/2` packs users already have with a stray file in the folder, breaking Item 1 criterion 4 ("existing review packs, and projects that name them, keep working unchanged"). The rule is therefore a separate function, called by inspection now and by install (Item 3) later, and the output says which. A `/3` pack that lists a stray file still *runs*; it just does not inspect clean. This is stated in the guide so nobody reads inspection as "the pack cannot do more than this".

## 4. The model of what a pack will do

`Inspection` is derived by `inspectionOf(pack, baseline)`, a pure function in `src/packs/inspection.ts` over the loaded `Pack` and a `Baseline` (section 5). `Pack` gains one field, `texts` (authored prompt text by file name), which the loader already holds in `texts` and discards; keeping it lets the model separate **what the pack author wrote** from **what the harness appends** (for a find, `ideaFormat`, `src/packs/manifest.ts`) without string surgery on the assembled prompt. A test asserts `authored + harness === the step's prompt` for every built-in, so the model can never show a prompt other than the one pinned.

| Part of the model | Derived from | Notes |
|---|---|---|
| Identity: name, version, title, summary, format, `hash`, source (built-in or folder, path) | `Pack` (`hash` is the loader's own) | `hash` is the value Item 3 will pin and compare; shown now so the owner can note it |
| Workflows, each by qualified name (`<pack>:<local>`), kind (find or act), summary, and for a find the acts its ideas may name | `pack.manifest.workflows` and `pack.workflows` | Same qualification rule the loader uses |
| Per step: the full prompt, as two labelled parts (authored, harness-added), shown verbatim | `pack.texts`, `WorkflowConfig.steps[].prompt` | Never summarised: criterion 1 says full prompts |
| Guards in effect, as defaults plus the pack's additions, and which are defaults | `activeGuards(taskDef, step.guards)` (`src/task-guards.ts`), the engine's own resolver | A guard is named with the one-line meaning the product designer owns |
| Hold policy | `WorkflowConfig.hold` | An act with no hold "lands without sign-off" once the owner has approved its idea (R§1, `deprecations:tests`); stated, not left blank |
| Gate and closer the workflow will use | `pack.workflows` has no `gate`, `agent`, `after` or `closer` key for `/3` or `/2` (format, `src/packs/pack-format.ts`), so every pack workflow **inherits the project's**: the model says "the project's own" and, when a project is found, names it (type and command text) from the same resolution a run uses | See below: this is the honest reading of "the gates and closers it selects" |
| After steps | `after: []` on a find (explicit, narrower); a pack's act sets none, so the project's `after` steps run (`afterFor`, `src/cli/after-landing.ts:19-23`: the workflow's own when present, else the project's), which may deploy | Shown, because an act landing triggers them (R§1; confirms R's ASSUMPTION) |
| The agent's powers | project `agent` options (a loose pass-through that can carry `mcpServers`, `plugins`, `settings`; `src/schema.ts:188-199`), fence mode, the fact that every session runs with permissions bypassed (`src/agent-invoke.ts:246-247`), and the owner's own Claude Code setup (reuse `OWN_SETUP`, `src/cli/preview-command.ts:80-83`) | R§1 "The agent's power". Inspection cannot enumerate tools; it says so. This is the honest answer to "what it is allowed to touch": everything the project's agent can already touch, directed by the pack's words |
| Files | folder listing with role (manifest, prompt, fixture, documentation) | From the folder check |
| Comparison rows, `widens`, and findings ("Things to look at") | section 5 | |

**"The gates and closers it selects".** Item 1 deliberately left step `gate` and a per-workflow `closer` out of the pack format (Item 1 architecture section 4, "step gate, agent, project closer"), so today a pack selects **none**; its work is judged and landed by the project's own gate and closer. Inspection reports that fact, with the project's values, rather than an empty list. This is not a gap to paper over: it is the useful answer, because it says what will judge the pack's work. If a pack later names a built-in gate or closer (an additive extension within `/3`, Item 1 section 15), the same field carries the pack's choice and the comparison in section 5 flags it, with no change to the model's shape. **Flagged for critic and main** because roadmap lines 17-18 can be read as expecting selections to exist now.

**Prompts are shown as bytes, not interpreted.** The text renderer prints each prompt exactly as the agent will receive it, in a plain block, never as Markdown (so an HTML comment or a hidden link is visible as written). Characters that hide content on a terminal or in a diff are shown as visible escapes (`<U+202E>`, `<U+200B>`, `<U+001B>` for ESC, and so on for every control, bidirectional, zero-width and escape character: one display form, shared with the product design M3) and each occurrence is a finding; this changes what is *displayed*, not what is *meant*, and the JSON carries the raw string. This is the only transformation, and it is deterministic (a fixed character class).

## 5. "Widens beyond project defaults": deterministic, against a named baseline

**Baseline: what a step of the project's own workflow gets when it overrides nothing.** `Baseline` holds: the default guards (`DEFAULT_ON`, `src/guards.ts`), the project's gate and closer, `agent` options, fence mode and `after` steps, resolved as a run resolves them (`resolveProject`, `src/cli/settings.ts`: `config.gate`, or the inferred `npm test` gate when unset; presets resolved; `closer`), and no hold. When no project is found, or its gate cannot be inferred, the baseline carries the harness defaults and marks gate and closer "not known without a project"; the guard comparison, which needs only the defaults, still runs.

**The comparison is a table over the engine's own schema.** For each key of `StepConfig` (`name`, `prompt`, `gate`, `agent`, `continue`, `guards`, `src/cli/config.ts:112-127`) and `WorkflowConfig` (`steps`, `after`, `hold`, `:152`), a rule returns `same`, `stricter` or `wider` against the baseline. The table is typed so that adding a key to either schema **fails the build until the key is classified**; a new capability can therefore never pass inspection unremarked. Rules:

| Dimension | wider than defaults when | stricter when |
|---|---|---|
| guards | any `DEFAULT_ON` guard is off (`guardChanges(...).off`, `src/task-guards.ts`, the existing diff-from-defaults function) | a guard is on that is not in `DEFAULT_ON` |
| gate | the step names its own gate (it replaces what judges the work; it could be a weaker one) | never |
| agent | the step carries `agent` options (tools, model, environment, instructions) | never |
| after | a non-empty workflow `after` is named (commands or an agent pass run on landing) | `after: []` replaces the project's steps with none |
| hold | never | a threshold is set where the project has none |
| closer | not expressible in a pack; always `same` | n/a |
| prompt, name, continue | `same`; the prompt is covered by the standing notice below | |

Each workflow carries its comparison as plain rows (`dimension`, `relation`: same, stricter or wider), shown as facts ("adds the guard tests-unchanged"). **"Things to look at" is a separate list of findings, `{ code, relation: "wider" | "note", where, detail }`, and is the one list product-design M8 renders: every `wider` comparison row, plus the notes below.** A `note` is not a comparison against the baseline; it is a fixed, deterministic fact an owner should weigh. The set is closed and each has its derivation:

| Code | Fires when | Derivation |
|---|---|---|
| `lands-without-sign-off` | an act has no `hold` | `WorkflowConfig.hold` undefined (R§1: lands once the idea is approved) |
| `hold-only-critical` | an act's hold is `critical` | `hold === "critical"` |
| `hidden-characters` | a prompt holds any control, bidirectional, zero-width or escape character | fixed character class (extends the `HFS_IGNORABLE` precedent, `src/packs/pack-fixtures.ts`); counted per prompt |
| `older-format-guards` | the pack is `delivery.pack/2` and an act's effective guards include one its file does not write (always `tests-unchanged`, added by `upgradeV2`) | effective guards vs the as-written manifest, so `Pack` also keeps `declared` (the parsed manifest before `upgradeV2`) beside `texts` |

Order is fixed (workflow order, then dimension or code order), so the same pack always yields the same text. No clock, no model, no network. The positive statement answering roadmap criterion 2 ("Nothing in this pack widens what the agent may do beyond your project's defaults", with the dimensions compared) is a field of the model, `widens: false`, true exactly when no `wider` row exists, and is printed whether or not notes exist; text and JSON carry both.

**What this means today, stated plainly.** The strict format makes most dimensions inexpressible: a `/3` or `/2` pack can only add guards, set hold and (on a find) skip `after`, all `stricter`. So for every pack that loads, the real finding set is empty of `wider`, and the output says so **positively**: "Nothing in this pack widens what the agent may do beyond your project's defaults", with the dimensions that were compared listed, and a permanent notice that **the prompts are not analysed**: they instruct an agent that holds the project's own powers, so they are the risk and must be read (the flagged unit of trust is the prompt, not the manifest). The `wider` branch is not dead code: it is the contract that fires the day the format gains a gate, agent or closer key, and it is proved now by tests that feed synthetic `WorkflowConfig`s through the same function (section 11). The easy choice (implement only the empty case and add flagging later) was rejected because Items 4, 7 and 9 each add a key and the typed table is what makes that safe.

**No prompt heuristics.** Inspection does not scan prompts for dangerous phrases ("ignore previous", `curl`, `rm -rf`). A pattern list gives false assurance (absence reads as safety) and is trivially evaded; an LLM judge is non-deterministic and sends third-party text to a model before the owner has agreed to anything. Prompt-injection stance: **inspection shows, it does not sanitise, score or reassure.** The only prompt-level finding is hidden or terminal-control characters which are about being able to *see* the text at all. This is the shared position with the product design (S4 dropped).

## 6. Where it lives: command, modules, reuse

| Piece | Location | Reuses |
|---|---|---|
| Command `delivery packs inspect <pack>` | new `src/cli/packs-inspect-command.ts`, registered beside `packs check` in `src/cli/program.ts` | `resolvePack` (name among built-ins and the project's listed packs, or a folder path; `src/packs/manifest.ts`), `CommandContext` and `--json` (`ctx.json`), `EXIT` codes, `Refusal` |
| Projection | new `src/packs/inspection.ts`: `inspectionOf(pack, baseline) -> Inspection`, the comparison table | `Pack`, `activeGuards`, `guardChanges`, `DEFAULT_ON` |
| Folder check | new `src/packs/pack-folder.ts` | `FIXTURES`, `isGitSegment`-style path handling already in `pack-fixtures.ts` |
| Baseline | new `src/packs/inspection-baseline.ts`, or a function in `packs-inspect-command.ts` | `findRepository`, `findConfig({ dataOnly: true })`, `checkConfig`, `resolveProject` |
| Text renderer | `src/cli/packs-inspect-render.ts`: `render(inspection, { colour })` | `plainReporter` styling conventions (`src/cli/output.ts`) |
| JSON schema and stability | `Inspection` as a zod schema in `src/packs/inspection.ts`; `z.toJSONSchema`, `openSchema`, `publishedKeys` | same machinery as `packSchema()` and `pack-published-keys.txt` |

The command name is the product designer's to confirm (structure here is independent of it). It sits under `packs` because `check` is already there and `delivery packs` already lists; `delivery review <pack> --preview` stays what it is (the find's instructions for a run) and is not extended: preview shows one step of one run, inspection shows the whole pack before any run.

**The baseline reads the project's configuration as data only.** `findConfig({ dataOnly: true })` ignores a `delivery.config.js`/`.mjs` (which would run the project's own code) and the baseline then carries "project configuration is code: not read", with the same guard-only comparison. Config discovery starts from the repository root of the working directory and **never inside the pack folder being inspected**, so a downloaded folder cannot supply its own configuration to the command that is judging it. Baseline resolution does not call `loadConfigAndPacks`, because that loads every listed pack and would fail the inspection on a different pack's fault.

**Inspecting a pack not yet listed.** A path is resolved from the working directory exactly as `delivery review` does (`resolvePack`); a name is looked up among the built-ins and the project's listed packs. No project is required: outside a repository, inspection runs against the harness defaults.

**View filter.** `--workflow <name>` (product design S2) is a filter over the same `Inspection`: the renderer, or the JSON view, narrows `workflows` to that one (named by local or qualified name; an unknown name is refused listing the pack's workflows). Pack identity, project baseline, files, notices and findings for that workflow stay; findings for others are dropped. The model is never computed differently for the filter, so it cannot disagree with the full view.

## 7. No execution of pack content during inspection

Inspection imports the loader, the folder check, the projection and the baseline; it **does not import** `checkPack`, `readFixtures`' consumers, the scripted agent, `loadPlugin` or any gate or closer loader. Fixtures are the only pack content that is real code (`fixtures/project/package.json` carries a test command that `packs check` runs, with the trust question at `packs-check-command.ts`); inspection lists their file names and sizes, says that `packs check` would run them, and never reads their bodies into the model. The baseline's gate resolution only reads `package.json` (`inferGate`, `src/cli/project.ts`). Enforced by test, not by convention (section 11). Inspection writes nothing: not to the pack folder, the project or the run record, and creates no run, worktree or journal entry.

## 8. Output formats and stability

- **Text (default).** Rendered only from the `Inspection`; every fact in it is in the model (a test checks that no value appears in the text that is not in the model). Wording and layout are the product designer's. **No stability promise for text**, stated in the guide: wording can change; scripts use `--json`.
- **Machine-readable (`--json`).** The whole `Inspection` as one document on standard output, as `delivery packs --json` and `delivery validate --json` do. A refusal under `--json` is `{ "ok": false, "problems": [...] }` in the same envelope, exit 2, so a script never has to parse text.
- **Stability.** The document carries `"schema": "delivery.pack-inspection/1"`. The JSON Schema comes from the zod source (as the pack and report schemas do), and a published-keys file (`src/packs/pack-inspection-published-keys.txt`) pins every key and enum value under the existing `publishedKeys` test: within `/1` a new optional key or enum member is additive; removing, retyping or changing meaning is a new major. Why promise: Item 3 must compare two inspections to show "what changed", Item 7 to show capabilities, and a machine-readable model without a promise would be a second unstable format those items depend on (roadmap Item 14 notes run outcomes already carry no promise, so this is a deliberate difference). The prompt text in `--json` is raw; consumers must treat it as untrusted data.

## 9. Data model (sketch, shape not final)

```
Inspection (ok: true)
  schema: "delivery.pack-inspection/1"
  pack: { name, version, title, summary, format, hash, source: { kind: "built-in" | "folder", path } }
  project: { found: boolean, config: "read" | "code" | "none", gate: Selection | null, closer: Selection | null, fence, agentOptions, after: [...] }
  workflows: [ { name, local, kind, summary?, offers?: [name],
                 steps: [ { name, prompt: { authored, harness }, guards: { default: [..], added: [..], off: [..] },
                            gate: { source: "project" | "pack", ... }, agent: { source: ... } } ],
                 hold: Severity | null, after: { source: "project" | "pack", steps: [...] } } ]
  files: [ { path, role: "manifest" | "prompt" | "fixture" | "documentation", bytes } ]
  widens: boolean   // true when any comparison row is wider
  comparison rows live per workflow (dimension, relation: "same" | "stricter" | "wider")
  findings: [ { code, relation: "wider" | "note", where, detail } ]   // "Things to look at"
  notices: [ "prompts-not-analysed" | "tools-follow-your-claude-setup" | "hidden-characters" ... ]
Refusal (ok: false): { schema, ok: false, problems: [ { file, field, message } ] }
```

`PackProblem` (`{ file, field, message }`) is reused for refusals, so inspection errors read as `packs check` errors do. `Selection` is `{ source: "project" | "pack", type, summary }`, the shape that carries a pack's own choice later.

## 10. Extensibility, without building it

- **Item 3 (install).** Install calls the same `readPack`, the same folder check and the same `inspectionOf`, and stores `pack.hash` plus the inspection document as the approved record; "refused until approved when changed" is a comparison of two `Inspection` values (and the hash), "what changed on update" a diff of two models. The folder check is already a callable function so install does not re-implement trust. No lockfile, source or approval concept is introduced here. Because the folder check, not the run-time loader, enforces "named content only", Item 3 gets the rule it needs for hashing the whole pack without breaking installed `/2` packs.
- **Item 4 (settings).** Settings are reserved in `/3` (Item 1 section 10; `packs/…/pack-rules.ts` already refuses a `settings` key with its own sentence). Inspection gains an optional `settings` array (name, default, value that would apply) as an additive key under the `/1` promise. Prompt rendering shows `{{settings.x}}` placeholders as written and, once Item 4 exists, the resolved value alongside.
- **Item 7 and Item 9 (plugins, custom gates and closers).** The `Selection.source`/`type` fields already carry "custom" with a module path; the typed comparison table forces a classification (a custom gate is `wider`) the moment `StepConfig.gate` can name one; inspection then lists "depends on custom code" per workflow from the same field. Capability declarations for plugins are a different artefact (a plugin, not a pack), and a sibling `inspectionOf` for them would share the findings vocabulary, not the code.

## 11. Testing strategy (red first, intended behaviour)

All offline, through the existing machinery: `claude-mock` and the scripted agent are not needed to *inspect* (nothing is run), so tests build packs on disk and call the command in process through `CommandContext`, as `packs-command.test.ts` does. The scripted agent appears only where the claim is "inspection shows what runs":

- **Shown equals run (anti-drift).** For each built-in (`code`, `security`, `deprecations`) and a purpose-built `/3` fixture: the model's pinned prompt, guards, hold and workflow list are deep-equal to what `delivery review <pack>` pins into the run (via the real command with the scripted agent, as `preview-matches-run.test.ts` reads the wire). Prior art: that test already proves preview equals send.
- **Authored plus harness equals pinned prompt** for every workflow of every built-in.
- **Widening, both directions, intended behaviour.** Synthetic `WorkflowConfig`s: a step with `guards.off`, a `gate`, an `agent`, a non-empty `after` each yield `wider` naming the dimension; added guards, `hold`, `after: []` yield `stricter`; a plain step yields no finding. A compile-level test asserts the table covers every key of `StepConfig` and `WorkflowConfig` (a new key must break the build). The real built-ins yield no `wider`, and the output says so in words.
- **Refusals.** One failing test per rule: unnamed file, symlink out of the folder, stray unreferenced prompt, non-UTF-8 prompt, unknown manifest key, unreadable format version, newer format; each asserts the plain sentence, the file/field, exit 2, and that **no prompt text appears in the output** and the `--json` form is `ok: false`. A `/2` pack with a `README.md` inspects clean; with a stray `.sh` file it is refused while `delivery review` still runs it (Item 1 criterion 4 preserved).
- **Hidden characters.** A prompt containing a right-to-left override, a zero-width space and an ESC sequence: the text output has none of the raw characters, shows visible escapes, records a `hidden-characters` finding with the count, in the `<U+202E>` display form; `--json` holds the raw string. Each note code has a firing and a non-firing case (a hold of `high` does not fire `hold-only-critical`; a `/3` pack never fires `older-format-guards`); `--workflow` output equals the matching slice of the full model; a git checkout with `.git/`, `.gitignore` and `.DS_Store` inspects clean and lists them as not read.
- **No execution, no writes.** The command is run against a pack whose `fixtures/project/package.json` test script writes a marker file, with process spawning mocked to fail the test if called and a before/after snapshot of the pack folder and project proving no write; a `delivery.config.js` in the project is not executed (a marker it would write is absent) and a config discovered inside the pack folder is never read.
- **Determinism.** Two runs over the same folder produce byte-identical JSON and text.
- **Stability.** The published-keys test for `delivery.pack-inspection/1`; `--json` output validates against the generated schema.
- **Text derives from the model.** A test extracts every quoted value in the rendered text and asserts it exists in the model (the guard against a renderer inventing a fact).
- **Criterion 4 (a non-author can say what it will do).** The only evaluable proxy is a golden rendering for each built-in reviewed by the product designer (wording is theirs); the architecture contributes that the golden is generated from the model, so it cannot disagree with it.

Not provable by tests, said in the guide: whether a prompt is malicious. Inspection makes it readable; the owner decides.

## 12. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Reading and validating a pack | reuse-estate: the existing loader (`inspectPack`, renamed `readPack`) | A separate inspection parser | A second parser is how "shown" and "run" drift apart; the loader already names every problem by file and field |
| What a pack will run (prompts, guards, hold, workflows) | reuse-estate: `Pack.workflows`, `activeGuards`, `guardChanges` | Re-derive from the manifest | The pinned `WorkflowConfig` is the thing that runs |
| Gate and closer resolution for the baseline | reuse-estate: `resolveProject`, `findConfig({ dataOnly })`, `inferGate` | Re-read config separately | One resolution for run and inspect; `dataOnly` is the estate's "promises only to read" precedent |
| "Widens beyond defaults" | build, thin: a typed comparison table over `StepConfig`/`WorkflowConfig` | Generic policy engine (OPA, Cedar); a list of "dangerous" manifest keys | The format has a handful of keys; a policy engine is a second language for six rules. A typed table forces classification of every future key. No library encodes "wider than this project's defaults" |
| Prompt-injection detection | not provided, by decision | A heuristic phrase scanner; an LLM judge; an off-the-shelf prompt-injection classifier | Heuristics give false assurance and are evadable; a model is non-deterministic and ships untrusted text to a third party pre-consent. Stance: show, do not sanitise |
| Invisible-character visibility | build, tiny: fixed character-class escaping in the renderer | A terminal or Markdown library | A dozen lines of fixed code; a library's escaping would not be deterministic across versions |
| Folder closed-set check | build, thin | Pack archive formats with manifests (npm tarball file lists, `npm pack --dry-run`, OCI) | Those arrive with Item 3 (install from npm) and its own file list; before then the folder is the unit. Written as a function Item 3 calls, so the choice is revisited there, not baked in |
| Machine-readable output and schema | reuse-estate: zod 4 `z.toJSONSchema`, `openSchema`, `publishedKeys` | Hand-written JSON Schema; TypeBox; ajv | One source feeds validation, the schema and the stability test, as for packs and reports |
| Text rendering | reuse-estate: `CommandContext.writeLine`, colour handling in `output.ts` | A table or CLI-formatting library | Output is prose and short blocks; existing commands print the same way |
| Command wiring | reuse-estate: commander, `program.ts` pattern for `packs check` | n/a | Sibling subcommand |
| Test harness | reuse-estate: vitest, in-process `CommandContext`, claude-mock and the `preview-matches-run` wire-recording pattern | A new fixture runner | Existing; inspection needs no agent except to prove shown equals run |
| Hosted review, scoring or signing of packs | out of scope, not built | A registry reputation or signature service | Roadmap "Not in this roadmap": hosted registry, signed distribution |

## 13. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git). Inspection needs no agent, no sign-in, no network, no credential, no service and no git history; it needs a repository only to resolve the project baseline, and runs without one. It runs offline on a pack folder just downloaded.

**Harness.** One project gate (lint, build, vitest), unchanged. A new test enumerates every built-in pack folder and asserts it inspects clean and that its model matches its run, so a built-in that stops being inspectable fails the build, as one that fails `checkPack` already does. Third-party authors get the same function for free: a pack that passes `packs check` should also inspect clean, and the guide says to run both; the folder check's refusals are the author-side reason to remove stray files before publishing.

**Local-run story.** An owner who has a folder from someone else runs the inspect command on it, reads workflows, prompts, guards, hold, the project's gate and closer that will judge the work, and any findings, with nothing executed and nothing written; they then decide whether to list it. An author runs it on their own pack to see what a stranger will see. In CI a script uses `--json` and the exit code (0 inspected, 2 refused) to gate on a pack's content, with the published-keys promise behind the document.

**Deploy target.** The npm package `delivery-service`, released through the repository's changeset flow (a minor change: a new command, a new published schema and one new refusal path that does not affect `run`). Nothing is hosted. The new published-keys file ships under the same test as the existing ones.

**Failure modes and diagnosis.** Every refusal is a plain sentence with the file and field, in the style of `packs check`; exit 2; never a stack trace. A project whose configuration cannot be read as data degrades the baseline, says so in the output, and still inspects the pack.

## 14. Surfaces touched

Code: `src/packs/manifest.ts` (`inspectPack` renamed `readPack`; `Pack` gains `texts`); new `src/packs/inspection.ts`, `src/packs/pack-folder.ts`, `src/cli/packs-inspect-command.ts`, `src/cli/packs-inspect-render.ts`; `src/cli/program.ts` (one subcommand); `src/packs/index.ts` / `src/index.ts` exports for the schema and model. Data: `src/packs/pack-inspection-published-keys.txt`. Docs: `docs/task-packs.md` and `docs/writing-a-pack.md` (what to expect from inspection, the folder rule), `docs/cli-reference.md`. Every built-in folder passes the folder check.

## 15. Not in this item

Install, pinning, approval records, "what changed" diffs (Item 3); settings (Item 4); a scaffold or publish flow (Item 5); editor schema for project config (Item 6); capability declarations for plugins (Item 7); enabling or loading code (Items 8-9); any heuristic or model-based assessment of prompts; per-run provenance of which pack version ran (arrives with pinning). Inspecting a pack that is already listed and whose names clash with the project's workflows is not reported here: clash reporting stays in the loader (`packWorkflowClash`) until install.

## 16. Decisions that no governing document settles

1. **Gate and closer selections.** Shown as "the project's own", because the format has no key for them (Item 1 architecture section 4 left them out deliberately). Roadmap lines 16-18 describe packs holding such choices; the model has the slot (`Selection.source`) and the comparison flags a pack's own choice as `wider` the day the format adds one.
2. **Documentation and VCS/OS metadata allowed in the folder check** (section 3): a closed named set, listed in the output as not read; any other unnamed file is refused.
3. **Folder check applied by inspection and install, not by the run-time loader**, so `/2` packs users already have keep running (Item 1 criterion 4).
4. **The loader is named `readPack`**, so "inspect" names only the command and projection.
5. **A published stability promise for the JSON form** (`delivery.pack-inspection/1`), where run outcomes carry none (roadmap Item 14 note): Items 3 and 7 compare inspections, so the model must not be a second unstable format. Text carries no promise.
