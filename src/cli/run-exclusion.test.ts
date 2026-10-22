import { describe, expect, it } from "vitest";
import { liveRunFound } from "./run-exclusion.js";

describe("why a second run cannot start on top of a live one", () => {
  it("names the live run, when it started and its shape, and how to look at it", () => {
    expect(liveRunFound({ runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } })).toBe(
      "Another run is already going here (started `2026-09-30 09:00 UTC`, 4 tasks, up to 2 at once: `run-20260930T090000Z`). " +
        "Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });

  it("still says a run is going when its record cannot be found", () => {
    expect(liveRunFound(undefined)).toBe(
      "Another run is already going here. Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });
});
