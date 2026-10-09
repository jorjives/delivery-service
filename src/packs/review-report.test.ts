import { describe, expect, it } from "vitest";
import type { Plain } from "../report/document.js";
import type { Finding } from "./finding.js";
import { FIX_STATES, UNDECIDED, type FindingState, type FixRun, type FixState } from "./fix-state.js";
import type { SavedReview } from "./review-record.js";
import { PACK_FORBIDDEN } from "./review-fixtures.js";
import { sampleFinding } from "./review-fixtures.js";
import { AGENT_DID, REVIEW_NEXT, outcomeOf, OUTCOME_WORDS, reviewPart, reviewSections, UNFIXABLE_ACTION, reviewOpening } from "./review-report.js";
import { CHECK_LEVEL, NO_TESTS_LEVEL, UNCHECKABLE_WHY } from "./render.js";

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
      expect(outcome === null).toBe(state === "proposed" || state === "needs_decision" || state === "skipped");
      if (outcome !== null) expect(OUTCOME_WORDS[outcome]).toHaveLength(2);
    }
  });
});

const plain = (over: Partial<Plain>): Plain => ({ group: "failed_after_attempts", audience: "owner", sentence: "Failed after 3 attempts. The agent tried 3 times and the check you set up still does not pass.", agentSaid: null, next: [], ...over });
const sections = (states: FindingState[], findings = states.map((_, i) => problem(i + 1))): string[] => reviewSections(reviewOf(findings), states, false);

