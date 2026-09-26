# Product design: Multi-Surface Supervisor (Roadmap Item 10)

Status: draft, awaiting critic review. Grounded in
`docs/prd/2026-09-26-multi-surface-supervisor/research.md` (cited inline as
`research.md §n.n`), `docs/multi-surface-control-flow.md` (the existing plan),
`docs/single-surface-control-flow.md`, `docs/provisioning.md`,
`docs/project-configuration.md`, `README.md`, `docs/getting-started.md`,
`docs/testing-your-pipeline.md`, and `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`
Item 10 (incl. its DX note) and Items 11–14 (read to keep their scope out).

## Vision

Today `delivery run` works through a list of tasks one at a time
(Item 9's sequential queue). Item 10 lets a project owner say "run several of
these at once" and get the same trustworthy, gated outcome per task, faster,
without learning a new mental model: still one repo, still one gate, still one
`delivery.config.json`, still the same six exit codes. The one new thing an
owner must be able to understand — because it is the one new failure mode
concurrency introduces — is that the *project's shared environment* can break
in a way no single task caused, and when it does, the harness pauses
everything to fix it rather than letting every task independently rediscover
and fight over the same broken box.

The harness becomes a small, deterministic scheduler in front of infrastructure
that already exists (`surface.ts`'s pure `advance()`/`run()`, the case-file
persistence model, provisioning, the gate and close interfaces) — none of
which Item 10 touches. Everything new is the layer *above* one surface: a
queue that can hand out more than one task at a time, a lock around the git
operations that were never safe to run twice at once, and a run-level record
of what the fleet of surfaces is doing collectively. `research.md §1.7`
confirms this framing is sound: nothing in `advance()`/`run()` depends on
being the only caller.

## Terminology decision (flag for the architect)

The codebase and the roadmap use two words for the same thing depending on
altitude, and Item 10 is where that stops being harmless:

- **User-facing docs today** call one task's execution "a run": `run-id`,
  `delivery status <run-id>`, `surface/<run-id>` as the branch name.
- **Internal design docs** call the same unit "a surface": `surface_id`,
  `docs/single-surface-control-flow.md`'s case file.

For one task these are the same identifier under two names — `surface/<run-id>`
*is* `surface/<surface_id>`. Item 10 introduces a genuinely new, higher-altitude
thing (the run file governing N surfaces), and it needs its own identity. The
proposal, chosen to disturb as little existing vocabulary as possible:

- **"Run" is promoted to mean "one invocation of `delivery run`"** — which is
  already how a user thinks about it, whether that invocation drives one task,
  a sequential list (today), or (new) several tasks at once.
- **"Surface" becomes the user-facing word for one task's execution within a
  run**, surfacing a name the codebase already uses internally rather than
  inventing one.
- **When a run has exactly one surface (concurrency 1, the default — see
  below), nothing changes for the user**: same `run-id`, same
  `surface/<run-id>` branch, same `delivery status <run-id>` output, byte-for-
  byte. The new vocabulary only becomes visible once concurrency is actually
  in play.
- `delivery status <id>` keeps its single positional argument and detects
  which kind of thing `<id>` names (a run with one surface, a run with many,
  or a bare surface within a many-surface run) from what is on disk, rather
  than inventing new addressing syntax — consistent with the existing command
  reading "the run touched most recently" when given no id at all.

This is a naming decision, not an architecture one, but it constrains the run
file's and CLI's shared vocabulary, so it needs the architect's agreement
before either side builds against it.

## Personas

Reference: `docs/personas.md` (team-derived, assumed). This phase adds a goal
extension, in place, to all three existing personas rather than inventing a
fourth — Item 10 changes *how much is happening at once* for people who
already have a goal here, not *who* uses the harness:

- **Dana Okafor — Non-technical Project Owner.** Extended goal: understand,
  from the terminal or `delivery status` and in her own vocabulary, roughly
  what is happening to several tasks running together, and — if the shared
  environment breaks — that the run has paused anything about to touch it
  while it's fixed, not that "the breaker tripped to DEGRADED". Drives the
  concurrent-queue and breaker-trip journeys below.
- **Priya Shah — Harness Extender.** Extended goal: prove her gate, closer and
  role configuration behave correctly under several concurrent surfaces,
  using the existing scripted-agent testing story, without needing a real
  concurrent run against real infrastructure. Drives the mock-testing journey.
- **Marcus Webb — On-call Engineer.** Extended goal: when an `EscalationPacket`
  arrives because the *run* escalated (breaker exhaustion) rather than one
  *task* escalating, the packet says so plainly, so he doesn't diagnose a task
  that was never the cause. Drives the "escalated task while others continue"
  journey's packet content, and the breaker-trip journey's post-mortem.

## Derived minimum scope (assumed, not human-confirmed)

The review log's derived MUST (`docs/prd/2026-09-26-multi-surface-supervisor/review-log.md`)
is the floor. Refined here into the smallest set of capabilities that let each
persona above complete their primary journey end to end, nothing speculative:

**MUST**

1. A `concurrency` setting (config key, `--concurrency` flag, `DELIVERY_CONCURRENCY`
   env var, same precedence as every other setting), a whole number, **default 1**.
   At `concurrency: 1` the run behaves exactly as it does today — the existing
   sequential loop (`research.md §1.1`), no run file, no lock, no new failure
   mode, zero migration for an existing user. Concurrency only activates the
   new machinery below when explicitly raised. See "Why default 1" under Key
   UX flows.
2. A run file, reusing the case file's three-part persistence split (immutable
   header, mutable cursor, append-only history), as already specified in
   `docs/multi-surface-control-flow.md`, holding: the shared queue cursor, the
   slot→surface assignment, the breaker state, and the run-level
   `gate_maintenance` budget. Exists only for `concurrency > 1`.
