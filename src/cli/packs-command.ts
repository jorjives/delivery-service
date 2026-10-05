import { builtInPacks } from "../packs/manifest.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";

/** `delivery packs`: the reviews that come with the harness, each in its own plain sentence. */
export async function packsCommand(ctx: CommandContext): Promise<ExitCode> {
  const packs = await builtInPacks();
  const say = (line: string): void => ctx.report.note(line);
  say("These reviews are available:");
  for (const { manifest } of packs) say(`  ${manifest.name}: ${manifest.summary}`);
  say("");
  say(`Run one with: delivery review ${packs[0]?.manifest.name ?? "code"}`);
  say("Or run a review from a folder of your own: delivery review ./path-to-the-folder");
  return EXIT.ok;
}
