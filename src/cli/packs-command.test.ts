import { describe, expect, it } from "vitest";
import { builtInPacks } from "../packs/manifest.js";
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
    expect(lines.slice(-2)).toEqual(["Run one with: delivery review code", "Or run a review from a folder of your own: delivery review ./path-to-the-folder"]);
  });
});
