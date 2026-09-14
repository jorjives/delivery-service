# Agent Mock — Slice 1: Write an Agent Stand-in the Compiler Checks

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-13-agent-mock-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Goal:** Add `fakeAgentPort(handlers)`, an honest role-typed in-process `AgentPort` double published from a new `src/testing.ts` barrel, move every hand-cast agent double in the harness's tests and demos onto it with no observable change, and make a new `as AgentPort["invoke"]` cast a lint failure.

**Architecture:** `src/agent-port-double.ts` turns a role-keyed handler record (`RoleHandlers`, the same mapped shape `RoleConfigs` uses) into an `AgentPort`; the one structurally unavoidable cast lives inside its dispatch, beside the existing one in `createAgentPort`. `AgentPort` itself is unchanged. `src/testing.ts` re-exports it as the testing seam's public entry point, beside `src/index.ts`. Existing doubles are rewritten onto it; the three demo *decorators* that forward to a real `createAgentPort` simply lose their cast (a forwarding arrow is contextually typed by the generic method, as `demos/single-surface-slice-5-crash-recovery.ts:91` already proves). An ESLint `no-restricted-syntax` rule, with the two owning files exempted, keeps new casts out. A new demo shows the double driving a surface, a missing role failing by name, and a wrong-shaped reply rejected by the real TypeScript compiler.

**Tech Stack:** TypeScript 6 (strict, Node16 ESM), vitest, ESLint flat config with typescript-eslint, `tsx` for demos. The `typescript` compiler API (already a devDependency) for the demo's compile check.

## Global Constraints

