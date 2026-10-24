import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isEnoent } from "../../journal.js";
import { prepareDeliveryDir } from "../../run-location.js";
import { putLockEntry, type LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";

/** The folder the added packs are kept in, inside a project's `.delivery/`. */
export const installedPacksDir = (repoPath: string): string => join(repoPath, ".delivery", "packs");

/** The folder one added pack is kept in. */
export const installedPackDir = (repoPath: string, name: string): string => join(installedPacksDir(repoPath), name);

/** Write a pack's files into `dir`, making each file's folders. The paths are the ones `readPackage` checked. */
export async function writePackFiles(dir: string, files: readonly PackageFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const path = join(dir, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes, { mode: 0o644 });
  }
}

/**
 * Keep an added pack in the project: its folder first, then its record entry, so a record never names a folder
 * that is not there. The files are written beside the folder and moved into place, so the folder is never half
 * written; a folder an interrupted add left behind is moved aside and removed.
 */
export async function installPack(repoPath: string, name: string, files: readonly PackageFile[], entry: LockEntry): Promise<void> {
  await prepareDeliveryDir(repoPath);
  const packs = installedPacksDir(repoPath);
  const staging = join(packs, ".staging");
  const token = randomBytes(8).toString("hex");
  const staged = join(staging, token);
  const old = join(staging, `${token}-old`);
  await writePackFiles(staged, files);
  await rename(join(packs, name), old).catch((error: unknown) => {
    if (!isEnoent(error)) throw error;
  });
  await rename(staged, join(packs, name));
  await rm(old, { recursive: true, force: true });
  await putLockEntry(repoPath, name, entry);
}
