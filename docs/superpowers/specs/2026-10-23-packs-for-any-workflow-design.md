---
seeded_by: []
---

# Delivery Service: Packs for Any Workflow: Design

> **Roadmap:** `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` — Item 1
> **Status:** Draft, awaiting slicing
> **Created:** 2026-10-23
> **Builds on:** task packs (`docs/superpowers/specs/2026-10-03-task-packs-design.md`, `src/packs/`, `docs/task-packs.md`, `docs/writing-a-pack.md`).
> **Audit trail:** `docs/prd/2026-10-23-packs-for-any-workflow/` (`research.md` cited as R§n, `product-design.md` as P§n, `architecture.md` as A§n). Where this document and an approved artefact differ in detail, the artefact wins.

## 1. Problem

A pack means "a review" today: an agent scans, the owner approves, an agent fixes. The workflow engine underneath is more general: a workflow carries its own prompt, guards and hold, and an approved idea can name any workflow (R§3, R§6, R§7.4). Only the pack **format** (`scan` and `fix` are required keys, `delivery.pack/2`), `delivery review`, `delivery packs check` and the documents assume scan-then-fix (R§10). So a project owner cannot use a pack for a dependency upgrade, a migration sweep or a docs-drift check, and an extender cannot author one.

Opportunity: the roadmap's phase 1 (shareable packs) needs a pack format that can describe any find-then-act job before inspection, install, settings and publishing (Items 2 to 5) can build on it.

## 2. Personas and goals

From `docs/personas.md` (team-derived, unratified; goal extensions are assumed, not human-confirmed: no human ratified this run).

| Persona | Goal for this item | Success |
|---|---|---|
| Dana Okafor, non-technical project owner | Use a pack for a job that is not a review and decide what is done and what waits for her | One command lists work in plain words; she approves; signs off or hands the technical block to Marcus; reads one report |
| Priya Shah, harness extender | Author a pack whose workflows are not a scan and a fix and prove it with the scripted agent | Names workflows in the manifest; `delivery packs check` runs every one end to end; mistakes are named by file and field; her `/2` packs need no edit |
| Marcus Webb, on-call engineer | Judge a held migration without re-running the find | Same FOR ENGINEERS block and sign-off handling as any item |

## 3. Goals and success metrics

No telemetry exists or is proposed. Success is checkable in the repository and in a scripted run:

1. The first paragraph of the packs page and of `docs/index.md` states that packs cover more than reviews and names the built-ins (documentation test).
2. `deprecations` runs end to end against the scripted agent on every build: find adds the scripted ideas, `approve --all`, `run --sources` lands the unheld honest fix, holds the high-severity one, and refuses the cheat.
3. Two act workflows with different prompts, guards and hold are exercised by shipped artefacts; a test shows an edit to a test file refused under `deprecations:code` and accepted under `deprecations:tests`.
4. Every existing review pack, its fixtures and a backlog item naming `code:fix` or `security:fix` behave as before: a characterisation test of today's loader output (all `WorkflowConfig`s and the hash) for `code` and `security`, written first against current code, passes through the new loader.
5. Owner-facing strings for `/3` packs contain none of the words the review UX forbids (existing vocabulary test extended).
6. Compatibility of `/3` is enforced from its first release by the published-keys test, in both directions.
7. A malformed `/3` pack is refused with file and field in every case in section 6.5.

## 4. Scope

### 4.1 Derived minimum scope (assumed, not human-confirmed)

The MUST tier M1 to M11 is the derived minimum scope. It was inferred from the roadmap's Item 1 success criteria, not confirmed by a human.

### 4.2 MUST

