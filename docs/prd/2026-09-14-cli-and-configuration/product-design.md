# Product design: CLI and Configuration (Roadmap Item 8)

**Status:** draft, pending critic approval. Autonomous run, no human review yet.
**Author:** product-designer, team `cli-and-configuration-design`.
**Grounded in:** `docs/prd/2026-09-14-cli-and-configuration/research.md` (cited
throughout as "research §n") and `docs/personas.md`.

## Vision

Today the delivery harness is a library: to run it at all, you write
TypeScript against `src/index.ts`, hand-wire a `SurfacePorts` object, and
loop `advance()` yourself (research §1.2, §1.7). Item 8 turns it into a tool:
install one package, point it at a repo and a task, watch it work, get a
plain-language answer when it's done or stuck. This is "the adoption gate"
(roadmap Item 8 DX note) — everything built so far (gates, closers, triage,
the agent primitive) only becomes real to a user through this surface.

The bar: a person who is not an engineer can run the harness against their
own project and understand what happened, without reading source, without
learning the word "worktree," and without writing a config file unless they
want more control than the defaults give them.

## Personas

Per `docs/personas.md` (team-derived, not human-confirmed — see that file's
own status note):

- **Priya Shah, Harness Extender** — wires a custom gate/closer for her
  project, wants the CLI to pick up her registrations without her writing
  glue code.
- **Marcus Webb, On-call Engineer** — reads an escalation, technical, wants
  evidence not paraphrase, arrives with no context on this run.
- **Dana Okafor, Non-technical Project Owner** — runs the harness to get
  work done, checks in to see if something needs her, has no harness
  vocabulary.

### Persona goal extension needed for this phase

