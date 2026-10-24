import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { packPackage } from "./install-fixtures.js";
import { readPackage } from "./package-archive.js";
import { withStagedPack } from "./staged.js";

/** The temporary pack folders the staging step makes in the system's temporary folder. */
const tempFolders = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("delivery-pack-")).sort();

/** The files of a valid pack, as an npm package carries them. */
async function packFiles() {
  const read = await readPackage(packPackage());
  if (!read.ok) throw new Error("the fixture pack did not read");
  return read.packFiles;
}

describe("withStagedPack", () => {
  it("reads the files as a pack folder and leaves no temporary folder", async () => {
    const files = await packFiles();
    const before = tempFolders();
    let seen: { ok: boolean; existed: boolean } | undefined;
    await withStagedPack(files, async (stagedDir, folder) => {
      seen = { ok: folder.ok, existed: existsSync(stagedDir) };
    });
    expect(seen).toEqual({ ok: true, existed: true });
    expect(tempFolders()).toEqual(before);
  });

  it("removes the temporary folder when the work throws", async () => {
    const files = await packFiles();
    const before = tempFolders();
    await expect(
      withStagedPack(files, async () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(tempFolders()).toEqual(before);
  });
});
