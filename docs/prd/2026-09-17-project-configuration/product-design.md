# Product design: Project Configuration (Roadmap Item 9)

**Status:** critic-approved (round 1); revised for team-lead assembly-review
findings and resubmitted (round 2). Autonomous run, no human review yet.
**Author:** product-designer, team `project-configuration-design`.
**Grounded in:** `docs/prd/2026-09-17-project-configuration/research.md` (cited
throughout as "research §n") and `docs/personas.md`.

## Vision

Item 8 got a person from nothing to one working run: a repo, a task
description, and the CLI infers the rest. That is a demo, not a project. A
real project has more than one thing to do, has its own domain context an
agent should know before it starts, and its owner wants to know *before*
spending any agent time whether their setup actually holds together.

Item 9 turns the harness from "a way to run one task" into "a way to run a
project": a checked-in, versioned description of what the project is, what
work is queued, how that work is checked and how it lands, that a person can
author without writing code, validate for free, and preview before they
spend a token. Nothing here replaces Item 8's `delivery.config.json` — it is
the same file, carrying more (research §1.1, §2).

The bar, restated for this phase: a non-technical project owner sets up a
whole small project — not one task — using only prose and built-in choices,
sees exactly what each agent will be told before any of it runs, and gets a
one-sentence answer naming the single thing to fix when something's missing.
An extender gets the same file at a lower altitude: named modules and typed
overrides, no new mechanism to learn beyond what Items 2, 4 and 6 already
shipped.

## Personas

Per `docs/personas.md` (team-derived, not human-confirmed — see that file's
own status note). This phase extends one goal in place (below); it forks no
persona.

- **Dana Okafor, Non-technical Project Owner** — the primary persona for this
  phase. Authors a project configuration by describing her project and its
  work in her own words, using only built-in gates and closers, and wants to
  know before a run starts whether her setup is complete.
- **Priya Shah, Harness Extender** — the programmatic-altitude reader of this
  same file: overrides a role's system prompt or tool list, points a task at
  work she's already broken down, and expects `delivery validate` to catch a
  mistake before it costs a run.
- **Marcus Webb, On-call Engineer** — does not author configuration, but
  benefits indirectly: a project with a domain prompt and a real task queue
  produces escalation packets with more legible context (`references`,
  `dead_ends`) than a single ad-hoc `--task` string does. No new goal for him
  this phase.

### Persona goal extension made for this phase

`docs/personas.md` extended Dana's goal once already, for Item 8, to cover
*starting a single run*. Item 9's roadmap accessibility note goes further: "a
non-technical project owner can set up a project using only declarative
configuration and built-in components, without writing any code" — setting
up a *project*, plural tasks, ongoing, not one invocation.

I amended `docs/personas.md` in place (dated note, `project-configuration-design`,
run `20260917T121214Z`, flagged assumed) adding this to Dana's section: she
authors and runs a small project — description, a handful of tasks, a gate
and closer choice, a check before spending anything — never opening the
config file's raw JSON by hand, never seeing "worktree", "envelope", "surface"
or "role config", and any broken setup names the one thing to fix in her own
words. Her Item 8 goal (one run, no config file) and her original goal
(reading escalation output) are unchanged; all three now describe one person
at three points in her relationship with the tool: try it once, run a real
project, check on it later.

## Problem and opportunity

Today, per research:

- **One run, one task, forever re-typed.** `resolveSettings` produces exactly
  one `TaskDef` per invocation (research §1.2); there is no queue anywhere in
  the resolution path. A project with five things to do runs `delivery run
  --task "…"` five times, retyping the same domain context into the agent's
  head each time because there is nowhere to put it once.
- **The domain prompt exists and does nothing.** `CaseFileHeader.domainPrompt`
  is fully plumbed into persistence and prompt assembly — it's the first
  thing appended to every role's system prompt when present (research §1.4,
  §1.5) — but no CLI code path ever sets it. The gap is a config key and a
  five-minute wiring fix, not new plumbing. This is the cheapest, highest-leverage
  piece of this phase.
- **Role overrides are a TypeScript-only lever.** `drive.ts` hardcodes
  `workerRoleConfig`/`gateMaintenanceRoleConfig` as static imports (research
  §1.5). An extender who wants a different tool list or a sharper system
  prompt writes and imports a module; there is no config-file seam at all,
  even though `RoleConfigShape`/`validateRoleConfig` already validate the
  target shape and are ready to be reused (research §1.5, §6.3).
