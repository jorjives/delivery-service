// The no-tests example: a project with planted flaws and no tests, for the case where nothing but
// a problem's own check, and the owner's sign-off, stands between a fix and the main copy.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferredCheck } from "../src/cli/project.js";
import { checkItem } from "../src/item-check.js";
import { exampleRepo, NO_TESTS_DIR, NO_TESTS_IDEAS } from "../src/packs/review-fixtures.js";

describe("the no-tests example", () => {
  it("ships only its source, with no test file and no test command to find", async () => {
    expect(readdirSync(NO_TESTS_DIR).sort()).toEqual(["README.md", "csv-export.js", "invoice.js", "main.js", "package.json", "settings.js"]);
    expect(await inferredCheck(exampleRepo("no-tests-", NO_TESTS_DIR))).toBeUndefined();
  });

  it("has a scripted code review whose three problems its checks all find in it", async () => {
    const repo = exampleRepo("no-tests-", NO_TESTS_DIR);
    const results = await Promise.all(NO_TESTS_IDEAS.map((idea) => checkItem(idea.check, { repoPath: repo, commit: "HEAD" })));
    expect(results).toEqual(["present", "present", "present"]);
  });
});