- **Buy-vs-build (Build note):** build `fakeAgentPort` over a mapped handler record reusing the `RoleConfigs` shape. No test-double library (no `vitest-mock-extended`, no `sinon`, no `vi.fn` wrappers as the double). `AgentPort`, `RoleTerminusMap`, `SurfacePorts` and `createAgentPort` do not change.
- **Exactly two owned casts:** after this slice, `grep -rn --exclude=invoke-cast-guard.test.ts 'as AgentPort\["invoke"\]' src demos tests` prints exactly two lines: `src/agent-invoke.ts` (`createAgentPort`) and `src/agent-port-double.ts` (`fakeAgentPort`). (The guard's own regression test holds the cast inside a string fixture, which the lint rule does not flag, so the grep excludes it.)
- **Operability / DX (Operational note):** `src/testing.ts` is a new public entry point with the same adopter-facing stability promise as `src/index.ts`. It exports `fakeAgentPort` and the `RoleHandlers` type and nothing else. `src/index.ts` gains no exports and does not change.
- **No new dependency**, runtime or dev. No new CI step: the guard rides the existing `npm run lint` (CI, `make verify`, `.githooks/pre-push`).
- **Observable behaviour preserved:** migrated tests keep their names and assertions; migrated demos print the same output modulo temp paths, commit hashes and timestamps.
- **Messages name the fix, not the mechanism** (house rule from `docs/configuring-a-role.md`). No em-dashes in outward-facing copy (error messages, demo output, CONTRIBUTING).
- **Imports:** tests and demos take `fakeAgentPort` from the public entry point (`./testing.js` / `../src/testing.js`), so the harness dogfoods what adopters import.
- **Every new `.ts` file must be tracked and inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts` enforces it; `src`, `demos`, `tests` are already included).

## Scaffolding Impact

- **Proactive, lint:** `eslint.config.js` gains a `no-restricted-syntax` rule forbidding `as AgentPort["invoke"]` outside `src/agent-invoke.ts` and `src/agent-port-double.ts` → Task 4, with its own regression test `tests/invoke-cast-guard.test.ts`.
- **Proactive, contributor docs:** `CONTRIBUTING.md` "Development" gains a short note that agent doubles are built with `fakeAgentPort` from `src/testing.ts` and that the linter rejects the cast → Task 4.
- **Reactive, stale comments:** the doc comment on `sessionAgent` in `src/surface.test.ts` ("the single cast lives here") describes the old idiom → rewritten in Task 2.
- **Inherited (Operational note):** new public entry point `src/testing.ts` → Task 1, with a test pinning its export list and that `src/index.ts` does not export the double.
- **Run story:** new demo registered as `npm run demo:mock-slice-1` in `package.json` → Task 5. It needs only `node` and `git`, so CI and `make verify` are unchanged.
- `README.md`, `docs/*.md`: none describe hand-written agent doubles or the cast (checked by grep for "double", "cast", "stand-in"); the adopter guide is Slice 5's. No change.

---

### Task 1: The honest double and the public testing entry point ✅ DONE (deliver-slice)

**Files:**
- Create: `src/agent-port-double.ts`, `src/testing.ts`, `src/agent-port-double.test.ts`

**Interfaces:**
- Consumes: `AgentContext`, `AgentPort`, `AgentRole`, `RoleHandle`, `RoleTerminusMap` from `src/ports.ts` (unchanged).
- Produces:
  - `export type RoleHandlers = { [R in AgentRole]?: (ctx: AgentContext) => Promise<RoleTerminusMap[R]> }`
  - `export function fakeAgentPort(handlers: RoleHandlers): AgentPort`
  - A missing role rejects with `Error` whose message is exactly `` `fakeAgentPort was given no reply for the ${role} role: the test must supply a "${role}" handler` ``, e.g. `fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler`.
  - `src/testing.ts` exports exactly `fakeAgentPort` (value) and `RoleHandlers` (type).

- [ ] **Step 1: Write the failing tests**

Create `src/agent-port-double.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as testing from "./testing.js";
import { fakeAgentPort } from "./testing.js";
import * as index from "./index.js";
import type { AgentContext, SurfacePorts } from "./ports.js";

const ctx: AgentContext = { worktreePath: "/w", dir: "/d", sessionKey: "round-1-0" };

describe("fakeAgentPort", () => {
  it("answers each role with that role's own reply, handing it the session's context", async () => {
    const seen: string[] = [];
    const agent = fakeAgentPort({
      worker: (c) => {
        seen.push(`worker:${c.sessionKey}`);
        return Promise.resolve({ status: "completed", rationale: "did the work" });
      },
      "gate-maintenance": (c) => {
        seen.push(`gate-maintenance:${c.sessionKey}`);
        return Promise.resolve({ status: "incomplete", rationale: "hit the turn cap" });
      },
      triage: (c) => {
        seen.push(`triage:${c.sessionKey}`);
        return Promise.resolve({ status: "abort", rationale: "nothing to salvage", payload: { reason: "gone" } });
      },
    });

    expect(await agent.invoke({ role: "worker" }, ctx)).toEqual({ status: "completed", rationale: "did the work" });
    expect(await agent.invoke({ role: "gate-maintenance" }, ctx)).toEqual({ status: "incomplete", rationale: "hit the turn cap" });
    expect(await agent.invoke({ role: "triage" }, ctx)).toEqual({
      status: "abort",
      rationale: "nothing to salvage",
      payload: { reason: "gone" },
    });
    expect(seen).toEqual(["worker:round-1-0", "gate-maintenance:round-1-0", "triage:round-1-0"]);
  });

  it("needs a reply only for the roles a test exercises, and fits wherever an agent port is expected", async () => {
    // No cast: the double is assignable to the driver's agent port as it stands.
    const agent: SurfacePorts["agent"] = fakeAgentPort({
      worker: () => Promise.resolve({ status: "completed", rationale: "one reply is enough" }),
    });

    expect(await agent.invoke({ role: "worker" }, ctx)).toEqual({ status: "completed", rationale: "one reply is enough" });
  });

  it("fails naming a role it was given no reply for, and says the test must supply it", async () => {
    const agent = fakeAgentPort({
      worker: () => Promise.resolve({ status: "completed", rationale: "unused" }),
    });

    await expect(agent.invoke({ role: "triage" }, ctx)).rejects.toThrow(
      'fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler',
    );
    await expect(fakeAgentPort({}).invoke({ role: "gate-maintenance" }, ctx)).rejects.toThrow(
      'fakeAgentPort was given no reply for the gate-maintenance role: the test must supply a "gate-maintenance" handler',
    );
  });

  it("rejects, at compile time, a worker reply shaped like a triage verdict", () => {
    // Checked by `npm run lint` (tsc): if the double stopped correlating a role
    // with its own reply shape, this directive would be unused and tsc would fail.
    const build = () =>
      fakeAgentPort({
        // @ts-expect-error a worker cannot reply with triage's reroute verdict
        worker: () =>
          Promise.resolve({
            status: "reroute",
            rationale: "worth one more attempt",
            payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
          }),
      });
    expect(build).toBeTypeOf("function");
  });
});

describe("the public testing entry point", () => {
  it("publishes the honest double and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual(["fakeAgentPort"]);
  });

  it("leaves the main entry point unchanged", () => {
    expect(Object.keys(index)).not.toContain("fakeAgentPort");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent-port-double.test.ts`
Expected: FAIL, "Failed to resolve import ./testing.js" (the module does not exist).

- [ ] **Step 3: Write the double**

Create `src/agent-port-double.ts`:

```typescript
import type { AgentContext, AgentPort, AgentRole, RoleHandle, RoleTerminusMap } from "./ports.js";

/**
 * One optional reply function per role, keyed the way `RoleConfigs` keys a
 * role's pinned configuration. Each function must return that role's own
 * terminus, so a worker reply shaped like a triage verdict does not compile.
 */
export type RoleHandlers = { [R in AgentRole]?: (ctx: AgentContext) => Promise<RoleTerminusMap[R]> };

/**
 * An in-process `AgentPort` for tests and demos, built from the replies a test
 * exercises. It runs nothing below `AgentPort.invoke`: no prompt assembly, no
 * envelope validation, no SDK. Invoking a role with no reply rejects, naming
 * the role, so a test cannot pass by reaching a role it never scripted.
 */
export function fakeAgentPort(handlers: RoleHandlers): AgentPort {
  const run = (roleCfg: RoleHandle, ctx: AgentContext) => {
    const handler = handlers[roleCfg.role];
    if (!handler) {
      return Promise.reject(
        new Error(
          `fakeAgentPort was given no reply for the ${roleCfg.role} role: the test must supply a "${roleCfg.role}" handler`,
        ),
      );
    }
    return handler(ctx);
  };
  // One cast, for the same reason as createAgentPort's: TypeScript cannot
  // correlate `handlers[role]`'s reply type with RoleTerminusMap[R] across a
  // generic key. RoleHandlers pins that mapping for every caller.
  return { invoke: run as AgentPort["invoke"] };
}
```

Create `src/testing.ts`:

```typescript
/**
 * The harness's public testing entry point, the testing seam's counterpart to
 * `index.ts`, with the same stability promise to adopters. Only the testing API
 * is exported from here; nothing else in `src/` becomes public through it.
 */
export { fakeAgentPort } from "./agent-port-double.js";
export type { RoleHandlers } from "./agent-port-double.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agent-port-double.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the compile-time test is load-bearing**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Then delete the single line `// @ts-expect-error a worker cannot reply with triage's reroute verdict` from `src/agent-port-double.test.ts` and run `npx tsc --noEmit` again.
Expected: `error TS2322` on the `worker:` line, ending `Type '"reroute"' is not assignable to type '"incomplete"'`.
Restore the line exactly, and re-run `npx tsc --noEmit`: exit 0.

- [ ] **Step 6: Lint the new files**

Run: `npx eslint src/agent-port-double.ts src/agent-port-double.test.ts src/testing.ts`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/agent-port-double.ts src/agent-port-double.test.ts src/testing.ts
git commit -m "Add fakeAgentPort, an agent double the compiler checks per role

Every in-process AgentPort double cast to AgentPort[\"invoke\"], which
switches off the role-to-reply correlation the generic exists for: a worker
double returning a triage verdict type-checked silently. A role-keyed
handler record, the shape RoleConfigs already uses, keeps that check at the
call site and fails loudly for a role the test did not supply. It is
published from a new src/testing.ts entry point so adopters can use it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The harness's unit tests use the honest double ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/surface.test.ts:19,35-58` (`sessionAgent`, `unusedAgent`, imports)
- Modify: `src/surface-close.test.ts:17,36-43,196-201` (`worker`, `agentWithTriage`, imports)
- Modify: `src/triage.test.ts:3,33-47` (`triageAgent`, `forbiddenAgent`, imports)

**Interfaces:**
- Consumes: `fakeAgentPort(handlers: RoleHandlers): AgentPort` from `./testing.js` (Task 1).
- Produces: nothing new. Helper names and signatures (`sessionAgent`, `unusedAgent`, `scriptedAgent`, `worker`, `agentWithTriage`, `triageAgent`, `forbiddenAgent`) stay as they are, so no call site changes.

This task is a refactor with a behaviour lock: the three suites must pass with the same test count before and after.

- [ ] **Step 1: Record the green baseline**

Run: `npx vitest run src/surface.test.ts src/surface-close.test.ts src/triage.test.ts`
Expected: PASS. Note the "Tests N passed" count (and any skipped count; `surface.test.ts` has `claude-mock`-gated tests). Both must be identical in Step 5.

- [ ] **Step 2: Rewrite the doubles in `src/surface.test.ts`**

Add to the imports (after the `./on-path.js` import):

```typescript
import { fakeAgentPort } from "./testing.js";
```

Replace lines 35-58 (the `sessionAgent` doc comment and function, and `unusedAgent`) with:

```typescript
/**
 * Build an agent port from one function for both worker-kind roles (it is told
 * which), and an optional triage function. A role with no function rejects,
 * naming the role.
 */
function sessionAgent(
  worker: (role: "worker" | "gate-maintenance", ctx: AgentContext) => Promise<Terminus>,
  triage?: (ctx: AgentContext) => Promise<TriageTerminus>,
): AgentPort {
  return fakeAgentPort({
    worker: (ctx) => worker("worker", ctx),
    "gate-maintenance": (ctx) => worker("gate-maintenance", ctx),
    triage,
  });
}

/** An agent that must never be called in this scenario. */
function unusedAgent(): SurfacePorts["agent"] {
  return fakeAgentPort({});
}
```

- [ ] **Step 3: Rewrite the doubles in `src/surface-close.test.ts`**

Add to the imports (after the `./triage-role-config.js` import):

```typescript
import { fakeAgentPort } from "./testing.js";
```

Replace lines 36-43 (the `worker` constant) with:

```typescript
/** Writes the feature and completes. */
function writeFeature(ctx: AgentContext): Promise<Terminus> {
  writeFileSync(join(ctx.worktreePath, "feature.txt"), "the feature\n");
  return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
}

/** A worker that writes the feature and completes. Any other role must not be asked. */
const worker: AgentPort = fakeAgentPort({ worker: writeFeature });
```

Replace the `agentWithTriage` function (lines 196-201) with:

```typescript
  function agentWithTriage(triage: () => Promise<TriageTerminus>): AgentPort {
    return fakeAgentPort({ worker: writeFeature, triage });
  }
```

Add `Terminus` to the `./ports.js` type import on line 17.

- [ ] **Step 4: Rewrite the doubles in `src/triage.test.ts`**

Add to the imports (after the `./triage-role-config.js` import):

```typescript
import { fakeAgentPort } from "./testing.js";
```

Replace lines 33-47 (`triageAgent` and `forbiddenAgent`) with:

```typescript
/** An agent port that answers triage with `reply` and records every call. */
function triageAgent(reply: TriageTerminus): AgentPort & { calls: AgentContext[] } {
  const calls: AgentContext[] = [];
  const agent = fakeAgentPort({
    triage: (c) => {
      calls.push(c);
      return Promise.resolve(reply);
    },
  });
  return Object.assign(agent, { calls });
}

/** An agent port that fails the test if it is called at all. */
const forbiddenAgent: AgentPort = fakeAgentPort({});
```

- [ ] **Step 5: Run the three suites and compare with the baseline**

Run: `npx vitest run src/surface.test.ts src/surface-close.test.ts src/triage.test.ts`
Expected: PASS with exactly the passed and skipped counts recorded in Step 1.

- [ ] **Step 6: Type-check, lint, and confirm the casts are gone from `src/` tests**

Run: `npx tsc --noEmit && npx eslint src/surface.test.ts src/surface-close.test.ts src/triage.test.ts`
Expected: exit 0. If ESLint reports an import that is now unused (for example `RoleHandle`), remove it and re-run.

Run: `grep -n 'as AgentPort\["invoke"\]' src/*.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/surface.test.ts src/surface-close.test.ts src/triage.test.ts
git commit -m "Build the unit tests' agent doubles with fakeAgentPort

The surface, close and triage suites each hand-cast their agent doubles,
so a reply of the wrong shape for a role would still compile. Building
them on the honest double restores that check with no change to what the
tests assert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The demos use the honest double ✅ DONE (deliver-slice)

**Files:**
- Modify (stand-ins moved to `fakeAgentPort`):
  - `demos/single-surface-slice-1-provisioning.ts:19,39-56`
  - `demos/single-surface-slice-2-happy-path.ts:18,37-43`
  - `demos/single-surface-slice-3-setbacks.ts:19-27,47-68`
  - `demos/single-surface-slice-4-budgets.ts:21-29,100-103,134-143`
  - `demos/single-surface-slice-5-crash-recovery.ts:21-28,101-104,194-208`
  - `demos/close-interface-slice-1-merge-back.ts:24,43-49`
  - `demos/close-interface-slice-2-branch-and-teardown.ts:25,44-68`
  - `demos/close-interface-slice-3-close-failure.ts:26,46-52`
  - `demos/close-interface-slice-4-custom-closer.ts:24,61-67`
  - `demos/close-interface-slice-5-open-pr.ts:27,46-52`
- Modify (decorators over a real `createAgentPort`, cast removed only):
  - `demos/triage-slice-1-informed-retry.ts:135-140`
  - `demos/triage-slice-2-escalation-packets.ts:123-128`
  - `demos/triage-slice-3-last-attempt.ts:129-134`

**Interfaces:**
- Consumes: `fakeAgentPort(handlers: RoleHandlers): AgentPort` from `../src/testing.js` (Task 1).
- Produces: nothing new; demo output unchanged.

Rule applied to every stand-in: supply a reply only for the roles that stand-in actually served. A stand-in that ignored its role argument but is only ever reached as a worker gets `worker` only; one that served "whatever the role" in a scenario that dispatches repair sessions gets both `worker` and `gate-maintenance`. Triage is never supplied by a stand-in returning a `Terminus`: those demos use `deterministicRouter`, which never invokes the agent's triage role, and a `Terminus` is not a triage reply (that mismatch is exactly what the old cast hid). Step 1's baseline and Step 5's diff catch any role that turns out to be reached.

- [ ] **Step 1: Capture every affected demo's output before changing anything**

```bash
BASE="${TMPDIR:-/tmp}/agent-mock-slice-1-demos"
rm -rf "$BASE" && mkdir -p "$BASE/before" "$BASE/after"
for d in surface-slice-1 surface-slice-2 surface-slice-3 surface-slice-4 surface-slice-5 \
         close-slice-1 close-slice-2 close-slice-3 close-slice-4 close-slice-5 \
         triage-slice-1 triage-slice-2 triage-slice-3; do
  npm run --silent "demo:$d" > "$BASE/before/$d.txt" 2>&1; echo "$d exit $?"
done
```

Expected: every demo exits 0. The triage demos need `claude-mock` on `PATH`; if it is absent they print their skip notice, in which case they are covered only by type-checking in Step 4 (say so in the task report).

- [ ] **Step 2: Move the single-surface demos' stand-ins**

In each of the five `demos/single-surface-slice-*.ts` files add, after the last `../src/...` value import:

```typescript
import { fakeAgentPort } from "../src/testing.js";
```

`demos/single-surface-slice-1-provisioning.ts`: slice 1 stops at `AGENT_ACTIVE`, so only repair sessions are ever dispatched. Replace lines 39-56 (`idleAgent`, `repairingAgent`, `uselessAgent`) with:

```typescript
/** Never called: this project's gate runs fine. */
const idleAgent: AgentPort = fakeAgentPort({});

/** Writes the missing report file, so the next baseline succeeds. */
const repairingAgent: AgentPort = fakeAgentPort({
  "gate-maintenance": (ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "report.tap"), PASSING_TAP);
    return Promise.resolve({ status: "completed", rationale: "restored the missing report.tap" });
  },
});

