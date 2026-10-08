// Slice 6: Review a Project That Has No Tests, Safely
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-08 against commit a7d3502
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/no-tests-example, the agent routed to the vendored scripted agent
// (no network, no sign-in). Skipped below, each with its reason: the pack-level
// requireCheck rule (no built-in pack sets it, so it needs a custom pack on disk).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { exampleRepo, NO_TESTS_DIR, NO_TESTS_FIXES, NO_TESTS_SCAN, scanScript } from "../../src/packs/review-fixtures.js";
import { runDelivery } from "../helpers.js";

const RUN_TIMEOUT = 120_000;
const DISCOUNT = "A discount is taken off a hundred times over";
const SETTINGS = "A missing or broken settings file stops the program with an unhelpful error";
const OLD_EXPORT = "Old export code nothing uses";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-6-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

const deliver = (repo: string, args: string[], env?: NodeJS.ProcessEnv) => runDelivery(args, { cwd: repo, env });

async function reviewed() {
  const repo = exampleRepo("uat-packs-6-", NO_TESTS_DIR);
  const review = deliver(repo, ["review", "code"], await envFor(scanScript(NO_TESTS_SCAN)));
  expect(review.status).toBe(0);
  return { repo, review };
}

describe("UAT: review a project with no tests, approve, fix, nothing merged unchecked", () => {
  it(
    "warns up front, holds every fix for sign-off, and merges only what the owner signs off",
    async () => {
      const { repo, review } = await reviewed();
      expect(review.stdout).toContain("Your project has no tests, so nothing will check that a fix has not broken something else.");
      expect(review.stdout).toContain("Every fix will wait for your sign-off");
      expect(review.stdout).toContain("this problem's own check only, no regression tests");
      expect(review.stdout).toContain("cannot be checked");

      expect(deliver(repo, ["findings", "approve", "1", "2"]).status).toBe(0);
      const fix = deliver(repo, ["fix"], await envFor(NO_TESTS_FIXES));
      expect(fix.status).toBe(0);

      const held = deliver(repo, ["findings"]).stdout;
      expect(held).toContain(`1. ${DISCOUNT} (high): waiting for your sign-off`);
      expect(held).toContain(`2. ${SETTINGS} (medium): waiting for your sign-off`);
      expect(held).not.toContain("fixed and merged");

      const signOff = deliver(repo, ["findings", "sign-off", "1"]);
      expect(signOff.status).toBe(0);
      expect(signOff.stdout).toContain("Problem 1: fixed and merged");
      const after = deliver(repo, ["findings"]).stdout;
      expect(after).toContain(`1. ${DISCOUNT} (high): fixed and merged`);
      expect(after).toContain(`2. ${SETTINGS} (medium): waiting for your sign-off`);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: problems with and without a specific check", () => {
  it("shows each checkable problem as its own check only, and the uncheckable one as needing a decision with the approve-anyway line", async () => {
    const { review } = await reviewed();
    expect(review.stdout.match(/this problem's own check only, no regression tests/g)).toHaveLength(2);
    expect(review.stdout).toContain("2 of 3 have a specific check; 1 cannot be checked, so it waits for your decision.");
    expect(review.stdout).toContain("To approve it anyway: delivery findings approve 3 --allow-unchecked");
  }, RUN_TIMEOUT);

  it("refuses to approve the uncheckable problem by number", async () => {
    const { repo } = await reviewed();
    const refused = deliver(repo, ["findings", "approve", "3"]);
    expect(refused.status).toBe(2);
    expect(refused.stdout + refused.stderr).toContain("Problem 3 cannot be checked");
  }, RUN_TIMEOUT);

  it("approves it with --allow-unchecked, warns, and always holds its fix", async () => {
    const { repo } = await reviewed();
    const approve = deliver(repo, ["findings", "approve", "3", "--allow-unchecked"]);
    expect(approve.status).toBe(0);
    expect(approve.stdout).toContain("nothing will check this fix except you");
    expect(deliver(repo, ["fix"], await envFor(NO_TESTS_FIXES)).status).toBe(0);
    const held = deliver(repo, ["findings"]).stdout;
    expect(held).toContain(`3. ${OLD_EXPORT} (low): waiting for your sign-off`);
    expect(held).toContain("nothing checks this fix except you");
  }, RUN_TIMEOUT);
});

describe("AC: a pack that requires a check", () => {
  it.skip("makes a problem without one 'needs your decision' in any project (no built-in pack sets requireCheck; needs a custom pack on disk)", () => {});
});
