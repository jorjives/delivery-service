import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "./git-env.js";
import { recordDelivery } from "./delivery-ledger.js";
import { levelRefOf } from "./delivery-stack.js";
import { initTempRepo } from "./temp-repo.js";

/** Test support: a repository with an open delivery branch, and another task landing on it. */
export const DELIVERY = "delivery/main";

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf-8" }).trim();

export function deliveryRepo(files: Record<string, string> = {}): string {
  const repo = initTempRepo("surface-delivery-repo-", { "check.sh": 'echo "1..1"\necho "ok 1 - fine"\n', "shared.txt": "one\n", ...files });
  git(repo, ["branch", DELIVERY]);
  return repo;
}

/** Commit `file` on `branch` from a scratch worktree, removed afterwards: as another task landing would. */
export async function commitOn(repo: string, branch: string, file: string, content: string): Promise<string> {
  const scratch = join(await mkdtemp(join(tmpdir(), "surface-delivery-other-")), "wt");
  git(repo, ["worktree", "add", "-q", scratch, branch]);
  writeFileSync(join(scratch, file), content);
  git(scratch, ["add", "-A"]);
  git(scratch, ["commit", "-q", "-m", `land ${file}`]);
  git(repo, ["worktree", "remove", "--force", scratch]);
  return git(repo, ["rev-parse", branch]);
}

/**
 * Test support: open the delivery branch in `repo` (a stack when `stacked`), land `landings` on it in order, and note the
 * pull requests `pulls` names. An empty landing changed nothing, so it sits on the commit before it. Returns each landing's commit.
 */
export async function stackedDelivery(
  repo: string,
  ledger: string,
  { stacked, landings, pulls = [] }: {
    stacked: boolean;
    landings: { runId: string; key: string; intent: string; empty?: true }[];
    pulls?: { runId: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" }[];
  },
): Promise<string[]> {
  git(repo, ["branch", DELIVERY]);
  const from = git(repo, ["rev-parse", "main"]);
  await recordDelivery(ledger, { t: "opened", branch: DELIVERY, base: "main", from, ...(stacked ? { stack: true as const } : {}) });
  const commits: string[] = [];
  for (const landing of landings) {
    const commit = landing.empty === true ? (commits.at(-1) ?? from) : await commitOn(repo, DELIVERY, `${landing.runId}.txt`, "work\n");
    commits.push(commit);
    await recordDelivery(ledger, { t: "landed", branch: DELIVERY, runId: landing.runId, key: landing.key, intent: landing.intent, commit, ...(landing.empty === true ? { empty: true as const } : {}) });
  }
  for (const pr of pulls) await recordDelivery(ledger, { t: "observed", branch: DELIVERY, pullRequests: [{ ref: levelRefOf("main", pr.runId), url: pr.url, state: pr.state }] });
  return commits;
}