/** Claims success every time but never actually fixes anything. */
const uselessAgent: AgentPort = fakeAgentPort({
  "gate-maintenance": () => Promise.resolve({ status: "completed", rationale: "claims to have fixed it" }),
});
```

`demos/single-surface-slice-2-happy-path.ts`: replace lines 37-43 (`cleanWorker`) with:

```typescript
/** Adds a file to the worktree and leaves the gate passing. */
const cleanWorker: AgentPort = fakeAgentPort({
  worker: (ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the change\n");
    return Promise.resolve({ status: "completed", rationale: "added the feature" });
  },
});
```

`demos/single-surface-slice-3-setbacks.ts`: replace the body of `agentOf` (lines 54-68, from `): AgentPort {` to the closing `}`) with:

```typescript
): AgentPort {
  let i = 0;
  return fakeAgentPort({
    worker: (ctx) => {
      const step = workerSteps[Math.min(i, workerSteps.length - 1)];
      i += 1;
      if (!step) throw new Error("no worker step scripted");
      return Promise.resolve(step(ctx.worktreePath));
    },
    "gate-maintenance": repair && ((ctx) => Promise.resolve(repair(ctx.worktreePath))),
  });
}
```

`demos/single-surface-slice-4-budgets.ts`: replace `alwaysWorker` (lines 100-103) with:

```typescript
/** A stand-in that gives the same reply to every worker and repair session. */
function alwaysWorker(terminus: Terminus): AgentPort {
  const reply = () => Promise.resolve(terminus);
  return fakeAgentPort({ worker: reply, "gate-maintenance": reply });
}
```

and replace the inline agent in the gate-repair scenario (lines 135-143, `agent: { invoke: ... },`) with:

```typescript
      agent: fakeAgentPort({
        worker: (ctx) => {
          fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
          return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
        },
        "gate-maintenance": () => Promise.resolve({ status: "completed", rationale: "repaired nothing" }),
      }),
