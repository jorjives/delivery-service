import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { load } from "../case-file.js";
import { FileNotFound } from "../errors.js";
import type { CaseFile } from "../schema.js";
import { runsRoot } from "./run-location.js";
import { taskIntent } from "./settings.js";

/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
export interface RunRecord {
  runId: string;
  repoPath: string;
  dir: string;
  caseFile: CaseFile;
}

/** One run by its id, finished or not. An id that names nothing raises `FileNotFound`, which the command already renders plainly. */
export async function readRun(repoPath: string, runId: string): Promise<RunRecord> {
  const dir = join(runsRoot(repoPath), runId);
  return { runId, repoPath, dir, caseFile: await load(dir) };
}

/** When a run's record was last written, for "the most recently touched": the cursor and the log are each rewritten as the run moves. */
async function touchedAt(dir: string): Promise<number> {
  const times = await Promise.all(
    ["case.json", "log.jsonl"].map((name) =>
      stat(join(dir, name)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

/**
 * The runs this repository is still holding: a record with no outcome, which is
 * what an interrupted run leaves behind. Most recently touched first, so "the
 * last one" needs no other bookkeeping.
 *
 * A folder with no record in it was never a run (the process died between
 * making the folder and writing the case file), so it is passed over. A record
 * that is there but cannot be read back is the user's to hear about, so it is
 * not swallowed: it stops the command with the message that names the folder.
 */
export async function unfinishedRuns(repoPath: string): Promise<RunRecord[]> {
  let entries;
  try {
    entries = await readdir(runsRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has ever run here
  }

  const found: { record: RunRecord; touchedAt: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let record: RunRecord;
    try {
      record = await readRun(repoPath, entry.name);
    } catch (err) {
      if (err instanceof FileNotFound) continue;
      throw err;
    }
    if (record.caseFile.outcome) continue;
    found.push({ record, touchedAt: await touchedAt(record.dir) });
  }
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

/** The UTC second a run started, which its id already carries (`src/cli/run-location.ts`), as a person reads it. */
export function startedAt(runId: string): string {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return "an unknown time";
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)} UTC`;
}

/** One run on one line: which run, when it started, and what it was asked to do. */
export function describeRun(record: RunRecord): string {
  return `${record.runId}, started ${startedAt(record.runId)}: ${taskIntent(record.caseFile.header.taskDef)}`;
}

/** Why a new task cannot simply start: a run is already under way, and which one, so the user can choose between finishing it and setting it aside. */
export function unfinishedRunFound(record: RunRecord): string {
  return (
    `There's a run that didn't finish (started \`${startedAt(record.runId)}\`, task: \`${taskIntent(record.caseFile.header.taskDef)}\`). ` +
    "Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway."
  );
}
