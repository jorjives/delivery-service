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
