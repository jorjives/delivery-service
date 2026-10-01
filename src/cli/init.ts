import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_BASENAME, CONFIG_EXTENSIONS, DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository, inferredCheck } from "./project.js";
import { concurrencyNamed, DEFAULT_CLOSER } from "./settings.js";

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

/**
 * What the project is, in the owner's words, told to the agent before every
 * task. Skippable: pressing Enter leaves it out of the file, which a project
 * can live without.
 */
export const DESCRIPTION_QUESTION: TextQuestion = {
  message:
    "Describe your project in a sentence or two: what it is and what it's built with. " +
    "The agent reads this before every task. Press Enter to skip.",
};

export const NOTHING_TO_DO = "Say what you'd like done, in a sentence.";

export const ALREADY_LISTED = "You've already said that one. Say something different.";

/**
 * The next thing to do, given the ones already said. The first cannot be
 * blank: a file with nothing to do has nothing to run. After that, a blank
 * answer means that's everything. A task already said is refused, trimmed
 * as the loader compares them, because the loader refuses two the same.
 */
export const taskQuestion = (listed: string[]): TextQuestion => ({
  message:
    listed.length === 0
      ? "What's the first thing you'd like done? Say it the way you'd say it to a colleague."
      : "What else would you like done? Press Enter when that's everything.",
  validate: (answer) => {
    const said = answer.trim();
    if (said === "") return listed.length === 0 ? NOTHING_TO_DO : true;
    return listed.some((task) => task.trim() === said) ? ALREADY_LISTED : true;
  },
});

/** Everything the owner would like done, asked one at a time until a blank answer. */
async function askTasks(ask: Ask): Promise<string[]> {
  const tasks: string[] = [];
  for (;;) {
    const answer = await ask.text(taskQuestion(tasks));
    if (answer.trim() === "") return tasks;
    tasks.push(answer);
  }
}

/**
 * How many to suggest running at the same time: the smallest number that is
 * "some at once" at all, so saying yes at most doubles what is being spent at
 * any moment and adds one working copy. It can never be more than the list,
 * because the question is only asked with two or more things listed.
 * ponytail: a fixed suggestion, not sized to the list or the machine. Revisit
 * if owners routinely type a larger number in its place.
 */
export const SUGGESTED_AT_ONCE = 2;

/**
 * Whether to work on some of the list at the same time. Enter means no: one at
 * a time is what every project gets unless its owner says otherwise, and
 * nobody's costs should change because they pressed Enter.
 */
export const atOnceQuestion = (listed: number): ConfirmQuestion => ({
  message:
    `You've listed ${listed} things to do. Shall I work on some of them at the same time? ` +
    "That costs more at the same time and uses a working copy of your project for each one. " +
    `I'd suggest ${SUGGESTED_AT_ONCE} at once; say no and they are done one at a time.`,
  default: false,
});

export const NOT_A_NUMBER_AT_ONCE = "That needs to be a whole number, 1 or more, such as 3.";

/**
 * How many at the same time, asked only after a yes. Enter takes the
 * suggestion; anything typed in its place is held to the rule the file's own
 * setting is held to, so this question cannot take a number that `delivery
 * validate` would then refuse.
 */
export const HOW_MANY_AT_ONCE_QUESTION: TextQuestion = {
  message: "How many at the same time?",
  default: String(SUGGESTED_AT_ONCE),
  validate: (answer) => (concurrencyNamed(answer) === undefined ? NOT_A_NUMBER_AT_ONCE : true),
};

/** How many to run at the same time, or nothing when there is only one thing to do or the owner said no. */
async function askAtOnce(ask: Ask, listed: number): Promise<number | undefined> {
  if (listed < 2 || !(await ask.confirm(atOnceQuestion(listed)))) return undefined;
  return concurrencyNamed(await ask.text(HOW_MANY_AT_ONCE_QUESTION));
}

export const overwriteQuestion = (file: string): ConfirmQuestion => ({
  message: file.endsWith(".json")
    ? `There's already a ${file}. Shall I replace it with your answers?`
    : `There's already a ${file}. I can only write a ${CONFIG_BASENAME}.json, and that would be used instead of it. Shall I?`,
  default: false,
});

/**
 * The answers as the file a run reads: always a list of tasks, even of one,
 * because `task` is the hand-written one-off form. Parsed by the very schema
 * `delivery run` will parse it with, so this command can never write a file
 * its own loader would refuse. A blank description is left out rather than
 * written empty, which the loader would refuse. How many run at the same time
 * is written only when the owner chose a number; left out, one at a time
 * applies. Limits are deliberately absent: the defaults are better left
 * implicit than frozen into a file nobody asked to set.
 */
export function configFrom({
  description,
  check,
  closer,
  tasks,
  atOnce,
}: {
  description: string;
  check: string;
  closer: string;
  tasks: string[];
  atOnce?: number;
}): DeliveryConfig {
  return DeliveryConfig.parse({
    ...(description.trim() === "" ? {} : { domain: description }),
    tasks,
    gate: { type: "command", command: check, parseMode: "exitcode" },
    closer: { type: closer },
    ...(atOnce === undefined ? {} : { concurrency: atOnce }),
  });
}

/**
 * `delivery init`: set a project up by answering questions instead of writing
 * the file by hand. It asks what the project is, what checks the agent's work,
 * what happens to work that passes, what you'd like done, one thing at a time,
 * and, when that is more than one thing, whether to work on some at the same time,
 * and writes the answers where the next `delivery run` will find them with no flags at all.
 */
export async function initCommand(options: InitOptions, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  // Before the repository is even looked for: needing somebody to answer is
  // about this command itself, so hearing about the folder first would send the
  // reader after the wrong problem.
  if (ctx.stdin.isTTY !== true) throw new Refusal(NEEDS_A_TERMINAL, EXIT.configuration);

  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const file = CONFIG_FILE(repoPath);

  // Asked first, not last: someone who is keeping the file they have should not
  // have to answer every question to find that out.
  const existing = existingConfig(repoPath);
  if (existing !== undefined && !(await ask.confirm(overwriteQuestion(existing)))) {
    ctx.writeLine(LEFT_ALONE(existing));
    return EXIT.ok;
  }

  const description = await ask.text(DESCRIPTION_QUESTION);
  const check = await ask.text(checkQuestion(await inferredCheck(repoPath)));
  const closer = await ask.choose(CLOSER_QUESTION);
  const tasks = await askTasks(ask);
  const atOnce = await askAtOnce(ask, tasks.length);

  await writeFile(file, `${JSON.stringify(configFrom({ description, check, closer, tasks, atOnce }), null, 2)}\n`);
  ctx.writeLine(WRITTEN(file));
  return EXIT.ok;
}
