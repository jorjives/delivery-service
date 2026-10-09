// Slice 8: Keep Your Choices Between Reviews
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-09 against commit 31dc3b9
//
// Drives the compiled `delivery` command as a person would, against a git copy of
// examples/code-review-example, the agent routed to the vendored scripted agent.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { git, runDelivery } from "../helpers.js";

const TIMEOUT = 120_000;
const NEGATIVE = "The price shown at checkout can be negative";
const SETTINGS = "A missing or broken settings file stops the shop with an unhelpful error";
const LEGACY = "Old code for a payment provider you no longer use";

async function envFor(script: MockScript): Promise<NodeJS.ProcessEnv> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-packs-8-script-")), "mock.json");
  await writeMockScript(path, script);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path };
}

const review = async (repo: string) => runDelivery(["review", "code"], { cwd: repo, env: await envFor(scanScript(EXAMPLE_SCAN)) });

const FIXES_CHECKOUT: MockScript = {
  expectations: [
    {
      when: { promptContains: NEGATIVE },
      effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
      json: { status: "completed", rationale: "a total never goes below zero" },
    },
  ],
};

describe("UAT: run the same review again without being asked about settled things", () => {
  it(
    "offers only new problems, counts the earlier choices not shown, and shows the skipped one on request",
    async () => {
      const repo = exampleRepo("uat-packs-8-");
      expect((await review(repo)).status).toBe(0);
      expect(runDelivery(["findings", "skip", "3"], { cwd: repo }).status).toBe(0);
      expect(runDelivery(["findings", "approve", "1"], { cwd: repo }).status).toBe(0);
      runDelivery(["fix"], { cwd: repo, env: await envFor(FIXES_CHECKOUT) });

      const again = await review(repo);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain(SETTINGS);
      expect(again.stdout).not.toContain(LEGACY);
      expect(again.stdout).toContain("1 problem skipped or declined in an earlier review, not shown");
      expect(again.stdout).toContain("delivery findings --include-skipped");
      // AC: fixed earlier and still gone is not re-proposed.
      expect(again.stdout).not.toContain(NEGATIVE);

      const hidden = runDelivery(["findings"], { cwd: repo });
      expect(hidden.stdout).not.toContain(LEGACY);
      const shown = runDelivery(["findings", "--include-skipped"], { cwd: repo });
      expect(shown.status).toBe(0);
      expect(shown.stdout).toContain(`${LEGACY} (low): skipped by you in an earlier review`);
      expect(shown.stdout).not.toContain("not shown");
    },
    TIMEOUT,
  );
});

describe("AC: a problem fixed earlier whose flagged code is back", () => {
  it(
    "is shown as came back",
    async () => {
      const repo = exampleRepo("uat-packs-8-back-");
      await review(repo);
      runDelivery(["findings", "approve", "1"], { cwd: repo });
      runDelivery(["fix"], { cwd: repo, env: await envFor(FIXES_CHECKOUT) });
      expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("Math.max(0, price - discount)");
      git(repo, ["revert", "--no-edit", "HEAD"]);
      expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("return price - discount;");

      const again = await review(repo);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("Came back: it was fixed in an earlier review, and the flagged code is back.");
      expect(runDelivery(["findings"], { cwd: repo }).stdout).toContain(`${NEGATIVE} (high): came back`);
    },
    TIMEOUT,
  );
});

describe("AC: delivery findings approve --recommended", () => {
  it("approves the problems with a check of their own below the sign-off threshold, and says which it chose", async () => {
    const repo = exampleRepo("uat-packs-8-rec-");
    await review(repo);
    const { status, stdout } = runDelivery(["findings", "approve", "--recommended"], { cwd: repo });
    expect(status).toBe(0);
    expect(stdout).toContain("Approved 1 and 2, the recommended ones");
    expect(stdout).toContain("delivery fix");
    const after = runDelivery(["findings"], { cwd: repo }).stdout;
    expect(after).toMatch(new RegExp(`1\\. ${NEGATIVE} \\(high\\): being fixed`));
    expect(after).toContain(`3. ${LEGACY} (low): not yet decided`);
  });

  it("takes no numbers", async () => {
    const repo = exampleRepo("uat-packs-8-rec2-");
    await review(repo);
    const { status, stderr } = runDelivery(["findings", "approve", "--recommended", "1"], { cwd: repo });
    expect(status).not.toBe(0);
    expect(stderr).toContain("--recommended on its own");
  });
});
