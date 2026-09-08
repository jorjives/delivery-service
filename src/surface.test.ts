import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, setBaseline, setOutcome, updateCursor, appendEntry } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
import { advance } from "./surface.js";
import { noopCloser } from "./ports.js";
import type { SurfaceLocation, SurfacePorts, Terminus } from "./ports.js";
import { IllegalStateTransition } from "./errors.js";
import type { BudgetSet, GateRef } from "./schema.js";
import { cleanGitEnv } from "./git-env.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

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

function portsWith(agent: SurfacePorts["agent"]): SurfacePorts {
  return { agent, triage: unusedTriage(), closer: noopCloser };
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

  it("throws IllegalStateTransition naming the state it cannot advance from", async () => {
    // An exhaustion-class escalate sits at TRIAGE, whose edge is slice 3's.
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "exhaustion", rationale: "out of ideas",
    });

    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      IllegalStateTransition,
    );
    await expect(advance(dir, location, portsWith(unusedAgent()))).rejects.toThrow(
      /TRIAGE/,
    );
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
    // The terminus already evidences the escalate — no extra entry is written.
    expect(reloaded.history).toHaveLength(2);
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

    expect(recorded).toEqual({ state: "INCOMPLETE_TERMINUS", done: false });
    const { history } = await load(dir);
    const tail = history.at(-1);
    expect(tail?.t).toBe("terminus");
    expect(tail).toMatchObject({ status: "incomplete", attempt: 1, sessionKey: "worker-1-0" });
    // No duplicate session was dispatched for the crashed one.
    expect(agent.calls).toEqual([]);
  });
});
