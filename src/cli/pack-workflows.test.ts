import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LockEntry } from "../packs/install/lock.js";
import { entryFor } from "../packs/install/install-fixtures.js";
import type { PackageFile } from "../packs/install/package-archive.js";
import { installPack } from "../packs/install/store.js";
import { builtInPackClash, builtInWorkflowClash } from "./pack-clash.js";
import { builtInPacks } from "../packs/manifest.js";
import { ONE_LINE } from "../packs/setting-types.js";
import { settingsRefusal, projectPackStates, withPackWorkflows } from "./pack-workflows.js";
import { EXIT } from "./failures.js";

/** A pack folder named `name`, with a minimal delivery.pack/2 manifest and its two instruction files. */
function writePack(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pack.json"), JSON.stringify({ schema: "delivery.pack/2", name, version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }));
  writeFileSync(join(dir, "scan.md"), "# Scan\n");
  writeFileSync(join(dir, "fix.md"), "# Fix\n");
}

/** A pack folder named `name`, with a minimal delivery.pack/3 manifest: a find named `find` offering an act `code`, and the two prompt files. */
function writeV3Pack(dir: string, name: string, find = "scan"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify({
      schema: "delivery.pack/3",
      name,
      version: "1.0.0",
      title: "Mine",
      summary: "Mine.",
      workflows: { [find]: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
    }),
  );
  writeFileSync(join(dir, "scan.md"), "# Scan\n");
  writeFileSync(join(dir, "code.md"), "# Code\n");
}

/** A pack folder named `name`: a find `scan` offering an act `code` whose prompt names the setting `old-module` (a text setting, default "the old client"). */
function writeSettingsPack(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify({
      schema: "delivery.pack/3",
      name,
      version: "1.0.0",
      title: "Mine",
      summary: "Mine.",
      settings: { "old-module": { type: "text", summary: "The module to leave.", default: "the old client" } },
      workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
    }),
  );
  writeFileSync(join(dir, "scan.md"), "# Scan\n");
  writeFileSync(join(dir, "code.md"), "Move off {{settings.old-module}}.");
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The files of an added delivery.pack/3 pack named `moves`, with a find `scan` offering an act `code`. */
const MOVES: PackageFile[] = [
  {
    path: "pack.json",
    bytes: encode(
      JSON.stringify({
        schema: "delivery.pack/3",
        name: "moves",
        version: "3.0.0",
        title: "Moves",
        summary: "Moves calls off retired code.",
        workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
      }),
    ),
  },
  { path: "scan.md", bytes: encode("# Scan\n") },
  { path: "code.md", bytes: encode("# Code\n") },
];

const MOVES_ENTRY: LockEntry = await entryFor(MOVES, { package: "@acme/moves", request: "^3.0.0", version: "3.0.0" });

/** The files of `MOVES` renamed `code`: an added pack named like the built-in `code`, as a later release could be. */
const CODE: PackageFile[] = MOVES.map((file) =>
  file.path === "pack.json" ? { path: file.path, bytes: encode(new TextDecoder().decode(file.bytes).replace('"name":"moves"', '"name":"code"')) } : file,
);

