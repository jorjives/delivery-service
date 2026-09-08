import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, setBaseline, setOutcome, updateCursor } from "./case-file.js";
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