- **No free check before spend.** Nothing today tells an owner their gate
  command is wrong, their closer type is misspelled, or their task list is
  empty, before a run provisions a worktree and calls an agent. The existing
  `.strict()` schema and `describeProblem` (research §1.1, §4) catch a typo in
  the *shape* of the four Item 8 keys; nothing checks the *completeness* of a
  project (a task list, a domain prompt, a role override that references a
  tool that doesn't exist).
- **No preview.** An owner cannot see what an agent will actually be told
  before it happens. `assemblePrompt` is a pure function already built for
  this (research §1.5) — nothing today calls it outside a live run.
- **Three separate onboarding guides, no map.** `writing-a-gate.md`,
  `writing-a-closer.md` and `configuring-a-role.md` each work alone; nothing
  stitches them into "here is how you set up a project," which is what a new
  adopter actually wants first (research §1.9, roadmap notes for Items 2, 4,
  6).

**Opportunity.** Every piece this phase needs either already exists
(`domainPrompt` field, `assemblePrompt`, `RoleConfigShape`, `.strict()`
validation, the config walker) or is a small, deterministic extension of it
(research §4, §5.3). The design cost here is almost entirely in the
authoring UX and the tier boundary, not in new mechanism — which is exactly
where a design pass earns its keep over letting the shape fall out of
whoever implements first.

## Buy-vs-build

Per the buy-vs-build lens: nothing here is a commodity crying out for a
library, and research (§4) independently confirms it, quoting the Item 8
spec's own precedent-setting decisions.

| Capability | Considered | Decision | Why |
|---|---|---|---|
| Config discovery (extended to new keys) | `cosmiconfig`/`lilconfig` | Extend `src/cli/config.ts`'s existing walker | Already a working, tested, ~15-line implementation of the same shape those libraries provide; Item 8 explicitly reserved a discovery library for "only if Item 9 needs YAML" (research §2), and YAML is this brief's own non-goal. Reaching for one now would be solving an already-solved problem. |
| JSON Schema for editor validation (SHOULD/COULD, e.g. `--json` schema dump) | `zod-to-json-schema` | `z.toJSONSchema()` (zod 4, built in) | Already used in this codebase for the same purpose (`prompt-assembly.ts:130`, research §4). No new dependency. |
| Plain-language validation errors | `zod-validation-error` | Extend the existing `describeProblem` | `describeProblem` already produces tailored, first-issue-only prose naming this project's exact vocabulary; a generic library would be a regression in message quality, not an improvement (research §4). |
| Domain prose authoring | `gray-matter` front-matter parsing, or a file-reference variant | Plain string field in the config file | The brief's non-goal on YAML/TOML plus the existing `domainPrompt: z.string()` shape point at Aider's proven pattern: prose loaded verbatim, no metadata parsing (research §3.4, §4). A file-reference variant (read a separate `.md` verbatim) was considered and dropped for the MUST tier in favour of one string field, one shape, at both altitudes (see Flow 1 and Flow 6) — simpler for `validate` and for Dana. No per-task metadata is needed for the MUST tier either. |
| Natural-language task → structured `TaskDef` | An agent call to structure prose | Prose passed straight through as `{ intent: "…" }` | `TaskDef` is genuinely opaque and every current consumer reads only `.intent` (research §1.4, §5.1). An agent call is non-deterministic and costs spend, which directly contradicts the brief's own MUST that `delivery validate` costs nothing (research §5.2, §5.3). Deterministic structuring is the only MUST-tier-compatible option; agent-assisted structuring is this phase's COULD. |
| Task queue storage | A separate queue engine / external file format | A flat, ordered array in `delivery.config.json` | Matches this repo's existing "name + params as data" pattern (`GateRef`/`CloserRef`) and the closest external precedent, Taskfile's flat named-task list (research §3.3). No queue engine has state beyond "done or not," which the case-file-per-task-run model already gives for free (see Key UX flows, "Running the queue"). |

The architect owns the final ledger and file-format details; this table
records the product-level reasoning that shaped what I designed around, so
the two artefacts agree before either goes to the critic.

## Derived minimum scope (assumed, not human-confirmed)

Carried from `review-log.md`'s phase-selection, reshaped below with
justification. The critic's remit explicitly includes scrutinising this.

### MUST

1. **A checked-in project configuration, extending `delivery.config.json`.**
   Three new keys alongside the existing four (`task`, `gate`, `closer`,
   `budgets`): a **domain description** in prose, a **task queue**, and
   **role overrides** (`systemPromptFragment`, `allowedTools`) for worker and
   gate-maintenance. Same file, same discovery, same `.strict()` schema
   composition — a superset, never a second file or format. *(Dana, Priya.)*
2. **Task definitions written in natural language, structured into what the
   harness needs.** Each queue entry is prose that becomes `{ intent: "…" }`
   deterministically — no agent call, no loss of the owner's own words. See
   "Key UX flow: writing tasks" for why "structured into what each role
   needs" is scoped this way, and why that scoping is not a retreat from the
   roadmap's wording given what the architecture actually consumes today
   (research §5.1, §1.5 — every role currently sees the same task block).
3. **`delivery validate`.** Local, offline, no agent spend: checks the
   configuration is complete and internally consistent (a gate is resolvable,
   a closer is resolvable, the task queue is non-empty with no two entries
   reading as the same task, each entry has prose, a role override is
   structurally sound) before a run starts. Reuses the existing `.strict()`
   schema composition and `RoleConfigShape`/`validateRoleConfig` (research
   §1.5, §4). Does not check an `allowedTools` name against a known-tool
   list — none exists in this codebase (see Flow 3).
4. **Preview of the assembled prompt.** A read-only command shows, per role,
   exactly what `assemblePrompt` would send — domain prompt, task, envelope
   shape — for the next queued task, before any run starts. No provisioning,
   no agent call: `assemblePrompt` is already pure (research §1.5).
5. **Running tasks from the queue.** Sequential, single-surface — Item 10
   owns concurrency. `delivery run` with no explicit `--task` works through
   the queue in order, one case file per task, resumable exactly as a single
   run is today.
6. **A complete example project, proven by a test.** A new, separate fixture,
   `examples/project-configuration-example/`, with a `delivery.config.json`
   using all three new keys, and a guide test that runs it end to end against
   `claude-mock`. `examples/sample-project` stays untouched, no-config, exactly
   as it is today (research §1.8) — `tests/getting-started-guide.test.ts` and
   `tests/sample-project.test.ts` depend on its no-config state as Item 8's
   own "repo + task alone" first-run example, and this phase must not disturb
   it. One fixture, one guide, one test, per the estate's existing convention
   (research §1.9).
7. **Unified onboarding documentation.** One guide that walks a new adopter
   through setting up a whole project, stitching `writing-a-gate.md`,
   `writing-a-closer.md` and `configuring-a-role.md` in as chapters rather
   than rewriting them (research §1.9, roadmap notes on Items 2, 4, 6).

### SHOULD

8. **`delivery init` extended** to ask about domain context and a first
   handful of tasks, alongside its existing gate/closer/task questions.
9. **Named gate presets** (`test-runner`, `file-exists`, `command-succeeds`,
   `schema-validates`) — the roadmap's own Item 2 accessibility note asks for
   this small library explicitly (research §2). Sugar over `GateRef`, no
   schema change.
10. **`--json` output for `validate`**, matching the existing `--json`
    convention on `run`/`status` (Item 8), for CI and scripting.

### COULD

11. **Agent-driven onboarding**: the harness proposes a configuration (gate,
    closer, task breakdown) from a project description, for the owner to
    review and approve — the roadmap's own framing, and the natural home for
    agent-assisted task structuring (§5.2) once it's explicitly opt-in and
    separated from the free `validate` path.
12. **Per-task metadata** beyond prose (priority, a role hint, an explicit
    scope) — deferred until a real need appears; `gray-matter` is the
    identified tool if it does (research §4).

### Non-goals (unchanged from the brief; restated for completeness)

Multi-surface concurrency (Item 10); observability/reporting (Item 11); task
packs (Item 12); scheduling (Items 13/14); licence choice and first
publication (human-gated); plugin distribution; YAML/TOML configuration;
sandboxing gate commands or custom modules (an existing, named Item 8
simplification this phase does not revisit).

### Where I reshaped the brief, and why

The brief's derived MUST #2 said tasks are "structured into what each role
needs." Research (§5.1, §1.5) found that no role today reads anything from
`taskDef` beyond the same JSON blob shown identically to worker,
gate-maintenance and triage — there is no architectural seam for "what a
role needs" to differ per task yet. I have **not** dropped this MUST; I have
scoped it to what the phrase can honestly mean given the current
architecture: prose → the one `TaskDef` shape every role already consumes.
Promising role-differentiated task views would be speculative — there is
nothing downstream to receive them — so I flag it here for the critic rather
than quietly narrowing it or quietly building unused plumbing.

I have **not** moved named gate/closer presets (SHOULD #9) to MUST despite
the roadmap's own accessibility note asking for them, because the brief's
derived scope explicitly places them at SHOULD and the MUST tier is
achievable without them (a project owner can still write
`{ "type": "command", "command": "npm test" }` by hand, exactly as Item 8
already lets her do via `init`). I flag this as a close call for the critic:
presets meaningfully lower Dana's authoring bar and are cheap (pure sugar,
no schema change), so if the critic judges the MUST tier does not genuinely
hold without them, I would not resist promotion.

## Key UX flows

Five flows carry this phase. Each is written at the altitude its persona
actually uses.

### Flow 1 — Authoring a project configuration at the declarative altitude (Dana)

Dana never opens `delivery.config.json` by hand for this. `delivery init`
(extended, SHOULD) or a text editor with the unified guide open both lead
here; either way the artefact is the same file.

She writes, in her own project's `delivery.config.json`:

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage. Nothing here talks to the internet except our own team.",
  "tasks": [
    "add a page that shows who's on call today",
    "let someone swap their on-call day with a teammate",
    "send a reminder the morning before someone's on-call day starts"
  ],
  "gate": { "type": "command", "command": "npm test" },
  "closer": { "type": "commit-to-branch" }
}
```

Nothing above is new vocabulary beyond Item 8's: `gate` and `closer` are
exactly as they were; `domain` and `tasks` are the two additions she
touches. `budgets` and `roles` exist in the schema but she never needs
them — their absence is not an error. `domain` is a plain prose string — she
never opens a nested object to write one sentence.

**What "structured into what each role needs" means for Dana, concretely:**
each line under `tasks` becomes that task's `TaskDef` verbatim — a bare
string is sugar for `{ intent: "add a page that shows who's on call today" }`
— no rewriting, no guessing at her intent. The structuring the harness does
is turning her list into the queue and giving each entry the one field
every role already reads. `tasks` (plural, a queue) and `task` (singular,
Item 8's one-off) are mutually exclusive in one config file — `validate`
refuses naming both if a config sets both, so a project is never ambiguous
about whether it's "one task" or "a queue."

### Flow 2 — Writing tasks in natural language

A task is one sentence or a short paragraph: a bare string in the `tasks`
array, in the order she wants them attempted. No headings, no IDs, no
metadata for the MUST tier (per Buy-vs-build, above) — the array's position
*is* the order, and the intent's first few words become that run's id slug,
exactly as `--task` already produces run ids today (research §1.7). An
extender who wants extra fields alongside a task's prose can write
`{ "intent": "…", ... }` instead of a bare string (Flow 6); Dana never needs
to.

An empty string, a duplicate-looking entry, or an entry that is only
whitespace is caught by `delivery validate` (Flow 3), never silently
dropped or silently run.

**How the queue survives Dana editing the list.** A queue entry's identity
is its own content — the structured `TaskDef` it produces — never its
position in the array and never a hidden id she'd have to manage. The
harness recognises "have I already run this one?" by comparing each entry
against past runs' recorded task, not by counting. Concretely, for Dana:

| She does | What happens |
|---|---|
| Adds a new task anywhere in the list | Only the new one runs; nothing already done or in progress is touched. |
| Reorders the list | Nothing re-runs and nothing is skipped — matching follows the words, not the position. |
| Deletes a line for a task that already finished | Nothing to resume — it already ran and stays in her run history; it just stops showing up as "next." |
| Rewords a task | The harness sees different words and treats it as a new task: the old run stays in history under the old wording, a new run starts for the new one. |
| Wants to deliberately re-run a "finished" task | Rewords the line (even slightly), or deletes it and adds it back — there is no separate "re-run" command; changing the words is how she asks for it to be tried again. |
| Lists the same wording twice | `delivery validate` refuses, naming both positions: two entries that read as the same task can't both be queued. |

"Task N of M" (Flow 5, `status`) is always the count of not-yet-closed
entries against the current length of the list, recomputed from the file as
it stands right now — never a number stored anywhere, so it can't go stale
after an edit.

### Flow 3 — Validating (Dana and Priya)

```
$ delivery validate
Checking delivery.config.json…
✗ tasks: item 2 is empty. Add a sentence describing what you want done, or remove it.
```

One problem, named plainly, with the fix stated — matching Item 8's existing
`describeProblem` convention (research §1.1) exactly, extended to the new
keys. Exit code `2`, same family as Item 8's configuration-problem class.
A passing check:

```
$ delivery validate
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

