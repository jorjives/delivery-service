# Single-Surface State Machine — Slice 1: Provision a Surface and Reach Its First Decision Point

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-07-single-surface-state-machine-design.md`

**Goal:** Build the driver's entry ramp — `advance` walks a fresh case file from
`PROVISIONING` through a real `git worktree add`, captures a baseline, and lands on
`AGENT_ACTIVE`, `ESCALATED` or `ABORTED`, dispatching bounded gate-repair sessions
when the gate itself cannot run.

**Architecture:** A step function (`advance`) that loads the case file, derives its
position from `header.baseline` + the log tail (the pre-first-worker-dispatch segment,
where the cursor and header are authoritative), performs exactly one transition, and
commits it. Three edges ship in this slice: `PROVISIONING`, `PRE_GATING`, and
`GATE_MAINTENANCE`. Everything the driver calls out to is a port
(`AgentPort`/`TriagePort`/`CloserPort`); this slice ships the no-op `CloserPort` and
uses scripted `AgentPort` doubles. `git worktree add` is real, shelled out through a
dedicated provisioning module.

**Tech Stack:** TypeScript (ES2024, Node16 modules, strict), Node ≥22, zod for the
persisted schema, vitest for tests, `tsx` for the demo script, `git` CLI via
`node:child_process`.

## Global Constraints

- **Node ≥22**, ESM only (`"type": "module"`), all intra-`src` imports use the
  `.js` extension (Node16 module resolution).
- **TypeScript strict** with `noUncheckedIndexedAccess`; `npm run lint` runs
  `eslint . && tsc --noEmit` and must stay green. `tsc` only compiles `src`
  (`rootDir: "src"`, `include: ["src"]`) — no file under `src` may import from
  `tests/` or `demos/`.
- **Errors follow `src/errors.ts` convention**: named class, `readonly code`
  literal, constructor args kept as readonly fields, `this.name` set.
- **Persisted shapes are zod schemas in `src/schema.ts`**; in-memory port
  contracts are plain TypeScript types.
- **Buy-vs-build (spec: "Provisioning is real, not stubbed"):** shell out to the
  `git` CLI for worktree creation and default-branch resolution. Do not add a git
  library, and do not hand-roll worktree bookkeeping. Reuse the already-shipped
  `recordBaseline` (Item 2) for baselining and the already-shipped `case-file.ts`
  primitives (`load`, `appendEntry`, `updateCursor`, `setOutcome`, `logTail`) for
  every write — this slice adds no new persistence mechanism.
- **Buy-vs-build (spec: "Three pluggable ports"):** the driver never calls an
  agent, triage or closer implementation directly; it calls through the port
  types, so Items 4/5/6 slot in without touching the driver.
- **Operability/DX (slice Operational note):** the two error paths this slice
  introduces must name the state and the attempted edge, never surface as a raw
  stack trace. `ProvisioningFailure` is caught by the driver and converted into an
  `ABORTED` outcome carrying a reason; `IllegalStateTransition` is thrown with
  `dir`, `state` and `edge` in its message. Budget-exhaustion escalations name the
  population and its cap in the outcome `reason`.
- **Additive-only schema changes.** `role` on dispatch/terminus entries is
  optional (absent = `"worker"`), so every case file and test from Items 1–2 stays
  valid.

## Scaffolding Impact

- `docs/single-surface-control-flow.md` — its `Entry =` block documents the
  `dispatch`/`terminus` entry shapes this slice extends with `role` → updated in
  Task 1.
- `docs/provisioning.md` — its "Open items → Branch naming and collision" entry
  says the `surface_id → branch` scheme is unspecified; this slice settles it
  (`surface/<surface_id>`, force-clean on re-provision) → updated in Task 2.
- `package.json` `scripts` — new `demo:surface-slice-1` entry, the run story for
  this slice's demo → added in Task 7.
- `src/index.ts` — the package's public surface gains the driver, the port types,
  the no-op closer, `branchName`, the two new errors, and the two newly-exported
  derivation functions → updated in the task that introduces each.

---

## Out of scope for this slice (deliberate, do not build)

These are in the design spec but belong to later slices. Do **not** implement them
here, and do not write tests for them:

- `run` (the loop over `advance`). Slice 1 ships `advance` only; nothing in slice 1
  can reach a terminal state through more than a handful of explicit steps, and
  `run` cannot be honestly written until `AGENT_ACTIVE` has an edge (Slice 2).
- The `AGENT_ACTIVE`, `GATING`, `TRIAGE`, `CLOSING`, `INCOMPLETE_TERMINUS` edges.
- `deriveStateFromEntry`'s **worker** corrections (worker `dispatch` →
  `INCOMPLETE_TERMINUS`, worker `escalate` terminus branching on `category`). No
  worker-role entry is ever written in slice 1, so these are untestable here.
- The `correction`/`close`/`terminus` budget re-attribution to `triage` and
  `terminus` entries. Slice 1 writes no triage entries and no worker terminus
  entries; only the `gateMaintenance` derivation changes here.
- `runCheck`'s widened gate-failure ref key. Slice 1 never calls `runCheck`.
- The deterministic `TriagePort` router. Its **type** is declared in Task 3
  (the driver's `SurfacePorts` argument must be stable from the start); its
  implementation is Slice 3's.
- The post-task `GATE_MAINTENANCE` entry (`fix_the_gate` → re-check against the
  existing baseline). Slice 1 only has the pre-task entry, because only
  `PRE_GATING` can route into `GATE_MAINTENANCE` yet.

---

## Spec refinement: where `git worktree add` runs

The design spec fixes `advance(dir, worktreePath, ports)` but never says which
repository the worktree is added to. `worktreePath` is where the tree goes; the repo
is a separate location, cannot be derived from `dir` or from a not-yet-existing
worktree, and must not be inferred from `process.cwd()` (untestable in a parallel
test runner, and a hidden global input to a function that must be deterministic).

This plan therefore groups the two caller-supplied filesystem locations:

```ts
export interface SurfaceLocation {
  repoPath: string;      // the repository worktrees are added to
  worktreePath: string;  // where this surface's worktree goes
}

advance(dir: string, location: SurfaceLocation, ports: SurfacePorts)
```

This preserves the spec's invariant-3 reasoning unchanged: both fields are read
**only** while `cursor.worktreeRef` is still the empty-string sentinel. Once the
provisioning cursor write has landed, `cursor.worktreeRef` is authoritative and
`location.worktreePath` is ignored, and `repoPath` is never read again — so a replay
called with different arguments cannot divert an already-provisioned surface.

---

### Task 1: `role` on dispatch/terminus entries, and role-aware derivation

**Files:**
- Modify: `src/schema.ts` (`DispatchEntry`, `TerminusEntry`)
- Modify: `src/case-file.ts` (`deriveStateFromEntry`, `deriveBudgetsFromLog` — both
  become exported)
- Modify: `src/index.ts` (re-export the two derivation functions)
- Modify: `docs/single-surface-control-flow.md` (the `Entry =` block)
- Test: `src/case-file.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `DispatchEntry.role?: "worker" | "gate-maintenance"` and
    `TerminusEntry.role?: "worker" | "gate-maintenance"` (absent = worker).
  - `export function deriveStateFromEntry(entry: HistoryEntry): SurfaceState`
  - `export function deriveBudgetsFromLog(history: HistoryEntry[], maxima: BudgetSet): BudgetSet`

- [ ] **Step 1: Write the failing tests**

Add to `src/case-file.test.ts`, inside the existing `describe("rebuild", ...)` block
(it already provides the `dir` fixture created in `beforeEach`):

