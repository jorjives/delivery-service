import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDS, guardListsFor } from "./guards.js";

describe("what a fix may not touch", () => {
  it("is the harness's defaults when a pack adds nothing", () => {
    expect(guardListsFor(undefined)).toEqual(DEFAULT_GUARDS);
    expect(DEFAULT_GUARDS.testGlobs).toContain("**/*.test.*");
    expect(DEFAULT_GUARDS.protectedGlobs).toEqual(expect.arrayContaining([".github/workflows/**", "**/.gitignore"]));
    expect(DEFAULT_GUARDS.skipMarkers).toEqual(expect.arrayContaining([".skip(", "xit(", "@Ignore", "pytest.mark.skip"]));
  });

  it("adds a pack's own after the defaults, each once", () => {
    const lists = guardListsFor({ testGlobs: ["e2e/**", "**/*.test.*"], protectedGlobs: ["deno.json"], skipMarkers: ["@pending"] });
    expect(lists.testGlobs).toEqual([...DEFAULT_GUARDS.testGlobs, "e2e/**"]);
    expect(lists.protectedGlobs.at(-1)).toBe("deno.json");
    expect(lists.skipMarkers.at(-1)).toBe("@pending");
  });
});
