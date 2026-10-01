# Research: Observability and Reporting (roadmap Item 11)

Author: researcher, team `observability-and-reporting-design`, run `20261001T131757Z`.
Status: facts and trade-offs only; no design. Every claim is marked **VERIFIED** (with a
citation) or **ASSUMED**. Paths are relative to the repository root; `file:line` is against
this worktree at HEAD `ba50592`. Web sources are linked inline and listed at the end.

## Headline findings (read these first)

1. **The CLI never runs agent triage.** `src/cli/drive.ts:74` wires `triage: deterministicRouter`;
   `createAgentTriage` is only referenced from tests and the library export (`src/index.ts:100`).
   So in every CLI run today every triage rationale is a fixed template string
   (`src/router.ts:39,49,61,68`) and every escalation packet is built by the deterministic
   `buildEscalationPacket` (`src/escalation-packet.ts:49`). There is no agent in the loop at
   triage time for the CLI, so "a plain-language summary generated at triage time" would be a
   new agent call, or (cheaper) a deterministic template. VERIFIED.
2. **Triage verdicts, rationales and per-surface budget counters are persisted but no
   command shows them.** `status` never reads `TriageEntry` or `cursor.budgets` (grep for
   `budget|triage|rationale|verdict` in `src/cli/status-command.ts`, `outcome.ts`,
   `supervised-view.ts`, `report.ts` finds only `runBudgets` at `status-command.ts:211,234`).
   This is "persisted, not surfaced", not "not persisted". VERIFIED.
3. **Nothing on disk is timestamped except outcomes.** History entries (`src/schema.ts:199-265`,
   `343-361`) carry no `at`. The only timestamps are `outcome.at` (`schema.ts:273`,
   `RunOutcome.at` `schema.ts:365,367`), the start instant encoded in the run id
   (`src/cli/run-location.ts:9-12,22-35,38-40`), file mtimes, and the `at` on live `--json`
   step records (`report.ts:141-153`), which are not persisted. Per-step timelines and
   durations are not recoverable after the fact. VERIFIED.
4. **Token usage, cost and duration are not captured anywhere.** `src/agent-invoke.ts` and
   `src/ports.ts` never read `total_cost_usd`, `usage`, `duration_ms` (grep finds only the
   unrelated `usage limit` concept). "Budget consumption" in the harness means retry-count
   budgets (`BudgetSet`, `schema.ts:18-25`), not tokens or money. The SDK does expose cost
   per `query()` result ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)),
   so capturing it is possible but would be a persistence change, against the roadmap note
   that Item 11 "is about surfacing that data ... not about capturing it". VERIFIED.
5. **What a repair changed is not recoverable.** A repair leaves only `rationale` text
   (`schema.ts:216,356`; `breaker.ts:45-51`). Its edits sit uncommitted in a task's worktree
   until the closer runs `git add -A && git commit` over everything at once
   (`src/git-exec.ts:66-70`), so a repair's edits are merged into the task's single
   "Accepted work from <branch>" commit with no attribution; on escalate/abort the worktree
   is force-removed uncommitted (`src/closer-support.ts:27,46`) and the edits are lost.
   VERIFIED (detail in A.6).
6. **The live `--json` stream and `status --json` carry no schema version.** No version
   field in `StepRecord`/`SurfaceStepRecord`/`RunEventRecord` (`report.ts:12-17,43-61`) nor in
   `RunStatusDocument`/`SupervisedStatusDocument` (`status-command.ts:122-148,195-213`).
   Prior art (Terraform, Cargo) versions its machine stream; see B/C. VERIFIED.
7. **OpenTelemetry for the agent sessions already works by environment passthrough.**
   `agentSession` returns `{ pathToClaudeCodeExecutable, env }` with the full process env
   (`src/cli/agent-session.ts:126`) and `buildSessionOptions` passes `env: session.env`
   (`src/agent-invoke.ts:188`), so `CLAUDE_CODE_ENABLE_TELEMETRY` and `OTEL_*` set in the
   owner's shell reach the Claude Code child that emits spans/metrics/events itself
   ([SDK observability](https://code.claude.com/docs/en/agent-sdk/observability)). The
   harness emits no telemetry of its own, and traces from the agent are beta. Passthrough is
   VERIFIED as wiring; that exporting then works end to end is ASSUMED (not run here).
8. **The estate has precedent for the terminal UI and web views.** `/home/jorjives/dev/autoloop`
   ships `autoloop-console` (Ink 5 + React 18, `React.createElement`, no JSX/build step) and a
   web console (pure state-to-HTML-string renderers with an `esc()` helper, template literals,
   no framework), with a pure model/view split (`console/model.mjs`, `console/fleet.mjs`,
   `web/views.mjs`). It also has `autoloop digest --emit` (run-health rollup) and
   `backlog --json`. VERIFIED (`autoloop/package.json`, `README.md:99-140`,
   `console/cli.mjs:1-30`, `web/views.mjs:1-20`). Whether to conform is the architect's call.

---

## A. Current-state inventory

### A.1 What the terminal renders live (`delivery run` / `resume`)

- **Seam.** `RunReporter` (`src/cli/report.ts:72-83`): `note(line)`, `step(AdvanceResult)`,
  `outcome(OutcomeSummary)`, `forTask(TaskTag)`, `run(RunEvent)`. The run loop reports through
  it and never learns which renderer it has (`report.ts:66-71`). Chosen once per invocation by
  `reporterFor` (`src/cli/program.ts:36-39`): `--json` gives `jsonReporter`, else `plainReporter`.
  The same seam was named in earlier specs as where Item 11 attaches
  (`2026-09-14-cli-and-configuration-design.md:415-420,548-552`). VERIFIED.
- **`plainReporter`** (`report.ts:92-118`): one line per step, no cursor movement, spinners or
  box drawing; a step whose phrase equals the previous one is suppressed unless it carries a
  `recovery` (`report.ts:98-103`). In a multi-task run each line is prefixed `[n/M]`
  (`report.ts:64,93`). Run-level events print only for shared-environment changes
  (`DEGRADED`, `REPAIRING`, `HEALTHY`; `report.ts:112-116`); `STARTED`/`RESUMED`/`DRAINED` are
  silent in the plain stream (`report.ts:111`) and told via `note` lines in `queue.ts`.
- **`jsonReporter`** (`report.ts:130-173`): NDJSON on stdout, one object per step, notes and
  the closing sentence on stderr (`report.ts:73,156-160`). Three record shapes:
  - untagged `StepRecord {state, done, recovery?, at}` (`report.ts:12-17,143`), key omitted
    when absent;
  - `SurfaceStepRecord {scope:"surface", runId, surface:{ordinal,of,id}, state, done, recovery|null, at}` (`report.ts:43-51,146-154`);
  - `RunEventRecord {scope:"run", runId, state, done, affected|null, at}` (`report.ts:54-61,163-170`),
    `state` one of `STARTED|RESUMED|DRAINED|ESCALATED|HEALTHY|DEGRADED|REPAIRING` (`report.ts:32`).
  There is **no outcome record**: the last step says `done:true` and the exit code carries the
  result (`report.ts:121-127,156-160`). Documented in `README.md:49-76`.
- **Phrase tables** (`src/cli/output.ts`): `STEP_PHRASES: Record<SurfaceState,string>`
  (`output.ts:37-50`), `BREAKER_PHRASES` (`output.ts:58-62`), `RESUME_PHRASES` (`output.ts:71-80`).
  All are total over closed enums so a new state does not compile without words
  (`output.ts:33-36`). Colour is decoration only, with `NO_COLOR`/TTY detection via `node:util`
  `styleText` (`output.ts:10-30`). No spinner, redraw, pane or box code exists anywhere in
  `src/cli` (the supervisor spec reserves "redrawing progress bars or panes" for Item 11:
  `2026-09-26-multi-surface-supervisor-design.md:286-291`). VERIFIED.
- **What the live stream does not say:** budgets, triage verdicts or rationales (the step
  phrase for `TRIAGE` is the fixed "deciding what to do about a setback", `output.ts:44`),
  which agent role is active beyond the state name, elapsed time (JSON `at` only), counts of
  how many tasks are in each standing so far. VERIFIED by reading `report.ts`/`output.ts`.
- **End of a multi-task run.** There is no roll-up. After `DRAINED` (`queue.ts:345`) a run
  with every task closed prints one line, `EVERY_TASK_DONE` (`queue.ts:83-84`); otherwise it
  prints one line per non-closed task, `taskEnded` (`queue.ts:170-175,350-352`). A one-at-a-time
  list stops at the first non-closed task with `listStopped` (`queue.ts:95-100,322`). A task's own
  `OutcomeSummary` prints when that task ends (`outcome.ts:139-144`). VERIFIED.

### A.2 What `delivery status` shows (read-only, safe during a run)

`statusCommand` (`status-command.ts:512-532`): `status [run-id]`, `--last`, `--all`, global
`--json`. It only reads (`status-command.ts:505-511`). Case/run files are replaced atomically
and appended with `datasync` (`src/journal.ts:10-30`), so a read mid-run sees whole records. VERIFIED.

- **Single run, plain** (`statusReport` `status-command.ts:73-79`, `statusBody` `82-101`):
  header line (run id, start time from the id, task intent); queue position; then
  - unfinished: "This run hasn't finished. Picking it up will carry on with <phrase>." and
    `delivery resume <id>` (`status-command.ts:86-91`);
  - closed: headline "Done: the change for ... passed `<check>` and <where landed>" plus
    finish time and landing details (`outcome.ts:88-102`);
  - escalated: headline **"This needs your decision: <packet.decision>"** (`outcome.ts:103-117`)
    then the whole packet: evidence, dead ends, "Why it stopped when it did", session keys
    (`status-command.ts:29-44,99-100`), then "Where to look" (branch, working copy if it
    survives, record dir; `53-64`);
  - aborted: "The run stopped: <reason>" (provisioning aborts get fixed advice; `outcome.ts:118-135`).
- **Single run, `--json`**: `RunStatusDocument` (`status-command.ts:122-148,165-187`): `run`,
  `task`, `startedAt` (from id), `outcome` (`closed|escalated|aborted|unfinished`), `state`,
  `finishedAt`, `reason`, `nextStep`, `summary` (the headline sentence), `details[]`,
  `branch`, `base`, `dir`, `worktree|null`, `escalation: EscalationPacket|null`, `queue`.
  Every key always present. No budgets, no history, no triage entries, no verdicts,
  no `schemaVersion`.
- **Run of several at once** (`supervisedReport` `status-command.ts:481-503`): environment
  narration if the shared environment is not healthy (`283-301`), run line with shape
  ("N tasks, up to C at once", `queue.ts` `shapeOf`), "Environment: <phrase> (repaired once
  during this run)" (`467-472,486-487`), a counts line ("3 done, 1 needs your decision",
  `303-309`), then one line per task: position, intent, run id, standing (`316-326`). A task
  that needs a decision is followed by the full single-run account (`494`). Standings are the
  closed set `closed|escalated|aborted|paused|unfinished|queued` (`supervised-view.ts:7-10`,
  words at `status-command.ts:248-255`).
  - **Gap inside the supervised view:** an in-flight task's standing is just `unfinished`
    ("not finished yet", `status-command.ts:253`; `supervised-view.ts:66-69`). Its actual
    surface state (setting up, agent working, checking, triage, repairing, wrapping up) is
    in `RunStatusDocument.state` (`status-command.ts:174`) and so in `--json`'s
    `surfaces[].state`, but the human view does not print it. VERIFIED.
