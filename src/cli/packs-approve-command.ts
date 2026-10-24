import { checkInstalledPack } from "../packs/install/installed.js";
import { fingerprintOf, putLockEntry } from "../packs/install/lock.js";
import { installedPackDir } from "../packs/install/store.js";
import { inspectionOf } from "../packs/inspection.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { addedPackNamed } from "./added-pack-lookup.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Ask } from "./init.js";
import { decideApproval } from "./pack-approval.js";
import { withDecisionOutput } from "./pack-decision.js";
import { fingerprintDiffers, nobodyToAsk } from "./packs-add-render.js";
import {
  alreadyApprovedLines,
  approvedLines,
  approveQuestion,
  missingLines,
  NOTHING_APPROVED,
  newerFormatLines,
  notApprovableLines,
  unapprovedLead,
} from "./packs-approve-render.js";
import { projectBaseline } from "./project-baseline.js";

/**
 * `delivery packs approve <name>`: approve an added pack whose record says it was not approved, after its full account is
 * shown and the owner says yes. A pack whose files differ from the record is refused: it is restored or updated instead.
 * Without a terminal nothing is asked, so nothing is approved, unless `--approve` gives the fingerprint the account shows;
 * a different fingerprint is refused. Nothing from the pack runs.
 */
export async function packsApproveCommand(name: string, ctx: CommandContext, ask: Ask, options: { approve?: string } = {}): Promise<ExitCode> {
  return withDecisionOutput(ctx, "approve", async (out) => {
    const added = await addedPackNamed(name, ctx);
    if (!added.found) return out.end("refused", added.lines, EXIT.configuration);
    const { repoPath, entry } = added;
    out.repository(repoPath);
    out.facts({ pack: name, package: { name: entry.package, version: entry.version } });

    const installed = await checkInstalledPack(repoPath, name, entry);
    if ("pack" in installed) out.facts({ fingerprint: installed.pack.hash });
    switch (installed.state) {
      case "ok":
        return out.end("unchanged", alreadyApprovedLines(name, entry.version), EXIT.ok);
      case "missing":
        return out.end("refused", missingLines(name), EXIT.configuration);
      case "newer-format":
        return out.end("refused", newerFormatLines(name), EXIT.configuration);
      case "invalid":
      case "changed":
        return out.end("refused", notApprovableLines(name), EXIT.configuration);
      case "unapproved":
        break;
    }

    const dir = installedPackDir(repoPath, name);
    const folder = await readPackFolder(dir);
    // The pack has just been read as a whole pack, so a folder that no longer reads as one has changed under this command.
    if (!folder.ok) throw new Error(`the added pack ${name} changed while it was being read`);
    out.plain(unapprovedLead(name));
    out.plain([""]);
    out.account(inspectionOf(installed.pack, await projectBaseline(ctx.cwd, ctx.env, dir), folder.files));

    const approval = await decideApproval(options.approve, installed.pack.hash, ctx, ask, approveQuestion(name));
    if (approval === "nobody") {
      out.plain([""]);
      return out.end("needs-approval", nobodyToAsk("approve", `delivery packs approve ${name}`, installed.pack.hash), EXIT.configuration);
    }
    if (approval === "differs") return out.end("fingerprint-differs", fingerprintDiffers("approve"), EXIT.configuration);
    // Unreachable under --json: a declined question is only asked at a terminal, where the plain lines are the outcome.
    if (approval === "no") return out.end("unchanged", [NOTHING_APPROVED], EXIT.ok);

    await putLockEntry(repoPath, name, { ...entry, approved: fingerprintOf(installed.pack) });
    return out.end("approved", approvedLines(name, entry.version), EXIT.ok);
  });
}
