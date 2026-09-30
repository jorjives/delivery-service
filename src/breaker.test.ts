import { describe, expect, it } from "vitest";
import type { RunEntry } from "./schema.js";
import { breakerOf, nextBreaker, openDispatch, openTrip, repairsUsed, requestedInOpenTrip, servedAlready, tripsOf } from "./breaker.js";

const degraded = (surfaceId: string, reason = "the shared helper is missing"): RunEntry => ({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
const dispatch = (attempt: number, surfaceId = "a"): RunEntry => ({ t: "repair_dispatch", attempt, sessionKey: `run-repair-${attempt}`, surfaceId });
const terminus = (attempt: number, status: "completed" | "escalate" | "incomplete" = "completed"): RunEntry => ({ t: "repair_terminus", attempt, sessionKey: `run-repair-${attempt}`, status, rationale: `attempt ${attempt}` });
const healthy: RunEntry = { t: "breaker_healthy" };

describe("how each entry moves the breaker", () => {
  it("trips from healthy, repairs, and comes back healthy", () => {
    expect(nextBreaker("HEALTHY", degraded("a"))).toBe("DEGRADED");
    expect(nextBreaker("DEGRADED", dispatch(1))).toBe("REPAIRING");
    expect(nextBreaker("REPAIRING", terminus(1))).toBe("DEGRADED");
    expect(nextBreaker("DEGRADED", healthy)).toBe("HEALTHY");
  });

  it("stays broken once the run gives up", () => {
    expect(nextBreaker("DEGRADED", { t: "run_escalated", reason: "gave up" })).toBe("DEGRADED");
  });

  it("is not moved by slots, holds or requests", () => {
    const quiet: RunEntry[] = [
      { t: "slot_fill", slot: 1, surfaceId: "a", taskDef: { intent: "x" } },
      { t: "slot_free", slot: 1, surfaceId: "a", outcome: "closed" },
      { t: "held", surfaceId: "b" },
      { t: "repair_request", surfaceId: "a", key: null },
    ];
    for (const entry of quiet) expect(nextBreaker("DEGRADED", entry)).toBe("DEGRADED");
  });

  it("is healthy for a run with no history, and follows the history otherwise", () => {
    expect(breakerOf([])).toBe("HEALTHY");
    expect(breakerOf([degraded("a"), dispatch(1)])).toBe("REPAIRING");
    expect(breakerOf([degraded("a"), dispatch(1), terminus(1), healthy])).toBe("HEALTHY");
  });
});

describe("the run's repairs", () => {
  it("counts every dispatch across every trip against the one limit", () => {
    expect(repairsUsed([degraded("a"), dispatch(1), terminus(1), healthy, degraded("b"), dispatch(2, "b")])).toBe(2);
  });

  it("finds a dispatch that never recorded a terminus, and only that", () => {
    expect(openDispatch([degraded("a"), dispatch(1)])).toMatchObject({ attempt: 1 });
    expect(openDispatch([degraded("a"), dispatch(1), terminus(1)])).toBeUndefined();
  });
});

describe("every trip, as status tells it", () => {
  it("names the cause, every task held once in the order held, each attempt, and how it ended", () => {
    const [trip] = tripsOf([
      degraded("a"),
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "held", surfaceId: "b" },
      { t: "repair_request", surfaceId: "c", key: "triage-3" },
      { t: "held", surfaceId: "b" },
      dispatch(1),
      terminus(1, "incomplete"),
      dispatch(2),
      terminus(2),
      healthy,
    ]);
    expect(trip).toEqual({
      cause: { kind: "gate_maintenance", surfaceId: "a", reason: "the shared helper is missing" },
      held: ["a", "b", "c"],
      repairs: [
        { attempt: 1, sessionKey: "run-repair-1", surfaceId: "a", status: "incomplete", rationale: "attempt 1" },
        { attempt: 2, sessionKey: "run-repair-2", surfaceId: "a", status: "completed", rationale: "attempt 2" },
      ],
      ended: "repaired",
      reason: null,
    });
  });

  it("opens a new trip after a repair, and records why the run gave up", () => {
    const trips = tripsOf([degraded("a"), dispatch(1), terminus(1), healthy, degraded("b"), { t: "run_escalated", reason: "could not be repaired" }]);
    expect(trips.map((trip) => [trip.cause.surfaceId, trip.ended, trip.reason])).toEqual([
      ["a", "repaired", null],
      ["b", "gave_up", "could not be repaired"],
    ]);
    expect(openTrip([degraded("a"), dispatch(1), terminus(1), healthy])).toBeUndefined();
    expect(openTrip([degraded("a")])?.cause.surfaceId).toBe("a");
  });
});

describe("whether a request has already been answered", () => {
  it("is answered once a repair finished after that same request", () => {
    const asked: RunEntry = { t: "repair_request", surfaceId: "a", key: "triage-3" };
    expect(servedAlready([degraded("a"), asked, dispatch(1), terminus(1), healthy], "a", "triage-3")).toBe(true);
    expect(servedAlready([degraded("a"), asked, dispatch(1)], "a", "triage-3")).toBe(false);
    expect(servedAlready([degraded("a"), asked, dispatch(1), terminus(1), healthy], "a", "triage-4")).toBe(false);
  });

  it("knows a request already made in the trip still open", () => {
    const history: RunEntry[] = [degraded("a"), { t: "repair_request", surfaceId: "a", key: null }];
    expect(requestedInOpenTrip(history, "a", null)).toBe(true);
    expect(requestedInOpenTrip(history, "b", null)).toBe(false);
    expect(requestedInOpenTrip([...history, dispatch(1), terminus(1), healthy], "a", null)).toBe(false);
  });
});