- **Supervised `--json`**: `SupervisedStatusDocument` (`status-command.ts:195-237`): `runId`,
  `startedAt`, `tasks`, `concurrency`, `live`, `breaker`, `outcome`, `finishedAt`,
  `surfaces: RunStatusDocument[]` (only tasks with a record), `queued[]`, `reason`, `cause`
  (`shared_environment|usage_limit`), `runBudgets.gateMaintenance {used,max}` (the only budget
  `status` exposes anywhere), `trips: Trip[]` (cause, held, repairs[{attempt,sessionKey,
  surfaceId,status,rationale}], ended, reason, limit; `breaker.ts:66-87`).
- **`status --all`** (`listRuns` `status-command.ts:377-390`): newest-first list, one line per
  run; a supervised run is one line with shape and counts (`356-369`); `--json` gives
  `ListedRun[]` (`331-353`) with each task as `RunSummary {run,task,startedAt,outcome}`.
- **`live`** is "the run holds the repository lock" (`status-command.ts:461-465`;
  `src/cli/repo-lock.ts`, `proper-lockfile`). VERIFIED.
- **A list run at concurrency 1 has no run-level record.** The supervised run file is only
  created when `concurrency > 1` (`queue.ts:279,288-292`). A sequentially-worked list is just
  a set of single runs; `status --all` lists them individually and there is no "this
  overnight run" object to summarise. VERIFIED.

### A.3 What is persisted (the data an Item 11 report could read)

Layout: a task run lives in `<repo>/.delivery/runs/<runId>/` (`run-location.ts:79-80`) as
`case.json` (header, cursor, outcome) + `log.jsonl` (history) + `refs/<id>.json` artefacts
(`src/case-file.ts:26-86,225-246`). A multi-task run lives in
`<repo>/.delivery/supervised/<runId>/` as `run.json` + `log.jsonl` (`src/run-file.ts:13-71`;
`run-location.ts:43-50`). `.delivery/` ignores itself (`run-location.ts:58-61`).

Per task (`src/schema.ts`):
- **Header** (immutable, `162-182`): `surfaceId`, `taskDef` (opaque), pinned `gateRef`,
  `closerRef`, `domainPrompt`, `roleOverrides`, `baseline` (full `GateReport`), `baseBranch`.
- **Cursor** (`190-195`): `state`, `budgets` (`BudgetSet`: five populations `correction`,
  `gateError`, `gateMaintenance`, `terminus`, `close`, each `{used,max}`; `12-25`), `worktreeRef`.
  `used` is also derivable from the log (`case-file.ts:310-346`), and `delivery` reads neither.
- **History entries** (`199-265`): `dispatch` (attempt, sessionKey, optional `briefRef`, `role`
  worker|gate-maintenance), `terminus` (attempt, sessionKey, status completed|escalate|incomplete,
  `category` exhaustion|authority, `rationale`, `role`, `notRun`), `gate` (attempt, status,
  `newFailures[{id,detailRef}]`, class), `triage` (`afterAttempt`, `trigger`, `verdict`
  reroute|escalate|fix_the_gate|retry_close|abort|recheck_gate, `rationale`, `artifactRef`;
  `234-242`), `close` (status, `detailRef`), `baseline`. **No entry has a timestamp.**
- **Outcome** (`269-278`): `kind` closed|escalated|aborted, `source`, `reason`, `at`, `packetRef`.
- **Refs** (`refs/*.json`): `escalation` (the `EscalationPacket`, `surface.ts:174`),
  `triage-<n>` (`{trigger, rationale, artifact?}`, `surface.ts:755-759`; `artifact` is the
  brief or packet), `close-<n>` (the `CloseReport`), per-assertion failure details, and
  `session-error-<key>` for sessions that produced nothing usable (`agent-invoke.ts:63-64,131-137`).
- **Run file** (`schema.ts:313-377`): header (`runId`, `repoPath`, `concurrency`, `tasks`,
  `runBudgetMax.gateMaintenance`), history entries `slot_fill`, `slot_free{outcome}`,
  `breaker_degraded{cause}`, `repair_request`, `gate_error_signal`, `held`, `repair_dispatch`,
  `repair_terminus{status,rationale}`, `breaker_healthy`, `run_escalated{reason,limit?}`, and
  outcome `drained` or `escalated{cause,reason,at}`. No timestamps on entries. `tripsOf` folds
  them into `Trip[]` (`breaker.ts:88-128`).
