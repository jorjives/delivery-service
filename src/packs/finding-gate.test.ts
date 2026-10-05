// src/packs/finding-gate.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateContext } from "../command-gate.js";
import { loadCustomGate } from "../custom-gate.js";
import { computeDelta } from "../delta-rule.js";
import type { GateRef } from "../schema.js";
import findingGate, { FINDING_GATE_MODULE, FINDING_GATE_REF, findingAssertion } from "./finding-gate.js";
import { FixTask, fixTaskFor } from "./fix-task.js";
import { exampleRepo, sampleFinding } from "./review-fixtures.js";

const TESTS: GateRef = { type: "command", command: "node --test", parseMode: "exitcode" };
const NEGATIVE = sampleFinding();
const ctxFor = (worktreePath: string, finding = NEGATIVE, verify: GateRef = TESTS): GateContext => ({ worktreePath, taskDef: fixTaskFor("code", finding, verify), gateRef: FINDING_GATE_REF });
const edit = (repo: string, from: string, to: string): void =>
  writeFileSync(join(repo, "checkout.js"), readFileSync(join(repo, "checkout.js"), "utf-8").replace(from, to));
const resolvedOf = (report: { assertions: { id: string; outcome: string }[] }) => report.assertions.find((a) => a.id === findingAssertion(NEGATIVE.id))?.outcome;

describe("a fix task", () => {
  it("is named for the problem and its file, and carries the problem, its tags and the project check it is judged by", () => {
    expect(fixTaskFor("code", NEGATIVE, TESTS)).toEqual({
      intent: "Fix: The price shown at checkout can be negative (checkout.js)",
      tags: { pack: "code", findingId: NEGATIVE.id, severity: "high", phase: "fix" },
      finding: NEGATIVE,
      authorisation: { verify: TESTS },
    });
  });

  it("reads back from a run's record exactly as it was written, so the queue recognises it", () => {
    const task = fixTaskFor("code", NEGATIVE, TESTS);
    expect(FixTask.parse(JSON.parse(JSON.stringify(task)))).toStrictEqual(task);
  });
});

describe("the check a fix is judged by", () => {
  it("is pinned as a module of the harness's own, counting a new failure", () => {
    expect(FINDING_GATE_REF).toEqual({ type: "custom", modulePath: FINDING_GATE_MODULE, failOnNewAssertions: true });
  });

  it("passes a fix that removes the flagged code and keeps every test passing", async () => {
    const repo = exampleRepo("finding-gate-");
    const baseline = await findingGate.baseline(ctxFor(repo));
    expect(resolvedOf(baseline)).toBeUndefined();
    edit(repo, "return price - discount;", "return Math.max(0, price - discount);");
    const check = await findingGate.check(ctxFor(repo));
    expect(resolvedOf(check)).toBe("PASS");
    expect(computeDelta(baseline, check, { failOnNewAssertions: true }).pass).toBe(true);
  });

  it.each([
    ["left in place", "return price - discount;"],
    ["commented out", "/* return price - discount; */ return Math.max(0, price - discount);"],
  ])("fails a fix that leaves the flagged code %s", async (_, replacement) => {
    const repo = exampleRepo("finding-gate-");
    const baseline = await findingGate.baseline(ctxFor(repo));
    edit(repo, "return price - discount;", replacement);
    const check = await findingGate.check(ctxFor(repo));
    expect(resolvedOf(check)).toBe("FAIL");
    expect(computeDelta(baseline, check, { failOnNewAssertions: true })).toMatchObject({ pass: false, class: "fail" });
  });

  it("fails a fix that removes the flagged code but breaks a test that passed before", async () => {
    const repo = exampleRepo("finding-gate-");
    const baseline = await findingGate.baseline(ctxFor(repo));
    edit(repo, "return price - discount;", "return price + discount;");
    const check = await findingGate.check(ctxFor(repo));
    expect(resolvedOf(check)).toBe("PASS");
    expect(computeDelta(baseline, check, { failOnNewAssertions: true }).pass).toBe(false);
  });

  it("adds no check of its own for a problem that is tests only", async () => {
    const repo = exampleRepo("finding-gate-");
    const testsOnly = sampleFinding({ check: { kind: "none" } });
    const check = await findingGate.check(ctxFor(repo, testsOnly));
    expect(check.assertions.map((a) => a.id)).not.toContain(findingAssertion(testsOnly.id));
  });

  it.each([
    ["a check that cannot run", (repo: string) => ctxFor(repo, sampleFinding({ check: { kind: "pattern-absent", pattern: "(", paths: ["checkout.js"] } }))],
    ["a task that is not a fix", (repo: string): GateContext => ({ worktreePath: repo, taskDef: { intent: "add a page" }, gateRef: FINDING_GATE_REF })],
    ["a project check of its own not pinned by its full path", (repo: string) => ctxFor(repo, NEGATIVE, { type: "custom", modulePath: "./gate.mjs" })],
  ])("is a problem with the check, never a pass, for %s", async (_, ctxOf) => {
    const repo = exampleRepo("finding-gate-");
    expect((await findingGate.check(ctxOf(repo))).status).toBe("ERROR");
  });

  it("loads as any custom check is loaded, from its own path", async () => {
    const repo = exampleRepo("finding-gate-");
    const gate = await loadCustomGate(repo, FINDING_GATE_MODULE);
    expect((await gate.baseline(ctxFor(repo))).status).toBe("PASS");
  });
});
