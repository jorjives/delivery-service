import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.js";
import { GuardSwitches, type GateRef } from "./schema.js";
import { initTempRepo } from "./temp-repo.js";
import { FILE_LIMIT } from "./packs/confirm.js";
import {
  CHECK_GUARD,
  DEFAULT_GUARDS,
  DEFAULT_ON,
  EDIT_GUARD,
  guardAssertions,
  guardListsFor,
  GuardName,
  ignoredAssertions,
  ignoredId,
  needsTestChange,
  SKIP_GUARD,
  TESTS_GUARD,
  type ActiveGuards,
} from "./guards.js";

describe("what a fix may not touch", () => {
  it("is the harness's defaults when a pack adds nothing", () => {
    expect(guardListsFor(undefined)).toEqual(DEFAULT_GUARDS);
    expect(DEFAULT_GUARDS.testGlobs).toContain("**/*.test.*");
    expect(DEFAULT_GUARDS.protectedGlobs).toEqual(expect.arrayContaining([".github/workflows/**", "**/.gitignore"]));
    expect(DEFAULT_GUARDS.skipMarkers).toEqual(expect.arrayContaining([".skip(", "xit(", "@Ignore", "pytest.mark.skip"]));
  });

  it("adds a pack's own after the defaults, each once", () => {
    const lists = guardListsFor({ testGlobs: ["e2e/**", "**/*.test.*"], protectedGlobs: ["deno.json"], skipMarkers: ["@pending"] });
    expect(lists.testGlobs).toEqual([...DEFAULT_GUARDS.testGlobs, "e2e/**"]);
    expect(lists.protectedGlobs.at(-1)).toBe("deno.json");
    expect(lists.skipMarkers.at(-1)).toBe("@pending");
  });
});

