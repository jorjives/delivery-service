# Architecture: Close Interface (Item 6)

Grounded throughout in `docs/prd/2026-09-11-close-interface/research.md` (cited
`research.md §N`) and coordinated with
`docs/prd/2026-09-11-close-interface/product-design.md` (cited
`product-design.md`). Settled mechanism decisions from
`docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`
(the CLOSING/TRIAGE/terminal edges) and
`docs/superpowers/specs/2026-09-10-triage-and-router-design.md` (close-triage,
`CloseRepairBrief`) are restated, not re-litigated. Format follows
`docs/prd/2026-09-10-triage-and-router/architecture.md`'s precedent.

This item extends one existing, shipped seam (`CloserPort`) and adds one new
resolution seam mirroring `resolveGate`'s (`src/resolve-gate.ts`). `src/surface.ts`'s
three call sites into `ports.closer.close()` (`closing`, `terminate`, the
`CLOSED`-resume branch) keep their exact shape and idempotency guarantees —
this document is about what a closer implementation does inside `close()`,
not a rewrite of how the driver calls it.

## 1. Module structure and seams

New files, following the codebase's flat `src/*.ts` + `src/*.test.ts` layout
(the pattern Item 2's `resolve-gate.ts` / `command-gate.ts` / `custom-gate.ts`
already established):

```
src/resolve-closer.ts        # resolveCloser(closerRef, repoPath): CloserPort — total, pure
src/merge-back-closer.ts     # createMergeBackCloser(opts?)
src/commit-to-branch-closer.ts
src/open-pr-closer.ts        # createOpenPrCloser(opts?: { ghCommand?: string })
src/custom-closer.ts         # loadCustomCloser / createCustomCloser — mirrors custom-gate.ts
src/closer-support.ts        # errorReport/messageOf-style shared helpers (mirrors gate-support.ts),
                              # plus teardownWorktree(ctx) shared by all built-ins' non-accept path (§5.4)
src/git-exec.ts              # NEW — shared git()/tryGit() helpers, extracted from provision.ts (§6)
src/plugin-loader.ts         # NEW — shared "dynamic-import + guard" mechanism, extracted from
                              #        custom-gate.ts (§8), reused by custom-closer.ts
```

Existing files change, each a targeted extension:

