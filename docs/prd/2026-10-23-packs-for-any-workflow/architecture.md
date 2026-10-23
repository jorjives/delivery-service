# Architecture: Packs for any workflow

Roadmap Item 1 (`docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, lines 67-90). Facts about the tree are from `research.md` in this folder ("R§n" cites its sections); R§ cites carry the file and line.

## 1. Position in one paragraph

The workflow engine already runs anything a pack could want: workflows with several steps, per-step guards, `hold`, `after`, an item `check` joined to every gate, and fan-out from the backlog work source (R§3, R§6, R§7, R§16.1). Only the pack **format** and a handful of command surfaces assume "one scan, then one fix" (R§10). So this item is a new pack format, `delivery.pack/3`, in which a pack names its own workflows, plus a loader that reads both `/2` and `/3` into one internal model. **No change to the engine, the guards, the case file or the report.** Everything else (find, approve, fan-out, hold, sign-off, item checks) is reused.

## 2. Constraints and where they come from

| Constraint | Source |
|---|---|
| Packs are data only in this phase: prompts, guards, hold policy, choices from built-in gates and closers | Roadmap lines 16-18; Item 1 Constraints line 85. Original rationale: task-packs spec lines 454-461 |
| Existing review packs, and projects that name them, keep working unchanged | Roadmap Item 1 success criterion 4 (line 78) |
| The format version changes; this spec decides how old packs are read | Roadmap Item 1 Notes (lines 87-90) |
| A pack can define workflows other than scan-then-fix, each with its own prompts, guards and hold policy | Roadmap Item 1 criterion 2 (lines 75-76) |
| At least one non-review built-in ships and runs end to end against the scripted agent | Roadmap criterion 3; Notes line 90 |
| Settings (Item 4) are designed with this format change, "not as a second one"; Item 4 is not delivered here | Roadmap lines 163-164; design brief |
| `/2` is additive-only: a pack valid under `/2` stays valid, enforced by test | `manifest.ts:13`; `manifest.test.ts:192-204`; `pack-published-keys.txt` (R§1). Origin: task-packs spec MUST 1 |
| Names `code:scan`, `code:fix`, `security:scan`, `security:fix` persist in users' repos and case files | Not a document: current behaviour (R§5). Treated as a requirement because criterion 4 makes it one |

Not constraints (current behaviour only): the three `ItemCheck` kinds, the `ideaFormat` wording, `tests-unchanged` on every fix, the `refused >= 1` fixture rule (code rule, R§9).

## 3. Why a new version, not an extension of `/2`

`scan` and `fix` are required keys in `/2`. The published-keys lines record `(optional)` for any key not in `required` (`json-schema.ts:55-56`), so making `scan` or `fix` optional changes their promised lines and fails the promise test (`manifest.test.ts:192-197`). Adding a new optional key does not fail it; it only needs its line appended (`:200-203`). A pack that names its own workflows cannot also be forced to carry `scan` and `fix`. A new major is therefore the smallest honest change, as the roadmap expected. The easy choice (bolt an optional `workflows` key onto `/2` beside required `scan`/`fix`) would leave two ways to say one thing in one version and no way to drop the old pair.

## 4. The `delivery.pack/3` format

A pack is still a folder: `pack.json`, prompt files, `fixtures/`. The manifest is a strict zod schema; any key it does not name is refused (data-only is unchanged).

```json
{
  "schema": "delivery.pack/3",
  "name": "deprecations",
  "version": "1.0.0",
  "title": "Move off deprecated code",
  "summary": "...",
  "workflows": {
    "scan": { "kind": "find", "prompt": "scan.md", "ideasFor": ["code", "tests"] },
    "code": { "kind": "act", "summary": "Code of the project's own that still calls the deprecated code.",
              "prompt": "code.md", "guards": { "add": ["tests-unchanged"] }, "hold": { "atOrAbove": "high" } },
    "tests": { "kind": "act", "summary": "A test file that still calls the deprecated code.", "prompt": "tests.md" }
  }
}
```

- Unchanged from `/2`: `$schema`, `schema`, `name` (slug), `version`, `title`, `summary`; `PackFile` (bare file name in the pack folder).
- `workflows`: a map from a local name (slug) to a workflow. The qualified name a project sees is `<pack>:<local>`, the rule `/2` already used (`manifest.ts:42-43`).
- A workflow is a discriminated union on `kind`:

| Key | find | act | Becomes in the engine's `WorkflowConfig` |
|---|---|---|---|
| `kind` | `"find"` | `"act"` | n/a |
| `prompt` | required | required | the single step's `prompt` (step named after the workflow) |
| `ideasFor` | required, non-empty: local names of act workflows its ideas name | n/a | tells the scanner which `workflow:` values to write (section 6) |
| `summary` | n/a | one sentence, required when `ideasFor` has more than one entry | shown to the scanner so it can choose |
| `guards.add` | n/a (fixed `backlog-only`, `after: []`, no hold) | optional `GuardName[]` | step `guards.add` |
| `hold` | n/a | optional `{ "atOrAbove": Severity }` | `WorkflowConfig.hold` |

- Rules this version enforces (validation, not shape, so each can be relaxed later without a major): exactly one `find`; every `ideasFor` entry names an `act`; every `act` appears in some `ideasFor`. The last two make fixtures able to cover every workflow.
- The find workflow's generated form stays exactly what `/2` fixes in code (`manifest.ts:170`): one step named after the workflow, `guards.add: ["backlog-only"]`, `after: []` (project `after` steps do not run after a scan), no `hold`, no gate. These are not pack keys, and the equivalence test (section 7) covers them.
- A pack workflow is deliberately a **subset of a project's `workflows` entry** (`config.ts:151`): only the keys that carry no commands and no extra authority. Left out, with reasons:
  - step `gate`, `agent`, project `closer`: a `command` or `command-succeeds` gate carries a shell command, `agent` carries tools, and `WorkflowConfig` has no `closer` at all (R§6). `DATA_ONLY` says a pack "cannot give the agent tools or commands" (`manifest.ts:111-112`). The roadmap lists "choices from built-in gates and closers" as data (lines 17-18) but no Item 1 criterion needs them; they are left out and are an additive extension (a structured, command-free `gate` object on an act). **Decision flagged for critic and main: R§17 records that no document settles this.**
  - `after`: commands or an agent pass after landing. Project `after` still applies to acts, as to `/2` fix.
  - `guards.off`: a pack may only add to what is guarded, never remove (`guards.ts` `GuardGlob` comment; `/2` exposes `add` only).
  - multi-step workflows: the engine supports them but no Item 1 consumer needs one. A workflow gaining `steps` as an alternative to `prompt` is additive.
- Hold stays severity-based (`surface.ts:782-789`; R§8). Every scan idea carries a severity (the `backlog-only` guard requires it), so a pack-produced item is always under its workflow's policy.

## 5. How old packs are read

**Rule: both versions are read; a `/2` manifest is parsed by its own frozen schema and converted by one pure function into the same model a `/3` manifest produces. Nothing is rewritten on disk.**

Why this and not refusal: `/1` to `/2` was a hard refusal (`manifest.ts:157-161`) only because `/1` authoring had been removed in the same change and no installed base existed (R§11). Now criterion 4 and the `/2` promise ("a pack valid under `/2` stays valid") govern. Prior art for "newer reader accepts the previous manifest version": Helm 3 installs `apiVersion: v1` charts (R§15, secondhand). A migration command that rewrites third-party files was rejected: it touches files the harness does not own, and reading is deterministic.

- Loader dispatches on the `schema` string. `/3`: parse `PackManifest`. `/2`: parse the existing `PackManifestV2` (unchanged) then `upgradeV2`. Any other value is refused before parsing, as today; the sentence now names both readable versions (it still contains `delivery.pack/2`, so the existing `/1` test at `manifest.test.ts:61-64` stands).
- `upgradeV2` is total and mechanical:
  - `scan.prompt` becomes workflow `scan`: `find`, `ideasFor: ["fix"]`.
  - `fix` becomes workflow `fix`: `act`, `guards.add = unique(["tests-unchanged", ...fix.guards.add])` (the order `manifest.ts:172` builds today), `hold = { atOrAbove: hold }` when present.
- The generated `WorkflowConfig`s for `/2` input are required to be **deep-equal to what `/2` produces today**, and the pack hash for a `/2` pack is computed by the same formula (raw manifest, raw scan text, raw fix text, `manifest.ts:176`), so a `/2` pack's pinned workflows, hash and `check` result do not move.
- The `/2` schema and its published-keys lines stay in the repository and the test; the stability file gains `delivery.pack/3.` lines beside the 26 `delivery.pack/2.` lines. `PACK_SCHEMA` (exported at `index.ts:117`) becomes the version written, `/3`; a new constant lists the versions read.
- No deprecation of `/2` is scheduled. **The built-in `code` and `security` manifests stay on `/2`, untouched**. They are then the real `/2` consumers in every build, which is the strongest proof of criterion 4 and needs no frozen test copy; blast radius is smallest (no version bump, no hash change). Cost, accepted: an author who copies a built-in gets `/2`, so the authoring guide points at `deprecations` as the `/3` example and says `/2` still works. The alternative (move them to `/3` plus a frozen copy) and a manifest `noun` key were weighed and rejected: the first adds churn and a test-only consumer, the second adds a key that exists only to preserve prose.

A `/3` pack's hash covers the raw manifest and every prompt file in sorted workflow-name order, so an added prompt cannot change behaviour without changing the hash (R§2 notes today's hash would miss extra files).

## 6. How the pipeline generalises

| Part | Reused unchanged | Parameterised by the pack |
|---|---|---|
| Items: backlog files, `ItemFrontMatter`, `check` kinds, `item:<id>:resolved` on every gate (R§4, R§6) | all | none. Check kinds stay closed and harness-owned; new kinds are an additive harness change, not a pack feature |
| Scan session: `backlog-only` guard, project gate, `after: []`, lands by merge-back or raised to a tracker | all | the scan **prompt**; the `workflow:` target list |
| `ideaFormat` (the harness half of the scan prompt) | text, 40-idea cap, check kinds | takes the list of target workflows. One target renders exactly today's text (golden test); several render a "choose one of" list from each act's `summary` |
| Approve, decline, `run --sources` fan-out, concurrency, ledger, parking | all (they honour any defined workflow name on the item, R§7.4) | none |
| Guards engine and defaults | all | per act: extra `guards.add`. `tests-unchanged` is no longer implied, a pack asks for it |
| Hold, sign-off, reject, escalation text | all | per act: severity threshold |
| Workflow naming, clash refusal (`packWorkflowClash`) | rule | local names, so a pack can have any number of acts |
| Starting a find: `delivery review <pack>` | flow, merge-back, ledger key `review:<name>`, tracker raise, `--path`, `--preview`, output lines | resolves the pack's **find** workflow from the model instead of `<name>:scan`; the preview step name is the find's local name (today the literal `"scan"`, `review-command.ts:74`) |
| **One command story** | n/a | `delivery review <pack>` starts the find of **any** pack; no new verb and no manifest attribute ("is this a review?"). Agreed with the product design (M4 revised). Why it is acceptable to Dana: the command's output takes the pack's own `title` and `summary` ("Move off deprecated code"), so the word "review" appears only in the command she types, which is the verb she already knows; a second verb would be a second thing to learn for the same loop. `delivery packs` prints each pack's start command, `delivery review <name>` for every pack. **Owner-facing wording is keyed on the format a pack declares** (`Pack.schema`, carried by the model): a `/2` pack is by definition a scan-then-fix review and keeps every current string byte for byte (`reviewed`, `NOTHING_FOUND`, `reviewTask`, `packs` and `packs check` lines), so `review code|security` output is unchanged (criterion 4, product M3 and metric 3); a `/3` pack gets pack-neutral strings built from its `title` and `summary`. Strings stay in the modules that own them (section 14) A neutral alias such as `find` is additive later if the word proves a problem. The `packNotListed` refusal is reworded for a pack that is not listed (not for one without a scan) |
| `checkPack` (review, approve all, run sources, classify by ledger) | sequence, sandboxing, trust prompt | resolves the find from the model; new validation that every act is exercised by at least one found idea (a scripted idea's `workflow:` names it) |
| Fixture contract (`review.json`, `fixes.json`, `expect.json`) | file names and the `found`/`fixed`/`refused` rule | none in this item (see section 9 for why the cheat requirement stays) |

The pipeline shape remains **find, then act** (R§16.2: a pack's find can only be an agent scan writing ideas; sources are project config). That is the shape the roadmap states for this item ("any find-then-act job", line 70). What changes is that the find, the acts, their prompts, guards and hold are the author's. Two things are deliberately not offered: a pack with no find (it would need a fixture contract for seeded items) and several finds (it needs a selection rule in `delivery review`). Both are relaxations of validation rules in section 4, so neither needs a new major.

Residual limits, stated: the scan prompt must route each idea to `code` or `tests`, and the scripted agent never reads prompts, so routing quality is not proved by `packs check` (R§9, `docs/writing-a-pack.md` "What a scripted check cannot prove"). If the scan routes an idea wrongly, the owner declines it, or edits the `workflow:` line in the idea file and commits it before approving: `approve --workflow` only fills in ideas that name none, because an idea's own workflow wins (`backlog-commands.ts` `workflowOf`: `item.workflow ?? options.workflow`). One scan writes at most 40 ideas (`ideaFormat`). A sweep with more call sites than that takes repeated scans, each finding what the previous fixes left. Making the cap a pack key is additive.

## 7. Existing packs on the model

| | `code` | `security` |
|---|---|---|
| find | `code:scan`, `scan.md`, `ideasFor: ["fix"]` | same |
| act | `code:fix`, `fix.md`, `guards.add: ["tests-unchanged"]`, no hold | same, `hold: { atOrAbove: "high" }` |
| Manifest, names, prompts, fixtures | unchanged, still `delivery.pack/2` | unchanged, still `delivery.pack/2` |

Equivalence is proved before it is claimed: a characterisation test captures today's loader output (all `WorkflowConfig`s and the hash) for both built-ins, written first against current code, and requires it to be identical after `upgradeV2` replaces the direct `/2` build. This is the intended behaviour under criterion 4, not a snapshot of an accident.

## 8. Machine-readable schema and validation errors

**Schema generation.** One source: the zod schemas. `packSchema()` keeps its method (`z.toJSONSchema(..., { io: "input" })`, R§2) over the `/3` manifest and prints only `/3`; `delivery packs --schema` is unchanged in shape. `kind` as a discriminated union becomes a `oneOf` with a `const` discriminator, and every strict branch carries `additionalProperties: false` (verified against zod 4.5.4 with `io: "input"`; `packSchema` calls `z.toJSONSchema` directly, not `openSchema`), so editors flag unknown keys inside the selected branch. A `$schema` property remains. The schema expresses shape only; the cross-reference rules in section 4 cannot be written in JSON Schema and are reported by the loader, which is the authority. Stability: the published-keys test (existing `publishedKeys(openSchema(...))` machinery, which rewrites `oneOf` to `anyOf` and `enum` to `examples` and walks `anyOf` and `additionalProperties`, `json-schema.ts:19-30` and `:50-72`) is extended to take the lines per version, so `/3` is under the same promise from its first release. Branch lines of the `kind` union publish under the same path with no kind prefix (`json-schema.ts:63-66`), so find-only and act-only keys merge in the promise file; harmless, noted so nobody reads it as per-kind. What counts as additive in `/3`: a new optional key; a new `kind`; a new enum member; relaxing a validation rule. Breaking: removing or retyping a key, making an optional key required, changing what existing text means.

**Errors** keep the `PackProblem { file, field, message }` shape, the field-first sentence style and "name every problem, do not stop at the first" (`manifest.ts:115-130`). New sentences:

| Fault | Message in the style of the existing ones |
|---|---|
| Version not readable | `"schema" is "delivery.pack/1", but this harness reads delivery.pack/2 and delivery.pack/3: ...` |
| No find, or two finds | `"workflows" must hold exactly one workflow with "kind": "find", but it holds none / holds 2 ("a", "b")` |
| `ideasFor` names nothing real | `"workflows.scan.ideasFor.1" is "fx", but this pack's act workflows are: code, tests` |
| `ideasFor` names a find | `"workflows.scan.ideasFor.0" is a find workflow; it can only offer act workflows` |
| Act no find offers | `"workflows.tests" is not listed in any find workflow's "ideasFor", so no idea could reach it` |
| Act-only key on a find (`hold`, `guards`, `summary`) | `"workflows.scan.hold" is only for act workflows` (replaces the generic data-only sentence, which would mislead here) |
| Missing `summary` with several targets | `"workflows.code.summary" is missing: the scan needs it to choose between "code" and "tests"` |
| Reserved key (`settings`) | `"settings" is reserved for pack settings, which this harness does not read yet` |
| Unknown or wrong `kind` | `"workflows.scan.kind" is "scna" but the allowed values are: find, act` (zod reports `invalid_union`, which `describe()` renders generically today, `manifest.ts:125`, so `describe()` gains a case listing the discriminator values) |
| Unknown key, bad enum value, bad slug, missing prompt file | unchanged sentences |

`/2` manifests report in `/2` terms, as today.

## 9. The non-review built-in: `deprecations`

**Choice and why.** Roadmap examples are a dependency upgrade, a migration sweep, a docs-drift check (line 70). Judged by what a data-only pack can *prove* with the three negative check kinds and no network:

| Candidate | Check | Verdict |
|---|---|---|
| Dependency upgrade | `dependency-absent` on the old version | **Buy, not build**: Renovate and Dependabot already do this and need the registry (R§15); an offline agent editing a lockfile is fragile. Not shipped |
| Docs drift | `anchor-gone` on the stale sentence | Weak: deleting the sentence passes. Needs Item 4 settings for a real check (R§13) |
| **Migration sweep** | `pattern-absent` on the legacy call in the named file, plus the project's tests | Strong, offline, and the project defines what is deprecated, so it is generic |

`deprecations` finds call sites of code the project itself has marked deprecated (a `@deprecated` note naming its replacement, or a "legacy" module with a named successor) and moves each call site to the replacement. Item 4 settings later let an owner name the `from` and `to` explicitly. Its fixtures adapt the shape of the unmerged `migration-campaign-example` (R§13), copying nothing from the branch and depending on none of it (roadmap line 56).

**Definition.** The manifest in section 4. Scan prompt rates severity by what breaks if a call site is moved wrongly (payments, authentication, data writes high or critical; display code low). Workflows:

| Workflow | Prompts and guards | Hold |
|---|---|---|
| `deprecations:scan` (find) | `scan.md` plus the harness half | none |
| `deprecations:code` (act) | `code.md`; `tests-unchanged`: moving a call must not need a test to change, so a changed test is a cheat or a behaviour change | `high` and above wait for sign-off |
| `deprecations:tests` (act) | `tests.md`; no `tests-unchanged`: updating a test's own calls is the job. Tests still may not be deleted or skipped (default-on guards) | none |

The three differ in prompts, guards and hold, which is the criterion. The deprecation sweep is not a review: the scan does not judge quality, it lists mechanical work.

**Fixtures** (`packs/deprecations/fixtures/`, same contract as every pack): a small project with `lib/dates.js` (new), `lib/legacy-dates.js` (marked deprecated), `src/invoice.js` and `src/receipt.js` calling the legacy module, and a test file for each, one of which also calls the legacy module directly; a `test` script. `review.json` adds three ideas, each with `pattern-absent` on the legacy import in its file: `invoice.js` (`deprecations:code`, high), `receipt.js` (`deprecations:code`, medium), `receipt.test.js` (`deprecations:tests`, low). `fixes.json`: an honest fix for `invoice.js` (ends held, which `checkPack` counts as passing); an honest fix for `receipt.test.js` (edits a test, passes under `deprecations:tests`); a cheat for `receipt.js` that edits `receipt.test.js` to match (refused by `guard:tests-unchanged`). `expect.json`: found 3, fixed 2, refused 1. The pair "edit a test: refused under `code`, accepted under `tests`" is the proof that guards are per workflow.

The `refused >= 1` rule stays for every pack: every act carries default-on guards, so a cheat is always scriptable, and the rule is what makes `packs check` show the guards working. It is a code rule, not a governing one (R§9); relaxing it later is additive.

## 10. Room for Item 4 (settings), without a second format change

Item 4 wants declared settings with defaults, values supplied in project configuration, values reaching prompts and checks, hold severity settable, and shows them on inspection (roadmap 144-167). I read "not a second format change" as: Item 4 must be deliverable as additive changes within `/3` (R§14 flags the ambiguity; the brief says Item 4 is not delivered, so reserving is the reading consistent with both). `/3` therefore fixes the things that would otherwise force a retype or a meaning change:

1. `hold` is an object, `{ atOrAbove }`, not the scalar `/2` used. Justification: Item 4 lists "the hold severity" among the settings a pack declares with defaults (roadmap lines 148-149), so the same field must later be both a literal default and something an owner's value can replace; a scalar cannot take a sibling "which setting" key without being retyped, and a retype is the second format change Item 4 forbids (lines 163-164). This is a decision, and its cost is one object level that `upgradeV2` absorbs. If the critic prefers a scalar, Item 4 would have to add a parallel `holdSetting` key instead.
2. Workflows and acts are objects keyed by stable local names, so settings can later be scoped to a workflow.
3. The prompt mechanism already exists: step prompts substitute `{{task.<field>}}` and leave unmatched placeholders as written (`prompt-assembly.ts:100-106`, R§6). Item 4 can add `{{settings.<name>}}` to the same function, which also answers its "one mechanism?" question for prompts. `{{settings.` is reserved in `/3` prompts and documented as such; no existing prompt uses it.
4. `settings` is a reserved top-level key with its own refusal sentence (section 8), added later as an optional key.
5. Command gates cannot see task fields (R§6). That is engine behaviour, not format, and `/3` exposes no gate, so nothing in the format has to change when it is fixed.

Nothing in this item reads, validates or substitutes settings.

## 11. Testing (red first, intended behaviour)

All offline, through the existing agent mock (`checkPack`, `claude-mock`, `TEST_MOCK_SCRIPT`; R§9).

- Compatibility (the unchanged claim): the characterisation described in section 7, written first against current code (green), kept green through the change.
- Loader: each message in section 8 has a failing test first; `upgradeV2` over generated `/2` manifests; `/1` and unknown schema still refused; a `/2` and a `/3` pack with the same workflows yield deep-equal models.
- Schema: `/3` schema flags an unknown key, a bad `kind` and a bad guard name; published-keys lines for both versions hold.
- Pipeline: `delivery review` runs a `/3` pack whose find is not called `scan` (including preview); `checkPack` on a pack with two acts fails when one act is never exercised.
- `deprecations`: whole-pack run through `checkPack` and the built-in-pack test; a whole-CLI scripted run (review, approve, run, sign-off of the held `invoice.js` fix); the guard-difference pair.
- Set pins: the three tests that assert the built-in set by name (R§16.6) move to include `deprecations`.
- Criterion 1 ("a new user can tell from the documentation that packs cover more than reviews"): a docs test asserts that the opening paragraph of the packs page and of `docs/index.md` states that a pack is a find-then-act job, reviews being one kind, and names the three built-ins; this is the product design's success metric 1 and the only automated trace of that criterion.
- Docs guides: existing guide tests (`tests/task-packs-guide.test.ts`, `tests/writing-a-pack-guide.test.ts`) are updated so the guides name every `/3` key and the `deprecations` worked example validates.

What scripted tests cannot prove, said in the guide as today: how well a real agent follows `scan.md`.

## 12. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Manifest validation and JSON Schema | reuse-estate: zod 4 `z.toJSONSchema`, `packSchema()` | ajv with hand-written JSON Schema; TypeBox | One source already feeds validation, `--schema` and the stability test |
| Stability promise per version | reuse-estate: `publishedKeys`/`openSchema` and the published-keys file | New golden file format; semver-only convention | Machinery handles unions and maps already; the file just gains `/3` lines |
| Reading old versions | build, thin: one pure `upgradeV2` | Refuse (the `/1` precedent); rewrite-on-disk migration command; external migration framework | Refusal breaks criterion 4; rewriting touches files we do not own; there is one version to bridge. Pattern matches Helm's multi-`apiVersion` reader (R§15) |
| Workflow engine, guards, hold, sign-off, fan-out, item checks | reuse-estate, unchanged | A pack-specific scheduler or gate | The engine already runs every shape needed (R§16.1) |
| Fixture runner and scripted agent | reuse-estate: `checkPack`, claude-mock | A pack-specific fake | One harness for every behaviour; already exported at `delivery-service/testing` |
| Error rendering | reuse-estate: `eachIssue`/`fieldOf`/`PackProblem` | Raw zod messages | Authors already read this style |
| Prompt substitution for settings | defer; reuse-estate `interpolateTask` pattern reserved | Mustache or Handlebars | A library would add a second syntax beside `{{task.x}}`; Item 4 decides |
| Dependency-upgrade pack | buy (not built): Renovate or Dependabot | Ship a `deps` built-in | Commodity, needs registry and network, weak offline (R§15) |
| Migration pack content (prompts, fixtures) | build | Adapting the unmerged examples branch wholesale | Branch examples are projects, not packs, and are not a dependency (R§13); shape is reused, files are new |
| Pack distribution, install, trust | out of scope: Item 3 (npm) | n/a | Roadmap places it later |
| Command or tool access for packs | not provided | Exposing `gate`, `agent`, `after` | Conflicts with `DATA_ONLY`; no Item 1 criterion needs it |

## 13. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git), the vendored claude-mock for the scripted agent, no service, no network and no credential for anything this item adds. A real review uses the agent runtime the CLI already requires. Built-in packs live in the npm package under `packs/` (listed in `package.json` `files`) and are located relative to the installed package (`BUILT_IN_PACKS`, R§2).

**Harness.** One gate for everything, the project's lint, build and vitest run. Within it, every built-in pack folder is run through `checkPack` by a single test that enumerates the folders, so a new built-in is covered by adding its folder and a broken one fails the build rather than every user's command (`builtInPacks()` loads every folder on every config load and throws if any is invalid, R§2). Third-party authors use the same `checkPack` from `delivery-service/testing` in their own test suites.

**Scaffolding.** A new pack is a copy of a built-in folder; the built-ins are the worked examples; `code` and `security` are `/2` review packs and `deprecations` is the `/3` example that shows more than a review, so the authoring guide starts authors from `deprecations`. The manifest has a published JSON Schema that an editor loads through `$schema`. Fixtures are the contract and are validated before they run. There is no scaffold command in this item (Item 5).

**Local-run story.** An author edits a pack folder, sees manifest and cross-reference faults named by file and field, then watches the scripted review, approval and fixes run in a scratch repository with no key and nothing sent to an agent. An owner lists a pack folder in project configuration (built-ins need no listing) and runs it against the real agent; nothing about the run record changes, so `status`, `report` and `backlog` read it as they read any run.

**Deploy target.** The npm package `delivery-service`, released through the repository's changeset flow (a minor change: a new readable format and a new built-in). Nothing is hosted. `code` and `security` stay on `/2` and `deprecations` is `/3`; user packs on `/2` keep loading.

**Built-in name reservation: a decision, not a footnote.** Every built-in's workflow names are reserved in every project, because `packWorkflowClash` runs over all built-ins and every listed pack (R§16.6). Two collisions are possible after upgrade: a project workflow named `deprecations:*`, and, more likely, a pack the project already lists that is itself named `deprecations` (or any future built-in name). Roadmap Items 3 and 5 will encourage published packs, so generic built-in names are a standing hazard. Decided:

1. The built-in is named `deprecations`, specific enough that a collision is unlikely (no `deprecations:` string exists in the repository; researcher fact-check, same as for `migrate:`), where `migrate` or `docs` would be a name authors reach for.
2. Shadowing is rejected: letting a listed pack replace a built-in of the same name would let a pack silently stand in for `security` (a trust problem Item 2 exists to expose). Refusal stays.
3. The clash sentence for a built-in name gains a case naming the built-in and what to rename ("`deprecations` is a pack that comes with the harness; rename the pack in <path> or its workflow"), and the changeset says so.
4. Residual, accepted under criterion 4: criterion 4 protects existing review packs and projects naming them (`code`, `security`); a user pack that happens to be named `deprecations` fails to load until renamed, with a message that says how. Critic and main may overrule; the alternative (no new built-in) fails criterion 3.

## 14. Surfaces touched (inventory, from R§10-11)

Code: `manifest.ts` (two schemas, loader, upgrade, `describe()` cases, `Pack` gains the find), `ideaFormat`, `review-command.ts` (find resolution, preview step) `pack-check.ts` (find resolution, act coverage), `packs-command.ts` (prints each pack's start command; list wording from pack `summary`), `review-command.ts` output lines (`reviewed`, `NOTHING_FOUND`, the task text `reviewTask`, and `program.ts` help for `review`) taking pack title and summary instead of "review" for non-review packs, `packs-check-command.ts` lines ("Checking the review in", "the scripted review ...", "Ready to use") in find/act words (R§10.7-9), `pack-workflows.ts` (built-in clash sentence), `config.ts` help text, `index.ts` exports. Data: new `packs/deprecations/` (the `code` and `security` manifests are untouched). Tests that pin the built-in set or write `/2` manifests (R§11.6). Docs that call a pack "a review": `task-packs.md`, `writing-a-pack.md`, `glossary.md`, `index.md`, `cli-reference.md`, `README.md`, `mkdocs.yml` nav (R§10). New owner-visible strings and who prints them: every `/3` line comes from `review-command.ts` (`reviewed`, the empty case, the cap case), `packs-command.ts` and `packs-check-command.ts`, as fixed strings with the pack's `title`/`summary` slotted in, never agent text. The nothing-found line is printed when the count of ideas the scan merged is 0 (`addedIdeas`, already computed). The cap line is printed when that count equals the harness's `ideaFormat` cap (one exported constant, 40), so it is deterministic and says only "there may be more", never that there are. A pack-specific empty-case sentence (for example how to mark a deprecation) has no deterministic owner and would need a manifest key: not provided; that guidance lives in the pack's how-to page. Reader-facing wording is the product-designer's; this document fixes only that the docs must present reviews as one kind of pack and `deprecations` as another.

## 15. Not in this item (all additive later)

Settings (Item 4); inspection, install, publish (Items 2, 3, 5); packs with no find or several finds; new check kinds; a configurable idea cap; code in packs. Also left out of the floor, each an additive extension within `/3` rather than a new format:

- **Multi-step workflows** (`steps` as an alternative to `prompt`, with per-step `continue` and `guards`).
- **Per-step command-free built-in checks** (`test-runner`, `file-exists`, `commits-ahead`, `schema-validates`, R§6) as a structured `gate` object on an act. Command-carrying ones (`command`, `command-succeeds`) stay excluded while packs are data only.
- **Workflow `after`** and **closer choice** (the engine has no per-workflow closer, R§6).

No Item 1 criterion needs any of them (roadmap lines 73-78 name prompts, guards and hold), so the product design's multi-step and per-step-check items (M1, S4) are not in this item's floor.

## 16. Open questions for critic and main

1. Gate and closer choices left out (section 4); roadmap lines 17-18 can be read as including them.
2. "Not a second format change" read as "additive within `/3`", slots reserved, settings not shipped (section 10).
3. Name-reservation residual (section 13).
