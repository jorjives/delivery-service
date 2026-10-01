import type { CaseFile } from "./schema.js";

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
