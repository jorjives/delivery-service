import type { LockEntry } from "../packs/install/lock.js";
import { showName } from "../packs/hidden-characters.js";
import { wrap } from "./text-wrap.js";

/** The widest a value printed on its own line is, in columns: a digest is too long to wrap by word, so it is cut to this. */
const VALUE_WIDTH = 56;

/** A long value, such as an integrity, cut into lines of at most 56 characters, each indented four spaces. */
const valueLines = (value: string): string[] => {
  const lines: string[] = [];
  for (let at = 0; at < value.length; at += VALUE_WIDTH) lines.push(`    ${value.slice(at, at + VALUE_WIDTH)}`);
  return lines;
};

/** The last sentence, by the lead: nothing is written on a restore, and nothing is changed on an update. */
const CLOSING: Record<"Not restored:" | "Not updated:", string> = {
  "Not restored:": "A published version should never change. The folder is unchanged. Do not use this pack until you know why.",
  "Not updated:": "A published version should never change. Nothing was changed. Do not use this version until you know why.",
};

/** npm now gives different bytes for the version the record holds: nothing is written, and the owner is told not to use the pack. */
export function changedAtSourceLines(lead: "Not restored:" | "Not updated:", entry: LockEntry, now: string): string[] {
  return [
    ...wrap(`${lead} npm now serves different contents for ${entry.package} ${entry.version}.`, ""),
    "  Recorded:",
    ...valueLines(entry.integrity),
    "  Now:",
    ...valueLines(showName(now)),
    ...wrap(CLOSING[lead], "  "),
  ];
}

/** The package npm gave is not the pack the record holds: the problems, when there are any, are listed between the lead and the last line. Nothing is written. */
export function unreadableLines(entry: LockEntry, problems: readonly string[]): string[] {
  return [
    ...wrap(
      `Not restored: ${entry.package} ${entry.version} is the package you added, but this delivery-service does not read it as the pack in the record.`,
      "",
    ),
    ...problems,
    ...wrap("The folder is unchanged.", "  "),
  ];
}

/** The folder is put back, as the record holds it. */
export const restoredLines = (name: string): string[] => wrap(`It matches the record. Replaced .delivery/packs/${name}.`, "");

/** The folder is put back, but the record says the pack was never approved: the one command that reads it and decides. */
export function unapprovedLines(name: string): string[] {
  return [...wrap(`The record says ${name} has not been approved. To read it and decide:`, ""), ...wrap(`delivery packs approve ${name}`, "  ")];
}
