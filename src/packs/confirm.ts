import { createHash } from "node:crypto";
import { posix } from "node:path";
import { git } from "../git-exec.js";
import { stripControl } from "../report/text.js";
import { SEVERITIES, type CheckSpec, type Finding, type ScanEnvelope, type ScannedFinding, type ScanResult, type Unconfirmed, type UnconfirmedReason } from "./finding.js";

/** How long git may spend on one agent-written pattern before the check is not used. */
export const PATTERN_TIMEOUT_MS = 10_000;
/** The longest agent-written pattern that is run at all. */
export const PATTERN_LIMIT = 500;
/** The longest each kind of agent-written text is kept at. */
export const TEXT_LIMITS = { title: 120, sentence: 600, detail: 2000, notes: 2000, path: 300 } as const;
/** The largest file read to find flagged code in. */
const FILE_LIMIT = 10 * 1024 * 1024;
/** Paths named to git as they are, never as patterns. */
const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };

/** Flagged code as it is compared: every run of whitespace one space, none at either end. */
export function normaliseAnchor(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A problem's identity: what it is about (pack and category), where (path) and
 * which code (the flagged text, normalised). Never the line, which moves as
 * other fixes land, and never the title, which an agent rewords.
 */
export function findingId(pack: string, category: string, path: string, anchor: string): string {
  return createHash("sha256").update(JSON.stringify([pack, category, path, normaliseAnchor(anchor)])).digest("hex").slice(0, 12);
}

/** Where flagged code starts and ends in `text`, by line, comparing with whitespace collapsed on both sides. */
export function locate(text: string, anchor: string): { line: number; endLine: number } | undefined {
  const wanted = normaliseAnchor(anchor);
  if (wanted === "") return undefined;
  let flat = "";
  const lineOf: number[] = [];
  let line = 1;
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (/\s/.test(char)) {
      if (char === "\n") line++;
      gap = flat.length > 0;
      continue;
    }
    if (gap) {
      flat += " ";
      lineOf.push(line);
      gap = false;
    }
    flat += char;
    lineOf.push(line);
  }
  const at = flat.indexOf(wanted);
  if (at === -1) return undefined;
  return { line: lineOf[at] ?? line, endLine: lineOf[at + wanted.length - 1] ?? line };
}

/** Agent-written text as it is kept: nothing that drives a terminal, whitespace collapsed, cut to `limit`. */
function plain(text: string, limit: number): string {
  const clean = stripControl(text).replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

/** A path inside the project, as git names it, or undefined for one that is absolute or leads out. */
function projectPath(raw: string): string | undefined {
  if (raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return undefined;
  // Without a trailing slash, so git names the entry itself, never the contents of a folder.
  const normal = posix.normalize(raw).replace(/\/+$/, "");
  if (normal === "." || normal === ".." || normal.startsWith("../")) return undefined;
  return normal;
}

/** Flagged code that cannot be found reliably: almost nothing in it, or more than five lines. */
function vague(anchor: string): boolean {
  return normaliseAnchor(anchor).replace(/ /g, "").length < 8 || anchor.trim().split("\n").length > 5;
}

/** The file's text at `commit`, or why there is none. Reads git's own tree, so a link or a folder is never followed. */
async function fileAt(repoPath: string, commit: string, path: string): Promise<{ text: string } | { reason: UnconfirmedReason }> {
  const listing = await git(repoPath, ["ls-tree", commit, "--", path], { env: LITERAL });
  const entry = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(listing);
  if (entry === null) return { reason: "no_such_file" };
  const [, mode, type, oid] = entry;
  if (type !== "blob" || (mode !== "100644" && mode !== "100755") || oid === undefined) return { reason: "not_a_file" };
  try {
    return { text: await git(repoPath, ["cat-file", "blob", oid], { maxBuffer: FILE_LIMIT, raw: true }) };
  } catch {
    return { reason: "text_not_found" };
  }
}

/** Whether a pattern check can be used: it runs, through git, and matches the code as it stands. Anything else is not a check. */
async function patternMatchesNow(repoPath: string, commit: string, check: Extract<CheckSpec, { kind: "pattern-absent" }>): Promise<boolean> {
  const paths = check.paths.map(projectPath);
  if (check.pattern.length > PATTERN_LIMIT || paths.some((path) => path === undefined)) return false;
  try {
    await git(repoPath, ["grep", "-q", "-E", "-e", check.pattern, commit, "--", ...(paths as string[])], { timeout: PATTERN_TIMEOUT_MS });
    return true;
  } catch {
    // No match, a pattern git refuses, or one that ran too long: none of them can go from failing to passing honestly.
    return false;
  }
}

const rank = (finding: Finding): number => SEVERITIES.indexOf(finding.severity);

/**
 * Check every problem the agent reported against the repository at `commit`
 * and keep only what it can place. Deterministic: the same reply and commit
 * always give the same result, which is what lets an interrupted review be
 * finished later without asking the agent again.
 */
export async function confirmFindings(
  repoPath: string,
  commit: string,
  { pack, maxFindings }: { pack: string; maxFindings: number },
  envelope: ScanEnvelope,
): Promise<ScanResult> {
  const confirmed = new Map<string, Finding>();
  const unconfirmed: Unconfirmed[] = [];
  for (const scanned of envelope.findings) {
    const placed = await place(repoPath, commit, scanned);
    if ("reason" in placed) {
      unconfirmed.push({ title: plain(scanned.title, TEXT_LIMITS.title), severity: scanned.severity, path: plain(scanned.where.path, TEXT_LIMITS.path), problem: plain(scanned.problem, TEXT_LIMITS.sentence), reason: placed.reason });
      continue;
    }
    const id = findingId(pack, scanned.category, placed.path, scanned.anchor);
    if (confirmed.has(id)) continue;
    confirmed.set(id, {
      id,
      title: plain(scanned.title, TEXT_LIMITS.title),
      category: scanned.category,
      severity: scanned.severity,
      where: { path: placed.path, line: placed.line, endLine: placed.endLine },
      problem: plain(scanned.problem, TEXT_LIMITS.sentence),
      whyItMatters: plain(scanned.whyItMatters, TEXT_LIMITS.sentence),
      fixedLooksLike: plain(scanned.fixedLooksLike, TEXT_LIMITS.sentence),
      anchor: scanned.anchor,
      check: scanned.check,
      ...(scanned.detail ? { detail: stripControl(scanned.detail).trim().slice(0, TEXT_LIMITS.detail) } : {}),
      source: "reviewer",
    });
  }
  const ordered = [...confirmed.values()].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  // Patterns are run only for the problems offered, so a reply with many problems costs no more git time than the limit allows.
  const offered: Finding[] = [];
  for (const finding of ordered.slice(0, maxFindings)) {
    const { check } = finding;
    offered.push(check.kind !== "pattern-absent" || (await patternMatchesNow(repoPath, commit, check)) ? finding : { ...finding, check: { kind: "anchor-gone" }, droppedCheck: check });
  }
  return {
    findings: offered,
    unconfirmed,
    notShown: Math.max(0, ordered.length - maxFindings),
    notes: plain(envelope.notes, TEXT_LIMITS.notes),
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
