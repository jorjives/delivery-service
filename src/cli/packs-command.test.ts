import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInPacks } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { packWorkflowClash } from "./pack-workflows.js";

/** The contents of a delivery.pack/3 manifest named `name`, with a find `scan` offering an act `code`. */
const v3Pack = (name: string, summary = "Moves calls off retired code."): string =>
  JSON.stringify({
    schema: "delivery.pack/3",
    name,
    version: "1.0.0",
    title: "Moves",
    summary,
    workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
  });

/** The contents of a delivery.pack/2 manifest named `name`. */
const v2Pack = (name: string): string =>
  JSON.stringify({ schema: "delivery.pack/2", name, version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } });

describe("delivery packs", () => {
  it("lists every review available with its plain sentence, and how to run one", async () => {
    const { exitCode, stdout } = await delivery(["packs"], { cwd: initTempRepo("packs-", { "a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("These reviews are available:");
    for (const pack of await builtInPacks()) expect(lines).toContain(`  ${pack.manifest.name}: ${pack.manifest.summary}`);
    expect(lines.slice(-2)).toEqual(["Run one with: delivery review code", "Or use a review folder of your own: list it under packs in delivery.config.json, then delivery review <its name>"]);
  });

  it("prints the pack format's JSON Schema with --schema, wherever it is asked", async () => {
    const { exitCode, stdout } = await delivery(["packs", "--schema"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual(packSchema());
  });

  it("lists the reviews as data with --json", async () => {
    const { exitCode, stdout } = await delivery(["packs", "--json"], { cwd: initTempRepo("packs-json-", { "a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    const packs = await builtInPacks();
    expect(JSON.parse(stdout)).toEqual({ packs: packs.map(({ manifest }) => ({ name: manifest.name, version: manifest.version, title: manifest.title, summary: manifest.summary })) });
  });

  it("lists a pack the project lists beside the built-in ones", async () => {
    const repo = initTempRepo("packs-listed-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": v3Pack("mymoves"),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const [code, security] = await builtInPacks();
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("These reviews are available:");
    expect(lines.slice(1, 4)).toEqual([`  ${code?.manifest.name}: ${code?.manifest.summary}`, `  ${security?.manifest.name}: ${security?.manifest.summary}`, "  mymoves: Moves calls off retired code."]);
  });

  it("lists a listed pack with --json too", async () => {
    const repo = initTempRepo("packs-listed-json-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": v3Pack("mymoves"),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stdout } = await delivery(["packs", "--json"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const packs = JSON.parse(stdout).packs;
    expect(packs[packs.length - 1]).toEqual({ name: "mymoves", version: "1.0.0", title: "Moves", summary: "Moves calls off retired code." });
  });

  it("refuses a listed pack with a mistake, naming its file and field", async () => {
    const repo = initTempRepo("packs-mistake-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": JSON.stringify({
        schema: "delivery.pack/3",
        name: "mymoves",
        version: "1.0.0",
        title: "Moves",
        summary: "Moves calls off retired code.",
        workflows: { scan: { kind: "find", prompt: "scan.md" }, code: { kind: "act", prompt: "code.md" } },
      }),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stderr } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(`${join(repo, "my-pack", "pack.json")}: "workflows.scan.ideasFor" is missing`);
  });

  it("refuses a project whose packs clash, by the existing sentence", async () => {
    const repo = initTempRepo("packs-clash-", {
      "delivery.config.json": JSON.stringify({ packs: ["a", "b"] }),
      "a/pack.json": v2Pack("mine"),
      "a/scan.md": "# Scan\n",
      "a/fix.md": "# Fix\n",
      "b/pack.json": v3Pack("mine"),
      "b/scan.md": "# Scan\n",
      "b/code.md": "# Code\n",
    });
    const { exitCode, stderr } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(packWorkflowClash("mine:scan"));
  });

  it("lists the built-in packs outside any repository", async () => {
    const { exitCode, stdout } = await delivery(["packs"], { cwd: mkdtempSync(join(tmpdir(), "no-repo-")) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("  code: ");
  });
});