describe("a review's report, problem by problem", () => {
  it("puts each problem under who must act, in a fixed order, with how many each holds", () => {
    const states = [at("held"), at("unfixable", {}, { standing: "escalated", plain: plain({}) }), at("stopped", {}, { standing: "escalated", plain: plain({ group: "needs_an_engineer", audience: "engineer" }) }), at("fixed"), at("skipped"), at("fixing", {}, { standing: "unfinished" }), UNDECIDED];

    expect(sections(states).filter((line) => /^[A-Z]/.test(line))).toEqual([
      "WAITING FOR YOUR SIGN-OFF (1)",
      "NEEDS YOU (1)",
      "STOPPED, FOR YOUR ENGINEERS (1)",
      "DONE (1)",
      "BEING FIXED (1)",
      "NOT YET DECIDED (1)",
      "SKIPPED BY YOU (1)",
    ]);
  });

  it("says of a fix waiting for sign-off what the risk was, what the agent changed, how the check knows, why it needs the owner, and the commands", () => {
    const secret = problem(1, { severity: "critical", outsideStep: "Change the payments password at the provider." });

    expect(sections([at("held", {}, { said: "Read the key from PAYMENTS_KEY." })], [secret])).toEqual([
      "",
      "WAITING FOR YOUR SIGN-OFF (1)",
      '  Problem 1 of 1: "Problem number 1" (critical)',
      '    What could happen: "Wrong totals cost money and trust."',
      "    The agent changed your code so the code the review flagged is gone.",
      '    The agent said: "Read the key from PAYMENTS_KEY."',
      "    How we know: the check passed (checked: the flagged code is gone), and every test that passed before still passes.",
      '    One thing is left for you: "Change the payments password at the provider."',
      "    Why this needs you: it is a serious problem, and you should see what changed before it reaches your main copy.",
      "    Look at what changed: delivery findings 1 --changes",
      "    Say yes: delivery findings sign-off 1",
      "    Say no: delivery findings reject 1",
      "    For engineers: branch surface/fix-1",
    ]);
  });

  it("says of a problem that could not be fixed why, in a fixed sentence and the agent's words, who must act and what", () => {
    const stuck = at("unfixable", {}, { standing: "escalated", plain: plain({ agentSaid: "I could not find where the total is worked out." }) });

    expect(sections([stuck], [problem(1, { severity: "high" })])).toEqual([
      "",
      "NEEDS YOU (1)",
      '  Problem 1 of 1: "Problem number 1" (high)',
      "    Could not be fixed. Failed after 3 attempts. The agent tried 3 times and the check you set up still does not pass.",
      '    The agent said: "I could not find where the total is worked out."',
      "    Who acts: you, or an engineer you pass it to.",
      "    To act: See it in full with delivery findings 1, then fix it by hand or pass it to an engineer.",
    ]);
  });

  it("says a problem that needs a change to a test needs one, and who may make it", () => {
    const lines = sections([at("unfixable", { cause: "needs_test_change" }, { standing: "escalated", plain: plain({}) })]);

    expect(lines).toContain("    Could not be fixed. It needs a change to one of your tests, which this review does not let an agent do.");
    expect(lines).toContain(`    Who acts: ${UNFIXABLE_ACTION.needs_test_change.who}.`);
  });

  it("puts a problem stopped by a broken check with the engineers, told as any stopped task is", () => {
    const broken = plain({ group: "needs_an_engineer", audience: "engineer", sentence: "The check you set up could not be run, even after trying it again. This is a problem with the setup, not a decision for you.", next: ["Pass this to whoever maintains your checks: delivery status fix-5-20261005T110400Z"] });

    expect(sections([at("stopped", {}, { standing: "escalated", plain: broken })])).toEqual([
      "",
      "STOPPED, FOR YOUR ENGINEERS (1)",
      '  Problem 1 of 1: "Problem number 1" (high)',
      "    Stopped by a setup problem. The check you set up could not be run, even after trying it again. This is a problem with the setup, not a decision for you.",
      "    To act: Pass this to whoever maintains your checks: delivery status fix-5-20261005T110400Z",
    ]);
  });

  it("names the check's level on every fixed line, so a fix checked only by the tests never reads as proved", () => {
    const lines = sections([at("fixed"), at("fixed")], [problem(1), problem(2, { severity: "low", check: { kind: "none" } })]);

    expect(lines).toContain(`  Problem 1 of 2: "Problem number 1" (high): fixed and merged; ${CHECK_LEVEL["anchor-gone"]}`);
    expect(lines).toContain(`  Problem 2 of 2: "Problem number 2" (low): fixed and merged; ${CHECK_LEVEL.none}`);
  });

  it("lists under NEEDS YOU what only a person can do once a fix is merged", () => {
    const lines = sections([at("fixed")], [problem(1, { outsideStep: "Change the payments password at the provider." })]);

    expect(lines).toEqual(expect.arrayContaining(["NEEDS YOU (1)", '  Problem 1 of 1: "Problem number 1" (high)', '    One thing is left for you: "Change the payments password at the provider."']));
  });

  it("tells a signed-off fix that could not be merged under NEEDS YOU, and a declined one under the engineers", () => {
    const failed = sections([at("signed_off_failed", { signOff: { t: "not_landed", at: "2026-10-05T12:00:00.000Z", id: "000000000001", reason: "conflict", detail: "" } })]);
    const declined = sections([at("rejected", { signOff: { t: "rejected", at: "2026-10-05T12:00:00.000Z", id: "000000000001" } })]);

    expect(failed).toEqual(expect.arrayContaining(["NEEDS YOU (1)", "    Signed off but could not be merged."]));
    expect(declined).toEqual(expect.arrayContaining(["STOPPED, FOR YOUR ENGINEERS (1)", "    Declined at sign-off.", "    The fix is kept on branch surface/fix-1 for an engineer."]));
  });

  it("says how to start fixing approved problems, and how to choose undecided ones", () => {
    expect(sections([at("approved", {}, { standing: "not_started", run: null })])).toContain("  1 approved and not started yet. Start fixing it with: delivery fix");
    expect(sections([UNDECIDED])).toContain("  Choose with: delivery findings approve or delivery findings skip, and their numbers");
  });

  it("is the report's part, with the review's opening, delivery fix to carry on, and the findings to read next", () => {
    const part = reviewPart(reviewOf([problem(1)]), [at("fixed")], false);
    expect(part).toMatchObject({ carryOn: "delivery fix", next: REVIEW_NEXT });
    expect(part.opening[0]).toBe("Security review of shop: 1 problem found; you approved 1 and skipped 0.");
  });
});

