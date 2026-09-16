import type { RunReporter } from "./report.js";

/** The command's standard input: a person typing, or a pipe with nobody behind it. */
export type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean };

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
}
