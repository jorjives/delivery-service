import { builtInPacks } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";

export interface PacksOptions {
  /** Print the JSON Schema of `pack.json` instead of the list. */
  schema?: boolean;
}

/** `delivery packs`: the reviews that come with the harness, each in its own plain sentence; as data with `--json`; or the pack format's schema with `--schema`. */
export async function packsCommand(options: PacksOptions, ctx: CommandContext): Promise<ExitCode> {
  if (options.schema === true) {
    ctx.writeLine(JSON.stringify(packSchema(), null, 2));
    return EXIT.ok;
  }
  const packs = await builtInPacks();
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
