import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { create } from "./case-file.js";
import { invoke, DID_NOT_COMPLETE } from "./agent-invoke.js";
import { workerRoleConfig } from "./role-config.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

/**
 * claude-mock is a sibling project installed with `npm link`, not vendored
 * here, so this tier skips rather than fails when it is absent.
 */
const hasMock = (process.env.PATH ?? "")
  .split(delimiter)
  .some((d) => d !== "" && existsSync(join(d, "claude-mock")));

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

let dir: string;
let worktreePath: string;
let scriptPath: string;
let ctx: AgentContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "invoke-case-"));
  worktreePath = await mkdtemp(join(tmpdir(), "invoke-tree-"));
  scriptPath = join(dir, "mock.json");
  ctx = { worktreePath, dir, sessionKey: "worker-1-0" };
  await create(dir, { surfaceId: "s-1", taskDef: { intent: "add a greeting" }, gateRef }, budgets);
});

/** Write the mock's expectation queue for this test. */
async function script(expectations: unknown[]): Promise<void> {
  await writeFile(scriptPath, JSON.stringify(expectations), "utf-8");
}

/** Point the SDK at the mock instead of the real CLI. */
function useMock(): { pathToClaudeCodeExecutable: string; env: Record<string, string | undefined> } {
  return {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  };
}

describe.skipIf(!hasMock)("invoke against a scripted agent session", () => {
  it("returns one completed terminus carrying the agent's explanation", async () => {
    await script([{ json: { status: "completed", rationale: "added the greeting endpoint" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({ status: "completed", rationale: "added the greeting endpoint" });
  });

  it("returns one escalate terminus naming the category", async () => {
    await script([
      { json: { status: "escalate", category: "authority", rationale: "needs a credential I was not given" } },
    ]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "escalate",
      category: "authority",
      rationale: "needs a credential I was not given",
    });
  });

  it("treats a session that ended in an error as did-not-complete", async () => {
    await script([{ fail: { message: "the session blew up: TypeError at line 42" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.errored);
  });

  it("treats a session that emitted no envelope as did-not-complete", async () => {
    await script([{ reply: "I had a look around but never reported back." }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.noEnvelope);
  });

  it("treats a reply that does not match the expected shape as did-not-complete", async () => {
    await script([{ json: { status: "finished", note: "all good" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.wrongShape);
  });

  it("treats a worker emitting a triage-only status as did-not-complete, not a route", async () => {
    await script([{ json: { status: "reroute", rationale: "someone else should do this" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.wrongShape);
  });

  it("never leaks the underlying error text into the rationale", async () => {
    await script([{ fail: { message: "TypeError: Cannot read properties of undefined\n    at foo (/x/y.js:42:9)" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.rationale).not.toContain("TypeError");
    expect(terminus.rationale).not.toContain("at foo");
    expect(terminus.rationale).toContain("worker");
  });
});

describe("invoke without a runnable session", () => {
  it("returns did-not-complete rather than throwing when the agent cannot be run", async () => {
    await script([{ reply: "unreachable" }]);
    const terminus = await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: join(dir, "no-such-binary"),
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.notRun);
    expect(terminus.rationale).not.toContain("ENOENT");
  });
});
