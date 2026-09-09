# Single-Surface State Machine — Slice 5: Resume a Surface After a Crash to the Same Outcome

> **Status:** ✅ Complete — 2026-09-09 — `bac91b6`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Goal:** Prove that stopping the driver at any recorded point and resuming from the directory alone reaches the same outcome and the same budget counts as an uninterrupted run, and make each resume-time recovery step visible to whoever is watching.

**Architecture:** The recovery *mechanism* already exists — Slices 1-4 built every edge to read the log tail rather than in-process state (`position()`, `deriveStateFromEntry`, `deriveBudgetsFromLog`, `recordMissingTerminus`, the idempotent `provisionWorktree`). This slice adds no new recovery path. It adds (a) an optional `recovery` note on `AdvanceResult` so the two recovery steps the slice names — a restarted provision, a dangling dispatch turned into a recorded incomplete retry — are observable by a caller instead of being silent, and (b) the parity tests and the demo that hold the guarantee. The note is returned as data, never printed from inside `src/` — the library has one `console.warn` today and gains none; printing is the demo's job.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 20+, vitest, `npx tsx` for demos.

## Global Constraints

- **Sessions are reconstructed, never resumed.** A dangling dispatch is recorded as an `incomplete` terminus and retried through the existing bounded path — never resurrected, never re-dispatched without a terminus in between (design spec, "A dangling dispatch on resume is an incomplete terminus").
- **A resumed run must enforce exactly the caps an uninterrupted one does.** Budget counts are derived from the log (`deriveBudgetsFromLog`), never from a separately mutated counter; do not add or call `incrementBudget` anywhere in this slice.
- **The log tail is authoritative once any entry exists.** Only pre-first-entry position may consult `cursor.state` + `header.baseline`.
- **Buy-vs-build (inherited):** git worktree creation, teardown and prune are `git` sub-commands via `provisionWorktree`; no hand-rolled filesystem detection of "is this worktree half-created". Test doubles are hand-written scripted ports as in Slices 1-4 — no mocking framework.
- **Operability/DX (inherited, this slice's Operational note):** resume-time recovery steps must be visible in what gets printed. Recovery is surfaced as structured data on `AdvanceResult` and printed by the demo; `src/` gains no logging.
- **Errors name the state and the attempted edge** (`IllegalStateTransition`), never a raw stack trace — the Slice 1 baseline.
- Import specifiers inside `src/` and `demos/` end in `.js`.

## Scaffolding Impact

- `package.json` demo script `demo:surface-slice-5` → added in Task 4 (the task that creates the demo).
- `docs/single-surface-control-flow.md` and `docs/provisioning.md` describe crash recovery conceptually ("there is no separate recovery subsystem", "recovery is idempotent re-provision"). This slice changes neither claim — it adds no recovery path and no new commit point — so neither doc goes stale. No update required.
- No new dependency, env var, or build/test step.

---

### Task 1: Report a restarted provision

A resume before the worktree exists re-runs `provisionWorktree`, which already tears down a partial worktree or leftover branch rather than adopting it. What is missing is that this is invisible: the caller cannot tell a clean first provision from one that had to clear wreckage. Make `provisionWorktree` report whether it tore anything down, and surface that as a `recovery` note on the advance.

**Files:**
- Modify: `src/provision.ts:23-29` (`tryGit`), `src/provision.ts:51-67` (`provisionWorktree`)
- Modify: `src/surface.ts:10-13` (`AdvanceResult`), `src/surface.ts:340-360` (`provisioning`)
- Test: `src/provision.test.ts`, `src/surface.test.ts`

**Interfaces:**
- Consumes: `provisionWorktree(dir, repoPath, worktreePath, surfaceId)`, `branchName(surfaceId)`, `ProvisioningFailure`.
- Produces:
  - `provisionWorktree(...): Promise<{ restarted: boolean }>` — `restarted` is true when an existing worktree at the path, or an existing branch of this surface's name, was removed before the new worktree was added.
  - `interface AdvanceResult { state: SurfaceState; done: boolean; recovery?: string }` — `recovery` is present only on an advance that recovered from an interruption, and carries a human-readable one-line description of what it recovered.

- [ ] **Step 1: Write the failing provision tests**

Add to `src/provision.test.ts`, inside the existing `provisionWorktree` describe block (alongside `"tears down a partial worktree and recreates it rather than adopting it"`):

```typescript
  it("reports a clean first provision as not restarted", async () => {
    const repo = initTempRepo("provision-repo-", { "a.txt": "hello\n" });
    const tree = join(mkdtempSync(join(tmpdir(), "provision-tree-")), "wt");

    const result = await provisionWorktree(repo, repo, tree, "surface-42");

    expect(result).toEqual({ restarted: false });
  });

  it("reports a provision that had to clear a leftover worktree as restarted", async () => {
    const repo = initTempRepo("provision-repo-", { "a.txt": "hello\n" });
    const tree = join(mkdtempSync(join(tmpdir(), "provision-tree-")), "wt");
    await provisionWorktree(repo, repo, tree, "surface-42");

    const result = await provisionWorktree(repo, repo, tree, "surface-42");

    expect(result).toEqual({ restarted: true });
  });
```

If `mkdtempSync`, `tmpdir`, `join` or `initTempRepo` are not already imported in that file, add them to the existing imports (`node:fs`, `node:os`, `node:path`, `./temp-repo.js`) matching the style already used there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/provision.test.ts`
Expected: FAIL — both new tests, because `provisionWorktree` resolves to `undefined`.

- [ ] **Step 3: Make `provisionWorktree` report what it cleared**

In `src/provision.ts`, have `tryGit` report whether its command succeeded, and return the flag:

```typescript
/** Best-effort clean-up: reports whether the command actually did something. */
async function tryGit(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    // Nothing to remove is the common case.
    return false;
  }
}
```

Then in `provisionWorktree`, keep the existing teardown order and collect the result. Replace the body of the `try` block and the signature's return type:

```typescript
export async function provisionWorktree(
  dir: string,
  repoPath: string,
  worktreePath: string,
  surfaceId: string,
): Promise<{ restarted: boolean }> {
  const branch = branchName(surfaceId);
  try {
    const baseRef = await resolveBaseRef(repoPath);
    const removedTree = await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    const removedBranch = await tryGit(repoPath, ["branch", "-D", "--", branch]);
    await git(repoPath, ["worktree", "add", "-b", branch, "--", worktreePath, baseRef]);
    return { restarted: removedTree || removedBranch };
  } catch (err) {
    throw new ProvisioningFailure(dir, messageOf(err));
  }
}
```

Update the doc comment above it to say it reports whether wreckage was cleared, keeping the existing "idempotent, a crash anywhere inside it is recovered by calling it again" sentence.

- [ ] **Step 4: Run the provision tests to verify they pass**

Run: `npx vitest run src/provision.test.ts`
Expected: PASS — all tests in the file, including the two pre-existing worktree tests.

- [ ] **Step 5: Write the failing surface test**

Add to `src/surface.test.ts`, in the describe block that covers the `PROVISIONING` edge (the one containing `"creates a real worktree..."` around line 114):

```typescript
  it("reports a restarted provision when a leftover worktree had to be cleared", async () => {
    const repoPath = initTempRepo("surface-repo-", { "a.txt": "hello\n" });
    const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");
    const location: SurfaceLocation = { repoPath, worktreePath };
    const ports = portsWith(unusedAgent());

    const first = await advance(dir, location, ports);
    expect(first).toEqual({ state: "PRE_GATING", done: false });
    // A crash after the worktree was created but before the cursor advanced:
    // the surface is still PROVISIONING on disk, with wreckage on the path.
    await updateCursor(dir, { state: "PROVISIONING", worktreeRef: "" });

    const resumed = await advance(dir, location, ports);

    expect(resumed.state).toBe("PRE_GATING");
    expect(resumed.recovery).toBe("restarted an interrupted provision: cleared a partial worktree and re-created it");
  });
