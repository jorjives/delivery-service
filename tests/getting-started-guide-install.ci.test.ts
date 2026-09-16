// Slice 5, gated on DELIVERY_PACK_TESTS exactly as tests/packaging.ci.test.ts is: actually packs the
// package and installs it two ways, because the guide teaches two different things.
// A global install (`npm install -g`) puts `delivery` on PATH, which is all Section 1 of the guide
// itself needs. It resolves nothing for a bare `import "delivery-service"` in a
// reader's own project: that needs a second, project-local install of the same
// tarball (no `-g`), which is what makes the other guides' snippets (Task 4) work.
// Both need the registry or a warm npm cache for the package's three runtime
// dependencies, so this stays out of a plain local `npm test`/`make verify`.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { packTarball, REPO_ROOT, sectionOf, useScratch } from "./helpers.js";

// Reading the guide, not just the tarball, ties this file to Task 3: it fails with
// ENOENT until docs/getting-started.md exists, the same way the offline guide test does.
const guide = readFileSync(join(REPO_ROOT, "docs/getting-started.md"), "utf-8");
const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
const INSTALL_TIMEOUT = 300_000;
let tarball: string;

const scratch = useScratch();

beforeAll(() => {
  tarball = packTarball(scratch("gs-pack-"));
}, INSTALL_TIMEOUT);

describe.skipIf(!process.env.DELIVERY_PACK_TESTS)("packing and installing the guide's way", () => {
  it("the guide's install section names both installs, and each one works", () => {
    const install = sectionOf(guide, "## 1. Install the command", "## 2.");
    expect(install).toMatch(/npm install(?! -g)[^\n]*delivery-service-\*\.tgz/);
  });

  it("global install (Section 1 of the guide): delivery lands on PATH", () => {
    const destination = scratch("gs-global-");
    execFileSync(
      "npm",
      ["install", "-g", "--prefix", destination, "--prefer-offline", "--no-audit", "--no-fund", tarball],
      { cwd: destination, encoding: "utf-8" },
    );
    const printed = spawnSync(join(destination, "bin", "delivery"), ["--version"], { encoding: "utf-8" });
    expect(printed.stdout.trim()).toBe(version);
  }, INSTALL_TIMEOUT);

  it("project-local install (also Section 1): import \"delivery-service\" resolves", () => {
    const project = scratch("gs-local-");
    execFileSync("npm", ["init", "-y"], { cwd: project, encoding: "utf-8" });
    execFileSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", tarball], {
      cwd: project,
      encoding: "utf-8",
    });
    // --input-type=module makes this ESM regardless of the scratch package.json's own
    // type, exactly as a reader's own ESM project would import it.
    const resolved = execFileSync(
      "node",
      ["--input-type=module", "-e", "import('delivery-service').then(() => console.log('resolved'))"],
      { cwd: project, encoding: "utf-8" },
    );
    expect(resolved.trim()).toBe("resolved");
  }, INSTALL_TIMEOUT);
});
