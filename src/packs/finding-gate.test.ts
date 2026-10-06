// src/packs/finding-gate.test.ts
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateContext } from "../command-gate.js";
import { loadCustomGate } from "../custom-gate.js";
import { computeDelta } from "../delta-rule.js";
import type { GateRef } from "../schema.js";
import findingGate, { FINDING_GATE_MODULE, FINDING_GATE_REF, findingAssertion } from "./finding-gate.js";
import { FixTask, fixTaskFor } from "./fix-task.js";
import { CHECK_GUARD, DEFAULT_GUARDS, EDIT_GUARD, ignoredId, SKIP_GUARD, TESTS_GUARD, type Guards } from "./guards.js";
import { exampleRepo, sampleFinding } from "./review-fixtures.js";

const TESTS: GateRef = { type: "command", command: "node --test", parseMode: "exitcode" };
const NEGATIVE = sampleFinding();
const GUARDS: Guards = { ...DEFAULT_GUARDS, testsCategory: false };
const ctxFor = (worktreePath: string, finding = NEGATIVE, verify: GateRef = TESTS, guards: Guards | undefined = GUARDS): GateContext => ({
  worktreePath,
  taskDef: fixTaskFor("code", finding, verify, guards),
  gateRef: FINDING_GATE_REF,
  baseBranch: "main",
});
const edit = (repo: string, from: string, to: string): void =>
  writeFileSync(join(repo, "checkout.js"), readFileSync(join(repo, "checkout.js"), "utf-8").replace(from, to));
const resolvedOf = (report: { assertions: { id: string; outcome: string }[] }) => report.assertions.find((a) => a.id === findingAssertion(NEGATIVE.id))?.outcome;
const HONEST = "return Math.max(0, price - discount);";
const failing = (report: { assertions: { id: string; outcome: string }[] }) => report.assertions.filter((a) => a.outcome === "FAIL").map((a) => a.id);

