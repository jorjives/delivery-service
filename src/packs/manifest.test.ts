import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidPack, UnknownPack } from "../errors.js";
import { BUILT_IN_PACKS, builtInPacks, loadPack, PACK_SCHEMA, resolvePack } from "./manifest.js";

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
  it("ship a code review that reads as delivery.pack/1, with its instructions", async () => {
    const [code] = await builtInPacks();
    expect(code?.manifest).toMatchObject({ schema: PACK_SCHEMA, name: "code", title: "Code review", scan: { maxFindings: 40 } });
    expect(code?.manifest.scan.categories.map((category) => category.id)).toEqual(["correctness", "error-handling", "dead-code", "inconsistency", "debt"]);
    expect(code?.scanInstructions).toContain("# Code review");
    expect(code?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("are found by name", async () => {
    expect((await resolvePack("code", "/anywhere")).manifest.name).toBe("code");
  });

  it("name the ones available when asked for one that does not exist", async () => {
    const err = await resolvePack("nope", "/anywhere").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownPack);
    expect(err).toMatchObject({ packName: "nope", available: ["code"] });
  });
});

describe("a pack from a folder", () => {
  it("loads exactly as a built-in one, by path", async () => {
    const dir = editedPack((manifest) => (manifest.name = "mine"));
    expect((await resolvePack(dir, "/")).manifest.name).toBe("mine");
  });

  it("changes its identity when its instructions change", async () => {
    const dir = editedPack(() => undefined);
    const before = (await loadPack(dir)).hash;
    writeFileSync(join(dir, "scan.md"), "# Different\n");
    expect((await loadPack(dir)).hash).not.toBe(before);
  });

  it("cannot widen what the review's agent may do: a tool list is not part of the format", async () => {
    const dir = editedPack((manifest) => (manifest.allowedTools = ["Read", "Bash"]));
    await expect(loadPack(dir)).rejects.toMatchObject({ filePath: join(dir, "pack.json"), detail: expect.stringContaining("allowedTools") });
  });

  it.each([
    ["a category with no id", (m: Record<string, unknown>) => ((m.scan as { categories: unknown[] }).categories = [{ title: "x", description: "y" }]), "scan.categories.0.id"],
    ["the same category twice", (m: Record<string, unknown>) => ((m.scan as { categories: unknown[] }).categories = [{ id: "a", title: "x", description: "y" }, { id: "a", title: "x", description: "y" }]), "scan.categories"],
    ["instructions outside the folder", (m: Record<string, unknown>) => ((m.scan as { prompt: string }).prompt = "../scan.md"), "scan.prompt"],
    ["a version that is not one", (m: Record<string, unknown>) => (m.version = "one"), "version"],
  ])("is refused for %s, naming the file and the field", async (_, edit, field) => {
    const dir = editedPack(edit);
    const err = await loadPack(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidPack);
    expect(err).toMatchObject({ filePath: join(dir, "pack.json"), detail: expect.stringContaining(`"${field}"`) });
  });

  it("is refused when there is no pack in the folder, naming where it looked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "no-pack-"));
    await expect(resolvePack(dir, "/")).rejects.toMatchObject({ filePath: join(dir, "pack.json"), detail: "is missing" });
  });
});
