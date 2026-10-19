import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { branchExists, git, tryGit } from "./git-exec.js";
import { deliveryLedgerPath, recordDelivery } from "./delivery-ledger.js";
import { appendLine, isEnoent, parseLines } from "./journal.js";
import { branchName, resolveBaseRef } from "./provision.js";
import { repoKey, stateHome } from "./run-location.js";
import type { RunRecord } from "./run-records.js";
import { taskIntent } from "./task-list.js";
import type { CaseFile } from "./schema.js";

/** Autoloop's retry budget: how many runs in a row an item may end undelivered before it is set aside. */
export const DEFAULT_PARK_AFTER = 3;

/**
 * How a run of an item ended, as the next run acts on it (spec §5.11): delivered; interrupted (carried on in the
 * same work); exhausted (started afresh, the old branch kept); decision (waits for the operator's answer);
 * escalated (waits for the operator to unpark it); held (finished and checked, waits for the operator's sign-off).
 */
export const OutcomeClass = z.enum(["delivered", "interrupted", "exhausted", "decision", "escalated", "held"]);
export type OutcomeClass = z.infer<typeof OutcomeClass>;

const ParkReason = z.enum(["decision", "escalated", "attempts", "held"]);
export type ParkReason = z.infer<typeof ParkReason>;

export const LedgerEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("dispatched"), key: z.string(), runId: z.string(), intent: z.string(), at: z.string() }),
  z.object({ t: z.literal("ended"), key: z.string(), runId: z.string(), class: OutcomeClass, question: z.string().optional(), branch: z.string().optional(), commit: z.string().optional(), at: z.string() }),
  z.object({ t: z.literal("parked"), key: z.string(), reason: ParkReason, at: z.string() }),
  z.object({ t: z.literal("answered"), key: z.string(), answer: z.string().min(1), at: z.string() }),
  z.object({ t: z.literal("unparked"), key: z.string(), at: z.string() }),
  z.object({ t: z.literal("signed_off"), key: z.string(), at: z.string() }),
]);
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export interface ItemState {
  key: string;
  intent: string | null;
  attempts: number;
  lastRunId: string | null;
  settled: boolean;
  lastClass: OutcomeClass | null;
  question: string | null;
  answer: string | null;
  parked: ParkReason | null;
  signedOff: boolean; // the operator signed held work off, and no run has dispatched since
  lastClosedAt: string | null;
  branch: string | null; // the delivered run's branch
  commit: string | null; // the delivered work's tip: the branch tip, or the base tip when a closer already merged and deleted the branch
}

const fresh = (key: string): ItemState => ({
  key, intent: null, attempts: 0, lastRunId: null, settled: true, lastClass: null, question: null, answer: null, parked: null, signedOff: false, lastClosedAt: null, branch: null, commit: null,
});

/** Machine-local, beside the worktrees: it describes this machine's runs and means nothing in another clone. */
export function ledgerPath(repoPath: string, env: NodeJS.ProcessEnv): string {
  return join(stateHome(env), "delivery-service", "ledger", repoKey(repoPath), "items.jsonl");
}

function apply(state: ItemState, entry: LedgerEntry): ItemState {
  switch (entry.t) {
    case "dispatched":
      return { ...state, intent: entry.intent, lastRunId: entry.runId, settled: false, answer: null, signedOff: false };
    case "ended":
      return entry.class === "delivered"
        ? { ...state, settled: true, lastClass: "delivered", attempts: 0, question: null, lastClosedAt: entry.at, branch: entry.branch ?? null, commit: entry.commit ?? null }
        : { ...state, settled: true, lastClass: entry.class, attempts: state.attempts + 1, question: entry.question ?? null };
    case "parked":
      return { ...state, parked: entry.reason };
    case "answered":
      return { ...state, parked: null, attempts: 0, answer: entry.answer };
    case "unparked":
      return { ...fresh(state.key), intent: state.intent, lastClosedAt: state.lastClosedAt };
    case "signed_off":
      return { ...state, parked: null, attempts: 0, signedOff: true };
  }
}

export function foldLedger(entries: readonly LedgerEntry[]): Map<string, ItemState> {
  const states = new Map<string, ItemState>();
  for (const entry of entries) states.set(entry.key, apply(states.get(entry.key) ?? fresh(entry.key), entry));
  return states;
}