```

Match the file's existing setup style for `repoPath`/`worktreePath` in that describe block — reuse its helper if one already builds a `SurfaceLocation`, rather than duplicating the two lines.

- [ ] **Step 6: Run the surface test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "reports a restarted provision"`
Expected: FAIL — `resumed.recovery` is `undefined`.

- [ ] **Step 7: Surface the recovery note from the PROVISIONING edge**

In `src/surface.ts`, widen the result type:

```typescript
export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
  /**
   * Present only when this advance recovered from an interruption, describing
   * what it recovered. Crash recovery is a primary debugging surface for this
   * item, so a resumed run says what it had to put right; it is returned as
   * data, never printed from here.
   */
  recovery?: string;
}
```

and in `provisioning`, use what `provisionWorktree` reports:

```typescript
  const worktreePath = worktreeOf(caseFile, location);
  let restarted: boolean;
  try {
    ({ restarted } = await provisionWorktree(
      dir, location.repoPath, worktreePath, caseFile.header.surfaceId,
    ));
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return abort(dir, caseFile, location, ports, "provisioning", err.detail);
  }

  // The cursor advance is the commit point for "the worktree exists and belongs
  // to this surface" — provisioning has no history representation.
  await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
  return {
    state: "PRE_GATING",
    done: false,
    ...(restarted
      ? { recovery: "restarted an interrupted provision: cleared a partial worktree and re-created it" }
      : {}),
  };
```

