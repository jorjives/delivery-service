import { describe, it, expect, beforeEach } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, writeFile, readFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { create, readRef } from "./case-file.js";
import { invoke, runSession, DID_NOT_COMPLETE, buildSessionOptions, createAgentPort, sessionErrorRef, stepSession, usageLimitOf, usageOf } from "./agent-invoke.js";
import { initialCaseFile } from "./case-file.js";
import { stepView } from "./workflow-step.js";
import { workerRoleConfig, gateMaintenanceRoleConfig, type RoleConfig } from "./role-config.js";
import { Ajv } from "ajv";
import { mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
import { triageRoleConfig, TriageEnvelope } from "./triage-role-config.js";
import { CorruptCaseFile, FileNotFound, InvalidRoleConfig } from "./errors.js";
import { USAGE_LIMIT_WORDS } from "./ports.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef, HistoryEntry } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

/** A sharpened brief, as a triage reply that sends the work round again carries it. */
const brief = { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "g" };
const NO_COST = { costUsd: 0, durationMs: 0 }; // what the scripted agent reports when the script sets no figure

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
    expect(terminus).toEqual({ status: "completed", rationale: "added the greeting endpoint", usage: NO_COST });
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
      usage: NO_COST,
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
      usage: NO_COST,
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

  // An unusable reply is the agent's own words, not the harness's, so it is kept
  // under its own label, apart from any cause the harness itself found.
  it("keeps the reply of a session that emitted no envelope, labelled as the agent's", async () => {
    await script([{ reply: "I had a look around but never reported back." }]);
    await invoke(workerRoleConfig, ctx, useMock());

    expect(await readRef(dir, sessionErrorRef(ctx.sessionKey))).toEqual({
      sessionKey: "worker-1-0",
      role: "worker",
      reason: DID_NOT_COMPLETE.noEnvelope,
      agentReply: "I had a look around but never reported back.",
    });
  });

  it("keeps a wrong-shaped reply and why the role's schema refused it", async () => {
    await script([{ json: { status: "finished", note: "all good" } }]);
    await invoke(workerRoleConfig, ctx, useMock());

    const record = (await readRef(dir, sessionErrorRef(ctx.sessionKey))) as { agentReply: string; cause: string };
    expect(record).toMatchObject({ sessionKey: "worker-1-0", role: "worker", reason: DID_NOT_COMPLETE.wrongShape });
    expect(JSON.parse(record.agentReply)).toEqual({ status: "finished", note: "all good" });
    expect(record.cause).toContain("status");
  });

  // Model output is unbounded and untrusted: a runaway reply must not become a
  // runaway file beside the case file.
  it("truncates a long unusable reply and says how much was dropped", async () => {
    await script([{ reply: "x".repeat(10_000) }]);
    await invoke(workerRoleConfig, ctx, useMock());

    const { agentReply } = (await readRef(dir, sessionErrorRef(ctx.sessionKey))) as { agentReply: string };
    expect(agentReply.startsWith("x".repeat(4_000))).toBe(true);
    expect(agentReply).toContain("[truncated: 6000 more characters]");
    expect(agentReply.length).toBeLessThan(4_100);
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

describe("what a session cost and took", () => {
  it("carries the cost and time the runtime reported on the terminus", async () => {
    await script([{ json: { status: "completed", rationale: "added it" }, costUsd: 0.42, durationMs: 1500 }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({ status: "completed", rationale: "added it", usage: { costUsd: 0.42, durationMs: 1500 } });
  });

  it("carries them on a session that gave no usable reply: it still ran, and still cost", async () => {
    await script([{ reply: "no envelope", costUsd: 0.1, durationMs: 800 }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toMatchObject({ status: "incomplete", usage: { costUsd: 0.1, durationMs: 800 } });
  });

  it("carries them on a session that ended in an error", async () => {
    await script([{ fail: { message: "boom" }, costUsd: 0.05, durationMs: 300 }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toMatchObject({ status: "incomplete", usage: { costUsd: 0.05, durationMs: 300 } });
  });

  it("carries none when no session ran: there is nothing the runtime could report", async () => {
    await script([{ reply: "unreachable" }]);
    const terminus = await invoke(workerRoleConfig, ctx, { pathToClaudeCodeExecutable: join(dir, "no-such-binary"), env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath } });
    expect(terminus).not.toHaveProperty("usage");
  });
});

describe("usageOf", () => {
  it("reads the runtime's cost and time, whole milliseconds", () => {
    expect(usageOf({ total_cost_usd: 0.42, duration_ms: 1500.6 })).toEqual({ costUsd: 0.42, durationMs: 1501 });
  });

  it("leaves out a figure that is not a finite, non-negative number rather than record it", () => {
    expect(usageOf({ total_cost_usd: Number.NaN, duration_ms: -1 })).toEqual({});
    expect(usageOf({ total_cost_usd: undefined as unknown as number, duration_ms: Number.POSITIVE_INFINITY })).toEqual({});
  });
});

// A case file that cannot be read cannot have its failure reported into it, so
// this is a run-level error for the caller, not an agent outcome, and no
// session is spent on it.
describe("invoke over a case file it cannot read", () => {
  it("throws the case-file error, before any session is spawned, when the case file is missing", async () => {
    await script([{ json: { status: "completed", rationale: "unreachable" } }]);
    const missing = await mkdtemp(join(tmpdir(), "invoke-missing-"));

    await expect(invoke(workerRoleConfig, { ...ctx, dir: missing }, useMock())).rejects.toThrow(FileNotFound);
    expect(await readJournal(journalPath)).toEqual([]);
  });

  it("throws the case-file error, before any session is spawned, when the log is corrupt", async () => {
    await script([{ json: { status: "completed", rationale: "unreachable" } }]);
    await appendFile(join(dir, "log.jsonl"), "not json\n{}\n", "utf-8");

    await expect(invoke(workerRoleConfig, ctx, useMock())).rejects.toThrow(CorruptCaseFile);
    expect(await readJournal(journalPath)).toEqual([]);
  });
});

describe("the session options the primitive builds", () => {
  function options() {
    return buildSessionOptions(workerRoleConfig, ctx, { pathToClaudeCodeExecutable: "/path/to/claude", env: { A: "1" } }, "harness context");
  }

  it("keeps Claude Code's own system prompt and appends the harness's context to it", () => {
    expect(options().systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "harness context" });
  });

  it("loads the operator's own settings, CLAUDE.md, skills, plugins, hooks and MCP servers, as their own session would", () => {
    const built = options();
    expect(built.settingSources).toBeUndefined();
    expect(built.settings).toBeUndefined();
    expect(built.plugins).toBeUndefined();
    expect(built.hooks).toBeUndefined();
    expect(built.mcpServers).toBeUndefined();
  });

  it("gives the session every tool, leaving refusals to the operator's own settings", () => {
    const built = options();
    expect(built.permissionMode).toBe("bypassPermissions");
    expect(built.allowDangerouslySkipPermissions).toBe(true);
    expect(built.canUseTool).toBeUndefined();
    expect(built.allowedTools).toBeUndefined();
    expect(built.tools).toBeUndefined();
  });

  it("takes the executable and its environment from the caller", () => {
    const built = options();
    expect(built.pathToClaudeCodeExecutable).toBe("/path/to/claude");
    expect(built.env).toEqual({ A: "1" });
  });

  it("still points the session at the run's worktree", () => {
    expect(options().cwd).toBe(worktreePath);
  });

  it("passes the operator's agent options through, without the harness's own text", () => {
    const built = buildSessionOptions(workerRoleConfig, ctx, { env: { A: "1" }, agent: { model: "opus", effort: "high", append: "x", env: { B: "2" } } });
    expect(built.model).toBe("opus");
    expect(built.effort).toBe("high");
    expect(built).not.toHaveProperty("append");
    expect(built.env).toEqual({ A: "1", B: "2" });
  });

  it("gives the harness's own environment the last word over the operator's", () => {
    const built = buildSessionOptions(workerRoleConfig, ctx, { env: { A: "1", GIT_CONFIG_COUNT: "0" }, agent: { env: { GIT_CONFIG_COUNT: "9", B: "2" } }, harnessEnv: { GIT_CONFIG_COUNT: "1" } });
    expect(built.env).toEqual({ A: "1", B: "2", GIT_CONFIG_COUNT: "1" });
  });

  it("keeps the harness's own options whatever the agent options say", () => {
    const built = buildSessionOptions(workerRoleConfig, ctx, { agent: { cwd: "/elsewhere", permissionMode: "plan" } as never });
    expect(built.cwd).toBe(worktreePath);
    expect(built.permissionMode).toBe("bypassPermissions");
  });

  // The runtime hands the reply schema to the API as a tool's input schema. The API
  // refuses a root not typed as an object, or one carrying oneOf, anyOf or allOf,
  // failing every session at its first turn; the handshake test below stops before
  // that turn, so the contract is pinned here.
  const replies = {
    worker: [
      { status: "completed", rationale: "done" },
      { status: "escalate", category: "authority", rationale: "not mine to decide" },
    ],
    triage: [
      { status: "reroute", rationale: "r", payload: brief },
      { status: "escalate", rationale: "r", payload: { decision: "d", evidence: "e", dead_ends: "d", why_now: "w", references: [] } },
      { status: "fix_the_gate", rationale: "r", payload: brief },
      { status: "retry_close", rationale: "r", payload: brief },
      { status: "abort", rationale: "r", payload: { reason: "gone" } },
    ],
  };
  const apiSchemaCases = [
    { roleCfg: workerRoleConfig, valid: replies.worker },
    { roleCfg: gateMaintenanceRoleConfig, valid: replies.worker },
    { roleCfg: triageRoleConfig, valid: replies.triage },
  ];

  function apiSchemaOf(roleCfg: RoleConfig<unknown>) {
    const schema = buildSessionOptions(roleCfg, ctx, {}).outputFormat?.schema;
    if (!schema) throw new Error(`no reply schema for ${roleCfg.role}`);
    return schema;
  }

  it.each(apiSchemaCases)("gives the $roleCfg.role reply schema a root the API accepts", ({ roleCfg }) => {
    const schema = apiSchemaOf(roleCfg);
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema).not.toHaveProperty("allOf");
  });

  it.each(apiSchemaCases)("still lets the API accept every reply the $roleCfg.role may give", ({ roleCfg, valid }) => {
    const accepts = new Ajv({ strict: false }).compile(apiSchemaOf(roleCfg));
    for (const reply of valid) {
      expect(roleCfg.envelopeSchema.safeParse(reply).success).toBe(true);
      expect(accepts(reply), JSON.stringify(accepts.errors)).toBe(true);
    }
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
        options: buildSessionOptions(roleCfg, ctx, { env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home } }),
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
      usage: NO_COST,
    });
    expect(await readFile(join(worktreePath, ".env"), "utf-8")).toBe("PORT=8080\n");
  });
});

const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

describe("createAgentPort", () => {
  it("refuses a malformed triage config before any session is spawned", async () => {
    const port = createAgentPort({
      ...configs,
      triage: { ...triageRoleConfig, systemPromptFragment: "" },
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
        payload: brief,
      } },
      { json: { status: "completed", rationale: "done" } },
    ]);
    const port = createAgentPort(configs, useMock());

    const triaged = await port.invoke({ role: "triage" }, { ...ctx, sessionKey: "triage-0" });
    expect(triaged.status).toBe("reroute");
    expect(TriageEnvelope.safeParse(triaged).success).toBe(true);

    const worked = await port.invoke({ role: "worker" }, ctx);
    expect(worked).toEqual({ status: "completed", rationale: "done", usage: NO_COST });
  });
});

/** What the runtime reports when the API refuses a request for its rate, and for a spend cap: the API's own error bodies. */
const RATE_LIMITED = 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}';
const SPEND_CAPPED = 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Usage limit","details":{"error_code":"enforced_spend_limit_reached"}}}';

