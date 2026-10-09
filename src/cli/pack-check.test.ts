import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { FIXTURES } from "../packs/pack-fixtures.js";
import { UNCONFIRMED_WHY } from "../packs/render.js";
import { CHECK_FAILED, checkPack, WEAKENED_TESTS } from "./pack-check.js";

const CHECK_TIMEOUT = 120_000;
const TOTAL = "The total can go below zero";
const SETTINGS = "A missing or broken settings file gives an unhelpful error";

/** A copy of a built-in pack, with `edit` applied to one of its JSON files. */
function packCopy(folder = "code-review", file?: string, edit?: (json: Record<string, any>) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pack-check-")), "my-pack");
  cpSync(join(BUILT_IN_PACKS, folder), dir, { recursive: true });
  if (file !== undefined && edit !== undefined) {
    const json = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    edit(json);
    writeFileSync(join(dir, file), JSON.stringify(json, null, 2));
  }
  return dir;
}

const listing = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

describe("the pack check", () => {
  it("runs the built-in code review's fixtures: what was found, which fix passed, which cheat was refused, and nothing sent to an agent", async () => {
    const dir = packCopy();
    const before = listing(dir);
    const result = await checkPack(dir);
    expect(result.problems).toEqual([]);
    expect(result).toMatchObject({
      ready: true,
      pack: { name: "code", version: "1.0.0" },
      run: { found: [TOTAL, SETTINGS], fixed: [TOTAL], refused: [{ title: SETTINGS, why: WEAKENED_TESTS }] },
      sentToAgent: false,
    });
    expect(listing(dir)).toEqual(before);
  }, CHECK_TIMEOUT);

  it("names every manifest problem and runs nothing", async () => {
    const dir = packCopy("code-review", "pack.json", (m) => (m.scan.checks = ["anchor-gone", "page-contains"]));
    const result = await checkPack(dir);
    expect(result).toMatchObject({ ready: false, pack: null, run: null });
    expect(result.problems.map((p) => p.field)).toEqual(["scan.checks.1"]);
  });

  it("fails when the scripted review does not find a problem it is expected to, saying why it could not be placed", async () => {
    const dir = packCopy("code-review", FIXTURES.review, (s) => (s.expectations[0].json.findings[0].anchor = "return price minus discount;"));
    const result = await checkPack(dir);
    expect(result.ready).toBe(false);
    expect(result.problems).toContainEqual({
      file: join(dir, FIXTURES.expect),
      field: "found.0",
      message: `the scripted review did not find "${TOTAL}": it could not be placed in ${FIXTURES.project} (${UNCONFIRMED_WHY.text_not_found})`,
    });
  }, CHECK_TIMEOUT);

  it("fails when the scripted review finds a problem the fixtures do not expect", async () => {
    const dir = packCopy("code-review", FIXTURES.review, (s) => s.expectations[0].json.findings.push({ ...s.expectations[0].json.findings[0], title: "Another problem", anchor: "export function total(price, discount) {" }));
    const result = await checkPack(dir);
    expect(result.ready).toBe(false);
    expect(result.problems).toContainEqual({ file: join(dir, FIXTURES.expect), field: "found", message: 'the scripted review also found "Another problem", which "found" does not list' });
  }, CHECK_TIMEOUT);

  it("fails when the seeded fix does not pass its check", async () => {
    const dir = packCopy("code-review", FIXTURES.fixes, (s) => (s.expectations[1].effects = [{ write: { path: "notes.txt", content: "looked at it\n" } }]));
    const result = await checkPack(dir);
    expect(result.ready).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ file: join(dir, FIXTURES.fixes), message: expect.stringMatching(new RegExp(`^the scripted fix for "${TOTAL}" did not pass its check: it ended "could not be fixed`)) }));
  }, CHECK_TIMEOUT);

  it("fails when the seeded cheat is not refused", async () => {
    const dir = packCopy("code-review", FIXTURES.fixes, (s) => (s.expectations[2].effects = s.expectations[2].effects.slice(0, 1)));
    const result = await checkPack(dir);
    expect(result.ready).toBe(false);
    expect(result.problems).toContainEqual({ file: join(dir, FIXTURES.fixes), field: null, message: `the scripted cheat for "${SETTINGS}" was not refused: it ended "fixed and merged"` });
  }, CHECK_TIMEOUT);

  it("names a scripted review the harness cannot use", async () => {
    const dir = packCopy("code-review", FIXTURES.review, (s) => (s.expectations[0].json.findings[0].category = "made-up"));
    const result = await checkPack(dir);
    expect(result).toMatchObject({ ready: false, run: null });
    expect(result.problems[0]).toMatchObject({ file: join(dir, FIXTURES.review), field: null, message: expect.stringMatching(/^the scripted review could not be used: /) });
  }, CHECK_TIMEOUT);

  it("counts a serious fix that waits for sign-off as passing its check, and refuses a line commented out", async () => {
    const result = await checkPack(packCopy("security-review"));
    expect(result.problems).toEqual([]);
    expect(result.run).toEqual({
      found: ["A key for the payments service is written in the code", "Checks of secure connections are turned off"],
      fixed: ["A key for the payments service is written in the code"],
      refused: [{ title: "Checks of secure connections are turned off", why: CHECK_FAILED }],
    });
  }, CHECK_TIMEOUT);
});
