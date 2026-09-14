import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { REPO_ROOT } from "./helpers.js";

const VENDORED = join(REPO_ROOT, "vendor/claude-mock");
const INSTALLED = join(REPO_ROOT, "node_modules/@jorj/claude-mock");
const BUILT = ["cli.js", "mock.js"];

/** What the prebuilt scripted agent may import: file and process plumbing, nothing that talks to a network. */
const ALLOWED_IMPORTS = new Set(["node:crypto", "node:fs", "node:path", "node:readline", "./mock.js"]);

describe("the vendored scripted agent", () => {
  it("is installed by npm install as a copy of vendor/claude-mock", () => {
    // A copy, not a symlink: a linked file: dependency makes npm install the vendored
    // project's own devDependencies (TypeScript 5, Vitest 4, a second Agent SDK) beside
    // ours. .npmrc's install-links=true is what keeps it a copy.
    expect(lstatSync(INSTALLED).isSymbolicLink()).toBe(false);
    expect(realpathSync(join(REPO_ROOT, "node_modules/.bin/claude-mock"))).toBe(join(INSTALLED, "dist/cli.js"));
    for (const file of BUILT) {
      expect(readFileSync(join(INSTALLED, "dist", file), "utf-8")).toBe(readFileSync(join(VENDORED, "dist", file), "utf-8"));
    }
  });

  it("commits its prebuilt entry point as an executable, so installing needs no build step", () => {
    const staged = execFileSync("git", ["ls-files", "-s", "--", "vendor/claude-mock/dist"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    });
    expect(staged).toMatch(/^100755 \S+ 0\tvendor\/claude-mock\/dist\/cli\.js$/m);
    expect(staged).toMatch(/\tvendor\/claude-mock\/dist\/mock\.js$/m);
  });

  it("has no dependencies and no way to reach a network", () => {
    const pkg = JSON.parse(readFileSync(join(VENDORED, "package.json"), "utf-8")) as { dependencies?: unknown };
    expect(pkg.dependencies).toBeUndefined();
    for (const file of BUILT) {
      const source = readFileSync(join(VENDORED, "dist", file), "utf-8");
      const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((specifier) => !ALLOWED_IMPORTS.has(specifier ?? ""))).toEqual([]);
      expect(source).not.toMatch(/\bimport\(|\brequire\(|\bfetch\(/);
    }
  });
});
