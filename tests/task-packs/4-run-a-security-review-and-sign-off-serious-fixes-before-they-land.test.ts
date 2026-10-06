// Slice 4: Run a Security Review and Sign Off Serious Fixes Before They Land
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-06 against commit e67cdf0
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent
// (no network, no sign-in). Skipped below, each with its reason: the held fix
// failing its check on the current main copy (needs a fix that passes in its own
// copy but fails after another change lands; the conflict case covers the
// "nothing merged, branch kept" outcome).

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { EXAMPLE_SCAN, EXAMPLE_SECURITY_SCAN, exampleRepo, PAYMENTS_PASSWORD, scanScript, SECURITY_FIXES } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const FIX_TIMEOUT = 120_000;
const SECRET = "A password for the payments service is written in the code";
const LIBRARY = "An old version of the minimist library with a known weakness";
const MASKED = `pay-… (${PAYMENTS_PASSWORD.length} characters)`;

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-4-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

const deliver = (repo: string, args: string[]) => runDelivery(args, { cwd: repo });

/** Security-review the example, approve everything, fix: the password fix is held. */
async function heldRepo() {
  const repo = exampleRepo("uat-packs-4-");
  const review = runDelivery(["review", "security"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SECURITY_SCAN)) });
  expect(review.status).toBe(0);
  expect(deliver(repo, ["findings", "approve", "--all"]).status).toBe(0);
  const fix = runDelivery(["fix"], { cwd: repo, env: await envFor(SECURITY_FIXES) });
  expect(fix.status).toBe(0);
  return { repo, review, fix };
}

describe("UAT: security review, fix, hold, inspect, sign off", () => {
  it(
    "holds the serious fix, shows its change, and lands it on sign-off with the owner's step left",
    async () => {
      const { repo, review } = await heldRepo();
      expect(review.stdout).toContain("1 critical, 0 high, 1 medium, 0 low");
      expect(review.stdout).toContain(SECRET);

      const held = deliver(repo, ["findings"]).stdout;
      expect(held).toContain(`1. ${SECRET} (critical): waiting for your sign-off`);
      expect(held).toContain(`2. ${LIBRARY} (medium): fixed and merged`);
      expect(readFileSync(join(repo, "payments.js"), "utf-8")).toContain(PAYMENTS_PASSWORD);

      const changes = deliver(repo, ["findings", "1", "--changes"]);
      expect(changes.status).toBe(0);
      expect(changes.stdout).toContain("cannot tell you it is safe");
      expect(changes.stdout).toContain("payments.js");
      expect(changes.stdout).not.toContain(PAYMENTS_PASSWORD);

      const signOff = deliver(repo, ["findings", "sign-off", "1"]);
      expect(signOff.status).toBe(0);
      expect(signOff.stdout).toContain("Checking the fix still works on your current main copy");
      expect(signOff.stdout).toContain("Problem 1: fixed and merged");
      expect(readFileSync(join(repo, "payments.js"), "utf-8")).toContain("process.env.PAYMENTS_PASSWORD");

      const after = deliver(repo, ["findings"]).stdout;
      expect(after).toContain(`1. ${SECRET} (critical): fixed and merged`);
      expect(after).toMatch(/NEEDS YOU\s+Problem 1: .*change it at the payments provider/);
    },
    FIX_TIMEOUT,
  );
});

describe("AC: the review's opening and wording", () => {
  it("opens with severity counts, says serious fixes wait, and labels library problems as the reviewer's opinion", async () => {
    const repo = exampleRepo("uat-packs-4-review-");
    const { stdout, status } = runDelivery(["review", "security"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SECURITY_SCAN)) });
    expect(status).toBe(0);
    expect(stdout).toContain("By how serious they are: 1 critical, 0 high, 1 medium, 0 low.");
    expect(stdout).toContain("fixed and checked, but wait for your sign-off");
    expect(stdout).toContain("What could happen:");
    expect(stdout).toContain("not an advisory database");
    expect(stdout).toContain("may be out of date or wrong");
    expect(stdout).toContain("checked: the vulnerable version is no longer installed");
    expect(stdout).toContain("One thing is left for you:");
  }, FIX_TIMEOUT);
});