| # | Capability | Source |
|---|---|---|
| M1 | A new pack format version in which a pack declares named workflows, any number. A workflow is a **find** (an agent writes ideas to the backlog) or an **act** (changes the project for one idea). Each has its own prompt file; each act has its own guards (additions only) and its own hold (A§4) | Roadmap Item 1 criterion 2 |
| M2 | A pack may have several act workflows; the find says which an idea belongs to, and the idea reaches that workflow (A§4, A§6) | Idea `workflow:` honoured (R§7.4); hold per workflow (R§8) |
| M3 | `delivery.pack/2` packs keep working with no edit: same workflow names (`code:scan|fix`, `security:scan|fix`), same commands, same output, same backlog items running (A§5, A§7) | Roadmap criterion 4; names persisted in users' repos (R§5) |
| M4 | `delivery review <pack>` starts any pack's find. Owner-facing wording is keyed on the declared format: a `/2` pack keeps every current string byte for byte; a `/3` pack gets fixed pack-neutral strings built from its `title` and `summary`, never agent text. A pack that is not listed gets a reworded refusal naming the pack, not "the review" (A§6, A§14) | Roadmap criterion 3 |
| M5 | Built-in non-review pack `deprecations` (section 7), with fixtures, passing the pack check on every build | Roadmap criterion 3 and Notes |
| M6 | `delivery packs check` runs a `/3` pack end to end (find, approve, every act, a refused cheat) with the scripted agent only, and fails a pack with an act that no scripted idea reaches (A§6) | Roadmap Notes; R§9 |
| M7 | Documentation: a packs page whose first paragraph says packs cover more than reviews; a how-to for `deprecations`; `writing-a-pack.md` for the new format with `deprecations` as the worked example; glossary, index, README, CLI help, `delivery packs` and check wording stop calling every pack a review | Roadmap criterion 1; R§10 |
| M8 | Data-only stays: keys the format does not name are refused with the existing plain explanation; a malformed `/3` pack is refused by file and field | Roadmap lines 16-18, Item 1 Constraints |
| M9 | Item 4 can add pack settings without a second, incompatible format change (mechanism in section 6.7) | Roadmap Item 4 Notes, lines 163-164 |
| M10 | Workflow name clashes (pack/pack, pack/project) are reported by the existing sentence (R§5); M11 adds the built-in case | Existing behaviour |
| M11 | Shipping a built-in must not make any project that is valid today refuse to load beyond the stated residual: the built-in's names are chosen so no `/2` pack derives them unless the pack is itself named `deprecations`; the clash sentence for a built-in's name names the built-in and what to rename; the changeset and packs page say so (A§13) | Roadmap criterion 4 |

### 4.3 SHOULD

- S1: `delivery packs` lists every pack with one sentence and its start command.
- S2: `delivery packs check` reports what it proved in the pack's own workflow names.
- S3: `writing-a-pack.md` says what fixtures can and cannot prove for non-review shapes.
- S4: Docs navigation groups pack pages under "Packs".
- S5: The release note and packs page state that `delivery review` starts any pack's find.

### 4.4 COULD

- C1: A second non-review built-in; documentation drift is the recommended candidate (it needs Item 4 settings for a real check).
- C2: A neutral alias for `delivery review` (provisionally `delivery find`).
- C3: The 40-idea scan cap as a pack key.

### 4.5 Non-goals (what this design does not include)

- Seeing what a pack will do before running it: Item 2.
- Install from a package or repository, pinning, update diffs: Item 3.
- Pack settings and per-project values: Item 4 (this item only keeps room, M9).
- Scaffolding, publishing: Item 5. Editor completion for project configuration: Item 6.
- Custom gates, closers, sources, plugins: Items 7 to 9. A pack cannot ship a work source (R§16.2), so a pack's find is an agent scan.
- A pack choosing its own gate, closer, step agent or `after` steps; multi-step workflows; per-step command-free checks; packs with no find or several finds; new check kinds. Each is additive later within `/3` (A§4, A§15).
- Event triggers, answer-only tasks, step approval: roadmap Deferred section.
- A dependency-upgrade built-in: Renovate and Dependabot are the commodity answer (A§12).

## 5. UX / Product

### 5.1 Vision

After this item an owner reads one page and knows: **a pack is a shareable, repeatable find-then-act job.** A review is one kind; moving a codebase off code its own team marked deprecated is another and ships built in. The owner finds it with `delivery packs`, starts it with the command they already know (`delivery review <pack>`), chooses what to act on, signs off risky changes and reads the same report as for a review. Nothing about the review journey changes for anyone using it today. Honest limits stay stated: the find step is an agent's opinion, "done" is only as strong as the check behind it, a pack is data and cannot run code.

### 5.2 Journeys

