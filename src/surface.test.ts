import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, setBaseline, setOutcome, updateCursor, appendEntry, readRef, deriveBudgetsFromLog, rebuild, writeRef } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
import { advance, run, triageTrigger } from "./surface.js";
import { noopCloser } from "./ports.js";
import { deterministicRouter } from "./router.js";
import { createAgentTriage } from "./triage.js";
import { createAgentPort } from "./agent-invoke.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { isOnPath } from "./on-path.js";
import type { SurfaceLocation, SurfacePorts, Terminus, AgentContext, AgentPort, TriageTerminus } from "./ports.js";
import type { AdvanceResult } from "./surface.js";
import { IllegalStateTransition } from "./errors.js";
import type { BudgetPopulation, BudgetSet, GateRef, HistoryEntry, SurfaceState } from "./schema.js";
import { cleanGitEnv } from "./git-env.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

/**
 * Build an agent port from per-role functions. `AgentPort.invoke` is generic
 * over the role, which a plain function cannot satisfy, so the single cast
 * lives here rather than in every fake. A role with no function rejects.
 */
function sessionAgent(
  worker: (role: "worker" | "gate-maintenance", ctx: AgentContext) => Promise<Terminus>,
  triage?: (ctx: AgentContext) => Promise<TriageTerminus>,
): AgentPort {
  const run = (roleCfg: { role: string }, ctx: AgentContext) => {
    if (roleCfg.role === "triage") {
      return triage ? triage(ctx) : Promise.reject(new Error("the triage agent was not expected here"));
    }
    return worker(roleCfg.role as "worker" | "gate-maintenance", ctx);
  };
  return { invoke: run as AgentPort["invoke"] };
}

/** An agent that must never be called in this scenario. */
function unusedAgent(): SurfacePorts["agent"] {
  return {
    invoke: () => Promise.reject(new Error("agent.invoke was not expected here")),
  };
}

function unusedTriage(): SurfacePorts["triage"] {
  return {
    triage: () => Promise.reject(new Error("triage was not expected here")),
  };
}

/** An agent that returns each scripted terminus in turn, then repeats the last. */
function scriptedAgent(script: Terminus[]): SurfacePorts["agent"] & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return Object.assign(sessionAgent((role, ctx) => {
    calls.push(`${role}:${ctx.sessionKey}`);
    const next = script[Math.min(i, script.length - 1)] as Terminus;
    i += 1;
    return Promise.resolve(next);
  }), { calls });
}

function portsWith(agent: SurfacePorts["agent"]): SurfacePorts {
  return { agent, triage: unusedTriage(), closer: noopCloser };
}

