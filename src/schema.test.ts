import { describe, it, expect } from "vitest";
import { GateRef, CloserRef, CloseReport, HistoryEntry, RunEntry } from "./schema.js";

describe("GateRef", () => {
  it("accepts a command ref with a supported parse mode", () => {
    const parsed = GateRef.safeParse({
      type: "command",
      command: "npm test",
      parseMode: "tap",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a custom ref with an optional export name", () => {
    const parsed = GateRef.safeParse({
      type: "custom",
      modulePath: "./gates/my-gate.mjs",
      exportName: "myGate",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a command ref naming an unsupported parse mode", () => {
    const parsed = GateRef.safeParse({
      type: "command",
      command: "npm test",
      parseMode: "xunit",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a ref with an unknown type", () => {
    const parsed = GateRef.safeParse({ type: "webhook", url: "http://x" });
    expect(parsed.success).toBe(false);
  });
});

describe("CloserRef", () => {
  it("accepts the merge-back closer named with no parameters", () => {
    expect(CloserRef.parse({ type: "merge-back" })).toEqual({ type: "merge-back" });
  });

  it("accepts an explicit request to keep the surface branch", () => {
    const parsed = CloserRef.parse({ type: "merge-back", deleteBranch: false });
    if (parsed.type === "merge-back") {
      expect(parsed.deleteBranch).toBe(false);
    } else {
      throw new Error("Expected merge-back variant");
    }
  });

  it("rejects a closer type it does not know", () => {
    expect(CloserRef.safeParse({ type: "teleport" }).success).toBe(false);
  });

  it("accepts the commit-to-branch closer named with no parameters", () => {
    expect(CloserRef.safeParse({ type: "commit-to-branch" }).success).toBe(true);
  });

  it("accepts a custom closer referenced by module path, with or without an export name", () => {
    expect(CloserRef.parse({ type: "custom", modulePath: "closers/notify.mjs" })).toEqual({
      type: "custom",
      modulePath: "closers/notify.mjs",
    });
    expect(CloserRef.safeParse({ type: "custom", modulePath: "closers/notify.mjs", exportName: "slack" }).success).toBe(true);
  });

  it("rejects a custom closer with no module path", () => {
    expect(CloserRef.safeParse({ type: "custom" }).success).toBe(false);
  });

  it("accepts the open-pr closer named with no parameters", () => {
    expect(CloserRef.parse({ type: "open-pr" })).toEqual({ type: "open-pr" });
  });
});

describe("CloseReport", () => {
  it("accepts each of the three statuses with a detail", () => {
    for (const status of ["DONE", "FAIL", "ERROR"]) {
      expect(CloseReport.safeParse({ status, detail: "what happened" }).success).toBe(true);
    }
  });

  it("rejects an unknown status, a missing detail, and a non-object", () => {
    expect(CloseReport.safeParse({ status: "OK", detail: "x" }).success).toBe(false);
    expect(CloseReport.safeParse({ status: "DONE" }).success).toBe(false);
    expect(CloseReport.safeParse(undefined).success).toBe(false);
  });
});

describe("the time a step was recorded", () => {
  const AT = "2026-10-01T02:20:00.000Z";
  const steps: HistoryEntry[] = [
    { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" },
    { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "done" },
    { t: "gate", attempt: 1, status: "PASS", newFailures: [] },
    { t: "triage", afterAttempt: 1, trigger: "gate_fail", verdict: "reroute", rationale: "try again", artifactRef: "triage-0" },
    { t: "close", status: "DONE", detailRef: "close-1" },
    { t: "baseline", status: "PASS" },
  ];
  const runSteps: RunEntry[] = [
    { t: "slot_fill", slot: 1, surfaceId: "a", taskDef: { intent: "a" } },
    { t: "slot_free", slot: 1, surfaceId: "a", outcome: "closed" },
    { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "the check could not run" } },
    { t: "repair_request", surfaceId: "a", key: null },
    { t: "gate_error_signal", surfaceId: "a" },
    { t: "held", surfaceId: "a" },
    { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1-0", surfaceId: "a" },
    { t: "repair_terminus", attempt: 1, sessionKey: "repair-1-0", status: "completed", rationale: "fixed" },
    { t: "breaker_healthy" },
    { t: "run_escalated", reason: "could not be repaired" },
  ];

  it("is kept on every kind of step a task's log holds", () => {
    for (const step of steps) expect(HistoryEntry.parse({ ...step, at: AT })).toEqual({ ...step, at: AT });
  });

  it("is kept on every kind of step a run's log holds", () => {
    for (const step of runSteps) expect(RunEntry.parse({ ...step, at: AT })).toEqual({ ...step, at: AT });
  });

  it("is optional, so a step recorded before steps carried a time still reads", () => {
    for (const step of steps) expect(HistoryEntry.parse(step)).toEqual(step);
    for (const step of runSteps) expect(RunEntry.parse(step)).toEqual(step);
  });

  it("must be a time: anything else is refused", () => {
    expect(HistoryEntry.safeParse({ t: "baseline", status: "PASS", at: "yesterday" }).success).toBe(false);
    expect(RunEntry.safeParse({ t: "breaker_healthy", at: 1727749200 }).success).toBe(false);
  });
});
