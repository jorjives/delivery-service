import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPack } from "./manifest.js";
import { bindSettings } from "./settings.js";

const dir = fileURLToPath(new URL("../../examples/docs-pack/", import.meta.url));

describe("the docs example pack", () => {
  it("reads, and declares a folder setting with a default", async () => {
    const read = await readPack(dir);
    expect(read.ok && read.pack.manifest.settings).toEqual({ "docs-folder": { type: "path", summary: "The folder that holds your documentation.", default: "docs" } });
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
