# Research: inspect a pack before trusting it

Roadmap Item 2 (`docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md:96-116`). Researcher notes for the design team. Repo facts cite `file:line` at this branch's HEAD; external facts cite URLs. Anything not verified is marked **ASSUMPTION**. The CLI was not executed (no `node_modules` in this worktree); command output below is read from source.

## 0. Findings that change the brief

1. **A pack selects no gates and no closers today.** The roadmap success criterion says the owner sees "the gates and closers it selects" (roadmap :102-103) and the roadmap Context says packs hold "choices from built-in gates and closers" (roadmap :16-18). The `delivery.pack/3` format has no such field: the manifest is `schema, name, version, title, summary, workflows, $schema` (`src/packs/pack-format.ts:64-73`), a find has `kind, prompt, ideasFor` (:39-43), an act has `kind, prompt, summary, guards, hold` (:45-51). The built workflows carry no `gate`, `agent`, `after` (acts) or `continue` (`src/packs/manifest.ts:169-174`; the prior bundle reached the same conclusion, `docs/prd/2026-10-23-packs-for-any-workflow/research.md:69,156`). Every pack step therefore runs under the **project's** gate (`StepConfig.gate` "the project's own `gate` when left out", `src/cli/config.ts:112-113`) and closer. So for every pack that can exist in this format, "the gates and closers it selects" is "none: the project's own". Inspection must say that explicitly (an owner reading silence cannot tell "none" from "not shown") and the design must decide whether the roadmap wording is a stale premise or a future-proof slot. This is a conflict between roadmap prose and the shipped format: surface it to the owner.
2. **A pack cannot structurally widen agent power; the only lever is prompt text.** See section 3. The honest "what it is allowed to touch" answer for a `/3` pack is: everything the project's agent can already touch, directed by the pack's words.
3. **Unknown keys are already refused everywhere in the format** (section 4). Success criterion 3 ("a pack that carries something the format does not name is refused with a plain explanation") is largely satisfied by existing behaviour at the manifest level; the gaps are in the pack *folder* (extra files, symlinks), not in the manifest.
4. **No existing command shows a not-yet-listed pack's prompts.** `delivery review <pack> --preview` needs the pack to be listed in the project's config first (section 2), so a stranger's pack must be installed-by-listing before it can be previewed: the opposite of "before installing".
5. **`delivery packs check` runs the pack's fixture project's own test command as real code** and asks a trust question first (`src/cli/pack-check.ts:279-292`, `src/cli/packs-check-command.ts:102-115`). An inspect command must not do that: it must be read-only and run nothing.

## 1. The pack format as it stands

### Folder
`pack.json`, one prompt file per workflow (shared prompts allowed: each file is read once, `manifest.ts:222`), and `fixtures/` (`project/`, `review.json`, `fixes.json`, `expect.json`; `src/packs/pack-fixtures.ts:8`). Fixtures are read only by `delivery packs check`; the runtime loader (`inspectPack`, `manifest.ts:192-238`) reads `pack.json` and the named prompts only. Built-ins live in repo `packs/` (`code`, `deprecations`, `security`); `BUILT_IN_PACKS` `manifest.ts:117`.

### Manifest, `delivery.pack/3` (written format)
| Field | Where | Notes |
|---|---|---|
| `schema` | `pack-format.ts:67` | literal `delivery.pack/3`; `/2` also read (:7) |
| `name` | :68 | slug `^[a-z0-9][a-z0-9-]*$` (:13) |
| `version` | :69 | `\d+.\d+.\d+` (:16) |
| `title`, `summary` | :70-71 | non-empty trimmed sentences |
| `workflows` | :72 | record slug to find/act |
| find: `prompt`, `ideasFor[]` | :39-43 | prompt is a bare filename (`PackFile` :15, `basename(file) === file`), so no `..` or subfolder paths |
| act: `prompt`, `summary?`, `guards.add[]?`, `hold.atOrAbove?` | :45-51 | |

Cross-field rules (`src/packs/pack-rules.ts:16-58`): exactly one find; every `ideasFor` names an act; every act is offered by some find; an act among several offered needs a `summary`.

