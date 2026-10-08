import { basename } from "node:path";
import { DID_NOT_COMPLETE } from "../agent-invoke.js";
import { USAGE_LIMIT_WORDS, type Incomplete } from "../ports.js";
import { dayAndMinute, durationWords, pathName, quoted } from "../report/text.js";
import { atOrAbove, SEVERITIES, type CheckKind, type CheckSpec, type Finding, type Severity, type UnconfirmedReason } from "./finding.js";
import { UNDECIDED, type FindingState, type FixState } from "./fix-state.js";
import { NOT_LANDED_REASONS, type NotLandedReason } from "./ledger.js";
import { uncheckable, type PinnedPack, type ReviewHeader, type SavedReview } from "./review-record.js";
import { literalsOf, maskIn } from "./secrets.js";

// Re-export for the test to use.
export { NOT_LANDED_REASONS };

/** How the harness will know each kind of check is met, as the owner reads it. Total over the closed set. */
export const CHECK_LEVEL: Record<CheckKind, string> = {
  "anchor-gone": "checked: the flagged code is gone",
  "pattern-absent": "checked: the risky pattern no longer appears",
  "dependency-absent": "checked: the vulnerable version is no longer installed",
  none: "tests only: no check of this specific problem",
};

export const NO_TESTS_WARNING =
  "Your project has no tests, so nothing will check that a fix has not broken something else. Every fix will wait for your sign-off before it reaches your main copy.";
/** What "checked" means where the project has no tests: the problem's own check and nothing else. */
export const NO_TESTS_LEVEL = "this problem's own check only, no regression tests";
export const CANNOT_BE_CHECKED = "cannot be checked";

export const UNCHECKABLE_WHY = "It cannot be checked, so nothing would check its fix except you.";
export const approveAnyway = (number: number): string => `To approve it anyway: delivery findings approve ${number} --allow-unchecked`;
export const uncheckedRefused = (number: number): string => `Problem ${number} cannot be checked: nothing would check its fix except you. ${approveAnyway(number)}`;
export const uncheckedApproved = (number: number): string => `Problem ${number}: nothing will check this fix except you, so it will wait for your sign-off.`;

/** How the harness will know a problem is fixed, as the owner of this project reads it: with no tests, a specific check is all there is, and a problem with none cannot be checked. */
export function checkLevel(header: Pick<ReviewHeader, "noTests">, kind: CheckKind): string {
  if (header.noTests !== true) return CHECK_LEVEL[kind];
  return kind === "none" ? CANNOT_BE_CHECKED : `${CHECK_LEVEL[kind]}; ${NO_TESTS_LEVEL}`;
}

/** Why a fix waits for the owner. */
export const HOLD_WHY = {
  serious: "it is a serious problem, and you should see what changed before it reaches your main copy.",
  noTests: "your project has no tests, so nothing has checked that this fix did not break something else.",
  unchecked: "nothing checks this fix except you, so you should see what changed before it reaches your main copy.",
};

/** Why this problem's fix waits: the owner approved it without a check, the project's missing tests, or its severity. */
export function holdWhy(header: Pick<ReviewHeader, "noTests" | "pack">, finding: Finding): string {
  if (uncheckable(header, finding)) return HOLD_WHY.unchecked;
  return header.noTests === true && !atOrAbove(finding.severity, header.pack.hold ?? null) ? HOLD_WHY.noTests : HOLD_WHY.serious;
}

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

export const CHANGES_NOTE = "The agent changed these files. This shows what changed; it cannot tell you it is safe.";
export const CHANGES_WHICH = "Say which problem's changes to show, by its number in the list, for example: delivery findings 1 --changes";
export const noKeptFix = (number: number, words: string): string => `Problem ${number} has no kept fix to show: it is ${words}. See where each stands with: delivery findings`;

