import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { UnknownPack } from "../errors.js";
import { openSchema, publishedKeys } from "../report/json-schema.js";
import { BUILT_IN_PACKS, builtInPacks, DATA_ONLY, inspectPack, loadPack, packSchema, resolvePack } from "./manifest.js";
import { PackManifestV2 } from "./pack-format.js";

const minimal = { schema: "delivery.pack/2", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } };

/** A folder holding `manifest` as its pack.json, with a scan.md and a fix.md beside it. */
function packDir(manifest: object): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "scan.md"), "# Scan\n");
  writeFileSync(join(dir, "fix.md"), "# Fix\n");
  return dir;
}

/** A delivery.pack/3 manifest: a find `scan` offering two acts, `code` (held at high) and `tests`. */
const v3 = {
  schema: "delivery.pack/3",
  name: "mine",
  version: "1.0.0",
  title: "Mine",
  summary: "Mine.",
  workflows: {
    scan: { kind: "find", prompt: "scan.md", ideasFor: ["code", "tests"] },
    code: { kind: "act", summary: "Code that calls it.", prompt: "code.md", guards: { add: ["tests-unchanged"] }, hold: { atOrAbove: "high" } },
    tests: { kind: "act", summary: "A test that calls it.", prompt: "tests.md" },
  },
};

/** A folder holding `manifest` as its pack.json, with the prompt files `files` beside it. */
function v3Dir(manifest: object, files: Record<string, string> = { "scan.md": "# Scan\n", "code.md": "# Code\n", "tests.md": "# Tests\n" }): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** A copy of the built-in code pack whose manifest has been changed by `edit`. */
function editedPack(edit: (manifest: Record<string, unknown>) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pack-")), "my-pack");
  cpSync(join(BUILT_IN_PACKS, "code-review"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf-8")) as Record<string, unknown>;
  edit(manifest);
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
  return dir;
}

describe("the built-in packs", () => {
  it("are code and security, each found by name", async () => {
    expect((await builtInPacks()).map((pack) => pack.manifest.name)).toEqual(["code", "security"]);
    expect((await resolvePack("code", "/anywhere")).manifest.name).toBe("code");
  });

  it("name the ones available when asked for one that does not exist", async () => {
    const err = await resolvePack("nope", "/anywhere").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownPack);
    expect(err).toMatchObject({ packName: "nope", available: ["code", "security"] });
  });

  it("ship the code review at 2.0.0, its scan instructions keeping matters of taste out", async () => {
    const code = await resolvePack("code", "/");
    expect(code.manifest.version).toBe("2.0.0");
    expect(code.workflows["code:scan"]?.steps[0]?.prompt).toContain("not matters of taste");
  });
});

describe("a delivery.pack/2 manifest", () => {
  it("becomes a scan workflow that may only add ideas and a fix workflow that keeps tests unchanged and holds", async () => {
    const pack = await resolvePack("security", "/");
    expect(Object.keys(pack.workflows)).toEqual(["security:scan", "security:fix"]);
    const scan = pack.workflows["security:scan"];
    expect(scan?.steps[0]).toMatchObject({ name: "scan", guards: { add: ["backlog-only"] } });
    expect(scan?.steps[0]?.prompt).toContain("workflow: security:fix");
    expect(scan?.after).toEqual([]);
    expect(pack.workflows["security:fix"]).toMatchObject({ steps: [{ name: "fix", guards: { add: ["tests-unchanged"] } }], hold: "high" });
  });

  it("refuses a delivery.pack/1 manifest with a sentence saying what changed", async () => {
    const dir = packDir({ schema: "delivery.pack/1", name: "old", version: "1.0.0", title: "Old", summary: "Old." });
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "schema", message: expect.stringContaining("delivery.pack/2") }] });
  });

  it.each(["delivery.pack/1", "delivery.pack/9"])("refuses %s, naming both versions it reads", async (schema) => {
    expect(await inspectPack(packDir({ ...minimal, schema }))).toEqual({
      ok: false,
      problems: [{ file: expect.any(String), field: "schema", message: `"schema" is "${schema}", but this harness reads delivery.pack/2 and delivery.pack/3 (see docs/writing-a-pack.md)` }],
    });
  });

  it("reports a /2 pack as /2, its find as <name>:scan", async () => {
    const code = await resolvePack("code", "/");
    expect([code.schema, code.find]).toEqual(["delivery.pack/2", "code:scan"]);
  });

  it("refuses a key the format does not name", async () => {
    const dir = packDir({ ...minimal, tools: ["Bash"] });
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ message: expect.stringContaining(DATA_ONLY) }] });
  });

  it("cannot widen what the fix's agent may do: a tool list is not part of the format", async () => {
    const dir = editedPack((manifest) => (manifest.allowedTools = ["Read", "Bash"]));
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "allowedTools", message: expect.stringContaining(DATA_ONLY) }] });
  });

  it("does not hold a fix workflow when the manifest says nothing about holding", async () => {
    const code = await resolvePack("code", "/");
    expect(code.workflows["code:fix"]).not.toHaveProperty("hold");
    expect(code.workflows["code:fix"]?.steps[0]?.guards).toEqual({ add: ["tests-unchanged"] });
  });

  it("adds the guards its fix names beside tests-unchanged, once each", async () => {
    const dir = packDir({ ...minimal, fix: { prompt: "fix.md", guards: { add: ["tests-unchanged", "backlog-only"] } } });
    const pack = await loadPack(dir);
    expect(pack.workflows["mine:fix"]?.steps[0]?.guards).toEqual({ add: ["tests-unchanged", "backlog-only"] });
  });

  it("refuses a hold threshold that is not a severity word", async () => {
    const dir = editedPack((manifest) => (manifest.hold = "severe"));
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "hold", message: expect.stringContaining('"hold"') }] });
  });

  it("is refused when there is no pack in the folder, naming where it looked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "no-pack-"));
    await expect(resolvePack(dir, "/")).rejects.toMatchObject({ filePath: join(dir, "pack.json"), detail: "is missing" });
  });
});

