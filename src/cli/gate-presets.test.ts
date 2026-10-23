import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateRef } from "../schema.js";
import { resolveGate } from "../resolve-gate.js";
import { EXIT, Refusal } from "./failures.js";
import { COMMITS_AHEAD, GatePreset, isPreset, NO_TEST_COMMAND, PRESET_DETAILS, PRESET_NAMES, presetGate, presetPhrase } from "./gate-presets.js";
import { initTempRepo } from "../temp-repo.js";
import { cleanGitEnv } from "../git-env.js";
import { inferGate } from "./project.js";
import { computeDelta } from "../delta-rule.js";
import { countsNewAssertions } from "../schema.js";

/** A folder standing in for a repository, holding just the files given. */
function folder(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-presets-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const byExitCode = (command: string): GateRef => ({ type: "command", command, parseMode: "exitcode" });

describe("the ready-made checks", () => {
  it("are the four the roadmap names, in its order, then commits-ahead and fails-with-new-test", () => {
    expect(PRESET_NAMES).toEqual(["test-runner", "file-exists", "command-succeeds", "schema-validates", "commits-ahead", "fails-with-new-test"]);
  });

  it("can say, in plain words, what every detail each one takes is", () => {
    for (const option of GatePreset.options) {
      const takes = Object.keys(option.shape).filter((key) => key !== "type").sort();
      expect(Object.keys(PRESET_DETAILS[option.shape.type.value]).sort()).toEqual(takes);
    }
  });

  it("tells a ready-made check from a written-out one", () => {
    expect(isPreset({ type: "file-exists", path: "CHANGES.md" })).toBe(true);
    expect(isPreset({ type: "command", command: "npm test", parseMode: "exitcode" })).toBe(false);
    expect(isPreset({ type: "custom", modulePath: "./gates/mine.mjs" })).toBe(false);
  });
});

describe("what each ready-made check stands for", () => {
  it.each<[GatePreset, GateRef]>([
    [{ type: "test-runner", command: "npx vitest run" }, byExitCode("npx vitest run")],
    [{ type: "file-exists", path: "CHANGES.md" }, { type: "command", command: "test -f 'CHANGES.md'", parseMode: "exitcode", checkOnly: true }],
    [{ type: "command-succeeds", command: "npm run lint" }, byExitCode("npm run lint")],
    [{ type: "commits-ahead" }, { type: "command", command: COMMITS_AHEAD, parseMode: "exitcode", checkOnly: true }],
    [
      { type: "schema-validates", file: "data.json", schema: "data.schema.json" },
      byExitCode("npx --yes ajv-cli@5.0.0 validate -s 'data.schema.json' -d 'data.json'"),
    ],
  ])("%j is the written-out gate %j", async (preset, gateRef) => {
    expect(await presetGate(preset, folder())).toEqual(gateRef);
  });

  it("runs the project's own tests when test-runner names no command, exactly as the default check does", async () => {
    const repoPath = folder({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
    expect(await presetGate({ type: "test-runner" }, repoPath)).toEqual(await inferGate(repoPath));
  });

  it("refuses test-runner with no command in a project with no test script, naming the detail it needs", async () => {
    const err = await presetGate({ type: "test-runner" }, folder()).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Refusal);
    expect((err as Refusal).message).toBe(NO_TEST_COMMAND);
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
  });
});

describe("a ready-made check judges work as its written-out gate does", () => {
  it.each([["CHANGES.md"], ["it's the notes.md"]])("file-exists %j fails a check that finds no file, and passes once it is there", async (path) => {
    const worktreePath = folder();
    const gateRef = await presetGate({ type: "file-exists", path }, worktreePath);
    const gate = resolveGate(gateRef, worktreePath);
    const ctx = { worktreePath, taskDef: { intent: "add the file" }, gateRef };
    const baseline = await gate.baseline(ctx);
    expect(baseline).toEqual({ status: "PASS", assertions: [] });
    const missing = await gate.check(ctx);
    expect(computeDelta(baseline, missing, { failOnNewAssertions: countsNewAssertions(gateRef) }).pass).toBe(false);
    writeFileSync(join(worktreePath, path), "one line\n");
    const present = await gate.check(ctx);
    expect(computeDelta(baseline, present, { failOnNewAssertions: countsNewAssertions(gateRef) }).pass).toBe(true);
  });
});

describe("commits-ahead", () => {
  it("fails a check that finds no commit since the start, and passes once one is added", async () => {
    const worktreePath = initTempRepo("commits-ahead-", { "a.txt": "a\n" });
    const start = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf-8" }).trim();
    const gateRef = await presetGate({ type: "commits-ahead" }, worktreePath);
    const gate = resolveGate(gateRef, worktreePath);
    const ctx = { worktreePath, taskDef: { intent: "commit something" }, gateRef, env: { ...process.env, DELIVERY_STEP_START: start } };
    const baseline = await gate.baseline(ctx);
    const judge = async () => computeDelta(baseline, await gate.check(ctx), { failOnNewAssertions: countsNewAssertions(gateRef) }).pass;
    expect(await judge()).toBe(false);
    writeFileSync(join(worktreePath, "b.txt"), "b\n");
    execFileSync("git", ["add", "-A"], { cwd: worktreePath, env: cleanGitEnv() });
    execFileSync("git", ["commit", "-qm", "b"], { cwd: worktreePath, env: cleanGitEnv() });
    expect(await judge()).toBe(true);
  });

  it("is described in plain words", () => {
    expect(presetPhrase({ type: "commits-ahead" }, COMMITS_AHEAD)).toBe("checks that the work added at least one commit");
  });
});
