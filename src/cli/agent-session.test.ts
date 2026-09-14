import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMockExecutable } from "../mock-session.js";
import { EXIT, Refusal } from "./failures.js";
import {
  agentSession,
  NO_RUNTIME,
  NOT_SIGNED_IN,
  preflight,
  resolveRuntime,
  runtimeCandidates,
  TEST_MOCK_SCRIPT,
} from "./agent-session.js";

const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

/** This process's environment with no credential and an empty Claude Code config folder: a machine nobody signed in on. */
function signedOutEnv(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "agent-session-home-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.includes(name)));
  return { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
}

/** A stand-in runtime: a shell script that prints `stdout` and exits with `code` for any arguments. */
function fakeRuntime(stdout: string, code: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "agent-session-runtime-")), "claude");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("runtimeCandidates", () => {
  it("names the SDK's binary package for this platform", () => {
    expect(runtimeCandidates({ platform: "darwin", arch: "arm64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    ]);
    expect(runtimeCandidates({ platform: "win32", arch: "x64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
    ]);
  });

  it("tries the matching C library's build first on Linux, then the other", () => {
    expect(runtimeCandidates({ platform: "linux", arch: "x64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
      "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
    ]);
    expect(runtimeCandidates({ platform: "linux", arch: "arm64", musl: true })).toEqual([
      "@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude",
      "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
    ]);
  });
});

describe("resolveRuntime", () => {
  it("finds the binary the installed SDK ships for this machine", () => {
    const runtime = resolveRuntime();
    expect(runtime).toBeDefined();
    expect(existsSync(runtime ?? "")).toBe(true);
  });

  it("is undefined when no candidate package is installed", () => {
    const missing = (id: string): string => {
      throw new Error(`Cannot find module '${id}'`);
    };
    expect(resolveRuntime(missing)).toBeUndefined();
  });
});

describe("preflight", () => {
  it("refuses when there is no runtime, naming it and the fix", async () => {
    const refusal = await refusalOf(preflight(undefined, process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
    expect(refusal.exitCode).toBe(EXIT.agentRuntime);
  });

  it("refuses a runtime that will not start", async () => {
    const refusal = await refusalOf(preflight(join(tmpdir(), "agent-session-no-such-binary"), process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
  });

  it("refuses a runtime that answers with something unreadable", async () => {
    const refusal = await refusalOf(preflight(fakeRuntime("not json", 0), process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
  });

  it("refuses a signed-out runtime, naming sign-in and the fix", async () => {
    const refusal = await refusalOf(preflight(fakeRuntime('{"loggedIn": false}', 1), process.env));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
    expect(refusal.exitCode).toBe(EXIT.agentRuntime);
  });

  it("passes a signed-in runtime and returns its path", async () => {
    const runtime = fakeRuntime('{"loggedIn": true, "authMethod": "api_key"}', 0);
    expect(await preflight(runtime, process.env)).toBe(runtime);
  });

  it("reads sign-in from the real runtime: with no credential and no stored login it is signed out", async () => {
    const refusal = await refusalOf(preflight(resolveRuntime(), signedOutEnv()));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
  });
});

describe("agentSession", () => {
  it("routes to the vendored scripted agent when the contributor test seam names a script, skipping the preflight", async () => {
    const session = await agentSession({ ...signedOutEnv(), [TEST_MOCK_SCRIPT]: "/tmp/run/mock.json" });
    expect(session.pathToClaudeCodeExecutable).toBe(resolveMockExecutable());
    expect(session.env?.CLAUDE_MOCK_SCRIPT).toBe("/tmp/run/mock.json");
    expect(session.env?.CLAUDE_MOCK_JOURNAL).toBe("/tmp/run/mock.json.journal.jsonl");
  });

  it("runs the preflight for a real session", async () => {
    const refusal = await refusalOf(agentSession(signedOutEnv()));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
  });
});
