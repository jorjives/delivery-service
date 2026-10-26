import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { packPackage } from "./install-fixtures.js";
import { readPackage } from "./package-archive.js";
import { withStagedPack } from "./staged.js";

/** The files of a valid pack, as an npm package carries them. */
async function packFiles() {
  const read = await readPackage(packPackage());
  if (!read.ok) throw new Error("the fixture pack did not read");
  return read.packFiles;
}

describe("withStagedPack", () => {
  it("reads the files as a pack folder and leaves no temporary folder", async () => {
    const files = await packFiles();
    let seen: { ok: boolean; existed: boolean; temp: string } | undefined;
    await withStagedPack(files, async (stagedDir, folder) => {
      seen = { ok: folder.ok, existed: existsSync(stagedDir), temp: dirname(stagedDir) };
    });
    expect(seen).toMatchObject({ ok: true, existed: true });
    expect(existsSync(seen?.temp ?? "")).toBe(false);
  });

  it("removes the temporary folder when the work throws", async () => {
    const files = await packFiles();
    let temp: string | undefined;
    await expect(
      withStagedPack(files, async (stagedDir) => {
        temp = dirname(stagedDir);
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(temp).toBeDefined();
    expect(existsSync(temp ?? "")).toBe(false);
  });
});