/** Ports whose triage is the real deterministic router. */
function portsWithTriage(
  agent: SurfacePorts["agent"],
  closer: SurfacePorts["closer"] = noopCloser,
): SurfacePorts {
  return { agent, triage: deterministicRouter, closer };
}

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

  it("creates a worktree on a surface-derived branch and lands on PRE_GATING", async () => {
    const repo = initTempRepo("surface-repo-", { "seed.txt": "hello\n" });
    const tree = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");

    const result = await advance(dir, { repoPath: repo, worktreePath: tree }, portsWith(unusedAgent()));

    expect(result).toEqual({ state: "PRE_GATING", done: false });
    expect(await readFile(join(tree, "seed.txt"), "utf-8")).toBe("hello\n");
    expect(
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: tree,
        encoding: "utf-8",
        env: cleanGitEnv(),
      }).trim(),
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
    expect(resumed.recovery).toBe("restarted an interrupted provision: cleared what a torn attempt left behind and re-created the worktree");
  });

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
    expect(reloaded.history).toEqual([{ t: "baseline", status: "PASS" }]);
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

  it("re-baselines after a successful repair and reaches AGENT_ACTIVE", async () => {
    const calls: string[] = [];
    const agent: SurfacePorts["agent"] & { calls: string[] } = Object.assign(sessionAgent((role, ctx) => {
      calls.push(`${role}:${ctx.sessionKey}`);
      // The repair agent fixes the environment it was dispatched into.
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    }), { calls });
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

    expect(result).toEqual({
      state: "GATE_MAINTENANCE",
      done: false,
      recovery: "recorded a missing terminus for repair attempt 1 (gate-maintenance-1-0): the interrupted session is retried, not re-dispatched",
    });
    expect(agent.calls).toEqual([]); // no duplicate session dispatched
    const tail = (await load(dir)).history.at(-1);
    expect(tail).toMatchObject({ t: "terminus", role: "gate-maintenance", attempt: 1, status: "incomplete" });

    // A repair recovery is not a worker retry and pays for nothing of the
    // worker's: only the repair's own population moves.
    const { history, cursor } = await load(dir);
    const spent = deriveBudgetsFromLog(history, cursor.budgets);
    expect(spent.terminus.used).toBe(0);
    expect(spent.correction.used).toBe(0);
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

  it("escalates instead of dispatching when the gate-maintenance budget is already spent", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "unused" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);
    // Two prior repair dispatches == the cap of 2
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" });
    await appendEntry(dir, { t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0", status: "completed", rationale: "a" });
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 2, sessionKey: "gate-maintenance-2-0" });
    await appendEntry(dir, { t: "terminus", role: "gate-maintenance", attempt: 2, sessionKey: "gate-maintenance-2-0", status: "completed", rationale: "b" });

    // Position is GATE_MAINTENANCE, so this drives PRE_GATING's cap check via
    // the completed-terminus exit, which re-baselines and finds ERROR again.
    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.outcome?.kind).toBe("escalated");
    expect(reloaded.outcome?.reason).toContain("gateMaintenance");
    expect(reloaded.outcome?.reason).toContain("2/2");
    // No third dispatch was appended, and the repair agent was never invoked
    expect(reloaded.history.filter((e) => e.t === "dispatch")).toHaveLength(2);
    expect(agent.calls).toEqual([]);
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

describe("the AGENT_ACTIVE edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision + baseline a healthy surface, leaving it at AGENT_ACTIVE. */
  async function readyForWorker(ports: SurfacePorts): Promise<SurfaceLocation> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    return location;
  }

  it("dispatches a worker session and records the dispatch/terminus pair", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "wrote the feature" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATING", done: false });
    expect(agent.calls).toEqual(["worker:worker-1-0"]);
    const { history, cursor } = await load(dir);
    expect(history).toEqual([
      { t: "baseline", status: "PASS" },
      { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" },
      {
        t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
        status: "completed", rationale: "wrote the feature",
      },
    ]);
    expect(cursor.state).toBe("GATING");
  });

  it("ends the surface in ESCALATED when the worker reports an authority limit", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "authority", rationale: "needs a credential I do not hold" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("ESCALATED");
    expect(reloaded.outcome?.kind).toBe("escalated");
    expect(reloaded.outcome?.source).toBe("worker");
    expect(reloaded.outcome?.reason).toContain("credential");
    // The terminus already evidences the escalate — no extra entry is written,
    // beyond the baseline capture that preceded this worker attempt.
    expect(reloaded.history).toHaveLength(3);
  });

  it("routes an exhaustion-class escalate to TRIAGE rather than straight out", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "out of ideas" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    // The deterministic router gets first look; its edge is slice 3's.
    expect(result).toEqual({ state: "TRIAGE", done: false });
    expect((await load(dir)).outcome).toBeUndefined();
  });

  it("routes a session that ended without a result to INCOMPLETE_TERMINUS", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "INCOMPLETE_TERMINUS", done: false });
  });

  it("resumes an authority escalate recorded before the outcome was written", async () => {
    // The crash window between appending the terminus and writing the outcome.
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "authority", rationale: "needs an owner's sign-off",
    });

    const result = await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    expect((await load(dir)).outcome?.reason).toContain("sign-off");
  });

  it("resumes a triage escalate recorded before the outcome was written, crediting triage", async () => {
    // The crash window between appending an escalate triage entry and writing the outcome.
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "exhaustion", rationale: "stuck for good",
    });
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "no retry can help" });
    await appendEntry(dir, {
      t: "triage", afterAttempt: 1, trigger: "worker_escalate",
      verdict: "escalate", rationale: "no retry can help", artifactRef: "triage-0",
    });

    const result = await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    expect((await load(dir)).outcome).toMatchObject({ source: "triage", reason: "no retry can help" });
  });
});