describe("a delivery.pack/3 manifest", () => {
  it("becomes one workflow per entry, each named <pack>:<workflow>, in manifest order", async () => {
    const pack = await loadPack(v3Dir(v3));
    expect(pack.schema).toBe("delivery.pack/3");
    expect(pack.find).toBe("mine:scan");
    expect(Object.keys(pack.workflows)).toEqual(["mine:scan", "mine:code", "mine:tests"]);
    expect(pack.workflows["mine:code"]).toEqual({ steps: [{ name: "code", prompt: "# Code", guards: { add: ["tests-unchanged"] } }], hold: "high" });
    expect(pack.workflows["mine:tests"]).toEqual({ steps: [{ name: "tests", prompt: "# Tests" }] });
    expect(pack.workflows["mine:scan"]).toMatchObject({ steps: [{ name: "scan", guards: { add: ["backlog-only"] } }], after: [] });
  });

  it("tells its find which act workflows an idea may name, with each one's summary", async () => {
    const prompt = (await loadPack(v3Dir(v3))).workflows["mine:scan"]?.steps[0]?.prompt ?? "";
    expect(prompt.startsWith("# Scan\n\n## What to hand back")).toBe(true);
    expect(prompt).toContain("workflow: mine:code");
    expect(prompt).toContain("- `mine:code`: Code that calls it.\n- `mine:tests`: A test that calls it.");
  });

  it("names its find after the workflow, whatever it is called", async () => {
    const manifest = { ...v3, workflows: { survey: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: v3.workflows.code } };
    const pack = await loadPack(v3Dir(manifest));
    expect(pack.find).toBe("mine:survey");
    expect(pack.workflows["mine:survey"]).toMatchObject({ steps: [{ name: "survey" }] });
  });

  it("yields the same workflows from a /2 manifest and the /3 manifest it means", async () => {
    const files = { "scan.md": "# Scan\n", "fix.md": "# Fix\n" };
    const v2Folder = v3Dir({ ...minimal, fix: { prompt: "fix.md", guards: { add: ["backlog-only"] } }, hold: "high" }, files);
    const v3Folder = v3Dir(
      {
        ...v3,
        workflows: {
          scan: { kind: "find", prompt: "scan.md", ideasFor: ["fix"] },
          fix: { kind: "act", prompt: "fix.md", guards: { add: ["tests-unchanged", "backlog-only"] }, hold: { atOrAbove: "high" } },
        },
      },
      files,
    );
    expect((await loadPack(v3Folder)).workflows).toEqual((await loadPack(v2Folder)).workflows);
  });

  it("names a missing prompt file once, though two workflows share it", async () => {
    const dir = v3Dir({ ...v3, workflows: { scan: v3.workflows.scan, code: { kind: "act", prompt: "act.md" }, tests: { kind: "act", prompt: "act.md" } } }, { "scan.md": "# Scan\n" });
    expect(await inspectPack(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "act.md"), field: null, message: "is missing" }] });
  });

  it("changes its identity when any workflow's instructions change", async () => {
    const dir = v3Dir(v3);
    const before = (await loadPack(dir)).hash;
    writeFileSync(join(dir, "tests.md"), "# Different\n");
    expect((await loadPack(dir)).hash).not.toBe(before);
  });
});

