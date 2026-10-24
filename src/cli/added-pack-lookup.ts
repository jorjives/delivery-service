import { readLock, type LockEntry } from "../packs/install/lock.js";
import type { CommandContext } from "./context.js";
import { notAddedLines } from "./installed-render.js";
import { findRepository } from "./project.js";

/** The repository and the record's entry for the added pack `name`; when the record has none, the lines that say so. Writes nothing. */
export async function addedPackNamed(
  name: string,
  ctx: CommandContext,
): Promise<{ found: true; repoPath: string; entry: LockEntry } | { found: false; lines: string[] }> {
  const repoPath = await findRepository(ctx.cwd);
  const lock = await readLock(repoPath);
  const entry = lock.packs[name];
  if (entry === undefined) return { found: false, lines: notAddedLines(name, Object.keys(lock.packs)) };
  return { found: true, repoPath, entry };
}
