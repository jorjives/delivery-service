import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, CommanderError, Option } from "commander";
import type { CommandContext, CliStdin, ExitOnInterrupt } from "./context.js";
import { EXIT, renderFailure } from "./failures.js";
import { secretMasker } from "../packs/secrets.js";
import { SIGN_OFF_THRESHOLDS } from "../packs/finding.js";
import { decideCommand, findingsCommand, type DecideOptions, type FindingsOptions } from "./findings-command.js";
import type { SignOffOptions } from "./sign-off-command.js";
import type { ReviewCommandOptions } from "./review-command.js";
import type { FixOptions } from "./fix-command.js";
import { answerCommand, unparkCommand, type ItemOptions } from "./item-commands.js";
import { initCommand, type InitOptions } from "./init.js";
import { useColour } from "./output.js";
import { PREVIEW_ROLES, previewCommand, taskNumber, type PreviewOptions } from "./preview-command.js";
import { inquirerAsk } from "./prompts.js";
import { jsonReporter, plainReporter, type RunReporter } from "./report.js";
import { reportCommand, type ReportOptions } from "./report-command.js";
import { resumeCommand, type ResumeOptions } from "./resume-command.js";
import { runCommand, type RunOptions } from "./run-command.js";
import { statusCommand, type StatusOptions } from "./status-command.js";
import { validateCommand, type ValidateOptions } from "./validate-command.js";
import { intervalSeconds, watchCommand } from "./watch-command.js";
import { packsCommand, type PacksOptions } from "./packs-command.js";

/** Everything the command takes from the process that runs it. `main.ts` passes the real process; tests pass their own. */
export interface CliIo {
  /** The arguments after the command name. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: CliStdin;
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
  /** How a stop may end a command; `main.ts` passes the real process's. Absent: nothing listens, and a stop ends the process as the platform does. */
  exitOnInterrupt?: ExitOnInterrupt;
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
    interactive: !json && io.stdin.isTTY === true && io.stdout.isTTY === true,
    stdin: io.stdin,
    writeLine: (line) => io.stdout.write(`${line}\n`),
    report: reporterFor(io, { json, colour }),
    exitOnInterrupt: io.exitOnInterrupt,
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

  // One choke point for everything this process prints, `--json`, errors and agent text included: a secret any review
  // of the repository flagged is masked on its way out. Set per command, from the repository that command reads.
  let mask = secretMasker(io.cwd);
  const out: CliIo = {
    ...io,
    stdout: { write: (text: string) => io.stdout.write(mask(text)), isTTY: io.stdout.isTTY },
    stderr: { write: (text: string) => io.stderr.write(mask(text)) },
  };
  const ctxFor = (command: Command, repo?: string): CommandContext => {
    mask = secretMasker(resolve(io.cwd, repo ?? command.optsWithGlobals<{ repo?: string }>().repo ?? "."));
    return contextFor(out, command);
  };

  const program = new Command("delivery")
    .description(
      "Hand an AI agent a task in plain English. It works on a copy of your repository, your own tests check the result, and the work is left on a branch for you.",
    )
    .version(version, "-V, --version", "print the harness version")
    .option("--no-color", "print without colour")
    .option("--json", "print machine-readable output: one JSON object per step while a run or a fix happens, one JSON document from status, report, validate, review, findings and packs, and one JSON event per line from status --watch")
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({ writeOut: (text) => out.stdout.write(text), writeErr: (text) => out.stderr.write(text) });

