import { posix } from "node:path";
import { gunzipSync } from "node:zlib";
import { Parser, type ReadEntry } from "tar";

/** The size limits a package for a pack must meet. The tarball is parsed in memory; nothing is extracted to disk. */
export const ARCHIVE_CAPS = { compressed: 10 * 2 ** 20, expanded: 20 * 2 ** 20, entries: 2000, packageJson: 256 * 2 ** 10, keptFile: 2 * 2 ** 20 } as const;

/** A file a pack keeps: its path relative to the pack folder, `/`-separated, and its bytes. */
export interface PackageFile {
  path: string;
  bytes: Uint8Array;
}

/** Why a package is refused: the path inside the package it concerns (without `package/`), or null when it concerns the whole package. */
export interface ArchiveProblem {
  entry: string | null;
  message: string;
}

export type PackageRead =
  | { ok: true; packPath: string; packFiles: PackageFile[]; ignored: { path: string; bytes: number }[]; declares: ("scripts" | "bin" | "dependencies")[] }
  | { ok: false; problem: ArchiveProblem };

export const NOT_AN_ARCHIVE = "could not be read as a package";
export const NO_PACK_FIELD = "does not say it holds a pack. If you wrote it, add a delivery-pack field to its package.json naming the pack folder";
export const BAD_PACK_FIELD = "names its pack folder in a way that is not a plain folder inside the package";
export const noPackThere = (path: string): string => `says its pack is in ${path}, but there is no pack.json there`;
export const NOT_PLAIN_ENTRY = "is a link or another special file: a package for a pack holds only plain files and folders";
export const BAD_PATH = "has a path that leads outside the package or is not written plainly";
export const SAME_NAME = "has the same name as another file when letter case is ignored";
export const TOO_MANY = "holds more than 2,000 files";
export const GIT_FOLDER = "is inside a .git folder: a package for a pack cannot bring a repository of its own";
export const FILE_AND_FOLDER = "is both a file and a folder in the package";

/** The sentence for a file or package over a cap, sized in MiB at or above 1 MiB and in KiB below it. */
export function over(what: string, bytes: number): string {
  const size = bytes >= 2 ** 20 ? `${bytes / 2 ** 20} MiB` : `${bytes / 2 ** 10} KiB`;
  return `is larger than the ${size} allowed for ${what}`;
}

const PREFIX = "package/";
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** Files that would change what the project's git keeps or how it reads the kept files, so they are never kept. */
const IGNORED_BY_GIT = [".gitignore", ".gitattributes"];

interface Read {
  type: string;
  path: string;
  body: Buffer;
}

/** Parses the raw tar in memory, collecting each entry's type, path and bytes, or null when it is not a tar or passes a cap. The reader never decompresses: the one gunzip above is the only expansion, and is the one that is capped. */
async function parseTar(raw: Buffer): Promise<Read[] | "too-many" | "too-big" | null> {
  let capped: "too-many" | "too-big" | null = null;
  const entries: Read[] = [];
  let held = 0;
  const stop = (why: "too-many" | "too-big"): void => {
    capped = why;
    parser.abort(new Error(why));
  };
  const parser = new Parser({
    strict: true,
    gzip: false,
    brotli: false,
    zstd: false,
    onReadEntry(entry: ReadEntry) {
      const chunks: Buffer[] = [];
      entry.on("data", (chunk: Buffer) => {
        held += chunk.length;
        if (held > ARCHIVE_CAPS.expanded) return stop("too-big");
        chunks.push(chunk);
      });
      entry.on("end", () => {
        entries.push({ type: entry.type ?? "", path: entry.path, body: Buffer.concat(chunks) });
        if (entries.length > ARCHIVE_CAPS.entries) stop("too-many");
      });
    },
  });
  return new Promise((resolve) => {
    parser.on("error", () => resolve(capped));
    parser.on("end", () => resolve(entries));
    parser.end(raw);
  });
}

