---
type: phase-design
created: 2026-09-17
roadmap_item: 9
---

# Project Configuration — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 9.
> Extends: `2026-09-14-cli-and-configuration-design.md` (Item 8: the `delivery` CLI, `delivery.config.json`, run lifecycle, error model, `describeProblem`).
> Builds on: `2026-09-09-agent-invocation-primitive-design.md` (Item 4: `RoleConfig`, `assemblePrompt`, `CaseFileHeader.domainPrompt`, tool authority), `2026-09-04-gate-interface-design.md` (`GateRef`), `2026-09-11-close-interface-design.md` (`CloserRef`), `2026-09-13-agent-mock-design.md` (`src/testing.ts`, vendored `claude-mock`, guide-as-test).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed; Dana's goal extended in place by this run).
> Audit trail: `docs/prd/2026-09-17-project-configuration/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).
> Produced by an autonomous design-team run (`20260917T121214Z`); no human reviewed it. No idea file from the operator's pool seeded this work: it is the next unstarted roadmap item.

## Problem

Item 8 took a person from nothing to one working run: a repository, a task
description, and the CLI infers the rest. That is a first run, not a project. A
project has several things to do, has domain context an agent should know before
it starts, and has an owner who wants to know before spending agent time whether
the setup holds together. Today (research §1):

- **One run, one task, retyped every time.** `resolveSettings` produces exactly
  one `TaskDef` per invocation; no queue exists anywhere in the resolution path.
- **The domain prompt exists and does nothing.** `CaseFileHeader.domainPrompt` is
  persisted and is the first thing `assemblePrompt` appends to every role's
  system prompt, but no CLI code path ever sets it.
- **Role overrides are a TypeScript-only lever.** `src/cli/drive.ts` imports
  `workerRoleConfig` and `gateMaintenanceRoleConfig` statically. An extender who
  wants a sharper system prompt or a different tool list writes a module; no
  config-file seam exists, although `validateRoleConfig` already validates the
  target shape.
- **No free check before spend.** The `.strict()` schema catches a typo in the
  shape of Item 8's four keys. Nothing checks the completeness of a project
  before a run provisions a worktree and calls an agent.
- **No preview.** `assemblePrompt` is a pure function, yet nothing calls it
  outside a live run, so an owner cannot see what an agent will be told.
- **Three onboarding guides, no map.** `writing-a-gate.md`, `writing-a-closer.md`
  and `configuring-a-role.md` each stand alone; nothing says "here is how you set
  up a project".

Items 4, 5, 6, 7 and 8 each deferred their declarative authoring surface to this
item. Items 10 to 14 (supervisor, reporting, task packs, scheduling) all consume
a project configuration, so this phase unblocks the rest of the roadmap.

**Opportunity.** Almost every mechanism this phase needs already exists
(`domainPrompt`, `assemblePrompt`, `validateRoleConfig`, the `.strict()` config
schema, the config walker, per-run case files). The design work is the authoring
experience and the tier boundary, not new machinery.

## Personas

From `docs/personas.md`:

- **Dana Okafor, Non-technical Project Owner.** The primary persona. This run
  extended her goal in place: she authors and runs a small project, not one task.
  She describes her project in prose, lists tasks in her own words, picks a
  built-in gate and closer, and sees before anything runs what the agent will be
  told and whether her setup is complete. She never reads "worktree",
  "envelope", "surface" or "role config", and a broken setup names the one thing
  to fix.
- **Priya Shah, Harness Extender.** Uses the same file at a lower altitude:
  custom gate and closer modules, role overrides, tasks carrying extra fields. She
  expects `delivery validate` to catch a mistake before it costs a run.
- **Marcus Webb, On-call Engineer.** Authors nothing. He benefits indirectly: a
  project with domain context and a real queue produces escalation packets with
  more legible context. No new goal this phase.

## Scope

### Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The MUST tier below was derived by the
team-lead from roadmap Item 9's success criteria, reshaped by the
product-designer, and critic-reviewed as conservative but usable (review-log:
phase-choice verdict, product-design rounds 1 to 3).

**MUST**

1. **A checked-in project configuration extending `delivery.config.json`.** Three
   new optional keys beside Item 8's four: `domain` (prose), `tasks` (a queue),
   `roles` (overrides for worker and gate-maintenance). Same file, same
   discovery, same `.strict()` schema. *(Dana, Priya.)*
2. **Task definitions in natural language.** Each queue entry is prose that
   becomes `{ intent: "…" }` deterministically: no agent call, the owner's words
   unaltered. *(Dana.)*
3. **`delivery validate`.** Offline, no agent spend, no credential needed: checks
   the configuration is complete and consistent before a run. *(Dana, Priya.)*
4. **`delivery preview`.** Read-only: shows, per role, exactly what
   `assemblePrompt` would send for a queued task. *(Dana, Priya.)*
5. **Running the queue.** `delivery run` with no `--task` works through `tasks` in
   order, one surface at a time, one case file per task, resumable as a single
   run is today. *(Dana, Priya.)*
6. **A complete example project, proven by a test.** A new fixture,
   `examples/project-configuration-example/`, using all three new keys and
   exercised end to end against `claude-mock`. *(Dana, Priya.)*
7. **Unified onboarding documentation.** `docs/project-configuration.md` walks a
   new adopter through setting up a project, with the gate, closer and role
   guides as linked chapters, proven by a guide-as-test. *(Dana, Priya.)*

**SHOULD**

8. `delivery init` extended to ask for a domain description and a first few
   tasks.
9. Named gate presets (`test-runner`, `file-exists`, `command-succeeds`,
   `schema-validates`): sugar resolving to a `GateRef`, per roadmap Item 2's
   accessibility note.
10. `--json` output for `validate`, listing every problem rather than the first,
    matching Item 8's `--json` convention.

**COULD**

11. Agent-driven onboarding: the harness proposes a configuration (gate, closer,
    task breakdown) from a project description for the owner to approve. This is
    the natural home for agent-assisted task structuring, kept opt-in and apart
    from the free `validate` path.
12. Per-task metadata beyond prose (priority, role hint, explicit scope).

**Where the brief was reshaped.** Roadmap Item 9 says tasks are "structured into
what each agent role needs". Every role today reads the same `task_def` prompt
slot verbatim; no per-role task shape exists for anything to consume. MUST 2 is
therefore scoped to what the phrase can honestly mean now: prose becomes the one
`TaskDef` every role already reads. Role-differentiated task views would be
plumbing with no consumer. Presets stay SHOULD because Item 8's `init` already
gets Dana to a working gate without hand-written JSON.

### Goals and success metrics

Each roadmap Item 9 success criterion maps to this design:

| Roadmap criterion | Met by |
|---|---|
| Define a gate, closer and task queue without reading source | `tasks` key, queue run, onboarding guide; `init` extension (SHOULD) |
| Domain system-prompt fragment authored and previewed before a run | `domain` key wired to `domainPrompt`; `delivery preview` |
| Task definitions authored and validated before dispatch | `tasks` entries; `delivery validate` |
| Configuration checked into the repo and versioned | Still one `delivery.config.json`; queue identity survives edits |
| A validation command checks completeness before a run | `delivery validate` |
| An example project demonstrates a complete configuration | `examples/project-configuration-example/` and its test |
| A non-technical owner sets up a project without code | Declarative altitude: prose and built-in components only |
| Tasks written in natural language | Bare-string queue entries |

The checkable metric: every guide-as-test and journey test this phase adds runs
offline against `claude-mock`, with no non-deterministic step in the tested path.

## UX / Product

### Configuration file

Three new top-level keys, all optional. A file with none of them is exactly
Item 8's file and behaves unchanged.

Dana's altitude:

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "tasks": [
    "add a page that shows who's on call today",
    "let someone swap their on-call day with a teammate",
    "send a reminder the morning before someone's on-call day starts"
  ],
  "gate": { "type": "command", "command": "npm test" },
  "closer": { "type": "commit-to-branch" }
}
```

