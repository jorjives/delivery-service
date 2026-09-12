# Close Interface — Slice 1: Accepted Work Is Merged Into the Base Branch

> **Status:** ✅ Complete — 2026-09-12 — `be223a1`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-11-close-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Goal:** A project selects the merge-back closer as data (`{ type: "merge-back" }`); an accepted surface then has its worker's changes committed, fast-forwarded into the branch the surface was provisioned from, its worktree removed and its surface branch deleted, with a plain-prose `CloseReport` and safe replay from any crash window.

**Architecture:** `provision.ts` widens `resolveBaseRef` to `{ ref, localBranch }` and returns the pinned `baseBranch` alongside `restarted`; `surface.ts` writes it set-once into the case file header and threads it, with `repoPath` and the derived `branch`, into a widened `CloseContext`. A new `src/merge-back-closer.ts` drives the system `git` through helpers extracted from `provision.ts` into `src/git-exec.ts`, deriving "already merged" and "already closed" from git state alone so a replayed close is safe. `src/resolve-closer.ts` mirrors `resolve-gate.ts`: a zod `CloserRef` in, a `CloserPort` out, an unparseable ref becoming a closer that reports `ERROR`.

**Tech Stack:** TypeScript (ESM, Node ≥22), zod v4, vitest, system `git` via `node:child_process.execFile`.

## Global Constraints

- Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint` strict config, `vitest`. **No new dependency of any kind** — no git library, no process library.
- **Buy-vs-build (Build note):** git is driven by the codebase's own `execFile` wrappers, **shared out of `provision.ts`** into `src/git-exec.ts`, not copied. Every call passes `env: cleanGitEnv()` and an argv **array** — never a shell string, never `/bin/sh -c`. Closer selection mirrors `GateRef` + `resolveGate` exactly: a zod discriminated union plus a total resolver function, **no registry**, no lifecycle.
- **Operability/DX (Operational note):** demo and tests need only a system `git` — no network, no `gh`, no `claude-mock`, nothing skipped. The demo must state plainly that the merge lands on the **local** base branch and is **not pushed** anywhere.
- **Idempotence is derived, not stored.** `CloseReport` has no resume token, so every "already done" answer comes from git state. No new persisted field beyond `header.baseBranch`.
- **`detail` is plain prose**, factual, naming branch and short commit. Never a raw git stdout/stderr dump.
- **The main checkout is shared with the operator.** A closer never switches `repoPath`'s checked-out branch; a wrong branch is an `ERROR`.
- Run commands from the worktree root. Targeted tests only: `npx vitest run <file> -t "<name>"`. Typecheck: `npx tsc --noEmit`. Lint a single file: `npx eslint <file>`.

## Scaffolding Impact

- `docs/provisioning.md` — "Write the case file header" lists the immutable identity block; provisioning now also pins `baseBranch` → **Task 2**.
- `src/index.ts` — new public symbols (`setBaseBranch`, `resolveCloser`, `createMergeBackCloser`, `CloserRef`) → **Tasks 2 and 5** (each exports what it adds).
- `package.json` — new `demo:close-slice-1` script → **Task 6**.
- `src/temp-repo.ts` — the shared test/demo repo fixture must carry a committable git identity for its worktrees → **Task 1**.
- `docs/single-surface-control-flow.md` — none. Its close-interface section describes the contract (`close(ctx, outcome) -> CloseReport`, close failure is infra-class, fire-and-log on non-accept terminals), all still exactly true; this slice implements it rather than changing it.
- `docs/writing-a-gate.md`, `docs/configuring-a-role.md` — none. The "writing a closer" guide is Slice 4's deliverable.
- `README.md`, `CONTRIBUTING.md`, `eslint.config.js`, `tsconfig.json` — none. No new env var, build step, dependency or directory convention; `demos/`, `src/` and `tests/` are already matched by lint and typecheck.

**Decisions recorded (unattended run):**

1. **`ensureCommitted` decides on `git status --porcelain`, not on the error text of a failed `git commit`.** The spec's snippet tests the rejection message against `/nothing to commit/`. Verified against real git: that sentence goes to **stdout**, and `execFile`'s rejection message carries the command line and stderr, so the guard would never match and a no-change surface would fail its close. Checking porcelain output is deterministic and needs no string-matching of human-facing output.
2. **`resolveCloser(ref)` takes no `repoPath` in this slice.** `repoPath` exists in the spec so a `custom` closer's relative `modulePath` resolves against the repo root; there is no custom arm until Slice 4, and an unused parameter is dead weight the strict lint config would flag. Slice 4 adds the parameter together with its first reader.
3. **`CloserRef` is not persisted in the case file header yet.** The spec pins it in `CaseFileHeader`, but nothing in this slice reads it back: `SurfacePorts.closer` is caller-supplied, and the surface never resolves a closer itself. Adding a required header field with no reader would churn every existing case-file fixture for no behaviour. The slice that assembles a driver from configuration (Item 8/9) adds it with its reader.
4. **Merge-back's non-accept branch is a placeholder in this slice.** `outcome.kind` of `escalated`/`aborted` returns `DONE` stating the worktree was left in place. Real teardown is Slice 2's shared `teardownWorktree`, which replaces this branch.
5. **`header.baseBranch` is `string | null`, set once, with no log entry.** Unlike `setBaseline`, it carries no state-machine meaning, so `deriveStateFromEntry` must not see it. Existing on-disk case files predating the field will not parse; the library is pre-release and no persisted fixture is checked in.
6. **Merge-back's close checks run branch-existence and a guarded commit before the ancestry probe, reversing the design spec's step order.** The spec's merge-back step list runs `git merge-base --is-ancestor` before committing the worker's changes. Verified against real git: at that point the worker's changes are still uncommitted, so the surface branch is exactly the base tip and the probe reports "already merged" on the very first close — the accepted work is discarded before it is ever committed, and the slice's own first test (`commits the worker's changes and fast-forwards the base branch onto them`) would fail. The corrected order is: (1) `baseBranch` empty → `ERROR`; (2) `rev-parse --verify refs/heads/<branch>` missing → `DONE` "already closed"; (3) only if the worktree directory still exists, `ensureCommitted` — the existence guard is load-bearing, not cosmetic: with `deleteBranch: false` a replay can find the branch still present after cleanup already removed the worktree, and touching a missing `worktreePath` must never be attempted; (4) *then* the ancestry probe → cleanup + `DONE`; (5) the checkout-on-base precondition → `ERROR`; (6) `merge --ff-only` → `FAIL` or `DONE` + cleanup. Because the commit now happens before the ancestry probe, a genuine no-change surface can legitimately reach that branch on its first close too, so the one `detail` written there must be true of both: it names the base branch's tip and says there is nothing new to land, with "already merged" as the leading phrase the replay test matches. The checkout precondition stays *after* the ancestry probe, as the design spec has it, so a replay that has nothing left to do still reports `DONE` even if the operator has since switched the shared checkout; the only cost is that a wrong-checkout first close commits the work in the worktree before refusing, which is harmless and leaves the work safer than it found it.

