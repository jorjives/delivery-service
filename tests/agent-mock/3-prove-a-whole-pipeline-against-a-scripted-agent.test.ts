// Slice 3: Prove a Whole Pipeline Against a Scripted Agent
// Source: docs/superpowers/specs/2026-09-13-agent-mock-slices.md
// Recorded: 2026-09-14 against commit 404c8c0

//
// Drives the slice's UAT (npm run demo:mock-slice-3) and asserts on its printed
// result: one call running a real gate and real closer against a scripted worker,
// worker to gate to close, in a scratch repository, then a rerun whose trigger
// phrase has a typo.
//
// AC "a script written through the typed helpers produces the same file a
// hand-written script would" is unit-tested directly in src/mock-script.test.ts,
// which compares writeMockScript's output byte-for-byte against a hand-written
// JSON string; not duplicated here.

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf, REPO_ROOT } from "../helpers.js";
import { execFileSync } from "node:child_process";

const CREDENTIAL_ENV_NAMES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

describe("UAT: prove a whole pipeline against a scripted agent", () => {
  it("UAT: a script whose worker writes a change and reports completion is judged by the real gate and landed by the real closer", () => {
    const { stdout, status } = runTsx(["demos/agent-mock-slice-3-scripted-pipeline.ts"]);
    expect(status).toBe(0);
    const first = sectionOf(stdout, "--- 1. The script given to the agent", "--- 2.");
    expect(first).toContain("Surface finished:     CLOSED");
    expect(first).toContain("greeting.txt on main: hello");
  });

  it("AC: the journal shows the task's wording in the prompt the harness sent the worker, and the consumption check passes when everything was used", () => {
    const { stdout } = runTsx(["demos/agent-mock-slice-3-scripted-pipeline.ts"]);
    const second = sectionOf(stdout, "--- 2. What the harness sent the worker", "--- 3.");
    expect(second).toContain("add a greeting file that says hello");
    expect(second).toContain("The task's wording reached the worker: yes");
    expect(second).toContain("Consumption check passed: every scripted expectation was used.");
  });

  it("AC: a prompt matching nothing ends the run unclosed, and the consumption failure shows both the still-waiting expectation and the prompt that matched nothing", () => {
    const { stdout } = runTsx(["demos/agent-mock-slice-3-scripted-pipeline.ts"]);
    const third = sectionOf(stdout, "--- 3. The same run with a typo");
    expect(third).toContain("Surface finished:     ESCALATED");
    expect(third).toContain("greeting.txt on main: (not on main)");
    expect(third).toContain("Consumption check failed:");
    expect(third).toContain('expectation 0: waiting for a prompt containing "add a greting file"');
    expect(third).toContain("Prompts the harness sent that matched no expectation:");
    expect(third).toContain("add a greeting file that says hello");
  });

  it("AC: the run makes no network call and needs no API key", () => {
    // Strip every credential from the child's environment directly, rather than trusting
    // this machine to lack one, so the assertion holds even when run with a real key set.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIAL_ENV_NAMES.includes(name)));
    const stdout = execFileSync("npx", ["tsx", "demos/agent-mock-slice-3-scripted-pipeline.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env,
    });
    expect(stdout).toContain("Surface finished:     CLOSED");
  });
});