- **J1 Dana learns packs cover more than reviews.** The docs index and packs page say so in the first paragraph, before any word about manifests.
- **J2 Dana moves a codebase off retired code.** `delivery packs` shows `deprecations` with one sentence and its start command; `delivery review deprecations` lists, in plain words, places that still use the retired code, each rated by how serious a wrong move would be (as the agent rates it); she approves some; `delivery run --sources` moves each, accepted only when the old use is gone and the tests still pass; high and critical moves are held for her sign-off or Marcus; the report says what moved, what waits, what could not be done.
- **J3** Output for a non-review pack never says "review found problems"; it uses the pack's own title and summary.
- **J4 Priya authors a non-review pack** by copying `deprecations`, renaming it, adding an act workflow with its own prompt, guards and hold, adding fixtures and running `delivery packs check ./my-pack`.
- **J5 Priya keeps her `/2` review pack**: listed, checked, run and its `mine:fix` backlog items still run, with no edit.
- **J6 Marcus takes over a held migration** with the same FOR ENGINEERS block, `sign-off` and `reject`.

### 5.3 Flows and what a person sees

`delivery packs` prints plain lines (no box drawing; readable at 60 columns, in a pipe and by a screen reader):

```text
Packs you can use:
  code          Looks for wrong results, missing error handling and unused code. Start it with: delivery review code
  security      Looks for weaknesses an attacker could use. Start it with: delivery review security
  deprecations  Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations
```

`delivery review deprecations` (with `--path`, `--preview` as for a review) prints fixed sentences with the pack title and summary slotted in ("Starting: Move off deprecated code. This reads your project and adds to your backlog; it changes nothing else."; closing "The pack added 3 ideas to your backlog"). The later steps (`backlog`, `approve`, `decline`, `run --sources`, `sign-off`, `reject`, `report`) are unchanged; the only new owner knowledge is that `delivery review <pack>` starts any pack's find. Which wording applies is decided by the declared pack format, not by a manifest attribute (A§6).

### 5.4 Documentation

`docs/index.md` and `README.md` gain one sentence (packs are find-then-act jobs, reviews are one kind, three built-ins). New `docs/packs.md`: what a pack is, what each built-in does, the find/approve/act/sign-off loop (also as a numbered list), limits, the name-collision note. New `deprecations` how-to in the structure of `task-packs.md`. `task-packs.md` keeps the review journey and stops defining a pack as a review. `writing-a-pack.md` documents `/3` with `deprecations` as the worked example and states `/2` still works. Glossary, CLI reference, `--help`, `config.ts` help text and `mkdocs.yml` navigation are reworded (R§10). Guide tests are extended to assert the packs page's opening claim and that the how-to names every command it uses.

### 5.5 Accessibility

All output is plain lines, one fact per line, no colour carrying meaning alone, severity always a word, 24-hour UTC times; any diagram has a text equivalent; errors start with the thing at fault.

### 5.6 Empty and error states

| Situation | What the owner sees |
|---|---|
| A `/3` pack adds no ideas | Fixed line from the pack title: "Move off deprecated code found nothing to add. That is the agent's reading of your project, not a guarantee." Printed when the merged idea count is 0 |
| The scan merged as many ideas as the cap (40) | "There may be more: run it again once these have landed." Deterministic: count equals the harness cap constant |
| Unknown pack name | Existing unknown-pack message listing available packs |
| `delivery review <path>` where the pack is not listed | Reworded refusal naming the pack and saying to list it under `packs` |
| Not signed in | Existing exit 3 message |
| An idea names an undefined workflow | Existing refusal at approve |
| Workflow name clash | The clash sentence; for a built-in's name it also names the built-in and what to rename |
| Malformed `/3` pack | Sentences in section 6.5, each naming file and field |
| Unreadable format version | One sentence naming the readable versions |
| A held move | Standard held-item handling, no new states |

## 6. Architecture

### 6.1 Position

The engine already runs anything a pack could want: multi-step workflows, per-step guards, `hold`, `after`, item `check` joined to every gate, and backlog fan-out (R§3, R§6, R§7, R§16.1). Only the pack **format** and a handful of command surfaces assume one scan then one fix. This item is a new pack format `delivery.pack/3`, in which a pack names its own workflows, plus a loader that reads both `/2` and `/3` into one internal model. **No change to the engine, guards, case file or report.**

### 6.2 Constraints and provenance

