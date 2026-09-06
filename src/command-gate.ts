import { execFile as execFileCb } from "node:child_process";
import type { GateReport, GateRef, TaskDef, Assertion } from "./schema.js";
import { parseTap, parseJunit, parseExitCode, validateUniqueIds } from "./parsers.js";
import { ParseError, DuplicateIdError } from "./errors.js";

export interface GateContext {
  worktreePath: string;
  taskDef: TaskDef;
  gateRef: GateRef;
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

function exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFileCb(
      "/bin/sh",
      ["-c", command],
      { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 },
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

function errorReport(detail: string): GateReport {
  return { status: "ERROR", assertions: [], detail };
}

async function run(
  command: string,
  parseMode: "tap" | "junit" | "exitcode",
  cwd: string,
  timeoutMs: number,
): Promise<GateReport> {
  let result: ExecResult;
  try {
    result = await exec(command, cwd, timeoutMs);
  } catch (err) {
    return errorReport(`Command execution failed: ${err instanceof Error ? err.message : String(err)}`);
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

  try {
    validateUniqueIds(assertions);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      return errorReport(`Duplicate assertion ID: ${err.duplicateId}`);
    }
    throw err;
  }

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
  const execute = (ctx: GateContext) => run(command, parseMode, ctx.worktreePath, timeoutMs);
  return { baseline: execute, check: execute };
}