/** How a problem's consequence is introduced, as its pack chose. */
export const CONSEQUENCE_WORDS: Record<NonNullable<PinnedPack["consequenceLabel"]>, string> = {
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

/** Why a signed-off fix was not merged, as the owner reads it. Total over the closed set. */
export const NOT_LANDED_WHY: Record<NotLandedReason, string> = {
  conflict: "your main copy has changed in the same lines since the fix was made",
  check_failed: "the fix no longer passes its check on your current main copy",
  check_error: "its check could not be run on your current main copy",
  not_merged: "it could not be merged into your main copy",
  branch_gone: "the branch holding the fix is no longer there",
};

export const CHECKING_SIGN_OFF = "Checking the fix still works on your current main copy...";
export const NEEDS_YOU = "NEEDS YOU";

/** Where a problem stands, as the owner reads it. Total over the closed set. */
export const STATE_WORDS: Record<FixState, string> = {
  proposed: NOT_YET_DECIDED,
  needs_decision: "needs your decision",
  approved: "being fixed",
  fixing: "being fixed",
  skipped: "skipped by you",
  fixed: "fixed and merged",
  held: "waiting for your sign-off",
  signed_off_landed: "fixed and merged",
  signed_off_failed: "signed off but could not be merged",
  rejected: "declined at sign-off",
  already_resolved: "already fixed",
  unfixable: "could not be fixed",
  stopped: "stopped by a setup problem",
};

/** "Fixed and merged" where the project's way of landing work opens a pull request instead: nothing has merged. */
export const PR_OPENED = "fixed, pull request opened";

export const stateWords = ({ state, fix, signOff }: FindingState): string =>
  (state === "fixed" && fix?.closer === "open-pr") || (state === "signed_off_landed" && signOff?.t === "landed" && signOff.closer.type === "open-pr") ? PR_OPENED : STATE_WORDS[state];

export const fixWaiting = (count: number): string => `${count} approved and not started yet. Start fixing ${count === 1 ? "it" : "them"} with: delivery fix`;

export const problems = (count: number): string => `${count} ${count === 1 ? "problem" : "problems"}`;

export const needsTestChangeLine = (count: number): string => `${problems(count)} could not be fixed: ${count === 1 ? "it" : "each"} ${NEEDS_TEST_CHANGE}.`;

/** Why a problem's fix stopped: the harness's plain sentence, then the agent's own words, quoted. */
function stopLines({ state, fix, cause }: FindingState): string[] {
  if ((state !== "unfixable" && state !== "stopped") || !fix?.plain) return [];
  const { sentence, agentSaid } = fix.plain;
  const why = cause === "needs_test_change" ? `It ${NEEDS_TEST_CHANGE}.` : sentence;
  return [`    Why: ${why}`, ...(agentSaid === null ? [] : [`    The agent said: ${quoted(agentSaid, "      ")}`])];
}

export function signOffLines(number: number, { state, fix, signOff }: FindingState, why: string): string[] {
  const branch = fix?.branch ?? "not recorded";
  switch (state) {
    case "held":
      return [
        `    Why this needs you: ${why}`,
        `    Look at what changed: delivery findings ${number} --changes`,
        `    Say yes: delivery findings sign-off ${number}`,
        `    Say no: delivery findings reject ${number}`,
        `    For engineers: branch ${branch}`,
      ];
    case "signed_off_failed":
      return [
        `    Why: ${signOff?.t === "not_landed" ? NOT_LANDED_WHY[signOff.reason] : NOT_LANDED_WHY.not_merged}. The fix is kept on branch ${branch}.`,
        `    Try again: delivery findings sign-off ${number}, or decline it: delivery findings reject ${number}`,
      ];
    case "rejected":
      return [`    The fix is kept on branch ${branch} for an engineer.`];
    default:
      return [];
  }
}

export const opening = (title: string): string[] => [`${title} of your project.`, READS_ONLY];
export const unfinishedReview = (packName: string): string => `The last review was stopped before it was saved. Run \`delivery review ${packName}\` to finish it.`;

export const noneFound = (fileCount: number): string =>
  `The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at ${fileCount} ${fileCount === 1 ? "file" : "files"}, and it can miss things.`;

const unconfirmedPointer = (count: number): string[] =>
  count === 0 ? [] : [`${count} more could not be confirmed: the code they point at could not be found, so they are not offered. See them with: delivery findings --unconfirmed`];

/** One problem as a numbered block: title and severity, then one fact per line, in the words its pack chose. */
export function problemBlock(number: number, finding: Finding, header: ReviewHeader): string[] {
  const pack = header.pack;
  const kind = category(pack, finding.category);
  return [
    `${number}. ${finding.title} (${finding.severity})`,
    `    Where: ${pathName(finding.where.path)}, line ${finding.where.line}`,
    `    What is wrong: ${finding.problem}`,
    `    ${CONSEQUENCE_WORDS[pack.consequenceLabel ?? "why-it-matters"]}: ${finding.whyItMatters}`,
    `    Fixed looks like: ${finding.fixedLooksLike}`,
    `    How we will know: ${checkLevel(header, finding.check.kind)}.`,
    ...(uncheckable(header, finding) ? [`    ${approveAnyway(number)}`] : []),
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
  const deciding = result.findings.filter((finding) => uncheckable(header, finding)).length;
  const testsOnly = shown - checked - deciding;
  const offered = shown - deciding;
  // A pack that holds fixes by severity opens with the severities, since they decide what waits for the owner.
  const threshold = header.pack.hold ?? null;
  return [
    `${took} It found ${problems(shown + result.notShown)}.`,
    ...(header.noTests === true ? [NO_TESTS_WARNING] : []),
    ...(threshold === null ? [] : [severityLine(result.findings), holdSentence(threshold)]),
    AGENT_OPINION,
    "",
    ...result.findings.flatMap((finding, index) => problemBlock(index + 1, finding, header)),
    ...(result.notShown > 0 ? [`${result.notShown} more not shown: this review lists at most ${header.pack.maxFindings} problems.`] : []),
    ...unconfirmedPointer(result.unconfirmed.length),
    "",
    `${checked} of ${shown} ${shown === 1 ? "has" : "have"} a specific check; ${deciding === 0 ? `${testsOnly} ${testsOnly === 1 ? "is" : "are"} tests only.` : `${deciding} cannot be checked, so ${deciding === 1 ? "it waits" : "they wait"} for your decision.`}`,
    NOTHING_CHANGED,
    "",
    "What next?",
    ...(offered === 0 ? [] : [`  Fix all ${offered}: delivery findings approve --all, then delivery fix`]),
    "  Choose: delivery findings",
  ];
}

/** What `delivery findings` prints: the latest review's problems and where each stands. `states` is aligned with the review's problems. */
export function listLines({ header, result }: SavedReview, states: readonly FindingState[]): string[] {
  const waiting = states.filter((at) => at.state === "approved").length;
  const needsTest = states.filter((at) => at.cause === "needs_test_change").length;
  const problemLines = result.findings.flatMap((finding, index) => {
    const at = states[index] ?? UNDECIDED;
    return [`${index + 1}. ${finding.title} (${finding.severity}): ${stateWords(at)}${at.state === "needs_decision" ? `; ${CANNOT_BE_CHECKED}` : ""}`, ...(at.refused ? [`    ${REFUSED_WEAKENING}`] : []), ...stopLines(at), ...(at.state === "needs_decision" ? [`    ${UNCHECKABLE_WHY} ${approveAnyway(index + 1)}`] : []), ...signOffLines(index + 1, at, holdWhy(header, finding))];
  });
  // What only a person can do, once the code part is done.
  const needsYou = result.findings.flatMap((finding, index) =>
    finding.outsideStep !== undefined && (states[index]?.state === "fixed" || states[index]?.state === "signed_off_landed") ? [`  Problem ${index + 1}: ${finding.outsideStep}`] : [],
  );
  return [
    `${header.pack.title} of ${basename(header.repoPath)}, ${dayAndMinute(header.endedAt)} UTC: ${problems(result.findings.length)}.`,
    ...problemLines,
    ...unconfirmedPointer(result.unconfirmed.length),
    ...(needsYou.length === 0 ? [] : ["", NEEDS_YOU, ...needsYou]),
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
  const hide = (text: string): string => maskIn(text, literalsOf(finding));
  return [
    ...problemBlock(number, finding, header),
    "",
    "FOR ENGINEERS",
    `  Category: ${finding.category}${categoryInfo === undefined ? "" : ` (${categoryInfo.title})`}`,
    `  File: ${pathName(finding.where.path)}, ${line === endLine ? `line ${line}` : `lines ${line} to ${endLine}`}`,
    ...checkLines(finding.check).map(hide),
    ...(finding.droppedCheck === undefined
      ? []
      : ["  The review suggested this check, which does not match the code as it stands, so it is not used:", ...checkLines(finding.droppedCheck).map((text) => `  ${hide(text)}`)]),
    `  Flagged text: ${quoted(hide(finding.anchor), "    ")}`,
    ...(finding.detail === undefined ? [] : [`  The agent's notes: ${quoted(hide(finding.detail), "    ")}`]),
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
