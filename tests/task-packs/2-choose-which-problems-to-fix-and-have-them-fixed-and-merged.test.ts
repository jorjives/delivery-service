// Slice 2: Choose Which Problems to Fix and Have Them Fixed and Merged
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-05 against commit 4d7015b
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const FIX_TIMEOUT = 120_000;
const NEGATIVE = "The price shown at checkout can be negative";
const LEGACY = "Old code for a payment provider you no longer use";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-2-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

async function reviewedRepo(prefix: string): Promise<string> {
  const repo = exampleRepo(prefix);
  const { status } = runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) });
  expect(status).toBe(0);
  return repo;
}

const FIXES_CHECKOUT = {
  when: { promptContains: NEGATIVE },
  effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
  json: { status: "completed", rationale: "a total never goes below zero" },
};
const GIVES_UP_ON_LEGACY = {
  when: { promptContains: LEGACY },
  json: { status: "escalate", category: "authority", rationale: "I am not sure nothing else uses this file." },
};

describe("UAT: pick which problems to fix and have them fixed and merged", () => {
  it(
    "approves some, skips one, fixes and merges the approved, explains the one the agent could not fix",
    async () => {
      const repo = await reviewedRepo("uat-packs-2-");

      const approve = runDelivery(["findings", "approve", "1", "3"], { cwd: repo });
      expect(approve.status).toBe(0);
      expect(approve.stdout).toContain("except by your existing tests");
      expect(runDelivery(["findings", "skip", "2"], { cwd: repo }).status).toBe(0);

      const fix = runDelivery(["fix"], { cwd: repo, env: await envFor({ expectations: [FIXES_CHECKOUT, GIVES_UP_ON_LEGACY] }) });
      expect(fix.stdout).toMatch(/fixing 2 /i);
      expect(fix.stdout).toContain("delivery status --watch");

      const after = runDelivery(["findings"], { cwd: repo });
      expect(after.stdout).toContain(`1. ${NEGATIVE} (high): fixed and merged`);
      expect(after.stdout).toContain("(medium): skipped by you");
      expect(after.stdout).toContain(`3. ${LEGACY} (low): could not be fixed`);
      expect(after.stdout).toContain("I am not sure nothing else uses this file.");

      // The main copy holds the fix for the approved problem and is untouched for the skipped one.
      expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("Math.max(0, price - discount)");
      expect(readFileSync(join(repo, "settings.js"), "utf-8")).toContain("JSON.parse(readFileSync(");
      expect(git(repo, ["status", "--porcelain"])).toBe("");
    },
    FIX_TIMEOUT,
  );
});

describe("AC: choosing", () => {
  it("approve --all covers the listed problems and the latest choice wins", async () => {
    const repo = await reviewedRepo("uat-packs-2-all-");
    runDelivery(["findings", "approve", "--all"], { cwd: repo });
    runDelivery(["findings", "skip", "2"], { cwd: repo });
    const { stdout } = runDelivery(["findings"], { cwd: repo });
    expect(stdout).toContain("(medium): skipped by you");
    expect(stdout).toMatch(new RegExp(`1\\. ${NEGATIVE} \\(high\\): being fixed`));
  });
});

describe("AC: delivery fix refuses plainly", () => {
  it("refuses when there is no review, naming the command to run", () => {
    const { status, stderr } = runDelivery(["fix"], { cwd: exampleRepo("uat-packs-2-none-") });
    expect(status).not.toBe(0);
    expect(stderr).toContain("delivery review code");
  });

  it("refuses when nothing is approved, naming the command to choose with", async () => {
    const repo = await reviewedRepo("uat-packs-2-nothing-");
    const { status, stderr } = runDelivery(["fix"], { cwd: repo });
    expect(status).not.toBe(0);
    expect(stderr).toContain("delivery findings approve");
  });
});

describe("AC: a problem already gone is not worked on", () => {
  it("reports it already fixed and spends no agent session", async () => {
    const repo = await reviewedRepo("uat-packs-2-gone-");
    runDelivery(["findings", "approve", "1"], { cwd: repo });
    writeFileSync(join(repo, "checkout.js"), readFileSync(join(repo, "checkout.js"), "utf-8").replace("return price - discount;", "return Math.max(0, price - discount);"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "Clamp the total"]);

    const { status, stdout } = runDelivery(["fix"], { cwd: repo, env: await envFor({ expectations: [] }) });
    expect(status).toBe(0);
    expect(stdout).toContain("already fixed");
  });
});

describe("AC: running delivery fix again never fixes a problem twice", () => {
  it(
    "says every approved problem has been dealt with",
    async () => {
      const repo = await reviewedRepo("uat-packs-2-again-");
      runDelivery(["findings", "approve", "1"], { cwd: repo });
      runDelivery(["fix"], { cwd: repo, env: await envFor({ expectations: [FIXES_CHECKOUT] }) });
      const again = runDelivery(["fix"], { cwd: repo, env: await envFor({ expectations: [] }) });
      expect(again.status).toBe(0);
      expect(again.stdout).toMatch(/dealt with|finished/i);
    },
    FIX_TIMEOUT,
  );
});
