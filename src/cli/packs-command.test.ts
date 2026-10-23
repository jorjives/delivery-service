import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { builtInPacks } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";

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
});
