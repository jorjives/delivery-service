# Close Interface — Research

> Roadmap Item 6. Factual foundation only — no design decisions. Every in-repo
> claim is cited `file:line`; every external claim is cited by URL.

## 1. Roadmap framing (Item 6)

`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:237-268`

- **Delivers:** a pluggable close action that runs after acceptance, separating
  "work is correct" (the gate) from "do something with it" (merge, open PR,
  cleanup, teardown).
- **Success criteria:** registerable/invokable close implementation; close
  failure routes to close-triage, not back to the worker; close is idempotent
  under replay (crash between accept and close re-runs close safely);
  non-accept terminals (`ESCALATED`, `ABORTED`) can invoke the closer for
  teardown as fire-and-log.
- **Dependency:** the single-surface state machine (closing is a node in the
  machine) — already built.
- **Notes:** a reference closer (merge-back or open-PR) "would make the
  harness useful out of the box."
- **DX:** ships with a "writing a closer" guide mirroring the Item 2 gate
  guide; the reference closer is the example.
- **Accessibility:** built-in closers (merge-back, open-PR, commit-to-branch)
  must be selectable by configuration, not only by code — a non-technical
  project owner should be able to say "when work is accepted, open a pull
  request."

### Two-audience context (roadmap, `Context` section, lines 13-45)

