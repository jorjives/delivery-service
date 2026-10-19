// Slice 8: Review a Project, Choose What to Fix, and Hold Serious Problems for Sign-Off
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-19 against commit b1ded48
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js) in a scratch project, running the built-in
// `security` pack (which holds at "high"). The agent is routed to the vendored
// scripted agent through the contributor-only test seam: first as the review's
// scan, then as the fix workflow. Acceptance criteria that need GitHub are
// recorded as skipped below, with their reason.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { ideaText, type ScriptedIdea } from "../../src/packs/review-fixtures.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const SECRET = 'export const KEY = "live-key-123";\n';
const LEGACY = "export function oldThing() {}\n";

const SERIOUS: ScriptedIdea = {
  file: "20261019T120000Z-key-in-code.md",
  title: "A key is written in the code",
  severity: "critical",
  workflow: "security:fix",
  check: { kind: "anchor-gone", path: "secret.js", anchor: 'export const KEY = "live-key-123";' },
  body: "A key is written into secret.js.\n\n## Why it matters\n\nAnyone who can read the code can use it.\n\n## What fixed looks like\n\nThe key is not in the code.",
};
const MINOR: ScriptedIdea = {
  file: "20261019T120100Z-old-thing.md",
  title: "Old code nothing uses",
  severity: "low",
  workflow: "security:fix",
  check: { kind: "anchor-gone", path: "legacy.js", anchor: "export function oldThing() {}" },
  body: "Nothing calls legacy.js.\n\n## Why it matters\n\nIt is extra code.\n\n## What fixed looks like\n\nThe file is gone.",
};
const UNFOUNDED: ScriptedIdea = {
  file: "20261019T120200Z-ghost.md",
  title: "A problem in a file that is not there",
  severity: "medium",
  workflow: "security:fix",
  check: { kind: "anchor-gone", path: "ghost.js", anchor: "export const ghost = 1;" },
  body: "Nothing to see.\n\n## Why it matters\n\nNothing.\n\n## What fixed looks like\n\nNothing.",
};

const scan = (ideas: ScriptedIdea[]): MockScript => ({
  expectations: [{ effects: ideas.map((i) => ({ write: { path: `.delivery/backlog/${i.file}`, content: ideaText(i) } })), json: { status: "completed", rationale: "reviewed" } }],
});
// Fix sessions are told which problem to fix; each is matched on its title.
const fixes: MockScript = {
  expectations: [
    { when: { promptContains: SERIOUS.title }, effects: [{ write: { path: "secret.js", content: "export const KEY = process.env.KEY;\n" } }], json: { status: "completed", rationale: "moved the key out" } },
    { when: { promptContains: MINOR.title }, effects: [{ write: { path: "legacy.js", content: "// removed\n" } }], json: { status: "completed", rationale: "removed" } },
  ],
};

async function project() {
  const repo = initTempRepo("uat-review-", { "package.json": PACKAGE, "secret.js": SECRET, "legacy.js": LEGACY });
  const state = mkdtempSync(join(tmpdir(), "uat-review-state-"));
  const as = async (script: MockScript) => ({ ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });
  return { repo, as };
}

const files = (repo: string, ref: string) => git(repo, ["ls-tree", "-r", "--name-only", ref, "--", ".delivery/backlog/"]).split("\n").filter(Boolean);
const backlogFile = (repo: string, ref: string, idea: ScriptedIdea) => git(repo, ["show", `${ref}:.delivery/backlog/${idea.file}`]);

