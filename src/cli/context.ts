/** The command's standard input: a person typing, or a pipe with nobody behind it. */
export type CliStdin = NodeJS.ReadableStream & { isTTY?: boolean };

/** What a command needs from the process it runs in, passed in so tests can run it in process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  stdin: CliStdin;
  writeLine(line: string): void;
}
