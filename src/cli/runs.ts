import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { load } from "../case-file.js";
import { FileNotFound, RunFileNotFound } from "../errors.js";
import { loadRunFile } from "../run-file.js";
import type { CaseFile, RunFile } from "../schema.js";
import { runsRoot, supervisedRoot, supervisedPlace } from "./run-location.js";
import { taskIntent } from "./settings.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal } from "./failures.js";

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

/**
 * When a record was last written, for "the most recently touched": whichever of
 * its files was rewritten or appended to last. A run of one task keeps
 * `case.json`, a run of several at once `run.json`, and both keep `log.jsonl`;
 * a file a record does not keep counts as never written.
 */
export async function touchedAt(dir: string): Promise<number> {
  const times = await Promise.all(
    ["case.json", "run.json", "log.jsonl"].map((name) =>
      stat(join(dir, name)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

/**
 * Every run this repository is holding, most recently touched first, so "the
 * last one" needs no other bookkeeping.
 *
 * A folder with no record in it was never a run (the process died between
 * making the folder and writing the case file), so it is passed over. A record
 * that is there but cannot be read back is the user's to hear about, so it is
 * not swallowed: it stops the command with the message that names the folder.
 */
export async function allRuns(repoPath: string): Promise<RunRecord[]> {
  let entries;
  try {
    entries = await readdir(runsRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has ever run here
  }

  const read = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) =>
      readRun(repoPath, entry.name).catch((err) => {
        if (err instanceof FileNotFound) return undefined;
        throw err;
      }),
    ),
  );
  const found = await Promise.all(
    read
      .filter((record): record is RunRecord => record !== undefined)
      .map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })),
  );
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

/** The runs this repository is still holding: a record with no outcome, which is what an interrupted run leaves behind. */
export async function unfinishedRuns(repoPath: string): Promise<RunRecord[]> {
  return (await allRuns(repoPath)).filter((record) => !record.caseFile.outcome);
}

/** A run of several tasks at once, read back from the repository: its folder and its record. */
export interface SupervisedRecord {
  dir: string;
  runFile: RunFile;
}

/** A run of several tasks at once by its id, finished or not. An id that names no such run raises `RunFileNotFound`. */
export async function readSupervisedRun(repoPath: string, runId: string): Promise<SupervisedRecord> {
  const dir = supervisedPlace(repoPath, runId);
  return { dir, runFile: await loadRunFile(dir) };
}

/**
 * Every run of several tasks at once this repository holds, finished or not,
 * most recently touched first. A folder with no record in it was never a run
 * and is passed over; a record that cannot be read back stops the command with
 * the message naming its folder.
 */
export async function allSupervisedRuns(repoPath: string): Promise<SupervisedRecord[]> {
  let entries;
  try {
    entries = await readdir(supervisedRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has run several at once here
  }
  const read = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readSupervisedRun(repoPath, entry.name).catch((err: unknown) => {
          if (err instanceof RunFileNotFound) return undefined;
          throw err;
        }),
      ),
  );
  const found = await Promise.all(
    read
      .filter((record): record is SupervisedRecord => record !== undefined)
      .map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })),
  );
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

/**
 * The run of several tasks at once that didn't finish, if there is one: a
 * record with no outcome, which is what a stopped or killed run leaves. The one
 * started most recently, should there be more than one. A folder with no
 * record in it was never a run and is passed over; a record that cannot be
 * read back stops the command with the message naming its folder.
 */
export async function unfinishedSupervisedRun(repoPath: string): Promise<SupervisedRecord | undefined> {
  const unfinished = (await allSupervisedRuns(repoPath)).filter((record) => record.runFile.outcome === undefined);
  return newestFirstBy(unfinished, (record) => record.runFile.header.runId).at(0);
}

/**
 * The UTC instant a run started, which its id already carries
 * (`src/cli/run-location.ts`), as a timestamp a script can parse. `null` for an
 * id that carries no stamp, rather than a made-up time.
 */
export function startedInstant(runId: string): string | null {
  const stamp = /-(\d{8}T\d{6}Z)$/.exec(runId)?.[1];
  if (stamp === undefined) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/** When a run started, as a person reads it. */
export function startedAt(runId: string): string {
  const instant = startedInstant(runId);
  return instant === null ? "an unknown time" : readableUtc(instant);
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

/** An ISO 8601 timestamp as a person reads it: the date, the minute, and the zone it is in. */
export function readableUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
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

export const NOTHING_TO_RESUME =
  'There\'s no run here that didn\'t finish, so there is nothing to pick up. Start one with `delivery run --task "..."`.';

export const NOTHING_HERE =
  'No runs have been started in this repository yet, so there is nothing to report on. Start one with `delivery run --task "..."`.';

export const NOTHING_CHOSEN =
  "That isn't one of the numbers in the list, so I've left every run alone. Run `delivery resume <run-id>` when you know which one you want.";

/** Every run that didn't finish, for a terminal with nobody in front of it to read in its log. */
export function severalRuns(records: RunRecord[]): string {
  return [
    "More than one run didn't finish:",
    ...records.map((record) => `  ${describeRun(record)}`),
    "Say which one to pick up: `delivery resume <run-id>`, or `delivery resume --last` for the one touched most recently.",
  ].join("\n");
}

/** The first line the user types, and nothing else: the answer to one question, not a session. */
async function firstLine(stdin: CommandContext["stdin"]): Promise<string> {
  const lines = createInterface({ input: stdin });
  try {
    for await (const line of lines) return line;
    return "";
  } finally {
    lines.close();
  }
}

/**
 * Which run this command means. One is unambiguous. Several are not, so a
 * person is asked rather than guessed at, and a terminal with nobody in front
 * of it is given the list and stopped: picking one for a script would sooner or
 * later finish the wrong run.
 */
export async function chooseRun(records: RunRecord[], ctx: CommandContext): Promise<RunRecord> {
  const [first] = records;
  if (first === undefined) throw new Refusal(NOTHING_TO_RESUME, EXIT.configuration);
  if (records.length === 1) return first;
  if (ctx.stdin.isTTY !== true) throw new Refusal(severalRuns(records), EXIT.configuration);

  ctx.report.note("More than one run didn't finish. Which one should I pick up?");
  records.forEach((record, index) => ctx.report.note(`  ${index + 1}. ${describeRun(record)}`));
  ctx.report.note("Type its number and press Enter.");
  const chosen = records[Number((await firstLine(ctx.stdin)).trim()) - 1];
  if (chosen === undefined) throw new Refusal(NOTHING_CHOSEN, EXIT.configuration);
  return chosen;
}

/** Why a finished run cannot be picked up: it is done, and reopening it would deliver its work twice. */
export function alreadyFinished(runId: string): string {
  return `The run \`${runId}\` has already finished, so there is nothing to pick up. Start a new one with \`delivery run --task "..."\`.`;
}
