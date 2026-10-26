---
seeded_by: []
---

# Delivery Service: Inspect a Pack Before Trusting It: Design

> **Roadmap:** `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` — Item 2
> **Status:** ✅ Complete — 2026-10-24 — all 5 slices delivered
> **Created:** 2026-10-23
> **Builds on:** packs for any workflow (`docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`), task packs (`docs/superpowers/specs/2026-10-03-task-packs-design.md`, `src/packs/`, `docs/task-packs.md`).
> **Audit trail:** `docs/prd/2026-10-23-inspect-a-pack/` (`research.md` cited as R§n, `product-design.md` as P§n, `architecture.md` as A§n). Where this document and an approved artefact differ in detail, the artefact wins.

## 1. Problem

A pack is a folder of prompts that an agent follows with every power the project's agent already has. Sessions run with permissions bypassed (`src/agent-invoke.ts:246-247`, R§1.2). A pack cannot ask for more power through any field, because every level of the format is a strict object (`src/packs/pack-format.ts`, R§0.2); it can only ask in words, and the words are the risk. The roadmap says so: "prompt injection is the real risk of sharing. Inspection is the first control and comes before install" (roadmap Item 2 Notes).

Today an owner cannot read a pack before it runs. `delivery packs` lists names and summaries; `delivery review <pack> --preview` needs the pack already listed in the project and shows one step of one run; `delivery packs check` runs the pack's fixture code and asks a trust question (R§0.4, R§0.5, R§2). The loader never looks at stray files and follows symlinks when it reads a prompt (`manifest.ts:128`, R§3), so "this is the whole pack" is not something anyone can currently say.

Opportunity: roadmap phase 1 (shareable packs) needs inspection first. Install (Item 3), settings (Item 4) and plugin capabilities (Item 7) all build on a model of "what this pack will do".

## 2. Personas and goals

From `docs/personas.md` (team-derived, not human-confirmed; goal extensions for this item are assumed). P§2.

| Persona | Goal | Success |
|---|---|---|
| Dana Okafor, non-technical project owner | Decide whether to use a pack someone else wrote | From the first screen she can say what it does, how far it goes before asking her, and whether anything unusual was found |
| Priya Shah, harness extender | See her own pack as an owner would; be refused in her terms for unnamed content | Same command, no extra flags; a refusal names the file and what to do |
| Marcus Webb, on-call engineer | Understand what an agent was told when a held change from a pack reaches him | Inspects the originating pack and reads one workflow's instructions and hold without opening files |

## 3. Goals and success metrics

No telemetry. Success is checkable in the repository (P§7): per built-in pack, the output holds every workflow, each act's guards and hold in words, the "Checks and landing" line, every prompt byte for byte (except visible escapes) and a fingerprint equal to `Pack.hash`; inspection makes no agent call, spawns nothing, writes nothing, asks nothing; works for an unlisted folder outside any project; every refusal names the file and reason, exits 2 and prints no prompt text; hidden characters are visible and flagged; the owner-vocabulary test passes and forbids "safe", "clean", "verified"; `--json` validates against a published schema and carries the same facts as the text; and a comprehension fixture: for a stranger-pack fixture with a deliberately unsafe-looking prompt and no hold, the sections above the first prompt marker ("In short", "How far", "Does it widen", "Things to look at") alone contain what the pack is for, that it lands without sign-off, and the flag. Roadmap criterion 4 is thereby evidenced without a user study; the human reading remains a recorded observation, not a test (P§7.7).

## 4. Capabilities (MUST / SHOULD / COULD)

### Derived minimum scope (assumed, not human-confirmed)

The MUST tier is derived from the four roadmap Item 2 success criteria and made usable (P§4). No human confirmed it; the critic verified it against the roadmap (`review-log.md`).

### MUST

