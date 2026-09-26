# Research: Multi-Surface Supervisor (Roadmap Item 10)

Factual foundation for the design phase. Two parts: (1) what the current
codebase actually assumes about single-flight execution, cited file:line; (2)
external facts — locking, git worktree concurrency, circuit breakers, Claude
API concurrency, and the competitive landscape — each cited to a source.

Every claim below is either a direct repo citation or carries a source link.
Nothing here is a design recommendation; that is the product-designer's and
architect's job.

---

## Part 1 — The current codebase's single-flight assumptions

### 1.1 The queue driver is a sequential `for` loop with no concurrency primitive

`src/cli/queue.ts:98-133` (`runQueue`) is a plain `for...of` loop: it reads
`allRuns(repoPath)` once at the top (`queue.ts:104`), then for each `taskDef`
in order calls `startRun`/`resumeRun`/`reportOutcome` and **awaits** the
result before moving to the next task (`queue.ts:111-128`). There is no
`Promise.all`, no worker pool, no queue depth beyond "the array of tasks",
and the loop returns (stops the whole list) the moment one task's exit code
isn't `EXIT.ok` (`queue.ts:125-128`). This is Item 9's shipped sequential
queue; Item 10 lifts exactly this loop to N concurrent slots.

Progress identity is **content-based, not index-based**:
`findQueueRun` (`queue.ts:35-38`) matches a queue entry to a run by deep-
equality of `record.caseFile.header.taskDef`, not by array position — "a
checked-in file is inserted into, reordered and trimmed, and a stored index
would silently skip a new entry or re-run an old one"
(`docs/superpowers/specs/2026-09-17-project-configuration-design.md:471-480`,
corroborated by the comment at `queue.ts:24-33`). `allRuns()` is the read
of every case file under `.delivery/runs/` (referenced at
`project-configuration-design.md:472`); the queue driver takes one snapshot
of it per invocation (`queue.ts:104`) and never re-reads it mid-loop — a
second run of the CLI (or, for Item 10, a second concurrent slot) that
appends a new case file is invisible to a `runQueue` call already in flight.
This snapshot-once behaviour is a seam Item 10 must either preserve
per-slot-fill (re-read before each provision) or explicitly replace.

### 1.2 No repo lock, mutex, or concurrency-limiting dependency exists anywhere in the repo

`grep -rn "lock\|mutex\|semaphore\|p-limit\|p-queue\|proper-lockfile"` across
`src/` (excluding tests) turns up nothing but coincidental substring matches
(`tool-authority.ts` targets/blockedPath, `preview-command.ts` comment). The
only `Promise.all` calls in the whole codebase are for **read-only** parallel
I/O — reading two files at once, gathering already-independent JSON parses
(`case-file.ts:80,111`; `escalation-packet.ts:139`; `prompt-assembly.ts:49`;
`run-gate.ts:77`; `cli/runs.ts:28,56,64`) — never for concurrent writers to
the same resource. `package.json` (`dependencies`) lists only
`@anthropic-ai/claude-agent-sdk`, `@inquirer/prompts`, `commander`, `zod`; no
lock, mutex, or bounded-concurrency package is installed. Item 10 starts from
zero locking infrastructure, in-process or cross-process.

### 1.3 `provisionWorktree` is not safe to call concurrently for two surfaces

