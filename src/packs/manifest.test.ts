import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UnknownPack } from "../errors.js";
import { BUILT_IN_PACKS, builtInPacks, DATA_ONLY, inspectPack, loadPack, resolvePack } from "./manifest.js";

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

  it("finds a pack by name among the packs it is given, and names them all when none matches", async () => {
    const mine = await loadPack(editedPack((m) => { m.name = "mine"; }));
    const packs = [...(await builtInPacks()), mine];
    expect((await resolvePack("mine", "/anywhere", packs)).dir).toBe(mine.dir);
    await expect(resolvePack("nope", "/anywhere", packs)).rejects.toMatchObject({ packName: "nope", available: ["code", "security", "mine"] });
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
      schema: null,
      problems: [{ file: expect.any(String), field: "schema", message: `"schema" is "${schema}", but this harness reads delivery.pack/2 and delivery.pack/3 (see docs/writing-a-pack.md)` }],
    });
  });

  it("says which version it read a manifest as, even when the manifest has a mistake", async () => {
    expect(await inspectPack(v3Dir({ ...v3, extra: 1 }))).toMatchObject({ ok: false, schema: "delivery.pack/3" });
    expect(await inspectPack(packDir({ ...minimal, extra: 1 }))).toMatchObject({ ok: false, schema: "delivery.pack/2" });
    const undeclared: Record<string, unknown> = { ...v3, extra: 1 };
    delete undeclared.schema;
    expect(await inspectPack(v3Dir(undeclared))).toMatchObject({ ok: false, schema: "delivery.pack/3" });
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
    const dir = v3Dir({ ...v3, workflows: { scan: v3.workflows.scan, code: { kind: "act", summary: "Code.", prompt: "act.md" }, tests: { kind: "act", summary: "Test.", prompt: "act.md" } } }, { "scan.md": "# Scan\n" });
    expect(await inspectPack(dir)).toEqual({ ok: false, schema: "delivery.pack/3", problems: [{ file: join(dir, "act.md"), field: null, message: "is missing" }] });
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
    expect(await inspectPack(dir)).toEqual({ ok: false, schema: "delivery.pack/2", problems: [{ file: join(dir, "scan.md"), field: null, message: "is missing" }] });
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

describe("a manifest's $schema", () => {
  it("lets a manifest name the schema it is written against, for an editor", async () => {
    const dir = editedPack((m) => (m.$schema = "./pack.schema.json"));
    expect((await loadPack(dir)).manifest.name).toBe("code");
  });
});

describe("a delivery.pack/3 manifest's mistakes", () => {
  type Manifest = { workflows: Record<string, Record<string, unknown>> } & Record<string, unknown>;

  /** The workflow `name` of a manifest copy, which every edit below names only where it is present. */
  const at = (manifest: Manifest, name: string): Record<string, unknown> => manifest.workflows[name] as Record<string, unknown>;

  /** A copy of the `v3` manifest after `edit` has changed it. */
  const edited = (edit: (manifest: Manifest) => void): Manifest => {
    const manifest = structuredClone(v3) as Manifest;
    edit(manifest);
    return manifest;
  };

  /** A copy of `manifest` in which `workflow` has `key` set to `value`. */
  const withKey = (manifest: object, workflow: string, key: string, value: unknown): object => {
    const copy = structuredClone(manifest) as Manifest;
    at(copy, workflow)[key] = value;
    return copy;
  };

  /** The folder a manifest is written to, and the exact problems it is refused with, each as its field and sentence. */
  async function refusedWith(manifest: object, problems: Array<[string | null, string]>): Promise<void> {
    const dir = v3Dir(manifest);
    expect(await inspectPack(dir)).toEqual({
      ok: false,
      schema: "delivery.pack/3",
      problems: problems.map(([field, message]) => ({ file: join(dir, "pack.json"), field, message })),
    });
  }

  it("names a folder with no find, and every act no find can reach", async () => {
    await refusedWith(
      edited((m) => delete m.workflows.scan),
      [
        ["workflows", '"workflows" must hold exactly one workflow with "kind": "find", but it holds none'],
        ["workflows.code", '"workflows.code" is not listed in any find workflow\'s "ideasFor", so no idea could reach it'],
        ["workflows.tests", '"workflows.tests" is not listed in any find workflow\'s "ideasFor", so no idea could reach it'],
      ],
    );
  });

  it.each<[string, () => object, string, string]>([
    [
      "a second find",
      () => edited((m) => (m.workflows.look = { kind: "find", prompt: "scan.md", ideasFor: ["code"] })),
      "workflows",
      '"workflows" must hold exactly one workflow with "kind": "find", but it holds 2 ("scan", "look")',
    ],
    [
      "an idea for something that is not a workflow",
      () => edited((m) => (at(m, "scan").ideasFor = ["code", "fx", "tests"])),
      "workflows.scan.ideasFor.1",
      '"workflows.scan.ideasFor.1" is "fx", but this pack\'s act workflows are: code, tests',
    ],
    [
      "an idea in a pack with no act workflows",
      () =>
        edited((m) => {
          delete m.workflows.code;
          delete m.workflows.tests;
          at(m, "scan").ideasFor = ["fx"];
        }),
      "workflows.scan.ideasFor.0",
      '"workflows.scan.ideasFor.0" is "fx", but this pack has no act workflows',
    ],
    [
      "an idea for a find",
      () => edited((m) => (at(m, "scan").ideasFor = ["scan", "code", "tests"])),
      "workflows.scan.ideasFor.0",
      '"workflows.scan.ideasFor.0" is a find workflow; it can only offer act workflows',
    ],
    [
      "an act no find offers",
      () => edited((m) => (at(m, "scan").ideasFor = ["code"])),
      "workflows.tests",
      '"workflows.tests" is not listed in any find workflow\'s "ideasFor", so no idea could reach it',
    ],
    [
      "ideasFor on an act",
      () => edited((m) => (at(m, "code").ideasFor = ["tests"])),
      "workflows.code.ideasFor",
      '"workflows.code.ideasFor" is only for find workflows',
    ],
    [
      "a summary missing from an act a find chooses between",
      () => edited((m) => delete at(m, "code").summary),
      "workflows.code.summary",
      '"workflows.code.summary" is missing: the find workflow "scan" needs it to choose between "code" and "tests"',
    ],
    [
      "settings, which are reserved",
      () => edited((m) => (m.settings = {})),
      "settings",
      '"settings" is reserved for pack settings, which this harness does not read yet',
    ],
    ["a top-level key that is a tool list", () => edited((m) => (m.tools = ["Bash"])), "tools", `"tools" ${DATA_ONLY}`],
    [
      "a kind the format does not name",
      () => edited((m) => (at(m, "scan").kind = "scna")),
      "workflows.scan.kind",
      '"workflows.scan.kind" is "scna" but the allowed values are: find, act',
    ],
    ["a workflow with no kind", () => edited((m) => delete at(m, "scan").kind), "workflows.scan.kind", '"workflows.scan.kind" is missing'],
    [
      "an empty ideasFor",
      () => edited((m) => (at(m, "scan").ideasFor = [])),
      "workflows.scan.ideasFor",
      '"workflows.scan.ideasFor" must name at least one act workflow',
    ],
    [
      "a workflow name that is not a slug",
      () =>
        edited((m) => {
          m.workflows.Code = at(m, "code");
          delete m.workflows.code;
        }),
      "workflows.Code",
      '"workflows.Code" must be lower-case letters, digits and dashes',
    ],
  ])("names the mistake of %s", async (_, make, field, message) => {
    await refusedWith(make(), [[field, message]]);
  });

  it.each([
    ["hold", { atOrAbove: "high" }],
    ["guards", { add: ["tests-unchanged"] }],
    ["summary", "A find."],
  ])("refuses %s on a find: it is only for act workflows", async (key, value) => {
    await refusedWith(withKey(v3, "scan", key, value), [[`workflows.scan.${key}`, `"workflows.scan.${key}" is only for act workflows`]]);
  });

  it.each(["gate", "agent", "tools", "allowedTools", "closer", "commands", "after", "steps"])("refuses %s on an act or a find as data-only", async (key) => {
    for (const workflow of ["code", "scan"]) {
      const result = await inspectPack(v3Dir(withKey(v3, workflow, key, "x")));
      expect(result).toMatchObject({ ok: false, problems: [{ field: `workflows.${workflow}.${key}`, message: `"workflows.${workflow}.${key}" ${DATA_ONLY}` }] });
    }
  });

  it("refuses guards.off: a pack may only add guards", async () => {
    await refusedWith(withKey(v3, "code", "guards", { add: ["tests-unchanged"], off: ["tests-unchanged"] }), [
      ["workflows.code.guards.off", `"workflows.code.guards.off" ${DATA_ONLY}`],
    ]);
  });

  it("names every broken rule at once", async () => {
    await refusedWith(
      edited((m) => (at(m, "scan").ideasFor = ["code", "fx"])),
      [
        ["workflows.scan.ideasFor.1", '"workflows.scan.ideasFor.1" is "fx", but this pack\'s act workflows are: code, tests'],
        ["workflows.tests", '"workflows.tests" is not listed in any find workflow\'s "ideasFor", so no idea could reach it'],
      ],
    );
  });

  it("counts an act offered twice by one find as one target", async () => {
    const dir = v3Dir({ ...v3, workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code", "code"] }, code: { kind: "act", prompt: "code.md" } } });
    expect((await inspectPack(dir)).ok).toBe(true);
  });

  it("reports a /2 manifest's unknown settings key in /2 terms", async () => {
    expect(await inspectPack(packDir({ ...minimal, settings: {} }))).toMatchObject({ ok: false, problems: [{ field: "settings", message: `"settings" ${DATA_ONLY}` }] });
  });
});
