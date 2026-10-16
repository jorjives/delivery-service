import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { advance, run } from "./surface.js";
import { stepView } from "./workflow-step.js";
import { create, deriveBudgetsFromLog, load } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
import { ensureCommitted } from "./git-exec.js";
import { deterministicRouter } from "./router.js";
import { fakeAgentPort } from "./testing.js";
import { cleanGitEnv } from "./git-env.js";
import type { AgentContext, CloserPort, SurfacePorts, Terminus } from "./ports.js";
import type { BudgetSet, GateReport, GateRef, PinnedWorkflow } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 }, gateError: { used: 0, max: 3 }, gateMaintenance: { used: 0, max: 2 }, terminus: { used: 0, max: 5 }, close: { used: 0, max: 3 },
};
const projectGate: GateRef = { type: "command", command: "test -f BUILT.md", parseMode: "exitcode", checkOnly: true };
const planGate: GateRef = { type: "command", command: "test -f PLAN.md", parseMode: "exitcode", checkOnly: true };
const workflow: PinnedWorkflow = {
  name: "plan-then-build",
  steps: [{ name: "plan", prompt: "write PLAN.md", gateRef: planGate }, { name: "build", prompt: "carry out PLAN.md" }],
};

function countingCloser(): CloserPort & { calls: string[] } {
  const calls: string[] = [];
  return { calls, close: async (_ctx, outcome) => { calls.push(outcome.kind); return { status: "DONE", detail: "landed" }; } };
}

const write = (file: string) => (ctx: AgentContext): Terminus => {
  writeFileSync(join(ctx.worktreePath, file), "done\n");
  return { status: "completed", rationale: `wrote ${file}` };
};
const nothing = (): Terminus => ({ status: "completed", rationale: "did nothing" });

async function surfaceWith(flow: PinnedWorkflow, files: Record<string, string>, workerReplies: ((ctx: AgentContext) => Terminus)[]) {
  const dir = await mkdtemp(join(tmpdir(), "surface-workflow-case-"));
  const repo = initTempRepo("surface-workflow-repo-", files);
  const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-workflow-tree-")), "wt") };
  await create(dir, { surfaceId: "wf-1", taskDef: { intent: "plan then build" }, gateRef: projectGate, workflow: flow }, budgets);
  const seen: AgentContext[] = [];
  let call = 0;
  // Once the scripted replies run out, the worker does nothing: a run that keeps failing escalates on its budgets.
  const agent = fakeAgentPort({ worker: (ctx) => { seen.push(ctx); return Promise.resolve((workerReplies[call++] ?? nothing)(ctx)); } });
  const closer = countingCloser();
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer };
  return { dir, location, ports, closer, seen };
}

const surface = (workerReplies: ((ctx: AgentContext) => Terminus)[]) => surfaceWith(workflow, { "README.md": "hi\n" }, workerReplies);

describe("a workflow of two steps", () => {
  it("runs the steps in order, each checked by its own gate, and lands the task once", async () => {
    const { dir, location, ports, closer, seen } = await surface([write("PLAN.md"), write("BUILT.md")]);
    const result = await run(dir, location, ports);
    expect(result.outcome?.kind).toBe("closed");
    expect(closer.calls).toEqual(["accepted"]);
    expect(seen.map((ctx) => ctx.sessionKey)).toEqual(["worker-1-0", "step2-worker-1-0"]);
    const { history } = await load(dir);
    const step = history.find((e) => e.t === "step");
    expect(step).toMatchObject({ t: "step", step: 2 });
    // Step 1's work was committed before step 2 started, and step 2 started from that commit.
    const log = execFileSync("git", ["log", "--format=%s", "-1", step?.t === "step" ? step.startCommit : ""], { cwd: location.worktreePath, encoding: "utf-8" });
    expect(log.trim()).toBe("Step plan accepted");
  });

  it("does not start step 2 until step 1 is accepted, and corrects only step 1", async () => {
    const { dir, location, ports, seen } = await surface([nothing, write("PLAN.md"), write("BUILT.md")]);
    await run(dir, location, ports);
    expect(seen.map((ctx) => ctx.sessionKey)).toEqual(["worker-1-0", "worker-2-0", "step2-worker-1-0"]);
  });

  it("retries only step 2 when step 2's gate fails", async () => {
    const { dir, location, ports, seen } = await surface([write("PLAN.md"), nothing, write("BUILT.md")]);
    const result = await run(dir, location, ports);
    expect(result.outcome?.kind).toBe("closed");
    expect(seen.map((ctx) => ctx.sessionKey)).toEqual(["worker-1-0", "step2-worker-1-0", "step2-worker-2-0"]);
  });

  it("baselines step 2 against step 1's accepted state", async () => {
    const { dir, location, ports } = await surface([write("PLAN.md"), write("BUILT.md")]);
    await run(dir, location, ports);
    const { history, header } = await load(dir);
    const opened = history.findIndex((e) => e.t === "step");
    const step = history[opened];
    const startCommit = step?.t === "step" ? step.startCommit : "";
    // Step 2 starts from the commit holding step 1's accepted work...
    expect(() => execFileSync("git", ["cat-file", "-e", `${startCommit}:PLAN.md`], { cwd: location.worktreePath })).not.toThrow();
    // ...and takes its own baseline there, on its own entry; header.baseline stays step 1's.
    const step2Baseline = history.slice(opened).find((e) => e.t === "baseline");
    expect(step2Baseline).toMatchObject({ t: "baseline", status: "PASS", report: { status: "PASS" } });
    expect(history.slice(0, opened).filter((e) => e.t === "baseline")).toHaveLength(1);
    expect(header.baseline).not.toBeNull();
  });

  it("checks a step that names no gate with the project's", async () => {
    const { dir, location, ports } = await surface([write("PLAN.md"), write("SOMETHING-ELSE.md")]);
    const result = await run(dir, location, ports);
    expect(result.outcome?.kind).not.toBe("closed"); // BUILT.md, the project's check, never appears
  });

  it("opens step 2 exactly once when a crash lands between committing step 1 and recording the step", async () => {
    const { dir, location, ports } = await surface([write("PLAN.md"), write("BUILT.md")]);
    const tailIsStep1Accepted = async (): Promise<boolean> => {
      const tail = (await load(dir)).history.at(-1);
      return tail?.t === "gate" && tail.status === "PASS";
    };
    do { await advance(dir, location, ports); } while (!(await tailIsStep1Accepted()));
    // What a crash after the commit but before the step entry leaves behind.
    writeFileSync(join(location.worktreePath, "extra.txt"), "x\n");
    await ensureCommitted(location.worktreePath, "hand-made");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: location.worktreePath, env: cleanGitEnv(), encoding: "utf-8" }).trim();
    await advance(dir, location, ports);
    const steps = (await load(dir)).history.filter((e) => e.t === "step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ startCommit: head });
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: location.worktreePath, env: cleanGitEnv(), encoding: "utf-8" }).trim()).toBe(head);
  });
});