`/2` packs (`code`, `security`) are strict too (`PackManifestV2` `z.strictObject`, :22-36) and are upgraded in memory: `scan` becomes a find offering `fix`; `fix` an act with `tests-unchanged` always added, plus any `fix.guards.add`; `hold` becomes `hold.atOrAbove` (`upgradeV2` :84-96). An inspector must show the **upgraded** (effective) guards or it will under-report `tests-unchanged` for `/2` packs.

### What a loaded pack becomes
Each local workflow is renamed `<pack>:<local>` (`manifest.ts:157`) and becomes a one-step `WorkflowConfig` (`config.ts:152`, strict: `steps, after?, hold?`):
- **Find:** prompt = pack's prompt text + harness-appended `ideaFormat` (`manifest.ts:169`, `ideaFormat` :23-72, which also lists each offered act and its `summary`). Guards fixed to `backlog-only` (not pack-controlled). `after: []`, so the project's after steps do not run for a scan.
- **Act:** prompt = pack text only; guards `add` from the pack; `hold` from the pack (`manifest.ts:171-174`). **No `after` is set**, so the project's own `after` steps (e.g. a deploy command) run after an act lands (`config.ts:150-152` comment: `after` replaces the project's when present; absent means the project's apply). **ASSUMPTION** on the absent-means-inherit reading; confirm in `src/cli/settings.ts` / `src/after*` if the designers want to show it.
- Packs can also carry a hash of manifest plus prompts: `Pack.hash` (`manifest.ts:75-82,180-185,236`): sha256 over raw manifest, then each prompt text. `/3` hashes prompts in sorted workflow-name order; `/2` in written order (:233-235). Useful as the identity Item 3 will pin; inspection can print it.

### Guards (the closed list)
`tests-untouched, tests-unchanged, check-untouched, no-skips, ignored, backlog, backlog-only` (`src/schema.ts:37`). A pack can only **add** guards (`guards: {add}` only; `off` exists in `GuardSwitches` `schema.ts:63` but the pack format has no `off`, and the translation copies `add` alone, `manifest.ts:172`). So guards from a pack never weaken the project's checks. **ASSUMPTION:** I did not read `src/guards.ts` for each guard's exact semantics; designers wanting a one-line plain meaning per guard should ask me to verify against `guards.ts` and `docs/writing-a-pack.md`.

### Hold policy
`hold.atOrAbove: critical|high|medium|low` (`schema.ts:41-43`): a finished act whose idea is at or above the severity waits for `delivery sign-off` instead of landing (`config.ts:150-151`, `surface.ts:782-784`). The workflow-level `hold` is the only hold: there is no project-level default hold in the code I grepped (`grep "hold"` over `src`), so a pack's hold can only add a human step, never remove one. **Absence matters to the owner:** an act with no `hold` lands without sign-off (the built-in `deprecations:tests` has none, `packs/deprecations/pack.json`), after the owner has approved the idea. Inspection should say "lands without sign-off" in that case.

### The agent's power, from the project side
- Every session runs `permissionMode: "bypassPermissions"` with `allowDangerouslySkipPermissions` (`src/agent-invoke.ts:246-247`).
- The project's `agent` block is a loose pass-through of any SDK option the harness does not own: model, `mcpServers`, `plugins`, `settings`, `sandbox` etc. (`schema.ts:188-199`); `HARNESS_OWNED` keys are refused (:184). Steps may layer their own `agent` (`config.ts:114-115`), gates may be `custom` modules or `command` gates with shell strings (`schema.ts:70-80`, `config.ts:112-113`), and `after` steps run shell commands (`config.ts:129-150`). **None of these are expressible in a pack** (strict objects at every level), but they are exactly what a future format could add (Items 4, 8, 9) and what "widening" would mean.
- `delivery preview` already tells owners the runtime truth: "Your own Claude Code settings, CLAUDE.md, skills, plugins, hooks and MCP servers also apply. It can use every tool your setup allows." (`OWN_SETUP`, `src/cli/preview-command.ts:80-83`) and prints `Agent options: ...` (:86-92). Reusable wording for the "what it may touch" section.
- Write fence: `FenceMode` preferred/required/off is a project/run setting (`schema.ts:202-204`); not in the pack. **ASSUMPTION:** I did not trace where fence mode is configured; none of it is reachable from `src/packs/`.

