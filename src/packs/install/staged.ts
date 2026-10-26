import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackFolder, type PackFolderRead } from "../pack-folder.js";
import type { PackageFile } from "./package-archive.js";
import { writePackFiles } from "./store.js";

/**
 * Write a pack's files to a temporary pack folder, read it as a pack, and run `work` on it. The temporary folder is
 * removed on every path, including when `work` throws. Nothing from the pack runs.
 */
export async function withStagedPack<T>(files: readonly PackageFile[], work: (stagedDir: string, folder: PackFolderRead) => Promise<T>): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), "delivery-pack-staged-"));
  try {
    const stagedDir = join(temp, "pack");
    await writePackFiles(stagedDir, files);
    return await work(stagedDir, await readPackFolder(stagedDir));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
