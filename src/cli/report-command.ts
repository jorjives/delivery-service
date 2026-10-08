import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import type { ReportDocument } from "../report/document.js";
import { publishedSchema } from "../report/json-schema.js";
import { holdsNoRun, loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { closingSentence, NO_RUNS_YET, NO_TASK_LIST, renderText, reportPointer } from "../report/text.js";
import { supervisedPlace } from "../run-location.js";
import type { TaskDef } from "../schema.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { repoLocked } from "../repo-lock.js";
import { isSaved, notSaved, SAVED_TO, saveReport } from "./saved-report.js";
import { listTasks } from "./status-command.js";
import { findConfig } from "./config.js";
import { deriveFindings, fixRunsOf } from "../packs/fix-state.js";
import { readLedger } from "../packs/ledger.js";
import { reviewOfPlan, uncheckable, type SavedReview } from "../packs/review-record.js";
import { reviewPart } from "../packs/review-report.js";

/** What `delivery report` was given on the command line besides the run id. */
export interface ReportOptions {
  repo?: string;
  write?: boolean;
  /** Print the published schema of both data formats instead of a report. */
  schema?: boolean;
}

export const SCHEMA_AND_REPORT = "Use `--schema` on its own: it prints the schema of the data, not a report, so it takes no run id and saves nothing.";

/** A report read from the records: the document, and the lines it is told in. */
export interface Report {
  doc: ReportDocument;
  /** Whether the folder holds no run at all: the document then says every task is still to start, and there is nothing to tell in words. */
  empty: boolean;
  /** The report as text. `saved` is the sentence about its copy on disk, when there is one to say. */
  lines(options: { colour: boolean; saved?: string }): string[];
}

/** What an id names: a run of several tasks at once keeps a record of its own; any other id names one task's run. */
export function namedSubject(repoPath: string, runId: string): ReportSubject {
  return existsSync(join(supervisedPlace(repoPath, runId), "run.json")) ? { kind: "run", runId } : { kind: "task", runId };
}

/**
 * The review whose plan is the task list a report is on, when it is one. Looked up the way `listTasks` finds the list,
 * so the two agree; a configuration that cannot be found means no review, as it means no list.
 */
async function listReview(startDir: string, repoPath: string, ctx: CommandContext): Promise<SavedReview | undefined> {
  try {
    const file = findConfig({ startDir, repoPath, flag: undefined, env: ctx.env, orPlan: true });
    return file === undefined ? undefined : await reviewOfPlan(repoPath, file);
  } catch (err) {
    if (err instanceof Refusal) return undefined;
    throw err;
  }
}

/**
 * Read the report on `named`, or with none on the project's task list, falling back to the most recent run where the
 * project has no list. When the list is `review`'s plan, it is told by the review's problems, read from the same
 * snapshot, so the two cannot differ. The one reading behind what `delivery report` prints, as text or as data, and
 * what is saved.
 */
export async function readReport(repoPath: string, named: ReportSubject | undefined, list: TaskDef[], review?: SavedReview): Promise<Report> {
  const snapshot = await loadSnapshot(repoPath, named ?? { kind: "list" }, { live: await repoLocked(repoPath), list });
  const told = named === undefined ? review : undefined;
  // A review's plan is told by its problems even when no fix is left to run, never swapped for the most recent run.
  const recent = named === undefined && list.length === 0 && told === undefined ? mostRecentSubject(snapshot) : undefined;
  const doc = deriveReport(recent ? { ...snapshot, subject: recent } : snapshot);
  const states = told === undefined ? undefined : deriveFindings(told.result.findings, await readLedger(told.dir), fixRunsOf(snapshot, doc), (finding) => uncheckable(told.header, finding));
  return {
    doc,
    empty: told === undefined && holdsNoRun(snapshot),
    lines: (options) => [
      ...(recent ? [NO_TASK_LIST] : []),
      ...renderText(doc, { ...options, ...(told !== undefined && states !== undefined ? { review: reviewPart(told, states, options.colour) } : {}) }),
    ],
  };
}

/**
 * `delivery report`: what happened and what to do about it, in the owner's
 * words. With no id, the project's task list, told by its problems when the list is a review's plan; with one, that task or that run
 * of several tasks; and where the project has no list, its most recent run.
 * It reads the records and nothing else, takes no lock and changes no run, so
 * it is safe while a run is going. The exit code says whether a report could
 * be made, never what the report says.
 *
 * `--write` also saves the report as the fixed pair a run leaves when it ends.
 * A report that cannot be saved is still printed, with one line saying so.
 */
export async function reportCommand(runId: string | undefined, options: ReportOptions, ctx: CommandContext): Promise<ExitCode> {
  // Before the repository is looked for: the schema is the same wherever it is asked for.
  if (options.schema) {
    if (runId !== undefined || options.write) {
      throw new Refusal(SCHEMA_AND_REPORT, EXIT.configuration);
    }
    ctx.writeLine(JSON.stringify(publishedSchema(), null, 2));
    return EXIT.ok;
  }
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const list = await listTasks(startDir, repoPath, ctx);
  const review = runId === undefined ? await listReview(startDir, repoPath, ctx) : undefined;
  const report = await readReport(repoPath, runId === undefined ? undefined : namedSubject(repoPath, runId), list, review);
  // The saved text names itself, so what is on disk is what is printed, line for line.
  const asSaved = report.lines({ colour: false, saved: SAVED_TO });

  if (ctx.json) {
    // The document and nothing else, exactly as it is saved: anything said about saving it goes beside the data, not in it.
    if (options.write) await saveReport(repoPath, report.doc, asSaved).catch((err: unknown) => ctx.report.note(notSaved(err)));
    ctx.writeLine(JSON.stringify(report.doc, null, 2));
    return EXIT.ok;
  }
  if (report.empty) {
    for (const line of [NO_RUNS_YET, "", "Next: delivery run"]) ctx.writeLine(line);
    return EXIT.ok;
  }

  const saved = options.write
    ? await saveReport(repoPath, report.doc, asSaved).then(() => SAVED_TO, notSaved)
    : (await isSaved(repoPath, asSaved))
      ? SAVED_TO
      : undefined;
  for (const line of report.lines({ colour: ctx.colour, saved })) ctx.writeLine(line);
  return EXIT.ok;
}

/**
 * What `delivery run` and `delivery resume` end with: the report's opening
 * counts in one sentence, where to read the rest, and the report itself saved
 * as the fixed pair for whoever was not there. It never changes how the command
 * ends: a report that cannot be read or saved is said in one line, and the run's
 * own outcome and exit code stand.
 */
export async function closingReport(repoPath: string, subject: ReportSubject, list: TaskDef[], ctx: CommandContext): Promise<void> {
  try {
    const report = await readReport(repoPath, subject, list);
    if (report.empty) return;
    ctx.report.note(closingSentence(report.doc));
    ctx.report.note(reportPointer(report.doc));
    await saveReport(repoPath, report.doc, report.lines({ colour: false, saved: SAVED_TO }));
  } catch (err) {
    ctx.report.note(notSaved(err));
  }
}
