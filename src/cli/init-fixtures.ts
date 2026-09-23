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
 * An answer left out is Enter: the question's own default. An answer the
 * question refuses is recorded in `refused` and the next scripted answer is
 * tried, as a person would type again; a refused answer with nothing scripted
 * after it fails the test rather than asking forever.
 */
export function scriptedAsk({ texts = [], choice, confirm }: { texts?: (string | undefined)[]; choice?: string; confirm?: boolean } = {}) {
  const asked: (TextQuestion | ChoiceQuestion | ConfirmQuestion)[] = [];
  const refused: string[] = [];
  const queue = [...texts];
  const ask: Ask = {
    text(question) {
      asked.push(question);
      for (;;) {
        const scripted = queue.length > 0;
        const answer = queue.shift() ?? question.default ?? "";
        const verdict = question.validate?.(answer) ?? true;
        if (verdict === true) return Promise.resolve(answer);
        refused.push(verdict);
        if (!scripted) return Promise.reject(new Error(`"${answer}" was refused (${verdict}) and no answer is scripted after it`));
      }
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
  return { ask, asked, refused };
}
