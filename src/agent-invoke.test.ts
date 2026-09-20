import { describe, it, expect, beforeEach } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { create, readRef } from "./case-file.js";
import { invoke, DID_NOT_COMPLETE, buildSessionOptions, createAgentPort, sessionErrorRef } from "./agent-invoke.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
import { createToolAuthority } from "./tool-authority.js";
import { triageRoleConfig, TriageEnvelope } from "./triage-role-config.js";
import { InvalidRoleConfig } from "./errors.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

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
let journalPath: string;
let ctx: AgentContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "invoke-case-"));
  worktreePath = await mkdtemp(join(tmpdir(), "invoke-tree-"));
  scriptPath = join(dir, "mock.json");
  journalPath = join(dir, "journal.jsonl");
  ctx = { worktreePath, dir, sessionKey: "worker-1-0" };
  await create(dir, { surfaceId: "s-1", taskDef: { intent: "add a greeting" }, gateRef }, budgets);
});

/** Write the mock's expectation queue for this test. */
async function script(expectations: unknown[]): Promise<void> {
  await writeFile(scriptPath, JSON.stringify(expectations), "utf-8");
}

/** Point the SDK at the vendored mock instead of the real CLI. */
function useMock() {
  return mockSessionEnvironment({ scriptPath, journalPath });
}

