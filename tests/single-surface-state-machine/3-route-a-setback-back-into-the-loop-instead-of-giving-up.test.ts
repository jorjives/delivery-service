// Slice 3: Route a Setback Back Into the Loop Instead of Giving Up
// Source: docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md
// Recorded: 2026-09-08 against commit 47da177

//
// Drives the slice's own UAT demo script (npx tsx demos/single-surface-slice-3-setbacks.ts)
// and asserts on its printed state sequence, router verdicts, and outcome for each of the
// four scripted scenarios, covering the slice's UAT and its acceptance criteria.
//
// AC "each of these routes eventually reaches a closed, escalated, or aborted outcome —
// none of them can loop without ever reaching a terminal state, given the scripted
// double's caps" is a budget-boundedness property exercised directly against the caps in
// src/surface.test.ts (e.g. "escalates a gate failure once the correction budget is at
// cap" in describe("the TRIAGE edge")); the demo's own scenarios all resolve, which this
// file also asserts.
//
// AC "a verdict that ends the surface outright ... leaves the surface in the matching
// terminal state with no further dispatch" is unit-tested directly in src/surface.test.ts:
// "ends the surface with no further dispatch when the router escalates" and "ends the
// surface as ABORTED when the port returns an abort verdict", both in describe("TRIAGE").

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: route a setback back into the loop instead of giving up", () => {
  const { stdout, status } = runTsx(["demos/single-surface-slice-3-setbacks.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a gate failure caused by the worker's own change routes to another worker attempt, using the next attempt number", () => {
    const s = section("=== Gate failure, fixed on the retried attempt ===", "=== Gate error, repaired then re-checked ===");
    expect(s).toContain("States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> GATING -> TRIAGE -> AGENT_ACTIVE -> GATING -> CLOSING -> CLOSED");
    expect(s).toContain("Router:   gate_fail -> reroute");
    expect(s).toContain("Attempts: 2 dispatched");
    expect(s).toContain("Outcome:  closed");
  });

  it("AC: a gate that errors post-worker routes to a repair, and a successful repair re-checks the same baseline rather than re-baselining", () => {
    const s = section("=== Gate error, repaired then re-checked ===", "=== Close rejected once, accepted on retry ===");
    expect(s).toContain("States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> GATING -> TRIAGE -> GATE_MAINTENANCE -> GATE_MAINTENANCE -> CLOSING -> CLOSED");
    expect(s).toContain("Router:   gate_error -> fix_the_gate");
    // Only one worker attempt was dispatched: the repair goes through GATE_MAINTENANCE
    // twice (dispatch, then a re-check), never re-running or re-baselining the worker's attempt.
    expect(s).toContain("Attempts: 2 dispatched");
    expect(s).toContain("Outcome:  closed");
  });

  it("AC: a closer that reports the surface isn't ready routes back to another close attempt", () => {
    const s = section("=== Close rejected once, accepted on retry ===", "=== Stuck worker, succeeds on the retried attempt ===");
    expect(s).toContain("States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> GATING -> CLOSING -> TRIAGE -> CLOSING -> CLOSED");
    expect(s).toContain("Router:   close_failure -> retry_close");
    expect(s).toContain("Outcome:  closed — closed on the retried attempt");
  });

  it("AC: a worker's exhaustion-class 'stuck, but retry might help' signal is retried by the router as another worker attempt", () => {
    const s = section("=== Stuck worker, succeeds on the retried attempt ===");
    expect(s).toContain("States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> TRIAGE -> AGENT_ACTIVE -> GATING -> CLOSING -> CLOSED");
    expect(s).toContain("Router:   worker_escalate -> reroute");
    expect(s).toContain("Attempts: 2 dispatched");
    expect(s).toContain("Outcome:  closed");
  });

  it("UAT: every scenario reaches a resolved outcome, none looping or ending early", () => {
    const outcomes = [...stdout.matchAll(/^Outcome:\s+(\S+)/gm)].map((m) => m[1]);
    expect(outcomes).toEqual(["closed", "closed", "closed", "closed"]);
  });

  it("demo exercises all four setback scenarios", () => {
    expect(stdout).toContain("=== Gate failure, fixed on the retried attempt ===");
    expect(stdout).toContain("=== Gate error, repaired then re-checked ===");
    expect(stdout).toContain("=== Close rejected once, accepted on retry ===");
    expect(stdout).toContain("=== Stuck worker, succeeds on the retried attempt ===");
  });
});
