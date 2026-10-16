import { existsSync } from "node:fs";
import { join } from "node:path";
import { branchExists, ensureCommitted, git } from "./git-exec.js";
import { branchName } from "./provision.js";
import { runPlace } from "./run-location.js";
import type { RunRecord } from "./run-records.js";
import type { Continues, PinnedWorkflow } from "./schema.js";
import { lastWorkerSession, worktreeOf } from "./surface.js";
import { stepIndexOf, stepView } from "./workflow-step.js";

/**
 * What a new run needs to carry on `record`'s work (spec §5.11): the same working copy, so its last worker session
 * can be resumed; the same work, from its branch tip once anything left uncommitted in that copy (a closer that did
 * not tear down, a teardown that failed) is committed onto it, else its start; judged from where its current step
 * started against that step's baseline. Committing first is idempotent, so a claim made twice adds nothing.
 * ponytail: the remaining steps are numbered from 1 in the new run; pin an offset in `continues` if step numbers must match.
 */
export async function prepareContinuation(
  record: RunRecord,
  turn: Continues["turn"],
  env: NodeJS.ProcessEnv,
): Promise<{ continues: Continues; workflow?: PinnedWorkflow } | undefined> {
  const view = stepView(record.caseFile);
  const startCommit = view.header.startCommit;
  if (startCommit === undefined) return undefined;
  const worktreePath = worktreeOf(record.caseFile, runPlace(record.repoPath, record.runId, env).location);
  const branch = branchName(record.caseFile.header.surfaceId);
  if (existsSync(join(worktreePath, ".git"))) await ensureCommitted(worktreePath, `Unfinished work from ${branch}, carried on by the next run`);
  const from = (await branchExists(record.repoPath, branch)) ? await git(record.repoPath, ["rev-parse", branch]) : startCommit;
  const sessionId = lastWorkerSession(view.history);
  const workflow = record.caseFile.header.workflow;
  const remaining = workflow === undefined ? undefined : { name: workflow.name, steps: workflow.steps.slice(stepIndexOf(record.caseFile) - 1) };
  return {
    continues: { runId: record.runId, worktreePath, from, startCommit, baseline: view.header.baseline, ...(sessionId === undefined ? {} : { sessionId }), turn },
    ...(remaining === undefined ? {} : { workflow: remaining }),
  };
}
