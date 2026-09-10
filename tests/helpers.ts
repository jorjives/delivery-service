import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..");

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
