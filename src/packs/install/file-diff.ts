import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "../../git-exec.js";

/** One line of a file's change: removed, added or kept, a gap between two hunks, or a note that the file has no line break. */
export const DiffLine = z.union([
  z.object({ kind: z.enum(["removed", "added", "context"]), text: z.string() }),
  z.object({ kind: z.literal("gap") }),
  z.object({ kind: z.literal("no-line-break") }),
]);
export type DiffLine = z.infer<typeof DiffLine>;

export interface FileDiff {
  path: string;
  status: "changed" | "added" | "removed" | "unchanged";
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Pure: the hunk lines of one file's unified diff, everything before the first "@@" skipped. */
export function hunkLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunk = false;
  let seenHunk = false;
  const rows = patch.split("\n");
  if (rows.at(-1) === "") rows.pop();
  for (const row of rows) {
    if (row.startsWith("@@")) {
      if (seenHunk) lines.push({ kind: "gap" });
      seenHunk = true;
      inHunk = true;
    } else if (!inHunk) {
      continue;
    } else if (row.startsWith("+")) {
      lines.push({ kind: "added", text: row.slice(1) });
    } else if (row.startsWith("-")) {
      lines.push({ kind: "removed", text: row.slice(1) });
    } else if (row.startsWith(" ")) {
      lines.push({ kind: "context", text: row.slice(1) });
    } else if (row.startsWith("\\")) {
      lines.push({ kind: "no-line-break" });
    }
  }
  return lines;
}

const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * Every path in either list, sorted, compared by bytes; for each that differs, its hunks from git diff --no-index (a side that lacks the file is /dev/null).
 * `maxBuffer` is raised because a kept file may be 2 MiB, past `execFile`'s 1 MiB default.
 */
export async function diffPackFiles(beforeDir: string, beforePaths: readonly string[], afterDir: string, afterPaths: readonly string[]): Promise<FileDiff[]> {
  const before = new Set(beforePaths);
  const after = new Set(afterPaths);
  const paths = [...new Set([...beforePaths, ...afterPaths])].sort(byBytes);
  return Promise.all(paths.map(async (path): Promise<FileDiff> => {
    const beforeFile = before.has(path) ? join(beforeDir, path) : "/dev/null";
    const afterFile = after.has(path) ? join(afterDir, path) : "/dev/null";
    const status: FileDiff["status"] = !before.has(path) ? "added" : !after.has(path) ? "removed" : (await readFile(beforeFile)).equals(await readFile(afterFile)) ? "unchanged" : "changed";
    if (status === "unchanged") return { path, status, added: 0, removed: 0, lines: [] };
    const patch = await git(afterDir, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--text", "--diff-algorithm=myers", "--indent-heuristic", "-U3", "--inter-hunk-context=0", "--", beforeFile, afterFile], { raw: true, okExitCodes: [1], maxBuffer: 16 * 1024 * 1024 });
    const lines = hunkLines(patch);
    return {
      path,
      status,
      added: lines.filter((line) => line.kind === "added").length,
      removed: lines.filter((line) => line.kind === "removed").length,
      lines,
    };
  }));
}