**Not in this slice:** the commit-to-branch closer, teardown on escalated/aborted, custom closers and `plugin-loader.ts`, the `open-pr` closer, the "writing a closer" guide, `CloseRepairBrief` threading, retry/escalation on a failed close (Slice 3 — a `FAIL`/`ERROR` close already routes to `TRIAGE` today, unchanged).

---

## Task 1: Shared git execution helpers ✅ DONE (deliver-slice)

**Files:**
- Create: `src/git-exec.ts`
- Create: `src/git-exec.test.ts`
- Modify: `src/provision.ts` (delete the local `git`/`tryGit`, import them)
- Modify: `src/temp-repo.ts` (persist the fixture identity in repo config)

**Interfaces:**
- Consumes: `cleanGitEnv()` from `src/git-env.js`.
- Produces:
  - `git(cwd: string, args: string[]): Promise<string>` — trimmed stdout, rejects on non-zero exit.
  - `tryGit(cwd: string, args: string[]): Promise<boolean>` — `true` if the command exited 0, `false` otherwise, never rejects.
  - `ensureCommitted(worktreePath: string, message: string): Promise<void>` — stages everything and commits, a no-op when the tree is clean.

Why `temp-repo.ts` changes: `initTempRepo` currently passes `user.email`/`user.name` with `-c` on the seed commit only. A worktree of that repo inherits repository config, not that one command's flags, so `ensureCommitted` inside a worktree would fail with "Author identity unknown" on any machine without a global git identity. Writing the identity into the repo config makes every test and demo commit deterministic.

- [ ] **Step 1: Write the failing test**

Create `src/git-exec.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { git, tryGit, ensureCommitted } from "./git-exec.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";

function gitSync(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

describe("git", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("returns trimmed stdout for a command that succeeds", async () => {
    expect(await git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
  });

  it("rejects for a command that fails", async () => {
    await expect(git(repo, ["rev-parse", "--verify", "refs/heads/nope"])).rejects.toThrow();
  });
});

describe("tryGit", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("reports true when the command exits zero", async () => {
    expect(await tryGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])).toBe(true);
  });

  it("reports false instead of throwing when the command fails", async () => {
    expect(await tryGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/nope"])).toBe(false);
  });
});

describe("ensureCommitted", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("commits every uncommitted change, including new files", async () => {
    writeFileSync(join(repo, "worker.txt"), "work\n");

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["status", "--porcelain"])).toBe("");
    expect(gitSync(repo, ["log", "-1", "--pretty=%s"])).toBe("accepted work");
  });

  it("is a no-op on a clean tree, leaving the history untouched", async () => {
    const before = gitSync(repo, ["rev-parse", "HEAD"]);

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["rev-parse", "HEAD"])).toBe(before);
  });

  it("is safe to call twice: the second call adds no commit", async () => {
    writeFileSync(join(repo, "worker.txt"), "work\n");
    await ensureCommitted(repo, "accepted work");
    const after = gitSync(repo, ["rev-parse", "HEAD"]);

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["rev-parse", "HEAD"])).toBe(after);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/git-exec.test.ts`
Expected: FAIL — cannot resolve `./git-exec.js`.

- [ ] **Step 3: Write the implementation**

Create `src/git-exec.ts`:

```typescript
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { cleanGitEnv } from "./git-env.js";

const execFile = promisify(execFileCb);

/**
 * Every git call the harness makes goes through here: arguments as a list so
 * nothing derived from task content can be read as shell syntax, and
 * `cleanGitEnv()` so an inherited `GIT_DIR`/`GIT_WORK_TREE` (git sets these for
 * hooks) cannot redirect the call away from `cwd`.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, env: cleanGitEnv() });
  return stdout.trim();
}

/** Ran-and-succeeded as a boolean, for probes and best-effort clean-up. */
export async function tryGit(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit whatever is in the worktree, tolerating "there is nothing to commit" —
 * either the worker changed nothing, or an earlier attempt already committed
 * before crashing. The emptiness check is `status --porcelain` rather than the
 * failed commit's message: git prints "nothing to commit" on stdout, which a
 * rejected `execFile` does not carry in its error message.
 */
export async function ensureCommitted(worktreePath: string, message: string): Promise<void> {
  await git(worktreePath, ["add", "-A"]);
  if ((await git(worktreePath, ["status", "--porcelain"])) === "") return;
  await git(worktreePath, ["commit", "-m", message]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/git-exec.test.ts`
Expected: PASS — all seven cases.

- [ ] **Step 5: Give the fixture repo a committable identity**

In `src/temp-repo.ts`, replace the seed commit's inline identity with repository config, so worktrees inherit it:

```typescript
  git(["init", "-b", "main"]);
  git(["config", "user.email", "harness@example.invalid"]);
  git(["config", "user.name", "Harness"]);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(repo, name), contents);
  }
  git(["add", "-A"]);
  git(["commit", "-m", "seed"]);
```

Update the doc comment's last sentence to: "Identity is written into the repository's own config so the seed commit, and any commit made in a worktree of this repo, works on a machine with no global git identity."

- [ ] **Step 6: Point `provision.ts` at the shared helpers**

In `src/provision.ts`, delete the local `execFile` import, the `const execFile = promisify(execFileCb)` line and the local `git`/`tryGit` functions, and import them instead:

```typescript
import { ProvisioningFailure } from "./errors.js";
import { messageOf } from "./gate-support.js";
import { git, tryGit } from "./git-exec.js";
```

Nothing else in the file changes: `resolveBaseRef` and `provisionWorktree` call the same two names with the same arguments.

- [ ] **Step 7: Run the existing provisioning suite as the extraction's regression proof**

Run: `npx vitest run src/provision.test.ts src/git-exec.test.ts`
Expected: PASS, unmodified provisioning tests included.

- [ ] **Step 8: Typecheck and lint the touched files**

Run: `npx tsc --noEmit && npx eslint src/git-exec.ts src/git-exec.test.ts src/provision.ts src/temp-repo.ts`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/git-exec.ts src/git-exec.test.ts src/provision.ts src/temp-repo.ts
git commit -m "Share provisioning's git helpers and add ensureCommitted