- `src/ports.ts` — `CloseContext` gains four fields (§2); `noopCloser`
  (Item 3's default, unmodified) remains as the fallback for a run with no
  closer configured at all, but is **not** what the built-in closers do for
  non-`accepted` outcomes — those implement real teardown (§5.4), per
  `product-design.md`'s approved MUST tier.
- `src/schema.ts` — `CloserRef` discriminated union (new, mirrors `GateRef`);
  `CaseFileHeader` gains `closerRef: CloserRef` and `baseBranch:
  z.string().nullable()` (§3, §4); `CloseReport` becomes a zod schema (it
  exists today only as a TS interface in `ports.ts` — promoting it is
  required for the custom-closer guard to validate a third-party return
  value at runtime, exactly as `GateReport` already is for custom gates).
- `src/provision.ts` — `resolveBaseRef` returns `{ ref, localBranch }` instead
  of a bare string (§4); `provisionWorktree`'s return gains `baseBranch:
  string`. Both existing call sites' consumers of the old string return are
  the only touch points; the git commands issued are unchanged.
- `src/case-file.ts` — new `setBaseBranch(dir, branch)`, mirroring
  `setBaseline`'s set-once pattern exactly (§4).
- `src/surface.ts` — `provisioning()` gains one guarded call to
  `setBaseBranch` (§4); `closing()` and `terminate()` build a richer
  `CloseContext` (§2) and `closing()` gains a call to thread
  `CloseRepairBrief` when present (§7).
- `src/custom-gate.ts` — refactored to call the new `src/plugin-loader.ts`
  instead of its own inline `loadCustomGate`/`guard` (§8). Behaviour and its
  existing tests are unchanged; this is an extraction, not a rewrite.
- `src/errors.ts` — two new error classes, `CloserModuleLoadFailure` and
  `InvalidCloserExport`, matching `GateModuleLoadFailure`/`InvalidGateExport`'s
  existing shape (§8).

Nothing in `src/agent-invoke.ts`, `src/triage.ts`, `src/router.ts`, or
`src/command-gate.ts` changes.

## 2. `CloserPort` / `CloseContext` / `CloseOutcome` / `CloseReport`

**`CloserPort` and `CloseOutcome` are unchanged** (`src/ports.ts:92-103`):
one method, one `{ kind: "accepted" | "escalated" | "aborted" }` input. No new
outcome kind — `research.md §7.1`'s open thread (should "already merged" be a
new value?) is resolved in §6, not by widening this type.

**`CloseReport` is unchanged in shape** — `{ status: "DONE" | "FAIL" |
"ERROR"; detail: string }` — but is now a zod schema (`src/schema.ts`), for
the same reason `GateReport` is: a custom closer is third-party code, and its
return value must be validated before the harness trusts it (§8).

**`CloseContext` gains four fields.** Today it is `{ worktreePath, dir }`
(`src/ports.ts:87-90`) — enough for a no-op closer, not enough for one that
merges git history. The design brief asks explicitly what context a closer
needs; the answer, derived from what merge-back/open-PR require (§5) and what
is already available to `surface.ts` at both call sites via `SurfaceLocation`
and `CaseFileHeader`:

```typescript
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;              // NEW — the shared origin checkout; merge-back and
                                   // open-PR operate here, not in the worktree
  branch: string;                 // NEW — branchName(surfaceId), already a pure
                                   // function (provision.ts:14-16), never persisted
  baseBranch: string;             // NEW — the local branch to merge/PR into, pinned
                                   // at provisioning time (§4)
  repairBrief?: CloseRepairBrief; // NEW — present only when the close in flight was
                                   // triggered by an agent-path `retry_close` verdict
                                   // that produced one (§7)
}
```

`repoPath` was always available to `surface.ts` (it is a field of
`SurfaceLocation`, the caller-supplied argument every call already receives)
but was never threaded through to the closer — `research.md §2.4` confirms no
merge-back code exists today, so this gap was never exercised. `branch` is
computed, not stored: `branchName(caseFile.header.surfaceId)`
(`src/provision.ts:14-16`, unchanged, reused verbatim) — no new persisted
field, matching that function's own stated property ("stored nowhere, so it
can never drift from the surface id it is derived from").

**Why `baseBranch` is not computed fresh at close time.** The gate's baseline
is captured once and pinned immutably in the header
(`docs/superpowers/specs/2026-09-04-gate-interface-design.md:89-91`) precisely
so the comparison a surface is judged against cannot drift mid-lifetime. The
same reasoning applies to the branch a merge-back closer targets: if computed
fresh at close time (re-running `resolveBaseRef`, §4), a project's default
branch changing between provisioning and close — plausible over a
long-running or retried surface — would silently redirect the merge to a
different target than the one the worktree was branched from, with no record
of which target was intended. Pinning it at provisioning time, the one point
the harness already resolves it, closes that drift window the same way
baseline pinning does. This is a deliberate widening of what `CaseFileHeader`
persists (§4), not a convenience default.

## 3. Closer resolution — mirroring gate resolution

`research.md §2.3` names `resolveGate` as the closest precedent: a
discriminated-union `*Ref` stored in config, a pure `resolve*` function
returning a uniform interface, built-in variants constructed directly, and a
`custom` variant that dynamically imports a user module. Closer resolution
follows the identical shape:

```typescript
// src/schema.ts
export const CloserRef = z.discriminatedUnion("type", [
  z.object({ type: z.literal("merge-back"), deleteBranch: z.boolean().optional() }),
  z.object({ type: z.literal("commit-to-branch"), push: z.boolean().optional() }),
  z.object({ type: z.literal("open-pr"), titleTemplate: z.string().optional(), bodyTemplate: z.string().optional() }),
  z.object({ type: z.literal("custom"), modulePath: z.string(), exportName: z.string().optional() }),
]);
export type CloserRef = z.infer<typeof CloserRef>;
```

```typescript
// src/resolve-closer.ts
export function resolveCloser(closerRef: CloserRef, repoPath: string): CloserPort {
  const parsed = CloserRef.safeParse(closerRef);
  if (!parsed.success) return failedCloser(`Cannot resolve closer reference: ${parsed.error.message}`);
  const ref = parsed.data;
  switch (ref.type) {
    case "merge-back":       return createMergeBackCloser(ref);
    case "commit-to-branch": return createCommitToBranchCloser(ref);
    case "open-pr":          return createOpenPrCloser(ref);
    case "custom":           return createCustomCloser(ref.modulePath, ref.exportName, repoPath);
  }
}
```

`repoPath` is required, not an optional `baseDir` defaulting to
`process.cwd()`: a custom closer's relative `modulePath` must resolve against
the repo root (`SurfaceLocation.repoPath`), never the worktree the worker
edits, so an agent can never rewrite the closer that lands its own work. The
surface path matches the gate, which `run-gate.ts` resolves against
`location.repoPath`; the signature is stricter than `resolveGate`, whose
`baseDir` still defaults to `process.cwd()`.

Total and pure, exactly like `resolveGate` (`src/resolve-gate.ts:16-26`): an
unparseable `CloserRef` yields a `CloserPort` whose `close()` always returns
an `ERROR` report (`failedCloser`, mirroring `failedGate` in
`src/gate-support.ts`), so resolution failure and run failure reach the
caller in the same shape.

**Where `closerRef` lives, and a deliberate divergence from the gate's
pattern.** `GateRef` is resolved *fresh, per call*, inside `run-gate.ts`,
reading `header.gateRef` directly — there is no `ports.gate`. `AgentPort` and
`TriagePort`, by contrast, are caller-supplied instances threaded through
`SurfacePorts` for the whole run, resolved once by whoever assembles the
driver's dependencies, not re-derived from the case file on every call.

`CloserRef` goes into `CaseFileHeader` (persisted, pinned per surface, like
`gateRef`) **but `CloserPort` stays in `SurfacePorts`** (caller-supplied,
like `agent`/`triage`) rather than being resolved fresh from the header at
each of the three call sites in `surface.ts`. Two reasons this is the right
choice, not an inconsistency:

1. **Replay safety already has an owner.** `AgentPort`/`TriagePort` are
   already re-supplied by the caller on every `advance()` call (they are
   plain function parameters, never persisted), and the existing crash-replay
   guarantees (`research.md §2.2`, item 3 in particular — the `CLOSED`-resume
   branch never re-invokes the closer) do not depend on the closer being
   *resolved* identically across calls, only on it being *invoked* correctly
   given whatever `caseFile` state is on disk. Resolving `CloserPort` fresh
   from `header.closerRef` inside `surface.ts` would duplicate a resolution
   step the caller already has every reason to do once, at process start,
   exactly like it already does for `resolveGate` inside `run-gate.ts` (which
   *is* called fresh per-invocation, but from a module the driver calls into,
   not from `surface.ts` itself).
2. **Existing tests depend on `ports.closer` being an arbitrary, directly
   injectable spy.** Removing it in favour of always resolving from
   `closerRef` would force every test exercising close-failure routing,
   fire-and-log teardown, or retry-close behaviour to go through the
   `"custom"` ref's dynamic-import path merely to inject a scripted double —
   the exact overhead `agent-invoke.test.ts`'s hand-built ports already avoid
   for `AgentPort`/`TriagePort`. Keeping `ports.closer` injectable preserves
   that.

`CloserRef` is still added to the header, because whoever assembles
`SurfacePorts.closer` needs a value to call `resolveCloser` with, and that
value must itself be **persisted and pinned** for the same drift-prevention
reason `baseBranch` is (§2) — a project owner's declarative configuration
(Item 9) changing the selected closer type between a surface's creation and
its (possibly much later, post-crash) close must not silently redirect an
in-flight surface to a different closer than the one it started with. Item 6
builds the `CloserRef` type, `resolveCloser`, and the built-in
implementations; **where the ref's value comes from is Item 9's declarative
surface**, matching the identical deferral the gate design already states
(`docs/superpowers/specs/2026-09-04-gate-interface-design.md:362`,
`research.md §2.3` restates this as the Item 6/Item 9 boundary). Until then,
constructing `SurfacePorts.closer = resolveCloser(closerRef, location.repoPath)` and passing
`closerRef` into `create()`'s header are both direct code, exactly as
constructing a `GateRef` literal is direct code today — "selectable by
configuration alone" means *by data, not by implementing an interface*, which
`CloserRef` already delivers; a no-code authoring surface for that data is
explicitly Item 9's job, not this one's.

## 4. Provisioning: capturing `baseBranch`

`resolveBaseRef` (`src/provision.ts:34-41`) returns a single ref string
usable for `git worktree add ... <baseRef>` — `origin/main` when an origin
exists, or a bare local branch name (`main`) when it does not. A merge-back
closer cannot merge *into* `origin/main` — that is a remote-tracking ref, a
local cache of the remote's state, not something `git merge`/`git commit` can
land on. It widens to return both forms:

```typescript
// src/provision.ts
async function resolveBaseRef(repoPath: string): Promise<{ ref: string; localBranch: string }> {
  try {
    const ref = await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return { ref, localBranch: ref.replace(/^origin\//, "") };
  } catch {
    const ref = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    return { ref, localBranch: ref }; // no origin: HEAD is already a local branch name
  }
}
```

`provisionWorktree` uses `.ref` exactly where it uses the old return value
today (`git worktree add -b <branch> -- <worktreePath> <baseRef>`,
`src/provision.ts:66`) and additionally returns `.localBranch` as
`baseBranch` in its result: `{ restarted: boolean; baseBranch: string }`.

**Persisting it, guarded against the double-call provisioning already
tolerates.** `provisioning()` (`src/surface.ts:435-464`) is already safe to
call twice — it has no history-entry representation, so a crash between
`provisionWorktree` succeeding and `updateCursor` writing `PRE_GATING` resumes
by calling `provisioning()` again (`research.md` restates this;
`src/surface.ts:454-455`'s own comment: "the cursor advance is the commit
point"). Calling `setBaseBranch` unconditionally on every entry into
`provisioning()` would throw `ImmutabilityViolation` on that second call.
`setBaseBranch` is guarded the same way the completed-repair branch of
`gateMaintenance()` already guards `setBaseline` (`src/surface.ts:419`,
`caseFile.header.baseline === null`):

```typescript
// src/surface.ts, inside provisioning()
const { restarted, baseBranch } = await provisionWorktree(...);
if (caseFile.header.baseBranch === null) {
  await setBaseBranch(dir, baseBranch);
}
await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
```

This assumes the repository's default branch does not change *during* the
crash window between the two writes — the same assumption the gate's
baseline pinning already makes about the world between baseline capture and
the cursor advance that follows it. A default-branch rename mid-run is an
operator action outside the harness's control either way; pinning still
narrows the window to "between two writes in one function call" rather than
"for the surface's entire lifetime," which is the whole point.

```typescript
// src/case-file.ts — mirrors setBaseline's set-once shape; no parse step is
// needed here (unlike setBaseline's GateReport.parse) because baseBranch is
// already a plain string, not a structured value that could be malformed.
export async function setBaseBranch(dir: string, baseBranch: string): Promise<void> {
  await setOnce(
    dir, "baseBranch",
    (caseJson) => caseJson.header.baseBranch !== null,
    (caseJson) => ({ ...caseJson, header: { ...caseJson.header, baseBranch } }),
  );
}
```

`CaseFileHeader.baseBranch: z.string().nullable()` defaults to `null` at
`create()`, exactly like `baseline`.

## 5. Built-in closers: exact git/`gh` semantics

All four built-in closers (merge-back, commit-to-branch, open-PR — accept-path
— and the teardown default) share one first step for the accept path, because
**nothing in the codebase commits the agent's work today** (`research.md`
found no `git add`/`git commit` call anywhere in `src/`). The worker edits the
worktree's working directory; nothing durable exists until something commits
it. This is a new, shared responsibility, factored once:

```typescript
// src/git-exec.ts — extracted from provision.ts's git()/tryGit(), reused there too (§6)
async function ensureCommitted(worktreePath: string, message: string): Promise<void> {
  await git(worktreePath, ["add", "-A"]);
  try {
    await git(worktreePath, ["commit", "-m", message]);
  } catch (err) {
    // "nothing to commit, working tree clean" is not a failure: either the
    // worker made no changes, or a prior closer attempt already committed
    // them before crashing on a later step. Both are safe to proceed from.
    if (!/nothing to commit/.test(messageOf(err))) throw err;
  }
}
```

Every git invocation uses `execFile("git", [...argv], { cwd, env:
cleanGitEnv() })` — argv arrays, never a shell string — matching the existing,
enforced convention (`src/git-env.ts`, `research.md §2.5`) and closing the
injection surface a task-derived commit message or PR title could otherwise
open (§9).

### 5.1 `merge-back`

Operates in `ctx.repoPath` (the shared origin checkout), not the worktree,
because merging *into* `baseBranch` must happen where that branch is checked
out.

**Ordering is load-bearing, not incidental.** Cleanup (step 4) removes
`ctx.worktreePath`. If the idempotency check ran *after* a worktree-touching
step, a crash after full cleanup but before the surface's own `close` entry
is durably written (the exact window `src/surface.ts:716-721` handles at the
*surface* level, by never re-invoking the closer once that entry exists —
but this crash happens *before* that entry is written, so `closing()` *does*
re-invoke the closer, `research.md §3.4`) would hand the second invocation a
`worktreePath` that no longer exists, and a step that touches it first would
fail outright rather than report `DONE`. Every step below is ordered so
nothing touches `ctx.worktreePath` until the closer has confirmed there is
still something to do there:

1. **Idempotent detect-then-skip, checked first, using only `repoPath` and
   `ctx.branch` — never the worktree** (`research.md §3.1, §3.4`):
   `git merge-base --is-ancestor <branch> <baseBranch>` in `repoPath`.
   - Exit `0`: the branch is already fully contained in `baseBranch` — a
     prior attempt already merged it before crashing on cleanup. Skip
     straight to step 4 (cleanup), which needs no worktree either.
   - Exit `1`: not yet merged. Proceed to step 2 — and because the merge has
     not yet happened, cleanup cannot have started either, which is exactly
     why `ctx.worktreePath` is guaranteed to still exist by the time step 2
     runs (cleanup, the only thing that removes it, is strictly later than a
     successful merge in this closer's own sequence).
   - Git reports `<branch>` as an unknown revision (rather than exit `1`):
     the branch itself has already been deleted — cleanup fully completed on
     a prior invocation, including the branch deletion step, before the
     surface's own `close` entry was durably written. Nothing is left to do
     at all; report `DONE` ("already closed: surface branch already
     removed") without touching `ctx.worktreePath`, which is guaranteed gone
     too (this closer's own step 4 always removes the worktree before, or
     together with, the branch — never the reverse — so branch-gone implies
     worktree-gone). This is the second crash window (after the *branch*
     delete specifically) closed by the same git-state check, not a separate
     mechanism.
2. `ensureCommitted(ctx.worktreePath, "surface ${surfaceId}: close")` — safe
   to reach only because step 1 has already established the worktree exists
   and nothing downstream has touched it yet.
3. Attempt the merge: `git merge --ff-only <branch>` in `repoPath`.
   `--ff-only` is deliberate (`research.md §3.1`) — it is the safest possible
   probe: on failure it touches no working-tree state at all, so a failed
   attempt never leaves `repoPath` in a conflicted state a subsequent retry
   or another operation would have to recover from. A fast-forward failing
   means real divergence — reported as `FAIL` (content-class, §6), not
   retried automatically by this closer; cleanup does not run, so a
   subsequent `retry_close` sees the same not-yet-merged state and the same
   step-1 check.
   - **Precondition, checked before merging, not worked around:**
     `repoPath`'s current checkout must already be `baseBranch`
     (`git rev-parse --abbrev-ref HEAD` in `repoPath` equals `ctx.baseBranch`).
     If not, this closer reports `ERROR` rather than force-checking-out
     `repoPath` — `repoPath` is a shared resource the operator may be using
     directly, and switching its checkout out from under them is an unsafe
     side effect no closer should take unilaterally. (Multi-surface's shared
     repo lock, Item 10, is the eventual fix for this constraint; single-
     surface has no such lock, so the constraint is enforced by refusing
     rather than by taking one.)
4. Cleanup: `git worktree remove --force -- <worktreePath>`,
   `git worktree prune` (both via `tryGit`-style swallowed-failure calls,
   exactly as `provision.ts` already does for its own teardown-before-
   recreate, `src/provision.ts:63-64`), then, if `deleteBranch !== false`,
   `git branch -d <branch>` (lower-case `-d`, not `-D` —
   `research.md §3.3`'s point exactly: `-d` is git's own built-in "is this
   really merged" safety check, which this closer wants *because* it just
   confirmed the merge itself; `provision.ts` uses `-D` only for
   wreckage-clearing, a different situation with no such guarantee to lean
   on). Worktree removal is ordered before branch deletion, deliberately —
   the reverse order would leave a "branch gone, worktree present" state
   that step 1's unknown-revision check could not distinguish from "never
   provisioned"; this order guarantees "branch gone" always implies
   "worktree already gone too," which is exactly what step 1 assumes.
5. Report `DONE`, `detail` naming whichever path was taken ("already merged",
   "already closed", or "fast-forwarded to <sha>").

**A crash strictly between the two cleanup sub-steps** (worktree removed,
branch not yet deleted) is a real, accepted gap: a resumed close's step 1
ancestor check still succeeds (the branch still exists and is still an
ancestor), so it reports `DONE` again without re-attempting the now-missing
branch deletion, leaving one extra, already-merged branch behind. This is a
deliberately bounded imperfection, not an unhandled case: the branch is
inert (merged, safe to delete manually or by a future housekeeping pass),
and closing this last sub-step gap fully would require either a persisted
"which cleanup step completed" marker (exactly the "resume token" the
`CloseReport` contract deliberately has no field for, `research.md §3.4`) or
re-deriving it from git state with no simpler signal than the one already
used. Acceptable because it never produces a wrong *outcome* (the surface
still correctly reaches `CLOSED`), only a harmless leftover ref.

### 5.2 `commit-to-branch`

The simplest built-in: the durable artefact *is* the branch, not a merge or a
PR — but the same worktree-removed-before-the-log-entry crash window applies
here too, and there is no merge/ancestor check to lean on for detection, so
the closest available git-state signal is used instead: whether the worktree
still exists at all.

1. **Idempotent detect-then-skip, checked first:** does `ctx.worktreePath`
   still exist on disk? If not, a prior invocation already completed cleanup
   before crashing — report `DONE` ("already closed: worktree already
   removed") without touching anything. This is the equivalent, for a
   closer with no merge step, of merge-back's ancestor check: the cheapest
   git-adjacent signal available for "has this already run to completion,"
   used the same way `provisionWorktree` already derives "was there
   wreckage" from filesystem/git state rather than a persisted flag.
2. `ensureCommitted(ctx.worktreePath, ...)` — reached only once step 1 has
   confirmed the worktree is still there.
3. If `push` option is set, `git push origin <branch>` in `repoPath` (default
   `false` — pushing requires a remote and credentials the harness does not
   otherwise need; left off by default rather than assumed).
4. `git worktree remove --force -- <worktreePath>`, `git worktree prune` — the
   worktree is scratch execution space and is freed; the branch is not
   touched, since it is the whole point (never deleted by this closer, on
   any outcome).
5. Report `DONE`.

### 5.3 `open-pr` (SHOULD)

Buys `gh`, per the roadmap's own note (`docs/superpowers/specs/2026-09-04-...
:30`: "buy: `gh` CLI, not a hand-rolled API client") and `research.md §4.4`'s
confirmation that no in-repo precedent or need justifies an Octokit
dependency for a single-host, CLI-shelling-out codebase.

1. `ensureCommitted(ctx.worktreePath, ...)`.
2. `git push -u origin <branch>` in `repoPath` (unlike commit-to-branch, this
   is not optional — a PR needs a pushed branch to point at).
3. **Idempotent detect-then-skip:** `gh pr list --head <branch> --state open
   --json url --jq '.[].url'` in `repoPath` (`research.md §4.2`, the
   documented structured-check pattern, preferred over parsing `gh pr
   create`'s "already exists" error text). A non-empty result means a PR
   already exists for this branch — report `DONE` with that URL, no create
   call.
4. Otherwise `gh pr create --base <baseBranch> --head <branch> --title
   <rendered> --body <rendered>` in `repoPath`, argv-array invocation (§9),
   `title`/`body` rendered from `titleTemplate`/`bodyTemplate` (default
   templates naming the surface id and task) — never string-interpolated
   into a shell command.
5. Report `DONE` with the created PR's URL as `detail`.

`gh`'s own auth/scope failures (`research.md §4.3`) are the built-in `ERROR`
case for this closer (§6). The command path is injectable
(`createOpenPrCloser({ ghCommand })`, default `"gh"`) purely for testing
without network (§10) — not a production configuration knob; a project owner
selecting `open-pr` gets the real `gh` binary.

### 5.4 Real teardown (ESCALATED / ABORTED, MUST)

For `outcome.kind !== "accepted"`, every built-in closer — `merge-back`,
`commit-to-branch`, and `open-pr` alike — performs the identical, real
teardown action: `git worktree remove --force -- <worktreePath>` and
`git worktree prune`. **The branch is deliberately never deleted on this
path.** An escalated or aborted surface's branch is exactly what a human
taking over the escalation (Marcus, `docs/personas.md`) needs to inspect or
continue from; deleting it would destroy the one artefact a handoff depends
on — this is `product-design.md`'s approved MUST tier (flow 4) stated
directly, not a scoping choice this document is free to narrow.

This is a shared, single implementation — `teardownWorktree(ctx):
Promise<CloseReport>` in `src/closer-support.ts` — called by all three
built-ins' `close()` when `outcome.kind !== "accepted"`, rather than three
copies of the same two commands. It is unconditionally idempotent by the
same `tryGit`-style tolerance `provision.ts` already relies on for its own
teardown-before-recreate step (`src/provision.ts:63-64`): removing an
already-removed worktree is the tolerated common case, not an error, so a
resumed `terminate()` call (`src/surface.ts:49-71`, already fire-and-log)
re-invoking this on the same surface a second time is safe by construction,
with no ordering hazard analogous to §5.1's — there is no merge, no
branch-deletion sub-step, and nothing else this action does that a second
run could partially redo.

**Why this is not the same thing as Item 10's deferred orphan collection.**
`docs/provisioning.md:88-90`'s deferral covers worktrees with **no owning
case file at all** (a torn provisioning attempt, a crashed process that never
reached a terminal state) — a sweep with no single surface to ask. This is
different: the surface *is* terminal, its own closer *is* being invoked
(fire-and-log, already wired), and removing its own worktree is exactly the
"do something with the terminal outcome" action this item's whole contract
exists for — the same class of action as merge-back's own cleanup, just
without a merge or a branch deletion. Treating it as a no-op here (this
document's own earlier position, corrected in review) would leave the
roadmap's fire-and-log success criterion with no observable effect for any
non-accept terminal — a gap `product-design.md`'s success metrics test
directly ("an ESCALATED or ABORTED surface's worktree is removed").

A closer author wanting different non-accept behaviour (stop a container,
release a sandbox, or genuinely leave the worktree for inspection) writes a
`"custom"` closer that switches on `outcome.kind` itself — the contract
already supports it; the built-ins' choice is no longer a permissive default
but the specific, tested behaviour the product design requires.

## 6. Error taxonomy: `FAIL` vs `ERROR`, and the routing split that does not happen

`research.md §7.1` names this the open thread requiring a decision:
`CloseReport.status` values `FAIL` and `ERROR` already route identically
(`close_failure` / `TRIAGE`, `src/case-file.ts:269-271`) — unlike the gate,
which splits `FAIL` (content-class, `correction` budget) from `ERROR`
(infra-class, `gateError`/`gateMaintenance`).

**Decision: no split. `FAIL` and `ERROR` keep routing identically for
close.** No roadmap success criterion for Item 6 asks for a `close_error`
trigger, a `closeError` budget population, or a `recheck_close` verdict — the
gate's split exists because gate errors are common (flaky infrastructure,
`gateError`'s whole reason for existing) and cheap to retry statelessly
before spending judgement. Close runs once, after acceptance, and the merge-
back closer's own idempotent detect-then-skip (§5.1 step 2) is exactly where
"this looked like a failure but was actually already done" gets absorbed —
that is the harness-level equivalent of a stateless recheck, done *inside*
the closer rather than by the driver on a separate budget, which is a
smaller, better-targeted mechanism for a setback this narrow. Adding a
parallel budget population, router row, and schema enum value for a case the
closer itself can already resolve for free would be exactly the kind of
unrequested machinery this codebase's existing "no framework-shaped overhead"
bias (`docs/superpowers/specs/2026-09-04-gate-interface-design.md:18-21`)
argues against.

`FAIL` vs `ERROR` still carries real diagnostic meaning per built-in closer,
even though routing does not distinguish them — this matters for
`CloseReport.detail`'s quality (read by triage's prompt, and by a human via
the escalation packet if `close_failure` reaches the last `close` budget
slot):

| Closer | `FAIL` (content-class: a person/agent decision could resolve it) | `ERROR` (infra-class: the environment, not the work, is broken) |
|---|---|---|
| `merge-back` | `git merge --ff-only` fails: real divergence, needs a rebase or a different close strategy | `repoPath` not on `baseBranch` (precondition refused, §5.1); `git` command itself errored (permission, corrupt repo) |
| `commit-to-branch` | *(none — nothing here can meaningfully fail short of infra)* | `git add`/`git commit`/`git worktree remove` errored unexpectedly |
| `open-pr` | *(rare — `gh pr create` rejecting for a content reason, e.g. branch protection requiring a different base)* | `gh` not authenticated / insufficient scope (`research.md §4.3`); network failure; `git push` rejected (non-fast-forward, remote changed) |
| `custom` | Whatever the implementation reports — validated only for shape (§8), not for which bucket a given failure belongs in | Any thrown/rejected call, or a schema-invalid return (`guard()`, mirrors `custom-gate.ts`) |

This table is documentation for closer authors (the "writing a closer" guide,
§11), not a schema change — `CloseReport.status` stays the same two-way
routing signal it is today.

## 7. Interaction with close-triage and budgets

Fully built in Item 5 (`docs/superpowers/specs/2026-09-10-triage-and-router-
design.md`); Item 6 changes nothing about the routing, budget, or legality
mechanism, and adds exactly one piece of wiring the triage design left open.

- **Trigger and legality, unchanged.** A `close` entry with `status !== "DONE"`
  routes to `TRIAGE` with `trigger: "close_failure"`
  (`src/case-file.ts:313`); `legalVerdicts.close_failure` permits only
  `retry_close` / `escalate` / `abort` (`src/triage.ts:17`) — `reroute` is
  structurally unreachable for a close setback, so an ungated ("un-gated"
  meaning: not re-checked by the gate) ship can never reach the worker again
  under a different guise.
- **Budget, unchanged.** `close` budget's `used` count is the number of
  `triage` entries with `verdict: "retry_close"` (`src/case-file.ts:347`) —
  the `triage` entry append *is* the burn, no separate `incrementBudget`
  call, exactly as for `correction`/`gateError`.
- **`needsJudgement`, unchanged.** `close_failure` needs agent judgement only
  at the last `close` budget slot (`src/triage.ts:36`); every earlier
  `close_failure` is a free, deterministic `retry_close`
  (`src/router.ts:14-21`).
- **The one open wiring gap this item closes: threading `CloseRepairBrief`
  into `CloseContext`.** `retry_close`'s payload (`CloseRepairBrief =
  SharpenedBrief`, `docs/superpowers/specs/2026-09-10-triage-and-router-
  design.md:200`) is persisted to the round's `triage-<n>` ref but nothing
  reads it back (`research.md §2.6`, the explicit open decision "until Item 6
  decides otherwise"). Decision: **thread it, as an optional field, for
  closer implementations that choose to use it — none of the built-ins do.**

  A closer is deterministic code, not an agent; it cannot act on prose
  guidance the way a worker retrying with a `SharpenedBrief` can. The value
  of threading it is not "the closer reads the brief and changes behaviour" —
  it is that a *custom* closer (or a future built-in) can surface it: render
  it into a PR body, log it for the operator, or hand it to an LLM call of
  its own. The mechanism mirrors `currentBriefRef`'s pattern
  (`src/surface.ts:263-272`) exactly, scoped to `retry_close` instead of
  `reroute`/`fix_the_gate`:

  ```typescript
  // src/surface.ts
  async function currentCloseRepairBrief(
    dir: string, history: HistoryEntry[],
  ): Promise<CloseRepairBrief | undefined> {
    const start = history.findLast((e) => e.t === "triage" && e.verdict === "retry_close");
    if (start?.t !== "triage") return undefined;
    const ref = await readRef(dir, start.artifactRef);
    const parsed = CloseRepairBriefRef.safeParse(ref); // { trigger, rationale, artifact? } shape
    return parsed.success ? parsed.data.artifact : undefined;
  }
  ```

  Called once, inside `closing()`, before invoking `ports.closer.close()`;
  `undefined` (no field set on `CloseContext`) for the first close attempt
  and for any deterministic-router `retry_close` (which never produces a
  `SharpenedBrief`, exactly as a deterministic `reroute` never does today,
  `src/surface.ts:279-283`). All four built-in closers ignore the field —
  their behaviour does not change based on it, matching the "built-in
  closers need no configuration surface for this" implication of nothing in
  the roadmap asking for one.

## 8. Custom closers: loading, guarding, and a small shared extraction

`createCustomGate`/`loadCustomGate`/`guard` (`src/custom-gate.ts`) is the
exact mechanism closer loading needs: lazy dynamic `import()`, a typed
load-failure error before any method is called, and a per-call guard that
turns a thrown/rejected/schema-invalid return into an `ERROR`-shaped report
rather than letting third-party code's failure reach the harness as an
uncaught exception. Writing a second, independent copy of this for closers
would be the exact hand-rolling the buy-vs-build lens flags (§12) — two
independent implementations of "dynamically import a user module, validate
its shape, guard every call" is duplicated logic with no reader-visible
reason for the duplication.

**Decision: extract the shared mechanism into `src/plugin-loader.ts`, used by
both `custom-gate.ts` (refactored) and the new `custom-closer.ts`.** Small,
generic over the report schema and the pair of error constructors — not a
plugin *framework*, one function:

```typescript
// src/plugin-loader.ts
export async function loadPlugin<M extends Record<string, (...a: any[]) => Promise<unknown>>>(
  modulePath: string,
  exportName: string,
  baseDir: string,
  methods: (keyof M)[],
  errors: { loadFailure: new (p: string, d: string) => Error; invalidExport: new (p: string, e: string, d: string) => Error },
): Promise<M> { /* import, read export, check each method exists, throw errors.loadFailure / errors.invalidExport — identical body to today's loadCustomGate */ }

export function guardMethod<R>(
  call: () => Promise<unknown>,
  resultSchema: { safeParse: (v: unknown) => { success: boolean; data?: R; error?: { message: string } } },
  onError: (detail: string) => R,
): Promise<R> { /* identical body to today's guard() */ }
```

`custom-gate.ts` passes `GateModuleLoadFailure`/`InvalidGateExport` and
`GateReport`; the new `custom-closer.ts` passes `CloserModuleLoadFailure`/
`InvalidCloserExport` (new, same shape, `src/errors.ts`) and `CloseReport`.
Error **types** stay distinct per plugin kind (a caller catching
`GateModuleLoadFailure` specifically is unaffected) while the mechanical
logic is shared once. `custom-gate.test.ts`'s existing tests require no
change — the refactor preserves exact behaviour, verified by running them
unmodified against the new implementation (a tidy-first extraction, not a
rewrite, called out explicitly rather than folded silently into an unrelated
diff).

`createCustomCloser` follows `createCustomGate`'s exact laziness (module
imported on first `close()` call, not at `resolveCloser` time) and duplicate-
free guarantee is not applicable here (closers have no per-report ID
uniqueness constraint the way assertions do) — the guard's only job for a
closer is schema validity of the returned `CloseReport`, one step simpler
than the gate's guard.

## 9. Security

**Shelling out safely.** Every git/`gh` invocation in the built-in closers
uses `execFile("git" | "gh", [...argv], { cwd, env: cleanGitEnv() })` —
argument arrays, never a shell string. This differs deliberately from
`command-gate.ts`'s `execFileCb("/bin/sh", ["-c", command], ...)`
(`src/command-gate.ts:26-32`): that gate's entire purpose is running an
arbitrary user-supplied command, so a shell is unavoidable and the user
authored the string themselves. A closer's own git/`gh` calls have no such
excuse — commit messages, PR titles/bodies, and branch names can all be
influenced by task-derived content (a task description embedded in a commit
message, say), and passing that through a shell (`/bin/sh -c "git commit -m
'${message}'"`) would be an injection surface for content the harness itself
assembled, not content the operator typed. `execFile("git", ["commit", "-m",
message])` passes `message` as one argv entry, never interpreted by a shell,
closing that surface structurally rather than by escaping.

**No credentials in the case file.** The `open-pr` closer relies entirely on
the operator's own `gh auth login` session or ambient `GH_TOKEN`/
`GITHUB_TOKEN` environment variables that `gh` itself reads
(`research.md §4.3`) — never a token accepted as a `CloserRef` field,
`CloseContext` field, or written into `CloseReport.detail`/the `close-<n>`
ref. The case file is a durable, filesystem-persisted artefact a project
owner or Marcus (an on-call engineer, `docs/personas.md`) reads directly —
the same reasoning that already keeps `GateRef`/`TaskDef` free of secrets
applies unchanged to `CloserRef` and every ref a closer writes. `gh`'s own
auth failures surface as an `ERROR` `CloseReport.detail` string (§6) that
must never echo a token value even when quoting the underlying `gh` error
verbatim — a closer author's responsibility, called out in the "writing a
closer" guide (§11), not a runtime check this item adds (no code path exists
for a token to reach `CloseReport` in the built-ins' own implementation, so
there is nothing to sanitise there; the guidance is for custom closers that
might construct their own error strings from raw subprocess output).

**Custom closers run in-process, same trust boundary as custom gates.** A
custom closer module executes with the same authority as the harness process
itself — no sandboxing, no restricted authority — identical to
`loadCustomGate`'s already-accepted trust model (`src/custom-gate.ts`'s doc
comment: "a custom gate is third-party code," guarded for shape, not for
behaviour). Item 6 introduces no new trust boundary and closes none that
Item 2 left open; it is the same accepted extension-point risk, restated for
a second plugin kind.

