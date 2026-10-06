import { basename } from "node:path";
import { DID_NOT_COMPLETE } from "../agent-invoke.js";
import { USAGE_LIMIT_WORDS, type Incomplete } from "../ports.js";
import { dayAndMinute, durationWords, pathName, quoted } from "../report/text.js";
import { SEVERITIES, type CheckKind, type CheckSpec, type Finding, type Severity, type UnconfirmedReason } from "./finding.js";
import type { FindingState, FixState } from "./fix-state.js";
import type { PinnedPack, SavedReview } from "./review-record.js";

/** How the harness will know each kind of check is met, as the owner reads it. Total over the closed set. */
export const CHECK_LEVEL: Record<CheckKind, string> = {
  "anchor-gone": "checked: the flagged code is gone",
  "pattern-absent": "checked: the risky pattern no longer appears",
  "dependency-absent": "checked: the vulnerable version is no longer installed",
  none: "tests only: no check of this specific problem",
};

/** Why a reported problem is not offered. Total over the closed set. */
export const UNCONFIRMED_WHY: Record<UnconfirmedReason, string> = {
  no_such_file: "that file is not in your last commit",
  outside_project: "that path leads outside your project",
  not_a_file: "that path is not an ordinary file in your project",
  text_not_found: "the code it points at is not in that file",
  vague: "it did not say exactly which code it means",
};

export const READS_ONLY = "This reads your project and writes nothing to it. It can take a few minutes.";
export const AGENT_OPINION = "The agent that did the review is giving its opinion: check anything that matters.";
export const NOTHING_CHANGED = "Nothing has been changed and nothing will be until you approve it.";
export const RECOVERED = "Finishing the review that was interrupted: the agent had already replied, so it is not asked again.";
export const NOT_NOW = "Nothing has been changed. The list is saved: see it again with delivery findings";
export const NO_REVIEW_YET = "No review found in this project. Start one with: delivery review code";
export const NOT_YET_DECIDED = "not yet decided";
export const REFUSED_WEAKENING = "The agent's fix was rejected because it removed or skipped existing tests.";
export const NEEDS_TEST_CHANGE = "needs a change to one of your tests, which this review does not let an agent do";
export const CHANGES_TESTS = "this fix will change your tests";

export const REVIEWER_KNOWLEDGE = "this comes from the reviewer's knowledge, not an advisory database; it may be out of date or wrong.";
export const LEFT_FOR_YOU = "One thing is left for you";

/** How a problem's consequence is introduced, as its pack chose. */
const CONSEQUENCE_WORDS: Record<NonNullable<PinnedPack["consequenceLabel"]>, string> = {
  "why-it-matters": "Why it matters",
  "what-could-happen": "What could happen",
};

/** How many problems there are at each severity, every severity named, most serious first. */
export const severityLine = (findings: readonly Finding[]): string =>
  `By how serious they are: ${SEVERITIES.map((severity) => `${findings.filter((finding) => finding.severity === severity).length} ${severity}`).join(", ")}.`;

/** Which problems wait for sign-off, by name: "critical or high" for a threshold of high. */
export function holdSentence(threshold: Severity): string {
  const held = SEVERITIES.slice(0, SEVERITIES.indexOf(threshold) + 1);
  const words = held.length === 1 ? held[0] : `${held.slice(0, -1).join(", ")} or ${held.at(-1)}`;
  return `Problems that are ${words} are fixed and checked, but wait for your sign-off before they reach your main copy.`;
}

const category = (pack: PinnedPack, id: string) => pack.categories.find((known) => known.id === id);

/** Where a problem stands, as the owner reads it. Total over the closed set. */
export const STATE_WORDS: Record<FixState, string> = {
  proposed: NOT_YET_DECIDED,
  approved: "being fixed",
  fixing: "being fixed",
  skipped: "skipped by you",
  fixed: "fixed and merged",
  already_resolved: "already fixed",
  unfixable: "could not be fixed",
  stopped: "stopped by a setup problem",
};

/** "Fixed and merged" where the project's way of landing work opens a pull request instead: nothing has merged. */
export const PR_OPENED = "fixed, pull request opened";

export const stateWords = ({ state, fix }: FindingState): string => (state === "fixed" && fix?.closer === "open-pr" ? PR_OPENED : STATE_WORDS[state]);

export const fixWaiting = (count: number): string => `${count} approved and not started yet. Start fixing ${count === 1 ? "it" : "them"} with: delivery fix`;

const problems = (count: number): string => `${count} ${count === 1 ? "problem" : "problems"}`;

export const needsTestChangeLine = (count: number): string => `${problems(count)} could not be fixed: ${count === 1 ? "it" : "each"} ${NEEDS_TEST_CHANGE}.`;

