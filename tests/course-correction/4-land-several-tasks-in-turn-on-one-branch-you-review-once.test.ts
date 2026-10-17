// Slice 4: Land Several Tasks in Turn on One Branch You Review Once
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-17 against commit cdc56c5
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project holding a backlog of
// three items, the agent routed to the vendored scripted agent through the
// contributor-only test seam: no network, no API key.
// Acceptance criteria that need a task finishing after another has landed
// (concurrent timing), or the operator's own commits conflicting with the
// delivery branch, are recorded as skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const FILES = ["20261016T090000Z-one.md", "20261016T090100Z-two.md", "20261016T090200Z-three.md"];
const BRIEFS = ["Add the first page.", "Add the second page.", "Add the third page."];
const PAGES = ["first.html", "second.html", "third.html"];
const ITEMS = FILES.map((file, i) => ({ file, brief: BRIEFS[i] ?? "", page: PAGES[i] ?? "", priority: i + 1 }));
const item = (priority: number, brief: string) => `---\nstatus: open\npriority: ${priority}\n---\n${brief}\n`;

const backlog = () => Object.fromEntries(ITEMS.map((i) => [`.delivery/backlog/${i.file}`, item(i.priority, i.brief)]));

// Each session writes the page named for its brief, so what landed is visible in the branch.
const script = (escalate?: string): MockScript => ({
  expectations: ITEMS.map(({ brief, page }) => ({
    when: { promptContains: brief },
    ...(brief === escalate
      ? { json: { status: "escalate", rationale: "cannot tell what this page is" } }
      : { effects: [{ write: { path: page, content: "<p>page</p>\n" } }], json: { status: "completed", rationale: "done" } }),
  })) as MockScript["expectations"],
});

async function project(mock: MockScript, config?: object) {
  const repo = initTempRepo("uat-one-branch-", {
    "package.json": PACKAGE,
    ...(config ? { "delivery.config.json": JSON.stringify(config) } : {}),
    ...backlog(),
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(mock),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-one-branch-state-")),
  };
  return { repo, env };
}

const list = (repo: string, pattern: string) =>
  git(repo, ["branch", "--list", pattern, "--format=%(refname:short)"]).split("\n").filter(Boolean);
const files = (repo: string, branch: string) => git(repo, ["ls-tree", "-r", "--name-only", branch]).split("\n");

describe("UAT: three tasks land on one delivery branch you review once", () => {
  it("lands all three on delivery/main, leaves no task branches, and names the branch in status and report", async () => {
    const { repo, env } = await project(script());

    const run = runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });
    expect(run.status).toBe(0);

    // One open delivery branch, not three task branches needing separate review.
    expect(list(repo, "delivery/*")).toEqual(["delivery/main"]);
    expect(list(repo, "surface/*")).toHaveLength(0);
    for (const page of PAGES) expect(files(repo, "delivery/main")).toContain(page);

    // Built up piece by piece: the delivery branch is ahead of the untouched base.
    expect(files(repo, "main")).not.toContain(PAGES[0]);
    expect(Number(git(repo, ["rev-list", "--count", "main..delivery/main"]))).toBeGreaterThanOrEqual(3);

    for (const command of ["status", "report"]) {
      const out = runDelivery([command], { cwd: repo, env });
      expect(out.status).toBe(0);
      expect(out.stdout).toContain("Delivery branch delivery/main");
      for (const file of FILES) expect(out.stdout).toContain(`backlog:${file}`);
      expect(out.stdout).toContain("Your closer");
    }
  }, 240_000);
});

describe("AC: a task that is escalated never lands and does not block the tasks after it", () => {
  it("lands the other two and keeps the escalated one off the delivery branch", async () => {
    const { repo, env } = await project(script(BRIEFS[1]));

    runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });

    expect(files(repo, "delivery/main")).toContain(PAGES[0]);
    expect(files(repo, "delivery/main")).toContain(PAGES[2]);
    expect(files(repo, "delivery/main")).not.toContain(PAGES[1]);
  }, 240_000);
});

describe("AC: the closer runs once per run, after the tasks have landed", () => {
  it("merge-back brings all three pages onto the base in one pass and deletes the delivery branch", async () => {
    const { repo, env } = await project(script(), { closer: { type: "merge-back" } });

    const run = runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });
    expect(run.status).toBe(0);

    for (const page of PAGES) expect(files(repo, "main")).toContain(page);
    expect(list(repo, "delivery/*")).toHaveLength(0);
    expect(run.stdout.match(/Handed delivery\/main to your closer/g) ?? []).toHaveLength(1);
  }, 240_000);
});

describe("AC: not recorded here", () => {
  it.skip("a task still at the tip lands with nothing re-checked (needs two tasks finishing in a controlled order; covered in src/surface-delivery.test.ts)", () => {});
  it.skip("a task finishing after another is rebuilt and re-checked, repeatedly if the branch moves again (needs concurrent timing the CLI cannot control; covered in src/surface-delivery.test.ts)", () => {});
  it.skip("a conflicting rebuild or failed re-check is never landed and gets a fresh attempt shown the conflict (needs concurrent timing; covered in src/surface-delivery.test.ts)", () => {});
  it.skip("the operator's own base commits are brought in, or block the run without repeating the failed attempt (covered in src/delivery-branch.test.ts and src/cli/sources-run.test.ts)", () => {});
});
