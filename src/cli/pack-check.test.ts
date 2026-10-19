import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { FIXTURES } from "../packs/pack-fixtures.js";
import { checkPack, NotTrusted, sandboxedEnv, WEAKENED_TESTS } from "./pack-check.js";

const RUN_TIMEOUT = 120_000;
const TOTAL = "The total can go below zero";
const SETTINGS = "A missing or broken settings file gives an unhelpful error";

/**
 * A copy of a built-in pack in a fresh folder, renamed `mine` so it does not clash with the built-in,
 * with `edit` applied to one of its JSON files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture JSON is edited by arbitrary deep paths
function copyPack(folder = "code-review", file?: string, edit?: (json: Record<string, any>) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pack-check-")), "my-pack");
  cpSync(join(BUILT_IN_PACKS, folder), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf-8"));
  manifest.name = "mine";
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest, null, 2));
  if (file !== undefined && edit !== undefined) {
    const json = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    edit(json);
    writeFileSync(join(dir, file), JSON.stringify(json, null, 2));
  }
  return dir;
}

describe("the pack check", () => {
  it("runs a built-in pack's fixtures through review, approve and run, and reports what was found, fixed and refused", async () => {
    const check = await checkPack(join(BUILT_IN_PACKS, "code-review"));
    expect(check.problems).toEqual([]);
    expect(check.ready).toBe(true);
    expect(check.run).toEqual({
      found: ["The total can go below zero", "A missing or broken settings file gives an unhelpful error"],
      fixed: ["The total can go below zero"],
      refused: [{ title: "A missing or broken settings file gives an unhelpful error", why: WEAKENED_TESTS }],
    });
  }, RUN_TIMEOUT);

  it("names an expected problem the scripted review did not add", async () => {
    const dir = copyPack("code-review");
    writeFileSync(join(dir, "fixtures/expect.json"), JSON.stringify({ found: ["Not there", "Other"], fixed: ["Other"], refused: ["Not there"] }));
    const check = await checkPack(dir);
    expect(check.problems).toContainEqual(expect.objectContaining({ field: "found.0", message: 'the scripted review did not add "Not there"' }));
  }, RUN_TIMEOUT);

  it("names every manifest problem and runs nothing", async () => {
    const dir = copyPack("code-review", "pack.json", (m) => (m.scan.checks = ["anchor-gone", "page-contains"]));
    const result = await checkPack(dir);
    expect(result).toMatchObject({ ready: false, pack: null, run: null });
    expect(result.problems.map((p) => p.field)).toEqual(["scan.checks"]);
  });
});

describe("confirming trust before running a pack's fixtures", () => {
  it("never asks when the manifest has a problem: nothing would run anyway", async () => {
    const dir = copyPack("code-review", "pack.json", (m) => (m.scan.checks = ["anchor-gone", "page-contains"]));
    const confirm = () => Promise.reject(new Error("should not be asked"));
    const result = await checkPack(dir, { confirm });
    expect(result).toMatchObject({ ready: false, run: null });
  });

  it("asks once before running fixtures, and declines without running them", async () => {
    const dir = copyPack();
    let calls = 0;
    const confirm = () => {
      calls++;
      return Promise.resolve(false);
    };
    await expect(checkPack(dir, { confirm })).rejects.toBeInstanceOf(NotTrusted);
    expect(calls).toBe(1);
  });

  it("runs the fixtures as normal once confirm resolves true", async () => {
    const result = await checkPack(copyPack(), { confirm: () => Promise.resolve(true) });
    expect(result).toMatchObject({ ready: true, run: { fixed: [TOTAL] } });
  }, RUN_TIMEOUT);
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
    const dir = copyPack();
    const seen = join(mkdtempSync(join(tmpdir(), "pack-check-seen-")), "env.json");
    const probe = join(dir, FIXTURES.project, "total.test.js");
    writeFileSync(probe, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env) + "\\n");\n${readFileSync(probe, "utf-8")}`);
    const result = await checkPack(dir, { env: { ...process.env, ANTHROPIC_API_KEY: "sk-leak", AWS_SECRET_ACCESS_KEY: "leak" } });
    expect(result.problems).toEqual([]);
    const runs = readFileSync(seen, "utf-8").trim().split("\n");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const names = Object.keys(JSON.parse(run));
      expect(names).not.toContain("ANTHROPIC_API_KEY");
      expect(names).not.toContain("AWS_SECRET_ACCESS_KEY");
    }
  }, RUN_TIMEOUT);
});

describe("a pack's fixture project", () => {
  it("cannot carry git's own control files, which would run its commands with the caller's credentials", async () => {
    const dir = copyPack();
    const seen = join(mkdtempSync(join(tmpdir(), "pack-check-seen-")), "ran");
    mkdirSync(join(dir, FIXTURES.project, ".git"));
    writeFileSync(join(dir, FIXTURES.project, ".git", "config"), `[core]\n\tfsmonitor = touch ${seen}; echo\n`);
    const result = await checkPack(dir, { env: { ...process.env, ANTHROPIC_API_KEY: "sk-leak" } });
    expect(result).toMatchObject({ ready: false, run: null });
    expect(result.problems).toContainEqual({ file: join(dir, FIXTURES.project), field: ".git/config", message: "is inside .git: a project's own git files would run commands the harness never chose" });
    expect(existsSync(seen)).toBe(false);
  }, RUN_TIMEOUT);
});
