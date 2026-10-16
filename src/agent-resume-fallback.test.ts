import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, readRef } from "./case-file.js";
import { workerRoleConfig } from "./role-config.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

// What the real CLI does with a session id that no longer exists (spike: `claude -p --resume <unknown id>`, run from a
// scratch directory): it emits one result message with subtype `error_during_execution` and no turns, exits non-zero,
// and the SDK then throws on the stream. Either way the session ends with no usable result, which is the one
// signal the fallback acts on. These tests script both shapes through the SDK's `query`.
type Call = { prompt: string; resume: string | undefined };
const calls: Call[] = [];
let sessions: Array<() => AsyncGenerator<unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt, options }: { prompt: string; options: { resume?: string } }) => {
    calls.push({ prompt, resume: options.resume });
    return (sessions.shift() ?? nothing)();
  },
}));

const nothing = async function* (): AsyncGenerator<unknown> { yield* []; };
const throws = (message: string) => async function* (): AsyncGenerator<unknown> { yield* []; throw new Error(message); };
const succeeds = async function* (): AsyncGenerator<unknown> {
  yield { type: "result", subtype: "success", is_error: false, result: "", session_id: "fresh", total_cost_usd: 0, duration_ms: 1, structured_output: { status: "completed", rationale: "done" } };
};
const errors = async function* (): AsyncGenerator<unknown> {
  yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"], session_id: "alive", total_cost_usd: 0, duration_ms: 1 };
};

const { runSession, sessionErrorRef } = await import("./agent-invoke.js");

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 }, gateError: { used: 0, max: 3 }, gateMaintenance: { used: 0, max: 2 }, terminus: { used: 0, max: 5 }, close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "true", parseMode: "exitcode" };
const assembled = { systemPrompt: "system", prompt: "the same prompt" };
let ctx: AgentContext;

beforeEach(async () => {
  calls.length = 0;
  sessions = [];
  const dir = await mkdtemp(join(tmpdir(), "resume-fallback-case-"));
  await create(dir, { surfaceId: "s-1", taskDef: { intent: "x" }, gateRef }, budgets);
  ctx = { worktreePath: await mkdtemp(join(tmpdir(), "resume-fallback-tree-")), dir, sessionKey: "worker-1-0" };
});

describe("a resume that cannot be honoured", () => {
  it("runs the same prompt once more as a fresh session, and records that it did", async () => {
    sessions = [nothing, succeeds];
    const terminus = await runSession(workerRoleConfig, { ...ctx, resume: "gone" }, assembled, {});
    expect(calls.map((call) => call.resume)).toEqual(["gone", undefined]);
    expect(calls[1]?.prompt).toBe(calls[0]?.prompt);
    expect(terminus).toMatchObject({ status: "completed", resumeFellBack: true });
    expect(terminus).not.toHaveProperty("notRun");
  });

  it("does the same when the runtime throws on the resume", async () => {
    sessions = [throws("no conversation found"), succeeds];
    expect(await runSession(workerRoleConfig, { ...ctx, resume: "gone" }, assembled, {})).toMatchObject({ resumeFellBack: true });
  });

  it("keeps the failed resume's cause where a person can find it", async () => {
    sessions = [throws("no conversation found"), succeeds];
    await runSession(workerRoleConfig, { ...ctx, resume: "gone" }, assembled, {});
    expect(await readRef(ctx.dir, sessionErrorRef(ctx.sessionKey))).toMatchObject({ cause: "no conversation found" });
  });

  it("is an ordinary notRun when the fresh run also produces nothing", async () => {
    sessions = [nothing, nothing];
    expect(await runSession(workerRoleConfig, { ...ctx, resume: "gone" }, assembled, {})).toMatchObject({ status: "incomplete", notRun: true });
  });

  it("does not fall back when the resumed session returned an error result", async () => {
    sessions = [errors];
    const terminus = await runSession(workerRoleConfig, { ...ctx, resume: "alive" }, assembled, {});
    expect(calls).toHaveLength(1);
    expect(terminus).toMatchObject({ status: "incomplete" });
    expect(terminus).not.toHaveProperty("resumeFellBack");
  });

  it("never falls back for a session that was not asked to resume", async () => {
    sessions = [nothing];
    await runSession(workerRoleConfig, ctx, assembled, {});
    expect(calls).toHaveLength(1);
  });
});