- **M1** One read-only command, `delivery packs inspect <pack>`, for a built-in name, a project-listed pack or a folder path; works for an unlisted folder and outside a project; runs no fixture, spawns nothing, makes no agent call, asks no trust question.
- **M2** Per workflow: name, find or act, deterministic plain-sentence purpose from `title`/`summary` (never generated), and for a find the acts it can send ideas to.
- **M3** Full prompts verbatim, pack's own words separated from words delivery-service adds (the find's `ideaFormat`, shown once). Control, bidirectional, zero-width and escape characters shown visibly (`<U+202E>`) and counted, never printed raw.
- **M4** Guards in plain words per act, the effective set including `tests-unchanged` that a `delivery.pack/2` pack gains on upgrade, using the sentences in `docs/configuration-reference.md`.
- **M5** Hold policy in plain words per act; the absent case ("lands without asking you again, once you have approved the idea") is stated.
- **M6** "Checks and landing": states that the pack chooses no gate and no closer, so every workflow uses the project's own (see D1).
- **M7** "What it may touch": a fixed statement that instructions run with everything the project's agent can do, that nothing in a pack narrows that, where the project's own checks stop a change, and that an act's landing runs the project's follow-on steps.
- **M8** Widening answered two ways from one shared list: a positive statement printed every time ("Nothing in this pack widens what the agent may do beyond your project's defaults", followed by the dimensions compared (guards, sign-off, checks, landing, follow-on steps, agent options) and the permanent notice that prompts are not analysed and must be read); and "Things to look at", a closed list: `lands-without-sign-off`, `hold-only-critical`, `hidden-characters`, `older-format-guards`, plus any `wider` comparison row. Stricter differences (added guards, a hold, skipped follow-on steps) are plain facts, not flags. When there is nothing to note: "Nothing unusual was found in what this command checks. That is not a guarantee about the instructions." Never "safe", "clean" or "passed".
- **M9** A folder is refused whole (exit 2, no prompt text) for a symlink anywhere, an unnamed file or folder, a prompt no workflow names, or a prompt that is not valid UTF-8. Documentation and housekeeping files (`README*`, `LICENSE*`, `CHANGELOG*`, top-level `.git/`, `.gitignore`, `.gitattributes`, `.DS_Store`, `Thumbs.db`) are allowed, listed as "not read when the pack is used". No size cap.
- **M10** Manifest-level refusals keep their existing sentences, all problems at once; exit 2 for any refusal, 0 for an account including one with flags.
- **M11** Legible to a non-author: plain lines, no box drawing, no colour carrying meaning, readable at 60 columns; short account first, verbatim prompts last; glossary vocabulary.
- **M12** Documented where owners look (packs page, CLI reference) with a worked reading of a built-in, saying inspection is a reading aid and not a guarantee.

### SHOULD

- **S1** `--json`: the same facts as one versioned document, including the pack hash.
- **S2** `--workflow <name>`: a view filter over the same account; an unknown name is refused listing the pack's workflows.
- **S3** The fingerprint printed in the human output.
- **S4** Dropped (a prompt-phrase scanner; see 5.3). The numbering is kept so P§4 and A§5 citations hold.
- **S5** `delivery packs` footer pointing at inspect.
- **S6** The `packNotListed` refusal in `delivery review` mentions inspect.
- **S7** Fixtures named with file names and sizes, "not read when the pack is used".
- **S8** A fixed "Questions to ask before you use it" block.

### COULD

- **C1** `--all` across listed packs. **C2** Compare two packs or versions (belongs to Item 3). **C3** Markdown or HTML rendering. **C4** Line numbers in verbatim prompts.

## 5. Architecture

Inspection is a **pure projection of the loaded pack** (A§1). The loader that `delivery review`, `delivery run` and `delivery packs check` use reads the folder; a pure function turns the resulting `Pack` into an `Inspection` model; one renderer prints it as text and the same model is the `--json` document. Nothing is re-parsed for inspection, so what is shown cannot drift from what runs, and inspection cannot accept what `delivery run` refuses. Two checks sit beside the projection: the folder holds only content the format names, and a deterministic comparison of each workflow against the project's own defaults.

### 5.1 Reading and refusing (A§3)

Reading is one pass of the unchanged loader plus the folder check, and their problems are merged. (1) `pack.json` is checked as a regular file, so a symlinked `pack.json` is refused like any other link. (2) The folder is listed without following links and links and unnamed paths outside the closed set in M9 are collected; (3) The unchanged loader parses and cross-checks the manifest and reads the prompts (the "prompt no workflow names" refusal needs the manifest), collecting every problem, including a missing or non-UTF-8 prompt. Folder and manifest problems are printed together, each by file, so M10's "all problems at once" holds across both kinds. On any refusal no pack text is printed (decision D6). The loader's function is renamed `readPack` (from `inspectPack`) so "inspect" names only the command and projection. A manifest whose `schema` this build does not read is refused whole, never shown best-effort; for a newer format the sentence tells the owner to upgrade the harness.