| Constraint | Source |
|---|---|
| Packs are data only: prompts, guards, hold, choices from built-in gates and closers | Roadmap lines 16-18; Item 1 Constraints line 85; task-packs spec lines 454-461 |
| Existing review packs and projects naming them work unchanged | Roadmap Item 1 criterion 4 |
| Format version changes; this spec decides how old packs are read | Roadmap Item 1 Notes lines 87-90 |
| Workflows other than scan-then-fix, each with own prompts, guards, hold | Roadmap criterion 2 |
| At least one non-review built-in runs end to end against the scripted agent | Roadmap criterion 3, Notes line 90 |
| Settings (Item 4) designed with this change, not delivered here | Roadmap lines 163-164 |
| `/2` is additive-only, enforced by test | `manifest.ts:13`; `manifest.test.ts:192-204`; `pack-published-keys.txt` (R§1) |
| `code:scan`, `code:fix`, `security:scan`, `security:fix` persist in users' repos and case files | Current behaviour (R§5), treated as a requirement because criterion 4 makes it one |

### 6.3 Why a new version, not an extension of `/2`

`scan` and `fix` are required in `/2`; the published-keys lines record `(optional)` for any key not required (`json-schema.ts:55-56`), so making them optional changes their promised lines and fails the promise test. A pack naming its own workflows cannot also be forced to carry `scan` and `fix`. A new major is the smallest honest change; bolting an optional `workflows` key onto `/2` would leave two ways to say one thing in one version.

### 6.4 The `delivery.pack/3` format

A pack is still a folder: `pack.json`, prompt files, `fixtures/`. The manifest is a strict zod schema; any key it does not name is refused.

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

Unchanged from `/2`: `$schema`, `schema`, `name`, `version`, `title`, `summary`, `PackFile`. `workflows` maps a local name (slug) to a workflow; the qualified name a project sees is `<pack>:<local>` (`manifest.ts:42-43`). A workflow is a discriminated union on `kind`:

| Key | find | act | Becomes in `WorkflowConfig` |
|---|---|---|---|
| `kind` | `"find"` | `"act"` | n/a |
| `prompt` | required | required | the single step's `prompt` (step named after the workflow) |
| `ideasFor` | required, non-empty: local names of act workflows its ideas name | n/a | tells the scanner which `workflow:` values to write |
| `summary` | n/a | one sentence, required when `ideasFor` has more than one entry | shown to the scanner so it can choose |
| `guards.add` | n/a (fixed `backlog-only`, `after: []`, no hold) | optional `GuardName[]` | step `guards.add` |
| `hold` | n/a | optional `{ "atOrAbove": Severity }` | `WorkflowConfig.hold` |

Validation rules (rules, not shape, so each can be relaxed later without a major): exactly one `find`; every `ideasFor` entry names an `act`; every `act` appears in some `ideasFor`. The find's generated form stays what `/2` fixes in code (`manifest.ts:170`): one step named after the workflow, `guards.add: ["backlog-only"]`, `after: []`, no `hold`, no gate; covered by the equivalence test.

A pack workflow is deliberately a **subset of a project's `workflows` entry** (`config.ts:151`): only keys carrying no commands and no extra authority. Left out: step `gate` and `agent` and a closer (a `command` gate carries a shell string, `agent` carries tools, and `WorkflowConfig` has no `closer`; `DATA_ONLY` says a pack "cannot give the agent tools or commands", `manifest.ts:111-112`); `after` (project `after` still applies to acts); `guards.off` (a pack may only add guards); multi-step workflows (additive later). Hold stays severity-based (`surface.ts:782-789`); every scan idea carries a severity (the `backlog-only` guard requires it).

**Accepted decision (D1):** gate and closer choice are excluded. No document settles whether the roadmap's "choices from built-in gates and closers" (lines 17-18) is in Item 1, no criterion needs it, a pack-supplied shell string is what Item 2 inspection would most need to flag, and Item 4 settings are the better route.

### 6.5 Reading old packs, schema and errors

**Both versions are read.** The loader dispatches on `schema`: `/3` parses `PackManifest`; `/2` parses the existing `PackManifestV2` (unchanged) then a pure total `upgradeV2` into the same model; any other value is refused before parsing (the sentence now names both readable versions and still contains `delivery.pack/2`, so the existing `/1` test stands). `upgradeV2`: `scan.prompt` becomes workflow `scan` (`find`, `ideasFor: ["fix"]`); `fix` becomes workflow `fix` (`act`, `guards.add = unique(["tests-unchanged", ...fix.guards.add])`, `hold = { atOrAbove: hold }` when present). Generated `WorkflowConfig`s for `/2` input must be deep-equal to today's, and a `/2` pack's hash uses the same formula (raw manifest, raw scan text, raw fix text, `manifest.ts:176`), so its workflows, hash and check result do not move. Nothing is rewritten on disk; a rewriting migration command was rejected (touches files the harness does not own). Refusal was rejected (breaks criterion 4; `/1` was refused only because no installed base existed, R§11).

