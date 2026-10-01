import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "./case-file.js";
import { CorruptCaseFile, FileNotFound } from "./errors.js";
import { runsRoot } from "./run-location.js";
import { CaseJson, type CaseFile, type TaskDef } from "./schema.js";

/** One run's record, read back from the repository: everything a command needs to report on it or pick it up. */
export interface RunRecord {
  runId: string;
  repoPath: string;
  dir: string;
  caseFile: CaseFile;
}

/**
 * The UTC instant a run started, which its id already carries
 * (`src/run-location.ts`), as a timestamp a script can parse. `null` for an
 * id that carries no stamp, rather than a made-up time.
 */
export function startedInstant(runId: string): string | null {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/**
 * Newest first, by the second each item's run id carries rather than by when
 * its record was last written: a list is a history, so resuming an old run
 * today does not make it the newest. A run id with no stamp sorts last, and
 * the sort is stable, so runs that started in the same second keep the order
 * they came in.
 */
export function newestFirstBy<T>(items: T[], runIdOf: (item: T) => string): T[] {
  const startedOf = (item: T): string => startedInstant(runIdOf(item)) ?? "";
  return [...items].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
}

/** Newest first, by the second each run id carries. See `newestFirstBy`. */
export function newestFirst(records: RunRecord[]): RunRecord[] {
  return newestFirstBy(records, (record) => record.runId);
}

/** A run whose record cannot be read back: which of its files is at fault, and the task it was for when its header still reads. */
export interface DamagedRun {
  runId: string;
  dir: string;
  file: "case.json" | "log.jsonl";
  taskDef?: TaskDef;
  /** The error reading it raised, for a caller that stops on damage rather than reporting around it. */
  error: CorruptCaseFile;
}

/** Which file of a damaged record is at fault. Its header still reads when only the log is damaged, and that names the task. */
async function whatIsDamaged(dir: string): Promise<Pick<DamagedRun, "file" | "taskDef">> {
  try {
    const { header } = CaseJson.parse(JSON.parse(await readFile(join(dir, "case.json"), "utf-8")));
    return { file: "log.jsonl", taskDef: header.taskDef };
  } catch {
    return { file: "case.json" };
  }
}

/**
 * Every run this repository is holding, in run id order, with the ones whose
 * record cannot be read back set aside rather than thrown: one damaged record
 * must not hide the others from a reader. A folder with no record in it was
 * never a run (the process died between making the folder and writing the case
 * file), so it is passed over.
 */
export async function readRunRecords(repoPath: string): Promise<{ records: RunRecord[]; damaged: DamagedRun[] }> {
  let runIds: string[];
  try {
    runIds = (await readdir(runsRoot(repoPath), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { records: [], damaged: [] }; // nothing has ever run here
  }

  const read = await Promise.all(
    runIds.map(async (runId): Promise<RunRecord | DamagedRun | undefined> => {
      const dir = join(runsRoot(repoPath), runId);
      try {
        return { runId, repoPath, dir, caseFile: await load(dir) };
      } catch (err) {
        if (err instanceof FileNotFound) return undefined;
        if (!(err instanceof CorruptCaseFile)) throw err;
        return { runId, dir, error: err, ...(await whatIsDamaged(dir)) };
      }
    }),
  );
  return {
    records: read.filter((run): run is RunRecord => run !== undefined && "caseFile" in run),
    damaged: read.filter((run): run is DamagedRun => run !== undefined && "error" in run),
  };
}
