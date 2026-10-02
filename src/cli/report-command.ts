import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import type { ReportDocument } from "../report/document.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { NO_RUNS_YET, NO_TASK_LIST, renderText } from "../report/text.js";
import { supervisedPlace } from "../run-location.js";
import type { TaskDef } from "../schema.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { repoLocked } from "./repo-lock.js";
import { isSaved, notSaved, SAVED_TO, saveReport } from "./saved-report.js";
import { listTasks } from "./status-command.js";

/** What `delivery report` was given on the command line besides the run id. */
export interface ReportOptions {
  repo?: string;
  write?: boolean;
}

/** A report read from the records: the document, and the lines it is told in. */
export interface Report {
  doc: ReportDocument;
  /** The report as text. `saved` is the sentence about its copy on disk, when there is one to say. */
  lines(options: { colour: boolean; saved?: string }): string[];
}

/** What an id names: a run of several tasks at once keeps a record of its own; any other id names one task's run. */
export function namedSubject(repoPath: string, runId: string): ReportSubject {
  return existsSync(join(supervisedPlace(repoPath, runId), "run.json")) ? { kind: "run", runId } : { kind: "task", runId };
}

export const NO_REPORT_DATA_YET = "`delivery report` prints its report as text only for now. Run it without `--json`.";

/**
 * Read the report on `named`, or with none on the project's task list, falling
 * back to the most recent run where the project has no list. Nothing when the
 * folder holds no run at all: there is nothing to report. The one reading
 * behind what `delivery report` prints and what is saved, so the two cannot differ.
 */
export async function readReport(repoPath: string, named: ReportSubject | undefined, list: TaskDef[]): Promise<Report | undefined> {
  const snapshot = await loadSnapshot(repoPath, named ?? { kind: "list" }, { live: await repoLocked(repoPath), list });
  if (snapshot.records.length + snapshot.runs.length + snapshot.damaged.length === 0) return undefined;
  const recent = named === undefined && list.length === 0 ? mostRecentSubject(snapshot) : undefined;
  const doc = deriveReport(recent ? { ...snapshot, subject: recent } : snapshot);
  return { doc, lines: (options) => [...(recent ? [NO_TASK_LIST] : []), ...renderText(doc, options)] };
}

/**
 * `delivery report`: what happened and what to do about it, in the owner's
 * words. With no id, the project's task list; with one, that task or that run
 * of several tasks; and where the project has no list, its most recent run.
 * It reads the records and nothing else, takes no lock and changes no run, so
 * it is safe while a run is going. The exit code says whether a report could
 * be made, never what the report says.
 *
 * `--write` also saves the report as the fixed pair a run leaves when it ends.
 * A report that cannot be saved is still printed, with one line saying so.
 */
export async function reportCommand(runId: string | undefined, options: ReportOptions, ctx: CommandContext): Promise<ExitCode> {
  if (ctx.json) throw new Refusal(NO_REPORT_DATA_YET, EXIT.configuration);
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const report = await readReport(repoPath, runId === undefined ? undefined : namedSubject(repoPath, runId), await listTasks(startDir, repoPath, ctx));

  if (report === undefined) {
    for (const line of [NO_RUNS_YET, "", "Next: delivery run"]) ctx.writeLine(line);
    return EXIT.ok;
  }

  // The saved text names itself, so what is on disk is what is printed, line for line.
  const asSaved = report.lines({ colour: false, saved: SAVED_TO });
  const saved = options.write
    ? await saveReport(repoPath, report.doc, asSaved).then(() => SAVED_TO, notSaved)
    : (await isSaved(repoPath, asSaved))
      ? SAVED_TO
      : undefined;
  for (const line of report.lines({ colour: ctx.colour, saved })) ctx.writeLine(line);
  return EXIT.ok;
}
