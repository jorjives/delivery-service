import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import type { CommandContext, CliStdin } from "./context.js";
import { EXIT, renderFailure } from "./failures.js";
import { initCommand, type InitOptions } from "./init.js";
import { useColour } from "./output.js";
import { inquirerAsk } from "./prompts.js";
import { jsonReporter, plainReporter, type RunReporter } from "./report.js";
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
 * How this invocation tells a run: plain-language lines for a person, or one
 * JSON object per step for a script, with everything that is not a step kept
 * off standard output so a reader never has to filter it back out.
 */
function reporterFor(io: CliIo, { json, colour }: { json: boolean; colour: boolean }): RunReporter {
  const writeLine = (line: string) => io.stdout.write(`${line}\n`);
  return json ? jsonReporter(writeLine, (line) => io.stderr.write(`${line}\n`)) : plainReporter(writeLine, colour);
}

/**
 * What every command gets from this process. Built once here rather than at
 * each command, so `--json` and `--no-color` cannot mean one thing to `run` and
 * another to `status`. Colour is off under `--json`: an escape code inside a
 * JSON line would break the one thing that option is for.
 */
function contextFor(io: CliIo, command: Command): CommandContext {
  const { color, json = false } = command.optsWithGlobals<{ color: boolean; json?: boolean }>();
  const colour = !json && useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY });
  return {
    cwd: io.cwd,
    env: io.env,
    colour,
    json,
    stdin: io.stdin,
    writeLine: (line) => io.stdout.write(`${line}\n`),
    report: reporterFor(io, { json, colour }),
  };
}

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
    .option("--json", "print machine-readable output: one JSON object per step while a run happens, and one JSON document from status")
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
      exitCode = await runCommand(options, contextFor(io, command));
    });

  program
    .command("resume")
    .description("pick up a run that didn't finish, without ever starting a new one")
    .argument("[run-id]", "the run to pick up (default: the one that didn't finish)")
    .option("--last", "pick up the run touched most recently, without asking")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: ResumeOptions, command: Command) => {
      exitCode = await resumeCommand(runId, options, contextFor(io, command));
    });

  program
    .command("status")
    .description("say what happened to a run: how it finished, or what decision it needs from you, without changing anything")
    .argument("[run-id]", "the run to read (default: the one touched most recently)")
    .option("--last", "read the run touched most recently, which is also what no run id means")
    .option("--all", "list every run in this repository, newest first, instead of reading one")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
      exitCode = await statusCommand(runId, options, contextFor(io, command));
    });

  program
    .command("init")
    .description(
      "set this project up by answering a few questions: what command checks the agent's work, what happens to work that passes, and the first thing you'd like done",
    )
    .option("--repo <path>", "the git repository to set up (default: the current folder)")
    .action(async (options: InitOptions, command: Command) => {
      const ctx = contextFor(io, command);
      exitCode = await initCommand(options, ctx, inquirerAsk(ctx.colour));
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
