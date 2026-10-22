import { resolve } from "node:path";
import type { CommandContext } from "./context.js";
import { resumeRun } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { holdingRepo } from "./run-exclusion.js";
import type { RunRecord } from "../run-records.js";
import { alreadyFinished, chooseRun, readRun, unfinishedRuns } from "./runs.js";
import { closingReport, projectNotify } from "./report-command.js";
import { listTasks } from "./status-command.js";

/** What `delivery resume` was given on the command line, besides the run id. */
export interface ResumeOptions {
  last?: boolean;
  repo?: string;
}

/** The run this command means when no id was given: the one that didn't finish, the most recent with `--last`, or a question. */
async function discover(repoPath: string, options: ResumeOptions, ctx: CommandContext): Promise<RunRecord> {
  const runs = await unfinishedRuns(repoPath);
  const [mostRecent] = runs;
  if (options.last && mostRecent) return mostRecent;
  return chooseRun(runs, ctx);
}

/**
 * `delivery resume`: the explicit form of what `delivery run` does when it finds
 * a run that didn't finish, for a script or for someone who wants certainty. It
 * never starts a new run, so when there is nothing to pick up it says so rather
 * than quietly doing something else.
 */
export async function resumeCommand(runId: string | undefined, options: ResumeOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);

  // The run to pick up may be one another run is driving right now, so this holds the repository while it carries the run on.
  return holdingRepo(repoPath, {}, ctx, async () => {
    const record = runId === undefined ? await discover(repoPath, options, ctx) : await readRun(repoPath, runId);
    if (record.caseFile.outcome) throw new Refusal(alreadyFinished(record.runId), EXIT.configuration);
    // Read before the agent runs: what the session leaves behind is not to be trusted to name a command.
    const notify = await projectNotify(startDir, repoPath, ctx);
    const exitCode = await resumeRun(record, ctx);
    await closingReport(repoPath, { kind: "task", runId: record.runId }, await listTasks(startDir, repoPath, ctx), ctx, notify);
    return exitCode;
  });
}
