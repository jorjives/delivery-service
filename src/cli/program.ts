import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { EXIT, renderFailure } from "./failures.js";
import { useColour } from "./output.js";
import { runCommand, type RunOptions } from "./run-command.js";

/** Everything the command takes from the process that runs it. `main.ts` passes the real process; tests pass their own. */
export interface CliIo {
  /** The arguments after the command name. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
}

/** This package's own version: `package.json` sits two folders above both `src/cli/` and `dist/cli/`. */
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

/**
 * Parse `io.argv`, run the command it names, and return the exit code. Never
 * throws and never prints a stack trace: every failure is rendered by
 * `renderFailure`, and a usage mistake (an unknown option or command) is a
 * configuration exit after commander has said what was wrong.
 */
export async function runCli(io: CliIo): Promise<number> {
  let exitCode: number = EXIT.ok;

  const program = new Command("delivery")
    .description(
      "Hand an AI agent a task in plain English. It works on a copy of your repository, your own tests check the result, and the work is left on a branch for you.",
    )
    .version(version, "-V, --version", "print the harness version")
    .option("--no-color", "print without colour")
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });

  program
    .command("run")
    .description("start a run: the agent works on the task, your test script checks it, and the result is committed to a new branch")
    .option("--task <text>", "what you want done, in plain English")
    .option("--repo <path>", "the git repository to work on (default: the current folder)")
    .action(async (options: RunOptions, command: Command) => {
      // A throw here rejects parseAsync with the original error, rendered once below.
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await runCommand(options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });

  try {
    await program.parseAsync(io.argv, { from: "user" });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode === 0 ? EXIT.ok : EXIT.configuration;
    const failure = renderFailure(err);
    io.stderr.write(`${failure.message}\n`);
    return failure.exitCode;
  }
}