describe("a session stopped by a usage limit", () => {
  it("says the AI service is limiting requests, and marks the terminus so a caller can tell", async () => {
    await script([{ fail: { message: RATE_LIMITED } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: "worker session did not complete: the AI service is limiting requests",
      limit: "rate",
      usage: NO_COST,
    });
  });

  it("says the spending limit has been reached when that is what stopped it", async () => {
    await script([{ fail: { message: SPEND_CAPPED } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: "worker session did not complete: the spending limit has been reached",
      limit: "spend",
      usage: NO_COST,
    });
  });

  it("leaves any other error as an error, unmarked", async () => {
    await script([{ fail: { message: "TypeError: the session blew up while talking about a rate limit" } }]);
    expect(await invoke(workerRoleConfig, ctx, useMock())).toEqual({
      status: "incomplete",
      rationale: `worker session did not complete: ${DID_NOT_COMPLETE.errored}`,
      usage: NO_COST,
    });
  });

  it("keeps the service's own words beside the case file", async () => {
    await script([{ fail: { message: RATE_LIMITED } }]);
    await invoke(workerRoleConfig, ctx, useMock());
    expect(await readRef(dir, sessionErrorRef(ctx.sessionKey))).toEqual({
      sessionKey: "worker-1-0",
      role: "worker",
      reason: USAGE_LIMIT_WORDS.rate,
      cause: RATE_LIMITED,
    });
  });
});

describe("telling a usage limit from any other error", () => {
  it("reads what the runtime types before any text", () => {
    expect(usageLimitOf({ apiError: "rate_limit", status: null, text: "" })).toBe("rate");
    expect(usageLimitOf({ apiError: undefined, status: 429, text: "" })).toBe("rate");
    expect(usageLimitOf({ apiError: "billing_error", status: null, text: "" })).toBe("spend");
  });

  it("treats a spend cap, which is also a 429, as the spending limit", () => {
    expect(usageLimitOf({ apiError: "rate_limit", status: 429, text: SPEND_CAPPED })).toBe("spend");
  });

  it("is not a limit for an overloaded or failing service, nor for prose that mentions one", () => {
    expect(usageLimitOf({ apiError: "overloaded", status: 529, text: "Overloaded" })).toBeUndefined();
    expect(usageLimitOf({ apiError: "server_error", status: 500, text: "we hit the rate limit of our patience" })).toBeUndefined();
    expect(usageLimitOf({ apiError: undefined, status: undefined, text: "" })).toBeUndefined();
  });
});

describe("runSession: one session from a prompt the caller assembled, with no case file", () => {
  it("sends the prompt it is given and returns the validated envelope", async () => {
    const bare = await mkdtemp(join(tmpdir(), "run-session-"));
    await script([{ json: { status: "completed", rationale: "read the files" } }]);

    const terminus = await runSession(
      workerRoleConfig,
      { worktreePath, dir: bare, sessionKey: "scan-1" },
      { systemPrompt: "You read.", prompt: "Review the project." },
      useMock(),
    );

    expect(terminus).toEqual({ status: "completed", rationale: "read the files", usage: NO_COST });
    expect(promptsSent(await readJournal(journalPath))).toEqual(["Review the project."]);
  });

  it("keeps a failed session's cause in the folder it is given, as invoke keeps it beside a case file", async () => {
    const bare = await mkdtemp(join(tmpdir(), "run-session-"));
    await script([{ fail: { message: "the session blew up" } }]);

    const terminus = await runSession(workerRoleConfig, { worktreePath, dir: bare, sessionKey: "scan-1" }, { systemPrompt: "", prompt: "Review." }, useMock());

    expect(terminus.status).toBe("incomplete");
    expect(await readRef(bare, sessionErrorRef("scan-1"))).toMatchObject({ role: "worker", reason: DID_NOT_COMPLETE.errored });
  });

  it("refuses a malformed role before any session, as invoke does", async () => {
    const bare = await mkdtemp(join(tmpdir(), "run-session-"));
    await expect(
      runSession({ ...workerRoleConfig, systemPromptFragment: "" }, { worktreePath, dir: bare, sessionKey: "scan-1" }, { systemPrompt: "", prompt: "x" }, useMock()),
    ).rejects.toBeInstanceOf(InvalidRoleConfig);
  });
});

describe("the session a workflow step's agent gets", () => {
  const workflow = { name: "w", steps: [{ name: "plan", prompt: "p" }, { name: "build", prompt: "b", agent: { model: "opus" } }] };
  const record = (header: Partial<Parameters<typeof initialCaseFile>[0]>, history: HistoryEntry[] = []) => ({
    ...initialCaseFile({ surfaceId: "s", taskDef: { intent: "x" }, gateRef, ...header }, budgets),
    history,
  });

  it("lays the step's agent options over the project's", () => {
    const view = stepView(record({ workflow }, [{ t: "step", step: 2, startCommit: "c1" }]));
    expect(stepSession(view, { agent: { model: "sonnet", effort: "high" } }).agent).toEqual({ model: "opus", effort: "high" });
  });

  it("leaves a run with no workflow's agent options as they were", () => {
    const session = { agent: { model: "sonnet" } };
    expect(stepSession(record({}), session).agent).toBe(session.agent);
  });

  it("tells the session where the step started, so the agent can run the check it is shown", () => {
    const step2 = stepView(record({ workflow, startCommit: "c0" }, [{ t: "step", step: 2, startCommit: "c1" }]));
    expect(stepSession(step2, {}).harnessEnv).toMatchObject({ DELIVERY_STEP_START: "c1" });
    expect(stepSession(record({ startCommit: "c0" }), {}).harnessEnv).toMatchObject({ DELIVERY_STEP_START: "c0" });
    expect(stepSession(record({}), {}).harnessEnv).toBeUndefined();
  });
});
