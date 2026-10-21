import { z } from "zod";
import { runGh } from "./gh.js";

const MergedPullRequests = z.array(z.object({ headRefOid: z.string() }));

/**
 * The head commits of the pull requests GitHub reports merged for `branch` (design §9 decision 5: GitHub's state, not
 * the shape of history, decides "merged", so a merge commit, a squash and a rebase all count). A delivery branch whose
 * tip is in this set has had everything on it merged. Throws gh's own error when gh cannot answer: no caller may
 * mistake "could not ask" for "nothing merged" without saying so.
 */
export async function mergedPullRequestTips(repoPath: string, branch: string, { command }: { command?: string } = {}): Promise<Set<string>> {
  const stdout = await runGh(["pr", "list", `--head=${branch}`, "--state=merged", "--limit=100", "--json=headRefOid"], { cwd: repoPath, ...(command === undefined ? {} : { command }) });
  return new Set(MergedPullRequests.parse(JSON.parse(stdout)).map((pr) => pr.headRefOid));
}
