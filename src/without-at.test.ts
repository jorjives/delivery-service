import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./schema.js";
import { withoutAt } from "./without-at.js";

describe("comparing recorded steps without the time each was recorded", () => {
  const dispatch: HistoryEntry = { t: "dispatch", attempt: 1, sessionKey: "worker-1-0", at: "2026-10-01T02:20:00.000Z" };
  const baseline: HistoryEntry = { t: "baseline", status: "PASS" };

  it("drops the time from one step and leaves everything else", () => {
    expect(withoutAt(dispatch)).toEqual({ t: "dispatch", attempt: 1, sessionKey: "worker-1-0" });
  });

  it("drops it from every step of a list, keeping their order", () => {
    expect(withoutAt([dispatch, baseline])).toEqual([{ t: "dispatch", attempt: 1, sessionKey: "worker-1-0" }, { t: "baseline", status: "PASS" }]);
  });

  it("leaves a step that carries no time as it is, and does not change the step it was given", () => {
    expect(withoutAt(baseline)).toEqual(baseline);
    expect(withoutAt(dispatch)).not.toBe(dispatch);
    expect(dispatch.at).toBe("2026-10-01T02:20:00.000Z");
  });

  it("gives back steps that are still steps, so what reads a log can read them", () => {
    const steps: HistoryEntry[] = withoutAt([dispatch, baseline]);

    expect(steps).toHaveLength(2);
  });
});