/** Why a problem's fix stopped: the harness's plain sentence, then the agent's own words, quoted. */
function stopLines({ state, fix, cause }: FindingState): string[] {
  if ((state !== "unfixable" && state !== "stopped") || !fix?.plain) return [];
  const { sentence, agentSaid } = fix.plain;
  const why = cause === "needs_test_change" ? `It ${NEEDS_TEST_CHANGE}.` : sentence;
  return [`    Why: ${why}`, ...(agentSaid === null ? [] : [`    The agent said: ${quoted(agentSaid, "      ")}`])];
}

export const opening = (title: string): string[] => [`${title} of your project.`, READS_ONLY];
export const unfinishedReview = (packName: string): string => `The last review was stopped before it was saved. Run \`delivery review ${packName}\` to finish it.`;

export const noneFound = (fileCount: number): string =>
  `The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at ${fileCount} ${fileCount === 1 ? "file" : "files"}, and it can miss things.`;

const unconfirmedPointer = (count: number): string[] =>
  count === 0 ? [] : [`${count} more could not be confirmed: the code they point at could not be found, so they are not offered. See them with: delivery findings --unconfirmed`];

/** One problem as a numbered block: title and severity, then one fact per line, in the words its pack chose. */
export function problemBlock(number: number, finding: Finding, pack: PinnedPack): string[] {
  const kind = category(pack, finding.category);
  return [
    `${number}. ${finding.title} (${finding.severity})`,
    `    Where: ${pathName(finding.where.path)}, line ${finding.where.line}`,
    `    What is wrong: ${finding.problem}`,
    `    ${CONSEQUENCE_WORDS[pack.consequenceLabel ?? "why-it-matters"]}: ${finding.whyItMatters}`,
    `    Fixed looks like: ${finding.fixedLooksLike}`,
    `    How we will know: ${CHECK_LEVEL[finding.check.kind]}.`,
    ...(kind?.changesTests === true ? [`    Note: ${CHANGES_TESTS}.`] : []),
    ...(kind?.reviewerKnowledge === true ? [`    Note: ${REVIEWER_KNOWLEDGE}`] : []),
    ...(finding.outsideStep === undefined ? [] : [`    ${LEFT_FOR_YOU}: ${finding.outsideStep}`]),
  ];
}

/** What `delivery review` prints once the review is saved. */
export function reviewLines({ header, result }: SavedReview): string[] {
  const shown = result.findings.length;
  const took = `Review finished in ${durationWords(Date.parse(header.endedAt) - Date.parse(header.startedAt))}.`;
  if (shown === 0) return [took, noneFound(header.fileCount), ...unconfirmedPointer(result.unconfirmed.length)];
  const checked = result.findings.filter((finding) => finding.check.kind !== "none").length;
  const testsOnly = shown - checked;
  // A pack that holds fixes by severity opens with the severities, since they decide what waits for the owner.
  const threshold = header.pack.hold ?? null;
  return [
    `${took} It found ${problems(shown + result.notShown)}.`,
    ...(threshold === null ? [] : [severityLine(result.findings), holdSentence(threshold)]),
    AGENT_OPINION,
    "",
    ...result.findings.flatMap((finding, index) => problemBlock(index + 1, finding, header.pack)),
    ...(result.notShown > 0 ? [`${result.notShown} more not shown: this review lists at most ${header.pack.maxFindings} problems.`] : []),
    ...unconfirmedPointer(result.unconfirmed.length),
    "",
    `${checked} of ${shown} ${shown === 1 ? "has" : "have"} a specific check; ${testsOnly} ${testsOnly === 1 ? "is" : "are"} tests only.`,
    NOTHING_CHANGED,
    "",
    "What next?",
    `  Fix all ${shown}: delivery findings approve --all, then delivery fix`,
    "  Choose: delivery findings",
  ];
}

/** What `delivery findings` prints: the latest review's problems and where each stands. `states` is aligned with the review's problems. */
export function listLines({ header, result }: SavedReview, states: readonly FindingState[]): string[] {
  const waiting = states.filter((at) => at.state === "approved").length;
  const needsTest = states.filter((at) => at.cause === "needs_test_change").length;
  return [
    `${header.pack.title} of ${basename(header.repoPath)}, ${dayAndMinute(header.endedAt)} UTC: ${problems(result.findings.length)}.`,
    ...result.findings.flatMap((finding, index) => {
      const at = states[index] ?? { state: "proposed", fix: undefined, refused: false, cause: null };
      return [`${index + 1}. ${finding.title} (${finding.severity}): ${stateWords(at)}`, ...(at.refused ? [`    ${REFUSED_WEAKENING}`] : []), ...stopLines(at)];
    }),
    ...unconfirmedPointer(result.unconfirmed.length),
    ...(needsTest === 0 ? [] : ["", needsTestChangeLine(needsTest)]),
    ...(waiting === 0 ? [] : ["", fixWaiting(waiting)]),
    ...(result.findings.length === 0 ? [] : ["", "See one in full: delivery findings 1"]),
  ];
}

