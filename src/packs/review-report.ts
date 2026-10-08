import { basename } from "node:path";
import { dayAndMinute, pathName } from "../report/text.js";
import type { FindingState } from "./fix-state.js";
import { PR_OPENED, problems, stateWords } from "./render.js";
import type { SavedReview } from "./review-record.js";

/** What a review's opening counts a problem under once the owner has approved it. Closed, so the words for each are total. */
export type Outcome = "merged" | "pr" | "waiting" | "unfixable" | "not_merged" | "stopped" | "declined" | "already" | "fixing";

/** How each outcome is counted, for one problem and for several. */
export const OUTCOME_WORDS: Record<Outcome, readonly [one: string, many: string]> = {
  merged: ["is fixed and merged", "are fixed and merged"],
  waiting: ["is waiting for your sign-off", "are waiting for your sign-off"],
  unfixable: ["could not be fixed", "could not be fixed"],
  pr: ["is fixed, with a pull request open", "are fixed, each with a pull request open"],
  not_merged: ["was signed off but could not be merged", "were signed off but could not be merged"],
  stopped: ["was stopped by a setup problem", "were stopped by a setup problem"],
  declined: ["was declined at sign-off", "were declined at sign-off"],
  already: ["was already fixed", "were already fixed"],
  fixing: ["is being fixed", "are being fixed"],
};

/** Said even when none: the three the owner asks about first. The rest only when some. */
const ALWAYS: readonly Outcome[] = ["merged", "waiting", "unfixable"];
const ORDER: readonly Outcome[] = [...ALWAYS, "pr", "not_merged", "stopped", "declined", "already", "fixing"];

/** What a problem counts as once approved; null for one the owner has not approved. Total over the states. */
export function outcomeOf(at: FindingState): Outcome | null {
  switch (at.state) {
    case "proposed":
    case "skipped":
      return null;
    case "approved":
    case "fixing":
      return "fixing";
    case "fixed":
    case "signed_off_landed":
      return stateWords(at) === PR_OPENED ? "pr" : "merged";
    case "held":
      return "waiting";
    case "unfixable":
      return "unfixable";
    case "signed_off_failed":
      return "not_merged";
    case "stopped":
      return "stopped";
    case "rejected":
      return "declined";
    case "already_resolved":
      return "already";
  }
}

/**
 * What a review's report opens with: which review it was, what it found and what the owner chose, then what came of
 * the fixes, then when the review was made. `states` is aligned with the review's problems.
 */
export function reviewOpening({ header, result }: SavedReview, states: readonly FindingState[]): string[] {
  const head = `${header.pack.title} of ${pathName(basename(header.repoPath))}`;
  const when = `Review ${dayAndMinute(header.endedAt)} UTC.`;
  const found = result.findings.length;
  if (found === 0) return [`${head}: no problems found.`, when];
  const skipped = states.filter((at) => at.state === "skipped").length;
  const undecided = states.filter((at) => at.state === "proposed").length;
  const counts = new Map<Outcome, number>();
  for (const at of states) {
    const outcome = outcomeOf(at);
    if (outcome !== null) counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  const parts = ORDER.flatMap((outcome) => {
    const count = counts.get(outcome) ?? 0;
    return count === 0 && !ALWAYS.includes(outcome) ? [] : [`${count} ${OUTCOME_WORDS[outcome][count === 1 ? 0 : 1]}`];
  });
  return [
    `${head}: ${problems(found)} found; you approved ${found - skipped - undecided} and skipped ${skipped}${undecided === 0 ? "" : `; ${undecided} not yet decided`}.`,
    `${parts.join("; ")}.`,
    when,
  ];
}
