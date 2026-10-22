import { existsSync } from "node:fs";
import { load } from "./case-file.js";
import { closeError, closerFromAcceptedHandler, commitAccepted, taskSummary } from "./closer-support.js";
import { ghFailureOf, ghReason, runGh } from "./gh.js";
import { git, tryGit } from "./git-exec.js";
import { createdUrl, listPullRequests, prAccessProblem } from "./pull-requests.js";
import type { CloseContext, CloseReport, CloserPort, DeliveredTask } from "./ports.js";
import type { TaskDef } from "./schema.js";

/**
 * Title and body for the pull request. The title is the first line of the
 * task's first text field, so a reviewer sees what was asked for; the body
 * carries the whole task definition. Both reach gh as single argv entries.
 */
function describePullRequest(surfaceId: string, taskDef: TaskDef, ctx: CloseContext): { title: string; body: string } {
  const summary = taskSummary(taskDef);
  const title = summary ? `${summary.slice(0, 100)} (${surfaceId})` : `Accepted work from ${ctx.branch}`;
  const body = [
    `The delivery harness accepted this work for surface ${surfaceId} and opened this pull request from ${ctx.branch} into ${ctx.baseBranch}.`,
    "",
    "Task definition:",
    "",
    "```json",
    JSON.stringify(taskDef, null, 2),
    "```",
  ].join("\n");
  return { title, body };
}

/** Title and body for the one pull request a delivery branch has: every task landed on it. */
function describeDelivery(ctx: CloseContext, landed: readonly DeliveredTask[]): { title: string; body: string } {
  const count = landed.length === 1 ? "1 item" : `${landed.length} items`;
  const closes = landed.flatMap((task) => (task.closes === undefined ? [] : [`Closes ${task.closes}`]));
  const body = [
    `The delivery harness landed these on ${ctx.branch}, each checked on top of the ones before it, for you to merge into ${ctx.baseBranch} as one:`,
    "",
    ...landed.map((task) => `- ${task.intent} (${task.item}, run ${task.run})`),
    ...(closes.length === 0 ? [] : ["", ...closes]),
  ].join("\n");
  return { title: `Delivered work on ${ctx.branch} (${count})`, body };
}

/**
 * Open a GitHub pull request for the accepted work, for owners who want a
 * person to review before anything merges.
 *
 * Uses the GitHub CLI as whoever runs the harness: no token is taken, stored
 * or reported. The order is commit, push, detect, create. Pushing before the
 * detect step means a repeat close also delivers any follow-up commits to the
 * pull request that is already open; the detect step (an open pull request
 * for this branch) is what makes a replay report that one instead of opening
 * a second.
 *
 * On success the worktree is left in place: a pull request under review may
 * take follow-up commits. Stopped surfaces tear down like every built-in.
 *
 * `ghCommand` exists so tests can substitute a stand-in executable.
 */
