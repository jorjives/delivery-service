import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atOrAbove, checkItem, commentBlind, FILE_LIMIT, PATTERN_LIMIT } from "./item-check.js";
import { exampleRepo, PAYMENTS_PASSWORD } from "./packs/review-fixtures.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import type { ItemCheck } from "./schema.js";

const NEGATIVE: ItemCheck = { kind: "anchor-gone", path: "checkout.js", anchor: "return price - discount;" };
const SETTINGS: ItemCheck = { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] };
const edit = (repo: string, file: string, from: string, to: string): void =>
  writeFileSync(join(repo, file), readFileSync(join(repo, file), "utf-8").replace(from, to));

describe("whether a problem's code is still there, in the main copy at a commit", () => {
  it("finds flagged code that is there, and none in a file that is not", async () => {
    const repo = exampleRepo("finding-check-");
    expect(await checkItem(NEGATIVE, { repoPath: repo, commit: "HEAD" })).toBe("present");
    expect(await checkItem({ kind: "anchor-gone", path: "gone.js", anchor: "return price - discount;" }, { repoPath: repo, commit: "HEAD" })).toBe("resolved");
    expect(await checkItem(SETTINGS, { repoPath: repo, commit: "HEAD" })).toBe("present");
  });
});

describe("whether a problem's code is still there, in a working copy", () => {
  it("is resolved when the flagged code is replaced or its file removed", async () => {
    const repo = exampleRepo("finding-check-");
    edit(repo, "checkout.js", "return price - discount;", "return Math.max(0, price - discount);");
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toBe("resolved");
    rmSync(join(repo, "checkout.js"));
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toBe("resolved");
  });

  it.each([
    ["a line comment", "// return price - discount;\n  return Math.max(0, price - discount);"],
    ["a block comment", "/* return price - discount; */ return Math.max(0, price - discount);"],
  ])("still finds flagged code commented out with %s", async (_, replacement) => {
    const repo = exampleRepo("finding-check-");
    edit(repo, "checkout.js", "return price - discount;", replacement);
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toBe("present");
  });

  it("still finds flagged code of several lines commented out line by line", async () => {
    const repo = exampleRepo("finding-check-");
    const twoLines: ItemCheck = { kind: "anchor-gone", path: "settings.js", anchor: 'export function loadSettings(path) {\n  return JSON.parse(readFileSync(path, "utf-8"));' };
    edit(repo, "settings.js", 'export function loadSettings(path) {\n  return JSON.parse(readFileSync(path, "utf-8"));', '// export function loadSettings(path) {\n  // return JSON.parse(readFileSync(path, "utf-8"));\nexport function loadSettings(path) {\n  return {};');
    expect(await checkItem(twoLines, { worktreePath: repo })).toBe("present");
  });

  it("judges a pattern by the files as the agent left them, new files included", async () => {
    const repo = exampleRepo("finding-check-");
    expect(await checkItem(SETTINGS, { worktreePath: repo })).toBe("present");
    edit(repo, "settings.js", 'return JSON.parse(readFileSync(path, "utf-8"));', 'const text = readFileSync(path, "utf-8");\n  return JSON.parse(text);');
    expect(await checkItem(SETTINGS, { worktreePath: repo })).toBe("resolved");
    writeFileSync(join(repo, "new.js"), "JSON.parse(readFileSync(x));\n");
    expect(await checkItem({ kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["new.js"] }, { worktreePath: repo })).toBe("present");
  });

  it.each([
    ["a pattern git cannot run", { kind: "pattern-absent" as const, pattern: "(", paths: ["settings.js"] }],
    ["a pattern too long to run", { kind: "pattern-absent" as const, pattern: "a".repeat(PATTERN_LIMIT + 1), paths: ["settings.js"] }],
    ["a path that leads out of the project", { kind: "pattern-absent" as const, pattern: "x", paths: ["../x"] }],
  ])("is never resolved for %s: the check itself has a problem", async (_, check) => {
    const repo = exampleRepo("finding-check-");
    expect(await checkItem(check, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is never resolved when the flagged file has been swapped for a link", async () => {
    const repo = exampleRepo("finding-check-");
    rmSync(join(repo, "checkout.js"));
    symlinkSync("/dev/null", join(repo, "checkout.js"));
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is never resolved when a folder on the flagged file's path has been swapped for a link", async () => {
    const repo = exampleRepo("finding-check-");
    const kept = join(repo, "..", `kept-${Date.now()}`);
    mkdirSync(kept);
    writeFileSync(join(kept, "checkout.js"), "export const total = () => 0;\n");
    symlinkSync(kept, join(repo, "lib"));
    const nested: ItemCheck = { kind: "anchor-gone", path: "lib/checkout.js", anchor: "return price - discount;" };
    expect(await checkItem(nested, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is never resolved, and never waits, when the flagged file has been swapped for a pipe", async () => {
    const repo = exampleRepo("finding-check-");
    rmSync(join(repo, "checkout.js"));
    execFileSync("mkfifo", [join(repo, "checkout.js")]);
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is resolved when a folder on the flagged file's path has been replaced by a file", async () => {
    const repo = exampleRepo("finding-check-");
    writeFileSync(join(repo, "lib"), "not a folder\n");
    expect(await checkItem({ kind: "anchor-gone", path: "lib/checkout.js", anchor: "return price - discount;" }, { worktreePath: repo })).toBe("resolved");
  });

  it("is never resolved when the flagged file is too large to read", async () => {
    const repo = exampleRepo("finding-check-");
    writeFileSync(join(repo, "checkout.js"), "x".repeat(FILE_LIMIT + 1));
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it.each([
    ["a file the pattern names", "settings.js", ["settings.js"]],
    ["a file inside a folder the pattern names", "lib/settings.js", ["lib"]],
  ])("is never resolved when %s is a link to the same code", async (_, link, paths) => {
    const repo = exampleRepo("finding-check-");
    writeFileSync(join(repo, "..", "kept-settings.js"), readFileSync(join(repo, "settings.js")));
    rmSync(join(repo, "settings.js"));
    mkdirSync(join(repo, "lib"));
    symlinkSync(join(repo, "..", "kept-settings.js"), join(repo, link));
    const check = { kind: "pattern-absent" as const, pattern: "JSON\\.parse\\(readFileSync\\(", paths };
    expect(await checkItem(check, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is never resolved when a folder on a pattern's path is swapped for a link to the same code", async () => {
    const repo = exampleRepo("finding-check-");
    mkdirSync(join(repo, "lib"));
    writeFileSync(join(repo, "lib", "settings.js"), readFileSync(join(repo, "settings.js")));
    execFileSync("git", ["add", "lib"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "lib"], { cwd: repo });
    const kept = join(repo, "..", `kept-lib-${Date.now()}`);
    renameSync(join(repo, "lib"), kept);
    symlinkSync(kept, join(repo, "lib"));
    const check = { kind: "pattern-absent" as const, pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["lib/settings.js"] };
    expect(await checkItem(check, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it.each([["--assume-unchanged"], ["--skip-worktree"]])("is never resolved when a file the pattern names is marked %s", async (flag) => {
    const repo = exampleRepo("finding-check-");
    execFileSync("git", ["update-index", flag, "settings.js"], { cwd: repo });
    expect(await checkItem(SETTINGS, { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("still finds a pattern in a file the project's ignore list covers", async () => {
    const repo = exampleRepo("finding-check-");
    writeFileSync(join(repo, ".gitignore"), "new.js\n");
    writeFileSync(join(repo, "new.js"), "JSON.parse(readFileSync(x));\n");
    const check = { kind: "pattern-absent" as const, pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["new.js"] };
    expect(await checkItem(check, { worktreePath: repo })).toBe("present");
  });
});

describe("comparing code with comment markers set aside", () => {
  it("drops comment openers at the start of each line and closers at the end", () => {
    expect(commentBlind("  // a\n/* b */\n# c\n * d\n<!-- e -->")).toBe("a\nb\nc\nd\ne");
  });
});

const LOCK = (version: string): string => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/minimist": { version } } }, null, 2);
const MINIMIST: ItemCheck = { kind: "dependency-absent", package: "minimist", version: "1.2.5" };

describe("whether a vulnerable library version is still installed", () => {
  it("is present while the lockfile installs it, at a commit and in a working copy", async () => {
    const repo = initTempRepo("dependency-check-", { "package-lock.json": LOCK("1.2.5") });
    expect(await checkItem(MINIMIST, { repoPath: repo, commit: "HEAD" })).toBe("present");
    expect(await checkItem(MINIMIST, { worktreePath: repo })).toBe("present");
  });

  it("is resolved once the lockfile installs another version", async () => {
    const repo = initTempRepo("dependency-check-", { "package-lock.json": LOCK("1.2.6") });
    expect(await checkItem(MINIMIST, { worktreePath: repo })).toBe("resolved");
  });

  it("cannot say, never resolved, when the lockfile is missing or unreadable", async () => {
    const missing = initTempRepo("dependency-check-", { "a.js": "x\n" });
    expect(await checkItem(MINIMIST, { worktreePath: missing })).toEqual({ error: "package-lock.json is not in the project, so which versions are installed cannot be read" });
    const broken = initTempRepo("dependency-check-", { "package-lock.json": "not json" });
    expect(await checkItem(MINIMIST, { worktreePath: broken })).toEqual({ error: "package-lock.json could not be read as an npm lockfile" });
  });
});

describe("a secret's check looks across the whole project", () => {
  const LINE = `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`;
  const SECRET: ItemCheck = { kind: "anchor-gone", path: "payments.js", anchor: LINE, scope: "repo", sensitive: true };

  it("is present while the secret is in its file", async () => {
    const repo = exampleRepo("secret-check-");
    expect(await checkItem(SECRET, { repoPath: repo, commit: "HEAD" })).toBe("present");
    expect(await checkItem(SECRET, { worktreePath: repo })).toBe("present");
  });

  it("is still present when the secret is moved to another file, committed or not", async () => {
    const repo = exampleRepo("secret-check-");
    edit(repo, "payments.js", LINE, "import { PAYMENTS_PASSWORD } from \"./config.js\";");
    writeFileSync(join(repo, "config.js"), `export const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";\n`);
    expect(await checkItem(SECRET, { worktreePath: repo })).toBe("present");
    execFileSync("git", ["add", "-A"], { cwd: repo, env: cleanGitEnv() });
    execFileSync("git", ["commit", "-m", "move it"], { cwd: repo, env: cleanGitEnv() });
    expect(await checkItem(SECRET, { repoPath: repo, commit: "HEAD" })).toBe("present");
  });

  it("is resolved once the secret is nowhere in the project, a file git ignores aside", async () => {
    const repo = exampleRepo("secret-check-");
    edit(repo, "payments.js", LINE, "const PAYMENTS_PASSWORD = process.env.PAYMENTS_PASSWORD;");
    writeFileSync(join(repo, ".gitignore"), ".env\n");
    writeFileSync(join(repo, ".env"), `PAYMENTS_PASSWORD=${PAYMENTS_PASSWORD}\n`);
    expect(await checkItem(SECRET, { worktreePath: repo })).toBe("resolved");
  });

  it("leaves a problem in an ordinary category judged by its own file", async () => {
    const repo = exampleRepo("secret-check-");
    writeFileSync(join(repo, "copy.js"), "return price - discount;\n");
    edit(repo, "checkout.js", "return price - discount;", "return Math.max(0, price - discount);");
    expect(await checkItem(NEGATIVE, { worktreePath: repo })).toBe("resolved");
  });
});

describe("an item check never reads the harness's own records", () => {
  it("does not find a secret in the backlog item that describes it", async () => {
    const LINE = 'const PAYMENTS_PASSWORD = "pay-live-7Hq2xV9rLm4K";';
    const repo = initTempRepo("item-check-backlog-", {
      "payments.js": "export const pay = () => 1;\n",
      ".delivery/backlog/20261019T120000Z-key-in-code.md": `---\nstatus: idea\nseverity: critical\ncheck:\n  kind: anchor-gone\n  path: payments.js\n  anchor: '${LINE}'\n  scope: repo\n  sensitive: true\n---\n# A key is written in the code\n`,
    });
    const check: ItemCheck = { kind: "anchor-gone", path: "payments.js", anchor: LINE, scope: "repo", sensitive: true };
    expect(await checkItem(check, { worktreePath: repo }, "20261019T120000Z-key-in-code.md")).toBe("resolved");
    expect(await checkItem(check, { repoPath: repo, commit: "HEAD" }, "20261019T120000Z-key-in-code.md")).toBe("resolved");
  });

  it("finds a secret copied into another backlog item, whatever the item that describes it", async () => {
    const LINE = 'const PAYMENTS_PASSWORD = "pay-live-7Hq2xV9rLm4K";';
    const OWN = "20261019T120000Z-key-in-code.md";
    const repo = initTempRepo("item-check-copied-", {
      "payments.js": "export const pay = () => 1;\n",
      [`.delivery/backlog/${OWN}`]: `---\nstatus: idea\n---\n# A key is written in the code\n${LINE}\n`,
      ".delivery/backlog/20261019T130000Z-other.md": `---\nstatus: idea\n---\n# Another item\n${LINE}\n`,
    });
    const check: ItemCheck = { kind: "anchor-gone", path: "payments.js", anchor: LINE, scope: "repo", sensitive: true };
    expect(await checkItem(check, { worktreePath: repo }, OWN)).toBe("present");
    expect(await checkItem(check, { repoPath: repo, commit: "HEAD" }, OWN)).toBe("present");
  });

  it("refuses a pattern that names the backlog folder", async () => {
    const repo = initTempRepo("item-check-pattern-", {
      "a.js": "ok\n",
      ".delivery/backlog/20261019T120000Z-eval.md": "---\nstatus: idea\n---\n# eval(x) is used\n",
    });
    expect(await checkItem({ kind: "pattern-absent", pattern: "eval\\(", paths: [".delivery/backlog"] }, { worktreePath: repo })).toEqual({
      error: "the check looks inside .delivery, where the harness keeps its own records",
    });
  });

  it("refuses a pattern that names a path inside .delivery", async () => {
    const repo = initTempRepo("item-check-pattern-", { "a.js": "ok\n", ".delivery/notes.md": "eval(x)\n" });
    expect(await checkItem({ kind: "pattern-absent", pattern: "eval\\(", paths: [".delivery/notes.md"] }, { worktreePath: repo })).toEqual({
      error: "the check looks inside .delivery, where the harness keeps its own records",
    });
  });

  it("refuses a check whose file is inside .delivery", async () => {
    const repo = initTempRepo("item-check-own-", { ".delivery/backlog/20261019T120000Z-x.md": "---\nstatus: idea\n---\n# x\n" });
    expect(await checkItem({ kind: "anchor-gone", path: ".delivery/backlog/20261019T120000Z-x.md", anchor: "status: idea" }, { worktreePath: repo })).toEqual({
      error: "the check looks inside .delivery, where the harness keeps its own records",
    });
  });
});

describe("severity thresholds", () => {
  it("holds what is at or above the threshold, and nothing without one", () => {
    expect(atOrAbove("critical", "high")).toBe(true);
    expect(atOrAbove("high", "high")).toBe(true);
    expect(atOrAbove("medium", "high")).toBe(false);
    expect(atOrAbove("critical", undefined)).toBe(false);
  });
});
