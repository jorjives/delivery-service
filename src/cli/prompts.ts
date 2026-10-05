import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { Ask } from "./init.js";

/**
 * The streams the questions are asked on. The real command passes none, so the
 * library talks to this process's terminal, which is the only place `init` runs
 * at all; a test passes its own pair.
 */
export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Colour off, as `--no-color` asks. The library paints its own prompts, so a
 * theme whose styles return their text unchanged is the only way that flag
 * reaches them. `NO_COLOR` needs nothing from us: the library's own colour
 * support honours it.
 */
export const PLAIN_THEME = {
  style: {
    answer: (text: string) => text,
    message: (text: string) => text,
    error: (text: string) => text,
    defaultAnswer: (text: string) => text,
    help: (text: string) => text,
    highlight: (text: string) => text,
    key: (text: string) => text,
  },
};

/**
 * The wizard's questions asked with `@inquirer/prompts`. A plain mapping and
 * nothing else: every word, default and choice comes from `init.ts`, so this
 * file has nothing in it to get wrong except the mapping itself.
 */
export function inquirerAsk(colour: boolean, streams: PromptStreams = {}): Ask {
  const theme = colour ? {} : PLAIN_THEME;
  return {
    text: (question) =>
      input(
        { message: question.message, default: question.default, required: question.required ?? false, validate: question.validate, theme },
        streams,
      ),
    choose: (question) => select({ message: question.message, choices: question.choices, default: question.default, theme }, streams),
    confirm: (question) => confirm({ message: question.message, default: question.default, theme }, streams),
    pick: (question) =>
      checkbox(
        { message: question.message, choices: question.choices.map((choice) => ({ ...choice, checked: true })), theme },
        streams,
      ),
  };
}