```

`demos/single-surface-slice-5-crash-recovery.ts`: replace `always` (lines 101-104) with:

```typescript
/** A stand-in that gives the same reply to every worker and repair session. */
function always(terminus: Terminus): SurfacePorts["agent"] {
  const reply = () => Promise.resolve(terminus);
  return fakeAgentPort({ worker: reply, "gate-maintenance": reply });
}
```

and replace the inline agent (lines 194-208, `agent: { invoke: ... },`) with:

```typescript
        agent: fakeAgentPort({
          worker: (ctx) => {
            fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
            return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
          },
          // Every repair session ends without a result, so the killed one and
          // a returned one leave the same history. A killed session whose
          // scripted result WOULD have resolved is a different history by
          // construction — it loses that session's consequences — and no
          // resume can conjure them back; the guarantee is that a crash
          // repeats nothing and loses nothing already recorded.
          "gate-maintenance": () => Promise.resolve({ status: "incomplete", rationale: "the repair session hit its cap" }),
        }),
```

Leave the crash-injecting wrapper at lines 88-98 as it is: it forwards to another port without a cast and is already type-checked.

- [ ] **Step 3: Move the close demos' stand-ins, and uncast the triage decorators**

In each of the five `demos/close-interface-slice-*.ts` files add, after the last `../src/...` value import:

```typescript
import { fakeAgentPort } from "../src/testing.js";
```

In `close-interface-slice-1-merge-back.ts`, `-3-close-failure.ts`, `-4-custom-closer.ts` and `-5-open-pr.ts`, replace the `workingAgent` constant with the following (keep each file's existing doc comment above it):

```typescript
const workingAgent: AgentPort = fakeAgentPort({
  worker: (ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  },
});
```

In `close-interface-slice-2-branch-and-teardown.ts`, replace `workingAgent` the same way, and replace `stuckAgent` (lines 57-68, keeping its doc comment) with:

```typescript
const stuckAgent: AgentPort = fakeAgentPort({
  worker: (ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "half-done.txt"), "as far as I got\n");
    git(ctx.worktreePath, ["add", "-A"]);
    git(ctx.worktreePath, ["commit", "-m", "as far as I got"]);
    return Promise.resolve({
      status: "escalate",
      category: "authority",
      rationale: "Finishing this needs the deploy key, which I do not hold.",
    });
  },
});
```

In the three triage demos the agent is a decorator counting triage calls over a real `createAgentPort`; a forwarding arrow is contextually typed by `AgentPort`'s generic method, so it needs no cast. In `demos/triage-slice-1-informed-retry.ts` replace lines 135-140 with:

```typescript
  const counting: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageAgentCalls += 1;
      return inner.invoke(roleCfg, ctx);
    },
  };
