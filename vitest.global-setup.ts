import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests leak scratch folders (the suite once filled a disk). Each run gets one private
// folder as TMPDIR, which workers and child processes inherit; teardown removes it, and
// the next run sweeps the folders of runs that were killed before they could.

// Short on purpose: some tests print paths and hold their output to 60 columns.
export const RUN_DIR_PREFIX = "dvt-";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Removes run folders under `root` whose owning process no longer exists. */
export function sweepStaleRunDirs(root: string): void {
  for (const name of readdirSync(root)) {
    const owner = new RegExp(`^${RUN_DIR_PREFIX}(\\d+)-`).exec(name);
    if (owner && !isAlive(Number(owner[1]))) rmSync(join(root, name), { recursive: true, force: true });
  }
}

export default function setup(): () => void {
  const root = realpathSync(tmpdir());
  sweepStaleRunDirs(root);
  const runDir = mkdtempSync(join(root, `${RUN_DIR_PREFIX}${process.pid}-`));
  process.env.TMPDIR = runDir;
  return () => {
    rmSync(runDir, { recursive: true, force: true });
  };
}