The spread keeps `recovery` absent (not `undefined`) on a clean provision, so the many `toEqual({ state, done })` assertions elsewhere in the suite keep passing.

- [ ] **Step 8: Run the surface and provision tests to verify they pass**

Run: `npx vitest run src/surface.test.ts src/provision.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/provision.ts src/provision.test.ts src/surface.ts src/surface.test.ts
git commit -m "Report a restarted provision on the advance result

A resume before the worktree exists already re-provisions cleanly, but the
caller could not tell that from a first provision. Crash recovery is a primary
debugging surface for this item, so the advance now says what it put right."
```

---

### Task 2: Report a dangling dispatch recorded on resume

A dispatch with no terminus is a session that ended without a result; both the worker edge and the gate-maintenance edge already record an `incomplete` terminus for it and let the ordinary bounded retry take over. Make that step visible, with role-distinct wording, so a repair recovery can never be read as a worker retry.

**Files:**
- Modify: `src/surface.ts:167-182` (`recordMissingTerminus`), `src/surface.ts:296-338` (`gateMaintenance`), `src/surface.ts:388-423` (`incompleteTerminus`)
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `AdvanceResult.recovery` (Task 1), `recordMissingTerminus(dir, tail, role)`, `deriveBudgetsFromLog`.
- Produces: no new exported names. `advance` returns `recovery` on the two dangling-dispatch edges.

- [ ] **Step 1: Write the failing tests**

In `src/surface.test.ts`, extend the two existing dangling-dispatch tests and add one budget-isolation assertion.

Change the assertion in `"records the missing terminus for a dispatch that never recorded one"` (currently `expect(recorded).toEqual({ state: "INCOMPLETE_TERMINUS", done: false });`) to:

```typescript
    expect(recorded).toEqual({
      state: "INCOMPLETE_TERMINUS",
      done: false,
      recovery: "recorded a missing terminus for worker attempt 1 (worker-1-0): the interrupted session is retried, not re-dispatched",
    });
```

Change the assertion in `"treats a dangling repair dispatch on resume as an incomplete terminus"` (currently `expect(result).toEqual({ state: "GATE_MAINTENANCE", done: false });`) to:

```typescript
    expect(result).toEqual({
      state: "GATE_MAINTENANCE",
      done: false,
      recovery: "recorded a missing terminus for repair attempt 1 (gate-maintenance-1-0): the interrupted session is retried, not re-dispatched",
    });
```

and add, at the end of that same test's body:

