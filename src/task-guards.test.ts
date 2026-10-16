import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GUARDS, guardListsFor } from "./guards.js";
import { fixTaskFor } from "./packs/fix-task.js";
import { sampleFinding } from "./packs/review-fixtures.js";
import type { GateRef } from "./schema.js";
import { activeGuards, guardChanges, verifyOf, guardedGate } from "./task-guards.js";
import type { Gate, GateContext } from "./command-gate.js";
import { initTempRepo } from "./temp-repo.js";
import { git } from "../tests/helpers.js";

const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const PROJECT_TESTS: GateRef = { type: "command", command: "node --test", parseMode: "exitcode" };
const ALL = ["tests-untouched", "tests-unchanged", "check-untouched", "no-skips", "ignored"];

describe("the guards a task's run is judged by", () => {
  it("are the defaults for a task that names none", () => {
    expect(activeGuards({ intent: "add a page" })).toEqual({ lists: DEFAULT_GUARDS, on: ["tests-untouched", "check-untouched", "no-skips", "ignored"] });
    expect(guardChanges({ intent: "add a page" })).toBeNull();
  });

  it("add and turn off by name, in a fixed order, and the change from the defaults is told", () => {
    const task = { intent: "tidy the tests", guards: { add: ["tests-unchanged"], off: ["no-skips"] } };
    expect(activeGuards(task).on).toEqual(["tests-untouched", "tests-unchanged", "check-untouched", "ignored"]);
    expect(guardChanges(task)).toEqual({ added: ["tests-unchanged"], off: ["no-skips"] });
  });

  it("are every guard, by the fix's own lists, for the fix of a problem a review found", () => {
    const lists = guardListsFor({ testGlobs: ["e2e/**"], protectedGlobs: [], skipMarkers: [] });
    const task = fixTaskFor("code", sampleFinding(), PROJECT_TESTS, { ...lists, testsCategory: false });
    expect(activeGuards(task)).toEqual({ lists, on: ALL });
  });

  it("let a fix change an existing test when the problem is in a test or the owner allowed it, never delete one", () => {
    const inTests = fixTaskFor("code", sampleFinding(), PROJECT_TESTS, { ...DEFAULT_GUARDS, testsCategory: true });
    const allowed = fixTaskFor("code", sampleFinding(), PROJECT_TESTS, { ...DEFAULT_GUARDS, testsCategory: false }, { hold: true, landing: { type: "merge-back" }, allowTestEdits: true });
    for (const task of [inTests, allowed]) expect(activeGuards(task).on).toEqual(ALL.filter((name) => name !== "tests-unchanged"));
  });

  it("judge a fix authorised before guards travelled with it by the harness's own lists", () => {
    expect(activeGuards(fixTaskFor("code", sampleFinding(), PROJECT_TESTS)).lists).toEqual(DEFAULT_GUARDS);
  });
});

describe("the check whose files the guards protect", () => {
  it("is the run's own gate, or the project's check a fix wraps", () => {
    expect(verifyOf({ intent: "add a page" }, NPM)).toEqual(NPM);
    expect(verifyOf(fixTaskFor("code", sampleFinding(), PROJECT_TESTS), NPM)).toEqual(PROJECT_TESTS);
    expect(verifyOf(fixTaskFor("code", sampleFinding(), null), NPM)).toBeNull();
  });
});

describe("a gate joined to the guards", () => {
  const passing: Gate = { baseline: async () => ({ status: "PASS", assertions: [] }), check: async () => ({ status: "PASS", assertions: [] }) };
  const broken: Gate = { ...passing, check: async () => ({ status: "ERROR", assertions: [], detail: "could not run" }) };
  const ctxOf = (worktreePath: string): GateContext => ({ worktreePath, taskDef: { intent: "x" }, gateRef: NPM });

  it("fails, with the guard's finding, when the check could not run but a guard failed", async () => {
    const repo = initTempRepo("task-guards-", { "a.test.js": "test\n" });
    const start = git(repo, ["rev-parse", "HEAD"]);
    rmSync(join(repo, "a.test.js"));
    const report = await guardedGate(broken, { commit: start }).check(ctxOf(repo));
    expect(report.status).toBe("FAIL");
    // Every active guard reports, pass or fail (guardAssertions), so the joined
    // report carries all of them; what matters here is that the one that failed is among them.
    expect(report.assertions.map((a) => a.id)).toContain("guard:tests-untouched");
  });

  it("is an error, never a pass, when the guards cannot be worked out", async () => {
    const notGit = mkdtempSync(join(tmpdir(), "task-guards-"));
    expect((await guardedGate(passing, { commit: "HEAD" }).check(ctxOf(notGit))).status).toBe("ERROR");
  });

  it("judges from where the work branched, for a record that pinned only its base branch", async () => {
    const repo = initTempRepo("task-guards-", { "a.test.js": "test\n" });
    git(repo, ["checkout", "-qb", "work"]);
    rmSync(join(repo, "a.test.js"));
    expect((await guardedGate(passing, { branch: "main" }).check(ctxOf(repo))).status).toBe("FAIL");
  });
});

describe("a workflow step's guards", () => {
  it("adds and turns off guards for the step, over the task's own", () => {
    const { on } = activeGuards({ intent: "x", guards: { off: ["ignored"] } }, { add: ["tests-unchanged"], off: ["no-skips"] });
    expect(on).toEqual(["tests-untouched", "tests-unchanged", "check-untouched"]);
  });

  it("leaves the task's guards alone when the step changes none", () => {
    expect(activeGuards({ intent: "x" }, undefined)).toEqual(activeGuards({ intent: "x" }));
  });

  it("reports the step's changes from the defaults", () => {
    expect(guardChanges({ intent: "x" }, { add: ["tests-unchanged"] })).toEqual({ added: ["tests-unchanged"], off: [] });
  });
});
