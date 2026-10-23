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

/** GitHub's view of one level's pull request, as the run observed it. */
export interface ObservedPull {
  url: string;
  state: PullRequestState;
  head: string;
  base: string;
  mergeCommit: string | null;
}

export type StackPlan =
  | { kind: "none" }
  | { kind: "restack"; merged: StackLevel[]; remaining: StackLevel[]; adopted: ReadonlyMap<string, string> }
  | { kind: "drop"; merged: StackLevel[]; remaining: StackLevel[]; closed: StackLevel[]; adopted: ReadonlyMap<string, string> }
  | { kind: "blocked"; reason: string };

/**
 * What a stack should do, given GitHub's view of its pull requests (`observed`, keyed by level ref; a level with no entry is
 * OPEN with no head). A merged level has reached the base when its merge commit is held by the base, or when it was merged
 * into the level below before that level merged and that level has itself reached the base. Blocks are checked before waits.
 * A level closed without merging is the owner saying no: it and every level above it are dropped, and only the levels below
 * it are checked for blocks.
 */
export function planStack(
  levels: readonly StackLevel[],
  observed: ReadonlyMap<string, ObservedPull>,
  context: {
    base: string;
    held: ReadonlySet<string>;
    carried: ReadonlyMap<string, boolean>;
    extended: ReadonlyMap<string, boolean>;
  },
): StackPlan {
  const { base, held, carried, extended } = context;
  const pullAt = (i: number): ObservedPull | undefined => observed.get(levels[i]?.ref ?? "");
  const stateAt = (i: number): ObservedPull["state"] => pullAt(i)?.state ?? "OPEN";
  const belowRefAt = (i: number): string | undefined => (i > 0 ? levels[i - 1]?.ref : undefined);
  const linkAt = (i: number): string => {
    const below = levels[i - 1];
    return (below && observed.get(below.ref)?.url) ?? below?.ref ?? "";
  };
  const isHeld = (pull: ObservedPull): boolean => pull.mergeCommit !== null && held.has(pull.mergeCommit);
  const blocked = (reason: string): StackPlan => ({ kind: "blocked", reason });
  const recovery = (pull: ObservedPull): string =>
    `A merge cannot be undone, so the stack stays blocked until that work is in ${base}: push ${pull.mergeCommit ? `commit ${pull.mergeCommit.slice(0, 7)}` : "its merge commit"} to a new branch, open a pull request from that branch to ${base}, and merge it with a merge commit. A squash or rebase merge of it is not recognised.`;

  const reached: boolean[] = [];
  levels.forEach((level, i) => {
    const pull = pullAt(i);
    let ok = false;
    if (pull?.state === "MERGED") {
      if (isHeld(pull)) ok = true;
      else ok = i > 0 && pull.base === belowRefAt(i) && carried.get(level.ref) === true && reached[i - 1] === true;
    }
    reached.push(ok);
  });

  const closedAt = levels.findIndex((_, i) => stateAt(i) === "CLOSED");
  // The levels that stay: a level above a close is going, so what it shows cannot block.
  const staying = closedAt >= 0 ? closedAt : levels.length;

  const elsewhere = levels.findIndex((_, i) => {
    if (i >= staying) return false;
    const pull = pullAt(i);
    return pull?.state === "MERGED" && !isHeld(pull) && pull.base !== base && pull.base !== belowRefAt(i);
  });
  if (elsewhere >= 0) {
    const pull = pullAt(elsewhere);
    if (pull) {
      return blocked(`${pull.url}, the pull request for ${levels[elsewhere]?.intent}, was merged into ${pull.base}, which is neither ${base} nor the branch of the level below it, so its work has not reached ${base}. ${recovery(pull)}`);
    }
  }

  const firstOpen = levels.findIndex((_, i) => stateAt(i) !== "MERGED");
  const mergedAboveOpen = firstOpen >= 0 ? levels.findIndex((_, i) => i > firstOpen && stateAt(i) === "MERGED") : -1;
  if (mergedAboveOpen >= 0) {
    const pull = pullAt(mergedAboveOpen);
    return blocked(`${pull?.url}, the pull request for ${levels[mergedAboveOpen]?.intent}, was merged into ${pull?.base} while ${linkAt(mergedAboveOpen)}, below it, is not merged yet. Once that is merged, the next run carries on.`);
  }

  const adopted = new Map<string, string>();
  for (const [i, level] of levels.entries()) {
    const pull = pullAt(i);
    if (i >= staying || pull?.state !== "OPEN" || pull.head === level.commit || level.earlier.includes(pull.head)) continue;
    if (extended.get(level.ref) === true) {
      adopted.set(level.ref, pull.head);
      continue;
    }
    const lost = level.commit.slice(0, 7);
    return blocked(`${pull.url}, the pull request for ${level.intent}, no longer holds ${lost}, the commit this machine last made for ${level.ref}: its branch was rewritten, so the stack was left as it is rather than overwrite it. Push commits on top of ${lost} to that branch, or close the pull request to drop it.`);
  }

  let prefix = 0;
  while (prefix < levels.length && stateAt(prefix) === "MERGED") prefix++;

  const stranded = levels.findIndex((_, i) => i < prefix && i < staying && !reached[i] && pullAt(i)?.base === belowRefAt(i) && carried.get(levels[i]?.ref ?? "") === false);
  if (stranded >= 0) {
    const pull = pullAt(stranded);
    if (pull) {
      return blocked(`${pull.url}, the pull request for ${levels[stranded]?.intent}, was merged into ${pull.base} after ${linkAt(stranded)}, below it, had already been merged, so its work has not reached ${base}. ${recovery(pull)}`);
    }
  }

  const reachedBase = prefix === 0 || reached.slice(0, prefix).every((ok) => ok);
  if (closedAt >= 0) {
    return reachedBase ? { kind: "drop", merged: levels.slice(0, prefix), remaining: levels.slice(prefix, closedAt), closed: levels.slice(closedAt), adopted } : { kind: "none" };
  }
  if (prefix >= 1 && reachedBase) {
    return { kind: "restack", merged: levels.slice(0, prefix), remaining: levels.slice(prefix), adopted };
  }
  if (adopted.size > 0) return { kind: "restack", merged: [], remaining: [...levels], adopted };
  return { kind: "none" };
}

/** A stable fingerprint of what GitHub reported, so a changed observation is noticed whatever order it arrived in. */
export function pullsFingerprint(observed: ReadonlyMap<string, ObservedPull>): string {
  return [...observed]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ref, pull]) => `${ref} ${pull.state} ${pull.head}`)
    .join("\n");
}
