import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanGitEnv } from "./git-env.js";

/** Run git in `cwd` with no hook or fsmonitor command, whatever the global config or a template would run. */
function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, stdio: "pipe", env: cleanGitEnv() });
}

/**
 * Test, demo and pack-check support: create a throwaway git repository seeded with `files`
 * and a single commit on `main`. Identity is written into the repository's own
 * config so the seed commit, and any commit made in a worktree of this repo,
 * works on a machine with no global git identity.
 */
export function initTempRepo(prefix: string, files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), contents);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "seed"]);

  return repo;
}

/**
 * Test and demo support: give `repo` a bare repository on this machine as its
 * `origin`, with `main` pushed, so a closer can push without any network.
 * Returns the bare repository's path, for asserting on what arrived there.
 */
export function addLocalOrigin(repo: string): string {
  const origin = mkdtempSync(join(tmpdir(), "origin-"));
  git(origin, ["init", "--bare", "-b", "main"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["push", "origin", "main"]);
  return origin;
}
