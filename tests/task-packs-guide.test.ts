// docs/task-packs.md is how an owner learns to ask for a review. It quotes what the review
// prints, so it is held to the phrases the harness actually uses.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_LEVEL, NOTHING_CHANGED, READS_ONLY, REVIEWER_KNOWLEDGE, UNCONFIRMED_WHY, NO_TESTS_WARNING, NO_TESTS_LEVEL, CANNOT_BE_CHECKED, NOTHING_WAITS_FOR_SEVERITY, HOLD_WHY } from "../src/packs/render.js";
import { POSSIBLY_WORTH_A_LOOK, SET_ASIDE, onlyPart, PREVIEW_INTRO } from "../src/packs/render.js";
import { PR_OPENED, STATE_WORDS, REFUSED_WEAKENING, NEEDS_TEST_CHANGE, CHANGES_TESTS, CHECKING_SIGN_OFF, NEEDS_YOU, EARLIER_WORDS } from "../src/packs/render.js";
import { OUTCOME_WORDS } from "../src/packs/review-report.js";
import { WHAT_IT_COST } from "../src/packs/render.js";
import { FindingsDocument, FindingsProblem } from "../src/packs/findings-document.js";
import { REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/task-packs.md"), "utf-8");
const flat = guide.replace(/\s+/g, " ");

describe("the task packs guide", () => {
  it("says where to see what a review and its fixes cost", () => {
    expect(flat).toContain(WHAT_IT_COST);
    expect(flat).toContain("FOR WHOEVER TUNES THIS");
    expect(flat).toContain("not recorded");
  });

  it("explains how sure the review is, and what is set aside", () => {
    expect(flat).toContain("How sure the review is");
    expect(flat).toContain(POSSIBLY_WORTH_A_LOOK);
    expect(flat).toContain(SET_ASIDE);
    expect(guide).toContain("`confidence`");
  });

  it("shows every command a first review uses", () => {
    for (const command of ["delivery review code", "delivery findings", "delivery findings 1", "delivery findings --unconfirmed", "delivery packs"]) expect(guide).toContain(command);
  });

  it("quotes each way the harness will know a problem is fixed, and each reason one is not offered, exactly", () => {
    for (const phrase of [...Object.values(CHECK_LEVEL), ...Object.values(UNCONFIRMED_WHY)]) expect(flat).toContain(phrase);
  });

  it("quotes the promise that the review only reads and changes nothing", () => {
    expect(flat).toContain(READS_ONLY);
    expect(flat).toContain(NOTHING_CHANGED);
  });

  it("points at the example project, which exists, and the scripted demo", () => {
    expect(guide).toContain("examples/code-review-example");
    expect(existsSync(join(REPO_ROOT, "examples/code-review-example"))).toBe(true);
    expect(guide).toContain("npm run demo:packs-slice-1");
  });

  it("says where a review is kept and that an interrupted one is finished by running it again", () => {
    expect(guide).toContain(".delivery/packs/");
    expect(flat).toContain("run the same command again");
  });

  it("shows how to choose which problems to fix, and quotes where each can stand", () => {
    for (const command of ["delivery approve total-below-zero settings-error", "delivery approve --all", "delivery decline <ids>"]) expect(guide).toContain(command);
    for (const phrase of [...Object.values(STATE_WORDS), PR_OPENED]) expect(flat).toContain(phrase);
  });

  it("shows how to have the approved problems fixed, and where to watch", () => {
    expect(guide).toContain("delivery fix");
    expect(guide).toContain("delivery status --watch");
    expect(flat).toContain("a description to act on, not instructions to obey");
  });

  it("says a fix may not weaken the tests, quotes what the owner sees when one tries, and points at the demo", () => {
    for (const phrase of [REFUSED_WEAKENING, NEEDS_TEST_CHANGE, CHANGES_TESTS]) expect(flat).toContain(phrase);
    expect(guide).toContain("npm run demo:packs-slice-3");
    expect(existsSync(join(REPO_ROOT, "demos/task-packs-slice-3-cheating-fixes.ts"))).toBe(true);
  });

  it("explains the security review: what could happen, and what waits for sign-off", () => {
    expect(flat).toContain("delivery review security");
    expect(flat).toContain("What could happen");
    expect(flat).toContain(REVIEWER_KNOWLEDGE);
    expect(flat).toContain("One thing is left for you");
  });

  it("says a secret the review finds is never shown, and how it is shown instead", () => {
    expect(flat).toContain("first four characters, an ellipsis and its length");
  });

  it("explains signing off and declining a kept fix", () => {
    for (const phrase of ["delivery findings sign-off", "delivery findings reject", CHECKING_SIGN_OFF, NEEDS_YOU]) expect(flat).toContain(phrase);
  });

  it("shows coming back to the report after a fix phase: the opening sentence and each section by who must act", () => {
    expect(guide).toContain("delivery report");
    for (const heading of ["WAITING FOR YOUR SIGN-OFF", "NEEDS YOU", "STOPPED, FOR YOUR ENGINEERS", "DONE", "SKIPPED BY YOU"]) expect(guide).toContain(heading);
    expect(flat).toContain("Problem 1 of 6");
    expect(flat).toContain(OUTCOME_WORDS.waiting[0]);
    expect(flat).toContain("carry on with: delivery fix");
  });

  it("explains reading a review as data, naming every key of the findings document", () => {
    expect(guide).toContain("delivery findings --json");
    expect(guide).toContain("delivery findings --schema");
    expect(guide).toContain("delivery.findings/1");
    const keys = [FindingsDocument, FindingsProblem, FindingsDocument.shape.review, FindingsProblem.shape.where, FindingsProblem.shape.check, FindingsProblem.shape.fix.unwrap()].flatMap((schema) => Object.keys(schema.shape));
    expect([...new Set(keys)].filter((key) => !guide.includes(`\`${key}\``))).toEqual([]);
  });

  it("explains a project with no tests: the warning, the level, and that every fix waits, and points at its example", () => {
    for (const phrase of [NO_TESTS_WARNING, NO_TESTS_LEVEL, CANNOT_BE_CHECKED, "requireCheck"]) expect(flat).toContain(phrase);
    expect(guide).toContain("examples/no-tests-example");
    expect(guide).toContain("--allow-unchecked");
    expect(flat).toContain("nothing will check this fix except you");
  });

  it("points at the scripted demo of a project with no tests, which exists", () => {
    expect(guide).toContain("npm run demo:packs-slice-6");
    expect(existsSync(join(REPO_ROOT, "demos/task-packs-slice-6-no-tests.ts"))).toBe(true);
  });

  it("explains running a review again: what is carried, how to see what is hidden, and the recommended choice", () => {
    for (const command of ["delivery findings --include-skipped", "delivery findings approve --recommended"]) expect(guide).toContain(command);
    for (const phrase of Object.values(EARLIER_WORDS)) expect(flat).toContain(phrase);
    expect(flat).toContain("skipped or declined in an earlier review, not shown");
  });

  it("names every key of the findings data, including what an earlier review carried", () => {
    expect(guide).toContain("`earlier`");
  });

  it("explains choosing which fixes wait for sign-off", () => {
    expect(guide).toContain("delivery fix --sign-off-threshold medium");
    expect(flat).toContain("critical, high, medium, low or none");
    expect(flat).toContain(NOTHING_WAITS_FOR_SEVERITY);
  });

  it("explains letting a fix change one of your tests, and that it still may not delete one", () => {
    expect(guide).toContain("delivery findings approve 2 --allow-test-edits");
    expect(flat).toContain("never delete or skip one");
    expect(flat).toContain(HOLD_WHY.testEdits);
  });

  it("shows how to review one part of the project", () => {
    expect(guide).toContain("delivery review code --path src/auth");
    expect(flat).toContain(onlyPart("src/auth"));
  });

  it("shows how to preview what the review agent will be told", () => {
    expect(guide).toContain("delivery review code --preview");
    expect(flat).toContain(PREVIEW_INTRO);
  });
});