```ts
  it("derives GATE_MAINTENANCE from a gate-maintenance dispatch tail", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });

    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.state).toBe("GATE_MAINTENANCE");
  });

  it("derives GATE_MAINTENANCE from a gate-maintenance terminus of any status", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
      status: "completed",
      rationale: "reinstalled the gate's dependencies",
    });

    const rebuilt = await rebuild(dir);
    // A worker terminus(completed) would derive GATING; the repair agent's does not.
    expect(rebuilt.cursor.state).toBe("GATE_MAINTENANCE");
  });

  it("counts the gateMaintenance budget off gate-maintenance dispatch entries", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
      status: "completed",
      rationale: "fixed",
    });
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 2,
      sessionKey: "gate-maintenance-2-0",
    });

    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.budgets.gateMaintenance.used).toBe(2);
    // attempt 2 is a repair attempt, not a worker correction
    expect(rebuilt.cursor.budgets.correction.used).toBe(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/case-file.test.ts -t "gate-maintenance"`
Expected: FAIL — zod rejects the unknown `role` key, or the state derives as
`AGENT_ACTIVE`/`GATING` and `gateMaintenance.used` is `0`.

- [ ] **Step 3: Add `role` to the two entry schemas**

In `src/schema.ts`, add the field to `DispatchEntry` and `TerminusEntry`:

```ts
export const DispatchEntry = z.object({
  t: z.literal("dispatch"),
  attempt: z.number().int().positive(),
  sessionKey: z.string(),
  briefRef: z.string().optional(),
  // Absent means "worker" — every Item 1/2 case file stays valid.
  role: z.enum(["worker", "gate-maintenance"]).optional(),
});
export type DispatchEntry = z.infer<typeof DispatchEntry>;

export const TerminusEntry = z.object({
  t: z.literal("terminus"),
  attempt: z.number().int().positive(),
  sessionKey: z.string(),
  status: z.enum(["completed", "escalate", "incomplete"]),
  category: z.enum(["exhaustion", "authority"]).optional(),
  rationale: z.string(),
  role: z.enum(["worker", "gate-maintenance"]).optional(),
});
export type TerminusEntry = z.infer<typeof TerminusEntry>;
```

- [ ] **Step 4: Make the derivations role-aware and export them**

In `src/case-file.ts`, replace `deriveStateFromEntry` and the `dispatch`/`triage`
arms of `deriveBudgetsFromLog`:

```ts
export function deriveStateFromEntry(entry: HistoryEntry): SurfaceState {
  switch (entry.t) {
    case "dispatch":
      // A gate-maintenance dispatch resumes into GATE_MAINTENANCE, whose edge
      // routes on by terminus status; a worker one still means AGENT_ACTIVE.
      return entry.role === "gate-maintenance" ? "GATE_MAINTENANCE" : "AGENT_ACTIVE";
    case "terminus":
      // A repair session's terminus of ANY status stays inside GATE_MAINTENANCE:
      // its edge decides between re-baselining, redispatching and escalating.
      return entry.role === "gate-maintenance"
        ? "GATE_MAINTENANCE"
        : terminusState[entry.status] as SurfaceState;
    case "gate": return gateState[entry.status] as SurfaceState;
    case "triage": return triageState[entry.verdict] as SurfaceState;
    case "close": return closeState[entry.status] as SurfaceState;
  }
}

export function deriveBudgetsFromLog(
  history: HistoryEntry[],
  maxima: BudgetSet,
): BudgetSet {
  const used = { correction: 0, gateError: 0, gateMaintenance: 0, terminus: 0, close: 0 };

  for (const entry of history) {
    switch (entry.t) {
      case "dispatch":
        // The dispatch entry IS the gateMaintenance burn (design spec: "Budgets
        // have no separately-mutated live counter"), so a repair dispatch is
        // never also charged to the worker's correction population.
        if (entry.role === "gate-maintenance") used.gateMaintenance++;
        else if (entry.attempt > 1) used.correction++;
        break;
      case "terminus":
        used.terminus++;
        break;
      case "gate":
        if (entry.status === "ERROR") used.gateError++;
        break;
      case "triage":
        break;
      case "close":
        used.close++;
        break;
    }
  }

  return Object.fromEntries(
    Object.entries(used).map(([k, u]) => [k, { used: u, max: maxima[k as keyof BudgetSet].max }]),
  ) as BudgetSet;
}
```

Note the `triage` arm no longer increments `gateMaintenance`: a `fix_the_gate`
verdict and the repair dispatch it pays for would otherwise double-count. (The
`correction`/`close`/`terminus` re-attribution to `triage`/`terminus` entries is
Slice 3/4 work — see "Out of scope".)

- [ ] **Step 5: Re-export the derivations from the package surface**

In `src/index.ts`, extend the `./case-file.js` export line:

```ts
export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog } from "./case-file.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/case-file.test.ts`
Expected: PASS, including the pre-existing rebuild and `resumeAction` tests.

- [ ] **Step 7: Update the control-flow doc's Entry block**

In `docs/single-surface-control-flow.md`, in the `Entry =` block, add the `role`
field to the two entries so the doc matches the shipped shape:

```
Entry =
  | { t:"dispatch", attempt, session_key, brief_ref?, role? }
        # written WHEN the session starts. brief_ref null on a raw reroute / attempt 1.
        # role: worker (default, may be absent) | gate-maintenance — a repair
        # session records the same crash-recoverable dispatch/terminus pair as a
        # worker, on the gate_maintenance budget rather than the worker's.
  | { t:"terminus", attempt, session_key,
        status: completed|escalate|incomplete,
        category?,             # for escalate: exhaustion | authority
        rationale, role? }     # role as above; must match its dispatch
```

- [ ] **Step 8: Commit**

```bash
git add src/schema.ts src/case-file.ts src/case-file.test.ts src/index.ts docs/single-surface-control-flow.md
git commit -m "Add a role field to dispatch and terminus entries

A gate-maintenance repair session needs the same crash-recoverable
dispatch/terminus pair as a worker attempt, but must not be counted as a
worker attempt. Tagging the entries by role lets state and budget
derivation tell the two apart from the log alone."
```

---

### Task 2: Provisioning errors and the git worktree module

**Files:**
- Modify: `src/errors.ts` (add `ProvisioningFailure`, `IllegalStateTransition`)
- Create: `src/provision.ts`
- Create: `src/temp-repo.ts` (throwaway-repo fixture used by tests and the demo)
- Modify: `src/index.ts`
- Modify: `docs/provisioning.md` (close the branch-naming open item)
- Test: `src/provision.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `class ProvisioningFailure extends Error` — `code: "PROVISIONING_FAILURE"`,
    `readonly surfaceDir: string`, `readonly detail: string`.
  - `class IllegalStateTransition extends Error` — `code: "ILLEGAL_STATE_TRANSITION"`,
    `readonly surfaceDir: string`, `readonly state: string`, `readonly edge: string`.
  - `export function branchName(surfaceId: string): string`
  - `export async function provisionWorktree(dir: string, repoPath: string, worktreePath: string, surfaceId: string): Promise<void>`
  - `export function initTempRepo(prefix: string, files: Record<string, string>): string`

- [ ] **Step 1: Write the failing tests**

Create `src/provision.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { branchName, provisionWorktree } from "./provision.js";
import { initTempRepo } from "./temp-repo.js";
import { ProvisioningFailure } from "./errors.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("branchName", () => {
  it("derives a deterministic branch from the surface id", () => {
    expect(branchName("surface-42")).toBe("surface/surface-42");
    expect(branchName("surface-42")).toBe(branchName("surface-42"));
  });
});

