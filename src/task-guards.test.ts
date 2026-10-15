import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDS, guardListsFor } from "./guards.js";
import { fixTaskFor } from "./packs/fix-task.js";
import { sampleFinding } from "./packs/review-fixtures.js";
import type { GateRef } from "./schema.js";
import { activeGuards, guardChanges, verifyOf } from "./task-guards.js";

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