describe("a review of a project with no tests, as the report tells it", () => {
  const noTestsOf = (findings: Finding[]): SavedReview => ({ ...reviewOf(findings), header: { ...HEADER, noTests: true as const } });

  it("says a waiting fix passed its own check only, and why it needs the owner", () => {
    const lines = reviewSections(noTestsOf([problem(1, { severity: "low" })]), [at("held")], false);
    expect(lines).toContain(`    How we know: the check passed (${CHECK_LEVEL["anchor-gone"]}); ${NO_TESTS_LEVEL}.`);
    expect(lines).toContain("    Why this needs you: your project has no tests, so nothing has checked that this fix did not break something else.");
  });

  it("names the level on a fixed line, so it never reads as proved by tests", () => {
    expect(reviewSections(noTestsOf([problem(1)]), [at("fixed")], false).join("\n")).toContain(`${CHECK_LEVEL["anchor-gone"]}; ${NO_TESTS_LEVEL}`);
  });
});

describe("a problem that needs the owner's decision, as the report tells it", () => {
  it("is under NEEDS YOU, says why, and how to approve it anyway", () => {
    const lines = reviewSections(reviewOf([problem(1, { check: { kind: "none" } })]), [at("needs_decision")], false);
    expect(lines.join("\n")).toContain("NEEDS YOU (1)");
    expect(lines).toContain(`    Needs your decision: ${UNCHECKABLE_WHY}`);
  });

  it("is counted on its own in the opening, never as approved", () => {
    expect(reviewOpening(reviewOf([problem(1), problem(2)]), [at("fixed"), at("needs_decision")])[0]).toBe("Security review of shop: 2 problems found; you approved 1 and skipped 0; 1 needs your decision.");
  });
});

describe("a review's report in the owner's words", () => {
  /** What is the harness's own: quoted record words, the command name, run ids and branches are data. */
  const ownWords = (lines: string[]): string =>
    lines
      .join("\n")
      .replace(/"[^"]*"/g, "")
      .replace(/delivery findings/g, "")
      .replace(/\b(surface\/\S+|\S+-\d{8}T\d{6}Z)/g, "");
  const groups: Plain["group"][] = ["needs_your_decision", "failed_after_attempts", "abandoned", "needs_an_engineer", "stopped"];

  it("never uses the harness's internal words, whatever state each problem is in", () => {
    const every: FindingState[] = [
      ...FIX_STATES.map((state) => at(state, {}, { standing: state === "unfixable" || state === "stopped" ? "escalated" : "closed", plain: plain({}) })),
      ...groups.map((group) => at("unfixable", {}, { standing: "escalated", plain: plain({ group }) })),
      at("unfixable", { cause: "needs_test_change" }, { standing: "escalated", plain: plain({}) }),
      at("fixed", {}, { closer: "open-pr" }),
    ];
    const findings = every.map((_, i) => problem((i % 9) + 1, { outsideStep: "Change the password." }));
    const part = reviewPart(reviewOf(findings), every, false);

    expect(ownWords([...part.opening, ...part.sections, part.next])).not.toMatch(PACK_FORBIDDEN);
  });

  it("keeps every phrase in its tables clean", () => {
    const phrases = [...Object.values(AGENT_DID), ...Object.values(UNFIXABLE_ACTION).flatMap(({ who, what }) => [who, what(1)]), ...Object.values(OUTCOME_WORDS).flat(), REVIEW_NEXT];
    for (const phrase of phrases) expect(phrase.replace(/delivery findings/g, "")).not.toMatch(PACK_FORBIDDEN);
  });
});
