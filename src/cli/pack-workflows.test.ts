import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LockEntry } from "../packs/install/lock.js";
import type { PackageFile } from "../packs/install/package-archive.js";
import { installPack } from "../packs/install/store.js";
import { builtInPackClash, builtInWorkflowClash, packWorkflowClash, withPackWorkflows } from "./pack-workflows.js";

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

const MOVES_ENTRY: LockEntry = {
  source: "npm",
  package: "@acme/moves",
  request: "^3.0.0",
  version: "3.0.0",
  integrity: "sha512-abc",
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
};

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

  it("refuses two listed packs that define the same workflow, by the existing sentence", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "a"), "mine"); // /2: mine:scan, mine:fix
    writeV3Pack(join(root, "b"), "mine"); // /3: mine:scan, mine:code
    await expect(withPackWorkflows({ packs: ["a", "b"] }, root, undefined)).rejects.toThrow(packWorkflowClash("mine:scan"));
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
});
