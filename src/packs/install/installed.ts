import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { InstalledPackRefused } from "../../errors.js";
import { isEnoent } from "../../journal.js";
import { declaresNewerFormat, type Pack, type PackProblem } from "../manifest.js";
import { readPackFolder } from "../pack-folder.js";
import { changedFiles, fileDigests, fingerprintedFiles } from "./digests.js";
import { fingerprintOf, readLock, type LockEntry } from "./lock.js";
import { installedPackDir, installedPacksDir } from "./store.js";

/** One added pack as the project's record and its folder agree, or do not. Only `ok` and `unapproved` carry a pack that can be read. */
export type InstalledPack =
  | { name: string; state: "ok"; entry: LockEntry; pack: Pack }
  | { name: string; state: "unapproved"; entry: LockEntry; pack: Pack }
  | { name: string; state: "missing"; entry: LockEntry }
  | { name: string; state: "invalid"; entry: LockEntry; problems: PackProblem[] }
  | { name: string; state: "newer-format"; entry: LockEntry; problems: PackProblem[] }
  | { name: string; state: "changed"; entry: LockEntry; changed: string[] }
  | { name: string; state: "unrecorded" };

export type UnusableInstalledPack = Exclude<InstalledPack, { state: "ok" }>;

const byName = (a: InstalledPack, b: InstalledPack): number => (a.name < b.name ? -1 : 1);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/** The pack as the record gives its origin: the npm package and version it came from. */
const withOrigin = (pack: Pack, entry: LockEntry): Pack => ({
  ...pack,
  origin: { kind: "installed", package: entry.package, version: entry.version, request: entry.request, integrity: entry.integrity },
});

/**
 * One recorded pack's state, checking in order and stopping at the first failure: its folder is there, it reads as a pack,
 * its manifest names it as the record does, its files still give the fingerprint the record holds, and that fingerprint is the one approved.
 * Only local files are read.
 */
export async function checkInstalledPack(repoPath: string, name: string, entry: LockEntry): Promise<Exclude<InstalledPack, { state: "unrecorded" }>> {
  const dir = installedPackDir(repoPath, name);
  if (!(await exists(dir))) return { name, state: "missing", entry };
  const read = await readPackFolder(dir);
  if (!read.ok) {
    if (await declaresNewerFormat(dir)) return { name, state: "newer-format", entry, problems: read.problems };
    return { name, state: "invalid", entry, problems: read.problems };
  }
  const { pack } = read;
  const manifestName = pack.manifest.name;
  if (manifestName !== name) {
    const problem = { file: join(dir, "pack.json"), field: "name", message: `"name" is "${manifestName}", but the record keeps this pack as ${name}` };
    return { name, state: "invalid", entry, problems: [problem] };
  }
  if (fingerprintOf(pack) !== entry.fingerprint) {
    return { name, state: "changed", entry, changed: changedFiles(entry.files, await fileDigests(dir, fingerprintedFiles(pack))) };
  }
  if (entry.approved !== entry.fingerprint) return { name, state: "unapproved", entry, pack: withOrigin(pack, entry) };
  return { name, state: "ok", entry, pack: withOrigin(pack, entry) };
}

/** The folders directly under the added packs' folder that the record has no entry for. A missing folder has none; staging is never a pack. */
async function unrecordedNames(repoPath: string, recorded: ReadonlySet<string>): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(installedPacksDir(repoPath), { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  return entries.filter((entry) => entry.isDirectory() && entry.name !== ".staging" && !recorded.has(entry.name)).map((entry) => entry.name);
}

/** Every pack the record names and every unrecorded folder, sorted by name, each checked against its folder. Only local files are read. */
export async function readInstalledPacks(repoPath: string): Promise<InstalledPack[]> {
  const lock = await readLock(repoPath);
  const recorded = await Promise.all(Object.entries(lock.packs).map(([name, entry]) => checkInstalledPack(repoPath, name, entry)));
  const unrecorded = (await unrecordedNames(repoPath, new Set(Object.keys(lock.packs)))).map((name): InstalledPack => ({ name, state: "unrecorded" }));
  return [...recorded, ...unrecorded].sort(byName);
}

/** Throws `InstalledPackRefused`, naming every pack that is not `ok`, when there is any. */
export function refuseUnusable(repoPath: string, installed: readonly InstalledPack[]): void {
  const refused = installed.filter((pack): pack is UnusableInstalledPack => pack.state !== "ok");
  if (refused.length > 0) throw new InstalledPackRefused(repoPath, refused);
}

/**
 * Every added pack, in name order, each read from its folder with the npm origin its record entry gives. Refuses the whole
 * set when any of them is not as the record approved it. Only local files are read: no network, no process, no `tar`.
 */
export async function installedPacks(repoPath: string): Promise<Pack[]> {
  const installed = await readInstalledPacks(repoPath);
  refuseUnusable(repoPath, installed);
  return installed.flatMap((pack) => (pack.state === "ok" ? [pack.pack] : []));
}
