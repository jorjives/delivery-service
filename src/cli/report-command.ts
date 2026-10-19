import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import type { ParkedItem, ReportAfter, ReportDelivery, ReportDocument } from "../report/document.js";
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
import { loadConfig } from "./config.js";
import { runShell } from "../shell.js";
import { deliveryLedgerPath, foldDelivery, readDeliveryEntries } from "../delivery-ledger.js";
import { git } from "../git-exec.js";
import { ledgerPath, parkedItems, readItemLedger, type ItemState } from "../item-ledger.js";
import { afterLedgerPath, isPending, readAfter } from "../after-ledger.js";

/** An item the ledger has set aside, as the report carries it. */
export const parkedOf = (state: ItemState): ParkedItem => ({
  item: state.key,
  intent: state.intent,
  reason: state.parked ?? "escalated",
  question: state.question,
  attempts: state.attempts,
  lastRun: state.lastRunId,
});

/** The items this machine's ledger has set aside, as a report carries them. */
export async function parkedIn(repoPath: string, env: NodeJS.ProcessEnv): Promise<ParkedItem[]> {
  return parkedItems(await readItemLedger(ledgerPath(repoPath, env))).map(parkedOf);
}

/** The after-landing batches a report shows: every one still waiting on a step, then the latest, oldest first. */
export async function afterIn(repoPath: string, env: NodeJS.ProcessEnv): Promise<ReportAfter[]> {
  const states = await readAfter(afterLedgerPath(ledgerPath(repoPath, env)));
  const latest = states.at(-1);
  const shown = states.filter((s) => isPending(s) || s === latest);
  return shown.map(({ batch, steps }) => ({
    batch: batch.batch, branch: batch.branch, commit: batch.commit, at: batch.at, landed: batch.landed,
    steps: batch.steps.map((planned, index) => ({ for: planned.for, label: planned.label, status: steps[index]?.status ?? "pending", detail: steps[index]?.detail ?? null, at: steps[index]?.at ?? null })),
  }));
}

/** The delivery branch this machine's runs last opened, as a report carries it; null when none was ever opened. */
export async function deliveryIn(repoPath: string, env: NodeJS.ProcessEnv): Promise<ReportDelivery | null> {
  const entries = await readDeliveryEntries(deliveryLedgerPath(ledgerPath(repoPath, env)));
  const opened = entries.findLast((e) => e.t === "opened");
  if (opened?.t !== "opened") return null;
  const state = foldDelivery(entries, opened.branch);
  const tip = await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${opened.branch}`]).catch(() => null);
  return {
    branch: opened.branch,
    base: opened.base,
    openedAt: opened.at,
    tip,
    landed: state.landed.map((e) => ({ run: e.runId, item: e.key, intent: e.intent, commit: e.commit, at: e.at })),
    closer: state.closer,
    blocked: state.blocked === null ? null : { reason: state.blocked.reason, at: state.blocked.at },
  };
}

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
 * Read the report on `named`, or with none on the project's task list, falling back to the most recent run where the
 * project has no list. The one reading behind what `delivery report` prints, as text or as data, and what is saved.
 */
export async function readReport(repoPath: string, named: ReportSubject | undefined, list: TaskDef[], { env }: { env: NodeJS.ProcessEnv }): Promise<Report> {
  const snapshot = await loadSnapshot(repoPath, named ?? { kind: "list" }, { live: await repoLocked(repoPath), list });
  const recent = named === undefined && list.length === 0 ? mostRecentSubject(snapshot) : undefined;
  const doc = { ...deriveReport(recent ? { ...snapshot, subject: recent } : snapshot), parked: await parkedIn(repoPath, env), delivery: await deliveryIn(repoPath, env), after: await afterIn(repoPath, env) };
  return {
    doc,
    empty: holdsNoRun(snapshot),
    lines: (options) => [...(recent ? [NO_TASK_LIST] : []), ...renderText(doc, options)],
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
  const report = await readReport(repoPath, runId === undefined ? undefined : namedSubject(repoPath, runId), list, { env: ctx.env });
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
 * own outcome and exit code stand. The project's `notify` command is run with the
 * report whenever it could be read, even when there is nothing to say in words or
 * the copy on disk could not be saved.
 */
export async function closingReport(repoPath: string, subject: ReportSubject, list: TaskDef[], ctx: CommandContext, notify?: string): Promise<void> {
  let report: Report;
  try {
    report = await readReport(repoPath, subject, list, { env: ctx.env });
  } catch (err) {
    ctx.report.note(notSaved(err));
    return;
  }
  // The operator hears about every run, however it ended, even one with nothing to tell in words (spec §5.7).
  if (!report.empty) {
    try {
      ctx.report.note(closingSentence(report.doc));
      ctx.report.note(reportPointer(report.doc));
      await saveReport(repoPath, report.doc, report.lines({ colour: false, saved: SAVED_TO }));
    } catch (err) {
      ctx.report.note(notSaved(err));
    }
  }
  if (notify !== undefined) await notifyWith(notify, report.doc, repoPath, ctx);
}

export const notifyFailed = (detail: string): string => `Your notify command did not work: ${detail}. The run itself is unaffected.`;

const NOTIFY_TIMEOUT_MS = 60_000;

/** Hand the report to the operator's own command. Never changes how the run ends. */
async function notifyWith(command: string, doc: ReportDocument, repoPath: string, ctx: CommandContext): Promise<void> {
  try {
    const result = await runShell(command, [], { cwd: repoPath, timeoutMs: NOTIFY_TIMEOUT_MS, env: ctx.env, input: JSON.stringify(doc) });
    if (result.exitCode !== 0) ctx.report.note(notifyFailed(result.stderr.trim() || `it exited with code ${result.exitCode}`));
  } catch (err) {
    ctx.report.note(notifyFailed((err as Error).message));
  }
}

/**
 * The project's `notify` command, read from its config the way `listTasks` reads the list; a configuration that cannot
 * be found means none, as it means no list.
 */
export async function projectNotify(startDir: string, repoPath: string, ctx: CommandContext): Promise<string | undefined> {
  try {
    return (await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env })).notify;
  } catch (err) {
    if (err instanceof Refusal) return undefined;
    throw err;
  }
}