- **Transcripts:** `references` in a packet are `sessionKey`s "for pulling a transcript"
  (`escalation-packet.ts:38-39`; `docs/single-surface-control-flow.md:455-461`). The harness
  runs sessions without resume/session id (`agent-invoke.ts:195-197`), so what a key
  resolves to is whatever the Claude Code runtime stored; the harness does not store
  transcripts. ASSUMED (not traced to the runtime's storage).

### A.4 Triage and the escalation packet

- **Packet shape** (`src/triage-role-config.ts:29-36`): `decision`, `evidence`, `dead_ends`,
  `why_now`, `references[]`. **There is no `summary` field.** The roadmap-5 COULD item "a
  one-sentence, jargon-free summary prepended to the packet" (`2026-09-10-triage-and-router-design.md:111-114`)
  was not built as a field; `decision` is the nearest thing. VERIFIED.
- **Who writes it, when.** Every escalation goes through `escalate()` (`surface.ts:169-182`),
  which writes `refs/escalation.json`. For an escalate verdict the packet is the agent's own
  if `verdict.artifact` parses as an `EscalationPacket`, else the harness's
  (`packetForVerdict`, `surface.ts:198-210`). In the CLI the router is deterministic, so
  **always the harness's** (A headline 1). `decision` is one of a fixed sentence per cause
  (`escalation-packet.ts:62-84`): authority, repair_gave_up, session_not_run, budget (close
  variant and general variant), triage_failure.
- **Plain-language quality of today's `decision`/`why_now`.** `decision` is imperative and mostly
  non-technical ("Decide whether to continue manually, amend the task, or abandon it") but the
  budget variant leads with a counter ("No correction budget remains (3/3 used)",
  `escalation-packet.ts:80`) and the roadmap's example of what NOT to say ("correction budget
  exhausted on surface 4") is close to the current text. `why_now` embeds a one-line budget
  digest in the harness's population words, "correction 3/3, gate recheck 0/3, gate repair 0/2,
  session retry 0/5, close retry 0/3" (`escalation-packet.ts:57,101-105`, labels `8-14`).
  `evidence` is verbatim failing assertion ids and details, or a worker's own rationale
  (`129-151`). `dead_ends` is a numbered list of prior triage rationales (`53-56`), which in
  the CLI are the router's template strings such as "gate_fail: reroute (correction 1/3)".
  So the packet is accurate and deterministic, written for Marcus, with the budget digest
  being the main jargon for Dana. VERIFIED.
- **Triage rationales today (CLI):** `authority limit: the worker reported no retry can
  resolve this` (`router.ts:39`), `gate_error: recheck_gate (gateError 1/3)` (`49`),
  `<budget> budget exhausted (<used>/<max>): no retry remains for a <trigger> setback`
  (`budgets.ts:23`, `router.ts:58-61`), `<trigger>: <verdict> (<budget> <used>/<max>)` (`68`).
  These are machine-flavoured strings, not prose. With an agent triage (library only) the
  rationale is the model's free text (`triage.ts:56-58`). VERIFIED.
- **Agent triage exists but is not reached from the CLI**: `createAgentTriage` consults an
  agent only when `needsJudgement` (a real decision exists: one slot left, or repair still
  affordable; `triage.ts:23-40,78-90`). VERIFIED.
- **Exposure of the packet:** in `status` (A.2) and the `escalation` key of `status --json`.
  The packet file path is not printed, but the run dir is (`status-command.ts:62`).

### A.5 Item 11's five success criteria against the code

Legend: **Met** / **Partly** / **Gap-surface** (data persisted, no command shows it) /
**Gap-capture** (data not persisted).

| # | Criterion | What exists | Remaining gap | Class |
|---|---|---|---|---|
| 1 | Current state of every active surface during a run | Live: tagged per-step lines and JSON (`report.ts:92-173`). `status` supervised view: standing per task, environment line, counts (`status-command.ts:316-326,481-503`); `--json` has `surfaces[].state` (`174`). | The human supervised view prints only "not finished yet" for an in-flight task (`253`), not "agent working / checking / repairing"; no active-session/role, attempt number or time-in-state anywhere (no timestamps). No redrawn board; the stream interleaves N tasks (`[n/M]` tags only). `status` for a sequential (concurrency 1) list has no run-level view (`queue.ts:279`). | Partly. State data persisted (cursor, log tail); human view omits it. Time-in-state is Gap-capture. |
| 2 | Budget consumption per surface and per run | Per run: `runBudgets.gateMaintenance {used,max}` in supervised `--json` only (`status-command.ts:211,234`); per-run repair attempts in `trips[].repairs` and the "attempt N of M" live line (`output.ts:109-110`). Per surface: `cursor.budgets` and log-derivable counters persisted (`schema.ts:190-195`, `case-file.ts:310-346`); a one-line digest inside an escalated packet's `why_now` (`escalation-packet.ts:101-105`). | No command prints any per-surface budget for any run (closed, running, or escalated, except as prose in `why_now`); the human supervised report shows no run budget at all. Not machine-readable in `status --json` per surface. Token/cost/duration are not captured (headline 4), so "budget" can only mean retry budgets unless capture is added. | Gap-surface for retry budgets. Gap-capture for tokens/cost/time. |
| 3 | Triage decisions and rationales inspectable | `TriageEntry` (verdict, trigger, rationale, afterAttempt) in `log.jsonl`; `refs/triage-<n>.json` has the brief/packet. Escalated packets carry prior rationales as `dead_ends` (`escalation-packet.ts:53-56`). Reading is possible with `cat`/`jq` on `.delivery/runs/<id>/log.jsonl`. | No command lists a task's triage history (or any history); `RunStatusDocument` has no history; a closed task that survived three rerouted retries looks identical to one that passed first time. Rationales are template strings in the CLI (A.4); briefs (`SharpenedBrief`) are in refs only. | Gap-surface. |
| 4 | Terminal outcomes summarised with reasons | Per run: headline + reason (`outcome.ts:81-137`, `status-command.ts:73-101`); counts line and per-task lines in supervised status (`303-326`); `status --all` list (`356-369`); live end-of-run lines (`queue.ts:345-352`); exit codes 0/4/5 (`failures.ts:28-35`, `queue.ts:107-111`); run-level `reason`/`cause` (`status-command.ts:232-233`). | No returning-owner roll-up for a whole run: no "what succeeded / what escalated / why / what to do" document across tasks (the roadmap DX example); `EVERY_TASK_DONE` is one line and says nothing about what landed where; `status` with no id returns the latest, not a summary of an overnight list; sequential lists have no run grouping. `aborted` reasons can be raw (`outcome.ts:131`). No durable report artefact is written. Plain-language outcome sentences exist but mention check commands and branches, which suits engineers more than Dana. | Partly. Pieces exist per task; the aggregate is Gap-surface. |
| 5 | Escalation packets accessible for human review | Fully rendered in `status` (escalated tasks are expanded inside the supervised report; `status-command.ts:494`); `--json` carries the whole packet (`145`); written to `refs/escalation.json`; "Where to look" names branch, working copy, record dir (`53-64`). | Packet is accessible. Not yet "the decision the owner needs to make, not the internal state" for a non-technical reader (`why_now`/`dead_ends` are harness vocabulary, A.4); no `summary` field; no per-escalation "what to do about it" beyond `decision`; no packet export or notification. Note stopped runs lose uncommitted work, so the packet is the only evidence (`outcome.ts:111-113`). | Met for access; Partly for plain-language. |

### A.6 What a repair changed: is a diff, commit or file list recoverable?

Grounds the SHOULD-tier capability seeded by
`/home/jorjives/dev/delivery-service/.autoloop/ideas/50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md`
(read; unmodified). The idea's first direction is "should a repair's change to the check (or
anything it reads) be shown to the owner"; the other two change control flow and are out of scope.

Facts:
- **What a repair is.** Gate maintenance (per task) and the shared-environment repair both run
  the `gate-maintenance` role: tools `Read, Glob, Grep, Edit, Write`, no `Bash`
  (`src/role-config.ts:87-96`), acting only inside the task's worktree
  (`tool-authority.ts:28-38`). The role prompt says checks are "pinned by the harness, kept
  outside your working tree" (`role-config.ts:93-96`). The idea file's concern is that a
  check that reads data from inside the worktree (its example: `shared/helper.json` naming a
  command) can still be weakened by an in-worktree edit. That example is the repository's
  `examples/shared-environment-example/check.mjs` (not re-read here beyond the idea's account).
- **Where a repair is recorded.** Per task: `dispatch {role:"gate-maintenance"}` then
  `terminus {role:"gate-maintenance", status, rationale}` (`schema.ts:199-222`). Per run:
  `repair_dispatch {attempt, sessionKey, surfaceId}` and `repair_terminus {status, rationale}`
  (`schema.ts:355-356`; recorded at `breaker.ts:247,250`), surfaced as
  `trips[].repairs[]` (`breaker.ts:66-72`). The shared repair runs in the worktree and record
  of the task that tripped the breaker (`drive.ts:88-101`, `breaker.ts` `RepairAttempt.surfaceId`).
  The only account of what was changed is the agent's free-text `rationale`. No changed-file
  list, diff, hash or snapshot is recorded. VERIFIED.
- **After the fact.** Repair edits are made in the working copy and are not committed by the
  repair. They are swept up with the worker's edits by `ensureCommitted` (`git add -A` then
  one commit, `git-exec.ts:66-70`), called by all three built-in closers with the same message
  "Accepted work from <branch>" (`commit-to-branch-closer.ts:30`, `open-pr-closer.ts:129`,
  `merge-back-closer.ts:59`). So when the task closes, the repair's edits are in the task's
  branch but not distinguishable from the worker's. When the task escalates or aborts, the
  closer removes the worktree with `--force` and does not commit
  (`closer-support.ts:27,46`), so the repair's edits are gone. A repair run by the shared
  breaker for a task that later escalates is therefore unrecoverable. VERIFIED.
- **A custom closer** (`src/custom-closer.ts`) may do anything; not examined.
- **Capturing it later would be a capture change**, not only a surfacing change: e.g. record
  `git status --porcelain`/`git diff --stat` (or a diff ref in `refs/`) in the repair's
  `terminus`/`repair_terminus` entry at the point the session ends. That is a design option,
  noted for the architect, not a recommendation. Whether the roadmap's "surfacing, not
  capturing" framing extends to this is a scope question for the designers.

### A.7 What earlier specs deferred to Item 11 (grep of `*-design.md` for "Item 11")

- cli-and-configuration: Item 11 may "replace or augment the renderer (for example, also writing
  each step to a structured log) without the run loop changing" (`:415-420`); "replaces or
  augments the renderer at the `AdvanceResult` seam and builds on `status`" (`:548-552`); the
  non-goal "live dashboards, cross-run summaries, plain-language summaries generated at triage
  time" (`:605-609`); build-vs-buy row: terminal progress "Build ... A spinner or task list would
  pre-empt Item 11" (`:565`, rejected `ora`, `listr2`).