3. A fixed pool of surface slots sized to `concurrency`. A freed slot
   re-reads the task list and automatically provisions the next queued task,
   using the existing content-based task matching (`research.md §1.1`) rather
   than a stored index, so editing the task list keeps meaning the same way it
   already does for the sequential queue.
4. One repo-level lock serialising every ref-mutating git operation:
   `worktree add`, `worktree remove`/`prune`, `branch -D`, and the merge-back
   close. `research.md §1.3–§1.4` name these as the exact, currently-unguarded
   operations; everything else (gate runs, the agent session, in-worktree
   edits) runs fully parallel, unlocked.
5. The breaker (`HEALTHY | DEGRADED | REPAIRING`) and the run-level
   `gate_maintenance` budget, exactly as specified in
   `docs/multi-surface-control-flow.md`: a surface hitting `GATE_MAINTENANCE`
   blocks rather than dispatching its own repair; the supervisor runs one
   exclusive, stop-the-world repair; repair success resumes every blocked
   surface; repair exhaustion escalates the whole run.
6. Supervisor crash resume from the run file alone — same invariant as the
   case file (`research.md §1.6`): the log tail is the crash detector, no
   warm-memory dependency. On restart, no surface is double-provisioned and
   no merge runs twice.
7. Terminal output that stays legible when several surfaces interleave: every
   line unambiguous about which surface it belongs to, in plain language,
   readable with `NO_COLOR`/`--no-color`, and as one JSON object per line
   under `--json` exactly as today's single-surface output already is. See
   "Terminal output" below for the concrete shape.
8. `delivery status` extended: given a run-with-many-surfaces id, a run-level
   summary (breaker state, per-surface state, budget headroom) in both plain
   language and `--json`; given a single-surface id, today's report,
   unchanged. This — plus the run file itself — is the literal answer to the
   roadmap DX note's "inspect the run file post-mortem".
9. Exit codes unchanged in number and meaning (the existing six-row table).
   A concurrent run's terminal outcomes are a strict superset of situations
   the table already names (drained → 0, any surface or the run itself
   escalated → 4, stopped before finishing → 5), not a new category, so no
   new code is added.
10. The testing API (`runSurfaceAgainstMock`, `fakeAgentPort`,
    `docs/testing-your-pipeline.md`) extended to drive several scripted
    surfaces with a chosen interleaving. Named explicitly in the roadmap's DX
    note ("test N surfaces with the mock"), and it is Priya's only route to
    her extended goal without a real concurrent run — floor, not stretch.

