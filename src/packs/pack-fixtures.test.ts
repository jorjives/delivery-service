import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "./manifest.js";
import { FIXTURES, readFixtures } from "./pack-fixtures.js";

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "fixtures-")), "my-pack");
  cpSync(join(BUILT_IN_PACKS, "code-review"), dir, { recursive: true });
  return dir;
}

describe("a pack's fixtures", () => {
  it("are read whole: the project's files by their paths, the two scripts and what the run must show", async () => {
    const result = await readFixtures(join(BUILT_IN_PACKS, "code-review"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.fixtures.project).sort()).toEqual(["package.json", "settings.js", "total.js", "total.test.js"]);
    expect(result.fixtures.expect.fixed).toEqual(["The total can go below zero"]);
  });

  it.each(Object.values(FIXTURES))("name %s by its path when it is missing", async (name) => {
    const dir = copy();
    rmSync(join(dir, name), { recursive: true });
    const result = await readFixtures(dir);
    expect(!result.ok && result.problems[0]).toMatchObject({ file: join(dir, name), field: null, message: expect.stringMatching(/^is missing: it holds /) });
  });

  it("names a fixed or refused problem the review is not expected to find, by field", async () => {
    const dir = copy();
    writeFileSync(join(dir, FIXTURES.expect), JSON.stringify({ found: ["A"], fixed: ["A"], refused: ["B"] }));
    const result = await readFixtures(dir);
    expect(!result.ok && result.problems).toEqual([{ file: join(dir, FIXTURES.expect), field: "refused.0", message: '"refused.0" names a problem "found" does not list' }]);
  });

  it("names a script that is not a claude-mock script", async () => {
    const dir = copy();
    writeFileSync(join(dir, FIXTURES.fixes), JSON.stringify({ replies: [] }));
    const result = await readFixtures(dir);
    expect(!result.ok && result.problems[0]?.file).toBe(join(dir, FIXTURES.fixes));
  });
});
