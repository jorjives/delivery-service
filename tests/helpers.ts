import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";

export const REPO_ROOT = join(import.meta.dirname, "..");

/** A fresh temp dir per call; every dir this file made is removed after its tests finish. */
export function useScratch(): (prefix: string) => string {
  const scratches: string[] = [];
  afterAll(() => {
    for (const path of scratches) rmSync(path, { recursive: true, force: true });
  });
  return (prefix: string) => {
    const path = mkdtempSync(join(tmpdir(), prefix));
    scratches.push(path);
    return path;
  };
}

/**
 * Run a git command against a working copy, with a clean, deterministic git env.
 * Stderr is captured (it stays on the thrown error), so a probe that is expected
 * to fail does not print `fatal: ...` into an otherwise green test run.
 */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
}

/** `npm pack` the checkout into `destination` (as `npm publish` would) and return the tarball's path. */
export function packTarball(destination: string): string {
  const [{ filename }] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  return join(destination, filename);
}

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

export function runTsx(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env,
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

/** A guide's fenced ```ts block whose first line is `// <name>`, exactly as a reader copies it. */
export function snippetFrom(guide: string, name: string): string {
  const start = guide.indexOf("```ts\n// " + name + "\n");
  if (start === -1) throw new Error(`the guide has no \`\`\`ts block starting with // ${name}`);
  const body = start + "```ts\n".length;
  return guide.slice(body, guide.indexOf("```", body));
}

/** The compiled `delivery` command, as `npm run build` leaves it. */
export const DELIVERY_BIN = join(REPO_ROOT, "dist", "cli", "main.js");

/** Run the compiled `delivery` command as a person would, capturing what it prints and how it exits. */
export function runDelivery(
  args: string[],
  { cwd = REPO_ROOT, env = process.env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number | null } {
  if (!existsSync(DELIVERY_BIN)) {
    throw new Error("dist/cli/main.js is missing: run `npm run build` (npm test does this for you)");
  }
  const { stdout, stderr, status } = spawnSync(process.execPath, [DELIVERY_BIN, ...args], { cwd, env, encoding: "utf-8" });
  return { stdout, stderr, status };
}
