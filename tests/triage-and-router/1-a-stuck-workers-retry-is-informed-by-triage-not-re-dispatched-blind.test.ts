// Slice 1: A Stuck Worker's Retry Is Informed by Triage, Not Re-dispatched Blind
// Source: docs/superpowers/specs/2026-09-10-triage-and-router-slices.md
// Recorded: 2026-09-11 against commit 4477d172cfcbcfe97db1a4b9f3bffd96f8ff2139

//
// Drives the slice's own UAT demo script (npx tsx demos/triage-slice-1-informed-retry.ts)
// and asserts on its printed output, covering the slice's UAT and its acceptance criteria.
//
// Requires `claude-mock` (a sibling project, not vendored here) on PATH. When it is absent
// the demo prints an explanatory message and exits non-zero rather than crashing; this test
// asserts on that message in that case instead of failing opaquely.
//
// Four ACs are not observable from this demo's two scenarios (a stuck-worker retry and a plain
// gate failure) and are covered elsewhere instead: authority escalation (both scenarios trigger
// an exhaustion-class escalation, not an authority one) and read-only tool enforcement (per the
// slice's own documented limit, `claude-mock` models no tool permissions) by src/triage.test.ts's
// authority tests; prompt determinism ("assembling triage's prompt twice ... produces the
// identical request") by src/prompt-assembly.test.ts; and crash-mid-triage resume by
// tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: a stuck worker's retry is informed by triage, not re-dispatched blind", () => {
  const { stdout, status } = runTsx(["demos/triage-slice-1-informed-retry.ts"]);

  const mockMissing = stdout.includes("claude-mock is not on PATH");
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion, or explains plainly that claude-mock is required", () => {
    if (mockMissing) {
      expect(status).not.toBe(0);
      expect(stdout).toContain("claude-mock is not on PATH");
      return;
    }
    expect(status).toBe(0);
  });

  it.skipIf(mockMissing)(
    "AC: a worker that escalates as stuck with correction budget left is triaged by the triage agent, not by the lookup table alone",
    () => {
      const s = section("1. The stuck worker's setback", "2. What triage was asked");
      expect(s).toContain("Worker attempt 1 ended: escalate (exhaustion)");
      const verdictSection = section("3. Triage's verdict", "4. The second worker's request");
      expect(verdictSection).toContain("Verdict:   reroute");
    },
  );

  it.skipIf(mockMissing)(
    "AC: when triage decides to retry, the next worker's prompt contains triage's brief (problem, dead ends, scope, references, and a diagnosis marked as a hypothesis) alongside the verbatim gate evidence, as two visibly separate sections",
    () => {
      const s = section("4. The second worker's request", "5. A plain gate failure");
      expect(s).toContain("## Brief");
      expect(s).toContain("Problem:");
      expect(s).toContain("Scope:");
      expect(s).toContain("References:");
      expect(s).toContain("Diagnosis (a hypothesis to test, not an established fact):");
      expect(s).toContain("## Gate evidence");
      expect(s.indexOf("## Brief")).toBeLessThan(s.indexOf("## Gate evidence"));
    },
  );

  it.skipIf(mockMissing)(
    "AC: the retried worker's prompt contains the previous round's dead ends, not merely an empty brief",
    () => {
      const s = section("4. The second worker's request", "5. A plain gate failure");
      expect(s).toContain("Dead ends: Attempt 1 searched the route handlers for the string and gave up");
    },
  );

  it.skipIf(mockMissing)(
    "AC: a plain gate failure with more than one correction slot left is routed with no agent call at all, exactly as before, and its retry carries no brief",
    () => {
      const s = section("5. A plain gate failure", "6. What this shows");
      expect(s).toContain("Triage agent calls:   0");
      expect(s).toContain("No triage agent was called: the deterministic router routed it.");
      expect(s).toContain("Brief stored:         no");
      expect(s).toContain("Retry dispatch brief: none");
    },
  );

  it.skipIf(mockMissing)(
    "AC: triage's own prompt shows the setback, the remaining budgets, and the rationales of earlier triage rounds, or a fixed sentence saying there were none",
    () => {
      const s = section("2. What triage was asked", "3. Triage's verdict");
      expect(s).toContain("## Setback");
      expect(s).toContain("Trigger: worker_escalate (exhaustion)");
      expect(s).toContain("Remaining budgets (used/max):");
      expect(s).toContain("No prior triage rounds on this surface.");
    },
  );

  it.skip(
    "AC: a worker that escalates for lack of authority is passed straight to escalation; triage is " +
      "never asked — not exercised by this demo (both scenarios trigger an exhaustion-class escalation); " +
      "see src/triage.test.ts's authority tests",
    () => {},
  );

  it.skip(
    "AC: triage is given read-only tools and cannot be configured into editing the worktree — " +
      "not demonstrable via claude-mock (it does not enforce a role's tool list); see src/triage.test.ts",
    () => {},
  );

  it.skip(
    "AC: assembling triage's prompt twice from the same case file produces the identical request; " +
      "worker and gate-maintenance prompts are unchanged from before this item — not observable from " +
      "this demo's printed output; see src/prompt-assembly.test.ts",
    () => {},
  );

  it.skip(
    "AC: a crash mid-triage resumes to the same triage round and produces the same request — not " +
      "exercised by this demo; see tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts",
    () => {},
  );
});