describe("the INCOMPLETE_TERMINUS edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  async function readyForWorker(ports: SurfacePorts): Promise<SurfaceLocation> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports);
    return location;
  }

  it("retries the same attempt with a fresh session key", async () => {
    const agent = scriptedAgent([
      { status: "incomplete", rationale: "hit the turn cap" },
      { status: "completed", rationale: "finished on the retry" },
    ]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);
    await advance(dir, location, ports); // AGENT_ACTIVE -> INCOMPLETE_TERMINUS

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "GATING", done: false });
    // Same attempt — a retry of the attempt that produced no valid result, not
    // a new one — and a distinct session, because sessions are reconstructed.
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-1-1"]);
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "dispatch").every((e) => e.attempt === 1)).toBe(true);
  });

  it("escalates once the terminus budget is spent, naming the population and cap", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);
    const ports = portsWith(agent);
    // A cap of 2 makes the whole scenario short: two incomplete sessions, then out.
    await updateCursor(dir, { budgets: { ...budgets, terminus: { used: 0, max: 2 } } });
    const location = await readyForWorker(ports);

    let result = await advance(dir, location, ports);
    for (let step = 0; step < 10 && !result.done; step++) {
      result = await advance(dir, location, ports);
    }

    expect(result).toEqual({ state: "ESCALATED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.outcome?.kind).toBe("escalated");
    // REVIEW FIX: the source is the ROLE whose retries ran out (matching slice
    // 1's "gate-maintenance"); the population and cap are named in the reason.
    expect(reloaded.outcome?.source).toBe("worker");
    expect(reloaded.outcome?.reason).toContain("terminus budget exhausted (2/2)");
    // Exactly the cap: two sessions dispatched, no third.
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-1-1"]);
  });

  it("records the missing terminus for a dispatch that never recorded one", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "finished on the retry" }]);
    const ports = portsWith(agent);
    const location = await readyForWorker(ports);
    // A crash between appending the dispatch and appending its terminus.
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });

    const recorded = await advance(dir, location, ports);

    expect(recorded).toEqual({
      state: "INCOMPLETE_TERMINUS",
      done: false,
      recovery: "recorded a missing terminus for worker attempt 1 (worker-1-0): the interrupted session is retried, not re-dispatched",
    });
    const { history } = await load(dir);
    const tail = history.at(-1);
    expect(tail?.t).toBe("terminus");
    expect(tail).toMatchObject({ status: "incomplete", attempt: 1, sessionKey: "worker-1-0" });
    // No duplicate session was dispatched for the crashed one.
    expect(agent.calls).toEqual([]);
  });
});

describe("the GATING edge", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision, baseline and run one worker session that writes `after`. */
  async function workerWrote(after: string): Promise<{ location: SurfaceLocation; ports: SurfacePorts }> {
    const agent: SurfacePorts["agent"] = sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), after);
      return Promise.resolve({ status: "completed", rationale: "made the change" });
    });
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    return { location, ports };
  }

  it("gates a clean change against the baseline and moves to CLOSING", async () => {
    const { location, ports } = await workerWrote(PASSING_TAP);

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "CLOSING", done: false });
    const { history, cursor } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "gate", attempt: 1, status: "PASS" });
    expect(cursor.state).toBe("CLOSING");
  });

  it("routes a change that broke the gate to TRIAGE", async () => {
    const { location, ports } = await workerWrote(FAILING_TAP);

    const result = await advance(dir, location, ports);

    // The router's edge is slice 3's; slice 2 only has to reach it.
    expect(result).toEqual({ state: "TRIAGE", done: false });
    const { history } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "gate", attempt: 1, status: "FAIL" });
  });
});

describe("the CLOSING edge", () => {
  let dir: string;
  const location: SurfaceLocation = { repoPath: "/unused", worktreePath: "/unused" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    // A baselined surface whose attempt 1 passed the gate sits at CLOSING.
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "completed", rationale: "made the change",
    });
    await appendEntry(dir, { t: "gate", attempt: 1, status: "PASS", newFailures: [] });
  });

  it("closes the surface when the closer accepts the work", async () => {
    const ports = portsWith(unusedAgent());

    const result = await advance(dir, location, ports);

    expect(result).toEqual({ state: "CLOSED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("CLOSED");
    expect(reloaded.outcome?.kind).toBe("closed");
    const tail = reloaded.history.at(-1);
    expect(tail).toMatchObject({ t: "close", status: "DONE", detailRef: "close-0" });
    expect(await readRef(dir, "close-0")).toMatchObject({ status: "DONE" });
  });

  it("routes a close that failed to TRIAGE with the report recorded", async () => {
    const failingCloser = {
      close: () => Promise.resolve({ status: "FAIL" as const, detail: "the merge conflicted" }),
    };

    const result = await advance(
      dir, location,
      { agent: unusedAgent(), triage: unusedTriage(), closer: failingCloser },
    );

    expect(result).toEqual({ state: "TRIAGE", done: false });
    const reloaded = await load(dir);
    expect(reloaded.outcome).toBeUndefined();
    expect(reloaded.history.at(-1)).toMatchObject({ t: "close", status: "FAIL" });
    expect(await readRef(dir, "close-0")).toMatchObject({ detail: "the merge conflicted" });
  });

  it("resumes an accepted close recorded before the outcome was written", async () => {
    // The crash window between appending the close entry and setOutcome.
    await appendEntry(dir, { t: "close", status: "DONE", detailRef: "close-0" });

    const result = await advance(dir, location, portsWith(unusedAgent()));

    expect(result).toEqual({ state: "CLOSED", done: true });
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("CLOSED");
    expect(reloaded.outcome?.kind).toBe("closed");
    // No second close was attempted: the log already carries the accepted one.
    expect(reloaded.history.filter((e) => e.t === "close")).toHaveLength(1);
  });
});

