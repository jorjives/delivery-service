import { randomBytes } from "node:crypto";
import { open, rename } from "node:fs/promises";

/**
 * The crash-safe write-and-append discipline every record the harness keeps
 * shares: a JSON file is only ever replaced whole, through a temporary file and
 * a rename, and a journal is only ever appended to, one JSON value per line,
 * synced before the call returns. The case file and the supervised run file
 * both build on this, so the two can never drift apart.
 */
export async function writeAndSync(filePath: string, flag: "w" | "a", data: string, mode?: number): Promise<void> {
  const fd = await open(filePath, flag, mode);
  try {
    await fd.write(data);
    await fd.datasync();
  } finally {
    await fd.close();
  }
}

/**
 * Replace a file whole: a reader sees the old contents or the new, never half of either.
 * `mode` is the permissions the file is created with; left out, the platform's default.
 */
export async function atomicWrite(filePath: string, data: string, mode?: number): Promise<void> {
  // Suffixed with a random token, not a fixed ".tmp": two writers racing to replace the same
  // path (two tasks of one run writing the same content-hashed fence wrapper, say) must not
  // share a temporary file, or one's rename can find the other has already moved it away.
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeAndSync(tmp, "w", data, mode);
  await rename(tmp, filePath);
}

/** Replace a JSON file whole. */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(data, null, 2));
}

/** Append one value to a journal as its own line. */
export async function appendLine(filePath: string, value: unknown): Promise<void> {
  await writeAndSync(filePath, "a", JSON.stringify(value) + "\n");
}

export function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

/** A journal line that cannot be read and is not the last one, so it is not a torn append: the journal itself is damaged. */
export class MalformedLine extends Error {
  constructor(
    readonly line: number,
    cause: unknown,
  ) {
    super(`Malformed log entry at line ${line}: ${String(cause)}`);
    this.name = "MalformedLine";
  }
}

/**
 * A journal's entries, oldest first. The final line alone may be cut short by
 * a crash mid-append, so one that will not parse is dropped; a bad line
 * anywhere else throws `MalformedLine`, for the owner to name in its own error.
 */
export function parseLines<T>(raw: string, parse: (value: unknown) => T): T[] {
  if (raw.trim().length === 0) return [];
  const lines = raw.trimEnd().split("\n");
  const entries: T[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(parse(JSON.parse(line)));
    } catch (err) {
      if (index === lines.length - 1) break;
      throw new MalformedLine(index + 1, err);
    }
  }
  return entries;
}