**No agent spend, ever** — this is the brief's own success criterion for
this command and it constrains the design directly (see Buy-vs-build,
"Natural-language task → structured `TaskDef`"). `validate` never
provisions a worktree, never calls `claude`, never touches the network.

Priya's version of the same command additionally checks her `roles`
override: an empty `allowedTools` list, an empty-string entry inside it, or
an empty `systemPromptFragment`, is refused with the field named, reusing
`RoleConfigShape`/`validateRoleConfig` (research §1.5). `validate` checks
`allowedTools` is *structurally* sound (a non-empty list of non-empty tool
names) — it does not check each name against a list of tools the SDK
actually offers, because no such list exists anywhere in this codebase
(`src/role-config.ts`, confirmed by the architect against source). A
misspelt tool name is not caught until a real run reaches `canUseTool`,
where it is refused there in plain language, exactly as any other
not-in-`allowedTools` call is today (`docs/configuring-a-role.md`, "What a
role cannot do"). Building a known-tool list is explicitly out of scope for
this phase (see Non-goals) — no persona need identified, and it would need
to track the SDK's own tool set to avoid going stale.

### Flow 4 — Previewing what agents will be told (Dana and Priya)

```
$ delivery preview
Next task: "add a page that shows who's on call today"

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
You make the smallest change to the working tree that satisfies the task below.
If you cannot proceed and no further attempt would help, escalate instead of guessing.

A small internal tool that tracks who's on call this week. Node.js, Express,
a SQLite file for storage. Nothing here talks to the internet except our own
team.

Task: add a page that shows who's on call today
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run
commands.
```

This is the assembled system prompt exactly as `assemblePrompt` would build
it for a live run (research §1.5) — same function, a synthetic case file
instead of a live one, no provisioning. `--role gate-maintenance` previews
that role instead of the default worker view; `--queue-index <n>` previews a
specific queued task instead of the next one. `preview` takes no free-text
flag — there is no `--task "…"` shorthand on this command, because it would
be ambiguous against `run`'s own `--task <text>`; a genuinely one-off task
is tried directly with `delivery run --task "…"` rather than previewed
first. On a project using singular `task` (Item 8-style, no queue), bare
`preview` previews that one task. `allowedTools` is rendered in plain
language (matching Item 8's own translation convention for terminal states,
`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`
"Terminal output"), never as raw SDK tool identifiers — Priya's habitual
reading of the guide gives the raw list for anyone who wants it; no
`--verbose` flag exists for this in the MUST tier.

This is the flow that answers the roadmap's own framing directly: "the
domain system-prompt fragment... can be authored and previewed before a
run." It costs nothing and needs no run in progress.

### Flow 5 — Running the queue (Dana, Priya)

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
main was not changed.

Task 2 of 3: let someone swap their on-call day with a teammate
- setting up
…
```

`delivery run` with no `--task` flag and no unfinished run walks the queue
in order: one case file per task (exactly Item 8's existing one-run-per-task
model, research §1.7), reusing every state-transition line, error message
and exit code Item 8 already defined — this phase adds no new terminal
vocabulary, it adds "which task" framing around the existing lines. An
explicit `--task "…"` still runs exactly one ad-hoc task and ignores the
queue, unchanged from Item 8.

A crash mid-queue resumes the same way Item 8's single run already does:
`delivery run` again finds the unfinished task's case file (matched by
content, as above, not by a stored position) and picks it up, then continues
down the queue once that task closes. `delivery status` gains "task N of M"
framing, always recomputed from the live list, on top of its existing
per-run output; it does not gain a new command.

If a task in the queue escalates, the queue stops there rather than skipping
ahead — the harness never decides on the owner's behalf that a later task
matters more than getting a human decision on this one. `delivery run` after
an escalation names the escalated task and that it is waiting on a person,
exactly as a single escalated run does today. There is no skip mechanism in
this phase (see "Questions the critic has ruled on"): a project owner who
wired ten tasks should not discover, hours later, that task 3 needed a
decision and tasks 4–10 ran anyway on top of an unreviewed state.

### Flow 6 — The extender's programmatic altitude (Priya)

Priya's same `delivery.config.json`, at the lower altitude:

```json
{
  "domain": "...",
  "tasks": [
    { "intent": "...", "area": "billing" }
  ],
  "gate": { "type": "custom", "modulePath": "./gates/my-gate.js" },
  "closer": { "type": "custom", "modulePath": "./closers/notify.mjs" },
  "roles": {
    "worker": {
      "systemPromptFragment": "You are the worker for the on-call service. Never touch the deploy scripts in ./ops.",
      "allowedTools": ["Read", "Glob", "Grep", "Edit", "Bash"]
    },
    "gateMaintenance": {
      "allowedTools": ["Read", "Glob", "Grep", "Edit"]
    }
  }
}
```

- `domain` is the same plain prose string as Dana's (Flow 1) — one field,
  one shape, at both altitudes. A longer or generated description is still
  just a JSON string value; nothing in the MUST tier reads it from a
  separate file (see "Questions the critic has ruled on" for why a
  file-reference variant was considered and dropped).
- An extender's `tasks` entry can carry extra fields alongside `intent`
  (`{ "intent": "...", "area": "billing" }`) — `TaskDef` stays the opaque
  passthrough object it already is (research §1.4); the harness still only
  reads `.intent` by convention, exactly as today, so an extra field is
  inert unless the extender's own tooling reads it.
- `roles.worker`/`roles.gateMaintenance` override only the fields given; an
  omitted field keeps the built-in reference configuration's value. This is
  the config-file seam `drive.ts`'s hardcoded imports don't currently offer
  (research §1.5) — the harness-level change is wiring this into
  `createAgentPort`, which is the architect's concern; the product shape is
  "override what you name, inherit the rest," matching how `budgets` already
  behaves in Item 8's schema (partial, merged over defaults).
- Triage is deliberately absent from `roles` in the MUST tier: Item 8 already
  drew this line ("triage stays a library-level choice," Item 8 spec) and
  nothing in this phase's research reopens it. An extender who wants a custom
  triage config still writes code, as today.
- A `custom` gate/closer module and a `roles` override that fails validation
  produce the same plain-language, field-naming refusal Item 8's
  `describeProblem` already gives for a malformed `gate`/`closer` — this
  phase extends the same function, not a parallel one.

## Command surface

Extends Item 8's surface; no command is renamed, no flag's existing meaning
changes.

- **`delivery validate [--config <file>] [--repo <path>] [--json]`** *(new,
  MUST)* — the completeness/consistency check above. Never provisions,
  never calls an agent. Exit `0` clean, `2` a named problem.
- **`delivery preview [--queue-index <n>] [--role worker|gate-maintenance] [--repo <path>]`**
  *(new, MUST)* — the assembled-prompt preview above, defaulting to the next
  queued task and the worker role; `--queue-index <n>` previews a specific
  queue position, `--role` previews the other role's view. No `--task`
  flag — a one-off task is tried with `delivery run --task "…"`, not
  previewed first. Never provisions, never calls an agent. Exit `0`, or `2`
  if there's nothing to preview (neither `task` nor `tasks` configured and
  nothing typed — the same `NO_TASK` refusal `run` already gives).
- **`delivery run`** *(extended)* — unchanged flags; with no `--task` and a
  non-empty `tasks` queue, walks the queue instead of refusing with "no
  task." An explicit `--task` still runs one ad-hoc task exactly as today.
- **`delivery status`** *(extended)* — unchanged behaviour, with "task N of
  M" context added to a queue-driven run's output.
- **`delivery init`** *(extended, SHOULD)* — asks for a domain description
  and a first task or two, alongside its existing questions.

## Config file shape (product-level; architect owns the schema)

Three new top-level keys, all optional (a project configuration with none of
them is exactly Item 8's file and keeps working unchanged):

- **`domain`**: a plain prose string — appended to every role's system
  prompt exactly where `CaseFileHeader.domainPrompt` already plugs in
  (research §1.4). This phase closes the "producer" gap research
  identified — `startRun`'s `create()` call needs to pass it; the schema and
  consumer already exist.
- **`tasks`**: an ordered array where each entry is either a bare string
  (sugar for `{ intent: <string> }`) or a full `{ intent: string, ... }`
  object — the same `TaskDef` shape `task` (singular) already uses, plural
  and ordered. `task` (singular, Item 8) and `tasks` (plural, this phase)
  are mutually exclusive in one config file; `validate` refuses naming both
  if a config sets both. An entry's identity is its own structured content
  (deep-equality of the `TaskDef` it produces), never its position — see
  Flow 2's edit-by-edit table. No new id field anywhere: no stored
  `queueIndex`, no marker distinguishing a queue-driven run from an ad-hoc
  `--task` run (an ad-hoc run that happens to match a queue entry's content
  is treated as satisfying it, which is correct, not a bug to guard
  against).
- **`roles`**: `{ worker?: Partial<RoleOverride>, gateMaintenance?:
  Partial<RoleOverride> }` where `RoleOverride` is `{ systemPromptFragment?:
  string, allowedTools?: string[] }` — partial, merged over the built-in
  reference configuration, reusing `RoleConfigShape` for validation (research
  §1.5).

This matches the architect's `architecture.md` draft key-for-key
(`domain`/`tasks`/`roles`, string-or-object task entries, `task`/`tasks`
mutual exclusivity) — confirmed by SendMessage exchange during drafting; see
Coordination record.

## Terminal output wording

No new vocabulary class is introduced; this phase extends Item 8's existing
conventions rather than inventing new ones:

- `validate` and `preview` output follows Item 8's rule that state and
  meaning are never carried by colour alone, colour is decorative and
  dropped under `NO_COLOR`/`--no-color`/non-TTY, and every line is
  append-only plain text with a `--json` opt-in (Item 8 spec, "Terminal
  output").
- Every `validate` failure names the one field and the one fix, mirroring
  the existing error table's shape (Item 8 spec, "Error and warning states")
  — no stack traces, no schema-internal vocabulary ("discriminated union",
  "z.string()") ever reaches the terminal.
- Queue framing ("Task 2 of 3: …") is additive text around Item 8's existing
  per-state lines; the state names themselves are untouched.

## Accessibility

Plain language for Dana is the binding constraint on every surface this
phase adds, per the roadmap's own framing of this item as "where the
two-audience split matters most":

- **No harness vocabulary anywhere in a declarative-altitude flow.** Never
  "worktree", "envelope", "surface", "case file", "role config",
  "discriminated union", or a raw SDK tool name (`Bash`, `Edit`) in anything
  Dana reads. `preview`'s default rendering translates `allowedTools` into
  plain phrases ("can edit files", "can run commands") exactly as Item 8
  translates surface states; there is no separate raw-list flag in the MUST
  tier, so Priya reads the raw names from her own config file's `roles`
  section rather than from `preview`'s output.
- **Every validation failure names the one thing to fix**, restated because
  it is the binding accessibility bar for this command specifically, not
  just a nice-to-have: a project owner who cannot read a stack trace must
  still be able to fix her configuration unassisted from the message alone.
- **The declarative and programmatic altitudes are the same file, same
  keys**, per the roadmap's own instruction that "both altitudes produce the
  same internal artefacts... the declarative path is a higher-level
  interface to the same contracts, not a separate system." Dana and Priya
  write the exact same `domain` field — one string, at either altitude —
  which populates the same `domainPrompt`; Dana's
  `{ "type": "command", "command": "npm test" }`
  and a future named preset (SHOULD) resolve to the same `GateRef`. Nobody
  reaches a wall where the declarative surface can't express something the
  programmatic one can, except role overrides and custom modules, which the
  roadmap explicitly accepts as extender-only ("accept that specific
  capability as extender-only" when a contract can't be simplified further).
- **Terminal output stays screen-reader-safe**: append-only lines, no cursor
  movement, inherited unchanged from Item 8.

## Empty, loading and error states

| State | What the user sees |
|---|---|
| No `delivery.config.json` at all | `validate`: "No delivery.config.json found. Run `delivery init` to create one, or see the getting-started guide." `preview`/`run`: falls back to Item 8's existing single-task defaults unchanged — this phase adds no new required file. |
| `tasks` present but empty array | `validate`: "tasks is empty. Add at least one sentence describing what you want done, or remove `tasks` and use `--task` for a single run." Exit 2. |
| A `tasks` entry is empty/whitespace-only | `validate`: "tasks: item `<n>` is empty. Add a sentence describing what you want done, or remove it." Exit 2. |
| Two `tasks` entries read as the same task | `validate`: "tasks: item 2 and item 5 are the same task. Reword one, or remove the duplicate." Exit 2. |
| Both `task` and `tasks` given in one config | `validate`: "This project has both `task` and `tasks` set; use `tasks` for a queue, or `task` for a single one-off, not both." Exit 2. |
| `roles.<role>.allowedTools` is empty, or contains an empty entry | `validate`: "roles.worker.allowedTools is empty. List at least one tool, or remove the field to keep the built-in list." Exit 2, reusing `RoleConfigShape`'s existing validation. A misspelt-but-non-empty tool name is not caught here — see Flow 3 for why — and surfaces in plain language at run time instead. |
| `roles.<role>.systemPromptFragment` is empty string | `validate`: "roles.worker.systemPromptFragment is empty. Either give it a sentence, or remove the field to keep the built-in one." Exit 2. |
| `delivery preview` with no `task` and no `tasks` configured | "There's nothing to preview yet: no task or task queue is configured. Add one under `tasks`, then try again." Exit 2 (the same `NO_TASK` refusal `run` gives). |
| `delivery run` on a project with a queue, all tasks already closed | "Every queued task is done. Add more under `tasks`, or `delivery status --all` to review what ran." Exit 0. |
| `delivery run` on a queue where an earlier task is escalated | "Task `<n>` needs your decision before I can continue the queue: `<packet decision, verbatim, Item 8's own convention>`." Exit 4 (Item 8's existing "needs a human" code). |
| `validate` / `preview` while a run is mid-flight | Both are read-only and safe to run alongside an active run, exactly as `status` is today — no new guard needed. |

