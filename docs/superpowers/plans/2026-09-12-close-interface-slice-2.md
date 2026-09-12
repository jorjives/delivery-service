# Close Interface — Slice 2: Work Can Be Left on Its Own Branch, and Stopped Surfaces Tidy Up

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-11-close-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Goal:** Add the `commit-to-branch` closer, so accepted work can be committed on the surface's own branch without merging, and give every built-in one shared teardown routine that removes the scratch worktree and keeps the branch when a surface ends escalated or aborted.

**Architecture:** Two small additions to the existing flat `src/*.ts` layout. `closer-support.ts` gains `removeWorktree(ctx)` (the two tolerated `git worktree` calls provisioning and `merge-back` already use) and `teardownWorktree(ctx, outcome)` built on it, returning a `DONE` report naming the kept branch; `merge-back-closer.ts` is refactored onto both, replacing its placeholder non-accept branch. A new `commit-to-branch-closer.ts` commits via the shared `ensureCommitted`, removes the worktree via `removeWorktree`, and never touches the branch. `CloserRef` gains its second variant and `resolveCloser` switches on `type`.

**Tech Stack:** TypeScript (ESM, `node:` builtins only), zod for the ref schema, vitest, system `git` driven through `src/git-exec.ts` (`execFile`, argv arrays, `cleanGitEnv()`).

## Global Constraints