## 10. Testing strategy

Follows the same three-tier shape `agent-invoke.test.ts` and
`custom-gate.test.ts` already establish, extended for git's own
process-spawning nature — no new testing mechanism, one more application of
the existing one, with real subprocesses standing in for mocks where the
codebase's existing gate/provisioning tests already do the same:

1. **Pure-function unit tests, no subprocess involved.**
   `resolveCloser`'s parse-success/parse-failure branches (mirrors
   `resolve-gate.test.ts`); `CloserRef`/`CloseReport` schema round-trips;
   `localBranchOf`-equivalent stripping logic inside `resolveBaseRef`'s new
   shape (§4), hand-fed both origin and no-origin cases.

2. **Real temp git repos, no mocked git.** `merge-back` and
   `commit-to-branch` are tested exactly the way `provision.ts`'s own tests
   already must be (real `git init` repos, a real `provisionWorktree()` call,
   real file edits inside the resulting worktree) — this is the existing
   convention the brief points at, not a new one. Concretely: init a repo,
   provision a worktree via the real `provisionWorktree`, write a file into
   the worktree (standing in for "the worker did something"), run the closer,
   assert the resulting `repoPath` state (fast-forwarded commit present /
   worktree gone / branch gone-or-kept per closer).

   **Idempotency is its own explicit test category, covering every crash
   window §5 names, not just one of them:**
   - *Crash after merge, before cleanup* (worktree and branch both still
     present, already merged): run the closer twice against the same
     fixture; the second run's step-1 ancestor check finds "already
     ancestor" and goes straight to cleanup — assert `DONE`, no duplicate
     commit, no second merge attempt.
   - *Crash after full cleanup, before the surface's `close` entry is
     written* (worktree already removed, branch already deleted): run
     `provisionWorktree` + a first successful closer invocation, delete the
     worktree and branch exactly as step 4 would have left them, then
     invoke the closer a **second** time against a `ctx.worktreePath` that no
     longer exists on disk — assert `DONE` ("already closed"), not a thrown
     error from `ensureCommitted`/`git add` failing against a missing `cwd`.
     This is the exact regression the load-bearing review-round-1 finding
     named, and the test that specifically would have caught it: an
     idempotency test that only covers the first bullet does not exercise
     this path at all, because it never removes the worktree before the
     second invocation.
   - *Teardown, non-accept path* (§5.4): run `teardownWorktree` twice in a
     row against the same fixture; assert both calls report `DONE` and the
     branch is never touched by either.