The folder check is a separate function (`src/packs/pack-folder.ts`) called by inspection now and by install (Item 3) later, **not** by the run-time loader, so existing `/2` packs with a stray file keep running (Item 1 criterion 4, `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`). A `/3` pack with a stray unnamed file still runs; it does not inspect clean.

### 5.2 The model (A§4)

`inspectionOf(pack, baseline)` in `src/packs/inspection.ts`. `Pack` gains `texts` (authored prompt text by file) and `declared` (the manifest before `upgradeV2`). The model carries: identity (name, version, title, summary, format, `hash`, source); workflows by qualified name with kind, summary and offered acts; per step the prompt as two labelled parts (authored, harness-added); guards in effect via the engine's own `activeGuards`; hold; the gate and closer ("the project's own", named when a project is found); after steps (`afterFor`, `src/cli/after-landing.ts`); the agent's powers; files with roles; comparison rows; `widens`; findings. A test asserts `authored + harness === the step's prompt` for every built-in. Prompts are shown as bytes, never as Markdown; the only transformation is the fixed visible-escape class, and the JSON carries the raw string.

Model shape (A§9, sketch, not final):

```
Inspection (ok: true)
  schema: "delivery.pack-inspection/1"
  pack: { name, version, title, summary, format, hash, source: { kind: "built-in" | "folder", path } }
  project: { found, config: "read" | "code" | "none", gate: Selection | null, closer: Selection | null, fence, agentOptions, after }
  workflows: [ { name, local, kind, summary?, offers?: [name],
                 steps: [ { name, prompt: { authored, harness }, guards: { default, added, off },
                            gate: { source }, agent: { source } } ],
                 hold: Severity | null, after: { source, steps } } ]
  files: [ { path, role: "manifest" | "prompt" | "fixture" | "documentation", bytes } ]
  widens: boolean
  comparison rows per workflow (dimension, relation: "same" | "stricter" | "wider")
  findings: [ { code, relation: "wider" | "note", where, detail } ]
  notices: [ "prompts-not-analysed" | "tools-follow-your-claude-setup" | "hidden-characters" ... ]
Refusal (ok: false): { schema, ok: false, problems: [ { file, field, message } ] }
```

`Selection` is `{ source: "project" | "pack", type, summary }`; `PackProblem` (`{ file, field, message }`) is reused for refusals.

### 5.3 "Widens beyond project defaults" (A§5)

Baseline: what a step of the project's own workflow gets when it overrides nothing (default guards, the project's gate, closer, agent options, fence mode and after steps resolved as a run resolves them, no hold). Without a project, the harness defaults are used and gate and closer are "not known without a project". The comparison is a table typed over the keys of `StepConfig` and `WorkflowConfig`; each returns `same`, `stricter` or `wider`, and adding a key to either schema fails the build until it is classified. Today every pack that loads can only be stricter (add guards, set hold, skip `after` on a find), so the output says "nothing widens" positively; the `wider` branch is the contract that fires when the format gains a gate, agent or closer key (Items 4, 7, 9), proved now by synthetic `WorkflowConfig` tests.

**No prompt heuristics.** Inspection shows, it does not sanitise, score or reassure. A phrase scanner gives false assurance and is evadable; an LLM judge is non-deterministic and ships untrusted text to a model before consent.

### 5.4 Where it lives (A§6, A§7)

Command `delivery packs inspect` in `src/cli/packs-inspect-command.ts` beside `packs check`; projection, folder check, baseline and renderer in `src/packs/` and `src/cli/` (A§6 table). The baseline reads project configuration as data only (`findConfig({ dataOnly: true })`), starting from the repository root and never inside the pack folder. Inspection does not import `checkPack`, the scripted agent, `loadPlugin` or any gate or closer loader; it writes nothing; enforced by test.

### 5.5 Output and stability (A§8, A§9)

Text has no stability promise. `--json` carries `"schema": "delivery.pack-inspection/1"`, a JSON Schema generated from the zod source and a published-keys file under the existing `publishedKeys` test; a refusal is `{ "ok": false, "problems": [...] }`, exit 2. The promise exists because Items 3 and 7 compare inspections. Prompt text in `--json` is raw and must be treated as untrusted data.

## 6. Key flows (P§3, P§5)