**SHOULD**

- `delivery init`, on detecting more than one task, offers a conservative
  concurrency suggestion rather than defaulting to it silently — an explicit
  choice each time, never a silent behaviour change.
- The plain-language breaker narration (what broke, who it's blocking, what
  repair is doing) is surfaced at the top of `delivery status` when relevant,
  not buried under a full surface-by-surface listing.
- A queued task that is waiting only because the pool is full says so on
  request, so throughput is legible rather than mysterious ("queued, waiting
  for a free slot" vs. silence).
- The terminal/status wording distinguishes an API rate-limit or spend-cap
  symptom (`research.md §2.4`) from a genuine shared-environment breakage,
  so an owner isn't told their project is broken when the real cause is a
  429 with no code fault at all.

**COULD**

- A host-level governor spanning multiple concurrent `delivery run`
  invocations on one machine (`docs/multi-surface-control-flow.md`'s named
  open item; out of this run's scope per its own runtime boundary — see
  Non-goals).
- Priority ordering beyond FIFO in the queue.
- A finer-grained pause (gate/close-only) instead of full stop-the-world
  repair, if repair frequency is ever shown to hurt throughput — the existing
  plan's own `ponytail` note.

**Non-goals**

- Item 11's full observability/reporting surface (a TUI, budget dashboards,
  cross-run trend reporting). This phase gives exactly enough terminal/status
  visibility to diagnose a breaker trip and read a post-mortem (the DX note's
  literal bar), not a reporting product.
- Task packs and scan→fix fan-out (Item 12), local/managed scheduling and
  event triggers (Items 13–14) — read, not absorbed.
- Cross-target fleets: a run is scoped to one target, one repo, one gate, per
  `docs/multi-surface-control-flow.md`'s "Runtime scope". Running several
  independent targets is several independent invocations of this same
  feature, not a scheduling concern for this phase.
- A host-level resource/rate governor (COULD above).
- Live mid-run edits to the task list. The queue is re-read before each
  slot-fill (MUST 3), but the *set of tasks the run is working through* is
  fixed at the run's start, exactly as the sequential queue already only
  re-reads the list at the top of each `delivery run` invocation
  (`research.md §1.1`) — Item 10 does not add live reload.
- Dependency-aware (DAG) scheduling — an explicit non-goal already recorded in
  the existing plan; the queue stays FIFO until a task is shown to genuinely
  block on another task's merge.

## Buy-vs-build (concrete choice deferred to the architect; naming the alternatives)

Per the brief, the concrete pick is the architect's; what follows is what the
CLI/config surface needs from whichever is chosen, and why none of these are
worth hand-rolling from nothing:

- **The repo lock.** `research.md §2.1` names `proper-lockfile` (cross-process,
  survives a supervisor crash-and-restart, at the cost of stale-lock cleanup on
  a hard kill) against `async-mutex`/`p-limit` (in-process only, simpler, no
  stale-lock problem, but doesn't by itself survive a process restart). The CLI
  surface is identical either way — the lock is invisible to a user — so this
  is purely an architecture decision, flagged for the architect. What the
  product surface *does* require, regardless of pick: MUST 6 (crash resume)
  has to hold even if the chosen lock is in-process-only, which likely means
  the run file's own commit-point discipline (not the lock) is what actually
  guarantees no double-merge on resume, the same way `docs/provisioning.md`
  already relies on the case-file header write, not a lock, as the crash
  boundary for provisioning.
- **The concurrency pool.** `p-limit` is a flat concurrency ceiling, which is
  exactly what "worktree-pool size" is; `p-queue` adds priority/pause-resume,
  which this phase explicitly does not need (FIFO only, non-goal above) — so
  `p-limit` is the shape that matches scope, not a mandate.
- **The breaker.** `research.md §2.3` is decisive here: Opossum and Cockatiel
  are both built for in-process, ephemeral, single-call protection; this
  breaker is a persisted, cross-surface, crash-recoverable field that must
  survive exactly the way `cursor.state` already does in the case file. Reuse
  of that existing pattern beats adopting a library built for a different
  shape — this is the estate-prior-art win the brief asks for, not a gap to
  fill with a dependency.
- **Identifiers.** Reuse `surface_id` (already used internally) as the
  per-task identifier surfaced by the CLI once concurrency is in play, rather
  than inventing a new noun (see Terminology decision above).

## Operability / DX

- **Develop:** the supervisor is new code above `surface.ts`, which is
  untouched (`research.md §1.7`); the sequential path (`concurrency: 1`) is
  also untouched. The only genuinely new surfaces to build are the run file,
  the lock, and the slot-fill loop — everything else is composition of
  existing, already-tested pieces.
- **Run:** no new command, no daemon, no new install step. `concurrency` is a
  config key like `budgets` or `roles` already are; `delivery run` is still
  the one verb.
- **Verify/diagnose:** the roadmap DX note asks for exactly three things, and
  each has a direct answer in this design: diagnosing a breaker trip → the
  plain-language narration plus `delivery status`'s breaker summary;
  inspecting the run file post-mortem → `delivery status <run-id> --json`;
  testing N surfaces with the mock → the extended testing API (MUST 10).
- **Deploy target:** unchanged — a single CLI process per invocation, same as
  today. The host-level governor is deliberately deferred (COULD/non-goal)
  partly *because* it would otherwise pull in a genuinely new deploy shape
  (a daemon, or a lock shared across machines) that this phase's single-
  process, single-target scope does not need.

## Primary journeys

Each cites the persona and goal it serves.

### 1. Dana runs a 10-task queue with concurrency

*Serves: Dana Okafor's extended goal (understand what's happening to several
tasks at once, in her own words).*

Dana already has a `delivery.config.json` with ten tasks (Item 9). She adds
one line:

```json
{ "concurrency": 3 }
```

`delivery validate` confirms it in the same tick-list style as every other
setting:

```
✓ concurrency: up to 3 tasks at once (10 queued)
```

`delivery run` starts, and its terminal output stays plain-language and
legible as three tasks run in parallel (see "Terminal output" below for the
exact shape). She does not need to know a run file exists, a lock exists, or
that a "surface" is a word the harness uses — the same bar Item 9 already set
for her (`docs/personas.md`'s Dana). At the end: "Every task on your list is
done" if all ten finish, or a plain statement of which ones need her.

### 2. A crash and resume

*Serves: Dana's goal (a run she started keeps working even if her laptop
sleeps), and the roadmap's MUST ("a supervisor crash resumes from the run
file").*

Mid-run, the machine restarts. Dana runs `delivery run` again in the same
folder — the same muscle memory Item 8 already taught her for a single task.
The supervisor reads the run file's tail, finds which surfaces were mid-flight
when it died, and resumes each from its own case file's tail exactly as a
single surface already does. No worktree is double-provisioned (MUST 6); no
task that had already merged runs again. The terminal says what it is picking
up, the same courtesy the existing single-surface resume already gives.

### 3. A breaker trip and what the owner sees

*Serves: Dana's extended goal directly (the one new vocabulary she needs);
Marcus Webb's extended goal (a run-level packet that says it's run-wide).*

Two of Dana's three running tasks hit the same environment problem — say, a
database container that died. The harness does not treat this as two
unrelated task failures:

```
! Something in the shared environment looks broken (2 of 3 running tasks hit
  the same problem). Pausing anything about to touch the shared project while
  it's repaired — work already under way carries on.
  - repairing (attempt 1 of 2)
✓ Fixed. Resuming.
```

The pause is deliberately narrow, and the wording says so rather than
overclaiming: only a task about to check its work or hand it off is held
back (it is the shared project those steps touch, not the task's own
worktree); a task where the agent is still working, or where a setback is
being triaged, is untouched by the repair and simply carries on, per the
architecture's exclusive-repair design (`architecture.md §5`) — nothing is
force-stopped mid-session. If repair fails twice (the run-level
`gate_maintenance` budget), the whole run escalates:

```
! Something in the shared environment looks broken, and repair didn't fix it
  after 2 attempts.
Stopping the run. 2 of 10 tasks were paused waiting on this and need your
attention; 5 had already finished, 3 are still queued.
Run `delivery status add-a-page-20260926T090000Z` to see the whole run.
```

`delivery status` on that run id leads with the breaker state and which
surfaces it blocked, before the per-surface list — the SHOULD above. If
Marcus is the one reading it (escalated to him instead of Dana), the
`EscalationPacket` says plainly this is a run-wide environment failure, not a
defect in either paused task — his extended goal.

### 4. An escalated task while others continue

*Serves: Dana's and Marcus's existing goals (per-task escalation, unchanged);
demonstrates that concurrency does not couple unrelated tasks' fates.*

One task genuinely fails — its own correction budget exhausts on a real
regression, nothing environmental. That surface alone reaches `ESCALATED`;
its slot frees, and the supervisor provisions the next queued task into it
immediately. The other running surfaces are entirely unaffected — this is the
property the shared-fate/task-local budget split exists to guarantee
(`docs/multi-surface-control-flow.md`'s budget table). `delivery status` on
the run shows "9 done, 1 needs your decision" without implying anything about
the nine.

### 5. Priya tests N surfaces with the mock

*Serves: Priya Shah's extended goal (prove her pipeline concurrency-safe
without a real concurrent run).*

Priya has a gate and closer already proven single-surface
(`docs/testing-your-pipeline.md`). She extends her test to script several
surfaces with a chosen interleaving — for instance, two surfaces both trying
to `GATING`→`CLOSING` at once, to prove her closer's serialisation holds — and
asserts on the resulting git state (one clean merge, one that correctly
detects the moving base and reports `FAIL`, matching
`merge-back-closer.ts`'s existing ff-only probe, `research.md §1.4`/§2.5).
She does this with the same imports she already uses
(`delivery-service/testing`), no new tool, no real agent invocation, no real
concurrent infrastructure.

## Key UX flows

### Config keys, flags, defaults

| Setting | What it says | Default |
|---|---|---|
| `concurrency` | How many tasks may run at once against this project. | `1` |

| Flag | Environment variable | What it sets |
|---|---|---|
| `--concurrency <n>` | `DELIVERY_CONCURRENCY` | Overrides `concurrency` for one run |

Same precedence as every other setting: flag beats env var beats file beats
built-in default. `delivery validate` rejects a non-whole-number or a number
less than 1, in the same "one thing to fix" style as every other bad setting.

**Why default 1.** This is a right-vs-easy check, made explicitly rather than
picked by inertia: raising `concurrency` means more simultaneous API spend,
more disk (a worktree per slot), and a genuinely new code path (the run file,
the lock, the breaker) running for the first time in a project that has never
exercised it. A non-technical owner (Dana) should never be surprised by a
cost or a new failure mode she didn't ask for. Defaulting to 1 means: every
existing project's behaviour is unchanged on upgrade, byte-for-byte (MUST 1),
and going concurrent is a deliberate, informed choice — which is also why
`delivery init` offers a suggestion rather than a default (SHOULD, above).
This is judged the right choice over the easier "just pick a friendly-looking
default like 3", which would silently change cost and risk profile for every
user who already has a multi-task list today.

### Terminal output when several surfaces interleave

Plain language, unambiguous per line, `NO_COLOR`-safe (the tag is a bracketed
ordinal, never colour-coded), append-only (no redrawing progress bar or
spinner — a screen reader reads it top to bottom exactly as it reads today's
single-surface output):

```
[1/10] Starting run add-a-page-20260926T090000Z: add a page that shows who's on call today
[2/10] Starting run let-someone-swap-20260926T090001Z: let someone swap their on-call day with a teammate
[1/10] setting up
[2/10] setting up
[1/10] checking the starting point
[2/10] checking the starting point
[1/10] the agent is working
[3/10] Starting run send-a-reminder-20260926T090005Z: send a reminder the morning before someone's on-call day starts
[2/10] the agent is working
[1/10] checking the agent's work
[1/10] wrapping up
[1/10] Done: the change for "add a page that shows who's on call today" passed `npm test` and is committed on branch surface/add-a-page-20260926T090000Z.
```

Breaker narration uses the same closed-set pattern `cli/output.ts` already
uses for `STEP_PHRASES`/`RESUME_PHRASES` — one phrase per `BreakerState`,
so a new state does not compile without one:

```ts
export const BREAKER_PHRASES: Record<BreakerState, string> = {
  HEALTHY: "running normally",
  DEGRADED: "something in the shared environment looks broken",
  REPAIRING: "fixing the shared environment",
};
```

Repair's two exits carry variable data (attempt counts, which surfaces were
blocked), so — like `CLOSED`'s "Done: …" and resume's "Had to put something
right: …" — they are constructed sentences wrapping the phrase above, not
further table entries: `"Fixed. Resuming."` on repair success, `"Couldn't fix
it after N attempts. Stopping the run."` on exhaustion.