describe("provisionWorktree", () => {
  let dir: string;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "provision-case-"));
    repo = initTempRepo("provision-repo-", { "seed.txt": "hello\n" });
    tree = join(await mkdtemp(join(tmpdir(), "provision-tree-")), "wt");
  });

  it("creates a real worktree on a surface-derived branch off the default branch", async () => {
    await provisionWorktree(dir, repo, tree, "surface-42");

    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    expect(git(tree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("surface/surface-42");
    // Branched off the repo's default branch, so it carries its commit
    expect(git(tree, ["rev-parse", "HEAD"])).toBe(git(repo, ["rev-parse", "HEAD"]));
  });

  it("tears down a partial worktree and recreates it rather than adopting it", async () => {
    await provisionWorktree(dir, repo, tree, "surface-42");
    await writeFile(join(tree, "stray.txt"), "left behind by a torn attempt\n");

    await provisionWorktree(dir, repo, tree, "surface-42");

    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    await expect(readFile(join(tree, "stray.txt"), "utf-8")).rejects.toThrow();
  });

  it("throws ProvisioningFailure naming the surface dir when the path is unusable", async () => {
    const blocker = join(await mkdtemp(join(tmpdir(), "provision-block-")), "file");
    await writeFile(blocker, "not a directory\n");

    await expect(
      provisionWorktree(dir, repo, join(blocker, "wt"), "surface-42"),
    ).rejects.toThrow(ProvisioningFailure);

    await expect(
      provisionWorktree(dir, repo, join(blocker, "wt"), "surface-42"),
    ).rejects.toThrow(new RegExp(dir));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/provision.test.ts`
Expected: FAIL — `Cannot find module './provision.js'`.

- [ ] **Step 3: Add the two error classes**

Append to `src/errors.ts`:

```ts
export class ProvisioningFailure extends Error {
  readonly code = "PROVISIONING_FAILURE" as const;
  constructor(
    readonly surfaceDir: string,
    readonly detail: string,
  ) {
    super(`Provisioning failed for ${surfaceDir}: ${detail}`);
    this.name = "ProvisioningFailure";
  }
}

export class IllegalStateTransition extends Error {
  readonly code = "ILLEGAL_STATE_TRANSITION" as const;
  constructor(
    readonly surfaceDir: string,
    readonly state: string,
    readonly edge: string,
  ) {
    super(
      `No "${edge}" edge from state ${state} in ${surfaceDir}: ` +
        `the driver has no transition to take from here`,
    );
    this.name = "IllegalStateTransition";
  }
}
```

- [ ] **Step 4: Write the throwaway-repo fixture**

Create `src/temp-repo.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test and demo support: create a throwaway git repository seeded with `files`
 * and a single commit on `main`. Identity is passed with `-c` so the fixture
 * does not depend on the machine's global git config.
 */
export function initTempRepo(prefix: string, files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  };

  git(["init", "-b", "main"]);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(repo, name), contents);
  }
  git(["add", "-A"]);
  git([
    "-c", "user.email=harness@example.invalid",
    "-c", "user.name=Harness",
    "commit", "-m", "seed",
  ]);

  return repo;
}
```

- [ ] **Step 5: Write the provisioning module**

Create `src/provision.ts`:

```ts
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ProvisioningFailure } from "./errors.js";
import { messageOf } from "./gate-support.js";

const execFile = promisify(execFileCb);

/**
 * The surface_id → branch scheme, settled by the single-surface state machine
 * design: pure, deterministic, and stored nowhere, so it can never drift from
 * the surface id it is derived from.
 */
export function branchName(surfaceId: string): string {
  return `surface/${surfaceId}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

async function tryGit(cwd: string, args: string[]): Promise<void> {
  try {
    await git(cwd, args);
  } catch {
    // Best-effort clean-up: nothing to remove is the common case.
  }
}

async function resolveBaseRef(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  } catch {
    // No origin (a local-only or freshly-initialised repo): the checked-out
    // branch is the repo's default.
    return git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
  }
}

/**
 * Create this surface's worktree, off the repository's default branch, on a
 * branch derived from the surface id.
 *
 * Provisioning is the one node that must start from a known-clean tree
 * (docs/provisioning.md), so a partial worktree or a leftover branch from a
 * torn attempt is torn down and recreated rather than adopted. That makes the
 * whole function idempotent: a crash anywhere inside it is recovered by calling
 * it again.
 */
export async function provisionWorktree(
  dir: string,
  repoPath: string,
  worktreePath: string,
  surfaceId: string,
): Promise<void> {
  const branch = branchName(surfaceId);
  try {
    const baseRef = await resolveBaseRef(repoPath);
    await tryGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    await tryGit(repoPath, ["branch", "-D", branch]);
    await git(repoPath, ["worktree", "add", worktreePath, "-b", branch, baseRef]);
  } catch (err) {
    throw new ProvisioningFailure(dir, messageOf(err));
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/provision.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Export the new surface from the package index**

In `src/index.ts`, add:

```ts
export { branchName, provisionWorktree } from "./provision.js";
export { initTempRepo } from "./temp-repo.js";
```

and extend the errors export list with `ProvisioningFailure, IllegalStateTransition`.

- [ ] **Step 8: Close the branch-naming open item in the provisioning doc**

In `docs/provisioning.md`, under "## Open items", replace the
"**Branch naming and collision.**" bullet with:

```
- **Branch naming and collision.** ~~Open.~~ Settled by the single-surface state
  machine: the branch is `surface/<surface_id>`, computed by a pure function and
  stored nowhere, so it can never drift from the surface id. A branch surviving a
  prior aborted run is force-deleted as part of the same tear-down-and-recreate
  that handles a partial worktree, so provisioning always starts from a clean
  branch as well as a clean tree.
```

- [ ] **Step 9: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/errors.ts src/provision.ts src/temp-repo.ts src/provision.test.ts src/index.ts docs/provisioning.md
git commit -m "Create a surface's worktree with a real git worktree add

The driver's entry edge needs a real tree to gate against, and stubbing it
would leave the loop untestable against a filesystem. Provisioning tears
down any partial tree or leftover branch before recreating, so the edge is
idempotent under the crash windows provisioning.md describes."
```

---

### Task 3: Ports, the no-op closer, and the `advance` skeleton

**Files:**
- Create: `src/ports.ts`
- Create: `src/surface.ts`
- Modify: `src/index.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `deriveStateFromEntry` (Task 1); `load`, `logTail` from `case-file.js`.
- Produces:
  - `src/ports.ts`: `AgentRole`, `RoleConfig`, `AgentContext`, `Terminus`,
    `AgentPort`, `TriageInput`, `TriageVerdict`, `TriagePort`, `CloseContext`,
    `CloseOutcome`, `CloseReport`, `CloserPort`, `SurfacePorts`,
    `SurfaceLocation`, `noopCloser`.
  - `src/surface.ts`: `export interface AdvanceResult { state: SurfaceState; done: boolean }`
    and `export async function advance(dir: string, location: SurfaceLocation, ports: SurfacePorts): Promise<AdvanceResult>`.

- [ ] **Step 1: Write the failing tests**

Create `src/surface.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, setBaseline, setOutcome, updateCursor } from "./case-file.js";
import { advance } from "./surface.js";
import { noopCloser } from "./ports.js";
import type { SurfaceLocation, SurfacePorts, Terminus } from "./ports.js";
import { IllegalStateTransition } from "./errors.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