export function createOpenPrCloser(options: { ghCommand?: string } = {}): CloserPort {
  const ghCommand = options.ghCommand ?? "gh";

  const gh = (cwd: string, args: string[]): Promise<string> => runGh(args, { cwd, command: ghCommand });

  /**
   * Push the branch to origin. When git refuses a delivery branch because origin's copy is not an ancestor, replace that
   * copy, but only when it is exactly the head of a pull request GitHub reports merged (a squash or rebase merge whose
   * branch GitHub kept): everything on it is then in the base. The lease names that commit, so anything pushed since is
   * never overwritten. Any other branch, and any other refusal, is reported as before.
   */
  async function pushBranch(ctx: CloseContext): Promise<boolean> {
    const refspec = `refs/heads/${ctx.branch}:refs/heads/${ctx.branch}`;
    if (await tryGit(ctx.repoPath, ["push", "--set-upstream", "origin", refspec])) return true;
    if (ctx.delivery === undefined) return false;
    const listed = await git(ctx.repoPath, ["ls-remote", "origin", `refs/heads/${ctx.branch}`]).catch(() => "");
    const remote = listed.split(/\s+/)[0] ?? "";
    if (remote === "") return false;
    const listing = await listPullRequests(ctx.repoPath, { heads: [ctx.branch] }, { state: "merged", command: ghCommand });
    if (!listing.ok || !listing.pullRequests.some((pr) => pr.headRefOid === remote)) return false;
    return tryGit(ctx.repoPath, ["push", "--set-upstream", `--force-with-lease=refs/heads/${ctx.branch}:${remote}`, "origin", refspec]);
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return closeError("This surface has no pinned base branch, so there is nothing to open a pull request against.");
    }

    if (existsSync(ctx.worktreePath)) {
      await commitAccepted(ctx);
    }

    if (!(await tryGit(ctx.repoPath, ["remote", "get-url", "origin"]))) {
      return closeError(
        `The repository at ${ctx.repoPath} has no remote named origin, so ${ctx.branch} could not be pushed for a ` +
          `pull request. The work is committed on ${ctx.branch}. Add the GitHub repository as origin and close again.`,
      );
    }

    if (!(await pushBranch(ctx))) {
      return closeError(
        `git could not push ${ctx.branch} to origin, so no pull request was opened. The work is committed on ` +
          `${ctx.branch}. Check that the operator can push to origin from ${ctx.repoPath}, then close again.`,
      );
    }

    const listing = await listPullRequests(ctx.repoPath, { heads: [ctx.branch] }, { command: ghCommand });
    if (!listing.ok) {
      const { failure } = listing;
      return (
        prAccessProblem(failure) ??
        closeError(
          `gh could not check whether ${ctx.branch} already has an open pull request: ${ghReason(failure)}. ` +
            `Check that origin is the GitHub repository and that gh can reach it from ${ctx.repoPath}, then close again.`,
        )
      );
    }
    const existing = listing.pullRequests[0];
    if (existing) {
      // A delivery branch's pull request is its own from an earlier run: bring its list up to date (spec §5.7).
      if (ctx.delivery !== undefined) {
        try {
          await gh(ctx.repoPath, ["pr", "edit", existing.url, `--body=${describeDelivery(ctx, ctx.delivery.landed).body}`]);
        } catch (err) {
          const failure = ghFailureOf(err);
          return prAccessProblem(failure) ?? closeError(`gh could not update ${existing.url} with what has landed on ${ctx.branch}: ${ghReason(failure)}. The work is pushed to it. Close again.`);
        }
        return { status: "DONE", detail: `${existing.url}: updated this pull request from ${ctx.branch} with everything landed on it so far, and pushed the new work.` };
      }
      return {
        status: "DONE",
        detail:
          `${existing.url}: this pull request from ${ctx.branch} was already open, so no new pull request was opened. ` +
          `Any new commits on ${ctx.branch} were pushed to it.`,
      };
    }

    const { title, body } =
      ctx.delivery === undefined
        ? await load(ctx.dir).then(({ header }) => describePullRequest(header.surfaceId, header.taskDef, ctx))
        : describeDelivery(ctx, ctx.delivery.landed);
    let created: string;
    try {
      created = await gh(ctx.repoPath, [
        "pr",
        "create",
        `--base=${ctx.baseBranch}`,
        `--head=${ctx.branch}`,
        `--title=${title}`,
        `--body=${body}`,
      ]);
    } catch (err) {
      const failure = ghFailureOf(err);
      // Anything that is not an access problem is GitHub declining this pull
      // request (branch protection, no commits between the branches): a
      // decision a person can make, so FAIL rather than ERROR.
      return (
        prAccessProblem(failure) ?? {
          status: "FAIL",
          detail:
            `GitHub refused to open a pull request from ${ctx.branch} into ${ctx.baseBranch}: ${ghReason(failure)}. ` +
            `The work is committed and pushed on ${ctx.branch}. Resolve the refusal on GitHub, or choose a different ` +
            `close, then close again.`,
        }
      );
    }
    return { status: "DONE", detail: createdUrl(created) };
  }

  return closerFromAcceptedHandler(closeAccepted);
}