describe("UAT: review a project, choose what to fix, and hold the serious one for sign-off", () => {
  it("lists problems as ideas, fixes only the approved, holds the critical one until sign-off", async () => {
    const { repo, as } = await project();
    const before = git(repo, ["rev-parse", "HEAD"]);

    // 1. Review: one idea per problem, nothing else changed.
    const review = runDelivery(["review", "security"], { cwd: repo, env: await as(scan([SERIOUS, MINOR])) });
    expect(review.status, review.stdout + review.stderr).toBe(0);
    expect(git(repo, ["diff", "--name-only", before, "main"]).split("\n").sort()).toEqual([`.delivery/backlog/${SERIOUS.file}`, `.delivery/backlog/${MINOR.file}`]);
    const listed = runDelivery(["backlog"], { cwd: repo, env: await as(fixes) });
    expect(listed.stdout).toContain(SERIOUS.title);
    expect(listed.stdout).toContain(MINOR.title);
    const detail = runDelivery(["backlog", "key-in-code"], { cwd: repo, env: await as(fixes) });
    expect(detail.stdout).toContain("FOR ENGINEERS");

    // 2. Approve both (no decline here; declining is its own test below).
    const approve = runDelivery(["approve", "--all"], { cwd: repo, env: await as(fixes) });
    expect(approve.status, approve.stdout + approve.stderr).toBe(0);
    expect(backlogFile(repo, "main", SERIOUS)).toContain("status: open");

    // 3. Run: the critical one is held, finished but unlanded; the minor fix lands.
    const run = runDelivery(["run", "--sources"], { cwd: repo, env: await as(fixes) });
    // One run works the held item; the next picks up the rest of the approved list.
    runDelivery(["run", "--sources"], { cwd: repo, env: await as(fixes) });
    expect(run.stdout + run.stderr).toContain("Holding");
    expect(git(repo, ["show", "delivery/main:legacy.js"])).toContain("removed");
    expect(git(repo, ["show", "delivery/main:secret.js"])).toBe(SECRET.trim());
    const held = runDelivery(["backlog"], { cwd: repo, env: await as(fixes) });
    expect(held.stdout).toMatch(/Held/i);

    // 4. Sign-off lands it.
    const signOff = runDelivery(["sign-off", "key-in-code"], { cwd: repo, env: await as(fixes) });
    expect(signOff.status, signOff.stdout + signOff.stderr).toBe(0);
    expect(git(repo, ["show", "delivery/main:secret.js"])).toContain("process.env.KEY");
  }, 240_000);
});

describe("AC: choosing what is fixed", () => {
  it("sets declined ideas aside so they are never worked", async () => {
    const { repo, as } = await project();
    runDelivery(["review", "security"], { cwd: repo, env: await as(scan([SERIOUS, MINOR])) });
    expect(runDelivery(["approve", "old-thing"], { cwd: repo, env: await as(fixes) }).status).toBe(0);
    expect(runDelivery(["decline", "key-in-code"], { cwd: repo, env: await as(fixes) }).status).toBe(0);
    expect(backlogFile(repo, "main", SERIOUS)).not.toContain("status: idea");
    runDelivery(["run", "--sources"], { cwd: repo, env: await as(fixes) });
    expect(git(repo, ["show", "delivery/main:legacy.js"])).toContain("removed");
    expect(git(repo, ["show", "delivery/main:secret.js"])).toBe(SECRET.trim());
  }, 240_000);
});

describe("AC: a problem the harness cannot confirm is not offered", () => {
  it("rejects the review and adds nothing to the branch", async () => {
    const { repo, as } = await project();
    const before = git(repo, ["rev-parse", "HEAD"]);
    const review = runDelivery(["review", "security"], { cwd: repo, env: await as(scan([UNFOUNDED])) });
    expect(review.status).not.toBe(0);
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
    expect(files(repo, "main")).toEqual([]);
  }, 240_000);
});

describe("AC: rejecting a held item", () => {
  it("sets it aside and never lands it", async () => {
    const { repo, as } = await project();
    runDelivery(["review", "security"], { cwd: repo, env: await as(scan([SERIOUS])) });
    runDelivery(["approve", "--all"], { cwd: repo, env: await as(fixes) });
    runDelivery(["run", "--sources"], { cwd: repo, env: await as(fixes) });
    const reject = runDelivery(["reject", "key-in-code"], { cwd: repo, env: await as(fixes) });
    expect(reject.status, reject.stdout + reject.stderr).toBe(0);
    expect(git(repo, ["show", "delivery/main:secret.js"])).toBe(SECRET.trim());
  }, 240_000);
});

describe("AC: not recorded here", () => {
  it.skip("an agent itself can never approve or decline an idea (asserted at the unit level in src/cli/backlog-commands.test.ts)", () => {});
  it.skip("on GitHub, adding the review's label is the approval (needs the gh stand-in with a review; asserted in src/cli/review-command.test.ts)", () => {});
});
