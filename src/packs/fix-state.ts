import { resolve } from "node:path";
import type { CaseFile, TerminusEntry } from "../schema.js";
import type { ReportDocument, ReportSurface } from "../report/document.js";
import { deriveReport } from "../report/derive.js";
import { loadSnapshot, type RecordSnapshot } from "../report/snapshot.js";
import { repoLocked } from "../repo-lock.js";
import { DamagedReview } from "../errors.js";
import { atOrAbove, type Finding } from "./finding.js";
import { fixTaskFor, type FixTask } from "./fix-task.js";
import { authorisations, readLedger, resolvedIds, signOffResults, allowedUnchecked, type LedgerEntry, type SignOffResult } from "./ledger.js";
import { changesTests, listReviews, loadReview, uncheckable, type ReviewHeader, type SavedReview } from "./review-record.js";
import { isGuard, needsTestChange } from "./guards.js";

/** Every state a problem can be in, internally. The owner reads them through `STATE_WORDS` (`render.ts`). */
export const FIX_STATES = ["proposed", "needs_decision", "approved", "skipped", "fixing", "fixed", "held", "signed_off_landed", "signed_off_failed", "rejected", "already_resolved", "unfixable", "stopped"] as const;
export type FixState = (typeof FIX_STATES)[number];

/** What the report says of a problem's fix, what each of its check rounds newly failed, oldest first, and the agent's own last account of it. */
export type FixRun = Pick<ReportSurface, "run" | "standing" | "closer" | "plain" | "branch" | "base"> & { rounds: string[][]; said: string | null };

/** Why a problem could not be fixed, where the harness can say so itself. Closed, so the words for each are total. */
export const UNFIXABLE_CAUSES = ["needs_test_change"] as const;
export type UnfixableCause = (typeof UNFIXABLE_CAUSES)[number];

/** What an earlier review of the same pack carries to a later one, by problem identity: the owner skipped it, declined its fix at sign-off, or it was fixed. Closed, so the words for each are total. */
export const EARLIER_CHOICES = ["skipped", "declined", "fixed"] as const;
export type EarlierChoice = (typeof EARLIER_CHOICES)[number];

export interface FindingState {
  state: FixState;
  fix: FixRun | undefined;
  /** Whether a check of its fix ever refused it for removing, changing or skipping tests. */
  refused: boolean;
  cause: UnfixableCause | null;
  /** What came of the owner's sign-off of a kept fix, or null when there is none yet. */
  signOff: SignOffResult | null;
  /**
   * What an earlier review carried to this problem, set only when this review has no choice of its own for it: skipped
   * or declined earlier (its state is then "skipped"), or fixed earlier and found again (it came back, so is offered).
   * Null when nothing was carried.
   */
  earlier: EarlierChoice | null;
}

/** A problem the owner has not decided on yet. */
export const UNDECIDED: FindingState = { state: "proposed", fix: undefined, refused: false, cause: null, signOff: null, earlier: null };

/** The agent's own account of its last finished attempt at a fix, verbatim; null when no attempt of it finished. A repair's words are not the fix's. */
export const lastWords = (history: CaseFile["history"]): string | null =>
  history.findLast((entry): entry is TerminusEntry => entry.t === "terminus" && (entry.role ?? "worker") === "worker" && entry.status === "completed")?.rationale ?? null;

/**
 * Each problem's fix as the report tells it, by the problem it fixes, read from one snapshot and the report derived
 * from it: the same reading a report is made from, so the two can never disagree. Tasks that fix no problem are left out.
 */
export function fixRunsOf(snapshot: RecordSnapshot, doc: ReportDocument): Map<string, FixRun> {
  const histories = new Map(snapshot.records.map((record) => [record.runId, record.caseFile.history]));
  return new Map(
    doc.surfaces.flatMap((surface) => {
      const id = surface.tags?.findingId;
      if (typeof id !== "string") return [];
      const history = surface.run === null ? [] : (histories.get(surface.run) ?? []);
      return [[id, { ...surface, rounds: gateRounds(history), said: lastWords(history) }] as const];
    }),
  );
}

/** An authorised problem's state from its fix's run: waiting for sign-off if held, delivered if fixed; a stop someone must act on is "could not be fixed", unless only an engineer can act, which is a setup problem. */
function fromRun(fix: FixRun | undefined, held: boolean): FixState {
  switch (fix?.standing) {
    case "closed":
      return held ? "held" : "fixed";
    case "escalated":
    case "aborted":
      return fix?.plain?.audience === "engineer" ? "stopped" : "unfixable";
    default:
      return "fixing";
  }
}

