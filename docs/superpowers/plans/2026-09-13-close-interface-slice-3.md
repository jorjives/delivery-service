# Close Interface — Slice 3: A Close That Cannot Complete Is Retried, Then Handed to a Person With the Reason

> **Status:** ✅ Complete — 2026-09-13 — `02fed8e`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-11-close-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Goal:** Make a close that cannot complete say precisely why, retry the real closer while close budget remains, escalate with a packet that asks a person to resolve the blocker or choose another close (quoting the closer's own report), and hand triage's repair brief to the closer on an agent-path retry.

**Architecture:** The routing already exists (Item 5): a non-`DONE` close entry routes to `TRIAGE` as `close_failure`, `retry_close` re-enters `CLOSING`, the close budget caps retries, and `resolveEscalationPacket` already quotes the latest close report as evidence. This slice adds substance at three seams and proves the loop end to end with the real `merge-back` closer against real temp repos: (1) `merge-back-closer.ts` tells a genuinely diverged base branch (`FAIL`, "has moved on", names the tip) apart from a checkout whose files block the fast-forward (`ERROR`), where today both are a hedged `FAIL`; (2) `escalation-packet.ts` gives a spent **close** budget its own decision sentence, because "amend the task, or abandon it" is the wrong question about accepted work; (3) `CloseContext` gains optional `repairBrief`, which `closing()` in `surface.ts` reads from the latest `retry_close` triage ref via a helper shared with the existing worker/repair brief lookup. A runnable demo shows the whole loop.

**Tech Stack:** TypeScript (ESM, `node:` builtins only), zod, vitest, system `git` through `src/git-exec.ts` (`execFile`, argv arrays, `cleanGitEnv()`).

## Global Constraints

- **Buy-vs-build (spec's buy-vs-build table):** conflict detection **reuses `git merge --ff-only`'s own no-mutation failure** — no `merge-tree` pre-flight. The only extra git call is a post-failure `merge-base --is-ancestor <base> <branch>` to classify *why* it refused. Git is driven only by `src/git-exec.ts` (`git`, `tryGit`). No new dependency. The repair brief reuses the existing `BriefRef` schema (`src/prompt-assembly.ts`), since `CloseRepairBrief` is `SharpenedBrief`.
- **No shell, ever.** Every git call goes through `git-exec.ts` with an argv array.
- **`FAIL` and `ERROR` keep routing identically to `close_failure`.** No new trigger, budget, router row or verdict (spec: "What this design does not include"). The split is diagnostic only: `FAIL` = a decision could resolve it (history diverged); `ERROR` = the environment is in the way (checkout not on base, files blocking the merge, git errored).
- **A close failure never returns work to a worker.** `close_failure`'s legal verdicts stay `retry_close`, `escalate`, `abort`.
- **`detail` is plain, factual prose** naming the specific cause, never a raw git transcript.
- **Built-in closers ignore `repairBrief`.** It exists for custom closers (Slice 4); no built-in reads it.
- **Operability / DX (slice's Operational note):** the demo simulates a diverged base branch inside its own scratch repository by committing to `main` before the close. No network, no API key, no `claude-mock`, nothing to skip: triage is the deterministic router.
- **Lint:** `typescript-eslint` strict — no non-null assertions (`!`); use guards or `??`.

## Scaffolding Impact

- `docs/configuring-a-role.md` triage verdict table, `retry_close` row ("the same brief shape, kept in the case file") describes behaviour this slice changes: the brief is now also handed to the closer on the retried close → updated in Task 3.
- `package.json` demo script `demo:close-slice-3` → added in Task 4 with the demo it runs.
- The "writing a closer" guide (which will document `CloseContext.repairBrief` and the `FAIL`/`ERROR` convention) is Slice 4's deliverable; no such doc exists yet, so nothing else is stale. `docs/single-surface-control-flow.md` already describes `retry_close` and `CloseRepairBrief` as this slice delivers them.
- No new command beyond the demo script, no env var, no CI step: `make verify` covers the new files, and `tests/typecheck-coverage.test.ts` already pulls every tracked `.ts` file (the new demo and test file included) into the typecheck.

---

### Task 1: Merge-back tells a diverged base branch apart from a blocked checkout

Today a refused fast-forward always reports `FAIL` with a hedge ("either it has moved on … or the checkout has local changes in the way"). The spec classifies divergence as `FAIL` and an environment problem as `ERROR`, and the UAT needs the report to say plainly that `main` has moved on. Verified empirically: with an untracked file in the checkout that the merge would overwrite, `git merge --ff-only` refuses while `git merge-base --is-ancestor main <branch>` still exits 0.

**Files:**
- Modify: `src/merge-back-closer.ts:85-97` (the `!merged` branch)
- Test: `src/merge-back-closer.test.ts` (tighten the existing diverged test, add a blocked-checkout test)

**Interfaces:**
- Consumes: `git(cwd, args): Promise<string>`, `tryGit(cwd, args): Promise<boolean>` from `src/git-exec.js`.
- Produces: no new exports. Report contract later tasks and the demo rely on:
  - diverged: `{ status: "FAIL", detail }` where `detail` contains `"<baseBranch> has moved on"`, the base branch's short tip, and the surface branch name.
  - blocked checkout: `{ status: "ERROR", detail }` where `detail` names the base branch and says files in the checkout are in the way.

- [ ] **Step 1: Write the failing tests**

In `src/merge-back-closer.test.ts`, replace the existing test `"reports a diverged base branch as a refusal, leaving the repo and worktree untouched"` with:

```typescript
  it("reports a diverged base branch as a refusal naming its tip, leaving the repo and worktree untouched", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    writeFileSync(join(repo, "other.txt"), "moved on\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "main moved on"]);
    const tip = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("FAIL");
    expect(report.detail).toContain("main has moved on");
    expect(report.detail).toContain(git(repo, ["rev-parse", "--short", "main"]));
    expect(report.detail).toContain("surface/surface-42");
    // One cause, stated plainly: no hedge about local changes.
    expect(report.detail).not.toMatch(/local changes/i);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(existsSync(tree)).toBe(true);
  });

  it("gives the same refusal when the diverged close is retried, without committing the work twice", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    writeFileSync(join(repo, "other.txt"), "moved on\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "main moved on"]);

    const first = await createMergeBackCloser().close(ctx, accepted);
    const second = await createMergeBackCloser().close(ctx, accepted);

    expect(second).toEqual(first);
    expect(git(repo, ["rev-list", "--count", "main..surface/surface-42"])).toBe("1");
  });

  it("reports files in the checkout that block the fast-forward as an environment error, changing nothing", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    // Untracked in the shared checkout, and in the way of the incoming file.
    writeFileSync(join(repo, "feature.txt"), "someone's scratch file\n");
    const tip = git(repo, ["rev-parse", "main"]);

    const report = await createMergeBackCloser().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("main");
    expect(report.detail).toMatch(/in the way/i);
    expect(report.detail).not.toMatch(/moved on/i);
    // Plain prose, not git's own refusal text.
    expect(report.detail).not.toMatch(/would be overwritten|Aborting/);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(existsSync(tree)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/merge-back-closer.test.ts`
Expected: FAIL — the diverged test fails on `toContain("main has moved on")` (current detail says "Could not fast-forward"), and the blocked-checkout test fails on `toBe("ERROR")` (receives `"FAIL"`). The retry test passes already (idempotence is Slice 1's); it stays as the retry-safety pin for this slice.

- [ ] **Step 3: Implement the classification**

In `src/merge-back-closer.ts`, replace the block from `// The merge is its own conflict probe` through the closing `}` of `if (!merged) { ... }` with:

```typescript
    // The merge is its own conflict probe: --ff-only either advances the ref or
    // refuses, changing nothing either way. Only once it has refused is the
    // reason worth a second call: a base branch that is no longer an ancestor of
    // the surface branch has moved on, which is a decision for a person (FAIL);
    // anything else that stopped a fast-forward the history allows is the
    // checkout itself being in the way (ERROR).
    const merged = await tryGit(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]);
    if (!merged) {
      const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
      const diverged = !(await tryGit(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.baseBranch, ctx.branch]));
      if (diverged) {
        return {
          status: "FAIL",
          detail:
            `${ctx.baseBranch} has moved on since this surface started: it is now at ${tip}, which ${ctx.branch} ` +
            `does not include, so ${ctx.baseBranch} cannot be fast-forwarded onto the work. Nothing was changed and ` +
            `the work is still on ${ctx.branch}. Bring ${ctx.branch} up to date with ${ctx.baseBranch}, or undo the ` +
            `new commits on ${ctx.baseBranch}, and close again; or choose a different close.`,
        };
      }
      return {
        status: "ERROR",
        detail:
          `git would not fast-forward ${ctx.baseBranch} (at ${tip}) onto ${ctx.branch}, although the history allows ` +
          `it: files in the checkout at ${ctx.repoPath} are in the way. Nothing was changed and the work is still on ` +
          `${ctx.branch}. Clear the checkout's uncommitted or untracked files and close again.`,
      };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/merge-back-closer.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/merge-back-closer.ts src/merge-back-closer.test.ts
git commit -m "Tell a diverged base branch apart from a blocked checkout in merge-back

A refused fast-forward was always a hedged FAIL. The spec makes divergence a
FAIL (a person can decide) and a checkout in the way an ERROR (the environment
is broken), and an on-call reader needs the one real cause stated plainly with
the base branch's current tip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A failed close is retried for real, then escalated with a packet about the close

Proves the driver loop with the real `merge-back` closer and real repos, and gives a spent close budget its own decision. The retry/route/evidence plumbing exists; the one production change is the packet's decision sentence, which today tells a person to "amend the task, or abandon it" about work that was already accepted.

**Files:**
- Modify: `src/escalation-packet.ts:62-73` (`decisionFor`, `budget` case)
- Test: `src/escalation-packet.test.ts` (add a close-budget cause), `src/surface-close.test.ts` (create)

**Interfaces:**
- Consumes: `createMergeBackCloser(options?)` (Task 1's report contract); `advance(dir, location, ports): Promise<AdvanceResult>`, `run(dir, location, ports): Promise<RunResult>` from `src/surface.js`; `deterministicRouter` from `src/router.js`; `create(dir, header, budgets)`, `load(dir)`, `readRef(dir, refId)` from `src/case-file.js`; `EscalationPacket` from `src/triage-role-config.js`; `initTempRepo(prefix, files)` from `src/temp-repo.js`.
- Produces:
  - Packet decision for `{ kind: "budget", population: "close", budget: { used, max } }`: `"No close retry budget remains (<used>/<max> used), so the accepted work has not landed. Decide whether to resolve what the closer reports below, such as a base branch that has moved on, and close again, or choose a different close."`
  - `src/surface-close.test.ts` with helpers `toClosing(ports, budgetSet?)` and `worker` that Task 3 appends to.

- [ ] **Step 1: Write the failing unit test for the packet**

In `src/escalation-packet.test.ts`, after the `budget` constant add:

```typescript
const closeBudget = {
  kind: "budget", population: "close", budget: { used: 3, max: 3 }, detail: "no retry remains",
} satisfies EscalationCause;
```

change `const all: EscalationCause[] = [authority, budget, triageFailure, repairGaveUp];` to:

```typescript
const all: EscalationCause[] = [authority, budget, closeBudget, triageFailure, repairGaveUp];
```

and inside `describe("buildEscalationPacket", ...)` add:

```typescript
  it("asks a person to resolve what blocked a close, or choose another, once no close retry remains", () => {
    const { decision } = buildEscalationPacket(closeBudget, facts);

    expect(decision).toBe(
      "No close retry budget remains (3/3 used), so the accepted work has not landed. " +
        "Decide whether to resolve what the closer reports below, such as a base branch that has moved on, " +
        "and close again, or choose a different close.",
    );
    // Accepted work is never sent back into the task.
    expect(decision).not.toMatch(/amend the task|abandon/);
  });
```

- [ ] **Step 2: Write the failing driver tests**

Create `src/surface-close.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, readRef } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import { advance, run, type AdvanceResult } from "./surface.js";
import { deterministicRouter } from "./router.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { EscalationPacket } from "./triage-role-config.js";
import type { AgentContext, AgentPort, SurfaceLocation, SurfacePorts, TriagePort } from "./ports.js";
import type { BudgetSet, GateRef, HistoryEntry } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const BRANCH = "surface/surface-7";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** A worker that writes the feature and completes. Any other role must not be asked. */
const worker: AgentPort = {
  invoke: ((role: { role: string }, ctx: AgentContext) => {
    if (role.role !== "worker") return Promise.reject(new Error(`${role.role} was not expected here`));
    writeFileSync(join(ctx.worktreePath, "feature.txt"), "the feature\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

/**
 * Provision a surface against a fresh repo and advance it until the work is
 * accepted and the close is next, so a test can change the world before it.
 */
async function toClosing(
  ports: SurfacePorts,
  budgetSet: BudgetSet = budgets,
): Promise<{ dir: string; repo: string; location: SurfaceLocation }> {
  const dir = await mkdtemp(join(tmpdir(), "surface-close-case-"));
  const repo = initTempRepo("surface-close-repo-", { "report.tap": PASSING_TAP });
  const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-close-tree-")), "wt") };
  await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef }, budgetSet);
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
  } while (result.state !== "CLOSING" && !result.done);
  expect(result.state).toBe("CLOSING");
  return { dir, repo, location };
}

function moveMainOn(repo: string): void {
  writeFileSync(join(repo, "hotfix.txt"), "someone else's change\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "main moved on"]);
}

async function closeReports(dir: string, history: HistoryEntry[]): Promise<unknown[]> {
  return Promise.all(history.flatMap((e) => (e.t === "close" ? [readRef(dir, e.detailRef)] : [])));
}

async function packetOf(dir: string): Promise<EscalationPacket> {
  const { outcome } = await load(dir);
  expect(outcome?.kind).toBe("escalated");
  return EscalationPacket.parse(await readRef(dir, outcome?.packetRef ?? ""));
}

describe("a close that cannot complete, with the real merge-back closer", () => {
  const ports: SurfacePorts = { agent: worker, triage: deterministicRouter, closer: createMergeBackCloser() };

  it("re-runs the real closer while close budget remains, each retry refusing the same way and changing nothing", async () => {
    const { dir, repo, location } = await toClosing(ports);
    moveMainOn(repo);
    const movedTip = git(repo, ["rev-parse", "main"]);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    const reports = await closeReports(dir, history);
    // The first close plus one retry per close slot.
    expect(reports).toHaveLength(budgets.close.max + 1);
    for (const report of reports) {
      expect(report).toEqual(reports[0]);
      expect(report).toMatchObject({ status: "FAIL" });
    }
    expect(history.filter((e) => e.t === "triage").map((e) => e.t === "triage" && e.verdict)).toEqual([
      "retry_close", "retry_close", "retry_close", "escalate",
    ]);
    expect(git(repo, ["rev-parse", "main"])).toBe(movedTip);
    expect(git(repo, ["rev-list", "--count", `main..${BRANCH}`])).toBe("1");
  });

  it("escalates with the closer's own report as evidence and a decision about the close", async () => {
    const { dir, repo, location } = await toClosing(ports);
    moveMainOn(repo);
    const shortTip = git(repo, ["rev-parse", "--short", "main"]);

    await run(dir, location, ports);

    const packet = await packetOf(dir);
    const { history } = await load(dir);
    const lastReport = (await closeReports(dir, history)).at(-1) as { detail: string };
    expect(packet.evidence).toBe(lastReport.detail);
    expect(packet.evidence).toContain("main has moved on");
    expect(packet.evidence).toContain(shortTip);
    expect(packet.decision).toContain("No close retry budget remains (3/3 used)");
    expect(packet.decision).toContain("choose a different close");
    // Stopped surface tidies up: worktree gone, branch with the work kept.
    expect(existsSync(location.worktreePath)).toBe(false);
    expect(git(repo, ["branch", "--list", BRANCH, "--format=%(refname:short)"])).toBe(BRANCH);
  });

  it("ends closed normally when a retry finds the base branch back in a mergeable state", async () => {
    const { dir, repo, location } = await toClosing(ports);
    const seedTip = git(repo, ["rev-parse", "main"]);
    moveMainOn(repo);
    // Stands in for an operator who undoes the stray commit while the close is being retried.
    let undone = false;
    const operatorUndoes: TriagePort = {
      triage: (input) => {
        if (!undone) {
          git(repo, ["reset", "-q", "--hard", seedTip]);
          undone = true;
        }
        return deterministicRouter.triage(input);
      },
    };

    const result = await run(dir, location, { ...ports, triage: operatorUndoes });

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.reason).toMatch(/Fast-forwarded main/);
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the feature");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "close").map((e) => e.t === "close" && e.status)).toEqual(["FAIL", "DONE"]);
  });

  it.each([
    ["a refusal", "FAIL", moveMainOn],
    ["an environment error", "ERROR", (repo: string) => git(repo, ["checkout", "-q", "-b", "elsewhere"])],
  ] as const)("routes %s to close-failure handling and never back to a worker", async (_kind, status, breakIt) => {
    const { dir, repo, location } = await toClosing(ports);
    breakIt(repo);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "close").every((e) => e.t === "close" && e.status === status)).toBe(true);
    const triages = history.filter((e) => e.t === "triage");
    expect(triages.every((e) => e.t === "triage" && e.trigger === "close_failure")).toBe(true);
    expect(triages.some((e) => e.t === "triage" && e.verdict === "reroute")).toBe(false);
    // The worker ran once, before acceptance, and was never dispatched again.
    expect(history.filter((e) => e.t === "dispatch")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/escalation-packet.test.ts src/surface-close.test.ts`
Expected: FAIL — the new packet test (decision still ends "Decide whether to continue manually, amend the task, or abandon it."), and `"escalates with the closer's own report as evidence and a decision about the close"` on `toContain("choose a different close")`. The retry, retry-success and routing tests are expected to PASS already, once Task 1 is in: they pin, with a real closer, behaviour the spec requires ("a test proves a real closer's FAIL and ERROR both land at close_failure") that Item 5 wired against scripted doubles only. To confirm they can fail, temporarily change `close_failure: { budget: "close", helpful: "retry_close" }` in `src/router.ts` to `helpful: "reroute"`, re-run, see the routing and retry tests fail, then revert.

- [ ] **Step 4: Implement the close-specific decision**

In `src/escalation-packet.ts`, replace the `case "budget":` arm of `decisionFor` with:

```typescript
    case "budget":
      if (cause.population === "close") {
        // The work was already accepted: the question is how to land it, never
        // whether to amend or abandon the task. The closer's report is the evidence.
        return (
          `No close retry budget remains (${cause.budget.used}/${cause.budget.max} used), so the accepted work has not landed. ` +
          "Decide whether to resolve what the closer reports below, such as a base branch that has moved on, " +
          "and close again, or choose a different close."
        );
      }
      return `No ${POPULATION_LABELS[cause.population]} budget remains (${cause.budget.used}/${cause.budget.max} used). Decide whether to continue manually, amend the task, or abandon it.`;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/escalation-packet.test.ts src/surface-close.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/escalation-packet.ts src/escalation-packet.test.ts src/surface-close.test.ts
git commit -m "Ask a person to resolve a blocked close, not to amend the task

A spent close budget produced the generic budget decision, which asks whether
to amend or abandon a task whose work was already accepted. The packet now
asks the reader to resolve what the closer reported or choose a different
close. New driver tests prove, with the real merge-back closer, that a failed
close is retried for real, recovers when the base becomes mergeable, and that
both FAIL and ERROR stay in close-failure handling.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Triage's repair brief reaches the closer on the retried close

**Files:**
- Modify: `src/ports.ts:87-100` (`CloseContext` gains `repairBrief?`; import `CloseRepairBrief` type)
- Modify: `src/surface.ts:268-290` (share the brief lookup), `src/surface.ts:581-599` (`closing()` passes the brief)
- Modify: `docs/configuring-a-role.md:246` (`retry_close` row)
- Test: `src/surface-close.test.ts` (append), `src/merge-back-closer.test.ts` (append), `src/commit-to-branch-closer.test.ts` (append)

**Interfaces:**
- Consumes: `BriefRef` (`z.object({ artifact: SharpenedBrief })`) from `src/prompt-assembly.js`, already imported in `surface.ts`; `readRef`; `createAgentTriage(agent)` from `src/triage.js`; `toClosing`, `worker`, `budgets` from Task 2's test file.
- Produces:
  - `CloseContext.repairBrief?: CloseRepairBrief` in `src/ports.ts`.
  - Private in `surface.ts`: `briefStartedBy(dir, history, verdict: "reroute" | "fix_the_gate" | "retry_close"): Promise<{ artifactRef: string; brief: SharpenedBrief } | undefined>`; `currentBriefRef` becomes a one-line wrapper over it.

- [ ] **Step 1: Write the failing tests**

Append to `src/surface-close.test.ts` (add `createAgentTriage` from `./triage.js`, and `CloseContext`, `TriageTerminus` to the `./ports.js` type import):

```typescript
describe("the repair brief on a retried close", () => {
  const brief = {
    problem: "main moved on under the merge",
    dead_ends: "a plain fast-forward was refused",
    scope: "land the accepted change only",
    references: ["close-0"],
    diagnosis: "rebase the surface branch onto main before merging",
  };

  /** A closer that refuses once, then lands, recording the context each accepted close saw. */
  function recordingCloser(): SurfacePorts["closer"] & { seen: CloseContext[] } {
    const seen: CloseContext[] = [];
    return {
      seen,
      close: (ctx, outcome) => {
        if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
        seen.push(ctx);
        return Promise.resolve(
          seen.length === 1 ? { status: "FAIL", detail: "main has moved on" } : { status: "DONE", detail: "landed" },
        );
      },
    };
  }

  function agentWithTriage(triage: () => Promise<TriageTerminus>): AgentPort {
    return {
      invoke: ((role: { role: string }, ctx: AgentContext) =>
        role.role === "triage" ? triage() : worker.invoke({ role: "worker" }, ctx)) as AgentPort["invoke"],
    };
  }

  it("hands the closer the brief triage's agent wrote for the retry, and none on the first close", async () => {
    const closer = recordingCloser();
    const agent = agentWithTriage(() =>
      Promise.resolve({ status: "retry_close", rationale: "worth one more try", payload: brief }),
    );
    // One close slot: the last slot is where triage's agent is engaged.
    const oneSlot = { ...budgets, close: { used: 0, max: 1 } };
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer };
    const { dir, location } = await toClosing(ports, oneSlot);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(closer.seen).toHaveLength(2);
    expect(closer.seen[0]?.repairBrief).toBeUndefined();
    expect(closer.seen[1]?.repairBrief).toEqual(brief);
  });

  it("hands the closer no brief when the deterministic router ordered the retry", async () => {
    const closer = recordingCloser();
    const ports: SurfacePorts = { agent: worker, triage: deterministicRouter, closer };
    const { dir, location } = await toClosing(ports);

    await run(dir, location, ports);

    expect(closer.seen).toHaveLength(2);
    expect(closer.seen.every((ctx) => !("repairBrief" in ctx))).toBe(true);
  });
});
```

Append inside `describe("the merge-back closer", ...)` in `src/merge-back-closer.test.ts`:

```typescript
  it("behaves the same when handed a repair brief", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    writeFileSync(join(repo, "other.txt"), "moved on\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "main moved on"]);
    const repairBrief = { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "rebase first" };

    const without = await createMergeBackCloser().close(ctx, accepted);
    const withBrief = await createMergeBackCloser().close({ ...ctx, repairBrief }, accepted);

    expect(withBrief).toEqual(without);
  });
```

Append inside `describe("the commit-to-branch closer", ...)` in `src/commit-to-branch-closer.test.ts`:

```typescript
  it("behaves the same when handed a repair brief", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    const repairBrief = { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "commit it" };

    const report = await createCommitToBranchCloser().close({ ...ctx, repairBrief }, accepted);

    expect(report.status).toBe("DONE");
    expect(report.detail).toContain("surface/surface-42");
    expect(git(repo, ["show", "surface/surface-42:feature.txt"])).toBe("the work");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/surface-close.test.ts src/merge-back-closer.test.ts src/commit-to-branch-closer.test.ts`
Expected: FAIL — typecheck-level errors are not enforced by vitest, so the runtime failure is `"hands the closer the brief triage's agent wrote for the retry"`: `closer.seen[1]?.repairBrief` is `undefined`, expected the brief. The deterministic-router and built-in tests pass (they pin that nothing else changes). `npx tsc --noEmit` also fails: `repairBrief` does not exist on type `CloseContext`.

- [ ] **Step 3: Widen `CloseContext`**

In `src/ports.ts`, change the import on line 2 to:

```typescript
import type { CloseRepairBrief, EscalationPacket, SharpenedBrief, TriageEnvelope } from "./triage-role-config.js";
```

and replace the `CloseContext` doc comment and interface with:

```typescript
/**
 * What a closer is given. `worktreePath` and `dir` are this surface's own;
 * `repoPath` is the checkout the worktree was created from and is shared with
 * the operator, which is why a closer may act on it but must never switch its
 * checked-out branch. `branch` is derived from the surface id, and `baseBranch`
 * is the local branch pinned when the surface was provisioned. `repairBrief` is
 * set only on a close retried by triage's agent, which wrote it; a first close
 * and a deterministic retry have none. No built-in closer reads it.
 */
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  repairBrief?: CloseRepairBrief;
}
```

- [ ] **Step 4: Share the brief lookup and thread it into `closing()`**

In `src/surface.ts`, add `SharpenedBrief` to the existing import from `./triage-role-config.js`:

```typescript
import { EscalationPacket, type SharpenedBrief } from "./triage-role-config.js";
```

Replace `currentBriefRef` (and its doc comment) with:

```typescript
/**
 * The brief carried by the latest triage round with `verdict`, or undefined.
 *
 * The latest such round is the one that started the session or close about to
 * run. Its ref carries an artefact only when an agent wrote a brief, so a
 * deterministic verdict's round yields none, never an earlier round's. Derived
 * from the log, so a first run, a retry and a resumed run agree.
 */
async function briefStartedBy(
  dir: string,
  history: HistoryEntry[],
  verdict: "reroute" | "fix_the_gate" | "retry_close",
): Promise<{ artifactRef: string; brief: SharpenedBrief } | undefined> {
  const start = history.findLast((e) => e.t === "triage" && e.verdict === verdict);
  if (start?.t !== "triage") return undefined;
  const ref = BriefRef.safeParse(await readRef(dir, start.artifactRef));
  return ref.success ? { artifactRef: start.artifactRef, brief: ref.data.artifact } : undefined;
}

/**
 * The ref holding the brief for the session about to be dispatched, or undefined.
 * Every worker attempt after the first was started by a `reroute`, and every
 * post-task repair by a `fix_the_gate`. A pre-task repair has no triage entry.
 */
async function currentBriefRef(
  dir: string,
  history: HistoryEntry[],
  role: "worker" | "gate-maintenance",
): Promise<string | undefined> {
  return (await briefStartedBy(dir, history, BRIEFING_VERDICT[role]))?.artifactRef;
}
```

In `closing()`, replace the first line of the body:

```typescript
  const report = await ports.closer.close(closeContextOf(dir, caseFile, location), { kind: "accepted" });
```

with:

```typescript
  // Inlined rather than passed on as a ref: a closer has no later reader to
  // defer to. Only a retry_close round can precede a close, so the latest one
  // is the round that ordered this retry.
  const repairBrief = (await briefStartedBy(dir, caseFile.history, "retry_close"))?.brief;
  const ctx: CloseContext = { ...closeContextOf(dir, caseFile, location), ...(repairBrief ? { repairBrief } : {}) };
  const report = await ports.closer.close(ctx, { kind: "accepted" });
```

and update `closing()`'s doc comment to append: `A close retried by triage's agent is handed the brief it wrote as ctx.repairBrief.`

- [ ] **Step 5: Update the role guide**

In `docs/configuring-a-role.md`, replace the row:

```markdown
| `retry_close` | the close failed | the same brief shape, kept in the case file |
```

with:

```markdown
| `retry_close` | the close failed | the same brief shape, kept in the case file and handed to the closer on the retried close as `repairBrief` (the built-in closers ignore it) |
```

- [ ] **Step 6: Run the tests and typecheck to verify they pass**

Run: `npx vitest run src/surface-close.test.ts src/merge-back-closer.test.ts src/commit-to-branch-closer.test.ts src/surface.test.ts -t "brief|repair|close"`
Expected: PASS (includes the existing brief-dispatch tests in `surface.test.ts` that exercise `currentBriefRef`).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ports.ts src/surface.ts src/surface-close.test.ts src/merge-back-closer.test.ts src/commit-to-branch-closer.test.ts docs/configuring-a-role.md
git commit -m "Hand triage's repair brief to the closer on a retried close

Close-triage's agent could persist a CloseRepairBrief, but nothing ever read
it back. A custom closer can now use the guidance on the retry it was written
for; the brief lookup is shared with the worker and repair dispatch so all
three read a round's brief the same way, and the built-ins ignore it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The close-failure demo

**Files:**
- Create: `demos/close-interface-slice-3-close-failure.ts`
- Modify: `package.json` (add `"demo:close-slice-3": "npx tsx demos/close-interface-slice-3-close-failure.ts"` after `demo:close-slice-2`)

**Interfaces:**
- Consumes: `create`, `load`, `readRef` (`src/case-file.js`); `advance`, `run` (`src/surface.js`); `resolveCloser(ref)` (`src/resolve-closer.js`); `deterministicRouter` (`src/router.js`); `EscalationPacket` (`src/triage-role-config.js`); `initTempRepo`, `cleanGitEnv`; Task 1's `FAIL` detail and Task 2's decision sentence.
- Produces: stdout with headings `--- 1.` to `--- 4.` (the later UAT recording drives these).

- [ ] **Step 1: Write the demo**

Create `demos/close-interface-slice-3-close-failure.ts`:

```typescript
/**
 * UAT demo for Close Interface Slice 3: A Close That Cannot Complete Is
 * Retried, Then Handed to a Person With the Reason.
 *
 * Accepts a surface with the merge-back closer, then commits to main in the
 * same scratch repository before the close runs, so the accepted work can no
 * longer fast-forward. Prints each close attempt, the escalation packet, and
 * the repository afterwards.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip. Triage
 * is the built-in deterministic router, so no agent is involved.
 *
 * Usage: npm run demo:close-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, readRef } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { advance, run, type AdvanceResult } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { deterministicRouter } from "../src/router.js";
import { EscalationPacket } from "../src/triage-role-config.js";
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
const BRANCH = "surface/surface-61";

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

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 3: a close that cannot complete ===\n");
  console.log(`The project names its closer as data: closerRef = ${JSON.stringify(closerRef)}`);
  console.log("Triage is the built-in deterministic router: it retries a failed close while the");
  console.log(`close budget remains (${budgets.close.max} retries), then escalates. Everything happens in a`);
  console.log("scratch repository on this machine; nothing is pushed.\n");

  const repo = initTempRepo("close3-demo-repo-", { "report.tap": PASSING_TAP });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close3-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close3-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId: "surface-61", taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  const ports: SurfacePorts = { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned) };

  // --- Accept the work, stopping just before the close ---
  let step: AdvanceResult;
  do {
    step = await advance(dir, location, ports);
  } while (step.state !== "CLOSING" && !step.done);
  if (step.state !== "CLOSING") throw new Error(`expected the work to be accepted, reached ${step.state}`);

  fs.writeFileSync(path.join(repo, "hotfix.txt"), "a change someone else landed on main\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "Someone else's hotfix"]);
  const movedTip = git(repo, ["rev-parse", "--short", "main"]);

  console.log("--- 1. The work is accepted, then main moves on ---");
  console.log(`The gate accepted the worker's change on ${BRANCH}.`);
  console.log(`Before the close runs, this demo commits a hotfix to main, which is now at ${movedTip}.`);
  console.log(`${BRANCH} does not contain it, so main can no longer be fast-forwarded onto the work.\n`);

  const result = await run(dir, location, ports);
  const caseFile = await load(dir);

  console.log("--- 2. Each close attempt, and what triage did about it ---");
  let attempt = 0;
  for (const entry of caseFile.history) {
    if (entry.t === "close") {
      attempt += 1;
      const report = (await readRef(dir, entry.detailRef)) as { detail?: string };
      console.log(`Close attempt ${attempt}: ${entry.status}: ${report.detail ?? "(no detail)"}`);
    } else if (entry.t === "triage") {
      console.log(`  Triage: ${entry.verdict} (${entry.rationale})`);
    }
  }
  const dispatches = caseFile.history.filter((e) => e.t === "dispatch").length;
  console.log(`\nWorker sessions dispatched in total: ${dispatches} (the accepted work was never sent back).\n`);

  console.log("--- 3. The escalation packet ---");
  console.log(`The surface ran to: ${result.state}`);
  const packet = EscalationPacket.parse(await readRef(dir, caseFile.outcome?.packetRef ?? ""));
  console.log(`Decision:\n  ${packet.decision}`);
  console.log(`Evidence:\n  ${packet.evidence}`);
  console.log(`Already tried:\n  ${packet.dead_ends.split("\n").join("\n  ")}`);
  console.log(`Why now:\n  ${packet.why_now}`);
  console.log(`Sessions to consult: ${packet.references.join(", ")}\n`);

  console.log("--- 4. The repository afterwards ---");
  console.log(`main history:\n  ${git(repo, ["log", "--oneline", "main"]).split("\n").join("\n  ")}`);
  console.log(`main is still at ${git(repo, ["rev-parse", "--short", "main"])}, the hotfix: the harness added nothing to it.`);
  console.log(`Branches now: ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`The accepted work, still on ${BRANCH}: ${git(repo, ["log", "--oneline", `main..${BRANCH}`])}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(location.worktreePath)} (tidied up on escalation; the branch is kept).`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the `"demo:close-slice-2"` line add:

```json
    "demo:close-slice-3": "npx tsx demos/close-interface-slice-3-close-failure.ts",
```

- [ ] **Step 3: Run the demo and check its output**

Run: `npm run demo:close-slice-3`
Expected: exit 0. Section 2 shows four `Close attempt N: FAIL: main has moved on since this surface started: it is now at <movedTip>...` lines, three `Triage: retry_close` and one `Triage: escalate`, and `Worker sessions dispatched in total: 1`. Section 3's decision starts `No close retry budget remains (3/3 used)` and ends `or choose a different close.`; its evidence is the same `main has moved on` sentence. Section 4 shows main's tip is the hotfix, `surface/surface-61` listed with one commit ahead of main, and `Scratch worktree still on disk: false`.

Run: `npx eslint demos/close-interface-slice-3-close-failure.ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add demos/close-interface-slice-3-close-failure.ts package.json
git commit -m "Add the close-failure demo

Slice 3's UAT needs a runnable script showing a close refused because main
moved on, the real closer retried within budget, and the escalation packet an
on-call engineer would act on, with the repository proving main was left
alone and the surface branch kept.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