const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const GUARDS: ActiveGuards = { lists: DEFAULT_GUARDS, on: GuardName.options };
const PROJECT = {
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2),
  "checkout.js": "export const total = (p, d) => p - d;\n",
  "checkout.test.js": "import { test } from 'node:test';\ntest('takes the discount off', () => {});\n",
  ".github/workflows/ci.yml": "on: push\n",
};
const put = (repo: string, path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const commit = (repo: string): void => {
  for (const args of [["add", "-A"], ["commit", "-qm", "agent"]]) execFileSync("git", args, { cwd: repo, env: cleanGitEnv() });
};
const outcomes = async (repo: string, guards: ActiveGuards = GUARDS, verify = NPM) =>
  Object.fromEntries((await guardAssertions(repo, "main", guards, verify)).map((a) => [a.id, a.outcome]));
const exclude = (repo: string, pattern: string): void => appendFileSync(join(repo, ".git", "info", "exclude"), `${pattern}\n`);

describe("whether a change touched the tests", () => {
  it("passes a change to the code alone, and one that adds a new test file", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "checkout.js", "export const total = (p, d) => Math.max(0, p - d);\n");
    put(repo, "clamp.test.js", "import { test } from 'node:test';\ntest('never below zero', () => {});\n");
    expect(await outcomes(repo)).toEqual({ [TESTS_GUARD]: "PASS", [EDIT_GUARD]: "PASS", [CHECK_GUARD]: "PASS", [SKIP_GUARD]: "PASS" });
  });

  it("passes a change to the code alone where an ignore rule matches a tracked test file", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    exclude(repo, "*.test.js");
    put(repo, "checkout.js", "export const total = (p, d) => Math.max(0, p - d);\n");
    expect(await outcomes(repo)).toEqual({ [TESTS_GUARD]: "PASS", [EDIT_GUARD]: "PASS", [CHECK_GUARD]: "PASS", [SKIP_GUARD]: "PASS" });
  });

  it.each([["left uncommitted", false], ["committed", true]])("refuses a deleted test file, %s", async (_, committed) => {
    const repo = initTempRepo("guards-", PROJECT);
    rmSync(join(repo, "checkout.test.js"));
    if (committed) {
      execFileSync("git", ["checkout", "-qb", "fix"], { cwd: repo, env: cleanGitEnv() });
      commit(repo);
    }
    const [tests] = await guardAssertions(repo, "main", GUARDS, NPM);
    expect(tests).toMatchObject({ id: TESTS_GUARD, outcome: "FAIL", detail: expect.stringContaining("checkout.test.js") });
  });

  it("refuses a modified test file and one under a tests folder as an edit, and a renamed one as a removal", async () => {
    const edited = initTempRepo("guards-", PROJECT);
    put(edited, "checkout.test.js", "import { test } from 'node:test';\ntest('takes the discount off', () => { /* nothing */ });\n");
    expect(await outcomes(edited)).toMatchObject({ [EDIT_GUARD]: "FAIL", [TESTS_GUARD]: "PASS" });
    const renamed = initTempRepo("guards-", PROJECT);
    execFileSync("git", ["mv", "checkout.test.js", "checkout.old.js"], { cwd: renamed, env: cleanGitEnv() });
    expect(await outcomes(renamed)).toMatchObject({ [TESTS_GUARD]: "FAIL", [EDIT_GUARD]: "PASS" });
    const nested = initTempRepo("guards-", { ...PROJECT, "pkg/tests/helpers.py": "x = 1\n" });
    put(nested, "pkg/tests/helpers.py", "x = 2\n");
    expect((await outcomes(nested))[EDIT_GUARD]).toBe("FAIL");
  });

  it("for a problem whose fix changes tests, allows modifying a test and still refuses deleting one", async () => {
    const tests = { ...GUARDS, on: GuardName.options.filter((name) => name !== "tests-unchanged") };
    const changed = initTempRepo("guards-", PROJECT);
    put(changed, "checkout.test.js", "import { test } from 'node:test';\ntest('takes the discount off', () => { /* stronger */ });\n");
    expect(await outcomes(changed, tests)).not.toHaveProperty(EDIT_GUARD);
    expect((await outcomes(changed, tests))[TESTS_GUARD]).toBe("PASS");
    const deleted = initTempRepo("guards-", PROJECT);
    rmSync(join(deleted, "checkout.test.js"));
    expect((await outcomes(deleted, tests))[TESTS_GUARD]).toBe("FAIL");
  });

  it("tells the agent, in the refusal of a modified test, to stop and say so if only a test change would fix the problem", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "checkout.test.js", "// nothing\n");
    const edit = (await guardAssertions(repo, "main", GUARDS, NPM)).find((a) => a.id === EDIT_GUARD);
    expect(edit?.detail).toContain("checkout.test.js changed");
    expect(edit?.detail).toContain("stop and say so");
  });

  it.each([
    [[EDIT_GUARD], true],
    [[EDIT_GUARD, "finding:0123456789ab:resolved"], true],
    [[TESTS_GUARD], false],
    [[EDIT_GUARD, SKIP_GUARD], false],
    [[EDIT_GUARD, CHECK_GUARD], false],
    [[EDIT_GUARD, ignoredId("vitest.config.ts")], false],
    [[], false],
  ])("reads whether a gate round says a test change is needed: %j is %s", (round, needed) => expect(needsTestChange(round)).toBe(needed));

  it.each([
    ["a CI workflow", (repo: string) => put(repo, ".github/workflows/ci.yml", "on: never\n")],
    ["a new test-runner setting", (repo: string) => put(repo, "vitest.config.ts", "export default { test: { exclude: ['**'] } };\n")],
    ["the test script", (repo: string) => put(repo, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test || true" } }))],
    ["a script npm test runs first", (repo: string) => put(repo, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test", pretest: "exit 0" } }))],
    ["the test runner's settings in package.json", (repo: string) => put(repo, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test" }, jest: { testPathIgnorePatterns: ["."] } }))],
    ["a file the project's own test command runs", (repo: string) => put(repo, "run-tests.sh", "exit 0\n")],
  ])("refuses a change to %s", async (_, change) => {
    const repo = initTempRepo("guards-", { ...PROJECT, "run-tests.sh": "node --test\n" });
    change(repo);
    expect((await outcomes(repo, GUARDS, { type: "command", command: "./run-tests.sh", parseMode: "exitcode" }))[CHECK_GUARD]).toBe("FAIL");
  });

  it("allows a change to package.json that leaves how tests run alone", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test" }, dependencies: { zod: "^4.0.0" } }));
    expect((await outcomes(repo))[CHECK_GUARD]).toBe("PASS");
  });

  it.each([
    ["a skipped test", "test.skip('takes the discount off', () => {});"],
    ["a test switched off by .only", "test.only('another', () => {});"],
    ["a skip marker a pack adds", "// @pending"],
  ])("refuses an added line with %s, in any file, new or old", async (_, line) => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "more.test.js", `import { test } from 'node:test';\n${line}\n`);
    const skips = (await guardAssertions(repo, "main", { ...GUARDS, lists: { ...GUARDS.lists, skipMarkers: [...GUARDS.lists.skipMarkers, "@pending"] } }, NPM)).find((a) => a.id === SKIP_GUARD);
    expect(skips).toMatchObject({ id: SKIP_GUARD, outcome: "FAIL", detail: expect.stringContaining("more.test.js") });
  });

  it("refuses a skip marker in a file the change marks as binary, so git would not show its lines", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, ".gitattributes", "*.test.js -diff\n");
    put(repo, "more.test.js", "import { test } from 'node:test';\ntest.only('another', () => {});\n");
    expect((await outcomes(repo))[SKIP_GUARD]).toBe("FAIL");
  });

  it("does not refuse removing a skip marker", async () => {
    const repo = initTempRepo("guards-", { ...PROJECT, "slow.js": "describe.skip('slow', () => {});\n" });
    put(repo, "slow.js", "describe('slow', () => {});\n");
    expect((await outcomes(repo))[SKIP_GUARD]).toBe("PASS");
  });

  describe("a file git ignores, which the tests still read from disk", () => {
    const CONFIG = "export default { test: { exclude: ['**'] } };\n";
    const refusedAs = async (repo: string, path: string) => {
      const found = await ignoredAssertions(repo, GUARDS);
      expect(found.map((a) => a.id)).toEqual([ignoredId(path)]);
      expect(found[0]).toMatchObject({ outcome: "FAIL", detail: expect.stringContaining(path) });
      expect((await outcomes(repo))[ignoredId(path)]).toBe("FAIL");
    };

    it("refuses a test-runner config hidden by an edit to .gitignore, and the edit itself", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "node_modules\n" });
      put(repo, ".gitignore", "node_modules\nvitest.config.ts\n");
      put(repo, "vitest.config.ts", CONFIG);
      await refusedAs(repo, "vitest.config.ts");
      expect((await outcomes(repo))[CHECK_GUARD]).toBe("FAIL");
    });

    it("refuses one hidden by .git/info/exclude, which no tracked file shows", async () => {
      const repo = initTempRepo("guards-", PROJECT);
      exclude(repo, "conftest.py");
      put(repo, "conftest.py", "collect_ignore_glob = ['*']\n");
      await refusedAs(repo, "conftest.py");
      expect((await outcomes(repo))[CHECK_GUARD]).toBe("PASS");
    });

    it("refuses one hidden by a pattern the project's ignore rules already held", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "*.config.*\n" });
      put(repo, "vitest.config.ts", CONFIG);
      await refusedAs(repo, "vitest.config.ts");
    });

    it("refuses an ignored test file that switches the others off with .only", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "only.test.js\n" });
      put(repo, "only.test.js", "describe.only('all', () => {});\n");
      await refusedAs(repo, "only.test.js");
    });

    it("refuses an ignored test file too large to read for a skip marker, never passing it unread", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "dist/\n" });
      put(repo, "dist/huge.test.js", "x".repeat(FILE_LIMIT + 1));
      await refusedAs(repo, "dist/huge.test.js");
    });

    it("passes a new test whose run leaves compiled, cached and report output where git ignores it, under test paths", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "dist/\n__pycache__/\nbuild/\n" });
      const NEW_TEST = "import { test } from 'node:test';\ntest('never below zero', () => {});\n";
      put(repo, "clamp.test.ts", NEW_TEST);
      put(repo, "dist/clamp.test.js", NEW_TEST); // TypeScript compiled into an ignored folder: matches **/*.test.*
      // Python's cache of a test that was already skipped: binary (it holds NUL bytes), so never read for a marker. Matches **/tests/**.
      put(repo, "tests/__pycache__/test_clamp.cpython-312.pyc", "\u0000\r\r\n\u0000pytest.mark.skip\u0000");
      put(repo, "build/test-results/test/TEST-ClampTest.xml", '<testsuite name="ClampTest" tests="1" skipped="0"/>\n'); // Gradle's report: matches **/test/**
      expect(await ignoredAssertions(repo, GUARDS)).toEqual([]);
      expect(Object.values(await outcomes(repo)).every((outcome) => outcome === "PASS")).toBe(true);
    });

    it("leaves a dependency folder alone, and an ignored file that matches no guarded path", async () => {
      const repo = initTempRepo("guards-", { ...PROJECT, ".gitignore": "node_modules\n.venv\nnotes.txt\n" });
      put(repo, "node_modules/pkg/jest.config.js", "module.exports = {};\n");
      put(repo, "node_modules/pkg/tests/a.test.js", "x\n");
      put(repo, ".venv/lib/tests/test_a.py", "x\n");
      put(repo, "notes.txt", "x\n");
      expect(await ignoredAssertions(repo, GUARDS)).toEqual([]);
      expect(Object.values(await outcomes(repo)).every((outcome) => outcome === "PASS")).toBe(true);
    });
  });

  it.each([["--skip-worktree"], ["--assume-unchanged"]])("refuses a test file git is told not to read from disk (%s), then deleted", async (flag) => {
    const repo = initTempRepo("guards-", PROJECT);
    execFileSync("git", ["update-index", flag, "checkout.test.js"], { cwd: repo, env: cleanGitEnv() });
    rmSync(join(repo, "checkout.test.js"));
    expect((await outcomes(repo))[CHECK_GUARD]).toBe("FAIL");
  });

  it("judges against the commit the work started from, not where the base branch has moved since", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, env: cleanGitEnv() }).toString().trim();
    const start = git(["rev-parse", "HEAD"]);
    rmSync(join(repo, "checkout.test.js"));
    commit(repo); // the branch moves on, deleting the test
    expect(Object.fromEntries((await guardAssertions(repo, start, GUARDS, NPM)).map((a) => [a.id, a.outcome]))[TESTS_GUARD]).toBe("FAIL");
  });
});