describe("AC: a leaked secret is never printed", () => {
  it("shows the secret masked in every output", async () => {
    const { repo, review, fix } = await heldRepo();
    const outputs = [
      review.stdout + review.stderr,
      fix.stdout + fix.stderr,
      deliver(repo, ["findings"]).stdout,
      deliver(repo, ["findings", "1"]).stdout,
      deliver(repo, ["findings", "1", "--changes"]).stdout,
      deliver(repo, ["status"]).stdout,
      deliver(repo, ["report"]).stdout,
      deliver(repo, ["status", "--json"]).stdout,
      deliver(repo, ["report", "--json"]).stdout,
    ];
    for (const out of outputs) expect(out).not.toContain(PAYMENTS_PASSWORD);
    expect(deliver(repo, ["findings", "1", "--changes"]).stdout).toContain(MASKED);
  }, FIX_TIMEOUT);

  it("does not count a secret moved to another file as fixed", async () => {
    const repo = exampleRepo("uat-packs-4-moved-");
    expect(runDelivery(["review", "security"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SECURITY_SCAN)) }).status).toBe(0);
    expect(deliver(repo, ["findings", "approve", "1"]).status).toBe(0);
    const moves: MockScript = {
      expectations: [{
        when: { promptContains: SECRET },
        effects: [
          { edit: { path: "payments.js", old: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, new: 'import { PAYMENTS_PASSWORD } from "./secret.js";' } },
          { write: { path: "secret.js", content: `export const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";\n` } },
        ],
        json: { status: "completed", rationale: "moved it" },
      }],
    };
    runDelivery(["fix"], { cwd: repo, env: await envFor(moves) });
    const findings = deliver(repo, ["findings"]).stdout;
    expect(findings).toContain(`1. ${SECRET} (critical): could not be fixed`);
    expect(findings).not.toContain(PAYMENTS_PASSWORD);
    expect(readFileSync(join(repo, "payments.js"), "utf-8")).toContain(PAYMENTS_PASSWORD);
  }, FIX_TIMEOUT);
});

describe("AC: sign-off, rejection and conflicts", () => {
  it("declines the fix on reject, keeps the branch and leaves the main copy alone", async () => {
    const { repo } = await heldRepo();
    const reject = deliver(repo, ["findings", "reject", "1"]);
    expect(reject.status).toBe(0);
    const findings = deliver(repo, ["findings"]).stdout;
    expect(findings).toContain(`1. ${SECRET} (critical): declined at sign-off`);
    expect(git(repo, ["branch", "--list", "surface/*"])).toContain("surface/fix-a-password");
    expect(readFileSync(join(repo, "payments.js"), "utf-8")).toContain(PAYMENTS_PASSWORD);
  }, FIX_TIMEOUT);

  it("merges nothing when the held fix conflicts with the main copy, and keeps the branch", async () => {
    const { repo } = await heldRepo();
    const payments = readFileSync(join(repo, "payments.js"), "utf-8");
    const edited = payments.replace(`"${PAYMENTS_PASSWORD}"`, '"rotated"');
    writeFileSync(join(repo, "payments.js"), edited);
    git(repo, ["commit", "-am", "Rotate the password by hand"]);
    const head = git(repo, ["rev-parse", "HEAD"]);

    const signOff = deliver(repo, ["findings", "sign-off", "1"]);
    expect(signOff.stdout + signOff.stderr).not.toContain(PAYMENTS_PASSWORD);
    expect(deliver(repo, ["findings"]).stdout).toContain(`1. ${SECRET} (critical): signed off but could not be merged`);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["branch", "--list", "surface/*"])).toContain("surface/fix-a-password");
  }, FIX_TIMEOUT);

  it("changes nothing when sign-off is run again after it landed", async () => {
    const { repo } = await heldRepo();
    expect(deliver(repo, ["findings", "sign-off", "1"]).status).toBe(0);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const before = deliver(repo, ["findings"]).stdout;
    deliver(repo, ["findings", "sign-off", "1"]);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect(deliver(repo, ["findings"]).stdout).toBe(before);
  }, FIX_TIMEOUT);

  it("holds nothing for severity on the code review pack", async () => {
    const repo = exampleRepo("uat-packs-4-code-");
    expect(runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) }).status).toBe(0);
    expect(deliver(repo, ["findings", "approve", "1"]).status).toBe(0);
    const fix: MockScript = {
      expectations: [{
        when: { promptContains: "The price shown at checkout can be negative" },
        effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
        json: { status: "completed", rationale: "fixed" },
      }],
    };
    expect(runDelivery(["fix"], { cwd: repo, env: await envFor(fix) }).status).toBe(0);
    const findings = deliver(repo, ["findings"]).stdout;
    expect(findings).toContain("(high): fixed and merged");
    expect(findings).not.toContain("waiting for your sign-off");
  }, FIX_TIMEOUT);
});

describe("AC: skipped", () => {
  it.skip("reports 'signed off but could not be merged' when the held fix no longer passes its check on main (conflict case covers the unmerged outcome)", () => {});
});
