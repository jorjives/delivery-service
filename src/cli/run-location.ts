import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { SurfaceLocation } from "../ports.js";

/** How many words of the task name a run. Enough to tell runs apart at a glance. */
const SLUG_WORDS = 5;

/**
 * A run's id, which is also its surface id and so its branch name: the first
 * words of the task, so a person can tell runs apart, then the UTC second it
 * started, so re-running a finished task starts a new run instead of reopening
 * the old one.
 */
export function runIdFor(intent: string, now: Date): string {
  const slug =
    intent
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, SLUG_WORDS)
      .join("-") || "run";
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `${slug}-${stamp}`;
}

/**
 * A single path component naming a repository, from its path: the estate's
 * autoloop target-key rule (drop the leading slash, and anything outside
 * [A-Za-z0-9_.] becomes "-"), so the two tools' state folders read alike.
 */
export function repoKey(repoPath: string): string {
  return repoPath.replace(/^\//, "").replace(/[^A-Za-z0-9_.]/g, "-");
}

/** `$XDG_STATE_HOME`, or `~/.local/state` when it is unset or relative, as the XDG base directory rules say. */
export function stateHome(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_STATE_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
}

/** Where a repository keeps every run's record: inside the repository, so nobody has to remember where it is. */
export function runsRoot(repoPath: string): string {
  return join(repoPath, ".delivery", "runs");
}

export interface RunPlace {
  /** The run's record: inside the repository, so nobody has to remember where it is. */
  dir: string;
  /** The repository, and the run's working copy outside it, where the user's own tools will not pick it up. */
  location: SurfaceLocation;
}

/**
 * Where a run keeps its record and its working copy. Pure: the same repository
 * and run id always give the same places, so a later command can recompute
 * them rather than store them.
 */
export function runPlace(repoPath: string, runId: string, env: NodeJS.ProcessEnv): RunPlace {
  return {
    dir: join(runsRoot(repoPath), runId),
    location: {
      repoPath,
      worktreePath: join(stateHome(env), "delivery-service", "worktrees", repoKey(repoPath), runId),
    },
  };
}

/**
 * Create the run's empty record folder, and make `.delivery/` ignore itself so
 * starting a run leaves `git status` exactly as it was. The repository's own
 * `.gitignore` is never touched. Fails if the folder already exists, rather
 * than write over another run's record.
 */
export async function prepareRunDir(repoPath: string, dir: string): Promise<void> {
  await mkdir(dirname(dir), { recursive: true });
  await writeFile(join(repoPath, ".delivery", ".gitignore"), "*\n");
  await mkdir(dir);
}
