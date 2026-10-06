import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { git } from "./git-exec.js";
import type { GateRef, RepairChanges, RepairFileStatus } from "./schema.js";

/** The most patch text one repair keeps, across all its files. */
export const PATCH_CAP_BYTES = 256 * 1024;

/** `target` as a `/`-separated path inside `base`, or nothing when it resolves outside it. */
function inside(base: string, target: string): string[] {
  const path = relative(base, resolve(base, target));
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return [];
  return [path.split(sep).join("/")];
}

/**
 * The paths in a working copy that the check itself runs: a custom check's
 * module (resolved against the repository, as the check is loaded), or a
 * command's first word taken as a path in the working copy. A fact about
 * paths, nothing more: `npm` names a file called `npm`, which a repair
 * changing would indeed be changing a file the command runs.
 */
export function checkFilesOf(gateRef: GateRef, { repoPath, worktreePath }: { repoPath: string; worktreePath: string }): string[] {
  if (gateRef.type === "custom") return inside(repoPath, gateRef.modulePath);
  const [first] = gateRef.command.trim().split(/\s+/);
  return first ? inside(worktreePath, first) : [];
}

/**
 * The whole working copy, tracked and untracked files alike (ignored ones
 * excepted), written as a tree through a private index built afresh (so every
 * file is hashed from its content, not trusted from the working copy's stat cache). Its own index, and so what is staged, is never
 * touched; the only lasting effect is unreferenced objects git tidies away.
 */
export async function treeOf(worktreePath: string): Promise<string> {
  // A folder below the top would have git describe the whole copy it sits in.
  if ((await git(worktreePath, ["rev-parse", "--show-prefix"])) !== "") throw new Error(`${worktreePath} is not the top of a working copy`);
  const scratch = await mkdtemp(join(tmpdir(), "delivery-repair-"));
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  try {
    // Built from an empty index, never a copy: a copy would let git trust its stat cache and miss a same-size edit made within one timestamp tick.
    await git(worktreePath, ["add", "-A"], { env });
    return await git(worktreePath, ["write-tree"], { env });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const STATUS: Record<string, RepairFileStatus> = { A: "added", D: "deleted", M: "modified", T: "modified" };

const fields = (output: string): string[] => output.split("\0").filter((field) => field !== "");

/** One file's patch, or nothing when it would not fit in what is left of the cap. */
async function patchOf(worktreePath: string, before: string, after: string, path: string, room: number): Promise<string | undefined> {
  if (room <= 0) return undefined;
  try {
    return await git(worktreePath, ["--literal-pathspecs", "diff-tree", "-p", "--no-renames", before, after, "--", path], { maxBuffer: room });
  } catch (err) {
    if ((err as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return undefined;
    throw err;
  }
}

async function changesBetween(worktreePath: string, before: string, after: string, checkFiles: readonly string[]): Promise<RepairChanges> {
  const diff = (format: string): Promise<string> => git(worktreePath, ["diff-tree", "-r", "--no-renames", format, "-z", before, after]);
  const named = fields(await diff("--name-status"));
  const counts = new Map(
    fields(await diff("--numstat")).map((line) => {
      const [added = "-", removed = "-", ...path] = line.split("\t");
      return [path.join("\t"), { added, removed }] as const;
    }),
  );
  let room = PATCH_CAP_BYTES;
  let truncated = false;
  const files: RepairChanges["files"] = [];
  for (let index = 0; index + 1 < named.length; index += 2) {
    const letter = named[index] ?? "M";
    const path = named[index + 1] ?? "";
    const count = counts.get(path);
    // git counts a binary file's lines as "-": it has no lines to count, and no patch worth keeping.
    const binary = count === undefined || count.added === "-";
    const patch = binary ? undefined : await patchOf(worktreePath, before, after, path, room);
    if (patch === undefined) truncated = true;
    else room -= Buffer.byteLength(patch);
    files.push({
      path,
      status: STATUS[letter] ?? "modified",
      added: binary ? 0 : Number(count.added),
      removed: binary ? 0 : Number(count.removed),
      touchesCheck: checkFiles.includes(path),
      ...(patch === undefined ? {} : { patch }),
    });
  }
  return { files, truncated };
}

/**
 * Run one repair session and say what it changed in the working copy: the
 * copy as a tree before, the session, the copy as a tree after, and the
 * difference. Read-only, so what the task finally lands is what it would have
 * been. Seeing what a repair changed must never change what a run does, so a
 * working copy git cannot read is captured as nothing (the report then says it
 * was not recorded) and the session's own result, or failure, is passed on
 * untouched.
 */
export async function captureRepair<T>(
  worktreePath: string,
  checkFiles: readonly string[],
  session: () => Promise<T>,
): Promise<{ result: T; changes: RepairChanges | undefined }> {
  const before = await treeOf(worktreePath).catch(() => undefined);
  const result = await session();
  if (before === undefined) return { result, changes: undefined };
  const changes = await treeOf(worktreePath)
    .then((after) => changesBetween(worktreePath, before, after, checkFiles))
    .catch(() => undefined);
  return { result, changes };
}