Every row above extends `describeProblem`'s existing shape (research §1.1,
§4): one problem, the field named, the fix stated in the user's words, no
schema-internal jargon.

## Goals and success metrics

Restated from the roadmap's own success criteria (`delivery-harness-roadmap.md`,
Item 9), each mapped to how this design satisfies it:

1. *"A project owner can define a gate, a closer, and a task queue... without
   reading harness source."* → Flows 1–2, 5; `delivery init` (SHOULD).
2. *"The domain system-prompt fragment can be authored and previewed before a
   run."* → Flow 4, closing the `domainPrompt` producer gap directly.
3. *"Task definitions can be authored with the context each agent role
   needs, and validated before dispatch."* → Flows 2–3, scoped per "Where I
   reshaped the brief" above.
4. *"A project configuration can be checked into the repo and versioned."* →
   unchanged from Item 8: still one JSON file, still `delivery.config.json`.
5. *"A validation command checks... before a run starts."* → Flow 3.
6. *"An example project demonstrates a complete configuration end to end."*
   → MUST #6.
7. *"A non-technical project owner can set up a project using only
   declarative configuration... without writing any code."* → Flow 1, and
   the Accessibility section's binding constraint.
8. *"Task definitions can be written in natural language; the harness
   structures them into what each agent role needs."* → Flow 2.

