import { describe, expect, it } from "vitest";
import type { Finding } from "./finding.js";
import { FIX_STATES, UNDECIDED, type FindingState, type FixRun, type FixState } from "./fix-state.js";
import type { SavedReview } from "./review-record.js";
import { sampleFinding } from "./review-fixtures.js";
import { outcomeOf, OUTCOME_WORDS, reviewOpening } from "./review-report.js";

const HEADER: SavedReview["header"] = {
  reviewId: "security-20261005T101500Z",
  pack: {
    name: "security",
    version: "1.0.0",
    title: "Security review",
    hash: "0".repeat(64),
    maxFindings: 40,
    categories: [{ id: "correctness", title: "Wrong results" }],
    consequenceLabel: "what-could-happen",
    hold: "high",
  },
  repoPath: "/home/dana/shop",
  commit: "abcdef0123456789abcdef0123456789abcdef01",
  fileCount: 84,
  startedAt: "2026-10-05T10:15:00.000Z",
  endedAt: "2026-10-05T10:19:12.000Z",
};

/** The nth problem, numbered from 1, with a distinct identity and title. */
const problem = (n: number, over: Partial<Finding> = {}): Finding => sampleFinding({ id: `00000000000${n}`, title: `Problem number ${n}`, ...over });
const reviewOf = (findings: Finding[]): SavedReview => ({ dir: "/d", header: HEADER, result: { findings, unconfirmed: [], notShown: 0, notes: "" } });
/** A problem's state with a fix that ran, unless the state is one no fix has reached. */
const at = (state: FixState, over: Partial<FindingState> = {}, fix: Partial<FixRun> = {}): FindingState => ({
  ...UNDECIDED,
  state,
  fix: { run: `fix-${state}-20261005T110000Z`, standing: "closed", closer: "merge-back", plain: null, rounds: [], branch: "surface/fix-1", base: "main", said: null, ...fix },
  ...over,
});

describe("the sentence a review's report opens with", () => {
  it("counts what was found, approved and skipped, then what was fixed, what waits for sign-off and what could not be fixed", () => {
    const states = [at("held"), at("fixed"), at("fixed"), at("unfixable"), at("stopped"), at("skipped")];

    expect(reviewOpening(reviewOf(states.map((_, i) => problem(i + 1))), states)).toEqual([
      "Security review of shop: 6 problems found; you approved 5 and skipped 1.",
      "2 are fixed and merged; 1 is waiting for your sign-off; 1 could not be fixed; 1 was stopped by a setup problem.",
      "Review 5 Oct 10:19 UTC.",
    ]);
  });

  it("always says the three the owner asks about, even when none", () => {
    expect(reviewOpening(reviewOf([problem(1), problem(2)]), [at("fixed"), at("skipped")])[1]).toBe("1 is fixed and merged; 0 are waiting for your sign-off; 0 could not be fixed.");
  });

  it("counts problems not yet decided and those still being fixed", () => {
    expect(reviewOpening(reviewOf([problem(1), problem(2)]), [UNDECIDED, at("approved")]).slice(0, 2)).toEqual([
      "Security review of shop: 2 problems found; you approved 1 and skipped 0; 1 not yet decided.",
      "0 are fixed and merged; 0 are waiting for your sign-off; 0 could not be fixed; 1 is being fixed.",
    ]);
  });

  it("does not call a fix merged when its pull request is only open", () => {
    expect(reviewOpening(reviewOf([problem(1)]), [at("fixed", {}, { closer: "open-pr" })])[1]).toBe(
      "0 are fixed and merged; 0 are waiting for your sign-off; 0 could not be fixed; 1 is fixed, with a pull request open.",
    );
  });

  it("says a review that found nothing found nothing", () => {
    expect(reviewOpening(reviewOf([]), [])).toEqual(["Security review of shop: no problems found.", "Review 5 Oct 10:19 UTC."]);
  });

  it("counts every state a fix can reach under exactly one outcome, and none the owner has not acted on", () => {
    for (const state of FIX_STATES) {
      const outcome = outcomeOf(at(state));
      expect(outcome === null).toBe(state === "proposed" || state === "skipped");
      if (outcome !== null) expect(OUTCOME_WORDS[outcome]).toHaveLength(2);
    }
  });
});
