import type { RunReporter } from "./report.js";

/** The command's standard input: a person typing, or a pipe with nobody behind it. */
export type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean };

/**
 * From when it is called until the function it returns is, have Ctrl-C, or the
 * process being told to stop, say `farewell` on standard error and end the
 * process at once with `exitCode`.
 */
export type ExitOnInterrupt = (exitCode: number, farewell: string) => () => void;

/** What a command needs from the process it runs in, passed in so tests can run it in process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  /** Whether this invocation asked for machine-readable output. */
  json: boolean;
  stdin: CliStdin;
  /** The answer this command was asked for, on standard output. */
  writeLine(line: string): void;
  /** How a run is told while it happens, and anything said alongside it. */
  report: RunReporter;
  /** How a stop ends this command, when the process it runs in lets it choose. Absent: a stop ends it as the platform does. */
  exitOnInterrupt?: ExitOnInterrupt;
}