```

In `demos/triage-slice-2-escalation-packets.ts` replace lines 123-128 with:

```typescript
  const agent: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageCalls += 1;
      return inner.invoke(roleCfg, ctx);
    },
  };
```

In `demos/triage-slice-3-last-attempt.ts` replace lines 129-134 with:

```typescript
  const agent: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") agentRounds.add(ctx.sessionKey);
      return inner.invoke(roleCfg, ctx);
    },
  };
```

- [ ] **Step 4: Type-check and lint the demos**

Run: `npx tsc --noEmit && npx eslint demos`
Expected: exit 0. ESLint will report type imports made unused by Steps 2-3 (typically `AgentContext` and `RoleHandle`, and `AgentPort` where the file no longer names it); remove exactly those names from the `../src/ports.js` type import and re-run until clean.

Run: `grep -rn 'as AgentPort\["invoke"\]' demos`
Expected: no output.

- [ ] **Step 5: Re-run every affected demo and diff against the baseline**

```bash
BASE="${TMPDIR:-/tmp}/agent-mock-slice-1-demos"
norm() { sed -E "s#${TMPDIR:-/tmp}[^ \"',:)]*#<tmp>#g; s#/tmp/[^ \"',:)]*#<tmp>#g; s/\b[0-9a-f]{7,40}\b/<sha>/g; s/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/<time>/g" "$1"; }
for d in surface-slice-1 surface-slice-2 surface-slice-3 surface-slice-4 surface-slice-5 \
         close-slice-1 close-slice-2 close-slice-3 close-slice-4 close-slice-5 \
         triage-slice-1 triage-slice-2 triage-slice-3; do
  npm run --silent "demo:$d" > "$BASE/after/$d.txt" 2>&1; echo "$d exit $?"
  diff <(norm "$BASE/before/$d.txt") <(norm "$BASE/after/$d.txt") && echo "$d unchanged"
