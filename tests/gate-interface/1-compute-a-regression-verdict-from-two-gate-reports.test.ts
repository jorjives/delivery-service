// Slice 1: Compute a Regression Verdict from Two Gate Reports
// Source: docs/superpowers/specs/2026-09-05-gate-interface-slices.md
// Recorded: 2026-09-05 against commit b327777d892120d756a1368d3e24bc582191c73e
//
// Drives the slice's own UAT demo script (npx tsx demos/gate-interface-slice-1-delta-rule.ts)
// and asserts on its printed verdict for each baseline/check scenario, covering the
// slice's UAT and all eight acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: feed the delta rule a pair of before/after gate reports", () => {
  const { stdout, status } = runTsx(["demos/gate-interface-slice-1-delta-rule.ts"]);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: identical passing assertions at baseline and check pass with no new failures", () => {
    const section = stdout.slice(
      stdout.indexOf("1. No regressions"),
      stdout.indexOf("2. Genuine regression"),
    );
    expect(section).toContain("verdict: PASS");
    expect(section).not.toContain("new failure:");
  });

  it("AC: an assertion that passed at baseline and fails at check is a new failure with both outcomes", () => {
    const section = stdout.slice(
      stdout.indexOf("2. Genuine regression"),
      stdout.indexOf("3. Vanished assertion"),
    );
    expect(section).toContain("verdict: FAIL (fail)");
    expect(section).toContain("new failure: a (PASS -> FAIL)");
  });

  it("AC: an assertion that passed at baseline and is missing at check is a new failure with ABSENT", () => {
    const section = stdout.slice(
      stdout.indexOf("3. Vanished assertion"),
      stdout.indexOf("4. Pre-existing red noise"),
    );
    expect(section).toContain("verdict: FAIL (fail)");
    expect(section).toContain("new failure: a (PASS -> ABSENT)");
  });

  it("AC: an assertion already failing at baseline is never reported as a new failure", () => {
    const section = stdout.slice(
      stdout.indexOf("4. Pre-existing red noise"),
      stdout.indexOf("5. Brand-new failing assertion, default"),
    );
    expect(section).toContain("verdict: PASS");
    expect(section).not.toContain("new failure:");
  });

  it("AC: an assertion present at check but absent from baseline is not reported by default", () => {
    const section = stdout.slice(
      stdout.indexOf("5. Brand-new failing assertion, default"),
      stdout.indexOf("5b. Brand-new failing assertion"),
    );
    expect(section).toContain("verdict: PASS");
    expect(section).not.toContain("new failure:");
  });

  it("AC: with failOnNewAssertions set, a failing assertion with no baseline counterpart is a new failure", () => {
    const section = stdout.slice(
      stdout.indexOf("5b. Brand-new failing assertion"),
      stdout.indexOf("6. Gate-level ERROR"),
    );
    expect(section).toContain("verdict: FAIL (fail)");
    expect(section).toContain("new failure: b (PASS -> FAIL)");
  });

  it("AC: a gate-level ERROR check status fails and classes as infrastructure regardless of assertion outcomes", () => {
    const section = stdout.slice(stdout.indexOf("6. Gate-level ERROR"));
    expect(section).toContain("verdict: FAIL (error)");
  });

  it("AC: new failures with a non-ERROR gate status class as worker-caused, not infrastructure", () => {
    // Same scenario 2 output above already shows "(fail)" rather than "(error)" —
    // asserted again here directly against the acceptance criterion's wording.
    const section = stdout.slice(
      stdout.indexOf("2. Genuine regression"),
      stdout.indexOf("3. Vanished assertion"),
    );
    expect(section).toContain("(fail)");
    expect(section).not.toContain("(error)");
  });
});