describe("pack workflows", () => {
  it("adds every built-in pack's workflows to the config's own", async () => {
    const config = await withPackWorkflows({ workflows: { mine: { steps: [{ name: "a", prompt: "a" }] } } }, "/", undefined);
    expect(Object.keys(config.workflows ?? {}).sort()).toEqual(["code:fix", "code:scan", "deprecations:code", "deprecations:scan", "deprecations:tests", "mine", "security:fix", "security:scan"]);
  });

  it("adds a pack the config lists, from a folder relative to the config file", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "reviews/mine"), "mine");
    expect((await withPackWorkflows({ packs: ["reviews/mine"] }, root, undefined)).workflows?.["mine:fix"]).toBeDefined();
  });

  it("adds a delivery.pack/3 pack's own workflows", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writeV3Pack(join(root, "moves"), "moves");
    expect(Object.keys((await withPackWorkflows({ packs: ["moves"] }, root, undefined)).workflows ?? {})).toEqual(expect.arrayContaining(["moves:scan", "moves:code"]));
  });

  it("adds an added pack's workflows after built-ins and listed folders", async () => {
    const repo = mkdtempSync(join(tmpdir(), "pack-workflows-added-"));
    await installPack(repo, "moves", MOVES, MOVES_ENTRY);
    expect(Object.keys((await withPackWorkflows({}, repo, repo)).workflows ?? {})).toEqual(expect.arrayContaining(["moves:scan", "moves:code"]));
  });

  it("names both pack folders when two listed packs define the same workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "a"), "mine"); // /2: mine:scan, mine:fix
    writeV3Pack(join(root, "b"), "mine"); // /3: mine:scan, mine:code
    await expect(withPackWorkflows({ packs: ["a", "b"] }, root, undefined)).rejects.toThrow(
      `Two things define the workflow "mine:scan": the pack in ${join(root, "a", "pack.json")}, and the pack in ${join(root, "b", "pack.json")}. To keep the second, take the first out of packs in your configuration.`,
    );
  });

  it("refuses a listed folder named like an added pack, naming both and how to keep the added one", async () => {
    const repo = mkdtempSync(join(tmpdir(), "pack-workflows-added-"));
    await installPack(repo, "moves", MOVES, MOVES_ENTRY);
    writeV3Pack(join(repo, "local"), "moves");
    await expect(withPackWorkflows({ packs: ["local"] }, repo, repo)).rejects.toThrow(
      `Two packs are named "moves": the pack in ${join(repo, "local", "pack.json")}, and the pack added from @acme/moves 3.0.0. To keep the second, take the first out of packs in your configuration.`,
    );
  });

  it("refuses an added pack that a later built-in shares a name with, saying to remove the added one", async () => {
    const repo = mkdtempSync(join(tmpdir(), "pack-workflows-added-"));
    await installPack(repo, "code", CODE, await entryFor(CODE, { package: "@acme/code", request: "^3.0.0", version: "3.0.0" }));
    await expect(withPackWorkflows({}, repo, repo)).rejects.toThrow(
      `Two packs are named "code": "code", a pack that comes with the harness, and the pack added from @acme/code 3.0.0. A pack that comes with the harness cannot be removed, so remove the added one: delivery packs remove code`,
    );
  });

  it("refuses a project workflow named like an added pack's, naming both", async () => {
    const repo = mkdtempSync(join(tmpdir(), "pack-workflows-added-"));
    await installPack(repo, "moves", MOVES, MOVES_ENTRY);
    const own = { workflows: { "moves:scan": { steps: [{ name: "a", prompt: "a" }] } } };
    await expect(withPackWorkflows(own, repo, repo)).rejects.toMatchObject({
      message: `Two things define the workflow "moves:scan": a workflow in your configuration, and the pack added from @acme/moves 3.0.0. Rename your own workflow so each name is used once.`,
      field: "workflows",
    });
  });

  it("refuses a listed pack named like a built-in, naming its manifest and what to change", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writeV3Pack(join(root, "code"), "code");
    await expect(withPackWorkflows({ packs: ["code"] }, root, undefined)).rejects.toThrow(builtInPackClash("code", join(root, "code", "pack.json")));
  });

  it("refuses a listed pack named like a built-in even when no workflow name overlaps", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writeV3Pack(join(root, "mine"), "security", "look"); // security:look, security:code: neither is a built-in name
    await expect(withPackWorkflows({ packs: ["mine"] }, root, undefined)).rejects.toThrow(builtInPackClash("security", join(root, "mine", "pack.json")));
  });

  it("refuses a project workflow named like a built-in's, naming the built-in", async () => {
    await expect(withPackWorkflows({ workflows: { "code:fix": { steps: [{ name: "a", prompt: "a" }] } } }, "/", undefined)).rejects.toThrow(builtInWorkflowClash("code:fix", "code"));
  });

  it("refuses a listed delivery.pack/2 pack named deprecations, naming its manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "mine"), "deprecations");
    await expect(withPackWorkflows({ packs: ["mine"] }, root, undefined)).rejects.toThrow(builtInPackClash("deprecations", join(root, "mine", "pack.json")));
  });

  it("refuses a project workflow named like one of deprecations'", async () => {
    await expect(withPackWorkflows({ workflows: { "deprecations:code": { steps: [{ name: "a", prompt: "a" }] } } }, "/", undefined)).rejects.toThrow(builtInWorkflowClash("deprecations:code", "deprecations"));
  });

  it("loads a project whose own names only resemble the built-in's", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "mine"), "deprecations-old");
    const config = await withPackWorkflows({ packs: ["mine"], workflows: { deprecations: { steps: [{ name: "a", prompt: "a" }] } } }, root, undefined);
    expect(Object.keys(config.workflows ?? {})).toEqual(expect.arrayContaining(["deprecations", "deprecations-old:scan", "deprecations:scan"]));
  });

  describe("with pack settings", () => {
    const rootWithSettingsPack = () => {
      const root = mkdtempSync(join(tmpdir(), "pack-workflows-settings-"));
      writeSettingsPack(join(root, "mine"), "mine");
      return root;
    };
    const promptOf = (config: Awaited<ReturnType<typeof withPackWorkflows>>) => config.workflows?.["mine:code"]?.steps[0]?.prompt;

    it("renders the default into a listed pack's workflow", async () => {
      expect(promptOf(await withPackWorkflows({ packs: ["mine"] }, rootWithSettingsPack(), undefined))).toBe("Move off the old client.");
    });

    it("renders the owner's value into a listed pack's workflow", async () => {
      const config = await withPackWorkflows({ packs: ["mine"], packSettings: { mine: { "old-module": "legacy-http" } } }, rootWithSettingsPack(), undefined);
      expect(promptOf(config)).toBe("Move off legacy-http.");
    });

    it("renders the owner's value into an added pack's workflow", async () => {
      const repo = mkdtempSync(join(tmpdir(), "pack-workflows-added-"));
      const files: PackageFile[] = MOVES.map((file) => {
        if (file.path === "pack.json") {
          const manifest = JSON.parse(new TextDecoder().decode(file.bytes)) as object;
          const settings = { "old-module": { type: "text", summary: "The module to leave.", default: "the old client" } };
          return { path: file.path, bytes: encode(JSON.stringify({ ...manifest, settings })) };
        }
        return file.path === "code.md" ? { path: file.path, bytes: encode("Move off {{settings.old-module}}.") } : file;
      });
      await installPack(repo, "moves", files, await entryFor(files, { package: "@acme/moves", request: "^3.0.0", version: "3.0.0" }));
      const config = await withPackWorkflows({ packSettings: { moves: { "old-module": "legacy-http" } } }, repo, repo);
      expect(config.workflows?.["moves:code"]?.steps[0]?.prompt).toBe("Move off legacy-http.");
    });

    it("binds a built-in pack through the same door", async () => {
      // No built-in declares settings in this slice, so a value for one is refused as undeclared: the binding reaches built-ins.
      await expect(withPackWorkflows({ packSettings: { code: { x: "y" } } }, "/", undefined)).rejects.toMatchObject({ exitCode: EXIT.configuration, field: "packSettings" });
    });

    it("refuses every problem at once, without printing the value", async () => {
      const refused = withPackWorkflows({ packs: ["mine"], packSettings: { mine: { "old-module": "a\u202eb", nope: "x" } } }, rootWithSettingsPack(), undefined);
      await expect(refused).rejects.toThrow(
        settingsRefusal([
          { pack: "mine", setting: "old-module", kind: "invalid", message: ONE_LINE },
          { pack: "mine", setting: "nope", kind: "undeclared", message: "is not a setting of this pack. Its settings are: old-module." },
        ]),
      );
      await expect(refused).rejects.not.toThrow("a\u202eb");
    });

    it("lists packs with a problem without refusing", async () => {
      const { packs, settingProblems } = await projectPackStates({ packs: ["mine"], packSettings: { mine: { nope: "x" } } }, rootWithSettingsPack(), undefined);
      expect(packs.map((pack) => pack.manifest.name)).toContain("mine");
      expect(settingProblems).toHaveLength(1);
    });

    it("leaves every built-in pack exactly as read when there are no settings", async () => {
      const { packs } = await projectPackStates({}, "/", undefined);
      const read = await builtInPacks();
      expect(packs.slice(0, read.length)).toEqual(read);
    });
  });
});
