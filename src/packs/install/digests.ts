import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promptsOf, type Pack } from "../manifest.js";

/** The files a pack's fingerprint covers: its manifest, then each prompt it names, sorted. */
export const fingerprintedFiles = (pack: Pack): string[] => ["pack.json", ...promptsOf(pack.manifest)].sort();

/** The lowercase hex SHA-256 of each file's raw bytes, keyed by its path from `dir`. */
export async function fileDigests(dir: string, paths: readonly string[]): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const path of paths) {
    digests[path] = createHash("sha256").update(await readFile(join(dir, path))).digest("hex");
  }
  return digests;
}

/** The paths present on one side only, or with differing digests, sorted. */
export function changedFiles(recorded: Readonly<Record<string, string>>, now: Readonly<Record<string, string>>): string[] {
  const paths = new Set([...Object.keys(recorded), ...Object.keys(now)]);
  return [...paths].filter((path) => recorded[path] !== now[path]).sort();
}
