import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Many tests make scratch folders and some never remove them (the suite once filled a
// disk with them). Instead of trusting every test and every child process to clean up,
// each run gets one private folder, made the process-wide temp location through TMPDIR.
// Workers and their children inherit it, so everything they make lands inside it, and
// the teardown removes the lot. A run that is killed cannot tear down, so the next run
// sweeps the folders of runs whose process has gone.

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
    if (!name.startsWith(RUN_DIR_PREFIX)) continue;
    const pid = Number(name.slice(RUN_DIR_PREFIX.length).split("-")[0]);
    if (Number.isInteger(pid) && !isAlive(pid)) rmSync(join(root, name), { recursive: true, force: true });
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
