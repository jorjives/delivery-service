import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "./git-env.js";

/**
 * Test and demo support: create a throwaway git repository seeded with `files`
 * and a single commit on `main`. Identity is passed with `-c` so the fixture
 * does not depend on the machine's global git config.
 */
export function initTempRepo(prefix: string, files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "pipe", env: cleanGitEnv() });
  };

  git(["init", "-b", "main"]);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(repo, name), contents);
  }
  git(["add", "-A"]);
  git([
    "-c", "user.email=harness@example.invalid",
    "-c", "user.name=Harness",
    "commit", "-m", "seed",
  ]);

  return repo;
}
