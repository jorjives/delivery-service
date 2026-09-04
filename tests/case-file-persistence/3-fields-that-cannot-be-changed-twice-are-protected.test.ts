// Slice 3: Fields That Cannot Be Changed Twice Are Protected
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
// Recorded: 2026-09-04 against commit 60569de5ff7c043ed7c077136285a9f6af714e36
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-3-immutability.ts)
// and asserts on its printed output.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: fields that cannot be changed twice are protected", () => {
  const { stdout, status } = runTsx(["demos/slice-3-immutability.ts"]);

  it("exits cleanly and prints the final verified summary", () => {
    expect(status).toBe(0);
    expect(stdout).toContain(
      "Immutability verified: both fields set exactly once, both second " +
        "attempts rejected with a named error.",
    );
  });

  it("AC: setting the baseline succeeds exactly once; a second attempt is rejected", () => {
    expect(stdout).toContain(
      "Baseline attempt 1: succeeded — baseline set to {assertion1: pass}",
    );
    expect(stdout).toContain("Baseline attempt 2: rejected — ImmutabilityViolation");
    expect(stdout).toContain("Cannot overwrite baseline in");
  });

  it("AC: setting the outcome succeeds exactly once; a second attempt is rejected", () => {
    expect(stdout).toContain(
      "Outcome attempt 1:  succeeded — outcome set to closed/gate",
    );
    expect(stdout).toContain("Outcome attempt 2:  rejected — ImmutabilityViolation");
    expect(stdout).toContain("Cannot overwrite outcome in");
  });

  it("AC: the header is unchanged after cursor updates and history appends", () => {
    expect(stdout).toContain("Header immutability: preserved after cursor updates and history appends");
  });
});
