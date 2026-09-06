// Slice 4: Resolve a Pinned Gate Reference into a Running Gate
// Source: docs/superpowers/specs/2026-09-05-gate-interface-slices.md
// Recorded: 2026-09-06 against commit 6a303ed

//
// Drives the slice's own UAT demo script (npx tsx demos/gate-interface-slice-4-resolution.ts)
// and asserts on its printed report for each scenario, covering the slice's UAT and all four
// acceptance criteria.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: hand the resolver a GateRef and get back a gate ready to call", () => {
  const { stdout, status } = runTsx(["demos/gate-interface-slice-4-resolution.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a command-type gate reference resolves to a working command gate configured with its command and parse mode", () => {
    const s = section("=== command ref (tap) — resolves and runs ===", "=== custom ref — resolves and runs ===");
    expect(s).toContain("Status: PASS");
    expect(s).toContain("[PASS] 1 - alpha — ok 1 - alpha");
    expect(s).toContain("[FAIL] 2 - beta — not ok 2 - beta");
  });

  it("AC: a custom-type gate reference resolves to a working custom gate loaded from its module path", () => {
    const s = section("=== custom ref — resolves and runs ===", "=== custom ref with a bad module path");
    expect(s).toContain("Status: PASS");
    expect(s).toContain("[PASS] licence:present — checked");
  });

  it("AC: resolution failures (bad module path, unsupported parse mode) produce an error-report shape, not a crash", () => {
    const badPath = section("=== custom ref with a bad module path", "=== command ref with an unsupported parse mode");
    expect(badPath).toContain("Status: ERROR");
    expect(badPath).toContain("Detail:");
    expect(badPath).toContain('cannot load custom gate module "./no-such-gate.mjs"');

    const badMode = section("=== command ref with an unsupported parse mode", "All four references were handled");
    expect(badMode).toContain("Status: ERROR");
    expect(badMode).toContain("Detail:");
    expect(badMode).toContain("Cannot resolve gate reference:");
  });

  it("AC: a gate reference naming an unsupported parse mode is rejected with a diagnostic detail, not a crash", () => {
    const s = section("=== command ref with an unsupported parse mode");
    expect(s).toContain("Status: ERROR");
    expect(s).toContain('"path": [\n      "parseMode"\n    ]');
  });

  it("demo confirms all four references were handled without throwing", () => {
    expect(stdout).toContain("All four references were handled without throwing.");
  });
});
