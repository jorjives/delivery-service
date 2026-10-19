import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GUARDS } from "./guards.js";
import type { GateRef } from "./schema.js";
import { activeGuards, guardChanges, guardedGate } from "./task-guards.js";
import type { Gate, GateContext } from "./command-gate.js";
import { initTempRepo } from "./temp-repo.js";
import { isItemAssertion } from "./item-check.js";
import { git } from "../tests/helpers.js";

const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const DEFAULT_ON = ["tests-untouched", "check-untouched", "no-skips", "ignored", "backlog"];

describe("the guards a task's run is judged by", () => {
  it("are the defaults for a task that names none", () => {
    expect(activeGuards({ intent: "add a page" })).toEqual({ lists: DEFAULT_GUARDS, on: ["tests-untouched", "check-untouched", "no-skips", "ignored", "backlog"] });
    expect(guardChanges({ intent: "add a page" })).toBeNull();
  });

  it("add and turn off by name, in a fixed order, and the change from the defaults is told", () => {
    const task = { intent: "tidy the tests", guards: { add: ["tests-unchanged"], off: ["no-skips"] } };
    expect(activeGuards(task).on).toEqual(["tests-untouched", "tests-unchanged", "check-untouched", "ignored", "backlog"]);
    expect(guardChanges(task)).toEqual({ added: ["tests-unchanged"], off: ["no-skips"] });
  });

  it("judges a task carrying a fix authorisation by the defaults, like any other task", () => {
    expect(activeGuards({ intent: "x", authorisation: { allowTestEdits: true } }).on).toEqual(DEFAULT_ON);
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

});

describe("a workflow step's guards", () => {
  it("adds and turns off guards for the step, over the task's own", () => {
    const { on } = activeGuards({ intent: "x", guards: { off: ["ignored"] } }, { add: ["tests-unchanged"], off: ["no-skips"] });
    expect(on).toEqual(["tests-untouched", "tests-unchanged", "check-untouched", "backlog"]);
  });

  it("leaves the task's guards alone when the step changes none", () => {
    expect(activeGuards({ intent: "x" }, undefined)).toEqual(activeGuards({ intent: "x" }));
  });

  it("reports the step's changes from the defaults", () => {
    expect(guardChanges({ intent: "x" }, { add: ["tests-unchanged"] })).toEqual({ added: ["tests-unchanged"], off: [] });
  });
});

describe("an item's check joins the gate", () => {
  const passing: Gate = { baseline: async () => ({ status: "PASS", assertions: [] }), check: async () => ({ status: "PASS", assertions: [] }) };
  const check = { kind: "anchor-gone", path: "total.js", anchor: "return price - discount;" } as const;

  it("fails while the problem is there, and passes once it is gone", async () => {
    const repo = initTempRepo("item-gate-", { "total.js": "export const total = (price, discount) => {\n  return price - discount;\n};\n" });
    const start = git(repo, ["rev-parse", "HEAD"]);
    const gate = guardedGate(passing, { commit: start });
    const ctx = { worktreePath: repo, taskDef: { intent: "x", check }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } as const, itemId: "20261019T120000Z-total.md" };
    const before = await gate.check(ctx);
    expect(before.status).toBe("FAIL");
    expect(before.assertions.find((a) => a.id === "item:20261019T120000Z-total.md:resolved")).toMatchObject({ outcome: "FAIL", detail: expect.stringContaining("still there") });
    writeFileSync(join(repo, "total.js"), "export const total = (price, discount) => Math.max(0, price - discount);\n");
    expect((await gate.check(ctx)).assertions.find((a) => a.id === "item:20261019T120000Z-total.md:resolved")?.outcome).toBe("PASS");
  });

  it("fails, never passes, when the task's check cannot be read", async () => {
    const repo = initTempRepo("item-gate-bad-", { "a.js": "x\n" });
    const gate = guardedGate(passing, { commit: git(repo, ["rev-parse", "HEAD"]) });
    const report = await gate.check({ worktreePath: repo, taskDef: { intent: "x", check: { kind: "tests-pass" } }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } });
    expect(report.assertions.find((a) => a.id === "item:task:resolved")?.outcome).toBe("FAIL");
  });

  it("adds nothing for a task with no check", async () => {
    const repo = initTempRepo("item-gate-none-", { "a.js": "x\n" });
    const gate = guardedGate(passing, { commit: git(repo, ["rev-parse", "HEAD"]) });
    const report = await gate.check({ worktreePath: repo, taskDef: { intent: "x" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } });
    expect(report.assertions.some((a) => isItemAssertion(a.id))).toBe(false);
  });
});
