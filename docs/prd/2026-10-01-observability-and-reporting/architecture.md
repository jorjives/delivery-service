# Architecture: Observability and Reporting (Roadmap Item 11)

Grounded in the real `src/` (every claim about existing code names its file),
`docs/prd/2026-10-01-observability-and-reporting/review-log.md`, the roadmap's Items 11
to 14, and `research.md` (citations marked `[research X]`, X being its heading letter or finding number). Style and altitude follow
`docs/prd/2026-09-26-multi-surface-supervisor/architecture.md`. This describes the
system as it will exist, not the order of building it.

## 0. The roadmap's premise, checked against the code

The roadmap says "the case file already serialises everything needed". Mostly true,
with four verified gaps. Each is closed by a small additive, optional schema change;
none touches control flow.

| Roadmap criterion | Already persisted | Gap (verified) |
|---|---|---|
| State of every active surface | Log tail is the authority: `deriveStateFromEntry`, `resumeAction` (`src/case-file.ts`); run log with `slot_fill`/`slot_free` and breaker entries (`src/schema.ts`, `src/breaker.ts`). `status` already folds these (`src/cli/supervised-view.ts`). | **No timestamps.** Neither `HistoryEntry` nor `RunEntry` has an `at`. Only `outcome.at` and the stamp in the run id exist. "Since when", "how long", and a time-ordered cross-surface feed cannot be derived. |
| Budget per surface and per run | `deriveBudgetsFromLog` gives `{used,max}` for five retry populations per surface; `repairsUsed` and `header.runBudgetMax.gateMaintenance` for the run. | These are retry caps, not spend. **No tokens, cost or duration is persisted**, though `invoke()` holds the SDK result message (`src/agent-invoke.ts`) whose type carries `total_cost_usd` and `duration_ms` (`sdk.d.ts`). Unrecorded now means unrecoverable later. |
| Triage decisions and rationales | `TriageEntry` has trigger, verdict, rationale, `artifactRef`; the ref holds the brief or packet (`src/surface.ts` `triage()`). No command shows them today `[research headline 2]`. | Persisted, not surfaced. The CLI wires `deterministicRouter` (`src/cli/drive.ts`), so every rationale is a fixed template string `[research headline 1]`. |
| Terminal outcomes with reasons | `CaseFileOutcome` (`kind`, `source`, `reason`, `at`, `packetRef`); `RunOutcome` (`drained`/`escalated`, with `cause: shared_environment \| usage_limit` already present on escalated). | A task's outcome has **no machine-readable cause**: `EscalationCause` is "never persisted" (`src/ports.ts`) and a dashboard, or the plain-language "what to do" text, would have to parse `reason` prose. |
| Escalation packets | `refs/escalation.json`, `EscalationPacket {decision, evidence, dead_ends, why_now, references}`; `packetOf` reads it. | None. Note: the CLI drives triage with `deterministicRouter` (`src/cli/drive.ts`), so every packet a CLI user sees is harness-built with a fixed plain-language `decision` sentence (`src/escalation-packet.ts`). |
| Repairs (SHOULD) | `repair_dispatch`/`repair_terminus` (rationale only), `tripsOf`; per-surface repairs are `dispatch`/`terminus` with `role: "gate-maintenance"`. | **What a repair changed is recorded nowhere** `[research A.6]`. Edits sit uncommitted in the working copy; on close they are swept into one "Accepted work" commit with the worker's (`ensureCommitted`, `git add -A`, `src/git-exec.ts`), unattributable; on escalate or abort the closer force-removes the working copy and they are lost. |

So the item is mostly a read model plus renderers, as the roadmap says, plus small
optional recording additions: timestamps and an outcome cause code (both MUST: the
"what to do" text and watch need them), session usage and repair changes (SHOULD).
Section 2.3 specifies them. None alters control flow; schema changes are verified
additive (section 8).

## 1. Platform strategy

This is a CLI and library; there is no web, mobile, desktop or server surface. "Platform"
means where reporting lives.

- **Library first.** A new `src/report/` module owns the read model and the document
  schema, exported from `src/index.ts`. The CLI is one consumer; Items 13 and 14 and
  adopters' dashboards are others. Today the derivation lives inside `src/cli/`, so a
  library user cannot reuse it; the read model lives in the library, and `src/cli/`
  renders it.
- **CLI.** Reporting extends `delivery status` rather than adding a parallel command
  family (agreed with the product-designer; see section 3). One new command,
  `delivery report`, exists for the durable artefact.
- **Files on disk.** Two derived artefacts, `.delivery/last-report.json` and
  `.delivery/last-report.txt`, written when a `delivery run` or `resume` ends. They are
  caches of a pure function of the record, never read back as truth.
- **A live view is a reader of the on-disk record, not a renderer over an in-process
  event stream.** Reasons: (1) the person who comes back, or the cron job of Item 13, is
  a different process from the one driving the run; an in-process bus cannot serve them.
  (2) The record is already crash-safe and append-only, so a live run, a finished run and
  a crashed run all report through one code path. (3) The in-process `RunReporter`
  (`src/cli/report.ts`) stays exactly as it is for the driving process's own console; it
  is not extended and not removed.
- **TTY versus piped.** The existing stance holds and is extended, not replaced: no
  cursor movement, spinners or box drawing, so logs and screen readers read output as
  printed (`plainReporter` doc comment). `status --watch` therefore appends change lines
  on a TTY and when piped alike; colour follows `useColour` (`--no-color`, `NO_COLOR`,
  isTTY). `--json` is never coloured. A full-screen redraw view is a COULD deferred
  behind the same read model (section 11), for the reason in the ledger.
