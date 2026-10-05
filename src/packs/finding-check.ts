import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isEnoent } from "../journal.js";
import { fileAt, locate, patternFound, projectPath } from "./confirm.js";
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
  const full = join(where.worktreePath, path);
  try {
    if (!(await lstat(full)).isFile()) return NOT_A_FILE(path);
    return await readFile(full, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
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
