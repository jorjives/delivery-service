// The Operational note of task packs slice 7: both built-in packs run the same pack check an
// author runs, through the testing entry point, in every build, so a broken built-in pack fails it.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../src/packs/manifest.js";
import { checkPack } from "../src/testing.js";

const folders = readdirSync(BUILT_IN_PACKS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

describe("every built-in pack", () => {
  it("is found", () => {
    expect(folders.sort()).toEqual(["code-review", "deprecations", "security-review"]);
  });

  it.each(folders)("%s passes the pack check", async (folder) => {
    const result = await checkPack(join(BUILT_IN_PACKS, folder));
    expect(result.problems).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.sentToAgent).toBe(false);
  }, 120_000);
});