done
```

Expected: every demo exits 0 and prints "unchanged". Any remaining diff is a regression, most likely a role the stand-in no longer serves (the output then contains `fakeAgentPort was given no reply for the ... role`): add that role's reply from the original code and re-run.

- [ ] **Step 6: Commit**

```bash
git add demos
git commit -m "Build the demos' agent stand-ins with fakeAgentPort

Every demo copied the cast idiom, so each new demo taught it again and
none of them had its replies checked against the role. The stand-ins now
use the honest double, and the three triage-counting decorators drop a
cast they never needed; every demo prints what it printed before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: A new cast fails lint ✅ DONE (deliver-slice)

**Files:**
- Create: `tests/invoke-cast-guard.test.ts`
- Modify: `eslint.config.js`, `CONTRIBUTING.md` ("Development" section)

**Interfaces:**
- Consumes: `REPO_ROOT` from `tests/helpers.ts`; the `ESLint` class from the installed `eslint` package; `src/agent-invoke.ts` and `src/agent-port-double.ts` (Task 1) as the two exempt paths.
- Produces: an ESLint `no-restricted-syntax` error on any `x as AgentPort["invoke"]` outside the two exempt files, with the message below.

- [ ] **Step 1: Write the failing test**

Create `tests/invoke-cast-guard.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { REPO_ROOT } from "./helpers.js";

// Linted as if it were the named file's content, through the project's own
// ESLint config. The paths must be real files so the type-aware parser accepts them.
const CAST = `import type { AgentPort } from "./ports.js";
export const agent: AgentPort = { invoke: (() => Promise.reject(new Error("x"))) as AgentPort["invoke"] };
`;

async function castFindings(filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(CAST, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("the agent port cast guard", () => {
  it("fails lint for a cast to the agent port's invoke signature in a test", async () => {
    expect(await castFindings("src/surface.test.ts")).toEqual([
      'Build agent doubles with fakeAgentPort from src/testing.ts: a cast to AgentPort["invoke"] lets a reply of the wrong shape for its role compile.',
    ]);
  }, 60_000);

  it("fails lint for the same cast in a demo", async () => {
    expect(await castFindings("demos/single-surface-slice-2-happy-path.ts")).toHaveLength(1);
  }, 60_000);

  it("allows the cast only where the two agent ports dispatch", async () => {
    expect(await castFindings("src/agent-invoke.ts")).toEqual([]);
    expect(await castFindings("src/agent-port-double.ts")).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/invoke-cast-guard.test.ts`