describe("a task with no workflow", () => {
  it("runs exactly as before: one step, unprefixed keys, no step entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "surface-workflow-case-"));
    const repo = initTempRepo("surface-workflow-repo-", { "README.md": "hi\n" });
    const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-workflow-tree-")), "wt") };
    await create(dir, { surfaceId: "plain-1", taskDef: { intent: "build" }, gateRef: projectGate }, budgets);
    const closer = countingCloser();
    const result = await run(dir, location, { agent: fakeAgentPort({ worker: (ctx) => Promise.resolve(write("BUILT.md")(ctx)) }), triage: deterministicRouter, closer });
    expect(result.outcome?.kind).toBe("closed");
    const { history } = await load(dir);
    expect(history.some((e) => e.t === "step")).toBe(false);
    expect(history.find((e) => e.t === "dispatch")).toMatchObject({ sessionKey: "worker-1-0" });
  });
});

describe("step guards", () => {
  const guarded: PinnedWorkflow = { ...workflow, steps: [workflow.steps[0] as PinnedWorkflow["steps"][number], { ...(workflow.steps[1] as PinnedWorkflow["steps"][number]), guards: { add: ["tests-unchanged"] } }] };

  it("does not blame step 2 for a test step 1 changed", async () => {
    // Step 1 edits an existing test file; step 2 turns tests-unchanged on and touches no test.
    // Step 2 diffs from step 1's accepted commit, so it passes.
    const editTest = (ctx: AgentContext): Terminus => {
      writeFileSync(join(ctx.worktreePath, "a.test.js"), "// changed\n");
      writeFileSync(join(ctx.worktreePath, "PLAN.md"), "plan\n");
      return { status: "completed", rationale: "planned and changed a test" };
    };
    const { dir, location, ports } = await surfaceWith(guarded, { "a.test.js": "// original\n" }, [editTest, write("BUILT.md")]);
    expect((await run(dir, location, ports)).outcome?.kind).toBe("closed");
  });

  it("holds step 2 to tests-unchanged when it changes a test itself", async () => {
    const editTest = (ctx: AgentContext): Terminus => {
      writeFileSync(join(ctx.worktreePath, "a.test.js"), "// changed in step 2\n");
      writeFileSync(join(ctx.worktreePath, "BUILT.md"), "built\n");
      return { status: "completed", rationale: "built and changed a test" };
    };
    const { dir, location, ports } = await surfaceWith(guarded, { "a.test.js": "// original\n" }, [write("PLAN.md"), editTest, editTest, editTest, editTest]);
    expect((await run(dir, location, ports)).outcome?.kind).not.toBe("closed");
  });
});

