import { readLock, type LockEntry } from "../packs/install/lock.js";
import type { CommandContext } from "./context.js";
import { notAddedLines } from "./installed-render.js";
import { findRepository } from "./project.js";

/** The repository and the record's entry for the added pack `name`; when the record has none, says so and gives undefined. */
export async function addedPackNamed(name: string, ctx: CommandContext): Promise<{ repoPath: string; entry: LockEntry } | undefined> {
  const repoPath = await findRepository(ctx.cwd);
  const lock = await readLock(repoPath);
  const entry = lock.packs[name];
  if (entry === undefined) {
    for (const line of notAddedLines(name, Object.keys(lock.packs))) ctx.writeLine(line);
    return undefined;
  }
  return { repoPath, entry };
}
