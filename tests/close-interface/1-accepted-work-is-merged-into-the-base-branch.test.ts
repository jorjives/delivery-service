// Slice 1: Accepted Work Is Merged Into the Base Branch
// Source: docs/superpowers/specs/2026-09-11-close-interface-slices.md
// Recorded: 2026-09-12 against commit 6860f6adedaf1f4b9cbfe576b83ebcfafc900f7d

//
// Drives the slice's own UAT demo script (npx tsx demos/close-interface-slice-1-merge-back.ts)
// and asserts on its printed output, covering the slice's UAT and the acceptance criteria the
// demo can show.
//
// Needs only a system `git`: no network, no API key, nothing to skip.
//
// Three ACs are not observable from this demo and are covered by unit tests instead:
// re-provisioning after a crash not failing on the already-pinned base branch, by
// src/surface.test.ts; an unreadable or unknown closer reference producing an error report, by
// src/resolve-closer.test.ts; and the refusal when the main checkout is not on the base branch,
// by src/merge-back-closer.test.ts. All three need a state the happy-path demo never reaches.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: accepted work is merged into the base branch", () => {
  const { stdout, status } = runTsx(["demos/close-interface-slice-1-merge-back.ts"]);
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a project names the merge-back closer as data, with no closer code written", () => {
    expect(stdout).toContain('closerRef = {"type":"merge-back"}');
  });

  it("AC: the closer reference is pinned in the case file header and resolved from there", () => {
    expect(stdout).toContain('Closer pinned in the case file header: {"type":"merge-back"}');
    expect(stdout).toContain("resolved from the pinned header, not from configuration");
  });

  it("UAT: the demo says plainly that the merge is local and nothing is pushed", () => {
    expect(stdout).toContain("The merge lands on the LOCAL base branch");
    expect(stdout).toContain("Nothing is pushed anywhere");
  });

  it("AC: an accepted surface ends closed with its work on the base branch", () => {
    const s = section("--- 1. The surface ran to", "--- 2.");
    expect(s).toContain("--- 1. The surface ran to CLOSED ---");
    expect(s).toContain("Close report status:                DONE");

    const after = section("--- 2. The repository afterwards ---", "--- 3.");
    expect(after).toContain("feature.txt on main: the feature the task asked for");
  });

  it("AC: the base branch merged into is the one captured when the surface was provisioned", () => {
    expect(section("--- 1.", "--- 2.")).toContain("Base branch pinned at provisioning: main");
  });

  it("AC: the closing report says which branch was updated and to which commit, in plain prose", () => {
    const s = section("Closing report:", "--- 2.");
    expect(s).toMatch(/Fast-forwarded main to [0-9a-f]{7,}/);
    expect(s).toContain("the accepted work is now on main");
    // Plain prose, not a raw git dump: no porcelain or diffstat lines.
    expect(s).not.toMatch(/^\s*(\d+ files? changed|create mode|Updating [0-9a-f]+\.\.)/m);
  });

  it("AC: after a successful merge the worktree is removed and the surface branch deleted", () => {
    const s = section("--- 2. The repository afterwards ---", "--- 3.");
    expect(s).toContain("Surface branches left: (none)");
    expect(s).toContain("Scratch worktree still on disk: false");
  });

  it("AC: a crash after the merge but before cleanup, replayed, reports done without merging twice", () => {
    const s = section("--- 3. Replaying the close", "--- 4.");
    expect(s).toMatch(/Replayed: {5}DONE — Already merged: main is at [0-9a-f]{7,}/);

    const counts = /Commits on main before replay: (\d+), after: (\d+)/.exec(s);
    expect(counts).not.toBeNull();
    expect(counts?.[2]).toBe(counts?.[1]);
  });

  it("AC: the project can ask for the surface branch to be kept", () => {
    const s = section("--- 3. Replaying the close", "--- 4.");
    expect(s).toMatch(/First close: {2}DONE —.*surface\/surface-43 was kept/);
  });

  it("AC: a crash after full cleanup, replayed, reports already closed without erroring on the missing worktree", () => {
    const s = section("--- 4. Replaying the first surface's close");
    expect(s).toContain("Replayed close status: DONE");
    expect(s).toContain("Already closed: branch surface/surface-42 no longer exists");
  });
});
