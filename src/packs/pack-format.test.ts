import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openSchema, publishedKeys } from "../report/json-schema.js";
import { PACK_SCHEMA, PACK_SCHEMAS_READ, PackManifest, PackManifestV2, packSchema, upgradeV2 } from "./pack-format.js";

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

describe("the pack format's JSON Schema", () => {
  type Manifest = { workflows: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  const at = (m: Manifest, name: string): Record<string, unknown> => m.workflows[name] as Record<string, unknown>;
  const schema = z.fromJSONSchema(packSchema());
  it("names itself by the version written", () => expect(packSchema().title).toBe(PACK_SCHEMA));
  it("accepts a delivery.pack/3 manifest", () => expect(schema.safeParse(EXAMPLE_V3).error).toBeUndefined());
  it.each([
    ["an unknown key on a find", (m: Manifest) => (at(m, "scan").tools = ["Bash"])],
    ["an act-only key on a find", (m: Manifest) => (at(m, "scan").hold = { atOrAbove: "high" })],
    ["an unknown key on an act", (m: Manifest) => (at(m, "code").gate = "npm test")],
    ["a kind it does not name", (m: Manifest) => (at(m, "scan").kind = "scna")],
    ["a guard it does not name", (m: Manifest) => (at(m, "code").guards = { add: ["no-such-guard"] })],
    ["a top-level key it does not name", (m: Manifest) => (m.settings = {})],
  ])("flags %s as an editor would", (_, edit) => {
    const m = structuredClone(EXAMPLE_V3) as Manifest;
    edit(m);
    expect(schema.safeParse(m).success).toBe(false);
  });
});

/** The stability promise, per version: a pack valid under a version stays valid. A line may be added, never removed or changed. */
describe("the pack format's stability promise", () => {
  const promised = readFileSync(new URL("./pack-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = [...publishedKeys(openSchema(PackManifestV2), "delivery.pack/2"), ...publishedKeys(openSchema(PackManifest), PACK_SCHEMA)];
  it("covers every version this harness reads", () => {
    for (const v of PACK_SCHEMAS_READ) expect(promised.some((l) => l.startsWith(`${v}.`))).toBe(true);
  });
  it("keeps every key and name ever published, each the kind of value it was", () => expect(promised.filter((l) => !current.includes(l))).toEqual([]));
  it("puts every key and name published now under the promise: add its line to pack-published-keys.txt", () => expect(current.filter((l) => !promised.includes(l))).toEqual([]));
});

describe("text a pack shows the owner", () => {
  const bad = ["two\nlines", "a\rb", `esc${String.fromCharCode(27)}[2J`, `rtl${String.fromCodePoint(0x202e)}text`, `zero${String.fromCodePoint(0x200b)}width`, "tab\there"];
  for (const text of bad) {
    it(`refuses ${JSON.stringify(text)} in the title and summary`, () => {
      expect(PackManifestV2.safeParse({ ...v2, title: text }).success).toBe(false);
      expect(PackManifest.safeParse({ ...expected, summary: text }).success).toBe(false);
    });
  }
  it("refuses it in an act's summary", () => {
    const workflows = { ...expected.workflows, fix: { kind: "act", prompt: "fix.md", summary: "two\nlines" } };
    expect(PackManifest.safeParse({ ...expected, workflows }).success).toBe(false);
  });
});