```typescript
    // A repair recovery is not a worker retry and pays for nothing of the
    // worker's: only the repair's own population moves.
    const { history, cursor } = await load(dir);
    const spent = deriveBudgetsFromLog(history, cursor.budgets);
    expect(spent.terminus.used).toBe(0);
    expect(spent.correction.used).toBe(0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "missing terminus"` and `npx vitest run src/surface.test.ts -t "dangling repair dispatch"`
Expected: FAIL — both, on the missing `recovery` key.

- [ ] **Step 3: Return the recovery note from both edges**

In `src/surface.ts`, have `recordMissingTerminus` also produce the note (it already knows the role, attempt and session key):

```typescript
async function recordMissingTerminus(
  dir: string,
  tail: Extract<HistoryEntry, { t: "dispatch" }>,
  role: "worker" | "gate-maintenance",
): Promise<string> {
  const label = role === "worker" ? "worker" : "repair";
  const entry: HistoryEntry = {
    t: "terminus",
    role,
    attempt: tail.attempt,
    sessionKey: tail.sessionKey,
    status: "incomplete",
    rationale: `${label} session ended without recording a terminus (recovered on resume)`,
  };
  await appendEntry(dir, entry);
  return `recorded a missing terminus for ${label} attempt ${tail.attempt} (${tail.sessionKey}): the interrupted session is retried, not re-dispatched`;
}
```

(The previous return value — the entry — was unused by both callers.)

In `gateMaintenance`, replace the dangling-dispatch branch's two lines with:

```typescript
  if (tail?.t === "dispatch") {
    // A dispatch with no terminus is a session that ended without emitting a
    // valid result — an incomplete terminus, not a session to resurrect. Record
    // it and let the ordinary incomplete handling redispatch or escalate.
    const recovery = await recordMissingTerminus(dir, tail, "gate-maintenance");
    return { state: "GATE_MAINTENANCE", done: false, recovery };
  }
```

and in `incompleteTerminus`:

```typescript
  if (tail?.t === "dispatch") {
    const recovery = await recordMissingTerminus(dir, tail, "worker");
    return { state: "INCOMPLETE_TERMINUS", done: false, recovery };
  }
```

- [ ] **Step 4: Run the surface tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS — the whole file, including every untouched `toEqual({ state, done })` assertion.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Report a dangling dispatch turned into a recorded retry

Recovering an interrupted session was silent, and a repair recovery read
identically to a worker one. Both edges now say which role's attempt they put
right, so crash recovery is legible when reading a resumed run."
```

---

### Task 3: Hold the resume-parity guarantee with tests

The remaining acceptance criteria are guarantees about behaviour Slices 1-4 built. Two are already covered (`"records the missing terminus..."`, `"dispatches the repair on resume when the fix_the_gate verdict was the last thing recorded"`); the triage-consequence case for a retried close is not, and neither is the parity claim itself. Run each test before implementing: if one passes unchanged it is a genuine regression guard for a guarantee nothing else pins — keep it and say so in the commit; if one fails, the gap is real and gets fixed in `src/surface.ts`.

**Files:**
- Test: `src/surface.test.ts`
- Modify (only if a test below fails): `src/surface.ts`

**Interfaces:**
- Consumes: `advance(dir, location, ports)`, `run(dir, location, ports)`, `load(dir)`, `rebuild(dir)`, `deriveBudgetsFromLog(history, cursor.budgets)`, `create(dir, header, budgets)`, `initTempRepo(prefix, files)`, `deterministicRouter`, `noopCloser`, the file's existing `scriptedAgent` / `portsWithTriage` helpers.
- Produces: no new exported names.

- [ ] **Step 1: Write the triage-consequence test**

Add to `src/surface.test.ts`, in the describe block that covers the `TRIAGE` edge (the one containing the `fix_the_gate`-on-resume test around line 891):

```typescript
  it("carries out a retry_close verdict on resume instead of re-triaging", async () => {
    let closes = 0;
    const closer: SurfacePorts["closer"] = {
      close: (_ctx, outcome) => {
        if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
        closes += 1;
        return Promise.resolve(
          closes === 1
            ? { status: "FAIL", detail: "not ready to close" }
            : { status: "DONE", detail: "closed on the retry" },
        );
      },
    };
    let triages = 0;
    const triage: SurfacePorts["triage"] = {
      triage: (input) => {
        triages += 1;
        return deterministicRouter.triage(input);
      },
    };
    const ports: SurfacePorts = {
      agent: scriptedAgent([{ status: "completed", rationale: "clean change" }]),
      triage,
      closer,
    };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    await advance(dir, location, ports); // GATING -> CLOSING
    await advance(dir, location, ports); // CLOSING -> TRIAGE (close rejected)
    const routed = await advance(dir, location, ports); // TRIAGE -> CLOSING
    expect(routed.state).toBe("CLOSING");
    expect(triages).toBe(1);

    // A fresh process picks the directory up here: the triage decision is
    // recorded, its consequence — the retried close — is not yet carried out.
    await rebuild(dir);
    const resumed = await run(dir, location, ports);

    expect(resumed.state).toBe("CLOSED");
    expect(closes).toBe(2); // the retried close ran exactly once
    expect(triages).toBe(1); // the triage decision was not repeated
    const { history, cursor } = await load(dir);
    expect(deriveBudgetsFromLog(history, cursor.budgets).close.used).toBe(1);
  });