/** The ids each check round of a run newly failed, oldest first. */
export const gateRounds = (history: CaseFile["history"]): string[][] => history.flatMap((entry) => (entry.t === "gate" ? [entry.newFailures.map((failure) => failure.id)] : []));

/** A held fix's state from what came of its sign-off. Total over the results. */
function afterSignOff(result: SignOffResult | undefined): FixState {
  switch (result?.t) {
    case undefined:
      return "held";
    case "rejected":
      return "rejected";
    case "landed":
      return "signed_off_landed";
    case "not_landed":
      return "signed_off_failed";
  }
}

/** A state with what its fix's rounds say: refused if any round refused it; a test change needed if it could not be fixed and its last round refused a modified existing test and nothing else (never a deletion, a skip, a settings change or an ignored file). */
function stateOf(state: FixState, fix: FixRun | undefined, signOff: SignOffResult | null = null, earlier: EarlierChoice | null = null): FindingState {
  const rounds = fix?.rounds ?? [];
  const refused = rounds.some((round) => round.some(isGuard));
  const cause = state === "unfixable" && needsTestChange(rounds.at(-1) ?? []) ? "needs_test_change" : null;
  return { state, fix, refused, cause, signOff, earlier };
}

/**
 * Where each problem stands, as a fold: the ledger says what the owner chose and
 * what `delivery fix` took on, and the runs say how each fix went. Nothing about
 * a fix's outcome is stored twice. A problem that cannot be checked needs the owner's decision unless skipped.
 * An earlier review's choice (`earlier`) applies only where this review's ledger has none.
 * Aligned with `findings`.
 */
export function deriveFindings(
  findings: readonly Finding[],
  entries: readonly LedgerEntry[],
  fixes: ReadonlyMap<string, FixRun>,
  isUncheckable: (finding: Finding) => boolean,
  earlier: ReadonlyMap<string, EarlierChoice>,
): FindingState[] {
  const gone = resolvedIds(entries);
  const authorised = authorisations(entries);
  const choice = new Map<string, "approve" | "skip">();
  for (const entry of entries) if (entry.t === "decision") for (const id of entry.ids) choice.set(id, entry.choice);
  const allowed = allowedUnchecked(entries);
  const results = signOffResults(entries);
  return findings.map((finding) => {
    const fix = fixes.get(finding.id);
    if (gone.has(finding.id)) return stateOf("already_resolved", fix);
    const auth = authorised.get(finding.id);
    if (auth !== undefined) {
      const state = fromRun(fix, auth.hold === true);
      if (state !== "held") return stateOf(state, fix);
      const result = results.get(finding.id);
      return stateOf(afterSignOff(result), fix, result ?? null);
    }
    const chosen = choice.get(finding.id);
    if (chosen === "skip") return stateOf("skipped", fix);
    // This review has no choice for it: an earlier skip or decline stands; one fixed earlier and found again came back, so is offered again.
    const carried = chosen === undefined ? earlier.get(finding.id) : undefined;
    if (carried === "skipped" || carried === "declined") return stateOf("skipped", fix, null, carried);
    const state = isUncheckable(finding) && !(chosen === "approve" && allowed.has(finding.id)) ? "needs_decision" : chosen === "approve" ? "approved" : "proposed";
    return stateOf(state, fix, null, carried ?? null);
  });
}

/** What each decided state carries to a later review. A state missing here carries nothing. */
const CARRIED: Partial<Record<FixState, EarlierChoice>> = { skipped: "skipped", rejected: "declined", fixed: "fixed", signed_off_landed: "fixed", already_resolved: "fixed" };

/** Whether a fix ended by opening a pull request rather than landing: also what `stateWords` (`render.ts`) reads as "PR opened". */
export const opensPr = ({ state, fix, signOff }: FindingState): boolean =>
  (state === "fixed" && fix?.closer === "open-pr") || (state === "signed_off_landed" && signOff?.t === "landed" && signOff.closer.type === "open-pr");

/**
 * What earlier reviews carry, folded oldest first: each problem's latest decided state wins. A review that left a
 * problem undecided (or needing the owner's decision) keeps what came before; one where it went any other way
 * (approved, being fixed, waiting for sign-off, could not be fixed) carries nothing. Pure.
 */
export function carryOver(reviews: readonly { findings: readonly Finding[]; states: readonly FindingState[] }[]): Map<string, EarlierChoice> {
  const carried = new Map<string, EarlierChoice>();
  for (const { findings, states } of reviews) {
    findings.forEach((finding, index) => {
      const at = states[index] ?? UNDECIDED;
      const { state } = at;
      if (state === "proposed" || state === "needs_decision") return;
      // A fix that only opened a pull request has not removed the flagged code yet, so finding it again is not "came back".
      const choice = opensPr(at) ? undefined : CARRIED[state];
      if (choice === undefined) carried.delete(finding.id);
      else carried.set(finding.id, choice);
    });
  }
  return carried;
}

