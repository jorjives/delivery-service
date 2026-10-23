import type { Pack } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { loadConfigAndPacks } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, Refusal } from "./failures.js";
import { projectPacks } from "./pack-workflows.js";
import { findRepository } from "./project.js";

export interface PacksOptions {
  /** Print the JSON Schema of `pack.json` instead of the list. */
  schema?: boolean;
}

/** The packs this command lists: the built-in ones, and in a project, the ones it lists too. Outside a repository there is no project, so only the built-in ones. */
async function packsFor(ctx: CommandContext): Promise<Pack[]> {
  const repoPath = await findRepository(ctx.cwd).catch((error: unknown) => {
    if (error instanceof Refusal) return undefined;
    throw error;
  });
  if (repoPath === undefined) return projectPacks({}, ctx.cwd);
  return (await loadConfigAndPacks({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env })).packs;
}

/** The lines `delivery packs` prints: each pack with its sentence and the command that starts it, the names aligned on the longest. */
export function packLines(packs: readonly Pack[]): string[] {
  const width = Math.max(0, ...packs.map(({ manifest }) => manifest.name.length));
  const lines = packs.map(({ manifest }) => {
    const sentence = /[.!?]$/.test(manifest.summary) ? manifest.summary : `${manifest.summary}.`;
    return `  ${manifest.name.padEnd(width)}  ${sentence} Start it with: delivery review ${manifest.name}`;
  });
  return ["Packs you can use:", ...lines, "", "To use a pack folder of your own, list it under packs in delivery.config.json."];
}

/** `delivery packs`: every pack you can use, the built-in ones and any the project lists, each with its sentence and the command that starts it; as data with `--json`; or the pack format's schema with `--schema`. */
export async function packsCommand(options: PacksOptions, ctx: CommandContext): Promise<ExitCode> {
  if (options.schema === true) {
    ctx.writeLine(JSON.stringify(packSchema(), null, 2));
    return EXIT.ok;
  }
  const packs = await packsFor(ctx);
  if (ctx.json) {
    ctx.writeLine(JSON.stringify({ packs: packs.map(({ manifest }) => ({ name: manifest.name, version: manifest.version, title: manifest.title, summary: manifest.summary })) }, null, 2));
    return EXIT.ok;
  }
  for (const line of packLines(packs)) ctx.report.note(line);
  return EXIT.ok;
}