describe("invoke against a scripted agent session", () => {
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

  // A session that ran and answered badly may answer well next time, so it
  // carries no mark: the caller's retry is right for it, and only for it.
  it("leaves a session that ran and answered badly unmarked", async () => {
    await script([{ json: { status: "finished", note: "all good" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "incomplete",
      rationale: `worker session did not complete: ${DID_NOT_COMPLETE.wrongShape}`,
    });
  });

  it("never leaks the underlying error text into the rationale", async () => {
    await script([{ fail: { message: "TypeError: Cannot read properties of undefined\n    at foo (/x/y.js:42:9)" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.rationale).not.toContain("TypeError");
    expect(terminus.rationale).not.toContain("at foo");
    expect(terminus.rationale).toContain("worker");
  });

  // Keeping the error out of the rationale is not licence to destroy it: without
  // a record naming the cause, diagnosing a session that never ran means patching
  // the built harness by hand.
  it("keeps the error the session reported beside the case file", async () => {
    await script([{ fail: { message: "TypeError: Cannot read properties of undefined\n    at foo (/x/y.js:42:9)" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());

    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.errored);
    expect(await readRef(dir, sessionErrorRef(ctx.sessionKey))).toEqual({
      sessionKey: "worker-1-0",
      role: "worker",
      reason: DID_NOT_COMPLETE.errored,
      cause: "TypeError: Cannot read properties of undefined\n    at foo (/x/y.js:42:9)",
    });
  });

  it("writes no failure record for a session that completed cleanly", async () => {
    await script([{ json: { status: "completed", rationale: "nothing went wrong" } }]);
    await invoke(workerRoleConfig, ctx, useMock());
    await expect(readRef(dir, sessionErrorRef(ctx.sessionKey))).rejects.toThrow();
  });

  // The journal records the user turn only; `systemPrompt` determinism is Task 3's.
  it("sends the identical request twice from the same starting case file", async () => {
    await script([{ json: { status: "completed", rationale: "either run" } }]);
    const sdk = useMock();

    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-0" }, sdk);
    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-1" }, sdk);

    const prompts = promptsSent(await readJournal(journalPath));

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
    // Exactly the fixed sentence and nothing else. The SDK's own message names
    // the binary it could not start (and never says "ENOENT"), so asserting on
    // the whole rationale is what actually pins "no raw error text leaks here".
    expect(terminus.rationale).toBe(`worker session did not complete: ${DID_NOT_COMPLETE.notRun}`);
  });

  // The reason is prose for a person; `notRun` is the same fact for the caller.
  // Nothing between attempts can change for a session that never started, so a
  // router that cannot see this fact can only guess, and guesses by retrying.
  it("marks a session that never started, so the caller can tell it from a bad answer", async () => {
    await script([{ reply: "unreachable" }]);
    const terminus = await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: join(dir, "no-such-binary"),
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });
    expect(terminus).toMatchObject({ status: "incomplete", notRun: true });
  });

  it("keeps the error that stopped the session starting beside the case file", async () => {
    await script([{ reply: "unreachable" }]);
    await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: join(dir, "no-such-binary"),
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });

    const record = await readRef(dir, sessionErrorRef(ctx.sessionKey));
    expect(record).toMatchObject({ sessionKey: "worker-1-0", role: "worker", reason: DID_NOT_COMPLETE.notRun });
    // The runtime names the binary it could not start — the fact the fixed
    // rationale cannot carry, and the one a diagnosis turns on.
    expect((record as { cause: string }).cause).toContain("no-such-binary");
  });
});

describe("the session options the primitive builds", () => {
  function options() {
    return buildSessionOptions(
      workerRoleConfig,
      ctx,
      { pathToClaudeCodeExecutable: "/path/to/claude", env: { A: "1" } },
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
      { pathToClaudeCodeExecutable: "/path/to/claude", permissionMode: "bypassPermissions" } as never,
      createToolAuthority(workerRoleConfig, worktreePath).canUseTool,
    );
    expect(built.pathToClaudeCodeExecutable).toBe("/path/to/claude");
    expect(built.permissionMode).toBe("default");
  });

  it("still points the session at the run's worktree", () => {
    expect(options().cwd).toBe(worktreePath);
  });

  // claude-mock never reads --json-schema, but the real runtime validates it at
  // startup and exits 1 on a schema it cannot compile, failing every session before
  // the model is reached. So each role's schema goes through the SDK to the runtime
  // it ships, and only the initialize handshake is awaited: no turn, no credentials,
  // no network.
  it.each([workerRoleConfig, gateMaintenanceRoleConfig, triageRoleConfig])(
    "hands the $role session a schema the real runtime starts with",
    async (roleCfg) => {
      const home = await mkdtemp(join(tmpdir(), "invoke-runtime-home-"));
      const session = query({
        prompt: new PassThrough({ objectMode: true }),
        options: buildSessionOptions(
          roleCfg,
          ctx,
          { env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home } },
          createToolAuthority(roleCfg, worktreePath).canUseTool,
        ),
      });
      try {
        await expect(session.initializationResult()).resolves.toBeDefined();
      } finally {
        session.close();
      }
    },
    30_000,
  );
});

describe("invoke with the guard installed", () => {
  it("still drives a scripted session to a clean terminus", async () => {
    await script([{ json: { status: "completed", rationale: "guard installed, run unaffected" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "completed",
      rationale: "guard installed, run unaffected",
    });
  });
});

describe("invoking gate-maintenance through the same seam as the worker", () => {
  it("repairs an environment file and returns a completed terminus, as the worker's clean case does", async () => {
    await writeFile(join(worktreePath, ".env"), "PORT=\n", "utf-8");
    await script([
      {
        effects: [{ edit: { path: ".env", old: "PORT=", new: "PORT=8080" } }],
        json: { status: "completed", rationale: "set the missing PORT in .env so the service can start" },
      },
    ]);

    const terminus = await invoke(
      gateMaintenanceRoleConfig,
      { worktreePath, dir, sessionKey: "gate-maintenance-1-0" },
      useMock(),
    );

    expect(terminus).toEqual({
      status: "completed",
      rationale: "set the missing PORT in .env so the service can start",
    });
    expect(await readFile(join(worktreePath, ".env"), "utf-8")).toBe("PORT=8080\n");
  });
});

const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

describe("createAgentPort", () => {
  it("refuses a triage config that grants an editing tool before any session is spawned", async () => {
    const port = createAgentPort({
      ...configs,
      triage: { ...triageRoleConfig, allowedTools: ["Read", "Write"] },
    });
    await expect(port.invoke({ role: "triage" }, { ...ctx, sessionKey: "triage-0" })).rejects.toThrow(InvalidRoleConfig);
  });
});

describe("createAgentPort against a scripted session", () => {
  it("runs each role with its own config through the one invoke seam", async () => {
    await script([
      // claude-mock matches the user turn only; the literal "reroute" appears in the
      // triage envelope schema rendered there, and in no worker prompt.
      { when: { promptContains: "\"reroute\"" }, json: {
        status: "reroute",
        rationale: "one more attempt is worth it",
        payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
      } },
      { json: { status: "completed", rationale: "done" } },
    ]);
    const port = createAgentPort(configs, useMock());

    const triaged = await port.invoke({ role: "triage" }, { ...ctx, sessionKey: "triage-0" });
    expect(triaged.status).toBe("reroute");
    expect(TriageEnvelope.safeParse(triaged).success).toBe(true);

    const worked = await port.invoke({ role: "worker" }, ctx);
    expect(worked).toEqual({ status: "completed", rationale: "done" });
  });
});