/** A problem skipped because of an earlier review and not chosen again here: left out of lists unless asked for. */
export const hiddenByDefault = (at: FindingState): boolean => at.state === "skipped" && at.earlier !== null;

/**
 * Whether a problem is recommended: still to decide (one that came back included), with a check of its own, and
 * mild enough that its fix lands without the owner's sign-off. Every specific check is the strongest level there is;
 * "tests only" is the weaker one. With no tests every fix waits for sign-off, so nothing is recommended.
 */
export const recommended = (header: Pick<ReviewHeader, "noTests" | "pack">, finding: Finding, at: FindingState): boolean =>
  at.state === "proposed" && finding.check.kind !== "none" && header.noTests !== true && !atOrAbove(finding.severity, header.pack.hold ?? null);

/**
 * One fix task per authorised problem still wanting a fix, in the review's order, each exactly as it was
 * authorised, so the queue recognises its run. A problem found already fixed has no task: it never runs, so
 * the plan the reading commands show must not list it as waiting to start.
 */
export function fixTasks({ header, result }: SavedReview, entries: readonly LedgerEntry[]): FixTask[] {
  const authorised = authorisations(entries);
  const gone = resolvedIds(entries);
  return result.findings.flatMap((finding) => {
    const auth = authorised.get(finding.id);
    if (auth === undefined || gone.has(finding.id)) return [];
    const guards = auth.guards === undefined ? undefined : { ...auth.guards, testsCategory: changesTests(header.pack, finding.category) };
    const release = auth.landing === undefined ? undefined : { hold: auth.hold ?? false, landing: auth.landing };
    return [fixTaskFor(header.pack.name, finding, auth.verify, guards, release, auth.review)];
  });
}

async function statesOf(repoPath: string, review: SavedReview, earlier: ReadonlyMap<string, EarlierChoice>): Promise<{ entries: LedgerEntry[]; tasks: FixTask[]; states: FindingState[] }> {
  const entries = await readLedger(review.dir);
  const tasks = fixTasks(review, entries);
  const snapshot = await loadSnapshot(repoPath, { kind: "list" }, { live: await repoLocked(repoPath), list: tasks });
  const doc = deriveReport(snapshot);
  return { entries, tasks, states: deriveFindings(review.result.findings, entries, fixRunsOf(snapshot, doc), (finding) => uncheckable(review.header, finding), earlier) };
}

/**
 * What the finished reviews of `review`'s pack made before it in this repository carry to it, each read as it stands
 * now. Each is read without carry-over of its own: `carryOver` lets an undecided state keep what came before.
 * ponytail: reads every earlier review's runs on each call; keep only the newest few if a long weekly history makes this slow.
 */
export async function earlierChoices(repoPath: string, review: SavedReview): Promise<Map<string, EarlierChoice>> {
  const all = await listReviews(repoPath);
  const at = all.findIndex((entry) => resolve(entry.dir) === resolve(review.dir));
  if (at === -1) return new Map();
  const read: { findings: Finding[]; states: FindingState[] }[] = [];
  for (const entry of all.slice(at + 1).toReversed()) {
    if (entry.state !== "done" || entry.header.pack.name !== review.header.pack.name) continue;
    try {
      const earlier = await loadReview(entry);
      read.push({ findings: earlier.result.findings, states: (await statesOf(repoPath, earlier, new Map())).states });
    } catch (err) {
      // A damaged earlier review carries nothing: its problems are offered again rather than guessed at.
      if (err instanceof DamagedReview) continue;
      throw err;
    }
  }
  return carryOver(read);
}

/** Where each of a review's problems stands now, read from its ledger, the project's runs and what earlier reviews of its pack decided. */
export async function readFindingStates(repoPath: string, review: SavedReview): Promise<{ entries: LedgerEntry[]; tasks: FixTask[]; states: FindingState[] }> {
  return statesOf(repoPath, review, await earlierChoices(repoPath, review));
}

/** Where a kept fix is: its run, its branch and the branch it is to land on. */
export interface KeptFix {
  runId: string;
  branch: string;
  base: string;
}

/** A problem's kept fix, when its run recorded where it is. */
export function keptFix({ fix }: FindingState): KeptFix | undefined {
  if (fix?.run == null || fix.branch === null || fix.base === null) return undefined;
  return { runId: fix.run, branch: fix.branch, base: fix.base };
}
