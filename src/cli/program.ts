import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import type { CliStdin } from "./context.js";
import { EXIT, renderFailure } from "./failures.js";
import { useColour } from "./output.js";
import { resumeCommand, type ResumeOptions } from "./resume-command.js";
import { runCommand, type RunOptions } from "./run-command.js";
import { statusCommand, type StatusOptions } from "./status-command.js";

/** Everything the command takes from the process that runs it. `main.ts` passes the real process; tests pass their own. */
export interface CliIo {
  /** The arguments after the command name. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: CliStdin;
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
    .description("start a run, or picks up a run that didn't finish: the agent works on the task, your check decides whether it is good, and the result is delivered the way your config file asks (by default, committed to a new branch)")
    .option("--task <text>", "what you want done, in plain English")
    .option("--task-file <path>", "read what you want done from a file")
    .option("--gate-command <command>", "the command that checks the agent's work: it passes when the command exits 0")
    .option("--closer <type>", "what happens to accepted work: commit-to-branch, merge-back or open-pr")
    .option("--config <path>", "use this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to work on (default: the current folder)")
    .option("--fresh", "start a new run even though one didn't finish, leaving that one to pick up later")
    .action(async (options: RunOptions, command: Command) => {
      // A throw here rejects parseAsync with the original error, rendered once below.
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await runCommand(options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        stdin: io.stdin,
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });

  program
    .command("resume")
    .description("pick up a run that didn't finish, without ever starting a new one")
    .argument("[run-id]", "the run to pick up (default: the one that didn't finish)")
    .option("--last", "pick up the run touched most recently, without asking")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: ResumeOptions, command: Command) => {
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await resumeCommand(runId, options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        stdin: io.stdin,
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });

  program
    .command("status")
    .description("say what happened to a run: how it finished, or what decision it needs from you, without changing anything")
    .argument("[run-id]", "the run to read (default: the one touched most recently)")
    .option("--last", "read the run touched most recently, which is also what no run id means")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await statusCommand(runId, options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        stdin: io.stdin,
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