`src/provision.ts:44-61` runs, unguarded: `worktree remove --force` on a
possibly-shared stale path, `worktree prune`, `branch -D` on the target
branch, then `worktree add -b <branch> -- <path> <ref>` — four sequential
git invocations with no lock around them. `git-exec.ts:13-16` (`git()`) is a
thin `execFile` wrapper with no serialisation of its own; two concurrent
`provisionWorktree` calls each running `worktree prune` (which walks and can
rewrite `.git/worktrees/` administrative state for **all** worktrees, not
just the caller's) race on the same shared directory. Because branches are
named `surface/<surfaceId>` (`provision.ts:10-12`) and worktree paths are
per-surface, two *different* surfaces provisioning at once do not collide on
the branch or path they create — but they still share the one `.git/`
metadata directory `worktree add`/`worktree prune`/`branch -D` all mutate.
`docs/multi-surface-control-flow.md:78-89` and
`docs/provisioning.md:14-19,114-132` both already name `worktree add`,
`worktree remove`, and the close-time merge as "the contention" requiring a
single repo lock; the code confirms there is currently no such lock, so any
naive N-way concurrent call into `provisionWorktree`/`removeWorktree` today
would race on `.git/` state.

### 1.4 The merge-back closer assumes there is exactly one main checkout, and blocks if it's on the wrong branch

`src/merge-back-closer.ts:74-83`: before merging, the closer reads
`git symbolic-ref --short HEAD` in `ctx.repoPath` (the *main* checkout, not
a worktree) and returns `ERROR` if it isn't already on `ctx.baseBranch`:
"Switching a checkout someone else may be using is not this closer's call."
This is the single most concrete concurrency constraint in the existing
close path: **only one merge can be in flight against the main checkout's
`HEAD` at a time**, because the merge (`git merge --ff-only`,
`merge-back-closer.ts:91`) runs directly against the checked-out working
tree, not a bare/detached ref update. Two surfaces closing "simultaneously"
against the same base branch must be serialised at exactly this operation;
the ff-only merge is itself the conflict probe (`merge-back-closer.ts:85-90`)
and reports `FAIL` (human-decidable, base has diverged) vs `ERROR`
(something in the checkout is in the way) distinctly. `closer-support.ts:26-29`
(`removeWorktree`) similarly runs `worktree remove --force` + `worktree
prune` against the shared repo with no lock. This is the concrete shape of
"the merge serialisation detail" that `multi-surface-control-flow.md:169-171`
leaves open.

### 1.5 Budgets are entirely per-surface today; no run-level or shared counter exists

`src/budgets.ts:32-38` (`DEFAULT_BUDGETS`) and `src/case-file.ts:344-380`
(`deriveBudgetsFromLog`) both operate over **one case file's** `history`
array — there is no cross-case-file aggregation anywhere in `src/`. Every
budget population (`correction`, `gateError`, `gateMaintenance`, `terminus`,
`close`) is counted by re-deriving from a single surface's log
(`case-file.ts:344`), and `incrementBudget`/`updateCursor`
(`case-file.ts:160-172,238-251`) both read-modify-write one surface's
`case.json`. `docs/multi-surface-control-flow.md:104-124` already specifies
the target shape (`gate_maintenance` lifts to run-level, others stay
per-surface); the code has no run-level file, counter, or lock to hold that
new shared state — the run file described in
`multi-surface-control-flow.md:27-48` does not exist in `src/` yet (no
`run-file.ts`, no `RunFile` schema in `src/schema.ts`).

### 1.6 The case-file persistence model Item 10 is told to reuse

`case-file.ts` is single-writer-assumed at the file level: `atomicWriteJson`
(`case-file.ts:17-21`) does `write-to-.tmp` then `rename`, which is atomic
per write but has no read-modify-write protection — `updateCursor`
(`case-file.ts:160-172`) reads `case.json`, patches, and writes back,
un-guarded against a concurrent writer to the *same* `dir`. This is safe
today because exactly one process ever owns one surface's `dir` at a time
(single-surface state machine, `docs/single-surface-control-flow.md:34-36`).
The run file the multi-surface doc proposes
(`docs/multi-surface-control-flow.md:27-48`) is explicitly modelled "with the
same three-part split as the case file" and inherits the same single-writer
assumption — for the run file, unlike a per-surface case file, the "one
writer" is now **the supervisor process itself**, so N surface-driving
coroutines/workers must not write the run file directly; only the supervisor
loop may, which the design needs to make explicit since the pattern isn't
self-enforcing in the code as it stands (nothing stops a naive port of
per-surface `advance()` calls into N parallel loops from each writing shared
run state).

### 1.7 `advance()`/`run()` are the reusable single-surface unit, untouched by Item 10 per the roadmap

`src/surface.ts:761-830` (`advance`, `run`) is pure: it takes `(dir,
location, ports)`, loads state fresh from disk every call, and performs
exactly one transition per `advance()` call (`surface.ts:761-765` comment).
Nothing in `advance`/`run` touches global/module-level state — no shared
mutable variables, no singleton clients — so N concurrent `run()` calls
against N distinct `dir`s are safe **except** where they each internally
call into `provision.ts`/`merge-back-closer.ts`'s unguarded git operations
(§1.3, §1.4). This confirms the multi-surface doc's framing
(`multi-surface-control-flow.md:22-24,60-63`): the supervisor is a new layer
above `surface.ts`, not a rewrite of it — `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:459-461`
lists this as Item 10's explicit dependency ("each surface is an instance of
the single-surface machine").

---

## Part 2 — External facts

### 2.1 Cross-process / in-process locking options for git in Node

- **`git`'s own locking.** Git already takes `index.lock`/`<ref>.lock`/
  `packed-refs.lock` around ref and index mutations, and refuses a second
  writer while one is held (transient, held for milliseconds, cleared on
  completion or on stale-lock timeout). Reported mitigation pattern in the
  wild for concurrent-agent git use: treat a lock collision as transient and
  retry with short exponential backoff (e.g. 200ms→400ms→800ms across 3–5
  attempts) rather than failing outright — GitHub issue discussion cites this
  as "a single retry with ~200ms backoff would succeed in nearly all cases."
  [Agent isolation: worktree — parallel agents lose work due to git lock
  contention + auto-cleanup (anthropics/claude-code#55724)](https://github.com/anthropics/claude-code/issues/55724);
  see also [Git Worktree Conflicts with Multiple AI Agents: Diagnosis and
  Fixes (Termdock)](https://www.termdock.com/en/blog/git-worktree-conflicts-ai-agents)
  and [Codex + git worktrees: avoiding index.lock in multi-agent workflows
  (berry.sh)](https://berry.sh/posts/codex-worktrees-git-locking/).
- **`proper-lockfile`** (npm, `moxystudio/node-proper-lockfile`): an
  inter-process **and** inter-machine lockfile utility. Uses the `mkdir`
  strategy (atomic on any filesystem, including network filesystems, unlike
  `open` with `O_EXCL`), refreshes the lock's `mtime` periodically so
  staleness is detectable, and auto-releases on normal process exit (not on
  `SIGKILL` or a VM fatal crash — a genuinely-crashed supervisor can strand a
  lock, which any design that adopts it must handle, e.g. via the mtime
  staleness check). [proper-lockfile (npm)](https://www.npmjs.com/package/proper-lockfile),
  [node-proper-lockfile README](https://github.com/moxystudio/node-proper-lockfile/blob/master/README.md).
  This is a candidate for the repo-level lock the multi-surface doc already
  names (`multi-surface-control-flow.md:83-89`), and it is cross-process —
  relevant if a supervisor crash-and-restart must not silently double-run a
  ref-mutating op while an orphaned process still holds one.
- **In-process bounded concurrency**: `p-limit` (sindresorhus) — run N
  promise-returning functions with a concurrency ceiling, nothing more.
  `p-queue` — builds a full queue (priority, pause/resume, introspection) on
  top of the same idea. Community guidance: use `p-limit` for a flat
  concurrency cap (fits "worktree-pool size" directly); use `p-queue` if
  priority ordering or pause/resume is also needed.
  [p-limit (npm)](https://www.npmjs.com/package/p-limit),
  [p-queue (npm)](https://www.npmjs.com/package/p-queue).
- **In-process mutex/semaphore**: `async-mutex` — `Mutex` (exclusive) and
  `Semaphore` (up to N concurrent holders) for async JS; ~4M weekly
  downloads, TypeScript-native. Fits an **in-process** single-repo-lock
  around ref-mutating ops if the supervisor runs all N surfaces as
  concurrent async tasks inside one Node process (which the `advance()`
  design already implies is possible, since it has no hidden global state,
  §1.7). Does **not** by itself solve cross-process locking (a second
  supervisor process, or a crash-and-resume process) — that is
  `proper-lockfile`'s job, or the run file's own commit-point discipline.
  [async-mutex (npm)](https://www.npmjs.com/package/async-mutex).

### 2.2 Concurrent git-worktree safety: what's actually safe in parallel, what contends

- Each worktree has its **own index and own `HEAD`**; git enforces that a
  given branch can only be checked out in one worktree at a time (branch-level
  isolation is real and enforced).
- What is **not** isolated: the shared `.git/` object store, loose refs,
  `packed-refs`, and reflogs. Concurrent `git commit`/`git add` *inside*
  distinct worktrees on distinct branches are reported safe in practice (each
  writes to its own index and eventually its own ref), but any operation that
  touches shared ref/packed-refs state — `worktree add`, `worktree remove`,
  `worktree prune`, `branch -D`, a `fetch`/`push` that updates
  `refs/remotes/...`, or a merge that fast-forwards a ref another checkout
  has open — can collide on `index.lock`/`<ref>.lock`/`packed-refs.lock`.
  Root cause named explicitly: "git's single-writer locking model" for the
  shared repository data, even though worktrees prevent branch-level
  corruption. [How to Use Git Worktrees for Parallel AI Agent Execution
  (Augment Code)](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution),
  [git.js pull/fetch/rebase can leave a shared ref lock that wedges every
  worktree (atomantic/PortOS#7513)](https://github.com/atomantic/PortOS/issues/7513),
  [Concurrent pipeline provisioning parks a lane on a transient 'cannot lock
  ref' (Latand/delegatus#2115)](https://github.com/Latand/delegatus/issues/2115).
- An escape hatch some multi-agent tooling takes instead of worktrees: **one
  full clone per agent**, each with its own `.git` directory and lock
  namespace, coordinating only through the shared remote's ref namespace
  (the one place git is designed for concurrent writers) — trades disk and
  clone time for zero shared-lock contention. Relevant as a documented
  alternative, not necessarily the right choice here, since delivery-service's
  provisioning is explicitly worktree-based already
  (`docs/provisioning.md:17-19`).
  [Git worktree conflicts with multiple AI agents (Termdock, cited above)].
- Claude Code's own worktree support (native `WorktreeCreate`/
  `WorktreeRemove` hooks) is a documented precedent for hook-based
  interception of exactly the two ref-mutating lifecycle points this repo's
  `provision.ts`/`closer-support.ts` already isolate into named functions
  (`provisionWorktree`, `removeWorktree`).
  [Run parallel sessions with worktrees (Claude Code docs)](https://code.claude.com/docs/en/worktrees).

### 2.3 Circuit-breaker libraries and fit for a persisted stop-the-world breaker

- **Opossum** (`nodeshift/opossum`, OpenJS Foundation): the established
  Node.js circuit breaker — three-state machine (closed/open/half-open),
  configurable thresholds, rich lifecycle events, Prometheus metrics.
  ~726k weekly downloads, 1,644 GitHub stars. Its docs note an explicit
  "initialize the state of a circuit breaker" use case for **ephemeral**
  containers (Lambda/Knative), implying state is normally **in-process,
  per-instance** — nothing in its documentation describes built-in
  cross-process or persisted-state sharing. [opossum (npm)](https://www.npmjs.com/package/opossum),
  [nodeshift/opossum (GitHub)](https://github.com/nodeshift/opossum),
  [opossum docs](https://nodeshift.dev/opossum/).
- **Cockatiel**: a newer, more popular-by-downloads (~1.73M weekly vs
  Opossum's ~726k) policy library covering circuit breaker, retry, timeout,
  bulkhead, and fallback as composable policies, TypeScript-first.
  [npm trends: opossum vs cockatiel vs others](https://npmtrends.com/brakes-vs-circuit-breaker-js-vs-circuitbreaker-vs-cockatiel-vs-levee-vs-opossum).
- **Fit assessment (fact, not recommendation):** neither library documents
  built-in persistence or cross-process/distributed state sharing. The
  breaker this project needs (`multi-surface-control-flow.md:126-162`) is a
  **field in a persisted run file** (`HEALTHY | DEGRADED | REPAIRING`) that
  must survive a supervisor crash and be read/written as part of the run
  file's own atomic-write discipline — i.e. it is closer to "one more
  denormalised cursor field with its own transition table" (the same pattern
  `case-file.ts`'s `cursor.state` already uses, §1.6) than to "wire in an
  off-the-shelf breaker library's runtime state machine." Both libraries are
  built for **in-process, ephemeral** breaker state protecting a single
  outbound call; this project's breaker is **cross-surface, persisted,
  crash-recoverable, and stop-the-world** (blocks every worker, not just the
  caller that tripped it) — a materially different shape. This is a fact
  about the libraries' documented scope, not a verdict on whether to use one
  as a building block for the *transition logic* only.

### 2.4 Claude Agent SDK / API concurrency and rate-limit facts

(Source: [Rate limits — Claude Platform Docs](https://platform.claude.com/docs/en/api/rate-limits),
fetched 2026-09-26.)

- Two independent limit types: **spend limits** (a hard monthly USD cap per
  organisation — Start $500, Build $1,000, Scale $200,000/month; usage
  pauses entirely, HTTP 429 with **no** `retry-after`, until the next
  calendar month or a tier increase) and **rate limits** (RPM/ITPM/OTPM,
  replenished continuously via a **token-bucket** algorithm, not a fixed
  window).
- Rate limits are enforced **per organisation** (optionally sub-divided into
  per-workspace limits an org admin sets), not per API key and not
  per-agent-session — so N concurrent surfaces under one delivery-service
  run all draw from the **same** shared bucket if they share credentials,
  which is exactly the host-resource-governor problem
  `multi-surface-control-flow.md:96-98,166-168` already names as a distinct,
  separate axis from the per-run worktree-pool cap.
  Example current tier numbers (Build tier, Claude Sonnet 5): 5,000 RPM,
  5,000,000 ITPM, 1,000,000 OTPM. Scale tier: 10,000 RPM /
  10,000,000 ITPM / 2,000,000 OTPM. These are **maximums, not guaranteed
  minimums**, and are enforced "in shorter intervals" (e.g. 60 RPM may be
  enforced as ~1/sec), so bursty concurrent dispatch of N surfaces can hit a
  429 well under the nominal per-minute number.
- **429 handling contract**: a rate-limit 429 always carries a `retry-after`
  header (seconds to wait) plus `anthropic-ratelimit-{requests,tokens,input-
  tokens,output-tokens}-{limit,remaining,reset}` response headers on *every*
  response, giving live headroom visibility without a dedicated call. A
  **spend-cap** 429 is distinguishable by `error.details.error_code ===
  "enforced_spend_limit_reached"` and carries no `retry-after` (retrying is
  futile until the cap resets) — a host governor that treats all 429s
  identically would busy-retry against a spend cap for the rest of the
  month.
- **Prompt caching** materially changes effective throughput per unit of
  ITPM: only *uncached* input tokens count toward the ITPM bucket, so a high
  cache-hit-rate workload (repeated system prompt, tool defs, or task
  context across many surfaces) can sustain far more concurrent throughput
  than the raw ITPM number suggests.
- **Message Batches API** has its own separate rate-limit pool (RPM plus a
  cap on the number of batch requests "in the processing queue" at once —
  e.g. 300,000 on Build tier) — a second-class alternative to synchronous
  Messages calls if the harness ever wants async/batched dispatch instead of
  a live concurrent session per surface, not evaluated further here as it's
  out of this item's scope (single agent sessions per surface, per
  `docs/single-surface-control-flow.md`).
- No API-level cap on the number of *concurrent open connections/sessions*
  is documented separately from the RPM/TPM buckets themselves — concurrency
  is governed entirely by how fast a burst of concurrent requests consumes
  the token-bucket, not by a separate "max concurrent sessions" number. This
  is a fact worth flagging to the architect: the host governor's natural
  unit is *rate*, not *concurrency count*, which is a different shape from
  the worktree-pool's cap (a concurrency count).

### 2.5 Competitive landscape: parallel agent runners and merge serialisation

- **Claude Code's own worktree pattern**: documented first-party support
  (`code.claude.com/docs/en/worktrees`) for running multiple sessions each
  in its own worktree, explicitly to avoid two sessions corrupting a shared
  working directory; subagent/cross-session messaging is separate from
  worktree isolation. Multiple third-party guides converge on the same
  pattern (worktree-per-agent, coordinate only through git).
  [Run parallel sessions with worktrees (Claude Code docs)](https://code.claude.com/docs/en/worktrees),
  [Parallel Agentic Development With Git Worktrees: A Practical Playbook
  (MindStudio)](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees).
- **OpenHands**: two distinct concurrency models at different layers —
  tool-level (`tool_concurrency_limit` on the `Agent` class, e.g. read 4
  files at once within one session) versus **agent**-level, where
  `DelegateTool` runs multiple sub-agents concurrently but `TaskToolSet` runs
  sub-agents sequentially with explicit lifecycle management — i.e. the
  project itself distinguishes "concurrency is free" tools from "concurrency
  needs a scheduler" agent dispatch, echoing this repo's split between
  in-worktree work (free) and ref-mutating ops (locked).
  [Parallel Tool Execution (OpenHands docs)](https://docs.openhands.dev/sdk/guides/parallel-tool-execution),
  [Sub-Agent Delegation and Task Management (DeepWiki)](https://deepwiki.com/OpenHands/software-agent-sdk/3.3-sub-agent-delegation-and-task-management).
- **Devin (Cognition)**: "Managed Devins" — one coordinator session
  decomposes a large task and delegates pieces to N child Devins, each in
  its own **isolated VM** (not a shared-repo worktree pool); the coordinator
  "scopes the work, monitors progress, resolves conflicts, and compiles the
  results" — i.e. Devin sidesteps shared-repo git contention entirely by
  giving each child full environment isolation, closer to the "one clone per
  agent" alternative noted in §2.2 than to this project's worktree-pool
  design. [Devin can now Manage Devins (Cognition)](https://cognition.ai/blog/devin-can-now-manage-devins).
- **Empirical data on concurrent-agent PR conflict rates**: a 2026 study of
  AI-agent-authored PRs on GitHub found 40.2% of sampled repositories show
  parallel agent workflows (multiple agents' branches open simultaneously),
  and 79.4% of all agent-authored PRs are open concurrently with at least
  one other agent's PR — concurrent multi-agent PR traffic is already the
  common case in the wild, not an edge case. [AI Agent Pull Requests on
  GitHub: Frequency, Structure, and Merge Conflict Rates
  (arXiv:2607.04697)](https://arxiv.org/pdf/2607.04697).
- **CI merge queues as the closest existing pattern for serialising merges
  onto a moving base**:
  - **GitHub Merge Queue** (GA since 2023): serialises PR merges, tests each
    PR (or a batch) against an up-to-date base, only fast-forwards when CI
    passes against the *actual* combined result — i.e. it revalidates
    against a moving target rather than trusting a stale pre-merge check,
    which is the same problem this repo's `merge-back-closer.ts:85-104`
    solves with its `--ff-only` probe distinguishing "diverged, needs a
    human" (`FAIL`) from "checkout blocked" (`ERROR`).
  - **Bors-NG**: pioneered "test the merge result before merging" for
    Rust's infra; as of 2026 is in maintenance mode, with most teams having
    migrated to GitHub's native queue or a commercial alternative — a signal
    that a bespoke merge-queue implementation is no longer the industry
    default, native/managed options have displaced it.
  - **Mergify**: commercial layer over merge queues adding priority lanes,
    per-label parallel queues (so unrelated work doesn't serialise behind
    each other), batching with bisection on failure, and two-step CI
    (light check pre-queue, full suite in-queue).
  [What Is a Merge Queue? (Mergify)](https://mergify.com/learn/merge-queue),
  [The Origin Story of Merge Queues (Mergify)](https://mergify.com/blog/the-origin-story-of-merge-queues),
  [GitHub Merge Queue in 2026 (Tenki)](https://tenki.cloud/blog/github-merge-queue-setup).
- **Take for the architect (fact, not a verdict)**: every external precedent
  that serialises merges onto a shared, moving base revalidates against the
  *current* tip at merge time rather than trusting a pre-computed diff —
  this repo's `--ff-only` + ancestry-probe approach
  (`merge-back-closer.ts:62-113`) already does this for a single surface;
  the open question for N concurrent surfaces is purely the **queueing**
  discipline around that existing, already-correct single-merge operation
  (FIFO per repo lock vs. priority lanes vs. batching), not the merge
  mechanics themselves.

---

## Summary for the design team

- The sequential queue (`queue.ts`), the case-file persistence model
  (`case-file.ts`), and the single-surface machine (`surface.ts`) are all
  reusable as-is; the concurrency gap is entirely in **new** code: a
  supervisor loop, a run file, a repo lock around `provision.ts`'s and
  `merge-back-closer.ts`'s git calls, and run-level budget storage — none of
  which exist today (§1.1–§1.6).
  - The 2026-09-04 roadmap spec itself: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:443-476`.
  - The existing plan: `docs/multi-surface-control-flow.md` (open items at
    its foot, §Part 1 above resolves what the code currently assumes about
    each).
- `proper-lockfile` (cross-process) and `async-mutex`/`p-limit` (in-process)
  are the two ends of a real design choice the architect must resolve:
  whether the repo lock needs to survive a supervisor process crash-and-
  restart (favouring `proper-lockfile`, or the run file's own commit
  discipline) or only needs to hold within one live supervisor process
  (favouring `async-mutex`, simpler, no stale-lock cleanup problem) — see
  §2.1.
- Circuit-breaker libraries (Opossum, Cockatiel) are built for in-process,
  ephemeral, single-call protection; this project's breaker is a persisted,
  cross-surface, crash-recoverable field in the run file — a materially
  different shape neither library documents solving directly (§2.3).
- The Claude API's rate-limit unit is **rate** (RPM/ITPM/OTPM via token
  bucket, org-wide), not a concurrent-session count — the host governor's
  natural control variable is different in kind from the worktree pool's
  concurrency-count cap, and the two 429 causes (rate vs. spend cap) need
  different handling (§2.4).
- Every external precedent for merge serialisation onto a moving base
  revalidates at merge time rather than trusting a stale diff — this repo's
  merge-back closer already does that for one surface; Item 10's job is the
  queueing discipline around it, not new merge mechanics (§2.5).

---

*Prepared by the researcher, team `multi-surface-supervisor-design`,
2026-09-26. All Part 1 claims are direct repository citations (file:line);
all Part 2 claims carry a source link. Available for fact-checking via
`SendMessage` for the remainder of this design phase.*
