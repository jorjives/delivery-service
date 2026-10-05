import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DamagedReview } from "../errors.js";
import { appendLine, isEnoent, MalformedLine, parseLines } from "../journal.js";
import { GateRef } from "../schema.js";
import type { WithoutAt } from "../without-at.js";

const Id = z.string().regex(/^[0-9a-f]{12}$/);
const At = z.string().datetime();

/**
 * What was decided about a review's problems, one line each, oldest first: the
 * owner's choices, `delivery fix` authorising the approved ones against the
 * project's check, and problems found already fixed before their fix started.
 * Each names concrete problem identities, so `--all` is expanded when it is
 * written and a later review can never widen it. Kept in the review's own
 * folder, outside every working copy, so no agent can write it.
 */
export const LedgerEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("decision"), at: At, ids: z.array(Id).min(1), choice: z.enum(["approve", "skip"]) }),
  z.object({ t: z.literal("authorise"), at: At, ids: z.array(Id).min(1), verify: GateRef }),
  z.object({ t: z.literal("fix_observed"), at: At, id: Id, outcome: z.literal("already_resolved"), commit: z.string().min(1) }),
]);
export type LedgerEntry = z.infer<typeof LedgerEntry>;
export type NewLedgerEntry = WithoutAt<LedgerEntry>;

const ledgerFile = (reviewDir: string): string => join(reviewDir, "log.jsonl");

export async function appendLedger(reviewDir: string, entry: NewLedgerEntry): Promise<void> {
  await appendLine(ledgerFile(reviewDir), { ...entry, at: new Date().toISOString() });
}

/** Every entry, oldest first. None before anything is decided; a damaged file is named, never guessed past. */
export async function readLedger(reviewDir: string): Promise<LedgerEntry[]> {
  const file = ledgerFile(reviewDir);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  try {
    return parseLines(raw, (value) => LedgerEntry.parse(value));
  } catch (err) {
    if (err instanceof MalformedLine) throw new DamagedReview(file);
    throw err;
  }
}

/** The problems `delivery fix` has taken on, each with the project check it was first authorised against: that check is part of the fix's identity. */
export function authorisedChecks(entries: readonly LedgerEntry[]): Map<string, GateRef> {
  const checks = new Map<string, GateRef>();
  for (const entry of entries) {
    if (entry.t !== "authorise") continue;
    for (const id of entry.ids) if (!checks.has(id)) checks.set(id, entry.verify);
  }
  return checks;
}

/** The problems found already fixed before their fix started. */
export function resolvedIds(entries: readonly LedgerEntry[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.t === "fix_observed" ? [entry.id] : [])));
}
