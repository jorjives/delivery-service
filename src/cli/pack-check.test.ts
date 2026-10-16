import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { FIXTURES } from "../packs/pack-fixtures.js";
import { UNCONFIRMED_WHY } from "../packs/render.js";
import { CHECK_FAILED, checkPack, NotTrusted, sandboxedEnv, WEAKENED_TESTS } from "./pack-check.js";

const CHECK_TIMEOUT = 120_000;
const TOTAL = "The total can go below zero";
const SETTINGS = "A missing or broken settings file gives an unhelpful error";

/** A copy of a built-in pack, with `edit` applied to one of its JSON files. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture JSON is edited by arbitrary deep paths
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
      pack: { name: "code", version: "1.1.0" },
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

describe("confirming trust before running a pack's fixtures", () => {
  it("never asks when the manifest has a problem: nothing would run anyway", async () => {
    const dir = packCopy("code-review", "pack.json", (m) => (m.scan.checks = ["anchor-gone", "page-contains"]));
    const confirm = () => Promise.reject(new Error("should not be asked"));
    const result = await checkPack(dir, { confirm });
    expect(result).toMatchObject({ ready: false, run: null });
  });

  it("asks once before running fixtures, and declines without running them", async () => {
    const dir = packCopy();
    const before = listing(dir);
    let calls = 0;
    const confirm = () => {
      calls++;
      return Promise.resolve(false);
    };
    await expect(checkPack(dir, { confirm })).rejects.toBeInstanceOf(NotTrusted);
    expect(calls).toBe(1);
    expect(listing(dir)).toEqual(before);
  });

  it("runs the fixtures as normal once confirm resolves true", async () => {
    const result = await checkPack(packCopy(), { confirm: () => Promise.resolve(true) });
    expect(result).toMatchObject({ ready: true, run: { fixed: [TOTAL] } });
  }, CHECK_TIMEOUT);
});

describe("sandboxedEnv", () => {
  it("keeps only PATH from the caller's environment, plus the given scratch HOME", () => {
    const env = { PATH: "/usr/bin:/bin", AWS_SECRET_ACCESS_KEY: "leak", ANTHROPIC_API_KEY: "leak", HOME: "/home/real-user" };
    expect(sandboxedEnv(env, "/scratch/home")).toEqual({ PATH: "/usr/bin:/bin", HOME: "/scratch/home" });
  });

  it("omits PATH when the caller's environment has none", () => {
    expect(sandboxedEnv({}, "/scratch/home")).toEqual({ HOME: "/scratch/home" });
  });
});

describe("what a pack's own code can see while it is checked", () => {
  it("never sees a credential from the caller's environment, in the fixture project's tests or anywhere else it runs", async () => {
    const dir = packCopy();
    const seen = join(mkdtempSync(join(tmpdir(), "pack-check-seen-")), "env.json");
    const probe = join(dir, FIXTURES.project, "total.test.js");
    writeFileSync(probe, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env) + "\\n");\n${readFileSync(probe, "utf-8")}`);
    const result = await checkPack(dir, { env: { ...process.env, ANTHROPIC_API_KEY: "sk-leak", AWS_SECRET_ACCESS_KEY: "leak" } });
    expect(result.problems).toEqual([]);
    const runs = readFileSync(seen, "utf-8").trim().split("\n");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(Object.keys(JSON.parse(run))).not.toContain("ANTHROPIC_API_KEY");
    for (const run of runs) expect(Object.keys(JSON.parse(run))).not.toContain("AWS_SECRET_ACCESS_KEY");
  }, CHECK_TIMEOUT);
});

describe("a pack's fixture project", () => {
  it("cannot carry git's own control files, which would run its commands with the caller's credentials", async () => {
    const dir = packCopy();
    const seen = join(mkdtempSync(join(tmpdir(), "pack-check-seen-")), "ran");
    mkdirSync(join(dir, FIXTURES.project, ".git"));
    writeFileSync(join(dir, FIXTURES.project, ".git", "config"), `[core]\n\tfsmonitor = touch ${seen}; echo\n`);
    const result = await checkPack(dir, { env: { ...process.env, ANTHROPIC_API_KEY: "sk-leak" } });
    expect(result).toMatchObject({ ready: false, run: null });
    expect(result.problems).toContainEqual({ file: join(dir, FIXTURES.project), field: ".git/config", message: "is inside .git: a project's own git files would run commands the harness never chose" });
    expect(existsSync(seen)).toBe(false);
  }, CHECK_TIMEOUT);
});