Priya's altitude, same file:

```json
{
  "domain": "...",
  "tasks": [{ "intent": "...", "area": "billing" }],
  "gate": { "type": "custom", "modulePath": "./gates/my-gate.js" },
  "closer": { "type": "custom", "modulePath": "./closers/notify.mjs" },
  "roles": {
    "worker": {
      "systemPromptFragment": "You are the worker for the on-call service. Never touch the deploy scripts in ./ops.",
      "allowedTools": ["Read", "Glob", "Grep", "Edit", "Bash"]
    },
    "gateMaintenance": { "allowedTools": ["Read", "Glob", "Grep", "Edit"] }
  }
}
```

- **`domain`**: one plain prose string at both altitudes. It populates
  `CaseFileHeader.domainPrompt`. A long description uses the existing
  `delivery.config.js` / `.mjs` form with a template literal; no file-reference
  variant is added.
- **`tasks`**: an ordered array. Each entry is a bare string (sugar for
  `{ intent: <string> }`) or an `{ intent, ... }` object whose extra fields pass
  through untouched. `task` (Item 8, one-off) and `tasks` (queue) are mutually
  exclusive in one file.
- **`roles`**: `worker` and `gateMaintenance` only, each overriding
  `systemPromptFragment` and/or `allowedTools`. An omitted field keeps the
  built-in value, as `budgets` already behaves. Triage is absent: it stays a
  library-level choice, as Item 8 left it.

