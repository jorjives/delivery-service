import type { CaseFile, TerminusEntry } from "../schema.js";
import type { ReportDocument, ReportSurface } from "../report/document.js";
import { deriveReport } from "../report/derive.js";
import { loadSnapshot, type RecordSnapshot } from "../report/snapshot.js";
import { repoLocked } from "../repo-lock.js";
import type { Finding } from "./finding.js";
import { fixTaskFor, type FixTask } from "./fix-task.js";
import { authorisations, readLedger, resolvedIds, signOffResults, allowedUnchecked, type LedgerEntry, type SignOffResult } from "./ledger.js";
import { changesTests, uncheckable, type SavedReview } from "./review-record.js";
import { isGuard, needsTestChange } from "./guards.js";

/** Every state a problem can be in, internally. The owner reads them through `STATE_WORDS` (`render.ts`). */
export const FIX_STATES = ["proposed", "needs_decision", "approved", "skipped", "fixing", "fixed", "held", "signed_off_landed", "signed_off_failed", "rejected", "already_resolved", "unfixable", "stopped"] as const;
export type FixState = (typeof FIX_STATES)[number];

/** What the report says of a problem's fix, what each of its check rounds newly failed, oldest first, and the agent's own last account of it. */
export type FixRun = Pick<ReportSurface, "run" | "standing" | "closer" | "plain" | "branch" | "base"> & { rounds: string[][]; said: string | null };

/** Why a problem could not be fixed, where the harness can say so itself. Closed, so the words for each are total. */
export const UNFIXABLE_CAUSES = ["needs_test_change"] as const;
export type UnfixableCause = (typeof UNFIXABLE_CAUSES)[number];

export interface FindingState {
  state: FixState;
  fix: FixRun | undefined;
  /** Whether a check of its fix ever refused it for removing, changing or skipping tests. */
  refused: boolean;
  cause: UnfixableCause | null;
  /** What came of the owner's sign-off of a kept fix, or null when there is none yet. */
  signOff: SignOffResult | null;
}

/** A problem the owner has not decided on yet. */
export const UNDECIDED: FindingState = { state: "proposed", fix: undefined, refused: false, cause: null, signOff: null };

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
function stateOf(state: FixState, fix: FixRun | undefined, signOff: SignOffResult | null = null): FindingState {
  const rounds = fix?.rounds ?? [];
  const refused = rounds.some((round) => round.some(isGuard));
  const cause = state === "unfixable" && needsTestChange(rounds.at(-1) ?? []) ? "needs_test_change" : null;
  return { state, fix, refused, cause, signOff };
}

/**
 * Where each problem stands, as a fold: the ledger says what the owner chose and
 * what `delivery fix` took on, and the runs say how each fix went. Nothing about
 * a fix's outcome is stored twice. A problem that cannot be checked needs the owner's decision unless skipped.
 * Aligned with `findings`.
 */
export function deriveFindings(findings: readonly Finding[], entries: readonly LedgerEntry[], fixes: ReadonlyMap<string, FixRun>, isUncheckable: (finding: Finding) => boolean): FindingState[] {
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
    if (isUncheckable(finding) && !(chosen === "approve" && allowed.has(finding.id))) return stateOf("needs_decision", fix);
    return stateOf(chosen === "approve" ? "approved" : "proposed", fix);
  });
}

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
    return [fixTaskFor(header.pack.name, finding, auth.verify, guards, release)];
  });
}

/** Where each of a review's problems stands now, read from its ledger and the project's runs. */
export async function readFindingStates(repoPath: string, review: SavedReview): Promise<{ entries: LedgerEntry[]; tasks: FixTask[]; states: FindingState[] }> {
  const entries = await readLedger(review.dir);
  const tasks = fixTasks(review, entries);
  const snapshot = await loadSnapshot(repoPath, { kind: "list" }, { live: await repoLocked(repoPath), list: tasks });
  const doc = deriveReport(snapshot);
  return { entries, tasks, states: deriveFindings(review.result.findings, entries, fixRunsOf(snapshot, doc), (finding) => uncheckable(review.header, finding)) };
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
