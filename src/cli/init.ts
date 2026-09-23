import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_BASENAME, CONFIG_EXTENSIONS, DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, inferredCheck } from "./project.js";
import { DEFAULT_CLOSER } from "./settings.js";

/**
 * A question answered by typing. `default` is what pressing Enter means;
 * `required` refuses an empty answer rather than writing one; `validate`
 * refuses any other answer it returns a sentence for, and that sentence is
 * shown while the question is asked again.
 */
export interface TextQuestion {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (answer: string) => true | string;
}

/** One thing a person can pick: what gets written, what it is called, and the one line saying what it does. */
export interface Choice {
  value: string;
  name: string;
  description: string;
}

/** A question answered by picking from a list. */
export interface ChoiceQuestion {
  message: string;
  choices: Choice[];
  default: string;
}

/** A question answered yes or no. */
export interface ConfirmQuestion {
  message: string;
  default: boolean;
}

/**
 * How this command asks a person something. The wizard is handed one rather
 * than importing a prompt library, because everything this slice promises is
 * about what is asked and what is written: drawing a menu and reading a
 * keypress is `@inquirer/prompts`' job (`src/cli/prompts.ts`), and re-testing
 * it here would assert on someone else's rendering.
 */
export interface Ask {
  text(question: TextQuestion): Promise<string>;
  choose(question: ChoiceQuestion): Promise<string>;
  confirm(question: ConfirmQuestion): Promise<boolean>;
}

/** What `delivery init` was given on the command line. */
export interface InitOptions {
  repo?: string;
}

/**
 * Where the file goes: the top of the repository, not the folder the command
 * was run from. Config discovery walks from the working folder up to the
 * repository root, so a file written into a subfolder would be invisible to a
 * run started anywhere else in the project.
 */
export const CONFIG_FILE = (repoPath: string): string => join(repoPath, `${CONFIG_BASENAME}.json`);

/**
 * The config file this project already has, whichever form it takes. All three,
 * not just the one this command writes: discovery prefers the `.json`, so a
 * `.json` written over somebody's computed `delivery.config.js` would stop that
 * file being used without anybody having been asked.
 */
export function existingConfig(repoPath: string): string | undefined {
  return CONFIG_EXTENSIONS.map((extension) => join(repoPath, CONFIG_BASENAME + extension)).find((candidate) => existsSync(candidate));
}

export const NEEDS_A_TERMINAL =
  "`delivery init` asks you a few questions, so it needs a terminal to type the answers in. " +
  `Run it in a terminal, or write a ${CONFIG_BASENAME}.json yourself: the README says what goes in it.`;

export const LEFT_ALONE = (file: string): string => `Left ${file} as it was. Nothing has changed.`;

export const WRITTEN = (file: string): string => `Written ${file}. To start the run: delivery run`;

/** The check, offering the project's own when it has one, so pressing Enter accepts it. */
export const checkQuestion = (suggested: string | undefined): TextQuestion => ({
  message: "What command should I run to check the agent's work? It passes when that command exits 0.",
  ...(suggested === undefined ? {} : { default: suggested }),
  required: true,
});

/**
 * What happens to work that passes. The three choices are the library's own
 * built-in closers, and the wizard's test pins them to that list, so a fourth
 * one cannot be added to the schema without being described here in words.
 */
export const CLOSER_QUESTION: ChoiceQuestion = {
  message: "What should happen to work that passes the check?",
  choices: [
    {
      value: "commit-to-branch",
      name: "Commit it to a branch",
      description: "The work is left on a branch of its own for you to look at. The branch you started from is untouched.",
    },
    {
      value: "merge-back",
      name: "Merge it into the branch you started from",
      description: "The work goes straight onto that branch, with no review step in between.",
    },
    {
      value: "open-pr",
      name: "Open a pull request",
      description: "The branch is pushed and a pull request is opened for it. This needs a remote and a signed-in `gh`.",
    },
  ],
  default: DEFAULT_CLOSER.type,
};

export const TASK_QUESTION: TextQuestion = {
  message: "What's the first thing you'd like done? Say it the way you'd say it to a colleague.",
  required: true,
};

export const overwriteQuestion = (file: string): ConfirmQuestion => ({
  message: file.endsWith(".json")
    ? `There's already a ${file}. Shall I replace it with your answers?`
    : `There's already a ${file}. I can only write a ${CONFIG_BASENAME}.json, and that would be used instead of it. Shall I?`,
  default: false,
});

/**
 * The three answers as the file a run reads. Parsed by the very schema
 * `delivery run` will parse it with, so this command can never write a file its
 * own loader would refuse. Limits are deliberately absent: the defaults are
 * better left implicit than frozen into a file nobody asked to set.
 */
export function configFrom({ check, closer, task }: { check: string; closer: string; task: string }): DeliveryConfig {
  return DeliveryConfig.parse({
    task: { intent: task },
    gate: { type: "command", command: check, parseMode: "exitcode" },
    closer: { type: closer },
  });
}

/**
 * `delivery init`: set a project up by answering a few questions instead of
 * writing the file by hand. It asks what checks the agent's work, what happens
 * to work that passes, and what you'd like done first, and writes those three
 * answers where the next `delivery run` will find them with no flags at all.
 */
export async function initCommand(options: InitOptions, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  // Before the repository is even looked for: needing somebody to answer is
  // about this command itself, so hearing about the folder first would send the
  // reader after the wrong problem.
  if (ctx.stdin.isTTY !== true) throw new Refusal(NEEDS_A_TERMINAL, EXIT.configuration);

  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const file = CONFIG_FILE(repoPath);

  // Asked first, not last: someone who is keeping the file they have should not
  // have to answer three questions to find that out.
  const existing = existingConfig(repoPath);
  if (existing !== undefined && !(await ask.confirm(overwriteQuestion(existing)))) {
    ctx.writeLine(LEFT_ALONE(existing));
    return EXIT.ok;
  }

  const check = await ask.text(checkQuestion(await inferredCheck(repoPath)));
  const closer = await ask.choose(CLOSER_QUESTION);
  const task = await ask.text(TASK_QUESTION);

  await writeFile(file, `${JSON.stringify(configFrom({ check, closer, task }), null, 2)}\n`);
  ctx.writeLine(WRITTEN(file));
  return EXIT.ok;
}
