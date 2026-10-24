import { lstat, readdir, type Stats } from "node:fs/promises";
import { join } from "node:path";
import { isEnoent } from "../journal.js";
import { readPack, type Pack, type PackProblem } from "./manifest.js";

export const FILE_ROLES = ["manifest", "prompt", "fixture", "documentation", "housekeeping"] as const;
export type FileRole = (typeof FILE_ROLES)[number];

/** One path in the folder, relative and "/"-separated; a folder not descended into ends in "/". */
export interface PackFolderFile {
  path: string;
  role: FileRole;
}

export type PackFolderRead = { ok: true; pack: Pack; files: PackFolderFile[] } | { ok: false; problems: PackProblem[] };

export const IS_A_LINK = "is a link: a link can point anywhere outside the pack, so this command does not follow it or show what it points at";
export const NOT_PLAIN = "is not a plain file or folder, so this command does not read it";
export const NO_FOLDER = "is not there: there is no folder at this path";
export const NOT_A_FOLDER = "is a file, not a pack folder";
export const NO_MANIFEST = "is missing, so this folder is not a pack: a pack folder holds a pack.json that names its workflows";

/** The stats of `path`, or null when nothing is there. Links are not followed. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** Every link, and every entry that is neither a file, a folder nor a link, in the folder tree under `root`, one folder at a time. Never descends into a link or into a top-level `.git`. */
async function unplainEntries(root: string): Promise<{ problem: PackProblem; topLevel: boolean }[]> {
  const found: { path: string; problem: PackProblem; topLevel: boolean }[] = [];
  const pending: string[] = [""];
  while (pending.length > 0) {
    const rel = pending.shift() as string;
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const file = join(root, path);
      if (entry.isSymbolicLink()) found.push({ path, problem: { file, field: null, message: IS_A_LINK }, topLevel: rel === "" });
      else if (entry.isDirectory()) {
        if (rel === "" && entry.name === ".git") continue;
        pending.push(path);
      } else if (!entry.isFile()) found.push({ path, problem: { file, field: null, message: NOT_PLAIN }, topLevel: rel === "" });
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Inspect the pack folder `dir` without following any link in it. A folder that is not there, is a file, or has no
 * pack.json is refused in one sentence. Links and special files are refused before the loader runs, and when one sits
 * at the top level the loader is not run at all, because it would read through it.
 */
export async function readPackFolder(dir: string): Promise<PackFolderRead> {
  const folder = await statOrNull(dir);
  if (folder === null) return { ok: false, problems: [{ file: dir, field: null, message: NO_FOLDER }] };
  if (!folder.isDirectory()) return { ok: false, problems: [{ file: dir, field: null, message: NOT_A_FOLDER }] };

  const manifestFile = join(dir, "pack.json");
  if ((await statOrNull(manifestFile)) === null) return { ok: false, problems: [{ file: manifestFile, field: null, message: NO_MANIFEST }] };

  const folderProblems = await unplainEntries(dir);
  if (folderProblems.some((found) => found.topLevel)) return { ok: false, problems: folderProblems.map((found) => found.problem) };

  const loaded = await readPack(dir);
  const problems = folderProblems.map((found) => found.problem);
  if (loaded.ok && problems.length === 0) return { ok: true, pack: loaded.pack, files: [] };
  return { ok: false, problems: loaded.ok ? problems : [...problems, ...loaded.problems] };
}
