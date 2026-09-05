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