3. **`open-pr` without network.** No `gh` mock exists in the estate
   (`research.md §4`); rather than build one, `createOpenPrCloser` accepts an
   injectable `ghCommand` (default `"gh"`), and tests point it at a small
   fixture script on disk (a few lines, `#!/usr/bin/env node`, matching `gh`'s
   `pr list --json`/`pr create` argv shape closely enough to exercise the
   closer's own parsing and idempotency-check logic) — the same "swap the
   executable" shape the whole codebase already uses for `claude-mock`
   (`docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`),
   applied to a second external CLI dependency rather than invented fresh.
   This exercises the closer's real code path (argv construction, JSON
   parsing, idempotent-skip-if-PR-exists) against a real subprocess, never a
   JS-level mock of `gh`'s behaviour.

4. **Custom closer, mirroring `custom-gate.test.ts`'s existing pattern.** A
   fixture module file under a test-fixtures directory, dynamically imported
   by `createCustomCloser`, exercising: a well-formed closer, one that throws,
   one that returns a schema-invalid report, and one missing the `close`
   method entirely (each producing the exact `ERROR`/typed-error path §8
   specifies).

5. **`plugin-loader.ts` extraction correctness.** `custom-gate.test.ts`'s
   existing suite run unmodified against the refactored `custom-gate.ts`
   is itself the regression test that the extraction changed nothing
   observable.

