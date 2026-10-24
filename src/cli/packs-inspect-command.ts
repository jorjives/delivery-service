import { resolve } from "node:path";
import { inspectionOf } from "../packs/inspection.js";
import { isPackPath, packNamed } from "../packs/manifest.js";
import { readPackFolder } from "../packs/pack-folder.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { renderInspection, renderRefusal } from "./packs-inspect-render.js";
import { projectBaseline } from "./project-baseline.js";

/**
 * `delivery packs inspect <pack>`: the account of a pack, read from its folder; nothing is run, changed or asked. The pack is a
 * name from `delivery packs`, or a path to a folder inside or outside a project. A folder that is not a whole pack is refused.
 */
export async function packsInspectCommand(arg: string, ctx: CommandContext): Promise<ExitCode> {
  const dir = isPackPath(arg) ? resolve(ctx.cwd, arg) : (await packNamed(arg)).dir;
  const read = await readPackFolder(dir);
  if (!read.ok) {
    for (const line of renderRefusal(dir, read.problems, ctx.cwd)) ctx.writeLine(line);
    return EXIT.configuration;
  }
  for (const line of renderInspection(inspectionOf(read.pack, await projectBaseline(ctx.cwd, ctx.env, dir), read.files))) ctx.writeLine(line);
  return EXIT.ok;
}
