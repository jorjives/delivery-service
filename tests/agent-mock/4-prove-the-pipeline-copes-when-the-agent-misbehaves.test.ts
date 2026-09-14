// Slice 4: Prove the Pipeline Copes When the Agent Misbehaves
// Source: docs/superpowers/specs/2026-09-13-agent-mock-slices.md
// Recorded: 2026-09-14 against commit 3fcd776

//
// Drives the slice's UAT (npm run demo:mock-slice-4) and asserts on its printed
// result: six sections, each running one surface against a scripted worker that
// misbehaves in a different way, then reading what the surface recorded and how
// it finished.

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: prove the pipeline copes when the agent misbehaves", () => {
  const { stdout, status } = runTsx(["demos/agent-mock-slice-4-misbehaving-agent.ts"]);

  it("runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a prompt matching no expectation ends the invocation as incomplete, with the existing plain-English rationale", () => {
    const section = sectionOf(stdout, "--- 1. No expectation matches the prompt", "--- 2.");
    expect(section).toContain("the session ended in an error before it reported a result");
    expect(section).toContain("Surface finished: ESCALATED");
    expect(section).toContain("Prompts the journal shows matched no expectation: 2");
  });

  it("AC: a reply with no structured envelope ends the invocation as incomplete", () => {
    const section = sectionOf(stdout, "--- 2. A reply with no envelope", "--- 3.");
    expect(section).toContain("the session ended without reporting a result");
    expect(section).toContain("Surface finished: ESCALATED");
  });

  it("AC: a reply whose envelope has the wrong shape for its role ends the invocation as incomplete, stating it replied in the wrong shape", () => {
    const section = sectionOf(stdout, "--- 3. An envelope in the wrong shape", "--- 4.");
    expect(section).toContain("the session replied with something that is not a valid result for this role");
    expect(section).toContain("Surface finished: ESCALATED");
  });

  it("SHOULD: writing an envelope through the authoring helper rejects a malformed envelope when the script is written, while a deliberately malformed script can still be written directly", () => {
    const section = sectionOf(stdout, "--- 3. An envelope in the wrong shape", "--- 4.");
    // The hand-written malformed json above proves the direct path still works;
    // this asserts the authoring helper catches the same slip at write time.
    expect(section).toContain("The scripted envelope is not a valid worker result:");
    expect(section).toContain("rationale: Too small: expected string to have >=1 characters");
  });

  it("AC: a scripted failure ends the invocation as incomplete", () => {
    const section = sectionOf(stdout, "--- 4. A scripted failure", "--- 5.");
    expect(section).toContain("the session ended in an error before it reported a result");
    expect(section).toContain("Surface finished: ESCALATED");
  });

  it("AC: a worker scripted to escalate with an authority reason brings the surface to escalation", () => {
    const section = sectionOf(stdout, "--- 5. The worker escalates for authority", "--- 6.");
    expect(section).toContain("worker attempt 1 (worker-1-0): escalate: deploying needs a production credential this worker was not given");
    expect(section).toContain("Surface finished: ESCALATED");
    expect(section).toContain("Worker sessions run: 1");
  });

  it("AC: a worker whose scripted change fails the real gate is routed back for another attempt within its budget", () => {
    const section = sectionOf(stdout, "--- 6. The worker's change fails the gate");
    expect(section).toContain("gate on attempt 1: FAIL");
    expect(section).toContain("triage after attempt 1: reroute");
    expect(section).toContain("worker attempt 2 (worker-2-0): completed: restored the beta check and wrote greeting.txt");
    expect(section).toContain("gate on attempt 2: PASS");
    expect(section).toContain("Surface finished: CLOSED");
    expect(section).toContain("report.tap on main:   passing: the rejected change never landed");
    expect(section).toContain("greeting.txt on main: hello");
  });
});
