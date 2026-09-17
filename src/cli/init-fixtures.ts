import { Readable } from "node:stream";
import type { CommandContext } from "./context.js";
import type { Ask, ChoiceQuestion, ConfirmQuestion, TextQuestion } from "./init.js";
import { plainReporter } from "./report.js";

/** Test support: a command context with somebody at the terminal, unless the test says there is nobody. */
export function context(cwd: string, { interactive = true }: { interactive?: boolean } = {}) {
  const lines: string[] = [];
  const writeLine = (line: string): void => void lines.push(line);
  const stdin = Object.assign(Readable.from([]), { isTTY: interactive || undefined });
  const ctx: CommandContext = { cwd, env: {}, colour: false, json: false, stdin, writeLine, report: plainReporter(writeLine, false) };
  return { ctx, lines };
}

/**
 * A person answering the wizard's questions in the order they are asked,
 * recording each question so a test can assert on what was actually offered.
 * An answer left out is Enter: the question's own default.
 */
export function scriptedAsk({ texts = [], choice, confirm }: { texts?: (string | undefined)[]; choice?: string; confirm?: boolean } = {}) {
  const asked: (TextQuestion | ChoiceQuestion | ConfirmQuestion)[] = [];
  const queue = [...texts];
  const ask: Ask = {
    text(question) {
      asked.push(question);
      return Promise.resolve(queue.shift() ?? question.default ?? "");
    },
    choose(question) {
      asked.push(question);
      return Promise.resolve(choice ?? question.default);
    },
    confirm(question) {
      asked.push(question);
      return Promise.resolve(confirm ?? question.default);
    },
  };
  return { ask, asked };
}
