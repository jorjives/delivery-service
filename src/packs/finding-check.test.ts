import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PATTERN_LIMIT } from "./confirm.js";
import { checkFinding, commentBlind } from "./finding-check.js";
import { exampleRepo, sampleFinding } from "./review-fixtures.js";

const NEGATIVE = sampleFinding();
const SETTINGS = sampleFinding({
  id: "111111111111",
  where: { path: "settings.js", line: 5, endLine: 5 },
  anchor: 'return JSON.parse(readFileSync(path, "utf-8"));',
  check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] },
});
const edit = (repo: string, file: string, from: string, to: string): void =>
  writeFileSync(join(repo, file), readFileSync(join(repo, file), "utf-8").replace(from, to));

describe("whether a problem's code is still there, in the main copy at a commit", () => {
  it("finds flagged code that is there, and none in a file that is not", async () => {
    const repo = exampleRepo("finding-check-");
    expect(await checkFinding(NEGATIVE, { repoPath: repo, commit: "HEAD" })).toBe("present");
    expect(await checkFinding(sampleFinding({ where: { path: "gone.js", line: 1, endLine: 1 } }), { repoPath: repo, commit: "HEAD" })).toBe("resolved");
    expect(await checkFinding(SETTINGS, { repoPath: repo, commit: "HEAD" })).toBe("present");
  });
});

describe("whether a problem's code is still there, in a working copy", () => {
  it("is resolved when the flagged code is replaced or its file removed", async () => {
    const repo = exampleRepo("finding-check-");
    edit(repo, "checkout.js", "return price - discount;", "return Math.max(0, price - discount);");
    expect(await checkFinding(NEGATIVE, { worktreePath: repo })).toBe("resolved");
    rmSync(join(repo, "checkout.js"));
    expect(await checkFinding(NEGATIVE, { worktreePath: repo })).toBe("resolved");
  });

  it.each([
    ["a line comment", "// return price - discount;\n  return Math.max(0, price - discount);"],
    ["a block comment", "/* return price - discount; */ return Math.max(0, price - discount);"],
  ])("still finds flagged code commented out with %s", async (_, replacement) => {
    const repo = exampleRepo("finding-check-");
    edit(repo, "checkout.js", "return price - discount;", replacement);
    expect(await checkFinding(NEGATIVE, { worktreePath: repo })).toBe("present");
  });

  it("still finds flagged code of several lines commented out line by line", async () => {
    const repo = exampleRepo("finding-check-");
    const twoLines = sampleFinding({ where: { path: "settings.js", line: 4, endLine: 5 }, anchor: 'export function loadSettings(path) {\n  return JSON.parse(readFileSync(path, "utf-8"));' });
    edit(repo, "settings.js", 'export function loadSettings(path) {\n  return JSON.parse(readFileSync(path, "utf-8"));', '// export function loadSettings(path) {\n  // return JSON.parse(readFileSync(path, "utf-8"));\nexport function loadSettings(path) {\n  return {};');
    expect(await checkFinding(twoLines, { worktreePath: repo })).toBe("present");
  });

  it("judges a pattern by the files as the agent left them, new files included", async () => {
    const repo = exampleRepo("finding-check-");
    expect(await checkFinding(SETTINGS, { worktreePath: repo })).toBe("present");
    edit(repo, "settings.js", 'return JSON.parse(readFileSync(path, "utf-8"));', 'const text = readFileSync(path, "utf-8");\n  return JSON.parse(text);');
    expect(await checkFinding(SETTINGS, { worktreePath: repo })).toBe("resolved");
    writeFileSync(join(repo, "new.js"), "JSON.parse(readFileSync(x));\n");
    expect(await checkFinding(sampleFinding({ check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["new.js"] } }), { worktreePath: repo })).toBe("present");
  });

  it.each([
    ["a pattern git cannot run", { kind: "pattern-absent" as const, pattern: "(", paths: ["settings.js"] }],
    ["a pattern too long to run", { kind: "pattern-absent" as const, pattern: "a".repeat(PATTERN_LIMIT + 1), paths: ["settings.js"] }],
    ["a path that leads out of the project", { kind: "pattern-absent" as const, pattern: "x", paths: ["../x"] }],
  ])("is never resolved for %s: the check itself has a problem", async (_, check) => {
    const repo = exampleRepo("finding-check-");
    expect(await checkFinding(sampleFinding({ check }), { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("is never resolved when the flagged file has been swapped for a link", async () => {
    const repo = exampleRepo("finding-check-");
    rmSync(join(repo, "checkout.js"));
    symlinkSync("/dev/null", join(repo, "checkout.js"));
    expect(await checkFinding(NEGATIVE, { worktreePath: repo })).toEqual({ error: expect.any(String) });
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
    expect(await checkFinding(sampleFinding({ check }), { worktreePath: repo })).toEqual({ error: expect.any(String) });
  });

  it("still finds a pattern in a file the project's ignore list covers", async () => {
    const repo = exampleRepo("finding-check-");
    writeFileSync(join(repo, ".gitignore"), "new.js\n");
    writeFileSync(join(repo, "new.js"), "JSON.parse(readFileSync(x));\n");
    const check = { kind: "pattern-absent" as const, pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["new.js"] };
    expect(await checkFinding(sampleFinding({ check }), { worktreePath: repo })).toBe("present");
  });
});

describe("comparing code with comment markers set aside", () => {
  it("drops comment openers at the start of each line and closers at the end", () => {
    expect(commentBlind("  // a\n/* b */\n# c\n * d\n<!-- e -->")).toBe("a\nb\nc\nd\ne");
  });
});