/** An agent that must never be called in this scenario. */
export function unusedAgent(): SurfacePorts["agent"] {
  return {
    invoke: () => Promise.reject(new Error("agent.invoke was not expected here")),
  };
}

export function unusedTriage(): SurfacePorts["triage"] {
  return {
    triage: () => Promise.reject(new Error("triage was not expected here")),
  };
}

/** An agent that returns each scripted terminus in turn, then repeats the last. */
export function scriptedAgent(script: Terminus[]): SurfacePorts["agent"] & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    invoke: (roleCfg, ctx) => {
      calls.push(`${roleCfg.role}:${ctx.sessionKey}`);
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      return Promise.resolve(next as Terminus);
    },
  };
}

export function portsWith(agent: SurfacePorts["agent"]): SurfacePorts {
  return { agent, triage: unusedTriage(), closer: noopCloser };
}

describe("advance", () => {
  let dir: string;
  let location: SurfaceLocation;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    location = { repoPath: "/unused", worktreePath: "/unused" };
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  it("returns the terminal state without re-entering the machine once an outcome is set", async () => {
    await updateCursor(dir, { state: "ESCALATED" });
    await setOutcome(dir, {
      kind: "escalated",
      source: "gate-maintenance",
      reason: "already done",
      at: new Date().toISOString(),
    });

    const result = await advance(dir, location, portsWith(unusedAgent()));

    expect(result).toEqual({ state: "ESCALATED", done: true });
  });

  it("throws IllegalStateTransition naming the state it cannot advance from", async () => {
    // A baselined surface with no worker dispatch sits at AGENT_ACTIVE, whose
    // edge this slice does not ship.
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });

    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      IllegalStateTransition,
    );
    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      /AGENT_ACTIVE/,
    );
  });
});