The built-in `code` and `security` manifests **stay on `/2`, untouched**: they are the real `/2` consumers in every build, which is the strongest proof of criterion 4, with the smallest blast radius. Accepted cost: an author who copies a built-in gets `/2`; the guide points at `deprecations` as the `/3` example. A manifest `noun` key was rejected (a key that exists only to preserve prose). A `/3` pack's hash covers the raw manifest and every prompt file in sorted workflow-name order. The `/2` schema and its published-keys lines stay in the repository and the test; the stability file gains `delivery.pack/3.` lines beside the 26 `delivery.pack/2.` lines. `PACK_SCHEMA` (exported at `index.ts:117`) becomes the version written, `/3`; a new constant lists the versions read. No `/2` deprecation is scheduled.

**Schema.** One source: the zod schemas. `packSchema()` keeps its method (`z.toJSONSchema(..., { io: "input" })`) over the `/3` manifest and prints only `/3`; `delivery packs --schema` is unchanged in shape. The `kind` union becomes `oneOf` with a `const` discriminator and strict branches carry `additionalProperties: false`, so editors flag unknown keys in the selected branch. The schema expresses shape only; the cross-reference rules are reported by the loader, the authority. The published-keys test takes lines per version, so `/3` is under the promise from its first release (branch lines of the `kind` union merge in the promise file with no kind prefix, `json-schema.ts:63-66`). Additive in `/3`: a new optional key, a new `kind`, a new enum member, a relaxed validation rule. Breaking: removing or retyping a key, making an optional key required, changing meaning.

**Errors** keep `PackProblem { file, field, message }`, field-first sentences, and name every problem:

| Fault | Message |
|---|---|
| Version not readable | `"schema" is "delivery.pack/1", but this harness reads delivery.pack/2 and delivery.pack/3: ...` |
| No find, or two finds | `"workflows" must hold exactly one workflow with "kind": "find", but it holds none / holds 2 ("a", "b")` |
| `ideasFor` names nothing real | `"workflows.scan.ideasFor.1" is "fx", but this pack's act workflows are: code, tests` |
| `ideasFor` names a find | `"workflows.scan.ideasFor.0" is a find workflow; it can only offer act workflows` |
| Act no find offers | `"workflows.tests" is not listed in any find workflow's "ideasFor", so no idea could reach it` |
| Act-only key on a find (`hold`, `guards`, `summary`) | `"workflows.scan.hold" is only for act workflows` (replaces the generic data-only sentence, which would mislead here) |
| Missing `summary` with several targets | `"workflows.code.summary" is missing: the scan needs it to choose between "code" and "tests"` |
| Reserved key | `"settings" is reserved for pack settings, which this harness does not read yet` |
| Unknown or wrong `kind` | `"workflows.scan.kind" is "scna" but the allowed values are: find, act` (`describe()` gains a case for `invalid_union`, `manifest.ts:125`) |
| Unknown key, bad enum, bad slug, missing prompt file | unchanged sentences |

`/2` manifests report in `/2` terms.

### 6.6 How the pipeline generalises

Reused unchanged: items and `check` kinds (closed, harness-owned), the scan session (`backlog-only`, project gate, `after: []`, merge-back or tracker raise), approve/decline/`run --sources` fan-out, guards engine, hold, sign-off, reject, escalation text, the clash rule. Parameterised by the pack: the scan **prompt** and the `workflow:` target list; per-act `guards.add` (`tests-unchanged` is no longer implied: a pack asks for it); per-act hold threshold; local workflow names.

- `ideaFormat` takes the list of target workflows. One target renders exactly today's text (golden test); several render a "choose one of" list from each act's `summary`. The 40-idea cap and check kinds are unchanged.
- `delivery review <pack>` resolves the pack's **find** from the model instead of `<name>:scan`; the preview step name is the find's local name (today the literal `"scan"`, `review-command.ts:74`); ledger key `review:<name>`, `--path`, `--preview` unchanged. No new verb, no manifest attribute. `delivery packs` prints each pack's start command.
- `checkPack` resolves the find from the model and validates that every act is exercised by at least one scripted idea. The fixture contract (`review.json`, `fixes.json`, `expect.json`, the `found`/`fixed`/`refused` rule) is unchanged; the `refused >= 1` rule stays because every act carries default-on guards, so a cheat is always scriptable (a code rule, not a governing document, R§9; relaxing it is additive).
- Wording: keyed on `Pack.schema` carried by the model. A `/2` pack is by definition a scan-then-fix review and keeps every current string (`reviewed`, `NOTHING_FOUND`, `reviewTask`, `packs` and `packs check` lines); a `/3` pack gets pack-neutral strings from its title and summary. Each string stays in the module that prints it.

