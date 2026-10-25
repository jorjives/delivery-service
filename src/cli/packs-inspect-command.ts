import { resolve } from "node:path";
import { type Inspection, inspectionOf, inspectionRefusal, inspectionSchema, narrowedTo } from "../packs/inspection.js";
import { builtInPacks, isPackPath, type Pack, packNamed } from "../packs/manifest.js";
import { readPackFolder } from "../packs/pack-folder.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, Refusal, renderFailure } from "./failures.js";
import { inspectedProject } from "./inspected-project.js";
import { renderInspection, renderRefusal } from "./packs-inspect-render.js";
import { projectPacksFor } from "./packs-command.js";

/** Named when `delivery packs inspect` is run with neither a pack nor `--schema`. */
export const NAME_A_PACK = "Name the pack to inspect: a name from `delivery packs`, such as deprecations, or the path to a pack folder.";

/** Named when `--workflow` names a workflow the pack does not have: the names it does have, in manifest order. */
export const unknownWorkflow = (name: string, pack: string, locals: readonly string[]): string =>
  `There is no workflow called "${name}" in the ${pack} pack. Its workflows are: ${locals.join(", ")}.`;

/** The inspection narrowed to the named workflow; a name the pack does not have is refused, with the names it does have. */
function shownWorkflow(whole: Inspection, name: string): Inspection {
  const narrowed = narrowedTo(whole, name);
  if (narrowed === null) throw new Refusal(unknownWorkflow(name, whole.pack.name, whole.workflows.map(({ local }) => local)), EXIT.configuration, "workflow");
  return narrowed;
}

/**
 * The pack a name refers to. A built-in name is found among the built-in packs, which need no project, so inspecting one
 * starts no process; a built-in name cannot be shadowed by a project's pack. Any other name is looked for among the project's packs.
 */
async function namedPack(name: string, ctx: CommandContext): Promise<Pack> {
  const builtIns = await builtInPacks();
  if (builtIns.some(({ manifest }) => manifest.name === name)) return packNamed(name, builtIns);
  return packNamed(name, await projectPacksFor(ctx));
}

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
    const named = isPackPath(arg) ? undefined : await namedPack(arg, ctx);
    const dir = named === undefined ? resolve(ctx.cwd, arg) : named.dir;
    const read = await readPackFolder(dir);
    if (!read.ok) {
      if (ctx.json) {
        ctx.writeLine(JSON.stringify(inspectionRefusal(read.problems), null, 2));
      } else {
        for (const line of renderRefusal(dir, read.problems, ctx.cwd)) ctx.writeLine(line);
      }
      return EXIT.configuration;
    }
    const pack = named === undefined ? read.pack : { ...read.pack, origin: named.origin };
    const { project, values, configName } = await inspectedProject(ctx.cwd, ctx.env, pack);
    const whole = inspectionOf(pack, project, read.files, values);
    const inspection = options.workflow === undefined ? whole : shownWorkflow(whole, options.workflow);
    if (ctx.json) {
      ctx.writeLine(JSON.stringify(inspection, null, 2));
    } else {
      for (const line of renderInspection(inspection, configName)) ctx.writeLine(line);
    }
    return EXIT.ok;
  } catch (err) {
    const { message, exitCode } = renderFailure(err);
    if (!ctx.json || exitCode !== EXIT.configuration) throw err;
    ctx.writeLine(JSON.stringify(inspectionRefusal([{ file: null, field: err instanceof Refusal ? (err.field ?? null) : null, message }]), null, 2));
    return exitCode;
  }
}
