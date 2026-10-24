import { comparePacks } from "../packs/install/compare.js";
import { fileDigests, fingerprintedFiles } from "../packs/install/digests.js";
import { checkInstalledPack, refuseUnusable } from "../packs/install/installed.js";
import { diffPackFiles } from "../packs/install/file-diff.js";
import { fingerprintOf } from "../packs/install/lock.js";
import { readPackage } from "../packs/install/package-archive.js";
import { PACKAGE_REQUEST, type PackageSpec } from "../packs/install/pack-spec.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { installedPackDir, installPack } from "../packs/install/store.js";
import { withStagedPack } from "../packs/install/staged.js";
import { inspectionOf } from "../packs/inspection.js";
import type { Pack } from "../packs/manifest.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { addedPackNamed } from "./added-pack-lookup.js";
import { loadConfigAndPackStates } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Ask } from "./init.js";
import { findClash } from "./pack-clash.js";
import { fetchFor } from "./pack-fetch.js";
import { projectBaseline } from "./project-baseline.js";
import { archiveRefusal, clashRefusal, nobodyToAsk, packRefusal } from "./packs-add-render.js";
import { changedAtSourceLines } from "./packs-restore-render.js";
import {
  badRequestLines,
  changedLinesBlock,
  filesLines,
  headlineLines,
  keptDiffersLines,
  lookupLines,
  NOTHING_UPDATED,
  notUpdatableLines,
  renamedLines,
  sameContentLines,
  stateHintLines,
  summaryLines,
  updatedLines,
  updateQuestion,
  upToDateLines,
} from "./packs-update-render.js";
import { withWorkflowsOf } from "./pack-workflows.js";

/**
 * `delivery packs update <name> [request]`: fetch the version an added pack's record asks for now, or the one the owner names,
 * and show what changes before anything is written: in short, the instruction files, and the changed lines. The new version
 * replaces the kept folder and the record entry only on a yes. Nothing from the package runs, and a refusal changes nothing.
 */
export async function packsUpdateCommand(name: string, request: string | undefined, ctx: CommandContext, ask: Ask, source: PackSource): Promise<ExitCode> {
  const out = (lines: readonly string[]): void => {
    for (const line of lines) ctx.writeLine(line);
  };
  const added = await addedPackNamed(name, ctx);
  if (!added.found) {
    for (const line of added.lines) ctx.writeLine(line);
    return EXIT.configuration;
  }
  const { repoPath, entry } = added;

  if (request !== undefined && !PACKAGE_REQUEST.test(request)) {
    out(badRequestLines(request));
    return EXIT.configuration;
  }

  const installed = await checkInstalledPack(repoPath, name, entry);
  if (installed.state === "missing" || installed.state === "invalid" || installed.state === "newer-format") {
    out(notUpdatableLines(name, installed.state));
    return EXIT.configuration;
  }

  const spec: PackageSpec = { name: entry.package, request: request ?? entry.request, typed: request !== undefined };
  // The first line of the lookup says what is asked for, so it is shown before npm answers; the rest says what npm found.
  out(lookupLines(entry.package, spec.request, "", entry.version).slice(0, 1));
  const fetched = await fetchFor(source, spec, "update");

  if (fetched.integrity === entry.integrity) {
    out(upToDateLines(name, entry.version, spec.request));
    out(stateHintLines(name, installed.state));
    return EXIT.ok;
  }
  if (fetched.version === entry.version) {
    out(changedAtSourceLines("Not updated:", entry, fetched.integrity));
    return EXIT.configuration;
  }

  const read = await readPackage(fetched.tarball);
  if (!read.ok) {
    out(archiveRefusal("update", fetched.name, fetched.version, read.problem));
    return EXIT.configuration;
  }

  return withStagedPack(read.packFiles, async (stagedDir, folder) => {
    if (!folder.ok) {
      out(packRefusal("update", fetched.name, fetched.version, read.packPath, folder.problems, stagedDir));
      return EXIT.configuration;
    }
    const newName = folder.pack.manifest.name;
    if (newName !== name) {
      out(renamedLines(name, fetched.name, fetched.version, newName));
      return EXIT.configuration;
    }

    const newPack: Pack = {
      ...folder.pack,
      dir: installedPackDir(repoPath, name),
      origin: { kind: "installed", package: fetched.name, version: fetched.version, request: spec.request, integrity: fetched.integrity },
    };
    const fingerprint = fingerprintOf(newPack);
    if (fingerprint === entry.fingerprint) {
      out(sameContentLines(name, entry.version, fetched.version));
      out(stateHintLines(name, installed.state));
      return EXIT.ok;
    }

    // The would-be set of packs must still make one project: a clash refuses here, before anything is shown or written.
    // The pack being replaced is left out, since the new version takes its place.
    const { settings, packs, installed: states } = await loadConfigAndPackStates({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
    refuseUnusable(repoPath, states.filter((added) => added.name !== name));
    const others = packs.filter((pack) => !(pack.origin.kind === "installed" && pack.manifest.name === name));
    withWorkflowsOf(settings, others);
    const clash = findClash(settings, [...others, newPack]);
    if (clash !== undefined) {
      out(clashRefusal("update", clash, repoPath));
      return EXIT.configuration;
    }

    // Both sides are judged against the same project baseline, so the project's own settings never show as a pack change.
    const baseline = await projectBaseline(ctx.cwd, ctx.env, stagedDir);
    const keptDir = installedPackDir(repoPath, name);
    const kept = await readPackFolder(keptDir);
    if (!kept.ok) throw new Error(`${name} was read as a pack a moment ago, and is not one now`);
    const before = inspectionOf({ ...kept.pack, origin: { kind: "installed", package: entry.package, version: entry.version, request: entry.request, integrity: entry.integrity } }, baseline, kept.files);
    const after = inspectionOf(newPack, baseline, folder.files);
    const diffs = await diffPackFiles(keptDir, fingerprintedFiles(kept.pack), stagedDir, fingerprintedFiles(newPack));

    out(lookupLines(entry.package, spec.request, fetched.version, entry.version).slice(1));
    ctx.writeLine("");
    out(headlineLines(name, { version: entry.version, hash: before.pack.hash }, { version: fetched.version, hash: after.pack.hash }));
    if (installed.state === "changed") out(keptDiffersLines());
    ctx.writeLine("");
    out(summaryLines(comparePacks(before, after), after));
    ctx.writeLine("");
    out(filesLines(diffs));
    ctx.writeLine("");
    out(changedLinesBlock(diffs));

    if (ctx.stdin.isTTY !== true) {
      ctx.writeLine("");
      out(nobodyToAsk("update"));
      return EXIT.configuration;
    }
    if (!(await ask.confirm(updateQuestion(name, entry.version, fetched.version)))) {
      ctx.writeLine(NOTHING_UPDATED);
      return EXIT.ok;
    }

    await installPack(repoPath, name, read.packFiles, {
      ...entry,
      request: spec.request,
      version: fetched.version,
      integrity: fetched.integrity,
      fingerprint,
      approved: fingerprint,
      files: await fileDigests(stagedDir, fingerprintedFiles(newPack)),
    });
    out(updatedLines(name, fetched.version));
    return EXIT.ok;
  });
}
