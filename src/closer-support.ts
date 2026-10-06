import { existsSync } from "node:fs";
import { load } from "./case-file.js";
import { branchExists, ensureCommitted, git, tryGit } from "./git-exec.js";
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
 * Whether the surface's branch holds commits of its own beyond the base. A
 * branch that is gone holds nothing; one whose base cannot be compared is
 * assumed to hold work, so nothing is ever deleted on a guess.
 */
async function holdsWork(ctx: CloseContext): Promise<boolean> {
  if (!(await branchExists(ctx.repoPath, ctx.branch))) return false;
  if (ctx.baseBranch === "") return true;
  const ahead = await git(ctx.repoPath, ["rev-list", "--count", `${ctx.baseBranch}..${ctx.branch}`]).catch(() => "unknown");
  return ahead !== "0";
}

/**
 * What every built-in closer does when the surface did not end accepted:
 * commit whatever the worker left onto the surface's branch, then clear the
 * scratch directory. The branch is what whoever takes over an escalation
 * inspects or continues from, so it is kept whenever it holds work; one the
 * worker never changed is removed rather than left behind empty.
 *
 * Idempotent by construction — every step tolerates an absent worktree or
 * branch — because a teardown failure is only logged by the driver, so a later
 * replay is the only thing that will ever try again.
 */
export async function teardownWorktree(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> {
  if (existsSync(ctx.worktreePath)) {
    await ensureCommitted(ctx.worktreePath, `Unfinished work from ${ctx.branch}, left when the task ${outcome.kind === "aborted" ? "was aborted" : "was escalated"}`);
  }
  await removeWorktree(ctx);
  if (await holdsWork(ctx)) {
    return {
      status: "DONE",
      detail:
        `The surface ended ${outcome.kind}, so nothing was landed. Committed what the worker left to branch ` +
        `${ctx.branch} and kept it for whoever takes it over. Removed the scratch worktree.`,
    };
  }
  await tryGit(ctx.repoPath, ["branch", "-D", "--", ctx.branch]);
  return {
    status: "DONE",
    detail:
      `The surface ended ${outcome.kind} with no changes, so nothing was landed and branch ${ctx.branch} was ` +
      `removed rather than kept empty. Removed the scratch worktree.`,
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
