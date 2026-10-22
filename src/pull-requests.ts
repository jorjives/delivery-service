import { z } from "zod";
import { closeError } from "./closer-support.js";
import { ghAccess, ghFailureOf, runGh, type GhFailure } from "./gh.js";
import type { CloseReport } from "./ports.js";

export const PullRequestState = z.enum(["OPEN", "MERGED", "CLOSED"]);
export type PullRequestState = z.infer<typeof PullRequestState>;

export const PullRequest = z.object({
  url: z.string(),
  state: PullRequestState,
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullish(),
});
export type PullRequest = z.infer<typeof PullRequest>;

/** The exact head branches to look up; each is matched by name, never by prefix or search. */
export type PullRequestQuery = { heads: readonly string[] };

export type PullRequestListing = { ok: true; pullRequests: PullRequest[] } | { ok: false; failure: GhFailure };

const STATES = { open: "[OPEN]", merged: "[MERGED]", all: "[OPEN,MERGED,CLOSED]" } as const;

/** What GitHub answers per pull request: ours plus whether its head branch lives in a fork. */
const Node = PullRequest.extend({ isCrossRepository: z.boolean() });

const Answer = z.object({
  data: z.object({ repository: z.record(z.string(), z.object({ nodes: z.array(Node) })) }).nullish(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/**
 * The pull requests GitHub holds for each of `query.heads`, in the states asked for (default `"open"`), from one
 * `gh api graphql` request whatever the number of heads. It reads GitHub's primary store by exact head name, so a
 * pull request is seen the moment it exists; nothing here goes through search. Pull requests from a fork are dropped,
 * since a stranger's branch may share a delivery branch's name but is never that level's pull request. Never throws:
 * a failure, including gh missing, signed out or offline, is a listing that says so, and each caller words its own fix.
 */
export async function listPullRequests(
  repoPath: string,
  query: PullRequestQuery,
  options: { state?: "open" | "merged" | "all"; command?: string } = {},
): Promise<PullRequestListing> {
  if (query.heads.length === 0) return { ok: true, pullRequests: [] };
  const { state = "open", command } = options;
  const variables = query.heads.map((_, i) => `$h${i}:String!`).join(",");
  const aliases = query.heads
    .map((_, i) => `p${i}:pullRequests(headRefName:$h${i},states:${STATES[state]},first:100){nodes{url state headRefName headRefOid baseRefName isCrossRepository mergeCommit{oid}}}`)
    .join(" ");
  const graphql = `query($owner:String!,$name:String!,${variables}){repository(owner:$owner,name:$name){${aliases}}}`;
  const heads = query.heads.flatMap((head, i) => ["-f", `h${i}=${head}`]);
  try {
    const stdout = await runGh(
      ["api", "graphql", "-f", `query=${graphql}`, "-F", "owner={owner}", "-F", "name={repo}", ...heads],
      { cwd: repoPath, ...(command === undefined ? {} : { command }) },
    );
    const answer = Answer.parse(JSON.parse(stdout));
    if (answer.errors !== undefined) {
      return { ok: false, failure: { missing: false, exitCode: 1, stderr: answer.errors.map((error) => error.message).join("\n") } };
    }
    if (answer.data === undefined || answer.data === null) throw new Error("gh answered with no data");
    const repository = answer.data.repository;
    const own = query.heads.flatMap((_, i) => (repository[`p${i}`]?.nodes ?? []).flatMap(({ isCrossRepository, ...pr }) => (isCrossRepository ? [] : [pr])));
    return { ok: true, pullRequests: own };
  } catch (err) {
    return { ok: false, failure: ghFailureOf(err) };
  }
}

/**
 * The GitHub access problems any gh call can hit, each an ERROR naming its
 * fix; null when the failure is something else.
 */
export function prAccessProblem(failure: GhFailure): CloseReport | null {
  switch (ghAccess(failure)) {
    case "missing":
      return closeError(
        "The GitHub command-line tool (gh) is not installed, or not on the PATH the harness runs with, so no pull " +
          "request could be opened. Install it from https://cli.github.com, run gh auth login, then close again.",
      );
    case "signed-out":
      return closeError(
        "GitHub sign-in is needed: gh is not signed in, or its sign-in has expired, so no pull request could be " +
          "opened. Run gh auth login as the person or account the harness runs as, then close again.",
      );
    case "forbidden":
      return closeError(
        "gh is signed in, but that GitHub account lacks permission to open pull requests on this repository. Run " +
          "gh auth refresh -s repo, or get write access to the repository, then close again.",
      );
    case "offline":
      return closeError("gh could not reach GitHub, so no pull request could be opened. Check the network and close again.");
    case null:
      return null;
  }
}

/** The pull request's URL from what `gh pr create` printed: its last non-blank line. */
export function createdUrl(stdout: string): string {
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? stdout;
}

/** The pull request that stands for a branch: the open one, else the latest. */
export function standingPullRequest(pullRequests: readonly PullRequest[]): PullRequest | undefined {
  return pullRequests.find((pr) => pr.state === "OPEN") ?? pullRequests.at(-1);
}
