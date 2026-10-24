import { readLock } from "./lock.js";
import { loadPack, type Pack } from "../manifest.js";
import { installedPackDir } from "./store.js";

/**
 * Every pack the project added, in name order, each read from its folder with the npm origin its record entry gives.
 * Only local files are read: no network, no process, no `tar`. A folder that is missing or broken is refused by `loadPack`.
 */
export async function installedPacks(repoPath: string): Promise<Pack[]> {
  const lock = await readLock(repoPath);
  const entries = Object.entries(lock.packs).sort(([a], [b]) => (a < b ? -1 : 1));
  return Promise.all(
    entries.map(async ([name, entry]) => {
      const pack = await loadPack(installedPackDir(repoPath, name));
      return { ...pack, origin: { kind: "installed", package: entry.package, version: entry.version, request: entry.request, integrity: entry.integrity } };
    }),
  );
}
