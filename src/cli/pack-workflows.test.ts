import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packWorkflowClash, withPackWorkflows } from "./pack-workflows.js";

/** A pack folder named `name`, with a minimal delivery.pack/2 manifest and its two instruction files. */
function writePack(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pack.json"), JSON.stringify({ schema: "delivery.pack/2", name, version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }));
  writeFileSync(join(dir, "scan.md"), "# Scan\n");
  writeFileSync(join(dir, "fix.md"), "# Fix\n");
}

describe("pack workflows", () => {
  it("adds every built-in pack's workflows to the config's own", async () => {
    const config = await withPackWorkflows({ workflows: { mine: { steps: [{ name: "a", prompt: "a" }] } } }, "/");
    expect(Object.keys(config.workflows ?? {}).sort()).toEqual(["code:fix", "code:scan", "mine", "security:fix", "security:scan"]);
  });

  it("adds a pack the config lists, from a folder relative to the config file", async () => {
    const root = mkdtempSync(join(tmpdir(), "pack-workflows-"));
    writePack(join(root, "reviews/mine"), "mine");
    expect((await withPackWorkflows({ packs: ["reviews/mine"] }, root)).workflows?.["mine:fix"]).toBeDefined();
  });

  it("refuses a workflow name two of them define", async () => {
    await expect(withPackWorkflows({ workflows: { "code:fix": { steps: [{ name: "a", prompt: "a" }] } } }, "/")).rejects.toThrow(packWorkflowClash("code:fix"));
  });
});