Two personas the roadmap holds throughout: **harness extenders** (engineers
who write gate/closer/agent code, comfortable with contracts and schemas) and
**project owners** (may be non-technical, want a declarative "what happens
when work is accepted" answer without writing code). Item 6 is explicitly
named, alongside Item 2, as one of "the two plug points" both audiences must
be able to use — extenders write closers, owners select built-in ones by
config.

`docs/personas.md` gives three concrete personas from Item 5's design work
(team-derived, not human-ratified): Priya Shah (harness extender, wires
config, reads case-file log entries rather than source), Marcus Webb
(on-call engineer, reads `EscalationPacket`s), Dana Okafor (non-technical
project owner, wants a plain-language "does this need me" summary). None of
the three is closer-specific, but Priya's bar ("no source-reading to get a
role working") and Dana's bar ("packet doesn't actively mislead her") both
apply directly to how a close failure surfaces.

## 2. Current in-repo state

### 2.1 `CloserPort` contract — exact types

`src/ports.ts:96-132`:

```typescript
export interface CloseContext {
  worktreePath: string;
  dir: string;
}

export interface CloseOutcome {
  kind: "accepted" | "escalated" | "aborted";
}

export interface CloseReport {
  status: "DONE" | "FAIL" | "ERROR";
  detail: string;
}

export interface CloserPort {
  close(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport>;
}
```

The no-op closer, `noopCloser`, lives in the same file, `src/ports.ts:126-132`:

```typescript
export const noopCloser: CloserPort = {
  close: () =>
    Promise.resolve({ status: "DONE", detail: "no-op closer (Item 6 ships real closers)" }),
};
```

Its doc comment (`src/ports.ts:120-125`) states it "reports DONE and performs
no infra work. The worktree is deliberately left in place for inspection —
real teardown is Item 6's, and orphan collection Item 10's." `SurfacePorts`
(`src/ports.ts:135-139`) bundles `agent`, `triage`, `closer` — the driver is
called with all three; there is no separate "closer resolution" registry
today (contrast with gates, §2.3).

### 2.2 How `surface.ts` calls the closer

Three call sites, all in `src/surface.ts`:

1. **`closing` (CLOSING node), `src/surface.ts:552-579`.** Called with
   `{ kind: "accepted" }` after `GATING` passes. The report's `detail` is
   persisted via `writeRef(dir, \`close-${priorCloses}\`, report)` where
   `priorCloses = caseFile.history.filter(e => e.t === "close").length`
   (`src/surface.ts:569-570`) — the ref key is namespaced by count-of-prior-
   `close`-entries specifically so a retried close cannot overwrite the ref an
   earlier attempt still points at (comment at `src/surface.ts:555-556`).
   `appendEntry(dir, { t: "close", status: report.status, detailRef })` is
   then written (`src/surface.ts:571`). `status !== "DONE"` routes to
   `TRIAGE` (`src/surface.ts:573-576`); `DONE` calls `closed(dir, report.detail)`
   (`src/surface.ts:578`) which writes the terminal `CLOSED` outcome
   (`src/surface.ts:585-591`).

2. **`terminate` (ESCALATED/ABORTED), `src/surface.ts:49-71`.** Called
   fire-and-log with `{ kind: outcome.kind }` (`"escalated"` or
   `"aborted"`) *after* `setOutcome`/`updateCursor` have already recorded the
   terminal state (`src/surface.ts:59-60, 64-68`). A thrown/rejected close is
   caught and only `console.warn`'d (`src/surface.ts:69-70`) — never re-triaged,
   because "the surface is already terminal" (doc comment,
   `src/surface.ts:50-51`).

3. **Resume-from-crash, `advance`'s `CLOSED` branch, `src/surface.ts:718-721`.**
   If the log tail already shows `CLOSED` position but the outcome write did
   not complete, resume calls `closed(dir, "the closer accepted the work
   (outcome recorded on resume)")` directly — it does **not** call
   `ports.closer.close` again. This is the concrete mechanism behind the
   roadmap's "idempotent under replay" criterion for the accept path: the
   close action itself is recorded as a log entry before the terminal outcome
   is written, so a resumed surface never re-invokes the closer for a close
   that already happened; it only re-invokes on a *new* transition into
   `CLOSING` (a fresh `retry_close` verdict from triage).

`position()` (`src/surface.ts:38-42`) derives current state from the log tail
via `deriveStateFromEntry`, which is why the `CLOSED`-branch-without-rerun
above is reachable at all: a case file whose tail is a `close` entry with
`status: "DONE"` derives to `CLOSED` on the next `advance` call before
`closed()` is invoked a second time from `closing()`.

### 2.3 Gate resolution pattern (built-in vs custom) — the precedent for closer resolution

`GateRef` is a zod discriminated union on `type`, stored in the case file
header, pinning the gate for the surface's lifetime
(`src/schema.ts:36-49`, and design intent at
`docs/superpowers/specs/2026-09-04-gate-interface-design.md:203-210`):

```typescript
export const GateRef = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), command: z.string(), parseMode: z.enum(["tap","junit","exitcode"]), failOnNewAssertions: z.boolean().optional() }),
  z.object({ type: z.literal("custom"), modulePath: z.string(), exportName: z.string().optional(), failOnNewAssertions: z.boolean().optional() }),
]);
```

`resolveGate(gateRef, baseDir?)` (`src/resolve-gate.ts:14-26`) is pure and
total: `GateRef.safeParse` first; on parse failure it returns a
`failedGate(...)` (a `Gate` whose both methods return an ERROR report,
`src/gate-support.ts`) rather than throwing — "resolution failure and run
failure reach the caller in the same shape" (doc comment,
`src/resolve-gate.ts:9-10`). On success it switches on `ref.type`:
`"command"` → `createCommandGate(ref.command, ref.parseMode)`
(`src/command-gate.ts:96-104`, wraps `execFileCb("/bin/sh", ["-c", command], ...)`
via a hand-rolled `exec` helper, `src/command-gate.ts:26-51`, timeout default
300_000 ms); `"custom"` → `createCustomGate(ref.modulePath, ref.exportName,
baseDir)` (`src/custom-gate.ts:82-99`).

`createCustomGate` is a **lazy-loading, guarding wrapper**: it does not import
the module until first use (`gate ??= loadCustomGate(...)`,
`src/custom-gate.ts:92`), and every call is wrapped so a thrown/rejected
custom implementation, or one returning a schema-invalid `GateReport`, becomes
an `ERROR` report rather than an uncaught exception
(`guard()`, `src/custom-gate.ts:14-34`; `errorReport` on catch, and
`GateReport.safeParse` validation before trusting the return value).
`loadCustomGate` (`src/custom-gate.ts:44-73`) resolves `modulePath` against
`baseDir` (default `process.cwd()`) with `resolve()` +
`pathToFileURL(...).href`, dynamic `import()`s it, reads the named export
(default `"default"`), and throws typed errors — `GateModuleLoadFailure`
(import failed) or `InvalidGateExport` (export missing or missing a required
method) — both **before** any gate method is ever called
(`src/custom-gate.ts:56-73`, error classes at `src/errors.ts:69-79`).

