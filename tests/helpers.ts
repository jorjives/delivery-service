import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cleanGitEnv } from "../src/git-env.js";

export const REPO_ROOT = join(import.meta.dirname, "..");

/** Paths (tracked by git) matching an extended-regex pattern, scoped to the given pathspecs. */
export function gitGrepFiles(pattern: string, scope: string[]): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-E", pattern, "--", ...scope], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []; // git grep found nothing
    throw err;
  }
}

export function runTsx(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

/** Slices a UAT demo's numbered console output between two section headings. */
export function sectionOf(stdout: string, from: string, to?: string): string {
  const start = stdout.indexOf(from);
  return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
}
