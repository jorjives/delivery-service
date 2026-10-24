import { relative } from "node:path";
import { showName } from "../packs/hidden-characters.js";
import type { InstalledPack, UnusableInstalledPack } from "../packs/install/installed.js";
import { problemLines, wrap } from "./packs-inspect-render.js";

const NOTHING_SENT = "Nothing was sent to an agent.";

/** The command the owner runs, on a line of its own. */
const command = (text: string): string[] => wrap(text, "  ");

/** Each changed file, named relative to the pack's folder as the record names it. */
const changedLines = (name: string, changed: readonly string[]): string[] =>
  changed.length === 0
    ? wrap("Its files do not match the fingerprint in the record.", "  ")
    : changed.flatMap((path) => wrap(`Changed: .delivery/packs/${name}/${showName(path)}`, "  ", "    "));

/** The note that ends one row of `delivery packs`: the state, and the one command that fixes it, or that starts an approved pack. One line. Pure: no I/O. */
export function stateNote(pack: InstalledPack): string {
  const name = showName(pack.name);
  switch (pack.state) {
    case "ok":
      return `As approved. Start it with: delivery review ${name}`;
    case "missing":
      return `Its files are missing. Will not run. To fix: delivery packs restore ${name}`;
    case "invalid":
      return `Does not read as a pack. Will not run. To fix: delivery packs restore ${name}`;
    case "changed":
      return `Changed since approved. Will not run. To fix: delivery packs restore ${name}`;
    case "unapproved":
      return `Not approved. Will not run. To decide: delivery packs approve ${name}`;
    case "unrecorded":
      return `Not in the record. Will not run. Add it again, or remove .delivery/packs/${name}`;
  }
}

/**
 * What an owner reads for one added pack that is not as the record approved it: its state, the file or version that is
 * concerned, that nothing was sent to an agent, and the one command that fixes it. Pure: no I/O.
 */
export function refusedLines(repoPath: string, pack: UnusableInstalledPack): string[] {
  const name = showName(pack.name);
  switch (pack.state) {
    case "missing":
      return [
        ...wrap(`The pack ${name} is in this project's record, but its files are missing.`, ""),
        ...wrap(NOTHING_SENT, "  "),
        ...wrap(`To fetch it again at ${showName(pack.entry.version)}, checked against the record:`, ""),
        ...command(`delivery packs restore ${name}`),
      ];
    case "invalid":
      return [
        ...wrap(`The pack ${name} is not as you approved it, and its folder does not read as a pack.`, ""),
        ...problemLines(pack.problems, (file) => showName(relative(repoPath, file))),
        ...wrap(NOTHING_SENT, "  "),
        ...wrap("To put back the approved pack:", ""),
        ...command(`delivery packs restore ${name}`),
      ];
    case "changed":
      return [
        ...wrap(`The pack ${name} is not as you approved it.`, ""),
        ...wrap(`Approved: ${showName(pack.entry.version)}, from ${showName(pack.entry.package)}`, "  "),
        ...changedLines(name, pack.changed),
        ...wrap(NOTHING_SENT, "  "),
        ...wrap("To go back to the approved pack:", ""),
        ...command(`delivery packs restore ${name}`),
      ];
    case "unapproved":
      return [
        ...wrap(`The pack ${name} is in the record but has not been approved.`, ""),
        ...wrap(NOTHING_SENT, "  "),
        ...wrap("To read it and decide:", ""),
        ...command(`delivery packs approve ${name}`),
      ];
    case "unrecorded":
      return [
        ...wrap(`The folder .delivery/packs/${name} has no entry in the record, .delivery/packs.lock.json.`, ""),
        ...wrap(NOTHING_SENT, "  "),
        ...wrap("Add it again with delivery packs add <package>, or remove the folder.", ""),
      ];
  }
}

/** The line that says a name is not one of the added packs, with the ones that are. Pure: no I/O. */
export function notAddedLines(name: string, added: readonly string[]): string[] {
  const names = [...added].sort().map(showName);
  return wrap(`${showName(name)} is not an added pack. Added: ${names.length === 0 ? "none" : names.join(", ")}.`, "");
}
