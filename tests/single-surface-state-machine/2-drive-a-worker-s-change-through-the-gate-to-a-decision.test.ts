// Slice 2: Drive a Worker's Change Through the Gate to a Decision
// Source: docs/superpowers/specs/2026-09-08-single-surface-state-machine-slices.md
// Recorded: 2026-09-08 against commit be3a906

//
// Drives the slice's own UAT demo script (npx tsx demos/single-surface-slice-2-happy-path.ts)
// and asserts on its printed state sequence, covering the slice's UAT.
//
// The UAT script only exercises the happy path (a clean worker change through to
// CLOSED); the remaining acceptance criteria describe edges the happy path never
// takes and are already covered directly against the driver in src/surface.test.ts:
//   - "a worker session that ends without a valid result is retried once ... and
//     exhaustion escalates" — describe("the INCOMPLETE_TERMINUS edge")
//   - "a worker session that reports ... a genuine authority limit ends the surface
//     in an escalated state directly" — "ends the surface in ESCALATED when the
//     worker reports an authority limit" in describe("the AGENT_ACTIVE edge")
//   - "running the same happy-path scenario twice produces the same sequence of
//     states" — "produces the same sequence of states every time, given the same
//     script" in describe("run")

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: drive a worker's change through the gate to a decision", () => {
  const { stdout, status } = runTsx(["demos/single-surface-slice-2-happy-path.ts"]);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("UAT + AC: dispatching a scripted worker session that completes cleanly runs the gate against the recorded baseline", () => {
    expect(stdout).toContain("State: AGENT_ACTIVE");
    expect(stdout).toContain("State: GATING");
    expect(stdout).toContain("Baseline captured:  PASS");
  });

  it("UAT + AC: a gate result with no new failures moves the surface to closing, and an accepting closer ends the surface closed", () => {
    expect(stdout).toContain("State: CLOSING");
    expect(stdout).toContain("State: CLOSED");
    expect(stdout).toContain("Outcome:            closed");
  });

  it("UAT: every state from provisioning through to closed is shown, with no manual intervention between them", () => {
    const states = [...stdout.matchAll(/^State: (\S+)/gm)].map((m) => m[1]);
    expect(states).toEqual([
      "PROVISIONING",
      "PRE_GATING",
      "AGENT_ACTIVE",
      "GATING",
      "CLOSING",
      "CLOSED",
    ]);
  });

  it("UAT: the worker's change made it into the worktree", () => {
    expect(stdout).toContain("Worktree created:   true");
    expect(stdout).toContain("Worker's change:    true");
  });
});
