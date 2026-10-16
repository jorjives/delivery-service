import { execFile } from "node:child_process";

/** What a shell command did: its output, and the code it exited with. */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run an operator's command through `/bin/sh`, with `args` as positional parameters (`"$@"`), so a value the
 * harness passes (an item id) is never read as shell text. A non-zero exit is a result; a command that cannot be
 * started is a rejection, and one killed for running past `timeoutMs` rejects with "Command timed out".
 */
export function runShell(
  command: string,
  args: string[],
  { cwd, timeoutMs, env, input }: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; input?: string },
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/bin/sh",
      ["-c", args.length === 0 ? command : `${command} "$@"`, "sh", ...args],
      { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (err && "code" in err && typeof err.code === "string") return reject(err);
        if (err && "killed" in err && (err as { killed: boolean }).killed) return reject(new Error("Command timed out"));
        const exitCode = err && "code" in err && typeof err.code === "number" ? err.code : err ? 1 : 0;
        resolve({ stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : "", exitCode });
      },
    );
    child.stdin?.on("error", () => undefined); // a command that never reads its input must not fail the run
    child.stdin?.end(input ?? "");
  });
}
