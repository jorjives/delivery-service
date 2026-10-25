import { showName } from "../packs/hidden-characters.js";
import type { ConfirmQuestion } from "./init.js";
import { wrap } from "./text-wrap.js";

/** The last line of a refusal that changed nothing. */
const NOTHING_CHANGED = "Nothing was changed.";

/** The last line when the owner says no. */
export const NOTHING_APPROVED = "Nothing was approved.";

/** The question that asks whether the owner approves the pack at the fingerprint of the account just shown. */
export const approveQuestion = (name: string): ConfirmQuestion => ({ message: `Approve ${showName(name)} at this fingerprint?`, default: false });

/** The pack is already approved as the record holds it: nothing to do. */
export const alreadyApprovedLines = (name: string, version: string): string[] =>
  wrap(`${showName(name)} is already approved at ${showName(version)}. Nothing to do.`, "");

/** The pack's files are gone: the one command that fetches them again. */
export const missingLines = (name: string): string[] => [
  ...wrap(`Cannot approve ${showName(name)}: its files are missing.`, ""),
  `  To fetch them again:  delivery packs restore ${showName(name)}`,
];

/** The pack is kept in a newer pack format than this delivery-service reads: only an upgrade of delivery-service reads it. */
export const newerFormatLines = (name: string): string[] => [
  ...wrap(`Cannot approve ${showName(name)}: it is kept in a newer pack format than this delivery-service reads.`, ""),
  ...wrap("Upgrade delivery-service to read it.", "  "),
  ...wrap(NOTHING_CHANGED, "  "),
];

/** The pack's files differ from the record: approving local edits is not possible, so the owner restores or updates the pack. */
export const notApprovableLines = (name: string): string[] => [
  ...wrap(`Cannot approve ${showName(name)}: its files are not the ones in the record. Approving local edits is not possible.`, ""),
  `  To go back:        delivery packs restore ${showName(name)}`,
  `  To take a new one:  delivery packs update ${showName(name)}`,
];

/** The first line before the account of an unapproved pack: what the record says, and that the owner must read it. */
export const unapprovedLead = (name: string): string[] =>
  wrap(`The record says ${showName(name)} has not been approved. Read it before you answer.`, "");

/** What was approved, where the record is, and what to do with it. */
export const approvedLines = (name: string, version: string): string[] => [
  `Approved ${showName(name)} ${showName(version)}.`,
  "  Recorded: .delivery/packs.lock.json",
  "Commit it, so everyone runs this same pack.",
];