describe("which guards are judged", () => {
  it("are, by default, the ones that catch weakening and never block honest work", () => {
    expect(DEFAULT_ON).toEqual(["tests-untouched", "check-untouched", "no-skips", "ignored"]);
  });

  it("leaves out a guard that is off: an edit to an existing test is no failure by default", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "checkout.test.js", "import { test } from 'node:test';\ntest('takes the whole discount off', () => {});\n");
    const judged = await outcomes(repo, { ...GUARDS, on: DEFAULT_ON });
    expect(judged).not.toHaveProperty(EDIT_GUARD);
    expect(judged[TESTS_GUARD]).toBe("PASS");
  });

  it("looks for no hidden files when the ignored-file guard is off", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    exclude(repo, "vitest.config.ts");
    put(repo, "vitest.config.ts", "export default {};\n");
    expect(await ignoredAssertions(repo, { ...GUARDS, on: ["tests-untouched"] })).toEqual([]);
  });

  it("are switched by name, and an unknown name is refused", () => {
    expect(GuardSwitches.safeParse({ add: ["tests-unchanged"], off: ["no-skips"] }).success).toBe(true);
    expect(GuardSwitches.safeParse({ off: ["tests"] }).success).toBe(false);
    expect(GuardSwitches.safeParse({ remove: ["no-skips"] }).success).toBe(false);
  });
});

describe("no-skips reads only test files", () => {
  it("does not refuse a skip-shaped method outside a test file", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "src/paginate.ts", "export const paginate = (items: unknown[]) => items.skip(1);\n");
    expect((await outcomes(repo))[SKIP_GUARD]).toBe("PASS");
  });

  it("still refuses a real skip marker added to a test", async () => {
    const repo = initTempRepo("guards-", PROJECT);
    put(repo, "checkout.test.js", "import { test } from 'node:test';\ntest.skip('later', () => {});\n");
    expect((await outcomes(repo))[SKIP_GUARD]).toBe("FAIL");
  });
});