- **Liveness is only partly knowable, and the document says so.** Whether a run is going
  is not in the record. The one existing signal is the repository lock (`repoLocked`,
  `src/cli/repo-lock.ts`), and `runQueue` takes it **only when concurrency is above 1**
  (`src/cli/queue.ts`: "One at a time takes no lock"); a single `--task` run
  (`startRun`) takes none. So at the default concurrency of 1 nothing outside the process
  can tell a running task from a killed one. The document carries `live: true | false |
  null`, where `true`/`false` mean "a run of several tasks at once does / does not hold
  the lock" and `null` means "not determinable"; it is never guessed from file ages (a
  guess would be non-deterministic). What the record does give, now that entries carry
  `at`, is `lastActivityAt`, which a report states as a fact ("last activity 14:02 UTC;
  nothing records whether it is still going") for the reader to judge. No heartbeat or new
  lock is added: that would put writes on the hot path or change the concurrency-1
  behaviour this item must not touch.
  What `--watch` does (the single-run and sequential-list owner is the common case):
  `true`, or `null` with no outcome: poll until an outcome is recorded or the user stops it;
  for `null` it says once that nothing can tell whether the run is still going, and never
  exits on a guess. `false` with no outcome (a run of several that was killed): say it
  stopped part way and how to carry it on (the existing `STOPPED_PART_WAY` sentence) and
  exit `ok`, since there is no outcome to mirror.

## 2. The read model

### 2.1 Shape: snapshot (I/O) then derive (pure)

```
loadSnapshot(repoPath, runId, { live })   // only I/O: case.json, log.jsonl, run.json, refs
   -> RecordSnapshot                      // plain data: RunFile?, CaseFile[], resolved refs
deriveReport(snapshot)                    // pure, total, deterministic
   -> ReportDocument                      // zod-defined, versioned
renderText(doc, { colour })               // pure; the phrase tables of src/cli/output.ts
eventsOf(snapshot)                        // pure; ordered ReportEvent[]
```

Reports are pure functions of the on-disk record, so the same record always yields
byte-identical output. The only non-record input is `live`, passed in, and `now` is never
read: elapsed times are differences between recorded `at` values, and a run still going
shows "last activity at T" rather than "idle for N minutes". The snapshot loader
resolves every ref the document needs (packet, triage artefacts, gate failure detail
count, repair changes) so that `deriveReport` does no I/O. Today `summariseOutcome` and
`packetOf` interleave reads and rendering (`src/cli/outcome.ts`); they are split.

Derivation reuses what exists and adds nothing parallel: `deriveStateFromEntry`,
`deriveBudgetsFromLog` (the log wins over the possibly stale `cursor`),
`setbackOf`, `tripsOf`/`repairsUsed`/`breakerOf`, `claimedBy`/`supervisedView`.

### 2.2 What the document contains

`ReportDocument` is a zod schema in `src/report/document.ts`, a superset of today's
`RunStatusDocument` and `SupervisedStatusDocument` (`src/cli/status-command.ts`): every
existing key keeps its name, type and meaning, so nothing built on `status --json` today
breaks. New keys are added; all keys are always present, with `null` or `[]` where they do
not apply (the existing rule).

- `schema: "delivery.report/1"`, `kind: "task" | "run" | "list"`, `live`.
  - `task`: one run of one task (what `status <id>` reads today).
  - `run`: one supervised run of several tasks at once (a `run.json` exists).
  - `list`: the project's task list as the owner experiences it. The default
    concurrency is 1, where a sequential list has **no run record of its own** and stops
    at the first task that does not close. `list` is therefore derived from the project's
    configured task list plus the latest record per task (`findQueueRun`, content match,
    `src/cli/queue.ts`), exactly as `status` counts queued tasks today. No new run object
    is invented and the concurrency-1 behaviour is untouched. The snapshot for a list has
    one more input than for a run, the resolved task list (`queueTasks`), which `status`
    already reads to annotate; a config that will not load yields a report with no list
    annotation, never a refusal (the existing rule).
- `counts`: counts per standing, the facts the headline sentence is built from (section 4). Standings
  are the existing `closed, escalated, aborted, paused, unfinished, queued`, plus
  `not_started` for a task a stopped sequential list or a finished run left alone behind a
  task that did not close. (`queued` stays what it is: waiting for a slot in a live run.)
  The enum is open under the stability promise.
- `run` (for `kind: run`): id, `startedAt`, task count, concurrency, `breaker`, `outcome`,
  `finishedAt`, `reason`, `cause`, `lastActivityAt`, run-level repair budget.
- `surfaces[]` (one per task): the existing fields plus
  - `states[]`: ordered `{state, at|null}` visits derived from log entries (the state
    after each entry via `deriveStateFromEntry`).
  - `budgets`: five `{population, used, max}` rows. The run's roll-up sums `used` per
    population and adds the run-level repair cap (`repairsUsed`/`runBudgetMax`).
  - `attempts`: worker dispatches, from `dispatch` entries.
  - `usage`: `{costUsd, durationMs}` summed over recorded sessions, or `null`; plus
    `usageRecorded: n of m sessions`, so a partial figure is never presented as whole.
  - `decisions[]`: one per `TriageEntry`: `afterAttempt`, `trigger`, `verdict`,
    `rationale` (verbatim), plus the brief or packet resolved from `artifactRef`.
  - `repairs[]`: section 5.
  - `escalation`: the verbatim `EscalationPacket` or `null` (for Marcus), plus `plain`
    (for Dana): `{ group, audience, sentence, agentSaid, next }`, section 4.
- `trips[]` (existing) now carries each attempt's `changes`.

### 2.3 What is newly recorded (all additive, all optional)

Old records stay valid because every addition is `.optional()`, which is the repo's
standing convention (`closerRef`, `roleOverrides`, `notRun`, `packetRef`, `role`
all arrived this way). A reader renders an absent value as "not recorded", never as zero.

```ts
// src/schema.ts
const At = z.string().datetime();                       // ISO 8601, UTC

// every HistoryEntry variant and every RunEntry variant gains:
at: At.optional()

export const SessionUsage = z.object({
  costUsd: z.number().nonnegative().optional(),         // SDK total_cost_usd, an estimate
  durationMs: z.number().int().nonnegative().optional() // SDK duration_ms
});
// TerminusEntry, the run log's repair_terminus, and TriageEntry gain:  usage: SessionUsage.optional()
// TerminusEntry gains:  limit: UsageLimit.optional()   // set when a usage limit stopped the session

export const OutcomeCause = z.object({
  kind: z.enum(["authority", "repair_gave_up", "session_not_run", "budget", "triage_failure",
                "triage_escalated", "triage_abort", "provisioning"]),
  role: z.enum(["worker", "gate-maintenance"]).optional(),                      // authority, session_not_run
  population: z.enum(["correction","gateError","gateMaintenance","terminus","close"]).optional(), // budget
});
// CaseFileOutcome gains:  cause: OutcomeCause.optional()

export const RepairChanges = z.object({                // the artefact behind changesRef, see section 5
  files: z.array(z.object({ path: z.string(), status: z.enum(["added","modified","deleted","renamed"]),
                            added: z.number().int(), removed: z.number().int(),
                            patch: z.string().optional() })),  // absent: binary, or over the cap
  truncated: z.boolean(),
});
// TerminusEntry (role gate-maintenance) and the run log's repair_terminus gain:  changesRef: z.string().optional()
```

**Which sites set `cause`.** `EscalationCause` (`src/ports.ts`) is "never persisted" and
exists only on an escalate verdict and at the surface's own escalation sites; abort sites
hold no such value. So the mapping is explicit, site by site (`src/surface.ts`), and
`escalate()` and `abort()` each take the `OutcomeCause` as a parameter:

| Site | `cause` written |
|---|---|
| `escalateFromTail`, authority terminus; the terminus-recording edge when the entry routes to ESCALATED | `authority` + `role` |
| `escalateFromTail`, repair session escalate | `repair_gave_up` |
| `escalateIfNotRun` | `session_not_run` + `role` |
| the two budget-at-cap sites in `surface.ts` (`dispatchOwnRepair`, the terminus-retry edge) | `budget` + `population` (already in hand: it is the `EscalationCause` they build the packet from) |
| `triage()` escalate verdict with `verdict.cause` set (the deterministic router sets it, including its at-cap branch) | that cause, mapped to the kinds above |
| `triage()` escalate verdict with no `cause` and an agent-written packet | `triage_escalated` |
| `triage()` escalate verdict where the packet fell back to `triage_failure` | `triage_failure` |
| `triage()` abort verdict | `triage_abort` |
| provisioning abort | `provisioning` |
| `closed()` | none (a closed run has no cause) |
| shared environment, usage limit at run level | **not a new code**: `RunOutcome.escalated.cause` (`shared_environment \| usage_limit`) is already persisted and the report passes it through; the "what to do" table is keyed on it |
| usage limit at task level | **not a cause kind**. Today the limit is returned on the in-memory terminus (`Incomplete.limit`) but is not persisted and `surface.ts` never reads it, so the task burns its session-retry budget and ends as `budget`+`terminus`. Recording the fact (`TerminusEntry.limit`, above) lets the report say "stopped because a usage limit was reached" without a parallel cause code |
| `abort()` | takes only `source` and `reason` strings today; it gains the `cause` parameter. Its two callers are provisioning and the triage abort verdict, which is unreachable in the CLI (`deterministicRouter` never aborts) and exists for library users of agent triage |

The resume path (`escalateFromTail` reading a triage tail after a crash between the ref
and the outcome) cannot recompute a `cause` that was never persisted, so `triage()` also
writes the cause into its round ref beside `trigger`, `rationale` and `artifact`, ahead
of the entry exactly as the packet is today; the resume path reads it back. Old
records, and any site not in the table, leave `cause` absent: the report then says only
what `reason` and the packet say, groups the task as "stopped" (section 4), and
gives no advice it cannot back.

How each recording is written, and why this shape:

- **`at`** is stamped inside `appendEntry` and `appendRunEntry` (`src/case-file.ts`,
  `src/run-file.ts`). These are the only two callers of `appendLine` for a log (checked
  by grep), so every entry passes through them with no call-site changes. The stamp is
  `new Date().toISOString()`, as `escalate()` stamps `outcome.at` today. `at` is not read
  by any decision, so replay and resume are unaffected. **Existing exact-shape tests:**
  about 45 `history` assertions across seven suites (`case-file`, `run-file`, `run-gate`,
  `surface`, `surface-close`, `supervisor`, `cli/run-command`) compare entries with
  `toEqual`. The property is that such assertions compare entries modulo `at`, through one
  shared test helper. Tests that need times use
  `vi.useFakeTimers({ toFake: ["Date"] })`, which fixes the clock without stalling the
  real I/O the scripted stack performs.
- **`usage`** is filled in `invoke()` from the SDK result message and carried up on the
  terminus the `AgentPort` returns. `costUsd` is `total_cost_usd`, which the SDK documents
  as covering the same query-pipeline calls as `modelUsage` (main loop, subagents,
  sidechains), cumulative per `query()` call, so no summing across results; the `usage`
  token field is main-loop-only and is **not** used (`sdk.d.ts` `SDKResultMessage`).
  `durationMs` is `duration_ms`. Crash or startup-error results may be zeroed; the SDK
  calls the figure an estimate, and the report labels it so. The mock emits constant zeros
  and scripts cannot set them today, so non-zero usage is tested at the `AgentPort` level
  (the fake port's handlers may return `usage`), and the capture from a real result message
  is covered by giving `MockScript` an optional scriptable `usage` on a reply (a small
  additive change to the vendored mock, in the SHOULD tier with the usage capture itself).
  Old records and sessions without it read "not recorded".
- **`cause`** is a recorded fact about *why*, not a decision; none changes
  `deriveStateFromEntry`, `resumeAction` or `deriveBudgetsFromLog`.

**What stays unrecorded, deliberately:** token counts per model, prompts, transcripts.
`references` already carries session keys for pulling a transcript.

### 2.4 Reading while a live supervisor appends

The record's write discipline already makes a concurrent reader safe; the design relies
on it and adds no lock (readers must never take the repo lock, or `status` would refuse
during a run).

- JSON files are replaced whole by rename (`atomicWriteJson`), so `case.json` and
  `run.json` are never half-read.
- Journals are append-only, one line per `datasync`; a reader can catch a final line
  mid-append. `parseLines` already drops an unparseable *final* line and throws
  `MalformedLine` only for an interior one, so a torn tail yields the state one entry
  earlier, never an error. A mid-journal bad line is real damage and is reported by name
  as today (`CorruptCaseFile`).
- Cross-file consistency: `outcome` is written last, after the final log entry. The
  loader reads `case.json` first, then the log: if it saw an outcome, the log is
  complete; if it did not, the log may be newer than the cursor, which is harmless
  because derivation uses the log, not the cursor (the cursor supplies only `max` and
  `worktreeRef`, which are immutable in practice). The supervised view reads `run.json`,
  the run log, then each task's record in that order for the same reason. A snapshot may
  be a moment stale; it is never torn or self-contradictory.
- **Cost of large runs.** A run is tens to low thousands of lines. `status --all` already
  reads every record per call. Derivation is O(entries). `--watch` re-reads only when a
  source file's size or mtime changed, and emits only entries past a per-source cursor
  (section 3). No index, cache or database is justified; `last-report.json` is a convenience
  artefact, not a performance cache. If a project ever holds thousands of runs, `--all`
  can paginate on the id stamp; not designed now.

## 3. Interfaces

### 3.1 Commands

Agreed with the product-designer (their `product-design.md` is the authority on wording).

| Command | Purpose |
|---|---|
| `delivery status [run-id]` | Existing. Same default (most recently touched). Text output gains: budgets, decisions (one line per triage round), repairs (one line each), and a "what to do" line per escalation. |
| `delivery status --all` | Existing. Each line gains the headline counts. |
| `delivery status --watch [--interval <s>]` | Poll the record; append one line per new entry. Default interval 2 s. Exits with the run's own exit code when an outcome is recorded (a script waiting on a run needs it); the not-live and not-determinable cases are in section 1. |
| `delivery status --decisions`, `--repairs` | Expand triage rounds in full (brief or packet text) and repair patches. Default text shows summary lines only (section 6). |
| `delivery report [run-id] [--write]` | With no id: the report of the **task list** (`kind: list`), which is what an owner on the default concurrency 1 needs; with an id: that task or supervised run. Prints; with `--write`, also (re)writes the artefacts. |
| `delivery report --schema` | Print the JSON Schema for `delivery.report/1` and `delivery.event/1`, generated from the zod schemas with `z.toJSONSchema` (zod ^4, already a dependency; the API is present in the installed version). |
| `--json` (global, existing) | One document from `status`/`report`; NDJSON events from `status --watch`. |

Report artefacts: at the end of every `delivery run` and `delivery resume` the run process
writes `.delivery/last-report.json` and `.delivery/last-report.txt` for the subject it
just ran (the list, or the single task), overwriting the previous pair. One fixed path
means a scheduler (Item 13) or a person never has to find "the newest run folder", and
there is no per-run copy to keep in step. `report --write [run-id]` writes the same pair
for any other subject. They sit in `.delivery/`, which is self-ignoring.

**Exit codes, one rule.** `status` and `report` exit `ok` whenever the report could be
made, whatever it says: the existing contract ("the exit code says whether the report could
be made, never what the run itself decided", `statusCommand`), which a scheduler reading
`last-report.json` relies on to tell a broken reader from a run that needs a person. The
decision is in the document (`counts`, `plain.audience`). The two exceptions are `run` and
`resume`, which keep today's codes (4 for a task needing a person), and `status --watch`,
which mirrors the code the run itself ended with. A damaged record is reported by name in
the report with the other tasks still reported, and the read exits `ok` (the report is made,
marked incomplete), as the product-designer's error-state table says.

### 3.2 Machine-readable shapes and the stability promise

Two documents, both zod-defined in `src/report/`, both carrying a `schema` field:

- **`delivery.report/1`** (section 2.2): a point-in-time document.
- **`delivery.event/1`**: one NDJSON line per recorded entry, produced by `eventsOf`
  and emitted by `--watch --json`. Shape:
  `{schema, run, surface|null, seq, at|null, type, ...payload}` where `type` is one of
  `stream_started, run_started, surface_state, budget_spent, triage_decision,
  repair_started, repair_finished, breaker_changed, surface_outcome, run_outcome,
  stream_ended`. Following the versioned-NDJSON prior art `[research C.4]` (Terraform's
  leading `version` message and Cargo's `build-finished` end marker), the first line is
  `stream_started` (carrying the schema version) and the last is `stream_ended` with the
  outcome, so a reader knows when to stop without watching the process. `seq` is the
  entry's position in its source journal, so a consumer can de-duplicate and resume
  (`--since <seq>` is not built until needed). Events are 1:1 with log entries, not diffs
  of documents, so replaying a finished run emits the same events as watching it live.
  Cross-surface order is by `at` where present, falling back to journal order for old
  records; within one surface order is always exact.

Promise (extenders build on this, so it is stated and tested):
1. Within a major (`/1`), keys are never removed, renamed or re-typed, and enum values are
   never removed. New keys and new enum values may appear; consumers must ignore unknown
   keys and treat unknown enum values as "other". The JSON Schema marks enums open.
2. A breaking change is a new major (`delivery.report/2`), served only behind an explicit
   opt-in for one minor release.
3. The existing `status --json` shapes are grandfathered into `/1` unchanged.
4. The in-process step records of `run --json` (`StepRecord`, `SurfaceStepRecord`,
   `RunEventRecord` in `src/cli/report.ts`) are shipped and unversioned
   `[research headline 6]`; they stay exactly as they are, as the stream *of the driving
   process*. The honest consequence, stated in the docs: only `delivery.report/1` and
   `delivery.event/1` carry the promise; the older stream does not.
5. Strings meant for people (`summary`, `plain`) are not part of the promise; the keys
   beside them are. Consumers must not parse prose.

A golden-file test per document pins the promise: it fails if a key disappears.

### 3.3 Library exports (`src/index.ts`)

`loadSnapshot`, `deriveReport`, `eventsOf`, `renderText`, the zod schemas and inferred
types (`ReportDocument`, `ReportEvent`), `reportJsonSchema`. Testing helpers go through
`./testing`, with the same stability promise as today's entry point.

### 3.4 Extension point

Reporting extension is by **composition over documents**, not a plugin API. Anything that
wants to push a report somewhere (mail, chat, a dashboard) consumes `ReportDocument` or
the event stream. There is deliberately no `Reporter` plugin interface: the existing
gate and closer plugin loading (`src/plugin-loader.ts`) exists because those *run code
inside the delivery*; a report consumer runs outside it. If a custom text renderer is
wanted, `renderText` is a pure exported function.

## 4. The plain-language question

**Decision: Dana's summary is a deterministic view of data that already exists, built
from phrase tables, as `src/cli/output.ts` does today. Nothing is generated at triage
time and no new prose is stored.**

Why this is the right choice and not only the easy one:

- *Determinism and cost.* An agent-generated summary is a second model call per
  escalation, non-deterministic, testable with the scripted mock stack only by asserting on
  whatever the script returns, and able to disagree with the evidence beside it. The
  deterministic view costs nothing and is byte-identical across reads.
- *There is no agent at triage time to ask.* The CLI wires `deterministicRouter`
  (`src/cli/drive.ts`), so every rationale is a template and every packet is harness-built;
  agent-written packets exist only for library users of `createAgentTriage`
  `[research headline 1]`. "Generate at triage time" would mean adding an agent call to a
  path that has none.
- *The one thing a table cannot do* is rewrite a worker's own words (the roadmap's "the
  agent wasn't sure whether to delete the old homepage"). Those words are agent-written
  already and are **quoted**, labelled as the agent's, never paraphrased: not rewriting
  evidence is the guarantee the current design makes (`summariseOutcome`).

### 4.1 Two audiences, two renderings of the same record

Marcus (on-call engineer) reads the verbatim `EscalationPacket` as today: `decision`,
`evidence`, `dead_ends`, `why_now`, `references`. Its wording is harness vocabulary
("No correction budget remains (2/3 used)", "gate repair session", "authority"), which is
right for him and wrong for Dana, who "would not know what a 'budget' means"
(`docs/personas.md`). So `plain` is **its own total phrase table**, never a quotation of the
packet's `decision`:

```
plain = { group, audience, sentence, agentSaid, next }
```

- `group`, from `outcome.cause` and the log (`attempts` = worker `dispatch` count; the last
  setback via `setbackOf`):

  | group | when | audience |
  |---|---|---|
  | `needs_your_decision` | `authority`; `triage_escalated`; `session_not_run` (agent not signed in or runnable: a credential only the owner can supply) | owner |
  | `failed_after_attempts` | `budget` on `correction` or `terminus` (the agent tried and the check still failed, or kept stopping): "failed after N attempts" | owner (reword or drop the task) |
  | `needs_an_engineer` | `budget` on `gateError`, `gateMaintenance` or `close`; `repair_gave_up`; `triage_failure`; `provisioning` (the check could not run, or the work could not be landed) | engineer |
  | `abandoned` | `triage_abort` | owner |
  | `stopped` | `cause` absent (old record) or any aborted task with no cause | unknown: says only the verbatim `reason` and gives no advice |

  **Mapping to the report's visible sections** (the product-designer's Done / Needs you /
  Stopped / Not started): Done = `closed`; Needs you = `audience: owner` (the groups
  `needs_your_decision`, `failed_after_attempts`, `abandoned`); Stopped = `audience: engineer`
  and `stopped`; Not started = standing `not_started`. `group` is the machine key and the
  sentence's selector; the section is a rendering of `audience` and standing. Both are in
  the document, so a reader that wants the finer split has it.

  `audience` answers Dana's primary goal, "does this need me or the engineers", from a
  table and not from prose. A worker `terminus` that ended on a recorded usage limit
  (`TerminusEntry.limit`, section 2.3) is phrased as "stopped because your usage limit was
  reached" under whichever group the budget put it in.
- `sentence`: a fixed sentence per group and, within it, per `trigger` from `setbackOf`
  ("the check you set up still doesn't pass", "the work passed but could not be added to
  your branch"). Its vocabulary excludes the harness's own terms; a test (section 10)
  fails if any rendered `plain` text contains "budget", "gate", "triage", "authority",
  "surface", "terminus", "repair session" or "escalat". Exact wording is the
  product-designer's; this design fixes the mechanism, the keys and the constraint.
- `agentSaid`: the agent's own last rationale, quoted and labelled. This is where the
  roadmap's parenthetical comes from, and the only place agent words reach Dana.
- `next`: the route that actually works, keyed on `group` and on whether the run is
  finished. An escalated or aborted task is a **finished** run, and `delivery resume`
  refuses a finished run (`alreadyFinished`). Re-running is **not** enough either: for a
  task still on the project's list and unchanged, `delivery run` finds its existing run
  (`findQueueRun`, content match on `taskDef`, `src/cli/queue.ts`) and retells the old
  outcome, and a sequential list stops there again. A fresh run starts only when the
  entry's `taskDef` no longer matches any earlier run, that is, when the owner **amends
  the task wording or removes the entry** (an ad hoc `delivery run --task "..."` also
  starts a new run). The decision lives in the task list, so an owner who decides "yes,
  grant it" does so by changing the task text. So `next` for a finished task is "amend the
  task or remove it from your list, then `delivery run`", never "just run it again" and
  never `resume`. `delivery resume <id>` is named only for an unfinished or crashed run
  (`nextStep`). For a stopped run of several tasks, `delivery run` carries the held tasks
  on (they have no outcome of their own).
- *What `plain` never promises about the work.* The "where your work is" line is keyed
  on the run's pinned closer and is per task: the built-in closers keep the branch, clear
  the scratch working copy away and change nothing on the base branch for a stopped task,
  but a custom closer may do anything, and other tasks of the same list may well have
  merged. `plain` therefore states only what the pinned closer type guarantees, never "your
  work was kept" or "nothing changed on main" in general, and the working copy is normally
  already cleared (the existing `whereToLook` checks the disk rather than assuming).

The roadmap's example is reproduced from the record, not authored: "3 of 5 tasks
completed and merged" is `closed` count plus the landing word from `closerRef`
(merged into base / committed on a branch / pull request open, the existing `landing`
table in `outcome.ts`); "1 needs your decision (the agent wasn't sure whether to delete
the old homepage)" is the `needs_your_decision` count with `agentSaid` quoted;
"1 failed after 3 attempts (the check still doesn't pass)" is `failed_after_attempts`
with `attempts` from the log and the phrase from the last setback; a task never reached
is "not started". Where it differs from the roadmap's wording ("the tests" versus "the
check"), it is because the check may not be tests; `gateRef` names the command where it
is a command.

**Packets written before this phase:** every packet since Item 5 has `decision`; a case
file with no `packetRef` predates packets. Both keep rendering exactly as today for
Marcus; Dana's `plain` for them falls to `stopped` with the verbatim `reason` and no advice.
No migration and no rewrite of old records.

**Upgrade path, not built:** an optional `plainSummary` on `EscalationPacket`, written by
an agent triage when one is configured, preferred by the renderer when present. Optional
fields are backward compatible, which is why it need not be decided now.

## 5. Repair visibility (SHOULD)

Seeded by the gate-maintenance idea, visibility part only. Approval gates and refusing a
repair that drops assertions are control-flow changes and are out of scope.

Today a repair's edits are lost or unattributable (section 0). The design records them:

- After a gate-maintenance session ends, and **before** its terminus entry is appended
  (the same ref-before-entry ordering `triage()` uses, so a crash leaves at most an
  orphan ref that the re-run overwrites), the harness captures the working copy's change
  against its commit. A bare `git diff` omits untracked files, and a repair that adds a
  new check file is exactly the case to surface, so the capture covers both: tracked
  changes from `git diff --numstat` and `git diff --no-color` against `HEAD`, and added
  files from `git ls-files --others --exclude-standard`, each added file rendered as a
  new-file patch (`git diff --no-index -- /dev/null <path>`, whose exit status 1 is the
  normal "differs" result: the helper accepts 0 and 1 and fails on anything else). Everything lands in one `RepairChanges` ref
  (`repair-<sessionKey>-changes`), named by `changesRef` on the terminus (per-surface
  repair) or `repair_terminus` (run-level repair, whose session runs in the tripping task's
  copy, `dispatchRepair`).
- One helper, called from both repair sites, using `src/git-exec.ts` (`git`, which already
  serialises through `takeTurn`). Read-only git; it never stages anything, so it cannot
  change what the closer's `git add -A` later commits.
- Per-file patches are capped (256 KiB in total); a file past the cap or binary keeps its
  path, status and counts and omits `patch`. `truncated` says so. The cap is a recording
  constant, not configuration.
- Display: default text shows one line per repair ("repair 1 changed 2 files: +14 -3:
  shared/helper.json, check.mjs"); `--repairs` shows the patches. JSON carries `files`
  always and each `patch` as recorded.
- A deterministic highlight only: a changed path equal to a custom gate's `modulePath`, or
  to the command gate's first token where that is a path in the working copy, is tagged
  `touchesCheck: true`. This is a fact about paths, not a verdict about weakening: the
  words say "this repair changed a file the check runs" and nothing about safety.
- Old records and mock sessions: `changesRef` absent -> "what this repair changed was not
  recorded". A repair that changed nothing records an empty list, which reads as "changed
  no files".
- Custom closers may do anything with the working copy; the capture happens before the
  closer runs, so it is independent of which closer a project uses.

## 6. Security and compliance

Auth and token storage: **not applicable.** Reporting reads local files and calls no
service; credentials are the agent runtime's concern (`src/cli/agent-session.ts`).

What a report can leak is what the record already holds, which is the point to state
plainly: gate output (`NewFailure.detail`), agent rationales, filesystem paths
(`dir`, worktree, repo), session keys, and now repair patches. Any of these can contain
a secret an agent or a test printed.

- **Redaction stance: none at record time, deliberate.** Redacting evidence would change
  what the harness's own verbatim-evidence guarantee means and could hide the very
  thing an on-call engineer needs. Redaction by pattern is also unreliable and
  non-deterministic as a promise. Instead: reports add nothing the record does not
  already hold; the new repair patch is the only newly *recorded* free text, and it is
  bounded and held to the same trust level as the case file.
- **Default output is the summary, detail is opt-in:** patches and full triage artefacts
  appear only with `--repairs`/`--decisions` (text) and as recorded fields in JSON.
  A pasted default report does not carry diffs.
- **Report artefacts' permissions:** `.delivery/last-report.json` and `.delivery/last-report.txt`
  sit inside `.delivery/`, which is self-ignoring (`prepareDeliveryDir` writes
  `.gitignore: *`), so a report can never be committed by accident. Created with mode
  `0600` via `atomicWriteJson`-style write-then-rename, so a reader never sees a partial
  file. The record's own files keep their existing modes. Documentation says: a report
  is as sensitive as the case file; do not mail `last-report.json` off-host unreviewed.
  `last-report.txt` omits patches and full triage artefacts for that reason, while
  `last-report.json` carries them as recorded.
- No network egress anywhere in this item (see telemetry, section 9).
- **Untrusted content in the terminal:** evidence and rationales are agent- and
  gate-produced text printed to a terminal. The **text renderer only** strips ESC and the
  other C0/C1 control characters from quoted fields, so a malicious or buggy gate cannot
  rewrite the owner's screen. Newline and tab survive, so multi-line verbatim evidence
  (the thing Marcus needs, quoted by `packetLines`) is unchanged. JSON output and the
  recorded data are never altered: JSON escaping already neutralises control characters,
  and the record stays verbatim.

## 7. Caching, offline, state management, concurrency

- **Offline:** fully; everything is local files.
- **State:** none new. The read model is stateless; `--watch` holds one in-memory cursor
  (entries emitted per source) and exits with the process. No daemon, no store.
- **Caching:** `last-report.json`/`last-report.txt` are caches of a pure function and are never
  trusted: `status` always recomputes. They exist so that a person or a scheduler can
  find the result of an unattended run without running a command.
- **Concurrency:** readers take no lock and write nothing except the `report` artefacts
  (atomic rename; two writers produce the same bytes from the same record). The run
  process writes the artefacts after `setOutcome`/`setRunOutcome`; a crash before that
  leaves none, and `delivery report --write` or `status` still answers.

## 8. Non-functional requirements

- **Determinism:** same record and `live` value -> byte-identical text and JSON. Tested.
- **Accuracy:** a report never states a figure it cannot derive; absent data reads "not
  recorded" and partial sums say how many sessions they cover.
- **Read cost:** O(entries); `status` on a 20-task run reads ~21 small files, as `status`
  already does. No performance claim beyond "no worse than today's `status`".
- **Compatibility, forward (the guarantee):** a new build reads every old record: all
  additions are optional, and old records render "not recorded". Existing `status`,
  `status --all`, `status --json` keys and exit codes are unchanged; new text lines are
  additive and golden-tested.
- **Compatibility, backward (best effort, stated honestly):** an older build reading a
  newer record still works for log entries, because zod's `z.object` strips unknown
  keys and log lines are never rewritten (the `.strict()` schemas are only the role
  overrides, not entries). It is not lossless: `case.json` and `run.json` are re-parsed
  and rewritten whole (`updateCursor`, `rebuild`), so an older build that updates a record
  drops document-level additions such as `outcome.cause`. And an unknown entry kind (`t`)
  would be dropped if it were the final line and rejected as corruption if interior.
  **Therefore this item adds no new entry kind, only optional fields on existing ones**,
  and stamps `cause` on the outcome only when the outcome is written, after which nothing
  rewrites it in the normal run.
- **Accessibility:** plain-language and no-cursor-movement stance preserved; tone is
  never colour alone (the `[n/M]` tags and sentence words carry it).
- **Failure:** a report that cannot be built because of a damaged record names the file
  (existing `CorruptCaseFile`/`CorruptRunFile`), as `status` does.

## 9. Telemetry and export formats

**Decision: no OpenTelemetry (or other exporter) in this item. The NDJSON event stream
and `ReportDocument` are the export contract.** Grounded in `[research headline 7, C.4]`.

Reasoning:
- OTel needs a collector/endpoint and a long-lived process to batch and flush. The harness
  is a short-lived CLI with no daemon (a stated non-goal), and the primary readers read
  *after* the process has gone. Spans over an already-complete, crash-recoverable record
  would be a second, lossy copy of it.
- The roadmap asks for "structured output ... so adopters can build their own dashboards
  or integrate with existing observability tooling": a stable NDJSON stream satisfies
  that and is what generic shippers (Vector, Fluent Bit, `jq`) ingest directly.
- Claude Code, the child the harness spawns, emits OpenTelemetry metrics, events and
  beta traces itself, and the harness already passes the owner's environment through
  (`agentSession` returns the full env; `buildSessionOptions` passes `env: session.env`),
  so `OTEL_*` set in the owner's shell reaches it today `[research headline 7]`. That is
  the model-usage telemetry; duplicating it at the harness layer is a commodity re-solved.
  End-to-end export working is the researcher's ASSUMED, not run here.
- The vocabulary that is the harness's own (surface, triage, budget, outcome) has no
  semantic convention: the GenAI/agent conventions are all at "Development" status, so
  spans would be custom attributes on generic spans against a moving standard
  `[research C.4]`.
- OTLP from a short-lived CLI needs a flush-before-exit window and adds three packages
  to a five-dependency tool `[research C.4, C.5]`.
- The mapping is straightforward if wanted later: each `delivery.event/1` line is one
  span/log record; an optional exporter would be a *consumer* of the stream
  (`delivery status --watch --json | otel-shipper`), outside this package. Item 14's
  webhooks are the first place a push model may justify it; it is revisited there.

Harness self-telemetry (usage analytics about the tool's own use): none, no egress.

## 10. Testing

Every report is tested deterministically with the existing scripted-run mock stack; no
real agent, network or clock.

- **Fixtures are real records, produced by real runs.** `runSurfaceAgainstMock`
  (`src/scripted-surface-run.ts`) and `runSupervisorAgainstMock`
  (`src/scripted-supervisor-run.ts`) drive the production driver, router, gate and closer
  against a `MockScript` and leave a genuine case file and run file. Scenarios cover:
  closed; escalated by authority; escalated by budget exhaustion per population; abort
  by provisioning; gate-error trip with a repair that succeeds; trip with repair given up;
  usage-limit stop; several tasks at once with a mixed standing.
- **Fake clock** (`vi.useFakeTimers({ toFake: ["Date"] })`) makes `at` deterministic.
- **Snapshot of text and JSON** per scenario (golden files). `deriveReport` is also
  tested directly on hand-built `RecordSnapshot` values (pure, no disk).
- **Crash and live-read cases:** a record truncated mid-final-line renders as the entry
  before; a record with `outcome` absent renders `unfinished` and the `nextStep`;
  `case.json` newer than the log and the reverse (the cross-file ordering of 2.4).
- **Old-record compatibility:** committed fixtures from before this item (no `at`, no
  `usage`, no `cause`, no `changesRef`, no `packetRef`) must read, and render "not
  recorded", never `0`, `NaN` or a throw.
- **Event stream:** property test: `eventsOf(record)` equals the concatenation of events
  emitted by `--watch` polling the same record grown entry by entry (the replay-equals-live
  guarantee).
- **Promise tests:** schema goldens (3.2); unknown-key tolerance via parsing a document
  with an extra key; round-trip `ReportDocument.parse(JSON.parse(output))` on every
  scenario.
- **Control-flow non-regression:** the existing `surface`, `supervisor` and `status`
  suites hold with their entry assertions compared modulo `at` (section 2.3); the schema additions are asserted not to alter
  `deriveStateFromEntry`/`deriveBudgetsFromLog` results on any existing fixture.
- **Plain-language vocabulary:** every `plain` sentence, for every `cause.kind`, group and
  closer type, is asserted free of the harness's own terms (section 4.1), and the phrase
  tables are total over their enums by type-check.
- **List report:** a scripted sequential list that stops at its second task reports
  `kind: list`, with the first `closed`, the second escalated and the rest `not_started`,
  and no run file exists.
- **Repair capture:** a scripted gate-maintenance session that edits a tracked file,
  one that adds an untracked file, and one that does both prove each is recorded; the cap
  truncates; an empty repair records an empty list.
- **Usage:** hand-built `AgentPort` results with non-zero `usage` prove the sums and the
  "n of m sessions" partial label; the capture from a result message is proved with the
  scriptable-usage mock.
- **Terminal safety:** ESC and control characters in evidence are stripped in text,
  newline and tab survive, and JSON keeps them (escaped).

Written test-first per the project rule: each report section starts with a failing golden.

## 11. Extensibility: what Items 12 to 14 hang off

- **Item 12 (task packs):** the document is keyed by run and task; a pack's fix-phase
  progress is more `surface_state` events and surfaces, with no new report type
  (the roadmap's "same plain-language approach"). A pack tags tasks via `taskDef`, which
  the document already echoes.
- **Item 13 (local scheduling):** a scheduled run is a normal run, so it produces the same
  `last-report.json`/`last-report.txt` by construction. A missed run is a *scheduler* fact, not a
  run fact; it is not forced into this schema. The scheduler consumes `ReportDocument`
  and `cause` codes (the reason `OutcomeCause` exists) to decide on notification, and
  mails `last-report.txt`.
- **Item 14 (triggers, webhooks):** push delivery consumes the NDJSON stream or the
  document; `schema` versions let a webhook receiver pin `/1`. If OTel export is ever
  wanted, it lands here as a consumer.
- **Cross-run trends (COULD):** a pure function over several `ReportDocument`s from
  `allRuns`; no new storage. Deferred.
- **Full-screen live view (COULD):** a second renderer over `deriveReport` plus polling,
  with the TTY decision of section 1; deferred behind a library, not built into the
  read model.
- **`plainSummary`**: section 4 upgrade path.

## Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Derivation of states, budgets, trips, standings from the record | **Reuse-estate**: `deriveStateFromEntry`, `deriveBudgetsFromLog`, `tripsOf`, `supervisedView` | A second fold for reporting | A second fold could disagree with resume. The reporting fold *is* the resume fold; the only new code lifts the I/O out of `outcome.ts`/`status-command.ts` (tidy-first) so the library can use it. |
| Crash-safe, live-readable record | **Reuse-estate**: `journal.ts` (atomic rename, synced append, torn-tail tolerance) | A log database (SQLite) or event store | The write discipline already gives a concurrent reader a consistent view (2.4). A database would add a second source of truth and a native dependency for no reader benefit. |
| Live view | **Build**, small: poll + per-source cursor + append lines | `fs.watch`; `chokidar` | `fs.watch` is unreliable on network and some container filesystems and would need a poll fallback anyway; a 2 s stat-and-compare is ~20 lines, portable and testable with fake timers. `chokidar` solves directory trees; we watch two files per task. |
| Terminal redraw / TUI | **Deferred** (COULD); if built, **Buy** `ink` or `log-update` `[research]` | Hand-rolled ANSI cursor control | The accessibility stance forbids cursor movement by default, so there is no MUST need. Hand-rolled ANSI redraw is the commodity smell; it is not built. |
| Colour and tone | **Reuse-estate**: `paint`/`useColour` in `output.ts` (honours `NO_COLOR`, isTTY) | `chalk`, `picocolors` | Already solved, already tested, three tones only; adding a dependency for a function that exists is the opposite smell. |
| Plain-language wording | **Reuse-estate**: phrase tables (`STEP_PHRASES`, `BREAKER_PHRASES`, `POPULATION_LABELS`, `decisionFor`), total over their enums | LLM-generated summary at triage | Section 4: deterministic, free, testable, cannot contradict the evidence. LLM stays a documented future optional field. |
| Machine-readable document schema + JSON Schema | **Reuse-estate**: zod ^4 (already a dependency) and its built-in `z.toJSONSchema` | `ajv` + hand-written JSON Schema; `typebox` | One schema source for types, runtime validation and the published JSON Schema; no new dependency, no drift. |
| Event stream format | **Reuse (convention)**: NDJSON, one object per line with a `schema` tag and `type` field `[research C.4]` | Custom framing; SSE; a binary format | NDJSON is what `run --json` already emits and what `jq`, Vector and Fluent Bit ingest directly. |
| Cost/duration figures | **Reuse**: SDK result message `total_cost_usd`, `duration_ms` | Counting tokens and pricing them ourselves | Hand-pricing tokens would go stale with every price change; the SDK already computes an estimate and honours contracted rates. Labelled an estimate. |
| OpenTelemetry / OTLP export | **Not built**; decision in section 9 | `@opentelemetry/*` SDK in the CLI | Needs a collector and a long-lived process; the record is already complete and the readers are post-hoc. The SDK emits OTel for model usage itself. Consumable later outside the package. |
| Table / markdown layout of reports | **Reuse-estate**: line-oriented text as `statusReport` does today | `cli-table3`, `marked-terminal` | Reports are lines and short lists; the existing style reads in logs and screen readers. A table dependency would regress that. |
| Repair change capture | **Reuse-estate**: `git-exec.ts` (`git`, `takeTurn`) with `git diff`/`status` | A file-hash snapshot library; copying the worktree | Git already is the diff engine for the repository the repair edits; a read-only call after the session is a few lines. |
| Liveness | **Reuse-estate**: `repoLocked` (`proper-lockfile`), plus `lastActivityAt` from the new `at` | Heartbeat file; pid file; mtime heuristic; locking sequential runs | A heartbeat adds writes to the hot path; an mtime guess is non-deterministic; locking concurrency-1 runs changes behaviour this item must not touch. The lock is crash-correct but taken only above concurrency 1, so `live` is honestly `null` otherwise and the report states last activity as a fact. |
| Report artefact write | **Reuse-estate**: `atomicWriteJson` pattern in `journal.ts` | Writing in place | Rename gives readers all-or-nothing, as the record's own JSON files get. |
| Sanitising terminal control characters | **Build**, ~5 lines (one regexp) | `strip-ansi` | A single targeted regexp over a closed set (C0, C1, ESC) in one function; a dependency for it is heavier than the code. |
| Pure model/view split (read model separate from renderers) | **Reuse-estate (pattern)**: the owner's `autoloop` keeps `console/model.mjs`, `fleet.mjs` apart from its Ink and HTML views `[research C.3]` | One module mixing derivation and rendering, as `outcome.ts` does today | Right-choice check: the estate precedent is the same shape as the design, so conform. The code is not shared (different language and domain), only the structure. |
| Full-screen live view | **Deferred (COULD)**; if built, **buy** `ink` (estate precedent: autoloop's console), as an optional separate entry point so the five-dependency baseline holds | Hand-rolled ANSI redraw; `log-update` (8.0.0, Node >=22); `listr2` (task-tree model does not fit an `advance()` loop, already rejected by the CLI design); `blessed` (unmaintained) `[research C.1]` | The accessibility stance forbids cursor movement by default, so no MUST need exists. Autoloop uses Ink 5/React 18; Ink 7 needs React 19, so conforming means a version split or a JSX/`createElement` decision made when the view is built, not now. |
| Self-contained HTML report | **Deferred (COULD)**; a pure render over `ReportDocument`, estate pattern (`autoloop/web/views.mjs`, with its `esc()` helper) available | Markdown; a templating library | Dana is terminal-first; `last-report.txt` is the forwardable artefact. Any HTML must escape every interpolation because the text includes agent output `[research C.2]`. |
| Machine formats for test tooling (JUnit XML, CTRF) | **Not built** | `junit-report-builder`; `ctrf` (pre-1.0) | Escalations, budgets, triage and repairs have no place in a test-result schema `[research C.4]`. |
| Dashboards, hosted UI, daemon | **Not built**: non-goal | Grafana/Datadog adapters | Out of scope by the review log. The stable documents are the integration point. |

## Operability / DX

These are properties of the built system, not steps to reach it.

**Environment.** Reporting is a capability of the existing `delivery` CLI (Node >= 22,
TypeScript ESM, commander) and of the library behind it; there is no new service, daemon,
database or deploy infrastructure. It reads `.delivery/` inside the target repository, so
it runs wherever `delivery` already runs: a developer's machine, CI, an autoloop worker,
and (for Item 13) a scheduler on the same host. It works offline and needs no credentials.

**Harness.** One harness, the one that exists: `vendor/claude-mock` through
`mock-session.ts`/`mock-script.ts`, driven by `runSurfaceAgainstMock` and
`runSupervisorAgainstMock`. A developer proving a report writes the same `MockScript` as
for any other behaviour, runs it, and asserts on the document or text produced from the
real record it left. There is no reporting-specific mock vocabulary. Time is controlled
with the test runner's fake timers; nothing reads the real clock inside a report.

**Scaffolding.** No `init` change and no configuration key: reporting works on any
existing record, including ones from before this item (they report "not recorded" where
data is missing). `delivery validate` is unaffected. Extenders get the schemas and a JSON
Schema (`delivery report --schema`) rather than prose documentation of key names, plus a
section in the existing docs set (`docs/`) that names the stability promise.

**Local-run story.** A developer looks at a run the same way an owner does: `status`
(or `status --watch` in a second terminal while `run` is going), `report` for the
artefact, `--json` for a script. The demos under `demos/` (npm `demo:*`) gain a reporting
demo built on the scripted stack, so the output can be seen without an agent or an API
key. Because reports are pure over the record, a failing case a user hits can be
reproduced by copying their `.delivery/runs/<id>` folder; no run is needed to debug a
report.

**Deploy target.** The npm package `delivery-service` (bin `delivery`, `exports` `.` and
`./testing`) is the only artefact; this item ships inside it. The library surface is
`src/index.ts`, the stability-promised documents are `delivery.report/1` and
`delivery.event/1`, and the schema additions are optional and add no entry kind, so a
newer build reads every older record and an older build still reads newer logs (section 8
states the one lossy case honestly). Nothing is hosted; `.delivery/` inside the target
repository is where a report lives, and `last-report.json`/`last-report.txt` are what a
scheduler or a person collects after an unattended run.

**Verification.** `npm test` (lint, build, vitest) is the single gate; reporting adds
goldens to it, runs under the same hooks, and needs no extra environment.
