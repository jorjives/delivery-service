// The code-review example: the project with planted flaws that docs/task-packs.md and the
// slice 1 demo review. What `delivery review` prints for it is proven by the command tests;
// this file holds what the fixture itself must be.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { checkItem } from "../src/item-check.js";
import { EXAMPLE_DIR, EXAMPLE_IDEAS, EXAMPLE_SECURITY_IDEAS, exampleRepo } from "../src/packs/review-fixtures.js";

describe("the code-review example", () => {
  it("passes its own tests as shipped, so the flaws are ones the tests miss", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: EXAMPLE_DIR, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source and no configuration file, so a copy is ready for git init", () => {
    const files = readdirSync(EXAMPLE_DIR, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(EXAMPLE_DIR, join(entry.parentPath, entry.name)));
    expect(files.sort()).toEqual(["README.md", "auth/session.js", "checkout.js", "checkout.test.js", "legacy-gateway.js", "package-lock.json", "package.json", "payments.js", "settings.js"]);
  });

  it("has a scripted code review whose three real problems its checks find in it, and whose fourth they do not", async () => {
    const repo = exampleRepo();
    const results = await Promise.all(EXAMPLE_IDEAS.map((idea) => checkItem(idea.check, { repoPath: repo, commit: "HEAD" })));
    expect(results).toEqual(["present", "present", "present", "resolved"]);
  });

  it("has a scripted security review both of whose problems its checks find", async () => {
    const repo = exampleRepo();
    expect(await Promise.all(EXAMPLE_SECURITY_IDEAS.map((idea) => checkItem(idea.check, { repoPath: repo, commit: "HEAD" })))).toEqual(["present", "present"]);
  });
});
