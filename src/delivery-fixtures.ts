import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "./git-env.js";
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
