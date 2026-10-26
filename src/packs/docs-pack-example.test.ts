import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPack } from "./manifest.js";
import { bindSettings } from "./settings.js";

const dir = fileURLToPath(new URL("../../examples/docs-pack/", import.meta.url));

describe("the docs example pack", () => {
  it("reads, and declares a folder setting with a default and a severity setting that holds its fix", async () => {
    const read = await readPack(dir);
    expect(read.ok && read.pack.manifest.settings).toEqual({
      "docs-folder": { type: "path", summary: "The folder that holds your documentation.", default: "docs" },
      "hold-from": { type: "severity", summary: "Changes rated this serious or more wait for your sign-off.", default: "high" },
    });
  });

  it("holds its fix at high by default, and at the owner's severity when given", async () => {
    const read = await readPack(dir);
    if (!read.ok) throw new Error("unreadable");
    expect(bindSettings(read.pack, undefined)).toMatchObject({ ok: true, pack: { workflows: { "docs:fix": { hold: "high" } } } });
    expect(bindSettings(read.pack, { "hold-from": "medium" })).toMatchObject({ ok: true, pack: { workflows: { "docs:fix": { hold: "medium" } } } });
  });

  it("tells both workflows the default folder, and an owner's folder when given", async () => {
    const read = await readPack(dir);
    if (!read.ok) throw new Error("unreadable");
    const byDefault = bindSettings(read.pack, undefined);
    const owned = bindSettings(read.pack, { "docs-folder": "handbook" });
    for (const name of ["docs:look", "docs:fix"]) {
      expect(byDefault.ok && byDefault.pack.workflows[name]?.steps[0]?.prompt).toContain("`docs`");
      expect(owned.ok && owned.pack.workflows[name]?.steps[0]?.prompt).toContain("`handbook`");
    }
  });
});
