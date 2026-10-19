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

  it("ignores a new assertion at check that has no baseline counterpart", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "FAIL", detail: "new test, not passing yet" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });

  it("reports a failing new assertion when failOnNewAssertions is set", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "FAIL", detail: "new and broken" },
      ],
    };

    const result = computeDelta(baseline, check, { failOnNewAssertions: true });

    expect(result.pass).toBe(false);
    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]).toEqual({
      id: "test-new",
      baselineOutcome: "ABSENT",
      checkOutcome: "FAIL",
      detail: "new and broken",
    });
    expect(result.class).toBe("fail");
  });

  it("does not report a passing new assertion even when failOnNewAssertions is set", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
        { id: "test-new", outcome: "PASS", detail: "new and passing" },
      ],
    };

    const result = computeDelta(baseline, check, { failOnNewAssertions: true });

    expect(result.pass).toBe(true);
    expect(result.newFailures).toEqual([]);
    expect(result.class).toBeNull();
  });

  it("fails with error class when check report status is ERROR, regardless of assertions", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "ERROR",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
      detail: "test runner crashed",
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("error");
  });

  it("classifies as fail when there are new failures and gate status is not ERROR", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "FAIL", detail: "broke" },
      ],
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("fail");
  });

  it("classifies as error even when there are also new assertion failures", () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [
        { id: "test-1", outcome: "PASS", detail: "ok" },
      ],
    };
    const check: GateReport = {
      status: "ERROR",
      assertions: [
        { id: "test-1", outcome: "FAIL", detail: "broke" },
      ],
      detail: "partial run",
    };

    const result = computeDelta(baseline, check);

    expect(result.pass).toBe(false);
    expect(result.class).toBe("error");
  });
});

describe("a guard's result", () => {
  it("counts when new and failing, even for a gate that does not count new assertions", () => {
    const baseline = { status: "PASS" as const, assertions: [{ id: "a", outcome: "PASS" as const, detail: "ok" }] };
    const check = { status: "FAIL" as const, assertions: [{ id: "a", outcome: "PASS" as const, detail: "ok" }, { id: "guard:no-skips", outcome: "FAIL" as const, detail: "Refused" }] };
    const delta = computeDelta(baseline, check);
    expect(delta.pass).toBe(false);
    expect(delta.newFailures.map((failure) => failure.id)).toEqual(["guard:no-skips"]);
  });

  it("does not count other new assertions without the option", () => {
    const baseline = { status: "PASS" as const, assertions: [] };
    expect(computeDelta(baseline, { status: "FAIL", assertions: [{ id: "new-test", outcome: "FAIL", detail: "broke" }] }).pass).toBe(true);
  });
});

it("counts a new failing item assertion as a new failure, whatever the gate's option", () => {
  const delta = computeDelta({ status: "PASS", assertions: [] }, { status: "FAIL", assertions: [{ id: "item:x.md:resolved", outcome: "FAIL", detail: "still there" }] });
  expect(delta.pass).toBe(false);
  expect(delta.newFailures.map((f) => f.id)).toEqual(["item:x.md:resolved"]);
});