- triage-and-router: COULD "one-sentence, jargon-free summary prepended to the packet ... Feeds
  Item 11" (`:111-114`); "every triage decision is reconstructable from the case file ... so
  Item 11 needs no schema change" (`:462-466`); excluded: dashboards, cross-run escalation
  metrics, Dana's experience beyond the COULD summary (`:547`).
- close-interface: "Plain-language reporting across runs is Item 11's" (`:474,552`).
- project-configuration: "Reporting beyond the terminal renderer and `status`" (`:551,603`).
- multi-surface-supervisor: "No new observability subsystem (Item 11). The run file is the audit
  trail. Output reuses `RunReporter` and the closed-set phrase tables" (`:530-531`); excluded:
  TUI, dashboards, cross-run trends, plain-language packet summaries beyond today's (`:591-592`);
  "No redrawing progress bars or panes" (`:291`).
- Roadmap Items 12-14: Item 12's fix-phase progress "feed[s] through the reporting surface
  (Item 11) using the same plain-language approach" (`roadmap:608`); Item 13 requires "Scheduled
  runs produce the same reporting output as manual runs" and lists Item 11 as a dependency
  (`roadmap:627,633-635`), with unattended runs needing "clear reporting on what happened". Item
  14 (event triggers, managed schedules) is downstream. VERIFIED.
- Constraint these create: all deferrals assume the reporting layer builds on the case/run
  files and the `RunReporter`/`status` seams, and (cli design) was told it needs no schema change.
  Findings 2, 3, 4 and A.6 show where that assumption is false (timestamps, cost, repair diffs).

### A.8 Docs an owner reads today

- `docs/getting-started.md` section 4 "Read what happened, later" (`:104-121`): shows `delivery status` for
  one closed run; says an escalated run prints the decision first, evidence beneath. Does not
  mention `--all`, `--json`, multi-task runs, budgets or triage history.
- `README.md:49-80` documents `--json` shapes and exit codes (0 ok, 3 agent runtime, 4 needs a
  decision, 5 stopped; `failures.ts:28-35`); `README.md:205,219-225` describe status for a live run.
- `docs/single-surface-control-flow.md` (Case file chapter `:361-455`, Session keys `:455-461`)
  and `docs/multi-surface-control-flow.md` (breaker `:128-170`) describe persisted state for
  engineers; `docs/shared-environment.md:69,120-136` points to `status --json` `trips` for
  looking back at repairs. None of the three control-flow docs says how to read budgets or
  triage history; `docs/personas.md` Priya's goal says she reads triage `log` entries by hand
  ("read the case file's `triage` log entries ... and understand why", `personas.md` Priya
  "What success looks like"). VERIFIED.

### A.9 Library surface (relevant to "adopters build their own dashboards")

`src/index.ts` exports the case-file API (`load`, `readRef`, `deriveBudgetsFromLog`; `:1`), the
escalation packet builders (`:101`), `EscalationPacket` schema (`:93`), types. It does not export
`RunReporter`, `statusDocument`, `RunStatusDocument`, `supervisedView`, or the run-file reader
(`loadRunFile`) (grep of `src/index.ts`). The CLI's two JSON surfaces are therefore the
only documented machine interface; the persisted `.delivery/` directory is a de facto third,
undocumented as a contract. VERIFIED.

---

## B. Prior art and competitive landscape

How comparable tools tell a returning human what an unattended run did. For each: mechanism,
what is portable here.

