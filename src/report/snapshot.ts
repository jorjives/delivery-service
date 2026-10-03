import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { readRef } from "../case-file.js";
import { CorruptCaseFile, CorruptRunFile, FileNotFound, RunFileNotFound } from "../errors.js";
import { loadRunFile } from "../run-file.js";
import { runsRoot, supervisedPlace, supervisedRoot } from "../run-location.js";
import { readRunRecords, type DamagedRun, type RunRecord } from "../run-records.js";
import type { RunFile, TaskDef } from "../schema.js";

/** What a report is about: the project's task list, one run of several tasks at once, or one task's own run. */
export type ReportSubject = { kind: "list" } | { kind: "run"; runId: string } | { kind: "task"; runId: string };

/** A record that could not be read back, with the file at fault named as the owner would find it: relative to the repository. */
export interface DamagedFile {
  runId: string;
  file: string;
  /** The task the record was for, when its header could still be read. */
  taskDef?: TaskDef;
}

/** What each record wrote beside its log that a report shows, read back: by run id (a task's own, or a run of several at once's), then by ref id. A ref that is missing or unreadable is simply not there. */
export type RecordRefs = Record<string, Record<string, unknown>>;

/** Everything a report is derived from, read once. Plain data: `deriveReport` does no reading of its own. */
export interface RecordSnapshot {
  subject: ReportSubject;
  /** Whether a run of several at once holds the repository right now. */
  live: boolean;
  /** The project's task list as written now; empty when it has none. */
  list: TaskDef[];
  records: RunRecord[];
  runs: RunFile[];
  damaged: DamagedFile[];
  refs: RecordRefs;
}

/** Whether the folder holds no run at all, readable or not. */
export const holdsNoRun = (snapshot: RecordSnapshot): boolean => snapshot.records.length + snapshot.runs.length + snapshot.damaged.length === 0;

/** Every run of several at once this repository holds, and the ones whose record cannot be read back. */
async function readRunFiles(repoPath: string): Promise<{ runs: RunFile[]; damaged: DamagedFile[] }> {
  const root = supervisedRoot(repoPath);
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return { runs: [], damaged: [] }; // no run of several at once has ever started here
  }
  const runs: RunFile[] = [];
  const damaged: DamagedFile[] = [];
  for (const name of names) {
    try {
      runs.push(await loadRunFile(join(root, name)));
    } catch (err) {
      if (err instanceof RunFileNotFound) continue; // a folder with no record in it was never a run
      if (!(err instanceof CorruptRunFile)) throw err;
      damaged.push({ runId: name, file: relative(repoPath, join(root, name)) });
    }
  }
  return { runs, damaged };
}

const asDamagedFile = (repoPath: string, { runId, dir, file, taskDef }: DamagedRun): DamagedFile => ({
  runId,
  file: relative(repoPath, join(dir, file)),
  ...(taskDef ? { taskDef } : {}),
});

/** Each of `ids` read from `dir`'s refs; one that is missing or damaged is left out, and reads "not recorded". */
async function refsIn(dir: string, ids: Iterable<string>): Promise<Record<string, unknown>> {
  const found = await Promise.all(
    [...new Set(ids)].map(async (id): Promise<[string, unknown][]> => {
      try {
        return [[id, await readRef(dir, id)]];
      } catch (err) {
        if (err instanceof FileNotFound || err instanceof CorruptCaseFile) return [];
        throw err;
      }
    }),
  );
  return Object.fromEntries(found.flat());
}

/**
 * What each record wrote beside its log that a report shows: the brief or
 * packet each triage round produced, the packet the task stopped with, and
 * what each repair changed, a task's own in its folder and a run's of the setup
 * in the run's. Read here so that `deriveReport` reads nothing.
 */
async function readRefs(repoPath: string, records: RunRecord[], runs: RunFile[]): Promise<RecordRefs> {
  const ofRecords = records.map(async (record) => {
    const { history, outcome } = record.caseFile;
    const ids = history.flatMap((entry) => (entry.t === "triage" ? [entry.artifactRef] : entry.t === "terminus" && entry.changesRef !== undefined ? [entry.changesRef] : []));
    return [record.runId, await refsIn(record.dir, outcome?.packetRef === undefined ? ids : [...ids, outcome.packetRef])] as const;
  });
  const ofRuns = runs.map(async (run) => {
    const ids = run.history.flatMap((entry) => (entry.t === "repair_terminus" && entry.changesRef !== undefined ? [entry.changesRef] : []));
    return [run.header.runId, await refsIn(supervisedPlace(repoPath, run.header.runId), ids)] as const;
  });
  const read = await Promise.all([...ofRecords, ...ofRuns]);
  return Object.fromEntries(read.filter(([, refs]) => Object.keys(refs).length > 0));
}

/**
 * Read everything a report on `subject` is derived from. The only reading a
 * report does, and it takes no lock, so it is safe while a run is going: the
 * records are replaced whole or appended to, never half-written. A damaged
 * record is set aside and named rather than thrown. A subject that names a
 * run nothing on disk answers for is a failure to answer, and throws the same
 * error a lookup of that id does anywhere else.
 */
export async function loadSnapshot(repoPath: string, subject: ReportSubject, { live, list }: { live: boolean; list: TaskDef[] }): Promise<RecordSnapshot> {
  // A run's own record first, then its tasks': the run's outcome is written last, so a run read as ended
  // never sits beside a task read before it ended (spec, "Reading while a run writes").
  const supervised = await readRunFiles(repoPath);
  const tasks = await readRunRecords(repoPath);
  const damaged = [...tasks.damaged.map((run) => asDamagedFile(repoPath, run)), ...supervised.damaged];
  const known = (runId: string): boolean => damaged.some((file) => file.runId === runId);

  if (subject.kind === "task" && !tasks.records.some((record) => record.runId === subject.runId) && !known(subject.runId)) {
    const dir = join(runsRoot(repoPath), subject.runId);
    throw new FileNotFound(dir, join(dir, "case.json"));
  }
  if (subject.kind === "run" && !supervised.runs.some((run) => run.header.runId === subject.runId) && !known(subject.runId)) {
    const dir = join(supervisedRoot(repoPath), subject.runId);
    throw new RunFileNotFound(dir, join(dir, "run.json"));
  }
  // One task's report renders only that task's rounds, so only its refs are read: `status <task-id>` must not
  // cost a file read per round of every run the repository has ever had (spec, "Read cost").
  // ponytail: a list or a run still reads every record's rounds; narrow those to the records they show if a
  // repository with thousands of runs makes a report slow. Every run's repair refs are read, since a task's report
  // shows a run-wide repair that ran in its copy.
  const rounds = subject.kind === "task" ? tasks.records.filter((record) => record.runId === subject.runId) : tasks.records;
  return { subject, live, list, records: tasks.records, runs: supervised.runs, damaged, refs: await readRefs(repoPath, rounds, supervised.runs) };
}
