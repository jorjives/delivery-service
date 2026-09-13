import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { load } from "./case-file.js";
import { closeError, closerFromAcceptedHandler } from "./closer-support.js";
import { cleanGitEnv } from "./git-env.js";
import { ensureCommitted, tryGit } from "./git-exec.js";
import type { CloseContext, CloseReport, CloserPort } from "./ports.js";
import type { TaskDef } from "./schema.js";

const execFile = promisify(execFileCb);

const OpenPullRequests = z.array(z.object({ url: z.string() }));

/**
 * Title and body for the pull request. The title is the first line of the
 * task's first text field, so a reviewer sees what was asked for; the body
 * carries the whole task definition. Both reach gh as single argv entries.
 */
function describePullRequest(surfaceId: string, taskDef: TaskDef, ctx: CloseContext): { title: string; body: string } {
  const summary = Object.values(taskDef)
    .find((value): value is string => typeof value === "string")
    ?.split("\n")[0]
    ?.trim();
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

  async function gh(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFile(ghCommand, args, { cwd, env: cleanGitEnv() });
    return stdout.trim();
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return closeError("This surface has no pinned base branch, so there is nothing to open a pull request against.");
    }

    if (existsSync(ctx.worktreePath)) {
      await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    }

    if (!(await tryGit(ctx.repoPath, ["remote", "get-url", "origin"]))) {
      return closeError(
        `The repository at ${ctx.repoPath} has no remote named origin, so ${ctx.branch} could not be pushed for a ` +
          `pull request. The work is committed on ${ctx.branch}. Add the GitHub repository as origin and close again.`,
      );
    }

    const refspec = `refs/heads/${ctx.branch}:refs/heads/${ctx.branch}`;
    if (!(await tryGit(ctx.repoPath, ["push", "--set-upstream", "origin", refspec]))) {
      return closeError(
        `git could not push ${ctx.branch} to origin, so no pull request was opened. The work is committed on ` +
          `${ctx.branch}. Check that the operator can push to origin from ${ctx.repoPath}, then close again.`,
      );
    }

    const listed = await gh(ctx.repoPath, ["pr", "list", `--head=${ctx.branch}`, "--state=open", "--json=url"]);
    const existing = OpenPullRequests.parse(JSON.parse(listed))[0];
    if (existing) {
      return {
        status: "DONE",
        detail:
          `${existing.url}: this pull request from ${ctx.branch} was already open, so no new pull request was opened. ` +
          `Any new commits on ${ctx.branch} were pushed to it.`,
      };
    }

    const { header } = await load(ctx.dir);
    const { title, body } = describePullRequest(header.surfaceId, header.taskDef, ctx);
    const created = await gh(ctx.repoPath, [
      "pr",
      "create",
      `--base=${ctx.baseBranch}`,
      `--head=${ctx.branch}`,
      `--title=${title}`,
      `--body=${body}`,
    ]);
    const url = created.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? created;
    return { status: "DONE", detail: url };
  }

  return closerFromAcceptedHandler(closeAccepted);
}