The closers Item 6 introduces need the same argv-array, clean-environment
git execution provisioning already had, so the two wrappers move into one
module rather than being copied. ensureCommitted joins them because
committing the worker's changes is the first step of every accept-path
close. The fixture repo now carries its identity in config so commits made
inside a worktree of it work without a global git identity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The base branch is pinned when the surface is provisioned ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/provision.ts` (`resolveBaseRef`, `provisionWorktree` return type)
- Modify: `src/schema.ts` (`CaseFileHeader.baseBranch`, `CreateHeader`)
- Modify: `src/case-file.ts` (`create` default, `setBaseBranch`)
- Modify: `src/surface.ts` (`provisioning` writes it once)
- Modify: `src/index.ts` (export `setBaseBranch`)
- Modify: `docs/provisioning.md` (the header's immutable identity block)
- Test: `src/provision.test.ts`, `src/case-file.test.ts`, `src/surface.test.ts`

**Interfaces:**
- Consumes: `git`/`tryGit` from Task 1.
- Produces:
  - `resolveBaseRef(repoPath: string): Promise<{ ref: string; localBranch: string }>` (module-private).
  - `provisionWorktree(dir, repoPath, worktreePath, surfaceId): Promise<{ restarted: boolean; baseBranch: string }>`.
  - `setBaseBranch(dir: string, branch: string): Promise<void>` — set-once, throws `ImmutabilityViolation` on a second call.
  - `CaseFileHeader.baseBranch: string | null`; `CreateHeader = Omit<CaseFileHeader, "baseline" | "baseBranch">`.

Why pin rather than resolve at close time: the close may run much later, possibly after a crash and after the repository's default branch has changed. Re-resolving would silently redirect the merge. This is the same reasoning that makes the gate baseline immutable.

- [ ] **Step 1: Write the failing tests**

In `src/provision.test.ts`, change the two existing `toEqual({ restarted: … })` assertions
(lines 55 and 63) to `toEqual({ restarted: …, baseBranch: "main" })` — that is the
local-branch case, so it needs no separate new test — and add one new case inside
`describe("provisionWorktree", …)` for the remote-tracking case:

```typescript
  it("reports a mergeable local branch, not a remote-tracking ref, when the repo has an origin", async () => {
    const origin = initTempRepo("provision-origin-", { "seed.txt": "hello\n" });
    git(repo, ["remote", "add", "origin", origin]);
    git(repo, ["fetch", "--quiet", "origin"]);
    git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

    const result = await provisionWorktree(dir, repo, tree, "surface-42");

    expect(result.baseBranch).toBe("main");
  });
```

Add to `src/case-file.test.ts`, as a new top-level block. Import `setBaseBranch` alongside
the other case-file imports; `ImmutabilityViolation` is already imported there. Note the
file's existing fixtures: the budget set is `budgetDefaults` (not `budgets`) and `gateRef`
is a module-level const, but there is **no** shared `header` const — each block builds its
own header literal inline. Follow that, declaring the header inline as below:

```typescript
const header = { surfaceId: "surface-base", taskDef: { intent: "x" }, gateRef };

describe("setBaseBranch", () => {
  it("starts null and records the branch the surface was started from", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);
    expect((await load(dir)).header.baseBranch).toBeNull();

    await setBaseBranch(dir, "main");

    expect((await load(dir)).header.baseBranch).toBe("main");
  });

  it("refuses a second write, like every other set-once header field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);
    await setBaseBranch(dir, "main");

    await expect(setBaseBranch(dir, "release")).rejects.toThrow(ImmutabilityViolation);
  });

  it("records no history entry, so the log tail still drives the state machine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);

    await setBaseBranch(dir, "main");

    expect((await load(dir)).history).toEqual([]);
  });
});
```

(`gateRef` and `budgetDefaults` are the existing module-level fixtures in that file; reuse them rather than declaring new ones.)

Add to `src/surface.test.ts`, inside `describe("advance", …)` beside the existing
provisioning cases (that block's `beforeEach` already creates `dir` with
`surfaceId: "surface-1"`, and the file's `provisioned()` helper performs the first
`advance` against a real temp repo):

```typescript
  it("pins the base branch the surface was provisioned from", async () => {
    await provisioned(dir, { "report.tap": PASSING_TAP }, portsWith(unusedAgent()));

    expect((await load(dir)).header.baseBranch).toBe("main");
  });

  it("re-provisions after a crash without failing on the already-pinned base branch", async () => {
    const ports = portsWith(unusedAgent());
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    // A crash before the cursor advance leaves the surface at PROVISIONING
    // with the base branch already written.
    await updateCursor(dir, { state: "PROVISIONING", worktreeRef: "" });

    const result = await advance(dir, location, ports);

    expect(result.state).toBe("PRE_GATING");
    expect((await load(dir)).header.baseBranch).toBe("main");
  });
```

Reuse `provisioned()`, `portsWith()` and `PASSING_TAP` as they already exist in that
file; introduce no second setup helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/provision.test.ts src/case-file.test.ts src/surface.test.ts`
Expected: FAIL — `setBaseBranch` is not exported; `baseBranch` missing from the provision result and the header.

- [ ] **Step 3: Widen `resolveBaseRef` and the provision result**

In `src/provision.ts`:

```typescript
/**
 * What the worktree branches off, in the two shapes a caller needs: `ref` for
 * `git worktree add`, and `localBranch` for anything that must later merge into
 * it. A remote-tracking ref such as `origin/main` cannot be merged into, so the
 * prefix is stripped for the local branch name.
 */
async function resolveBaseRef(repoPath: string): Promise<{ ref: string; localBranch: string }> {
  try {
    const ref = await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return { ref, localBranch: ref.replace(/^origin\//, "") };
  } catch {
    // No origin (a local-only or freshly-initialised repo): the checked-out
    // branch is the repo's default.
    const ref = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    return { ref, localBranch: ref };
  }
}
```

and in `provisionWorktree`, replacing the existing body's first and last lines of the `try`:

```typescript
export async function provisionWorktree(
  dir: string,
  repoPath: string,
  worktreePath: string,
  surfaceId: string,
): Promise<{ restarted: boolean; baseBranch: string }> {
  const branch = branchName(surfaceId);
  try {
    const { ref, localBranch } = await resolveBaseRef(repoPath);
    const removedTree = await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    const removedBranch = await tryGit(repoPath, ["branch", "-D", "--", branch]);
    await git(repoPath, ["worktree", "add", "-b", branch, "--", worktreePath, ref]);
    return { restarted: removedTree || removedBranch, baseBranch: localBranch };
  } catch (err) {
    throw new ProvisioningFailure(dir, messageOf(err));
  }
}
```

Extend the function's doc comment with: "Also reports the local branch the worktree was started from, which the surface pins in its header for the closer to merge into."

- [ ] **Step 4: Add the header field and the set-once writer**

In `src/schema.ts`:

```typescript
export const CaseFileHeader = z.object({
  surfaceId: z.string(),
  taskDef: TaskDef,
  gateRef: GateRef,
  domainPrompt: z.string().optional(),
  baseline: GateReport.nullable(),
  // The local branch this surface was provisioned from, pinned once at
  // PROVISIONING so a later default-branch change cannot redirect the close.
  baseBranch: z.string().nullable(),
});
export type CaseFileHeader = z.infer<typeof CaseFileHeader>;

// Header without the fields the surface fills in later — the public input type for create()
export type CreateHeader = Omit<CaseFileHeader, "baseline" | "baseBranch">;
```

In `src/case-file.ts`, in `create`:

```typescript
  const fullHeader: CaseFileHeader = { ...header, baseline: null, baseBranch: null };
```

and beside `setBaseline`:

```typescript
/**
 * Pin the branch the surface was provisioned from. Set-once like the baseline,
 * and for the same reason: the close may happen much later, and must target the
 * branch the work actually started from. Unlike the baseline it records no
 * history entry — it advances no state, and the log tail must stay the single
 * authority for `deriveStateFromEntry`.
 */
export function setBaseBranch(dir: string, branch: string): Promise<void> {
  return setOnce(
    dir,
    "baseBranch",
    (caseJson) => caseJson.header.baseBranch !== null,
    (caseJson) => ({ ...caseJson, header: { ...caseJson.header, baseBranch: branch } }),
  );
}
```

In `src/index.ts`, add `setBaseBranch` to the existing `./case-file.js` export list.

- [ ] **Step 5: Write it from the provisioning edge**

In `src/surface.ts`, import `setBaseBranch` from `./case-file.js` and change `provisioning`:

```typescript
  let restarted: boolean;
  let baseBranch: string;
  try {
    ({ restarted, baseBranch } = await provisionWorktree(
      dir, location.repoPath, worktreePath, caseFile.header.surfaceId,
    ));
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return abort(dir, caseFile, location, ports, "provisioning", err.detail);
  }

  // Guarded rather than unconditional: provisioning legitimately runs twice
  // when a crash lands before the cursor advance, and the pin is set-once.
  if (caseFile.header.baseBranch === null) await setBaseBranch(dir, baseBranch);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/provision.test.ts src/case-file.test.ts src/surface.test.ts`
Expected: PASS, including the pre-existing cases in all three files.

- [ ] **Step 7: Update the provisioning document**

In `docs/provisioning.md`, under "What provisioning owns", replace item 2's second sentence so the pinned base branch is described where the header is:

```markdown
2. **Write the case file header.** The immutable identity block: `surface_id`,
   `task_def`, `gate_ref`, `worktree_ref`, and `base_branch` — the local branch the
   worktree was started from, pinned here so a later default-branch change cannot
   redirect the close. The `baseline` field is created empty; the fingerprint is
   captured later at `PRE_GATING`, before the first dispatch, never here.
```

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/provision.ts src/schema.ts src/case-file.ts src/surface.ts src/index.ts`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/provision.ts src/schema.ts src/case-file.ts src/surface.ts src/index.ts src/provision.test.ts src/case-file.test.ts src/surface.test.ts docs/provisioning.md
git commit -m "Pin the base branch a surface was provisioned from

A close can happen long after provisioning, and after a crash. Resolving
the default branch afresh at close time would silently merge into whatever
the repository points at by then, so the branch is captured once at
PROVISIONING and stored set-once in the header, exactly as the gate
baseline is. The write is guarded because provisioning itself can legally
run twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The closer is told which repository, branch and base branch it is closing ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/ports.ts` (`CloseContext`, `noopCloser` comment)
- Modify: `src/surface.ts` (one context builder, used by `closing` and `terminate`)
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `header.baseBranch` (Task 2), `branchName` from `./provision.js`.
- Produces:

```typescript
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;   // the shared origin checkout; merge-back acts here
  branch: string;     // branchName(surfaceId): computed, never persisted
  baseBranch: string; // the local branch pinned at provisioning
}
```

- [ ] **Step 1: Write the failing test**

Add to `src/surface.test.ts`:

```typescript
describe("the close context", () => {
  let dir: string;
  let location: SurfaceLocation;
  let seen: CloseContext[];
  let recordingCloser: SurfacePorts["closer"];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    location = {
      repoPath: initTempRepo("surface-repo-", { "report.tap": PASSING_TAP }),
      worktreePath: join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt"),
    };
    seen = [];
    recordingCloser = {
      close: (ctx) => {
        seen.push(ctx);
        return Promise.resolve({ status: "DONE", detail: "recorded" });
      },
    };
  });

  it("tells the closer the repo, the surface branch and the pinned base branch", async () => {
    const agent = sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the change\n");
      return Promise.resolve({ status: "completed", rationale: "added the feature" });
    });

    await run(dir, location, { agent, triage: unusedTriage(), closer: recordingCloser });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      repoPath: location.repoPath,
      branch: "surface/surface-1",
      baseBranch: "main",
    });
  });

  it("gives an escalated surface's fire-and-log teardown the same context", async () => {
    // An authority-class escalate leaves the machine directly, so terminate()
    // — not closing() — is what calls the closer here.
    const agent = scriptedAgent([{ status: "escalate", category: "authority", rationale: "needs a human" }]);

    const result = await run(dir, location, { agent, triage: unusedTriage(), closer: recordingCloser });

    expect(result.state).toBe("ESCALATED");
    expect(seen[0]).toMatchObject({
      repoPath: location.repoPath,
      branch: "surface/surface-1",
      baseBranch: "main",
    });
  });
});
```

Everything above (`sessionAgent`, `scriptedAgent`, `unusedTriage`, `initTempRepo`,
`PASSING_TAP`, `gateRef`, `budgets`) already exists in `src/surface.test.ts`; add
nothing but the block itself. Import `CloseContext` as a type from `./ports.js`.
Note the surface id in this file's fixtures is `surface-1`, so the derived branch is
`surface/surface-1`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "the close context"`
Expected: FAIL — `repoPath`, `branch` and `baseBranch` are not on the context object (and do not typecheck).

- [ ] **Step 3: Widen the contract**

In `src/ports.ts`:

```typescript
/**
 * What a closer is given. `worktreePath` and `dir` are this surface's own;
 * `repoPath` is the checkout the worktree was created from and is shared with
 * the operator, which is why a closer may act on it but must never switch its
 * checked-out branch. `branch` is derived from the surface id, and `baseBranch`
 * is the local branch pinned when the surface was provisioned.
 */
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
}
```

- [ ] **Step 4: Build it once in `surface.ts`**

In `src/surface.ts`, import `branchName` alongside `provisionWorktree`, add the builder beside `worktreeOf`:

```typescript
/**
 * One place builds the closer's context, so the accept path and the
 * fire-and-log teardown path can never disagree about what a closer is given.
 * `baseBranch` is empty only if provisioning never completed, which no state
 * that reaches a closer can be; a closer that needs it reports the gap itself
 * rather than the driver guessing a branch.
 */
function closeContextOf(dir: string, caseFile: CaseFile, location: SurfaceLocation): CloseContext {
  return {
    worktreePath: worktreeOf(caseFile, location),
    dir,
    repoPath: location.repoPath,
    branch: branchName(caseFile.header.surfaceId),
    baseBranch: caseFile.header.baseBranch ?? "",
  };
}
```

then use it at both call sites, replacing the inline object literals:

```typescript
    await ports.closer.close(closeContextOf(dir, caseFile, location), { kind: outcome.kind });
```

in `terminate`, and

```typescript
  const report = await ports.closer.close(closeContextOf(dir, caseFile, location), { kind: "accepted" });
