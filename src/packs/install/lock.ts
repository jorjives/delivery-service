import lockfile from "proper-lockfile";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { PackLockInvalid } from "../../errors.js";
import { atomicWrite, isEnoent } from "../../journal.js";
import { openSchema, type JsonSchema } from "../../report/json-schema.js";
import type { Pack } from "../manifest.js";
import { Slug } from "../pack-format.js";

export const PACKS_LOCK_SCHEMA = "delivery.packs-lock/1";
export const PACK_HASH_LABEL = "delivery.pack-hash/1:";
export const PACKS_LOCK_FILE = "packs.lock.json";

/** A pack's fingerprint as the record names it: the rule version, then the hash of everything the pack holds. */
const Fingerprint = z.string().regex(/^delivery\.pack-hash\/1:[0-9a-f]{64}$/);

/** One added pack: the npm package and exact version it came from, the integrity npm published, and the fingerprint installed and approved. */
export const LockEntry = z.strictObject({
  source: z.literal("npm"),
  package: z.string().min(1),
  request: z.string().min(1),
  version: z.string().min(1),
  integrity: z.string().regex(/^sha512-/),
  fingerprint: Fingerprint,
  approved: Fingerprint,
});
export type LockEntry = z.infer<typeof LockEntry>;

/** The committed record of added packs, keyed by each pack's name. */
export const PacksLock = z.strictObject({
  schema: z.literal(PACKS_LOCK_SCHEMA),
  packs: z.record(Slug, LockEntry),
});
export type PacksLock = z.infer<typeof PacksLock>;

const NEWER_SCHEMA = /^delivery\.packs-lock\/(\d+)$/;

/** The fingerprint a pack is labelled with: its rule version, then its hash. */
export const fingerprintOf = (pack: Pack): string => PACK_HASH_LABEL + pack.hash;

export const packsLockPath = (repoPath: string): string => join(repoPath, ".delivery", PACKS_LOCK_FILE);

const emptyLock = (): PacksLock => ({ schema: PACKS_LOCK_SCHEMA, packs: {} });

type Issue = z.ZodError["issues"][number];

/** The field an issue is about, and one plain phrase of what is wrong with it. */
function describeIssue(issue: Issue): { field: string | null; detail: string } {
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") return { field: [...path, issue.keys[0]].join("."), detail: "is not a key this format names" };
  const field = path.length === 0 ? null : path.join(".");
  return { field, detail: issue.code === "invalid_type" && issue.message.includes("received undefined") ? "is missing" : "is not valid" };
}

function parseLock(filePath: string, text: string): PacksLock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackLockInvalid(filePath, null, "is not JSON");
  }
  const declared = (raw as { schema?: unknown } | null)?.schema;
  const newer = typeof declared === "string" ? NEWER_SCHEMA.exec(declared) : null;
  if (newer !== null && Number(newer[1]) > 1) {
    throw new PackLockInvalid(filePath, null, "is from a newer delivery-service than this one: upgrade delivery-service to read it");
  }
  const result = PacksLock.safeParse(raw);
  if (!result.success) {
    const { field, detail } = describeIssue(result.error.issues[0]!);
    throw new PackLockInvalid(filePath, field, detail);
  }
  return result.data;
}

/** The record of added packs as it stands; an absent file is an empty record. */
export async function readLock(repoPath: string): Promise<PacksLock> {
  const filePath = packsLockPath(repoPath);
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return emptyLock();
    throw err;
  }
  return parseLock(filePath, text);
}

/** Every object's keys sorted, so the same entries always give the same bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

/** The record as the file holds it: keys sorted at every level, two-space JSON, a final newline. */
export const serialiseLock = (lock: PacksLock): string => JSON.stringify(sortKeys(lock), null, 2) + "\n";

/**
 * Set one pack's entry in the record. Under a lock on the record, so two adds at once both land:
 * the record is read, changed and written whole while no other add can write it.
 */
export async function putLockEntry(repoPath: string, name: string, entry: LockEntry): Promise<void> {
  const filePath = packsLockPath(repoPath);
  // The lock's folder sits beside the record, so the folder must exist before the lock is taken.
  await mkdir(dirname(filePath), { recursive: true });
  const release = await lockfile.lock(filePath, { realpath: false, retries: { retries: 20, minTimeout: 50 } });
  try {
    const lock = await readLock(repoPath);
    lock.packs[name] = entry;
    await atomicWrite(filePath, serialiseLock(lock));
  } finally {
    await release();
  }
}

/** The JSON Schema of the record of added packs, as it is published. */
export const packsLockSchema = (): JsonSchema => ({ ...openSchema(PacksLock), title: PACKS_LOCK_SCHEMA });
