import { dirname } from "node:path";
import type { Pack } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { type DeliveryConfig, findConfig, readConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, Refusal } from "./failures.js";
import { projectPacks, withWorkflowsOf } from "./pack-workflows.js";
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
  const file = findConfig({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
  const config: DeliveryConfig = file === undefined ? {} : await readConfig(file);
  const packs = await projectPacks(config, file === undefined ? repoPath : dirname(file));
  withWorkflowsOf(config, packs);
  return packs;
}

/** `delivery packs`: the reviews that come with the harness, and any the project lists, each in its own plain sentence; as data with `--json`; or the pack format's schema with `--schema`. */
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
  const say = (line: string): void => ctx.report.note(line);
  say("These reviews are available:");
  for (const { manifest } of packs) say(`  ${manifest.name}: ${manifest.summary}`);
  say("");
  say(`Run one with: delivery review ${packs[0]?.manifest.name ?? "code"}`);
  say("Or use a review folder of your own: list it under packs in delivery.config.json, then delivery review <its name>");
  return EXIT.ok;
}
