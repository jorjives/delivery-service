import { showName } from "../packs/hidden-characters.js";
import { sortKeys } from "../packs/install/lock.js";
import type { InstalledPack } from "../packs/install/installed.js";
import type { Pack } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { refuseUnusable } from "../packs/install/installed.js";
import { loadConfigAndPackStates, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, Refusal } from "./failures.js";
import { stateNote } from "./installed-render.js";
import { installedNeeds, needsOf, packsListing } from "./packs-listing.js";
import { projectPacks, withWorkflowsOf } from "./pack-workflows.js";
import { findRepository } from "./project.js";

export interface PacksOptions {
  /** Print the JSON Schema of `pack.json` instead of the list. */
  schema?: boolean;
}

/** The repository the command in `ctx` is in, or undefined outside one. */
async function repositoryOf(ctx: CommandContext): Promise<string | undefined> {
  return findRepository(ctx.cwd).catch((error: unknown) => {
    if (error instanceof Refusal) return undefined;
    throw error;
  });
}

/** The packs the command in `ctx` can use: the built-in ones, and in a project, the ones it lists and the ones it added. Outside a repository there is no project, so only the built-in ones. Refuses an added pack that is not as approved, or a clash; a setting problem never refuses, and a pack with one is returned unbound, so its owner can reach the command that says what to set. */
export async function projectPacksFor(ctx: CommandContext): Promise<Pack[]> {
  const repoPath = await repositoryOf(ctx);
  if (repoPath === undefined) return projectPacks({}, ctx.cwd, undefined);
  const { settings, packs, installed } = await loadConfigAndPackStates({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
  refuseUnusable(repoPath, installed);
  withWorkflowsOf(settings, packs);
  return packs;
}

/** The packs the plain listing shows, every added pack's state, and the owner's pack settings. Refuses no state, so the listing can say what stops a pack; a clash between packs still refuses. */
async function packStatesFor(ctx: CommandContext): Promise<{ packs: Pack[]; installed: InstalledPack[]; packSettings: NonNullable<DeliveryConfig["packSettings"]> }> {
  const repoPath = await repositoryOf(ctx);
  if (repoPath === undefined) return { packs: await projectPacks({}, ctx.cwd, undefined), installed: [], packSettings: {} };
  const { settings, packs, installed } = await loadConfigAndPackStates({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
  withWorkflowsOf(settings, packs);
  return { packs, installed, packSettings: settings.packSettings ?? {} };
}

/** The line after the folder hint: how to add a pack someone has published on npm. */
export const ADD_HINT = "To add a pack someone has published on npm: delivery packs add <package>";

/** The last line of the plain listing: how to see what a pack will do before using it. */
export const INSPECT_HINT = "See exactly what a pack will do: delivery packs inspect <name>";

const sentenceOf = (summary: string): string => (/[.!?]$/.test(summary) ? summary : `${summary}.`);

/** The line under a row that needs settings: its name column left blank, then the settings it has no value for. Nothing when it needs none. */
function needsLine(needs: readonly string[], width: number): string[] {
  if (needs.length === 0) return [];
  return [`  ${"".padEnd(width)}  ${needs.length === 1 ? "needs setting" : "needs settings"}: ${needs.join(", ")}`];
}

/** One row for an added pack: its name, its sentence when it can be read, the npm package and version it came from, and its state. An unrecorded folder has no record, so no source. */
function installedRow(pack: InstalledPack, width: number): string {
  const name = showName(pack.name).padEnd(width);
  if (pack.state === "unrecorded") return `  ${name}  ${stateNote(pack)}`;
  const summary = pack.state === "ok" ? `${sentenceOf(pack.pack.manifest.summary)} ` : "";
  return `  ${name}  ${summary}From npm: ${showName(pack.entry.package)} ${showName(pack.entry.version)}. ${stateNote(pack)}`;
}

/** The lines `delivery packs` prints: each pack with its sentence and the command that starts it, each added pack with its state, a line under each pack that needs a setting, the names aligned on the longest, and how to add and inspect a pack. */
export function packLines(packs: readonly Pack[], installed: readonly InstalledPack[] = [], packSettings: DeliveryConfig["packSettings"] = {}): string[] {
  const width = Math.max(0, ...packs.map(({ manifest }) => manifest.name.length), ...installed.map(({ name }) => showName(name).length));
  const listed = packs
    .filter(({ origin }) => origin.kind !== "installed")
    .flatMap((pack) => {
      const { manifest } = pack;
      return [`  ${manifest.name.padEnd(width)}  ${sentenceOf(manifest.summary)} Start it with: delivery review ${manifest.name}`, ...needsLine(needsOf(pack, packSettings), width)];
    });
  const added = installed.flatMap((pack) => [installedRow(pack, width), ...needsLine(installedNeeds(pack, packSettings), width)]);
  return ["Packs you can use:", ...listed, ...added, "", "To use a pack folder of your own, list it under packs in delivery.config.json.", ADD_HINT, INSPECT_HINT];
}

/** `delivery packs`: every pack you can use, the built-in ones and any the project lists, each with its sentence and the command that starts it; as data with `--json`; or the pack format's schema with `--schema`. */
export async function packsCommand(options: PacksOptions, ctx: CommandContext): Promise<ExitCode> {
  if (options.schema === true) {
    ctx.writeLine(JSON.stringify(packSchema(), null, 2));
    return EXIT.ok;
  }
  const { packs, installed, packSettings } = await packStatesFor(ctx);
  if (ctx.json) {
    ctx.writeLine(JSON.stringify(sortKeys(packsListing(packs, installed, packSettings)), null, 2));
    return EXIT.ok;
  }
  for (const line of packLines(packs, installed, packSettings)) ctx.report.note(line);
  return EXIT.ok;
}