Both altitudes produce the same internal artefacts. The only capabilities
confined to the programmatic altitude are role overrides and custom modules,
which the roadmap accepts as extender-only.

### Command surface

No Item 8 command is renamed and no existing flag changes meaning.

- **`delivery validate [--config <file>] [--repo <path>] [--json]`** *(new)*
  Never provisions, never calls an agent, needs no credential. Exit `0` clean,
  `2` on a named problem. `--json` is SHOULD.
- **`delivery preview [--queue-index <n>] [--role worker|gate-maintenance] [--config <file>] [--repo <path>]`**
  *(new)* Prints the assembled prompt for one task and one role. Defaults: the
  next task the queue would run, and the worker role. `--queue-index` is 1-based,
  matching "Task N of M". Against a config with a singular `task` it previews
  that task and refuses `--queue-index`. With neither `task` nor `tasks` it
  refuses with `run`'s existing "no task" sentence. It takes no free-text task
  of its own. Exit `0`, or `2`.
- **`delivery run`** *(extended)* With no `--task` and a `tasks` queue present,
  walks the queue. An explicit `--task` still runs one ad-hoc task and ignores
  the queue.
- **`delivery status`** *(extended)* Adds "task N of M" framing for a run that
  answers a current queue entry.
- **`delivery init`** *(extended, SHOULD)* Asks for a domain description and
  first tasks alongside its existing questions.

### Key flows

**Validating.**

```
$ delivery validate
Checking delivery.config.json…
✗ tasks: item 2 is empty. Add a sentence describing what you want done, or remove it.
```

```
$ delivery validate
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

One problem, named plainly, with the fix stated: Item 8's `describeProblem`
convention extended to the new keys.

**Previewing.**

```
$ delivery preview
Next task: "add a page that shows who's on call today"

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small internal tool that tracks who's on call this week. Node.js, Express,
a SQLite file for storage.

Task: add a page that shows who's on call today
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run commands.
```

The prompt text between the rules is `assemblePrompt`'s output, unaltered. The
tools line translates `allowedTools` into plain phrases, as Item 8 translates
surface states; a tool name with no translation is printed as written.

**Running the queue.**

```
$ delivery run
Task 1 of 3: add a page that shows who's on call today
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
Done: the change for "add a page that shows who's on call today" passed `npm test`
and is committed on branch surface/add-a-page-...

