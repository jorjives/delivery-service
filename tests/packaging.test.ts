// Slice 5: the package boundary, checked without touching the network. `npm pack
// --dry-run` reports exactly what `npm publish` would send without contacting the
// registry or writing a tarball, so this runs in the default suite. Whether a
// packed tarball actually installs and runs is tests/packaging.ci.test.ts
// (CI only, via DELIVERY_PACK_TESTS): that needs the registry or a warm npm cache.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
  bin: Record<string, string>;
  exports: Record<string, { types: string; default: string }>;
};

/** What `npm publish` would send, without sending it or running `prepack`: the `dist/` the suite already built. */
function packReport(): { files: string[]; bundled: string[] } {
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: REPO_ROOT, encoding: "utf-8" }),
  ) as [{ files: { path: string }[]; bundled?: string[] }];
  return { files: report.files.map((file) => file.path), bundled: report.bundled ?? [] };
}

describe("the package", () => {
  it("exposes the delivery command, the library and the testing API", () => {
    expect(pkg.bin).toEqual({ delivery: "./dist/cli/main.js" });
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
    expect(pkg.exports["./testing"]).toEqual({ types: "./dist/testing.d.ts", default: "./dist/testing.js" });
  });

  it("ships its built output, its built-in reviews, its readme, its changelog and the scripted agent, and nothing else", () => {
    const { files, bundled } = packReport();
    const own = files.filter((path) => !path.startsWith("dist/") && !path.startsWith("node_modules/"));
    expect(own.filter((path) => !path.startsWith("packs/")).sort()).toEqual(["CHANGELOG.md", "README.md", "package.json"]);
    for (const file of ["packs/code-review/pack.json", "packs/code-review/scan.md", "packs/code-review/fix.md", "packs/code-review/fixtures/expect.json", "packs/code-review/fixtures/project/total.js", "packs/security-review/pack.json", "packs/security-review/scan.md", "packs/security-review/fix.md", "packs/security-review/fixtures/expect.json", "packs/security-review/fixtures/project/payments.js"]) expect(own).toContain(file);
    for (const file of ["dist/cli/main.js", "dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts", "dist/packs/manifest.js"]) expect(files).toContain(file);
    // The pack check runs a review folder against the scripted agent, so an installed copy carries it.
    expect(bundled).toEqual(["@jorj/claude-mock"]);
    expect(files).toContain("node_modules/@jorj/claude-mock/dist/cli.js");
  });

  // A check nothing arms runs nowhere. The skip is deliberate locally, so the only
  // thing standing between "skipped here" and "never runs at all" is this line in the
  // workflow: assert it, rather than trusting a comment two files away.
  it("arms the pack-and-install checks on CI's own test step", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8");
    expect(workflow).toMatch(/- run: npm test\n\s+env:\n\s+DELIVERY_PACK_TESTS: "1"/);
  });
});