describe("run", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** A worker that adds a file and leaves the gate passing. */
  function cleanWorker(): SurfacePorts["agent"] {
    return sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the change\n");
      return Promise.resolve({ status: "completed", rationale: "added the feature" });
    });
  }

  it("drives a fresh surface all the way to CLOSED with no intervention", async () => {
    const ports = portsWith(cleanWorker());
    const repoPath = initTempRepo("surface-repo-", { "report.tap": PASSING_TAP });
    const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");

    const result = await run(dir, { repoPath, worktreePath }, ports);

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.kind).toBe("closed");
    const { history } = await load(dir);
    expect(history.map((e) => e.t)).toEqual(["baseline", "dispatch", "terminus", "gate", "close"]);
  });

  it("produces the same sequence of states every time, given the same script", async () => {
    async function statesOf(): Promise<SurfaceState[]> {
      const caseDir = await mkdtemp(join(tmpdir(), "surface-case-"));
      await create(caseDir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
      const ports = portsWith(cleanWorker());
      const repoPath = initTempRepo("surface-repo-", { "report.tap": PASSING_TAP });
      const worktreePath = join(await mkdtemp(join(tmpdir(), "surface-tree-")), "wt");
      const seen: SurfaceState[] = [];
      let step: AdvanceResult = { state: "PROVISIONING", done: false };
      while (!step.done) {
        step = await advance(caseDir, { repoPath, worktreePath }, ports);
        seen.push(step.state);
      }
      return seen;
    }

    expect(await statesOf()).toEqual(await statesOf());
    expect(await statesOf()).toEqual([
      "PRE_GATING", "AGENT_ACTIVE", "GATING", "CLOSING", "CLOSED",
    ]);
  });
});