async function entriesAt(path: string): Promise<LedgerEntry[]> {
  try {
    return parseLines(await readFile(path, "utf-8"), (value) => LedgerEntry.parse(value));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

export async function readItemLedger(path: string): Promise<Map<string, ItemState>> {
  return foldLedger(await entriesAt(path));
}

async function append(path: string, entry: LedgerEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendLine(path, entry);
}

const now = (): string => new Date().toISOString();

/** How a finished run's record says it ended, for the next run to act on; undefined while it has no outcome. */
export function classOf(caseFile: CaseFile): OutcomeClass | undefined {
  const { outcome } = caseFile;
  if (outcome === undefined) return undefined;
  if (outcome.kind === "closed") return "delivered";
  if (outcome.kind === "aborted") return "exhausted";
  const cause = outcome.cause;
  if (cause?.kind === "decision") return "decision";
  if (cause?.kind === "held") return "held";
  // Accepted work that could not be landed (the close budget spent) is the operator's to look at, its accepted
  // branch kept (spec §5.7); starting it afresh would redo accepted work only to fail the same close again.
  if (cause?.kind === "budget" && cause.population === "close") return "escalated";
  if (cause?.kind === "budget") return cause.population === "terminus" ? "interrupted" : "exhausted";
  return "escalated";
}

/** Written before the run's record exists: the commit point a crash is recovered from. */
export async function recordDispatched(path: string, key: string, runId: string, intent: string): Promise<void> {
  await append(path, { t: "dispatched", key, runId, intent, at: now() });
}

function parkReasonOf(state: ItemState, parkAfter: number): ParkReason | null {
  if (state.lastClass === "held") return "held";
  if (state.lastClass === "decision") return "decision";
  if (state.lastClass === "escalated") return "escalated";
  if (state.lastClass !== "delivered" && state.attempts >= parkAfter) return "attempts";
  return null;
}

/**
 * The tip of the work a delivered run landed: its delivery branch, or its own branch, while that exists; otherwise a closer has merged it and
 * deleted the branch, and the local base branch's tip is it (a fast-forward merge-back leaves the two equal).
 * ponytail: read at settle time, straight after the close; a base that moved on in between still contains the work.
 */
async function deliveredCommit(record: RunRecord): Promise<string> {
  const branch = record.caseFile.header.delivery?.branch ?? branchName(record.runId);
  if (await branchExists(record.repoPath, branch)) return git(record.repoPath, ["rev-parse", branch]);
  return git(record.repoPath, ["rev-parse", (await resolveBaseRef(record.repoPath)).localBranch]);
}

/** Record how `record`'s run of `key` ended, and park the item when that says to. Returns the item's state after. */
export async function settleRun(path: string, key: string, record: RunRecord, parkAfter: number): Promise<ItemState> {
  const kind = classOf(record.caseFile);
  if (kind === undefined) throw new Error(`run ${record.runId} has not ended`);
  const question = record.caseFile.outcome?.cause?.question;
  const delivery = record.caseFile.header.delivery;
  const commit = kind === "delivered" ? await deliveredCommit(record) : undefined;
  // Landed before it is settled, so a crash between the two leaves the landing recorded and the run settled on the next run.
  if (delivery !== undefined && commit !== undefined) {
    await recordDelivery(deliveryLedgerPath(path), { t: "landed", branch: delivery.branch, runId: record.runId, key, intent: taskIntent(record.caseFile.header.taskDef), commit });
  }
  await append(path, {
    t: "ended", key, runId: record.runId, class: kind, at: now(),
    ...(kind === "decision" && question !== undefined ? { question } : {}),
    ...(commit === undefined ? {} : { branch: delivery?.branch ?? branchName(record.runId), commit }),
  });
  const state = (await readItemLedger(path)).get(key) ?? fresh(key);
  const reason = parkReasonOf(state, parkAfter);
  if (reason === null) return state;
  await append(path, { t: "parked", key, reason, at: now() });
  return { ...state, parked: reason };
}

export async function recordAnswer(path: string, key: string, answer: string): Promise<void> {
  await append(path, { t: "answered", key, answer, at: now() });
}

export async function recordUnpark(path: string, key: string): Promise<void> {
  await append(path, { t: "unparked", key, at: now() });
}

export async function recordSignOff(path: string, key: string): Promise<void> {
  await append(path, { t: "signed_off", key, at: now() });
}

export function parkedItems(ledger: Map<string, ItemState>): ItemState[] {
  return [...ledger.values()].filter((state) => state.parked !== null).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * Delivered work still on its way to the base: its commit is on the branch it landed on, or its commit is already on the local base branch
 * (a merge-back closer lands locally, pushes nothing and deletes the branch, while the backlog is read from `origin`
 * when there is one, so the item still reads `open` there). Neither holds when the branch was deleted without the work
 * reaching the base: then the item is for another run.
 */
export async function awaitsMerge(repoPath: string, state: ItemState | undefined): Promise<boolean> {
  if (state?.lastClass !== "delivered") return false;
  if (state.commit === null) return state.branch !== null && (await branchExists(repoPath, state.branch));
  // On its way while the branch it landed on still holds it: a delivery branch outlives the runs that land on it.
  if (state.branch !== null && (await tryGit(repoPath, ["merge-base", "--is-ancestor", state.commit, state.branch]))) return true;
  const { localBranch } = await resolveBaseRef(repoPath);
  return tryGit(repoPath, ["merge-base", "--is-ancestor", state.commit, localBranch]);
}
