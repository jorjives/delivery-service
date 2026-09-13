// Slice 4: An Extender Writes Their Own Closer From the Guide
// Source: docs/superpowers/specs/2026-09-11-close-interface-slices.md
// Recorded: 2026-09-13 against commit 1ab0e5d4b65cfd62b191d5ad4e18fd210168c2ea

//
// Drives the slice's own UAT demo script (npx tsx demos/close-interface-slice-4-custom-closer.ts)
// and asserts on its printed output, covering the slice's UAT and the acceptance criteria the
// demo can show.
//
// Needs only a system `git`: no network, no API key, nothing to skip. Triage is the built-in
// deterministic router, so no agent is involved.
//
// Four ACs are not observable from this demo and are covered elsewhere instead: a custom closer
// that rejects or returns a malformed report, and a module that cannot be loaded or lacks a close
// action, by src/custom-closer.test.ts ("turns a rejected promise into an ERROR report",
// "turns a malformed report into an ERROR report", "throws CloserModuleLoadFailure naming the
// module when it cannot be imported", "throws InvalidCloserExport naming the module and the
// missing close method"); custom gates behaving exactly as before the loading mechanism was
// shared, by the unchanged src/custom-gate.test.ts suite; and the guide's own contract (the
// context it hands a closer, the three outcomes, FAIL versus ERROR, replay detection, never
// echoing secrets) plus its worked merge-back example, by tests/writing-a-closer-guide.test.ts.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: an extender writes their own closer from the guide", () => {
  const { stdout, status } = runTsx(["demos/close-interface-slice-4-custom-closer.ts"]);
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a project references its own closer module by path, and an accepted surface closes using it", () => {
    const s1 = section("--- 1.", "--- 2.");
    expect(s1).toContain('closerRef = {"type":"custom","modulePath":"closers/announce.mjs"}');
    expect(s1).toContain("The path is relative to the repository root, never the worktree the agent edits.");

    const s2 = section("--- 2.", "--- 3.");
    expect(s2).toContain("The surface ran to: CLOSED");
  });

  it("UAT: the example closer's own report appears as the surface's closing report", () => {
    const s2 = section("--- 2.", "--- 3.");
    expect(s2).toContain(
      "Closing report: Example closer: would land surface/surface-71 on main and notify the team.",
    );
    expect(s2).toContain(
      "escalated: DONE: Example closer: would keep surface/surface-71 for whoever takes over, and tidy the worktree.",
    );
    expect(s2).toContain("aborted: DONE: Example closer: would tidy the worktree; nothing is landed.");
  });

  it("AC: a custom closer that throws produces an error report naming the cause, never a crash", () => {
    const s3 = section("--- 3.", "--- 4.");
    expect(s3).toContain(
      'Close report: ERROR: Custom closer "closers/broken.mjs" threw during close: the notification service is unreachable',
    );
  });

  it("UAT: the broken closer's failure reaches close-triage rather than crashing the surface", () => {
    const s3 = section("--- 3.", "--- 4.");
    expect(s3).toContain("The surface moved to: TRIAGE (close-triage), and nothing crashed.");
  });

  it("UAT: close-triage retries the broken close, then escalates with the closer's report as evidence", () => {
    const s4 = section("--- 4.");
    expect(s4).toContain("then the surface ran to: ESCALATED");
    expect(s4).toContain(
      "Evidence:\n  Custom closer \"closers/broken.mjs\" threw during close: the notification service is unreachable",
    );
  });
});
