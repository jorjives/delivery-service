import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AfterStep } from "./cli/config.js";
import { HeldItem } from "./follow-ups.js";
import { appendLine, isEnoent, parseLines } from "./journal.js";

/** A follow-up held by a landed task, with the task's run and the source that raises it. */
export const FollowUp = HeldItem.extend({ run: z.string(), source: z.string() });
export type FollowUp = z.infer<typeof FollowUp>;

/** The built-in first step whenever landed tasks held follow-ups: raise them through their source (spec §5.7). */
export const RAISE = { raise: true as const };

/**
 * One step of a batch, as recorded when the batch began: which `after` list it came from (`project`, a workflow's
 * name, or `follow-ups`), how reports name it, the step itself, and, for an agent pass on a tracker-backed project,
 * the source its new items are raised through (absent: they land on the delivery branch).
 * What is recorded is what was planned and what reports show; a step that is still to run is run as the config defines it
 * at that time (`currentStep`, Task 8), so fixing a typo repairs a stuck step.
 */
export const PlannedStep = z.object({ for: z.string(), label: z.string(), step: z.union([AfterStep, z.object({ raise: z.literal(true) }).strict()]), raiseVia: z.string().optional() });
export type PlannedStep = z.infer<typeof PlannedStep>;

/**
 * What happened after work landed (spec §5.7): a batch begun once the closer took the delivery branch, what an agent
 * step left, each follow-up raised (so a retry never raises it twice), and each step's outcome. Machine-local.
 */
export const AfterEntry = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("batch"), batch: z.string(), branch: z.string(), base: z.string(), commit: z.string(),
    landed: z.array(z.object({ run: z.string(), item: z.string(), intent: z.string() })), followUps: z.array(FollowUp), steps: z.array(PlannedStep), at: z.string(),
  }),
  z.object({ t: z.literal("held"), batch: z.string(), index: z.number().int().nonnegative(), items: z.array(HeldItem), discarded: z.array(z.string()), at: z.string() }),
  z.object({ t: z.literal("raised"), batch: z.string(), file: z.string(), id: z.string(), at: z.string() }),
  z.object({ t: z.literal("step"), batch: z.string(), index: z.number().int().nonnegative(), status: z.enum(["done", "failed", "skipped"]), detail: z.string(), at: z.string() }),
]);
export type AfterEntry = z.infer<typeof AfterEntry>;
export type BatchEntry = Extract<AfterEntry, { t: "batch" }>;
type Unstamped = AfterEntry extends infer E ? (E extends AfterEntry ? Omit<E, "at"> : never) : never;

export type StepStatus = "done" | "failed" | "skipped" | "pending";

/** A finished step is never run again: it worked, or it was skipped (superseded, dropped, or gone from the config). */
export const finished = (status: StepStatus | undefined): boolean => status === "done" || status === "skipped";

export interface BatchState {
  batch: BatchEntry;
  /** The first step not finished: where a retry starts. Equal to the number of steps once the batch is finished. */
  next: number;
  steps: { status: StepStatus; detail: string | null; at: string | null }[];
  raised: Map<string, string>;
  held: Map<number, { items: HeldItem[]; discarded: string[] }>;
}

export function afterLedgerPath(itemLedger: string): string {
  return join(dirname(itemLedger), "after.jsonl");
}

export function foldAfter(entries: readonly AfterEntry[]): BatchState[] {
  const states = new Map<string, BatchState>();
  for (const entry of entries) {
    if (entry.t === "batch") {
      states.set(entry.batch, { batch: entry, next: 0, steps: entry.steps.map(() => ({ status: "pending", detail: null, at: null })), raised: new Map(), held: new Map() });
      continue;
    }
    const state = states.get(entry.batch);
    if (state === undefined) continue;
    if (entry.t === "raised") state.raised.set(entry.file, entry.id);
    if (entry.t === "held") state.held.set(entry.index, { items: entry.items, discarded: entry.discarded });
    if (entry.t === "step" && !finished(state.steps[entry.index]?.status)) state.steps[entry.index] = { status: entry.status, detail: entry.detail, at: entry.at };
  }
  for (const state of states.values()) {
    const first = state.steps.findIndex((step) => !finished(step.status));
    state.next = first === -1 ? state.steps.length : first;
  }
  return [...states.values()];
}

export const isPending = (state: BatchState): boolean => state.next < state.batch.steps.length;

/** How many of a batch's steps are still to run. */
export const waiting = (state: BatchState): number => state.steps.filter((step) => !finished(step.status)).length;

export async function readAfter(path: string): Promise<BatchState[]> {
  try {
    return foldAfter(parseLines(await readFile(path, "utf-8"), (value) => AfterEntry.parse(value)));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

export async function recordAfter(path: string, entry: Unstamped): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendLine(path, { ...entry, at: new Date().toISOString() });
}
