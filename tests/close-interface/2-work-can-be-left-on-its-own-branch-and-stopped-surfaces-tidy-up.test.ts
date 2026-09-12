// Slice 2: Work Can Be Left on Its Own Branch, and Stopped Surfaces Tidy Up
// Source: docs/superpowers/specs/2026-09-11-close-interface-slices.md
// Recorded: 2026-09-12 against commit 8c507dcc70e87eba8e140fad1b8ed7cd2585d575

//
// Drives the slice's own UAT demo script (npx tsx demos/close-interface-slice-2-branch-and-teardown.ts)
// and asserts on its printed output, covering the slice's UAT and the acceptance criteria the
// demo can show.
//
// Needs only a system `git`: no network, no API key, nothing to skip.
//
// Four ACs are not observable from this demo and are covered by unit tests instead: replaying
// the commit-to-branch close after its worktree is already gone, by
// src/commit-to-branch-closer.test.ts ("reports already closed when a replay finds the worktree
// gone"); an aborted surface's worktree removed and branch kept, by src/closer-support.test.ts
// ("is harmless the second time, leaving the branch untouched") and
// src/commit-to-branch-closer.test.ts ("never deletes the surface branch, on any outcome"); and
// a teardown failure being logged without changing the outcome, by src/surface.test.ts ("logs a
// teardown failure on an escalated surface and leaves the outcome alone"). All three states need
// a crash or failure this happy-path demo never reaches.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: work can be left on its own branch, and stopped surfaces tidy up", () => {
  const { stdout, status } = runTsx(["demos/close-interface-slice-2-branch-and-teardown.ts"]);
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a project names the commit-to-branch closer as data, with no closer code written", () => {
    expect(stdout).toContain('closerRef = {"type":"commit-to-branch"}');
  });

  it("AC: an accepted surface ends closed with its work committed on the surface branch, and the base branch untouched", () => {
    const s = section("--- 1.", "--- 3.");
    expect(s).toContain("The surface ran to: CLOSED");
    expect(s).toContain("Work on surface/surface-51: the feature the task asked for");

    const tips = /main was ([0-9a-f]{7,}), and is now: ([0-9a-f]{7,})/.exec(s);
    expect(tips).not.toBeNull();
    expect(tips?.[2]).toBe(tips?.[1]);
    expect(s).toContain("feature.txt on main: (not there — main is untouched)");
  });

  it("AC: the closing report names the branch holding the work, in plain prose", () => {
    const s = section("Closing report:", "--- 2.");
    expect(s).toContain("committed on surface/surface-51");
    // Plain prose, not a raw git dump.
    expect(s).not.toMatch(/files? changed|create mode|\[surface\//);
  });

  it("AC: the commit-to-branch closer never deletes the surface branch, on an accepted or an escalated outcome", () => {
    const afterAccepted = section("--- 2.", "--- 3.");
    expect(afterAccepted).toContain("Branches now:            main | surface/surface-51");

    const afterEscalated = section("--- 4.", "--- 5.");
    expect(afterEscalated).toContain("Branches now:              main | surface/surface-51 | surface/surface-52");
  });

  it("UAT: after the escalation the second surface's worktree is gone but its branch is still listed", () => {
    const s = section("--- 3.", "--- 5.");
    expect(s).toContain("The surface ran to: ESCALATED");
    expect(s).toContain("Its scratch worktree still on disk: false");
    expect(s).toContain("surface/surface-52");
  });

  it("AC: a surface that ends escalated has its worktree removed and its branch kept", () => {
    const s = section("--- 4.", "--- 5.");
    expect(s).toContain("Its scratch worktree still on disk: false");
    expect(s).toContain("Branches now:              main | surface/surface-51 | surface/surface-52");
    expect(s).toContain("Its half-finished work is still on surface/surface-52: as far as I got");
  });

  it("AC: tearing down the same stopped surface twice succeeds both times and leaves the branch untouched", () => {
    const s = section("--- 5.");
    expect(s).toMatch(/Second teardown: DONE —/);

    const tips = /surface\/surface-52 was ([0-9a-f]{7,}), and is now: ([0-9a-f]{7,})/.exec(s);
    expect(tips).not.toBeNull();
    expect(tips?.[2]).toBe(tips?.[1]);
  });
});
