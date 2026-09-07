// Slice 5: A Gated Surface's Baseline and History Survive on Disk
// Source: docs/superpowers/specs/2026-09-05-gate-interface-slices.md
// Recorded: 2026-09-07 against commit 6a9c2bf

//
// Drives the slice's own UAT demo script (npx tsx demos/gate-interface-slice-5-round-trip.ts)
// and asserts on its printed report for each scenario, covering the slice's UAT and all four
// acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: a surface's baseline and history survive a real write-then-read cycle", () => {
  const { stdout, status } = runTsx(["demos/gate-interface-slice-5-round-trip.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: storing a baseline succeeds exactly once; a second attempt for the same surface is rejected", () => {
    const first = section("=== 1. Record the baseline ===", "=== 2. A second baseline");
    expect(first).toContain("Baseline stored: status PASS, 2 assertions");
    expect(first).toContain("[PASS] 1 - alpha");
    expect(first).toContain("[PASS] 2 - beta");

    const second = section("=== 2. A second baseline for the same surface ===", "=== 3. Simulate an attempt");
    expect(second).toContain("Second baseline: rejected — ImmutabilityViolation: Cannot overwrite baseline");
  });

  it("AC: running check after an attempt appends a history entry with verdict, new failures and failure class", () => {
    const s = section("=== 3. Simulate an attempt that breaks a test, then check ===", "=== 4. A second attempt");
    expect(s).toContain("Check verdict: pass=false, class=fail");
    expect(s).toContain("New failure: 2 - beta (PASS -> FAIL) — not ok 2 - beta");
  });

  it("AC: a gate-level error during check is recorded as an error-class entry, distinct from a worker-caused failure", () => {
    const s = section("=== 4. A second attempt where the gate itself cannot run ===", "=== 5. Re-read");
    expect(s).toContain("Gate report status: ERROR");
    expect(s).toContain("Check verdict: pass=false, class=error");
  });

  it("AC: reading the case file back shows the original baseline unchanged and the check's verdict present in history", () => {
    const s = section("=== 5. Re-read the case file from disk ===");
    expect(s).toContain("Baseline re-read unchanged: true");
    expect(s).toContain("History: attempt 1 — status FAIL, class fail, newFailures [2 - beta]");
    expect(s).toContain("History: attempt 2 — status ERROR, class error, newFailures []");
  });

  it("demo confirms the full round trip completed", () => {
    expect(stdout).toContain(
      "Round trip complete: baseline stored once, two verdicts appended, all re-read from disk.",
    );
  });
});