/** The pack folder a delivery-pack field names, normalised, or null when it is not a plain folder inside the package. */
function packFolderOf(field: string): string | null {
  const folder = field.replace(/^\.\//, "").replace(/\/$/, "");
  if (folder === "" || folder === ".") return ".";
  if (folder.startsWith("/") || folder.split("/").includes("..") || folder.includes("\\")) return null;
  return folder;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" ? value.length > 0 : isObject(value) && Object.keys(value).length > 0;
}

/** Reads a package's tarball in memory and keeps only the pack folder its package.json names. Nothing touches the filesystem. */
export async function readPackage(tarball: Uint8Array): Promise<PackageRead> {
  const fail = (entry: string | null, message: string): PackageRead => ({ ok: false, problem: { entry, message } });
  if (tarball.length > ARCHIVE_CAPS.compressed) return fail(null, over("a package", ARCHIVE_CAPS.compressed));

  let raw: Buffer;
  try {
    raw = gunzipSync(tarball, { maxOutputLength: ARCHIVE_CAPS.expanded });
  } catch (err) {
    if (err instanceof RangeError) return fail(null, over("a package once expanded", ARCHIVE_CAPS.expanded));
    return fail(null, NOT_AN_ARCHIVE);
  }
  // A tar never starts with a compression header; one that does would be expanded again by the reader, past the cap.
  if (raw.subarray(0, 2).equals(GZIP_MAGIC) || raw.subarray(0, 4).equals(ZSTD_MAGIC)) return fail(null, NOT_AN_ARCHIVE);
  const parsed = await parseTar(raw);
  if (parsed === "too-many") return fail(null, TOO_MANY);
  if (parsed === "too-big") return fail(null, over("a package once expanded", ARCHIVE_CAPS.expanded));
  if (parsed === null) return fail(null, NOT_AN_ARCHIVE);

  interface Accepted {
    name: string;
    rel: string;
    type: string;
    body: Buffer;
  }
  const accepted: Accepted[] = [];
  const keys = new Set<string>();
  const files = new Set<string>();
  const folders = new Set<string>();

  for (const [index, entry] of parsed.entries()) {
    if (index >= ARCHIVE_CAPS.entries) return fail(null, TOO_MANY);
    const inside = entry.path.startsWith(PREFIX);
    const name = inside ? entry.path.slice(PREFIX.length) : entry.path;
    if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") return fail(name, NOT_PLAIN_ENTRY);

    const rel = entry.type === "Directory" && name.endsWith("/") ? name.slice(0, -1) : name;
    if (entry.type === "Directory" && rel === "") continue;
    const badPath =
      !inside ||
      rel.split("/").includes("..") ||
      /[\\\0]/.test(rel) ||
      /^[A-Za-z]:/.test(rel) ||
      rel.startsWith("/") ||
      posix.normalize(rel) !== rel;
    if (badPath) return fail(name, BAD_PATH);

    const key = rel.normalize("NFC").toLowerCase();
    if (keys.has(key)) return fail(name, SAME_NAME);
    keys.add(key);

    const parts = key.split("/");
    if (parts.some((part) => part === ".git")) return fail(name, GIT_FOLDER);

    const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
    if (ancestors.some((ancestor) => files.has(ancestor))) return fail(name, FILE_AND_FOLDER);
    if (entry.type !== "Directory") {
      if (folders.has(key)) return fail(name, FILE_AND_FOLDER);
      files.add(key);
    } else {
      folders.add(key);
    }
    for (const ancestor of ancestors) folders.add(ancestor);

    accepted.push({ name, rel, type: entry.type, body: entry.body });
  }

  const plainFiles = accepted.filter((entry) => entry.type !== "Directory");
  const manifest = plainFiles.find((entry) => entry.rel === "package.json");
  if (manifest === undefined) return fail(null, NOT_AN_ARCHIVE);
  if (manifest.body.length > ARCHIVE_CAPS.packageJson) return fail("package.json", over("package.json", ARCHIVE_CAPS.packageJson));
  let pkg: unknown;
  try {
    pkg = JSON.parse(manifest.body.toString("utf-8"));
  } catch {
    return fail("package.json", NOT_AN_ARCHIVE);
  }
  if (!isObject(pkg)) return fail("package.json", NOT_AN_ARCHIVE);

  const field = pkg["delivery-pack"];
  if (typeof field !== "string") return fail(null, NO_PACK_FIELD);
  const folder = packFolderOf(field);
  if (folder === null) return fail(null, BAD_PACK_FIELD);
  const prefix = folder === "." ? "" : `${folder}/`;
  if (!plainFiles.some((entry) => entry.rel === `${prefix}pack.json`)) return fail(null, noPackThere(field));

  const packFiles: PackageFile[] = [];
  const ignored: { path: string; bytes: number }[] = [];
  for (const entry of plainFiles) {
    const inPack = entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : undefined;
    const basename = (inPack ?? "").split("/").at(-1)?.toLowerCase() ?? "";
    if (inPack === undefined || entry.name === "package.json" || IGNORED_BY_GIT.includes(basename)) {
      ignored.push({ path: entry.name, bytes: entry.body.length });
      continue;
    }
    if (entry.body.length > ARCHIVE_CAPS.keptFile) return fail(entry.name, over("one file", ARCHIVE_CAPS.keptFile));
    packFiles.push({ path: inPack, bytes: entry.body });
  }

  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  packFiles.sort(byPath);
  ignored.sort(byPath);
  const declares = (["scripts", "bin", "dependencies"] as const).filter((key) => nonEmpty(pkg[key]));
  return { ok: true, packPath: folder, packFiles, ignored, declares };
}
