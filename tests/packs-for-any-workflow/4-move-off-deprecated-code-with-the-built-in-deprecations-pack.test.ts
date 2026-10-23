// Slice 4: Move off deprecated code with the built-in `deprecations` pack
// Source: docs/superpowers/specs/2026-10-23-packs-for-any-workflow-slices.md
// Recorded: 2026-10-23 against commit 46bc0e0
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js) in a scratch copy of the pack's own sample
// project (packs/deprecations/fixtures). The agent is scripted through the
// contributor test seam. Assertions are on exit codes, stable phrases and where
// the work landed, never on full output.
//
// SKIPPED AC: "The built-in passes the pack check as part of the normal test suite"
//   is proved by tests/built-in-packs-pass-the-pack-check.test.ts and
//   tests/deprecations-pack.test.ts; here the same check is run once as a person would.
// SKIPPED AC: "A test edited as part of moving a test file's own calls is accepted under
//   the tests workflow and refused under the code workflow" is proved with a per-workflow
//   scripted idea in tests/deprecations-pack.test.ts; the UAT below shows both outcomes
//   through the shipped fixtures (tests workflow lands, code workflow refuses the cheat).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { BUILT_IN_PACKS } from "../../src/packs/manifest.js";
import { readFixtures } from "../../src/packs/pack-fixtures.js";
import { ideasScript } from "../../src/packs/review-fixtures.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const DEPRECATIONS = join(BUILT_IN_PACKS, "deprecations");
const OWNER_FORBIDDEN = /pattern-absent|guard|deprecation sweep|check kind/i;

const state = mkdtempSync(join(tmpdir(), "uat-deprecations-state-"));
const as = async (dir: string, args: string[], script?: MockScript) =>
  runDelivery(args, { cwd: dir, env: { ...process.env, XDG_STATE_HOME: state, ...(script ? { [TEST_MOCK_SCRIPT]: await scriptFile(script) } : {}) } });

/** The pack's sample project (an old date module marked as replaced) in a scratch repository, with its two scripts. */
async function sample() {
  const read = await readFixtures(DEPRECATIONS);
  if (!read.ok) throw new Error(`fixtures unreadable: ${JSON.stringify(read.problems)}`);
  const { project, reviewScript, fixesScript } = read.fixtures;
  return { dir: initTempRepo("uat-deprecations-", project), review: JSON.parse(reviewScript) as MockScript, fixes: JSON.parse(fixesScript) as MockScript };
}

describe("UAT: hand a deprecation clean-up to the harness and stay in control of the risky parts", () => {
  it("lists the pack, finds three places, lands the safe moves, holds the serious one until signed off", async () => {
    const { dir, review, fixes } = await sample();

    // 1. The pack is listed, with no configuration, with its sentence and start command.
    const listed = await as(dir, ["packs"]);
    expect(listed.status, listed.stdout + listed.stderr).toBe(0);
    expect(listed.stdout).toContain("Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations");

    // 2. Start it: three ideas appear in plain words, with how serious a wrong move would be.
    const started = await as(dir, ["review", "deprecations"], review);
    expect(started.status, started.stdout + started.stderr).toBe(0);
    expect(started.stdout).toContain("The pack added 3 ideas to your backlog.");
    expect(started.stdout + started.stderr).not.toMatch(OWNER_FORBIDDEN);
    const backlog = await as(dir, ["backlog"]);
    expect(backlog.stdout).toContain("Invoices still use the old date handling the team marked as replaced");
    expect(backlog.stdout).toContain("Receipts still use the old date handling the team marked as replaced");
    expect(backlog.stdout).toContain("The receipt test still uses the old date handling the team marked as replaced");
    expect(backlog.stdout + backlog.stderr).not.toMatch(OWNER_FORBIDDEN);

    // 3. Approve all and run: the honest test move lands; the cheat is refused; the high-severity move waits.
    expect((await as(dir, ["approve", "--all"], fixes)).status).toBe(0);
    await as(dir, ["run", "--sources", "--max", "3"], fixes); // ends needing a person, so its exit code is not asserted
    expect(git(dir, ["show", "delivery/main:src/receipt.test.js"])).toContain('from "../lib/dates.js"');
    expect(git(dir, ["show", "delivery/main:src/receipt.js"])).toContain("legacy-dates"); // the cheat did not land
    expect(git(dir, ["show", "delivery/main:src/invoice.js"])).toContain("legacy-dates"); // held, not yet moved

    // 4. The held move is visible, then lands after sign-off, and the report reads.
    expect((await as(dir, ["backlog"])).stdout).toMatch(/held/i);
    const signed = await as(dir, ["sign-off", "invoice-dates"], fixes);
    expect(signed.status, signed.stdout + signed.stderr).toBe(0);
    expect(git(dir, ["show", "delivery/main:src/invoice.js"])).toContain('from "../lib/dates.js"');
    const report = await as(dir, ["report"], fixes);
    expect(report.status, report.stdout + report.stderr).toBe(0);
    expect(report.stdout.length).toBeGreaterThan(0);
  }, 360_000);
});

describe("AC: the built-in passes the pack check as a person would run it", () => {
  it("proves its own fixtures end to end", () => {
    const result = runDelivery(["packs", "check", DEPRECATIONS, "--yes"], { cwd: tmpdir() });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("was refused under deprecations:code");
    expect(result.stdout).toContain("passed its check under deprecations:tests");
  }, 120_000);
});

describe("AC: a project that takes a built-in's name is refused in words naming it and what to rename", () => {
  it("refuses a workflow named like one of the built-in's", async () => {
    const dir = initTempRepo("uat-deprecations-clash-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ workflows: { "deprecations:code": { steps: [{ name: "a", prompt: "a" }] } } }),
    });
    const result = await as(dir, ["packs"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('"deprecations:code"');
    expect(result.stderr).toContain('"deprecations", a pack that comes with the harness');
    expect(result.stderr).toContain("rename your workflow");
  });

  it("loads a project whose names only resemble the built-in's", async () => {
    const dir = initTempRepo("uat-deprecations-near-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ workflows: { "deprecation:code": { steps: [{ name: "a", prompt: "a" }] } } }),
    });
    const result = await as(dir, ["packs"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("AC: when the project marks nothing as deprecated the owner sees the plain nothing-found line", () => {
  it("says it found nothing, as the agent's reading only", async () => {
    const dir = initTempRepo("uat-deprecations-none-", { "package.json": PACKAGE, "a.js": "export const a = 1;\n" });
    const result = await as(dir, ["review", "deprecations"], ideasScript([]));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("Move off deprecated code found nothing to add. That is the agent's reading of your project, not a guarantee.");
  }, 60_000);
});