```

in `closing`. Import the `CloseContext` type from `./ports.js`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS, whole file.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/ports.ts src/surface.ts src/surface.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/ports.ts src/surface.ts src/surface.test.ts
git commit -m "Give closers the repo, surface branch and base branch

A real closer cannot act on worktreePath alone: merging needs the checkout
the worktree came from, the branch holding the work, and the branch to
merge into. One builder serves both the accept path and the fire-and-log
teardown so the two can never hand a closer different facts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The merge-back closer ✅ DONE (deliver-slice)

**Files:**
- Create: `src/merge-back-closer.ts`
- Create: `src/merge-back-closer.test.ts`

**Interfaces:**
- Consumes: `git`, `tryGit`, `ensureCommitted` (Task 1); `CloseContext`, `CloseOutcome`, `CloseReport`, `CloserPort` (Task 3, `src/ports.js`); `messageOf` from `./gate-support.js`.
- Produces: `createMergeBackCloser(options?: { deleteBranch?: boolean }): CloserPort`.

Ordering is load-bearing, and it deliberately diverges from the design spec's merge-back step list — see Decision 6. Cleanup always removes the worktree before (optionally) deleting the branch, so a missing branch still implies a missing worktree — that half of the design spec's reasoning holds. What does not hold with `deleteBranch: false` is the reverse: the branch can survive a replay after its worktree is already gone. So the existence check is on the worktree directory itself, not inferred from the branch, and `ensureCommitted` runs guarded by it — and before the ancestry probe, never after: the probe can only see committed work, so checking ancestry first (as the spec's list does) reads an uncommitted first close as already landed and discards it.

- [ ] **Step 1: Write the failing tests**

Create `src/merge-back-closer.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const accepted = { kind: "accepted" } as const;