Task 2 of 3: let someone swap their on-call day with a teammate
…
```

Queue framing is additive text around Item 8's existing per-state lines. A crash
mid-queue resumes as a single run does: `delivery run` again picks up the
unfinished task, then continues down the queue.

**Editing the queue after some tasks are done.** The file is checked in and
hand-edited, so every edit has a defined outcome:

| Owner action | Outcome |
|---|---|
| Insert a new entry anywhere | It has no matching run, so it runs, in its position. Other entries are unaffected. |
| Reorder | Each entry still answers to its own run; only visiting order changes. |
| Delete a finished entry | It leaves the queue; its run stays in history (`status --all`). |
| Delete an unfinished or escalated entry | The queue stops naming it; the run is untouched and still resumable by id. |
| Reword an entry | It is a new task and runs. The old run stays in history. |
| Re-run a finished task on purpose | Reword it, even trivially. No separate flag. |

"Task N of M" is recomputed from the file as currently written on every
invocation; no count is stored.

**Escalation stops the queue.** The harness never decides on the owner's behalf
that a later task matters more than a human decision on this one. No skip
mechanism is offered this phase.

### Empty and error states

Every row extends `describeProblem`'s shape: one problem, the field named, the
fix stated, no schema vocabulary.

| State | What the user sees | Exit |
|---|---|---|
| No config file | `validate`: "No delivery.config.json found. Run `delivery init` to create one, or see the getting-started guide." `run` keeps Item 8's no-config behaviour. | 2 |
| `tasks` is an empty array | "tasks is empty. Add at least one sentence describing what you want done, or remove `tasks` and use `--task` for a single run." | 2 |
| A `tasks` entry is empty or whitespace | "tasks: item `<n>` is empty. Add a sentence describing what you want done, or remove it." | 2 |
| Two entries are the same task | "tasks `<a>` and `<b>` are the same task; identical entries can't be told apart. Reword one or remove it." | 2 |
| Both `task` and `tasks` set | "This project has both `task` and `tasks` set; use `tasks` for a queue, or `task` for a single one-off, not both." | 2 |
| `domain` empty or whitespace | "domain is empty. Describe your project in a sentence or two, or remove the field." | 2 |
| Unknown key under `roles` | Named by the existing unrecognised-key path. | 2 |
| `roles.<role>.systemPromptFragment` empty | "roles.worker.systemPromptFragment is empty. Either give it a sentence, or remove the field to keep the built-in one." | 2 |
| `roles.<role>.allowedTools` empty | Named, with the same "remove the field to keep the built-in list" fix. | 2 |
| `preview --queue-index` out of range | "There's no task 7; your queue has 4." | 2 |
| `run` with every queued task closed | "Every queued task is done. Add more under `tasks`, or `delivery status --all` to review what ran." | 0 |
| `run` where a queued task's run is escalated | "Task `<n>` needs your decision before I can continue the queue:" then the packet's decision verbatim, per Item 8. | 4 |
| `run` where a queued task's run was aborted | Names the task and Item 8's aborted-run sentence; rewording the entry retries it. | 5 |

`validate` and `preview` are read-only and safe alongside an active run, as
`status` is.

### Accessibility

- No harness vocabulary in any declarative-altitude output: never "worktree",
  "envelope", "surface", "case file", "role config" or schema terms.
- Every validation failure names the one thing to fix. A project owner who cannot
  read a stack trace must be able to repair her configuration from the message
  alone.
- Output inherits Item 8's rules: append-only plain lines, no cursor movement,
  colour decorative only and dropped under `NO_COLOR`, `--no-color` or non-TTY.

## Architecture

This is a Node CLI and library. It has no auth UI, client platform or offline
cache, and none is introduced.

### Configuration schema

`DeliveryConfig` in `src/cli/config.ts` stays one `.strict()` zod object and
gains three optional keys. The four Item 8 keys are untouched.

```ts
const QueueEntry = z.union([
  z.string().min(1),
  z.object({ intent: z.string().min(1) }).passthrough(),
]);

const RoleOverride = z.object({
  systemPromptFragment: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1)).min(1).optional(),
}).strict();

const RoleOverrides = z.object({
  worker: RoleOverride.optional(),
  gateMaintenance: RoleOverride.optional(),
}).strict();

