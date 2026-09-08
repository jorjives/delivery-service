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
