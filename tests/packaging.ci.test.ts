// Slice 5: packs the package the way `npm publish` would, installs the tarball
// into an empty folder, and runs the installed command, so the boundary that
// reaches a user is exercised rather than described. This resolves the
// package's three runtime dependencies from the registry or the npm cache,
// which is why the whole suite is gated on `DELIVERY_PACK_TESTS`: skipped under a
// plain local `npm test`/`make verify`, and run as part of the same `npm test` in
// CI, whose workflow step sets `DELIVERY_PACK_TESTS=1`. This project's own variable,
// not the ambient `CI`, so an agent harness that exports `CI` around `make verify`
// does not silently arm a registry-touching check.
// tests/packaging.test.ts covers the same shape offline.
// `--ignore-scripts` on the pack is deliberate: `prepack` rebuilds `dist/`, and
// other test files are running the compiled command at the same time.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };

const INSTALL_TIMEOUT = 300_000;
let tarball: string;

// Scratch folders hold a tarball and a whole node_modules tree apiece: cleared, as
// tests/testing-your-pipeline-guide.test.ts clears its own.
const scratches: string[] = [];
const scratch = (prefix: string): string => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(path);
  return path;
};
afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

beforeAll(() => {
  const destination = scratch("delivery-pack-");
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  tarball = join(destination, report.filename);
}, INSTALL_TIMEOUT);

describe.skipIf(!process.env.DELIVERY_PACK_TESTS)("the packed tarball", () => {
  it("installs into an empty folder and gives a working delivery command", () => {
    const folder = scratch("delivery-install-");
    execFileSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", tarball], {
      cwd: folder,
      encoding: "utf-8",
    });
    const { stdout, status } = spawnSync(join(folder, "node_modules", ".bin", "delivery"), ["--version"], {
      encoding: "utf-8",
    });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  }, INSTALL_TIMEOUT);

  it("runs through npx without being installed first", () => {
    const folder = scratch("delivery-npx-");
    const stdout = execFileSync("npx", ["--yes", "--prefer-offline", "--package", tarball, "delivery", "--version"], {
      cwd: folder,
      encoding: "utf-8",
    });
    expect(stdout.trim()).toBe(pkg.version);
  }, INSTALL_TIMEOUT);
});
