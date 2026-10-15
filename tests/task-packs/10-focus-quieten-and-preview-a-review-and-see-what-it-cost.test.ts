// Slice 10: Focus, Quieten and Preview a Review, and See What It Cost
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-13 against commit a7a7fbb
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
import { EXAMPLE_SCAN, SCOPED_SCAN, exampleRepo, scanScript, writeReview } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const TIMEOUT = 120_000;
const NEGATIVE = "The price shown at checkout can be negative";
const SETTINGS = "A missing or broken settings file stops the shop with an unhelpful error";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-10-script-")), "mock.json");
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

describe("UAT: preview, focus, read the quiet list, then see what it cost", () => {
  it("previews with no sign-in, reviews one folder with the unsure problem set aside, and reports the cost after fixes", async () => {
    const repo = exampleRepo("uat-packs-10-");

    const preview = runDelivery(["review", "code", "--preview"], { cwd: repo });
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain("What the review agent will be told");
    expect(preview.stdout).toContain("nothing is sent, and no sign-in is needed");

    const focused = runDelivery(["review", "code", "--path", "auth"], { cwd: repo, env: await envFor(scanScript(SCOPED_SCAN)) });
    expect(focused.status).toBe(0);
    expect(focused.stdout).toContain("This review looks only at auth.");
    expect(focused.stdout).toContain("1. Signed-in sessions never run out, and new ones are refused (high)");
    expect(focused.stdout).toContain("Possibly worth a look (1)");
    expect(focused.stdout).toContain("2. Session times are compared without saying their unit (low)");

    // A whole-project review, then fix, then the report's tuning section.
    expect(runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) }).status).toBe(0);
    expect(runDelivery(["findings", "approve", "1", "2"], { cwd: repo }).status).toBe(0);
    runDelivery(["fix", "--sign-off-threshold", "none"], { cwd: repo, env: await envFor({ expectations: [CLAMP, SETTINGS_FIX] }) });

    const report = runDelivery(["report"], { cwd: repo });
    expect(report.status).toBe(0);
    const tuning = report.stdout.slice(report.stdout.indexOf("FOR WHOEVER TUNES THIS"));
    expect(tuning).toMatch(/^ {2}The review: .*session time; USD/m);
    expect(tuning).toMatch(/^ {2}The fixes: .*session time; USD/m);
  }, TIMEOUT);
});

describe("AC: --path reviews only that part and says so", () => {
  it("says so before and after, and points at what was outside it", async () => {
    const repo = exampleRepo("uat-packs-10-path-");
    const { status, stdout } = runDelivery(["review", "code", "--path", "auth"], { cwd: repo, env: await envFor(scanScript(SCOPED_SCAN)) });
    expect(status).toBe(0);
    expect(stdout.split("This review looks only at auth.").length - 1).toBe(2);
    expect(stdout).toContain("1 more was outside auth, so it is not offered.");
  }, TIMEOUT);

  it("refuses a folder outside the project or with nothing in it, before any agent runs", () => {
    const repo = exampleRepo("uat-packs-10-bad-path-");
    const outside = runDelivery(["review", "code", "--path", "../elsewhere"], { cwd: repo });
    expect(outside.status).not.toBe(0);
    expect(outside.stderr).toContain("../elsewhere");
    const empty = runDelivery(["review", "code", "--path", "nowhere"], { cwd: repo });
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("nowhere");
  });
});

describe("AC: each problem shows how sure the review was", () => {
  it("shows confidence on the sure problem and collapses the unsure one under Possibly worth a look", async () => {
    const repo = exampleRepo("uat-packs-10-confidence-");
    const { stdout } = runDelivery(["review", "code", "--path", "auth"], { cwd: repo, env: await envFor(scanScript(SCOPED_SCAN)) });
    expect(stdout).toContain("How sure the review is: high");
    const [sure, setAside] = stdout.split("Possibly worth a look");
    expect(sure).toContain("Signed-in sessions never run out");
    expect(sure).not.toContain("Session times are compared");
    expect(setAside).toContain("Session times are compared without saying their unit");
    expect(setAside).toContain("set aside");
  }, TIMEOUT);
});

describe("AC: a pack's exclusion list keeps those kinds of problem out of the review", () => {
  it("tells the review agent not to report what the pack excludes", () => {
    const repo = exampleRepo("uat-packs-10-exclude-");
    const pack = JSON.parse(readFileSync(join(import.meta.dirname, "../../packs/code-review/pack.json"), "utf-8")) as { scan: { exclude: string[] } };
    const { exclude } = pack.scan;
    expect(exclude.length).toBeGreaterThan(0);
    const { stdout } = runDelivery(["review", "code", "--preview"], { cwd: repo });
    expect(stdout).toContain("What not to report");
    for (const excluded of exclude) expect(stdout).toContain(excluded);
  });
});

describe("AC: --preview shows what the agent will be told with no sign-in and no network", () => {
  it("prints the same as data with --json, and sets nothing up in the project", () => {
    const repo = exampleRepo("uat-packs-10-preview-");
    const headBefore = git(repo, ["rev-parse", "HEAD"]);
    const { status, stdout } = runDelivery(["review", "code", "--preview", "--json"], { cwd: repo });
    expect(status).toBe(0);
    expect(Object.keys(JSON.parse(stdout) as object)).toEqual(["systemPrompt", "prompt"]);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });
});

describe("AC: cost and duration read in the owner's words, and what was not recorded says so", () => {
  it("says not recorded for a review whose session usage was never recorded", async () => {
    const repo = exampleRepo("uat-packs-10-cost-");
    await writeReview(repo, { findings: [] });
    const { status, stdout } = runDelivery(["findings"], { cwd: repo });
    expect(status).toBe(0);
    expect(stdout).toContain("What it cost:");
    expect(stdout).toContain("The review: time not recorded; cost not recorded.");
  });
});
