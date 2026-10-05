import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../git-exec.js";
import { isEnoent } from "../journal.js";
import { FILE_LIMIT, fileAt, LITERAL, locate, patternFound, projectPath } from "./confirm.js";
import type { Finding } from "./finding.js";

/** Where a problem is checked: the main copy at a commit, or a working copy as an agent left it. */
export type Where = { repoPath: string; commit: string } | { worktreePath: string };

/** Gone, still there, or the check itself could not say: never read as gone. */
export type CheckResult = "resolved" | "present" | { error: string };

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

/** The file's text, nothing when it is not there, or an error when something other than an ordinary file stands in its place. */
async function textAt(where: Where, path: string): Promise<string | undefined | { error: string }> {
  if ("commit" in where) {
    const file = await fileAt(where.repoPath, where.commit, path);
    if ("text" in file) return file.text;
    return file.reason === "no_such_file" ? undefined : NOT_A_FILE(path);
  }
  // Folder by folder, as git's own tree is read: a link anywhere on the path could lead outside the working copy.
  const parts = path.split("/");
  try {
    for (let i = 1; i < parts.length; i++) {
      const folder = await lstat(join(where.worktreePath, ...parts.slice(0, i)));
      if (folder.isSymbolicLink()) return NOT_A_FILE(path);
      if (!folder.isDirectory()) return undefined;
    }
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
    if (err instanceof Error && "code" in err && err.code === "ELOOP") return NOT_A_FILE(path);
    if (isEnoent(err)) return undefined;
    throw err;
  }
}

/**
 * A link, or anything else that is not an ordinary file, among the files a
 * pattern names in a working copy, or a file git is told not to look at on
 * disk (assume-unchanged, skip-worktree): git's search passes over the first
 * and reads the staged copy of the second, so either could hide code from the check.
 */
async function oddFileIn(worktreePath: string, paths: string[]): Promise<{ error: string } | undefined> {
  const named = paths.map(projectPath);
  if (named.some((path) => path === undefined)) return undefined;
  const listed = await git(worktreePath, ["ls-files", "-z", "-v", "--cached", "--others", "--", ...(named as string[])], { env: LITERAL, raw: true });
  for (const entry of new Set(listed.split("\0").filter(Boolean))) {
    const [tag, path] = [entry.charAt(0), entry.slice(2)];
    if (tag === "S" || tag !== tag.toUpperCase()) return { error: `git is told not to look at ${path} as it stands on disk` };
    try {
      if (!(await lstat(join(worktreePath, path))).isFile()) return NOT_A_FILE(path);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }
  return undefined;
}

/**
 * Whether a problem is still there: its pattern still matches, or its flagged
 * code is still in its file (commented out counts as still there). A problem
 * whose check is "tests only" is judged by its flagged code too, for the one
 * caller that asks of it: whether its fix is needed at all.
 */
export async function checkFinding(finding: Finding, where: Where): Promise<CheckResult> {
  const { check } = finding;
  if (check.kind === "pattern-absent") {
    if ("worktreePath" in where) {
      const odd = await oddFileIn(where.worktreePath, check.paths);
      if (odd !== undefined) return odd;
    }
    const found = "commit" in where ? await patternFound(where.repoPath, check, where.commit) : await patternFound(where.worktreePath, check);
    return typeof found === "boolean" ? (found ? "present" : "resolved") : found;
  }
  const path = projectPath(finding.where.path);
  if (path === undefined) return { error: "the problem's file leads outside the project" };
  const text = await textAt(where, path);
  if (text === undefined) return "resolved";
  if (typeof text !== "string") return text;
  return locate(commentBlind(text), commentBlind(finding.anchor)) === undefined ? "resolved" : "present";
}
