import { z } from "zod";
import { openSchema, type JsonSchema } from "../report/json-schema.js";
import { Severity, type CheckKind } from "./finding.js";
import { EARLIER_CHOICES, FIX_STATES, UNDECIDED, UNFIXABLE_CAUSES, type FindingState } from "./fix-state.js";
import { CHECK_LEVEL, stateWords, checkLevel } from "./render.js";
import type { SavedReview } from "./review-record.js";

/** The version every findings document names itself by. A later version adds keys; it never renames or removes one. */
export const FINDINGS_SCHEMA = "delivery.findings/1";

const CHECK_KINDS = Object.keys(CHECK_LEVEL) as [CheckKind, ...CheckKind[]];

/** One problem as the data tells it. Never its flagged text or a check's pattern: either may hold a secret. */
export const FindingsProblem = z.object({
  /** Its number in `delivery findings`, counted from 1: the handle every command takes. */
  number: z.int().min(1),
  id: z.string(),
  title: z.string(),
  category: z.string(),
  severity: Severity,
  where: z.object({ path: z.string(), line: z.int().min(1), endLine: z.int().min(1) }),
  /** Where it stands, from the closed set. */
  state: z.enum(FIX_STATES),
  /** The same, as the owner reads it. */
  words: z.string(),
  check: z.object({ kind: z.enum(CHECK_KINDS), level: z.string() }),
  /** Whether a check of its fix ever refused it for removing, changing or skipping tests. */
  refused: z.boolean(),
  cause: z.enum(UNFIXABLE_CAUSES).nullable(),
  /** What an earlier review of the same kind decided, where this review has no choice of its own: skipped or declined (its state is then "skipped"), or fixed (it came back). Null when nothing was carried. */
  earlier: z.enum(EARLIER_CHOICES).nullable(),
  /** Its fix's run, for `delivery status <run>`; null before `delivery fix` has taken it on. */
  fix: z.object({ run: z.string().nullable(), branch: z.string().nullable(), base: z.string().nullable(), closer: z.string().nullable() }).nullable(),
});

/** What `delivery findings --json` prints: the latest review and every problem in it. */
export const FindingsDocument = z.object({
  schema: z.literal(FINDINGS_SCHEMA),
  review: z.object({
    id: z.string(),
    pack: z.string(),
    title: z.string(),
    commit: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    /** The version of the pack that made the review, and a fingerprint of its manifest and instructions: a changed pack shows as a changed fingerprint. */
    packVersion: z.string(),
    packHash: z.string(),
  }),
  problems: z.array(FindingsProblem),
  /** How many the review reported that could not be found in the project: `delivery findings --unconfirmed`. */
  unconfirmed: z.int().min(0),
  /** How many it found beyond the pack's limit, not listed. */
  notShown: z.int().min(0),
});
export type FindingsDocument = z.infer<typeof FindingsDocument>;

/** A review's problems and where each stands, as data. Pure. `states` is aligned with the review's problems. */
export function findingsDocument({ header, result }: SavedReview, states: readonly FindingState[]): FindingsDocument {
  return {
    schema: FINDINGS_SCHEMA,
    review: { id: header.reviewId, pack: header.pack.name, title: header.pack.title, commit: header.commit, startedAt: header.startedAt, endedAt: header.endedAt, packVersion: header.pack.version, packHash: header.pack.hash },
    problems: result.findings.map((finding, index) => {
      const at = states[index] ?? UNDECIDED;
      return {
        number: index + 1,
        id: finding.id,
        title: finding.title,
        category: finding.category,
        severity: finding.severity,
        where: { path: finding.where.path, line: finding.where.line, endLine: finding.where.endLine },
        state: at.state,
        words: stateWords(at),
        check: { kind: finding.check.kind, level: checkLevel(header, finding.check.kind) },
        refused: at.refused,
        cause: at.cause,
        earlier: at.earlier,
        fix: at.fix === undefined ? null : { run: at.fix.run, branch: at.fix.branch, base: at.fix.base, closer: at.fix.closer },
      };
    }),
    unconfirmed: result.unconfirmed.length,
    notShown: result.notShown,
  };
}

/** The published schema of the findings document, under the version it names itself by: what `delivery findings --schema` prints. */
export const findingsSchema = (): Record<typeof FINDINGS_SCHEMA, JsonSchema> => ({ [FINDINGS_SCHEMA]: openSchema(FindingsDocument) });
