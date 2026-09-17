---
type: phase-design
created: 2026-09-17
roadmap_item: 9
---

# Project Configuration — Architecture

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 9.
> Extends: `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md` (Item 8 — `delivery.config.json`, CLI command layer).
> Builds on: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` (Item 4 — `invoke`, `RoleConfig`, `assemblePrompt`).
> Audit trail: `docs/prd/2026-09-17-project-configuration/` (research.md, product-design.md, review-log.md).
> Produced by an autonomous design-team run (`20260917T121214Z`); no human reviewed it.

This document covers architecture only — problem framing, personas and goals are
`product-design.md`'s. It grounds every claim about existing code in file paths read
directly from this checkout (cited inline) and cross-checked against
`docs/prd/2026-09-17-project-configuration/research.md`, whose findings on the
config loader, the `domainPrompt` producer gap, the missing role-config seam, and
the deterministic-structuring constraint (research §1.1–§1.9, §5) match this
document's own reading and are cited throughout as "research.md".

**Platform note.** This is a Node CLI/library, not an application with an auth UI, a
mobile client, or an offline cache. Those concerns (session UI, native app packaging,
client-side caching) do not exist here and are not invented for this design. "Offline"
in this codebase means "no network call the CLI itself makes" — already true of Item 8
(`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`, NFRs) and
unchanged here.

## 1. Config schema: a strict superset of Item 8's four keys

`src/cli/config.ts` defines `DeliveryConfig` as a `.strict()` zod object over exactly
`task`, `gate`, `closer`, `budgets` (lines 56–64), composing the library's own
`TaskDef`, `GateRef`, `CloserRef` schemas rather than restating them (the file's own
comment, lines 50–55). Item 9 extends this same object with new, all-optional keys,
never touching the four existing ones:

```ts
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),          // Item 8, unchanged
    gate: GateRef.optional(),          // Item 8, unchanged
    closer: CloserRef.optional(),      // Item 8, unchanged
    budgets: Budgets.optional(),       // Item 8, unchanged
    domain: z.string().min(1).optional(),        // NEW — prose, project/domain context
    tasks: z.array(QueueEntry).min(1).optional(),// NEW — the task queue
    roles: RoleOverrides.optional(),              // NEW — programmatic-altitude overrides
  })
  .strict();