function checkLines(check: CheckSpec): string[] {
  switch (check.kind) {
    case "anchor-gone":
      return ["  Check: anchor-gone (the flagged text must no longer be in the file)"];
    case "pattern-absent":
      return [`  Check: pattern-absent, pattern ${pathName(check.pattern)}`, `  Checked in: ${check.paths.map(pathName).join(", ")}`];
    case "dependency-absent":
      return [`  Check: dependency-absent, ${check.package} ${check.version} must no longer be in package-lock.json`];
    case "none":
      return ["  Check: none (the project's own tests only)"];
  }
}

/** What `delivery findings <n>` prints: the problem in full, then the technical detail an engineer needs. `number` counts from 1 and must be in range. */
export function findingLines({ header, result }: SavedReview, number: number): string[] {
  const finding = result.findings[number - 1];
  if (finding === undefined) return [];
  const categoryInfo = header.pack.categories.find((known) => known.id === finding.category);
  const { line, endLine } = finding.where;
  return [
    ...problemBlock(number, finding, header.pack),
    "",
    "FOR ENGINEERS",
    `  Category: ${finding.category}${categoryInfo === undefined ? "" : ` (${categoryInfo.title})`}`,
    `  File: ${pathName(finding.where.path)}, ${line === endLine ? `line ${line}` : `lines ${line} to ${endLine}`}`,
    ...checkLines(finding.check),
    ...(finding.droppedCheck === undefined
      ? []
      : ["  The review suggested this check, which does not match the code as it stands, so it is not used:", ...checkLines(finding.droppedCheck).map((text) => `  ${text}`)]),
    `  Flagged text: ${quoted(finding.anchor, "    ")}`,
    ...(finding.detail === undefined ? [] : [`  The agent's notes: ${quoted(finding.detail, "    ")}`]),
    `  Identity: ${finding.id}, from review ${header.reviewId} of commit ${header.commit.slice(0, 12)}`,
  ];
}

/** What `delivery findings --unconfirmed` prints. */
export function unconfirmedLines({ result }: SavedReview): string[] {
  if (result.unconfirmed.length === 0) return ["Every problem the review reported was found in your project."];
  return [
    `The review reported ${problems(result.unconfirmed.length)} that could not be confirmed, so they are not offered:`,
    ...result.unconfirmed.flatMap((item, index) => [
      `${index + 1}. ${item.title} (${item.severity})`,
      `    Where the review said: ${pathName(item.path)}`,
      `    Why it is not offered: ${UNCONFIRMED_WHY[item.reason]}.`,
      `    What the review said is wrong: ${item.problem}`,
    ]),
  ];
}

/** What choosing "Fix now" prints in this slice: the exact commands for the problems chosen. */
export const fixNowLines = (numbers: number[]): string[] => [`To fix the ones you chose: delivery findings approve ${numbers.join(" ")}, then delivery fix`, NOTHING_CHANGED];

/**
 * Why a review could not run, in one sentence with one next step. Read from
 * the session's marks and the harness's own fixed reasons, never the agent's words.
 */
export function failureSentence(terminus: Incomplete, packArg: string): string {
  const again = `run \`delivery review ${packArg}\` again`;
  if (terminus.limit === "rate") return `The review could not run because ${USAGE_LIMIT_WORDS.rate}. Wait a few minutes, then ${again}.`;
  if (terminus.limit === "spend") return `The review could not run because ${USAGE_LIMIT_WORDS.spend}. Raise the limit or wait for it to reset, then ${again}.`;
  if (terminus.notRun === true || terminus.rationale.endsWith(DID_NOT_COMPLETE.errored)) {
    return `The review could not run because the agent could not be started or stopped with an error, often a lost connection. Check you are online, then ${again}.`;
  }
  if (terminus.rationale.endsWith(DID_NOT_COMPLETE.wrongShape) || terminus.rationale.endsWith(DID_NOT_COMPLETE.noEnvelope)) {
    return `The review could not run because the agent did not give back a list of problems the harness could read. Run \`delivery review ${packArg}\` again.`;
  }
  // The only other incomplete a session returns is the tool guard's refusal (`authorityRefusal`): the read-only boundary held.
  return `The review was stopped because the agent tried to do something a review may not do, such as change a file, run a command or read outside your project. Nothing was changed. Run \`delivery review ${packArg}\` again.`;
}