This is the closest existing precedent for "closer resolution": a
discriminated-union `*Ref` type stored in config/header, a pure `resolve*`
function returning a uniform interface, built-in variants implemented
directly, and a `custom` variant that dynamically imports a user module and
wraps all its failure modes into the port's own report shape so the harness
never has to special-case "resolution failed" vs "invocation failed."
`docs/superpowers/specs/2026-09-04-gate-interface-design.md:268-364` documents
the `GateResolver = (ctx: GateContext) => Promise<Gate>` type and enumerates
what belongs to gate resolution vs explicitly defers "Gate configuration via
CLI or project config file" to Items 8/9 — the same deferral the Item 6
roadmap entry makes for closer *selection* by config (accessibility note,
roadmap lines 265-268), i.e. Item 9 is expected to be where the declarative
surface lands, not Item 6 itself (Item 6 builds the contract + reference
implementations; Item 9 composes them into non-code selection).

### 2.4 Provisioning: worktree/branch creation, and what teardown exists today

`src/provision.ts` — `branchName(surfaceId) => \`surface/${surfaceId}\``
(`src/provision.ts:14-16`, "settled by the single-surface state machine
design: pure, deterministic, and stored nowhere, so it can never drift from
the surface id it is derived from"). `provisionWorktree(dir, repoPath,
worktreePath, surfaceId)` (`src/provision.ts:47-71`):

1. `resolveBaseRef(repoPath)` — reads `origin/HEAD` via
   `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to the
   checked-out `HEAD` if there is no origin (`src/provision.ts:33-40`).
2. Tears down any pre-existing wreckage for this surface unconditionally,
   before creating anything: `git worktree remove --force -- <worktreePath>`,
   `git worktree prune`, `git branch -D -- <branch>` — all via `tryGit`, which
   swallows failure ("nothing to remove is the common case",
   `src/provision.ts:22-29`).
3. `git worktree add -b <branch> -- <worktreePath> <baseRef>`
   (not swallowed — a genuine failure here throws `ProvisioningFailure`).
4. Returns `{ restarted: boolean }` reporting whether step 2 actually removed
   something.

This function is explicitly idempotent-by-reconstruction, not
idempotent-by-detection: it always tears down and recreates rather than
"detecting already provisioned and skipping" (doc comment,
`src/provision.ts:42-46`). There is **no merge-back, no PR-open, and no
worktree-removal-on-success** anywhere in `src/provision.ts` or `src/surface.ts`
today — the only "teardown" that exists is the wreckage-clearing step above,
which runs only on the *next* provision of the *same* surface id, not on
close. `docs/provisioning.md:31-33` states plainly: "The closer's 'docker
teardown' is likewise the project's teardown hook; from the harness's side,
releasing a surface is `worktree remove` and nothing else" — i.e. the design
intent is that Item 6's closer, on a terminal outcome, is responsible for
`git worktree remove` (and, by the branch-naming symmetry with provisioning's
own cleanup, plausibly `git branch -D`), and that is not built yet.
`docs/provisioning.md:88-90` also notes an **open, unbuilt** "orphan
collection" concern (a worktree with no owning case file header) explicitly
deferred to a supervisor-level sweep, not Item 6's job.

### 2.5 `git-env.ts` — why every git-spawning call needs `cleanGitEnv()`