```

`.strict()` is preserved unchanged: a typo in a new key is refused by name exactly as
an Item 8 typo already is, through the existing `describeProblem` path (`src/cli/
config.ts:82-99`), which needs one more branch per new key family, following the
existing `where === "closer.type"` / `budgets` special cases in that function.

`task` and `tasks` are mutually exclusive at the schema level (`.strict()` plus a
`superRefine` check), not merely by convention: a project either runs one task
(Item 8's existing mode, unchanged) or a queue (Item 9). This is enforced once, at
load time, so `delivery run`'s existing single-task path (`src/cli/run-command.ts`)
and the new queue path never have to guess which the operator meant.

Nothing else about `loadConfig`, `configCandidates`, `.strict()` semantics or the
JSON/`.js`/`.mjs` file forms (`CONFIG_EXTENSIONS`, `src/cli/config.ts:11-12`) changes.
An Item 8 config file with only the four original keys parses identically under the
Item 9 schema — see §11, Backwards compatibility.

## 2. Data model

### 2.1 Domain context (`domain`)

A single prose string. No new persistence concept: it is a config-time *producer* of
the field that already exists and already flows end to end — `CaseFileHeader
.domainPrompt` (`src/schema.ts:138`, `.optional()`, sitting alongside `taskDef` and
`gateRef` in the immutable header) and `assemblePrompt`'s consumption of it
(`src/prompt-assembly.ts:103-107`: `domain ? \`${roleCfg.systemPromptFragment}\n\n
${domain}\` : roleCfg.systemPromptFragment`). `docs/agent-interface.md` ("Prompt
assembly") already specifies this exact field as "pinned run-identity... immutable,
out of the worker's reach". Item 9 adds nothing to the runtime data model here — it
adds a config-file *author* for a field Item 4 already built and pinned. See §4.

### 2.2 Task queue (`tasks`)

```ts
const QueueEntry = z.union([
  z.string().min(1),                              // pure prose: "add a health endpoint"
  z.object({ intent: z.string().min(1) }).passthrough(), // structured, extender-authored
]);
```

Each entry becomes exactly one `TaskDef` (§3). The queue itself is not a new runtime
persistence format — it is config, read fresh on every `delivery run` invocation, the
same way `config.gate` or `config.closer` already are (`src/cli/settings.ts:81-97`).
Progress through the queue is derived, not stored (§7): there is no `queue-state.json`.

### 2.3 Role-config overrides (`roles`)

```ts
const RoleOverride = z.object({
  systemPromptFragment: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1)).min(1).optional(),
}).strict();

const RoleOverrides = z.object({
  worker: RoleOverride.optional(),
  gateMaintenance: RoleOverride.optional(),
}).strict();
```

Deliberately narrow: only the two fields of `RoleConfig` (`src/role-config.ts:39-52`)
that are plain data (`string`, `string[]`) are exposed. `envelopeSchema` (a zod type)
and `budgets` (reserved, unverified SDK field names per Item 4's own scope note,
`docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` lines
166-170) are not — they stay programmatic-altitude, unlisted here, exactly as Item 4
left them. Triage is excluded: `triageRoleConfig` is deterministic-router-driven by
default (`src/router.ts`, unchanged by Item 8 and this phase) and its `allowedTools`
is fixed to `READ_ONLY_TOOLS` by the existing `superRefine` in `role-config.ts:111-120`
— a config override that tried to widen it would already fail that check when merged
and re-validated (§3.3).

An override merges over the shipped reference config (`workerRoleConfig` /
`gateMaintenanceRoleConfig`, `src/role-config.ts:65-99`) field-by-field: an omitted
`systemPromptFragment` keeps the reference wording, an omitted `allowedTools` keeps
the reference list. The merged result is re-validated through the existing
`validateRoleConfig` (`src/role-config.ts:127-134`) before any session spawns — reuse,
not a parallel check.

## 3. Natural-language task definitions → `TaskDef`

### 3.1 The structuring rule is deterministic, not agent-assisted

`TaskDef` is `z.record(z.string(), z.unknown())` — fully opaque (`src/schema.ts:33-34`)
— and `taskIntent()` already reads `.intent` defensively with a `"run"` fallback
(`src/cli/settings.ts:42-44`). Structuring a queue entry needs no model call:

```ts
function structureTask(entry: QueueEntry): TaskDef {
  return typeof entry === "string" ? { intent: entry.trim() } : entry;
}
```

A bare string becomes `{ intent: <string> }` — the exact shape `--task` already
produces (`src/cli/settings.ts:67-71`, `taskFrom`). A structured object passes
through as-is (already a valid `TaskDef`; `.passthrough()` on `QueueEntry`'s object
arm lets an extender add whatever fields their custom gate or domain fragment reads).

This keeps a load-bearing promise: the derived minimum scope requires `validate`
to run "before dispatch... no agent spend" (brief, MUST 3) and `preview` to be
inspectable before a run starts. Deferring structuring to an agent would make
`validate`'s output depend on model output — nondeterministic and untestable, and it
would need agent credentials (Item 8's preflight, `docs/superpowers/specs/
2026-09-14-cli-and-configuration-design.md` §"Agent runtime preflight") just to
validate a config file. **Decision:** structuring is 100% deterministic in the MUST
tier. The roadmap's "the harness structures them into what each role needs" is met
because every role's prompt already reads the *same* `task_def` slot verbatim
(`docs/agent-interface.md`, "Prompt assembly": `[ task_def ] # original intent, from
the immutable header`) — there is no per-role task shape to derive; Item 4 already
built one shared slot, not N role-specific ones. An agent proposing a *whole config*
(gate + closer + queue) from a free-form project description is the COULD-tier
"agent-driven onboarding" the brief names separately and explicitly excludes from
this structuring step.

### 3.2 Validation before dispatch

Every `TaskDef` produced by `structureTask` is parsed against `TaskDef` (always
succeeds — it's a record) but also against a **queue-specific tightened schema**,
`z.object({ intent: z.string().min(1) }).passthrough()`, applied only at config-load
time for queue entries (never at the single-`task` path, which Item 8 already
accepts opaquely). This is what turns "a queue entry with no intent" into a named
`validate` failure instead of a confusing empty prompt slot at run 4 of 10.

**Duplicate entries are refused, not silently allowed.** `validate` deep-equality
compares every pair of structured entries (`structureTask(entry)` output, not the
raw config text — so `"add a page"` and `{ "intent": "add a page" }` count as the
same entry) and refuses if any two are identical, naming both positions. This is
not cosmetic: §6.2's content-addressed run identity depends on every entry in one
queue structuring to a distinct `TaskDef`, or "which run does this entry match"
would be ambiguous. An owner who genuinely wants the same work done twice writes
two entries with different wording (even a trivial difference), which is also how
§6.2 defines "this is a new task, not the old one."

### 3.3 Role-config merge validation

Described in §2.3: `validateRoleConfig` (`src/role-config.ts`) runs against the
merged worker/gate-maintenance config for every queue task, at `validate`/`preview`
time and again immediately before the first dispatch of a run — the same "before any
SDK call" placement Item 4 specifies (`src/role-config.ts:122-126`'s own doc comment).

## 4. Domain context reaching the prompt without breaking determinism

This is the crux of the byte-identical-prompt guarantee (Item 4 MUST 9,
`docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` line 109;
`docs/agent-interface.md`, governing decision 3: "same case file → byte-identical
prompt"). The mechanism already exists and is not modified:

1. `create(dir, header, budgets)` (`src/case-file.ts:57-81`) writes `header` — including
   `domainPrompt` — into `case.json` once, at `PROVISIONING`. `CaseFileHeader` has no
   setter for `domainPrompt` after create; the only way to change it is a new run.
2. `assemblePrompt(caseFile, roleCfg, evidence)` (`src/prompt-assembly.ts:98-156`) is a
   pure function of `caseFile` (serialised, on-disk state) and `roleCfg` (pinned
   config) — no clock, no randomness, no I/O of its own (module doc comment,
   lines 86-97). It reads `caseFile.header.domainPrompt` and prepends it to
   `roleCfg.systemPromptFragment` (lines 103-107).

Item 9's entire job is to **populate `header.domainPrompt` at `create()` time from
`config.domain`**, in the CLI's `startRun` (`src/cli/run-command.ts:47-75`) — one new
field passed into the existing `create()` call, sourced from `resolveSettings`
(`src/cli/settings.ts`) alongside `taskDef`/`gateRef`/`closerRef`. Nothing downstream
of `create()` changes: `assemblePrompt` already handles a present-or-absent
`domainPrompt` (the ternary at line 105), `agent-invoke.ts` already calls
`assemblePrompt` unconditionally, and the determinism proof Item 4 already has
(`claude-mock` journal assertion, per that item's testing strategy) already covers
this path — a queue task with `config.domain` set produces a header with
`domainPrompt` set once, and two `advance()` calls against that same on-disk case
file produce the same prompt for the same reason two `advance()` calls against an
Item 8 run without `domain` already do. **No new mechanism, no new risk to the
guarantee** — this is reuse-estate, not build.

## 5. `delivery validate` and `delivery preview`: pure, agent-free functions

Both commands are read-only over the *loaded configuration*, never over a run in
progress, and neither spawns an SDK session — consistent with the brief's MUST 3
("no agent spend") and the existing precedent that `status` never calls `advance`
(`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`, "`status` is
`load` plus lookup tables, never `advance`").

### 5.1 `delivery validate [--config <file>] [--repo <path>]`

```
loadConfig(...)                       // src/cli/config.ts — existing, extended schema
  → parse task | tasks (mutually exclusive, §1)
  → structureTask() + tighten-check each queue entry, refuse duplicates (§3.2)
  → merge + validateRoleConfig() each role override (§3.3, §2.3)
  → if gate/closer is `custom`, checkCustomModules() (src/cli/settings.ts:168-171 — already exists, already "load, don't run")
  → report the first problem (describeProblem-style, one sentence) or "looks good"
```

Every step here is a function this codebase already has (`loadConfig`,
`checkCustomModules`, `validateRoleConfig`) or a small pure extension of one
(`structureTask`, the tightened queue-entry schema). `validate` runs zero agent
sessions and needs no `claude` executable or credential — it does not go through
Item 8's agent-runtime preflight (`docs/superpowers/specs/
2026-09-14-cli-and-configuration-design.md`, "Agent runtime preflight") at all,
because nothing here reaches `agent-invoke.ts`.

**Failure shape**: one plain-language sentence naming the first problem, exactly
Item 8's `describeProblem` convention (`src/cli/config.ts:76-81`'s own rationale:
"a person fixes one thing and runs again"). `--json` (SHOULD, matching Item 8's own
`--json` precedent) can list every problem instead of stopping at the first, for a
CI caller that wants the whole list in one pass — deferred detail, not a MUST-tier
architectural decision.

### 5.2 `delivery preview [--queue-index <n>] [--role worker|gate-maintenance]`

`--queue-index <n>` selects a queue position (0-based internally, "task n+1"
externally, matching §6.2's "Task N of M" numbering); omitted, it previews the next task the
queue driver would actually run (the first entry §6.2's matching finds with no
closed run). Against an Item 8-style config with a singular `task` (no `tasks`
queue at all — §1's mutual exclusion means only one can be present), `--queue-index`
is not accepted (there is no queue to index into) and `preview` with no flags
previews that one task. Against a config with neither `task` nor `tasks` and no
`--task`/`--task-file` given to `run` yet, there is nothing to preview: `preview`
refuses with the same "tell me what to do" sentence `run` already gives (`NO_TASK`,
`src/cli/settings.ts:12`), not a new preview-specific flag — `preview` never takes
free-text task content of its own; a one-off task is tried directly with
`delivery run --task "…"`, never previewed separately, keeping one flag surface
instead of two ways to say the same thing.

Constructs a **synthetic pre-run `CaseFile`** — the same shape `create()` would
produce for that queue entry, never written to disk — and calls the library's own
exported `assemblePrompt` (`src/index.ts`: `export { assemblePrompt, resolveEvidence,
... } from "./prompt-assembly.js"`) directly:

```ts
const header: CaseFileHeader = {
  surfaceId: "preview", taskDef: structureTask(entry), gateRef, closerRef,
  domainPrompt: config.domain, baseline: null, baseBranch: null,
};
const caseFile: CaseFile = { header, cursor: { state: "PROVISIONING", budgets: DEFAULT_BUDGETS, worktreeRef: "" }, history: [] };
const roleCfg = mergedRoleConfig(config, role);           // §2.3
const { systemPrompt, prompt } = assemblePrompt(caseFile, roleCfg, { brief: null, newFailures: [], setback: null });
```

This is the load-bearing design choice for this command: **preview does not
re-implement prompt rendering.** It calls the exact pure function the real dispatch
path calls (`src/agent-invoke.ts` also calls `assemblePrompt`, per Item 4's
architecture, `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`
lines 186-193). Whatever `preview` prints for a given config and queue entry is
*provably* what the real run's first dispatch will send, because it is the same
function call with the same inputs a real `PROVISIONING → AGENT_ACTIVE` transition
would construct — not a parallel formatter that could drift from it. This directly
satisfies the brief's requirement that domain-context wiring "not break the
byte-identical-prompt guarantee": preview is a read of that guarantee, not a second
implementation of it.

`preview` takes no `--json` flag in the MUST tier: its output is prompt text, meant
to be read, not parsed.

## 6. Running the queue: sequential, single-surface, crash-recoverable

### 6.1 Sequential execution reuses the existing single-run driver unchanged

`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`'s "Run lifecycle
composition" already fully specifies one task's lifecycle: resolve settings, resolve
`SurfaceLocation`, preflight, build `SurfacePorts`, `create()` or resume, loop
`advance()` until `done`. `src/cli/drive.ts`'s `driveToOutcome` and `resumeRun` are
this today, already crash-recoverable per-run (Item 1/3's own guarantee, inherited
unchanged). **The queue driver adds one loop around this, nothing inside it changes:**

```
for entry, position in config.tasks:              // position is 1-based, purely for display (§6.2)
  taskDef = structureTask(entry)                   // §3.1
  existing = findQueueRun(repoPath, taskDef)        // §6.2 — content match, derived, not stored
  if existing?.caseFile.outcome:            continue          // already done, skip
  if existing (unfinished):                 resumeRun(existing, ctx)   // reuse Item 8 resume
  else:                                      startQueuedRun(taskDef, ctx)  // reuse Item 8 create+drive
  if outcome.kind !== "closed":              stop (escalated/aborted needs attention; §8)
```

This is Item 9 MUST 5 ("running tasks from the queue: sequential, single-surface;
concurrency is Item 10") read literally: one surface, one task in flight at a time,
in queue order. Nothing about `src/surface.ts` (the single-surface state machine)
changes — the queue driver never touches it directly, only through the same
`driveToOutcome`/`resumeRun` seam the existing single-task `run` command already
uses. Item 10's multi-surface supervisor is explicitly the only thing allowed to run
several of these concurrently (brief's non-goals; §9 below expands the handoff).

### 6.2 Identity is by content, not position — and survives editing the queue

**Superseded from round 1.** The earlier draft of this section identified a queue
entry by its array index (`_queueIndex`, then a `CaseFileHeader.queueIndex` sibling
field after the critic's round-1 note). Both versions share the same defect,
independent of *where* the index is stored: **position is not a stable identity**
for a checked-in, versioned, hand-edited file. If Dana finishes tasks 0–2 and then
inserts a new task at the top, every later entry's index shifts by one, so index 0
now names the *new* entry but still matches the *old, closed* run that was created
under index 0 — the new task is silently skipped and never runs. Reordering or
deleting a finished entry has the same failure shape. This is a correctness bug,
not a style preference, so the mechanism changes, not just its storage location.

**The fix: identity is the task's own content**, not its position or a
harness-assigned id. `findQueueRun(repoPath, taskDef)` compares the *structured*
`TaskDef` (`structureTask(entry)`, §3.1) for deep equality against every existing
run's `header.taskDef` (via `allRuns()`, `src/cli/runs.ts:48-70`, already reading
every case file under `.delivery/runs/`, already crash-safe — a folder with no case
file is passed over, line 46). No new field, no schema change: `TaskDef` is already
the one thing an owner authors and the one thing every run's header already stores
verbatim. Matching on the *structured* form (not just the `intent` string) means an
extender's `{ intent: "…", area: "billing" }` and `{ intent: "…", area: "shipping" }`
are correctly treated as different tasks even though their prose is identical —
content identity is the whole `TaskDef`, not a substring of it. §3.2's
duplicate-entry refusal is what keeps this well-defined: no two entries in one
queue ever structure to the same `TaskDef`, so a content match is never ambiguous
about which queue line it answers for.

**What happens on each edit**, concretely:

| Owner action | What the queue driver does |
|---|---|
| **Insert** a new entry anywhere | No existing run's `taskDef` matches it (it's new content); the queue driver runs it, in whatever position it now occupies. Every other entry's matching is untouched — insertion doesn't shift anyone else's identity, because nothing is keyed on position. |
| **Reorder** the list | Every entry still matches the run whose `taskDef` it structures to, wherever it now sits in the array. Reordering changes only the order §6.1's loop visits entries in, never which run answers for which entry. |
| **Delete** a finished entry's line | Its run simply stops appearing in "what's queued" (§6.1 only iterates `config.tasks` as currently written); the closed case file stays on disk, still visible through `delivery status --all`, exactly as an ad-hoc `--task` run's history already does today. Nothing needs cleaning up. |
| **Delete** an entry with an unfinished or escalated run | Same as above — the queue stops naming it, but the run itself is untouched and still resumable directly (`delivery resume <run-id>`, unchanged from Item 8) if the owner re-adds the line or wants to finish it by hand. |
| **Reword** an entry | Different content structures to a different `TaskDef`, so it doesn't match the old run — the harness treats it as a new task and runs it. The old run stays in history under the old wording; nothing is silently reused across a genuine change of intent. |
| **Deliberately re-run a "finished" task** | Reword the entry (even trivially) or delete-and-re-add the line with slightly different wording — either produces content that no longer matches the closed run, so the queue driver treats it as new. No separate "re-run" flag or command is needed: this is the same mechanism as "reword," used on purpose. An owner who wants the *exact* same wording to run twice writes two visibly different entries (§3.2's duplicate refusal already requires this), which is also how "run this twice" is expressed. |

**"Task N of M" derives from the current file, not a stored count.** `N` is an
entry's 1-based position in `config.tasks` *as currently written*; `M` is
`config.tasks.length`, *as currently written*. Both are recomputed by re-reading
the config on every `run`/`status` invocation — there is no persisted "task 3 of 7"
anywhere, so an edit between two invocations is reflected immediately and correctly,
with no possibility of the display disagreeing with the file that produced it.

**No `queue-state.json`, no lock file, no second source of truth, and no new
`CaseFileHeader` field.** "Which queue entries are done" is answered by reading the
case files that already exist (`allRuns()`) and asking, per current entry, "does any
run's `taskDef` already equal this?" — the same shape `unfinishedRuns`
(`src/cli/runs.ts:73-75`) already uses to answer "which runs aren't done," extended
from "read every case file" to "read every case file and content-match it." A crash
between two queue entries leaves the completed entries' case files closed and the
in-flight one's case file mid-log; resuming the queue re-derives exactly where it
was by re-scanning and re-matching, with no queue-level cursor — stored by index,
by harness-assigned id, or otherwise — that could itself go stale, disagree with an
edited file, or need migrating when the queue changes shape.

This is the buy-vs-build ledger's first "build" row, but the smallest version of
it possible: `findQueueRun` is a filter-and-deep-equal over data every run's header
already carries; every read/write path it needs (`allRuns`, `create`, `load`,
atomic case-file writes) is Item 1/8 machinery, untouched, and the schema gains
nothing at all.

**Content identity is task-content-only, by design, and that is an accepted trade,
not an oversight.** `findQueueRun` matches on `taskDef` alone — it does not also
compare `gateRef`, `closerRef` or `domainPrompt`. If an owner reworks their gate
command or domain description between two `delivery run` invocations without
changing a task's wording, the queue still treats that task as done against the
run that was verified under the *old* gate: the new acceptance bar is never
re-checked for it. This mirrors Item 8's own single-run behaviour exactly — a
finished run's result stands until the owner deliberately asks for a fresh one
(`--fresh`, Item 8) — but the queue path has no equivalent per-entry safety valve
in this MUST tier: rewording the *task* is what re-triggers a queue entry (§6.2's
table above), reworking the *gate* alone does not. Adding one (e.g. folding
`gateRef`/`closerRef`/`domainPrompt` into the match, or a `--fresh`-for-one-entry
flag) is a deliberate, separate design decision this phase does not make — flagged
here so the behaviour is documented, not silently discovered.

### 6.3 Run naming

`runIdFor(intent, now)` (`src/cli/run-location.ts:15-25`) already slugs from intent
text; queue runs reuse it unchanged, giving ids like `add-a-health-endpoint-
20260917T140501Z`. The run id plays no role in queue identity — content matching
(§6.2) is — so two differently-worded entries that happen to slug to similar text
still resolve correctly; a genuinely duplicate slug is merely a cosmetic
near-collision Item 8's existing timestamp suffix already resolves (`runIdFor`,
`src/cli/run-location.ts:22-24`).

## 7. Error model and exit codes

Extends Item 8's table (`docs/superpowers/specs/2026-09-14-cli-and-configuration-
design.md`, "Error model") with the same shape: one lookup keyed on a typed error's
`code`, mapped to a plain-language template and an exit code — no new mechanism.

| Condition | Exit | Notes |
|---|---|---|
| `task` and `tasks` both present in config | 2 | Refused at `loadConfig`, before anything else |
| Queue entry with empty/missing `intent` | 2 | Named by position: "task 3 in your queue has no `intent`" |
| Two queue entries structure to the same `TaskDef` (§3.2) | 2 | Named by both positions: "tasks 2 and 5 are the same task; identical entries can't be told apart" |
| Unknown role name under `roles` (not `worker`/`gateMaintenance`) | 2 | `.strict()` on `RoleOverrides`, same `unrecognized_keys` path as `describeProblem` already handles |
| Merged role config fails `validateRoleConfig` (e.g. an empty `allowedTools`, an empty `systemPromptFragment`, or — not reachable via `roles`, since triage isn't overridable, §2.3 — triage's tools widened) | 2 | `InvalidRoleConfig`, already in the error table. **Scope note:** this is a structural check only (non-empty list of non-empty strings) — `validateRoleConfig` has no list of tool names the SDK actually offers to check `allowedTools` entries against (confirmed against `src/role-config.ts:100-120`: `allowedTools` is `z.array(z.string().min(1)).min(1)`, no known-tool enumeration exists anywhere in this codebase). A misspelled tool name is **not** caught by `validate` in the MUST tier; it surfaces at run time as every call to that name being refused by `canUseTool` (Item 4's existing tool-authority refusal, `docs/agent-interface.md`), which is a working but later signal than `validate` gives for every other mistake in this table. Adding a known-tool list is explicitly not designed here (see "What this design does not include": no source of truth for "every tool name the installed SDK version offers" exists in this codebase today, and inventing one risks drifting from the SDK's actual set). |
| `domain` present but empty/whitespace-only | 2 | `z.string().min(1)` catches it at parse |
| `preview` asked for a queue index out of range | 2 | New, small: "there's no task 7; your queue has 4" |
| A queue run escalates or aborts mid-queue | 4 / 5 | Same codes Item 8 already defines for a single run; the queue driver stops rather than continuing past unattended work, per §8 |
| Everything else in Item 8's table | unchanged | `FileNotFound`, `CorruptCaseFile`, `GateModuleLoadFailure`, etc. — reused verbatim |

`validate` and `preview` exit `0` on success, `2` on any config problem, and never
`3` (no agent preflight, §5.1) or `4`/`5` (no run happens).

## 8. Escalation and the queue

A queue run that escalates or aborts stops the queue (§6.1's loop) rather than
skipping to the next task silently — a project owner who wired ten tasks should not
discover, hours later, that task 3 needed a decision and tasks 4–10 ran anyway on
top of an unreviewed state. `delivery status` already prints an escalated run's
packet verbatim (Item 8); the queue driver's own final message additionally names
how many tasks completed and which one is waiting, reusing `describeRun`
(`src/cli/runs.ts:100-102`) for that line. Skipping past an escalation to keep the
queue moving is not offered in the MUST tier — no persona in `docs/personas.md`
needs it, and it would need explicit per-task "may skip on escalate" authoring this
phase's derived scope does not ask for.

## 9. Security

Extends Item 8's security section (`docs/superpowers/specs/2026-09-14-cli-and-
configuration-design.md`, "Security") without adding a new trust boundary:

- **`delivery.config.json`/`.js`/`.mjs` remains as trusted as the repository's own
  `package.json` scripts or CI workflow** (Item 8's own framing, unchanged). The new
  `domain`, `tasks`, `roles` keys are all *data* (strings, arrays) or references to
  the same custom-module mechanism Item 8 already trusts — no new code-execution
  surface. A `.js`/`.mjs` config computing `tasks` dynamically executes with the
  invoking user's authority exactly as a `.js` config computing `gate`/`closer`
  already does (`src/cli/config.ts:168-170`, `import(pathToFileURL(...))`).
- **Custom module paths** (a role's `envelopeSchema` or a project's own gate/closer,
  should Item 9's declarative `roles` key not cover a project's needs) resolve via
  the existing `loadPlugin`/`checkCustomModules` seam (`src/plugin-loader.ts:21-54`,
  `src/cli/settings.ts:168-171`), relative to `repoPath`, never the worktree or cwd —
  unchanged, reused, not re-specified.
- **Prompt content from the repo**: `domain` and every `tasks` entry's prose are
  author-controlled config, checked into the repository the operator already
  controls — the same trust level as the existing `task.intent` (Item 8) and
  `systemPromptFragment` (Item 4, hardcoded in `role-config.ts` today, now also
  config-authorable). No secret-bearing field is added: same rule as Item 8's
  "the config schema has no secret-bearing field" — `domain`/`tasks`/`roles` are all
  prose or tool names, never credentials. `role.allowedTools` widening a role's
  reach is bounded by the same `canUseTool` enforcement Item 4 already built
  (`docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`, "Tool
  authority enforcement") — a project cannot grant a role a capability the SDK seam
  itself does not also gate.
- **No sandbox added**, matching Item 8's explicit `ponytail:` note on this point
  (`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md` line 475-477)
  — this phase does not change who is trusted to author a config.

## 10. Non-functional requirements

- **Determinism**: `structureTask`, `findQueueRun`, the role-config merge and
  `assemblePrompt`'s consumption of `domainPrompt` are all pure functions of their
  inputs (config, case files on disk) — no clock, no randomness beyond the existing
  run-id timestamp (already non-deterministic-by-design in Item 8, unchanged). Two
  `validate` or `preview` calls against the same config produce identical output.
- **No new I/O beyond what Item 8 already does.** `validate`/`preview` read the
  config file and, for `preview`'s `findQueueRun`-adjacent lookups, existing case
  files; neither writes anything. The queue driver's writes are entirely Item 1's
  existing atomic case-file writes (`src/case-file.ts:17-21`, `atomicWriteJson`),
  called once per queue entry, not a new write path.
- **No agent spend for validate/preview** (§5) — a hard NFR, not just a nicety: an
  operator with ten queued tasks and no credential configured yet can still validate
  and preview the whole queue.
- **Idempotent resume**: unchanged from Item 8 at the single-run level; the queue
  loop's own resume (§6.2) is idempotent by the same argument — re-deriving "what's
  done" from case files on disk every time it's asked, never trusting an
  in-process variable that a crash would lose.

## 11. Backwards compatibility with Item 8 configs

Every Item 8 `delivery.config.json` — four keys, no `domain`/`tasks`/`roles` — parses
under the extended `DeliveryConfig` unchanged: the new keys are all `.optional()`,
`task` (singular) is untouched, and `.strict()` still only rejects keys outside the
now-seven-key set. `delivery run --task "..."` and a config with `task` (not `tasks`)
behave exactly as Item 8 specifies — the queue path in §6 only activates when
`config.tasks` is present, and the mutual-exclusion check (§1) means a project cannot
accidentally end up half-migrated. No migration step, flag or version marker is
needed: an Item 8 project simply has never populated the new keys.

## 12. Testing

Follows the codebase's existing two-tier pattern precedent (`docs/superpowers/specs/
2026-09-14-cli-and-configuration-design.md`, "Testing"; `docs/superpowers/specs/
2026-09-09-agent-invocation-primitive-design.md`, "Testing strategy"):

- **Unit (vitest, no process spawn, no SDK)**: `structureTask`, the tightened
  queue-entry schema, the duplicate-entry check (§3.2), `RoleOverrides` merge +
  `validateRoleConfig` reuse, `findQueueRun`'s content-matching over `allRuns()`
  fixtures — including a fixture reproducing each edit case in §6.2's table
  (insert, reorder, delete, reword) — `describeProblem`'s new branches, and
  exit-code mapping for the new error rows. Extends the existing
  `src/cli/config.test.ts` (confirmed present in this checkout) in the same style.
- **`preview` correctness proven against the real dispatch path, not asserted in
  isolation**: a test constructs a queue config, calls `preview`'s prompt assembly,
  then separately drives one real queued run through `claude-mock`
  (`vendor/claude-mock`) via the vendored test seam (`src/testing.ts`,
  `mockSessionEnvironment`, per Item 7/8 precedent) and asserts the mock's own
  journal recorded the *same* system prompt `preview` printed — the guide-as-test
  pattern applied to a guarantee rather than a guide, giving `preview` a genuine
  non-drift proof rather than a snapshot of its own output.
- **Guide-as-test**: the unified onboarding doc (§13 below) gets a
  `tests/project-configuration-guide.test.ts` exactly like
  `tests/getting-started-guide.test.ts` and `tests/testing-your-pipeline-guide.test.ts`
  already do — extracting its commands and executing them against the built CLI and
  a fixture project, agent routed to `claude-mock` via the existing scripted-double
  seam (`src/mock-script.ts`), asserting the documented output. Numbered journey
  tests follow the existing `tests/cli-and-configuration/N-<slug>.test.ts` convention
  (research.md §1.9), one per primary journey this phase's product design defines,
  once that numbering exists. This is the brief's requirement that documentation
  "stitching the existing gate/closer/role guides" cannot drift from the tool,
  applied the same way Item 8 already applies it.
- **A complete example project, proven by a test** (brief item 6/MUST): a new,
  separate fixture, `examples/project-configuration-example/`, deliberately **not**
  a modification of `examples/sample-project/` — `examples/sample-project/` stays
  exactly as it is (no `delivery.config.json` added to it), because
  `tests/getting-started-guide.test.ts` and `tests/sample-project.test.ts` both
  depend on it being a no-config, single `--task` first run today; dropping a
  `tasks`-bearing config into that same directory would change what config
  discovery (`configCandidates`, `src/cli/config.ts:119-129`) finds for those
  existing tests and silently break the exact "repo + task, no config" journey
  Item 8 proved. The new fixture follows the same "one fixture, one guide, one
  test" convention (`docs/superpowers/specs/2026-09-14-cli-and-configuration-
  design.md`, "Sample project") one directory over, with a `delivery.config.json`
  using all three new keys (`domain`, a two-entry `tasks` queue, one
  `roles.worker` override), exercised end-to-end through `claude-mock` by a
  dedicated test asserting: `validate` passes, `preview` prints the domain
  sentence in the system prompt, and running the queue produces two closed runs
  in order, the second matched to its queue entry by content (§6.2), not by a
  stored index.
- **CLI end-to-end**: `delivery validate`, `delivery preview` and the queue-driving
  `delivery run` are exercised against `dist/cli/main.js` through the same
  scratch-repository harness Item 8's end-to-end tests already use
  (`initTempRepo`, per that design's Testing section), asserting stdout, exit code
  and the resulting case files on disk — the same tier Item 8 already built, no new
  test infrastructure.

## 13. Extensibility towards Items 10–14

- **Item 10 (Multi-Surface Supervisor)** consumes the same queue: §6.1's loop is
  deliberately factored as "resolve next queue entry → drive one surface to
  outcome", the exact unit Item 10's supervisor would run N of concurrently against
  a shared worktree pool. Item 9 does not build the pool, the breaker, or run-level
  budgets — it builds the single-surface sequential case so that Item 10's queue
  input (an ordered `config.tasks`, each already reducible to a `TaskDef` via
  `structureTask`) requires no reshaping.
- **Item 11 (Reporting)** replaces or augments the renderer at the same
  `AdvanceResult` seam Item 8 already isolated (`docs/superpowers/specs/
  2026-09-14-cli-and-configuration-design.md`, "Progress reporting" — "Item 11 can
  replace or augment the renderer... without the run loop changing"); the queue
  driver's own per-entry summary line (§8) is one more thing that seam can capture,
  not a new one.
- **Items 12 (Task Packs)**: "packs are pre-built configurations" per this brief —
  concretely, a pack is a `delivery.config.json` (or the `.js`/`.mjs` computed form)
  authored once and distributed, using exactly the schema this document extends. No
  new packaging mechanism is needed at the schema level; Item 12's work is
  discovery/distribution (where a pack comes from), not shape.
- **Items 13/14 (Scheduling)**: drive `delivery run` unattended against a queue
  exactly as Item 8 already anticipated for a single task (`docs/superpowers/specs/
  2026-09-14-cli-and-configuration-design.md`, "Extensibility" — "Item 13 drives
  `delivery run` unattended; plain non-TTY output, `--json` and distinct exit codes
  are what a scheduled invocation needs"). The queue's crash-safe, state-file-free
  resume (§6.2) is what makes an interrupted scheduled run resumable with no
  scheduler-side bookkeeping.

## Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Config schema composition (`domain`/`tasks`/`roles`) | **Reuse-estate** — extend `DeliveryConfig` (zod, `src/cli/config.ts`) in place | A second, Item-9-only schema/loader | Item 8's design explicitly names this file as the extension point ("Item 9's declarative surface is a superset of this file"); a second loader would fork discovery, precedence and `.strict()` behaviour that already work. |
| NL task → `TaskDef` structuring | **Build** — a ~3-line deterministic function (`structureTask`) | Agent-assisted structuring at config-load/validate time | Rejected: would make `validate`/`preview` non-deterministic and agent-credentialled, violating the brief's "no agent spend" requirement for `validate`. `TaskDef`'s existing opaque-record design and the single shared `task_def` prompt slot (Item 4) mean no per-role structuring logic exists to build. |
| Domain context reaching the prompt | **Reuse-estate** — populate the existing `CaseFileHeader.domainPrompt` field (Item 4) from `config.domain` at `create()` | A second, config-level prompt-injection path bypassing the case file | `domainPrompt` already exists, is already pinned at creation, and `assemblePrompt` already consumes it (§4). Building a parallel path would duplicate a mechanism that already satisfies the determinism requirement and risk the two drifting. |
| Prompt preview | **Reuse-estate** — call the library's exported `assemblePrompt` (`src/index.ts`) against a synthetic pre-run `CaseFile` | A standalone template renderer duplicating the five-slot format | A second renderer is exactly the "byte-identical guarantee" risk the brief flags by name. Calling the real function on synthetic-but-shaped input is the only way `preview`'s output is provably what a run would send. |
| Role-config override merge | **Reuse-estate** — merge over `workerRoleConfig`/`gateMaintenanceRoleConfig` (`src/role-config.ts`) and re-run the existing `validateRoleConfig` | A parallel role-config validator for config-authored overrides | `validateRoleConfig` already checks every field this design exposes (`systemPromptFragment`, `allowedTools`), including the triage read-only guard; re-implementing it for the config path would be a second, driftable copy of the same rule. |
| Queue progress persistence / identity | **Reuse-estate** — content-match a queue entry's structured `TaskDef` against existing runs' `header.taskDef`, read back via the existing `allRuns()` (`src/cli/runs.ts`), with no new field at all | A dedicated `queue-state.json` (or a lock file) tracking cursor position; a harness-assigned id or array-index tag (`_queueIndex` / a `CaseFileHeader.queueIndex` field, both considered and rejected during round-2 revision, §6.2) | A stored cursor or index is a second source of truth that can disagree with the case files it summarises after a crash — exactly the class of bug Item 1's case-file design exists to prevent — **and**, distinctly, position-keyed identity breaks the moment a checked-in, versioned queue file is edited (inserted into, reordered, or trimmed), which this brief's own framing of the file as "checked into the repo and versioned" makes a certainty, not an edge case. Content identity survives every edit class (§6.2's table) and needs no schema change at all. |
| Sequential queue driver | **Build** — a thin loop over the existing `driveToOutcome`/`resumeRun`/`create` seam | Reimplementing run lifecycle composition for "a run, but N of them" | The loop itself (iterate, check existing, drive one, stop on non-closed outcome) is project-specific glue with no commodity equivalent; everything it calls is already-built Item 1/4/8 machinery. |
| Queue-entry / role-override schema validation | **Reuse-estate** — zod, composing existing schemas (`TaskDef`, the existing `RoleConfigShape`'s shape) | A second validation library, or hand-written checks | Same rationale as Item 8's own ledger row for this ("zod is already the codebase's exclusive schema-validation library"); no new dependency, no new pattern. |
| CLI subcommands (`validate`, `preview`) | **Reuse-estate** — `commander` (already Item 8's dependency, `src/cli/program.ts`) | A new CLI framework, or hand-rolled arg parsing | Two more subcommands on an already-`commander`-driven program; Item 8's own ledger already settled this choice for the whole CLI. |
| Config-driven custom modules (gate/closer/role extension points) | **Reuse-estate** — the existing `loadPlugin`/`checkCustomModules` seam (`src/plugin-loader.ts`, `src/cli/settings.ts`) | A new plugin-loading mechanism scoped to Item 9 | Identical shape (a relative module path resolved against `repoPath`, a named export checked for required methods) to what gates and closers already use; no reason for a third copy. |

## Operability / DX

- **Environment**: unchanged from Item 8 — Node ≥22, TypeScript, `vitest`,
  `eslint`/`typescript-eslint`, git, and for a real (non-`validate`/`preview`) queue
  run, the Claude Code executable and a credential, checked by Item 8's existing
  preflight before the first task in the queue is provisioned. `validate` and
  `preview` need none of that (§5, §10) — a project owner can author and check a
  whole queue offline, with no credential, before ever spending agent budget.
- **Harness**: the same `src/cli/` command-handler layout Item 8 established
  (`src/cli/config.ts`, `src/cli/settings.ts`, `src/cli/run-command.ts`, etc.) gains
  `src/cli/validate-command.ts`, `src/cli/preview-command.ts` and a queue-aware
  extension of `run-command.ts`'s dispatch (whether `config.tasks` is present),
  plus their `vitest` unit tests, following the existing one-file-per-command
  pattern exactly. `src/role-config.ts` gains the merge function; no existing
  export's shape changes (matching Item 4's own precedent: "no existing export
  changes shape").
- **Scaffolding**: one new example fixture,
  `examples/project-configuration-example/` (§12), alongside the existing
  `examples/sample-project/`, following the "one fixture, one guide, one test"
  convention Item 8 set. The unified onboarding document lives at
  `docs/project-configuration.md` (new), absorbing `docs/configuring-a-role.md`,
  `docs/writing-a-gate.md` and `docs/writing-a-closer.md` as chapters rather than
  forking their content — those three files stay as the extender-facing
  programmatic reference `project-configuration.md` links to for anyone who
  outgrows the declarative surface, per the brief's "stitches" instruction (not
  "replaces").
- **Local-run story**: identical to Item 8's — a contributor runs the CLI from a
  checkout via compiled output or `tsx`, routed to `claude-mock` through the
  existing documented test seam (`src/testing.ts`, `mockSessionEnvironment`) for
  queue runs; `validate`/`preview` need no routing at all, since they never reach
  the agent seam. An adopter runs the installed `delivery` binary (`delivery
  validate`, `delivery preview`, `delivery run`) against their own repository and
  config file exactly as they already run Item 8's `run`/`status`/`init`.
- **Deploy target**: unchanged — the same `delivery-service` npm package Item 8
  ships (`dist/cli/main.js` behind the `delivery` bin), versioned by the same
  `changesets` flow, gated on the same licence decision. Item 9 adds no new
  package, no new binary, and no new deploy target: it is more surface on the one
  CLI that already exists.
- **Diagnosability**: a queue run leaves one `.delivery/runs/<run-id>/` per task,
  exactly as a single run already does — `delivery status --all` (Item 8, SHOULD)
  already lists every run in a repository; nothing new is needed to inspect a
  queue's history, because a queue's history *is* a set of ordinary runs.

## What this design does not include

- **Agent-driven onboarding** that proposes a whole configuration from a free-form
  project description (COULD tier per the brief; not designed here beyond noting
  §3.1's boundary against it).
- **Multi-surface concurrency** for the queue (Item 10) — §6.1's loop is
  deliberately sequential and single-surface only.
- **A reporting surface beyond the terminal renderer and `status`** (Item 11).
- **Task pack discovery/distribution** (Item 12) — only the schema shape a pack
  would use.
- **Scheduling or event triggers** (Items 13/14).
- **An auth UI, a mobile client, or an offline cache** — not applicable to this
  CLI/library; noted once here per the brief rather than invented.
- **Sandboxing** of gate commands, custom modules, or config `.js`/`.mjs` files —
  unchanged trust model from Item 8 (§9).
- **YAML/TOML config formats** — unchanged from Item 8's non-goal.
- **A known-tool list for `allowedTools`.** `validate`'s check of a `roles`
  override's `allowedTools` is structural only (§7) — no enumeration of "every
  tool name the SDK actually offers" exists anywhere in this codebase to check
  against, and this phase does not invent one (source-of-truth risk: it would
  need to track the SDK's own tool set independently and could silently drift).
  A misspelled tool name surfaces at run time via the existing `canUseTool`
  refusal (Item 4), not at `validate` time.
- **A "re-run this exact task" command or flag.** §6.2 deliberately answers this
  with "reword the entry" rather than new mechanism — no `--fresh`-for-one-entry,
  no queue-level re-run flag.

## Open questions

1. Whether `preview`'s synthetic `CaseFile` should be exposed as a small exported
   helper (`buildPreviewCaseFile`) for extenders writing their own tooling, or kept
   as CLI-internal. No persona need identified yet; default is CLI-internal until
   one appears.

**Resolved during critic review, round 1:** `queueIndex` placement was raised as an
open question and initially resolved to a `CaseFileHeader` sibling field.

**Superseded during team-lead assembly review, round 2:** that resolution turned
out to share the underlying defect of the index-in-`TaskDef` version it replaced —
position-based identity of any kind breaks under a checked-in queue file's normal
edits (insert, reorder, delete). §6.2 now uses content identity (deep-equality of
the structured `TaskDef` against existing runs' headers) instead, with no new
schema field at all. This is not re-opened as a question: it is the stated design,
covered in full in §6.2's edit-by-edit table.