```

Use whatever the describe block's existing helper is named for provisioning-to-`PRE_GATING` (`provisioned` in the neighbouring blocks) and its `PASSING_TAP` constant, rather than introducing new ones.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/surface.test.ts -t "retry_close verdict on resume"`
Expected: PASS is the likely result — `deriveStateFromEntry` already routes a `retry_close` triage tail to `CLOSING`. If it FAILS, fix the routing in `src/surface.ts` so a recorded triage verdict's consequence is completed on resume rather than the decision being repeated, then re-run until PASS. Do not change the test to match the code.

- [ ] **Step 3: Write the parity test**

Add a new describe block at the end of `src/surface.test.ts`:

```typescript
describe("resume parity: an interrupted run reaches the same outcome as a straight one", () => {
  /** A fresh case dir + temp repo + worktree path for one scenario. */
  async function freshSurface(files: Record<string, string>): Promise<{ dir: string; location: SurfaceLocation }> {
    const dir = await mkdtemp(join(tmpdir(), "surface-parity-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const repoPath = initTempRepo("parity-repo-", files);
    const worktreePath = join(await mkdtemp(join(tmpdir(), "parity-tree-")), "wt");
    return { dir, location: { repoPath, worktreePath } };
  }

  /** The outcome and log-derived budgets a finished surface ended on. */
  async function summarise(dir: string): Promise<{ kind: string; reason: string; spent: BudgetSet }> {
    const { outcome, history, cursor } = await load(dir);
    return {
      kind: outcome?.kind ?? "none",
      reason: outcome?.reason ?? "",
      spent: deriveBudgetsFromLog(history, cursor.budgets),
    };
  }

  interface ParityCase {
    name: string;
    files: Record<string, string>;
    ports: () => SurfacePorts;
    /** Where to cut the first process off, in whole advances. */
    stopAfter: number;
  }

  const cases: ParityCase[] = [
    {
      name: "a clean worker change closing on the first attempt",
      files: { "report.tap": PASSING_TAP },
      ports: () => ({
        agent: scriptedAgent([{ status: "completed", rationale: "clean change" }]),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
      stopAfter: 2,
    },
    {
      name: "a worker that never returns a result, to the terminus cap",
      files: { "report.tap": PASSING_TAP },
      ports: () => ({
        agent: scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
      stopAfter: 3,
    },
    {
      name: "a worker that breaks the gate, repaired to the gate-maintenance cap",
      files: { "report.tap": PASSING_TAP },
      ports: () => ({
        agent: {
          invoke: (roleCfg, ctx) => {
            if (roleCfg.role === "worker") {
              rmSync(join(ctx.worktreePath, "report.tap"), { force: true });
              return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
            }
            return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
          },
        },
        triage: deterministicRouter,
        closer: noopCloser,
      }),
      stopAfter: 4,
    },
    {
      name: "a closer that always rejects, to the close cap",
      files: { "report.tap": PASSING_TAP },
      ports: () => ({
        agent: scriptedAgent([{ status: "completed", rationale: "clean change" }]),
        triage: deterministicRouter,
        closer: {
          close: (_ctx, outcome) =>
            Promise.resolve(
              outcome.kind === "accepted"
                ? { status: "FAIL", detail: "not ready to close" }
                : { status: "DONE", detail: "torn down" },
            ),
        },
      }),
      // Stops with the triage verdict recorded and its retried close pending.
      stopAfter: 5,
    },
  ];

  for (const parityCase of cases) {
    it(`reaches the same outcome and budgets with a stop-and-resume: ${parityCase.name}`, async () => {
      const straight = await freshSurface(parityCase.files);
      await run(straight.dir, straight.location, parityCase.ports());
      const reference = await summarise(straight.dir);

      const stopped = await freshSurface(parityCase.files);
      const firstProcess = parityCase.ports();
      for (let step = 0; step < parityCase.stopAfter; step++) {
        await advance(stopped.dir, stopped.location, firstProcess);
      }
      // A fresh process picks up the directory with nothing else carried over.
      await rebuild(stopped.dir);
      await run(stopped.dir, stopped.location, parityCase.ports());

      expect(await summarise(stopped.dir)).toEqual(reference);
    });
  }
});
```

