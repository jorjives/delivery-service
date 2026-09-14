// Slice 2: Every Escalation Hands a Human a Decision, Not Internal State
// Source: docs/superpowers/specs/2026-09-10-triage-and-router-slices.md
// Recorded: 2026-09-11 against commit 43887bddec5fc730efe38226147703402a5a7248

//
// Drives the slice's own UAT demo script (npx tsx demos/triage-slice-2-escalation-packets.ts)
// and asserts on its printed output, covering the slice's UAT and its acceptance criteria.
//
// Runs against claude-mock, vendored in vendor/claude-mock and installed by `npm install`, so
// this test never skips.
//
// "A failed close can end only in a close retry, an escalation, or an abort" is not separately
// observable from this demo's printed output beyond the naming already covered by the section 5
// assertion below (the allowed set is named in the escalation's why-now text); the stronger,
// exhaustive claim is covered by src/surface.test.ts's close-failure routing tests.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: every escalation hands a human a decision, not internal state", () => {
  const { stdout, status } = runTsx(["demos/triage-slice-2-escalation-packets.ts"]);

  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  const allSections = () => [
    section("1. The triage agent escalates", "2. The worker hits an authority limit"),
    section("2. The worker hits an authority limit", "3. The correction budget runs out"),
    section("3. The correction budget runs out", "4. Triage replies with something unusable"),
    section("4. Triage replies with something unusable", '5. A failed close answered with "retry the worker"'),
    section('5. A failed close answered with "retry the worker"', "6. What this shows"),
  ];

  it(
    "AC: an escalation decided by the triage agent stores the agent's packet with all five parts",
    () => {
      const s = allSections()[0];
      expect(s).toContain("Surface finished: ESCALATED; triage agent calls: 1; packet stored at: escalation");
      expect(s).toContain("Decision:");
      expect(s).toContain("Evidence:");
      expect(s).toContain("Already tried:");
      expect(s).toContain("Why now:");
      expect(s).toContain("Sessions to consult:");
    },
  );

  it(
    "AC: an authority escalation, a budget-exhaustion escalation, and an unusable-triage-output escalation each store a packet with all five parts",
    () => {
      for (const s of [allSections()[1], allSections()[2], allSections()[3]]) {
        expect(s).toContain("Decision:");
        expect(s).toContain("Evidence:");
        expect(s).toContain("Already tried:");
        expect(s).toContain("Why now:");
        expect(s).toContain("Sessions to consult:");
      }
    },
  );

  it(
    "AC: each packet's decision reads as a question for a human, and differs by cause: authority, no budget left, and triage failure read differently",
    () => {
      const [, authority, budget, unusable] = allSections();
      const decisionOf = (s = "") => s.slice(s.indexOf("Decision:"), s.indexOf("Evidence:"));
      const authorityDecision = decisionOf(authority);
      const budgetDecision = decisionOf(budget);
      const unusableDecision = decisionOf(unusable);
      expect(authorityDecision).toContain("Decide whether to grant that authority or take the action yourself.");
      expect(budgetDecision).toContain("Decide whether to continue manually, amend the task, or abandon it.");
      expect(unusableDecision).toContain("Decide how to proceed from the evidence below.");
      expect(authorityDecision).not.toBe(budgetDecision);
      expect(authorityDecision).not.toBe(unusableDecision);
      expect(budgetDecision).not.toBe(unusableDecision);
    },
  );

  it(
    "AC: a packet produced because a budget ran out says plainly that no budget remains and shows it as used out of maximum",
    () => {
      const s = allSections()[2];
      expect(s).toContain("No correction budget remains (1/1 used).");
    },
  );

  it(
    "AC: triage output that is missing, malformed, or of the wrong shape escalates with a plain-English reason, never defaults to a retry, and never shows a raw error",
    () => {
      const s = allSections()[3];
      expect(s).toContain("Triage could not reach a verdict. Decide how to proceed from the evidence below.");
      expect(s).toContain("triage did not produce a usable verdict");
      expect(s).not.toMatch(/at \S+ \(.*:\d+:\d+\)/); // no stack-trace frame
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("[object Object]");
    },
  );

  it(
    'AC: a triage agent that answers "retry the worker" to a failed close is escalated instead, with a reason naming the verdict and the verdicts that were allowed',
    () => {
      const s = allSections()[4];
      expect(s).toContain(
        "triage answered reroute, which is not allowed after a close failure (allowed: retry_close, escalate, abort)",
      );
    },
  );

  it("AC: no packet contains a stack trace or a bare internal code presented as the message", () => {
    const packets = allSections().join("\n");
    expect(packets).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
    expect(packets).not.toMatch(/^\s*Error:/m);
    expect(packets).not.toContain("[object Object]");
  });

});
