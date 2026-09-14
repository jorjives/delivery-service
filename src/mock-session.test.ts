import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { create } from "./case-file.js";
import { invoke } from "./agent-invoke.js";
import { workerRoleConfig } from "./role-config.js";
import { MockNotInstalled } from "./errors.js";
import { resolveMockExecutable } from "./mock-session.js";
import { mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
import type { BudgetSet } from "./schema.js";

const REPO_ROOT = join(import.meta.dirname, "..");

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const paths = { scriptPath: "/tmp/run/mock.json", journalPath: "/tmp/run/journal.jsonl" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockSessionEnvironment", () => {
  it("points the session at the claude-mock npm install provides, by absolute path, never via PATH", () => {
    const session = mockSessionEnvironment(paths);
    expect(session.pathToClaudeCodeExecutable).toBe(join(REPO_ROOT, "node_modules/.bin/claude-mock"));
    expect(isAbsolute(session.pathToClaudeCodeExecutable ?? "")).toBe(true);
  });

  it("hands claude-mock its script and journal locations", () => {
    const { env } = mockSessionEnvironment(paths);
    expect(env?.CLAUDE_MOCK_SCRIPT).toBe(paths.scriptPath);
    expect(env?.CLAUDE_MOCK_JOURNAL).toBe(paths.journalPath);
  });

  it("keeps the caller's environment but carries no credentials into the session", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-reach-the-session");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "must-not-reach-the-session");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "must-not-reach-the-session");
    const { env } = mockSessionEnvironment(paths);
    expect(env?.PATH).toBe(process.env.PATH);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });
});

describe("when claude-mock cannot be found", () => {
  it("fails with a sentence naming where it looked and that npm install provides it", () => {
    const missing = join(tmpdir(), "no-such-checkout", "node_modules", ".bin", "claude-mock");
    expect(() => resolveMockExecutable(missing)).toThrow(MockNotInstalled);
    expect(() => resolveMockExecutable(missing)).toThrow(
      `claude-mock was not found at ${missing}. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.`,
    );
  });
});

describe("a session driven through the helper", () => {
  it("runs a real invocation to a typed result with no API key and records the turn in the journal", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-reach-the-session");
    const dir = await mkdtemp(join(tmpdir(), "mock-session-case-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "mock-session-tree-"));
    const scriptPath = join(dir, "mock.json");
    const journalPath = join(dir, "journal.jsonl");
    await create(
      dir,
      { surfaceId: "s-1", taskDef: { intent: "add a greeting" }, gateRef: { type: "command", command: "cat report.tap", parseMode: "tap" } },
      budgets,
    );
    await writeFile(scriptPath, JSON.stringify([{ json: { status: "completed", rationale: "added the greeting" } }]), "utf-8");

    const terminus = await invoke(
      workerRoleConfig,
      { worktreePath, dir, sessionKey: "worker-1-0" },
      mockSessionEnvironment({ scriptPath, journalPath }),
    );

    expect(terminus).toEqual({ status: "completed", rationale: "added the greeting" });
    expect(promptsSent(await readJournal(journalPath))[0]).toContain("add a greeting");
  });
});