Expected: FAIL: the first two tests receive `[]` / length 0 (no rule configured yet); the third passes. (Verified during planning: with the rule added, all three pass and `npx eslint .` on the pre-migration tree reports 22 errors, one per cast Tasks 2 and 3 remove.)

- [ ] **Step 3: Add the rule**

In `eslint.config.js`, insert this config object between the `languageOptions` object and the `ignores` object:

```javascript
  {
    // createAgentPort and fakeAgentPort own the only two casts the generic
    // AgentPort contract forces; anywhere else the cast hides a wrong reply.
    ignores: ["src/agent-invoke.ts", "src/agent-port-double.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression > TSIndexedAccessType[objectType.typeName.name='AgentPort'][indexType.literal.value='invoke']",
          message:
            'Build agent doubles with fakeAgentPort from src/testing.ts: a cast to AgentPort["invoke"] lets a reply of the wrong shape for its role compile.',
        },
      ],
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/invoke-cast-guard.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the repository itself is clean under the rule**

Run: `npx eslint .`
Expected: exit 0 (Tasks 2 and 3 removed every other cast).

Run: `grep -rn --exclude=invoke-cast-guard.test.ts 'as AgentPort\["invoke"\]' src demos tests`
Expected: exactly two lines, one in `src/agent-invoke.ts` and one in `src/agent-port-double.ts`. (Without the exclude, a third line appears: the string fixture `CAST` in `tests/invoke-cast-guard.test.ts`, which is text, not a cast.)

- [ ] **Step 6: Tell contributors**

In `CONTRIBUTING.md`, under "## Development", after the paragraph about `claude-mock`, add:

```markdown
To stand in for an agent in a test or demo, build the double with `fakeAgentPort` from
`src/testing.ts`, supplying a reply only for the roles the test exercises. Each reply is
type-checked against its role, and a role with no reply fails the test by name. Do not cast
to `AgentPort["invoke"]`: the linter rejects it, because the cast lets a reply of the wrong
shape compile.
```

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js tests/invoke-cast-guard.test.ts CONTRIBUTING.md
git commit -m "Reject new AgentPort invoke casts in lint

With every double moved onto fakeAgentPort, the cast is only needed where
createAgentPort and fakeAgentPort dispatch. A lint rule keeps it there, so
the next demo or test cannot quietly reintroduce an unchecked double, and
CONTRIBUTING says what to use instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The honest-double demo ✅ DONE (deliver-slice)

**Files:**
- Create: `demos/agent-mock-slice-1-honest-double.ts`
- Modify: `package.json` (add `demo:mock-slice-1` after `demo:close-slice-5`)

**Interfaces:**
- Consumes: `fakeAgentPort` from `../src/testing.js` (Task 1); `create`, `load` from `../src/case-file.js`; `initTempRepo(prefix, files)` from `../src/temp-repo.js`; `run(dir, location, ports): Promise<RunResult>` from `../src/surface.js`; `deterministicRouter` from `../src/router.js`; `noopCloser` from `../src/ports.js`; the `typescript` compiler API.
- Produces: `npm run demo:mock-slice-1`, printing three sections headed `--- 1. `, `--- 2. `, `--- 3. ` (the `sectionOf` convention in `tests/helpers.ts`). Section 1 contains `The surface ran to: CLOSED`; section 2 contains the missing-role message from Task 1; section 3 contains `error TS2322` and `Type '"reroute"' is not assignable`.

- [ ] **Step 1: Write the demo**

Create `demos/agent-mock-slice-1-honest-double.ts`:

```typescript
/**
 * UAT demo for Agent Mock Slice 1: Write an Agent Stand-in the Compiler Checks.
 *
 * 1. Drives a real surface (real temp git repo, real command gate) to its
 *    decision with a stand-in worker built from a single reply.
 * 2. Asks the same stand-in for a role it was given no reply for.
 * 3. Compiles, with the project's own TypeScript settings, a stand-in whose
 *    worker replies with a triage verdict, and prints what the compiler says.
 *
 * No network, no API key, no claude-mock.
 *
 * Usage: npm run demo:mock-slice-1
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import { fakeAgentPort } from "../src/testing.js";
import type { SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const REPO_ROOT = path.join(import.meta.dirname, "..");

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

/** The stand-in the demo would like to write, and the compiler refuses. */
const WRONG_SHAPE = `import { fakeAgentPort } from "../src/testing.js";

export const agent = fakeAgentPort({
  worker: () =>
    Promise.resolve({
      status: "reroute",
      rationale: "worth one more attempt",
      payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
    }),
});
`;

