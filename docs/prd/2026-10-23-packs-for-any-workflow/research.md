# Research: Packs for any workflow (roadmap Item 1)

Author: researcher. Scope: facts about the tree at HEAD `0a0f6d2` (branch `autoloop-20261023T121423Z`), the unmerged examples branch, and external prior art. File:line citations are to this worktree unless stated. "UNCERTAIN" marks anything I inferred rather than read.

Provenance rule used throughout: a thing is called a *constraint* only where a governing document says so (cited). Code behaviour is reported as *current behaviour*, not as a requirement.

---

## 0. Governing documents and their status

| Document | What it governs | Status |
|---|---|---|
| `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` Item 1 (lines 67-90) | The brief | Draft roadmap. Item 1 is "brief" detail level (line 83). |
| same, Item 4 (lines 144-167) | Settings must be designed with Item 1's format change, "not as a second one" (163-164) | Same |
| same, Prior art (lines 45-56) | Names `loadPlugin`, named-schedules backend port, AI workflow examples branch | Same |
| `docs/superpowers/specs/2026-10-06-course-correction-design.md` section 5.13 (lines 715-760) | The *current* (`delivery.pack/2`) pack design: pack = distributable bundle of workflows over the ordinary backlog | Delivered. This, not the 2026-10-03 spec, is the live design of `/2`. |
| `docs/superpowers/specs/2026-10-03-task-packs-design.md` | Original `delivery.pack/1` design (findings ledger, `delivery findings`/`fix`) | Marked complete (line 11) but **largely superseded**: its findings system was deleted by 5.13 (course-correction lines 952, 985; changeset `.changeset/replace-findings-with-pack-two.md`). Still the source of the data-only rationale (lines 454-461, 767-785) and of COULD 23 (lines 149-157). Do not cite its manifest fields (lines 427-470: `categories`, `severity`, `landing`, `testGlobs`...) as current. |
| `docs/writing-a-pack.md`, `docs/task-packs.md` | User docs for `/2` | Current; both are review-only in framing (see 10). |

Stray file: `docs/prd/2026-10-23-packs-for-any-workflow/review-log.md` already exists in the bundle dir (untracked per git status). Its heading is "Review Log - Agent Invocation Primitive (Item 4)", i.e. a different design bundle's critic log (references `docs/agent-interface.md`, `sdk.d.ts`). It is not about this item. I did not touch it; the orchestrator should decide whether it is a leftover to remove before the bundle is committed.

---

## 1. The current pack format (`delivery.pack/2`)

A pack is a folder: `pack.json`, a scan prompt file, a fix prompt file, and `fixtures/`. Built-ins: `packs/code-review/` (pack name `code`) and `packs/security-review/` (name `security`). Folder name differs from pack name (`packs/code-review/pack.json:3` `"name": "code"`).

Manifest schema: `PackManifest`, `src/packs/manifest.ts:25-39`, a zod `strictObject`:

| Key | Type | Cite |
|---|---|---|
| `$schema` | optional string, editor hint, ignored | :27 |
| `schema` | literal `"delivery.pack/2"` (`PACK_SCHEMA`, :14) | :28 |
| `name` | slug `^[a-z0-9][a-z0-9-]*$` | :16, :29 |
| `version` | `\d+.\d+.\d+` | :30 |
| `title`, `summary` | non-empty trimmed strings | :17, :31-32 |
| `scan` | `strictObject({ prompt: PackFile })`, **required** | :34 |
| `fix` | `strictObject({ prompt: PackFile, guards?: { add: GuardName[] (min 1) } })`, **required** | :36 |
| `hold` | optional `Severity` | :38 |

`PackFile` (:18) is a bare file name in the pack folder (no path separators).

Strictness is deliberate and carries a user-facing message: an unrecognised key is refused with `DATA_ONLY` text (:111-112, used at :118): "is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check". Documented at `docs/writing-a-pack.md:12`.

**Stability promise (a governing constraint).** `manifest.ts:13` comment: "Additive-only within the major." Enforced by a test: `src/packs/manifest.test.ts:192-204` compares `publishedKeys(openSchema(PackManifest), PACK_SCHEMA)` against the committed file `src/packs/pack-published-keys.txt` in both directions: nothing promised may disappear or change kind, and nothing new may be published without adding its line. Every line in that file is prefixed `delivery.pack/2.` (e.g. `delivery.pack/2.fix.guards.add[] = "backlog-only"`, lines 3-9, lists all seven guard names; `hold` enum values lines 14-17). Origin of the promise: task-packs spec MUST 1 (line 96-97) and line 934 ("stability-promised surfaces are `delivery.pack/1` ..."). Note the spec says "within a major"; it does not say what a new major must do for old packs (that is the Item 1 decision the roadmap hands to the spec, roadmap line 88).

**Data-only is a governing constraint** for this phase: roadmap lines 16-18 ("Packs stay data (prompts, guards, hold policy, choices from built-in gates and closers)") and Item 1 Constraints line 85. Original rationale: task-packs spec 454-461 ("the pack **choosing check kinds and guard globs**, not ... shipping gate code"). Open interpretation point: roadmap line 17-18 explicitly lists "choices from built-in gates and closers" as data. Today's built-in gate *presets* include `command-succeeds { command }` (`src/cli/gate-presets.ts:17`), which carries a shell command string. Whether a pack naming that preset (and so supplying a command) counts as "data only" is **not decided by any document I found**; `DATA_ONLY` text says a pack "cannot give the agent tools or commands" (manifest.ts:112), which concerns the *agent*, not the gate. Flag for the designers.

