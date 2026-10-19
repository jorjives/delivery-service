import { createHash } from "node:crypto";
import { stripControl } from "../report/text.js";
import { SEVERITIES, type CheckKind, type CheckSpec, type Finding, type ScanEnvelope, type ScannedFinding, type ScanResult, type Unconfirmed, type UnconfirmedReason } from "./finding.js";
import type { PinnedCategory } from "./review-record.js";
import { literalsOf, maskIn, secretLiterals } from "./secrets.js";
// Moved to the core as item checks (course-correction slice 8); this file is deleted with the findings system.
export { FILE_LIMIT, LITERAL, PATTERN_LIMIT, PATTERN_TIMEOUT_MS, fileAt, locate, normaliseAnchor, patternFound, projectPath } from "../item-check.js";
import { fileAt, locate, normaliseAnchor, patternFound, projectPath } from "../item-check.js";
import { LOCKFILE, lockfileHas } from "../lockfile.js";

/** The longest each kind of agent-written text is kept at. */
export const TEXT_LIMITS = { title: 120, sentence: 600, detail: 2000, notes: 2000, path: 300 } as const;
/**
 * A problem's identity: what it is about (pack and category), where (path) and
 * which code (the flagged text, normalised). Never the line, which moves as
 * other fixes land, and never the title, which an agent rewords.
 */
export function findingId(pack: string, category: string, path: string, anchor: string): string {
  return createHash("sha256").update(JSON.stringify([pack, category, path, normaliseAnchor(anchor)])).digest("hex").slice(0, 12);
}