`src/git-env.ts:1-16`. `cleanGitEnv()` strips every `GIT_*` env var from
`process.env` before handing it to a spawned `git` process. Rationale in the
doc comment: `cwd` alone does not pin a spawned `git` process to a given
repository, because any inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`
etc. overrides discovery regardless of `cwd` — and git itself sets these when
invoking hooks, so a helper that only passes `cwd` "silently targets the
wrong repository the moment it runs inside a hook (e.g. this repo's own
`pre-push`, which runs the test suite)." `provision.ts`'s `git()` helper
already applies this (`src/provision.ts:18-20`, `env: cleanGitEnv()`); any
new git-spawning code for the closer (merge-back, worktree remove, branch
delete) must do the same — this is an existing, enforced convention, not a
new decision.

### 2.6 `retry_close` today, and where `CloseRepairBrief` is persisted

`retry_close` is one of six triage verdicts
(`TriageVerdict.verdict`, `src/ports.ts:73`). It is legal **only** for the
`close_failure` trigger — `src/triage.ts:15` (`close_failure: new Set(["retry_close", "escalate", "abort"])`),
mirrored in the deterministic router's per-trigger rule table
(`src/router.ts:14-21`: `close_failure: { budget: "close", helpful: "retry_close" }`).
`needsJudgement` (`src/triage.ts:37`) treats `close_failure` as needing an
agent's judgement only when exactly one `close` budget slot remains
(`left(b.close) === 1`) — otherwise it is a free/automatic retry.

Routing: `TRIAGE → CLOSING` on `retry_close`
(`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md:483`:
"`retry_close` returns to `CLOSING`"). The `close` budget population is
derived purely from the log — "`close` ← count of `triage` entries with
`verdict: 'retry_close'`"
(`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md:163-165`,
also stated as settled fact at
`2026-09-07-single-surface-state-machine-design.md:715`) — there is no
separate `incrementBudget` call; the `triage` entry append *is* the burn
(`2026-09-07-single-surface-state-machine-design.md:472`).

`CloseRepairBrief` is defined as a **type alias**, not a new schema:
`docs/superpowers/specs/2026-09-10-triage-and-router-design.md:200`:
`export const CloseRepairBrief = SharpenedBrief;`. It appears in the
`retry_close` verdict shape at line 156: `{ status: "retry_close"; rationale:
string; payload: CloseRepairBrief }`, and the discriminated schema union entry
at line 215. Persistence is explicit and narrow
(`2026-09-10-triage-and-router-design.md:392-395`): *"`retry_close`'s
`CloseRepairBrief` is persisted in the ref only: the closer is not an agent,
so there is no dispatch to thread it to until Item 6 decides otherwise."* In
other words: today, a `retry_close` verdict's payload is written to the
`triage-<n>` ref (`writeRef`, keyed by count of prior `triage` entries per
`2026-09-07-single-surface-state-machine-design.md:472-474`) exactly like any
other triage artifact, but **nothing currently reads it back and threads it
into the next `closing()` call** — `closing()` (`src/surface.ts:552-579`)
takes no brief/context parameter beyond `dir`, `caseFile`, `location`,
`ports`. Whether/how Item 6 makes use of that persisted brief (e.g. passing
repair guidance into `CloseContext`, or leaving it purely for a human reading
the case file) is exactly the open question the triage design left for this
item to decide — it is not resolved anywhere in the codebase today.

The `TriageInput.trigger` value the closer failure produces is
`"close_failure"` (`src/ports.ts:57`, `docs/.../single-surface-state-machine-design.md:454-457`:
"`FAIL`/`ERROR`: appends the `close` entry, routes to `TRIAGE` with trigger
`close_failure` (the narrow router — only `retry_close` or `escalate` are
legal verdicts here, enforced by `TriagePort`'s own contract, not by this
driver)"). Note precisely: **both** `CloseReport.status` values `"FAIL"` and
`"ERROR"` route identically to `TRIAGE` with `close_failure` — the closer
contract does not distinguish "close ran and failed" from "close could not
run" the way the gate contract distinguishes `FAIL` from `ERROR` for routing
purposes (gate `ERROR` has its own `gate_error` trigger and its own
`gateError` budget/`recheck_gate` verdict, `src/router.ts:14-21`); no such
split exists for close today.

## 3. Git mechanics for merge-back from a worktree

### 3.1 Fast-forward vs merge commit

- `git merge --ff-only <branch>` fast-forwards the current branch to
  `<branch>`'s tip if the current branch is a strict ancestor of it; if a
  fast-forward is not possible (history has diverged) the command fails
  immediately with no merge commit and no working-tree changes — this is the
  standard "refuse to create a merge commit" flag.
  [git-merge docs](https://git-scm.com/docs/git-merge/2.13.7)
- Without `--ff-only`, `git merge` will create a merge commit whenever a
  fast-forward is not possible (or is suppressed with `--no-ff`); this is the
  "merge commit" path referenced in the roadmap's "merge-back" closer.
- `git merge-base --is-ancestor <A> <B>` exits `0` if `A` is an ancestor of
  `B` (including `A == B`), `1` otherwise — the standard scripted check for
  "is this branch's work already fully contained upstream," and per
  the man page is designed for exactly this kind of script use.
  [git-merge-base docs](https://git-scm.com/docs/git-merge-base)

### 3.2 Conflict detection

A `git merge --ff-only` attempt that cannot fast-forward exits non-zero
without touching the working tree — the safest possible probe for "would this
merge conflict," because it never partially applies. A full three-way
`git merge` (no `--ff-only`) that hits real content conflicts leaves the
working tree in a conflicted state (unmerged paths, conflict markers) and
exits non-zero; recovering cleanly requires `git merge --abort` before any
further automated step, since a worktree left mid-conflict is not safe to
hand back to a subsequent gate run or another closer invocation.
`git merge-tree` (modern form, `--write-tree`) can pre-flight a merge's
conflicts without mutating any branch or the working tree at all — closest
tool to "detect conflicts with zero side effects" — documented conflict
output format built for scripting.
[git-merge-tree docs](https://git-scm.com/docs/git-merge-tree)

### 3.3 Worktree removal and branch deletion

- `git worktree remove [--force] <path>` — the same primitive
  `provision.ts` already uses for teardown-before-recreate
  (`src/provision.ts:57`, via `tryGit`); `--force` is required if the
  worktree has uncommitted changes or is locked.
  [gitworktree.org merge tutorial](https://www.gitworktree.org/tutorial/merge)
- `git worktree prune` clears stale administrative files after a worktree
  directory has been removed by other means — already used in
  `src/provision.ts:58` after the forced remove.
- `git branch -d <branch>` (lower-case) refuses to delete a branch git does
  not consider merged into the current branch — a **built-in idempotent
  safety check** for exactly the "is it safe to delete this branch" question,
  as opposed to `-D` (force) which `provision.ts` already uses for
  wreckage-clearing (`src/provision.ts:59`) precisely because provisioning's
  teardown case must not be blocked by that safety check. A merge-back closer
  wanting the safety check gets it for free by preferring `-d` over `-D` after
  a successful merge.

### 3.4 Making each step idempotent under replay

The general pattern the codebase already uses (provisioning: tear down and
recreate; surface.ts CLOSING: log the close action before the terminal write
so a resumed run never re-invokes on an already-completed close) suggests two
complementary idempotency strategies available to a merge-back closer:

- **Detect-then-skip, via `git merge-base --is-ancestor`:** before attempting
  a merge, check whether the surface branch's tip is already an ancestor of
  the base branch's tip. If so, the merge already happened (e.g. crash after
  merge, before worktree removal) and the closer can safely proceed straight
  to cleanup (worktree remove, branch delete) and report `DONE`, without
  re-running `git merge` (which would either no-op or error depending on
  state, but is unnecessary work and a second chance to fail).
- **Detect-then-skip, via ref existence:** if the worktree or branch has
  already been removed (e.g. crash after full cleanup, before the surface's
  own `close` entry + outcome were durably written — the same crash window
  `src/surface.ts:716-721` already handles for the *surface's own* replay),
  a second closer invocation for the *same accepted outcome* should treat
  "nothing left to merge, nothing left to clean up" as success rather than an
  error, since `git worktree remove` on a non-existent path is the exact
  failure `provision.ts`'s `tryGit` already tolerates by design
  (`src/provision.ts:22-29`).
- Both of these push the idempotency logic **into the closer**, not the
  surface driver — the surface's own idempotency guarantee (never re-invoking
  `close` for an already-`CLOSED` surface) is already built and is a distinct,
  narrower guarantee: it protects against re-running a closer that already
  reported `DONE`, not against a closer being asked to redo partial git state
  from a crash *inside* its own single invocation. The `CloseOutcome`/
  `CloseReport` contract has no fields for "resume token" or "which step got
  to" — a closer implementation that wants sub-step resumability must derive
  it from git state itself (ancestor checks, ref existence), the same way
  `provisionWorktree` derives "was there wreckage" from git state rather than
  from any persisted flag.

## 4. Opening a PR: `gh` CLI vs Octokit

### 4.1 `gh pr create`

`gh pr create --base <branch> --head <branch> --title ... --body ...` opens a
PR from the CLI; run from a directory whose git config already identifies the
right repo (matching the existing execFile-in-cwd pattern the repo already
uses for `git`, e.g. `src/command-gate.ts`, `src/provision.ts`).
[gh pr create manual](https://cli.github.com/manual/gh_pr_create)

### 4.2 Detecting an existing PR for a branch

The standard idempotent-check pattern, confirmed by both the manual and a
`cli/cli` maintainer discussion:
`gh pr list --head "<branch>" --state open --json url --jq '.[].url'` — a
non-empty result means a PR already exists for that head branch, and the
create step should be skipped (report `DONE` referencing the existing PR
URL) rather than attempted a second time. `gh pr create` itself, when a PR
already exists for the branch, fails with a message of the form "a pull
request for branch '<head>' into branch '<base>' already exists" rather than
silently opening a duplicate — so even without a pre-check, the failure mode
is detectable by parsing that message, though checking first via `gh pr list
--head` is the documented, structured (`--json`) way to do it rather than
string-matching an error.
[cli/cli discussion #5792](https://github.com/cli/cli/discussions/5792),
[gh-pr-create manual](https://cli.github.com/manual/gh_pr_create)

`gh pr view <branch>` is the equivalent single-PR lookup when the branch name
is already known and only its existence/URL is wanted, rather than a list.

### 4.3 Exit codes and auth failure modes

`gh`'s exit codes were standardised from gh 2.0 (August 2021) onward; general
guidance is that a non-zero exit signals command failure and specific
commands may layer additional codes on top, per the command's own help text —
no single universal table covers every subcommand.
[fixdevs.com gh CLI troubleshooting](https://fixdevs.com/blog/gh-cli-not-working/)

Documented auth failure modes relevant to a closer that needs to run
unattended:
- Missing/expired token or missing scope: commands needing scopes the current
  token lacks (e.g. cross-fork operations, or project-linking) fail with a
  403-class error until re-authenticated with the right scope, e.g.
  `gh auth refresh -s project`.
  [fixdevs.com](https://fixdevs.com/blog/gh-cli-not-working/)
- CI/Action environments are a documented common failure surface: `gh pr
  create` succeeding locally but failing in CI is typically a
  permissions/token-scoping mismatch (the workflow's `GITHUB_TOKEN` lacking PR
  write scope, or branch protection), not a `gh` bug.
  [GitHub community discussion #144831](https://github.com/orgs/community/discussions/144831)
- A closer implementation needs to treat "gh not authenticated" /
  "insufficient scope" as its own distinguishable failure (`ERROR`, likely —
  infra-class, not a content problem) versus "PR create rejected for a
  content reason," since the former is not something a `retry_close` retry
  can fix and the latter might not be either, but the two have different
  diagnostic value in the `CloseReport.detail` a human eventually reads.

### 4.4 `gh` CLI vs Octokit

- `gh` CLI: shells out, reuses the operator's existing `gh auth login`
  session/token, zero new npm dependency, matches the repo's existing
  "spawn a subprocess" pattern for git itself (`src/git-env.ts`,
  `src/provision.ts`, `src/command-gate.ts` all shell out rather than use
  a library). Downside: another external binary dependency (like `git`
  itself, which the harness already requires), and its own auth state to
  diagnose (§4.3).
- Octokit (`@octokit/rest` or `octokit`): an in-process HTTP client against
  GitHub's REST/GraphQL API, needs its own token management (a PAT or GitHub
  App installation token) independent of the operator's `gh` CLI session,
  and is GitHub-specific — it has no answer for GitLab/Bitbucket/self-hosted
  Forgejo remotes, whereas `gh` itself is also GitHub-specific but at least
  matches a pattern (`git`-like CLI wrapping) the repo could extend to other
  hosts' own CLIs (`glab` for GitLab) with the same integration shape.
  Trade-off is standard "CLI dependency + operator's own auth" vs
  "library dependency + explicit credential plumbing the harness itself must
  manage and store somewhere" — no in-repo precedent leans either way, since
  nothing in this codebase talks to GitHub's API today.

## 5. How comparable tools close work

- **Aider** is git-first but not close-oriented in the harness sense: every
  AI edit is auto-committed as a small, revertible commit on the user's
  existing branch; there is no separate "merge back" or "open PR" step baked
  into its own workflow, because it operates directly on the user's real
  working tree rather than an isolated worktree/branch a harness later needs
  to reconcile.
  [wetheflywheel.com OpenHands vs Aider](https://wetheflywheel.com/en/comparisons/openhands-vs-aider/)
- **SWE-agent / OpenHands**: the dominant pattern is autonomous PR creation —
  the agent reads a GitHub issue, writes a patch, runs tests, and opens a
  pull request; a second common OpenHands mode is "PR finishing" (given an
  existing open PR, the agent clones, reads failing CI, fixes, and pushes
  further commits to the same PR branch) rather than merging directly.
  [openhands.dev blog](https://www.openhands.dev/blog/open-source-ai-coding-agents),
  [toolhalla.ai comparison](https://toolhalla.ai/blog/devin-vs-openhands-vs-swe-agent-2026)
- **GitHub Copilot coding agent**: creates a dedicated `copilot/`-prefixed
  branch per assigned issue, opens a **draft** PR immediately (before work is
  complete), pushes further commits to the same branch as it iterates, and
  updates the PR body/description with status as it works — i.e. "open PR"
  happens at the *start* of work, not as a terminal close action, and the PR
  stays a draft (human-in-the-loop review gate) rather than auto-merging.
  [github.blog: coding agent 101](https://github.blog/ai-and-ml/github-copilot/github-copilot-coding-agent-101-getting-started-with-agentic-workflows/),
  [github.blog: idea to PR](https://github.blog/ai-and-ml/github-copilot/from-idea-to-pr-a-guide-to-github-copilots-agentic-workflows/)
- Common thread across all of these: none auto-merges to the base branch by
  default; "open PR, leave for human review" is the dominant close action in
  the wild, "merge-back directly" is the harness's own more autonomous
  option per its accepted-work gate already having done the correctness
  check the human reviewer would otherwise be standing in for. This is a
  meaningful contrast worth the design phase weighing explicitly: the
  harness's premise (a deterministic gate already verified correctness) is
  precisely what would justify auto-merge where these other tools cannot
  assume it.
- No public "Sweep" or generic "autoloop-style harness" close-mechanics
  documentation surfaced distinct enough from the above to add new fact,
  beyond the general merge-vs-PR split already covered.

## 6. Candidate libraries and execution mechanism

**The repo has no `execa`, `simple-git`, or `isomorphic-git` dependency
today** (checked `package.json`; only devDependencies are eslint/tsx/
typescript/vitest/@types/node, `package.json:16-24`). Every existing
git-spawning call in the codebase uses raw `node:child_process`:
`execFile` promisified via `node:util`'s `promisify` in `src/provision.ts:1-2,
18-20`, and a hand-rolled `execFileCb`-based `exec()` for the command gate in
`src/command-gate.ts:1, 26-51` (with its own timeout/maxBuffer/signal-vs-
exit-code handling). This is a strong, load-bearing precedent — a "right
choice" check for Item 6 must weigh continuing the same raw
`node:child_process`/`execFile` approach (zero new dependency, exact control
over `env: cleanGitEnv()` which is already an enforced convention,
consistency with the two existing call sites) against a library.

- **`simple-git`**: a thin promise wrapper over the system `git` binary
  (still shells out, still needs `git` installed) — would reduce the
  hand-rolled `execFile`/promisify boilerplate for the closer's own git calls
  but does not remove the "spawn a process, needs `env` control" concern
  (`cleanGitEnv()` still applies), and introduces a first new runtime
  dependency the two existing git call sites don't have. Recommended by
  general trade-off writeups for "CI scripts, CLIs, and Node tools running on
  machines that already have git installed" — exactly this harness's
  situation.
  [npm-compare simple-git vs isomorphic-git vs nodegit](https://npm-compare.com/isomorphic-git,nodegit,simple-git)
- **`isomorphic-git`**: pure-JS reimplementation of git, no system binary
  required, works in-browser — irrelevant advantage for a Node-only,
  filesystem-worktree-based harness that already assumes a system `git`
  binary for provisioning; recommended instead for "browser tools, sandboxed
  runtimes, apps that cannot assume a system git binary" — not this harness's
  situation, and likely slower/less complete for the merge/conflict-detection
  operations this item needs.
  [npm-compare](https://npm-compare.com/isomorphic-git,nodegit,simple-git)
- **`execa`** vs raw `child_process`: `execa` is a general process-spawning
  convenience wrapper (better defaults, promise API, cleaner error objects)
  and is not git-specific; the repo's existing `execFile`+`promisify`
  pattern in `src/provision.ts` already gets most of the same convenience
  (a promise-returning `git()` helper) with zero new dependency. Given the
  repo ships with two independent hand-rolled wrappers already
  (`provision.ts`'s `git()`/`tryGit()`, `command-gate.ts`'s `exec()`), adding
  `execa` now would mean either leaving the existing two call sites
  unmigrated (inconsistent) or touching working, tested code outside this
  item's scope purely to adopt a dependency — a cost with no described
  benefit tied to Item 6's own success criteria (idempotency, routing on
  failure, fire-and-log teardown), none of which are execution-mechanism
  problems.

## 7. Open threads a design must explicitly resolve (facts, not recommendations)

These are not decisions — they are exactly the points where the sources
above leave a gap this item's design must close:

1. **`FAIL` vs `ERROR` for the closer today route identically** to
   `close_failure`/`TRIAGE` (§2.6) — unlike the gate, which splits `FAIL`
   (content-class, correction) from `ERROR` (infra-class, `gate_error`/
   `recheck_gate`/`gate-maintenance`). A merge-back closer's own richest
   idempotent-detection signal (§3.4: "already merged, nothing to do") maps
   naturally onto a "this was actually already fine" outcome that isn't
   quite `FAIL` or `ERROR` in the existing two-value vocabulary — whether
   that is represented as `DONE` (treat "already merged" as success, per
   §3.4's recommendation) or needs a contract change is for the design, not
   this document, to decide.
2. **`CloseRepairBrief` persistence-only status is a stated open decision**
   in the triage design itself (§2.6, "until Item 6 decides otherwise") — no
   in-repo code threads it anywhere.
3. **No worktree/branch teardown code exists at all today** (§2.4) — Item 6
   is building this from zero, not modifying an existing closer body.
4. **Accessibility/config-driven selection (roadmap accessibility note) has
   no code precedent of its own** — the closest analogue is `GateRef`/
   `resolveGate` (§2.3), and even that is a code-level discriminated union
   read by the harness at run start, not yet reachable by a non-technical
   user without Item 9's declarative surface (per the gate design's own
   explicit deferral of "Gate configuration via CLI or project config file"
   to Items 8/9,
   `docs/superpowers/specs/2026-09-04-gate-interface-design.md:362`).
