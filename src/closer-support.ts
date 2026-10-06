import { load } from "./case-file.js";
import { ensureCommitted, tryGit } from "./git-exec.js";
import { messageOf } from "./gate-support.js";
import type { CloserPort, CloseContext, CloseOutcome, CloseReport } from "./ports.js";
import type { TaskDef } from "./schema.js";

/** An ERROR close report: the one shape every "could not close" reaches the driver in. */
export function closeError(detail: string): CloseReport {
  return { status: "ERROR", detail };
}

/** The first line of the task's first text field: what was asked for, in the words it was asked in. */
export function taskSummary(taskDef: TaskDef): string | undefined {
  return Object.values(taskDef)
    .find((value): value is string => typeof value === "string")
    ?.split("\n")[0]
    ?.trim() || undefined;
}

/**
 * Commit whatever the worker left in the worktree, titled with the task it
 * delivers so the branch's history says what was asked for. A task with no
 * text to title it with is named by its branch instead.
 */
export async function commitAccepted(ctx: CloseContext): Promise<void> {
  const { header } = await load(ctx.dir);
  const summary = taskSummary(header.taskDef);
  const message = summary
    ? `${summary.slice(0, 72)}\n\nDelivered by delivery-service for ${header.surfaceId} on ${ctx.branch}.`
    : `Accepted work from ${ctx.branch}`;
  await ensureCommitted(ctx.worktreePath, message);
}

/**
 * A closer that reports the same failure however it is called. Resolution
 * failures use this so a caller never has to distinguish "failed to resolve"
 * from "failed to run" — both are just an ERROR report, exactly as `failedGate`
 * does for gates.
 */
export function failedCloser(detail: string): CloserPort {
  return { close: () => Promise.resolve(closeError(detail)) };
}

/**
 * Drop a scratch worktree, tolerating "already gone" exactly as provisioning
 * does: on a replay the removal has usually already happened, and a closer has
 * no resume token to tell it so. `prune` clears the administrative entry left
 * behind when the directory itself vanished without git's help.
 */
export async function removeWorktree(ctx: CloseContext): Promise<void> {
  await tryGit(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
  await tryGit(ctx.repoPath, ["worktree", "prune"]);
}

/**
 * What every built-in closer does when the surface did not end accepted: clear
 * the scratch directory, keep the branch. The branch is what whoever takes over
 * an escalation inspects or continues from, so no built-in ever deletes it on a
 * stopped surface.
 *
 * Idempotent by construction — both calls tolerate an absent worktree — because
 * a teardown failure is only logged by the driver, so a later replay is the only
 * thing that will ever try again.
 */
export async function teardownWorktree(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> {
  await removeWorktree(ctx);
  return {
    status: "DONE",
    detail:
      `The surface ended ${outcome.kind}, so nothing was landed. Removed its scratch worktree and kept ` +
      `branch ${ctx.branch}, where the work was left for whoever takes it over.`,
  };
}

/**
 * Every built-in closer shares this shape: a stopped surface (anything but
 * "accepted") always tears down the same way via `teardownWorktree`, and an
 * "accepted" surface routes to the closer's own landing logic, which never
 * throws at the driver — an environment problem becomes an ERROR report,
 * exactly as it does for a gate.
 */
export function closerFromAcceptedHandler(closeAccepted: (ctx: CloseContext) => Promise<CloseReport>): CloserPort {
  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      try {
        if (outcome.kind !== "accepted") return await teardownWorktree(ctx, outcome);
        return await closeAccepted(ctx);
      } catch (err) {
        return closeError(`The close could not run: ${messageOf(err)}`);
      }
    },
  };
}