1. **Dana is handed a pack:** `delivery packs inspect ./their-pack`. First screen "In short", then "What it may touch", "How far each workflow goes before it asks you", "Checks and landing", "Does it widen what the agent may do?", "Things to look at", questions to ask, folder listing, then the verbatim prompts.
2. **Built-in:** the same account for `deprecations`; built-ins are not exempt.
3. **Refusal:** names the file and one plain reason, states nothing was shown, run or sent, and shows no partial account (a partial account reads as an approval). Wording drafts are in P§5.2.
4. **Author check:** Priya inspects her own folder as a stranger would.
5. **Bad-hour read:** `--workflow fix` shows one workflow in full.
6. **Machine read:** `--json` for tooling and for Item 3's approval record.

Empty and error states (missing folder, unknown name, outside a project, bad JSON, `/2` pack, hidden characters) are tabled in P§5.3. Accessibility and plain language rules (glossary vocabulary, cause-first sentences, no "safe"/"clean"/"verified", British English) are P§6.

## 7. Buy-vs-build decisions

Ledger in A§12; headline decisions:

| Capability | Decision | Rationale |
|---|---|---|
| Reading and validating a pack | reuse-estate: existing loader (`readPack`) | A second parser lets "shown" and "run" drift apart |
| What a pack will run | reuse-estate: `Pack.workflows`, `activeGuards`, `guardChanges` | The pinned `WorkflowConfig` is what runs |
| Baseline gate and closer | reuse-estate: `resolveProject`, `findConfig({ dataOnly })`, `inferGate` | One resolution for run and inspect |
| "Widens beyond defaults" | build, thin: typed comparison table | A policy engine (OPA, Cedar) is a second language for six rules; the typed table forces classification of every future key |
| Prompt-injection detection | not provided, by decision | Heuristics give false assurance; an LLM judge is non-deterministic and pre-consent |
| Invisible-character visibility | build, tiny: fixed character-class escaping | A library's escaping would not be deterministic across versions |
| Folder closed-set check | build, thin, callable by Item 3 | Archive formats arrive with install |
| JSON output and schema | reuse-estate: zod 4 `z.toJSONSchema`, `publishedKeys` | One source feeds validation, schema and stability test |
| Text rendering | reuse-estate: `CommandContext.writeLine`, `output.ts` | Output is prose and short blocks |
| Hosted review, scoring, signing | out of scope | Roadmap "Not in this roadmap" |

No library is added (P§9, R§5). Prior art informs the design: GitHub Actions' "read the source, pin the commit" (the fingerprint is our commit SHA), `npm pack --dry-run` (list what else is in the folder), Terraform `plan` (a read-only command ahead of the acting one), Chrome and VS Code permission prompts (they show a closed declared-permission list, which our format does not have, so the display is the prompts themselves) (R§5).

## 8. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node, TypeScript ESM, zod 4, git). Inspection needs no agent, sign-in, network, credential or git history; it needs a repository only to resolve the project baseline and runs without one, offline, on a folder just downloaded.

**Harness.** The project gate (lint, build, vitest) is unchanged. A new test enumerates every built-in pack and asserts that it inspects clean and that its model matches its run. Tests build packs on disk and call the command in process through `CommandContext`; the scripted agent appears only to prove shown equals run (A§11). A test asserts every value in the rendered text exists in the model.

**Local-run story.** An owner runs the command on a folder, reads it, then decides whether to list it. An author runs it on their own pack. CI uses `--json` and the exit code (0 inspected, 2 refused).

**Deploy target.** The npm package `delivery-service`, via the existing changeset flow (a minor change: a new command, a new published schema, one new refusal path that does not affect `run`). Nothing is hosted.

**Failure modes.** Every refusal is a plain sentence with file and field, exit 2, never a stack trace. A project whose configuration cannot be read as data degrades the baseline, says so, and still inspects the pack.

## 9. Testing

Offline, through the existing machinery (A§11): tests build packs on disk and call the command in process through `CommandContext`; the scripted agent appears only where the claim is "inspection shows what runs".

