// Slice 9: Choose What Waits for Sign-Off and When Tests May Change
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-09 against commit 6378ef1
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent
// (no network, no sign-in).

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockExpectation, type MockScript } from "../../src/mock-script.js";
import { EXAMPLE_SCAN, NO_TESTS_DIR, NO_TESTS_FIXES, NO_TESTS_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const TIMEOUT = 120_000;
const NEGATIVE = "The price shown at checkout can be negative";
const SETTINGS = "A missing or broken settings file stops the shop with an unhelpful error";
const LEGACY = "Old code for a payment provider you no longer use";
const TEST_FILE = "checkout.test.js";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-9-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

const CLAMP: MockExpectation = {
  when: { promptContains: NEGATIVE },
  effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
  json: { status: "completed", rationale: "a total never goes below zero" },
};
const SETTINGS_FIX: MockExpectation = {
  when: { promptContains: SETTINGS },
  effects: [{ edit: { path: "settings.js", old: 'return JSON.parse(readFileSync(path, "utf-8"));', new: 'const text = readFileSync(path, "utf-8");\n  return JSON.parse(text);' } }],
  json: { status: "completed", rationale: "read the file first" },
};
const ESCALATE_ON_RETRY: MockExpectation = {
  when: { promptContains: "\n- guard:" },
  json: { status: "escalate", category: "authority", rationale: "The tests would have to change." },
};
/** The honest move when only a test change would do. */
const gatewayTouching = (...effects: NonNullable<MockExpectation["effects"]>): MockExpectation => ({
  when: { promptContains: LEGACY },
  effects,
  json: { status: "completed", rationale: "Only a change to the test would cover the old gateway." },
});
const editTest = (original: string) => ({ write: { path: TEST_FILE, content: `${original}// the old gateway's totals are exact now\n` } });

/** Review the example and approve everything. */
async function approvedRepo() {
  const repo = exampleRepo("uat-packs-9-");
  expect(runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) }).status).toBe(0);
  expect(runDelivery(["findings", "approve", "--all"], { cwd: repo }).status).toBe(0);
  return { repo, original: readFileSync(join(repo, TEST_FILE), "utf-8") };
}

const findingsOf = (repo: string) => runDelivery(["findings"], { cwd: repo }).stdout;

describe("UAT: choose the threshold, then unblock a fix that needs a test changed", () => {
  it(
    "holds medium and above, then fixes the blocked problem once test edits are allowed, and holds it too",
    async () => {
      const { repo, original } = await approvedRepo();
      runDelivery(["fix", "--sign-off-threshold", "medium"], {
        cwd: repo,
        env: await envFor({ expectations: [ESCALATE_ON_RETRY, CLAMP, SETTINGS_FIX, gatewayTouching(editTest(original))] }),
      });
      const held = findingsOf(repo);
      expect(held).toContain(`1. ${NEGATIVE} (high): waiting for your sign-off`);
      expect(held).toContain(`2. ${SETTINGS} (medium): waiting for your sign-off`);
      expect(held).toContain(`3. ${LEGACY} (low): could not be fixed`);
      expect(held).toContain("needs a change to one of your tests");
      expect(held).toContain("delivery findings approve 3 --allow-test-edits");

      const approve = runDelivery(["findings", "approve", "3", "--allow-test-edits"], { cwd: repo });
      expect(approve.status).toBe(0);
      const second = runDelivery(["fix", "--sign-off-threshold", "medium"], {
        cwd: repo,
        env: await envFor({ expectations: [gatewayTouching(editTest(original))] }),
      });
      expect(second.status).toBe(0);
      const after = findingsOf(repo);
      expect(after).toContain(`3. ${LEGACY} (low): waiting for your sign-off`);
      // Held, so the main copy still has the original test.
      expect(readFileSync(join(repo, TEST_FILE), "utf-8")).toBe(original);
      expect(git(repo, ["status", "--porcelain"])).toBe("");
    },
    TIMEOUT,
  );
});