A demo, `demos/close-slice-N-merge-back.ts`, matching the existing
`demos/agent-invocation-slice-N-*.ts` / triage demo pattern: a real temp repo,
a real `provisionWorktree`, a simulated accepted attempt, and a real
`merge-back` closer invocation — printing the resulting `CloseReport` and the
repo's post-close `git log`, proving the whole accept→close loop end to end
with no live API/network call (the `open-pr` variant of the demo uses the
same fixture-script `ghCommand` substitution as its tests, for the same
reason).

## 11. Extensibility

Writing a custom closer is: implement `CloserPort` (one `close(ctx, outcome)`
method returning a `CloseReport`), export it from a module, reference it via
`{ type: "custom", modulePath, exportName? }`. This is the exact shape
`custom-gate.ts` already establishes for gates (§8), restated for closers —
an extender who has already written a custom gate needs to learn nothing new
to write a custom closer beyond the different context/report shape.

The **"writing a closer" guide** the roadmap names (`docs/superpowers/specs/
2026-09-04-delivery-harness-roadmap.md:259-263`, mirroring Item 2's gate
guide) documents: the four context fields (§2) and when each is populated;
the `outcome.kind` switch every built-in performs (accept-path logic vs the
teardown default, §5.4) as the expected shape for a custom implementation
too; the `FAIL`/`ERROR` distinction (§6) as authorial guidance even though
routing does not enforce it; and the merge-back closer's own body as the
worked reference example, per the roadmap's stated intent ("the reference
closer is the example"). This guide becomes a chapter in Item 9's unified
onboarding documentation, exactly as the gate guide does
(`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:263`) — this
item writes the chapter; Item 9 stitches chapters together.