describe("noopCloser", () => {
  it("reports DONE and does no teardown", async () => {
    const report = await noopCloser.close(
      { worktreePath: "/unused", dir: "/unused" },
      { kind: "escalated" },
    );
    expect(report.status).toBe("DONE");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts`
Expected: FAIL — `Cannot find module './surface.js'`.

- [ ] **Step 3: Write the ports module**

Create `src/ports.ts`:

```ts
import type { BudgetSet, CaseFile } from "./schema.js";

// --- AgentPort (Item 4 supplies the real, SDK-backed implementation) ---

export type AgentRole = "worker" | "triage" | "gate-maintenance";

/** Per-role pinned configuration. Item 4 owns what else lives in here. */
export interface RoleConfig {
  role: AgentRole;
}

export interface AgentContext {
  worktreePath: string;
  dir: string;
  sessionKey: string;
}

export type Terminus =
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | { status: "incomplete"; rationale: string };

export interface AgentPort {
  invoke(roleCfg: RoleConfig, ctx: AgentContext): Promise<Terminus>;
}

// --- TriagePort (this item ships the deterministic router; Item 5 the agent) ---

export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  /** Log-derived {used, max} per population, computed immediately before the call. */
  remainingBudgets: BudgetSet;
}

export interface TriageVerdict {
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort";
  rationale: string;
}

export interface TriagePort {
  triage(input: TriageInput): Promise<TriageVerdict>;
}

// --- CloserPort (Item 6 supplies merge-back / open-PR / teardown closers) ---

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

/**
 * The closer this item ships: reports DONE and performs no infra work. The
 * worktree is deliberately left in place for inspection — real teardown is
 * Item 6's, and orphan collection Item 10's.
 */
export const noopCloser: CloserPort = {
  close: () =>
    Promise.resolve({ status: "DONE", detail: "no-op closer (Item 6 ships real closers)" }),
};

// --- What the driver is called with ---

export interface SurfacePorts {
  agent: AgentPort;
  triage: TriagePort;
  closer: CloserPort;
}

/**
 * The two caller-supplied filesystem locations. Both are read only while
 * `cursor.worktreeRef` is still the empty-string "not yet provisioned"
 * sentinel; afterwards `cursor.worktreeRef` is authoritative, so a replay
 * called with different arguments cannot divert a provisioned surface.
 */
export interface SurfaceLocation {
  repoPath: string;
  worktreePath: string;
}
```

- [ ] **Step 4: Write the `advance` skeleton**

Create `src/surface.ts`:

```ts
import { load, logTail, deriveStateFromEntry } from "./case-file.js";
import { IllegalStateTransition } from "./errors.js";
import type { SurfaceLocation, SurfacePorts } from "./ports.js";
import type { CaseFile, SurfaceState } from "./schema.js";

export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
}

function worktreeOf(caseFile: CaseFile, location: SurfaceLocation): string {
  // `create` writes worktreeRef: "" — the "not yet provisioned" sentinel.
  return caseFile.cursor.worktreeRef || location.worktreePath;
}

/**
 * Where the surface actually is, derived rather than trusted.
 *
 * Before the first worker dispatch there are no worker log entries to read, so
 * the header's set-once `baseline` and the cursor are authoritative — this is
 * the one segment of the loop where that is true. Once a baseline exists the
 * surface is ready for a worker.
 */
function position(caseFile: CaseFile): SurfaceState {
  if (caseFile.header.baseline === null) {
    const tail = logTail(caseFile);
    if (tail) return deriveStateFromEntry(tail);
    return caseFile.cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING";
  }
  return "AGENT_ACTIVE";
}

/**
 * Perform exactly one transition and commit it. Safe to call from a fresh
 * process against an existing `dir`: every branch reads pre-entry state or the
 * log tail, so a call after a crash always resumes onto a legal edge.
 */
export async function advance(
  dir: string,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const caseFile = await load(dir);

  // Terminal surfaces are recognised before any position is derived: escalation
  // and abort do not always append an entry, so a terminal surface's log tail
  // can still look mid-flight.
  if (caseFile.outcome) return { state: caseFile.cursor.state, done: true };

  const state = position(caseFile);
  switch (state) {
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}
```

`worktreeOf` is referenced by the edges added in Tasks 4–6; leave it in place.
If the linter flags it as unused at this point, add the edges in the next task
rather than deleting it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Export the driver and the port types**

In `src/index.ts`, add:

```ts
export { advance } from "./surface.js";
export { noopCloser } from "./ports.js";
export type { AdvanceResult } from "./surface.js";
export type {
  AgentRole,
  RoleConfig,
  AgentContext,
  Terminus,
  AgentPort,
  TriageInput,
  TriageVerdict,
  TriagePort,
  CloseContext,
  CloseOutcome,
  CloseReport,
  CloserPort,
  SurfacePorts,
  SurfaceLocation,
} from "./ports.js";
```

- [ ] **Step 7: Commit**

```bash
git add src/ports.ts src/surface.ts src/surface.test.ts src/index.ts
git commit -m "Add the surface driver's port seams and advance skeleton

Fixing the agent, triage and closer contracts now lets Items 4, 5 and 6
supply real implementations without touching the driver, and gives the
state machine a single place to recognise an already-terminal surface and
to refuse a state it has no edge for."
```

---

### Task 4: The `PROVISIONING` edge

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `provisionWorktree`, `branchName` (Task 2); `ProvisioningFailure`
  (Task 2); `advance`, `worktreeOf`, `AdvanceResult` (Task 3).
- Produces (module-private, used by Tasks 5–6):
  - `async function terminate(dir: string, caseFile: CaseFile, location: SurfaceLocation, ports: SurfacePorts, state: "ESCALATED" | "ABORTED", outcome: CaseFileOutcome): Promise<AdvanceResult>`

- [ ] **Step 1: Write the failing tests**

Add to `src/surface.test.ts` (inside `describe("advance", ...)`; it needs a real
repo, so import the fixture at the top of the file):

```ts
// add to the imports at the top of the file
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { load } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
```

```ts
  it("creates a worktree on a surface-derived branch and lands on PRE_GATING", async () => {
    const repo = initTempRepo("surface-repo-", { "seed.txt": "hello\n" });
    const tree = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");

    const result = await advance(dir, { repoPath: repo, worktreePath: tree }, portsWith(unusedAgent()));

    expect(result).toEqual({ state: "PRE_GATING", done: false });
    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    expect(
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: tree, encoding: "utf-8" }).trim(),
    ).toBe("surface/surface-1");

    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("PRE_GATING");
    expect(reloaded.cursor.worktreeRef).toBe(tree);
  });

  it("aborts with a reason when the worktree cannot be created", async () => {
    const repo = initTempRepo("surface-repo-", { "seed.txt": "hello\n" });
    const blocker = join(await mkdtemp(join(tmpdir(), "surface-block-")), "file");
    await writeFile(blocker, "not a directory\n");

    const result = await advance(
      dir,
      { repoPath: repo, worktreePath: join(blocker, "wt") },
      portsWith(unusedAgent()),
    );

    expect(result).toEqual({ state: "ABORTED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("ABORTED");
    expect(reloaded.outcome?.kind).toBe("aborted");
    expect(reloaded.outcome?.source).toBe("provisioning");
    expect(reloaded.outcome?.reason).not.toBe("");
    // No history entry: provisioning has no representation in the log
    expect(reloaded.history).toHaveLength(0);
  });

  it("still reaches ABORTED when the closer's teardown throws", async () => {
    const repo = initTempRepo("surface-repo-", { "seed.txt": "hello\n" });
    const blocker = join(await mkdtemp(join(tmpdir(), "surface-block-")), "file");
    await writeFile(blocker, "not a directory\n");
    const throwingCloser = {
      close: () => Promise.reject(new Error("teardown blew up")),
    };

    const result = await advance(
      dir,
      { repoPath: repo, worktreePath: join(blocker, "wt") },
      { agent: unusedAgent(), triage: unusedTriage(), closer: throwingCloser },
    );

    expect(result).toEqual({ state: "ABORTED", done: true });
  });
```

Add `writeFile` to the `node:fs/promises` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "worktree"`
Expected: FAIL with `IllegalStateTransition ... state PROVISIONING`.

- [ ] **Step 3: Implement the terminal handler and the PROVISIONING edge**

In `src/surface.ts`, add the imports and the two functions, and wire the switch:

```ts
import { load, logTail, deriveStateFromEntry, setOutcome, updateCursor } from "./case-file.js";
import { IllegalStateTransition, ProvisioningFailure } from "./errors.js";
import { provisionWorktree } from "./provision.js";
import { messageOf } from "./gate-support.js";
import type { CaseFile, CaseFileOutcome, SurfaceState } from "./schema.js";
```

```ts
/**
 * Escalation and abort are handled identically: no extra history entry (the
 * entries already in the log evidence the cause), an outcome, a cursor write so
 * the cursor names the terminal state the outcome records, and a fire-and-log
 * closer call for infra teardown. A teardown failure here is logged, never
 * re-triaged — the surface is already terminal.
 */
async function terminate(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  state: "ESCALATED" | "ABORTED",
  outcome: CaseFileOutcome,
): Promise<AdvanceResult> {
  await setOutcome(dir, outcome);
  await updateCursor(dir, { state });
  try {
    await ports.closer.close(
      { worktreePath: worktreeOf(caseFile, location), dir },
      { kind: outcome.kind === "closed" ? "accepted" : outcome.kind },
    );
  } catch (err) {
    console.warn(`Closer teardown failed for ${dir}: ${messageOf(err)}`);
  }
  return { state, done: true };
}

async function provisioning(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const worktreePath = worktreeOf(caseFile, location);
  try {
    await provisionWorktree(dir, location.repoPath, worktreePath, caseFile.header.surfaceId);
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return terminate(dir, caseFile, location, ports, "ABORTED", {
      kind: "aborted",
      source: "provisioning",
      reason: err.detail,
      at: new Date().toISOString(),
    });
  }

  // The cursor advance is the commit point for "the worktree exists and belongs
  // to this surface" — provisioning has no history representation.
  await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
  return { state: "PRE_GATING", done: false };
}
```

and in `advance`'s switch:

```ts
  switch (state) {
    case "PROVISIONING":
      return provisioning(dir, caseFile, location, ports);
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Advance a fresh surface from PROVISIONING to PRE_GATING

A surface cannot be gated until it owns a real tree. Converting a failed
worktree creation into an aborted outcome with a reason keeps infra-class
failure from crashing the driver, which is the baseline every later edge's
error handling builds on."
```

---

### Task 5: The `PRE_GATING` edge and the gate-maintenance dispatch

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `recordBaseline` (`src/run-gate.ts`, already shipped);
  `deriveBudgetsFromLog` (Task 1); `terminate`, `worktreeOf` (Tasks 3–4).
- Produces (module-private, used by Task 6):
  - `async function dispatchGateMaintenance(dir: string, caseFile: CaseFile, location: SurfaceLocation, ports: SurfacePorts, reason: string): Promise<AdvanceResult>`
  - `async function preGating(dir: string, caseFile: CaseFile, location: SurfaceLocation, ports: SurfacePorts): Promise<AdvanceResult>`
  - `sessionKey` format: `` `gate-maintenance-${attempt}-${retryCount}` ``

- [ ] **Step 1: Write the failing tests**

Add to `src/surface.test.ts`. First a small helper, placed just below
`portsWith`:

```ts
/** Provision a surface against a repo seeded with `files`, and return its paths. */
async function provisioned(
  dir: string,
  files: Record<string, string>,
  ports: SurfacePorts,
): Promise<SurfaceLocation> {
  const repoPath = initTempRepo("surface-repo-", files);
  const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");
  const location = { repoPath, worktreePath };
  await advance(dir, location, ports);
  return location;
}

const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
```

Then the tests:

```ts
  it("baselines a healthy gate and lands on AGENT_ACTIVE with no repair dispatched", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "unused" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "AGENT_ACTIVE", done: false });
    const reloaded = await load(dir);
    expect(reloaded.header.baseline?.status).toBe("PASS");
    expect(reloaded.cursor.state).toBe("AGENT_ACTIVE");
    expect(agent.calls).toEqual([]);
    expect(reloaded.history).toHaveLength(0);
  });

  it("baselines a red-but-running gate and still lands on AGENT_ACTIVE", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "unused" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "report.tap": FAILING_TAP }, ports);

    const result = await advance(dir, location, ports);

    // Pre-existing failures are recorded as the baseline, not repaired: only a
    // gate-level ERROR routes to GATE_MAINTENANCE.
    expect(result).toEqual({ state: "AGENT_ACTIVE", done: false });
    expect(agent.calls).toEqual([]);
  });

  it("dispatches a repair session when the gate itself cannot run", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "reinstalled the runner" }]);
    const ports = portsWith(agent);
    // No report.tap in the repo: `cat report.tap` fails and parses to nothing,
    // so the gate reports ERROR.
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATE_MAINTENANCE", done: false });
    expect(agent.calls).toEqual(["gate-maintenance:gate-maintenance-1-0"]);

    const reloaded = await load(dir);
    expect(reloaded.header.baseline).toBeNull();
    expect(reloaded.cursor.state).toBe("GATE_MAINTENANCE");
    expect(reloaded.history).toEqual([
      { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" },
      {
        t: "terminus",
        role: "gate-maintenance",
        attempt: 1,
        sessionKey: "gate-maintenance-1-0",
        status: "completed",
        rationale: "reinstalled the runner",
      },
    ]);
  });

  it("escalates instead of dispatching when the gate-maintenance budget is already spent", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "unused" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);
    // Two prior repair dispatches == the cap of 2
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" });
    await appendEntry(dir, { t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0", status: "completed", rationale: "a" });
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 2, sessionKey: "gate-maintenance-2-0" });
    await appendEntry(dir, { t: "terminus", role: "gate-maintenance", attempt: 2, sessionKey: "gate-maintenance-2-0", status: "completed", rationale: "b" });

    // Position is GATE_MAINTENANCE now, so drive PRE_GATING's cap check via the
    // completed-terminus exit, which re-baselines and finds ERROR again.
    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.outcome?.kind).toBe("escalated");
    expect(reloaded.outcome?.reason).toContain("gateMaintenance");
    expect(reloaded.outcome?.reason).toContain("2/2");
    // No third dispatch was appended
    expect(reloaded.history.filter((e) => e.t === "dispatch")).toHaveLength(2);
  });
```

Add `appendEntry` to the `./case-file.js` import.

Note: the last test depends on Task 6's `GATE_MAINTENANCE` completed-terminus
exit. Write it now (it states the cap behaviour this task implements) and expect
it to stay red until Task 6 lands; every other test in this task must go green
here.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "gate"`
Expected: FAIL with `IllegalStateTransition ... state PRE_GATING`.

- [ ] **Step 3: Implement the baseline edge and the repair dispatch**

In `src/surface.ts`, add:

```ts
import { recordBaseline } from "./run-gate.js";
import type { HistoryEntry } from "./schema.js";
```

```ts
function isGateMaintenanceTerminus(entry: HistoryEntry): boolean {
  return entry.t === "terminus" && entry.role === "gate-maintenance";
}

/**
 * The repair agent's own attempt counter, entirely separate from the worker's:
 * a resolved repair session (completed or escalate) advances it, an incomplete
 * one does not — that redispatches the same attempt.
 */
function gateMaintenanceAttempt(history: HistoryEntry[]): number {
  return (
    1 +
    history.filter(
      (e) =>
        isGateMaintenanceTerminus(e) &&
        e.t === "terminus" &&
        (e.status === "completed" || e.status === "escalate"),
    ).length
  );
}

function gateMaintenanceRetries(history: HistoryEntry[], attempt: number): number {
  return history.filter(
    (e) =>
      isGateMaintenanceTerminus(e) &&
      e.t === "terminus" &&
      e.attempt === attempt &&
      e.status === "incomplete",
  ).length;
}

/**
 * Dispatch one repair session, or escalate if the gate-maintenance budget is
 * spent. The dispatch entry IS the budget burn: the count is derived from the
 * log first, and the entry appended only if under cap, so "burned live" and
 * "derived from the log on rebuild" are the same computation by construction.
 */
async function dispatchGateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  reason: string,
): Promise<AdvanceResult> {
  const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
  const { used, max } = budgets.gateMaintenance;
  if (used >= max) {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: "gate-maintenance",
      reason: `gateMaintenance budget exhausted (${used}/${max}): ${reason}`,
      at: new Date().toISOString(),
    });
  }

  const attempt = gateMaintenanceAttempt(caseFile.history);
  const sessionKey = `gate-maintenance-${attempt}-${gateMaintenanceRetries(caseFile.history, attempt)}`;

  await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt, sessionKey });
  const terminus = await ports.agent.invoke(
    { role: "gate-maintenance" },
    { worktreePath: worktreeOf(caseFile, location), dir, sessionKey },
  );
  await appendEntry(dir, {
    t: "terminus",
    role: "gate-maintenance",
    attempt,
    sessionKey,
    status: terminus.status,
    ...(terminus.status === "escalate" ? { category: terminus.category } : {}),
    rationale: terminus.rationale,
  });
  await updateCursor(dir, { state: "GATE_MAINTENANCE" });
  return { state: "GATE_MAINTENANCE", done: false };
}