// added to DeliveryConfig:
domain: z.string().min(1).optional(),
tasks: z.array(QueueEntry).min(1).optional(),
roles: RoleOverrides.optional(),
```

String checks treat whitespace-only as empty. `task`/`tasks` mutual exclusion is
a `superRefine` on the object, enforced once at load so neither the single-task
path nor the queue path guesses which was meant. `loadConfig`, discovery,
precedence and the `.json`/`.js`/`.mjs` forms are unchanged. `describeProblem`
gains one branch per new key family, following its existing `closer.type` and
`budgets` cases.

Only the two plain-data fields of `RoleConfig` are exposed. `envelopeSchema` (a
zod type) and the reserved `budgets` field stay programmatic, as Item 4 left
them.

### Task structuring

```ts
function structureTask(entry: QueueEntry): TaskDef {
  return typeof entry === "string" ? { intent: entry.trim() } : entry;
}
```

A bare string becomes the exact shape `--task` already produces. An object
passes through. Structuring is deterministic because `validate` and `preview`
must run with no agent spend and no credential; an agent call would make their
output depend on a model. Agent-assisted structuring belongs to COULD 11.

Duplicate detection is enforced once at load, in the same `superRefine` as the
`task`/`tasks` mutual exclusion above: any two entries whose structured
`TaskDef`s are deep-equal (`"add a page"` and `{ "intent": "add a page" }` are
the same entry) are refused by `loadConfig` itself, before `validate`, `preview`
or `run` sees the config. Queue identity (§ Queue driver) depends on no two
entries ever structuring to the same `TaskDef`; enforcing that at load, rather
than only inside the `validate` command, is what makes the guarantee hold for
`run` too, including a run that never had `validate` invoked against it first.

### Domain context and the byte-identical prompt guarantee

`create()` writes the header, including `domainPrompt`, once at `PROVISIONING`;
nothing can change it afterwards. `assemblePrompt` is a pure function of the
on-disk case file and the role config, and already prepends `domainPrompt` to the
role's `systemPromptFragment` when present. This phase adds only a producer:
`resolveSettings` carries `config.domain`, and the CLI's run start passes it into
the existing `create()` call. Nothing downstream changes, so Item 4's guarantee
(same case file, byte-identical prompt) holds for the same reason it holds today.

### Role overrides

An override merges field by field over `workerRoleConfig` or
`gateMaintenanceRoleConfig`. The merged config passes through the existing
`validateRoleConfig` at `validate` and `preview` time and again before the first
dispatch of a run. The CLI's run composition passes the merged configs to
`createAgentPort` instead of the static imports.

`validateRoleConfig` checks structure only: a non-empty list of non-empty
strings. No list of valid tool names exists in this codebase, and none is
designed here, because nothing could keep it in step with the installed SDK. A
misspelled tool name is therefore not caught by `validate`; it surfaces at run
time as that tool being refused by Item 4's tool-authority enforcement. A role's
reach stays bounded by that enforcement regardless of what a config lists.

### `validate` and `preview`

Both are pure functions over the loaded configuration. Neither reaches
`agent-invoke.ts`, so neither goes through Item 8's agent-runtime preflight.

`validate` composes: `loadConfig` with the extended schema (which itself
enforces mutual exclusion and duplicate-entry refusal, see Task structuring);
the per-entry empty checks; role merge plus `validateRoleConfig`; and the
existing `checkCustomModules` (load, do not run)
for a `custom` gate or closer. It reports the first problem, or the summary.

`preview` builds a synthetic pre-run `CaseFile`, the shape `create()` would
produce for that entry, never written to disk, and calls the library's exported
`assemblePrompt` with the merged role config and empty evidence. It does not
re-implement prompt rendering: what it prints is what a run's first dispatch
sends, because it is the same function on the same inputs. "Next task" is the
first entry the queue driver would act on.

### Queue driver

One loop around Item 8's existing single-run composition; nothing inside
`driveToOutcome`, `resumeRun` or `src/surface.ts` changes.

```
for entry in config.tasks:
  taskDef  = structureTask(entry)
  existing = findQueueRun(repoPath, taskDef)
  if existing is closed:                 continue
  if existing is escalated or aborted:   stop, naming it
  if existing is unfinished:             outcome = resumeRun(existing)
  else:                                  outcome = start a run for taskDef
  if outcome is not closed:              stop
