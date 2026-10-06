import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { messageOf } from "../gate-support.js";
import { atomicWrite } from "../journal.js";
import type { ReportDocument } from "../report/document.js";
import { quoted } from "../report/text.js";
import { prepareDeliveryDir } from "../run-location.js";
import { secretMasker } from "../packs/secrets.js";

/** Where the report of the last run is kept, as the owner would find it: relative to the repository. One fixed pair, replaced by the next run. */
export const SAVED_TEXT = ".delivery/last-report.txt";
export const SAVED_DATA = ".delivery/last-report.json";

/** The sentence a report that was saved says of its own copy. */
export const SAVED_TO = `Saved to: ${SAVED_TEXT} and ${SAVED_DATA}`;

/** The sentence said instead when the copy could not be written, with the system's own words quoted. */
export const notSaved = (err: unknown): string =>
  `This report could not be saved to ${SAVED_TEXT} and ${SAVED_DATA}. The system said: ${quoted(messageOf(err), "    ")}`;

/** Readable and writable by the user who ran the command, and nobody else: a report is as sensitive as the record it is read from. */
const OWNER_ONLY = 0o600;

const asFile = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

/**
 * Save a report as the fixed pair: the document as data, and `lines` as the
 * text a person reads. Each file is replaced whole by a rename, as the record's
 * own files are, so a reader sees the earlier report or this one and never half
 * of either. They sit in `.delivery/`, which keeps itself out of version control.
 * Throws what the file system throws; the caller says so and carries on.
 */
export async function saveReport(repoPath: string, doc: ReportDocument, lines: readonly string[]): Promise<void> {
  await prepareDeliveryDir(repoPath);
  // ponytail: two renames, so a failure between them leaves new data beside old text. Write both temporary files
  // before either rename if a half-replaced pair is ever seen.
  const mask = secretMasker(repoPath);
  await atomicWrite(join(repoPath, SAVED_DATA), mask(asFile([JSON.stringify(doc, null, 2)])), OWNER_ONLY);
  await atomicWrite(join(repoPath, SAVED_TEXT), mask(asFile(lines)), OWNER_ONLY);
}

/** Whether the saved text is exactly `lines`: the copy on disk is this very report. A check of a copy, never a reading of one: the report itself always comes from the record. */
export async function isSaved(repoPath: string, lines: readonly string[]): Promise<boolean> {
  const mask = secretMasker(repoPath);
  return readFile(join(repoPath, SAVED_TEXT), "utf-8").then(
    (text) => text === mask(asFile(lines)),
    () => false,
  );
}
