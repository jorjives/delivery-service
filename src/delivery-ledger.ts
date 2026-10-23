import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { appendLine, isEnoent, parseLines } from "./journal.js";
import { PullRequestState } from "./pull-requests.js";

/**
 * What happened to each delivery branch (spec §5.7): opened at a base tip, a task landed, the base merged in, an attempt
 * to merge the base in blocked, levels dropped because their pull request was closed, a restack that moved levels (and
 * took the heads the owner pushed to adopted levels) onto new commits, and what the project's closer did. Machine-local,
 * beside the item ledger.
 */
export const DeliveryEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("opened"), branch: z.string(), base: z.string(), from: z.string(), stack: z.literal(true).optional(), at: z.string() }),
  z.object({ t: z.literal("landed"), branch: z.string(), runId: z.string(), key: z.string(), intent: z.string(), commit: z.string(), empty: z.literal(true).optional(), at: z.string() }),
  z.object({ t: z.literal("observed"), branch: z.string(), pullRequests: z.array(z.object({ ref: z.string(), url: z.string(), state: PullRequestState })), at: z.string() }),
  z.object({ t: z.literal("base_merged"), branch: z.string(), base: z.string(), commit: z.string(), at: z.string() }),
  z.object({ t: z.literal("blocked"), branch: z.string(), base: z.string(), baseTip: z.string(), tip: z.string(), reason: z.string(), pulls: z.string().optional(), at: z.string() }),
  z.object({ t: z.literal("restacked"), branch: z.string(), onto: z.string(), merged: z.array(z.string()), adopted: z.array(z.object({ runId: z.string(), commit: z.string() })).optional(), levels: z.array(z.object({ runId: z.string(), commit: z.string() })), at: z.string() }),
  z.object({ t: z.literal("dropped"), branch: z.string(), runs: z.array(z.string()), at: z.string() }),
  z.object({ t: z.literal("closed"), branch: z.string(), status: z.enum(["DONE", "FAIL", "ERROR"]), detail: z.string(), at: z.string() }),
]);
export type DeliveryEntry = z.infer<typeof DeliveryEntry>;
export type LandedEntry = Extract<DeliveryEntry, { t: "landed" }>;
export type BlockedEntry = Extract<DeliveryEntry, { t: "blocked" }>;
type RestackedEntry = Extract<DeliveryEntry, { t: "restacked" }>;
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
  /** The current section was opened in stack mode: its landings are read as levels of a stack, not as a rolling branch. */
  stacked: boolean;
  /** The current section's opening commit, or the base tip the last restack moved it onto. */
  from: string | null;
  /** The current section was restacked since the closer last succeeded. */
  restacked: boolean;
  /** Per run, the commits its level stood at before its current one, oldest first. */
  earlier: ReadonlyMap<string, readonly string[]>;
  /** Per level ref, what GitHub last showed for its pull request in the current section. */
  pullRequests: ReadonlyMap<string, { url: string; state: PullRequestState }>;
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
  let landed = section.filter((e): e is LandedEntry => e.t === "landed").filter((e, i, all) => all.findIndex((x) => x.runId === e.runId) === i);
  const lastDone = section.findLastIndex((e) => e.t === "closed" && e.status === "DONE");
  let pending = landed.filter((e) => section.indexOf(e) > lastDone);
  // Each restack takes the heads the owner pushed to adopted levels, then moves the levels it kept onto their new commits,
  // and drops the levels it merged into the base. Each commit a level stood at before is remembered in `earlier`.
  const earlier = new Map<string, string[]>();
  for (const restack of section.filter((e): e is RestackedEntry => e.t === "restacked")) {
    const settle = (commits: ReadonlyMap<string, string>): void => {
      for (const e of landed) {
        const commit = commits.get(e.runId);
        if (commit !== undefined && commit !== e.commit) earlier.set(e.runId, [...(earlier.get(e.runId) ?? []), e.commit]);
      }
      const relevel = (entries: readonly LandedEntry[]): LandedEntry[] =>
        entries.map((e) => {
          const commit = commits.get(e.runId);
          return commit === undefined ? e : { ...e, commit };
        });
      landed = relevel(landed);
      pending = relevel(pending);
    };
    settle(new Map((restack.adopted ?? []).map((level) => [level.runId, level.commit])));
    settle(new Map(restack.levels.map((level) => [level.runId, level.commit])));
    landed = landed.filter((e) => !restack.merged.includes(e.runId));
    pending = pending.filter((e) => !restack.merged.includes(e.runId));
  }
  // A dropped level was closed without merging: its landing no longer stands, whatever restacks came before.
  const dropped = new Set(section.flatMap((e) => (e.t === "dropped" ? e.runs : [])));
  landed = landed.filter((e) => !dropped.has(e.runId));
  pending = pending.filter((e) => !dropped.has(e.runId));
  const closed = section.findLast((e) => e.t === "closed");
  const restackedAt = section.findLastIndex((e) => e.t === "restacked");
  const blockedAt = section.findLastIndex((e) => e.t === "blocked");
  const cleared = section.findLastIndex((e) => e.t === "base_merged" || e.t === "opened" || e.t === "restacked" || e.t === "dropped");
  const blocked = blockedAt > cleared ? (section[blockedAt] as BlockedEntry) : null;
  const lastRestack = section.findLast((e): e is RestackedEntry => e.t === "restacked");
  const pullRequests = new Map<string, { url: string; state: PullRequestState }>();
  for (const e of section) if (e.t === "observed") for (const pr of e.pullRequests) pullRequests.set(pr.ref, { url: pr.url, state: pr.state });
  return {
    branch,
    base: opened?.base ?? null,
    openedAt: opened?.at ?? null,
    landed,
    pending,
    closer: closed?.t === "closed" ? { status: closed.status, detail: closed.detail, at: closed.at } : null,
    blocked,
    stacked: opened?.stack === true,
    from: lastRestack?.onto ?? opened?.from ?? null,
    restacked: restackedAt > lastDone,
    earlier,
    pullRequests,
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
