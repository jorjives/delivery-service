import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { computeDelta } from "../delta-rule.js";
import { resolveGate } from "../resolve-gate.js";
import { countsNewAssertions } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { presetGate, type GatePreset } from "./gate-presets.js";

const preset = { type: "fails-with-new-test", command: "sh run-tests.sh" } as unknown as GatePreset;

// A stand-in test runner: it fails while any file under tests/ says it fails.
const RUNNER = "! grep -rl 'fails' tests 2>/dev/null\n";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf-8" }).trim();

function commitFile(cwd: string, path: string, contents: string): void {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), contents);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", path);
}

describe("fails-with-new-test", () => {
  async function setUp() {
    const worktreePath = initTempRepo("fails-with-new-test-", { "run-tests.sh": RUNNER });
    const start = git(worktreePath, "rev-parse", "HEAD");
    const gateRef = await presetGate(preset, worktreePath);
    const gate = resolveGate(gateRef, worktreePath);
    const ctx = { worktreePath, taskDef: { intent: "reproduce the issue" }, gateRef, env: { ...process.env, DELIVERY_STEP_START: start } };
    const baseline = await gate.baseline(ctx);
    const judge = async () => computeDelta(baseline, await gate.check(ctx), { failOnNewAssertions: countsNewAssertions(gateRef) }).pass;
    return { worktreePath, judge };
  }

  it("fails when the step committed nothing", async () => {
    const { judge } = await setUp();
    expect(await judge()).toBe(false);
  });

  it("fails when the step committed no test file, even though the tests are unaffected", async () => {
    const { worktreePath, judge } = await setUp();
    commitFile(worktreePath, "notes.txt", "unrelated\n");
    expect(await judge()).toBe(false);
  });

  it("fails when the new test passes, so nothing is reproduced", async () => {
    const { worktreePath, judge } = await setUp();
    commitFile(worktreePath, "tests/ok.test.js", "passes\n");
    expect(await judge()).toBe(false);
  });

  it("passes when the step committed a test file and the tests now fail", async () => {
    const { worktreePath, judge } = await setUp();
    commitFile(worktreePath, "tests/new.test.js", "fails\n");
    expect(await judge()).toBe(true);
  });

  it("fails when the tests were already failing at the step's start", async () => {
    const worktreePath = initTempRepo("fails-with-new-test-", { "run-tests.sh": RUNNER, "tests/old.test.js": "fails\n" });
    const start = git(worktreePath, "rev-parse", "HEAD");
    const gateRef = await presetGate(preset, worktreePath);
    const gate = resolveGate(gateRef, worktreePath);
    const ctx = { worktreePath, taskDef: { intent: "reproduce the issue" }, gateRef, env: { ...process.env, DELIVERY_STEP_START: start } };
    const baseline = await gate.baseline(ctx);
    commitFile(worktreePath, "tests/new.test.js", "fails\n");
    expect(computeDelta(baseline, await gate.check(ctx), { failOnNewAssertions: countsNewAssertions(gateRef) }).pass).toBe(false);
  });
});
