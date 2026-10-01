import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveReport, mostRecentSubject } from "../report/derive.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { NO_RUNS_YET, NO_TASK_LIST, renderText } from "../report/text.js";
import { supervisedPlace } from "../run-location.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { repoLocked } from "./repo-lock.js";
import { listTasks } from "./status-command.js";

/** What `delivery report` was given on the command line besides the run id. */
export interface ReportOptions {
  repo?: string;
}

export const NO_REPORT_DATA_YET = "`delivery report` prints its report as text only for now. Run it without `--json`.";

/**
 * `delivery report`: what happened and what to do about it, in the owner's
 * words. With no id, the project's task list; with one, that task or that run
 * of several tasks; and where the project has no list, its most recent run.
 * It reads the records and nothing else, takes no lock and changes nothing, so
 * it is safe while a run is going. The exit code says whether a report could
 * be made, never what the report says.
 */
export async function reportCommand(runId: string | undefined, options: ReportOptions, ctx: CommandContext): Promise<ExitCode> {
  if (ctx.json) throw new Refusal(NO_REPORT_DATA_YET, EXIT.configuration);
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const [list, live] = await Promise.all([listTasks(startDir, repoPath, ctx), repoLocked(repoPath)]);

  // A run of several tasks at once keeps a record of its own; any other id names one task's run.
  const named: ReportSubject | undefined =
    runId === undefined
      ? undefined
      : existsSync(join(supervisedPlace(repoPath, runId), "run.json"))
        ? { kind: "run", runId }
        : { kind: "task", runId };
  const snapshot = await loadSnapshot(repoPath, named ?? { kind: "list" }, { live, list });

  if (snapshot.records.length + snapshot.runs.length + snapshot.damaged.length === 0) {
    for (const line of [NO_RUNS_YET, "", "Next: delivery run"]) ctx.writeLine(line);
    return EXIT.ok;
  }

  const recent = named === undefined && list.length === 0 ? mostRecentSubject(snapshot) : undefined;
  if (recent) ctx.writeLine(NO_TASK_LIST);
  for (const line of renderText(deriveReport(recent ? { ...snapshot, subject: recent } : snapshot), { colour: ctx.colour })) ctx.writeLine(line);
  return EXIT.ok;
}
