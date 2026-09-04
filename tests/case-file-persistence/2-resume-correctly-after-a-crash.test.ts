// Slice 2: Resume Correctly After a Crash
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-2-crash-recovery.ts)
// and asserts on its printed output for each simulated crash scenario.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: resume correctly after a crash", () => {
  const { stdout, status } = runTsx(["demos/slice-2-crash-recovery.ts"]);

  it("exits cleanly and prints the final verified summary", () => {
    expect(status).toBe(0);
    expect(stdout).toContain(
      "Crash recovery verified: every simulated crash point recovered to the " +
        "last fully-written state, with the resume action matching the last " +
        "complete event recorded.",
    );
  });

  it("AC: an orphan .tmp file left behind by an interrupted write does not corrupt the read", () => {
    expect(stdout).toContain("Scenario 1: orphan .tmp file from a crashed write");
    expect(stdout).toContain("Surface ID: demo-surface-2");
    expect(stdout).toContain("State:      PROVISIONING");
    expect(stdout).toContain(
      "Recovered:  valid case.json read, orphan .tmp ignored",
    );
  });

  it("AC: a truncated final log line from an interrupted append is ignored, prior history kept", () => {
    expect(stdout).toContain("Scenario 2: truncated log line from a crashed append");
    expect(stdout).toContain("History:       2 entries (complete only)");
    expect(stdout).toContain("Last entry:    terminus");
    expect(stdout).toContain(
      "Recovered:     truncated line ignored, prior history intact",
    );
  });

  it("AC: rebuilding from a stale cursor derives the cursor the log implies", () => {
    expect(stdout).toContain("Scenario 3: stale cursor rebuild");
    expect(stdout).toContain("Cursor before rebuild (stale): PROVISIONING");
    expect(stdout).toContain("Cursor after rebuild:          GATING");
  });

  it("AC: the resume action for each recovery matches the last complete event recorded", () => {
    // Scenario 2's last complete entry is a completed terminus, which should
    // resume into gating.
    expect(stdout).toContain("Resume action: gate");
    // Scenario 3's rebuilt cursor agrees with the same resume action.
    expect(stdout).toContain("Resume action:                 gate");
  });

  it("AC: rebuilding when case.json is missing fails with a clear, named error", () => {
    expect(stdout).toContain("Scenario 4: missing case.json");
    expect(stdout).toContain("Error name: FileNotFound");
    expect(stdout).toContain(
      "Recovered:  clear, named error instead of a crash",
    );
  });
});
