import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, posix } from "node:path";
import { BACKLOG_DIR } from "./backlog.js";
import { git } from "./git-exec.js";
import { isEnoent } from "./journal.js";
import { LOCKFILE, lockfileHas } from "./lockfile.js";
import { secretLiterals } from "./secrets.js";
import { SEVERITIES, ItemCheck, type Assertion, type Severity, type TaskDef } from "./schema.js";

/** Where the harness keeps its records in a project: never where a problem is looked for, so an item never confirms itself. */
export const HARNESS_DIR = ".delivery/";
/** Paths named to git exactly as written, and the backlog folder never searched. */
const named = (path: string): string => `:(literal)${path}`;
const NOT_BACKLOG = `:(exclude,literal)${BACKLOG_DIR}`;

/** Where a problem is checked: the main copy at a commit, or a working copy as an agent left it. */
export type Where = { repoPath: string; commit: string } | { worktreePath: string };

/** Gone, still there, or the check itself could not say: never read as gone. */
export type CheckResult = "resolved" | "present" | { error: string };

/** Whether a problem is at or above a threshold on the closed order. No threshold holds nothing. */
export const atOrAbove = (severity: Severity, threshold: Severity | undefined): boolean =>
  threshold !== undefined && SEVERITIES.indexOf(severity) <= SEVERITIES.indexOf(threshold);

/** How long git may spend on one agent-written pattern before the check is not used. */
export const PATTERN_TIMEOUT_MS = 10_000;
/** The longest agent-written pattern that is run at all. */
export const PATTERN_LIMIT = 500;
/** The largest file read to find flagged code in. */
export const FILE_LIMIT = 10 * 1024 * 1024;
/** Paths named to git as they are, never as patterns. */
export const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };

/** Flagged code as it is compared: every run of whitespace one space, none at either end. */
export function normaliseAnchor(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

/** A path inside the project, as git names it, or undefined for one that is absolute or leads out. */
export function projectPath(raw: string): string | undefined {
  if (raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return undefined;
  // Without a trailing slash, so git names the entry itself, never the contents of a folder.
  const normal = posix.normalize(raw).replace(/\/+$/, "");
  if (normal === "." || normal === ".." || normal.startsWith("../")) return undefined;
  return normal;
}

/** The file's text at `commit`, or why there is none. Reads git's own tree, so a link or a folder is never followed. */
export async function fileAt(repoPath: string, commit: string, path: string): Promise<{ text: string } | { reason: "no_such_file" | "not_a_file" | "text_not_found" }> {
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
export async function patternFound(cwd: string, check: { pattern: string; paths: string[] }, commit?: string): Promise<boolean | { error: string }> {
  const paths = check.paths.map(projectPath);
  if (check.pattern.length > PATTERN_LIMIT) return { error: `the pattern is longer than ${PATTERN_LIMIT} characters` };
  if (paths.some((path) => path === undefined)) return { error: "a path the check names leads outside the project" };
  const scope = commit === undefined ? { options: ["--untracked", "--no-exclude-standard"], revision: [] } : { options: [], revision: [commit] };
  try {
    await git(cwd, ["grep", "-q", "-E", ...scope.options, "-e", check.pattern, ...scope.revision, "--", ...(paths as string[]).map(named), NOT_BACKLOG], { timeout: PATTERN_TIMEOUT_MS });
    return true;
  } catch (err) {
    const { code, killed } = err as { code?: unknown; killed?: boolean };
    if (code === 1 && killed !== true) return false;
    return { error: killed === true ? `the pattern ran longer than ${PATTERN_TIMEOUT_MS / 1000} seconds` : "git could not run the pattern" };
  }
}

const COMMENT_OPENER = /^\s*(?:\/\/+|\/\*+|\*+|#+|--|<!--)\s?/;
const COMMENT_CLOSER = /\s*(?:\*\/|-->)\s*$/;

/**
 * Code with comment markers at the start and end of each line set aside, so
 * flagged code commented out still reads as the flagged code. Applied to both
 * sides of the comparison, so it can only make a match more likely.
 * ponytail: line and block markers only; code moved into a string or a docstring evades it, which the project's tests still judge.
 */
export function commentBlind(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(COMMENT_OPENER, "").replace(COMMENT_CLOSER, ""))
    .join("\n");
}

const NOT_A_FILE = (path: string): { error: string } => ({ error: `${path} is not an ordinary file` });
/**
 * Whether the folders on a path in a working copy, read one by one as git's
 * own tree is, are all real folders (nothing), one of them a link (an error: it
 * could lead anywhere, outside the working copy included), or one missing or
 * not a folder, so nothing can be there.
 */
async function foldersOn(root: string, path: string): Promise<{ error: string } | "missing" | undefined> {
  let folder = root;
  try {
    for (const part of path.split("/").slice(0, -1)) {
      folder = join(folder, part);
      const stat = await lstat(folder);
      if (stat.isSymbolicLink()) return { error: `${path} sits in a folder that is a link` };
      if (!stat.isDirectory()) return "missing";
    }
  } catch (err) {
    if (isEnoent(err)) return "missing";
    throw err;
  }
  return undefined;
}

/** The file's text, nothing when it is not there, or an error when something other than an ordinary file stands in its place. */
async function textAt(where: Where, path: string): Promise<string | undefined | { error: string }> {
  if ("commit" in where) {
    const file = await fileAt(where.repoPath, where.commit, path);
    if ("text" in file) return file.text;
    return file.reason === "no_such_file" ? undefined : NOT_A_FILE(path);
  }
  try {
    const folders = await foldersOn(where.worktreePath, path);
    if (folders !== undefined) return folders === "missing" ? undefined : folders;
    const file = await open(join(where.worktreePath, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return NOT_A_FILE(path);
      if (stat.size > FILE_LIMIT) return { error: `${path} is too large to read` };
      return await file.readFile("utf-8");
    } finally {
      await file.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOOP") return NOT_A_FILE(path);
    if (isEnoent(err)) return undefined;
    throw err;
  }
}

/**
 * A link, or anything else that is not an ordinary file, among the files a
 * pattern names in a working copy or the folders they sit in, or a file git is
 * told not to look at on disk (assume-unchanged, skip-worktree): git's search
 * passes over the first and reads the staged copy of the second, so either
 * could hide code from the check.
 */
async function oddFileIn(worktreePath: string, paths: string[]): Promise<{ error: string } | undefined> {
  const named = paths.map(projectPath);
  if (named.some((path) => path === undefined)) return undefined;
  const listed = await git(worktreePath, ["ls-files", "-z", "-v", "--cached", "--others", "--", ...(named as string[])], { env: LITERAL, raw: true });
  for (const entry of new Set(listed.split("\0").filter(Boolean))) {
    const [tag, path] = [entry.charAt(0), entry.slice(2)];
    if (tag === "S" || tag !== tag.toUpperCase()) return { error: `git is told not to look at ${path} as it stands on disk` };
    const folders = await foldersOn(worktreePath, path);
    if (folders === "missing") continue;
    if (folders !== undefined) return folders;
    try {
      if (!(await lstat(join(worktreePath, path))).isFile()) return NOT_A_FILE(path);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }
  return undefined;
}

/**
 * Whether any of `literals` is anywhere in the project: at the commit, or in
 * the working copy's tracked and new files (files git ignores aside, which is
 * where a secret moved out of the code belongs). Searched as fixed text by git,
 * so nothing an agent wrote is run as a pattern.
 */
async function anywhere(where: Where, literals: string[]): Promise<boolean | { error: string }> {
  const search = literals.flatMap((literal) => ["-e", literal]);
  const [cwd, args] =
    "commit" in where ? [where.repoPath, ["grep", "-q", "-F", ...search, where.commit, "--", NOT_BACKLOG]] : [where.worktreePath, ["grep", "-q", "-F", "--untracked", ...search, "--", NOT_BACKLOG]];
  try {
    await git(cwd, args, { timeout: PATTERN_TIMEOUT_MS });
    return true;
  } catch (err) {
    const { code, killed } = err as { code?: unknown; killed?: boolean };
    if (code === 1 && killed !== true) return false;
    return { error: "the project could not be searched for the secret" };
  }
}

/**
 * Whether an item's problem is still there: its pattern still matches, its vulnerable
 * version is still in the lockfile, or its flagged code is still in its file
 * (commented out counts as still there). A secret is still there
 * while its text is anywhere in the project: moving it is not fixing it. Never read as gone when it cannot tell.
 */
export async function checkItem(check: ItemCheck, where: Where): Promise<CheckResult> {
  if (check.kind === "dependency-absent") {
    const text = await textAt(where, LOCKFILE);
    if (text === undefined) return { error: `${LOCKFILE} is not in the project, so which versions are installed cannot be read` };
    if (typeof text !== "string") return text;
    const installed = lockfileHas(text, check.package, check.version);
    if (installed === undefined) return { error: `${LOCKFILE} could not be read as an npm lockfile` };
    return installed ? "present" : "resolved";
  }
  if (check.kind === "pattern-absent") {
    if ("worktreePath" in where) {
      const odd = await oddFileIn(where.worktreePath, check.paths);
      if (odd !== undefined) return odd;
    }
    const found = "commit" in where ? await patternFound(where.repoPath, check, where.commit) : await patternFound(where.worktreePath, check);
    return typeof found === "boolean" ? (found ? "present" : "resolved") : found;
  }
  const path = projectPath(check.path);
  if (path === undefined) return { error: "the problem's file leads outside the project" };
  if (`${path}/`.startsWith(HARNESS_DIR)) return { error: "the check looks inside .delivery, where the harness keeps its own records" };
  if (check.scope === "repo") {
    const literals = secretLiterals(check.anchor, check.sensitive === true);
    if (literals.length > 0) {
      const found = await anywhere(where, literals);
      if (found !== false) return found === true ? "present" : found;
    }
  }
  const text = await textAt(where, path);
  if (text === undefined) return "resolved";
  if (typeof text !== "string") return text;
  return locate(commentBlind(text), commentBlind(check.anchor)) === undefined ? "resolved" : "present";
}

/** An item's own requirement: its problem is gone. Counted when new, as a guard is. */
export const isItemAssertion = (id: string): boolean => id.startsWith("item:");
export const resolvedId = (itemId: string): string => `item:${itemId}:resolved`;

/** What the check looks for, for the agent and the engineer, or what it will show once the problem is gone. Never the anchor itself, which may hold a secret. */
export function describeCheck(check: ItemCheck, when: "now" | "done" = "now"): string {
  const gone = when === "done";
  switch (check.kind) {
    case "anchor-gone":
      return check.scope === "repo"
        ? `the flagged text from ${check.path} ${gone ? "is no longer" : "is still"} somewhere in the project`
        : `the flagged code ${gone ? "is no longer" : "is still"} in ${check.path}`;
    case "pattern-absent":
      return `the pattern ${JSON.stringify(check.pattern)} ${gone ? "no longer matches" : "still matches"} in ${check.paths.join(", ")}`;
    case "dependency-absent":
      return `${check.package} ${check.version} ${gone ? "is no longer" : "is still"} installed in ${LOCKFILE}`;
  }
}

/** The task's check as a gate assertion: undefined when it has none, FAIL when it cannot be read or cannot run. */
export async function resolvedAssertion(taskDef: TaskDef, itemId: string | undefined, worktreePath: string): Promise<Assertion | undefined> {
  if (taskDef.check === undefined) return undefined;
  const id = resolvedId(itemId ?? "task");
  const parsed = ItemCheck.safeParse(taskDef.check);
  if (!parsed.success) return { id, outcome: "FAIL", detail: "The task's check is not one the harness knows, so whether its problem is gone cannot be told." };
  const result = await checkItem(parsed.data, { worktreePath });
  if (result === "resolved") return { id, outcome: "PASS", detail: "the problem the task describes is gone" };
  if (result === "present") return { id, outcome: "FAIL", detail: `The problem is still there: ${describeCheck(parsed.data)}. Fix the problem itself; commenting it out or moving it does not count.` };
  return { id, outcome: "FAIL", detail: `Whether the problem is gone could not be checked: ${result.error}.` };
}
