import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { cleanGitEnv } from "./git-env.js";

const execFile = promisify(execFileCb);

/** What a failed gh call left to go on. Node's execFile error carries `code`: the exit code as a number, or a spawn error string such as "ENOENT". */
export interface GhFailure {
  missing: boolean;
  exitCode: number | null;
  stderr: string;
}

export function ghFailureOf(err: unknown): GhFailure {
  const { code, stderr } = err as { code?: unknown; stderr?: unknown };
  return { missing: code === "ENOENT", exitCode: typeof code === "number" ? code : null, stderr: typeof stderr === "string" ? stderr : "" };
}

// GitHub token prefixes, and credentials embedded in a URL.
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/g;
const URL_CREDENTIALS = /\/\/[^/\s@]+@/g;

/** gh's own first line of explanation, safe to quote: any token or credentialed URL is redacted. */
export function ghReason(failure: GhFailure): string {
  const line = failure.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "gh gave no reason";
  return line.replace(TOKEN, "[redacted]").replace(URL_CREDENTIALS, "//[redacted]@");
}

export type GhAccess = "missing" | "signed-out" | "forbidden" | "offline";

/**
 * The GitHub access problems any gh call can hit; null when the failure is something else. Recognised from gh's own
 * signals: a spawn ENOENT, its documented exit code 4 for "authentication required", and the HTTP status it prints.
 * Each caller words its own fix.
 */
export function ghAccess(failure: GhFailure): GhAccess | null {
  if (failure.missing) return "missing";
  if (failure.exitCode === 4 || /HTTP 401|Bad credentials|gh auth login/i.test(failure.stderr)) return "signed-out";
  if (/HTTP 403|does not have the correct permissions|not accessible/i.test(failure.stderr)) return "forbidden";
  if (/error connecting to|could not resolve host|timed? ?out/i.test(failure.stderr)) return "offline";
  return null;
}

/** One gh call as whoever runs the harness, found on `env`'s PATH, with no inherited `GIT_*` variable steering it. */
export async function runGh(args: string[], { cwd, env = process.env, command = "gh", timeoutMs }: { cwd: string; env?: NodeJS.ProcessEnv; command?: string; timeoutMs?: number }): Promise<string> {
  const { stdout } = await execFile(command, args, { cwd, env: cleanGitEnv(env), maxBuffer: 50 * 1024 * 1024, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) });
  return stdout.trim();
}
