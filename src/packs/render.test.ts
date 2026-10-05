import { describe, expect, it } from "vitest";
import { DID_NOT_COMPLETE } from "../agent-invoke.js";
import type { Incomplete } from "../ports.js";
import { UNCONFIRMED_REASONS, type Unconfirmed } from "./finding.js";
import {
  AGENT_OPINION, CHECK_LEVEL, failureSentence, findingLines, fixNowLines, listLines, NO_REVIEW_YET, noneFound, NOT_NOW, NOTHING_CHANGED,
  opening, reviewLines, RECOVERED, UNCONFIRMED_WHY, unconfirmedLines, unfinishedReview,
} from "./render.js";
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
    expect(listLines(review())).toEqual([
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

  it("tells engineers which check the review suggested and could not use, and the agent's own notes", () => {
    const lines = findingLines(review(), 3);
    expect(lines).toContain("  Check: none (the project's own tests only)");
    expect(lines).toContain("  The review suggested this check, which does not match the code as it stands, so it is not used:");
    expect(lines).toContain('  The agent\'s notes: "nothing imports it"');
  });

  it("lists every problem it could not confirm, with why", () => {
    const lines = unconfirmedLines(review({ unconfirmed }));
    expect(lines[0]).toBe(`The review reported ${unconfirmed.length} problems that could not be confirmed, so they are not offered:`);
    for (const reason of UNCONFIRMED_REASONS) expect(lines).toContain(`    Why it is not offered: ${UNCONFIRMED_WHY[reason]}.`);
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

describe("the review's own words", () => {
  it("never use the harness's internal words", () => {
    const everything = [
      ...opening("Code review"), RECOVERED, NOT_NOW, NO_REVIEW_YET, unfinishedReview("code"),
      ...reviewLines(review({ notShown: 1, unconfirmed })), ...reviewLines(review({ findings: [] })),
      ...listLines(review({ unconfirmed })), ...unconfirmedLines(review({ unconfirmed })), ...fixNowLines([1, 3]),
      ...findingLines(review(), 1).slice(0, findingLines(review(), 1).indexOf("FOR ENGINEERS")),
      ...Object.values(CHECK_LEVEL), ...Object.values(UNCONFIRMED_WHY),
      failureSentence({ status: "incomplete", rationale: "x", limit: "rate" }, "code"),
      failureSentence({ status: "incomplete", rationale: "x" }, "code"),
    ].join("\n");
    expect(everything.replace(/delivery findings/g, "")).not.toMatch(PACK_FORBIDDEN);
  });
});
