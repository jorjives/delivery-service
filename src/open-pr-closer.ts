import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { load } from "./case-file.js";
import { closeError, closerFromAcceptedHandler, commitAccepted, taskSummary } from "./closer-support.js";
import { cleanGitEnv } from "./git-env.js";
import { tryGit } from "./git-exec.js";
import type { CloseContext, CloseReport, CloserPort } from "./ports.js";
import type { TaskDef } from "./schema.js";

const execFile = promisify(execFileCb);

export const OpenPullRequests = z.array(z.object({ url: z.string() }));

/**
 * What a failed gh call left to go on. Node's execFile error carries `code`:
 * the exit code as a number, or a spawn error string such as "ENOENT".
 */
interface GhFailure {
  missing: boolean;
  exitCode: number | null;
  stderr: string;
}

function ghFailureOf(err: unknown): GhFailure {
  const { code, stderr } = err as { code?: unknown; stderr?: unknown };
  return {
    missing: code === "ENOENT",
    exitCode: typeof code === "number" ? code : null,
    stderr: typeof stderr === "string" ? stderr : "",
  };
}

// GitHub token prefixes, and credentials embedded in a URL.
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/g;
const URL_CREDENTIALS = /\/\/[^/\s@]+@/g;

/** gh's own first line of explanation, safe to quote: any token or credentialed URL is redacted. */
function reasonOf(failure: GhFailure): string {
  const line = failure.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "gh gave no reason";
  return line.replace(TOKEN, "[redacted]").replace(URL_CREDENTIALS, "//[redacted]@");
}

/**
 * The GitHub access problems any gh call can hit, each an ERROR naming its
 * fix; null when the failure is something else. Recognised from gh's own
 * signals: a spawn ENOENT, its documented exit code 4 for "authentication
 * required", and the HTTP status it prints.
 */
function accessProblem(failure: GhFailure): CloseReport | null {
  if (failure.missing) {
    return closeError(
      "The GitHub command-line tool (gh) is not installed, or not on the PATH the harness runs with, so no pull " +
        "request could be opened. Install it from https://cli.github.com, run gh auth login, then close again.",
    );
  }
  if (failure.exitCode === 4 || /HTTP 401|Bad credentials|gh auth login/i.test(failure.stderr)) {
    return closeError(
      "GitHub sign-in is needed: gh is not signed in, or its sign-in has expired, so no pull request could be " +
        "opened. Run gh auth login as the person or account the harness runs as, then close again.",
    );
  }
  if (/HTTP 403|does not have the correct permissions|not accessible/i.test(failure.stderr)) {
    return closeError(
      "gh is signed in, but that GitHub account lacks permission to open pull requests on this repository. Run " +
        "gh auth refresh -s repo, or get write access to the repository, then close again.",
    );
  }
  if (/error connecting to|could not resolve host|timed? ?out/i.test(failure.stderr)) {
    return closeError("gh could not reach GitHub, so no pull request could be opened. Check the network and close again.");
  }
  return null;
}

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
      await commitAccepted(ctx);
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

    let listed: string;
    try {
      listed = await gh(ctx.repoPath, ["pr", "list", `--head=${ctx.branch}`, "--state=open", "--json=url"]);
    } catch (err) {
      const failure = ghFailureOf(err);
      return (
        accessProblem(failure) ??
        closeError(
          `gh could not check whether ${ctx.branch} already has an open pull request: ${reasonOf(failure)}. ` +
            `Check that origin is the GitHub repository and that gh can reach it from ${ctx.repoPath}, then close again.`,
        )
      );
    }
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
        accessProblem(failure) ?? {
          status: "FAIL",
          detail:
            `GitHub refused to open a pull request from ${ctx.branch} into ${ctx.baseBranch}: ${reasonOf(failure)}. ` +
            `The work is committed and pushed on ${ctx.branch}. Resolve the refusal on GitHub, or choose a different ` +
            `close, then close again.`,
        }
      );
    }
    const url = created.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? created;
    return { status: "DONE", detail: url };
  }

  return closerFromAcceptedHandler(closeAccepted);
}
