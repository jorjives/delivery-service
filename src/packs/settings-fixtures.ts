import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPack, type Pack } from "./manifest.js";

/** Reads a pack named `docs`: find `look` offering act `fix`, with the given settings and prompt texts. */
export async function settingsPackOf(settings: Record<string, unknown>, files: Record<string, string>, act: Record<string, unknown> = {}): Promise<Pack> {
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