| Tool | Mechanism | What works for a returning/non-technical reader | Portability / caveat |
|---|---|---|---|
| **GitHub Actions job summaries** ([workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)) | Steps append GitHub-flavoured Markdown to the file at `$GITHUB_STEP_SUMMARY`; grouped into one job summary on the run page. Limits: 1 MiB per step; 20 step summaries displayed per job; steps isolated; immutable after the step. | A formatted page at the top of the run, no log-reading needed. | The pattern is "write Markdown to a path the host renders". A durable `report.md` file is the portable form; the delivery harness could also write to `$GITHUB_STEP_SUMMARY` when set (ASSUMED useful for Item 13/14 unattended CI use, not for Dana at a desk). |
| **Buildkite annotations** ([annotate](https://buildkite.com/docs/agent/v3/cli-annotate)) | `buildkite-agent annotate` with `--style success\|info\|warning\|error`, `--context` (update in place), `--append`, `--priority`; CommonMark+GFM up to 1 MiB; scope build or job. | Severity styling and "update in place by context" give a live-updating headline at the top of the build. | Style = tone mapping, which `Tone` (`output.ts:15`) already is. Context-keyed update is the live-summary idea. |
| **Turborepo run summary** ([run reference](https://turborepo.dev/docs/reference/run)) | `--summarize` writes a JSON file into `.turbo/runs` (affected packages, tasks with timings and hashes, cached files); `--dry=json` prints plan as JSON. | Machine-readable post-run artefact, per-task timings; third parties build viewers on it. | Closest analogue to a "durable post-run artefact + JSON" SHOULD item. Only works because the tool captures timings, which delivery does not (headline 3). |
| **Nx** | Concurrent target output is interleaved; summary line "Successfully ran target ..." at end (observed via a bug report: [deadline-radar#81](https://github.com/epo33m/deadline-radar/issues/81)). | End-of-run summary line. | Thin evidence; I could not retrieve Nx's own docs for run summaries in this run. ASSUMED that Nx's summary is a one-line count plus failed-task list. Treat as unverified. |
| **Vitest reporters** ([reporters](https://vitest.dev/guide/reporters)) | Pluggable `reporters` (default, verbose, tree, dot, `minimal`/`agent`, json, junit, html, tap, blob, github-actions, hanging-process); several may run at once, terminal ones to stdout, file ones to `outputFile`; custom reporters by path or package. `github-actions` reporter auto-enables on Actions and writes workflow commands and job summaries. | One run, several renderings; the HTML reporter is the "send this to someone" artefact; the agent-minimal reporter cuts output for AI consumers. | The reporter-plugin pattern matches the existing `RunReporter` seam; multi-reporter fan-out is the only structural addition. |
| **Playwright reporters** ([test-reporters](https://playwright.dev/docs/test-reporters)) | Nine built-ins (list, line, dot, html, json, junit, blob, perfetto, github); combine several; custom `Reporter` with `onBegin/onTestBegin/onTestEnd/onEnd`; HTML reporter is self-contained; blob reporter exists to merge sharded runs. | Local default is rich, CI default is minimal (dot); a self-contained HTML file for after the fact; perfetto timeline. | The "different default per environment" idea is explicitly rejected in this repo (README `:78-79`: "nothing switches format on its own"). |
| **Renovate Dependency Dashboard** ([docs](https://docs.renovatebot.com/key-concepts/dashboard/)) | One long-lived issue listing everything pending, awaiting approval, rate-limited, errored and ignored, with checkboxes that trigger action. | Best-in-class for "an unattended bot did N things, which need me": one page, grouped by what the human must do, action inline. | Needs a git host with dynamic Markdown. The grouping (needs-you / done / waiting) maps directly to Dana's roadmap sentence. A hosted dashboard is a stated non-goal here. |
| **GitHub Copilot cloud agent** ([tracking sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions)) | Session log streams live; the PR timeline links "View session"; Copilot checklists the task in the PR body and ticks it as it goes. | Progress as a checklist the reader already understands; the log is secondary evidence. | Index of web results is thin; the "session log is the first thing to read" claim comes from a third-party guide ([prlens](https://prlens.dev/guides/how-to-review-copilot-coding-agent-pull-requests)). ASSUMED for detail. |
| **Claude Code / Agent SDK telemetry** ([observability](https://code.claude.com/docs/en/agent-sdk/observability), [monitoring](https://code.claude.com/docs/en/monitoring-usage)) | The CLI child emits OTLP metrics (tokens, cost, sessions), log events (prompt, API request, tool result), and beta traces (`claude_code.interaction`, `llm_request`, `tool`); enabled by env vars; `TRACEPARENT` propagated from the host so agent spans nest under a host span. | Tokens and cost per session in any OTel backend with zero harness code. | Agent-level only: it does not know about surfaces, triage, budgets or outcomes. The harness could create a parent span per run/surface and let the agent spans nest (ASSUMED feasible: the SDK injects `TRACEPARENT` when a span is active). Traces are beta. |

Plain-language reporting guidance for non-technical readers (general, not tool-specific):
lead with the point and the decision needed before the path taken (BLUF / inverted pyramid:
[NIH plain language](https://www.nih.gov/institutes-nih/nih-office-director/office-communications-public-liaison/clear-communication/plain-language-nih/plain-language-getting-started-or-brushing-up/presenting-your-information),
[BLUF](https://en.wikipedia.org/wiki/BLUF_(communication))); a status report should say whether
things are on track, what the risk is and what decision is needed, then give actions
([status writing summary](https://coderslingo.com/blog/stakeholder-technical-status-english/)).
Those sources are generic and secondary; the roadmap's own example sentence
(`roadmap:520-526`: "3 of 5 tasks completed and merged; 1 needs your decision ...") already
encodes the same shape. VERIFIED that the sources say this; applicability to Dana is ASSUMED.

Cross-cutting patterns from the above:
1. **Same data, several renderers** (Vitest, Playwright): the human report and the machine
   file are siblings, not derivatives of each other.
2. **A single "needs you" grouping at the top** (Renovate, Buildkite style/priority, roadmap
   example).
3. **A durable, self-contained post-run artefact** (Playwright HTML, Turborepo summary, GHA
   summary file).
4. **Machine streams carry a version and a discriminator** (see C.4).

---

## C. Candidate libraries and formats

Already a dependency (`package.json`): runtime `@anthropic-ai/claude-agent-sdk ^0.3.266`,
`@inquirer/prompts ^8.7.2`, `commander ^14.0.3`, `proper-lockfile ^4.1.2`, `zod ^4.5.4`;
dev `vitest`, `typescript ^6`, `tsx`, `eslint`. No colour, spinner, table, markdown or logging
library. Colour comes from `node:util` `styleText` (`output.ts:1,29`). Node `>=22`,
ESM (`"type":"module"`). All npm facts below from `npm view` on 2026-10-01 (VERIFIED).

### C.1 Live terminal rendering

| Option | Version / Node / module | Last publish | Notes and fit |
|---|---|---|---|
| Plain ANSI (own code) | none | n/a | Nothing to add; `styleText` already used. A redraw loop is small (cursor-up + erase) but TTY detection, width truncation, wide characters and resize are hand-rolled concerns. Today's design deliberately avoids redraw so logs and screen readers read it as printed (`report.ts:85-91`). |
| `log-update` 8.0.0 | ESM, Node `>=22`, 6 deps (ansi-escapes, cli-cursor, slice-ansi, string-width, strip-ansi, wrap-ansi) | 2026-04-05 | The thin "redraw N lines in place" primitive; fits a fixed status board. Used by listr2. Node 22 fit exact. |
| `listr2` 11.1.0 | ESM, Node `>=22.13.0`, 3 deps (wrap-ansi, log-update, cli-truncate) | 2026-09-02 | Task-list renderer with default (TTY), simple, verbose, silent, test renderers; non-TTY degrades; concurrency supported ([repo](https://github.com/listr2/listr2), engines per npm). Its model (a tree of tasks with a promise each) does not match a loop driven by `advance()`; the cli design already rejected it, as pre-empting Item 11 (`cli-and-configuration-design.md:565`). Node `>=22.13` is stricter than this package's `>=22`. |
| `ink` 7.1.1 | ESM, Node `>=22`, peers `react >=19.2`, `@types/react >=19.2`, ~15 deps | 2026-07-16 (7.0.4 to 7.1.1 between 2026-05 and 2026-07, so actively released) | React renderer for the terminal; best for an interactive full-screen/board view (COULD tier). Heavy (React + reconciler) for a CLI that today has 5 runtime deps. **Estate precedent:** autoloop uses `ink ^5.2.1` + `react ^18.3.1` + `ink-testing-library` (`autoloop/package.json`), written with `React.createElement`, no JSX build (`console/cli.mjs:1-30`); this repo would need either Ink 7/React 19 (version split from autoloop) or JSX/TS config for `.tsx`. |
| `ora` 9.4.1 | ESM, Node `>=20` | 2026-06-22 | Single spinner; unsuitable for N concurrent tasks; rejected before (`cli-and-configuration-design.md:565`). |
| `blessed` 0.1.81 / `neo-blessed` 0.2.0 | CJS, Node `>= 0.8` / `>= 8` | 2024-10-22 / 2022-05-10 | Effectively unmaintained (no release for 2 to 4 years); CJS in an ESM/TS5-6 project; not recommended. |

Facts relevant to any live view: (i) non-TTY and `NO_COLOR` must degrade to today's plain lines
(existing rules `output.ts:10-12`; the README states nothing switches format by itself,
`README.md:78-79`); (ii) `--json` stdout must remain pure NDJSON (`report.ts:121-127`); (iii)
repo lock means one live run per repository (`queue.ts` `refuseIfRunGoing`), so a board process
is either the run process itself or a second read-only process polling files (which `status`
already is: safe mid-run, `status-command.ts:505-511`; atomic writes, `journal.ts:10-30`).
(iv) The roadmap says a live TUI is one of "structured log, live TUI, post-run report, or all
three" and the team-lead's shape puts a full-screen live view at COULD.

### C.2 Static report generation

- **Markdown** (stdlib string building): zero dependencies; renders in GitHub, editors, GHA step
  summary (1 MiB cap per step, [source](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)),
  Buildkite annotations (1 MiB, [source](https://buildkite.com/docs/agent/v3/cli-annotate)). Not
  rendered for a non-developer who double-clicks a `.md` file. VERIFIED (formats), ASSUMED (Dana's
  viewing habits; see `docs/personas.md` Dana: "checks in on runs", terminal-first).
- **Self-contained HTML** (one file, inline CSS, template literals with an `esc()` helper):
  zero dependencies; works offline and is the "attach to an email" artefact (Playwright and
  Vitest both ship HTML reporters: [Playwright](https://playwright.dev/docs/test-reporters),
  [Vitest](https://vitest.dev/guide/reporters)). Estate precedent for the string-renderer
  approach: `autoloop/web/views.mjs:1-20` (pure state-to-HTML, `esc()` for untrusted text).
  Security note: report text includes agent output and task prose, so every interpolation needs
  escaping (the same reason `esc()` exists there). No templating library is needed or installed.
- **Terminal tables / box drawing:** none installed; the plain stream currently avoids box
  drawing deliberately for screen readers (`report.ts:85-91`; `2026-09-26-multi-surface-supervisor-design.md:286-291`).

### C.3 Where the owner's estate stands

`autoloop` already solves this class of problem ("run unattended, come back to a summary") with:
a fleet console (Ink), a web console (HTML strings, served locally), `autoloop status`,
`logs -f`, `backlog --json`, `digest --emit` ("fleet-wide run-health rollup, posted via your
notifier", `README.md:99-140`), and a pure data-model layer separated from view code
(`console/model.mjs`, `console/fleet.mjs`, `console/target.mjs`). Its `.autoloop/` queue is
git-excluded like this repo's `.delivery/` (`README.md:97`, `run-location.ts:57-61`).
Both tools share the state-folder naming rule (`run-location.ts:63-70`). Whether a delivery
report should conform (JSON "digest" shape, Ink version) is for the right-choice check; I did
not read autoloop's digest JSON schema in detail. ASSUMED that its shape is reusable.

### C.4 Machine-readable conventions

| Convention | Facts | Fit for "adopters build their own dashboards or integrate with existing observability tooling" |
|---|---|---|
| **NDJSON / JSON Lines** ([jsonlines.org](https://jsonlines.org/)) | UTF-8, one JSON value per line, `\n`-terminated, `.jsonl`; NDJSON is the same format. Already what the harness uses for its logs (`journal.ts:27-30`) and `--json` stream (`report.ts:137`). | Direct fit: zero new dependency, `jq`/`tail -f` friendly, an append-only file is also a durable log. Needs a version and a discriminator to be a contract. |
| **Versioned NDJSON, prior art** | **Terraform `-json`:** every message has `@level`, `@message`, `@module`, `@timestamp`, `type`; stream starts with a `version` message `{"type":"version","ui":"1.0",...}`; minor = additive (clients ignore unknown properties), major = breaking (clients must reject) ([machine-readable UI](https://developer.hashicorp.com/terraform/internals/machine-readable-ui)). **Cargo `--message-format=json`:** line-delimited, discriminated by `reason`, ends with `build-finished {success}` so readers know when to stop; format is "stable and versioned" ([external tools](https://doc.rust-lang.org/cargo/reference/external-tools.html)). | Both show the same three needs: an up-front version, a type discriminator, an end marker. The delivery stream has the discriminator only partly (`scope` appears only on multi-task records; untagged records have none, `report.ts:143`), no version, and its end is signalled by `done:true` on the last step. I did not fetch GitHub Actions workflow-command, TAP or `jest --json` specifications; for those, ASSUMED unverified. |
| **JUnit XML** | Tool-targeted at tests (CI test tabs). The harness already parses JUnit as a gate input (`GateRef.parseMode "junit"`, `schema.ts:40`) but nothing writes it. `junit-report-builder` 5.1.2 (Node >=16, lodash, xmlbuilder) is the sort of dependency one would add. | Poor semantic fit: a surface's "test case" could be a task with pass/fail, but escalations, budgets, triage and repairs have no place in it. Useful only if an adopter wants tasks to appear as tests in a CI tab. ASSUMED. |
| **CTRF** ([ctrf-io/ctrf](https://github.com/ctrf-io/ctrf)) | "An open standard for JSON test reporting"; document has `reportFormat:"CTRF"`, `specVersion` (semver), `results`; pre-1.0 (npm `ctrf` 0.3.0, Node >=20.19, ESM; 2026-08-15); custom properties are listed in the docs; ecosystem of reporters/CLI/integrations. | Same as JUnit: scoped to test results; adoption is among test runners. Not a fit for run/surface/budget/triage unless modelled as tests with extras. Pre-1.0. |
| **OpenTelemetry traces/spans + GenAI semantic conventions** | `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-base` 2.11.0 (Node `^18.19 \|\| >=20.6`), `@opentelemetry/semantic-conventions` 1.43.0, all Apache-2.0 (npm view). GenAI/agent conventions (`invoke_agent`, `execute_tool`, `invoke_workflow`, plan spans; attributes `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.agent.name`...) are all marked **Development**, not stable, as of v1.41 and moved to a dedicated repo in v1.42 on 2026-06-12 ([agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md), [summary](https://www.dash0.com/knowledge/opentelemetry-genai-semantic-conventions-explained)). | Credible for "integrate with existing observability tooling" because OTel is the cross-vendor standard and Claude Code already emits it per session (headline 7). Caveats: (i) the surface/triage/budget/outcome vocabulary is domain-specific and has no semantic convention, so it would be custom attributes on generic spans; (ii) OTLP export needs a collector or backend and a flush on short-lived processes (the agent docs describe the flush window, [source](https://code.claude.com/docs/en/agent-sdk/observability)); the CLI has no daemon, so each `delivery` invocation would need to flush before exit; (iii) GenAI conventions are Development; (iv) it adds 3 packages and concepts to a 5-dependency tool. An alternative that keeps a CLI dependency-free is to write a file in an OTel-shaped schema or emit only a W3C `TRACEPARENT` so agent spans nest under an existing trace (ASSUMED sufficient for most adopters). |
| **Own event schema (zod)** | The repo already validates every persisted record with `zod` (`schema.ts`) and exports `EscalationPacket` etc. A versioned event/summary schema could be defined once and exported (`./testing` and `.` exports exist, `package.json`). | Zero new dependencies; one source of truth for both the human report and the JSON; matches how `RunStatusDocument` is already hand-typed in TS rather than zod (`status-command.ts:122`). Cost: designing and committing to a public contract. |

### C.5 Summary of dependency cost to the five-dependency baseline

Stdlib-only options: plain ANSI redraw, Markdown, self-contained HTML, NDJSON, own zod schema.
Adds one small dependency: `log-update` (8.0.0). Adds a framework: `ink` + `react` (version
split from autoloop's Ink 5/React 18). Adds an ecosystem: OpenTelemetry packages (and, to be useful,
a collector). Format-only libraries (`ctrf`, `junit-report-builder`) have poor semantic fit.

---

## D. Plain-language summarisation

The roadmap's question: is non-technical reporting "a different view of the same data, or does
the escalation packet itself need a plain-language summary generated at triage time"
(`roadmap:520-526` region, Accessibility paragraph).

Facts bearing on it:
1. **What triage produces today.** For an escalation, a five-field `EscalationPacket`
   (`triage-role-config.ts:29-36`). No `summary` field. `decision` is the nearest plain sentence.
   Who writes: in the CLI always the harness, deterministically, per `EscalationCause`
   (`escalation-packet.ts:49-84`, `surface.ts:198-210`, `drive.ts:74`). When: at escalation time,
   via `escalate()` (`surface.ts:169-182`), once per task (fixed ref key `escalation`).
2. **Determinism.** The deterministic packet is a pure function of the case file, "so the same
   log always yields the same packet" (`escalation-packet.ts:44-48`) and is identical whether
   built before or after the triage entry is appended (`escalation-packet.ts:107-113`). A
   deterministic plain-language template for the same causes preserves that. An agent-written
   summary would break it (non-deterministic text, stored once; replay would need the stored
   ref, which `PacketRef` already does for agent-authored packets, `surface.ts:190-210,243-247`).
3. **Cost and where an agent is already in the loop.** The CLI makes no triage agent call
   today (`needsJudgement` fast-path and the CLI wiring, `triage.ts:23-40,78-90`, `drive.ts:74`).
   The agent calls that do exist are worker and gate-maintenance sessions
   (`drive.ts:71`). Generating a summary at triage time therefore means either (a) wiring
   `createAgentTriage` into the CLI (a control-flow and cost change, out of Item 11's stated
   scope since the roadmap says this item surfaces rather than captures), (b) a new, separate
   summarisation call after the packet is built, or (c) a deterministic template.
4. **The set of causes is small and closed.** `EscalationCause` kinds are authority,
   repair_gave_up, session_not_run, budget (five populations), triage_failure
   (`escalation-packet.ts:62-99`), plus run-level `shared_environment` and `usage_limit`
   (`schema.ts:367`), and abort sources (`outcome.ts:118-135`). A closed enum is the same
   property that made the phrase tables total (`output.ts:33-36`), so a total plain-language
   table keyed on cause is a known pattern in this codebase. VERIFIED for the shape; whether
   fixed sentences capture the roadmap's example ("the agent wasn't sure whether to delete the
   old homepage") is not established: that example is task-specific content that only the
   agent's own words (`terminus.rationale`, `evidence`) contain. A template can say "the agent
   stopped and needs your decision" but not what the decision is about; the owner-specific
   content would have to be quoted from `evidence` or come from an agent. ASSUMED limitation,
   derived from the packet fields' content (`escalation-packet.ts:129-151`).
5. **What the existing view already does for the decision.** `outcome.ts:106` puts `packet.decision`
   at the head of the escalated headline, and the supervised report expands it
   (`status-command.ts:494`). A "different view of the same data" is largely built; what it
   lacks is jargon-free `why_now`/`dead_ends` and aggregation across tasks.
6. **Mixed audiences are already a design constraint.** Marcus's bar: "the packet must be legible
   to him without a plain-language rewrite", and a plain summary must be additive, "Marcus's
   content is never diluted" (`personas.md` Marcus; `triage-and-router-design.md:111-114`).
7. **Trust.** Agent-authored text in a plain-language summary can mislead; the harness's rule
   elsewhere is verbatim evidence, "never paraphrased" (`status-command.ts:24-28`,
   `outcome.ts:77-79`). VERIFIED that the principle is stated; applying it to a summary is a
   design question.

I express no preference: options are (i) a different deterministic view over the same persisted
data (no schema change), (ii) a deterministic plain-language field added to the packet at
build time (additive schema change; the packet is parsed with `safeParse`, `outcome.ts:29-33`,
so adding an optional field leaves old packets valid), (iii) an agent-written summary at triage
time (needs agent triage wired into the CLI, or a new call). Trade-off axes are determinism,
cost, owner-specific content, and schema change.

---

## E. Gaps in this research (so nobody leans on it where it is thin)

- Nx run-summary format: not retrieved from Nx docs; row in B is low-confidence.
- GitHub Actions workflow-command JSON, TAP, `jest --json` versioning: not fetched. Terraform and
  Cargo are the two verified examples.
- `examples/shared-environment-example/check.mjs` was not re-read; the weakening scenario is as the
  idea file describes it.
- `src/custom-closer.ts` behaviour on non-accepted outcomes not examined (affects A.6 only for custom closers).
- Where the Claude Code runtime stores session transcripts (what `sessionKey` resolves to) not traced.
- Autoloop's digest JSON schema not read.
- No code was run: all behaviour claims come from reading source, not from executing the CLI.

## Sources

Local code and docs are cited inline. Web: GitHub Docs workflow commands
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands);
Buildkite annotate (https://buildkite.com/docs/agent/v3/cli-annotate);
Turborepo run (https://turborepo.dev/docs/reference/run);
Vitest reporters (https://vitest.dev/guide/reporters);
Playwright reporters (https://playwright.dev/docs/test-reporters);
Renovate dashboard (https://docs.renovatebot.com/key-concepts/dashboard/);
Copilot sessions (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions);
Claude Agent SDK observability (https://code.claude.com/docs/en/agent-sdk/observability);
Claude Code monitoring (https://code.claude.com/docs/en/monitoring-usage);
Agent SDK cost tracking (https://code.claude.com/docs/en/agent-sdk/cost-tracking);
OTel GenAI agent spans (https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md);
Dash0 GenAI explainer (https://www.dash0.com/knowledge/opentelemetry-genai-semantic-conventions-explained);
CTRF (https://github.com/ctrf-io/ctrf); JSON Lines (https://jsonlines.org/);
Terraform machine-readable UI (https://developer.hashicorp.com/terraform/internals/machine-readable-ui);
Cargo external tools (https://doc.rust-lang.org/cargo/reference/external-tools.html);
NIH plain language (https://www.nih.gov/institutes-nih/nih-office-director/office-communications-public-liaison/clear-communication/plain-language-nih/plain-language-getting-started-or-brushing-up/presenting-your-information);
BLUF (https://en.wikipedia.org/wiki/BLUF_(communication));
status writing (https://coderslingo.com/blog/stakeholder-technical-status-english/);
ink/listr2/log-update/ora/blessed/neo-blessed/ctrf/junit-report-builder/@opentelemetry/*: `npm view`, 2026-10-01.

## Appended findings (fact-check log)

_(The researcher appends material answers to teammates' queries below.)_

### F1. Critic's eight checks (all VERIFIED against source unless marked)

1. **SDK result carries cost and duration; `invoke()` holds the message but ignores them.**
   Installed SDK 0.3.266 (`/home/jorjives/dev/delivery-service/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4986-4994,5035`):
   `SDKResultSuccess` and `SDKResultError` both have `duration_ms`, `duration_api_ms`, `num_turns`,
   `total_cost_usd` (an estimate), `usage` (main loop only), `modelUsage`. `invoke()` keeps the
   whole result (`agent-invoke.ts:238`, `sessionEnd` `281-290`) and reads only
   `subtype`, `is_error`, `structured_output`, `result`, `api_error_status`, `permission_denials`.
   claude-mock does emit the fields but as constants: `vendor/claude-mock/src/mock.ts:147-156`
   gives `duration_ms: 0`, `duration_api_ms: 0`, `total_cost_usd: 0`, `num_turns: opts.numTurns`,
   `usage: USAGE`, `modelUsage: {}`. So a script cannot currently set cost or duration; a test
   that needs non-zero values needs a mock change (ASSUMED small: the options object already
   carries `numTurns`). Real-SDK caveats: crash results may carry zeroed cost; `usage` undercounts
   subagents, use `modelUsage` ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)).
2. **`parseLines`: yes, with a wider condition than "unparseable".** `src/journal.ts:52-65`: any
   exception from `JSON.parse` OR from the caller's `parse` callback (so a zod failure) on the
   last line is swallowed (`break`); on any earlier line it throws `MalformedLine`, which
   `load()` maps to `CorruptCaseFile` (`case-file.ts:109-114`) and `loadRunFile` to
   `CorruptRunFile` (`run-file.ts:55-60`). Consequence: an unknown `t` variant on the FINAL line is
   silently dropped by an older build, on an interior line it makes the whole record unreadable.
3. **Extra keys: readable, but stripped on rewrite of the JSON documents.** History and run
   variants are plain `z.object` (only `RoleOverride` uses `.strict()`, `schema.ts:145-150`), and
   zod 4.5.4 (installed) strips unknown keys by default, so an older build reads entries and
   header/cursor/outcome carrying a new optional key without error. Not safe: (a) a new `t`
   variant or a new enum value (e.g. a new `kind`, `status`, `verdict`) fails the
   `discriminatedUnion`/enum, see 2; (b) `case.json` and `run.json` are re-parsed and rewritten
   whole (`case-file.ts:126-135` `updateCursor` re-parses the cursor; `setOnce`,
   `run-file.ts:63-71`), so an older build that updates a record DROPS any new key it does not
   know from `case.json`/`run.json`. Log lines are never rewritten, so entry-level additions
   survive an old build; document-level additions do not.
4. **Write paths and equality.** Entries are appended only through `appendEntry`
   (`case-file.ts:72-84`, validates with `HistoryEntry.parse` first) and `appendRunEntry`
   (`run-file.ts:25-32`), both over `appendLine` (`journal.ts:28-30`); `setBaseline` also appends
   through `appendEntry` (`case-file.ts:176`). Nothing in non-test `src` compares history
   entries by deep equality or hash: the only `isDeepStrictEqual` uses compare `taskDef`
   (`cli/queue.ts:43,56,73`, `cli/config.ts:144`). Resume reads the log tail by `t`/field
   (`resumeAction`, `deriveStateFromEntry`, `servedAlready`, `requestedInOpenTrip`: key and
   `surfaceId` comparisons, `breaker.ts:76-146`), so an added `at` would not break replay logic.
   It WOULD break existing tests that assert exact entry shapes with `toEqual` on `history`
   (ASSUMED widespread: `case-file.test.ts` is 1078 lines; not counted).
5. **`repoLocked` is false for a live single run.** The lock is taken only when
   `concurrency > 1` (`cli/queue.ts:246-250`, comment: "One at a time takes no lock"); a single
   `--task` run goes `startOne` → `startRun` (`run-command.ts:60,81-91`) and a sequential list
   runs at concurrency 1, neither calls `takeRepoLock`. `repoLocked` is `lockfile.check` on
   `.delivery/supervisor.lock` (`repo-lock.ts:34-37`) so it returns false. Therefore
   `SupervisedView.live` (`status-command.ts:461-465`) is "a multi-task run holds the lock", not
   "something is running"; there is no liveness signal for a single or sequential run, and
   `refuseIfRunGoing` does not stop a second single run starting beside one.
   (`resume`/`run` only refuse when a multi-task run holds the lock, `queue.ts:163-167`.)
   Detecting a live single run would need a new signal (lock, heartbeat or pid file).
6. **Cause values at each stop site.** `EscalationCause` has exactly the five kinds listed
   (`ports.ts:74-79`). Task level:
   - `abort()` (`surface.ts:211-223`) takes `source` and `reason` strings and no cause; it has two
     call sites: `provisioning` (`surface.ts:539`, reason = git detail) and `triage`
     (`surface.ts:778`, only reachable when a triage port returns `abort`; the deterministic
     router never does, `router.ts:14-70`, so in the CLI only provisioning aborts occur).
     Aborts write no packet and no cause; `CaseFileOutcome` is `{kind, source, reason, at,
     packetRef?}` (`schema.ts:269-277`).
   - Task escalations pass an `EscalationCause` only via `packetFor`/`resolveEscalationPacket`
     (`surface.ts:185-187,254-257,285,388,417,615`); the cause is NOT persisted on the outcome,
     only baked into the packet sentences. `source` is a free string ("triage", "worker",
     "gate-maintenance", "provisioning").
   - Usage limit at task level: `Terminus.incomplete` carries `limit` in memory
     (`ports.ts:43-47`) but `TerminusEntry` has no `limit` field (`schema.ts:209-222`) and
     `surface.ts` never reads it, so a task-level usage-limit stop is recorded as an ordinary
     incomplete terminus whose `rationale` is the `USAGE_LIMIT_WORDS` text
     (`agent-invoke.ts:252-255`), recoverable only by matching that string.
   - Run level: `RunOutcome.escalated.cause` is `shared_environment | usage_limit`
     (`schema.ts:367`), set in `stopForEnvironment` from the last trip's `limit`
     (`queue.ts:190-201`). There is no packet for a run-level stop, and held tasks have no
     outcome of their own (`queue.ts:188-190`). `BreakerCause` (`schema.ts:335-341`) is the
     cause of a trip, not of an escalation.
7. **Repair edits vanish on stopped outcomes, yes; plain `git diff` omits untracked files, yes.**
   `terminate()` (`surface.ts:91-107`) sets the outcome, then calls the closer; every built-in
   closer runs `teardownWorktree` for any outcome but accepted (`closer-support.ts:41-49,
   53-59`), i.e. `git worktree remove --force` (`:27`) with no commit; the branch is kept but
   holds none of the run's uncommitted edits (the comment at `outcome.ts:111-112` says the same).
   On accepted, `ensureCommitted` does `git add -A` then one commit (`git-exec.ts:66-70`).
   Experiment (scratch repo, 2026-10-01): after editing a tracked file and creating an untracked
   one, `git diff --stat` listed only the tracked file; `git status --porcelain` listed ` M a`
   and `?? newfile`; `git add -A && git diff --cached --stat` listed both. So any "what did the
   repair change" capture must use `git status --porcelain` or `git add -A` + `--cached`
   (or `git diff --no-index`/`ls-files -o`), not bare `git diff`. Also, a snapshot taken at the end of the repair session
   is the only point at which repair edits are separable from the worker's: before the repair
   the worker's edits may already be in the tree (a post-task repair), after it they mix.
8. **`z.toJSONSchema` exists in the installed zod.** Installed zod is 4.5.4
   (`node_modules/zod/package.json`), and the repo already calls it at `agent-invoke.ts`
   (`buildSessionOptions`, `z.toJSONSchema(roleCfg.envelopeSchema)`, with a `delete schema.$schema`
   workaround). So an event/summary schema in zod can emit JSON Schema for adopters with no new
   dependency. Caveat from the same call site: the `$schema` URI zod stamps on the root had to be
   stripped for Claude Code; adopters' validators may want it kept.

### F2. Additional facts surfaced while checking

- `status` `live` and liveness: see F1.5. For a single run, "is it running right now" is
  unanswerable from the record; "unfinished" means "has no outcome", which is also what a
  killed run looks like (`status-command.ts:86-91`).
- `terminate()` writes the outcome before teardown (`surface.ts:99-102`); `outcome.at` is
  therefore a time before the worktree removal, and a crash between the two leaves a run with
  an outcome and a live worktree.
- `delivery run --task` (single) and a sequential list produce no run-level record at all
  (`queue.ts:279`); an overnight sequential list is only reconstructable by listing task
  records and matching `taskDef` to the config list (`queue.ts:43`, `status-command.ts:446-448`).

### F3. Re-running after an escalation, and what a stopped run keeps (critic query)

- `delivery resume` refuses any record with an outcome (`resume-command.ts:36`).
- In a task list, `stillToTake` counts only `closed` as done (`queue.ts:47-57`), but `findQueueRun` returns the task's existing escalated run, and `drive` then RETELLS it via `reportOutcome` (`queue.ts:314-320`) rather than starting a fresh run. A fresh run starts only when the entry's `taskDef` no longer deep-equals an earlier run's (amend or replace the entry). Re-running unchanged just re-reports and, at concurrency 1, stops at it (`queue.ts:322`).
- An ad hoc `delivery run --task` ignores finished runs (`run-command.ts:46`) and starts a new run under a new id, hence a new branch `surface/<runId>` (`provision.ts:10-12`); no clash with the kept branch. `provisionWorktree` deletes a same-named leftover branch only for the same id (`provision.ts:50-58`).
- Escalated/aborted: built-in closers tear down with `git worktree remove --force`, no commit; the branch is kept at the base commit and holds none of the run's uncommitted edits (`closer-support.ts:36-65`). The worker has `Bash` (`role-config.ts:75`) so its own `git commit` would survive on the branch (ASSUMED possible). "Nothing was changed on <base>" (`outcome.ts:113`) is true for built-in closers, not guaranteed for a custom closer, and is per task only.

## F4. Two further verifications (critic request)

- VERIFIED: SDK `total_cost_usd` is the cumulative estimated cost for one `query()` call and covers the same calls as `modelUsage` (main loop, Task subagents, sidechains, compaction). `usage` is MAIN AGENT LOOP ONLY (excludes subagent, sidechain and auxiliary calls). Source: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (SDK 0.3.266), result-message doc comments near lines 4993-5001. The harness never resumes sessions (`src/agent-invoke.ts:195-197`), so each `invoke()` total is that session's own spend. The d.ts says resumed sessions "start fresh" while the docs say later versions carry earlier spend; irrelevant here. Cost is an estimate, not billing.
- VERIFIED (scratch repo, read-only): `git diff --no-index -- /dev/null <path>` renders an untracked file as a new-file patch (`new file mode 100644`, `--- /dev/null`, `+++ b/<path>`, `@@ -0,0 +1,N @@`) and exits 1 (differences found). A capture must treat exit 0 and 1 as success.
