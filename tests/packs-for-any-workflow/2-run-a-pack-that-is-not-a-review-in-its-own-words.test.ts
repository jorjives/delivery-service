// Slice 2: Run a pack that is not a review, in its own words
// Source: docs/superpowers/specs/2026-10-23-packs-for-any-workflow-slices.md
// Recorded: 2026-10-23 against commit 4a95b84
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js) in a scratch project that lists the `moves`
// pack. The agent is scripted through the contributor test seam. Assertions are on
// exit codes, stable phrases and where the work landed, never on full output.
//
// SKIPPED AC: "Output for existing review packs is unchanged" is proved byte for byte
//   by src/cli/review-command.test.ts and tests/course-correction; not repeated here.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { MOVES_FILES, movesProject, PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { IDEA_CAP } from "../../src/packs/manifest.js";
import { ideasScript, type ScriptedIdea } from "../../src/packs/review-fixtures.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const RISKY: ScriptedIdea = { file: "20261023T120000Z-prices-still-use.md", title: "Prices still use the old code", severity: "high", workflow: "moves:code",
  check: { kind: "anchor-gone", path: "price.js", anchor: "export const price = old(1);" }, body: "Prices still call the old code." };
const SAFE: ScriptedIdea = { file: "20261023T120100Z-a-test-still-uses.md", title: "A test still uses the old code", severity: "high", workflow: "moves:tests",
  check: { kind: "anchor-gone", path: "a.test.js", anchor: "old(2);" }, body: "A test still calls the old code." };

const fix = (title: string, path: string, content: string): MockScript["expectations"][number] =>
  ({ when: { promptContains: title }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: "moved" } });
const FIXES: MockScript = { expectations: [fix(RISKY.title, "price.js", "export const price = 1;\n"), fix(SAFE.title, "a.test.js", "// moved\n")] };

const FILES = { "price.js": "export const price = old(1);\n", "a.test.js": "old(2);\n" };
const state = mkdtempSync(join(tmpdir(), "uat-moves-state-"));
const as = async (dir: string, args: string[], script?: MockScript) =>
  runDelivery(args, { cwd: dir, env: { ...process.env, XDG_STATE_HOME: state, ...(script ? { [TEST_MOCK_SCRIPT]: await scriptFile(script) } : {}) } });

describe("UAT: start a pack that is not a review, approve its ideas, run them, and read the report", () => {
  it("lists the start command, finds ideas in the pack's words, holds the risky one, lands the other, and reports", async () => {
    const dir = movesProject(FILES);

    // 1. The pack is listed with one plain sentence and its start command.
    const listed = await as(dir, ["packs"]);
    expect(listed.status, listed.stdout + listed.stderr).toBe(0);
    expect(listed.stdout).toContain("Finds places that still use old code, and moves them. Start it with: delivery review moves");

    // 2. Start it; the ideas appear, in the pack's words and never a review's.
    const started = await as(dir, ["review", "moves"], ideasScript([RISKY, SAFE]));
    expect(started.status, started.stdout + started.stderr).toBe(0);
    expect(started.stdout).toContain("Move off old code");
    expect(started.stdout).toContain("The pack added 2 ideas to your backlog.");
    expect(started.stdout + started.stderr).not.toMatch(/review found/i);
    const backlog = await as(dir, ["backlog"]);
    expect(backlog.stdout).toContain("Prices still use the old code");
    expect(backlog.stdout).toContain("A test still uses the old code");

    // 3. Approve both (they name different act workflows) and run them.
    expect((await as(dir, ["approve", "--all"], FIXES)).status).toBe(0);
    await as(dir, ["run", "--sources", "--max", "2"], FIXES); // ends needing a person, so its exit code is not asserted

    // 4. The risky idea waits for sign-off; the other landed; the report says so.
    expect(git(dir, ["show", "delivery/main:a.test.js"])).toBe("// moved");
    expect(git(dir, ["show", "delivery/main:price.js"])).toBe("export const price = old(1);");
    expect((await as(dir, ["backlog"])).stdout).toMatch(/held/i);
    const report = await as(dir, ["report"]);
    expect(report.status, report.stdout + report.stderr).toBe(0);
    expect(report.stdout.length).toBeGreaterThan(0);
  }, 180_000);
});

describe("AC: the find of a pack whose find is not called scan starts with --preview", () => {
  it("prints the pack's own find prompt", async () => {
    const preview = await as(movesProject(), ["review", "moves", "--preview"]);
    expect(preview.status, preview.stdout + preview.stderr).toBe(0);
    expect(preview.stdout).toContain("# Look for old code");
  });
});

describe("AC: when the find adds nothing the owner is told, as the agent's reading only", () => {
  it("says it found nothing and that this is not a guarantee", async () => {
    const result = await as(movesProject(), ["review", "moves"], ideasScript([]));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("found nothing to add. That is the agent's reading of your project, not a guarantee.");
  });
});

describe("AC: when the find adds as many ideas as the cap allows the owner is told there may be more", () => {
  it("says to run it again once these have landed", async () => {
    const many: ScriptedIdea[] = Array.from({ length: IDEA_CAP }, (_, i) => ({ ...SAFE, file: `20261023T1200${String(i).padStart(2, "0")}Z-idea-${i}.md`, title: `Idea ${i}` }));
    const result = await as(movesProject(FILES), ["review", "moves"], ideasScript(many));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("There may be more: run it again once these have landed.");
  }, 60_000);
});

describe("AC: a pack not listed in the project is refused without mentioning a review", () => {
  it("names the pack and says to list it", async () => {
    const dir = initTempRepo("uat-unlisted-", { "package.json": PACKAGE, ...MOVES_FILES });
    const result = await as(dir, ["review", "./moves-pack"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('The pack "moves"');
    expect(result.stderr).toContain('List its folder under "packs" in delivery.config.json');
    expect(result.stderr).not.toMatch(/the review/i);
  });
});
