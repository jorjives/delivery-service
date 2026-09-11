---
type: phase-design
created: 2026-09-11
roadmap_item: 6
---

# Close Interface — Design

> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 6.
> Mechanism spec this design implements: `docs/single-surface-control-flow.md` §Close interface, `docs/provisioning.md`.
> Builds on: `2026-09-07-single-surface-state-machine-design.md` (CLOSING / terminal edges, `CloserPort`), `2026-09-10-triage-and-router-design.md` (close-triage, `CloseRepairBrief`), `2026-09-04-gate-interface-design.md` (resolution precedent).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed).
> Audit trail: `docs/prd/2026-09-11-close-interface/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).

## Problem

The harness has the full *shape* of a close action and none of its substance.
`CloserPort`, `CloseContext`, `CloseOutcome` and `CloseReport` are typed and
wired into all three call sites the mechanism spec requires in
`src/surface.ts`: `closing()` on the accept path, `terminate()`'s
fire-and-log call on `ESCALATED`/`ABORTED`, and the `CLOSED`-resume branch
that never re-invokes a completed close. The only implementation is
`noopCloser`, which reports `DONE` and does nothing.

Consequences for the people using the harness:

- **Accepted work goes nowhere.** A surface can be gated and accepted, and the
  work then sits uncommitted in a worktree. Nobody gets a merged branch, a
  pull request, or even a commit. This is the step that makes a harness run
  produce something usable.
- **Escalated and aborted surfaces leak worktrees.** The fire-and-log call
  happens, into a no-op; every non-accept terminal leaves its worktree behind.
- **`retry_close` retries nothing.** Close-triage can issue `retry_close` and
  persist a `CloseRepairBrief` (Item 5), but the closer it retries is a no-op
  and the brief is never read back.

Items 3 and 5 explicitly deferred real closers here. Item 3 (the only
dependency) is complete, so this is the next phase. The routing, budget and
replay plumbing are done; this phase gives the seam real closers to resolve
to, rather than rebuilding it.

## Personas and goals

Full derivation in `docs/personas.md`.

- **Priya Shah, harness extender.** Writes or adopts a closer the way she
  already writes a gate or a `role_cfg`: from a contract, a reference
  implementation and a guide, without reading `src/surface.ts`.
- **Marcus Webb, on-call engineer.** Reads a close-failure `EscalationPacket`
  cold and decides whether to retry the close or take it over, from the case
  file alone.
- **Dana Okafor, non-technical project owner.** Says "when work is accepted,
  merge it" (or commit it to a branch, or open a PR) by naming a built-in
  closer as data, and sees in plain prose what happened. The guided, no-code
  authoring surface for that data is Item 9's; this phase guarantees the
  artefact is a name and a few parameters, never an implementation.

## Goals and success metrics

- **Extender cold start.** Priya goes from no closer to a working, resolved
  closer using only the guide and the reference `merge-back` closer, without
  reading `src/surface.ts` or `src/provision.ts`. Verified by a cold-start
  walkthrough, as for Items 2, 4 and 5.
- **Accepted work lands.** A surface configured with `{ type: "merge-back" }`
  or `{ type: "commit-to-branch" }` reaches `CLOSED` with the work merged into
  the pinned base branch or committed to the surface branch, and a `detail`
  that states what happened in plain prose.
- **Actionable close escalations.** Given a case file at `ESCALATED` from a
  `close_failure`, Marcus can state the decision, the evidence (the closer's
  own `detail`) and what already failed, from the `EscalationPacket` alone.
  Proven by a test per close-failure path: diverged history, missing `gh`
  auth, custom closer exception.
- **Idempotence is proven, not claimed.** Automated tests replay each crash
  window named under "Built-in closers" (after merge before cleanup; after
  full cleanup before the surface's `close` entry) and assert `DONE` with no
  second merge and no error from a missing worktree.
- **Non-accept teardown tears down.** A test proves an `ESCALATED` or
  `ABORTED` surface's worktree is removed and its branch preserved.
- **Close failure never reroutes to the worker.** A test proves a real
  closer's `FAIL` and `ERROR` both land at `close_failure`.

## Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The MUST tier below is the derived
minimum, recorded by the team-lead in `review-log.md` and scrutinised by the
critic against the personas. It extends the literal roadmap wording in one
place: real teardown on non-accept terminals. Without it the roadmap's own
fire-and-log criterion has no observable effect, because the call already
happens today, into a no-op. The floor gets Priya a seam and a worked example
and gets Dana two working built-in strategies with no new dependency. It does
**not** get Dana the open-PR closer the roadmap uses as its example phrase:
that is SHOULD, because it alone depends on an external CLI (`gh`) whose
absence or expired auth is a project-setup problem this item cannot solve.

## Capabilities

### MUST

1. **`CloserRef`**, a zod discriminated union on `type` mirroring `GateRef`:
   built-in variants carry a name and parameters; `custom` carries
   `modulePath` and optional `exportName`.
2. **`resolveCloser(ref, baseDir?)`**, total and pure like `resolveGate`: an
   unparseable ref yields a closer whose `close()` returns `ERROR`, so
   resolution failure and run failure reach the caller in one shape.
3. **The `merge-back` closer**: idempotent ancestor check, commit, ff-only
   merge into the pinned base branch, worktree removal, safety-checked branch
   delete.
4. **The `commit-to-branch` closer**: commit, remove the worktree, keep the
   branch.
5. **Real teardown on `ESCALATED`/`ABORTED`** by every built-in: worktree
   removed, branch kept.
6. **Custom closer loading and guarding**: a throwing, hanging-then-rejecting
   or schema-invalid custom closer becomes an `ERROR` report, never an
   uncaught exception.
7. **Closer-level idempotence** for the built-ins, derived from git state,
   so a crash between accept and close replays safely.
8. **`baseBranch` pinned at provisioning** and threaded to the closer, with
   `repoPath` and `branch`, via a widened `CloseContext`.
9. **A "writing a closer" guide** with the reference `merge-back` closer as
   the worked example.

### SHOULD

- **The `open-pr` closer** via the `gh` CLI.
- **`CloseRepairBrief` threaded into `CloseContext`** on an agent-path
  `retry_close`. No built-in reads it; it exists for custom closers.
- **A runnable demo** of the accept → merge-back loop, matching the existing
  `demos/*-slice-N-*.ts` pattern.

### COULD

- **`push` on `commit-to-branch`**: push the surface branch to `origin` so it
  is visible outside the local machine. Defaults off.
- **A `glab`-based open-PR variant** for GitLab, same CLI-wrapping shape.

## Architecture

### Module structure

New files, in the existing flat `src/*.ts` + `src/*.test.ts` layout that
`resolve-gate.ts` / `command-gate.ts` / `custom-gate.ts` established:

| File | Contents |
|---|---|
| `src/resolve-closer.ts` | `resolveCloser` |
| `src/merge-back-closer.ts` | `createMergeBackCloser` |
| `src/commit-to-branch-closer.ts` | `createCommitToBranchCloser` |
| `src/open-pr-closer.ts` | `createOpenPrCloser({ ghCommand? })` |
| `src/custom-closer.ts` | `createCustomCloser`, mirrors `custom-gate.ts` |
| `src/closer-support.ts` | `failedCloser`, report helpers (mirrors `gate-support.ts`), `teardownWorktree(ctx)` |
| `src/git-exec.ts` | `git()` / `tryGit()` extracted from `provision.ts`, plus `ensureCommitted` |
| `src/plugin-loader.ts` | `loadPlugin` / `guardMethod` extracted from `custom-gate.ts` |

Existing files take targeted changes: `ports.ts` (`CloseContext`),
`schema.ts` (`CloserRef`, `CloseReport` as a zod schema, header fields),
`provision.ts` (`resolveBaseRef` shape, `baseBranch` returned),
`case-file.ts` (`setBaseBranch`), `surface.ts` (context construction,
`setBaseBranch` call, repair-brief read), `errors.ts`
(`CloserModuleLoadFailure`, `InvalidCloserExport`), and `custom-gate.ts`
(behaviour-preserving refactor onto `plugin-loader.ts`). `agent-invoke.ts`,
`triage.ts`, `router.ts` and `command-gate.ts` do not change.

The two extractions (`git-exec.ts`, `plugin-loader.ts`) are tidy-first
refactors with no behaviour change. The existing `provision` and
`custom-gate` suites, run unmodified, are their regression proof.

### Contract

`CloserPort` and `CloseOutcome` are unchanged: one `close(ctx, outcome)`
method; `outcome.kind` is `"accepted" | "escalated" | "aborted"`.

`CloseReport` keeps its shape, `{ status: "DONE" | "FAIL" | "ERROR"; detail:
string }`, but becomes a zod schema in `schema.ts`, as `GateReport` is, so a
custom closer's return value can be validated at runtime.

`CloseContext` widens from `{ worktreePath, dir }`:

```typescript
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;               // the shared origin checkout; merge-back and open-pr act here
  branch: string;                 // branchName(surfaceId): computed, never persisted
  baseBranch: string;             // local branch to merge/PR into, pinned at provisioning
  repairBrief?: CloseRepairBrief; // SHOULD: present only after an agent-path retry_close
}
```

`repoPath` is already on `SurfaceLocation`; `branch` reuses the pure
`branchName` from `provision.ts`. Neither adds persisted state.

### Pinning `baseBranch`

`resolveBaseRef` returns a ref usable for `git worktree add`: `origin/main`
when an origin exists, a local branch name otherwise. A remote-tracking ref
cannot be merged into, so it widens to `{ ref, localBranch }`
(`localBranch` strips the `origin/` prefix), and `provisionWorktree` returns
`{ restarted, baseBranch }`. The git commands it issues are unchanged.

`CaseFileHeader` gains `baseBranch: z.string().nullable()`, `null` at
`create()`, set once by `setBaseBranch(dir, branch)`, which mirrors
`setBaseline`'s set-once shape. `provisioning()` can legitimately run twice
(a crash before its cursor advance), so the write is guarded:

```typescript
const { restarted, baseBranch } = await provisionWorktree(...);
if (caseFile.header.baseBranch === null) await setBaseBranch(dir, baseBranch);
await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
```

Pinning, rather than resolving afresh at close time, follows the gate
baseline's reasoning: a default-branch change between provisioning and a
possibly much later, post-crash close must not silently redirect the merge.

### Resolution and where the ref lives

```typescript
export const CloserRef = z.discriminatedUnion("type", [
  z.object({ type: z.literal("merge-back"), deleteBranch: z.boolean().optional() }),
  z.object({ type: z.literal("commit-to-branch"), push: z.boolean().optional() }),
  z.object({ type: z.literal("open-pr"), titleTemplate: z.string().optional(), bodyTemplate: z.string().optional() }),
  z.object({ type: z.literal("custom"), modulePath: z.string(), exportName: z.string().optional() }),
]);
```

No variant takes a `base` parameter: the target is the pinned `baseBranch`,
so a project owner never restates a branch the harness already derived.

`CloserRef` is persisted in `CaseFileHeader` (`closerRef`), pinned per
surface like `gateRef`, so a configuration change cannot redirect an
in-flight surface to a different closer. `CloserPort` stays
caller-supplied in `SurfacePorts`, like `agent` and `triage`. This is a
deliberate divergence from the gate, which `run-gate.ts` resolves fresh from
the header. Replay safety does not depend on resolving the closer
identically across calls, only on invoking it correctly against on-disk
state. Existing close-routing tests also inject `ports.closer` as a scripted
double, and forcing them through the `custom` dynamic-import path would add
cost for no gain. Whoever assembles the driver calls
`resolveCloser(header.closerRef)`. Until Item 9 exists that is direct code,
as constructing a `GateRef` literal is today. "Selectable by configuration
alone" means selectable by data, not by implementing an interface.

### Commit before close

Nothing in `src/` commits the worker's changes today; the worker edits the
worktree and the gate judges the working tree. Every accept path therefore
starts from a shared helper:

```typescript
async function ensureCommitted(worktreePath: string, message: string): Promise<void> {
  await git(worktreePath, ["add", "-A"]);
  try { await git(worktreePath, ["commit", "-m", message]); }
  catch (err) { if (!/nothing to commit/.test(messageOf(err))) throw err; }
}
```

"Nothing to commit" is tolerated: either the worker made no change, or a
prior attempt already committed before crashing. The commit uses the
repository's configured git identity; a missing identity surfaces as an
`ERROR` naming the cause.

### Built-in closers

Every git and `gh` call is `execFile(cmd, [...argv], { cwd, env:
cleanGitEnv() })`: argument arrays, never a shell string.

**`merge-back`** acts in `repoPath`. Ordering is load-bearing: nothing touches
`worktreePath` until the closer has confirmed there is work left to do there,
because a crash after full cleanup but before the surface's `close` entry is
durable causes `closing()` to re-invoke the closer against a worktree that no
longer exists.

1. **Detect, using only `repoPath` and `branch`:**
   `git merge-base --is-ancestor <branch> <baseBranch>`.
   - Exit 0: already merged by a prior attempt; go to cleanup.
   - Exit 1: not merged, so cleanup cannot have started; the worktree
     exists. Continue.
   - `<branch>` unknown: cleanup already completed, including the branch
     delete. Report `DONE` ("already closed") without touching the worktree.
     Cleanup always removes the worktree before the branch, so a missing
     branch implies a missing worktree.
2. **Precondition:** `repoPath`'s checkout must be `baseBranch`. If not,
   report `ERROR`: `repoPath` is shared with the operator, and switching its
   checkout is not a closer's call. Item 10's repo lock is the eventual
   relief.
3. `ensureCommitted(worktreePath, ...)`.
4. `git merge --ff-only <branch>`. Failure means real divergence: `FAIL`,
   `detail` naming the base branch's current tip. Nothing was touched, and
   cleanup does not run, so a later `retry_close` sees the same state.
5. **Cleanup:** `git worktree remove --force`, `git worktree prune`
   (tolerated failures, as in `provision.ts`), then, unless
   `deleteBranch: false`, `git branch -d <branch>`. The lower-case `-d` is
   git's own "is this merged" guard.
6. `DONE`, `detail` naming the path taken: "fast-forwarded `<base>` to
   `<sha>`", "already merged", or "already closed".

Accepted gap: a crash strictly between worktree removal and branch deletion
replays as "already merged" and leaves one merged, inert branch behind.
Closing it would need a persisted cleanup-step marker, which the
`CloseReport` contract deliberately lacks. The outcome is still correct.

`merge-back` lands the work on the local base branch only. It does not push
the base branch to a remote (see what this design does not include).

**`commit-to-branch`**, with no merge to probe, uses the cheapest git-adjacent
signal available:

1. **Detect:** if `worktreePath` no longer exists, a prior attempt finished
   cleanup; report `DONE` ("already closed").
2. `ensureCommitted(worktreePath, ...)`.
3. COULD: if `push`, `git push origin <branch>`.
4. `git worktree remove --force`, `git worktree prune`. The branch is never
   deleted by this closer, on any outcome.
5. `DONE`, `detail` naming the branch.

**`open-pr` (SHOULD)**:

1. `ensureCommitted(worktreePath, ...)`.
2. `git push -u origin <branch>` in `repoPath`.
3. **Detect:** `gh pr list --head <branch> --state open --json url`. A
   result means a prior attempt already opened it: `DONE` with that URL.
4. Otherwise `gh pr create --base <baseBranch> --head <branch> --title … --body …`,
   rendered from `titleTemplate`/`bodyTemplate` (defaults name the surface
   and task), passed as argv entries.
5. `DONE`, `detail` the PR URL.

`open-pr` does not remove the worktree on success: a PR under review may take
follow-up commits, as the tools surveyed in `research.md` §5 do. On success
it leaves the worktree in place. Removal after an external merge is outside
this state machine (Item 10's sweep). The `ghCommand` option exists only so
tests can substitute a fixture executable; production uses `gh`.

**Teardown (`outcome.kind !== "accepted"`, MUST).** All three built-ins call
one shared `teardownWorktree(ctx)`: `git worktree remove --force`,
`git worktree prune`, both tolerated, then `DONE`. The branch is always kept,
because it is what Marcus, or anyone taking over an escalation, inspects or
continues from. Teardown is idempotent by construction: removing an absent
worktree is the tolerated case. A teardown failure is logged by
`terminate()`'s existing fire-and-log handling and never re-triaged. This is
not Item 10's orphan sweep: that covers worktrees with no terminal owning
surface; here the terminal surface's own closer is tidying its own worktree.

A closer that wants different non-accept behaviour (keep the worktree, stop a
container) is a `custom` closer switching on `outcome.kind`.

### FAIL vs ERROR

`FAIL` and `ERROR` keep routing identically to `close_failure`. This is
deliberate, not an asymmetry to fix. The gate splits them because a content
failure can be rerouted to a fresh worker and an infra failure cannot. Close
has no reroute: "the work is already accepted and correct, so rerouting to a
fresh worker is meaningless" (control-flow doc), for a merge conflict and an
expired token alike. Both need `retry_close` or a human. The cheap
"was it actually already done" recheck the gate gets from `gateError` lives
inside each closer's own detect step instead, without a new budget,
router row or verdict.

The distinction still carries diagnostic meaning, documented in the guide
as a message-quality convention and carried into the packet's evidence
through `detail`:

| Closer | `FAIL`: a decision could resolve it | `ERROR`: the environment is broken |
|---|---|---|
| `merge-back` | ff-only refused: history diverged | `repoPath` not on `baseBranch`; git itself errored; no commit identity |
| `commit-to-branch` | none in practice | git errored |
| `open-pr` | `gh pr create` refused for a content reason (e.g. branch protection) | `gh` missing, unauthenticated or under-scoped; network; `git push` rejected |
| `custom` | whatever the implementation reports | thrown or rejected call; schema-invalid return |

`detail` is plain, factual prose naming the specific cause (for example "`gh`
is not authenticated; run `gh auth login`"), never a raw error dump.

### Close-triage, budgets and the repair brief

Unchanged from Item 5: a non-`DONE` close entry routes to `TRIAGE` with
`trigger: "close_failure"`; legal verdicts are `retry_close`, `escalate`,
`abort`; the `close` budget counts `retry_close` triage entries; the agent is
engaged only at the last `close` slot. `retry_close` now re-runs a real
closer, whose detect step makes the retry safe.

SHOULD: `closing()` reads the most recent `retry_close` triage entry's ref
and, when it holds a `CloseRepairBrief` (agent path only; the deterministic
router produces none), sets `ctx.repairBrief`. It finds the triage entry
the way `currentBriefRef` does for `reroute`, but resolves and inlines the
brief rather than passing a ref key on, because the closer has no later
reader to defer to. A closer is deterministic code and
the built-ins ignore the field; it lets a custom closer surface the guidance,
for example in a PR body or its own agent call.

### Custom closers

`custom-gate.ts`'s lazy dynamic import, typed load-failure errors and
per-call guard are exactly what closer loading needs. They are extracted
once into `src/plugin-loader.ts` (`loadPlugin`, generic over method names and
error constructors; `guardMethod`, generic over the result schema) and used
by both `custom-gate.ts` and the new `custom-closer.ts`. Error types stay
distinct per plugin kind. The closer guard's only job is `CloseReport` schema
validity. The module is imported on the first `close()` call, as for gates.

Custom closers run in-process with the harness's authority: the same trust
model as custom gates, with no new boundary opened or closed.

### Security

- **No shell.** Commit messages, branch names and PR titles may derive from
  task content; argv arrays keep them from being interpreted by a shell.
  `command-gate.ts` uses `/bin/sh -c` only because its whole purpose is a
  user-authored command; closers have no such excuse.
- **No credentials in the case file.** `open-pr` relies on the operator's
  `gh auth login` session or ambient `GH_TOKEN`/`GITHUB_TOKEN`. No token is
  accepted on `CloserRef` or `CloseContext`, or written to `detail` or a ref.
  The guide tells custom-closer authors never to echo raw subprocess output
  that could contain one.

### Testing

1. **Pure**: `resolveCloser` parse success and failure; `CloserRef` and
   `CloseReport` schemas; `resolveBaseRef`'s origin and no-origin shapes.
2. **Real temp git repos, no mocked git**, as the provisioning tests already
   do: a real `provisionWorktree`, a file written into the worktree, a real
   closer, assertions on `repoPath`. Idempotence is its own category
   covering every crash window: after merge before cleanup (second run finds
   the ancestor, `DONE`, no second merge); after full cleanup (worktree and
   branch gone, second run `DONE`, no error from a missing `cwd`); teardown
   run twice (`DONE` both times, branch untouched).
3. **`open-pr` without network**: `ghCommand` points at a small fixture
   executable honouring `gh pr list --json` / `gh pr create` argv and stdout.
   This is the swap-the-executable convention `claude-mock` already
   establishes, applied to a second CLI.
4. **Custom closers**: fixture modules that are well-formed, throw, return a
   schema-invalid report, or lack `close`, mirroring `custom-gate.test.ts`.
5. **Extraction regression**: the existing `custom-gate` and `provision`
   suites, unmodified.

## UX and key flows

- **Priya writes a closer.** She reads the guide's contract section, then
  either names a built-in or exports an object satisfying `CloserPort` and
  references it as `{ type: "custom", modulePath }`. If it throws or returns
  garbage, she sees an `ERROR` report with the cause, not a crashed driver.
  When a close fails she reads the packet, not her own logs.
- **Dana selects a closer.** `{ type: "merge-back" }`,
  `{ type: "commit-to-branch" }` or (SHOULD) `{ type: "open-pr" }`. She never
  implements `close()` and never reasons about worktrees or fast-forwards. On
  an accepted surface she sees `CLOSED` and a `detail` such as "merged into
  main (fast-forward to 3f2a91c)", "committed to harness/surface-7", or a PR
  URL. Plain-language reporting across runs is Item 11's.
- **Marcus triages a close failure.** A closer reports `FAIL` or `ERROR`;
  close-triage retries while budget remains and escalates at the last slot.
  The packet's five elements, as Item 5 built them: the decision ("the closer
  could not merge: resolve the divergence or re-target"), verbatim evidence
  (the closer's `detail`), dead ends (prior `retry_close` rounds), why now
  (close budget state) and session references.
- **Crash between accept and close.** Resume derives `CLOSING` from the log
  tail and re-invokes the closer; a tail already showing a `DONE` close entry
  derives `CLOSED` and never re-invokes. Each closer's detect step makes the
  re-invocation safe from git state alone.

**Error and empty states**: a missing `gh` or expired auth gives `ERROR` with
the specific precondition; "already merged" or "already has an open PR" is
`DONE`, not an error, and is the common case on a post-crash retry; diverged
history gives `FAIL` naming the base tip; a broken custom closer gives
`ERROR`; a teardown failure on a terminal surface is logged only; an absent
repair brief means the field is simply unset.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Git execution | **Reuse-estate**: `node:child_process.execFile`, extracted from `provision.ts` into `git-exec.ts` | `simple-git`, `execa` | The repo has no process or git library; the existing hand-rolled wrappers already give `cleanGitEnv()` control and promises. A library would mean an inconsistent split or migrating tested code outside this item's scope. |
| PR creation and detection | **Buy**: the `gh` CLI | `@octokit/rest` | Reuses the operator's `gh auth login` session with no harness-managed token; both are GitHub-only; matches the shell-out pattern already used for git. |
| Conflict detection | **Reuse**: `git merge --ff-only`'s own no-mutation failure | `git merge-tree --write-tree` pre-flight | Merge-back's semantics are already "fast-forward or refuse", so the merge command is its own probe: one call, equally safe. |
| Closer resolution | **Reuse-estate, mirrored**: `CloserRef` + `resolveCloser`, as `GateRef` + `resolveGate` | A runtime registry | The gate interface deliberately has no registry or lifecycle; a closer-only registry would add inconsistency. |
| Custom-plugin loading | **Reuse-estate, extracted**: `plugin-loader.ts` shared by gates and closers | A second copy of `custom-gate.ts`'s loader | The second occurrence of the same mechanism; one small generic function, proven by the unmodified gate tests. |
| `gh` test double | **Reuse-estate, extended**: fixture executable, as `claude-mock` | `nock`/`msw` HTTP mocks; no coverage | With `gh` chosen there is no HTTP layer to intercept; a fake executable exercises the real argv and parsing code. |
| Commit before close | **Build**: `ensureCommitted`, two git commands | A commit-management library; making the worker commit | A new, narrow responsibility with no commodity to buy; two commands are smaller than any wrapper. |
| Schemas | **Reuse**: zod | none | Every other contract in the codebase uses zod. |

## Operability / DX

- **Environment**: unchanged: Node ≥ 22, TypeScript, eslint, vitest, zod. No
  new npm dependency. System `git` is already required by provisioning.
  `open-pr` alone adds a system `gh`, authenticated; a project that does not
  select it never needs `gh`.
- **Harness and scaffolding**: new files sit beside their gate equivalents,
  so an extender who knows `resolve-gate.ts` / `command-gate.ts` /
  `custom-gate.ts` finds the closer equivalents where that pattern taught
  them to look. No new build step, lint configuration or directory
  convention.
- **Local-run story**: the whole suite runs under `npm test` with no
  skipped tiers. Real temp repos need only `git`, and the `gh` fixture needs
  no network or `gh` installation. A `demo:close-*` script (SHOULD) prints a
  real merge-back run's `CloseReport` and resulting `git log`, with no network.
- **Guide**: a "writing a closer" chapter covering the `CloseContext` fields
  and when each is set, the `outcome.kind` switch every closer is expected to
  implement, the `FAIL`/`ERROR` convention, the idempotence obligation (the
  contract has no resume token, so a closer derives "already done" from the
  world), the no-secrets-in-`detail` rule, and `merge-back` as the worked
  example. It stands alongside `docs/configuring-a-role.md`, and Item 9
  stitches it into unified onboarding. Unlike the gate guide, which only ever
  shipped as doc-comments, this one ships as a document.
- **Deploy target**: unchanged: an npm-installable library, no service. Where
  the `gh` precondition is documented for end users is Item 8's
  getting-started guide.

## Extensibility

A new built-in closer is one `CloserRef` member, one `create*Closer`
function and one `resolveCloser` arm; `CloserPort`, `CloseContext`,
`plugin-loader.ts` and existing closers are untouched. A custom closer is
one module exporting a `close(ctx, outcome)` object, referenced by
`{ type: "custom", modulePath, exportName? }`. An extender who has written a
custom gate has nothing new to learn beyond the context and report shapes.

## What this design does not include

- A declarative or config-file authoring surface for `CloserRef` (Item 9).
- A CLI for registering closers or inspecting close outcomes (Item 8).
- Multi-surface merge serialisation and a shared repo lock (Item 10); this
  design assumes one writer of the base ref, and refuses rather than switches
  a `repoPath` checkout on the wrong branch.
- Orphan worktree and branch sweeping for surfaces with no terminal owner
  (Item 10), including worktrees `open-pr` leaves for externally merged PRs,
  and the one merged branch left by the accepted cleanup crash gap.
- Plain-language cross-run reporting (Item 11).
- Pushing the base branch after `merge-back`: the merge lands locally.
- Non-GitHub PR hosts beyond the COULD `glab` variant.
- Automatic conflict resolution: divergence is `FAIL`.
- An agent-backed built-in closer; `custom` does not preclude one.
- Per-outcome closer composition (a different closer for escalate than
  accept); one closer handles every `outcome.kind`, which the existing
  signature already supports.
- A `close_error` trigger, `closeError` budget or `recheck_close` verdict.

## Open questions

None blocking. Assembly decisions for the spec-reviewer to check against the
approved artefacts:

- The product design's example `{ type: "merge-back", base: "main" }` is
  superseded by the architecture's pinned `baseBranch`; no variant takes
  `base`. The product design left this choice to the architect, preferring
  that owners not restate a derivable branch.
- `push` on `commit-to-branch` appears in the `CloserRef` schema but is
  COULD-tier, following the product design's tiering; delivery may omit the
  field until it is built.
- Whether `merge-back` should also push the updated base branch to `origin`
  is deferred. Neither artefact specifies it, and pushing a shared base
  branch unattended is a trust decision the roadmap has not taken.
