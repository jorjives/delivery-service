// Slice 2: Gate a Real Project with a Shell Command
// Source: docs/superpowers/specs/2026-09-05-gate-interface-slices.md
// Recorded: 2026-09-06 against commit 6b92b9d

//
// Drives the slice's own UAT demo script (npx tsx demos/gate-interface-slice-2-command-gate.ts)
// and asserts on its printed report for each parse mode and error scenario, covering the
// slice's UAT and all six acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: point the command gate at a real test suite", () => {
  const { stdout, status } = runTsx(["demos/gate-interface-slice-2-command-gate.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: TAP output produces one assertion per ok/not ok line with a stable ID from test number and description", () => {
    const s = section("=== TAP — all passing ===", "=== JUnit — all passing ===");
    expect(s).toContain("[PASS] 1 - addition works");
    expect(s).toContain("[PASS] 2 - subtraction works");
    expect(s).toContain("[PASS] 3 - multiplication works");
  });

  it("UAT: a broken TAP run shows the failed test as FAIL and every other test as PASS", () => {
    const s = section("=== TAP — one broken ===", "=== JUnit — all passing ===");
    expect(s).toContain("[PASS] 1 - addition works");
    expect(s).toContain("[FAIL] 2 - subtraction works");
    expect(s).toContain("[PASS] 3 - multiplication works");
  });

  it("AC: JUnit XML produces one assertion per test case with a stable ID from class and test name", () => {
    const s = section("=== JUnit — all passing ===", "=== JUnit — one broken ===");
    expect(s).toContain("[PASS] MathTest::addition");
    expect(s).toContain("[PASS] MathTest::subtraction");
    expect(s).toContain("[PASS] MathTest::multiplication");
  });

  it("UAT: a broken JUnit run shows the failed test as FAIL and every other test as PASS", () => {
    const s = section("=== JUnit — one broken ===", "=== Exit-code — passing");
    expect(s).toContain("[PASS] MathTest::addition");
    expect(s).toContain("[FAIL] MathTest::subtraction");
    expect(s).toContain("[PASS] MathTest::multiplication");
  });

  it("AC: exit-code mode produces exactly one assertion, passing on exit 0 and failing otherwise", () => {
    const pass = section("=== Exit-code — passing (exit 0) ===", "=== Exit-code — failing");
    const passAssertions = pass.match(/^\s*\[(PASS|FAIL)\]/gm) ?? [];
    expect(passAssertions).toHaveLength(1);
    expect(pass).toContain("[PASS]");

    const fail = section("=== Exit-code — failing (exit 1) ===", "=== Determinism");
    const failAssertions = fail.match(/^\s*\[(PASS|FAIL)\]/gm) ?? [];
    expect(failAssertions).toHaveLength(1);
    expect(fail).toContain("[FAIL]");
  });

  it("AC: running the same command twice against unchanged code produces the same set of assertion IDs", () => {
    const s = section("=== Determinism — same command run twice ===", "=== Error — command not found");
    const run1 = /Run 1 IDs: (.+)/.exec(s)?.[1];
    const run2 = /Run 2 IDs: (.+)/.exec(s)?.[1];
    expect(run1).toBeTruthy();
    expect(run1).toBe(run2);
  });

  it("AC: a command that cannot be found or produces unparseable output yields an error status with a diagnostic detail, never a crash", () => {
    const notFound = section("=== Error — command not found ===", "=== Error — unparseable output ===");
    expect(notFound).toContain("Status: ERROR");
    expect(notFound).toContain("Detail:");

    const unparseable = section("=== Error — unparseable output ===", "=== Error — duplicate assertion ID ===");
    expect(unparseable).toContain("Status: ERROR");
    expect(unparseable).toContain("Detail:");
  });

  it("AC: a command reporting the same assertion ID twice produces an error status with a diagnostic detail", () => {
    const s = section("=== Error — duplicate assertion ID ===", "--- Demo complete ---");
    expect(s).toContain("Status: ERROR");
    expect(s).toContain("Detail: Duplicate assertion ID");
  });

  it("demo prints its completion banner", () => {
    expect(stdout).toContain("--- Demo complete ---");
  });

  it("AC: a command that times out produces an error status with a diagnostic detail", () => {
    const s = section("=== Error — command timed out ===", "--- Demo complete ---");
    expect(s).toContain("Status: ERROR");
    expect(s).toContain("Detail:");
    expect(s.toLowerCase()).toContain("timed out");
  });
});