describe("the merge-back closer", () => {
  let dir: string;
  let repo: string;
  let tree: string;
  let ctx: CloseContext;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-back-case-"));
    repo = initTempRepo("merge-back-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "merge-back-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("commits the worker's changes and fast-forwards the base branch onto them", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
  });

  it("says in plain prose which branch was updated and to which commit", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser().close(ctx, accepted);
    const sha = git(repo, ["rev-parse", "--short", "main"]);

    expect(report.detail).toContain("main");
    expect(report.detail).toContain(sha);
    expect(report.detail).toMatch(/fast-forward/i);
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/Updating|Fast-forward\n|files? changed/);
  });

  it("removes the worktree and deletes the surface branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await createMergeBackCloser().close(ctx, accepted);

    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("");
  });

  it("keeps the surface branch when the project asked to keep it", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("surface/surface-42");
  });

  it("closes cleanly when the worker changed nothing", async () => {
    const before = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
    expect(existsSync(tree)).toBe(false);
  });

  it("replayed after the merge but before cleanup, reports done without merging twice", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    // Crash window: the merge landed, cleanup never ran.
    await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);
    const merged = git(repo, ["rev-parse", "main"]);
    const commits = git(repo, ["rev-list", "--count", "main"]);

    const report = await createMergeBackCloser({ deleteBranch: false }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toMatch(/already merged/i);
    expect(git(repo, ["rev-parse", "main"])).toBe(merged);
    expect(git(repo, ["rev-list", "--count", "main"])).toBe(commits);
  });

  it("replayed after full cleanup, reports already closed without erroring on the missing worktree", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await createMergeBackCloser().close(ctx, accepted);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toMatch(/already closed/i);
  });

  it("refuses, without switching the checkout, when the repo is not on the base branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    git(repo, ["checkout", "-q", "-b", "elsewhere"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("elsewhere");
    expect(report.detail).toContain("main");
    expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("elsewhere");
    expect(existsSync(tree)).toBe(true);
  });

  it("reports a diverged base branch as a refusal, leaving the repo and worktree untouched", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    writeFileSync(join(repo, "other.txt"), "moved on\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "main moved on"]);
    const tip = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("FAIL");
    expect(report.detail).toContain(git(repo, ["rev-parse", "--short", "main"]));
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(existsSync(tree)).toBe(true);
  });

  it("reports an error, never a throw, when the surface has no pinned base branch", async () => {
    const report = await createMergeBackCloser().close({ ...ctx, baseBranch: "" }, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/base branch/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/merge-back-closer.test.ts`
Expected: FAIL — cannot resolve `./merge-back-closer.js`.

- [ ] **Step 3: Write the implementation**

Create `src/merge-back-closer.ts`:

```typescript
import { existsSync } from "node:fs";
import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "./ports.js";
import { messageOf } from "./gate-support.js";
import { ensureCommitted, git, tryGit } from "./git-exec.js";

/**
 * Land the accepted work on the branch the surface was started from.
 *
 * Every "have I already done this?" answer comes from git state, because the
 * close report carries no resume token: a crash anywhere between the merge and
 * the surface recording the close replays this same function.
 *
 * The order is load-bearing, and deliberately not the design spec's: branch
 * existence is checked, then (guarded by the worktree still existing)
 * `ensureCommitted`, and only then the ancestry probe — never the reverse. The
 * worker's changes are uncommitted at the start of a first close, so an
 * ancestry probe run before committing sees the surface branch sitting exactly
 * at the base tip and reports "already merged", discarding the work. The
 * worktree-existence guard, not a branch-existence inference, is what lets a
 * `deleteBranch: false` replay skip straight to the ancestry probe once the
 * worktree is gone but the branch survived cleanup.
 *
 * The merge lands on the local base branch only. Nothing is pushed.
 */
export function createMergeBackCloser(options: { deleteBranch?: boolean } = {}): CloserPort {
  const deleteBranch = options.deleteBranch ?? true;

  async function cleanup(ctx: CloseContext): Promise<void> {
    // Tolerated, as in provisioning: "already gone" is the common case on a
    // replay. Worktree first, then branch, so a missing branch always implies
    // a missing worktree — though with deleteBranch:false the branch can
    // outlive the worktree, which is why callers never infer worktree
    // presence from branch presence.
    await tryGit(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
    await tryGit(ctx.repoPath, ["worktree", "prune"]);
    if (deleteBranch) {
      // Lower-case -d is git's own "is this merged?" guard.
      await tryGit(ctx.repoPath, ["branch", "-d", "--", ctx.branch]);
    }
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return { status: "ERROR", detail: "This surface has no pinned base branch, so there is nothing to merge into." };
    }

    const branchExists = await tryGit(ctx.repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${ctx.branch}`]);
    if (!branchExists) {
      return {
        status: "DONE",
        detail: `Already closed: branch ${ctx.branch} no longer exists, so an earlier close merged the work and cleaned up.`,
      };
    }

    // Guarded on the worktree's own existence, not on branch existence: with
    // deleteBranch:false a replay can find the branch still here after an
    // earlier close already removed the worktree, and worktreePath must never
    // be touched once it is gone. Run before the ancestry probe below — the
    // probe can only see committed work.
    if (existsSync(ctx.worktreePath)) {
      await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    }

    const nothingToLand = await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.branch, ctx.baseBranch]);
    if (nothingToLand) {
      await cleanup(ctx);
      const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      return {
        status: "DONE",
        detail:
          `Already merged: ${ctx.baseBranch} is at ${sha} and already has everything from ${ctx.branch} — ` +
          `nothing new to land. Cleaned up the scratch worktree.`,
      };
    }

    const head = await git(ctx.repoPath, ["symbolic-ref", "--short", "HEAD"]);
    if (head !== ctx.baseBranch) {
      return {
        status: "ERROR",
        detail:
          `The main checkout is on ${head}, not the base branch ${ctx.baseBranch}. ` +
          `Switching a checkout someone else may be using is not this closer's call, so nothing was changed. ` +
          `Check out ${ctx.baseBranch} there and close again.`,
      };
    }

    // The merge is its own conflict probe: --ff-only either advances the ref or
    // refuses, changing nothing either way.
    const merged = await tryGit(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]);
    if (!merged) {
      const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      return {
        status: "FAIL",
        detail:
          `Could not fast-forward ${ctx.baseBranch} onto ${ctx.branch}. ${ctx.baseBranch} is at ${tip}: either it has ` +
          `moved on since this surface started, or the checkout has local changes in the way. ` +
          `Nothing was changed and the work is still on ${ctx.branch}.`,
      };
    }

    const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
    await cleanup(ctx);
    const branchNote = deleteBranch ? `, and deleted ${ctx.branch}` : `. ${ctx.branch} was kept`;
    return {
      status: "DONE",
      detail:
        `Fast-forwarded ${ctx.baseBranch} to ${sha}, so the accepted work is now on ${ctx.baseBranch} in this checkout ` +
        `(nothing was pushed). Removed the scratch worktree${branchNote}.`,
    };
  }

  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      try {
        if (outcome.kind !== "accepted") {
          // Teardown of a stopped surface is the next slice's shared routine.
          return {
            status: "DONE",
            detail: `The surface ended ${outcome.kind}, so nothing was merged. Its worktree and branch ${ctx.branch} were left in place.`,
          };
        }
        return await closeAccepted(ctx);
      } catch (err) {
        // A closer never throws at the driver: an environment problem is an
        // ERROR report, which routes to close-triage like any other.
        return { status: "ERROR", detail: `The close could not run: ${messageOf(err)}` };
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/merge-back-closer.test.ts`
Expected: PASS — all ten cases.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/merge-back-closer.ts src/merge-back-closer.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/merge-back-closer.ts src/merge-back-closer.test.ts
git commit -m "Add the merge-back closer

Accepted work has had nowhere to go: the no-op closer left it uncommitted
in a scratch worktree. This commits it and fast-forwards the pinned base
branch onto it, then clears the worktree and branch. Every replay answer
is derived from git state because the close report carries no resume
token, and the shared checkout is refused rather than switched when it is
on the wrong branch.

The commit happens before the ancestry probe, not after as the design
spec's step list has it: probing ancestry first sees an uncommitted first
close as already landed and discards the work. The probe is guarded by
the worktree's own existence rather than the branch's, because a
deleteBranch:false replay can find the branch outliving its worktree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: A project selects the closer as data ✅ DONE (deliver-slice)

**Files:**
- Create: `src/closer-support.ts`
- Create: `src/resolve-closer.ts`
- Create: `src/resolve-closer.test.ts`
- Modify: `src/schema.ts` (`CloserRef`)
- Modify: `src/index.ts` (exports)
- Test: `src/schema.test.ts` (the `CloserRef` cases)

**Interfaces:**
- Consumes: `createMergeBackCloser` (Task 4); `CloserPort`, `CloseReport` from `./ports.js`.
- Produces:
  - `CloserRef` (zod schema and inferred type) in `src/schema.ts`.
  - `failedCloser(detail: string): CloserPort` in `src/closer-support.ts`.
  - `resolveCloser(ref: CloserRef): CloserPort` in `src/resolve-closer.ts`.

This mirrors `resolveGate`: total, so a caller never has to tell "failed to resolve" from "failed to run" — both arrive as an `ERROR` report from `close()`.

- [ ] **Step 1: Write the failing tests**

Add to `src/schema.test.ts` (import `CloserRef` as a value alongside the other schema
imports there — it is used as `CloserRef.parse`, not as a type):

```typescript
describe("CloserRef", () => {
  it("accepts the merge-back closer named with no parameters", () => {
    expect(CloserRef.parse({ type: "merge-back" })).toEqual({ type: "merge-back" });
  });

  it("accepts an explicit request to keep the surface branch", () => {
    expect(CloserRef.parse({ type: "merge-back", deleteBranch: false }).deleteBranch).toBe(false);
  });

  it("rejects a closer type it does not know", () => {
    expect(CloserRef.safeParse({ type: "teleport" }).success).toBe(false);
  });
});
```

Create `src/resolve-closer.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCloser } from "./resolve-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloserRef } from "./schema.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const accepted = { kind: "accepted" } as const;

describe("resolveCloser", () => {
  let ctx: CloseContext;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "resolve-closer-case-"));
    repo = initTempRepo("resolve-closer-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "resolve-closer-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("turns the merge-back name into a closer that actually merges", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await resolveCloser({ type: "merge-back" }).close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
  });

  it("passes the keep-the-branch parameter through", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await resolveCloser({ type: "merge-back", deleteBranch: false }).close(ctx, accepted);

    expect(git(repo, ["branch", "--list", "surface/surface-42", "--format=%(refname:short)"])).toBe("surface/surface-42");
  });

  it("turns an unknown closer reference into an error report, not a crash", async () => {
    const report = await resolveCloser({ type: "teleport" } as unknown as CloserRef).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
    expect(existsSync(tree)).toBe(true);
  });

  it("turns an unreadable closer reference into an error report", async () => {
    const report = await resolveCloser(undefined as unknown as CloserRef).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/closer reference/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/resolve-closer.test.ts src/schema.test.ts -t "CloserRef"`
Expected: FAIL — `resolveCloser` and `CloserRef` do not exist.

- [ ] **Step 3: Add the reference schema**

In `src/schema.ts`, beside `GateRef`:

```typescript
/**
 * Which closer this surface uses, as data. A project names a strategy and its
 * parameters; it never implements one. No variant takes a base branch: the
 * target is the branch pinned at provisioning, so an owner never restates
 * something the harness already derived.
 */
export const CloserRef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("merge-back"),
    deleteBranch: z.boolean().optional(),
  }),
]);
export type CloserRef = z.infer<typeof CloserRef>;
```

- [ ] **Step 4: Write the resolver**

Create `src/closer-support.ts`:

```typescript
import type { CloserPort } from "./ports.js";

/**
 * A closer that reports the same failure however it is called. Resolution
 * failures use this so a caller never has to distinguish "failed to resolve"
 * from "failed to run" — both are just an ERROR report, exactly as `failedGate`
 * does for gates.
 */
export function failedCloser(detail: string): CloserPort {
  return { close: () => Promise.resolve({ status: "ERROR", detail }) };
}
```

Create `src/resolve-closer.ts`:

```typescript
import type { CloserPort } from "./ports.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { failedCloser } from "./closer-support.js";
import { CloserRef } from "./schema.js";