describe("a fix task", () => {
  it("is named for the problem and its file, and carries the problem, its tags and the project check it is judged by", () => {
    expect(fixTaskFor("code", NEGATIVE, TESTS, GUARDS)).toEqual({
      intent: "Fix: The price shown at checkout can be negative (checkout.js)",
      tags: { pack: "code", findingId: NEGATIVE.id, severity: "high", phase: "fix" },
      finding: NEGATIVE,
      guards: GUARDS,
      authorisation: { verify: TESTS },
    });
  });

  it("carries no guards when none were authorised, so a fix authorised earlier keeps its identity", () => {
    expect(fixTaskFor("code", NEGATIVE, TESTS)).not.toHaveProperty("guards");
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

const EXITCODE: GateRef = { type: "command", command: "node --test", parseMode: "exitcode" };
const TAP: GateRef = { type: "command", command: "node --test --test-reporter=tap", parseMode: "tap" };

describe.each([["only pass or fail as a whole", EXITCODE], ["each test's own result", TAP]])("a fix that weakens the tests, when the tests report %s", (_, verify) => {
  const judge = async (cheat: (repo: string) => void, guards: Guards = GUARDS) => {
    const repo = exampleRepo("finding-gate-cheat-");
    const baseline = await findingGate.baseline(ctxFor(repo, NEGATIVE, verify, guards));
    edit(repo, "return price - discount;", HONEST);
    cheat(repo);
    const check = await findingGate.check(ctxFor(repo, NEGATIVE, verify, guards));
    return { check, delta: computeDelta(baseline, check, { failOnNewAssertions: true }) };
  };

  it("is refused for deleting a test file", async () => {
    const { check, delta } = await judge((repo) => rmSync(join(repo, "checkout.test.js")));
    expect(failing(check)).toEqual([TESTS_GUARD]);
    expect(delta.pass).toBe(false);
    expect(delta.newFailures.map((f) => f.id)).toContain(TESTS_GUARD);
  });

  it("is refused for changing a test file, and allowed to add one", async () => {
    expect((await judge((repo) => writeFileSync(join(repo, "checkout.test.js"), "// nothing to see\n"))).delta.pass).toBe(false);
    expect((await judge((repo) => writeFileSync(join(repo, "clamp.test.js"), "import { test } from 'node:test';\ntest('never below zero', () => {});\n"))).delta.pass).toBe(true);
  });

  it("is refused for skipping a test", async () => {
    const { check } = await judge((repo) => writeFileSync(join(repo, "checkout.test.js"), readFileSync(join(repo, "checkout.test.js"), "utf-8").replace("test(", "test.skip(")));
    expect(failing(check)).toEqual([EDIT_GUARD, SKIP_GUARD]);
  });

  it("is refused for hiding a test-runner config from git, however it was hidden", async () => {
    const { check, delta } = await judge((repo) => {
      appendFileSync(join(repo, ".git", "info", "exclude"), "vitest.config.ts\n");
      writeFileSync(join(repo, "vitest.config.ts"), "export default { test: { exclude: ['**'] } };\n");
    });
    expect(failing(check)).toEqual([ignoredId("vitest.config.ts")]);
    expect(delta.pass).toBe(false);
  });

  it("is refused for an ignored test file that switches the other tests off", async () => {
    const { check } = await judge((repo) => {
      appendFileSync(join(repo, ".gitignore"), "only.test.js\n");
      writeFileSync(join(repo, "only.test.js"), "import { test } from 'node:test';\ntest.only('all', () => {});\n");
    });
    expect(failing(check)).toEqual([CHECK_GUARD, ignoredId("only.test.js")]);
  });

  it("is refused for changing the test command", async () => {
    const { check } = await judge((repo) => writeFileSync(join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test || true" } })));
    expect(failing(check)).toEqual([CHECK_GUARD]);
  });

  it("for a problem whose fix changes tests, is allowed to change a test but not to delete one", async () => {
    const tests = { ...GUARDS, testsCategory: true };
    expect((await judge((repo) => writeFileSync(join(repo, "checkout.test.js"), readFileSync(join(repo, "checkout.test.js"), "utf-8").replace("7", "7 /* exact */")), tests)).delta.pass).toBe(true);
    expect((await judge((repo) => rmSync(join(repo, "checkout.test.js")), tests)).delta.pass).toBe(false);
  });
});

it("allows an honest fix that adds a new test, when the project's check leaves a compiled copy of it where git ignores it, round after round", async () => {
  const repo = exampleRepo("finding-gate-");
  appendFileSync(join(repo, ".git", "info", "exclude"), "dist/\n");
  // The check builds the project into an ignored folder and runs the tests there too, as a compiled project does.
  const BUILDS: GateRef = { type: "command", command: "mkdir -p dist && cp *.js dist/ && node --test", parseMode: "exitcode" };
  const baseline = await findingGate.baseline(ctxFor(repo, NEGATIVE, BUILDS));
  edit(repo, "return price - discount;", HONEST);
  writeFileSync(join(repo, "clamp.test.js"), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from './checkout.js';\ntest('never below zero', () => assert.equal(total(3, 10), 0));\n");
  const first = await findingGate.check(ctxFor(repo, NEGATIVE, BUILDS)); // its run writes dist/clamp.test.js, as a refused round's run or the agent's own would
  expect(existsSync(join(repo, "dist", "clamp.test.js"))).toBe(true);
  const second = await findingGate.check(ctxFor(repo, NEGATIVE, BUILDS));
  for (const check of [first, second]) expect(computeDelta(baseline, check, { failOnNewAssertions: true }).pass).toBe(true);
  expect(failing(second)).toEqual([]);
});

it("tolerates an ignored file that matches a guarded path when it was already there at baseline, and refuses a new one", async () => {
  const repo = exampleRepo("finding-gate-");
  appendFileSync(join(repo, ".git", "info", "exclude"), "*.config.*\n");
  writeFileSync(join(repo, "jest.config.js"), "module.exports = {};\n"); // what the project's own tooling left behind
  const baseline = await findingGate.baseline(ctxFor(repo));
  expect(baseline.assertions.map((a) => a.id)).toContain(ignoredId("jest.config.js"));
  edit(repo, "return price - discount;", HONEST);
  writeFileSync(join(repo, "vitest.config.ts"), "export default {};\n");
  const delta = computeDelta(baseline, await findingGate.check(ctxFor(repo)), { failOnNewAssertions: true });
  expect(delta.newFailures.map((f) => f.id)).toEqual([ignoredId("vitest.config.ts")]);
});

it("guards a problem that is tests only too", async () => {
  const repo = exampleRepo("finding-gate-");
  rmSync(join(repo, "checkout.test.js"));
  expect(failing(await findingGate.check(ctxFor(repo, sampleFinding({ check: { kind: "none" } }))))).toEqual([TESTS_GUARD]);
});

it("judges a fix authorised before guards travelled with it by the harness's own lists", async () => {
  const repo = exampleRepo("finding-gate-");
  rmSync(join(repo, "checkout.test.js"));
  expect(failing(await findingGate.check(ctxFor(repo, NEGATIVE, TESTS, undefined)))).toContain(TESTS_GUARD);
});

it.each([
  ["a check that cannot run", (repo: string) => ctxFor(repo, sampleFinding({ check: { kind: "pattern-absent", pattern: "(", paths: ["checkout.js"] } }))],
  ["a task that is not a fix", (repo: string): GateContext => ({ worktreePath: repo, taskDef: { intent: "add a page" }, gateRef: FINDING_GATE_REF })],
  ["a project check of its own not pinned by its full path", (repo: string) => ctxFor(repo, NEGATIVE, { type: "custom", modulePath: "./gate.mjs" })],
  ["a run that recorded no base branch", (repo: string): GateContext => ({ ...ctxFor(repo), baseBranch: null })],
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