describe("AC: the sign-off threshold", () => {
  it("rejects a level that is not critical, high, medium, low or none", async () => {
    const { repo } = await approvedRepo();
    const { status, stderr } = runDelivery(["fix", "--sign-off-threshold", "extreme"], { cwd: repo });
    expect(status).not.toBe(0);
    expect(stderr).toContain("extreme");
  }, TIMEOUT);

  it("with none, nothing waits for how serious it is", async () => {
    const { repo } = await approvedRepo();
    runDelivery(["fix", "--sign-off-threshold", "none"], { cwd: repo, env: await envFor({ expectations: [CLAMP, SETTINGS_FIX] }) });
    const findings = findingsOf(repo);
    expect(findings).toContain(`1. ${NEGATIVE} (high): fixed and merged`);
    expect(findings).toContain(`2. ${SETTINGS} (medium): fixed and merged`);
    expect(findings).not.toContain("waiting for your sign-off");
  }, TIMEOUT);

  it("with high, a medium fix is merged and a high one waits", async () => {
    const { repo } = await approvedRepo();
    runDelivery(["fix", "--sign-off-threshold", "high"], { cwd: repo, env: await envFor({ expectations: [CLAMP, SETTINGS_FIX] }) });
    const findings = findingsOf(repo);
    expect(findings).toContain(`1. ${NEGATIVE} (high): waiting for your sign-off`);
    expect(findings).toContain(`2. ${SETTINGS} (medium): fixed and merged`);
  }, TIMEOUT);

  it("still holds a fix in a project with no tests, whatever the threshold", async () => {
    const repo = exampleRepo("uat-packs-9-notests-", NO_TESTS_DIR);
    expect(runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(NO_TESTS_SCAN)) }).status).toBe(0);
    expect(runDelivery(["findings", "approve", "--all"], { cwd: repo }).status).toBe(0);
    runDelivery(["fix", "--sign-off-threshold", "none"], { cwd: repo, env: await envFor(NO_TESTS_FIXES) });
    expect(findingsOf(repo)).toContain("waiting for your sign-off");
  }, TIMEOUT);
});

describe("AC: --allow-test-edits", () => {
  it("does not go with --all", async () => {
    const { repo } = await approvedRepo();
    const { status, stderr, stdout } = runDelivery(["findings", "approve", "--all", "--allow-test-edits"], { cwd: repo });
    expect(status).not.toBe(0);
    expect(stderr + stdout).toContain("Name each problem whose fix may change your tests by its number");
  }, TIMEOUT);

  it("still refuses a fix that deletes an existing test", async () => {
    const { repo } = await approvedRepo();
    expect(runDelivery(["findings", "approve", "3", "--allow-test-edits"], { cwd: repo }).status).toBe(0);
    runDelivery(["fix", "--sign-off-threshold", "none"], {
      cwd: repo,
      env: await envFor({ expectations: [ESCALATE_ON_RETRY, gatewayTouching({ delete: { path: TEST_FILE } })] }),
    });
    const findings = findingsOf(repo);
    expect(findings).toContain(`3. ${LEGACY} (low): could not be fixed`);
    expect(findings).toContain("removed or skipped existing tests");
    expect(readFileSync(join(repo, TEST_FILE), "utf-8")).toContain("test(");
  }, TIMEOUT);

  it("always waits for sign-off, even with threshold none", async () => {
    const { repo, original } = await approvedRepo();
    expect(runDelivery(["findings", "approve", "3", "--allow-test-edits"], { cwd: repo }).status).toBe(0);
    runDelivery(["fix", "--sign-off-threshold", "none"], { cwd: repo, env: await envFor({ expectations: [gatewayTouching(editTest(original))] }) });
    expect(findingsOf(repo)).toContain(`3. ${LEGACY} (low): waiting for your sign-off`);
  }, TIMEOUT);
});

describe("AC: skipped", () => {
  it.skip("shows the chosen threshold and the test-edit permission recorded with the approval (the ledger is internal; their effects on what waits are asserted above)", () => {});
});