/**
 * Turn a pinned closer reference into a runnable closer. Total, like
 * `resolveGate`: an unparseable reference (an unknown type, a missing one)
 * yields a closer whose `close()` returns an ERROR report, so a
 * misconfiguration reaches close-triage as a report rather than as a crash of
 * the surface.
 */
export function resolveCloser(closerRef: CloserRef): CloserPort {
  const parsed = CloserRef.safeParse(closerRef);
  if (!parsed.success) {
    return failedCloser(`Cannot resolve closer reference: ${parsed.error.message}`);
  }

  return createMergeBackCloser({ deleteBranch: parsed.data.deleteBranch });
}
```

- [ ] **Step 5: Export the new public surface**

In `src/index.ts`:

```typescript
export { resolveCloser } from "./resolve-closer.js";
export { createMergeBackCloser } from "./merge-back-closer.js";
export { failedCloser } from "./closer-support.js";
```

and add `CloserRef` to the existing `export type { … } from "./schema.js"` list.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/resolve-closer.test.ts src/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/resolve-closer.ts src/closer-support.ts src/schema.ts src/index.ts src/resolve-closer.test.ts`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/resolve-closer.ts src/closer-support.ts src/resolve-closer.test.ts src/schema.ts src/index.ts src/schema.test.ts
git commit -m "Select a closer by naming it as data

A project should say 'merge it back', not write a close step. CloserRef
and resolveCloser mirror GateRef and resolveGate exactly — a zod union and
a total resolver, no registry — so an unknown or unreadable reference
becomes an ERROR report that routes like any other close failure instead
of crashing the surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The merge-back demo ✅ DONE (deliver-slice)

**Files:**
- Create: `demos/close-interface-slice-1-merge-back.ts`
- Modify: `package.json` (`demo:close-slice-1`)

**Interfaces:**
- Consumes: `resolveCloser` (Task 5), `create`/`load` from `./src/case-file.js`, `advance`/`run` from `./src/surface.js`, `initTempRepo`, the `AgentPort`/`SurfacePorts` fakes the existing demos use.
- Produces: no library symbols. A runnable script whose printed output is the slice's UAT evidence.

The demo follows the existing `demos/single-surface-slice-*.ts` shape: a real temporary git repository, a stand-in worker that writes a file into the worktree, a command gate over a TAP file, and printed output a reader can follow without reading the source.

It is also the slice's only end-to-end proof of the first acceptance criterion — a named
closer carrying an accepted surface all the way to `CLOSED` with the work on the base
branch. The unit tests prove each half (`resolveCloser` → a closer that merges; the
driver → a closer called with the right context), and the composition is proved here.
Keep the `--- N. …` section headings: `tests/helpers.ts`'s `sectionOf` slices demo output
on exactly that shape, and the recorded UAT test under `tests/close-interface/` — a later
step in the workflow, not this plan's — will read them.

- [ ] **Step 1: Write the demo script**

Create `demos/close-interface-slice-1-merge-back.ts`:

```typescript
/**
 * UAT demo for Close Interface Slice 1: Accepted Work Is Merged Into the Base
 * Branch.
 *
 * Creates a scratch git repository, starts a surface in its own worktree,
 * writes a change into that worktree as a stand-in worker, and accepts it with
 * the merge-back closer selected by name. Then replays the close as if the
 * process had crashed immediately after the merge.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip.
 *
 * Usage: npx tsx demos/close-interface-slice-1-merge-back.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { provisionWorktree } from "../src/provision.js";
import { resolveCloser } from "../src/resolve-closer.js";
import type { AgentContext, AgentPort, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const closerRef: CloserRef = { type: "merge-back" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** Stands in for a worker: writes the change the project asked for. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback is expected in this demo")),
};

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 1: accepted work merged into the base branch ===\n");
  console.log("The project names its closer as data — no closer code is written here:");
  console.log(`  closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("The merge lands on the LOCAL base branch in this scratch repository.");
  console.log("Nothing is pushed anywhere: no remote is involved at any point.\n");

  const repo = initTempRepo("close-demo-repo-", { "report.tap": PASSING_TAP });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-case-"));
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-tree-")), "wt");
  const location: SurfaceLocation = { repoPath: repo, worktreePath };
  const ports: SurfacePorts = {
    agent: workingAgent,
    triage: unusedTriage,
    closer: resolveCloser(closerRef),
  };

  await create(dir, { surfaceId: "surface-42", taskDef: { goal: "add the feature" }, gateRef }, budgets);
  const result = await run(dir, location, ports);

  const caseFile = await load(dir);
  const closeEntry = caseFile.history.filter((e) => e.t === "close").at(-1);
  console.log(`--- 1. The surface ran to ${result.state} ---`);
  console.log(`Base branch pinned at provisioning: ${caseFile.header.baseBranch}`);
  console.log(`Close report status:                ${closeEntry?.status}`);
  console.log(`Closing report: ${caseFile.outcome?.reason}\n`);

  console.log("--- 2. The repository afterwards ---");
  console.log(`main's history:   ${git(repo, ["log", "--oneline", "main"]).split("\n").join(" | ")}`);
  console.log(`feature.txt on main: ${git(repo, ["show", "main:feature.txt"])}`);
  console.log(`Surface branches left: ${git(repo, ["branch", "--list", "surface/*"]) || "(none)"}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(worktreePath)}\n`);

  console.log("--- 3. Replaying the close, as if the process had crashed just after merging ---");
  // The crash window the UAT asks for: the merge landed, cleanup never ran. A
  // second surface, closed with the branch kept, leaves exactly that state
  // behind, so closing it again is the replay.
  console.log("A close that keeps its branch leaves exactly the crash state behind — merged,");
  console.log("but not cleaned up — so closing it a second time IS the replay.\n");
  const keepBranch: CloserRef = { type: "merge-back", deleteBranch: false };
  const secondTree = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-tree-")), "wt");
  const { baseBranch } = await provisionWorktree(dir, repo, secondTree, "surface-43");
  fs.writeFileSync(path.join(secondTree, "second.txt"), "more accepted work\n");
  const secondCtx = { dir, repoPath: repo, worktreePath: secondTree, branch: "surface/surface-43", baseBranch };

  const first = await resolveCloser(keepBranch).close(secondCtx, { kind: "accepted" });
  console.log(`First close:  ${first.status} — ${first.detail}`);
  const commitsBefore = git(repo, ["rev-list", "--count", "main"]);

  const replay = await resolveCloser(keepBranch).close(secondCtx, { kind: "accepted" });
  console.log(`Replayed:     ${replay.status} — ${replay.detail}`);
  console.log(`Commits on main before replay: ${commitsBefore}, after: ${git(repo, ["rev-list", "--count", "main"])}`);
  console.log(`main's history: ${git(repo, ["log", "--oneline", "main"]).split("\n").join(" | ")}\n`);

  console.log("--- 4. Replaying the first surface's close, after its cleanup had finished ---");
  const afterCleanup = await resolveCloser(closerRef).close(
    {
      dir,
      repoPath: repo,
      worktreePath,
      branch: `surface/${caseFile.header.surfaceId}`,
      baseBranch: caseFile.header.baseBranch ?? "",
    },
    { kind: "accepted" },
  );
  console.log(`Replayed close status: ${afterCleanup.status}`);
  console.log(`Replayed close report: ${afterCleanup.detail}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Register the demo script**

In `package.json`, after `demo:triage-slice-3`:

```json
    "demo:close-slice-1": "npx tsx demos/close-interface-slice-1-merge-back.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:close-slice-1`
Expected: section 1 reports `CLOSED` with a base branch of `main` and a closing report naming `main` and a short commit; section 2 shows `feature.txt` on `main`, no `surface/*` branch and `Scratch worktree still on disk: false`; section 3 shows a first close that fast-forwards `main`, then a replay reporting `DONE` with an "already merged" report and an unchanged commit count; section 4 reports `DONE` with an "already closed" report.

- [ ] **Step 4: Typecheck and lint the demo**

Run: `npx tsc --noEmit && npx eslint demos/close-interface-slice-1-merge-back.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add demos/close-interface-slice-1-merge-back.ts package.json
git commit -m "Add the merge-back demo

The slice's claim is that a project owner gets usable work by naming a
closer rather than writing one, and that a replayed close does not merge
twice. The demo shows both against a real scratch repository, and states
plainly that the merge is local and nothing is pushed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| Closer named as data, no closer code, accepted surface ends closed with work on the base branch | 5 (`resolveCloser`), 4 (the merge), 6 (demonstrated end to end) |
| Base branch is the one the surface started from, captured at provisioning, immune to a later default-branch change | 2 (`setBaseBranch`, set-once; `resolveBaseRef`'s `localBranch`) |
| Provisioning twice after a crash does not fail on the already-captured base branch | 2 (guarded write + its test) |
| Uncommitted changes committed before merging; a surface with no changes still closes cleanly | 1 (`ensureCommitted`), 4 ("closes cleanly when the worker changed nothing") |
| Worktree removed and surface branch deleted, unless the project asked to keep it | 4 (`cleanup`, `deleteBranch`), 5 (parameter passed through) |
| Report names branch and commit in plain prose, no raw git output | 4 ("says in plain prose …", with the negative assertion) |
| Crash after merge before cleanup, replayed, reports done without merging twice | 4 ("replayed after the merge but before cleanup …") |
| Crash after full cleanup, replayed, reports already closed without erroring on a missing worktree | 4 (branch-existence probe, then a worktree-existence guard, before anything touches the worktree) |
| Unreadable or unknown closer reference produces an error report, never a crash | 5 (`failedCloser`, both cases) |
| Main checkout not on the base branch: refuse, name the problem, do not switch | 4 ("refuses, without switching the checkout …") |

No gaps.

**2. Placeholder scan** — every step carries the real code or the real command. Every
helper a test leans on is one that genuinely exists today and is named exactly:
`src/surface.test.ts`'s `provisioned`, `portsWith`, `sessionAgent`, `scriptedAgent`,
`unusedAgent`, `unusedTriage`, `PASSING_TAP`, `gateRef` and `budgets`;
`src/provision.test.ts`'s `git`; `src/case-file.test.ts`'s `gateRef`/`budgetDefaults`
(that file has no shared `header` fixture, so Task 2 declares one inline). The
surface fixtures use `surfaceId: "surface-1"`, so the derived branch in those tests is
`surface/surface-1`; only the closer's own tests, which call `provisionWorktree`
directly, use `surface-42`.

**3. Type consistency** — `createMergeBackCloser(options?: { deleteBranch?: boolean })` is used with that shape in Tasks 4, 5 and 6. `provisionWorktree` returns `{ restarted, baseBranch }` in Task 2 and is destructured that way in Tasks 4, 5 and 6's tests. `CloseContext`'s five fields are constructed identically in Task 3's builder, Task 4's tests, Task 5's tests and Task 6's replay. `resolveCloser(ref)` is single-argument everywhere. `setBaseBranch(dir, branch)` matches its call site.

**4. Right-choice re-audit**

| Decision | Pre-planning choice | What the plan does | Easy or Right |
|---|---|---|---|
| Git execution | Share `provision.ts`'s wrappers | Task 1 extracts them; `provision.ts` imports; the unmodified provisioning suite is the regression proof | Right |
| Closer selection | Mirror `GateRef`/`resolveGate` | Task 5: zod union + total resolver + `failedCloser`, no registry | Right |
| Replay safety | Derive from git state | Task 4 probes branch existence, then (guarded on the worktree) commits, then ancestry; no persisted cleanup marker | Right |
| "Nothing to commit" | Spec's error-text match | Changed to `status --porcelain` after verifying git prints that sentence to stdout; recorded as decision 1 | Right (the spec's snippet would silently break the no-change close) |
| Merge-back's step order | Spec's list: ancestry probe before commit | Reversed — commit (guarded on worktree existence) before the ancestry probe; recorded as decision 6 | Right (verified against real git: the spec's order reads an uncommitted first close as already merged and discards the work) |
| Shared checkout on the wrong branch | Refuse | Task 4 returns `ERROR` and asserts the checkout is unchanged | Right |
| `resolveCloser`'s `repoPath` | Spec mandates it | Deferred to Slice 4 with its first reader; recorded as decision 2 | Right (a dead parameter now, and the strict lint config would flag it) |
| `closerRef` in the header | Spec pins it there | Deferred to the slice with a reader; recorded as decision 3 | Right (no reader exists; adding it churns every fixture for no behaviour) |
| Non-accept branch of merge-back | Slice 2 owns teardown | Placeholder `DONE` naming what was left in place, replaced by Slice 2's shared routine; recorded as decision 4 | Right |
| Fixture git identity | Not in the spec | Task 1 writes it into repo config, so worktree commits are deterministic on any machine | Right |
| Context construction | One builder | Task 3's `closeContextOf` serves both `closing` and `terminate` | Right |
| Commit granularity | Per task | Six commits, each a working increment with its own tests | Right |

No drift found.

**5. Scaffolding drift check** — behaviours this slice changes, and where each description is updated: provisioning now pins a base branch in the header (`docs/provisioning.md` → Task 2; `provisionWorktree`'s own doc comment → Task 2); a closer is now given repo, branch and base branch (`CloseContext`'s doc comment → Task 3); new public symbols (`src/index.ts` → Tasks 2 and 5); a new runnable command (`package.json` → Task 6); the fixture repo's identity behaviour (`temp-repo.ts` doc comment → Task 1). Searched for descriptions rather than references: `docs/single-surface-control-flow.md`'s close-interface section and `docs/provisioning.md`'s closer sentence describe the contract and the harness/project split, both unchanged by this slice; `docs/writing-a-gate.md` and `docs/configuring-a-role.md` describe gates and roles, untouched; `README.md` and `CONTRIBUTING.md` document neither closers nor demo scripts individually. No new env var, dependency or build step. Every scaffolding update rides with the task whose deliverable caused it.
