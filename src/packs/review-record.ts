import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DamagedReview } from "../errors.js";
import { atomicWrite, isEnoent } from "../journal.js";
import { SessionUsage } from "../schema.js";
import { scanEnvelopeFor, ScanResult, type ScanEnvelope } from "./finding.js";

/** Owner-only: these files hold the agent's words about the project, which can quote anything in it. */
const PRIVATE = 0o600;

/** Where every review of a repository is kept: inside the self-ignoring `.delivery/`. */
export const packsRoot = (repoPath: string): string => join(repoPath, ".delivery", "packs");
export const reviewPlace = (repoPath: string, reviewId: string): string => join(packsRoot(repoPath), reviewId);

/** What a review records of the pack it ran, so the review reads back the same if the pack later changes or moves. */
export const PinnedPack = z.object({
  name: z.string(),
  version: z.string(),
  title: z.string(),
  hash: z.string(),
  maxFindings: z.int().min(1),
  categories: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
});

/** A review's header, written once the agent has replied: its existence is what makes a folder a review. */
export const ReviewHeader = z.object({
  reviewId: z.string(),
  pack: PinnedPack,
  repoPath: z.string(),
  commit: z.string(),
  fileCount: z.int().min(0),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});
export type ReviewHeader = z.infer<typeof ReviewHeader>;

const StoredReply = z.object({ envelope: z.unknown(), usage: SessionUsage.optional() });

/** The agent's reply as it was given, kept so a review interrupted before its list was saved is finished without asking again. */
export interface ScanReply {
  envelope: ScanEnvelope;
  usage?: SessionUsage;
}

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new DamagedReview(file);
    throw err;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: damaged, as below.
  }
  throw new DamagedReview(file);
}

const writePrivate = (file: string, data: unknown): Promise<void> => atomicWrite(file, JSON.stringify(data, null, 2), PRIVATE);

/**
 * Record a review the agent has replied to: its reply first, then its header,
 * each written whole. The header is written last because it is what makes the
 * folder a review, so a review always has the reply it is confirmed from.
 */
export async function startReview(repoPath: string, header: ReviewHeader, reply: { envelope: unknown; usage?: SessionUsage }): Promise<string> {
  const dir = reviewPlace(repoPath, header.reviewId);
  await mkdir(join(dir, "refs"), { recursive: true });
  await writePrivate(join(dir, "refs", "reply.json"), reply);
  await writePrivate(join(dir, "review.json"), header);
  return dir;
}

export const readHeader = (dir: string): Promise<ReviewHeader> => readJson(join(dir, "review.json"), ReviewHeader);

export async function readReply(dir: string, header: ReviewHeader): Promise<ScanReply> {
  const file = join(dir, "refs", "reply.json");
  const stored = await readJson(file, StoredReply);
  const envelope = scanEnvelopeFor(header.pack.categories.map((category) => category.id)).safeParse(stored.envelope);
  if (!envelope.success) throw new DamagedReview(file);
  return { envelope: envelope.data, ...(stored.usage === undefined ? {} : { usage: stored.usage }) };
}

/** Save the confirmed list: the step that finishes a review. */
export const saveResult = (dir: string, result: ScanResult): Promise<void> => writePrivate(join(dir, "refs", "scan.json"), result);

export type ReviewEntry =
  | { dir: string; state: "done"; header: ReviewHeader }
  | { dir: string; state: "unfinished"; header: ReviewHeader }
  | { dir: string; state: "damaged"; file: string };

export interface SavedReview {
  dir: string;
  header: ReviewHeader;
  result: ScanResult;
}

const STAMP = /(\d{8}T\d{6}Z)$/;
const stampOf = (name: string): string => STAMP.exec(name)?.[1] ?? "";

async function entryOf(dir: string): Promise<ReviewEntry> {
  try {
    const header = await readHeader(dir);
    if (existsSync(join(dir, "refs", "scan.json"))) return { dir, state: "done", header };
    await readReply(dir, header);
    return { dir, state: "unfinished", header };
  } catch (err) {
    if (err instanceof DamagedReview) return { dir, state: "damaged", file: err.filePath };
    throw err;
  }
}

/** Every review of the repository, newest first. A folder with no header never became a review and is not one. */
export async function listReviews(repoPath: string): Promise<ReviewEntry[]> {
  const root = packsRoot(repoPath);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const reviews = names
    .filter((name) => existsSync(join(root, name, "review.json")))
    .sort((a, b) => stampOf(b).localeCompare(stampOf(a)) || b.localeCompare(a));
  return Promise.all(reviews.map((name) => entryOf(join(root, name))));
}

export async function loadReview(entry: Extract<ReviewEntry, { state: "done" }>): Promise<SavedReview> {
  return { dir: entry.dir, header: entry.header, result: await readJson(join(entry.dir, "refs", "scan.json"), ScanResult) };
}
