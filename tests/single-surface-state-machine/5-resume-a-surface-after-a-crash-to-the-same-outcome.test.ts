// Slice 5: Resume a Surface After a Crash to the Same Outcome
// Source: docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md
// Recorded: 2026-09-09 against commit e3cf65c

//
// Drives the slice's own UAT demo script (npx tsx demos/single-surface-slice-5-crash-recovery.ts)
// and asserts on its printed uninterrupted-vs-resumed outcome/budget pairs and recovery
// narration for each of the four crash windows, covering the slice's UAT and its
// acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: resume a surface after a crash to the same outcome", () => {
  const { stdout, status } = runTsx(["demos/single-surface-slice-5-crash-recovery.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: stopping and resuming before a worktree has been created re-attempts provisioning cleanly", () => {
    const s = section("=== Stopped mid provision ===", "=== Stopped mid worker attempt ===");
    expect(s).toContain(
      "Recovery:      restarted an interrupted provision: cleared what a torn attempt left behind and re-created the worktree",
    );
    expect(s).toContain("Identical:     yes");
  });

  it("AC: stopping and resuming after a worker session started but before its result was recorded retries that session rather than dispatching a duplicate or losing it", () => {
    const s = section("=== Stopped mid worker attempt ===", "=== Stopped mid repair attempt ===");
    expect(s).toContain(
      "Recovery:      recorded a missing terminus for worker attempt 1 (worker-1-1): the interrupted session is retried, not re-dispatched",
    );
    expect(s).toContain(
      "Uninterrupted: escalated — terminus budget exhausted (5/5): hit the turn cap",
    );
    expect(s).toContain(
      "Stop + resume: escalated — terminus budget exhausted (5/5): hit the turn cap",
    );
    expect(s).toContain("Identical:     yes");
  });

  it("AC: stopping and resuming after a repair session started but before its result was recorded behaves the same way for repair sessions, without being mistaken for a worker retry", () => {
    const s = section("=== Stopped mid repair attempt ===", "=== Stopped mid triage ===");
    expect(s).toContain(
      "Recovery:      recorded a missing terminus for repair attempt 1 (gate-maintenance-1-0): the interrupted session is retried, not re-dispatched",
    );
    expect(s).toContain(
      "Uninterrupted: escalated — gateMaintenance budget exhausted (2/2): the repair session ended without a result",
    );
    expect(s).toContain(
      "Stop + resume: escalated — gateMaintenance budget exhausted (2/2): the repair session ended without a result",
    );
    // The repair retry burns the gate-maintenance budget, never the worker's terminus budget.
    expect(s).toContain(
      "correction 0/3, gateError 1/3, gateMaintenance 2/2, terminus 0/5, close 0/3",
    );
    expect(s).toContain("Identical:     yes");
  });

  it("AC: stopping and resuming after a triage decision but before its consequence was carried out completes that consequence on resume rather than repeating the triage decision", () => {
    const s = section("=== Stopped mid triage ===", "\nEvery scenario identical");
    expect(s).toContain(
      "Uninterrupted: escalated — close budget exhausted (3/3): no retry remains for a close_failure setback",
    );
    expect(s).toContain(
      "Stop + resume: escalated — close budget exhausted (3/3): no retry remains for a close_failure setback",
    );
    expect(s).toContain("correction 0/3, gateError 0/3, gateMaintenance 0/2, terminus 0/5, close 3/3");
    expect(s).toContain("Identical:     yes");
  });

  it("UAT: every scenario's uninterrupted and stop-and-resume outcomes and budget counts are identical", () => {
    const identicalLines = [...stdout.matchAll(/^Identical:\s+(.+)$/gm)];
    expect(identicalLines).toHaveLength(4);
    for (const [, verdict] of identicalLines) {
      expect(verdict).toBe("yes");
    }
    expect(stdout).toContain("Every scenario identical across the stop-and-resume: yes");
  });

  it("demo exercises all four crash windows", () => {
    expect(stdout).toContain("=== Stopped mid provision ===");
    expect(stdout).toContain("=== Stopped mid worker attempt ===");
    expect(stdout).toContain("=== Stopped mid repair attempt ===");
    expect(stdout).toContain("=== Stopped mid triage ===");
  });
});