The full task text appears once per surface, at its start and its done/escalate
line — exactly where today's single-surface output already puts it — so a
reader can `grep '\[1/10\]'` and follow one thread deterministically. At
`concurrency: 1` no tag is printed at all: output is identical to today's,
unchanged (MUST 1).

Under `--json`, the existing per-step shape gains one field, and run-level
events (breaker state changes) interleave on the same stream, distinguished by
scope — still one JSON object per line, still only JSON on stdout, warnings
and the closing sentence still on stderr, exactly as today's invariant states:

```json
{"scope":"surface","surface":{"ordinal":1,"of":10,"id":"add-a-page-20260926T090000Z"},"state":"PROVISIONING","done":false,"at":"2026-09-26T09:00:00.000Z"}
{"scope":"run","state":"DEGRADED","affected":["add-a-page-20260926T090000Z"],"at":"2026-09-26T09:03:11.000Z"}
{"scope":"run","state":"HEALTHY","at":"2026-09-26T09:04:02.000Z"}
{"scope":"surface","surface":{"ordinal":1,"of":10,"id":"add-a-page-20260926T090000Z"},"state":"CLOSED","done":true,"at":"2026-09-26T09:05:41.000Z"}
```

### `delivery status`

Given a many-surface run id, leads with the run-level summary (the SHOULD
above), then a one-line-per-surface list, in the same "what you get depends on
how it ended" spirit the command already has:

```
Run add-a-page-20260926T090000Z, started 2026-09-26 09:00 UTC: 10 tasks, up to 3 at once
Environment: healthy
6 done, 1 needs your decision, 1 paused (waiting on a repair), 2 queued

  [1/10] add a page that shows who's on call today — done, committed on branch surface/add-a-page-20260926T090000Z
  [2/10] let someone swap their on-call day with a teammate — done, committed on branch surface/let-someone-swap-20260926T090001Z
  [3/10] send a reminder the morning before someone's on-call day starts — needs your decision (see below)
  …

[3/10] needs a decision from you:
  <the existing escalation packet rendering, unchanged>

To read one task in full: delivery status add-a-page-20260926T090000Z --surface 3
```

`--json` gives the same information as one document: run-level fields
(`run_id`, `concurrency`, breaker state, run budgets) plus a `surfaces` array,
each entry shaped exactly like today's single-run `--json` document — nesting
what exists rather than inventing a second schema.