The shape remains **find, then act** (a pack's find can only be an agent scan, R§16.2; sources are project config). Not offered: a pack with no find (it would need a fixture contract for seeded items) and several finds (they need a selection rule in `delivery review`); both are relaxations of validation rules.

**Residual limits, stated to owners:** the scan prompt must route each idea to `code` or `tests`, and the scripted agent never reads prompts, so routing quality is not proved by `packs check`. A mis-routed idea is declined, or its `workflow:` line edited and committed before approving (`approve --workflow` only fills in ideas that name none; an idea's own workflow wins). One scan writes at most 40 ideas; a larger sweep takes repeated scans.

### 6.7 Room for Item 4 (settings)

"Not a second format change" is read as: Item 4 must be deliverable as additive changes within `/3` (R§14 flags the ambiguity). `/3` therefore fixes what would otherwise force a retype:

1. `hold` is an object `{ atOrAbove }`, not `/2`'s scalar. Item 4 lists hold severity among declared settings with defaults (roadmap lines 148-149), so the same field must later be a literal default and replaceable by an owner's value; a scalar cannot take a sibling key without a retype. Cost: one object level that `upgradeV2` absorbs. If a scalar is preferred, Item 4 would add a parallel `holdSetting` key.
2. Workflows and acts are objects keyed by stable local names, so settings can later be scoped.
3. Step prompts already substitute `{{task.<field>}}` and leave unmatched placeholders as written (`prompt-assembly.ts:100-106`). Item 4 can add `{{settings.<name>}}` to the same function; `{{settings.` is reserved in `/3` prompts and documented.
4. `settings` is a reserved top-level key with its own refusal sentence, added later as an optional key.
5. Command gates cannot see task fields (R§6): engine behaviour, not format; `/3` exposes no gate, so nothing in the format changes when it is fixed.

Nothing in this item reads, validates or substitutes settings.

## 7. The built-in non-review pack: `deprecations`

**What it does.** Finds places that still use code the project's own team has marked deprecated (a `@deprecated` note naming its replacement, or a legacy module with a named successor) and moves each place to the replacement. Each place becomes an idea; approved ideas are moved by an agent; a move is accepted only when the old use is gone from that file and the project's tests pass. The project, not the pack, says what is deprecated, so no per-project settings are needed; Item 4 will let an owner name from and to explicitly.

**Choice.** Judged by what a data-only pack can prove with the closed negative check kinds and no network:

| Candidate | Check | Verdict |
|---|---|---|
| Dependency upgrade | `dependency-absent` on the old version | Buy, not build: Renovate and Dependabot do this and need the registry (R§15); an offline lockfile edit is fragile. Not shipped |
| Docs drift | `anchor-gone` on the stale sentence | Weak: deleting the sentence passes. Needs Item 4 settings. Recommended second built-in (C1) |
| **Migration sweep** | `pattern-absent` on the legacy call in the named file, plus the project's tests | Strong, offline, generic |

The name `deprecations` (not `migrate` or `docs`) is chosen because generic words are what authors reach for in their own `/2` packs, which would collide on upgrade (M11).

| Workflow | Prompts and guards | Hold |
|---|---|---|
| `deprecations:scan` (find) | `scan.md` plus the harness half; rates severity by what breaks if a call site is moved wrongly (payments, sign-in, data writes high or critical; display code low) | none |
| `deprecations:code` (act) | `code.md`; `tests-unchanged` (moving a call must not need a test to change) | `high` and above wait for sign-off |
| `deprecations:tests` (act) | `tests.md`; no `tests-unchanged` (updating a test's own calls is the job; deleting or skipping tests stays refused by default-on guards) | none |

**Fixtures** (`packs/deprecations/fixtures/`): a small project with `lib/dates.js` (new), `lib/legacy-dates.js` (marked deprecated), `src/invoice.js` and `src/receipt.js` calling the legacy module, a test file for each (one also calling the legacy module directly) and a `test` script. `review.json` adds three ideas, each with `pattern-absent` on the legacy import in its file: `invoice.js` (`deprecations:code`, high), `receipt.js` (`deprecations:code`, medium), `receipt.test.js` (`deprecations:tests`, low). `fixes.json`: an honest fix for `invoice.js` (ends held, which `checkPack` counts as passing); an honest fix for `receipt.test.js`; a cheat for `receipt.js` that edits `receipt.test.js` to match (refused by `guard:tests-unchanged`). `expect.json`: found 3, fixed 2, refused 1. Fixtures adapt the shape of the unmerged `migration-campaign-example` (R§13), copying nothing from that branch and depending on none of it.

**Owner text.** `delivery packs` line as in section 5.3; start of a run states what it will read, that it changes nothing but the backlog, and that the list is the agent's opinion; an idea is a plain sentence naming the place and its replacement with the agent-rated seriousness; a held move uses the standard held-item text. Never "pattern-absent", "guard", "deprecation sweep" or "check kind" in owner text.

**Limits stated in `docs/packs.md` and the how-to:** the agent's list is an opinion ("nothing found" means it found none); a scan writes at most 40 ideas (run again after moves land); a move is checked in its own file and by tests, so it cannot prove behaviour no test covers (sign-off on high-severity moves exists for that); which moves wait depends on the severity the agent assigns, so sign-off protects only as well as that rating, and the owner can decline or hold anything by reading the backlog; if the project marks nothing as deprecated the pack finds nothing and says so, and how to mark a deprecation is taught in the how-to, not printed by the command.

## 8. Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Manifest validation and JSON Schema | reuse-estate: zod 4 `z.toJSONSchema`, `packSchema()` | ajv with hand-written JSON Schema; TypeBox | One source already feeds validation, `--schema` and the stability test |
| Stability promise per version | reuse-estate: `publishedKeys`/`openSchema`, published-keys file | New golden file format; semver-only convention | Machinery handles unions and maps; the file gains `/3` lines |
| Reading old versions | build, thin: one pure `upgradeV2` | Refuse (the `/1` precedent); rewrite-on-disk migration command; external migration framework | Refusal breaks criterion 4; rewriting touches files we do not own; one version to bridge. Matches Helm's multi-`apiVersion` reader (R§15, secondhand) |
| Workflow engine, guards, hold, sign-off, fan-out, item checks | reuse-estate, unchanged | A pack-specific scheduler or gate | The engine already runs every needed shape (R§16.1) |
| Fixture runner and scripted agent | reuse-estate: `checkPack`, claude-mock | A pack-specific fake | One harness; already exported at `delivery-service/testing` |
| Error rendering | reuse-estate: `eachIssue`/`fieldOf`/`PackProblem` | Raw zod messages | Authors already read this style |
| Prompt substitution for settings | defer; reserve the `interpolateTask` pattern | Mustache or Handlebars | A library adds a second syntax beside `{{task.x}}`; Item 4 decides |
| Dependency-upgrade pack | buy (not built): Renovate or Dependabot | Ship a `deps` built-in | Commodity, needs registry and network |
| Migration pack content | build | Adapt the unmerged examples branch wholesale | Branch examples are projects, not packs, and not a dependency (R§13) |
| Distribution, install, trust | out of scope: Item 3 | n/a | Roadmap places it later |
| Command or tool access for packs | not provided | Exposing `gate`, `agent`, `after` | Conflicts with `DATA_ONLY`; no criterion needs it |

## 9. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git), the vendored claude-mock for the scripted agent; no service, network or credential for anything this item adds. A real run uses the agent runtime the CLI already requires. Built-in packs live under `packs/` (in `package.json` `files`) and are located relative to the installed package (`BUILT_IN_PACKS`, R§2).

**Harness.** One gate for everything: the project's lint, build and vitest run. Every built-in pack folder is run through `checkPack` by a single test that enumerates the folders, so a broken built-in fails the build rather than every user's command (`builtInPacks()` loads every folder on every config load and throws if any is invalid, R§2). Third-party authors use the same `checkPack` from `delivery-service/testing`.

**Scaffolding.** A new pack is a copy of a built-in folder; `code` and `security` are `/2` review packs and `deprecations` is the `/3` example, so the authoring guide starts authors from `deprecations`. The manifest has a published JSON Schema loadable through `$schema`. Fixtures are validated before they run. No scaffold command (Item 5).

**Local-run story.** An author edits a pack folder, sees manifest and cross-reference faults named by file and field, then watches the scripted find, approval and acts run in a scratch repository with no key and nothing sent to an agent. An owner lists a pack folder in project configuration (built-ins need no listing) and runs it against the real agent; the run record is unchanged, so `status`, `report` and `backlog` read it as any run.

**Deploy target.** The npm package `delivery-service`, released through the changeset flow (a minor: a new readable format and a new built-in). Nothing is hosted.

**Built-in name reservation (decision).** Every built-in's workflow names are reserved in every project, because `packWorkflowClash` runs over all built-ins and every listed pack (R§16.6). After upgrade a project workflow named `deprecations:*`, or a listed pack itself named `deprecations`, collides. Decided: (1) the built-in is named `deprecations`; no `deprecations:` string exists in the repository (researcher check); (2) shadowing a built-in is rejected as a trust problem Item 2 exists to expose; (3) the clash sentence for a built-in name names the built-in and what to rename, and the changeset says so; (4) the residual (a user pack named `deprecations` fails to load until renamed, with a message that says how) is accepted under criterion 4, which protects existing review packs and projects naming them. The alternative (no new built-in) fails criterion 3.

**Testing (red first, intended behaviour; all offline through the agent mock).** Compatibility characterisation written first against current code and kept green; loader tests for each message in section 6.5, `upgradeV2` over generated `/2` manifests, `/1` and unknown schema still refused, a `/2` and a `/3` pack with the same workflows yield deep-equal models; schema tests (unknown key, bad `kind`, bad guard name; published-keys lines for both versions); pipeline tests (`delivery review` runs a `/3` pack whose find is not called `scan`, including preview; `checkPack` fails when an act is never exercised); `deprecations` whole-pack run, a whole-CLI scripted run (review, approve, run, sign-off of the held `invoice.js` fix) and the guard-difference pair; the three tests that pin the built-in set by name include `deprecations` (R§16.6); docs test for criterion 1; guide tests updated so guides name every `/3` key and the `deprecations` example validates. Not provable by scripted tests, and said so in the guide: how well a real agent follows `scan.md`, and routing quality.

**Surfaces touched.** Code: `manifest.ts` (two schemas, loader, upgrade, `describe()` cases, `Pack` gains the find), `ideaFormat`, `review-command.ts` (find resolution, preview step, output lines `reviewed`, `NOTHING_FOUND`, `reviewTask`), `pack-check.ts`, `packs-command.ts` (start command, list wording), `packs-check-command.ts` (lines in find/act words), `program.ts` help, `pack-workflows.ts` (built-in clash sentence), `config.ts` help text, `index.ts` exports. Data: new `packs/deprecations/`. Tests that pin the built-in set or write `/2` manifests (R§11.6). Docs: `task-packs.md`, `writing-a-pack.md`, `glossary.md`, `index.md`, `cli-reference.md`, `README.md`, `mkdocs.yml`, plus new `docs/packs.md` and the `deprecations` how-to. Every `/3` owner string comes from `review-command.ts`, `packs-command.ts` or `packs-check-command.ts` as fixed text with the pack's `title`/`summary` slotted in, never agent text. The cap line is printed when the merged count equals the one exported cap constant (40). A pack-specific empty-case sentence has no deterministic owner and would need a manifest key: not provided.

## 10. Risks

- Name reservation: section 9.
- The scripted agent never reads prompts (`docs/writing-a-pack.md`, "What a scripted check cannot prove"); `deprecations` prompt quality is verified by a person reading them and a recorded real run, and the docs say so.
- "Review" as the start verb for a non-review pack may feel wrong once a second non-review pack ships; C2 is the escape and is deliberately not built now.

## 11. Assumptions and open questions

Assumptions (no human confirmed any): the derived minimum scope M1 to M11 (section 4.1); persona goal extensions in `docs/personas.md`; D1 (gate and closer choice excluded); "not a second format change" read as additive within `/3`; the name-reservation residual accepted. The critic recorded no unresolved disagreement. The main-line open items for downstream slicing: whether the roadmap's "choices from built-in gates and closers" should later be read as in-scope for packs (Item 2 and 4 will revisit); whether a neutral alias for `delivery review` is wanted once a second non-review pack ships (C2).
