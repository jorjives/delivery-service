import { basename } from "node:path";
import { paint, type Tone } from "../paint.js";
import type { PlainGroup } from "../report/document.js";
import { HEADING, quoted, toAct, type ReviewPart } from "../report/text.js";
import { dayAndMinute, pathName } from "../report/text.js";
import type { CheckKind, Finding } from "./finding.js";
import { UNDECIDED, type UnfixableCause } from "./fix-state.js";
import type { FindingState } from "./fix-state.js";
import { CHECK_LEVEL, CONSEQUENCE_WORDS, fixWaiting, LEFT_FOR_YOU, NEEDS_TEST_CHANGE, PR_OPENED, problems, signOffLines, stateWords, checkLevel, holdWhy, NO_TESTS_LEVEL, CANNOT_BE_CHECKED, UNCHECKABLE_WHY } from "./render.js";
import type { ReviewHeader, SavedReview } from "./review-record.js";

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
    case "needs_decision":
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
  const deciding = states.filter((at) => at.state === "needs_decision").length;
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
    `${head}: ${problems(found)} found; you approved ${found - skipped - undecided - deciding} and skipped ${skipped}${undecided === 0 ? "" : `; ${undecided} not yet decided`}${deciding === 0 ? "" : `; ${deciding} ${deciding === 1 ? "needs" : "need"} your decision`}.`,
    `${parts.join("; ")}.`,
    when,
  ];
}

/** The parts of a review's report, by who must act. Closed, so each has a heading. */
export type ProblemSection = "waiting" | "needs_you" | "engineers" | "done" | "fixing" | "undecided" | "skipped";

const PROBLEM_SECTIONS: readonly ProblemSection[] = ["waiting", "needs_you", "engineers", "done", "fixing", "undecided", "skipped"];

const PROBLEM_HEADING: Record<ProblemSection, { title: string; tone: Tone }> = {
  waiting: { title: "WAITING FOR YOUR SIGN-OFF", tone: "attention" },
  needs_you: HEADING.needs_you,
  engineers: HEADING.engineers,
  done: HEADING.done,
  fixing: { title: "BEING FIXED", tone: "quiet" },
  undecided: { title: "NOT YET DECIDED", tone: "quiet" },
  skipped: { title: "SKIPPED BY YOU", tone: "quiet" },
};

/** What the agent's fix did, as its check proves it. Total over the kinds of check. */
export const AGENT_DID: Record<CheckKind, string> = {
  "anchor-gone": "The agent changed your code so the code the review flagged is gone.",
  "pattern-absent": "The agent changed your code so the risky pattern no longer appears.",
  "dependency-absent": "The agent moved your project off the vulnerable version of the library.",
  none: "The agent changed your code; nothing checks this specific problem, so look at what changed.",
};

/** How the harness knows a fix passed, naming the check's level, so a fix checked only by the tests, or only by its own check, never reads as proved. */
const howWeKnow = (header: Pick<ReviewHeader, "noTests">, kind: CheckKind): string => {
  if (header.noTests === true) return kind === "none" ? `How we know: it ${CANNOT_BE_CHECKED}; look at what changed.` : `How we know: the check passed (${CHECK_LEVEL[kind]}); ${NO_TESTS_LEVEL}.`;
  return kind === "none"
    ? `How we know: ${CHECK_LEVEL.none}; every test that passed before still passes.`
    : `How we know: the check passed (${CHECK_LEVEL[kind]}), and every test that passed before still passes.`;
};

/** Who must act on a problem that could not be fixed, and what to do, by why it stopped. Total over the kinds of stop and the harness's own causes. */
export const UNFIXABLE_ACTION: Record<PlainGroup | UnfixableCause, { who: string; what: (number: number) => string }> = {
  needs_your_decision: { who: "you", what: (n) => `Decide what to do about it. See it in full with delivery findings ${n}, then fix it yourself or pass it to an engineer.` },
  failed_after_attempts: { who: "you, or an engineer you pass it to", what: (n) => `See it in full with delivery findings ${n}, then fix it by hand or pass it to an engineer.` },
  abandoned: { who: "you, or an engineer you pass it to", what: (n) => `The agent judged it cannot be fixed as described. See it in full with delivery findings ${n} and decide whether to fix it by hand.` },
  needs_an_engineer: { who: "an engineer", what: (n) => `Pass it to whoever maintains your checks, with: delivery findings ${n}` },
  stopped: { who: "you, or an engineer you pass it to", what: (n) => `The record does not say why it stopped. See it in full with delivery findings ${n}.` },
  needs_test_change: { who: "you, or an engineer you trust with your tests", what: (n) => `Change that test yourself or have an engineer do it. See where the problem is with delivery findings ${n}.` },
};

export const REVIEW_NEXT = "Next: delivery findings (every problem and where it stands), delivery status --all (every run)";
const CHOOSE = "  Choose with: delivery findings approve or delivery findings skip, and their numbers";
const NOT_RECORDED = "The record does not say why.";

const titleLine = (number: number, total: number, finding: Finding): string => `  Problem ${number} of ${total}: ${quoted(finding.title, "    ")} (${finding.severity})`;
const saidLine = (said: string | null | undefined): string[] => (said == null ? [] : [`    The agent said: ${quoted(said, "      ")}`]);
const leftLine = (finding: Finding): string[] => (finding.outsideStep === undefined ? [] : [`    ${LEFT_FOR_YOU}: ${quoted(finding.outsideStep, "      ")}`]);

