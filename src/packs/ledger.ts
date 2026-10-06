import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DamagedReview } from "../errors.js";
import { appendLine, isEnoent, MalformedLine, parseLines } from "../journal.js";
import { CloserRef, GateRef } from "../schema.js";
import type { WithoutAt } from "../without-at.js";
import { GuardLists } from "./guards.js";
import { Severity } from "./finding.js";

const Id = z.string().regex(/^[0-9a-f]{12}$/);
const At = z.string().datetime();

/** Why a signed-off fix could not be merged. Closed, so the words for it are total. */
export const NOT_LANDED_REASONS = ["conflict", "check_failed", "check_error", "not_merged", "branch_gone"] as const;
export type NotLandedReason = (typeof NOT_LANDED_REASONS)[number];

/**
 * What was decided about a review's problems, one line each, oldest first: the
 * owner's choices, `delivery fix` authorising the approved ones against the
 * project's check, problems found already fixed before their fix started, and
 * the owner's sign-off or refusal of a kept fix and what came of it.
 * Each names concrete problem identities, so `--all` is expanded when it is
 * written and a later review can never widen it. Kept in the review's own
 * folder, outside every working copy, so no agent can write it.
 */
export const LedgerEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("decision"), at: At, ids: z.array(Id).min(1), choice: z.enum(["approve", "skip"]) }),
  z.object({
    t: z.literal("authorise"),
    at: At,
    ids: z.array(Id).min(1),
    verify: GateRef,
    guards: GuardLists.optional(),
    /** The pack's threshold when this was written, and what it decided for each problem: computed once, never again. */
    threshold: Severity.nullable().optional(),
    hold: z.record(Id, z.boolean()).optional(),
    /** How a fix lands once it may: the project's closer, pinned. */
    landing: CloserRef.optional(),
  }),
  z.object({ t: z.literal("fix_observed"), at: At, id: Id, outcome: z.literal("already_resolved"), commit: z.string().min(1) }),
  z.object({ t: z.literal("signed_off"), at: At, id: Id }),
  z.object({ t: z.literal("rejected"), at: At, id: Id }),
  z.object({ t: z.literal("landed"), at: At, id: Id, commit: z.string().min(1), closer: CloserRef }),
  z.object({ t: z.literal("not_landed"), at: At, id: Id, reason: z.enum(NOT_LANDED_REASONS), detail: z.string() }),
]);
export type LedgerEntry = z.infer<typeof LedgerEntry>;
export type NewLedgerEntry = WithoutAt<LedgerEntry>;

/** What came of a kept fix, as the owner decided it: declined, merged, or signed off and not merged. */
export type SignOffResult = Extract<LedgerEntry, { t: "rejected" | "landed" | "not_landed" }>;

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

/** What `delivery fix` was authorised to do for a problem: the project check it is judged by and what it may not touch. Part of the fix's identity. */
export interface Authorised {
  verify: GateRef;
  guards?: GuardLists;
  hold?: boolean;
  landing?: CloserRef;
}

/** The problems `delivery fix` has taken on, each as it was first authorised. */
export function authorisations(entries: readonly LedgerEntry[]): Map<string, Authorised> {
  const found = new Map<string, Authorised>();
  for (const entry of entries) {
    if (entry.t !== "authorise") continue;
    for (const id of entry.ids) {
      if (found.has(id)) continue;
      const hold = entry.hold?.[id];
      found.set(id, {
        verify: entry.verify,
        ...(entry.guards === undefined ? {} : { guards: entry.guards }),
        ...(hold === undefined ? {} : { hold }),
        ...(entry.landing === undefined ? {} : { landing: entry.landing }),
      });
    }
  }
  return found;
}

/** The problems found already fixed before their fix started. */
export function resolvedIds(entries: readonly LedgerEntry[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.t === "fix_observed" ? [entry.id] : [])));
}

/** Each problem's latest sign-off result: a later sign-off after a failed one replaces it. */
export function signOffResults(entries: readonly LedgerEntry[]): Map<string, SignOffResult> {
  const found = new Map<string, SignOffResult>();
  for (const entry of entries) if (entry.t === "rejected" || entry.t === "landed" || entry.t === "not_landed") found.set(entry.id, entry);
  return found;
}
