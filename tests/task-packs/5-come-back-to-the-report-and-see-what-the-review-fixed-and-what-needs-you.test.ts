// Slice 5: Come Back to the Report and See What the Review Fixed and What Needs You
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-08 against commit 57a0787
//
// Drives the compiled `delivery` command as a person would. The review and fix phase
// is left in the example project by the harness's own test support (writeFixPhase:
// fixed, waiting, could not be fixed, stopped by a setup problem, skipped); a second
// test runs the real security review and fix against the vendored scripted agent.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { EXAMPLE_SECURITY_SCAN, exampleRepo, PACK_FORBIDDEN, scanScript, SECURITY_FIXES, writeFixPhase } from "../../src/packs/review-fixtures.js";
import { runDelivery } from "../helpers.js";

const TIMEOUT = 120_000;
const SECRET = "A password for the payments service is written in the code";

const deliver = (repo: string, args: string[]) => runDelivery(args, { cwd: repo });

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-5-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

async function afterFixPhase(opts?: { interrupted?: boolean }) {
  const repo = exampleRepo("uat-packs-5-");
  await writeFixPhase(repo, opts);
  return repo;
}

/** The report with the command names (which are words an owner types) removed, for the forbidden-word check. */
const ownerWords = (out: string) => out.replace(/delivery (findings|status|fix|report)[^\n]*/g, "").replace(/For engineers:[^\n]*/g, "");

describe("UAT: come back after a review and read what happened", () => {
  it("opens with one sentence, then each problem by title under who must act", async () => {
    const repo = await afterFixPhase();
    const report = deliver(repo, ["report"]);
    expect(report.status).toBe(0);
    const lines = report.stdout.split("\n");
    expect(lines[0]).toMatch(/Security review of .*: 6 problems found; you approved 5 and skipped 1\./);
    expect(lines[1]).toBe("2 are fixed and merged; 1 is waiting for your sign-off; 1 could not be fixed; 1 was stopped by a setup problem.");

    const out = report.stdout;
    const at = (heading: string) => out.indexOf(heading);
    const order = ["WAITING FOR YOUR SIGN-OFF", "NEEDS YOU", "STOPPED, FOR YOUR ENGINEERS", "DONE", "SKIPPED BY YOU"].map(at);
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(out).toContain(`Problem 1 of 6: "${SECRET}" (critical)`);
    expect(out).toContain('Problem 4 of 6: "The price shown at checkout can be negative" (low)');
    expect(out).toContain('Problem 6 of 6: "Debug logging is left on" (low): skipped by you');
  });
});

describe("AC: what each section says", () => {
  it("explains a waiting problem and gives the commands to look, sign off or reject", async () => {
    const out = deliver(await afterFixPhase(), ["report"]).stdout;
    expect(out).toContain("What could happen:");
    expect(out).toContain("The agent changed your code");
    expect(out).toContain("How we know:");
    expect(out).toContain("Why this needs you:");
    for (const command of ["delivery findings 1 --changes", "delivery findings sign-off 1", "delivery findings reject 1"]) expect(out).toContain(command);
  });

  it("says why a problem could not be fixed, in the agent's words, and who acts", async () => {
    const out = deliver(await afterFixPhase(), ["report"]).stdout;
    expect(out).toContain("Could not be fixed. Failed after 1 attempt.");
    expect(out).toContain('The agent said: "I could not find where the total is worked out."');
    expect(out).toContain("Who acts: you, or an engineer you pass it to.");
    expect(out).toContain("To act:");
  });

  it("puts a problem stopped by a broken check in the engineers' section", async () => {
    const out = deliver(await afterFixPhase(), ["report"]).stdout;
    const engineers = out.slice(out.indexOf("STOPPED, FOR YOUR ENGINEERS"), out.indexOf("DONE"));
    expect(engineers).toContain("Totals are rounded the wrong way");
    expect(engineers).toContain("This is a problem with the setup, not a decision for you.");
  });

  it("names the check's level on each fixed line, so a tests-only fix is not presented as proved", async () => {
    const out = deliver(await afterFixPhase(), ["report"]).stdout;
    expect(out).toContain("fixed and merged; checked: the risky pattern no longer appears");
    expect(out).toContain("fixed and merged; tests only: no check of this specific problem");
  });

  it("uses none of the forbidden words in what the owner reads", async () => {
    const repo = await afterFixPhase();
    for (const args of [["report"], ["findings"]]) expect(ownerWords(deliver(repo, args).stdout)).not.toMatch(PACK_FORBIDDEN);
  });
});

describe("AC: findings as data", () => {
  it("gives one versioned document with every problem, state, check level and fix run", async () => {
    const repo = await afterFixPhase();
    const json = deliver(repo, ["findings", "--json"]);
    expect(json.status).toBe(0);
    const doc = JSON.parse(json.stdout);
    expect(doc.schema).toBe("delivery.findings/1");
    expect(doc.problems).toHaveLength(6);
    const [p1, p2, p3, p4, p5, p6] = doc.problems;
    expect(p1).toMatchObject({ number: 1, state: "held", fix: { run: expect.stringMatching(/^fix-1-/) } });
    expect(p2).toMatchObject({ state: "fixed", check: { kind: "pattern-absent", level: "checked: the risky pattern no longer appears" } });
    expect(p3.check).toMatchObject({ kind: "none", level: "tests only: no check of this specific problem" });
    expect(p4.state).toBe("unfixable");
    expect(p5.state).toBeDefined();
    expect(p6.fix ?? null).toBeNull();
  });

  it("prints the JSON Schema for that document", async () => {
    const schema = deliver(await afterFixPhase(), ["findings", "--schema"]);
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout)["delivery.findings/1"].properties.schema.const).toBe("delivery.findings/1");
  });
});

describe("AC: the report is the same from anywhere, and after an interruption", () => {
  it("prints the same report on repeat and from a subfolder of the project", async () => {
    const repo = await afterFixPhase();
    const first = deliver(repo, ["report"]).stdout;
    expect(deliver(repo, ["report"]).stdout).toBe(first);
    expect(runDelivery(["report"], { cwd: join(repo, ".delivery") }).stdout).toBe(first);
  });

  it("still reports when the fix phase was interrupted, without counting the unfinished fix as done", async () => {
    const report = deliver(await afterFixPhase({ interrupted: true }), ["report"]);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("WAITING FOR YOUR SIGN-OFF");
    expect(report.stdout).not.toContain("1 was stopped by a setup problem");
  });
});

describe("UAT end to end: a real security review and fix, then the report", () => {
  it("shows the held fix waiting and the merged fix done", async () => {
    const repo = exampleRepo("uat-packs-5-live-");
    expect(runDelivery(["review", "security"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SECURITY_SCAN)) }).status).toBe(0);
    expect(deliver(repo, ["findings", "approve", "--all"]).status).toBe(0);
    expect(runDelivery(["fix"], { cwd: repo, env: await envFor(SECURITY_FIXES) }).status).toBe(0);

    const report = deliver(repo, ["report"]);
    expect(report.status).toBe(0);
    expect(report.stdout).toMatch(/^Security review of .*: 2 problems found; you approved 2 and skipped 0\./);
    expect(report.stdout).toContain("1 is waiting for your sign-off");
    expect(report.stdout).toContain("WAITING FOR YOUR SIGN-OFF");
    expect(report.stdout).toContain("DONE");
    expect(ownerWords(report.stdout)).not.toMatch(PACK_FORBIDDEN);
  }, TIMEOUT);
});
