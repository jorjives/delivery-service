import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "./case-file.js";
import { invoke, DID_NOT_COMPLETE, buildSessionOptions } from "./agent-invoke.js";
import { workerRoleConfig } from "./role-config.js";
import { isOnPath } from "./on-path.js";
import { createToolAuthority } from "./tool-authority.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

/**
 * claude-mock is a sibling project installed with `npm link`, not vendored
 * here, so this tier skips rather than fails when it is absent.
 */
const hasMock = isOnPath("claude-mock");

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

  // The journal records the user turn only; `systemPrompt` determinism is Task 3's.
  it("sends the identical request twice from the same starting case file", async () => {
    const journalPath = join(dir, "journal.jsonl");
    await script([{ json: { status: "completed", rationale: "either run" } }]);
    const sdk = {
      pathToClaudeCodeExecutable: "claude-mock",
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath },
    };

    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-0" }, sdk);
    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-1" }, sdk);

    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { event: string; prompt?: string })
      .filter((entry) => entry.event === "matched")
      .map((entry) => entry.prompt);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
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

describe("the session options the primitive builds", () => {
  function options() {
    return buildSessionOptions(
      workerRoleConfig,
      ctx,
      { pathToClaudeCodeExecutable: "claude-mock", env: { A: "1" } },
      createToolAuthority(workerRoleConfig, worktreePath).canUseTool,
    );
  }

  it("installs the role's guard as the permission decision point", () => {
    expect(typeof options().canUseTool).toBe("function");
  });

  it("does not narrow the session's base tool set, which would silence the guard", () => {
    expect(options().tools).toBeUndefined();
  });

  it("does not auto-approve the role's tools, which would make the guard dead code", () => {
    expect(options().allowedTools).toBeUndefined();
  });

  it("closes every route round the guard by construction", () => {
    const built = options();
    expect(built.settingSources).toEqual([]);
    expect(built.permissionMode).toBe("default");
    expect(built.permissionPrompts).toBe("host");
    expect(built.hooks).toBeUndefined();
    expect(built.plugins).toBeUndefined();
    expect(built.permissionPromptToolName).toBeUndefined();
    expect(built.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("takes only the executable and its environment from the caller", () => {
    const built = buildSessionOptions(
      workerRoleConfig,
      ctx,
      // A caller reaching for a permission field cannot: the parameter type has no
      // such field, and nothing is spread. Cast to prove the runtime behaviour too.
      { pathToClaudeCodeExecutable: "claude-mock", permissionMode: "bypassPermissions" } as never,
      createToolAuthority(workerRoleConfig, worktreePath).canUseTool,
    );
    expect(built.pathToClaudeCodeExecutable).toBe("claude-mock");
    expect(built.permissionMode).toBe("default");
  });

  it("still points the session at the run's worktree", () => {
    expect(options().cwd).toBe(worktreePath);
  });
});

describe.skipIf(!hasMock)("invoke with the guard installed", () => {
  it("still drives a scripted session to a clean terminus", async () => {
    await script([{ json: { status: "completed", rationale: "guard installed, run unaffected" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "completed",
      rationale: "guard installed, run unaffected",
    });
  });
});
