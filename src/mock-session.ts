import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionEnvironment } from "./agent-invoke.js";
import { MockNotInstalled } from "./errors.js";

/** Where `npm install` puts the vendored claude-mock's command (vendor/README.md). */
const INSTALLED_MOCK = join(import.meta.dirname, "..", "node_modules", ".bin", "claude-mock");

/**
 * Credentials a scripted session never needs. Leaving them out means a
 * mock-backed test proves it runs without a key, even on a machine that has one.
 */
const CREDENTIALS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]);

/** Where a scripted session reads its expectations and writes its journal. */
export interface MockSessionPaths {
  /** The expectations claude-mock replays, each consumed by the first prompt it matches. */
  scriptPath: string;
  /** Where claude-mock appends one JSON line per turn: the prompt sent, and what it consumed. */
  journalPath: string;
}

/** The installed claude-mock's absolute path, or a named error saying where it looked and how to get it. */
export function resolveMockExecutable(path = INSTALLED_MOCK): string {
  if (!existsSync(path)) throw new MockNotInstalled(path);
  return path;
}

/**
 * A session pointed at the vendored claude-mock instead of the real `claude`
 * CLI, for `invoke` or `createAgentPort`. The command is resolved by absolute
 * path from this checkout's `node_modules`, so nothing depends on `PATH` or on
 * a machine-local link. The session makes no network call and carries no
 * credentials.
 */
export function mockSessionEnvironment({ scriptPath, journalPath }: MockSessionPaths): SessionEnvironment {
  const pathToClaudeCodeExecutable = resolveMockExecutable();
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.has(name)));
  return {
    pathToClaudeCodeExecutable,
    env: { ...inherited, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath },
  };
}
