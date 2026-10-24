import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileDigests, fingerprintedFiles } from "../packs/install/digests.js";
import { fingerprintOf, readLock } from "../packs/install/lock.js";
import { readPackage } from "../packs/install/package-archive.js";
import { parsePackageSpec } from "../packs/install/pack-spec.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { installedPackDir, installPack, writePackFiles } from "../packs/install/store.js";
import { inspectionOf } from "../packs/inspection.js";
import type { Pack } from "../packs/manifest.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { loadConfigAndPacks } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Ask } from "./init.js";
import { withWorkflowsOf } from "./pack-workflows.js";
import { projectBaseline } from "./project-baseline.js";
import { findRepository } from "./project.js";
import { renderInspection } from "./packs-inspect-render.js";
import {
  addedDifferently,
  addedLines,
  addQuestion,
  alreadyAdded,
  archiveRefusal,
  foundLines,
  NOTHING_ADDED,
  nobodyToAsk,
  notInPackLines,
  packRefusal,
} from "./packs-add-render.js";

/**
 * `delivery packs add <package>`: fetch a pack someone has published on npm, read its account, and keep it in the project
 * only when the owner says yes. The package is judged in a temporary folder that is removed on every path; nothing from
 * the package runs. Nothing in the project changes before the answer, and without a terminal nothing is asked, so nothing is added.
 */
export async function packsAddCommand(spec: string, ctx: CommandContext, ask: Ask, source: PackSource): Promise<ExitCode> {
  const parsed = parsePackageSpec(spec);
  const repoPath = await findRepository(ctx.cwd);
  const fetched = await source.fetch(parsed);

  const read = await readPackage(fetched.tarball);
  if (!read.ok) {
    for (const line of archiveRefusal(fetched.name, fetched.version, read.problem)) ctx.writeLine(line);
    return EXIT.configuration;
  }

  const temp = await mkdtemp(join(tmpdir(), "delivery-pack-"));
  try {
    const stagedDir = join(temp, "pack");
    await writePackFiles(stagedDir, read.packFiles);
    const folder = await readPackFolder(stagedDir);
    if (!folder.ok) {
      for (const line of packRefusal(fetched.name, fetched.version, read.packPath, folder.problems, stagedDir)) ctx.writeLine(line);
      return EXIT.configuration;
    }

    // The pack is keyed by its own name, and the package it came from is recorded beside it, so the two can differ.
    const name = folder.pack.manifest.name;
    const pack: Pack = {
      ...folder.pack,
      dir: installedPackDir(repoPath, name),
      origin: { kind: "installed", package: fetched.name, version: fetched.version, request: parsed.request, integrity: fetched.integrity },
    };
    const fingerprint = fingerprintOf(pack);
    const entry = (await readLock(repoPath)).packs[name];
    if (entry !== undefined) {
      if (entry.fingerprint === fingerprint && entry.package === fetched.name) {
        ctx.writeLine(alreadyAdded(name, fetched.version));
        return EXIT.ok;
      }
      for (const line of addedDifferently(name, entry)) ctx.writeLine(line);
      return EXIT.configuration;
    }

    // The would-be set of packs must still make one project: a clash refuses here, before anything is shown or written.
    // It is checked over the project's own settings, since the config already carries every current pack's workflows.
    const { settings, packs } = await loadConfigAndPacks({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
    withWorkflowsOf(settings, [...packs, pack]);

    for (const line of foundLines(fetched, parsed)) ctx.writeLine(line);
    ctx.writeLine("");
    const account = inspectionOf(pack, await projectBaseline(ctx.cwd, ctx.env, stagedDir), folder.files);
    for (const line of renderInspection(account)) ctx.writeLine(line);
    const outside = notInPackLines(read);
    if (outside.length > 0) {
      ctx.writeLine("");
      for (const line of outside) ctx.writeLine(line);
    }

    if (ctx.stdin.isTTY !== true) {
      ctx.writeLine("");
      for (const line of nobodyToAsk()) ctx.writeLine(line);
      return EXIT.configuration;
    }
    if (!(await ask.confirm(addQuestion(name, fetched.version)))) {
      ctx.writeLine(NOTHING_ADDED);
      return EXIT.ok;
    }

    await installPack(repoPath, name, read.packFiles, {
      source: "npm",
      package: fetched.name,
      request: parsed.request,
      version: fetched.version,
      integrity: fetched.integrity,
      fingerprint,
      approved: fingerprint,
      files: await fileDigests(stagedDir, fingerprintedFiles(pack)),
    });
    for (const line of addedLines(name, fetched.version)) ctx.writeLine(line);
    return EXIT.ok;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
