import { checkInstalledPack } from "../packs/install/installed.js";
import { fingerprintOf, putLockEntry } from "../packs/install/lock.js";
import { installedPackDir } from "../packs/install/store.js";
import { inspectionOf } from "../packs/inspection.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { addedPackNamed } from "./added-pack-lookup.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Ask } from "./init.js";
import {
  alreadyApprovedLines,
  approvedLines,
  approveQuestion,
  missingLines,
  NOTHING_APPROVED,
  nobodyToApproveLines,
  notApprovableLines,
  unapprovedLead,
} from "./packs-approve-render.js";
import { renderInspection } from "./packs-inspect-render.js";
import { projectBaseline } from "./project-baseline.js";

/**
 * `delivery packs approve <name>`: approve an added pack whose record says it was not approved, after its full account is
 * shown and the owner says yes. A pack whose files differ from the record is refused: it is restored or updated instead.
 * Nothing is approved without a terminal to ask, and nothing from the pack runs.
 */
export async function packsApproveCommand(name: string, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  const added = await addedPackNamed(name, ctx);
  if (!added.found) {
    for (const line of added.lines) ctx.writeLine(line);
    return EXIT.configuration;
  }
  const { repoPath, entry } = added;

  const installed = await checkInstalledPack(repoPath, name, entry);
  switch (installed.state) {
    case "ok":
      for (const line of alreadyApprovedLines(name, entry.version)) ctx.writeLine(line);
      return EXIT.ok;
    case "missing":
      for (const line of missingLines(name)) ctx.writeLine(line);
      return EXIT.configuration;
    case "invalid":
    case "changed":
      for (const line of notApprovableLines(name)) ctx.writeLine(line);
      return EXIT.configuration;
    case "unapproved":
      break;
  }

  if (ctx.stdin.isTTY !== true) {
    for (const line of nobodyToApproveLines()) ctx.writeLine(line);
    return EXIT.configuration;
  }

  const dir = installedPackDir(repoPath, name);
  const folder = await readPackFolder(dir);
  // The pack has just been read as a whole pack, so a folder that no longer reads as one has changed under this command.
  if (!folder.ok) throw new Error(`the added pack ${name} changed while it was being read`);
  const account = inspectionOf(installed.pack, await projectBaseline(ctx.cwd, ctx.env, dir), folder.files);
  for (const line of unapprovedLead(name)) ctx.writeLine(line);
  ctx.writeLine("");
  for (const line of renderInspection(account)) ctx.writeLine(line);

  if (!(await ask.confirm(approveQuestion(name)))) {
    ctx.writeLine(NOTHING_APPROVED);
    return EXIT.ok;
  }

  await putLockEntry(repoPath, name, { ...entry, approved: fingerprintOf(installed.pack) });
  for (const line of approvedLines(name, entry.version)) ctx.writeLine(line);
  return EXIT.ok;
}
