// Slice 1: Provision a Surface and Reach Its First Decision Point
// Source: docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md
// Recorded: 2026-09-08 against commit 787eff4

//
// Drives the slice's own UAT demo script (npx tsx demos/single-surface-slice-1-provisioning.ts)
// and asserts on its printed state sequence for each scenario, covering the slice's UAT and
// its acceptance criteria.
//
// AC "a repair attempt that fails outright ... ends the surface in an escalated state" has two
// sub-cases: the repair session reporting escalate directly, and repeated non-fixing repairs
// draining the budget. The demo only scripts the budget-exhaustion sub-case (an agent that
// claims success but never actually fixes the gate); the direct-escalate sub-case is unit-tested
// in src/surface.test.ts ("escalates when a repair session escalates outright").

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: provision a surface and reach its first decision point", () => {
  const { stdout, status } = runTsx(["demos/single-surface-slice-1-provisioning.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a fresh case file directory with no worktree creates a real git worktree on a branch derived from the surface's id, off the default branch", () => {
    // The "unusable worktree path" scenario's failure message surfaces the exact
    // git command attempted, proving the branch name is derived from the surface id
    // ("demo-unusable") and based off the repository's default branch ("main").
    const s = section("=== Unusable worktree path ===");
    expect(s).toContain("git worktree add");
    expect(s).toContain("-b surface/demo-unusable main");
  });

  it("UAT + AC: once the worktree exists, a baseline gate report is captured automatically with no further input", () => {
    const s = section("=== Healthy gate ===", "=== Broken gate, repaired ===");
    expect(s).toContain("Worktree created: true");
    expect(s).toContain("Baseline captured: true");
  });

  it("UAT + AC: a healthy baseline lands the surface in the state ready to dispatch a worker, with no repair", () => {
    const s = section("=== Healthy gate ===", "=== Broken gate, repaired ===");
    expect(s).toContain("State: PROVISIONING (fresh case file, no worktree)");
    expect(s).toContain("State: PRE_GATING");
    expect(s).toContain("State: AGENT_ACTIVE");
    expect(s).toContain("Repair sessions dispatched: 0");
    expect(s).toContain("Outcome: none yet — ready for a worker");
  });

  it("UAT + AC: a baseline error dispatches a repair, and a repair that succeeds re-baselines and reaches ready-for-a-worker", () => {
    const s = section("=== Broken gate, repaired ===", "=== Broken gate, never repaired ===");
    expect(s).toContain("State: GATE_MAINTENANCE");
    expect(s).toContain("State: AGENT_ACTIVE");
    expect(s).toContain("Baseline captured: true");
    expect(s).toContain("Repair sessions dispatched: 1");
    expect(s).toContain("Outcome: none yet — ready for a worker");
  });

  it("UAT + AC: a repair that never fixes the gate exhausts the repair budget and escalates, instead of looping forever", () => {
    const s = section("=== Broken gate, never repaired ===", "=== Unusable worktree path ===");
    const gateMaintenanceStates = s.match(/State: GATE_MAINTENANCE/g) ?? [];
    expect(gateMaintenanceStates).toHaveLength(2);
    expect(s).toContain("State: ESCALATED");
    expect(s).toContain("Repair sessions dispatched: 2");
    expect(s).toContain("Outcome: escalated — gateMaintenance budget exhausted (2/2)");
  });

  it("AC: a worktree creation failure ends the surface in an aborted state with a reason, rather than crashing the driver", () => {
    const s = section("=== Unusable worktree path ===");
    expect(s).toContain("State: PROVISIONING (fresh case file, no worktree)");
    expect(s).toContain("State: ABORTED");
    expect(s).toContain("Worktree created: false");
    expect(s).toMatch(/Outcome: aborted — .+/);
  });

  it("demo exercises all four provisioning scenarios", () => {
    expect(stdout).toContain("=== Healthy gate ===");
    expect(stdout).toContain("=== Broken gate, repaired ===");
    expect(stdout).toContain("=== Broken gate, never repaired ===");
    expect(stdout).toContain("=== Unusable worktree path ===");
  });
});
