// Slice 2: The Scripted Agent Is There After a Plain Install
// Source: docs/superpowers/specs/2026-09-13-agent-mock-slices.md
// Recorded: 2026-09-14 against commit a37e82b

//
// Drives the slice's UAT (npm run demo:agent-slice-1, on a checkout freshly reinstalled
// from the lockfile: `rm -rf node_modules && npm ci`) and asserts on its printed result,
// plus a codebase-wide grep invariant for the "every test and demo uses the helper"
// acceptance criteria. `npm ci` itself is not re-run inside this suite — doing so would
// rebuild node_modules out from under the running test process — so this file asserts the
// state a fresh install leaves behind (vendored files committed, no symlink, the demo
// working credential-free) rather than repeating the reinstall on every run.
//
// AC "one helper gives a test or demo a ready session pointed at the scripted agent, with
// its script and journal locations" and AC "if the scripted agent cannot be found, the
// helper fails with a sentence naming where it looked" are unit-tested directly in
// src/mock-session.test.ts, which drives mockSessionEnvironment and resolveMockExecutable
// against real and missing paths; not duplicated here.

import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { gitGrepFiles, runTsx, REPO_ROOT } from "../helpers.js";

const CREDENTIAL_ENV_NAMES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

describe("UAT: the scripted agent is there after a plain install", () => {
  it("AC: the vendored scripted agent is committed prebuilt, so `npm install` alone provides it", () => {
    const tracked = execFileSync("git", ["ls-files", ".npmrc", "vendor/README.md", "vendor/claude-mock/dist/cli.js"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    })
      .trim()
      .split("\n");
    expect(tracked.sort()).toEqual([".npmrc", "vendor/README.md", "vendor/claude-mock/dist/cli.js"]);
  });

  it("UAT: the worker invocation demo completes with a typed result instead of refusing for a missing tool", () => {
    const { stdout, status } = runTsx(["demos/agent-invocation-slice-1-worker-invocation.ts"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Result: completed — added the greeting endpoint and its handler");
    expect(stdout).not.toMatch(/not on PATH|MOCK_NOT_INSTALLED|was not found at/);
  });

  it("AC: a session driven through the helper needs no API key and makes no network call", () => {
    // Strip every credential from the child's environment directly, rather than trusting
    // this machine to lack one, so the assertion holds even when run with a real key set.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIAL_ENV_NAMES.includes(name)));
    const stdout = execFileSync("npx", ["tsx", "demos/agent-invocation-slice-1-worker-invocation.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env,
    });
    expect(stdout).toContain("Result: completed — added the greeting endpoint and its handler");
  });

  it("AC: no test, demo or guide names claude-mock as the bare executable or skips when it is not linked", () => {
    const scope = [
      "src",
      "demos",
      "tests",
      "docs/configuring-a-role.md",
      ":(exclude)tests/scripted-agent-reachability.test.ts",
      ":(exclude)tests/agent-mock/2-the-scripted-agent-is-there-after-a-plain-install.test.ts",
    ];
    expect(gitGrepFiles('pathToClaudeCodeExecutable: "claude-mock"', scope)).toEqual([]);
    expect(gitGrepFiles("isOnPath|mockMissing|claude-mock is not on PATH", scope)).toEqual([]);
  });
});