/**
 * Capture the baseline. A gate that ran — green or known-red — is a trustworthy
 * measuring stick, so the surface is ready for a worker; only a gate-level
 * ERROR (the gate could not run at all) needs the environment repaired first.
 */
async function preGating(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const report = await recordBaseline(dir, worktreeOf(caseFile, location));
  if (report.status !== "ERROR") {
    await updateCursor(dir, { state: "AGENT_ACTIVE" });
    return { state: "AGENT_ACTIVE", done: false };
  }
  // recordBaseline stores nothing on ERROR, so `caseFile` is still current.
  return dispatchGateMaintenance(
    dir,
    caseFile,
    location,
    ports,
    report.detail ?? "the gate could not run",
  );
}
```

Add `appendEntry` and `deriveBudgetsFromLog` to the `./case-file.js` import, and
wire the switch:

```ts
    case "PRE_GATING":
      return preGating(dir, caseFile, location, ports);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS for every test except "escalates instead of dispatching when the
gate-maintenance budget is already spent", which stays red until Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Baseline a provisioned surface and repair a gate that cannot run

A baseline is only a trustworthy measuring stick if the gate actually ran,
so a gate-level ERROR dispatches a repair session rather than pinning a
meaningless fingerprint. Deriving the repair budget from the log and
appending the dispatch only when under cap makes the entry itself the burn,
so a crash cannot leave the counter and the log disagreeing."
```

---

### Task 6: The `GATE_MAINTENANCE` edge

**Files:**
- Modify: `src/surface.ts`
- Test: `src/surface.test.ts`

**Interfaces:**
- Consumes: `dispatchGateMaintenance`, `preGating`, `terminate` (Tasks 4–5);
  `logTail`, `appendEntry` (`case-file.js`).
- Produces: nothing new for later tasks; completes `advance`'s slice-1 switch.

- [ ] **Step 1: Write the failing tests**

Add to `src/surface.test.ts`:

```ts
  it("re-baselines after a successful repair and reaches AGENT_ACTIVE", async () => {
    const agent: SurfacePorts["agent"] & { calls: string[] } = (() => {
      const calls: string[] = [];
      return {
        calls,
        invoke: (roleCfg, ctx) => {
          calls.push(`${roleCfg.role}:${ctx.sessionKey}`);
          // The repair agent fixes the environment it was dispatched into.
          writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
          return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
        },
      };
    })();
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    expect(await advance(dir, location, ports)).toEqual({ state: "GATE_MAINTENANCE", done: false });
    expect(await advance(dir, location, ports)).toEqual({ state: "AGENT_ACTIVE", done: false });

    const reloaded = await load(dir);
    expect(reloaded.header.baseline?.status).toBe("PASS");
    expect(agent.calls).toEqual(["gate-maintenance:gate-maintenance-1-0"]);
  });

  it("escalates when a repair session escalates outright", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "authority", rationale: "no permission to install the runner" },
    ]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    await advance(dir, location, ports);
    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.outcome?.kind).toBe("escalated");
    expect(reloaded.outcome?.reason).toContain("no permission to install the runner");
  });

  it("redispatches an incomplete repair on the same attempt with a fresh session key", async () => {
    const agent = scriptedAgent([
      { status: "incomplete", rationale: "session was killed" },
      { status: "escalate", category: "authority", rationale: "gave up" },
    ]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    await advance(dir, location, ports); // dispatch 1 -> incomplete
    expect(await advance(dir, location, ports)).toEqual({ state: "GATE_MAINTENANCE", done: false });

    expect(agent.calls).toEqual([
      "gate-maintenance:gate-maintenance-1-0",
      "gate-maintenance:gate-maintenance-1-1",
    ]);
    const dispatches = (await load(dir)).history.filter((e) => e.t === "dispatch");
    expect(dispatches.map((e) => e.attempt)).toEqual([1, 1]);
  });

  it("treats a dangling repair dispatch on resume as an incomplete terminus", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "unused" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);
    // A repair session that started and never recorded a result.
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" });

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATE_MAINTENANCE", done: false });
    expect(agent.calls).toEqual([]); // no duplicate session dispatched
    const tail = (await load(dir)).history.at(-1);
    expect(tail).toMatchObject({ t: "terminus", role: "gate-maintenance", attempt: 1, status: "incomplete" });
  });

  it("escalates when repeated repairs never fix the gate, at exactly the cap", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "claims to have fixed it" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    expect(await advance(dir, location, ports)).toEqual({ state: "GATE_MAINTENANCE", done: false });
    expect(await advance(dir, location, ports)).toEqual({ state: "GATE_MAINTENANCE", done: false });
    expect(await advance(dir, location, ports)).toEqual({ state: "ESCALATED", done: true });

    // gateMaintenance max is 2, so exactly two repair sessions ran
    expect(agent.calls).toEqual([
      "gate-maintenance:gate-maintenance-1-0",
      "gate-maintenance:gate-maintenance-2-0",
    ]);
    const reloaded = await load(dir);
    expect(reloaded.outcome?.reason).toContain("2/2");
  });