Adding a fifth built-in closer (a future item, or a project's own convention)
touches exactly: one new `CloserRef` union member, one new `create*Closer`
function, one new arm in `resolveCloser`'s switch — `CloserPort`,
`CloseContext`, `plugin-loader.ts`, and every existing closer are untouched,
the same "one interface, variable subject" shape `research.md §2.3` and the
triage architecture doc's own extensibility section (§12 there) already
establish for gates and triage roles respectively.

## 12. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Git execution mechanism (merge, worktree/branch cleanup, commit) | **Reuse-estate** — raw `node:child_process.execFile`, extracted from `provision.ts`'s existing `git()`/`tryGit()` into a shared `src/git-exec.ts` both modules use | `simple-git` (thin promise wrapper) or `execa` (general process-spawn convenience) | `research.md §6`: the repo has zero of `execa`/`simple-git`/`isomorphic-git` today; two independent hand-rolled wrappers (`provision.ts`, `command-gate.ts`) already exist and already get the needed convenience (`env: cleanGitEnv()` control, promise API) with zero new dependency. Adding a library now would mean either leaving the two existing call sites unmigrated (inconsistent) or touching working, tested code outside this item's stated scope purely to adopt a dependency — a cost with no benefit tied to Item 6's own success criteria |
| PR creation and existing-PR detection | **Buy** — the `gh` CLI, shelling out, reusing the operator's own `gh auth login` session | `@octokit/rest`/`octokit` (in-process GitHub API client) | Roadmap's own stated preference (`delivery-harness-roadmap.md:30`, "buy: `gh` CLI, not a hand-rolled API client"). `research.md §4.4`: Octokit needs its own token management independent of the operator's existing session and is no more host-general than `gh` is (both GitHub-specific); `gh` also matches the repo's existing "shell out to a CLI" pattern for `git` itself, where Octokit would introduce the codebase's first "library talks to a remote API directly" dependency for no functional gain |
| Merge-conflict detection strategy | **Reuse-estate** — `git merge --ff-only`'s own all-or-nothing failure mode as the probe (no working-tree mutation on failure) | `git merge-tree --write-tree` (zero-side-effect pre-flight) | `research.md §3.2` documents both; `--ff-only` is chosen because merge-back's target semantics are already "fast-forward or refuse," so the same command that performs the merge also serves as its own conflict probe — no separate pre-flight call needed, one command instead of two, with an equally-safe (no-mutation-on-failure) guarantee for this closer's narrower use case (a real three-way merge is never attempted) |
| Closer resolution mechanism (`CloserRef` + `resolveCloser`) | **Reuse-estate, mirrored** — the exact discriminated-union-ref + pure-resolver shape `GateRef`/`resolveGate` already establish | A registry/plugin-manager abstraction (register-by-name at runtime); a factory-function convention with no persisted ref type | `research.md §2.3` names this as the closest and most direct precedent in the estate; a registry would add lifecycle/registration machinery the gate interface deliberately avoided ("no registry, no lifecycle," `gate-interface-design.md:18-19`) for the exact same shape of problem — building one now for closers alone would introduce inconsistency, not remove it |
| Custom-plugin loading/guarding mechanism | **Reuse-estate, extracted** — `custom-gate.ts`'s `loadCustomGate`/`guard` logic, generalised into `src/plugin-loader.ts` and used by both custom gates (refactored, behaviour-preserving) and the new custom closers | A second, independent `loadCustomCloser`/`guard` copy-pasted from the gate's version | This is the second occurrence of an identical "dynamically import, validate shape, guard every call" mechanism appearing in the same codebase — the textbook case for extraction rather than duplication, and precisely the kind of hand-rolling-a-commodity the buy-vs-build lens flags when done twice with no shared abstraction. The extraction is small (one generic function) and behaviour-preserving (existing gate tests are the regression proof), not a speculative framework |
| Test double for `gh` | **Reuse-estate, extended** — the same "swap the real executable for a fixture script on `PATH`/an injectable path" convention `claude-mock` already establishes for the Claude SDK seam | A hand-written HTTP mock of GitHub's API (`nock`/`msw`) sitting in front of a hypothetical Octokit client; or skipping `open-PR` test coverage of the real command path entirely | Since `gh` (not Octokit) is the chosen mechanism (row above), an HTTP-level mock has nothing to intercept — `gh` itself would still need to run. Following the exact "fake executable, same argv/stdout contract, real subprocess" shape the estate already uses for `claude-mock` needs no new testing library and exercises the closer's actual argv/JSON-parsing code, not a re-implementation of it |
| Commit-before-close step (`ensureCommitted`) | **Build** — two git plumbing commands (`add -A`, `commit -m`) with one tolerated failure message match | A dedicated commit-management library; deferring commit responsibility to the worker/agent invocation instead | No such responsibility exists anywhere in the codebase today (`research.md §2.4`) — this is a genuinely new, narrow capability with no commodity to buy; two git commands and one string check is smaller and more legible than any library that would exist to wrap them, matching the "would a senior engineer call this overcomplicated" bar |

## 13. Operability / DX

**Environment**: unchanged from every prior item — Node ≥22, TypeScript, the
existing `eslint`/`typescript-eslint` config, `vitest`, zod already installed.
No new **npm** dependency (`research.md §6` confirms the raw
`node:child_process` approach needs none). One new **operational**
precondition, additive to the existing implicit requirement that a system
`git` binary is present (already true since Item 3's provisioning): the
`open-pr` closer additionally requires a system `gh` binary on `PATH`,
authenticated via the operator's own `gh auth login` session or
`GH_TOKEN`/`GITHUB_TOKEN`. This is exactly the same class of precondition
`git` itself already is for this harness — an external tool the environment
must provide, not a package the library installs — and is scoped to the one
closer that needs it; `merge-back` and `commit-to-branch` need nothing beyond
`git`.

**Harness / scaffolding**: this item adds nine files to the existing flat
`src/*.ts` + `src/*.test.ts` layout (§1) and extends six existing files with
small, targeted diffs (`ports.ts`, `schema.ts`, `provision.ts`, `case-file.ts`,
`surface.ts`, `errors.ts`) plus one behaviour-preserving refactor
(`custom-gate.ts`, §8). No new build step, no new lint configuration, no new
directory convention — an extender who has already navigated `resolve-gate.ts`
/ `command-gate.ts` / `custom-gate.ts` finds the closer equivalents in exactly
the place that pattern already taught them to look.

**Local-run story**: `npm test` runs the full suite; tiers 1 and 2 (pure
functions, real-temp-git-repo integration) run unconditionally and fast, with
no mock gate needed (unlike the agent/triage suites' `describe.skipIf` on
`claude-mock`'s presence) because real `git` is already an unconditional
dependency of every existing provisioning test. `open-pr`'s tests are
likewise unconditional — the fixture-script `gh` stand-in needs no network
and no real `gh` installation, so there is nothing to skip. A closer author
developing against a real project iterates with real temp repos locally
before ever pointing the harness at a live repository — cheaper and more
representative than mocking git's own behaviour would be. `npm run
demo:close-slice-N` (new script, matching the existing `demo:*` naming)
prints a real merge-back run's `CloseReport` and resulting `git log` to the
terminal, no live network call.

**A "writing a closer" guide chapter** (MUST, per the roadmap's own DX note):
one more chapter in the same onboarding documentation the gate guide already
started, following its exact shape (§11) — the reference `merge-back` closer,
the four-field `CloseContext` table, and the `outcome.kind` switch every
closer author is expected to implement. Becomes a chapter in Item 9's unified
onboarding surface, exactly as Item 2's gate guide does.

**Deploy target**: unchanged — an npm-installable TypeScript library, no
server, container, or hosted component. A closer's git/`gh` operations run in
the same process, on the same machine, as every other part of a surface's
lifecycle — no new deployment surface. The one new operational note (`gh`'s
presence and auth, above) belongs in the getting-started/runbook documentation
Item 8 eventually owns, not in this library's own packaging.
