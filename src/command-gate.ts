import { execFile as execFileCb } from "node:child_process";
import type { GateReport, GateRef, TaskDef, Assertion } from "./schema.js";
import { parseTap, parseJunit, parseExitCode } from "./parsers.js";
import { ParseError } from "./errors.js";
import { errorReport, messageOf, duplicateIdReport } from "./gate-support.js";

export interface GateContext {
  worktreePath: string;
  taskDef: TaskDef;
  gateRef: GateRef;
  /** The branch the run started from and lands on, as pinned in the case file, or `null` for a run that recorded none. Most gates ignore it. */
  baseBranch?: string | null;
  /** The environment the gate's command runs with. Unset: it inherits the process's own, which is right for an ordinary fix or sign-off; a caller that needs the command sandboxed (`packs check`, against a pack's own fixture code) sets it instead. */
  env?: NodeJS.ProcessEnv;
}

export interface Gate {
  baseline(ctx: GateContext): Promise<GateReport>;
  check(ctx: GateContext): Promise<GateReport>;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

function exec(command: string, cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFileCb(
      "/bin/sh",
      ["-c", command],
      { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (err && "code" in err && typeof err.code === "string") {
          // System-level error (ENOENT, ETIMEDOUT, etc.) — not a command exit code
          reject(err);
          return;
        }
        if (err && "killed" in err && (err as { killed: boolean }).killed) {
          // Process was killed (timeout or signal)
          reject(new Error("Command timed out"));
          return;
        }
        const exitCode = err && "code" in err && typeof err.code === "number"
          ? err.code
          : err ? 1 : 0;
        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          exitCode,
        });
      },
    );
  });
}

async function run(
  command: string,
  parseMode: "tap" | "junit" | "exitcode",
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<GateReport> {
  let result: ExecResult;
  try {
    result = await exec(command, cwd, timeoutMs, env);
  } catch (err) {
    return errorReport(`Command execution failed: ${messageOf(err)}`);
  }

  let assertions: Assertion[];
  try {
    if (parseMode === "exitcode") {
      assertions = parseExitCode(command, result.exitCode);
    } else if (parseMode === "tap") {
      assertions = parseTap(result.stdout);
    } else {
      assertions = parseJunit(result.stdout);
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return errorReport(`Failed to parse ${parseMode} output: ${err.message}`);
    }
    throw err;
  }

  const dup = duplicateIdReport(assertions);
  if (dup) return dup;

  // Gate-level status reflects whether the gate infrastructure ran successfully,
  // not whether individual assertions passed (that is the delta rule's concern).
  // If we reached here, the command ran and output parsed — that is "PASS".
  return {
    status: "PASS",
    assertions,
  };
}

export function createCommandGate(
  command: string,
  parseMode: "tap" | "junit" | "exitcode",
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Gate {
  const execute = (ctx: GateContext) => run(command, parseMode, ctx.worktreePath, timeoutMs, ctx.env);
  return { baseline: execute, check: execute };
}