describe("TRIAGE", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Drive a surface to TRIAGE by letting a worker break the gate. */
  async function toTriageOnGateFail(): Promise<{
    location: SurfaceLocation;
    ports: SurfacePorts;
  }> {
    const agent = sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
      return Promise.resolve({ status: "completed", rationale: "broke it" });
    });
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    const gated = await advance(dir, location, ports); // GATING -> TRIAGE
    expect(gated.state).toBe("TRIAGE");
    return { location, ports };
  }

  it("routes a gate failure to another worker attempt on the next attempt number", async () => {
    const { location, ports } = await toTriageOnGateFail();

    const step = await advance(dir, location, ports);
    expect(step.state).toBe("AGENT_ACTIVE");
    expect(step.done).toBe(false);

    const { history } = await load(dir);
    const entry = history.at(-1);
    expect(entry).toMatchObject({
      t: "triage",
      trigger: "gate_fail",
      verdict: "reroute",
      afterAttempt: 1,
      artifactRef: "triage-0",
    });
    expect(await readRef(dir, "triage-0")).toMatchObject({ trigger: "gate_fail" });

    // The reroute entry IS the correction burn, and it advances the attempt.
    await advance(dir, location, ports); // AGENT_ACTIVE dispatches attempt 2
    const after = await load(dir);
    const dispatches = after.history.filter((e) => e.t === "dispatch");
    expect(dispatches.at(-1)).toMatchObject({ attempt: 2, role: "worker" });
  });

  it("escalates a gate failure once the correction budget is at cap", async () => {
    const { location, ports } = await toTriageOnGateFail();

    // The worker never fixes the gate, so every attempt returns to TRIAGE.
    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");
    expect(result.outcome).toMatchObject({ kind: "escalated", source: "triage" });

    const { history } = await load(dir);
    const reroutes = history.filter((e) => e.t === "triage" && e.verdict === "reroute");
    expect(reroutes).toHaveLength(budgets.correction.max);
  });

  it("routes a close failure back to another close attempt", async () => {
    const cleanWorker = sessionAgent(() =>
      Promise.resolve({ status: "completed", rationale: "clean" }),
    );
    let closes = 0;
    const fussyCloser: SurfacePorts["closer"] = {
      close: (_ctx, outcome) => {
        if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
        closes += 1;
        return Promise.resolve(
          closes === 1
            ? { status: "FAIL", detail: "not ready yet" }
            : { status: "DONE", detail: "merged" },
        );
      },
    };
    const ports = portsWithTriage(cleanWorker, fussyCloser);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");
    expect(closes).toBe(2);

    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "close_failure", verdict: "retry_close" },
    ]);
  });

  it("retries an exhaustion-class worker escalate as another worker attempt", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck, maybe retry" },
      { status: "completed", rationale: "got there on the retry" },
    ]);
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");

    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "worker_escalate", verdict: "reroute" },
    ]);
    expect(agent.calls).toEqual(["worker:worker-1-0", "worker:worker-2-0"]);
  });

  it("ends the surface with no further dispatch when the router escalates", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck for good" },
    ]);
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");

    const { cursor, history } = await load(dir);
    expect(cursor.state).toBe("ESCALATED");
    // The last triage entry is the escalate; nothing was dispatched after it.
    const lastTriage = history.map((e) => e.t).lastIndexOf("triage");
    expect(history.slice(lastTriage).filter((e) => e.t === "dispatch")).toEqual([]);
  });

  it("ends the surface as ABORTED when the port returns an abort verdict", async () => {
    const abortingTriage: SurfacePorts["triage"] = {
      triage: () =>
        Promise.resolve({ verdict: "abort", rationale: "the task itself is unsound" }),
    };
    const agent = sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
      return Promise.resolve({ status: "completed", rationale: "broke it" });
    });
    const ports: SurfacePorts = { agent, triage: abortingTriage, closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ABORTED");
    expect(result.outcome).toMatchObject({ kind: "aborted", source: "triage" });

    const { history } = await load(dir);
    expect(history.at(-1)).toMatchObject({ t: "triage", verdict: "abort" });
  });

  it("names the state and the edge when TRIAGE is reached with no routable tail", () => {
    // Defensive guard: no tail `position()` derives TRIAGE from can fail to
    // yield a trigger, so it is exercised directly rather than through advance.
    expect(() => triageTrigger(dir, undefined)).toThrow(IllegalStateTransition);
    expect(() => triageTrigger(dir, { t: "baseline", status: "PASS" })).toThrow(/TRIAGE/);
  });

  it("repairs an errored gate and re-checks the same attempt against the same baseline", async () => {
    const worker = (ctx: { worktreePath: string }): Promise<Terminus> => {
      // The worker's change removes the file the gate reads: the gate can no
      // longer run at all, which is an ERROR, not a regression.
      rmSync(join(ctx.worktreePath, "report.tap"));
      return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
    };
    const repair = (ctx: { worktreePath: string }): Promise<Terminus> => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    };
    const agent: SurfacePorts["agent"] = sessionAgent((role, ctx) =>
      role === "gate-maintenance" ? repair(ctx) : worker(ctx),
    );
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    // Capture the baseline the moment it is pinned, before any worker runs.
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    const pinned = (await load(dir)).header.baseline;
    expect(pinned).not.toBeNull();

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");

    const { header, history } = await load(dir);

    // The baseline is the one captured pre-task — never recaptured.
    expect(history.filter((e) => e.t === "baseline")).toHaveLength(1);
    expect(header.baseline).toEqual(pinned);

    // gate_error routed to a repair, and the re-check judged the SAME attempt.
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "gate_error", verdict: "fix_the_gate" },
    ]);
    expect(history.filter((e) => e.t === "gate")).toMatchObject([
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "PASS" },
    ]);
    expect(history.filter((e) => e.t === "dispatch")).toMatchObject([
      { role: "worker", attempt: 1 },
      { role: "gate-maintenance", attempt: 1 },
    ]);
  });

  it("dispatches the repair on resume when the fix_the_gate verdict was the last thing recorded", async () => {
    const agent: SurfacePorts["agent"] = sessionAgent((role, ctx) => {
      if (role === "gate-maintenance") {
        writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
        return Promise.resolve({ status: "completed", rationale: "restored" });
      }
      rmSync(join(ctx.worktreePath, "report.tap"));
      return Promise.resolve({ status: "completed", rationale: "broke the gate" });
    });
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    await advance(dir, location, ports); // GATING -> TRIAGE
    const routed = await advance(dir, location, ports); // TRIAGE -> GATE_MAINTENANCE
    expect(routed.state).toBe("GATE_MAINTENANCE");

    // Nothing dispatched yet — the triage entry is the tail. A fresh process
    // resuming here must dispatch the repair rather than throw.
    const mid = await load(dir);
    expect(mid.history.at(-1)).toMatchObject({ t: "triage", verdict: "fix_the_gate" });

    const step = await advance(dir, location, ports);
    expect(step.state).toBe("GATE_MAINTENANCE");
    const after = await load(dir);
    expect(after.history.filter((e) => e.t === "dispatch").at(-1))
      .toMatchObject({ role: "gate-maintenance" });
  });

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
});

