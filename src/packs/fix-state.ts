import { deriveReport } from "../report/derive.js";
import type { ReportSurface } from "../report/document.js";
import { loadSnapshot } from "../report/snapshot.js";
import { repoLocked } from "../repo-lock.js";
import type { Finding } from "./finding.js";
import { fixTaskFor, type FixTask } from "./fix-task.js";
import { authorisedChecks, readLedger, resolvedIds, type LedgerEntry } from "./ledger.js";
import type { SavedReview } from "./review-record.js";

/** Every state a problem can be in, internally. The owner reads them through `STATE_WORDS` (`render.ts`). */
export const FIX_STATES = ["proposed", "approved", "skipped", "fixing", "fixed", "already_resolved", "unfixable", "stopped"] as const;
export type FixState = (typeof FIX_STATES)[number];

/** What the report says of a problem's fix: its run, how it stands, how its work lands, and a stop in plain words. */
export type FixRun = Pick<ReportSurface, "run" | "standing" | "closer" | "plain">;

export interface FindingState {
  state: FixState;
  fix: FixRun | undefined;
}

/** An authorised problem's state from its fix's run: delivered is fixed; a stop someone must act on is "could not be fixed", unless only an engineer can act, which is a setup problem. */
function fromRun(fix: FixRun | undefined): FixState {
  switch (fix?.standing) {
    case "closed":
      return "fixed";
    case "escalated":
    case "aborted":
      return fix?.plain?.audience === "engineer" ? "stopped" : "unfixable";
    default:
      return "fixing";
  }
}

/**
 * Where each problem stands, as a fold: the ledger says what the owner chose and
 * what `delivery fix` took on, and the runs say how each fix went. Nothing about
 * a fix's outcome is stored twice. Aligned with `findings`.
 */
export function deriveFindings(findings: readonly Finding[], entries: readonly LedgerEntry[], fixes: ReadonlyMap<string, FixRun>): FindingState[] {
  const gone = resolvedIds(entries);
  const authorised = authorisedChecks(entries);
  const choice = new Map<string, "approve" | "skip">();
  for (const entry of entries) if (entry.t === "decision") for (const id of entry.ids) choice.set(id, entry.choice);
  return findings.map((finding) => {
    const fix = fixes.get(finding.id);
    if (gone.has(finding.id)) return { state: "already_resolved", fix };
    if (authorised.has(finding.id)) return { state: fromRun(fix), fix };
    const chosen = choice.get(finding.id);
    return { state: chosen === "approve" ? "approved" : chosen === "skip" ? "skipped" : "proposed", fix };
  });
}

/**
 * One fix task per authorised problem still wanting a fix, in the review's order, each exactly as it was
 * authorised, so the queue recognises its run. A problem found already fixed has no task: it never runs, so
 * the plan the reading commands show must not list it as waiting to start.
 */
export function fixTasks({ header, result }: SavedReview, entries: readonly LedgerEntry[]): FixTask[] {
  const authorised = authorisedChecks(entries);
  const gone = resolvedIds(entries);
  return result.findings.flatMap((finding) => {
    const verify = authorised.get(finding.id);
    return verify === undefined || gone.has(finding.id) ? [] : [fixTaskFor(header.pack.name, finding, verify)];
  });
}

/** Where each of a review's problems stands now, read from its ledger and the project's runs. */
export async function readFindingStates(repoPath: string, review: SavedReview): Promise<{ entries: LedgerEntry[]; tasks: FixTask[]; states: FindingState[] }> {
  const entries = await readLedger(review.dir);
  const tasks = fixTasks(review, entries);
  const doc = deriveReport(await loadSnapshot(repoPath, { kind: "list" }, { live: await repoLocked(repoPath), list: tasks }));
  const fixes = new Map(doc.surfaces.flatMap((surface) => (typeof surface.tags?.findingId === "string" ? [[surface.tags.findingId, surface] as const] : [])));
  return { entries, tasks, states: deriveFindings(review.result.findings, entries, fixes) };
}
