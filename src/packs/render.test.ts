import { describe, expect, it } from "vitest";
import { DID_NOT_COMPLETE } from "../agent-invoke.js";
import type { Incomplete } from "../ports.js";
import { UNCONFIRMED_REASONS, type Unconfirmed } from "./finding.js";
import {
  AGENT_OPINION, CHANGES_TESTS, CHECK_LEVEL, failureSentence, findingLines, fixNowLines, fixWaiting, listLines, NEEDS_TEST_CHANGE, needsTestChangeLine, NO_REVIEW_YET, noneFound, NOT_NOW, NOTHING_CHANGED,
  opening, PR_OPENED, REFUSED_WEAKENING, REVIEWER_KNOWLEDGE, reviewLines, RECOVERED, STATE_WORDS, UNCONFIRMED_WHY, unconfirmedLines, unfinishedReview,
} from "./render.js";
import type { FindingState, FixRun, FixState } from "./fix-state.js";
import type { SavedReview } from "./review-record.js";
import { PACK_FORBIDDEN, sampleFinding } from "./review-fixtures.js";

const HEADER: SavedReview["header"] = {
  reviewId: "code-20261005T101500Z",
  pack: { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 2, categories: [{ id: "correctness", title: "Wrong results" }] },
  repoPath: "/home/dana/shop",
  commit: "abcdef0123456789abcdef0123456789abcdef01",
  fileCount: 84,
  startedAt: "2026-10-05T10:15:00.000Z",
  endedAt: "2026-10-05T10:19:12.000Z",
};

