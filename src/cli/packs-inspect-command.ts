import { packNamed } from "../packs/manifest.js";
import { inspectionOf, NO_PROJECT } from "../packs/inspection.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { renderInspection } from "./packs-inspect-render.js";

/** `delivery packs inspect <pack>`: the account of a built-in pack, read from its folder; nothing is run, changed or asked. */
export async function packsInspectCommand(name: string, ctx: CommandContext): Promise<ExitCode> {
  const pack = await packNamed(name);
  for (const line of renderInspection(inspectionOf(pack, NO_PROJECT, []))) ctx.writeLine(line);
  return EXIT.ok;
}
