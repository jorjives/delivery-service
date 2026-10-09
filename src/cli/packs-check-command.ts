import { relative, resolve } from "node:path";
import { FIXTURES } from "../packs/pack-fixtures.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { checkPack, type PackCheck } from "./pack-check.js";

export const SENT_NOTHING = "Nothing was sent to a real agent: every reply came from the review's fixtures.";
export const checkingLine = (shown: string): string => `Checking the review in ${shown}…`;
/** `delivery review` reads a bare word as a built-in pack's name, so a folder is always shown as a path it will read as one (resolvePack's rule). */
export const readyLine = (pathArg: string): string =>
  `Ready to use: delivery review ${pathArg.includes("/") || pathArg.includes("\\") || pathArg.startsWith(".") ? pathArg : `./${pathArg}`}`;

const quoted = (titles: readonly string[]): string => titles.map((title) => `"${title}"`).join(", ");

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
 * if there are none, its fixtures run against the scripted agent. Exit codes follow `delivery validate`:
 * 0 ready, 2 anything wrong with the pack. With `--json`, the whole result as one document.
 */
export async function packsCheckCommand(pathArg: string, ctx: CommandContext): Promise<ExitCode> {
  const dir = resolve(ctx.cwd, pathArg);
  const shown = (file: string): string => relative(ctx.cwd, file) || ".";
  if (!ctx.json) ctx.writeLine(checkingLine(shown(dir)));
  const result = await checkPack(dir, { env: ctx.env });
  const exitCode = result.ready ? EXIT.ok : EXIT.configuration;
  if (ctx.json) {
    ctx.writeLine(JSON.stringify(result, null, 2));
    return exitCode;
  }
  for (const problem of result.problems) ctx.writeLine(`${shown(problem.file)}: ${problem.message}.`);
  if (result.ready) for (const line of passedLines(result, pathArg)) ctx.writeLine(line);
  else if (result.run !== null) ctx.writeLine(SENT_NOTHING);
  return exitCode;
}
