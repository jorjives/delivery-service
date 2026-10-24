import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The repository `startDir` is in: the nearest folder up with a `.git` entry (a folder, or a file in a linked working copy). */
export function repoRootOf(startDir: string): string | undefined {
  for (let dir = startDir; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}