describe("continue", () => {
  const planned = (ctx: AgentContext): Terminus & { sessionId: string } => ({ ...write("PLAN.md")(ctx), sessionId: "sess-plan" });
  const continuing: PinnedWorkflow = { ...workflow, steps: [{ name: "plan", prompt: "write PLAN.md", gateRef: planGate }, { name: "build", prompt: "carry out PLAN.md", continue: true as const }] };

  it("resumes step 1's last worker session in step 2, and only when the step says so", async () => {
    const { dir, location, ports, seen } = await surfaceWith(continuing, { "README.md": "hi\n" }, [planned, write("BUILT.md")]);
    await run(dir, location, ports);
    expect(seen.map((ctx) => ctx.resume)).toEqual([undefined, "sess-plan"]);
    const { history } = await load(dir);
    expect(history.find((e) => e.t === "terminus")).toMatchObject({ sessionId: "sess-plan" });
  });

  it("starts a continuing step's retry fresh, so a resume that failed is not repeated", async () => {
    const incomplete = (): Terminus => ({ status: "incomplete", rationale: "the session ended without a result" });
    const { dir, location, ports, seen } = await surfaceWith(continuing, { "README.md": "hi\n" }, [planned, incomplete, write("BUILT.md")]);
    await run(dir, location, ports);
    expect(seen.map((ctx) => ctx.resume)).toEqual([undefined, "sess-plan", undefined]);
  });

  it("records a resume that fell back, spends no budget, and does not escalate", async () => {
    const fellBack = (ctx: AgentContext): Terminus & { resumeFellBack: true } => ({ ...write("BUILT.md")(ctx), resumeFellBack: true });
    const { dir, location, ports } = await surfaceWith(continuing, { "README.md": "hi\n" }, [planned, fellBack]);
    const outcome = await run(dir, location, ports);
    const record = await load(dir);
    expect(outcome.outcome?.kind).toBe("closed");
    expect(record.history.filter((e) => e.t === "terminus")[1]).toMatchObject({ status: "completed", resumeFellBack: true });
    expect(record.history.some((e) => e.t === "terminus" && e.notRun === true)).toBe(false);
    expect(deriveBudgetsFromLog(stepView(record).history, record.cursor.budgets).terminus.used).toBe(0);
  });

  it("starts step 2 fresh without continue", async () => {
    const { dir, location, ports, seen } = await surface([planned, write("BUILT.md")]);
    await run(dir, location, ports);
    expect(seen.map((ctx) => ctx.resume)).toEqual([undefined, undefined]);
  });
});

describe("a run that carries on an earlier run's work", () => {
  it("works in the earlier run's working copy, on its work, judged from its start against its baseline, resuming its session there", async () => {
    const repo = initTempRepo("surface-continue-repo-", { "README.md": "hi\n" });
    const gitIn = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf-8" }).trim();
    const start = gitIn(repo, ["rev-parse", "HEAD"]);
    // The earlier run: its branch holds its half-done work, its working copy has been cleared away.
    const earlierCopy = join(await mkdtemp(join(tmpdir(), "surface-continue-earlier-")), "wt");
    gitIn(repo, ["worktree", "add", "-q", "-b", "surface/earlier-1", "--", earlierCopy, start]);
    writeFileSync(join(earlierCopy, "partial.js"), "// half done\n");
    await ensureCommitted(earlierCopy, "Unfinished work");
    const from = gitIn(repo, ["rev-parse", "surface/earlier-1"]);
    gitIn(repo, ["worktree", "remove", "--force", "--", earlierCopy]);
    // The gate fails on the start commit, so a baseline taken now would FAIL: only the carried one PASSes.
    const carried = { status: "PASS", assertions: [] } as GateReport;

    const dir = await mkdtemp(join(tmpdir(), "surface-continue-case-"));
    await create(dir, {
      surfaceId: "later-1", taskDef: { intent: "build" }, gateRef: projectGate,
      continues: { runId: "earlier-1", worktreePath: earlierCopy, from, startCommit: start, baseline: carried, sessionId: "sess-1", turn: { kind: "interrupted" } },
    }, budgets);
    const seen: { worktreePath: string; resume: string | undefined; hadPartial: boolean }[] = [];
    const agent = fakeAgentPort({
      worker: (ctx) => {
        seen.push({ worktreePath: ctx.worktreePath, resume: ctx.resume, hadPartial: existsSync(join(ctx.worktreePath, "partial.js")) });
        return Promise.resolve(write("BUILT.md")(ctx));
      },
    });
    // This run's own path is never used: it carries on where the earlier run worked.
    const ownCopy = join(await mkdtemp(join(tmpdir(), "surface-continue-own-")), "wt");

    const result = await run(dir, { repoPath: repo, worktreePath: ownCopy }, { agent, triage: deterministicRouter, closer: countingCloser() });

    expect(result.outcome?.kind).toBe("closed");
    expect(seen[0]).toEqual({ worktreePath: earlierCopy, resume: "sess-1", hadPartial: true });
    const { header, cursor } = await load(dir);
    expect(cursor.worktreeRef).toBe(earlierCopy);
    expect(header.startCommit).toBe(start);
    expect(header.baseline).toEqual(carried);
    expect(existsSync(ownCopy)).toBe(false);
  });
});