const NEGATIVE = sampleFinding();
const PATTERN = sampleFinding({ id: "111111111111", title: "Settings errors are unhelpful", severity: "medium", where: { path: "settings.js", line: 4, endLine: 5 }, check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync", paths: ["settings.js"] } });
const UNUSED = sampleFinding({ id: "222222222222", title: "Old payment code", severity: "low", check: { kind: "none" }, droppedCheck: { kind: "pattern-absent", pattern: "x", paths: ["a.js"] }, detail: "nothing imports it" });
const unconfirmed = UNCONFIRMED_REASONS.map((reason): Unconfirmed => ({ title: "Rounding", severity: "medium", path: "pricing.js", problem: "Prices round down.", reason }));
const review = (overrides: Partial<SavedReview["result"]> = {}): SavedReview => ({ dir: "/d", header: HEADER, result: { findings: [NEGATIVE, PATTERN, UNUSED], unconfirmed: [], notShown: 0, notes: "", ...overrides } });
const at = (state: FixState, fix?: Partial<FixRun>): FindingState => ({ state, fix: fix === undefined ? undefined : { run: "r", standing: "closed", closer: "merge-back", plain: null, rounds: [], branch: null, base: null, ...fix }, refused: false, cause: null });
const undecided = [at("proposed"), at("proposed"), at("proposed")];

describe("a finished review, as the owner reads it", () => {
  it("says how long it took, how many it found, that it is an agent's opinion, then one numbered block per problem", () => {
    const lines = reviewLines(review());
    expect(lines.slice(0, 3)).toEqual(["Review finished in 4 min 12 s. It found 3 problems.", AGENT_OPINION, ""]);
    expect(lines.slice(3, 9)).toEqual([
      "1. The price shown at checkout can be negative (high)",
      "    Where: checkout.js, line 3",
      "    What is wrong: A discount larger than the price makes the total negative.",
      "    Why it matters: Wrong totals cost money and trust.",
      "    Fixed looks like: A total never goes below zero.",
      "    How we will know: checked: the flagged code is gone.",
    ]);
    expect(lines).toContain("    How we will know: checked: the risky pattern no longer appears.");
    expect(lines).toContain("    How we will know: tests only: no check of this specific problem.");
  });

  it("ends with how many have a specific check, that nothing has changed, and the exact next commands", () => {
    expect(reviewLines(review()).slice(-6)).toEqual([
      "2 of 3 have a specific check; 1 is tests only.",
      NOTHING_CHANGED,
      "",
      "What next?",
      "  Fix all 3: delivery findings approve --all, then delivery fix",
      "  Choose: delivery findings",
    ]);
  });

  it("says how many more were found than it shows, and how many could not be confirmed", () => {
    const lines = reviewLines(review({ notShown: 5, unconfirmed: unconfirmed.slice(0, 2) }));
    expect(lines).toContain("5 more not shown: this review lists at most 2 problems.");
    expect(lines).toContain("2 more could not be confirmed: the code they point at could not be found, so they are not offered. See them with: delivery findings --unconfirmed");
    expect(lines[0]).toBe("Review finished in 4 min 12 s. It found 8 problems.");
  });

  it("says it found none, that this is not proof, and how many files it looked at", () => {
    expect(reviewLines(review({ findings: [] }))).toEqual(["Review finished in 4 min 12 s.", noneFound(84)]);
    expect(noneFound(84)).toBe("The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at 84 files, and it can miss things.");
  });
});

describe("the findings view", () => {
  it("lists each problem with how serious it is and that it is not yet decided", () => {
    expect(listLines(review(), undecided)).toEqual([
      "Code review of shop, 5 Oct 10:19 UTC: 3 problems.",
      "1. The price shown at checkout can be negative (high): not yet decided",
      "2. Settings errors are unhelpful (medium): not yet decided",
      "3. Old payment code (low): not yet decided",
      "",
      "See one in full: delivery findings 1",
    ]);
  });

  it("shows one problem in full, then a block for engineers with category, file range, check kind and its parameters", () => {
    const lines = findingLines(review(), 2);
    expect(lines.slice(0, 1)).toEqual(["2. Settings errors are unhelpful (medium)"]);
    expect(lines.slice(lines.indexOf("FOR ENGINEERS"))).toEqual([
      "FOR ENGINEERS",
      "  Category: correctness (Wrong results)",
      "  File: settings.js, lines 4 to 5",
      "  Check: pattern-absent, pattern JSON\\.parse\\(readFileSync",
      "  Checked in: settings.js",
      '  Flagged text: "return price - discount;"',
      "  Identity: 111111111111, from review code-20261005T101500Z of commit abcdef012345",
    ]);
  });

  it("takes anything that could drive the terminal out of a check's pattern and paths", () => {
    const hostile = sampleFinding({ check: { kind: "pattern-absent", pattern: "a\u001b[2Jb", paths: ["x\u001b]0;t\u0007.js"] } });
    const saved = review();
    const lines = findingLines({ ...saved, result: { ...saved.result, findings: [hostile] } }, 1);
    expect(lines.join("\n")).not.toContain("\u001b");
    expect(lines).toContain("  Check: pattern-absent, pattern ab");
    expect(lines).toContain("  Checked in: x.js");
  });

  it("tells engineers which check the review suggested and could not use, and the agent's own notes", () => {
    const lines = findingLines(review(), 3);
    expect(lines).toContain("  Check: none (the project's own tests only)");
    expect(lines).toContain("  The review suggested this check, which does not match the code as it stands, so it is not used:");
    expect(lines).toContain('  The agent\'s notes: "nothing imports it"');
  });

  it("says where each problem stands, and why one could not be fixed in the agent's own words", () => {
    const stuck = at("unfixable", { standing: "escalated", plain: { group: "needs_your_decision", audience: "owner", sentence: "Needs your decision. The agent stopped and asked for a person to decide.", agentSaid: "The discount rules are not written down.", next: [] } });
    expect(listLines(review(), [at("fixed"), at("skipped"), stuck]).slice(1, 6)).toEqual([
      "1. The price shown at checkout can be negative (high): fixed and merged",
      "2. Settings errors are unhelpful (medium): skipped by you",
      "3. Old payment code (low): could not be fixed",
      "    Why: Needs your decision. The agent stopped and asked for a person to decide.",
      '    The agent said: "The discount rules are not written down."',
    ]);
  });

  it("says a fix opened a pull request rather than merged when that is how the project lands work", () => {
    expect(listLines(review(), [at("fixed", { closer: "open-pr" }), at("already_resolved"), at("stopped")]).slice(1, 4)).toEqual([
      "1. The price shown at checkout can be negative (high): fixed, pull request opened",
      "2. Settings errors are unhelpful (medium): already fixed",
      "3. Old payment code (low): stopped by a setup problem",
    ]);
  });

  it("says how many approved problems are waiting, and the command that starts fixing them", () => {
    const lines = listLines(review(), [at("approved"), at("approved"), at("proposed")]);
    expect(lines.slice(1, 3)).toEqual(["1. The price shown at checkout can be negative (high): being fixed", "2. Settings errors are unhelpful (medium): being fixed"]);
    expect(lines).toContain("2 approved and not started yet. Start fixing them with: delivery fix");
  });

  it("says a fix waiting for sign-off is waiting, and how to look, say yes or say no", () => {
    const held = at("held", { closer: "commit-to-branch", branch: "surface/fix-a-20261006T110000Z", base: "main" });
    const lines = listLines(review(), [held, at("proposed"), at("proposed")]);
    expect(lines).toContain("1. The price shown at checkout can be negative (high): waiting for your sign-off");
    expect(lines).toContain("    Why this needs you: it is a serious problem, and you should see what changed before it reaches your main copy.");
    expect(lines).toContain("    Look at what changed: delivery findings 1 --changes");
    expect(lines).toContain("    Say yes: delivery findings sign-off 1");
    expect(lines).toContain("    Say no: delivery findings reject 1");
    expect(lines).toContain("    For engineers: branch surface/fix-a-20261006T110000Z");
    for (const line of lines) expect(line.replace(/delivery findings|branch \S+/g, "")).not.toMatch(PACK_FORBIDDEN);
  });

  it("lists every problem it could not confirm, with why", () => {
    const lines = unconfirmedLines(review({ unconfirmed }));
    expect(lines[0]).toBe(`The review reported ${unconfirmed.length} problems that could not be confirmed, so they are not offered:`);
    for (const reason of UNCONFIRMED_REASONS) expect(lines).toContain(`    Why it is not offered: ${UNCONFIRMED_WHY[reason]}.`);
  });

  it("says in a problem's history when a fix was rejected for weakening the tests", () => {
    const lines = listLines(review(), [{ ...at("fixed"), refused: true, cause: null }, at("skipped"), at("proposed")]);
    expect(lines.slice(1, 3)).toEqual(["1. The price shown at checkout can be negative (high): fixed and merged", `    ${REFUSED_WEAKENING}`]);
  });

  it("says a problem needs a change to a test, and counts those separately", () => {
    const stuck = (): FindingState => ({ ...at("unfixable", { standing: "escalated", plain: { group: "needs_your_decision", audience: "owner", sentence: "Needs your decision.", agentSaid: "Only the test is wrong.", next: [] } }), refused: true, cause: "needs_test_change" });
    const lines = listLines(review(), [stuck(), stuck(), at("proposed")]);
    expect(lines.slice(1, 5)).toEqual([
      "1. The price shown at checkout can be negative (high): could not be fixed",
      `    ${REFUSED_WEAKENING}`,
      "    Why: It needs a change to one of your tests, which this review does not let an agent do.",
      '    The agent said: "Only the test is wrong."',
    ]);
    expect(lines).toContain(needsTestChangeLine(2));
    expect(needsTestChangeLine(2)).toBe("2 problems could not be fixed: each needs a change to one of your tests, which this review does not let an agent do.");
  });

  it("shows, before it is approved, that a problem's fix will change the tests", () => {
    const header = { ...HEADER, pack: { ...HEADER.pack, categories: [...HEADER.pack.categories, { id: "tests", title: "Tests", changesTests: true as const }] } };
    const weak = sampleFinding({ category: "tests" });
    const saved: SavedReview = { dir: "/d", header, result: { findings: [weak], unconfirmed: [], notShown: 0, notes: "" } };
    expect(reviewLines(saved)).toContain(`    Note: ${CHANGES_TESTS}.`);
    expect(findingLines(saved, 1)).toContain(`    Note: ${CHANGES_TESTS}.`);
    expect(reviewLines(review())).not.toContain(`    Note: ${CHANGES_TESTS}.`);
  });
});

describe("what the review says when it could not run", () => {
  const incomplete = (rationale: string, extra: Partial<Incomplete> = {}): Incomplete => ({ status: "incomplete", rationale: `scanner session did not complete: ${rationale}`, ...extra });

  it.each([
    [incomplete("x", { limit: "rate" }), "The review could not run because the AI service is limiting requests. Wait a few minutes, then run `delivery review code` again."],
    [incomplete("x", { limit: "spend" }), "The review could not run because the spending limit has been reached. Raise the limit or wait for it to reset, then run `delivery review code` again."],
    [incomplete(DID_NOT_COMPLETE.notRun, { notRun: true }), "The review could not run because the agent could not be started or stopped with an error, often a lost connection. Check you are online, then run `delivery review code` again."],
    [incomplete(DID_NOT_COMPLETE.errored), "The review could not run because the agent could not be started or stopped with an error, often a lost connection. Check you are online, then run `delivery review code` again."],
    [incomplete(DID_NOT_COMPLETE.wrongShape), "The review could not run because the agent did not give back a list of problems the harness could read. Run `delivery review code` again."],
    [incomplete(DID_NOT_COMPLETE.noEnvelope), "The review could not run because the agent did not give back a list of problems the harness could read. Run `delivery review code` again."],
    [incomplete("the scanner role is not permitted to use Edit, so the harness refused the call before it ran."), "The review was stopped because the agent tried to do something a review may not do, such as change a file, run a command or read outside your project. Nothing was changed. Run `delivery review code` again."],
  ])("is one plain sentence with one next step", (terminus, sentence) => {
    expect(failureSentence(terminus, "code")).toBe(sentence);
  });
});

describe("the vulnerable-version check, as the owner and an engineer read it", () => {
  const DEPENDENCY = sampleFinding({ id: "333333333333", check: { kind: "dependency-absent", package: "minimist", version: "1.2.5" } });

  it("says what will show it is fixed, and names the package and version for engineers", () => {
    const lines = findingLines(review({ findings: [DEPENDENCY] }), 1);
    expect(lines).toContain("    How we will know: checked: the vulnerable version is no longer installed.");
    expect(lines).toContain("  Check: dependency-absent, minimist 1.2.5 must no longer be in package-lock.json");
  });
});

describe("a security review, as the owner reads it", () => {
  const SECURITY: SavedReview["header"] = {
    ...HEADER,
    reviewId: "security-20261005T101500Z",
    pack: {
      ...HEADER.pack,
      name: "security",
      title: "Security review",
      consequenceLabel: "what-could-happen",
      hold: "high",
      categories: [{ id: "secrets", title: "Passwords and keys", scope: "repo", sensitive: true }, { id: "dependencies", title: "Unsafe library versions", reviewerKnowledge: true }],
    },
  };
  const SECRET = sampleFinding({ title: "A password is written in the code", category: "secrets", severity: "critical", outsideStep: "Change the password at the provider." });
  const LIBRARY = sampleFinding({ id: "333333333333", title: "An old library", category: "dependencies", severity: "medium", check: { kind: "dependency-absent", package: "minimist", version: "1.2.5" } });
  const security = (findings = [SECRET, LIBRARY]): SavedReview => ({ dir: "/d", header: SECURITY, result: { findings, unconfirmed: [], notShown: 0, notes: "" } });

  it("opens with how many problems there are at each severity, and says which wait for sign-off", () => {
    expect(reviewLines(security()).slice(0, 4)).toEqual([
      "Review finished in 4 min 12 s. It found 2 problems.",
      "By how serious they are: 1 critical, 0 high, 1 medium, 0 low.",
      "Problems that are critical or high are fixed and checked, but wait for your sign-off before they reach your main copy.",
      AGENT_OPINION,
    ]);
  });

  it("says what could happen, labels the reviewer's own knowledge, and notes what is left for a person", () => {
    const lines = reviewLines(security());
    expect(lines).toContain("    What could happen: Wrong totals cost money and trust.");
    expect(lines).not.toContain("    Why it matters: Wrong totals cost money and trust.");
    expect(lines).toContain("    One thing is left for you: Change the password at the provider.");
    expect(lines).toContain(`    Note: ${REVIEWER_KNOWLEDGE}`);
    expect(lines.filter((line) => line.includes(REVIEWER_KNOWLEDGE))).toHaveLength(1);
  });

  it("uses no word an owner should not have to know", () => {
    for (const line of reviewLines(security())) expect(line.replace(/delivery findings/g, "")).not.toMatch(PACK_FORBIDDEN);
  });

  it("leaves a code review opening as it was", () => {
    expect(reviewLines(review())[1]).toBe(AGENT_OPINION);
  });
});

describe("the review's own words", () => {
  it("never use the harness's internal words", () => {
    const everything = [
      ...opening("Code review"), RECOVERED, NOT_NOW, NO_REVIEW_YET, unfinishedReview("code"),
      ...reviewLines(review({ notShown: 1, unconfirmed })), ...reviewLines(review({ findings: [] })),
      ...listLines(review({ unconfirmed }), undecided), ...unconfirmedLines(review({ unconfirmed })), ...fixNowLines([1, 3]),
      ...findingLines(review(), 1).slice(0, findingLines(review(), 1).indexOf("FOR ENGINEERS")),
      ...Object.values(CHECK_LEVEL), ...Object.values(UNCONFIRMED_WHY), ...Object.values(STATE_WORDS), PR_OPENED, fixWaiting(1), fixWaiting(2),
      failureSentence({ status: "incomplete", rationale: "x", limit: "rate" }, "code"),
      failureSentence({ status: "incomplete", rationale: "x" }, "code"),
      REFUSED_WEAKENING, NEEDS_TEST_CHANGE, CHANGES_TESTS, needsTestChangeLine(1), needsTestChangeLine(2),
    ].join("\n");
    expect(everything.replace(/delivery findings/g, "")).not.toMatch(PACK_FORBIDDEN);
  });
});

describe("a secret in a problem's text", () => {
  it("is masked in the flagged text and the pattern an engineer sees", () => {
    const secret = "pay-live-7Hq2xV9rLm4K";
    const finding = sampleFinding({ anchor: `const PAYMENTS_PASSWORD = "${secret}";`, sensitive: true, check: { kind: "pattern-absent", pattern: secret, paths: ["payments.js"] } });
    const text = findingLines(review({ findings: [finding] }), 1).join("\n");
    expect(text).not.toContain(secret);
    expect(text).toContain("pay-… (21 characters)");
  });
});