```

Add `writeFileSync` from `node:fs` to the imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "repair"`
Expected: FAIL with `IllegalStateTransition ... state GATE_MAINTENANCE`.

- [ ] **Step 3: Implement the edge**

In `src/surface.ts`, add:

```ts
/**
 * Route a repair session's outcome.
 *
 * Slice 1 only reaches here pre-task (no baseline yet), so a completed repair
 * resolves by re-baselining. That re-baseline — writing the set-once
 * `header.baseline`, or appending another repair dispatch when the gate is
 * still broken — is what makes the exit distinguishable on resume: without it
 * the log tail would still derive GATE_MAINTENANCE and the surface would
 * re-enter this edge forever.
 */
async function gateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "dispatch") {
    // A dispatch with no terminus is a session that ended without emitting a
    // valid result — an incomplete terminus, not a session to resurrect. Record
    // it and let the ordinary incomplete handling redispatch or escalate.
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: tail.attempt,
      sessionKey: tail.sessionKey,
      status: "incomplete",
      rationale: "repair session ended without recording a terminus (recovered on resume)",
    });
    return { state: "GATE_MAINTENANCE", done: false };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "GATE_MAINTENANCE", "resolve-repair");
  }

  switch (tail.status) {
    case "completed":
      return preGating(dir, caseFile, location, ports);
    case "escalate":
      return terminate(dir, caseFile, location, ports, "ESCALATED", {
        kind: "escalated",
        source: "gate-maintenance",
        reason: tail.rationale,
        at: new Date().toISOString(),
      });
    case "incomplete":
      return dispatchGateMaintenance(
        dir,
        caseFile,
        location,
        ports,
        "the repair session ended without a result",
      );
  }
}
```

and wire the switch:

```ts
    case "GATE_MAINTENANCE":
      return gateMaintenance(dir, caseFile, location, ports);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/surface.test.ts`
Expected: PASS — including Task 5's deferred "budget is already spent" test.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Resolve a repair session back into the baseline loop or escalate

A repair that claims success is only believed once the gate is re-run, so
the completed exit re-baselines rather than trusting the agent; that write
is also what lets a resumed process tell a resolved repair from one still
in flight. A dangling dispatch is recorded as an incomplete terminus so a
crashed repair costs its own budget instead of retrying forever."
```

---

### Task 7: The provisioning demo script

**Files:**
- Create: `demos/single-surface-slice-1-provisioning.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `create` (`src/case-file.js`), `advance` (`src/surface.js`),
  `noopCloser` and the port types (`src/ports.js`), `initTempRepo`
  (`src/temp-repo.js`).
- Produces: `npm run demo:surface-slice-1`.

- [ ] **Step 1: Write the demo script**

Create `demos/single-surface-slice-1-provisioning.ts`:

```ts
/**
 * UAT demo for Single-Surface State Machine Slice 1: Provision a Surface and
 * Reach Its First Decision Point.
 *
 * Points the driver at a fresh case file directory and a real temporary git
 * repository four times: a project whose gate passes cleanly, one whose gate is
 * broken until a scripted repair agent fixes it, one whose repair agent never
 * fixes it, and one with an unusable worktree path.
 *
 * Usage: npx tsx demos/single-surface-slice-1-provisioning.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate is a plain shell command over the project's TAP output, so "the gate
// itself cannot run" is just a missing report file.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("triage is not reachable in slice 1")),
};

/** Never called: this project's gate runs fine. */
const idleAgent: AgentPort = {
  invoke: () => Promise.reject(new Error("no repair should be dispatched")),
};

/** Writes the missing report file, so the next baseline succeeds. */
const repairingAgent: AgentPort = {
  invoke: (_roleCfg, ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "report.tap"), PASSING_TAP);
    return Promise.resolve({ status: "completed", rationale: "restored the missing report.tap" });
  },
};

/** Claims success every time but never actually fixes anything. */
const uselessAgent: AgentPort = {
  invoke: () => Promise.resolve({ status: "completed", rationale: "claims to have fixed it" }),
};

async function runSurface(
  label: string,
  files: Record<string, string>,
  agent: AgentPort,
  worktreePathOverride?: string,
): Promise<void> {
  console.log(`\n=== ${label} ===`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-case-"));
  const repoPath = initTempRepo("surface-demo-repo-", files);
  const worktreePath =
    worktreePathOverride ??
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-tree-")), "wt");
  const location: SurfaceLocation = { repoPath, worktreePath };
  const ports: SurfacePorts = { agent, triage: unusedTriage, closer: noopCloser };

  await create(
    dir,
    { surfaceId: `demo-${label.split(" ")[0]?.toLowerCase() ?? "surface"}`, taskDef: { intent: "add a feature" }, gateRef },
    budgets,
  );
  console.log("State: PROVISIONING (fresh case file, no worktree)");

  // Slice 1 stops at "ready for a worker": AGENT_ACTIVE has no edge yet.
  for (let step = 0; step < 10; step++) {
    const { state, done } = await advance(dir, location, ports);
    console.log(`State: ${state}`);
    if (done || state === "AGENT_ACTIVE") break;
  }

  const caseFile = await load(dir);
  const repairs = caseFile.history.filter((e) => e.t === "dispatch").length;
  console.log(`Worktree created: ${fs.existsSync(worktreePath)}`);
  console.log(`Baseline captured: ${caseFile.header.baseline !== null}`);
  console.log(`Repair sessions dispatched: ${repairs}`);
  console.log(
    caseFile.outcome
      ? `Outcome: ${caseFile.outcome.kind} — ${caseFile.outcome.reason}`
      : "Outcome: none yet — ready for a worker",
  );
}

async function main(): Promise<void> {
  await runSurface("Healthy gate", { "report.tap": PASSING_TAP }, idleAgent);
  await runSurface("Broken gate, repaired", { "seed.txt": "hello\n" }, repairingAgent);
  await runSurface("Broken gate, never repaired", { "seed.txt": "hello\n" }, uselessAgent);

  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-block-")), "file");
  fs.writeFileSync(blocker, "not a directory\n");
  await runSurface(
    "Unusable worktree path",
    { "report.tap": PASSING_TAP },
    idleAgent,
    path.join(blocker, "wt"),
  );
}

await main();
```

