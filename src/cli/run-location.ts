import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { SurfaceLocation } from "../ports.js";

/** How many words of the task name a run. Enough to tell runs apart at a glance. */
const SLUG_WORDS = 5;

/** A UTC second as the ids carry it: 2026-09-14T21:03:09Z becomes 20260914T210309Z. */
function stampOf(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/**
 * A run's id, which is also its surface id and so its branch name: the first
 * words of the task, so a person can tell runs apart, then the UTC second it
 * started, so re-running a finished task starts a new run instead of reopening
 * the old one. Two tasks sharing their first words can start in the same second
 * when several run at once, so an id in `taken` is passed over for the next
 * numbered one, with the stamp kept last where every reader expects it.
 */
export function runIdFor(intent: string, now: Date, taken: ReadonlySet<string> = new Set()): string {
  const slug =
    intent
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, SLUG_WORDS)
      .join("-") || "run";
  const stamp = stampOf(now);
  for (let n = 1; ; n++) {
    const id = n === 1 ? `${slug}-${stamp}` : `${slug}-${n}-${stamp}`;
    if (!taken.has(id)) return id;
  }
}

/** A run of several tasks at once: its own id, told apart from every task's id by what it is and when it started. */
export function supervisedRunId(now: Date): string {
  return `run-${stampOf(now)}`;
}

/** Where the runs of several tasks at once keep their records: beside the tasks' records, so reading them never meets these. */
export function supervisedRoot(repoPath: string): string {
  return join(repoPath, ".delivery", "supervised");
}

/** Where a run of several tasks at once keeps its own record. */
export function supervisedPlace(repoPath: string, runId: string): string {
  return join(supervisedRoot(repoPath), runId);
}

/** The lock a run of several tasks at once holds on its repository for as long as it runs. Repository-wide, because it guards the repository, not one run. */
export function supervisorLockPath(repoPath: string): string {
  return join(repoPath, ".delivery", "supervisor.lock");
}

/** Make `.delivery/`, and make it ignore itself, so nothing the harness keeps there ever shows in `git status`. The repository's own `.gitignore` is never touched. */
export async function prepareDeliveryDir(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, ".delivery"), { recursive: true });
  await writeFile(join(repoPath, ".delivery", ".gitignore"), "*\n");
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
 * Create the run's empty record folder inside the self-ignoring `.delivery/`,
 * so starting a run leaves `git status` exactly as it was. Fails if the folder
 * already exists, rather than write over another run's record.
 */
export async function prepareRunDir(repoPath: string, dir: string): Promise<void> {
  await prepareDeliveryDir(repoPath);
  await mkdir(dirname(dir), { recursive: true });
  await mkdir(dir);
}
