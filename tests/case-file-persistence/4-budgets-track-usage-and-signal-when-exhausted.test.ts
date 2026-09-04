// Slice 4: Budgets Track Usage and Signal When Exhausted
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-4-budget.ts)
// and asserts on its printed output.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: budgets track usage and signal when exhausted", () => {
  const { stdout, status } = runTsx(["demos/slice-4-budget.ts"]);

  it("exits cleanly and prints the final verified summary", () => {
    expect(status).toBe(0);
    expect(stdout).toContain(
      "Budget tracking verified: each population increments independently,",
    );
    expect(stdout).toContain(
      "and exhausted flag is set exactly when used >= max.",
    );
  });

  it("AC: incrementing a budget's usage raises its counter by one and persists the new value", () => {
    expect(stdout).toContain("correction      |    1 |   3 | false");
    expect(stdout).toContain("correction      |    2 |   3 | false");
    expect(stdout).toContain("correction      |    3 |   3 | true");
  });

  it("AC: each of the five budget populations tracks its usage independently of the others", () => {
    expect(stdout).toContain("Summary: populations exhausted at:");
    expect(stdout).toContain("correction      at 3 ✓");
    expect(stdout).toContain("gateError       at 3 ✓");
    expect(stdout).toContain("gateMaintenance at 2 ✓");
    expect(stdout).toContain("terminus        at 5 ✓");
    expect(stdout).toContain("close           at 3 ✓");
  });

  it("AC: the result of an increment reports whether the cap has now been reached", () => {
    expect(stdout).toContain("gateMaintenance |    1 |   2 | false");
    expect(stdout).toContain("gateMaintenance |    2 |   2 | true");
  });

  it("AC: incrementing past the cap is not blocked and still reports the cap as reached", () => {
    expect(stdout).toContain("gateMaintenance |    3 |   2 | true");
    expect(stdout).toContain("terminus        |    6 |   5 | true");
  });
});
