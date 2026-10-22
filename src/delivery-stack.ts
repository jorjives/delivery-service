import { readDelivery, type DeliveryState } from "./delivery-ledger.js";
import { branchExists, git } from "./git-exec.js";
import type { PullRequestState } from "./pull-requests.js";

/** The ref a stack level's pull request is opened from: named by the base it stands on and the run that landed it. */
export const levelRefOf = (base: string, runId: string): string => `delivery-stack/${base}/${runId}`;

/** One level of a stack: the commits one item landed on the delivery branch, and the pull request that carries them. */
export interface StackLevel {
  run: string;
  item: string;
  intent: string;
  commit: string;
  ref: string;
  parent: string;
  at: string;
  /** The commits this level stood at before its current one, oldest first. */
  earlier: readonly string[];
  pr: { url: string; state: PullRequestState } | null;
}

/**
 * The levels of a stacked delivery branch, bottom first. Which items have a level is the ledger's; the order they stand in
 * is where each landed on the branch, `line` (its first-parent commits after the section's opening, oldest first).
 * Ledger order is settle order, which need not be landing order, so it is not trusted for stacking.
 *
 * An item that landed nothing of its own is no level: a landing marked `empty`, one at the opening commit, and one at a
 * commit an earlier level already holds. A commit not on `line` sorts after those that are, in ledger order.
 */
export function stackOf(state: DeliveryState, line: readonly string[]): StackLevel[] {
  if (!state.stacked || state.base === null) return [];
  const base = state.base;
  const position = new Map(line.map((commit, i) => [commit, i]));
  const rank = (commit: string): number => position.get(commit) ?? line.length;
  // Array.prototype.sort is stable, so entries off the line (all ranked last) and entries sharing a commit keep ledger order.
  const ordered = state.landed
    .filter((entry) => entry.empty !== true && entry.commit !== state.from)
    .sort((a, b) => rank(a.commit) - rank(b.commit));
  const held = new Set<string>();
  const levels: StackLevel[] = [];
  let parent = base;
  for (const entry of ordered) {
    if (held.has(entry.commit)) continue;
    held.add(entry.commit);
    const ref = levelRefOf(base, entry.runId);
    levels.push({ run: entry.runId, item: entry.key, intent: entry.intent, commit: entry.commit, ref, parent, at: entry.at, earlier: state.earlier.get(entry.runId) ?? [], pr: state.pullRequests.get(ref) ?? null });
    parent = ref;
  }
  return levels;
}

/** The stack of `branch` as the closer published it: levels in landing order, read from the branch's first-parent line. */
export async function readStack(repoPath: string, ledger: string, branch: string): Promise<StackLevel[]> {
  const state = await readDelivery(ledger, branch);
  if (!state.stacked || state.from === null) return stackOf(state, []);
  const line = (await branchExists(repoPath, branch))
    ? (await git(repoPath, ["rev-list", "--first-parent", "--reverse", `${state.from}..refs/heads/${branch}`])).split("\n").filter((commit) => commit !== "")
    : [];
  return stackOf(state, line);
}