**Metric this design can actually be checked against** (per "Endeavor to be
deterministic"): every guide-as-test and numbered-journey test this phase
adds runs offline against `claude-mock`, with no non-deterministic step in
the tested path — a direct consequence of keeping natural-language task
structuring deterministic (Buy-vs-build, above) rather than agent-assisted
in the MUST tier.

## Non-goals

Restated and made explicit for this document (matching the brief and
reshaped-scope sections above, gathered here for a single reference point):

- **Multi-surface concurrency** (Item 10) — the queue in this phase runs
  strictly sequentially, one surface at a time.
- **Observability/reporting** (Item 11) — `status`'s "task N of M" framing
  is the extent of run-history presentation this phase adds; no dashboard,
  no history browser beyond Item 8's existing `status --all`.
- **Task packs** (Item 12) — no shareable/importable bundle of tasks or
  configuration across projects.
- **Scheduling** (Items 13/14) — `delivery run` still runs once per
  invocation; nothing here adds a daemon, cron integration, or trigger.
- **Licence choice and first publication** — human-gated, outside any
  design team's remit (Item 8 spec, unchanged).
- **Plugin distribution** — a `custom` gate/closer/role is still a local
  file path; no registry, no npm-installable gate/closer package format.
- **YAML/TOML configuration** — `delivery.config.json`/`.js`/`.mjs` only,
  per Item 8's precedent and this brief's explicit non-goal.
- **Sandboxing gate commands or custom modules** — an existing Item 8
  simplification (ponytail-flagged there); this phase does not revisit it,
  including for `roles` overrides, which run with the same authority a
  custom gate already does.
- **Per-task metadata beyond prose** (priority, explicit scope, role hints)
  — COULD #12; no evidence of need yet.
- **Skipping an escalated task to continue the queue** — Flow 5 stops the
  queue at an escalation; the critic confirmed no skip mechanism belongs in
  this phase (see "Questions the critic has ruled on"), so none is designed.
- **Triage configuration in the declarative or programmatic config surface**
  — stays a library-level, code-only choice, unchanged from Item 8.

## Questions the critic has ruled on (closed)

1. **Stop, don't skip, on escalation (Flow 5).** Ruled correct: no skip
   mechanism this phase, matching "no unrequested abstractions." Closed.
2. **Named gate/closer presets stay SHOULD, not MUST.** Ruled: Item 8's
   `init` already gets Dana to a working gate/closer through prompts, not
   hand-written JSON — she doesn't hit raw `{"type":"command",...}`
   authoring unless she skips `init`. Presets are ergonomics on an
   already-clearable MUST bar, not required to clear it. Closed.
3. **`domain` as a single inline prose string, no file-reference split.**
   Ruled: stays as-is. The "uncomfortable for a long description" cost I
   flagged already has an escape valve with zero new mechanism: `.js`/`.mjs`
   are already valid `delivery.config` extensions (research §1.1,
   `src/cli/config.ts`), so an owner with a long domain description writes
   `export default { domain: \`...template literal...\`, ... }` today, no
   schema addition needed. Closed.

## Coordination record

Drafted independently, then reconciled by `SendMessage` exchange with the
architect before either artefact went to the critic. The architect's
`architecture.md` and this document now agree key-for-key: `domain` as a
plain prose string (not the `description`/`descriptionFile` split I
originally drafted — dropped in favour of the architect's simpler shape,
recorded as a flagged trade in "Where I reshaped the brief" and open
question 3), `tasks` as a string-or-`{intent,...}` array mutually exclusive
with singular `task`, `roles` as partial per-role overrides merged over the
shipped reference configs, `delivery validate` (zero agent spend) and
`delivery preview --queue-index --role` calling the library's own
`assemblePrompt` against a synthetic case file with no parallel renderer,
and a queue that stops rather than skips past an escalation. No open
disagreement remains between the two documents.

**Round 2 (team-lead assembly review).** The team-lead's cross-artefact pass
found five defects spanning both documents; reconciled again by `SendMessage`
before resubmitting to the critic:

1. Queue identity was keyed on array position in an earlier draft, which
   silently skips or re-runs tasks under a simple reorder. Resolved to
   content-based identity (deep-equality of the structured `TaskDef`, not
   just the bare intent string, so an extender's two same-worded-but-
   differently-parameterised entries stay distinct) — no new schema field.
   Reflected in Flow 2's edit-by-edit table and Flow 5.
2. This document's Flow 3 and error table overstated `validate`'s
   `allowedTools` check as "isn't a tool this harness knows" — no known-tool
   list exists in `src/role-config.ts`. Dropped; Flow 3 and the error table
   now state the check is structural only, and that a bad tool name surfaces
   at run time via `canUseTool` instead.
3. `preview`'s flag surface settled on `--queue-index <n>` only, no `--task`
   shorthand (ambiguous against `run --task <text>`) and no `--verbose`.
   Command surface, Flow 4 and the Accessibility section updated to match.
4. MUST #6's example project settled on a new, separate fixture,
   `examples/project-configuration-example/`; `examples/sample-project`
   stays untouched because existing guide tests depend on its no-config
   state.
5. Stale status line and dangling "open question"/"below" references
   (Flow 5's `--skip`, Flow 6's forward reference) tidied throughout.
