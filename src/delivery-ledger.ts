import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { appendLine, isEnoent, parseLines } from "./journal.js";

/**
 * What happened to each delivery branch (spec §5.7): opened at a base tip, a task landed, the base merged in, an attempt
 * to merge the base in blocked, and what the project's closer did. Machine-local, beside the item ledger.
 */
export const DeliveryEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("opened"), branch: z.string(), base: z.string(), from: z.string(), at: z.string() }),
  z.object({ t: z.literal("landed"), branch: z.string(), runId: z.string(), key: z.string(), intent: z.string(), commit: z.string(), at: z.string() }),
  z.object({ t: z.literal("base_merged"), branch: z.string(), base: z.string(), commit: z.string(), at: z.string() }),
  z.object({ t: z.literal("blocked"), branch: z.string(), base: z.string(), baseTip: z.string(), tip: z.string(), reason: z.string(), at: z.string() }),
  z.object({ t: z.literal("closed"), branch: z.string(), status: z.enum(["DONE", "FAIL", "ERROR"]), detail: z.string(), at: z.string() }),
]);
export type DeliveryEntry = z.infer<typeof DeliveryEntry>;
export type LandedEntry = Extract<DeliveryEntry, { t: "landed" }>;
export type BlockedEntry = Extract<DeliveryEntry, { t: "blocked" }>;
type Unstamped = DeliveryEntry extends infer E ? (E extends DeliveryEntry ? Omit<E, "at"> : never) : never;

export interface DeliveryState {
  branch: string;
  base: string | null;
  openedAt: string | null;
  /** Since the branch last opened, one per run, oldest first. */
  landed: LandedEntry[];
  /** Of those, landed after the closer last succeeded. */
  pending: LandedEntry[];
  closer: { status: "DONE" | "FAIL" | "ERROR"; detail: string; at: string } | null;
  /** The last blocked attempt, unless the branch was opened or the base merged in since. */
  blocked: BlockedEntry | null;
}

export function deliveryLedgerPath(itemLedger: string): string {
  return join(dirname(itemLedger), "delivery.jsonl");
}

/** `branch` since it last opened: what landed (once per run), what the closer has yet to hand off, and what blocks it. */
export function foldDelivery(entries: readonly DeliveryEntry[], branch: string): DeliveryState {
  const own = entries.filter((e) => e.branch === branch);
  const section = own.slice(Math.max(0, own.findLastIndex((e) => e.t === "opened")));
  const opened = section[0]?.t === "opened" ? section[0] : undefined;
  // A run settled twice (a crash between the two writes) lands once.
  const landed = section.filter((e): e is LandedEntry => e.t === "landed").filter((e, i, all) => all.findIndex((x) => x.runId === e.runId) === i);
  const lastDone = section.findLastIndex((e) => e.t === "closed" && e.status === "DONE");
  const pending = landed.filter((e) => section.indexOf(e) > lastDone);
  const closed = section.findLast((e) => e.t === "closed");
  const blockedAt = section.findLastIndex((e) => e.t === "blocked");
  const cleared = section.findLastIndex((e) => e.t === "base_merged" || e.t === "opened");
  const blocked = blockedAt > cleared ? (section[blockedAt] as BlockedEntry) : null;
  return {
    branch,
    base: opened?.base ?? null,
    openedAt: opened?.at ?? null,
    landed,
    pending,
    closer: closed?.t === "closed" ? { status: closed.status, detail: closed.detail, at: closed.at } : null,
    blocked,
  };
}

export async function readDeliveryEntries(path: string): Promise<DeliveryEntry[]> {
  try {
    return parseLines(await readFile(path, "utf-8"), (value) => DeliveryEntry.parse(value));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

export async function readDelivery(path: string, branch: string): Promise<DeliveryState> {
  return foldDelivery(await readDeliveryEntries(path), branch);
}

export async function recordDelivery(path: string, entry: Unstamped): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendLine(path, { ...entry, at: new Date().toISOString() });
}
