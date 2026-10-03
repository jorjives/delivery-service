import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunEntry, type RepairChanges } from "./schema.js";
import { breakerOf, nextBreaker, openDispatch, openTrip, repairsUsed, requestedInOpenTrip, servedAlready, tripsOf, createRunBreaker, couldNotRepair, RECOVERED_REPAIR, signalsSinceHealthy, SHARED_ERROR_THRESHOLD, type BreakerChange, type RepairOutcome } from "./breaker.js";
import { createRunFile, loadRunFile } from "./run-file.js";
import { withoutAt } from "./without-at.js";
import { RunHalted } from "./errors.js";
import type { Terminus } from "./ports.js";
import { readRef } from "./case-file.js";

const degraded = (surfaceId: string, reason = "the shared helper is missing"): RunEntry => ({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
const signal = (surfaceId: string): RunEntry => ({ t: "gate_error_signal", surfaceId });
const aggregate = (surfaceId: string, surfaceIds: string[]): RunEntry => ({ t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId, surfaceIds } });
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
      signal("a"),
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

describe("the tasks whose check kept erroring", () => {
  it("names each task once, in the order they first reported", () => {
    expect(signalsSinceHealthy([signal("a"), signal("b"), signal("a")])).toEqual(["a", "b"]);
    expect(signalsSinceHealthy([])).toEqual([]);
  });

  it("forgets every report made before the environment was last healthy", () => {
    expect(signalsSinceHealthy([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy, signal("c")])).toEqual(["c"]);
    expect(signalsSinceHealthy([signal("a"), degraded("z"), dispatch(1, "z"), terminus(1), healthy])).toEqual([]);
  });

  it("takes two different tasks to call it shared", () => {
    expect(SHARED_ERROR_THRESHOLD).toBe(2);
  });

  it("records a trip those reports caused, in the copy of the task that reached the threshold", () => {
    const [trip] = tripsOf([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy]);
    expect(trip).toMatchObject({
      cause: { kind: "gate_error_aggregate", surfaceId: "b", surfaceIds: ["a", "b"] },
      held: ["b"],
      repairs: [{ attempt: 1, surfaceId: "b", status: "completed" }],
      ended: "repaired",
    });
  });

  it("refuses a trip that names fewer than two tasks", () => {
    expect(RunEntry.safeParse(aggregate("a", ["a"])).success).toBe(false);
    expect(RunEntry.safeParse(aggregate("b", ["a", "b"])).success).toBe(true);
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
      limit: null,
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

/** Let every promise callback already queued run. Only for asserting that something has NOT happened yet: the breaker writes to disk between steps, so anything positive is awaited with `vi.waitFor`. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A run file on disk, a breaker over it, and a repair whose answers the test gives one at a time. */
async function breakerOver(history: RunEntry[] = [], limit = 2) {
  const dir = mkdtempSync(join(tmpdir(), "breaker-"));
  await createRunFile(dir, { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: limit } });
  const { appendRunEntry } = await import("./run-file.js");
  for (const entry of history) await appendRunEntry(dir, entry);
  const dispatched: string[] = [];
  const answers: PromiseWithResolvers<RepairOutcome>[] = [];
  const changes: BreakerChange[] = [];
  const breaker = createRunBreaker({
    dir,
    history,
    limit,
    dispatch: (surfaceId, sessionKey) => {
      dispatched.push(`${surfaceId}:${sessionKey}`);
      const answer = Promise.withResolvers<RepairOutcome>();
      answers.push(answer);
      return answer.promise;
    },
    onChange: (change) => changes.push(change),
  });
  // Each answer waits for the next dispatch to exist, since every dispatch follows fsynced run-file writes.
  let answered = 0;
  const answer = async (terminus: Terminus, changesData?: RepairChanges) => {
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(answered));
    answers[answered++]?.resolve({ terminus, ...(changesData === undefined ? {} : { changes: changesData }) });
  };
  const entries = async () => withoutAt((await loadRunFile(dir)).history);
  return { dir, breaker, dispatched, changes, answer, entries };
}

const fixed: Terminus = { status: "completed", rationale: "restored the helper" };
const nothing: Terminus = { status: "incomplete", rationale: "ended without a result" };

describe("one repair of the shared environment for the whole run", () => {
  it("lets a task check its work straight away while the environment is healthy, recording nothing", async () => {
    const { breaker, entries } = await breakerOver();
    const leave = await breaker.awaitClearance("a");
    leave();
    expect(await entries()).toEqual([]);
  });

  it("runs one repair however many tasks ask, counts it once, and releases them all when it works", async () => {
    const { breaker, dispatched, answer, entries, changes } = await breakerOver();
    const first = breaker.requestRepair({ surfaceId: "a", reason: "the shared helper is missing" });
    const second = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-2" });
    const held = breaker.awaitClearance("c");
    await vi.waitFor(() => expect(dispatched).toEqual(["a:run-repair-1"]));

    await answer(fixed);
    await Promise.all([first, second]);
    (await held)();

    expect((await entries()).map((entry) => entry.t)).toEqual([
      "breaker_degraded", "repair_request", "repair_request", "held", "repair_dispatch", "repair_terminus", "breaker_healthy",
    ]);
    expect(changes).toEqual([
      { state: "DEGRADED", affected: ["a"] },
      { state: "REPAIRING", affected: ["a", "b", "c"], repair: { attempt: 1, of: 2 } },
      { state: "HEALTHY", affected: ["a", "b", "c"] },
    ]);
  });

  it("waits for a task already checking its work before starting the repair", async () => {
    const { breaker, dispatched } = await breakerOver();
    const leave = await breaker.awaitClearance("b");
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    expect(dispatched).toEqual([]);

    leave();
    await vi.waitFor(() => expect(dispatched).toEqual(["a:run-repair-1"]));
    void asked.catch(() => undefined);
  });

  it("tries again after a repair that ended without a result, within the run's limit", async () => {
    const { breaker, dispatched, answer } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer(nothing);
    await answer(fixed);
    await asked;
    expect(dispatched).toEqual(["a:run-repair-1", "a:run-repair-2"]);
  });

  it("gives up once the run's limit is spent, stopping every held task and every later one", async () => {
    const { breaker, answer, entries } = await breakerOver([], 1);
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    const held = breaker.awaitClearance("b");
    await settle();
    await answer(nothing);

    await expect(asked).rejects.toBeInstanceOf(RunHalted);
    await expect(held).rejects.toBeInstanceOf(RunHalted);
    await expect(breaker.awaitClearance("c")).rejects.toBeInstanceOf(RunHalted);
    expect(breaker.gaveUp).toBe(couldNotRepair(1));
    expect((await entries()).at(-1)).toEqual({ t: "run_escalated", reason: couldNotRepair(1) });
  });

  it("counts repairs across trips against the one limit", async () => {
    const { breaker, answer, dispatched } = await breakerOver([], 2);
    const one = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer(fixed);
    await one;
    const two = breaker.requestRepair({ surfaceId: "b", reason: "broken again" });
    await settle();
    await answer(fixed);
    await two;

    await expect(breaker.requestRepair({ surfaceId: "a", reason: "and again" })).rejects.toBeInstanceOf(RunHalted);
    expect(dispatched).toEqual(["a:run-repair-1", "b:run-repair-2"]);
  });

  it("gives a task that finds it broken again, once the fix is announced, a repair of its own", async () => {
    const { breaker, dispatched, answer, changes } = await breakerOver([], 3);
    const first = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await answer(fixed);
    // As soon as "fixed" is said, which may be before its entry is on disk: the new trip must not join the finished repair.
    await vi.waitFor(() => expect(changes.at(-1)?.state).toBe("HEALTHY"));
    const again = breaker.requestRepair({ surfaceId: "b", reason: "broken again" });
    await first;
    await answer(fixed);
    await again;
    expect(dispatched).toEqual(["a:run-repair-1", "b:run-repair-2"]);
  });

  it("gives up at once when the repair says only a change to the check would fix it", async () => {
    const { breaker, answer } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer({ status: "escalate", category: "authority", rationale: "the only fix is to the check" });
    await expect(asked).rejects.toThrow("the only fix is to the check");
  });

  it("gives up at once on a repair session that never started", async () => {
    const { breaker, answer, dispatched } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer({ status: "incomplete", rationale: "the runtime would not start", notRun: true });
    await expect(asked).rejects.toBeInstanceOf(RunHalted);
    expect(dispatched).toHaveLength(1);
  });

  it("resumes into a repair a crash interrupted, in the same trip, rather than losing it", async () => {
    const history: RunEntry[] = [
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "broken" } },
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "a" },
    ];
    const { breaker, dispatched, answer, entries } = await breakerOver(history);
    const held = breaker.awaitClearance("b");
    await vi.waitFor(() => expect(dispatched).toEqual(["a:run-repair-2"]));
    await answer(fixed);
    (await held)();

    const after = await entries();
    expect(after.filter((entry) => entry.t === "breaker_degraded")).toHaveLength(1);
    expect(after.filter((entry) => entry.t === "repair_terminus")).toMatchObject([
      { attempt: 1, status: "incomplete", rationale: RECOVERED_REPAIR },
      { attempt: 2, status: "completed" },
    ]);
  });

  it("stays stopped when picked up after it gave up", async () => {
    const { breaker } = await breakerOver([
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "broken" } },
      { t: "run_escalated", reason: "gave up" },
    ]);
    expect(breaker.gaveUp).toBe("gave up");
    await expect(breaker.awaitClearance("a")).rejects.toBeInstanceOf(RunHalted);
  });

  it("gives up at once, naming the limit and not the environment, when a usage limit stops the repair", async () => {
    const { breaker, answer, dispatched, entries } = await breakerOver();
    const asked = breaker.requestRepair({ surfaceId: "a", reason: "broken" });
    await settle();
    await answer({ status: "incomplete", rationale: "gate-maintenance session did not complete: the AI service is limiting requests", limit: "rate" });

    await expect(asked).rejects.toThrow("the AI service is limiting requests");
    expect(breaker.gaveUp).toBe("the repair could not run because the AI service is limiting requests; no task caused this");
    expect(breaker.gaveUp).not.toContain("could not be repaired");
    // The next attempt would meet the same limit: the run's repair limit (2 here) is not spent finding that out.
    expect(dispatched).toHaveLength(1);
    const history = await entries();
    expect(history.at(-1)).toEqual({ t: "run_escalated", reason: "the repair could not run because the AI service is limiting requests; no task caused this", limit: "rate" });
    expect(tripsOf(history).at(-1)).toMatchObject({ ended: "gave_up", limit: "rate" });
  });

  it("keeps what the repair changed in the run's own folder and names it on the repair's terminus", async () => {
    const changed: RepairChanges = { files: [{ path: "check.mjs", status: "modified", added: 1, removed: 1, touchesCheck: true, patch: "diff --git a/check.mjs b/check.mjs\n" }], truncated: false };
    const { dir, breaker, answer, entries } = await breakerOver();
    const repaired = breaker.requestRepair({ surfaceId: "a", reason: "the shared helper is missing" });

    await answer(fixed, changed);
    await repaired;

    expect((await entries()).find((entry) => entry.t === "repair_terminus")).toMatchObject({ sessionKey: "run-repair-1", status: "completed", changesRef: "repair-run-repair-1" });
    expect(await readRef(dir, "repair-run-repair-1")).toEqual(changed);
  });

  it("names no changes on a repair whose changes could not be read, and goes on just the same", async () => {
    const { breaker, answer, entries } = await breakerOver();
    const repaired = breaker.requestRepair({ surfaceId: "a", reason: "the shared helper is missing" });

    await answer(fixed);
    await repaired;

    expect((await entries()).find((entry) => entry.t === "repair_terminus")).not.toHaveProperty("changesRef");
    expect((await entries()).map((entry) => entry.t)).toContain("breaker_healthy");
  });
});

