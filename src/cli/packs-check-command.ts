import { relative, resolve } from "node:path";
import { FIXTURES } from "../packs/pack-fixtures.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import type { Ask, ConfirmQuestion } from "./init.js";
import { checkPack, NotTrusted, type PackCheck } from "./pack-check.js";

export interface PacksCheckOptions {
  /** Skip the trust confirmation below: for a non-interactive run, where nothing can ask. */
  yes?: boolean;
}

export const SENT_NOTHING = "Nothing was sent to a real agent: every reply came from the review's fixtures.";
export const checkingLine = (shown: string): string => `Checking the review in ${shown}…`;
/** `delivery review` reads a bare word as the name of a pack the project uses, so a folder is always shown as a path it will read as one (resolvePack's rule). */
export const readyLine = (pathArg: string): string =>
  `Ready to use: delivery review ${pathArg.includes("/") || pathArg.includes("\\") || pathArg.startsWith(".") ? pathArg : `./${pathArg}`}`;

const quoted = (titles: readonly string[]): string => titles.map((title) => `"${title}"`).join(", ");

/**
 * Checking a pack runs its own test command: real code, with the real
 * filesystem and process access of whoever runs it, only without this
 * process's credentials and its real `HOME` (see `sandboxedEnv`). That is not
 * a sandbox against a hostile pack, only against an accidental credential
 * leak, so a pack you did not write is asked for once, before anything runs.
 */
export const trustQuestion = (shown: string): ConfirmQuestion => ({
  message: `${shown}'s fixtures are about to run its own test command, as real code: no credentials of yours reach it, but it otherwise runs as you would. Do you trust this pack's code?`,
  default: false,
});

export const NOT_TRUSTED = (shown: string): string => `Left ${shown} alone: I only run a pack's own code once you say you trust it.`;
export const NEEDS_CONFIRMATION = "This isn't a terminal, so I can't ask whether you trust this pack's code. Pass --yes once you do.";

/** What a pack that passed showed, one fact per line. */
export function passedLines({ pack, run }: PackCheck, pathArg: string): string[] {
  if (pack === null || run === null) return [];
  const count = run.found.length;
  return [
    `✓ pack.json: the ${pack.name} review, version ${pack.version}.`,
    `✓ The scripted review found ${count} ${count === 1 ? "problem" : "problems"}, as ${FIXTURES.expect} expects: ${quoted(run.found)}.`,
    ...run.fixed.map((title) => `✓ The scripted fix for "${title}" passed its check.`),
    ...run.refused.map(({ title, why }) => `✓ The scripted cheat for "${title}" was refused: ${why}.`),
    SENT_NOTHING,
    readyLine(pathArg),
  ];
}

/**
 * `delivery packs check <path>`: every problem with a review folder, named by file and field; then,
 * if there are none, trust is confirmed before its fixtures run against the scripted agent: asked
 * in a terminal, required as `--yes` otherwise, since nothing can ask. A declined pack is left
 * alone (exit 0); an unconfirmable one (non-interactive, no `--yes`) is refused (exit 2), same as
 * any other configuration problem. Exit codes otherwise follow `delivery validate`: 0 ready, 2
 * anything wrong with the pack. With `--json`, the whole result as one document.
 */
export async function packsCheckCommand(pathArg: string, options: PacksCheckOptions, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  const dir = resolve(ctx.cwd, pathArg);
  const shown = (file: string): string => relative(ctx.cwd, file) || ".";
  if (!ctx.json) ctx.writeLine(checkingLine(shown(dir)));
  const confirm =
    options.yes === true
      ? undefined
      : async (): Promise<boolean> => {
          if (ctx.stdin.isTTY !== true) throw new Refusal(NEEDS_CONFIRMATION, EXIT.configuration);
          return ask.confirm(trustQuestion(shown(dir)));
        };
  let result: PackCheck;
  try {
    result = await checkPack(dir, { env: ctx.env, confirm });
  } catch (err) {
    if (err instanceof NotTrusted) {
      ctx.writeLine(NOT_TRUSTED(shown(dir)));
      return EXIT.ok;
    }
    throw err;
  }
  const exitCode = result.ready ? EXIT.ok : EXIT.configuration;
  if (ctx.json) {
    ctx.writeLine(JSON.stringify(result, null, 2));
    return exitCode;
  }
  // A problem is usually a clause; one carrying a refusal is already a sentence.
  for (const problem of result.problems) ctx.writeLine(`${shown(problem.file)}: ${problem.message.replace(/\.?$/, ".")}`);
  if (result.ready) for (const line of passedLines(result, pathArg)) ctx.writeLine(line);
  else if (result.run !== null) ctx.writeLine(SENT_NOTHING);
  return exitCode;
}