- [ ] **Step 2: Add the demo script to package.json**

In `package.json`, add to `scripts` (keeping the existing demo entries):

```json
    "demo:surface-slice-1": "npx tsx demos/single-surface-slice-1-provisioning.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:surface-slice-1`
Expected:
- **Healthy gate** — `PROVISIONING → PRE_GATING → AGENT_ACTIVE`, worktree created
  `true`, baseline captured `true`, repair sessions dispatched `0`, outcome
  "ready for a worker".
- **Broken gate, repaired** — `PROVISIONING → PRE_GATING → GATE_MAINTENANCE →
  AGENT_ACTIVE`, repair sessions dispatched `1`, baseline captured `true`.
- **Broken gate, never repaired** — two `GATE_MAINTENANCE` lines then
  `ESCALATED`, repair sessions dispatched `2`, outcome reason naming
  `gateMaintenance budget exhausted (2/2)`.
- **Unusable worktree path** — `ABORTED` with a provisioning reason, worktree
  created `false`, baseline captured `false`.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add demos/single-surface-slice-1-provisioning.ts package.json
git commit -m "Add a provisioning demo for the single-surface driver

The state machine has no product surface yet, so a harness extender needs a
runnable script whose printed state sequence shows the entry ramp working
against a real git repository and a scripted repair agent."
```

---

## Self-review

### 1. Slice coverage

| Acceptance criterion | Task |
|---|---|
| Fresh dir + no worktree → real worktree on a surface-derived branch off the default branch | Task 2 (`provisionWorktree`), Task 4 (the edge) |
| Worktree exists → baseline recorded automatically with no further input | Task 5 (`preGating`, driven by the next `advance`) |
| Healthy or pre-existing-failure baseline → ready to dispatch a worker | Task 5 (both `AGENT_ACTIVE` tests) |
| Baseline ERROR → repair dispatched; a successful repair re-baselines to the same ready state | Task 5 (dispatch), Task 6 (`completed` → `preGating`) |
| A repair that fails outright, or exhausts its budget, ends escalated | Task 6 (`escalate` terminus; the never-fixed cap test) |
| Worktree creation failure ends aborted with a reason, not a crash | Task 4 |
| Operational note: errors name the state and attempted edge, not a stack trace | Task 2 (`IllegalStateTransition`, `ProvisioningFailure`), Task 3 (the default arm), Task 4 (abort conversion) |

No gaps.

### 2. Placeholder scan

No "TBD", no "add error handling", no "similar to Task N", no referenced type
that is not defined in a task. Every code step carries the code.

### 3. Type consistency

- `SurfaceLocation { repoPath, worktreePath }` — defined Task 3, used verbatim in
  Tasks 4, 5, 6, 7.
- `provisionWorktree(dir, repoPath, worktreePath, surfaceId)` — defined Task 2,
  called with exactly that order in Task 4.
- `deriveBudgetsFromLog(history, maxima)` — exported Task 1, called in Task 5.
- `terminate(dir, caseFile, location, ports, state, outcome)` — defined Task 4,
  called in Tasks 5 and 6 with the same arity.
- `dispatchGateMaintenance(dir, caseFile, location, ports, reason)` — defined
  Task 5, called in Task 6 with the same arity.
- `sessionKey` is `gate-maintenance-<attempt>-<retryCount>` everywhere (impl in
  Task 5, asserted in Tasks 5 and 6).
- `initTempRepo(prefix, files)` — defined Task 2, used in Tasks 4–7.
- `Terminus` `escalate` always carries `category`; the driver copies it onto the
  entry only for that status, matching `TerminusEntry.category?`.

### 4. Right choice re-audit

| Decision | Pre-planning choice | What the plan does | Easy or Right? |
|---|---|---|---|
| Where `git worktree add` runs | Explicit `SurfaceLocation`, never `process.cwd()` | `SurfaceLocation { repoPath, worktreePath }`, read only while `worktreeRef` is the empty sentinel | Right |
| Ship `run` in slice 1 | No — `advance` only until `AGENT_ACTIVE` has an edge | Out of scope section says so; the demo loops `advance` | Right (a `run` that stopped on an unimplemented state would be scaffolding pretending to be behaviour) |
| Encoding the `GATE_MAINTENANCE` exit so resume can tell it apart | Re-baseline inside the completed-terminus edge; `header.baseline` is the set-once commit that distinguishes it | Task 6 delegates to `preGating` | Right — reuses the authority the spec already grants the header in this segment, adds no synthetic entry type |
| Partial-worktree recovery | Unconditional tear-down-and-recreate | Task 2: `worktree remove --force`, `prune`, `branch -D`, then `add` | Right — one code path, idempotent, matches provisioning.md's "never adopt found state"; a detect-then-branch version would have an untested branch |
| Budget enforcement | Derive from the log, the dispatch entry is the burn | Task 5 derives, checks, then appends | Right — no `incrementBudget` call, no crash window |
| Scope of the `case-file.ts` derivation changes | Only what slice 1 exercises | Task 1 changes the role-aware paths and the `gateMaintenance` count; worker corrections deferred with an explicit Out-of-scope entry | Right — untestable-here changes would be plumbing without a consumer |
| `TriagePort` type with no implementation | Declare the type, defer the router | Task 3 declares it; slice-1 tests pass a rejecting stub that asserts it is never reached | Right — keeps `SurfacePorts` stable across slices, and the stub is itself an assertion |
| Test git-repo fixture location | `src/temp-repo.ts` | Task 2 | Right — `tsconfig` has `rootDir: "src"`, so a fixture in `tests/` could not be imported by a `src` test; three consumers justify one module |
| Closer teardown failure | Catch and log, never re-triage | Task 4's `terminate`, asserted by a test | Right |

No drift. Both lenses hold: the git CLI is shelled out rather than wrapped
(buy-vs-build), and the demo plus the two named errors are the DX story the
slice's Operational note demands.

### 5. Scaffolding drift check

- `docs/single-surface-control-flow.md` `Entry =` block — the `role` field is a
  format change this slice makes; updated in Task 1, the task that makes it. ✓
- `docs/provisioning.md` "Branch naming and collision" open item — settled by
  `branchName`; updated in Task 2, the task that settles it. ✓
- `package.json` `scripts` — the new demo's run story; added in Task 7 alongside
  the demo. ✓
- `src/index.ts` — public surface changes ride with each introducing task
  (Tasks 1, 2, 3). ✓
- Read the other way: the behaviours this slice changes are (a) the
  dispatch/terminus entry format → doc updated; (b) the surface_id → branch
  scheme → doc updated; (c) `gateMaintenance` budget attribution → described
  nowhere outside the design spec (which specifies it, and is not stale); (d) the
  `PROVISIONING`/`PRE_GATING`/`GATE_MAINTENANCE` edges → described by
  `docs/single-surface-control-flow.md` exactly as implemented, no change needed.
  New commands: `npm run demo:surface-slice-1` (Task 7). No new env var, no new
  dependency, no CI change. `README.md` and `CONTRIBUTING.md` document `npm test`
  / `npm run lint` only and list no demo scripts, so neither goes stale. ✓