- **Buy-vs-build (from the slice's Build note and the spec's buy-vs-build table):** teardown is **one shared routine used by every built-in closer, not a copy per closer**, and reuses the tolerant worktree-removal behaviour provisioning already has. Git is driven by the codebase's own `src/git-exec.ts` helpers (`git`, `tryGit`, `ensureCommitted`) — no git library, no new dependency.
- **No shell, ever.** Every git call is `execFile("git", [...argv], { cwd, env: cleanGitEnv() })` via `git-exec.ts`. Branch names derive from task content, so nothing may pass through `/bin/sh`.
- **Closer selection is data.** A project names `{ type: "commit-to-branch" }`; `resolveCloser` stays total — an unparseable ref yields `failedCloser`, never a throw. The ref shape is validated with the codebase's existing schema library (zod), mirroring `GateRef`/`resolveGate` with no registry.
- **`detail` is plain, factual prose** naming the specific cause or outcome — never a raw git transcript and never a raw error dump.
- **A closer never throws at the driver.** Any exception becomes `{ status: "ERROR", detail }`.
- **Operability / DX (from the slice's Operational note):** the demo and tests need only a system `git` — no network, no API key, nothing to skip. Teardown failures on a stopped surface are logged, never re-triaged, and the demo must show that a second teardown is harmless.
- **Deliberate omission, licensed by the spec:** the COULD-tier `push` field on `commit-to-branch` is *not* added to `CloserRef`. The spec's open questions say "delivery may omit the field until it is built"; a field that parses and silently does nothing would mislead the project owner setting it.

## Scaffolding Impact

- `package.json` demo script (`demo:close-slice-2`, alongside `demo:close-slice-1`) → added in Task 3, with the demo it runs.
- No doc, README section or skill describes closer behaviour yet: `docs/configuring-a-role.md` references only `noopCloser` (unchanged by this slice), and the "writing a closer" guide is Slice 4's deliverable. The `CloserRef` union and the built-ins' reports are documented nowhere outside the design spec, which already describes the end state.
- No new command, env var, dependency or CI step: `make verify` (`npm ci`, `npm run lint`, `npm test`) covers the new files unchanged, and `tests/typecheck-coverage.test.ts` already forces every tracked `.ts` file — the new demo included — into `tsconfig.json`'s programme.

---

### Task 1: Shared teardown for stopped surfaces

Teardown is the routine every built-in closer will share: remove the scratch worktree, keep the branch. It lands in `closer-support.ts` (the spec's home for it, beside `failedCloser`), with `removeWorktree` factored out of `merge-back-closer.ts`'s existing `cleanup` so all three call sites — `merge-back`'s accept cleanup, teardown, and Task 2's `commit-to-branch` — use one copy.

**Files:**
- Modify: `src/closer-support.ts` (append `removeWorktree`, `teardownWorktree`)
- Modify: `src/merge-back-closer.ts:28-40` (`cleanup` uses `removeWorktree`), `src/merge-back-closer.ts:110-118` (the non-accept branch calls `teardownWorktree`)
- Modify: `src/index.ts:10` (export `teardownWorktree`)
- Test: `src/closer-support.test.ts` (create), `src/merge-back-closer.test.ts` (append), `src/surface.test.ts` (append one test)

**Interfaces:**
- Consumes: `tryGit(cwd, args)` from `src/git-exec.js`; `CloseContext`, `CloseOutcome`, `CloseReport`, `CloserPort` from `src/ports.js`; `provisionWorktree(dir, repoPath, worktreePath, surfaceId) => Promise<{ restarted, baseBranch }>` and `initTempRepo(prefix, files)` in tests.
- Produces:
  - `removeWorktree(ctx: CloseContext): Promise<void>` — the two tolerated `git worktree` calls.
  - `teardownWorktree(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport>` — always `DONE`, branch always kept.

Note on the signature: the spec writes `teardownWorktree(ctx)`, but the report's prose has to name *which* stopped outcome it is tidying after. Passing `outcome` keeps that one sentence in the shared routine rather than making each closer write its own copy of it.

- [ ] **Step 1: Write the failing tests for the shared routine**

Create `src/closer-support.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teardownWorktree } from "./closer-support.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

describe("teardownWorktree", () => {
  let ctx: CloseContext;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "teardown-case-"));
    repo = initTempRepo("teardown-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "teardown-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("removes the scratch worktree and keeps the branch", async () => {
    const report = await teardownWorktree(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("says in plain prose which branch was kept and why", async () => {
    const report = await teardownWorktree(ctx, { kind: "escalated" });

    expect(report.detail).toContain("surface/surface-42");
    expect(report.detail).toContain("escalated");
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/Preparing worktree|HEAD is now at/);
  });

  it("is harmless the second time, leaving the branch untouched", async () => {
    const first = await teardownWorktree(ctx, { kind: "aborted" });
    const tip = git(repo, ["rev-parse", "surface/surface-42"]);

    const second = await teardownWorktree(ctx, { kind: "aborted" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    expect(git(repo, ["rev-parse", "surface/surface-42"])).toBe(tip);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/closer-support.test.ts`
Expected: FAIL — `teardownWorktree` is not exported from `./closer-support.js`.

- [ ] **Step 3: Implement the shared routine**

Append to `src/closer-support.ts` (and add the imports it needs at the top of the file):

```typescript
import { tryGit } from "./git-exec.js";
import type { CloseContext, CloseOutcome, CloseReport } from "./ports.js";

/**
 * Drop a scratch worktree, tolerating "already gone" exactly as provisioning
 * does: on a replay the removal has usually already happened, and a closer has
 * no resume token to tell it so. `prune` clears the administrative entry left
 * behind when the directory itself vanished without git's help.
 */
export async function removeWorktree(ctx: CloseContext): Promise<void> {
  await tryGit(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
  await tryGit(ctx.repoPath, ["worktree", "prune"]);
}

/**
 * What every built-in closer does when the surface did not end accepted: clear
 * the scratch directory, keep the branch. The branch is what whoever takes over
 * an escalation inspects or continues from, so no built-in ever deletes it on a
 * stopped surface.
 *
 * Idempotent by construction — both calls tolerate an absent worktree — because
 * a teardown failure is only logged by the driver, so a later replay is the only
 * thing that will ever try again.
 */
export async function teardownWorktree(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> {
  await removeWorktree(ctx);
  return {
    status: "DONE",
    detail:
      `The surface ended ${outcome.kind}, so nothing was landed. Removed its scratch worktree and kept ` +
      `branch ${ctx.branch}, where the work was left for whoever takes it over.`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/closer-support.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for merge-back's stopped outcomes**

Append inside the existing `describe("the merge-back closer", ...)` block in `src/merge-back-closer.test.ts`:

```typescript
  it("removes the worktree and keeps the branch when the surface escalated", async () => {
    writeFileSync(join(tree, "feature.txt"), "half-finished work\n");

    const report = await createMergeBackCloser().close(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
    expect(report.detail).toContain("surface/surface-42");
  });

  it("removes the worktree and keeps the branch when the surface aborted", async () => {
    const report = await createMergeBackCloser().close(ctx, { kind: "aborted" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("keeps the branch on a stopped surface even when it would delete it on an accept", async () => {
    // deleteBranch defaults to true; a stopped surface must be exempt from it.
    await createMergeBackCloser({ deleteBranch: true }).close(ctx, { kind: "escalated" });

    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/merge-back-closer.test.ts`
Expected: FAIL — the first two assert `existsSync(tree) === false` but the current placeholder branch leaves the worktree in place ("Its worktree and branch … were left in place").

- [ ] **Step 7: Wire merge-back onto the shared routines**

In `src/merge-back-closer.ts`, replace the body of the local `cleanup` helper's worktree calls with `removeWorktree`, and replace the non-accept branch with a `teardownWorktree` call.

Import line:

```typescript
import { removeWorktree, teardownWorktree } from "./closer-support.js";
```

`cleanup` becomes:

```typescript
  async function cleanup(ctx: CloseContext): Promise<void> {
    // Worktree first, then branch, so a missing branch always implies a missing
    // worktree — though with deleteBranch:false the branch can outlive the
    // worktree, which is why callers never infer worktree presence from branch
    // presence.
    await removeWorktree(ctx);
    if (deleteBranch) {
      // Lower-case -d is git's own "is this merged?" guard.
      await tryGit(ctx.repoPath, ["branch", "-d", "--", ctx.branch]);
    }
  }
```

and the non-accept branch of `close` becomes:

```typescript
        if (outcome.kind !== "accepted") {
          return await teardownWorktree(ctx, outcome);
        }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/merge-back-closer.test.ts src/closer-support.test.ts`
Expected: PASS — the three new tests plus every pre-existing merge-back test (the accept-path tests prove the `cleanup` refactor changed no behaviour).

- [ ] **Step 9: Export the shared routine**

In `src/index.ts`, extend the `closer-support.js` export line:

```typescript
export { failedCloser, teardownWorktree } from "./closer-support.js";
```

(`removeWorktree` stays internal: it is a detail of how closers tidy up, not part of the package's surface.)

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Cover the logged teardown failure**

The driver already logs and swallows a throwing closer on a terminal surface (`terminate()` in `src/surface.ts:83-88`), and `src/surface.test.ts:174` proves an `ABORTED` surface still reaches its outcome. What no test asserts is the *logged* half of the criterion, on the escalated path. Append inside the same top-level `describe` as that existing test in `src/surface.test.ts`:

```typescript
  it("logs a teardown failure on an escalated surface and leaves the outcome alone", async () => {
    const repo = initTempRepo("surface-repo-", { "seed.txt": "hello\n" });
    const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");
    const location: SurfaceLocation = { repoPath: repo, worktreePath };
    const throwingCloser: SurfacePorts["closer"] = {
      close: () => Promise.reject(new Error("teardown blew up")),
    };
    const escalatingAgent = scriptedAgent([
      { status: "escalate", category: "authority", rationale: "I do not hold the deploy key." },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await run(dir, location, {
      agent: escalatingAgent,
      triage: deterministicRouter,
      closer: throwingCloser,
    });

    expect(result.state).toBe("ESCALATED");
    expect((await load(dir)).outcome?.kind).toBe("escalated");
    expect(warn.mock.calls.flat().join(" ")).toContain("teardown blew up");
    warn.mockRestore();
  });
```

Match the file's existing helpers when you write this: read how the neighbouring tests build an escalating agent (`scriptedAgent` / `portsWith`) and reuse them rather than inventing a second shape, and add `vi` to the `vitest` import if it is not already there. The assertions above are the fixed part; the scaffolding around them follows the file.

- [ ] **Step 11: Run the test to verify it passes**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS — including the pre-existing `src/surface.test.ts:174` abort test. This step adds coverage of behaviour the driver already has; if it fails, the fault is in the test's scaffolding, not in `surface.ts`.

- [ ] **Step 12: Commit**

```bash
git add src/closer-support.ts src/closer-support.test.ts src/merge-back-closer.ts src/merge-back-closer.test.ts src/surface.test.ts src/index.ts
git commit -m "$(cat <<'EOF'
Tear down a stopped surface's worktree and keep its branch

An escalated or aborted surface left its scratch worktree on disk: the
fire-and-log closer call had nothing real behind it. One shared routine now
removes the worktree and keeps the branch, because the branch is what whoever
picks up the escalation inspects. It is shared rather than per-closer so the
next two built-ins cannot drift apart, and it reuses provisioning's tolerance
of an already-gone worktree so a replay is harmless.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The commit-to-branch closer, selectable by name

**Files:**
- Create: `src/commit-to-branch-closer.ts`
- Modify: `src/schema.ts:58-63` (`CloserRef` gains its second variant), `src/resolve-closer.ts:17-20` (dispatch on `type`), `src/index.ts:9` (export the factory)
- Test: `src/commit-to-branch-closer.test.ts` (create), `src/schema.test.ts` (append), `src/resolve-closer.test.ts` (append)

**Interfaces:**
- Consumes: `ensureCommitted(worktreePath, message)` and `tryGit(cwd, args)` from `src/git-exec.js`; `removeWorktree(ctx)` and `teardownWorktree(ctx, outcome)` from Task 1; `messageOf(err)` from `src/gate-support.js`; `CloseContext`, `CloseOutcome`, `CloseReport`, `CloserPort` from `src/ports.js`.
- Produces:
  - `createCommitToBranchCloser(): CloserPort`
  - `CloserRef` widened to `{ type: "merge-back"; deleteBranch?: boolean } | { type: "commit-to-branch" }`
  - `resolveCloser(closerRef)` returning the commit-to-branch closer for a `commit-to-branch` ref.

- [ ] **Step 1: Write the failing tests for the closer**

Create `src/commit-to-branch-closer.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
import { provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloseContext } from "./ports.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const accepted = { kind: "accepted" } as const;

describe("the commit-to-branch closer", () => {
  let repo: string;
  let tree: string;
  let ctx: CloseContext;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "commit-branch-case-"));
    repo = initTempRepo("commit-branch-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "commit-branch-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-42");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-42", baseBranch };
  });

  it("commits the accepted work on the surface branch and leaves the base branch alone", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const mainTip = git(repo, ["rev-parse", "main"]);

    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "surface/surface-42:feature.txt"])).toBe("the work");
    expect(git(repo, ["rev-parse", "main"])).toBe(mainTip);
    expect(() => git(repo, ["show", "main:feature.txt"])).toThrow();
  });

  it("names the branch holding the work, in plain prose", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.detail).toContain("surface/surface-42");
    expect(report.detail).toMatch(/committed/i);
    // Plain prose, not a git transcript.
    expect(report.detail).not.toMatch(/files? changed|create mode|\[surface\//);
  });

  it("removes the scratch worktree", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await createCommitToBranchCloser().close(ctx, accepted);

    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["worktree", "list"])).not.toContain(tree);
  });

  it("closes cleanly when the worker changed nothing", async () => {
    const report = await createCommitToBranchCloser().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
  });

  it("reports already closed when a replay finds the worktree gone", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await createCommitToBranchCloser().close(ctx, accepted);
    const branchTip = git(repo, ["rev-parse", "surface/surface-42"]);

    const replay = await createCommitToBranchCloser().close(ctx, accepted);

    expect(replay.status).toBe("DONE");
    expect(replay.detail).toMatch(/already closed/i);
    expect(git(repo, ["rev-parse", "surface/surface-42"])).toBe(branchTip);
  });

  it("never deletes the surface branch, on any outcome", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const closer = createCommitToBranchCloser();

    for (const outcome of [accepted, { kind: "escalated" } as const, { kind: "aborted" } as const]) {
      await closer.close(ctx, outcome);
      expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
    }
  });

  it("tears the worktree down and keeps the branch when the surface escalated", async () => {
    const report = await createCommitToBranchCloser().close(ctx, { kind: "escalated" });

    expect(report.status).toBe("DONE");
    expect(existsSync(tree)).toBe(false);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });

  it("reports an ERROR rather than throwing when git cannot run", async () => {
    // A directory that exists — so the "already closed" detect does not fire —
    // but is no git worktree, so the commit itself fails.
    const notAWorktree = await mkdtemp(join(tmpdir(), "commit-branch-bare-"));

    const report = await createCommitToBranchCloser().close(
      { ...ctx, worktreePath: notAWorktree },
      accepted,
    );

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/could not run/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/commit-to-branch-closer.test.ts`
Expected: FAIL — cannot resolve `./commit-to-branch-closer.js`.

- [ ] **Step 3: Implement the closer**

Create `src/commit-to-branch-closer.ts`:

```typescript
import { existsSync } from "node:fs";
import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "./ports.js";
import { messageOf } from "./gate-support.js";
import { removeWorktree, teardownWorktree } from "./closer-support.js";
import { ensureCommitted } from "./git-exec.js";

/**
 * Leave the accepted work committed on the surface's own branch, for a project
 * owner who wants to review before anything merges.
 *
 * With no merge to probe, the "have I already done this?" answer comes from the
 * cheapest git-adjacent signal there is: the scratch worktree's own existence.
 * Cleanup removes it last, so a worktree that is gone means a previous close ran
 * to completion. The branch is never deleted, on any outcome — it is the whole
 * point of this closer, and on a stopped surface it is what whoever takes over
 * continues from.
 *
 * Nothing is pushed and the base branch is never touched.
 */
export function createCommitToBranchCloser(): CloserPort {
  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (!existsSync(ctx.worktreePath)) {
      return {
        status: "DONE",
        detail:
          `Already closed: the scratch worktree is gone, so an earlier close already committed the work ` +
          `to ${ctx.branch} and cleaned up. ${ctx.branch} is untouched.`,
      };
    }

    await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    await removeWorktree(ctx);

    return {
      status: "DONE",
      detail:
        `The accepted work is committed on ${ctx.branch}, which was kept for review. Removed the scratch ` +
        `worktree. ${ctx.baseBranch} was not changed and nothing was pushed.`,
    };
  }

  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      try {
        if (outcome.kind !== "accepted") return await teardownWorktree(ctx, outcome);
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

Run: `npx vitest run src/commit-to-branch-closer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing tests for naming it as data**

Append to the `CloserRef` describe block in `src/schema.test.ts` (match the neighbouring cases' shape):

```typescript
  it("accepts the commit-to-branch closer named with no parameters", () => {
    expect(CloserRef.safeParse({ type: "commit-to-branch" }).success).toBe(true);
  });
```

Append to `src/resolve-closer.test.ts`:

```typescript
  it("resolves a commit-to-branch reference to a closer that keeps the branch", async () => {
    const closer = resolveCloser({ type: "commit-to-branch" });

    const report = await closer.close(ctx, { kind: "accepted" });

    expect(report.status).toBe("DONE");
    expect(report.detail).toContain("surface/surface-42");
    expect(git(repo, ["rev-parse", "main"])).toBe(mainTip);
    expect(git(repo, ["branch", "--list", "surface/surface-42"])).toContain("surface/surface-42");
  });
```

Read `src/resolve-closer.test.ts` first and reuse whatever fixture it already builds for its merge-back case (a real temp repo, a provisioned worktree and a `CloseContext`); if it only covers resolution failure and has no repo fixture, build one in this test the way `src/commit-to-branch-closer.test.ts` does, including `mainTip` as `git(repo, ["rev-parse", "main"])` captured before the close. The assertions above are the fixed part.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/schema.test.ts src/resolve-closer.test.ts`
Expected: FAIL — `CloserRef` rejects the unknown discriminator `commit-to-branch`, and `resolveCloser` returns a merge-back closer.

- [ ] **Step 7: Widen the ref and dispatch on it**

In `src/schema.ts`, `CloserRef` becomes:

```typescript
export const CloserRef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("merge-back"),
    deleteBranch: z.boolean().optional(),
  }),
  // No parameters: the branch to commit to is the surface's own, and the COULD-tier
  // `push` is deliberately absent until it is built rather than parsed and ignored.
  z.object({ type: z.literal("commit-to-branch") }),
]);
```

In `src/resolve-closer.ts`, replace the unconditional merge-back construction with a dispatch, and add the import:

```typescript
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
```

```typescript
  const ref = parsed.data;
  switch (ref.type) {
    case "merge-back":
      return createMergeBackCloser({ deleteBranch: ref.deleteBranch });
    case "commit-to-branch":
      return createCommitToBranchCloser();
  }
```

The exhaustive `switch` over the discriminant is what makes the compiler, not a reviewer, catch the next variant Slices 4 and 5 add.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/schema.test.ts src/resolve-closer.test.ts src/commit-to-branch-closer.test.ts`
Expected: PASS.

- [ ] **Step 9: Export the factory and type-check**

In `src/index.ts`, beside the merge-back export:

```typescript
export { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
```

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/commit-to-branch-closer.ts src/commit-to-branch-closer.test.ts src/schema.ts src/schema.test.ts src/resolve-closer.ts src/resolve-closer.test.ts src/index.ts
git commit -m "$(cat <<'EOF'
Add the commit-to-branch closer

Owners who want to review before anything merges had only merge-back, which
lands the work on their base branch and deletes the evidence. Naming
commit-to-branch instead leaves the accepted work committed on the surface's
own branch with the base branch untouched.

Replay safety comes from the scratch worktree's own existence, the cheapest
signal available with no merge to probe: cleanup removes it last, so a missing
worktree means a prior close finished. The branch is never deleted on any
outcome, which is the whole point of this closer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The branch-and-teardown demo

The slice's UAT is a script a reviewer runs and reads. It closes one accepted surface with `{ type: "commit-to-branch" }` named as data, prints the report and the branch listing, then runs a second surface that escalates and prints the worktree and branch listings after it — plus a second teardown, to show it is harmless.

**Files:**
- Create: `demos/close-interface-slice-2-branch-and-teardown.ts`
- Modify: `package.json` (add `demo:close-slice-2` after `demo:close-slice-1`)

**Interfaces:**
- Consumes: `create(dir, header, budgets)` and `load(dir)` from `../src/case-file.js`; `initTempRepo(prefix, files)` from `../src/temp-repo.js`; `cleanGitEnv()` from `../src/git-env.js`; `run(dir, location, ports)` from `../src/surface.js`; `resolveCloser(ref)` from `../src/resolve-closer.js`; `teardownWorktree(ctx, outcome)` from `../src/closer-support.js`; types `AgentContext`, `AgentPort`, `RoleHandle`, `SurfaceLocation`, `SurfacePorts` from `../src/ports.js` and `BudgetSet`, `CloserRef`, `GateRef` from `../src/schema.js`.
- Produces: nothing importable — a script run via `npx tsx`.

- [ ] **Step 1: Write the demo script**

Create `demos/close-interface-slice-2-branch-and-teardown.ts`. It follows `demos/close-interface-slice-1-merge-back.ts` closely — read that file first and reuse its `budgets`, `git` helper, `workingAgent` and passing-TAP gate verbatim rather than inventing new ones:

```typescript
/**
 * UAT demo for Close Interface Slice 2: Work Can Be Left on Its Own Branch, and
 * Stopped Surfaces Tidy Up.
 *
 * Closes one accepted surface with the commit-to-branch closer named as data,
 * then runs a second surface that escalates, showing that its scratch worktree
 * is removed while its branch is kept for whoever takes it over. Finally it
 * tears the same stopped surface down a second time, to show that a repeat is
 * harmless.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip.
 *
 * Usage: npx tsx demos/close-interface-slice-2-branch-and-teardown.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { teardownWorktree } from "../src/closer-support.js";
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
const closerRef: CloserRef = { type: "commit-to-branch" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** Stands in for a worker that finishes the job. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

/**
 * Stands in for a worker that cannot finish and hands the task back. It commits
 * what it managed, which is why the kept branch is worth anything: teardown
 * removes the scratch directory, so uncommitted work in it goes with it.
 */
const stuckAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "half-done.txt"), "as far as I got\n");
    git(ctx.worktreePath, ["add", "-A"]);
    git(ctx.worktreePath, ["commit", "-m", "as far as I got"]);
    return Promise.resolve({
      status: "escalate",
      category: "authority",
      rationale: "Finishing this needs the deploy key, which I do not hold.",
    });
  }) as AgentPort["invoke"],
};

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback is expected in this demo")),
};

function newTree(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-tree-")), "wt");
}

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 2: a branch per task, and stopped surfaces tidied up ===\n");
  console.log("The project names its closer as data — no closer code is written here:");
  console.log(`  closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("Everything happens in a scratch repository on this machine. No remote is involved");
  console.log("at any point: nothing is pushed and no base branch is merged.\n");

  const repo = initTempRepo("close2-demo-repo-", { "report.tap": PASSING_TAP });
  const mainTipBefore = git(repo, ["rev-parse", "--short", "main"]);

  // --- An accepted surface, closed onto its own branch ---
  const acceptedDir = fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-case-"));
  const acceptedTree = newTree();
  const acceptedLocation: SurfaceLocation = { repoPath: repo, worktreePath: acceptedTree };

  await create(
    acceptedDir,
    { surfaceId: "surface-51", taskDef: { goal: "add the feature" }, gateRef, closerRef },
    budgets,
  );
  const acceptedPinned = (await load(acceptedDir)).header.closerRef;
  if (!acceptedPinned) throw new Error("the closer reference was not pinned in the header");

  const acceptedResult = await run(acceptedDir, acceptedLocation, {
    agent: workingAgent,
    triage: unusedTriage,
    closer: resolveCloser(acceptedPinned),
  });
  const acceptedCase = await load(acceptedDir);

  console.log("--- 1. The accepted surface's closing report ---");
  console.log(`Closer resolved from the pinned header: ${JSON.stringify(acceptedPinned)}`);
  console.log(`The surface ran to: ${acceptedResult.state}`);
  console.log(`Closing report: ${acceptedCase.outcome?.reason}\n`);

  console.log("--- 2. The repository after it ---");
  console.log(`Branches now:            ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`Work on surface/surface-51: ${git(repo, ["show", "surface/surface-51:feature.txt"])}`);
  console.log(`main was ${mainTipBefore}, and is now: ${git(repo, ["rev-parse", "--short", "main"])}`);
  console.log(`feature.txt on main: ${git(repo, ["ls-tree", "--name-only", "main", "feature.txt"]) || "(not there — main is untouched)"}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(acceptedTree)}\n`);

  // --- A second surface, which escalates ---
  const stuckDir = fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-case-"));
  const stuckTree = newTree();
  const stuckLocation: SurfaceLocation = { repoPath: repo, worktreePath: stuckTree };

  await create(
    stuckDir,
    { surfaceId: "surface-52", taskDef: { goal: "add the other feature" }, gateRef, closerRef },
    budgets,
  );
  const stuckResult = await run(stuckDir, stuckLocation, {
    agent: stuckAgent,
    triage: unusedTriage,
    closer: resolveCloser(closerRef),
  });
  const stuckCase = await load(stuckDir);

  console.log("--- 3. A second surface, which gives up ---");
  console.log(`The surface ran to: ${stuckResult.state}`);
  console.log(`Why: ${stuckCase.outcome?.reason}\n`);

  console.log("--- 4. What it left behind ---");
  console.log(`Its scratch worktree still on disk: ${fs.existsSync(stuckTree)}`);
  console.log(`Worktrees git knows about: ${git(repo, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).join(" | ")}`);
  console.log(`Branches now:              ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`Its half-finished work is still on surface/surface-52: ${git(repo, ["show", "surface/surface-52:half-done.txt"])}`);
  console.log("(Teardown removes the scratch directory and commits nothing, so the branch carries");
  console.log(" exactly what the worker committed before it gave up.)\n");

  console.log("--- 5. Tearing the same stopped surface down a second time ---");
  console.log("A teardown failure is only logged, never re-triaged, so a repeat is the only");
  console.log("thing that ever tries again — and it has to be harmless.\n");
  const stuckBranchTip = git(repo, ["rev-parse", "--short", "surface/surface-52"]);
  const repeat = await teardownWorktree(
    {
      dir: stuckDir,
      repoPath: repo,
      worktreePath: stuckTree,
      branch: "surface/surface-52",
      baseBranch: stuckCase.header.baseBranch ?? "",
    },
    { kind: "escalated" },
  );
  console.log(`Second teardown: ${repeat.status} — ${repeat.detail}`);
  console.log(`surface/surface-52 was ${stuckBranchTip}, and is now: ${git(repo, ["rev-parse", "--short", "surface/surface-52"])}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Register the demo**

In `package.json`, after the `demo:close-slice-1` line:

```json
    "demo:close-slice-2": "npx tsx demos/close-interface-slice-2-branch-and-teardown.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:close-slice-2`

Expected, checked against the slice's UAT:
- Section 1's report names `surface/surface-51` as the branch holding the work, in prose.
- Section 2 lists `surface/surface-51`, shows `feature.txt` on it, shows `main` at the same short sha it started on with no `feature.txt`, and shows the scratch worktree gone.
- Section 3 ends `ESCALATED`.
- Section 4 shows the second worktree gone from disk and from `git worktree list`, `surface/surface-52` still listed, and its half-finished work readable on it.
- Section 5 reports `DONE` and the same branch tip before and after.

If the printed output contradicts any of those, fix the code, not the expectation.

- [ ] **Step 4: Type-check the demo**

Run: `npx vitest run tests/typecheck-coverage.test.ts && npx tsc --noEmit`
Expected: PASS and no output — the new demo is a tracked `.ts` file, so it must be inside `tsconfig.json`'s programme.

- [ ] **Step 5: Commit**

```bash
git add demos/close-interface-slice-2-branch-and-teardown.ts package.json
git commit -m "$(cat <<'EOF'
Add the branch-and-teardown demo

The slice's reviewer needs to see, not infer, that accepted work can stay on a
reviewable branch with the base branch untouched, and that a surface which
gives up leaves its branch behind but not its scratch directory. The script
shows both against a real temporary repository, and tears the stopped surface
down twice to show the repeat is harmless.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Read before you write.** Three of the steps above append to files that already exist (`src/merge-back-closer.test.ts`, `src/surface.test.ts`, `src/resolve-closer.test.ts`) and one mirrors an existing demo. Reuse the helpers those files already define — `git()`, `scriptedAgent`, `portsWith`, `initTempRepo`, the TAP fixture — rather than writing a second copy beside them.
- **Do not add the `push` option.** It is COULD-tier and the spec explicitly licenses omitting the field until it is built.
- **`merge-back`'s accept path is not being changed.** Its existing tests, run unmodified, are the proof that Task 1's `cleanup` refactor is behaviour-preserving. If one of them goes red, the refactor is wrong.
