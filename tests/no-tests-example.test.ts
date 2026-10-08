// The no-tests example: a project with planted flaws and no tests, for the case where nothing but
// a problem's own check, and the owner's sign-off, stands between a fix and the main copy.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferredCheck } from "../src/cli/project.js";
import { expectEnvelope } from "../src/mock-script.js";
import { confirmFindings } from "../src/packs/confirm.js";
import { resolvePack } from "../src/packs/manifest.js";
import { exampleRepo, NO_TESTS_DIR, NO_TESTS_SCAN } from "../src/packs/review-fixtures.js";
import { scannerRoleConfig } from "../src/packs/scanner-role.js";
import { git } from "./helpers.js";

describe("the no-tests example", () => {
  it("ships only its source, with no test file and no test command to find", async () => {
    expect(readdirSync(NO_TESTS_DIR).sort()).toEqual(["README.md", "csv-export.js", "invoice.js", "main.js", "package.json", "settings.js"]);
    expect(await inferredCheck(exampleRepo("no-tests-", NO_TESTS_DIR))).toBeUndefined();
  });

  it("has a scripted code review whose three problems are all confirmed, two with a specific check and one with none", async () => {
    const pack = await resolvePack("code", "/");
    expectEnvelope(scannerRoleConfig(pack), NO_TESTS_SCAN);
    const repo = exampleRepo("no-tests-", NO_TESTS_DIR);
    const result = await confirmFindings(repo, git(repo, ["rev-parse", "HEAD"]), { pack: "code", maxFindings: 40 }, NO_TESTS_SCAN);
    expect(result.findings.map((finding) => [finding.severity, finding.check.kind])).toEqual([
      ["high", "anchor-gone"],
      ["medium", "pattern-absent"],
      ["low", "none"],
    ]);
    expect(result.unconfirmed).toEqual([]);
  });
});
