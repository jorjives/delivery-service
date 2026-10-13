// The code-review example: the project with planted flaws that docs/task-packs.md and the
// slice 1 demo review. What `delivery review` prints for it is proven by the command tests;
// this file holds what the fixture itself must be.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectEnvelope } from "../src/mock-script.js";
import { confirmFindings } from "../src/packs/confirm.js";
import { resolvePack } from "../src/packs/manifest.js";
import { EXAMPLE_DIR, EXAMPLE_SCAN, EXAMPLE_SECURITY_SCAN, SCOPED_SCAN, exampleRepo } from "../src/packs/review-fixtures.js";
import { scannerRoleConfig } from "../src/packs/scanner-role.js";
import { git } from "./helpers.js";

describe("the code-review example", () => {
  it("passes its own tests as shipped, so the flaws are ones the tests miss", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: EXAMPLE_DIR, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source and no configuration file, so a copy is ready for git init", () => {
    const files = readdirSync(EXAMPLE_DIR, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(EXAMPLE_DIR, join(entry.parentPath, entry.name)));
    expect(files.sort()).toEqual(["README.md", "auth/session.js", "checkout.js", "checkout.test.js", "legacy-gateway.js", "package-lock.json", "package.json", "payments.js", "settings.js"]);
  });

  it("has a scripted review the code pack accepts, whose three real problems are confirmed in it and whose fourth is not", async () => {
    const pack = await resolvePack("code", "/");
    expectEnvelope(scannerRoleConfig(pack), EXAMPLE_SCAN);
    const repo = exampleRepo();
    const result = await confirmFindings(repo, git(repo, ["rev-parse", "HEAD"]), { pack: "code", maxFindings: 40 }, EXAMPLE_SCAN);
    expect(result.findings.map((finding) => finding.check.kind).sort()).toEqual(["anchor-gone", "none", "pattern-absent"]);
    expect(result.unconfirmed.map((u) => u.reason)).toEqual(["no_such_file"]);
  });

  it("has a scripted review of its auth folder the code pack accepts", async () => {
    expectEnvelope(scannerRoleConfig(await resolvePack("code", "/")), SCOPED_SCAN);
  });

  it("has a scripted security review the security pack accepts, both of whose problems are confirmed with their own checks", async () => {
    const pack = await resolvePack("security", "/");
    expectEnvelope(scannerRoleConfig(pack), EXAMPLE_SECURITY_SCAN);
    const repo = exampleRepo();
    const result = await confirmFindings(repo, git(repo, ["rev-parse", "HEAD"]), { pack: "security", maxFindings: 40 }, EXAMPLE_SECURITY_SCAN);
    expect(result.findings.map((finding) => finding.check.kind)).toEqual(["anchor-gone", "dependency-absent"]);
    expect(result.unconfirmed).toEqual([]);
  });
});
