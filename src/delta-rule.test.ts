import { describe, it, expect } from "vitest";
import { computeDelta } from "./delta-rule.js";
import type { GateReport } from "./schema.js";

describe("computeDelta", () => {
  it("passes when baseline and check have identical passing assertions", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });

  it("reports a new failure when an assertion passes at baseline and fails at check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "expected 200, got 500" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-2",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "expected 200, got 500",
    });
    expect(result.class).toBe("fail");
  });

  it("reports a new failure when an assertion passes at baseline and errors at check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "ERROR", detail: "timeout" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-1",
      baselineOutcome: "PASS",
      checkOutcome: "ERROR",
      detail: "timeout",
    });
    expect(result.class).toBe("fail");
  });

  it("reports ABSENT when an assertion passed at baseline but is missing from check", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        // test-2 is gone
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-2",
      baselineOutcome: "PASS",
      checkOutcome: "ABSENT",
      detail: 'Assertion "test-2" was present at baseline but missing from check',
    });
    expect(result.class).toBe("fail");
  });

  it("never reports a pre-existing failure as a new failure regardless of check outcome", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "known broken" },
        { id: "test-3", outcome: "ERROR", detail: "known error" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-2", outcome: "FAIL", detail: "still broken" },
        { id: "test-3", outcome: "PASS", detail: "fixed now" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });
});
