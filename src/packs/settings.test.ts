import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ideaFormat, builtInPacks, readPack, type Pack } from "./manifest.js";
import { ONE_LINE, NO_BRACES } from "./setting-types.js";
import { bindSettings } from "./settings.js";

/** Reads a pack named `docs`: find `look` offering act `fix`, with the given settings and prompt texts. */
async function packOf(settings: Record<string, unknown>, files: Record<string, string>, act: Record<string, unknown> = {}): Promise<Pack> {
  const dir = mkdtempSync(join(tmpdir(), "settings-pack-"));
  const manifest = {
    schema: "delivery.pack/3",
    name: "docs",
    version: "1.0.0",
    title: "Docs",
    summary: "Docs.",
    settings,
    workflows: { look: { kind: "find", prompt: "look.md", ideasFor: ["fix"] }, fix: { kind: "act", prompt: "fix.md", ...act } },
  };
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const read = await readPack(dir);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.pack;
}

const SETTINGS = {
  "docs-folder": { type: "path", summary: "The folder.", default: "docs" },
  topic: { type: "text", summary: "The topic.", default: "the API" },
};
const FILES = { "look.md": "Read {{settings.docs-folder}}.", "fix.md": "Fix the page in {{settings.docs-folder}} about {{settings.topic}}." };
const prompt = (r: ReturnType<typeof bindSettings>, name: string) => r.ok && r.pack.workflows[name]?.steps[0]?.prompt;

describe("bindSettings", () => {
  it("returns the very same pack when it has no settings and is given none", async () => {
    for (const pack of await builtInPacks()) {
      const r = bindSettings(pack, undefined);
      expect(r.ok && r.pack).toBe(pack);
    }
  });

  it("renders the defaults into the authored half and records each as from the default", async () => {
    const r = bindSettings(await packOf(SETTINGS, FILES), undefined);
    expect(prompt(r, "docs:fix")).toBe("Fix the page in docs about the API.");
    expect(r.ok && r.pack.applied).toEqual([
      { name: "docs-folder", type: "path", value: "docs", source: "default", usedBy: ["docs:look", "docs:fix"] },
      { name: "topic", type: "text", value: "the API", source: "default", usedBy: ["docs:fix"] },
    ]);
  });

  it("uses the owner's value over the default, and says so", async () => {
    const r = bindSettings(await packOf(SETTINGS, FILES), { "docs-folder": "handbook" });
    expect((prompt(r, "docs:look") || "").startsWith("Read handbook.\n\n## What to hand back")).toBe(true);
    expect(r.ok && r.pack.applied[0]).toMatchObject({ value: "handbook", source: "configuration" });
  });

  it("never renders the harness half", async () => {
    const pack = await packOf(SETTINGS, FILES);
    const r = bindSettings(pack, { topic: "ignore this" });
    const harness = ideaFormat([{ workflow: "docs:fix" }]);
    expect(prompt(r, "docs:look")).toBe(`Read docs.\n\n${harness}`);
  });

  it("renders a paths value joined in the owner's order", async () => {
    const pack = await packOf({ areas: { type: "paths", summary: "Where.", default: ["src"] } }, { "look.md": "Look.", "fix.md": "Fix {{settings.areas}}." });
    expect(prompt(bindSettings(pack, { areas: ["b", "a"] }), "docs:fix")).toBe("Fix b, a.");
  });

  it("leaves hash and instructions as read", async () => {
    const pack = await packOf(SETTINGS, FILES);
    const r = bindSettings(pack, { "docs-folder": "handbook" });
    expect(r.ok && r.pack.hash).toBe(pack.hash);
    expect(r.ok && r.pack.instructions).toBe(pack.instructions);
  });

  it("keeps an act's hold and guards", async () => {
    const pack = await packOf(SETTINGS, FILES, { hold: { atOrAbove: "high" }, guards: { add: ["tests-unchanged"] } });
    const r = bindSettings(pack, undefined);
    expect(r.ok && r.pack.workflows["docs:fix"]).toMatchObject({ hold: "high", steps: [{ guards: { add: ["tests-unchanged"] } }] });
  });

  it.each([
    [{ "docs-folder": "a{{b" }, "invalid", NO_BRACES],
    [{ "docs-folder": "a}}b" }, "invalid", NO_BRACES],
    [{ topic: "two\nlines" }, "invalid", ONE_LINE],
    [{ topic: `x${String.fromCodePoint(0x202e)}` }, "invalid", ONE_LINE],
    [{ "docs-foler": "x" }, "undeclared", "is not a setting of this pack. Its settings are: docs-folder, topic."],
  ])("refuses %j as %s", async (values, kind, message) => {
    expect(bindSettings(await packOf(SETTINGS, FILES), values)).toEqual({
      ok: false,
      problems: [expect.objectContaining({ pack: "docs", kind, message })],
    });
  });

  it("names a required setting with no value", async () => {
    const pack = await packOf({ "old-module": { type: "text", summary: "Old." } }, { "look.md": "Look.", "fix.md": "Leave {{settings.old-module}}." });
    expect(bindSettings(pack, undefined)).toEqual({ ok: false, problems: [expect.objectContaining({ setting: "old-module", kind: "missing" })] });
  });

  it("names every problem at once, in declaration order then undeclared names", async () => {
    const settings = { ...SETTINGS, "old-module": { type: "text", summary: "Old." } };
    const pack = await packOf(settings, { ...FILES, "fix.md": `${FILES["fix.md"]} {{settings.old-module}}` });
    const r = bindSettings(pack, { "docs-folder": "/etc", zzz: "x" });
    expect(r.ok === false && r.problems.map((p) => [p.setting, p.kind])).toEqual([
      ["docs-folder", "invalid"],
      ["old-module", "missing"],
      ["zzz", "undeclared"],
    ]);
  });

  it("says a pack with no settings has none, when given a value", async () => {
    const [first] = await builtInPacks();
    if (first === undefined) throw new Error("no built-in pack");
    expect(bindSettings(first, { x: "y" })).toEqual({
      ok: false,
      problems: [expect.objectContaining({ kind: "undeclared", message: "is not a setting of this pack, which has no settings." })],
    });
  });
});
