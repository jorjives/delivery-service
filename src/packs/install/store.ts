import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isEnoent } from "../../journal.js";
import { prepareDeliveryDir } from "../../run-location.js";
import { setLockEntry, withRecordLock, type LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";

/** What git is told about a kept pack's files: none is line-ending converted, so the bytes stay as the package had them. */
export const KEPT_ATTRIBUTES = "* -text\n";

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
 * Put a pack's folder in place, with the files written beside it and moved in, so the folder is never half written.
 * Whatever an interrupted add left in staging is removed first. The caller must hold the record lock.
 */
async function placeFolder(repoPath: string, name: string, files: readonly PackageFile[]): Promise<void> {
  const packs = installedPacksDir(repoPath);
  const staging = join(packs, ".staging");
  await rm(staging, { recursive: true, force: true });
  const token = randomBytes(8).toString("hex");
  const staged = join(staging, token);
  const old = join(staging, `${token}-old`);
  await writePackFiles(staged, files);
  // Written last, so it replaces any .gitattributes the package brought: a housekeeping file, outside the fingerprint.
  await writeFile(join(staged, ".gitattributes"), KEPT_ATTRIBUTES);
  await rename(join(packs, name), old).catch((error: unknown) => {
    if (!isEnoent(error)) throw error;
  });
  await rename(staged, join(packs, name));
  await rm(old, { recursive: true, force: true });
}

/** Put a pack's files back in its folder, replacing the folder and leaving the record as it stands. */
export async function restorePackFolder(repoPath: string, name: string, files: readonly PackageFile[]): Promise<void> {
  await prepareDeliveryDir(repoPath);
  await withRecordLock(repoPath, () => placeFolder(repoPath, name, files));
}

/**
 * Keep an added pack in the project: its folder first, then its record entry, so a record never names a folder
 * that is not there. Both happen under one hold of the record lock, so no other writer sees the folder without its entry.
 */
export async function installPack(repoPath: string, name: string, files: readonly PackageFile[], entry: LockEntry): Promise<void> {
  await prepareDeliveryDir(repoPath);
  await withRecordLock(repoPath, async () => {
    await placeFolder(repoPath, name, files);
    await setLockEntry(repoPath, name, entry);
  });
}