### What would count as "widening" (candidate flag list)
Because the format cannot widen anything, a flag list for `/3` is mostly *behavioural* signals, not field checks. Candidates, each with its observable source:
| Signal | Source |
|---|---|
| Act lands without sign-off (no `hold`) | `pack-format.ts:50` |
| Hold threshold above `high` (only critical stops) | same |
| Project `after` steps run after the act (inherited) | `manifest.ts:171-174` |
| Prompt text names tools, shell commands, network, URLs, other repos, credentials, "ignore previous" | text scan, **heuristic** (see section 5) |
| Prompt text outside the pack folder? impossible: `PackFile` bare name (`pack-format.ts:15`), but a **symlinked** prompt file is followed (section 4) | `manifest.ts:128` |
| Pack adds fewer guards than the project default | cannot happen (add only) |
| `/2` format: legacy words, effective guards differ from written | `upgradeV2` |
Anything declaring a field the format does not name is already a refusal, not a flag.

## 2. How the CLI presents packs today

All in `src/cli/program.ts` (option registration :103,286-353).

| Command | Does | Shows | Cite |
|---|---|---|---|
| `delivery packs` | lists built-ins plus packs the project lists; outside a repo, built-ins only | `name  summary. Start it with: delivery review <name>` per pack, footer line; `--json`: `{packs:[{name,version,title,summary}]}`; `--schema`: JSON Schema of `/3` | `src/cli/packs-command.ts:25-47` |
| `delivery packs check <path>` | validates manifest and fixtures, then runs fixtures against the scripted agent | problems by `file: field sentence`; on pass: `✓` lines (pack name/version, scripted find found N ideas, each act, cheat refusals), `Nothing was sent to a real agent`, and a `Ready to use:` line; `--json` returns `{ready, pack{name,version,hash}, problems[], run, sentToAgent:false}`; exit 0 ok / 2 configuration | `packs-check-command.ts:62-172`, `pack-check.ts:235-243` |
| `delivery validate` | validates the project config (built-in pack workflows included) | not pack-specific; reads the project | `validate-command.ts:10,133` |
| `delivery preview [--workflow w --step s --task t]` | prints what the worker would be told: heading, the assembled prompt between `RULE` lines, `OWN_SETUP`, `Agent options` | the full assembled prompt of one step; pack workflows addressable as `<pack>:<local>` once the pack is in the config | `preview-command.ts:36-140` |
| `delivery review <pack> --preview` | resolves pack by name or path, requires its find workflow present in config, then calls `previewCommand` for the find step | one step's prompt, the **find** only | `review-command.ts:106-120` (and `program.ts:333`) |