/** Where each state is told. Total over the states, so a new one does not compile until it has a place. */
function sectionOf(at: FindingState): ProblemSection {
  switch (at.state) {
    case "held":
      return "waiting";
    case "unfixable":
    case "needs_decision":
    case "signed_off_failed":
      return "needs_you";
    case "stopped":
    case "rejected":
      return "engineers";
    case "fixed":
    case "signed_off_landed":
    case "already_resolved":
      return "done";
    case "approved":
    case "fixing":
      return "fixing";
    case "proposed":
      return "undecided";
    case "skipped":
      return "skipped";
  }
}

/** One problem as its section tells it. `number` counts from 1, as `delivery findings` numbers it. */
function itemLines(review: SavedReview, number: number, finding: Finding, at: FindingState): string[] {
  const total = review.result.findings.length;
  const title = titleLine(number, total, finding);
  switch (at.state) {
    case "held":
      return [
        title,
        `    ${CONSEQUENCE_WORDS[review.header.pack.consequenceLabel ?? "why-it-matters"]}: ${quoted(finding.whyItMatters, "      ")}`,
        `    ${AGENT_DID[finding.check.kind]}`,
        ...saidLine(at.fix?.said),
        `    ${howWeKnow(review.header, finding.check.kind)}`,
        ...leftLine(finding),
        ...signOffLines(number, at, holdWhy(review.header, finding, at)),
      ];
    case "unfixable": {
      const action = UNFIXABLE_ACTION[at.cause ?? at.fix?.plain?.group ?? "stopped"];
      const why = at.cause === "needs_test_change" ? `It ${NEEDS_TEST_CHANGE}.` : (at.fix?.plain?.sentence ?? NOT_RECORDED);
      return [title, `    Could not be fixed. ${why}`, ...saidLine(at.fix?.plain?.agentSaid), `    Who acts: ${action.who}.`, ...toAct([action.what(number)])];
    }
    case "stopped":
      return [title, `    Stopped by a setup problem. ${at.fix?.plain?.sentence ?? NOT_RECORDED}`, ...saidLine(at.fix?.plain?.agentSaid), ...toAct(at.fix?.plain?.next ?? [])];
    case "signed_off_failed":
      return [title, "    Signed off but could not be merged.", ...signOffLines(number, at, holdWhy(review.header, finding, at))];
    case "rejected":
      return [title, "    Declined at sign-off.", ...signOffLines(number, at, holdWhy(review.header, finding, at))];
    case "fixed":
    case "signed_off_landed":
      return [`${title}: ${stateWords(at)}; ${checkLevel(review.header, finding.check.kind)}`];
    case "needs_decision":
      return [title, `    Needs your decision: ${UNCHECKABLE_WHY}`, ...toAct([`Fix it yourself, skip it with delivery findings skip ${number}, or approve it anyway with delivery findings approve ${number} --allow-unchecked`])];
    default:
      return [`${title}: ${stateWords(at)}`];
  }
}

/** Sections whose items run to several lines are spaced; the rest are one line each. */
const SPACED: ReadonlySet<ProblemSection> = new Set(["waiting", "needs_you", "engineers"]);

/** A review's problems under who must act, each section headed with how many it holds; an empty section is left out. `states` is aligned with the review's problems. */
export function reviewSections(review: SavedReview, states: readonly FindingState[], colour: boolean): string[] {
  const { findings } = review.result;
  const items = new Map<ProblemSection, string[][]>(PROBLEM_SECTIONS.map((section) => [section, []]));
  findings.forEach((finding, index) => {
    const at = states[index] ?? UNDECIDED;
    items.get(sectionOf(at))?.push(itemLines(review, index + 1, finding, at));
    // What only a person can do, once the code part is merged.
    if ((at.state === "fixed" || at.state === "signed_off_landed") && finding.outsideStep !== undefined) {
      items.get("needs_you")?.push([titleLine(index + 1, findings.length, finding), ...leftLine(finding)]);
    }
  });
  const waitingToStart = states.filter((at) => at.state === "approved").length;
  return PROBLEM_SECTIONS.flatMap((section) => {
    const entries = items.get(section) ?? [];
    if (entries.length === 0) return [];
    const { title, tone } = PROBLEM_HEADING[section];
    const body = entries.flatMap((entry, index) => [...(SPACED.has(section) && index > 0 ? [""] : []), ...entry]);
    const footer = section === "fixing" && waitingToStart > 0 ? [`  ${fixWaiting(waitingToStart)}`] : section === "undecided" ? [CHOOSE] : [];
    return ["", paint(colour, tone, `${title} (${entries.length})`), ...body, ...footer];
  });
}

/** A review's fix phase as the report tells it. Pure: the same review and states always give the same lines. */
export function reviewPart(review: SavedReview, states: readonly FindingState[], colour: boolean): ReviewPart {
  return { opening: reviewOpening(review, states), sections: reviewSections(review, states, colour), next: REVIEW_NEXT, carryOn: "delivery fix" };
}
