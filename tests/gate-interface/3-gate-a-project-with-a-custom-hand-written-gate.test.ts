// Slice 3: Gate a Project with a Custom, Hand-Written Gate
// Source: docs/superpowers/specs/2026-09-05-gate-interface-slices.md
// Recorded: 2026-09-06 against commit 5b102ea

//
// Drives the slice's own UAT demo script (npx tsx demos/gate-interface-slice-3-custom-gate.ts)
// and asserts on its printed report for each scenario, covering the slice's UAT and all five
// acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: write a small custom gate module and have the harness load and run it", () => {
  const { stdout, status } = runTsx(["demos/gate-interface-slice-3-custom-gate.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a module exporting baseline and check is loaded and both methods run successfully against a worktree", () => {
    const baselineSection = section("=== Working custom gate — baseline ===", "=== Working custom gate — check ===");
    expect(baselineSection).toContain("Status: PASS");
    expect(baselineSection).toContain("[PASS] file:alpha.txt — present in the worktree");
    expect(baselineSection).toContain("[PASS] file:beta.txt — present in the worktree");

    const checkSection = section("=== Working custom gate — check ===", "=== Named export");
    expect(checkSection).toContain("Status: PASS");
    expect(checkSection).toContain("[PASS] file:alpha.txt — present in the worktree");
    expect(checkSection).toContain("[PASS] file:beta.txt — present in the worktree");
  });

  it("AC: a named export other than the default can be selected and loaded correctly", () => {
    const s = section("=== Named export 'strictGate' — baseline ===", "=== Broken — module path");
    expect(s).toContain("Status: PASS");
    expect(s).toContain("[PASS] strict:licence — named export was selected");
  });

  it("AC: a module path that doesn't resolve produces an error status with a diagnostic detail, never a crash", () => {
    const s = section("=== Broken — module path does not resolve ===", "=== Broken — export missing");
    expect(s).toContain("Status: ERROR");
    expect(s).toContain("Detail:");
    expect(s).toContain("cannot load custom gate module");
  });

  it("AC: a module whose export is missing baseline or check is rejected with a clear, named error at load time", () => {
    const s = section("=== Broken — export missing 'check' ===", "=== Throwing gate");
    expect(s).toContain("Rejected at load time:");
    expect(s).toContain("InvalidGateExport");
    expect(s).toContain('missing "check" method');
    expect(s).not.toContain("UNEXPECTED");
  });

  it("AC: an uncaught exception thrown by a custom gate's baseline or check is caught and turned into an error report, never propagated", () => {
    const s = section("=== Throwing gate — baseline ===", "--- Demo complete ---");
    expect(s).toContain("Status: ERROR");
    expect(s).toContain("threw during baseline: the custom gate exploded");
  });

  it("demo prints its completion banner", () => {
    expect(stdout).toContain("--- Demo complete ---");
  });
});
