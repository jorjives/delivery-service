// Slice 3: A Fix That Weakens the Tests Is Refused
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-06 against commit c70c237
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent
// (no network, no sign-in). The scripted agent cheats; the harness must refuse.
// Skipped below, each with its reason: pack-added skip markers and "tests"-category
// problems (no pack in the repo declares them), and a project whose tests report
// only pass or fail as a whole (the example's runner reports individual results).

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockExpectation, type MockScript } from "../../src/mock-script.js";
import { CHEATING_FIXES, EXAMPLE_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const FIX_TIMEOUT = 120_000;
const NEGATIVE = "The price shown at checkout can be negative";
const REJECTED = "The agent's fix was rejected because it removed or skipped existing tests.";
const CLAMP = { edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } };
const TEST_FILE = "checkout.test.js";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-3-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

/** Review the example, approve the named problems, run `delivery fix` with `script`. */
async function fixWith(script: MockScript, approve: string[] = ["1"]) {
  const repo = exampleRepo("uat-packs-3-");
  expect(runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) }).status).toBe(0);
  expect(runDelivery(["findings", "approve", ...approve], { cwd: repo }).status).toBe(0);
  const fix = runDelivery(["fix"], { cwd: repo, env: await envFor(script) });
  return { repo, fix, findings: runDelivery(["findings"], { cwd: repo }).stdout };
}

/** One cheating fix for problem 1; told it was refused, the agent gives up. */
const cheatOn = (...effects: NonNullable<MockExpectation["effects"]>): MockScript => ({
  expectations: [
    { when: { promptContains: "\n- guard:" }, json: { status: "escalate", category: "authority", rationale: "The tests would have to change." } },
    { when: { promptContains: NEGATIVE }, effects: [CLAMP, ...effects], json: { status: "completed", rationale: "fixed" } },
  ],
});

const expectRefused = ({ repo, findings }: { repo: string; findings: string }) => {
  expect(findings).toContain(`1. ${NEGATIVE} (high): could not be fixed`);
  expect(findings).toContain(REJECTED);
  expect(findings).not.toContain("fixed and merged");
  expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("return price - discount;");
  expect(git(repo, ["status", "--porcelain"])).toBe("");
  expect(git(repo, ["log", "--oneline"]).split("\n")).toHaveLength(1);
};

describe("UAT: cheating fixes are refused and none is shown as fixed or merged", () => {
  it(
    "refuses the delete, the skip with a changed test command, and the test edit, and says why",
    async () => {
      const result = await fixWith(CHEATING_FIXES, ["--all"]);
      expect(result.fix.stdout).toMatch(/fixing 3 problems/i);
      expect(result.findings).toContain(`1. ${NEGATIVE} (high): could not be fixed`);
      expect(result.findings).toMatch(/2\. .*\(medium\): could not be fixed/);
      expect(result.findings).toMatch(/3\. .*\(low\): could not be fixed/);
      expect(result.findings.split(REJECTED)).toHaveLength(4);
      expect(result.findings).not.toContain("fixed and merged");
      expect(readFileSync(join(result.repo, TEST_FILE), "utf-8")).toContain("test(");
      expect(git(result.repo, ["status", "--porcelain"])).toBe("");
      expect(git(result.repo, ["log", "--oneline"]).split("\n")).toHaveLength(1);
    },
    FIX_TIMEOUT,
  );
});

describe("AC: what counts as weakening the tests", () => {
  it("refuses a fix that deletes an existing test file", async () => {
    expectRefused(await fixWith(cheatOn({ delete: { path: TEST_FILE } })));
  }, FIX_TIMEOUT);

  it("refuses a fix that modifies an existing test file", async () => {
    const original = readFileSync(join(exampleRepo("uat-packs-3-peek-"), TEST_FILE), "utf-8");
    expectRefused(await fixWith(cheatOn({ write: { path: TEST_FILE, content: `${original}// loosened\n` } })));
  }, FIX_TIMEOUT);

  it("allows a fix that adds a new test file", async () => {
    const { repo, findings } = await fixWith({
      expectations: [{ when: { promptContains: NEGATIVE }, effects: [CLAMP, { write: { path: "clamp.test.js", content: "// new test\n" } }], json: { status: "completed", rationale: "fixed" } }],
    });
    expect(findings).toContain(`1. ${NEGATIVE} (high): fixed and merged`);
    expect(readFileSync(join(repo, "clamp.test.js"), "utf-8")).toContain("new test");
  }, FIX_TIMEOUT);

  it("refuses a fix that adds a skip marker", async () => {
    const original = readFileSync(join(exampleRepo("uat-packs-3-peek-"), TEST_FILE), "utf-8");
    expectRefused(await fixWith(cheatOn({ write: { path: TEST_FILE, content: original.replace("test(", "test.skip(") } })));
  }, FIX_TIMEOUT);

  it("refuses a fix that changes the project's test command", async () => {
    const pkg = '{\n  "name": "code-review-example",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test || true" }\n}\n';
    expectRefused(await fixWith(cheatOn({ write: { path: "package.json", content: pkg } })));
  }, FIX_TIMEOUT);
});

describe("AC: the agent and the owner are told", () => {
  it("tells the agent why and retries within the limit, and tells the owner in the problem's history", async () => {
    const { fix, findings } = await fixWith(cheatOn({ delete: { path: TEST_FILE } }));
    // The scripted retry only answers once a refusal is in the prompt, so reaching it proves the agent was told.
    expect(fix.stdout.match(/the agent is working/g)).toHaveLength(2);
    expect(findings).toContain(REJECTED);
  }, FIX_TIMEOUT);

  it("counts a problem that only a test change could fix separately", async () => {
    const { findings } = await fixWith(CHEATING_FIXES, ["--all"]);
    expect(findings).toContain("1 problem could not be fixed: it needs a change to one of your tests, which this review does not let an agent do.");
  }, FIX_TIMEOUT);
});

describe("AC: skipped", () => {
  it.skip("refuses a pack-added skip marker or test file (no pack in the repo adds one)", () => {});
  it.skip("holds for a project whose tests report only a single pass or fail (the example reports individual results)", () => {});
  it.skip("allows modifying a test for a problem in the pack's 'tests' category and shows 'this fix will change your tests' (no such pack ships)", () => {});
});
