// Slice 3: A Close That Cannot Complete Is Retried, Then Handed to a Person With the Reason
// Source: docs/superpowers/specs/2026-09-11-close-interface-slices.md
// Recorded: 2026-09-13 against commit cf3c053906fa03d8744581f20ccb899ca2cf7aeb

//
// Drives the slice's own UAT demo script (npx tsx demos/close-interface-slice-3-close-failure.ts)
// and asserts on its printed output, covering the slice's UAT and the acceptance criteria the
// demo can show.
//
// Needs only a system `git`: no network, no API key, nothing to skip. Triage is the built-in
// deterministic router, so no agent is involved.
//
// Two ACs are not observable from this demo and are covered by unit tests instead: a close that
// succeeds on retry once the base branch is back in a mergeable state, by src/surface-close.test.ts
// ("ends closed normally when a retry finds the base branch back in a mergeable state"); and the
// closer receiving triage's repair brief on an agent-path retry (versus none from the deterministic
// router), by src/surface-close.test.ts ("hands the closer the brief triage's agent wrote for the
// retry, and none on the first close" / "hands the closer no brief when the deterministic router
// ordered the retry"). The ERROR side of the FAIL/ERROR split (a blocked checkout, rather than a
// genuinely diverged base) is covered by src/merge-back-closer.test.ts ("reports files in the
// checkout that block the fast-forward as an environment error, changing nothing").
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: a close that cannot complete is retried, then handed to a person with the reason", () => {
  const { stdout, status } = runTsx(["demos/close-interface-slice-3-close-failure.ts"]);
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a merge-back close whose base branch has diverged reports a failure naming the base branch's current tip", () => {
    const s = section("--- 1.", "--- 2.");
    const tip = /now at ([0-9a-f]{7,})/.exec(s)?.[1];
    expect(tip).toBeTruthy();

    const attempts = section("--- 2.", "--- 3.");
    expect(attempts).toContain("Close attempt 1: FAIL: main has moved on since this surface started");
    expect(attempts).toContain(`it is now at ${tip}`);
    expect(attempts).toContain("surface/surface-61 does not include");
  });

  it("AC: a failed close is retried by re-running the real closer while close budget remains, each retry safe to repeat", () => {
    const attempts = section("--- 2.", "--- 3.");
    const failLines = attempts.match(/Close attempt \d: FAIL: main has moved on[^\n]*/g) ?? [];
    // The original close attempt plus 3 retries, each an identical refusal
    // (the same real closer, safe to repeat).
    expect(failLines).toHaveLength(4);
    const messages = failLines.map((l) => l.replace(/^Close attempt \d: /, ""));
    expect(new Set(messages).size).toBe(1);
    expect(attempts).toContain("Triage: retry_close (close_failure: retry_close (close 0/3))");
    expect(attempts).toContain("Triage: retry_close (close_failure: retry_close (close 1/3))");
    expect(attempts).toContain("Triage: retry_close (close_failure: retry_close (close 2/3))");
  });

  it("UAT/AC: at the close budget's last slot the surface escalates, and the packet's evidence is the closer's own plain-prose report", () => {
    const attempts = section("--- 2.", "--- 3.");
    expect(attempts).toContain("Close attempt 4: FAIL: main has moved on");
    expect(attempts).toContain("Triage: escalate (close budget exhausted (3/3): no retry remains for a close_failure setback)");

    const packet = section("--- 3.", "--- 4.");
    expect(packet).toContain("The surface ran to: ESCALATED");
    expect(packet).toContain("No close retry budget remains (3/3 used)");
    expect(packet).toMatch(/Decide whether to resolve what the closer reports below.*or choose a different close\./s);
    expect(packet).toContain(
      "Evidence:\n  main has moved on since this surface started: it is now at",
    );
    expect(packet).toContain("Bring surface/surface-61 up to date with main");
  });

  it("AC: the accepted work is never returned to a worker, only retried or escalated", () => {
    const s = section("--- 2.", "--- 3.");
    expect(s).toContain("Worker sessions dispatched in total: 1 (the accepted work was never sent back).");
  });

  it("UAT: the repository history shows main unchanged by the harness and the surface branch still present", () => {
    const s = section("--- 4.");
    expect(s).toContain("main is still at");
    expect(s).toContain("the harness added nothing to it.");
    expect(s).toContain("Branches now: main | surface/surface-61");
    expect(s).toMatch(/The accepted work, still on surface\/surface-61: [0-9a-f]{7,} Accepted work from surface\/surface-61/);
  });
});