/**
 * Type-check `source` as if it were a file in `demos/`, under tsconfig.json,
 * without writing it to disk. Returns tsc-style diagnostic lines.
 */
function compile(source: string): string[] {
  const virtual = path.join(REPO_ROOT, "demos", "wrong-shaped-stand-in.ts");
  const configPath = ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const { options } = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, REPO_ROOT);
  const host = ts.createCompilerHost(options);
  const readFromDisk = host.getSourceFile.bind(host);
  host.fileExists = (file) => file === virtual || ts.sys.fileExists(file);
  host.getSourceFile = (file, language, ...rest) =>
    file === virtual ? ts.createSourceFile(file, source, language) : readFromDisk(file, language, ...rest);
  const program = ts.createProgram([virtual], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(virtual)).map((d) => {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `wrong-shaped-stand-in.ts line ${line}: error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n  ")}`;
  });
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 1: an agent stand-in the compiler checks ===\n");

  console.log("--- 1. A surface driven to its decision by a stand-in worker ---");
  console.log("The stand-in supplies one reply, for the worker role, and no cast:\n");
  console.log("  fakeAgentPort({ worker: (ctx) => { write feature.txt; reply completed } })\n");
  const agent = fakeAgentPort({
    worker: (ctx) => {
      fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
      return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock1-demo-case-"));
  const repoPath = initTempRepo("mock1-demo-repo-", { "report.tap": PASSING_TAP });
  const location: SurfaceLocation = {
    repoPath,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mock1-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId: "surface-1", taskDef: { intent: "add the feature" }, gateRef }, budgets);
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: noopCloser };
  const result = await run(dir, location, ports);
  const worker = (await load(dir)).history.filter((e) => e.t === "terminus");
  console.log(`The surface ran to: ${result.state}`);
  console.log(`Worker sessions:    ${worker.length}`);
  console.log(`Outcome:            ${result.outcome?.kind ?? "none"}\n`);

  console.log("--- 2. The same stand-in asked for a role it was given no reply for ---");
  try {
    await agent.invoke({ role: "triage" }, { worktreePath: location.worktreePath, dir, sessionKey: "triage-1-0" });
    console.log("Unexpected: the triage role answered.");
  } catch (err) {
    console.log(`The test fails with: ${(err as Error).message}\n`);
  }

  console.log("--- 3. A stand-in whose worker replies with a triage verdict ---");
  console.log("Source handed to the TypeScript compiler, with this project's tsconfig.json:\n");
  console.log(WRONG_SHAPE.replace(/^/gm, "  "));
  const diagnostics = compile(WRONG_SHAPE);
  console.log(diagnostics.length > 0 ? "The compiler reports:\n" : "Unexpected: it compiled.\n");
  for (const line of diagnostics) console.log(`  ${line}`);
  console.log("\nIt is a compile error, not a passing run: the stand-in never gets to run.");
}

await main();
```

- [ ] **Step 2: Register the demo**

In `package.json`, after the `"demo:close-slice-5"` line, add:

```json
    "demo:mock-slice-1": "npx tsx demos/agent-mock-slice-1-honest-double.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:mock-slice-1`
Expected, exit 0, and:
- section `--- 1.` prints `The surface ran to: CLOSED`, `Worker sessions:    1` and `Outcome:            closed`;
- section `--- 2.` prints `The test fails with: fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler`;
- section `--- 3.` prints the source, then a line containing `error TS2322`, and further down `Type '"reroute"' is not assignable to type '"incomplete"'`.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint demos/agent-mock-slice-1-honest-double.ts`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demos/agent-mock-slice-1-honest-double.ts package.json
git commit -m "Add a demo of the agent stand-in the compiler checks

A reviewer needs to see the three things the honest double promises
without reading the tests: a surface driven to its decision by a one-reply
stand-in, a missing role failing by name, and a wrong-shaped reply
rejected by the real compiler rather than described.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