`docs/personas.md` describes Dana only as a *reader* of run output ("Look at
an escalated run and know... whether it needs her"). It says nothing about
her *starting* a run, because it was written for Item 5 (Triage), before a
CLI existed. Item 8's roadmap accessibility note explicitly promotes her to
first-touch user: "The CLI is the first thing a non-technical user touches"
and "a user who runs the tool with a repo and a task description, and
nothing else, should get a working run." That is a goal Dana's persona
doesn't currently state.

I have amended `docs/personas.md` in place (not forked a new file, per this
file's own maintenance instruction) to add this goal to Dana's section,
citing Item 8's roadmap text as the source. Her "what success looks like"
for reading output is unchanged; the addition is scoped to starting a run.

## Problem and opportunity

Nobody outside this codebase can use the harness today. Three separate docs
(`configuring-a-role.md`, `writing-a-gate.md`, `testing-your-pipeline.md`)
each independently state "the harness is not published as a package yet" and
route every example through `npx tsx` against a cloned checkout (research
§1.8). There is no `bin`, no `license`, no build step, no default budgets,
and no case-file-directory convention — the library assumes its caller
already knows the internal model (research §1.10, §1.2, §1.4).

The opportunity is narrow and load-bearing: every later roadmap item (9, 11,
12, 13, 14) depends on Item 8 directly or transitively (roadmap, review-log).
Getting the command surface and config shape right here means Item 9 extends
it; getting it wrong means Item 9 replaces it. The scope this phase should
resist is doing Item 9's job — natural-language task authoring, a domain
prompt authoring surface, a versioned project-config product. Item 8's job is
narrower and mechanical: make the existing library invocable, with defaults
good enough that "invocable" and "usable by Dana" are the same event.

## Buy-vs-build

**Argument parsing:** no arg-parsing library. Research (§3, §2) found no
sibling project in this estate reaches for one — `claude-mock`, `autoloop`,
and `open-design` all avoid commander/yargs/oclif, using env vars, manual
flag whitelisting, or an interactive-prompts library instead. `oclif`'s
50MB+ footprint (research §3) is disproportionate to a tool with a handful of
flags. This is an architecture-level call (parseArgs vs. citty vs. hand-rolled
whitelisting), but the product requirement is: subcommands (`run`, `resume`,
`status`), `--help`, and `--version` that behave like any other CLI a user
has met — whatever mechanism delivers that with the least code wins.

**Config loading:** combine with the already-installed `zod` (research
§1.10, §3) — parse whatever the file loader hands back through a schema,
same pattern as the case file's own validation. Not building a bespoke
YAML/JSON parser or a bespoke upward-search algorithm; cosmiconfig/lilconfig/
c12 all already solve "find and load a config file with a sensible search
path" (research §3) — architect's call on which, not a product concern.

**Interactive `init` (SHOULD-tier):** `autoloop` in this same estate already
ships an `@inquirer/prompts`-based wizard (research §2) — prior art to reuse
the pattern from rather than inventing prompt UX from scratch, if this tier
is built.

**Terminal progress:** plain line-based output is the MUST-tier default —
it's what the demos already do (research §1.7), it's CI-safe by construction,
and it needs no dependency. A richer live-updating display (ora/listr2,
research §3) is a SHOULD-tier enhancement layered on top for a TTY, never a
replacement for the plain-line fallback non-TTY output always needs.

**Packaging:** `vendor/claude-mock`, already inside this repo, is a working
example of exactly this shape — `bin` field, `tsc` build, committed `dist/`
(research §1.9, §2). Item 8 should follow that precedent rather than invent
a new packaging convention: it is the closest and most directly applicable
prior art in the estate, per the buy-vs-build lens's preference for existing
patterns over a generic template.

**What is not buy-vs-build:** the case-file-directory convention, the
default `BudgetSet`, and the plain-language diagnosis of "no `claude`
executable / no credential" (research §8) don't exist anywhere to buy —
research confirms no shipped default and no prior art for any of the three.
These are Item 8's to originate; I specify their user-facing shape below and
leave the exact values/algorithm to the architect.

## Derived minimum scope (assumed, not human-confirmed)

This is inferred by the team-lead from the roadmap (review-log), not
confirmed by a human. Kept conservative: the smallest capability set that
lets each persona reach their primary goal, nothing beyond it.

**MUST** (a persona's journey breaks without this):
1. An installable package (`delivery-service`) exposing a single `bin`
   (`delivery`) — `npm install -g delivery-service` then `delivery run`, or
   `npx delivery-service run` with no install, both work (roadmap Item 8
   success criterion; `npx` resolves the sole bin even though its name
   differs from the package name).
2. A `run` command that starts a single-surface run against a repo, given a
   gate, a closer, and a task, from a config file and/or flags.
3. Defaults good enough that repo + task description alone produces a
   working run — a built-in gate, a built-in closer, no "missing
   configuration" error for the base case (roadmap accessibility note).
4. Terminal progress reported in plain language while the run is active.
5. A crashed run can be resumed from the command line without the user
   supplying anything the harness could instead remember (research §1.4:
   `advance`/`run` are already unconditionally resumable from the case file;
   the CLI's job is remembering *where* the case file is).
6. Error messages for the base failure modes (no credentials, not a git
   repo, dirty tree, missing gate command, unknown closer type, crashed run
   found) that name the problem and the fix in plain language, assuming no
   harness vocabulary.
7. A sample project and a getting-started guide, proven by executing the
   guide's own instructions from a clean install.
8. Semver and a changelog.
9. The package is publish-ready (packaging, `files`/`exports`/`bin` wired,
   a release workflow) with first publication itself gated on the licence
   decision (see Open questions) — not performed this phase.
10. **A minimal `delivery status [<surface-id> | --last]` that prints a
    finished run's outcome after the terminal session that started it has
    ended** — plain language for a closed run, and, for an escalated one, the
    `EscalationPacket`'s `decision`/`evidence`/`dead_ends`/`why_now`/
    `references` verbatim (research §1.6). Without this, neither Marcus nor
    Dana has any way to complete journey 4 ("reading what happened when a run
    escalates") through the CLI at all: both are explicitly described in
    `docs/personas.md` as arriving *later*, not watching a live terminal
    (Marcus: "arrives at short notice... for a project he has only partial
    context on"; Dana: "checks in on runs"), and neither can be expected to
    open `case.json` by hand — Dana has no harness vocabulary and Marcus's
    bar is legibility from the packet alone, not from raw persistence. This
    is deliberately minimal: one run, plain-text, no filtering, no listing,
    no `--json` — just enough that the journey has a floor. The richer form
    is SHOULD-tier (below).

**SHOULD** (materially improves a persona's experience, not load-bearing for
the floor):
11. `--json` output on `status`, and listing every run under
    `.delivery/runs/` (not just the most recent/named one) for reading
    without a live terminal at scale (Marcus scripting a check; CI use).
12. An interactive `init` that walks a project owner through choosing a
    gate, a closer, and writing a first task via prompts (Dana, first run,
    per roadmap accessibility note).

**COULD** (real value, explicitly deferrable):
13. Multiple named task queues managed through the CLI in one invocation
    (single-task, single-surface is the floor; a queue is Item 9/10
    territory once it needs authoring, not just passing through).
14. Shell completion.
15. A `doctor`/preflight command that checks the `claude` executable and
    credential are present *before* a run starts, rather than only
    diagnosing failure after (valuable, but the MUST-tier error message at
    the point of failure already unblocks the persona).

## Primary journeys

Each journey names the persona and goal it serves, per the brief's
citation requirement.

### 1. First run: install to a completed run against the sample project

**Persona/goal:** Dana Okafor — get a working run from a repo and a task
description alone, with no config file and no code (roadmap accessibility
note; personas.md, amended).

1. Dana installs the package (`npm install -g delivery-service`, or she runs
   it once via `npx delivery-service` — both must work per MUST 1).
2. She has a working directory that is a git repository with a clean tree
   (the sample project ships exactly this, so the very first thing she runs
   the CLI against already satisfies every precondition).
3. She runs `delivery run --task "add a health-check endpoint that
   returns 200"` from inside the sample project.
4. The CLI:
   - confirms the directory is a git repo with a clean tree (or fails with
     a plain-language message, see Error states),
   - detects a test command from `package.json` to use as the built-in
     command gate (see Command surface → defaults),
   - picks the built-in `commit-to-branch` closer (see rationale below),
   - creates a case file under `.delivery/runs/<surface-id>/` in the repo,
   - starts the run and prints plain-language progress lines as the surface
     advances.
5. The run finishes. The CLI prints a plain-language outcome: what was done,
   where to find it (a branch name, not a "worktree ref"), and — if
   escalated — what decision is being asked of her, in the same register as
   the `EscalationPacket` (research §1.6) already uses.

**Why `commit-to-branch` and not `merge-back` or `open-pr` as the default
closer:** `merge-back` writes straight to the base branch with no review
step — wrong for a first, unsupervised run from someone who cannot yet judge
the agent's work. `open-pr` needs a configured git remote and forge
credentials (a second, harness-external precondition, on top of the `claude`
executable/credential precondition research §1.11 already documents) — it
would turn "repo and task alone" into "repo, task, remote, and forge token."
`commit-to-branch` needs nothing beyond git, which the sample project (and
the "is this a git repo" precondition check) already guarantees, and it
leaves a reviewable artifact (a branch) rather than a side effect Dana can't
inspect before trusting it. Extenders who want `open-pr` or `merge-back`
select it explicitly (config file or `--closer`); this is Item 8's default,
not a ceiling.

### 2. Extender wiring a custom gate/closer

**Persona/goal:** Priya Shah — wire her project's own gate and closer,
trust the CLI picks them up without hand-written glue (personas.md).

1. Priya writes a gate module and a closer module against the existing
   `Gate`/`CloserPort` contracts (`docs/writing-a-gate.md`,
   `docs/writing-a-closer.md` — unchanged by this item).
2. She writes a `delivery-service.config.*` (see Config file shape) naming
   `{ type: "custom", modulePath: "./gates/my-gate.js" }` for her gate and
   similarly for her closer — the exact shape the library's `GateRef`/
   `CloserRef` already define (research §1.2), so there is nothing new for
   her to learn beyond "here is where that reference goes in a file the CLI
   reads."
3. She runs `delivery run` with no gate/closer flags at all — a `custom`
   gate or closer can only be expressed as a full `GateRef`/`CloserRef` in
   the config file (see Command surface: the flags only cover the built-in,
   flat-value cases), so the config file supplies them (precedence: flags
   override config, both override built-in defaults — see Config file
   shape).
4. If her module path is wrong or her export doesn't satisfy the contract,
   the CLI surfaces the same plain-language framing as any other config
   error (see Error states → "unknown closer" / "missing gate command"),
   not a raw `InvalidGateExport`/import stack trace.

### 3. Resuming after a crash

**Persona/goal:** Priya Shah (most likely to be running this unattended and
to hit a crash) and Dana Okafor (needs resuming to not require anything she
doesn't have) — get a crashed run moving again from the command line
(roadmap Item 8 success criterion; personas.md).

1. The process running `delivery run` is killed (machine reboot,
   Ctrl-C, OOM) mid-surface.
2. The user runs `delivery run` again from the same repo directory,
   with the same or no `--task` flag.
3. The CLI finds the existing, incomplete case file under
   `.delivery/runs/` for this repo (see Command surface → resume
   discovery), and resumes it rather than starting a new run. It reports
   what it found using the library's existing `resumeAction` classification
   (research §1.4) translated to plain language — "picking up where it left
   off: rechecking your gate" rather than the raw `"gate"` action name —
   and, if the surface's own recovery reports anything (research §1.4's
   `recovery` string, `src/surface.ts:17-24`, "a resumed run says what it had
   to put right" — currently never printed anywhere), prints that too. This
   is the first place in the codebase this data reaches a user at all.
4. If more than one incomplete run exists for the repo (e.g. two different
   tasks started and both crashed), the CLI lists them with enough
   information to disambiguate (task description, started-at) and asks
   which to resume, rather than guessing.

### 4. Reading what happened when a run escalates

**Persona/goal:** Marcus Webb — decide what a human must do next from the
packet alone, without reconstructing history from transcripts (personas.md,
MUST-tier reader). Dana Okafor — know in plain language whether it needs her
(personas.md).

1. A run ends `ESCALATED`. The terminal (if still attached) prints the
   outcome at the point it happens; the case file persists the
   `EscalationPacket` regardless (research §1.6 — this is existing library
   behaviour, not new).
2. Marcus, arriving later with no context and no live terminal to have
   watched, runs the MUST-tier minimal `delivery status <run>` against the
   same repo (Derived minimum scope, MUST 10). The CLI reads the case file
   and prints the packet's `decision`, `evidence`, `dead_ends`, `why_now`,
   and `references` (research §1.6) — verbatim gate evidence, not
   paraphrase, exactly as the packet already carries it. This is what makes
   the journey possible at all for someone who wasn't there when the run
   finished, not an optional enhancement on top of it; the SHOULD-tier
   `--json`/listing form (MUST 10 vs. SHOULD 11) only adds scale and
   scriptability, not the ability to read a finished run in the first place.
3. Dana, checking in later, sees the same packet but the CLI's framing leads
   with the plain-language decision ("this needs your decision: the agent
   wasn't sure whether to delete the old homepage") ahead of the technical
   evidence — the same content, ordered for her first, per the roadmap
   Item 11 accessibility note's phrasing (cited here as the target register,
   since Item 8's summary is this project's only reporting surface until
   Item 11 ships a dedicated one).

## Command surface

*(Illustrative example invocations only — this is the product's shape, not
a build sequence. Command name aligned with the architect below: the
package publishes as `delivery-service`; the binary it exposes is the
shorter `delivery` — a person types `delivery run`, not `delivery-service
run`, the way `npm install -g eslint` gives you `eslint`, not
`eslint-the-package`.)*

- `delivery run [--task "<text>"] [--config <file>] [--gate-command "<cmd>"]
  [--closer <built-in-type>] [--repo <path>]`
  Starts a run, or resumes an existing incomplete one for this repo — one
  verb for both, so a person who doesn't know or care whether their last
  attempt crashed can always just run this again (see journey 3). `--repo`
  defaults to the current directory. `GateRef`/`CloserRef` are structured
  types, not flat strings (research §1.2), so flags only cover what's
  expressible as a bare value: `--gate-command` is shorthand for
  `{ type: "command", command: <value>, parseMode: "exitcode" }` (the
  default parse mode — a different one needs the config file), and
  `--closer` takes one of the built-in type names with no required fields of
  their own (`commit-to-branch`, `merge-back`, `open-pr`). A `custom` gate
  or closer, a non-default `parseMode`, or `merge-back`'s `deleteBranch`
  option are only expressible in the config file, where the full `GateRef`/
  `CloserRef` shape is written directly (see Config file shape below) — the
  flags are a convenience for the common case, not a second syntax for the
  whole type.
- `delivery resume [<surface-id> | --last] [--repo <path>]` — the explicit
  form of the same resume behaviour `run` does implicitly, for scripting or
  when a person wants to be certain they're resuming rather than
  (re)starting. Errors plainly if no incomplete run exists.
- `delivery status [<surface-id> | --last] [--repo <path>]` — read-only:
  for an in-progress run, prints the plain-language "what happens next"; for
  a finished run, prints the terminal outcome, or the escalation packet
  verbatim if escalated (Derived minimum scope, MUST 10 — this minimal form
  is what makes journey 4 possible for someone who wasn't watching when the
  run finished). Never advances state. `--json` output and listing every run
  under `.delivery/runs/` are SHOULD-tier additions (MUST 10 vs. SHOULD 11).
- `delivery init` (SHOULD) — interactive wizard: choose a gate, a closer,
  write a first task, writes the config file.
- `delivery --version`, `delivery --help` / `<command> --help`.

### Config file shape (user/harness-invocation level — Item 8's layer)

A single file, e.g. `delivery.config.json` (also a `.js`/`.mjs` form for
extenders who want to compute values; exact search path/format left to the
architect's library choice — discovered by walking up from the working
directory, the same convention git itself uses for `.git`), holding exactly
what Item 8's success criteria require to invoke a run:

```json
{
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "budgets": { "correction": { "max": 3 } },
  "task": { "intent": "add a health-check endpoint that returns 200" }
}
```

- `gate` / `closer`: the existing `GateRef`/`CloserRef` shapes verbatim
  (research §1.2) — nothing new invented, the CLI is a thin front door onto
  contracts that already exist.
- `budgets`: optional partial overrides of the CLI's own default `BudgetSet`
  (research §1.5 confirms none is shipped today; Item 8 must originate one).
- `task`: the same opaque `TaskDef` shape the library already accepts
  (research §1.2) — a single task for the MUST-tier single-surface floor.
  Item 9 is what teaches the harness to *structure* a natural-language
  description into this shape and to manage a queue of them; Item 8 only
  ever produces one `TaskDef` per invocation, from `--task` or this field.

**Precedence:** CLI flag > environment variable (`DELIVERY_*`, e.g.
`DELIVERY_GATE_COMMAND`) > config file field > built-in default. This is
the ordinary convention every comparable tool in research §6 (Aider,
`claude -p`) follows, and it is what lets Priya override one field (say,
`--gate-command` for a quick local check) for one run without editing her
checked-in config, or override it for a CI environment via env var without
a flag at all.

**Where Item 9 extends, not replaces, this:** Item 9's declarative surface
(natural-language task authoring, domain prompt authoring, a versioned
project-config product) is a *superset* of this same file — the same
`gate`/`closer`/`task` keys, with `task` gaining the ability to hold prose
that the harness structures, and new keys (domain prompt, task queue) added
alongside. Item 8 must not invent a config format Item 9 would need to
migrate away from; the four keys above are deliberately the minimum that
satisfies Item 8's own success criteria and nothing that anticipates Item
9's authoring UX.

### Defaults

- **Gate:** a command gate running the test command detected from
  `package.json`'s `scripts.test` (or the project's equivalent convention),
  `parseMode: "exitcode"` (the only parse mode that assumes nothing about
  output format — safe against any test runner). If none is detected, this
  is the one missing thing the CLI names (see Error states).
- **Closer:** `commit-to-branch` (see journey 1's rationale — no external
  precondition beyond git, leaves a reviewable artifact, never silently
  lands on the base branch).
- **Budgets:** a CLI-owned default `BudgetSet`, values TBD by the architect
  from what demos/tests already use as a working baseline (research §1.5
  lists the values every demo hand-writes today — `correction: 3, gateError:
  3, gateMaintenance: 2, terminus: 5, close: 3` — a reasonable starting
  point already exercised by the test suite, not a novel number this design
  is inventing).
- **Case-file directory:** `.delivery/runs/<surface-id>/` inside the target
  repo, where `<surface-id>` is derived from the task description unless a
  person supplies one explicitly. The CLI ensures this path is git-ignored
  (adding an entry with a one-line explanation if the repo has no
  `.gitignore` entry for it yet) — colocated with the repo so "resume" never
  requires the user to remember or supply a path, matching how `run`/
  `advance` already treat `dir` as caller-chosen (research §1.4). `resume`/
  `status` invoked with no id default to the most recently modified
  non-terminal run under that directory, the same "most recent, no id
  needed" convenience Claude Code's own `--resume` offers (research §6).

## Terminal output design

**TTY vs non-TTY:** the MUST-tier default is plain, line-based output — one
line per state transition, in plain language, no ANSI control codes — which
is CI-safe by construction and already the pattern every demo uses
(research §1.7). A SHOULD-tier richer live display (spinner/task-list) may
render additionally when stdout is a TTY, but the plain-line stream is
always what a non-TTY consumer (CI logs, `| cat`, a file redirect) sees, and
what `--json` reports structurally.

**Colour and `NO_COLOR`:** any colour is decorative only — meaning is never
colour-only. `NO_COLOR` (non-empty value; research §3) disables colour;
`--no-color` is the explicit flag override. This is the accessibility
baseline this item owns; it is a small, direct requirement, not deferred.

**Progress, translated:** every state name is translated to a plain-
language present-tense phrase before it reaches the terminal — the
translation table is small and fixed (the state machine's states are a
closed set): "setting up," "starting the agent," "checking your gate,"
"the agent is fixing something," "wrapping up," "done." `resumeAction`
(research §1.4) already gives the CLI the exact classification needed to
say what a *resumed* run is about to do, and the surface's `recovery`
string (currently unprinted anywhere in the codebase) is exactly what should
follow "picking up where it left off" when non-empty.

**Terminal outcome summary, per persona:**
- **Dana** (and any non-technical reader): a plain-language sentence
  matching Item 11's accessibility register — what happened, in terms of
  the task, not the state machine ("3 attempts, then the tests passed and
  the change is on branch `delivery/health-check`" / "this needs your
  decision: ..."). Never a raw state name, a budget population name, or a
  gate assertion ID as the *first* thing shown.
  file 5..." above); technical evidence and internal terms are additional,
  not withheld — Marcus's bar (personas.md) is that the evidence is present
  verbatim, not paraphrased away, so the summary leads with plain language
  and does not omit the underlying detail beneath it.

## Error and empty states

Every message names the problem in plain language and states the fix,
per the roadmap's explicit bar ("assume the reader does not know what a
'worktree' or 'structured output envelope' is"):

| Condition | What the user sees |
|---|---|
| No `claude` executable / no credential (research §1.11 — `DID_NOT_COMPLETE.notRun` is the closest existing signal and does not name the cause today; the CLI must add this diagnosis) | "I can't start the agent that does the work. Make sure the Claude Code CLI is installed and you're signed in (or set `ANTHROPIC_API_KEY`), then try again." |
| Not a git repository | "This isn't a git repository yet. The harness needs one to track changes — run `git init` here first, or point `--repo` at one." |
| Dirty working tree | "You have uncommitted changes here. Commit or stash them first — the harness needs a clean starting point to tell your changes from the agent's." |
| No test command detected, no `--gate-command` given | "I couldn't find a command to check the agent's work with. Tell me what marks a change as good — for example `--gate-command \"npm test\"` — or add a `test` script to your `package.json`." |
| Unknown closer type in config/flag | "I don't know the closer type `<type>`. Built-in options are `commit-to-branch`, `merge-back`, and `open-pr` — or point at your own with `{ \"type\": \"custom\", \"modulePath\": \"...\" }`." |
| A crashed/incomplete run found for this repo | "Found a run that didn't finish (started `<time>`, task: `<intent>`). Picking up where it left off — pass `--fresh` to start a new one instead." |
| Multiple incomplete runs found | Lists each with start time and task, asks which to resume (or `--fresh`). |

None of these messages use "worktree," "envelope," "surface," "gate
reference," or a `SurfaceState` name — those are internal vocabulary the
error text translates away, consistent with the state machine's own DX bar
(roadmap Item 3 note) applied at the CLI's outward face.

**Distinct exit codes** matter to Marcus and Priya specifically: a CI
pipeline or an unattended script needs to tell "the run escalated and needs
a human" apart from "the run crashed" apart from "the config was wrong"
without parsing text. `run`/`resume` should exit with a different code for
closed, an unexpected failure, a config/flag problem, an environment
precondition failure (no `claude`/no credential), an escalation, and an
abort — the exact numbering is the architect's call, not a product concern,
but the six-way distinction itself is a UX requirement: it's what lets "the
harness reviews every PR" (a later item's ambition, but exercised today by
anyone wrapping `delivery run` in their own CI step) branch correctly on the
outcome.

## Accessibility

- **Plain language by default**, as above — this is the primary
  accessibility requirement for Dana's persona and is treated as a MUST,
  not a polish pass.
- **`NO_COLOR`** honoured (see Terminal output design).
- **Screen-reader friendly output:** no reliance on cursor repositioning,
  spinners, or box-drawing characters in the MUST-tier plain-line mode —
  sequential, append-only lines read correctly by a screen reader exactly as
  they do in a CI log. A SHOULD-tier live TTY display must degrade to the
  same plain-line stream whenever stdout is not an interactive terminal
  (already required above for non-TTY) — the same test that makes it CI-safe
  also makes it screen-reader-safe, since AT typically reads a redirected or
  captured stream rather than an in-place redraw.
- **No jargon-gated recovery:** every error state above tells the user what
  to *do*, not only what went wrong — a Dana-level reader must never need to
  ask an engineer to translate an error message.

## Goals and success metrics

Mirroring roadmap Item 8's own success criteria, made checkable:

- A person can go from `npm install` to a completed run against the sample
  project by following the getting-started guide alone, with no step that
  requires reading source (proven by literally executing the guide from a
  clean environment, per the roadmap's DX note).
- Given only a repo and `--task`, a run starts with zero "missing
  configuration" errors when the repo has a detectable test command and a
  clean git tree.
- Killing the process mid-run and re-invoking `run` resumes to completion
  without the user supplying anything beyond the same command.
- Every MUST-tier error state (table above) is reproducible and its message
  is read back correctly by a person unfamiliar with the harness's internals
  (i.e., it doesn't require this document to decode).
- `npm publish --dry-run` (or equivalent) succeeds against the packaged
  artifact — publish-readiness proven without performing the first publish.

## Non-goals

- Item 9's declarative project-configuration surface: natural-language task
  structuring, domain prompt authoring, a versioned project-config product
  with its own validation command. Item 8 accepts a single opaque `TaskDef`
  per invocation and a `GateRef`/`CloserRef` verbatim; it does not structure
  prose into either.
- Item 10's multi-surface concurrency — this item is single-surface only.
- Item 11's dedicated reporting surface (live multi-surface dashboards,
  structured historical reporting across runs) — Item 8's terminal output
  and outcome summary are the whole of this item's reporting story.
- Item 12's task packs, Items 13/14's scheduling.
- Choosing the project's licence, and performing the first public
  publication of the package (see Open questions — this is an explicit,
  human-gated exclusion per this run's operating constraint, not an
  oversight).
- A packaged/named plugin distribution mechanism for custom gates/closers
  (research §1.3 confirms none exists today, and Item 8's scope is "just
  enough to make the harness invocable," not a plugin ecosystem) — `custom`
  stays a local file path, as it is today.

## Open questions

1. **Licence.** Gates first public publication. MIT vs. Apache-2.0 vs.
   another choice is an outward-facing, legally significant decision no
   human has made (research §7 lays out the facts only). The package must
   be publish-ready without this being resolved; publication itself waits
   on a human decision.
2. **Default `BudgetSet` exact values.** I've proposed reusing the values
   every demo/test already exercises (research §1.5) as a defensible
   starting point, but confirming these are the right operator-facing
   defaults (versus, say, more generous correction budget for a first-run
   experience) is a judgement call the architect and I should settle
   together before implementation, not something this document should
   pretend is final.
3. **Exact config file name/format and search path** (`delivery-service
   .config.json` vs `.yaml` vs `.js`, project-root-only vs. upward search) —
   deferred to the architect's library choice (research §3); this document
   fixes the four top-level keys (`gate`, `closer`, `budgets`, `task`) and
   the precedence rule, not the file format.
4. **Slug/naming scheme for concurrent named runs** — the MUST-tier floor is
   single-task, so this only matters once a user starts a second run before
   the first finishes; the mechanism (task-description hash vs. required
   `--name`) needs a decision but doesn't block the floor.
5. **Preflight `doctor` command (COULD-tier).** Whether checking the
   `claude` executable and credential *before* a run starts is worth
   building now versus relying on the MUST-tier error at the point of
   failure — I've placed it COULD-tier because the failure-time message
   already unblocks the persona, but the architect may find the preflight
   check nearly free once the diagnosis logic for the error message exists.

## Coordination record

Sent to `architect` for alignment on command surface, config shape, and
defaults before this draft was finalised. Sent to `critic` for the required
approval gate; see `review-log.md` for the outcome of that review once
complete.
