import type { GateReport, GateRef, GuardSwitches, TaskDef, Assertion } from "./schema.js";
import { parseTap, parseJunit, parseExitCode } from "./parsers.js";
import { ParseError } from "./errors.js";
import { errorReport, messageOf, duplicateIdReport } from "./gate-support.js";
import { runShell, type ShellResult } from "./shell.js";

export interface GateContext {
  worktreePath: string;
  taskDef: TaskDef;
  gateRef: GateRef;
  /** The branch the run started from and lands on, as pinned in the case file, or `null` for a run that recorded none. Most gates ignore it. */
  baseBranch?: string | null;
  /** The environment the gate's command runs with. Unset: it inherits the process's own, which is right for an ordinary fix or sign-off; a caller that needs the command sandboxed (`packs check`, against a pack's own fixture code) sets it instead. */
  env?: NodeJS.ProcessEnv;
  /** A workflow step's own guard switches, laid over the task's. Unset outside a workflow. */
  guards?: GuardSwitches;
}

export interface Gate {
  baseline(ctx: GateContext): Promise<GateReport>;
  check(ctx: GateContext): Promise<GateReport>;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

async function run(
  command: string,
  parseMode: "tap" | "junit" | "exitcode",
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<GateReport> {
  let result: ShellResult;
  try {
    result = await runShell(command, [], { cwd, timeoutMs, env });
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

/** How a command gate runs besides its command. */
export interface CommandGateOptions {
  /** Judge only after the work: the baseline runs nothing and records nothing. */
  checkOnly?: true;
  /** Run before the command, in the same working copy and environment. Exiting non-zero is a gate error. */
  setup?: string;
  /** Run after the command (and after a failed setup), whatever the result. */
  teardown?: string;
}

const NOTHING_YET: GateReport = { status: "PASS", assertions: [] };

/** The last few lines of what a command said, for an error a person reads. */
const lastLines = (text: string): string => text.trim().split("\n").slice(-5).join("\n");

async function setupProblem(setup: string, ctx: GateContext, timeoutMs: number): Promise<string | undefined> {
  try {
    const result = await runShell(setup, [], { cwd: ctx.worktreePath, timeoutMs, env: ctx.env });
    return result.exitCode === 0 ? undefined : `setup \`${setup}\` failed (exit ${result.exitCode}): ${lastLines(result.stderr || result.stdout)}`;
  } catch (err) {
    return `setup \`${setup}\` could not run: ${messageOf(err)}`;
  }
}

export function createCommandGate(
  command: string,
  parseMode: "tap" | "junit" | "exitcode",
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  options: CommandGateOptions = {},
): Gate {
  const execute = async (ctx: GateContext): Promise<GateReport> => {
    try {
      const problem = options.setup === undefined ? undefined : await setupProblem(options.setup, ctx, timeoutMs);
      if (problem !== undefined) return errorReport(problem);
      return await run(command, parseMode, ctx.worktreePath, timeoutMs, ctx.env);
    } finally {
      // ponytail: a teardown failure is warned about and never changes the verdict; record it on the gate entry if operators need it.
      if (options.teardown !== undefined) {
        await runShell(options.teardown, [], { cwd: ctx.worktreePath, timeoutMs, env: ctx.env })
          .then((r) => { if (r.exitCode !== 0) console.warn(`gate teardown \`${options.teardown}\` exited ${r.exitCode}`); })
          .catch((err: unknown) => console.warn(`gate teardown \`${options.teardown}\` could not run: ${messageOf(err)}`));
      }
    }
  };
  return { baseline: options.checkOnly === true ? () => Promise.resolve(NOTHING_YET) : execute, check: execute };
}