describe("triage by agent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  const brief = {
    problem: "the second assertion fails",
    dead_ends: "attempt 1 gave up looking in the wrong module",
    scope: "touch report.tap only",
    references: ["worker-1-0"],
    diagnosis: "the report is generated, not hand-written",
  };

  /** Worker 1 is stuck; later workers complete. Records each worker's assembled prompt. */
  function stuckThenCleanWorker(prompts: string[]) {
    let calls = 0;
    return async (role: "worker" | "gate-maintenance", ctx: { dir: string }): Promise<Terminus> => {
      const caseFile = await load(ctx.dir);
      prompts.push(assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(ctx.dir, caseFile)).prompt);
      calls += 1;
      return calls === 1
        ? { status: "escalate", category: "exhaustion", rationale: "I am stuck" }
        : { status: "completed", rationale: "fixed it" };
    };
  }

  it("puts a stuck worker to the triage agent and hands the retried worker its brief", async () => {
    const workerPrompts: string[] = [];
    const triageKeys: string[] = [];
    const agent = sessionAgent(stuckThenCleanWorker(workerPrompts), (ctx) => {
      triageKeys.push(ctx.sessionKey);
      return Promise.resolve({ status: "reroute", rationale: "one more try with a sharper brief", payload: brief });
    });
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(triageKeys).toEqual(["triage-0"]);
    const { history } = await load(dir);
    expect(history.find((e) => e.t === "triage")).toMatchObject({ verdict: "reroute", artifactRef: "triage-0" });
    expect(await readRef(dir, "triage-0")).toEqual({
      trigger: "worker_escalate",
      rationale: "one more try with a sharper brief",
      artifact: brief,
    });
    expect(history.filter((e) => e.t === "dispatch").at(-1)).toMatchObject({ attempt: 2, briefRef: "triage-0" });

    const retried = workerPrompts.at(-1) ?? "";
    expect(retried).toContain(`Dead ends: ${brief.dead_ends}`);
    expect(retried).toContain("Diagnosis (a hypothesis to test, not an established fact)");
    expect(retried.indexOf("## Gate evidence")).toBeGreaterThan(retried.indexOf("## Brief"));
  });

  it("keeps the brief when the retried worker's session ends without a result and is retried", async () => {
    let calls = 0;
    const agent = sessionAgent(
      () => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "stuck" });
        if (calls === 2) return Promise.resolve({ status: "incomplete", rationale: "hit the turn cap" });
        return Promise.resolve({ status: "completed", rationale: "fixed it" });
      },
      () => Promise.resolve({ status: "reroute", rationale: "retry", payload: brief }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await run(dir, location, ports);

    const dispatches = (await load(dir)).history.filter((e) => e.t === "dispatch");
    expect(dispatches.slice(1)).toEqual([
      expect.objectContaining({ attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" }),
      expect.objectContaining({ attempt: 2, sessionKey: "worker-2-1", briefRef: "triage-0" }),
    ]);
  });

  it("routes a plain gate failure with slots to spare with no agent call, and its retry carries no brief", async () => {
    let workerCalls = 0;
    const agent = sessionAgent((_role, ctx) => {
      workerCalls += 1;
      if (workerCalls === 1) writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
      return Promise.resolve({ status: "completed", rationale: "changed it" });
    }); // no triage function: any triage call rejects and fails the test
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    for (let i = 0; i < 5; i++) await advance(dir, location, ports); // baseline, worker, gate, triage, worker 2

    const { history } = await load(dir);
    expect(history.find((e) => e.t === "triage")).toMatchObject({ trigger: "gate_fail", verdict: "reroute" });
    expect(await readRef(dir, "triage-0")).not.toHaveProperty("artifact");
    const retry = history.filter((e) => e.t === "dispatch").at(-1);
    expect(retry).toMatchObject({ attempt: 2 });
    expect(retry).not.toHaveProperty("briefRef");
  });

  it("never asks the triage agent about an authority limit", async () => {
    const agent = sessionAgent(() =>
      Promise.resolve({ status: "escalate", category: "authority", rationale: "I may not touch billing" }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");
    expect((await load(dir)).history.some((e) => e.t === "triage")).toBe(false);
  });

  it("resumes a triage round that crashed mid-session to the same round and the same request", async () => {
    const seen: { sessionKey: string; prompt: string }[] = [];
    let triageCalls = 0;
    const agent = sessionAgent(
      () => Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "stuck" }),
      async (ctx) => {
        const caseFile = await load(ctx.dir);
        seen.push({
          sessionKey: ctx.sessionKey,
          prompt: assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(ctx.dir, caseFile)).prompt,
        });
        triageCalls += 1;
        if (triageCalls === 1) throw new Error("process killed mid-triage");
        return { status: "reroute", rationale: "retry", payload: brief };
      },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // worker escalates -> TRIAGE
    const before = await load(dir);

    await expect(advance(dir, location, ports)).rejects.toThrow("process killed mid-triage");
    expect((await load(dir)).history).toEqual(before.history); // nothing appended

    const resumed = await advance(dir, location, ports);
    expect(resumed.state).toBe("AGENT_ACTIVE");
    expect(seen.map((s) => s.sessionKey)).toEqual(["triage-0", "triage-0"]);
    expect(seen[1]?.prompt).toBe(seen[0]?.prompt);
  });
});

