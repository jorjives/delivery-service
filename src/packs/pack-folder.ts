import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isEnoent } from "../journal.js";
import { FIXTURES } from "./pack-fixtures.js";
import { promptsOf, readPack, type Pack, type PackProblem } from "./manifest.js";

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
export const NOT_IN_A_PACK = "is not part of a pack: a pack folder holds only its pack.json, the instruction files it names, a fixtures folder, and README, licence or changelog files, so a script or any other file cannot come with it";
export const FOLDER_NOT_IN_A_PACK = "is a folder that is not part of a pack: a pack folder holds only its pack.json, the instruction files it names, a fixtures folder, and README, licence or changelog files";
export const UNUSED_INSTRUCTIONS = "is an instruction file that no workflow in pack.json names, so it is not part of the pack";

/** The folder the fixtures live in, which the walk descends into; the only entries it allows there are the project and the fixture files. */
const FIXTURES_FOLDER = dirname(FIXTURES.project);
/** The fixture files that sit beside the project folder, not inside it. */
const FIXTURE_FILES: readonly string[] = [FIXTURES.review, FIXTURES.fixes, FIXTURES.expect];
/** Top-level documentation names, in any case, with no extension or one of the usual document extensions. */
const DOCUMENTATION = /^(readme|licen[cs]e|changelog)(\.(md|markdown|txt|rst|adoc))?$/i;
/** Housekeeping files, allowed at any level the walk reaches. */
const HOUSEKEEPING = new Set([".gitignore", ".gitattributes", ".DS_Store", "Thumbs.db"]);

/** One entry the walk reached: its path relative to the folder, and what it is. */
interface Entry {
  path: string;
  kind: "file" | "folder" | "link" | "special";
}

/** Whether the walk descends into the folder at `path`: the fixtures folder, and the project inside it with everything under it. */
function walked(path: string): boolean {
  return path === FIXTURES_FOLDER || path === FIXTURES.project || path.startsWith(`${FIXTURES.project}/`);
}

/** The stats of `path`, or null when nothing is there. Links are not followed. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/**
 * Every entry the walk reaches under `root`, sorted by path. It descends only into the fixtures folder and the project in
 * it, one folder at a time, and lists any other folder as one entry without reading inside it. Never follows a link.
 */
async function entriesOf(root: string): Promise<Entry[]> {
  const found: Entry[] = [];
  const pending: string[] = [""];
  while (pending.length > 0) {
    const rel = pending.shift() as string;
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) found.push({ path, kind: "link" });
      else if (entry.isDirectory()) {
        if (walked(path)) pending.push(path);
        else found.push({ path, kind: "folder" });
      } else found.push({ path, kind: entry.isFile() ? "file" : "special" });
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The problem with a link or a special file: the loader would read through it, or could block on it. */
function unplainProblem(entry: Entry, root: string): PackProblem {
  const message = entry.kind === "link" ? IS_A_LINK : NOT_PLAIN;
  return { file: join(root, entry.path), field: null, message };
}

/** What the check makes of one entry: the file it is in the pack, and the problem with it when it is not. Both are absent for a name the loader already reports. */
interface Judged {
  file?: PackFolderFile;
  problem?: PackProblem;
}

/** Judge one entry against the closed set. `prompts` is null when the manifest could not be read, so an instruction file cannot be judged. */
function judge(entry: Entry, root: string, prompts: readonly string[] | null): Judged {
  const file = join(root, entry.path);
  const top = !entry.path.includes("/");
  const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
  const refuse = (message: string): Judged => ({ problem: { file, field: null, message } });
  if (entry.kind === "link" || entry.kind === "special") return { problem: unplainProblem(entry, root) };
  if (entry.kind === "folder") {
    if (entry.path === ".git") return { file: { path: ".git/", role: "housekeeping" } };
    // The loader names a folder given as pack.json or as a prompt, so the check does not name it too.
    if (entry.path === "pack.json" || prompts?.includes(entry.path)) return {};
    return refuse(FOLDER_NOT_IN_A_PACK);
  }
  const role = (kind: FileRole): Judged => ({ file: { path: entry.path, role: kind } });
  if (top && entry.path === "pack.json") return role("manifest");
  if (top && prompts?.includes(entry.path)) return role("prompt");
  if (HOUSEKEEPING.has(name)) return role("housekeeping");
  if (entry.path.startsWith(`${FIXTURES.project}/`) || FIXTURE_FILES.includes(entry.path)) return role("fixture");
  if (top && DOCUMENTATION.test(entry.path)) return role("documentation");
  if (top && entry.path.endsWith(".md")) return prompts === null ? {} : refuse(UNUSED_INSTRUCTIONS);
  return refuse(NOT_IN_A_PACK);
}

/**
 * Inspect the pack folder `dir` without following any link in it. A folder that is not there, is a file, or has no
 * pack.json is refused in one sentence. Links and special files are refused before the loader runs, and when one sits
 * at the top level the loader is not run at all, because it would read through it. Otherwise every entry is held to the
 * closed set, and the folder's problems are shown beside the loader's, all at once.
 */
export async function readPackFolder(dir: string): Promise<PackFolderRead> {
  const folder = await statOrNull(dir);
  if (folder === null) return { ok: false, problems: [{ file: dir, field: null, message: NO_FOLDER }] };
  if (!folder.isDirectory()) return { ok: false, problems: [{ file: dir, field: null, message: NOT_A_FOLDER }] };

  const manifestFile = join(dir, "pack.json");
  if ((await statOrNull(manifestFile)) === null) return { ok: false, problems: [{ file: manifestFile, field: null, message: NO_MANIFEST }] };

  const entries = await entriesOf(dir);
  const unplain = entries.filter((entry) => entry.kind === "link" || entry.kind === "special");
  if (unplain.some((entry) => !entry.path.includes("/"))) return { ok: false, problems: unplain.map((entry) => unplainProblem(entry, dir)) };

  const read = await readPack(dir);
  const judged = entries.map((entry) => judge(entry, dir, read.ok ? promptsOf(read.pack.manifest) : read.prompts));
  const folderProblems = judged.flatMap((found) => (found.problem === undefined ? [] : [found.problem]));
  const problems = [...folderProblems, ...(read.ok ? [] : read.problems)];
  if (read.ok && problems.length === 0) {
    // `entries` is sorted by path, so the files come out in order.
    const files = judged.flatMap((found) => (found.file === undefined ? [] : [found.file]));
    return { ok: true, pack: read.pack, files };
  }
  return { ok: false, problems };
}