```

Preflight runs once, before the first task is provisioned.

**Identity is by content.** `findQueueRun` filters the existing `allRuns()`
(every case file under `.delivery/runs/`) for runs whose pinned `header.taskDef`
deep-equals the entry's structured `TaskDef`. When several match (an owner used
`--fresh`, or ran the same words ad hoc), the most recent run answers. Position
is not identity: a checked-in file is inserted into, reordered and trimmed, and a
stored index would silently skip a new entry or re-run an old one. Content
identity gives the edit table above with no new field, no `queue-state.json` and
no lock file. Progress is derived from case files on every invocation, so a crash
between tasks leaves nothing stale; crash recovery within a task is Item 1's and
Item 8's, unchanged.

**Accepted trade.** Matching is on `taskDef` alone, not `gateRef`, `closerRef` or
`domainPrompt`. If an owner changes the gate without rewording a task, that task
still counts as done under the old gate. This mirrors Item 8, where a finished
run stands until the owner asks for a fresh one. Rewording is the queue's
re-trigger. An ad-hoc `--task` run with identical words also satisfies a queue
entry, for the same reason.

Run ids come from the existing `runIdFor(intent, now)` and play no part in
identity.

### Error model

Item 8's table gains the rows under "Empty and error states": all configuration
problems exit `2`; a queue stopped by escalation or abort exits `4` or `5`, the
codes a single run already uses. `validate` and `preview` never exit `3` (no
preflight) or `4`/`5` (no run). Every other Item 8 row is reused verbatim.

### Security

No new trust boundary. The config file stays as trusted as the repository's own
`package.json` scripts. `domain`, `tasks` and `roles` are data; a `.js` config
computing them executes with the invoking user's authority exactly as one
computing `gate` already does. Custom modules resolve through the existing
`loadPlugin` / `checkCustomModules` seam, relative to the repository. Prompt
content from the config has the same trust level as Item 8's `task.intent`. No
secret-bearing field is added. No sandbox is added.

### Non-functional requirements

- **Determinism.** `structureTask`, the role merge, `findQueueRun` and prompt
  assembly are pure functions of the config and the case files on disk. Two
  `validate` or `preview` calls on the same inputs print identical output.
- **No agent spend and no credential** for `validate` and `preview`: an owner
  with no credential configured can check and preview a whole queue.
- **No new write path.** `validate` and `preview` write nothing. The queue
  driver's writes are Item 1's atomic case-file writes, one run per entry.
- **Backwards compatibility.** Every Item 8 config parses unchanged; the queue
  path activates only when `tasks` is present. No migration or version marker.

### Testing

- **Unit (vitest, no process spawn):** `structureTask`, the empty and duplicate
  checks, the role merge with `validateRoleConfig`, `findQueueRun` over case-file
  fixtures covering each edit-table row and the closed/escalated/aborted/
  unfinished branches, the new `describeProblem` branches, exit-code mapping.
- **Preview proven against the real dispatch path:** a test takes `preview`'s
  system prompt for a queue entry, drives that entry's real run through
  `claude-mock` via `src/testing.ts`, and asserts the mock's journal recorded the
  same system prompt. This is a non-drift proof, not a snapshot.
- **Guide-as-test:** `docs/project-configuration.md` gets a test in the style of
  `tests/getting-started-guide.test.ts`, executing the guide's own commands
  against the built CLI and the example fixture with the agent routed to
  `claude-mock`.
- **Example project test:** `validate` passes, `preview` shows the domain
  sentence in the system prompt, and running the queue yields closed runs in
  order whose headers carry the domain prompt and the overridden worker config's
  effect.
- **CLI end to end:** `validate`, `preview` and queue-driving `run` exercised
  against `dist/cli/main.js` in Item 8's scratch-repository harness, asserting
  stdout, exit code and case files on disk, including a crash between two queue
  tasks and an edit between two invocations.

`examples/sample-project/` stays untouched: `tests/getting-started-guide.test.ts`
and `tests/sample-project.test.ts` depend on it as the no-config first run.

### Extensibility

- **Item 10** consumes the same queue. The driver's unit, "next entry, drive one
  surface to an outcome", is what a supervisor runs N of.
- **Item 11** augments the renderer at the `AdvanceResult` seam Item 8 isolated;
  the per-task summary line is one more thing that seam carries.
- **Item 12:** a pack is a project configuration authored once and distributed.
  Its work is discovery and distribution, not shape.
- **Items 13/14** drive `delivery run` unattended against a queue; state-file-free
  resume means an interrupted scheduled run needs no scheduler-side bookkeeping.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Config schema and discovery | Reuse-estate: extend `DeliveryConfig` and the existing walker | `cosmiconfig` / `lilconfig`; a second Item 9 loader | The walker already works; Item 8 reserved a discovery library for YAML, which stays a non-goal. A second loader would fork precedence and `.strict()` behaviour. |
| Plain-language validation errors | Reuse-estate: extend `describeProblem` | `zod-validation-error` | The existing function speaks this project's vocabulary and reports one fix; a generic formatter would lower message quality. |
| Natural-language task structuring | Build: a three-line deterministic function | An agent call at load or validate time | An agent call is non-deterministic, costs spend and needs a credential, contradicting MUST 3. |
| Domain prose authoring | Reuse-estate: a plain string into the existing `domainPrompt` | `gray-matter` front matter; a file-reference key; a second prompt-injection path | The field, its pinning and its consumer already exist. One string at both altitudes is simplest for `validate` and for Dana. |
| Prompt preview | Reuse-estate: call exported `assemblePrompt` on a synthetic case file | A standalone template renderer | A second renderer could drift from the real prompt, which is the exact risk to Item 4's guarantee. |
| Role override validation | Reuse-estate: merge, then `validateRoleConfig` | A parallel validator | A second copy of the same rule would drift. |
| Queue storage | Reuse-estate: an ordered array in the config file | A queue engine or separate queue file | Matches the estate's "name plus params as data" pattern and Taskfile's flat list (research §3.3). |
| Queue progress and identity | Reuse-estate: content-match against `allRuns()` | `queue-state.json`; an index tag in `TaskDef`; a `CaseFileHeader.queueIndex` field | A stored cursor is a second source of truth, and position-keyed identity breaks when the file is edited. Content identity needs no schema change. |
| Sequential queue driver | Build: a thin loop over the existing run seam | Re-implementing run composition | Project-specific glue with no commodity equivalent. |
| JSON Schema for editors (if pursued under SHOULD 10) | Reuse-estate: zod 4's built-in `z.toJSONSchema()` | `zod-to-json-schema` | Already used in `prompt-assembly.ts`; no new dependency. |
| CLI subcommands | Reuse-estate: `commander` | Another CLI framework | Item 8 settled this for the whole CLI. |
| Custom modules | Reuse-estate: `loadPlugin` / `checkCustomModules` | A new plugin mechanism | Same shape gates and closers already use. |

No new runtime dependency is introduced.

## Operability / DX

- **Environment.** Unchanged from Item 8: Node ≥22, TypeScript, vitest, eslint,
  git, and for a real queue run the Claude Code executable and a credential,
  checked by the existing preflight. `validate` and `preview` need none of the
  agent runtime.
- **Harness.** The `src/cli/` one-file-per-command layout gains
  `validate-command.ts` and `preview-command.ts` and a queue-aware `run`
  dispatch. `src/role-config.ts` gains the merge function. No existing export
  changes shape.
- **Scaffolding.** One new fixture, `examples/project-configuration-example/`,
  following Item 8's "one fixture, one guide, one test" convention. The unified
  guide is `docs/project-configuration.md`; the gate, closer and role guides
  remain the extender reference it links to, not content it forks.
- **Local-run story.** A contributor runs the CLI from a checkout, routed to
  `claude-mock` through `mockSessionEnvironment` for queue runs; `validate` and
  `preview` need no routing. An adopter runs the installed `delivery` binary.
- **Deploy target.** The same `delivery-service` npm package and `delivery`
  binary, versioned by the same changesets flow, gated on the same licence
  decision. This phase is a minor version: additive surface only.
- **Diagnosability.** A queue's history is a set of ordinary runs under
  `.delivery/runs/`, already listed by `delivery status --all`.

## What this design does not include

- **Multi-surface concurrency** for the queue (Item 10).
- **Reporting beyond the terminal renderer and `status`** (Item 11).
- **Task pack discovery or distribution** (Item 12); **scheduling or triggers**
  (Items 13, 14).
- **Agent-driven onboarding** and agent-assisted task structuring (COULD 11, not
  designed here).
- **A known-tool-name check** for `allowedTools`.
- **Skipping an escalated task** to continue the queue, and any per-entry
  "run again" flag; rewording is the mechanism.
- **Invalidating finished queue entries when the gate, closer or domain
  changes.**
- **Triage configuration** in the config file; it stays a library-level choice.
- **Per-task metadata with harness meaning.** Extra fields on a task object are
  inert passthrough.
- **A file-reference form for `domain`.**
- **Licence choice and first publication** (human-gated), **plugin
  distribution**, **YAML or TOML**, **sandboxing** of gate commands, custom
  modules or `.js` configs.

## Assembly resolutions

Both role artefacts were critic-approved, then the team-lead's side-by-side
reading for assembly found defects neither review caught. They went back through
the critic gate (review-log, "assembly review, task #4 reopened") rather than
being settled silently. Outcomes:

1. **Queue identity.** Array-position identity silently skipped or re-ran tasks
   when the file was edited. Replaced by content identity; both artefacts now
   carry the edit table.
2. **Unknown tool names.** The product design promised a check "reusing"
   validation that does not exist. The promise was dropped and the gap documented.
3. **`preview` flags.** Settled on `--queue-index` and `--role`; no free-text
   `--task`, no `--verbose`.
4. **Example project.** A new fixture; `examples/sample-project/` is left alone
   because existing tests depend on it.
5. **Duplicate entries.** Refused by `validate` in both artefacts.

Settled by the team-lead at assembly, where the artefacts were silent or
ambiguous:

6. **Finished-but-not-closed runs.** The architecture's loop skipped any run with
   an outcome, which would have skipped an escalated task on the next
   invocation, contradicting both artefacts' "escalation stops the queue".
   Resolved: only a closed run is skipped; an escalated or aborted match stops
   the queue and is named.
7. **Several matching runs.** Unspecified. Resolved: the most recent run answers.
8. **`--queue-index` base.** The architecture said 0-based internally, 1-based
   externally. The spec states only the user-facing contract: 1-based.
9. **`preview` and `validate` take `--config`**, as `run` does; the architecture
   omitted it from `preview`.

## Open questions

1. **Gate changes and finished entries.** Whether changing `gate`, `closer` or
   `domain` should invalidate finished queue entries, or whether a per-entry
   fresh-run mechanism is wanted, is left to evidence from real use.
2. **Ad-hoc runs satisfying queue entries.** An ad-hoc `--task` run with
   identical words counts as that queue entry's run. This follows from adding no
   header field; whether owners find it surprising is unvalidated.
3. **Misspelled tool names** surface only at run time. A known-tool list would
   need a source of truth tied to the installed SDK version.
4. **Preset names and coverage** (SHOULD 9) follow roadmap Item 2's list;
   whether those four are the right set is unvalidated.
5. **Licence** remains open from Item 8 and still gates first publication. Needs
   a human.
6. **Whether `preview`'s synthetic `CaseFile` construction should be exposed as
   a small exported helper** (`buildPreviewCaseFile`) for extenders writing
   their own tooling, or kept CLI-internal. No persona need identified yet;
   default is CLI-internal until one appears.
