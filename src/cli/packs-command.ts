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

/** The packs the command in `ctx` can use: the built-in ones, and in a project, the ones it lists and the ones it added. Outside a repository there is no project, so only the built-in ones. */
export async function projectPacksFor(ctx: CommandContext): Promise<Pack[]> {
  const repoPath = await findRepository(ctx.cwd).catch((error: unknown) => {
    if (error instanceof Refusal) return undefined;
    throw error;
  });
  if (repoPath === undefined) return projectPacks({}, ctx.cwd, undefined);
  return (await loadConfigAndPacks({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env })).packs;
}

/** The line after the folder hint: how to add a pack someone has published on npm. */
export const ADD_HINT = "To add a pack someone has published on npm: delivery packs add <package>";

/** The last line of the plain listing: how to see what a pack will do before using it. */
export const INSPECT_HINT = "See exactly what a pack will do: delivery packs inspect <name>";

/** The lines `delivery packs` prints: each pack with its sentence and the command that starts it, the names aligned on the longest, and how to add and inspect a pack. An added pack also names the npm package and version it came from. */
export function packLines(packs: readonly Pack[]): string[] {
  const width = Math.max(0, ...packs.map(({ manifest }) => manifest.name.length));
  const lines = packs.map((pack) => {
    const { manifest, origin } = pack;
    const sentence = /[.!?]$/.test(manifest.summary) ? manifest.summary : `${manifest.summary}.`;
    const source = origin.kind === "installed" ? ` From npm: ${origin.package} ${origin.version}.` : "";
    return `  ${manifest.name.padEnd(width)}  ${sentence}${source} Start it with: delivery review ${manifest.name}`;
  });
  return ["Packs you can use:", ...lines, "", "To use a pack folder of your own, list it under packs in delivery.config.json.", ADD_HINT, INSPECT_HINT];
}

/** `delivery packs`: every pack you can use, the built-in ones and any the project lists, each with its sentence and the command that starts it; as data with `--json`; or the pack format's schema with `--schema`. */
export async function packsCommand(options: PacksOptions, ctx: CommandContext): Promise<ExitCode> {
  if (options.schema === true) {
    ctx.writeLine(JSON.stringify(packSchema(), null, 2));
    return EXIT.ok;
  }
  const packs = await projectPacksFor(ctx);
  if (ctx.json) {
    ctx.writeLine(JSON.stringify({ packs: packs.map(({ manifest }) => ({ name: manifest.name, version: manifest.version, title: manifest.title, summary: manifest.summary })) }, null, 2));
    return EXIT.ok;
  }
  for (const line of packLines(packs)) ctx.report.note(line);
  return EXIT.ok;
}