---

## 2. Loader and validator

- `inspectPack(dir)` `manifest.ts:147-178`: reads `pack.json` (:149), JSON-parses (:153-156), then a **pre-check on `schema`** (:158-161): any `schema` value other than `PACK_SCHEMA` is refused with its own sentence ("this harness reads only delivery.pack/2: packs are now a scan workflow and a fix workflow over the backlog (see docs/writing-a-pack.md)") and the rest of the manifest is *never read*. This is the existing "how old packs are read" behaviour: `/1` is refused, not migrated. Test: `manifest.test.ts:61-64`.
- Then `PackManifest.safeParse` (:162), problems reported per field via `packProblems` (:128-130) using `describe` (:115-126), then reads both prompt files (:165-166), reporting missing files (:136-144).
- `loadPack` (:181-186) throws `InvalidPack` on the first problem. `resolvePack` (:200-206): a name containing `/`, `\` or starting with `.` is a folder resolved from cwd, otherwise a built-in name; unknown gives `UnknownPack` with the list of built-in names.
- `builtInPacks()` (:189-193) loads **every** folder under `BUILT_IN_PACKS` (:133, `packs/` beside `src/`/`dist/`), sorted by folder name, and throws if any one is invalid. Consequence (current behaviour): a broken built-in pack breaks every command that goes through `withPackWorkflows` (see 5). A new built-in is therefore loaded on every command for every project.
- Test pins on the built-in set: `manifest.test.ts:36-38` ("are code and security"), :41-42 (`available: ["code","security"]`); `tests/built-in-packs-pass-the-pack-check.test.ts:14-16` (folders equal `["code-review","security-review"]`); `tests/packaging.test.ts:37` (lists shipped pack files by name). Adding a built-in means updating these; they assert the *set*, not just membership. `package.json:25` ships `packs` in `files`.
- Hash: `manifest.ts:176` SHA-256 over raw manifest, scan text, fix text only. Any additional file a new format lets a pack reference would not be in the hash unless the hash is extended (relevant to Items 2 and 3).
- JSON Schema for editors: `packSchema()` :101, printed by `delivery packs --schema` (`src/cli/packs-command.ts:12-14`), title is the schema id.

---

## 3. What a pack becomes: exactly two workflows, built in code

`inspectPack` :167-175 hard-codes the translation (the manifest has no way to describe a workflow's shape):

- Names: `scanWorkflowOf` = `<name>:scan`, `fixWorkflowOf` = `<name>:fix` (:42-43).
- **Scan workflow**: one step named `scan` (:170). Prompt = pack's `scan.md` text, then `ideaFormat(<name>:fix)` appended (:170, :46-87). Guards: `{ add: ["backlog-only"] }`, fixed in code, not pack-controlled. `after: []` (a scan lands only ideas, so the project's after steps are skipped; comment :169). No `gate` on the step, so the project's gate applies. No `hold`.
- **Fix workflow**: one step named `fix` (:172). Prompt = pack's `fix.md`. Guards `add` = `tests-unchanged` always, plus `fix.guards.add` (:172). `hold` copied from manifest when present (:173). No `gate`, no `after` override, no `agent`, no `continue`.
- Both are values of type `WorkflowConfig` (`src/cli/config.ts:151`: `{ steps: StepConfig[] (min 1), after?, hold? }`, strict). `StepConfig` (`config.ts:108-122`) already supports `name`, `prompt`, `gate` (any `GateChoice`: custom/command gates and the five presets), `agent` options, `continue`, `guards {add, off}`. **So the harness's workflow engine already runs multi-step workflows with per-step gates, guards, `continue` and `after`; the pack format simply cannot express any of it.** The same shape is what `delivery.config.json` `workflows` accepts (`config.ts:207`).

`ideaFormat` (:46-87) is where "scan" is hard-wired into prose. Fixed text includes: "Change nothing in the project", the backlog filename pattern `<UTC timestamp>-<short-slug>.md`, front matter `status: idea`, `workflow: <fix workflow>`, `severity`, `check`; the closed list of three check kinds (:79-83); "write no more than 40" (:85). A non-review pack that reuses this scan machinery inherits the "problem" vocabulary (severities "critical/high/medium/low", "problem", "What is wrong").

---

## 4. Finding schema: the backlog idea

There is no separate finding type any more (deleted by 5.13). A finding is a backlog item:

- Location `.delivery/backlog/` (`src/backlog.ts:10`), file name `YYYYMMDDTHHMMSSZ-slug.md` (:13).
- Front matter `ItemFrontMatter` (`backlog.ts:41-55`, `.catchall(z.unknown())` so extra fields pass through): `status` (`open|idea|resolved|declined`, :15), `workflow`, `priority` (int), `cadence` (e.g. `7d`), `sequence`, `severity` (critical|high|medium|low), `check`. Non-empty body required (:74). `cadence` and `sequence` are mutually exclusive (:75).
- `itemTask` (:109-112) turns an item into a task: `intent` = first body line, `body`, plus **every other front-matter field** as task fields (so arbitrary fields like `package`, `file` are carried to the task; see 6 for who can read them).
- `ItemCheck` (`src/schema.ts:51-60`): closed discriminated union, harness-owned: `anchor-gone {path, anchor, scope?, sensitive?}`, `pattern-absent {pattern, paths[]}`, `dependency-absent {package, version}`. Every kind is a **negative** assertion ("the thing is gone"). `dependency-absent` reads `package-lock.json` only (`item-check.ts:236-243`, `LOCKFILE`). There is no "X is now present/true" kind. Evaluation: `checkItem` `item-check.ts:235-267`; `describeCheck` :274-286.
- Everything the check can see excludes `.delivery/` (`item-check.ts:12-13, 245, 255`).

Original (superseded) finding schema `delivery.findings/1` no longer exists in the tree (changeset text only).

---

## 5. How projects name packs; where workflow names get persisted

- Config key `packs`: `z.array(Written)`, paths relative to the config file (`config.ts:208`; help text :293-294 says "folders of review packs of your own ... each adds its `<name>:scan` and `<name>:fix` workflows"; `docs/configuration-reference.md:163-170`). `CONFIG_KEYS` string at `config.ts:20`.
- `withPackWorkflows` (`src/cli/pack-workflows.ts:9-19`): loads **all built-in packs plus every listed pack**, merges their workflows into `config.workflows`; a name already present (project's own, or another pack's) throws `Refusal(packWorkflowClash)` exit `configuration` (:6, :12-15). Called from `loadConfig` (`config.ts:536`) and `validate` (`validate-command.ts:106, 112`).
- Built-ins need no listing: `delivery review code` works with no config (`review-command.ts:71` checks the scan workflow exists in `config.workflows`, which includes built-ins). A *path* pack must be listed or the review refuses with `packNotListed` (`review-command.ts:34`).
- Where pack workflow names end up **persisted** (these must survive any change, per roadmap Item 1 success criterion 4, line 78):
  1. Backlog item front matter `workflow: code:fix` (written by scans: `manifest.ts:55`; read by `approve`: `backlog-commands.ts:82-87`, which refuses if the workflow is not defined, :27-30); committed in users' repos; also on GitHub issues via `workflow:` label (`config.ts:171-ish` github source note; UNCERTAIN: label spelling not re-read).
  2. A run's pinned `PinnedWorkflow { name, steps, hold }` in the case file (`schema.ts:227`, header field :293) - old runs carry the name and resolved steps, not a reference.
  3. Item ledger key `review:<pack name>` for tracker projects (`review-command.ts:86`).
  4. Projects' `delivery.config.json` `packs: [...]` paths, and any project workflow named `x:scan`/`x:fix` would clash.
  5. Fixtures: `src/packs/review-fixtures.ts` hard-codes `workflow: "code:fix"` / `"security:fix"` (lines 45-126).
- Therefore the names `code:scan`, `code:fix`, `security:scan`, `security:fix` are a de facto compatibility surface. A new format that derives workflow names differently must still produce these four for `/2` packs.

---

## 6. Per-finding gate, guards, and what a "find-then-act" job needs from them

- **Per-item check gate**: `guardedGate` (`src/task-guards.ts:57-76`): after the step's own gate, for every task whose `taskDef.check` is set, `resolvedAssertion` (`item-check.ts:289-298`) adds assertion `item:<itemId>:resolved` (:271-272), PASS only when the check says resolved; unreadable check is FAIL (:293). This applies to **any** workflow and any step whose task has a `check` field, not just pack fixes (course-correction 5.13 "Item checks", line ~738 confirms the intent: "generalised to every item"). Hence a non-review pack's items can already carry `check`.
- **Scan gate**: guard `backlog-only` (`guards.ts:345-348`, `notIdeas` :148-169): only new backlog files allowed; each must parse, be `status: idea`, have `severity` and `check`, and the check must currently find the problem present (:162-165), else the scan fails. So *the scan side requires severity and a present-tense check on every idea*. A find step whose output is not a "problem" (e.g. "this file needs migrating") must still be expressible as one of the three negative check kinds. Examples branch shows this is natural for migration (`pattern-absent` on the legacy import) and upgrades (`dependency-absent` on the old version), less so for docs drift (UNCERTAIN: `anchor-gone` on the stale sentence).
- **Default-on guards** (`guards.ts:50`): `tests-untouched`, `check-untouched`, `no-skips`, `ignored`, `backlog`. Opt-in: `tests-unchanged`, `backlog-only`. Names enum: `schema.ts:37`. `backlog` guard (`guards.ts:341-343`) forbids editing/removing existing items - relevant to any "act" step that resolves items (the harness, not the agent, resolves).
- **Guards are test-suite-shaped**: `tests-untouched`, `tests-unchanged`, `no-skips`, `check-untouched` all protect the project's tests/test config (`guards.ts:325-343`). `docs-drift` style packs have no test-weakening concern, but the guards remain on by default (a step can turn some off via `guards.off`, `schema.ts:63`; the pack manifest cannot, it only has `add`, `manifest.ts:36`). UNCERTAIN: whether any default-on guard obstructs a docs-only change; they only fire on test/config/skip/ignore/backlog changes, so likely not.
- **Task fields vs gates/prompts**: step prompts have `{{task.<field>}}` substituted from the task's fields (`src/prompt-assembly.ts:100-106`, applied at :224). This was reported broken on the examples branch (survey defect 1, `docs/research/2026-10-20-ai-workflows.md:190-195`) but is present at HEAD. **A command gate still cannot see task fields**: gate context carries `taskDef` (`run-gate.ts:21-23`) but the shell command only gets env with `DELIVERY_STEP_START` added (`run-gate.ts:14-16`; `command-gate.ts` passes `ctx.env`, lines 87-108). Survey defect 5 (line 206-208) is therefore still true for command gates and is the Item 4 hook: "settings and task fields share one mechanism?" (roadmap 164-167). Custom gates (code) do receive `taskDef` (examples' `gates/upgraded.mjs`).
- **Gate per step**: a step may name its own gate (`config.ts:113`, pinned at `settings.ts:118-130`). Pack steps never do today. Gate choices: `custom{modulePath}` (code; Item 9 territory), `command{command, parseMode, ...}`, presets `test-runner`, `file-exists{path}`, `command-succeeds{command}`, `schema-validates{file, schema}`, `commits-ahead` (`gate-presets.ts:14-45`). Closers: `merge-back`, `commit-to-branch`, `open-pr{stack?}`, `custom` (`schema.ts:100-123`). Closer is a *project* setting; a workflow cannot choose its own closer (`WorkflowConfig` has no `closer`, `config.ts:151`), and `reviewCommand` forces `merge-back` for the scan (`review-command.ts:78`). The roadmap's phrase "choices from built-in gates and closers" (line 17-18) therefore implies new capability for closers, not just exposing existing config (UNCERTAIN whether Item 1 must include closers; Item 1 criteria at lines 73-78 mention only prompts, guards, hold).

---

## 7. Fix-task generation and the fan-out

There is no fix-task generation step in the pack code any more. The flow, in code:

1. `delivery review <pack>` (`src/cli/review-command.ts`): resolves the pack (:67), requires `<name>:scan` in config (:71), builds a task `reviewTask` (:56-59) with fixed text "Review ${where} and add one idea to the backlog for each problem you find ... Change nothing else.", runs it as one ordinary run with closer forced to `merge-back` (:78), `key = review:<name>` (:86). Output lines "The review added N ideas" (`reviewed`, :33-34), tracker variant `raised` (:35-36).
2. `delivery approve` (`backlog-commands.ts:76-88`): idea -> `status: open` with its own `workflow` (or `--workflow`); commits only item files.
3. `delivery run --sources`: the `backlog` source turns each `open` item into a task via `itemTask`, with its `workflow` (`work-sources.ts:75-90`). **The fan-out is the work source, not the workflow** (5.13: "workflows need no fan-out of their own"). Command sources can also emit tasks with a `workflow` (`work-sources.ts:37, 42, 64-66`); that is how the example branch's migration and upgrade shapes get their per-file/per-package tasks. A *pack* cannot define a source (sources are project config, `config.ts:210`; a `command` source is a shell command, i.e. code).
4. Because the idea's front matter names its own `workflow`, a scan could already point different ideas at **different** fix workflows: `ideaFormat` only ever writes `<name>:fix`, but `approve` and `run` honour any defined workflow name (`backlog-commands.ts:82-87`).

---

## 8. Hold policy

- Config: `WorkflowConfig.hold: Severity` (`config.ts:151`), pinned into the run (`settings.ts:137`, `schema.ts:227`). Pack: `manifest.hold` copied to the *fix* workflow only (`manifest.ts:173`).
- Evaluation: `heldFor` (`src/surface.ts:782-789`): `threshold = header.workflow?.hold`; `severity = Severity.safeParse(taskDef.severity)`; held iff both present and `atOrAbove(severity, threshold)` (`item-check.ts:25-26`, closed order critical>high>medium>low, `schema.ts:41`). An item **without `severity` is never held**; a workflow without `hold` holds nothing. A signed-off item re-checked as it stands is not re-held (:786).
- Consequences for the brief: hold policy is per *workflow* already (so "each with its own hold policy" is a format limitation, not an engine one); the unit is item severity, a four-point scale. Packs whose items lack natural severity (dependency upgrade: major vs patch?) need either a convention that the scan assigns `severity`, or a richer hold rule. UNCERTAIN: whether any document asks for hold rules beyond severity; the roadmap says only "hold policy" (line 76, 17).
- Sign-off commands: `delivery sign-off <id>`, `delivery reject <id>`; text at `escalation-packet.ts:89`. Report/`backlog` listing "Held" documented `docs/task-packs.md:110-115`.

---

## 9. Fixtures and the `check` contract

- Layout, `src/packs/pack-fixtures.ts:8`: `fixtures/project/` (files, committed fresh; must be non-empty; no `.git` segment, :83-100), `fixtures/review.json` (claude-mock script for the scan), `fixtures/fixes.json` (claude-mock script for fixes), `fixtures/expect.json`.
- `expect.json` (`FixtureExpectations`, :22-38): `found[]` (>=1), `fixed[]` (>=1), `refused[]` (**>=1**), all titles; `fixed`/`refused` subsets of `found`, disjoint. So every pack must ship at least one scripted cheat that is refused. This is a code rule, not (as far as I found) a governing-document rule; the docs state it as "Each list needs at least one title" (`docs/writing-a-pack.md:86`). Names `review`/`fixes` are scan/fix-shaped.
- `checkPack` (`src/cli/pack-check.ts:78-165` in file numbering; cited here as function-relative): `inspectPack` + `readFixtures` in parallel; refuses on any problem; optional `confirm` (trust) asked once after validation and before running code (:83); copies scripts to a scratch dir, sandboxed env (`sandboxedEnv` :51-55: only `PATH` and scratch `HOME`); for a non-built-in pack writes a temp `delivery.config.json` `{packs:[dir]}` and commits (:110-115); then **hard-wired sequence**: `reviewCommand(packRef)` (:119), compare ideas to `expect.found`, `approveCommand([], {all:true})` (:135) and `runCommand({sources:true, max})` (:136), then reads the item ledger and classifies by `lastClass`: `delivered|held` = fixed, any other non-null class = refused (reason `WEAKENED_TESTS` if a `guard:` assertion failed else `CHECK_FAILED`) (:150-158). Result type `PackCheck {ready, pack{name,version,hash}, problems, run{found,fixed,refused}, sentToAgent:false}` (:34-42; `--json` documented `docs/writing-a-pack.md:189`).
- So a pack that is not scan-then-fix **cannot be checked today**: the check only knows `<name>:scan` via `review`, then `approve --all`, then `run --sources`. A one-workflow pack, or a pack whose find step is not an agent scan, has no check path.
- Public surface: `checkPack` exported for authors at `delivery-service/testing` (`src/testing.ts:17`, `package.json` exports :18-20); `PACK_SCHEMA`, `loadPack`, `builtInPacks`, `resolvePack` exported from `src/index.ts:117`. Both are published API that a format change touches.
- Built-ins run through the same check in every build: `tests/built-in-packs-pass-the-pack-check.test.ts`. Roadmap Item 1 line 90: "The built-in non-review pack should run end to end against the scripted agent" - the existing mechanism for that is `checkPack` plus `claude-mock` scripts; the scripted agent is the claude-mock stack (`src/mock-script.ts`, `TEST_MOCK_SCRIPT` in `src/cli/agent-session.ts`).
- Fixtures helpers `src/packs/review-fixtures.ts` (`ideaText`, `ScriptedIdea`; hard-coded `code:fix`/`security:fix`) are test/demo support built on `examples/code-review-example/`.

---

## 10. What is hard-wired to "scan then fix" / "review" (inventory)

Code:
1. `PackManifest` requires `scan` and `fix` (`manifest.ts:34, 36`); exactly two workflows built (`:167-175`); names `:scan`/`:fix` (:42-43).
2. `ideaFormat` scan contract and its "problem" vocabulary (:46-87); `backlog-only` guard forced on scan (:170) and the guard's own message "A review only adds ideas" (`guards.ts:347`).
3. `tests-unchanged` forced on fix (:172).
4. `after: []` forced on scan (:170); project `after` still applies to fix.
5. `hold` only on fix (:173).
6. No per-step gate, agent options, `continue`, `after`, or extra steps possible in a pack (all exist in `StepConfig`).
7. `delivery review` = scan-only entry point; closer forced `merge-back`; task text "Review ... add one idea"; ledger key `review:<name>`; success wording (`review-command.ts:33-36, 56-59, 78, 86`). `delivery review <pack>` for a pack with no scan workflow would hit `packNotListed` (a misleading message: "not one your project uses yet", :34, :71).
8. `delivery packs` list wording "These reviews are available", "Run one with: delivery review ..." (`packs-command.ts:22-26`); `packs check` wording "Checking the review in", "the scripted review ...", "Ready to use: delivery review ..." (`packs-check-command.ts:42-45, 70-73`); command help in `program.ts:328-329` ("have an agent review your project"; arg "which review: ... a review folder of your own").
9. `pack-check.ts` sequence (9 above); fixtures names `review.json`/`fixes.json`; expect keys `found`/`fixed`/`refused`.
10. `config.ts:293-294` help text calls packs "review packs".
11. Error/CLI strings in tests: `src/cli/failures.test.ts:98` (UnknownPack render), `packs-command.test.ts`, `packs-check-command.test.ts`, `tests/task-packs-guide.test.ts:11` (asserts the guide mentions listed commands).

Data: item `severity` and `check` mandatory on scan ideas (`guards.ts:160-161`); closed negative-only check kinds (`schema.ts:51-59`); default guards test-suite-shaped.

Docs: `docs/task-packs.md:5` defines a pack as "also called a review ... for one kind of problem"; title "Review your project"; `docs/writing-a-pack.md:3` "a review of your own"; `docs/glossary.md:90`; `docs/index.md:61` "a review pack"; `docs/cli-reference.md:20-21, 30`; `README.md:25, 29`; `mkdocs.yml:93, 98, 143, 148` (nav). Roadmap criterion 1 (line 74) is a documentation criterion; a docs test exists asserting guide contents (`tests/task-packs-guide.test.ts`, `tests/writing-a-pack-guide.test.ts`, `tests/docs-site.test.ts`) - UNCERTAIN what `docs-site.test.ts` asserts about nav (not read).

---

## 11. Everywhere a pack format version bump touches

Code and data (all literal `delivery.pack/2` or `PACK_SCHEMA`):
1. `src/packs/manifest.ts:14` (constant), :28 (`z.literal`), :101 (JSON Schema title), :159-160 (the "other format" refusal sentence naming the single accepted version), plus the comment :13 ("Additive-only within the major").
2. `packs/code-review/pack.json:2`, `packs/security-review/pack.json:2`.
3. `src/packs/pack-published-keys.txt` (all 26 lines are `delivery.pack/2.`-prefixed; the test derives the prefix from `PACK_SCHEMA`, `manifest.test.ts:195`, so a bumped constant makes every promised line "missing" until re-keyed or until the test is extended to a per-version file).
4. `src/packs/manifest.test.ts`: :10 (`minimal`), :50 (describe name), :61-64 (the `/1` refusal test), :181-182 (asserts `PACK_SCHEMA === "delivery.pack/2"`), :192-204 (promise).
5. `src/index.ts:117` exports `PACK_SCHEMA`; `src/cli/packs-command.ts:12-14` prints the schema; `docs/cli-reference.md:73`.
6. Tests that write manifests or check messages: `src/cli/pack-workflows.test.ts`, `src/cli/packs-command.test.ts`, `src/cli/packs-check-command.test.ts`, `src/cli/pack-check.test.ts`, `src/shell.test.ts`, `src/cli/failures.test.ts`, `tests/packaging.ci.test.ts`, `tests/writing-a-pack-guide.test.ts` (grep for `delivery.pack` / `"schema":` matched these; I did not read each).
7. Docs: `docs/writing-a-pack.md:40, 67, 216` ("Always `delivery.pack/2`"), :211 ("Bump `version` when you change the manifest"); `docs/cli-reference.md`; changeset convention in `.changeset/` (the `/2` bump shipped as `minor`: `.changeset/replace-findings-with-pack-two.md`).
8. The case-file / report schemas do **not** carry the pack schema version (grep of `src/schema.ts`, `src/report/*` found no pack version field). Run records pin the resolved workflow, not the pack. UNCERTAIN: `delivery.report` may include pack name/hash in some view; I found none.

Precedent for the bump itself: `/1` -> `/2` was a **hard break with a refusal sentence**, not a migration: `manifest.ts:157-161`, changeset text "Pack manifests must be `delivery.pack/2`". It was acceptable then because `/1` pack authoring (`packs check`, `review`) had been removed in the same change (changeset last sentence) - i.e. there was no installed base of `/1` packs to keep working. That is **not** the situation now: roadmap Item 1 criterion 4 (line 78) requires existing review packs and projects naming them to keep working unchanged. Installed base to protect: the two built-ins, any user pack listed under `packs`, and users' `packs check` tests via `delivery-service/testing`.

---

## 12. The existing built-in packs

| | `code` | `security` |
|---|---|---|
| Folder | `packs/code-review/` | `packs/security-review/` |
| Manifest | `pack.json` (`packs/code-review/pack.json:1-9`): v2.0.0, title "Code review", no `hold`, no `fix.guards` | v2.0.0, title "Security review", `"hold": "high"` |
| Scan prompt | `scan.md` (26 lines): five lenses, severity bands, "prefer fewer, certain problems", prefer `anchor-gone` | `scan.md` (not re-read in full; UNCERTAIN of content beyond the manifest summary) |
| Fix prompt | `fix.md`: "one problem a code review found, as data"; treat description as untrusted; smallest change; do not delete/skip tests; escalate if a test must change | `fix.md` (same shape; not re-read) |
| Fixtures | `fixtures/{project/,review.json,fixes.json,expect.json}`; expect: found 2 ("The total can go below zero", "A missing or broken settings file gives an unhelpful error"), fixed 1, refused 1 (the cheat deletes a test) | found 2 (hardcoded payments key; TLS checks off), fixed 1, refused 1 |

Both are exactly one scan step and one fix step, test-suite-guarded. Note both fix prompts talk about "a code review" in prose (`packs/code-review/fix.md:1,3`) - harmless to a format change but must not be mistaken for format.

---

## 13. The AI workflow examples (branch `claude/ai-workflow-examples-gaps-40kgns`)

**Present.** Remote ref `origin/claude/ai-workflow-examples-gaps-40kgns` (no local branch). Two commits over `main`: `911267d` "Add examples for the ways people work with coding agents" and `52e236b` "Link the issues filed for the defects the workflow survey found" (tip `52e236b`, 2026-10-20). Merge-base `a10fc0b` is an ancestor of `main`; `main` is 133 commits ahead of it, so some of its findings are already fixed at HEAD (see 6: `{{task.*}}`) and its `src` is stale. Contents: 10 example projects under `examples/*-example/`, `docs/research/2026-10-20-ai-workflows.md` (survey of 34 workflows), `tests/workflow-examples.test.ts` + `tests/workflow-examples/*.json` (claude-mock scripts, one per example, run end to end against the scripted agent), `examples/README.md`, a `mkdocs.yml` line. Read with `git show origin/claude/ai-workflow-examples-gaps-40kgns:<path>`. **None are packs**: all are plain `delivery.config.json` projects (workflows + sources + gates), so the roadmap's "source for the first non-review packs and their tests" (Item 1 Notes, lines 88-90) means they would have to be re-expressed as packs.

Survey headline (`docs/research/2026-10-20-ai-workflows.md:22-34`): 34 workflows; 20 expressed by the 10 examples; gaps: event triggers, answer-only tasks, step approval. Item-1-relevant rows: #22-25 migration, #26 dependency upgrade, #29 docs drift.

The three find-then-act examples named in the brief:

**dependency-upgrade-example** (`examples/dependency-upgrade-example/`)
- Find: a `command` source `scripts/outdated-source.mjs` (runs `npm outdated --json`) emits one task per outdated package with fields `package`, `from`, `to`, `workflow: "upgrade"`; id `name@latest` so a later release is a new task.
- Act: workflow `upgrade`, two steps. `bump` (prompt uses "its package field", "its to field"; **custom gate** `gates/upgraded.mjs` reading `taskDef.package/to` and `package-lock.json`); `repair` (`continue: true`, `guards.add: ["tests-unchanged"]`, project gate = `npm test` with `setup: npm ci`).
- Config also relies on: `parkAfter: 1`, `closer: commit-to-branch`, `concurrency` default 1.
- Pack-ability gaps: find is a **source** (code), not a scan; per-step gate is a **custom gate** reading task fields; ideas in a pack scan would have to carry `check: dependency-absent {package, version=old}` instead (which does exist and matches upgrade semantics, but only for `package-lock.json`).

**docs-drift-example**
- Find+act in one: workflow `sync-docs`, one step, gate `command-succeeds` `node scripts/check-docs.mjs --only-docs` (a project script that also asserts only `docs/API.md` changed, reading `DELIVERY_STEP_START`), `after: []`; a recurring backlog item (`cadence: 1d`, file `20261020T080000Z-sync-docs.md`) runs it daily; a project-level `after` agent step runs the check post-landing and raises a `sync-docs` follow-up on failure. Closer `merge-back`, project gate `test-runner`.
- Pack-ability gaps: needs a project script (`check-docs.mjs`) - project-specific, so a shared pack needs Item 4 settings (command/path) or a built-in check; cadence is an item field (data) but a pack cannot ship items; project-level `after` is not per workflow (workflow `after` is, `config.ts:151`).

**migration-campaign-example**
- Find: `command` source `scripts/migration-source.mjs` lists files still importing the legacy module, emits `file`, `workflow: "migrate-file"`.
- Act: workflow `migrate-file`, three steps: `convert` (**custom gate** `gates/file-migrated.mjs`: named `file` no longer imports legacy, and no other file started to; keeps per-worktree baseline in a module `Map`), `tests` (`continue: true`, `tests-unchanged`), `lint` (`continue: true`, gate `command-succeeds` `npm run lint`). `concurrency: 3`, `parkAfter: 2`, closer `commit-to-branch`, playbook `docs/MIGRATION.md`.
- Pack-ability gaps: same as upgrade (source + custom gate on task fields); the "convert" check is expressible as `pattern-absent` on a legacy import in the named file, which would let a data-only pack do it if the scan produced one idea per file (an agent scan can, but listing hundreds of files via an LLM is not what the example does; survey notes 40-idea cap in `ideaFormat` :85).

Survey-found gaps relevant to Item 1/4 (`docs/research/2026-10-20-ai-workflows.md:188-218`): (1) `{{task.field}}` unsubstituted - **fixed at HEAD** (`prompt-assembly.ts:100-106`); (3) a task list entry cannot name a workflow; (5) command gates cannot see task fields - **still true at HEAD**; (6) custom gate modules shared between concurrent tasks; (7) `validate` did not describe sources - the branch's log shows later commits `14b884b`, `f88384d`, `6272ebd` about this on `main` (UNCERTAIN: confirmed fixed on main only by commit titles, not re-run). Roadmap Item 9 (lines 281-282) depends on how many examples still need custom code after Item 4.

Common shape across all three: *a list of units (per package / per file / one) -> per-unit task -> one or more checked steps with a unit-specific check -> usually a non-merge closer*. Only `docs-drift` is a single-step workflow.

---

## 14. Item 4 (settings) and Prior art: what the Item 1 format must leave room for

Roadmap Item 4 (lines 144-167), restated factually:
- Pack "can declare settings it needs, such as the test command, the file layout or the hold severity, with defaults"; owner supplies values in project configuration; unset required setting refused naming it; "values reach the pack's prompts and checks"; inspection shows them.
- Constraint (governing): "Settings are part of the pack format, so they are designed with Item 1's format change and not as a second one" (163-164). I read this as: Item 1's new schema version must already contain (or have a reserved, additive slot for) settings; and because the stability promise is additive-only within a major (`manifest.ts:13`), a settings key added later *within the same major* is allowed - which means "not a second format change" is satisfiable by an additive key **only if Item 1's version is designed so settings can be added additively**. The roadmap statement is ambiguous between "ship the field in Item 1" and "make sure it fits additively"; the spec should say which. (This is my reading; flagged.)
- Open decision handed to Item 4 (lines 164-167): "whether settings and task fields share one mechanism". Facts bearing on it: prompts already have `{{task.<field>}}` (6); command gates have no field access (6); `hold` severity is currently a plain manifest key (`manifest.ts:38`), so a settable hold would change that key's type or add an indirection; Item 6 expects "settings that packs contribute" to appear in the config JSON schema (roadmap 203), and project config is strict (`config.ts:206-ish` `.strict()`), so settings values need a home in `delivery.config.json` that does not break strictness (UNCERTAIN: no such key exists today).
- Item 2 (inspection) depends on Item 1 describing workflows "of any shape" and wants "the gates and closers it selects" visible (roadmap 100-101); Item 9 will let a pack reference custom gates/closers (roadmap 270): a format that names gates/closers by a structured reference today is easiest to extend later.

Roadmap Prior art section (lines 45-56) maps to code as: `loadPlugin`/`guardMethod` in `src/plugin-loader.ts` (not read; UNCERTAIN of its API - relevant only to phase 2); named schedules spec `2026-10-21-named-schedules-design.md` section 7 backend port (not read); AI workflow examples branch (read above).

---

## 15. External prior art (sparing; two searches)

- **Helm chart `apiVersion`** (data-only package manifest with a versioned format): Chart `apiVersion: v2` is what Helm 3 expects, and Helm 3 still installs charts with `apiVersion: v1`; v2 added `dependencies` in `Chart.yaml` (previously a separate `requirements.yaml`) and a `type` field (application/library). Direct analogue for "how old packs are read": the newer reader accepts both versions; the manifest declares which. Source: Helm docs, https://helm.sh/docs/topics/charts (via search summary; I did not fetch the page, so treat the field details as secondhand).
- **Renovate shareable config presets**: JSON/JSON5 files pulled in with `extends`, nestable, pinnable to a git tag; npm-based presets are deprecated. Closest analogue to a data-only shared bundle for dependency-update work, and an example of keeping a back-compat shim at an old path during migration (a GitLab MR cited in the results). I found nothing describing a "no code" guarantee for presets. Sources: https://docs.renovatebot.com/config-presets/ ; https://gitlab.com/gitlab-com/public-sector/pipeline/-/merge_requests/74 (via search summary only).
- Internal analogue: the estate's own `delivery.report` schema, which also has a published-keys stability file pattern (`publishedKeys` in `src/report/json-schema.ts:75`), used by packs at `manifest.test.ts:194-195`.

I did not search for GitHub Actions `action.yml`, Dependabot or Backstage templates; the above two are enough to cite for "reader accepts the previous manifest version" and "data-only shareable preset".

---

## 16. Facts the designers will probably need stated plainly

1. Engine already supports what Item 1 wants; only the pack *format* and a handful of command/doc/check surfaces assume scan-then-fix. Workflows (multi-step, per-step gate/guards/agent/continue, `after`, `hold`) are already first-class in project config (`config.ts:108-151`).
2. Fan-out for a non-review "find" comes from work sources; a pack cannot ship a source. A pack's find step can only be an agent scan that writes backlog ideas (subject to `severity` and a negative `check` per idea, and `backlog-only` guard), or the pack can omit find and rely on items the project/tracker/source provides.
3. `hold` is per workflow and severity-based; severity is an item field.
4. Check kinds are three, negative-only, harness-owned; per-step custom checks need a gate, i.e. a command preset or custom code.
5. The only existing "how are old packs read" behaviour is refusal of a different `schema` string before any parsing (`manifest.ts:157-161`); `/2` itself is under an additive-only promise (`manifest.ts:13`, `manifest.test.ts:192-204`), enforced by test.
6. The built-in set is asserted by name in at least three tests (`manifest.test.ts:36-42`, `tests/built-in-packs-pass-the-pack-check.test.ts:14-16`, `tests/packaging.test.ts:37`), and every built-in is loaded on every config load (`pack-workflows.ts:10`), so a new built-in's workflow names become reserved in every project (`packWorkflowClash`, :6).
7. `checkPack` cannot check a non-scan/fix pack as written (`pack-check.ts` sequence).
8. `{{task.<field>}}` works in step prompts; not in command gates.

## 17. Uncertainties list

- Whether `command-succeeds`/`command` gates are "data" for the data-only constraint (no document decides).
- Whether Item 1 must deliver closer choice (roadmap line 17-18 versus criteria 73-78).
- Exact meaning of "not as a second format change" (Item 4, lines 163-164).
- Security pack `scan.md`/`fix.md` content not re-read; GitHub `workflow:` label spelling; `docs-site.test.ts` nav assertions; contents of `src/plugin-loader.ts`; whether `main` fully fixed survey defects 3, 7.
- Line numbers for `pack-check.ts` are given relative to the file (I verified them via grep against file-numbered output; the `cat -n` output I first read was continuous across files, so I re-derived them).
