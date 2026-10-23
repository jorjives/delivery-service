import { describe, expect, it } from "vitest";
import { PACK_SCHEMA, PACK_SCHEMAS_READ, PackManifest, PackManifestV2, upgradeV2 } from "./pack-format.js";

const v2 = { schema: "delivery.pack/2", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } } as const;
const expected = { schema: "delivery.pack/3", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.",
  workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["fix"] }, fix: { kind: "act", prompt: "fix.md", guards: { add: ["tests-unchanged"] } } } };

/** The spec's example delivery.pack/3 manifest (docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md, 6.4), with real summaries. */
const EXAMPLE_V3 = {
  schema: "delivery.pack/3",
  name: "deprecations",
  version: "1.0.0",
  title: "Move off deprecated code",
  summary: "Finds code that still calls deprecated APIs and fixes it.",
  workflows: {
    scan: { kind: "find", prompt: "scan.md", ideasFor: ["code", "tests"] },
    code: { kind: "act", summary: "Code of the project's own that still calls the deprecated code.",
      prompt: "code.md", guards: { add: ["tests-unchanged"] }, hold: { atOrAbove: "high" } },
    tests: { kind: "act", summary: "A test file that still calls the deprecated code.", prompt: "tests.md" },
  },
};

describe("the pack format's constants", () => {
  it("names the version it writes and the versions it reads", () => {
    expect(PACK_SCHEMA).toBe("delivery.pack/3");
    expect(PACK_SCHEMAS_READ).toEqual(["delivery.pack/2", "delivery.pack/3"]);
  });
});

describe("upgradeV2", () => {
  it.each([
    ["a bare pack", {}, {}],
    ["a hold", { hold: "high" }, { hold: { atOrAbove: "high" } }],
    ["extra guards", { fix: { prompt: "fix.md", guards: { add: ["backlog-only"] } } }, { guards: { add: ["tests-unchanged", "backlog-only"] } }],
    ["tests-unchanged named again", { fix: { prompt: "fix.md", guards: { add: ["tests-unchanged", "backlog-only"] } } }, { guards: { add: ["tests-unchanged", "backlog-only"] } }],
  ])("upgrades %s into a find called scan offering an act called fix", (_, change, fixChange) => {
    const upgraded = upgradeV2(PackManifestV2.parse({ ...v2, ...change }));
    expect(upgraded).toEqual({ ...expected, workflows: { ...expected.workflows, fix: { ...expected.workflows.fix, ...fixChange } } });
    expect(PackManifest.safeParse(upgraded).success).toBe(true);
  });

  it("drops $schema, which pointed at the /2 schema", () => {
    expect(upgradeV2(PackManifestV2.parse({ ...v2, $schema: "./pack.schema.json" }))).not.toHaveProperty("$schema");
  });

  it("reads the spec's example /3 manifest", () => {
    expect(PackManifest.safeParse(EXAMPLE_V3).success).toBe(true);
  });
});
