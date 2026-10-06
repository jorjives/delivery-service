import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanGitEnv } from "./git-env.js";

/**
 * Test and demo support: create a throwaway git repository seeded with `files`
 * and a single commit on `main`. Identity is written into the repository's own
 * config so the seed commit, and any commit made in a worktree of this repo,
 * works on a machine with no global git identity.
 */
export function initTempRepo(prefix: string, files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "pipe", env: cleanGitEnv() });
  };

  git(["init", "-b", "main"]);
  git(["config", "user.email", "harness@example.invalid"]);
  git(["config", "user.name", "Harness"]);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), contents);
  }
  git(["add", "-A"]);
  git(["commit", "-m", "seed"]);

  return repo;
}

/**
 * Test and demo support: give `repo` a bare repository on this machine as its
 * `origin`, with `main` pushed, so a closer can push without any network.
 * Returns the bare repository's path, for asserting on what arrived there.
 */
export function addLocalOrigin(repo: string): string {
  const origin = mkdtempSync(join(tmpdir(), "origin-"));
  const git = (cwd: string, args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: "pipe", env: cleanGitEnv() });
  };
  git(origin, ["init", "--bare", "-b", "main"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["push", "origin", "main"]);
  return origin;
}
