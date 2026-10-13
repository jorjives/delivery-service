import { z } from "zod";

/** How serious a problem is, most serious first: the order a review lists them in. Words a pack defines, never a number. */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

/** How sure a review is that a problem is real, most sure first. Words, never a number; a problem it is unsure of ("low") is set aside, not hidden. */
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const Confidence = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof Confidence>;

/** Whether a problem is at or above a threshold on the closed order. A null threshold holds nothing. */
export const atOrAbove = (severity: Severity, threshold: Severity | null): boolean =>
  threshold !== null && SEVERITIES.indexOf(severity) <= SEVERITIES.indexOf(threshold);

/** What the owner may choose for which fixes wait for sign-off: a severity (that one and every more serious one wait), or none (nothing waits for its severity). */
export const SIGN_OFF_THRESHOLDS = [...SEVERITIES, "none"] as const;
export type SignOffThreshold = (typeof SIGN_OFF_THRESHOLDS)[number];
/** The owner's choice as a threshold on the closed order: none is null, which holds nothing. */
export const thresholdOf = (choice: SignOffThreshold): Severity | null => (choice === "none" ? null : choice);

/**
 * How the harness will know a problem is fixed. Closed and harness-owned: a
 * review's agent picks one, and the harness decides whether it can be used.
 */
export const CheckSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anchor-gone") }),
  z.object({ kind: z.literal("pattern-absent"), pattern: z.string().min(1), paths: z.array(z.string().min(1)).min(1) }),
  z.object({
    kind: z.literal("dependency-absent"),
    /** An npm package name, scoped or not. */
    package: z.string().regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/),
    /** An exact version as npm writes it: no spaces or control text, so it prints safely. */
    version: z.string().regex(/^[0-9A-Za-z.+_~-]+$/),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type CheckSpec = z.infer<typeof CheckSpec>;
export type CheckKind = CheckSpec["kind"];

/** The checks that look at the code itself, in the order a pack lists them. `none` is not among them: any problem may have no check. */
export const SPECIFIC_CHECKS = ["anchor-gone", "pattern-absent", "dependency-absent"] as const satisfies readonly CheckKind[];
export type SpecificCheck = (typeof SPECIFIC_CHECKS)[number];

const Text = z.string().min(1);

/**
 * The reply a review's agent must give, for one pack: only that pack's
 * categories. It carries no id and no line: identity and position are the
 * harness's, worked out from the repository, never taken on the agent's word.
 */
export function scanEnvelopeFor(categoryIds: readonly string[]) {
  const [first, ...rest] = categoryIds;
  if (first === undefined) throw new Error("a pack names at least one category");
  const ScannedFinding = z.object({
    title: Text,
    category: z.enum([first, ...rest]),
    severity: Severity,
    where: z.object({ path: Text }),
    problem: Text,
    whyItMatters: Text,
    fixedLooksLike: Text,
    anchor: Text,
    check: CheckSpec,
    /** Optional, so a reply recorded before reviews said it, and a pack's own scripted fixtures, still read. */
    confidence: Confidence.optional(),
    detail: z.string().optional(),
    outsideStep: z.string().optional(),
  });
  return z.object({ findings: z.array(ScannedFinding), notes: z.string() });
}
export type ScanEnvelope = z.infer<ReturnType<typeof scanEnvelopeFor>>;
export type ScannedFinding = ScanEnvelope["findings"][number];

/** Why a reported problem could not be confirmed, so is listed but not offered. Closed, so the words for it are total. */
export const UNCONFIRMED_REASONS = ["no_such_file", "outside_project", "not_a_file", "text_not_found", "vague", "outside_scope"] as const;
export type UnconfirmedReason = (typeof UNCONFIRMED_REASONS)[number];

/** A problem the harness confirmed in the repository at the review's commit. */
export const Finding = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  title: z.string(),
  category: z.string(),
  severity: Severity,
  where: z.object({ path: z.string(), line: z.int().min(1), endLine: z.int().min(1) }),
  problem: z.string(),
  whyItMatters: z.string(),
  fixedLooksLike: z.string(),
  anchor: z.string(),
  check: CheckSpec,
  /** How sure the review was that this is a real problem. Absent for a review made before reviews said, or when the agent did not. */
  confidence: Confidence.optional(),
  /** The check the agent suggested and the harness could not use, kept for engineers. */
  droppedCheck: CheckSpec.optional(),
  detail: z.string().optional(),
  /** What only a person can do once the code is fixed, such as changing a leaked password at its provider. */
  outsideStep: z.string().optional(),
  /** The problem's category says a fix must clear the flagged text from the whole project, not only its file. */
  scope: z.literal("repo").optional(),
  /** The problem's category says its flagged text may hold a secret. */
  sensitive: z.literal(true).optional(),
  source: z.literal("reviewer"),
});
export type Finding = z.infer<typeof Finding>;

/** A problem the agent reported that the harness could not place in the repository. */
export const Unconfirmed = z.object({
  title: z.string(),
  severity: Severity,
  path: z.string(),
  problem: z.string(),
  reason: z.enum(UNCONFIRMED_REASONS),
});
export type Unconfirmed = z.infer<typeof Unconfirmed>;

/** What a finished review found: what it offers, what it could not confirm, how many it left out over the limit, and the agent's notes. */
export const ScanResult = z.object({
  findings: z.array(Finding),
  unconfirmed: z.array(Unconfirmed),
  notShown: z.int().min(0),
  notes: z.string(),
});
export type ScanResult = z.infer<typeof ScanResult>;
