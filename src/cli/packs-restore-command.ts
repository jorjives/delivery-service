import { join, relative } from "node:path";
import { showName } from "../packs/hidden-characters.js";
import { fingerprintOf } from "../packs/install/lock.js";
import { readPackage } from "../packs/install/package-archive.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { restorePackFolder } from "../packs/install/store.js";
import { withStagedPack } from "../packs/install/staged.js";
import { addedPackNamed } from "./added-pack-lookup.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { fetchFor } from "./pack-fetch.js";
import { problemLines } from "./packs-inspect-render.js";
import { wrap } from "./text-wrap.js";
import { changedAtSourceLines, restoredLines, unapprovedLines, unreadableLines } from "./packs-restore-render.js";

/**
 * `delivery packs restore <name>`: fetch an added pack again at the version its record holds, and put its files back when the
 * package still matches the record. Nothing is written unless it does, and nothing from the package runs. The record is left as it stands.
 */
export async function packsRestoreCommand(name: string, ctx: CommandContext, source: PackSource): Promise<ExitCode> {
  const added = await addedPackNamed(name, ctx);
  if (!added.found) {
    for (const line of added.lines) ctx.writeLine(line);
    return EXIT.configuration;
  }
  const { repoPath, entry } = added;

  const refuse = (problems: readonly string[]): ExitCode => {
    for (const line of unreadableLines(entry, problems)) ctx.writeLine(line);
    return EXIT.configuration;
  };

  for (const line of wrap(`Fetching ${entry.package} ${entry.version} again.`, "")) ctx.writeLine(line);
  const fetched = await fetchFor(source, { name: entry.package, request: entry.version, typed: true }, "restore");
  if (fetched.integrity !== entry.integrity) {
    for (const line of changedAtSourceLines("Not restored:", entry, fetched.integrity)) ctx.writeLine(line);
    return EXIT.configuration;
  }

  const read = await readPackage(fetched.tarball);
  if (!read.ok) {
    return refuse(wrap(`${read.problem.entry == null ? "The package" : showName(read.problem.entry)} ${read.problem.message}.`, "  ", "    "));
  }

  return withStagedPack(read.packFiles, async (stagedDir, folder) => {
    // Each problem is named by its path inside the package, which is the pack folder's path plus the file's.
    const inPackage = (file: string): string => (read.packPath === "." ? showName(relative(stagedDir, file)) : showName(`${read.packPath}/${relative(stagedDir, file)}`));
    if (!folder.ok) return refuse(problemLines(folder.problems, inPackage));
    const manifestName = folder.pack.manifest.name;
    if (manifestName !== name) {
      const problem = { file: join(stagedDir, "pack.json"), field: "name", message: `"name" is "${showName(manifestName)}", but the record keeps this pack as ${showName(name)}` };
      return refuse(problemLines([problem], inPackage));
    }
    if (fingerprintOf(folder.pack) !== entry.fingerprint) return refuse([]);

    await restorePackFolder(repoPath, name, read.packFiles);
    for (const line of restoredLines(name)) ctx.writeLine(line);
    if (entry.approved !== entry.fingerprint) {
      for (const line of unapprovedLines(name)) ctx.writeLine(line);
    }
    return EXIT.ok;
  });
}
