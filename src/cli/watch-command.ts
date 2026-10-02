import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { InvalidArgumentError } from "commander";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { NO_RUNS_YET, NO_TASK_LIST } from "../report/text.js";
import { runsRoot, supervisedRoot } from "../run-location.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { namedSubject } from "./report-command.js";
import { repoLocked } from "../repo-lock.js";
import { listTasks, type StatusOptions } from "./status-command.js";
import { emptyStream, livenessUnknown, streamTick, watchTick, type WatchState } from "./watch.js";

/** How often a watch looks at the record when it is not told. */
export const DEFAULT_INTERVAL_SECONDS = 2;

export const INTERVAL_SECONDS = "An interval is a number of seconds above 0, as in `--interval 5`.";

export const INTERVAL_NEEDS_WATCH = "`--interval` says how often `--watch` looks at the record. Use it with `--watch`.";

export const WATCH_AND_ALL = "Use either `--watch` or `--all`, not both: `--watch` follows one run or your task list, and `--all` lists every run.";

export const WATCH_AND_DECISIONS = "Use either `--watch` or `--decisions`, not both: `--watch` follows a run as it happens, and `--decisions` prints one run's triage rounds in full.";

/** `--interval`'s value as a number of seconds, or commander's own refusal naming the option. */
export function intervalSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new InvalidArgumentError(INTERVAL_SECONDS);
  return seconds;
}

/**
 * The size and last-written time of every file a record keeps, as one string:
 * when it has not changed, nothing was recorded since the last look, and the
 * record is not read again. A stat of each file, never a read, and never the
 * operating system's change notifications, which are unreliable on network and
 * container file systems.
 */
export async function signatureOf(repoPath: string): Promise<string> {
  const parts: string[] = [];
  for (const root of [supervisedRoot(repoPath), runsRoot(repoPath)]) {
    const names = await readdir(root).catch(() => [] as string[]);
    for (const name of names.sort()) {
      for (const file of ["run.json", "case.json", "log.jsonl"]) {
        const stats = await stat(join(root, name, file)).catch(() => undefined);
        if (stats) parts.push(`${name}/${file}:${stats.size}:${stats.mtimeMs}`);
      }
    }
  }
  return parts.join("|");
}

/**
 * `delivery status --watch`: follow a run, or the project's task list, as it
 * happens, from any terminal. It only ever reads the record on disk and takes
 * no lock, so it cannot disturb the run, and stopping it (Ctrl-C, which ends
 * it as the platform does) stops nothing else. Lines are only ever added.
 *
 * With no id it follows the task list, as `delivery report` does, or the most
 * recent run when the project has no list; with an id, that task or that run
 * of several tasks. It ends when what it follows ends, with the exit code that
 * run ended with, so a script can wait on it.
 *
 * `wait` is how it passes the time between looks; a test passes its own, to
 * change the record between one look and the next.
 */
export async function watchCommand(
  runId: string | undefined,
  options: StatusOptions,
  ctx: CommandContext,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<ExitCode> {
  if (!options.watch) throw new Refusal(INTERVAL_NEEDS_WATCH, EXIT.configuration);
  if (options.all) throw new Refusal(WATCH_AND_ALL, EXIT.configuration);
  if (options.decisions) throw new Refusal(WATCH_AND_DECISIONS, EXIT.configuration);
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  // ponytail: the list is read once, so a list edited while it is watched is followed as it was; read it each look if that is ever wanted.
  const list = await listTasks(startDir, repoPath, ctx);
  let subject: ReportSubject = runId === undefined ? { kind: "list" } : namedSubject(repoPath, runId);
  let state: WatchState | undefined;
  let seen: string | undefined;

  for (;;) {
    // Whether the run is going first, then its record: a run writes its outcome before it lets the lock go, so a
    // run seen as no longer going has its outcome on disk by the time the record is read.
    const live = await repoLocked(repoPath);
    const signature = `${live}|${await signatureOf(repoPath)}`;
    if (signature !== seen) {
      seen = signature;
      // ponytail: a change to any record re-reads them all. Read only the files whose size or time moved if a
      // repository with thousands of runs makes a look slow.
      let snapshot = await loadSnapshot(repoPath, subject, { live, list });
      const nothingYet = state === undefined && snapshot.records.length + snapshot.runs.length + snapshot.damaged.length === 0;
      if (nothingYet && !live) {
        for (const line of ctx.json ? emptyStream(snapshot) : [NO_RUNS_YET, "", "Next: delivery run"]) ctx.writeLine(line);
        return EXIT.ok;
      }
      // A run of several tasks takes the lock before it records anything: held with nothing recorded, it is starting,
      // so there is nothing to say yet and the next look that finds something written opens the watch.
      if (!nothingYet) {
        const recent = state === undefined && runId === undefined && list.length === 0 ? mostRecentSubject(snapshot) : undefined;
        if (recent) {
          // Said to a person only: a stream names what it follows in its first line.
          if (!ctx.json) ctx.writeLine(NO_TASK_LIST);
          subject = recent;
          snapshot = { ...snapshot, subject };
        }
        const tick = (ctx.json ? streamTick : watchTick)(state, snapshot);
        for (const line of tick.lines) ctx.writeLine(line);
        if (ctx.json) {
          const doc = deriveReport(snapshot);
          if (doc.live === null && tick.exitCode === null && !tick.state.saidUnknown) {
            ctx.report.note(livenessUnknown(doc.kind));
            tick.state.saidUnknown = true;
          }
        }
        state = tick.state;
        if (tick.exitCode !== null) return tick.exitCode;
      }
    }
    await wait((options.interval ?? DEFAULT_INTERVAL_SECONDS) * 1000);
  }
}
