// Slice 4: Stop Cleanly When a Retry Budget Runs Out
// Source: docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md
// Recorded: 2026-09-09 against commit f6c93b5

//
// Drives the slice's own UAT demo script (npx tsx demos/single-surface-slice-4-budgets.ts)
// and asserts on its printed spend-vs-cap lines and escalation reasons for each of the
// four scripted budget-exhaustion scenarios, plus the stop-and-resume scenario, covering
// the slice's UAT and its acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: stop cleanly when a retry budget runs out", () => {
  const { stdout, status } = runTsx(["demos/single-surface-slice-4-budgets.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a worker that always reports 'stuck, try again' exhausts the correction budget at exactly its cap and escalates", () => {
    const s = section(
      "=== Correction budget: a worker that is always stuck ===",
      "=== Gate-repair budget: a gate that always errors ===",
    );
    expect(s).toContain("Capped by: correction, cap 3");
    expect(s).toContain("Spent:     3 of 3");
    expect(s).toContain(
      "Outcome:   escalated — correction budget exhausted (3/3): no retry remains for a worker_escalate setback",
    );
  });

  it("AC: exhausting the correction budget never consumes another budget", () => {
    const s = section(
      "=== Correction budget: a worker that is always stuck ===",
      "=== Gate-repair budget: a gate that always errors ===",
    );
    expect(s).toContain(
      "Budgets:   correction 3/3, gateError 0/3, gateMaintenance 0/2, terminus 0/5, close 0/3",
    );
  });

  it("AC: a gate that always errors out exhausts the gate-repair budget at exactly its cap and escalates", () => {
    const s = section(
      "=== Gate-repair budget: a gate that always errors ===",
      "=== Incomplete-terminus budget: a worker that never returns a result ===",
    );
    expect(s).toContain("Capped by: gateMaintenance, cap 2");
    expect(s).toContain("Spent:     2 of 2");
    expect(s).toContain(
      "Outcome:   escalated — gateMaintenance budget exhausted (2/2): no retry remains for a gate_error setback",
    );
  });

  it("AC: a worker session that always ends without a valid result exhausts the incomplete-terminus budget at exactly its cap and escalates", () => {
    const s = section(
      "=== Incomplete-terminus budget: a worker that never returns a result ===",
      "=== Close-retry budget: a closer that always rejects the work ===",
    );
    expect(s).toContain("Capped by: terminus, cap 5");
    expect(s).toContain("Spent:     5 of 5");
    expect(s).toContain("Outcome:   escalated — terminus budget exhausted (5/5): hit the turn cap");
  });

  it("AC: exhausting the incomplete-terminus budget never consumes another budget", () => {
    const s = section(
      "=== Incomplete-terminus budget: a worker that never returns a result ===",
      "=== Close-retry budget: a closer that always rejects the work ===",
    );
    expect(s).toContain(
      "Budgets:   correction 0/3, gateError 0/3, gateMaintenance 0/2, terminus 5/5, close 0/3",
    );
  });

  it("AC: a closer that always rejects the work exhausts the close-retry budget at exactly its cap and escalates", () => {
    const s = section(
      "=== Close-retry budget: a closer that always rejects the work ===",
      "=== The same cap, reached across a restart ===",
    );
    expect(s).toContain("Capped by: close, cap 3");
    expect(s).toContain("Spent:     3 of 3");
    expect(s).toContain(
      "Outcome:   escalated — close budget exhausted (3/3): no retry remains for a close_failure setback",
    );
  });

  it("AC: exhausting the close-retry budget never consumes another budget", () => {
    const s = section(
      "=== Close-retry budget: a closer that always rejects the work ===",
      "=== The same cap, reached across a restart ===",
    );
    expect(s).toContain(
      "Budgets:   correction 0/3, gateError 0/3, gateMaintenance 0/2, terminus 0/5, close 3/3",
    );
  });

  it("AC: stopping a budget-exhausting scenario partway through and resuming it from the same directory reaches the same escalation at the same cap", () => {
    const s = section("=== The same cap, reached across a restart ===");
    // Stopped short of the cap, proving the resumed run genuinely continues rather than
    // starting a scenario that was already exhausted before the stop.
    expect(s).toContain("Stopped at:   correction 1/3");
    expect(s).toContain(
      "Uninterrupted: escalated — correction budget exhausted (3/3): no retry remains for a worker_escalate setback",
    );
    expect(s).toContain(
      "Stop + resume: escalated — correction budget exhausted (3/3): no retry remains for a worker_escalate setback",
    );
    expect(s).toContain(
      "               correction 3/3, gateError 0/3, gateMaintenance 0/2, terminus 0/5, close 0/3, 4 session(s)",
    );
    // Both runs land on the identical budget line and session count.
    const budgetLines = [...s.matchAll(/^ {15}correction 3\/3.*$/gm)];
    expect(budgetLines).toHaveLength(2);
    expect(budgetLines[0]?.[0]).toBe(budgetLines[1]?.[0]);
  });

  it("UAT: every scenario's printed retry count exactly matches its budget's cap before escalating", () => {
    const spentLines = [...stdout.matchAll(/^Spent:\s+(\d+) of (\d+)/gm)];
    expect(spentLines).toHaveLength(4);
    for (const [, used, max] of spentLines) {
      expect(used).toBe(max);
    }
  });

  it("demo exercises all four budgets plus the stop-and-resume scenario", () => {
    expect(stdout).toContain("=== Correction budget: a worker that is always stuck ===");
    expect(stdout).toContain("=== Gate-repair budget: a gate that always errors ===");
    expect(stdout).toContain("=== Incomplete-terminus budget: a worker that never returns a result ===");
    expect(stdout).toContain("=== Close-retry budget: a closer that always rejects the work ===");
    expect(stdout).toContain("=== The same cap, reached across a restart ===");
  });
});