/** Agent-written text as it is kept: nothing that drives a terminal, whitespace collapsed, cut to `limit`. */
function plain(text: string, limit: number): string {
  const clean = stripControl(text).replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

/** Flagged code that cannot be found reliably: almost nothing in it, or more than five lines. */
function vague(anchor: string): boolean {
  return normaliseAnchor(anchor).replace(/ /g, "").length < 8 || anchor.trim().split("\n").length > 5;
}

/** Whether a check can be used: it runs and the problem it looks for is there now, so it can go from red to green. Anything else is not a check. */
async function holdsNow(repoPath: string, commit: string, check: CheckSpec): Promise<boolean> {
  if (check.kind === "pattern-absent") return (await patternFound(repoPath, check, commit)) === true;
  if (check.kind === "dependency-absent") {
    const file = await fileAt(repoPath, commit, LOCKFILE);
    return "text" in file && lockfileHas(file.text, check.package, check.version) === true;
  }
  return true;
}

/** Whether a file is inside the part of the project reviewed: the whole project, or that folder or file by whole names. */
export const inScope = (path: string, scope: string | undefined): boolean => scope === undefined || path === scope || path.startsWith(`${scope}/`);

/** Problems the review is unsure of go last, so they are listed apart and cut first; then the most serious first. */
const rank = (finding: Finding): number => (finding.confidence === "low" ? SEVERITIES.length : 0) + SEVERITIES.indexOf(finding.severity);

/**
 * Check every problem the agent reported against the repository at `commit`
 * and keep only what it can place. Deterministic: the same reply and commit
 * always give the same result, which is what lets an interrupted review be
 * finished later without asking the agent again.
 */
export async function confirmFindings(
  repoPath: string,
  commit: string,
  { pack, maxFindings, categories = [], checks, scope }: { pack: string; maxFindings: number; categories?: readonly PinnedCategory[]; checks?: readonly CheckKind[]; scope?: string },
  envelope: ScanEnvelope,
): Promise<ScanResult> {
  const flags = new Map(categories.map((category) => [category.id, category]));
  // The flagged text and pattern are the only places a secret is kept: they are how the problem is found and checked.
  // Everywhere else the agent's words are masked before they are saved, with any secret-shaped text they hold themselves.
  const secrets = envelope.findings.flatMap((scanned) => literalsOf({ anchor: scanned.anchor, check: scanned.check, sensitive: flags.get(scanned.category)?.sensitive }));
  const words = (text: string, limit: number): string => plain(maskIn(text, [...secrets, ...secretLiterals(text, false)]), limit);
  const confirmed = new Map<string, Finding>();
  const unconfirmed: Unconfirmed[] = [];
  for (const scanned of envelope.findings) {
    const placed = await place(repoPath, commit, scanned);
    if ("reason" in placed) {
      unconfirmed.push({ title: words(scanned.title, TEXT_LIMITS.title), severity: scanned.severity, path: plain(scanned.where.path, TEXT_LIMITS.path), problem: words(scanned.problem, TEXT_LIMITS.sentence), reason: placed.reason });
      continue;
    }
    if (!inScope(placed.path, scope)) {
      unconfirmed.push({ title: words(scanned.title, TEXT_LIMITS.title), severity: scanned.severity, path: placed.path, problem: words(scanned.problem, TEXT_LIMITS.sentence), reason: "outside_scope" });
      continue;
    }
    const id = findingId(pack, scanned.category, placed.path, scanned.anchor);
    if (confirmed.has(id)) continue;
    confirmed.set(id, {
      id,
      title: words(scanned.title, TEXT_LIMITS.title),
      category: scanned.category,
      severity: scanned.severity,
      where: { path: placed.path, line: placed.line, endLine: placed.endLine },
      problem: words(scanned.problem, TEXT_LIMITS.sentence),
      whyItMatters: words(scanned.whyItMatters, TEXT_LIMITS.sentence),
      fixedLooksLike: words(scanned.fixedLooksLike, TEXT_LIMITS.sentence),
      anchor: scanned.anchor,
      check: scanned.check,
      ...(scanned.confidence === undefined ? {} : { confidence: scanned.confidence }),
      ...(scanned.detail ? { detail: maskIn(stripControl(scanned.detail), [...secrets, ...secretLiterals(scanned.detail, false)]).trim().slice(0, TEXT_LIMITS.detail) } : {}),
      ...(scanned.outsideStep ? { outsideStep: words(scanned.outsideStep, TEXT_LIMITS.sentence) } : {}),
      ...(flags.get(scanned.category)?.scope === "repo" ? { scope: "repo" as const } : {}),
      ...(flags.get(scanned.category)?.sensitive === true ? { sensitive: true as const } : {}),
      source: "reviewer",
    });
  }
  const ordered = [...confirmed.values()].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  // Checks are tried only for the problems offered, so a reply with many problems costs no more git time than the limit allows.
  const offeredHere = (check: CheckSpec): boolean => check.kind === "none" || checks === undefined || checks.includes(check.kind);
  const offered: Finding[] = [];
  for (const finding of ordered.slice(0, maxFindings)) {
    const { check } = finding;
    // ponytail: the engineers' line for a dropped check says it does not match the code; for a check the pack does not offer that is approximate. Give it its own words if anyone reads it as wrong.
    offered.push(offeredHere(check) && (await holdsNow(repoPath, commit, check)) ? finding : { ...finding, check: { kind: "anchor-gone" }, droppedCheck: check });
  }
  return {
    findings: offered,
    unconfirmed,
    notShown: Math.max(0, ordered.length - maxFindings),
    notes: words(envelope.notes, TEXT_LIMITS.notes),
  };
}

async function place(repoPath: string, commit: string, scanned: ScannedFinding): Promise<{ path: string; line: number; endLine: number } | { reason: UnconfirmedReason }> {
  const path = projectPath(scanned.where.path);
  if (path === undefined) return { reason: "outside_project" };
  if (vague(scanned.anchor)) return { reason: "vague" };
  const file = await fileAt(repoPath, commit, path);
  if ("reason" in file) return file;
  const at = locate(file.text, scanned.anchor);
  return at === undefined ? { reason: "text_not_found" } : { path, ...at };
}