`delivery status --all` stays a scannable history, one line per run: a
many-surface run summarises ("10 tasks: 8 done, 1 needs your decision, 1
queued") rather than exploding into ten lines — a live surface-by-surface view
is what `delivery status <run-id>` is for; `--all` remains an index, not a
dashboard (Item 11's job, not this phase's).

### Exit codes

Unchanged — the existing table:

| Exit code | Meaning |
|---|---|
| 0 | The run finished and the work was delivered |
| 1 | Something unexpected went wrong |
| 2 | Something about the setup or the command needs fixing |
| 3 | The agent could not start: Claude Code is missing or not signed in |
| 4 | The run stopped because it needs a decision from you |
| 5 | The run stopped before it could finish |

For a many-surface run, `delivery run`'s exit code reflects the *run's*
outcome: 0 only if every surface drained to `CLOSED`; 4 if any surface (or the
run itself, via breaker exhaustion) reached `ESCALATED`; 5 if the run stopped
before finishing (Ctrl-C, restart — resumable, per journey 2). No new code:
every one of these is already a case the table names for a single surface: a
run is a superset of outcomes, not a new kind of outcome.

## Accessibility

- **Plain language stays the default surface**, exactly as it is today: state
  names (`GATE_MAINTENANCE`, `DEGRADED`) never appear in the human-readable
  path; the breaker's plain narration and the escalation packet's plain
  summary do the translation, the same bar Item 11's DX note already sets for
  the escalation packet.
- **`NO_COLOR` / `--no-color`**: the per-surface tag is a bracketed ordinal,
  never a colour — colour, where available, is decoration, never the only way
  to tell two surfaces' lines apart.
- **Screen-reader-friendly**: strictly append-only, one event per line, no
  live-redrawing progress bar or multi-pane TUI for N surfaces (that shape is
  explicitly Item 11's, not this phase's) — a screen reader reads the output
  the same way it already reads today's single-surface output, sequentially.
- **`--json` stays machine-readable**: one JSON object per line on stdout,
  nothing else on stdout, exactly as today; every key present with `null`
  where a field doesn't apply, so a script never has to guess whether a key
  exists.

## Empty / loading / error states

- **Empty**: `concurrency > 1` with an empty task list behaves exactly as an
  empty list does today — nothing supervisor-specific to say.
- **Loading / in progress**: the initial line states the shape of the run
  ("10 tasks, up to 3 at once") once; a slot waiting on a full pool prints
  nothing by default (backpressure is silent, per the existing plan) but
  reports its wait state on request via `delivery status` (the "queued,
  waiting for a free slot" SHOULD above) — no polling noise in the default
  stream.
- **Error — a single surface's infra failure** (its worktree can't be
  created): unchanged from today, `ABORTED`, per-surface, no run-wide effect.
  If the *same* infra failure recurs across distinct surfaces, that is exactly
  the shape the breaker's existing shared-fate aggregation
  (`docs/multi-surface-control-flow.md`'s `gate_error` aggregation logic) is
  designed to catch — flagged for the architect to extend that aggregation to
  provisioning failures rather than this design re-specifying a second
  mechanism.
- **Error — the run itself** (breaker exhaustion): journey 3, above.
- **Error — a second `delivery run` against a repo already driving a live
  supervised run**: refused before anything starts, in the same shape and on
  the same exit code as today's `unfinishedRunFound` refusal
  (`src/cli/runs.ts:117`, `EXIT.configuration`, 2) — "something about this
  invocation needs fixing before it can start" is exactly what this is, not a
  new kind of stop. Message follows the same "name the run, name the escape
  hatch" pattern: *"Another run is already going here (started `<when>`, N
  tasks, up to `<concurrency>` at once: `<run-id>`). Run `delivery status
  <run-id>` to see it, or wait for it to finish."* No new exit code.

## Success metrics

1. A ten-task queue at `concurrency: 3` finishes in materially less wall-clock
   time than the same queue at `concurrency: 1`, with no orphaned worktree
   left behind after a clean run (the existing orphan-GC sweep,
   `docs/provisioning.md`, finds nothing to sweep).
2. A supervisor process killed mid-run and restarted resumes to the same
   outcome as an uninterrupted run: no duplicate merge, no double-provisioned
   worktree — provable via the mock's scripted crash-and-resume test (MUST 10).
3. Dana can state, from `delivery status` alone, which tasks are done, which
   need her, and whether anything is paused for a shared-environment reason —
   without being told an internal state name.
4. A breaker trip's cause, the surfaces it affected, and the repair's outcome
   are all readable from `delivery status <run-id> --json` after the fact,
   with no source reading — the DX note's literal bar.
5. Priya can write a test that scripts several surfaces with a chosen
   interleaving and assert on the resulting git state, using only the public
   testing API, without touching her own gate/closer code to make it
   concurrency-safe (given she has not written her own ref-mutating git calls
   — a documented boundary, not the harness's to enforce).
6. One surface escalating never stops or slows an unrelated running surface
   (journey 4) — the one property the task-local/shared-fate budget split
   exists to guarantee.