Gaps relative to Item 2:
- No command prints **all workflows of a pack** together (find plus every act), their guards, hold, and the `ideasFor` routing.
- `packs` lists names and summaries only: no prompts, guards or hold.
- Preview shows the *assembled* prompt for one step, which includes harness text and the project's `agent` options; it does not isolate the **pack's own words** from the harness's (`ideaFormat` is appended to finds, `manifest.ts:169`).
- A pack given as a path is resolved by `resolvePack` (`manifest.ts:260-266`: anything with `/`, `\` or leading `.` is a folder), but `reviewCommand` then needs it listed in config (`packNotListed`, `review-command.ts:106-109`), so path-based preview of an unlisted pack is not possible today.
- `packs check` already prints the pack's `hash` only in `--json` (`pack-check.ts:236,281`); human output does not.
- Output conventions to follow: plain sentences, `ctx.writeLine` / `ctx.report.note`, `ctx.json` switches to one JSON document, exit codes `EXIT.ok` (0) and `EXIT.configuration` (2) (`packs-command.ts:5,35-47`, `packs-check-command.ts:162`); problems are `file: sentence` with the field first (`manifest.ts:84-89,95-106`). Docs for the commands: `docs/packs.md` (72 lines), `docs/writing-a-pack.md:244-246` (trust question wording).

## 3. How strict is the parser

- Manifest: `z.strictObject` at the top (`pack-format.ts:64`, `/2` :22), each find/act (:39,45), `guards` (:49) and `hold` (:50). An unknown key yields `unrecognized_keys`, rendered by `describe` as: `"<field>" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check` (`DATA_ONLY`, `manifest.ts:91-93,99`). Special sentences: `settings` is "reserved for pack settings, which this harness does not read yet"; `summary/guards/hold` on a find, `ideasFor` on an act (`pack-rules.ts:64-74`).
- `$schema` is the one allowed extra and is ignored (`pack-format.ts:66`).
- Unreadable schema value: refused before reading further, naming what is read (`manifest.ts:202-206`). Every problem is reported at once, not the first only (`manifest.ts:187-190`, `packProblems` :112-114), though `loadPack` throws only the first (:241-246).
- **Not covered by the manifest strictness:**
  - Extra files in the pack folder (anything beside `pack.json`, the prompts and `fixtures/`) are never looked at by the loader. **ASSUMPTION:** I did not find a check for stray files; none seen in `manifest.ts`.
  - **Symlinks:** a prompt filename like `scan.md` that is a symlink to a file elsewhere is followed by `readFile` (`manifest.ts:128`; Node follows symlinks, standard behaviour) and its content becomes prompt text sent to the model. `PackFile` only forbids path separators in the *name*. I did not execute this; it follows from the code. Fixture project symlinks are skipped by `entry.isFile()` (`pack-fixtures.ts:92`; Dirent from `readdir` does not follow links). Candidate "named but not format content" refusal.
  - `fixtures/*.json` claude-mock scripts are validated only loosely (`z.looseObject`, `pack-fixtures.ts:42`). They are not read at runtime, only by `packs check`.
  - Prompt text is free: no length cap, no content rules.
- Trust of the *check* flow, as a precedent: `NOT_TRUSTED`, `trustQuestion` default false, non-TTY requires `--yes` (`packs-check-command.ts:109-115,145-151`); and the comment at :102-108 states plainly that this "is not a sandbox against a hostile pack".

## 4. Prompt-injection risk from shared prompts

- **Governing statement:** roadmap Item 2 notes: "A pack is prompts that run with the agent's powers, so prompt injection is the real risk of sharing. Inspection is the first control and comes before install" (roadmap :115-116). Task-packs spec: data-only means a pack "cannot run code on the machine", with code-bearing packs a COULD behind trust (`docs/superpowers/specs/2026-10-03-task-packs-design.md:454-461,152-153,782`).
- **The pack author is the attacker here**, not the repo content. A hostile pack's prompt can tell a `bypassPermissions` agent (`agent-invoke.ts:246`) to run shell, read credentials in the worktree or environment, push to a network, or edit CI files. Data-only does not mean harmless: the code runs as the model.
- **What contains it today (project side, not pack side):** the gate and guards judge the outcome, not the actions; the closer governs landing; `hold` gates landing; the find lands only backlog files (`backlog-only` guard, `manifest.ts:169`) and idea checks are closed kinds validated deterministically (`schema.ts:53-62`). Nothing restricts what the agent does *during* a session beyond the worktree and, where present, the fence. **ASSUMPTION:** fence behaviour not traced.
- **Existing precedent for untrusted text:** tracker issues are framed as data (`WorkItemRef.untrusted`, `schema.ts:219-222`). Scan output is untrusted and validated (task-packs spec :504-508, :771-779). Neither treats the **pack prompt itself** as untrusted.
- **Implication for inspection:** the main control is *the owner reading the pack's own words in full*, separate from the harness's words (so they can see where the author's text ends). Heuristic scanning for "dangerous" phrases is a weak, bypassable second signal; the design should present it as a hint, never as a clean bill of health, and never print "safe". The existing wording "That is the agent's reading of your project, not a guarantee" (`review-command.ts:63`) shows the house tone for non-guarantees.
- Hidden-content hazards a viewer must handle (**ASSUMPTION: general terminal-security knowledge, not repo-specific**): ANSI escape sequences, bidirectional control characters, zero-width characters and very long lines in a prompt can make printed text differ from what the model reads. A "show the full prompt" command should escape or visibly mark control and bidi characters; Markdown comments (`<!-- -->`) are visible in raw text but invisible when rendered. The repo already handles an analogue for filenames (`HFS_IGNORABLE`, `pack-fixtures.ts:74-81`) and is a precedent for the char class list.

## 5. Prior art

| Source | What it shows the user | Takeaway | Trade-off |
|---|---|---|---|
| Chrome extensions permission warnings | Fixed plain-language warnings from declared permissions at install; adding a warned permission on update disables the extension until accepted. Warnings are mapped per permission, with combination rules. https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings (fetched) | Declared-capability list rendered in plain words; re-consent on widening (Item 3's update flow). | Works only because permissions are a closed declared set. Our format has none to declare, so the display is the prompts themselves. |
| VS Code Workspace Trust | Restricted Mode banner; the trust editor lists features that are disabled or limited, including AI agents, tasks, terminal. Extensions that do not opt in are disabled. https://code.visualstudio.com/docs/editing/workspaces/workspace-trust (fetched) | A "what is turned off until you trust this" list is easy to read. | Binary trust, no per-item consent; trust is of the *workspace*, not the content. |
| GitHub Actions | Docs advise pinning third-party actions to a full commit SHA and auditing their source; no install-time capability display; permissions are the workflow's own `permissions:` block. https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions (fetched) | "Read the source, pin the commit" is the accepted control for shared automation. Pack `hash` (`manifest.ts:236`) is our commit-SHA analogue. | Relies on the user reading source; nothing helps them read it. Our value-add is making the reading complete and legible. |
| `npm pack --dry-run` | Reports what would be packaged without creating the tarball. https://docs.npmjs.com/cli/v10/commands/npm-pack (fetched: confirms dry-run semantics; **ASSUMPTION from memory**: output lists tarball contents, sizes and file count) | Model for a read-only "what is in this pack" listing before use, and for listing files that will be read. | Lists files, says nothing about what they do. |
| npm install scripts | **ASSUMPTION from memory, not fetched:** lifecycle scripts run on install; `--ignore-scripts` disables; `npm audit` flags known advisories. | Shows the cost of hiding code-bearing behaviour behind install; supports "inspect first, run nothing". | Not directly comparable: our packs run nothing on install. |
| Terraform `plan` | **ASSUMPTION from memory, not fetched** (https://developer.hashicorp.com/terraform/cli/commands/plan): a read-only preview of changes with `+`, `~`, `-` markers, applied only by an explicit second step. | Good model for Item 3's update diff and for a "what will change" summary; a separate read-only command before the acting one. | Plan is a diff of state; ours is a description of a pack, so less directly applicable for Item 2 alone. |
| pip / cargo | **ASSUMPTION from memory, not fetched:** neither displays what a package will do before install; `cargo` has `cargo vendor`/`cargo package --list` for contents; pip builds from source can run arbitrary code at install. | Reinforces that content listing is table stakes while behaviour display is rare. | |

No library is needed. Everything required is already in the repo: `inspectPack`, `Pack.manifest/hash/workflows`, `packLines`, `previewCommand`'s rule-lines, `--json` conventions. A terminal-width or Markdown rendering dependency is not justified for plain text; if control-character escaping is wanted, it is a few lines (cf. `HFS_IGNORABLE`). **Wardley note:** parsing and strictness (zod) are commodity and already used; do not hand-roll a second validator.

## 6. Design implications for the team (facts, not decisions)

- The command's data source is `inspectPack(dir)` (`manifest.ts:192`): it returns `{ok:true, pack}` or `{ok:false, schema, problems}` without throwing, and without reading fixtures; `Pack.manifest.workflows`, `Pack.workflows` (assembled, with harness text) and `Pack.hash` give everything for workflows, prompts, guards, hold. `resolvePack` (`manifest.ts:260`) resolves name or path.
- Two prompt views exist: the **pack's own text** (read from files; `inspectPack` does not retain it separately: `Pack.workflows[...].steps[0].prompt` is the trimmed text, plus `ideaFormat` on finds) and the **assembled** prompt. `ideaFormat` is exported (`manifest.ts:23`), so the harness's part is separable.
- `/2` and `/3` both need handling; built-ins `code` and `security` are `/2`.
- Refusal path already exists and is plain-language, per file and field; extending it to stray files and symlinks is the likely gap for success criterion 3.
- `Pack.hash` exists to show in the output; Item 3 will pin on it.
- Item 3 boundary: install, pin, update diff, approval records are out of scope (roadmap :120-143).

## 7. Open items I can verify on request
Exact guard semantics (`src/guards.ts`); whether the project's `after` steps run after a pack act; fence configuration; whether stray files in a pack folder are ignored; symlink behaviour (needs a test run, I would add no repo code); the three "from memory" prior-art rows.
