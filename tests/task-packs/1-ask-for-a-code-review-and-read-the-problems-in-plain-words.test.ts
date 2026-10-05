// Slice 1: Ask for a Code Review and Read the Problems in Plain Words
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-05 against commit 52256f8
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript } from "../../src/mock-script.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

async function reviewEnv(envelope: unknown = EXAMPLE_SCAN): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-1-script-")), "mock.json");
  await writeMockScript(path, scanScript(envelope));
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

describe("UAT: ask for a code review and read the problems in plain words", () => {
  it("reviews the example with no configuration, explains each problem, shows one in full, and changes nothing", async () => {
    const repo = exampleRepo("uat-packs-1-");
    const env = await reviewEnv();
    const headBefore = git(repo, ["rev-parse", "HEAD"]);

    const review = runDelivery(["review", "code"], { cwd: repo, env });
    expect(review.status).toBe(0);
    expect(review.stdout).toContain("This reads your project and writes nothing to it.");
    expect(review.stdout).toMatch(/It found 3 problems\./);
    for (const label of ["Where:", "What is wrong:", "Why it matters:", "Fixed looks like:", "How we will know:"]) {
      expect(review.stdout.split(label).length - 1).toBe(3);
    }
    expect(review.stdout).toContain("1. The price shown at checkout can be negative (high)");
    expect(review.stdout).toContain("checked: the flagged code is gone");
    expect(review.stdout).toContain("tests only: no check of this specific problem");
    expect(review.stdout).toContain("Nothing has been changed and nothing will be until you approve it.");
    expect(review.stdout).toContain("delivery findings");

    const one = runDelivery(["findings", "1"], { cwd: repo, env });
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("The price shown at checkout can be negative");
    expect(one.stdout).toContain("FOR ENGINEERS");
    expect(one.stdout).toContain("Category: correctness");
    expect(one.stdout).toContain("Check: anchor-gone");

    // Nothing in the project changed.
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(repo, ["branch", "--list"]).trim()).toBe("* main");
  });
});

describe("AC: a problem that cannot be confirmed is listed, not dropped", () => {
  it("lists the problem about a missing file under could not be confirmed", async () => {
    const repo = exampleRepo("uat-packs-1-unconfirmed-");
    const env = await reviewEnv();
    runDelivery(["review", "code"], { cwd: repo, env });

    const review = runDelivery(["findings", "--unconfirmed"], { cwd: repo, env });
    expect(review.status).toBe(0);
    expect(review.stdout).toContain("Prices are rounded the wrong way");
    expect(review.stdout).toContain("that file is not in your last commit");
  });
});

describe("AC: findings and packs commands", () => {
  it("lists the latest review's problems as not yet decided", async () => {
    const repo = exampleRepo("uat-packs-1-list-");
    const env = await reviewEnv();
    runDelivery(["review", "code"], { cwd: repo, env });

    const { stdout, status } = runDelivery(["findings"], { cwd: repo, env });
    expect(status).toBe(0);
    expect(stdout).toContain("not yet decided");
    expect(stdout).toContain("The price shown at checkout can be negative");
  });

  it("says there is no review yet and how to start one", () => {
    const { stdout, status } = runDelivery(["findings"], { cwd: exampleRepo("uat-packs-1-none-") });
    expect(status).toBe(0);
    expect(stdout).toContain("No review found in this project. Start one with: delivery review code");
  });

  it("lists the available packs, and an unknown pack name lists them", () => {
    const repo = exampleRepo("uat-packs-1-packs-");
    expect(runDelivery(["packs"], { cwd: repo }).stdout).toContain("code");
    const unknown = runDelivery(["review", "no-such-pack"], { cwd: repo });
    expect(unknown.status).not.toBe(0);
    expect(unknown.stdout + unknown.stderr).toContain("code");
  });
});

describe("AC: no problems found", () => {
  it("says none were found, that this is not proof, and exits success", async () => {
    const repo = exampleRepo("uat-packs-1-clean-");
    const { stdout, status } = runDelivery(["review", "code"], { cwd: repo, env: await reviewEnv({ findings: [], notes: "" }) });
    expect(status).toBe(0);
    expect(stdout).toMatch(/found no problems/i);
    expect(stdout).toMatch(/not proof/i);
  });
});