If `BudgetSet`, `initTempRepo`, `rebuild`, `create`, `rmSync` or `deriveBudgetsFromLog` are not already imported at the top of the file, add them — they all appear in the file's existing imports listed at lines 1-16, so most should already be there.

- [ ] **Step 4: Run the parity tests**

Run: `npx vitest run src/surface.test.ts -t "resume parity"`
Expected: PASS for all four cases. If any FAILS, the divergence is a real defect in the resume path: fix `src/surface.ts` so the resumed run derives the same position and budgets as the live one (the log tail is authoritative; do not paper over it by adjusting `stopAfter`), then re-run until PASS.

- [ ] **Step 5: Commit**

```bash
git add src/surface.test.ts src/surface.ts
git commit -m "Pin resume parity across the loop's four setback scenarios

The equivalence of an interrupted and an uninterrupted run is the guarantee
this slice sells, and nothing pinned it: each edge was tested for its own
resume behaviour, never end-to-end against a straight run of the same script."
```

---

### Task 4: Ship the crash-recovery demo

The slice's UAT is read from a runnable demo, matching Slices 1-4. It runs each scenario twice — straight through, and stopped mid-run then resumed from the directory as a fresh process — and prints the two outcomes side by side plus the recovery steps the resumed run reported.

**Files:**
- Create: `demos/single-surface-slice-5-crash-recovery.ts`
- Modify: `package.json:10-19` (scripts)

**Interfaces:**
- Consumes: `advance`, `run` (`../src/surface.js`), `create`, `load`, `rebuild`, `deriveBudgetsFromLog` (`../src/case-file.js`), `initTempRepo` (`../src/temp-repo.js`), `deterministicRouter` (`../src/router.js`), `noopCloser` (`../src/ports.js`), `AdvanceResult.recovery` (Task 1, Task 2).
- Produces: `npm run demo:surface-slice-5`.

- [ ] **Step 1: Write the demo**

Create `demos/single-surface-slice-5-crash-recovery.ts`:

```typescript
/**
 * UAT demo for Single-Surface State Machine Slice 5: Resume a Surface After a
 * Crash to the Same Outcome.
 *
 * Each scenario runs twice against fresh directories: once straight through,
 * and once stopped after a fixed number of advances and resumed from the same
 * directory as if a new process had picked it up. The two outcomes and the two
 * sets of log-derived budget counts are printed side by side, along with every
 * recovery step the resumed run reported.
 *
 * Usage: npx tsx demos/single-surface-slice-5-crash-recovery.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load, rebuild, updateCursor, deriveBudgetsFromLog } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type { SurfaceLocation, SurfacePorts, Terminus } from "../src/ports.js";
import type { BudgetPopulation, BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

async function freshSurface(surfaceId: string): Promise<{ dir: string; location: SurfaceLocation }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-case-"));
  const repoPath = initTempRepo("resume-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "resume-tree-")), "wt");
  await create(dir, { surfaceId, taskDef: { intent: "add a feature" }, gateRef }, budgets);
  return { dir, location: { repoPath, worktreePath } };
}

function budgetLine(spent: BudgetSet): string {
  return (Object.keys(spent) as BudgetPopulation[])
    .map((p) => `${p} ${spent[p].used}/${spent[p].max}`)
    .join(", ");
}

async function summarise(dir: string): Promise<{ outcome: string; reason: string; budgets: string }> {
  const caseFile = await load(dir);
  return {
    outcome: caseFile.outcome?.kind ?? "none",
    reason: caseFile.outcome?.reason ?? "",
    budgets: budgetLine(deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets)),
  };
}

interface Scenario {
  title: string;
  scripted: string;
  /** Where the first process is cut off, in whole advances. */
  stopAfter: number;
  /**
   * Kill the first process *inside* its nth agent session instead: the dispatch
   * is on disk and the terminus never arrives, which is the window a clean stop
   * between advances cannot reach.
   */
  killSession?: number;
  /**
   * How else the first process died, for windows neither of the above reaches —
   * a kill between `git worktree add` and the cursor write leaves the surface
   * still PROVISIONING on disk with a worktree already on the path.
   */
  interrupt?: (dir: string) => Promise<void>;
  ports: () => SurfacePorts;
}

/** Ports whose agent dies mid-session on its nth invocation. */
function killingSession(ports: SurfacePorts, n: number): SurfacePorts {
  let calls = 0;
  return {
    ...ports,
    agent: {
      invoke: (roleCfg, ctx) => {
        calls += 1;
        return calls === n
          ? Promise.reject(new Error("session killed by infrastructure"))
          : ports.agent.invoke(roleCfg, ctx);
      },
    },
  };
}

/** An agent that always returns the same terminus, whatever the role. */
function always(terminus: Terminus): SurfacePorts["agent"] {
  return { invoke: () => Promise.resolve(terminus) };
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  const straight = await freshSurface("straight");
  await run(straight.dir, straight.location, scenario.ports());
  const uninterrupted = await summarise(straight.dir);

  const stopped = await freshSurface("interrupted");
  const base = scenario.ports();
  const firstProcess = scenario.killSession ? killingSession(base, scenario.killSession) : base;
  const recoveries: string[] = [];
  try {
    for (let step = 0; step < scenario.stopAfter; step++) {
      await advance(stopped.dir, stopped.location, firstProcess);
    }
  } catch {
    // The first process died mid-session. The directory is all that survives.
  }
  if (scenario.interrupt) await scenario.interrupt(stopped.dir);
  // Everything except the directory is thrown away: fresh ports, and a rebuilt
  // cursor, exactly as a new process picking the surface up would have.
  await rebuild(stopped.dir);
  const secondProcess = scenario.ports();
  let result = await advance(stopped.dir, stopped.location, secondProcess);
  if (result.recovery) recoveries.push(result.recovery);
  while (!result.done) {
    result = await advance(stopped.dir, stopped.location, secondProcess);
    if (result.recovery) recoveries.push(result.recovery);
  }
  const resumed = await summarise(stopped.dir);

  // The guarantee is the outcome and the budget counts. The reason is printed
  // for information: a crashed session is honestly described differently from a
  // session that returned a result, and that difference is the point.
  const identical =
    uninterrupted.outcome === resumed.outcome && uninterrupted.budgets === resumed.budgets;

  console.log(`\n=== ${scenario.title} ===`);
  console.log(`Scripted:      ${scenario.scripted}`);
  console.log(`Stopped after: ${scenario.stopAfter} advance(s), then resumed from the directory alone`);
  console.log(`Uninterrupted: ${uninterrupted.outcome} — ${uninterrupted.reason}`);
  console.log(`               ${uninterrupted.budgets}`);
  console.log(`Stop + resume: ${resumed.outcome} — ${resumed.reason}`);
  console.log(`               ${resumed.budgets}`);
  console.log(`Recovery:      ${recoveries.length ? recoveries.join("\n               ") : "none needed at this stopping point"}`);
  console.log(`Identical:     ${identical ? "yes" : "NO — the runs diverged"}`);
  return identical;
}

async function main(): Promise<void> {
  console.log("Each scenario runs twice: straight through, and stopped mid-run then resumed.");

  const scenarios: Scenario[] = [
    {
      title: "Stopped mid provision",
      scripted:
        "a clean worker change; the first process is killed after `git worktree add` but before the cursor advanced",
      stopAfter: 1,
      interrupt: (dir) => updateCursor(dir, { state: "PROVISIONING", worktreeRef: "" }),
      ports: () => ({
        agent: always({ status: "completed", rationale: "clean change" }),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid worker attempt",
      scripted:
        "every worker session ends without a valid result, to the terminus cap; the second session is killed outright",
      stopAfter: 20,
      killSession: 2,
      ports: () => ({
        agent: always({ status: "incomplete", rationale: "hit the turn cap" }),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid repair attempt",
      scripted:
        "the worker deletes the file the gate reads; no repair restores it, to the repair cap; the first repair session is killed outright",
      stopAfter: 20,
      killSession: 2,
      ports: () => ({
        agent: {
          invoke: (roleCfg, ctx) => {
            if (roleCfg.role === "worker") {
              fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
              return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
            }
            return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
          },
        },
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid triage",
      scripted:
        "the work passes the gate; every close attempt is rejected, to the close cap; stopped with the triage verdict recorded and its retried close not yet carried out",
      stopAfter: 5,
      ports: () => ({
        agent: always({ status: "completed", rationale: "clean change" }),
        triage: deterministicRouter,
        closer: {
          close: (_ctx, outcome) =>
            Promise.resolve(
              outcome.kind === "accepted"
                ? { status: "FAIL", detail: "not ready to close" }
                : { status: "DONE", detail: "torn down" },
            ),
        },
      }),
    },
  ];

  let allIdentical = true;
  for (const scenario of scenarios) {
    allIdentical = (await runScenario(scenario)) && allIdentical;
  }

  console.log(
    `\nEvery scenario identical across the stop-and-resume: ${allIdentical ? "yes" : "NO"}`,
  );
  if (!allIdentical) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the demo script to `package.json`**

Add after the `demo:surface-slice-4` line, keeping the existing formatting:

```json
    "demo:surface-slice-5": "npx tsx demos/single-surface-slice-5-crash-recovery.ts",
```

- [ ] **Step 3: Run the demo**

Run: `npm run demo:surface-slice-5`
Expected: four scenario blocks; in each, the `Uninterrupted` and `Stop + resume` outcome, reason and budget lines match, `Identical: yes`. The mid-provision scenario prints a `Recovery:` line saying it restarted an interrupted provision, and the mid-worker and mid-repair scenarios print a `Recovery:` line naming the role and attempt whose missing terminus was recorded. Final line: `Every scenario identical across the stop-and-resume: yes`. If any scenario prints `NO`, treat it as a real defect and fix `src/surface.ts` — never tune `stopAfter` to dodge it.

- [ ] **Step 4: Typecheck and lint the new file**

Run: `npx tsc --noEmit && npx eslint demos/single-surface-slice-5-crash-recovery.ts src/surface.ts src/provision.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add demos/single-surface-slice-5-crash-recovery.ts package.json
git commit -m "Add the crash-recovery demo

The slice's guarantee is an equivalence between two runs, which only reads as
proven when both are printed side by side; the demo also shows the recovery
steps a resumed run reports."
```
