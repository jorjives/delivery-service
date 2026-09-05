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

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: identical passing assertions at baseline and check pass with no new failures", () => {
    const s = section("1. No regressions", "2. Genuine regression");
    expect(s).toContain("verdict: PASS");
    expect(s).not.toContain("new failure:");
  });

  it("AC: an assertion that passed at baseline and fails at check is a new failure with both outcomes", () => {
    const s = section("2. Genuine regression", "3. Vanished assertion");
    expect(s).toContain("verdict: FAIL (fail)");
    expect(s).toContain("new failure: a (PASS -> FAIL)");
    // Also covers AC: non-ERROR gate status classes as worker-caused (fail), not infrastructure (error)
    expect(s).not.toContain("(error)");
  });

  it("AC: an assertion that passed at baseline and is missing at check is a new failure with ABSENT", () => {
    const s = section("3. Vanished assertion", "4. Pre-existing red noise");
    expect(s).toContain("verdict: FAIL (fail)");
    expect(s).toContain("new failure: a (PASS -> ABSENT)");
  });

  it("AC: an assertion already failing at baseline is never reported as a new failure", () => {
    const s = section("4. Pre-existing red noise", "5. Brand-new failing assertion, default");
    expect(s).toContain("verdict: PASS");
    expect(s).not.toContain("new failure:");
  });

  it("AC: an assertion present at check but absent from baseline is not reported by default", () => {
    const s = section("5. Brand-new failing assertion, default", "5b. Brand-new failing assertion");
    expect(s).toContain("verdict: PASS");
    expect(s).not.toContain("new failure:");
  });

  it("AC: with failOnNewAssertions set, a failing assertion with no baseline counterpart is a new failure", () => {
    const s = section("5b. Brand-new failing assertion", "6. Gate-level ERROR");
    expect(s).toContain("verdict: FAIL (fail)");
    expect(s).toContain("new failure: b (ABSENT -> FAIL)");
  });

  it("AC: a gate-level ERROR check status fails and classes as infrastructure regardless of assertion outcomes", () => {
    const s = section("6. Gate-level ERROR");
    expect(s).toContain("verdict: FAIL (error)");
  });
});
