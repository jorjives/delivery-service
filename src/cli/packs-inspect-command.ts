import { resolve } from "node:path";
import { inspectionOf, inspectionRefusal, inspectionSchema } from "../packs/inspection.js";
import { isPackPath, packNamed } from "../packs/manifest.js";
import { readPackFolder } from "../packs/pack-folder.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, Refusal, renderFailure } from "./failures.js";
import { renderInspection, renderRefusal } from "./packs-inspect-render.js";
import { projectBaseline } from "./project-baseline.js";

/** Named when `delivery packs inspect` is run with neither a pack nor `--schema`. */
export const NAME_A_PACK = "Name the pack to inspect: a name from `delivery packs`, such as deprecations, or the path to a pack folder.";

export interface PacksInspectOptions {
  /** Print the JSON Schema of the document `--json` prints, instead of an account. */
  schema?: boolean;
  /** Inspect one workflow of the pack rather than the whole pack. */
  workflow?: string;
}

/**
 * `delivery packs inspect <pack>`: the account of a pack, read from its folder; nothing is run, changed or asked. The pack is a
 * name from `delivery packs`, or a path to a folder inside or outside a project. A folder that is not a whole pack is refused.
 * With `--json` the account, or the refusal, is one document; with `--schema` the document's JSON Schema is printed and no pack is read.
 */
export async function packsInspectCommand(arg: string | undefined, options: PacksInspectOptions, ctx: CommandContext): Promise<ExitCode> {
  if (options.schema === true) {
    ctx.writeLine(JSON.stringify(inspectionSchema(), null, 2));
    return EXIT.ok;
  }
  try {
    if (arg === undefined) throw new Refusal(NAME_A_PACK, EXIT.configuration);
    const dir = isPackPath(arg) ? resolve(ctx.cwd, arg) : (await packNamed(arg)).dir;
    const read = await readPackFolder(dir);
    if (!read.ok) {
      if (ctx.json) {
        ctx.writeLine(JSON.stringify(inspectionRefusal(read.problems), null, 2));
      } else {
        for (const line of renderRefusal(dir, read.problems, ctx.cwd)) ctx.writeLine(line);
      }
      return EXIT.configuration;
    }
    const inspection = inspectionOf(read.pack, await projectBaseline(ctx.cwd, ctx.env, dir), read.files);
    if (ctx.json) {
      ctx.writeLine(JSON.stringify(inspection, null, 2));
    } else {
      for (const line of renderInspection(inspection)) ctx.writeLine(line);
    }
    return EXIT.ok;
  } catch (err) {
    const { message, exitCode } = renderFailure(err);
    if (!ctx.json || exitCode !== EXIT.configuration) throw err;
    ctx.writeLine(JSON.stringify(inspectionRefusal([{ file: null, field: err instanceof Refusal ? (err.field ?? null) : null, message }]), null, 2));
    return exitCode;
  }
}
