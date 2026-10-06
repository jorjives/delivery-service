import { createHash } from "node:crypto";
import { posix } from "node:path";
import { git } from "../git-exec.js";
import { stripControl } from "../report/text.js";
import { SEVERITIES, type CheckSpec, type Finding, type ScanEnvelope, type ScannedFinding, type ScanResult, type Unconfirmed, type UnconfirmedReason } from "./finding.js";
import { LOCKFILE, lockfileHas } from "./lockfile.js";

/** How long git may spend on one agent-written pattern before the check is not used. */
export const PATTERN_TIMEOUT_MS = 10_000;
/** The longest agent-written pattern that is run at all. */
export const PATTERN_LIMIT = 500;
/** The longest each kind of agent-written text is kept at. */
export const TEXT_LIMITS = { title: 120, sentence: 600, detail: 2000, notes: 2000, path: 300 } as const;
/** The largest file read to find flagged code in. */
export const FILE_LIMIT = 10 * 1024 * 1024;
/** Paths named to git as they are, never as patterns. */
export const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };

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
export function projectPath(raw: string): string | undefined {
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
export async function fileAt(repoPath: string, commit: string, path: string): Promise<{ text: string } | { reason: UnconfirmedReason }> {
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

/**
 * Whether an agent-written pattern matches in the paths it names: at `commit`,
 * or in the working tree at `cwd` (new and ignored files included) when there is
 * none. Run through git with a time limit; anything that is not a clean "matches"
 * or "does not match" is an error, never an answer.
 */
export async function patternFound(cwd: string, check: Extract<CheckSpec, { kind: "pattern-absent" }>, commit?: string): Promise<boolean | { error: string }> {
  const paths = check.paths.map(projectPath);
  if (check.pattern.length > PATTERN_LIMIT) return { error: `the pattern is longer than ${PATTERN_LIMIT} characters` };
  if (paths.some((path) => path === undefined)) return { error: "a path the check names leads outside the project" };
  const scope = commit === undefined ? { options: ["--untracked", "--no-exclude-standard"], revision: [] } : { options: [], revision: [commit] };
  try {
    await git(cwd, ["grep", "-q", "-E", ...scope.options, "-e", check.pattern, ...scope.revision, "--", ...(paths as string[])], { env: LITERAL, timeout: PATTERN_TIMEOUT_MS });
    return true;
  } catch (err) {
    const { code, killed } = err as { code?: unknown; killed?: boolean };
    if (code === 1 && killed !== true) return false;
    return { error: killed === true ? `the pattern ran longer than ${PATTERN_TIMEOUT_MS / 1000} seconds` : "git could not run the pattern" };
  }
}

/** Whether a pattern check can be used: it runs, through git, and matches the code as it stands. Anything else is not a check. */
/** Whether a check can be used: it runs and the problem it looks for is there now, so it can go from red to green. Anything else is not a check. */
async function holdsNow(repoPath: string, commit: string, check: CheckSpec): Promise<boolean> {
  if (check.kind === "pattern-absent") return (await patternFound(repoPath, check, commit)) === true;
  if (check.kind === "dependency-absent") {
    const file = await fileAt(repoPath, commit, LOCKFILE);
    return "text" in file && lockfileHas(file.text, check.package, check.version) === true;
  }
  return true;
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
  // Checks are tried only for the problems offered, so a reply with many problems costs no more git time than the limit allows.
  const offered: Finding[] = [];
  for (const finding of ordered.slice(0, maxFindings)) {
    const { check } = finding;
    offered.push((await holdsNow(repoPath, commit, check)) ? finding : { ...finding, check: { kind: "anchor-gone" }, droppedCheck: check });
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
