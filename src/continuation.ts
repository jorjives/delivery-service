import { existsSync } from "node:fs";
import { join } from "node:path";
import { branchTip, ensureCommitted, git } from "./git-exec.js";
import { branchName } from "./provision.js";
import { runPlace } from "./run-location.js";
import type { RunRecord } from "./run-records.js";
import type { Continues, PinnedWorkflow } from "./schema.js";
import { lastWorkerSession, worktreeOf } from "./surface.js";
import { stepIndexOf, stepView } from "./workflow-step.js";

/** Whether the copy sits on `commit` with nothing uncommitted. */
async function copyIsCleanAt(worktreePath: string, commit: string): Promise<boolean> {
  return (await git(worktreePath, ["rev-parse", "HEAD"])) === commit && (await git(worktreePath, ["status", "--porcelain"])) === "";
}

/**
 * What a new run needs to carry on `record`'s work (spec §5.11): the same working copy, so its last worker session
 * can be resumed; the same work, from its branch tip once anything left uncommitted in that copy (a closer that did
 * not tear down, a teardown that failed) is committed onto it, else its start; judged from where its current step
 * started against that step's baseline. Committing first is idempotent, so a claim made twice adds nothing.
 * A signed-off turn covers only the commit that was reviewed: `held` is that commit, and the sign-off stands only while
 * the branch tip and the copy's `HEAD` are it and the copy is clean. Otherwise the work is not what was reviewed, so it carries on as an
 * interrupted run's would, and is checked and held again. A signed-off turn never commits the copy first.
 * ponytail: the remaining steps are numbered from 1 in the new run; pin an offset in `continues` if step numbers must match.
 */
export async function prepareContinuation(
  record: RunRecord,
  asked: Continues["turn"],
  env: NodeJS.ProcessEnv,
  held?: string | null,
): Promise<{ continues: Continues; workflow?: PinnedWorkflow } | undefined> {
  const view = stepView(record.caseFile);
  const startCommit = view.header.startCommit;
  if (startCommit === undefined) return undefined;
  const worktreePath = worktreeOf(record.caseFile, runPlace(record.repoPath, record.runId, env).location);
  const branch = branchName(record.caseFile.header.surfaceId);
  const copyExists = existsSync(join(worktreePath, ".git"));
  const tip = await branchTip(record.repoPath, branch);
  const reviewed = asked.kind === "signed_off" && held === tip && tip !== undefined && (!copyExists || (await copyIsCleanAt(worktreePath, tip)));
  const turn: Continues["turn"] = asked.kind === "signed_off" && !reviewed ? { kind: "interrupted" } : asked;
  if (copyExists && !reviewed) await ensureCommitted(worktreePath, `Unfinished work from ${branch}, carried on by the next run`);
  // Committing the copy can move the tip; a reviewed sign-off commits nothing, so its tip stands.
  const from = reviewed ? tip : ((await branchTip(record.repoPath, branch)) ?? startCommit);
  const sessionId = lastWorkerSession(view.history);
  const workflow = record.caseFile.header.workflow;
  const remaining = workflow === undefined ? undefined : { ...workflow, steps: workflow.steps.slice(stepIndexOf(record.caseFile) - 1) };
  return {
    continues: { runId: record.runId, worktreePath, from, startCommit, baseline: view.header.baseline, ...(sessionId === undefined ? {} : { sessionId }), turn },
    ...(remaining === undefined ? {} : { workflow: remaining }),
  };
}