describe("a pack from a folder", () => {
  it("loads exactly as a built-in one, by path", async () => {
    const dir = editedPack((manifest) => (manifest.name = "mine"));
    expect((await resolvePack(dir, "/")).manifest.name).toBe("mine");
  });

  it("changes its identity when its scan instructions change", async () => {
    const dir = editedPack(() => undefined);
    const before = (await loadPack(dir)).hash;
    writeFileSync(join(dir, "scan.md"), "# Different\n");
    expect((await loadPack(dir)).hash).not.toBe(before);
  });

  it("changes its identity when its fix instructions change", async () => {
    const dir = editedPack(() => undefined);
    const before = (await loadPack(dir)).hash;
    writeFileSync(join(dir, "fix.md"), "# Different\n");
    expect((await loadPack(dir)).hash).not.toBe(before);
  });

  it("names a missing instructions file by its own path", async () => {
    const dir = editedPack(() => undefined);
    rmSync(join(dir, "scan.md"));
    expect(await inspectPack(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "scan.md"), field: null, message: "is missing" }] });
  });

  it("refuses instructions outside the folder", async () => {
    const dir = editedPack((manifest) => ((manifest.scan as { prompt: string }).prompt = "../scan.md"));
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "scan.prompt" }] });
  });

  it("refuses a version that is not one", async () => {
    const dir = editedPack((manifest) => (manifest.version = "one"));
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "version" }] });
  });

  it("refuses a guard the format does not name", async () => {
    const dir = packDir({ ...minimal, fix: { prompt: "fix.md", guards: { add: ["no-such-guard"] } } });
    expect(await inspectPack(dir)).toMatchObject({ ok: false, problems: [{ field: "fix.guards.add.0" }] });
  });
});

describe("inspecting a pack", () => {
  it("names every problem in the manifest, each by its file and field", async () => {
    const dir = editedPack((m) => {
      m.version = "one";
      m.hold = "severe";
      delete m.title;
    });
    const result = await inspectPack(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const file = join(dir, "pack.json");
    expect(result.problems).toEqual(
      expect.arrayContaining([
        { file, field: "version", message: '"version" must be a version such as 1.0.0' },
        { file, field: "title", message: '"title" is missing' },
      ]),
    );
    expect(result.problems).toHaveLength(3);
  });

  it("gives the loaded pack when there is nothing wrong", async () => {
    const result = await inspectPack(join(BUILT_IN_PACKS, "code-review"));
    expect(result.ok && result.pack.manifest.name).toBe("code");
  });
});

describe("the pack format's JSON Schema", () => {
  const schema = z.fromJSONSchema(packSchema());
  const builtIn = (folder: string): unknown => JSON.parse(readFileSync(join(BUILT_IN_PACKS, folder, "pack.json"), "utf-8"));

  it("accepts every built-in pack's manifest, so an editor holds a copy to the same rules", () => {
    for (const folder of ["code-review", "security-review"]) expect(schema.safeParse(builtIn(folder)).error).toBeUndefined();
  });

  it("flags an unknown key as an editor would while it is typed", () => {
    const manifest = builtIn("code-review") as Record<string, unknown>;
    expect(schema.safeParse({ ...manifest, tools: ["Bash"] }).success).toBe(false);
  });

  it("names itself by the format's version", () => {
    expect(packSchema().title).toBe("delivery.pack/2");
  });

  it("lets a manifest name the schema it is written against, for an editor", async () => {
    const dir = editedPack((m) => (m.$schema = "./pack.schema.json"));
    expect((await loadPack(dir)).manifest.name).toBe("code");
  });

});

/** The stability promise: a pack valid under delivery.pack/2 stays valid. A line may be added, never removed or changed. */
describe("the pack format's stability promise", () => {
  const promised = readFileSync(new URL("./pack-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = publishedKeys(openSchema(PackManifestV2), "delivery.pack/2");

  it("keeps every key and name ever published, each the kind of value it was", () => {
    expect(promised.filter((line) => !current.includes(line))).toEqual([]);
  });

  it("puts every key and name published now under the promise: add its line to pack-published-keys.txt", () => {
    expect(current.filter((line) => !promised.includes(line))).toEqual([]);
  });
});