  program
    .command("run")
    .description("work down the list of tasks in your config file, or work through your backlog with `--sources`, or start a single run, or pick up a run that didn't finish: the agent works on the task, your check decides whether it is good, and the result is delivered the way your config file asks (by default, committed to a new branch)")
    .option("--task <text>", "what you want done, in plain English")
    .option("--task-file <path>", "read what you want done from a file")
    .option("--workflow <name>", "do the task in the steps of this workflow, as named under `workflows` in your config file")
    .option("--gate-command <command>", "the command that checks the agent's work: it passes when the command exits 0")
    .option("--closer <type>", "what happens to accepted work: commit-to-branch, merge-back or open-pr")
    .option("--concurrency <n>", "how many tasks from your list may run at once (default 1: one after another)")
    .option("--sources", "work through your backlog and the other work sources in your config file, in order, instead of one task")
    .option("--max <n>", "with --sources, how many items to take in this run (default 1)")
    .option("--config <path>", "use this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to work on (default: the current folder)")
    .option("--fresh", "start a new run even though one didn't finish, leaving that one to pick up later")
    .action(async (options: RunOptions, command: Command) => {
      // A throw here rejects parseAsync with the original error, rendered once below.
      exitCode = await runCommand(options, ctxFor(command));
    });

  program
    .command("answer")
    .description("answer the question a parked backlog item is waiting on; the next `delivery run --sources` carries on its work with your answer")
    .argument("<item>", "the item, as `delivery status` names it, such as backlog:20261016T090000Z-greet.md")
    .argument("<answer>", "your answer, in plain words")
    .option("--repo <path>", "the git repository the item belongs to (default: the current folder)")
    .action(async (item: string, answer: string, options: ItemOptions, command: Command) => {
      exitCode = await answerCommand(item, answer, options, ctxFor(command));
    });

  program
    .command("unpark")
    .description("put a parked item back in the queue; the next `delivery run --sources` starts it afresh")
    .argument("<item>", "the item, as `delivery status` names it")
    .option("--repo <path>", "the git repository the item belongs to (default: the current folder)")
    .action(async (item: string, options: ItemOptions, command: Command) => {
      exitCode = await unparkCommand(item, options, ctxFor(command));
    });

