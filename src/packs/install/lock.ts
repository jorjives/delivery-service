import lockfile from "proper-lockfile";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { PackLockInvalid } from "../../errors.js";
import { atomicWrite, isEnoent } from "../../journal.js";
import { openSchema, type JsonSchema } from "../../report/json-schema.js";
import type { Pack } from "../manifest.js";
import { Slug } from "../pack-format.js";
import { PACKAGE_NAME, PACKAGE_REQUEST } from "./pack-spec.js";

export const PACKS_LOCK_SCHEMA = "delivery.packs-lock/1";
export const PACK_HASH_LABEL = "delivery.pack-hash/1:";
export const PACKS_LOCK_FILE = "packs.lock.json";

/** A pack's fingerprint as the record names it: the rule version, then the hash of everything the pack holds. */
const Fingerprint = z.string().regex(/^delivery\.pack-hash\/1:[0-9a-f]{64}$/);

/** An exact version, never a tag or a range: the record names the one version that was accepted. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** One added pack: the npm package and exact version it came from, the integrity npm published, the fingerprint installed and approved, and the digest of each file the fingerprint covers. */
export const LockEntry = z.strictObject({
  source: z.literal("npm"),
  package: z.string().max(214).regex(PACKAGE_NAME),
  request: z.string().regex(PACKAGE_REQUEST),
  version: z.string().regex(EXACT_VERSION),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+=*$/),
  fingerprint: Fingerprint,
  approved: Fingerprint,
  files: z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/)),
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
  // A key comes from the file, so it is quoted with its control characters escaped before it reaches a terminal.
  if (issue.code === "unrecognized_keys") return { field: [...path, JSON.stringify(issue.keys[0] ?? "")].join("."), detail: "is not a key this format names" };
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
    const issue = result.error.issues[0];
    if (issue === undefined) throw new PackLockInvalid(filePath, null, "is not a valid packs lock");
    const { field, detail } = describeIssue(issue);
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
 * Run `work` while holding the lock on the record, so two writers at once cannot both land: each waits its turn.
 * The lock is not re-entrant, so `work` must not take it again.
 */
export async function withRecordLock<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  const filePath = packsLockPath(repoPath);
  // The lock's folder sits beside the record, so the folder must exist before the lock is taken.
  await mkdir(dirname(filePath), { recursive: true });
  const release = await lockfile.lock(filePath, { realpath: false, retries: { retries: 20, minTimeout: 50 } });
  try {
    return await work();
  } finally {
    await release();
  }
}

/**
 * Set one pack's entry in the record: read it, change it, and write it whole, atomically. No lock is taken here,
 * so the caller must hold one (see `withRecordLock`).
 */
export async function setLockEntry(repoPath: string, name: string, entry: LockEntry): Promise<void> {
  const lock = await readLock(repoPath);
  lock.packs[name] = entry;
  await atomicWrite(packsLockPath(repoPath), serialiseLock(lock));
}

/**
 * Remove one pack's entry from the record: read it, drop the entry, and write it whole, atomically. No lock is taken
 * here, so the caller must hold one (see `withRecordLock`).
 */
export async function deleteLockEntry(repoPath: string, name: string): Promise<void> {
  const lock = await readLock(repoPath);
  const packs = Object.fromEntries(Object.entries(lock.packs).filter(([key]) => key !== name));
  await atomicWrite(packsLockPath(repoPath), serialiseLock({ ...lock, packs }));
}

/** Set one pack's entry in the record, under the record lock, so two adds at once both land. */
export const putLockEntry = (repoPath: string, name: string, entry: LockEntry): Promise<void> =>
  withRecordLock(repoPath, () => setLockEntry(repoPath, name, entry));

/** The JSON Schema of the record of added packs, as it is published. */
export const packsLockSchema = (): JsonSchema => ({ ...openSchema(PacksLock), title: PACKS_LOCK_SCHEMA });
