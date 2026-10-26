import { fileDigests, fingerprintedFiles } from "../packs/install/digests.js";
import { fingerprintOf, readLock } from "../packs/install/lock.js";
import { readPackage } from "../packs/install/package-archive.js";
import { parsePackageSpec } from "../packs/install/pack-spec.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { refuseUnusable } from "../packs/install/installed.js";
import { installedPackDir, installPack } from "../packs/install/store.js";
import { withStagedPack } from "../packs/install/staged.js";
import { inspectionOf } from "../packs/inspection.js";
import type { Pack } from "../packs/manifest.js";
import { missingSettings } from "../packs/settings.js";
import { loadConfigAndPackStates } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Ask } from "./init.js";
import { decideApproval } from "./pack-approval.js";
import { withDecisionOutput } from "./pack-decision.js";
import { findClash } from "./pack-clash.js";
import { notRunUntilLines } from "./pack-settings-render.js";
import { withWorkflowsOf } from "./pack-workflows.js";
import { projectBaseline } from "./project-baseline.js";
import { findRepository } from "./project.js";
import {
  addedDifferently,
  clashRefusal,
  addedLines,
  addQuestion,
  alreadyAdded,
  archiveRefusal,
  fingerprintDiffers,
  foundLines,
  NOTHING_ADDED,
  nobodyToAsk,
  notInPackLines,
  packRefusal,
  shellWord,
} from "./packs-add-render.js";

/**
 * `delivery packs add <package>`: fetch a pack someone has published on npm, read its account, and keep it in the project
 * only when the owner says yes. The package is judged in a temporary folder that is removed on every path; nothing from
 * the package runs. Nothing in the project changes before the answer. Without a terminal nothing is asked, so nothing is
 * added, unless `--approve` gives the fingerprint the account shows; a different fingerprint is refused.
 */
export async function packsAddCommand(spec: string, ctx: CommandContext, ask: Ask, source: PackSource, options: { approve?: string } = {}): Promise<ExitCode> {
  return withDecisionOutput(ctx, "add", async (out) => {
    const parsed = parsePackageSpec(spec);
    const repoPath = await findRepository(ctx.cwd);
    out.repository(repoPath);
    const fetched = await source.fetch(parsed);
    out.facts({ package: { name: fetched.name, version: fetched.version } });

    const read = await readPackage(fetched.tarball);
    if (!read.ok) return out.end("refused", archiveRefusal("add", fetched.name, fetched.version, read.problem), EXIT.configuration);
    out.facts({ notInPack: { ignored: read.ignored, declares: read.declares } });

    return withStagedPack(read.packFiles, async (stagedDir, folder) => {
      if (!folder.ok) return out.end("refused", packRefusal("add", fetched.name, fetched.version, read.packPath, folder.problems, stagedDir), EXIT.configuration);

      // The pack is keyed by its own name, and the package it came from is recorded beside it, so the two can differ.
      const name = folder.pack.manifest.name;
      const pack: Pack = {
        ...folder.pack,
        dir: installedPackDir(repoPath, name),
        origin: { kind: "installed", package: fetched.name, version: fetched.version, request: parsed.request, integrity: fetched.integrity },
      };
      const fingerprint = fingerprintOf(pack);
      out.facts({ pack: name, fingerprint: pack.hash });

      // A record entry from this same package is the add's own answer; one from another package is a clash, judged below.
      const entry = (await readLock(repoPath)).packs[name];
      if (entry !== undefined && entry.package === fetched.name) {
        if (entry.fingerprint === fingerprint) return out.end("unchanged", [alreadyAdded(name, fetched.version)], EXIT.ok);
        return out.end("refused", addedDifferently(name, entry), EXIT.configuration);
      }

      // The would-be set of packs must still make one project: a clash refuses here, before anything is shown or written.
      // The added packs are judged here, not refused on load, so an unrecorded folder of this same name is the one this add replaces.
      // It is checked over the project's own settings, since the config already carries every current pack's workflows.
      const { settings, configName, packs, installed } = await loadConfigAndPackStates({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
      refuseUnusable(repoPath, installed.filter((added) => !(added.state === "unrecorded" && added.name === name)));
      // A clash already in the project is not this pack's fault: it is refused with its own sentence.
      withWorkflowsOf(settings, packs);
      const clash = findClash(settings, [...packs, pack]);
      if (clash !== undefined) return out.end("refused", clashRefusal("add", clash, repoPath), EXIT.configuration);
      const missing = missingSettings(pack, settings.packSettings?.[name]);
      out.facts({ needs: missing.map(({ setting }) => setting) });

      out.plain(foundLines(fetched, parsed));
      out.plain([""]);
      out.account(inspectionOf(pack, await projectBaseline(ctx.cwd, ctx.env, stagedDir), folder.files, null));
      const outside = notInPackLines(read);
      if (outside.length > 0) out.plain(["", ...outside]);

      const approval = await decideApproval(options.approve, pack.hash, ctx, ask, addQuestion(name, fetched.version));
      if (approval === "nobody") {
        out.plain([""]);
        return out.end("needs-approval", nobodyToAsk("add", `delivery packs add ${shellWord(spec)}`, pack.hash), EXIT.configuration);
      }
      if (approval === "differs") return out.end("fingerprint-differs", fingerprintDiffers("add"), EXIT.configuration);
      // Unreachable under --json: a declined question is only asked at a terminal, where the plain lines are the outcome.
      if (approval === "no") return out.end("unchanged", [NOTHING_ADDED], EXIT.ok);

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
      return out.end("added", [...addedLines(name, fetched.version), ...(missing.length === 0 ? [] : ["", ...notRunUntilLines(missing, configName)])], EXIT.ok);
    });
  });
}