describe.skipIf(!isOnPath("claude-mock"))("triage by agent through the real invocation seam", () => {
  it("delivers the triage brief's dead ends into the retried worker's actual request", async () => {
    const localBrief = {
      problem: "the second assertion fails",
      dead_ends: "attempt 1 gave up looking in the wrong module",
      scope: "touch report.tap only",
      references: ["worker-1-0"],
      diagnosis: "the report is generated, not hand-written",
    };
    const dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const scriptPath = join(dir, "mock.json");
    const journalPath = join(dir, "journal.jsonl");
    // Each session re-reads the queue, so expectations are routed by prompt content:
    // triage first (only its prompt has a Setback slot), then the briefed retry, then attempt 1.
    await writeFile(scriptPath, JSON.stringify([
      { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "one more try", payload: localBrief } },
      { when: { promptContains: localBrief.dead_ends }, json: { status: "completed", rationale: "fixed it" } },
      { when: { promptContains: "No distilled brief" }, json: { status: "escalate", category: "exhaustion", rationale: "I am stuck" } },
    ]), "utf-8");
    const agent = createAgentPort(
      { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
      { pathToClaudeCodeExecutable: "claude-mock", env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath } },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n").filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { event: string; prompt?: string })
      .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain("## Setback");
    expect(prompts[2]).toContain(`Dead ends: ${localBrief.dead_ends}`);
  });
});