- **Shown equals run (anti-drift).** For each built-in (`code`, `security`, `deprecations`) and a purpose-built `/3` fixture: the model's pinned prompt, guards, hold and workflow list are deep-equal to what `delivery review <pack>` pins into the run.
- **Authored plus harness equals pinned prompt** for every workflow of every built-in.
- **Widening, both directions.** Synthetic `WorkflowConfig`s: a step with `guards.off`, a `gate`, an `agent`, a non-empty `after` each yield `wider` naming the dimension; added guards, `hold`, `after: []` yield `stricter`; a plain step yields no finding. A compile-level test asserts the table covers every key of `StepConfig` and `WorkflowConfig`. The real built-ins yield no `wider`, and the output says so in words.
- **Refusals.** One failing test per rule: unnamed file, symlink out of the folder, stray unreferenced prompt, non-UTF-8 prompt, unknown manifest key, unreadable format version, newer format; each asserts the plain sentence, the file/field, exit 2, that no prompt text appears, and that the `--json` form is `ok: false`. A `/2` pack with a `README.md` inspects clean; with a stray `.sh` file it is refused while `delivery review` still runs it.
- **Hidden characters.** A prompt containing a right-to-left override, a zero-width space and an ESC sequence: no raw characters in the text, visible escapes, a `hidden-characters` finding with the count; `--json` holds the raw string. Each note code has a firing and a non-firing case; `--workflow` output equals the matching slice of the full model; a git checkout with `.git/`, `.gitignore` and `.DS_Store` inspects clean and lists them as not read.
- **No execution, no writes.** Run against a pack whose `fixtures/project/package.json` test script writes a marker file, with process spawning mocked to fail if called and a before/after snapshot proving no write; a project `delivery.config.js` is not executed and a config inside the pack folder is never read.
- **Determinism, stability, text from model.** Two runs yield byte-identical JSON and text; the published-keys test and schema validation for `delivery.pack-inspection/1`; every quoted value in the rendered text exists in the model.
- **Criterion 4.** A golden rendering per built-in, generated from the model and reviewed by the product designer.

Not provable by tests: whether a prompt is malicious. Inspection makes it readable; the owner decides.

## 10. Decisions and assumptions

- **D1 (assumption flagged for the operator).** The roadmap says "the gates and closers it selects" (Item 2 criterion 1), but the shipped format has no such field (`pack-format.ts:39-73`, R§0.1; Item 1 deliberately left them out). Inspection reports "the project's own" and keeps the slot (`Selection.source`) for Item 9. The roadmap wording is a stale premise.
- **D2.** Command shape `delivery packs inspect <pack>` beside `packs check`; `delivery preview` and `delivery review --preview` keep their meaning.
- **D3.** The folder allow-list (documentation and VCS/OS metadata) is a closed named set no governing document settles; a later format version can extend it.
- **D6.** When the folder check and the loader both find problems, all are shown together and none of the pack's text is printed, so a linked prompt is refused and its content never shown (A§3 "a refusal from either stage stops before any prompt text is produced"; P§4 M9, M10).
- **D4.** The folder check is applied by inspection and install, not the run-time loader, to keep existing `/2` packs running.
- **D5.** `--json` carries a published stability promise; text does not.
- **Derived minimum scope** (section 4) is assumed, not human-confirmed.
- **Unverified research claims** (R): guard semantics, whether an act inherits the project's `after` steps (confirmed by the architect at `afterFor`), the fence configuration, and several prior-art rows written from memory. None is load-bearing for a MUST.

No critic disagreement is unresolved: both artefacts were approved in final form (`review-log.md`).

## 11. What this design does not include

- Install from elsewhere, version pinning, recording approvals, refusing a changed pack, update diffs: Item 3. Inspect prints the hash and a stable `--json` so Item 3 can build on it; it records nothing.
- Pack settings and the values that would apply: Item 4 (output has room for a "Settings" section; the format refuses `settings` today).
- Writing, scaffolding, validating and publishing a pack: Item 5. `delivery packs check` keeps that role.
- Editor support: Item 6.
- Plugin capabilities, enabling code, packs carrying gates and closers: Items 7 to 9. When a pack can name a custom gate or closer, M6 shows it and M8 gains a flag.
- Sandboxing the agent, or any claim that inspection makes a pack safe (Item 7 decides containment).
- Judging a pack's quality, or running it to see what it does.
- Scanning prompt text for dangerous phrases; prompt length caps or empty/long flags.
- Reporting workflow-name clashes with listed packs: stays in the loader (`packWorkflowClash`) until install.
- Inspecting packs in bulk or comparing versions (COULD C1, C2).

## 12. Risks

False comfort from "nothing unusual" (mitigated: always "not a guarantee", prompts shown in full, M12); prompts that are long, subtle or in an unfamiliar language; hidden-text attacks beyond the covered character classes (M3 shows rather than detects, which fails safe); drift between inspect, the loader and `packs check` (single-source loader, plus a test running all three over the same fixtures); the command going unfound (S5, S6). See P§10.
