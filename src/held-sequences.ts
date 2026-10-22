import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { atomicWriteJson, isEnoent } from "./journal.js";
import type { ItemState } from "./item-ledger.js";

/** Why a sequence waits on its earliest undelivered item: parked, waiting for the operator's answer, or being worked (spec §5.10). */
export const HoldReason = z.enum(["parked", "decision", "in_flight"]);
export type HoldReason = z.infer<typeof HoldReason>;

/** A sequence that has items waiting behind its earliest undelivered one, why that one has not moved on, and the source that listed it. */
export const Held = z.object({ sequence: z.string(), item: z.string(), source: z.string(), reason: HoldReason });
export type Held = z.infer<typeof Held>;

const HeldFile = z.object({ at: z.string(), held: z.array(Held) });

/** Beside the item ledger: what `delivery run --sources` has found held, source by source (see `mergeHeld`). */
export function heldPath(itemLedger: string): string {
  return join(dirname(itemLedger), "held.json");
}

/** This run's holds for the sources it read, plus the earlier holds of the sources it did not (a run stops reading at `max`). */
export function mergeHeld(previous: readonly Held[], held: readonly Held[], read: readonly string[]): Held[] {
  const found = new Set(held.map((h) => h.sequence));
  const kept = previous.filter((h) => !read.includes(h.source) && !found.has(h.sequence));
  return [...kept, ...held];
}

export async function recordHeld(path: string, held: readonly Held[], read: readonly string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteJson(path, { at: new Date().toISOString(), held: mergeHeld(await readHeld(path), held, read) });
}

export async function readHeld(path: string): Promise<Held[]> {
  try {
    return HeldFile.parse(JSON.parse(await readFile(path, "utf-8"))).held;
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/** Why an item holds its sequence now, by the item ledger alone, or null when it holds nothing up. */
export function holdReasonOf(state: ItemState | undefined): HoldReason | null {
  if (state === undefined) return null;
  if (state.parked !== null) return state.parked === "decision" ? "decision" : "parked";
  return state.settled ? null : "in_flight";
}

/** The recorded holds still true, each with the reason its holder has now. */
export function stillHeld(held: readonly Held[], ledger: ReadonlyMap<string, ItemState>): { sequence: string; item: string; reason: HoldReason }[] {
  return held.flatMap(({ sequence, item }) => {
    const reason = holdReasonOf(ledger.get(item));
    return reason === null ? [] : [{ sequence, item, reason }];
  });
}