describe("budget caps", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** Provision, run to a terminal state, and read back what the log says was spent. */
  async function runToEnd(
    ports: SurfacePorts,
  ): Promise<{ state: SurfaceState; reason: string; spent: BudgetSet; history: HistoryEntry[] }> {
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    const result = await run(dir, location, ports);
    const caseFile = await load(dir);
    return {
      state: result.state,
      reason: caseFile.outcome?.reason ?? "",
      spent: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
      history: caseFile.history,
    };
  }

  function countOf(history: HistoryEntry[], t: HistoryEntry["t"]): number {
    return history.filter((e) => e.t === t).length;
  }

  /** The reason a cap escalation must carry, per the item's DX decision. */
  function exhaustedPrefix(population: BudgetPopulation): string {
    const { max } = budgets[population];
    return `${population} budget exhausted (${max}/${max})`;
  }

  it("spends exactly the correction cap when the worker is always stuck, and nothing else", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "exhaustion", rationale: "stuck, try again" },
    ]);

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("correction"));
    expect(spent.correction.used).toBe(budgets.correction.max);

    // Exactly the cap: the first attempt plus one retry per correction spent,
    // and a final triage round that refused to spend a fourth.
    expect(countOf(history, "dispatch")).toBe(budgets.correction.max + 1);
    expect(
      history.filter((e) => e.t === "triage" && e.verdict === "reroute"),
    ).toHaveLength(budgets.correction.max);

    // Independence: a scenario that only ever burns corrections burns nothing else.
    expect(spent.gateError.used).toBe(0);
    expect(spent.gateMaintenance.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
    expect(spent.close.used).toBe(0);
  });

  it("spends exactly the gate-maintenance cap when the gate never runs again", async () => {
    // The worker deletes the file the gate reads, so the gate ERRORs rather
    // than failing; every repair session reports success without restoring it.
    const agent: SurfacePorts["agent"] = sessionAgent((role, ctx) => {
      if (role === "worker") {
        rmSync(join(ctx.worktreePath, "report.tap"), { force: true });
        return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
      }
      return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
    });

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("gateMaintenance"));
    expect(spent.gateMaintenance.used).toBe(budgets.gateMaintenance.max);

    // One repair session per gateMaintenance spent, and no more.
    expect(
      history.filter((e) => e.t === "dispatch" && e.role === "gate-maintenance"),
    ).toHaveLength(budgets.gateMaintenance.max);
    expect(
      history.filter((e) => e.t === "dispatch" && e.role === "worker"),
    ).toHaveLength(1);

    // The worker's own populations are untouched: a broken gate is not the
    // worker's setback to pay for.
    expect(spent.correction.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
    expect(spent.close.used).toBe(0);
  });

  it("spends exactly the terminus cap when the worker never returns a result", async () => {
    const agent = scriptedAgent([{ status: "incomplete", rationale: "hit the turn cap" }]);

    const { state, reason, spent, history } = await runToEnd(portsWithTriage(agent));

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("terminus"));
    expect(spent.terminus.used).toBe(budgets.terminus.max);

    // Each incomplete session IS the burn, so the cap is the session count —
    // the last one is never retried, and no triage round is ever reached.
    expect(countOf(history, "dispatch")).toBe(budgets.terminus.max);
    expect(countOf(history, "triage")).toBe(0);
    expect(spent.correction.used).toBe(0);
    expect(spent.gateMaintenance.used).toBe(0);
  });

  it("spends exactly the close cap when the closer always rejects the work", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "clean change" }]);
    const rejectingCloser: SurfacePorts["closer"] = {
      close: (_ctx, outcome) =>
        Promise.resolve(
          outcome.kind === "accepted"
            ? { status: "FAIL", detail: "not ready to close" }
            : { status: "DONE", detail: "torn down" },
        ),
    };

    const { state, reason, spent, history } = await runToEnd(
      portsWithTriage(agent, rejectingCloser),
    );

    expect(state).toBe("ESCALATED");
    expect(reason).toContain(exhaustedPrefix("close"));
    expect(spent.close.used).toBe(budgets.close.max);

    // The first close plus one retry per close spent; the worker ran once.
    expect(countOf(history, "close")).toBe(budgets.close.max + 1);
    expect(countOf(history, "dispatch")).toBe(1);
    expect(spent.correction.used).toBe(0);
    expect(spent.terminus.used).toBe(0);
  });

  it("reaches the same cap when the run is stopped partway and resumed from the directory", async () => {
    const stuck = (): Terminus => ({
      status: "escalate",
      category: "exhaustion",
      rationale: "stuck, try again",
    });

    // Reference: the whole scenario in one go.
    const straightThrough = await runToEnd(portsWithTriage(scriptedAgent([stuck()])));

    // The same scenario, stopped after four transitions and picked up again.
    const resumedDir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(
      resumedDir,
      { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef },
      budgets,
    );
    const firstProcess = portsWithTriage(scriptedAgent([stuck()]));
    const location = await provisioned(resumedDir, { "report.tap": PASSING_TAP }, firstProcess);
    // PRE_GATING -> AGENT_ACTIVE -> TRIAGE -> AGENT_ACTIVE -> TRIAGE: stopped
    // with one of three corrections spent.
    for (let step = 0; step < 4; step++) {
      await advance(resumedDir, location, firstProcess);
    }
    const midRun = await load(resumedDir);
    expect(midRun.outcome).toBeUndefined();
    expect(
      deriveBudgetsFromLog(midRun.history, midRun.cursor.budgets).correction.used,
    ).toBe(1);

    // A fresh process: the cursor rebuilt from the log, and doubles that share
    // no state with the ones that ran before the stop.
    await rebuild(resumedDir);
    const secondProcess = portsWithTriage(scriptedAgent([stuck()]));
    const result = await run(resumedDir, location, secondProcess);
    const resumed = await load(resumedDir);

    expect(result.state).toBe(straightThrough.state);
    expect(resumed.outcome?.reason).toContain(exhaustedPrefix("correction"));
    expect(
      deriveBudgetsFromLog(resumed.history, resumed.cursor.budgets),
    ).toEqual(straightThrough.spent);
    // Not later and not sooner: the same number of worker sessions either way.
    expect(resumed.history.filter((e) => e.t === "dispatch")).toHaveLength(
      straightThrough.history.filter((e) => e.t === "dispatch").length,
    );
  });
});

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
        agent: sessionAgent((role, ctx) => {
          if (role === "worker") {
            rmSync(join(ctx.worktreePath, "report.tap"), { force: true });
            return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
          }
          return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
        }),
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
      // Six advances — provision, baseline, worker, gate, rejected close,
      // triage — stop with the retry_close verdict recorded and the close it
      // pays for not yet carried out: AC4's window exactly.
      stopAfter: 6,
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