  program
    .command("resume")
    .description("pick up a run that didn't finish, without ever starting a new one")
    .argument("[run-id]", "the run to pick up (default: the one that didn't finish)")
    .option("--last", "pick up the run touched most recently, without asking")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: ResumeOptions, command: Command) => {
      exitCode = await resumeCommand(runId, options, ctxFor(command));
    });

  program
    .command("status")
    .description("say what happened to a run: how it finished, or what decision it needs from you, without changing anything")
    .argument("[run-id]", "the run to read (default: the one touched most recently)")
    .option("--last", "read the run touched most recently, which is also what no run id means")
    .option("--all", "list every run in this repository, newest first, instead of reading one")
    .option("--decisions", "print every triage round in full: what set it off, the verdict, the reasoning word for word, and the brief or packet it produced")
    .option("--repairs", "print what each repair changed in the task's working copy: every changed file and its patch, marking a file the check runs")
    .option(
      "--watch",
      "follow the run as it happens, from any terminal: what each task is doing now, then one line for each change, until the run ends. With no run id it follows your task list. Ctrl-C stops watching; the run is not affected",
    )
    .option("--interval <seconds>", "with --watch, how often to look at the record (default: every 2 seconds)", intervalSeconds)
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
      const ctx = ctxFor(command);
      exitCode = options.watch || options.interval !== undefined ? await watchCommand(runId, options, ctx) : await statusCommand(runId, options, ctx);
    });

  program
    .command("report")
    .description(
      "say in plain words what happened to your task list and what to do next: which tasks landed, which need you, which need an engineer and which were not started, without changing any run",
    )
    .argument("[run-id]", "report this task's run, or this run of several tasks, instead of the task list")
    .option("--write", "also save the report as .delivery/last-report.txt and .delivery/last-report.json, as a run does when it ends")
    .option("--schema", "print the published JSON Schema of the report document and of the events `status --watch --json` prints, instead of a report")
    .option("--repo <path>", "the git repository the runs belong to (default: the current folder)")
    .action(async (runId: string | undefined, options: ReportOptions, command: Command) => {
      exitCode = await reportCommand(runId, options, ctxFor(command));
    });

  program
    .command("validate")
    .description(
      "check your config file is ready to run, without starting anything: no agent, no sign-in and no network, and nothing on disk changes",
    )
    .option("--config <path>", "check this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to check (default: the current folder)")
    .action(async (options: ValidateOptions, command: Command) => {
      exitCode = await validateCommand(options, ctxFor(command));
    });

  program
    .command("preview")
    .description(
      "show exactly what the agent will be told for the next task on your list, before anything runs: no agent, no sign-in, and nothing on disk changes",
    )
    .option("--task <text>", "preview this task, as `delivery run --task` would take it")
    .option("--step <name>", "show what this step of a workflow will be told, and the agent options it runs with")
    .option("--workflow <name>", "the workflow --step is in, when more than one has a step of that name")
    .option("--queue-index <n>", 'show this task on your list instead, counted from 1 as in "Task 1 of 3"', taskNumber)
    .addOption(
      new Option("--role <role>", "whose instructions to show: the worker doing the task, or gate-maintenance, the agent that repairs your check when it can't run")
        .choices(PREVIEW_ROLES)
        .default("worker"),
    )
    .option("--config <path>", "read this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to read (default: the current folder)")
    .action(async (options: PreviewOptions, command: Command) => {
      exitCode = await previewCommand(options, ctxFor(command));
    });

  program
    .command("init")
    .description(
      "set this project up by answering a few questions: what the project is, what command checks the agent's work, what happens to work that passes, and what you'd like done",
    )
    .option("--repo <path>", "the git repository to set up (default: the current folder)")
    .action(async (options: InitOptions, command: Command) => {
      const ctx = ctxFor(command);
      exitCode = await initCommand(options, ctx, inquirerAsk(ctx.colour));
    });

  program
    .command("review")
    .description(
      "have an agent review your project, such as a code review, and list the problems it finds in plain words: it reads your last commit and changes nothing",
    )
    .argument("<pack>", "which review: a name from `delivery packs`, such as code, or the path to a review folder of your own")
    .argument("[repo]", "the git repository to review (default: the current folder)")
    .option("--path <part>", "review only this part of your project, such as src/auth: a folder or file, relative to where you are")
    .option("--preview", "show what the review agent would be told, and start nothing: no sign-in and no network needed")
    .action(async (pack: string, repo: string | undefined, options: ReviewCommandOptions, command: Command) => {
      const ctx = ctxFor(command, repo);
      const { reviewCommand } = await import("./review-command.js");
      exitCode = await reviewCommand(pack, repo, ctx, inquirerAsk(ctx.colour), options);
    });

  const findings = program
    .command("findings")
    .description("list the problems your latest review found and where each stands, or show one in full with the detail for engineers; changes nothing")
    .argument("[number]", "show this problem in full, counted from 1 as the list numbers them")
    .option("--unconfirmed", "list the problems the review reported that could not be found in your project, and why")
    .option("--changes", "with a problem's number: show what its kept fix changed, file by file")
    .option("--include-skipped", "also list problems you skipped or declined in an earlier review of the same kind, which are left out by default")
    .option("--schema", "print the published JSON Schema of the document `delivery findings --json` prints, instead of the problems")
    .option("--repo <path>", "the git repository the review belongs to (default: the current folder)")
    .action(async (number: string | undefined, options: FindingsOptions, command: Command) => {
      exitCode = await findingsCommand(number, options, ctxFor(command));
    });

  findings
    .command("approve")
    .description("approve problems from your latest review for fixing, by their numbers in the list; `delivery fix` then fixes them")
    .argument("[numbers...]", "the problems to approve, as the list numbers them")
    .option("--all", "approve every problem listed now that is not already being fixed (not those you settled in an earlier review)")
    .option("--allow-unchecked", "approve problems that cannot be checked: nothing will check their fixes except you, so each waits for your sign-off")
    .option("--allow-test-edits", "let each named problem's fix change your existing tests, never delete or skip one: each waits for your sign-off. Use it on a problem that needs a change to one of your tests to have it fixed on the next delivery fix")
    .option("--recommended", "approve the problems still to decide that have a check of their own and are not serious enough to wait for your sign-off; says which it chose")
    .action(async (numbers: string[], _options: DecideOptions, command: Command) => {
      exitCode = await decideCommand("approve", numbers, command.optsWithGlobals<DecideOptions>(), ctxFor(command));
    });

  findings
    .command("skip")
    .description("skip problems from your latest review: nothing will be done about them")
    .argument("[numbers...]", "the problems to skip, as the list numbers them")
    .action(async (numbers: string[], _options: unknown, command: Command) => {
      exitCode = await decideCommand("skip", numbers, command.optsWithGlobals<DecideOptions>(), ctxFor(command));
    });

  findings
    .command("sign-off")
    .description("merge a serious fix waiting for your sign-off: it is checked again on your current main copy first, and nothing is merged if it no longer passes")
    .argument("<number>", "the problem whose fix to merge, as the list numbers it")
    .action(async (number: string, _options: unknown, command: Command) => {
      const { signOffCommand } = await import("./sign-off-command.js");
      exitCode = await signOffCommand(number, command.optsWithGlobals<SignOffOptions>(), ctxFor(command));
    });

  findings
    .command("reject")
    .description("decline a serious fix waiting for your sign-off: nothing is merged, and the fix is kept on its branch for an engineer")
    .argument("<number>", "the problem whose fix to decline, as the list numbers it")
    .action(async (number: string, _options: unknown, command: Command) => {
      const { rejectCommand } = await import("./sign-off-command.js");
      exitCode = await rejectCommand(number, command.optsWithGlobals<SignOffOptions>(), ctxFor(command));
    });

  program
    .command("fix")
    .description(
      "fix the problems you approved in your latest review: each is fixed by an agent in its own copy, checked by its own check and your tests (if you have any), then merged or kept for your sign-off",
    )
    .option("--concurrency <n>", "how many problems to fix at once (default: 1, or `concurrency` in delivery.config.json)")
    .addOption(
      new Option("--sign-off-threshold <level>", "how serious a problem must be for its fix to wait for your sign-off: that level and every more serious one wait; none: nothing waits for how serious it is (default: the review's own)").choices(
        SIGN_OFF_THRESHOLDS,
      ),
    )
    .option("--repo <path>", "the git repository the review belongs to (default: the current folder)")
    .action(async (options: FixOptions, command: Command) => {
      const { fixCommand } = await import("./fix-command.js");
      exitCode = await fixCommand(options, ctxFor(command));
    });

  const packs = program
    .command("packs")
    .description("list the reviews available, each with a sentence saying what it looks for")
    .option("--schema", "print the JSON Schema of a review folder's pack.json, so your editor can check one as you write it")
    .action(async (options: PacksOptions, command: Command) => {
      exitCode = await packsCommand(options, ctxFor(command));
    });

  packs
    .command("check")
    .description(
      "check a review folder of your own before you use it: every mistake is named by file and field, then its fixtures run against a scripted agent, with nothing sent to a real agent",
    )
    .argument("<path>", "the review folder to check, such as ./my-review")
    .option("--yes", "skip asking whether you trust this pack's code before its fixtures run; needed when this isn't a terminal")
    .action(async (path: string, options: { yes?: boolean }, command: Command) => {
      const { packsCheckCommand } = await import("./packs-check-command.js");
      const ctx = ctxFor(command);
      exitCode = await packsCheckCommand(path, options, ctx, inquirerAsk(ctx.colour));
    });

  try {
    await program.parseAsync(io.argv, { from: "user" });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode === 0 ? EXIT.ok : EXIT.configuration;
    const failure = renderFailure(err);
    out.stderr.write(`${failure.message}\n`);
    return failure.exitCode;
  }
}