describe("a check that keeps erroring", () => {
  it("is the task's own business while no other task has reported it: nothing trips, nobody is held", async () => {
    const { breaker, dispatched, changes, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");

    expect(await entries()).toEqual([signal("a")]);
    expect(dispatched).toEqual([]);
    expect(changes).toEqual([]);
    (await breaker.awaitClearance("b"))();
    expect(await entries()).toEqual([signal("a")]);
  });

  it("counts the same task once however often it reports", async () => {
    const { breaker, dispatched, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");
    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-5" })).toBe("alone");

    expect(await entries()).toEqual([signal("a")]);
    expect(dispatched).toEqual([]);
  });

  it("is shared once a second, different task reports it: one repair, in that task's copy", async () => {
    const { breaker, dispatched, changes, answer, entries } = await breakerOver();

    expect(await breaker.reportCheckErrors({ surfaceId: "a", key: "triage-3" })).toBe("alone");
    const second = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["b:run-repair-1"]));
    await answer(fixed);

    expect(await second).toBe("shared");
    expect(await entries()).toEqual([
      signal("a"),
      signal("b"),
      aggregate("b", ["a", "b"]),
      { t: "repair_request", surfaceId: "b", key: "triage-3" },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "b" },
      { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored the helper" },
      healthy,
    ]);
    expect(changes).toEqual([
      { state: "DEGRADED", affected: ["b"] },
      { state: "REPAIRING", affected: ["b"], repair: { attempt: 1, of: 2 } },
      { state: "HEALTHY", affected: ["b"] },
    ]);
  });

  it("no longer counts earlier reports once a repair has worked", async () => {
    const { breaker, dispatched } = await breakerOver([signal("a"), signal("b"), aggregate("b", ["a", "b"]), dispatch(1, "b"), terminus(1), healthy]);

    expect(await breaker.reportCheckErrors({ surfaceId: "c", key: "triage-3" })).toBe("alone");
    expect(dispatched).toEqual([]);
  });

  it("shares a repair already pending, without counting as evidence of its own", async () => {
    const { breaker, dispatched, answer, entries } = await breakerOver();
    const first = breaker.requestRepair({ surfaceId: "a", reason: "the shared helper is missing" });
    const joined = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["a:run-repair-1"]));
    await answer(fixed);

    await first;
    expect(await joined).toBe("shared");
    expect((await entries()).map((entry) => entry.t)).toEqual(["breaker_degraded", "repair_request", "repair_request", "repair_dispatch", "repair_terminus", "breaker_healthy"]);
  });

  it("answers a report already repaired before a crash, without counting or repairing again", async () => {
    const history: RunEntry[] = [signal("a"), signal("b"), aggregate("b", ["a", "b"]), { t: "repair_request", surfaceId: "b", key: "triage-3" }, dispatch(1, "b"), terminus(1), healthy];
    const { breaker, dispatched, entries } = await breakerOver(history);

    expect(await breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" })).toBe("shared");
    expect(dispatched).toEqual([]);
    expect(await entries()).toEqual(history);
  });

  it("trips when picked up after a crash that landed between the second report and the trip", async () => {
    const { breaker, dispatched, answer } = await breakerOver([signal("a"), signal("b")]);

    const again = breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" });
    await vi.waitFor(() => expect(dispatched).toEqual(["b:run-repair-1"]));
    await answer(fixed);
    expect(await again).toBe("shared");
  });

  it("is refused once the run has given up", async () => {
    const { breaker } = await breakerOver([degraded("a"), { t: "run_escalated", reason: "gave up" }]);
    await expect(breaker.reportCheckErrors({ surfaceId: "b", key: "triage-3" })).rejects.toBeInstanceOf(RunHalted);
  });
});
