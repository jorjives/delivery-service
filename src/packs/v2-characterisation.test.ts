import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInPacks, loadPack } from "./manifest.js";

// The Operational note of packs-for-any-workflow slice 1: what a delivery.pack/2 pack becomes,
// captured from the loader before the /3 reader existed. It must never change.
describe("a delivery.pack/2 pack, as it loaded before delivery.pack/3", () => {
  it("keeps its workflows, its names and its identity", async () => {
    const mine = mkdtempSync(join(tmpdir(), "v2-char-"));
    writeFileSync(join(mine, "pack.json"), JSON.stringify({ schema: "delivery.pack/2", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md", guards: { add: ["backlog-only"] } }, hold: "medium" }));
    writeFileSync(join(mine, "scan.md"), "# Scan\n");
    writeFileSync(join(mine, "fix.md"), "# Fix\n");
    const packs = [...(await builtInPacks()).filter((pack) => pack.schema === "delivery.pack/2"), await loadPack(mine)];
    const captured = packs.map(({ manifest, hash, workflows }) => ({ name: manifest.name, version: manifest.version, title: manifest.title, summary: manifest.summary, hash, workflows }));
    await expect(`${JSON.stringify(captured, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/v2-packs.json");
  });
});
