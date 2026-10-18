import { git } from "./git-exec.js";
import { runGh } from "./gh.js";
import { OpenPullRequests } from "./open-pr-closer.js";

/** An origin that is a folder on this machine: no pull request can be open on it. */
const isLocal = (url: string): boolean => url.startsWith("/") || url.startsWith(".") || url.startsWith("file:");

/**
 * Finds a pull request open for a branch, asked of GitHub through gh as whoever runs the harness. The landing
 * boundary refuses the push a pull request needs, so this is the check behind it: what it finds, the task is
 * flagged for. Never an error of its own: no origin, an origin on this machine, or gh unable to answer all mean
 * none was found.
 * ponytail: GitHub only, through gh, as the open-pr closer is; another host's pull requests are not looked for.
 */
export function pullRequestFinder(repoPath: string, gh = "gh"): (branch: string) => Promise<string | null> {
  return async (branch) => {
    try {
      const origin = await git(repoPath, ["remote", "get-url", "origin"]);
      if (isLocal(origin)) return null;
      const stdout = await runGh(["pr", "list", `--head=${branch}`, "--state=open", "--json=url"], { cwd: repoPath, command: gh });
      return OpenPullRequests.parse(JSON.parse(stdout))[0]?.url ?? null;
    } catch {
      return null;
    }
  };
}
