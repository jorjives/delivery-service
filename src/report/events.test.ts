import { describe, expect, it } from "vitest";
import type { HistoryEntry, RunEntry } from "../schema.js";
import { withoutAt } from "../without-at.js";
import { eventsOf, ReportEvent } from "./events.js";
import { attempt, closedAt, failedCheck, fill, FOOTER, FORM, formDone, ID, recordOf, runFileOf, snapshotOf, timed } from "./report-fixtures.js";

const BASELINE: HistoryEntry = { t: "baseline", status: "PASS" };
const steps = timed([BASELINE, ...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go")], "2026-10-01T02:20:00.000Z");
const footer = (count: number, ended = false) =>
  recordOf({ runId: ID.footer, task: FOOTER, history: steps.slice(0, count), ...(ended ? { outcome: closedAt("2026-10-01T02:30:00.000Z") } : {}) });
const task = (count: number, ended = false) => snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [footer(count, ended)] });

describe("the events a record shows", () => {
  it("are one for each entry of a task's log, in the log's order, each with the step the task is in after it", () => {
    const events = eventsOf(task(7));

    expect(events.map((event) => [event.seq, event.at?.slice(11, 16), event.type === "surface_state" ? [event.from, event.state, event.attempt] : event.type])).toEqual([
      [0, "02:20", [null, "AGENT_ACTIVE", 1]],
      [1, "02:21", ["AGENT_ACTIVE", "AGENT_ACTIVE", 1]],
      [2, "02:22", ["AGENT_ACTIVE", "GATING", 1]],
      [3, "02:23", ["GATING", "TRIAGE", 1]],
      [4, "02:24", ["TRIAGE", "AGENT_ACTIVE", 2]],
      [5, "02:25", ["AGENT_ACTIVE", "AGENT_ACTIVE", 2]],
      [6, "02:26", ["AGENT_ACTIVE", "GATING", 2]],
    ]);
  });

  it("end with the task's outcome, after its last entry", () => {
    expect(eventsOf(task(7, true)).at(-1)).toEqual({
      schema: "delivery.event/1",
      run: null,
      surface: ID.footer,
      seq: 7,
      at: "2026-10-01T02:30:00.000Z",
      type: "surface_outcome",
      outcome: "closed",
    });
  });

  it("are the same for a record read whole as for the same record followed entry by entry", () => {
    const followed: ReportEvent[] = [];
    for (let count = 0; count <= steps.length; count++) followed.push(...eventsOf(task(count)).slice(followed.length));

    expect(followed).toEqual(eventsOf(task(steps.length)));
  });

  it("validate against their own schema", () => {
    for (const event of eventsOf(task(7, true))) expect(ReportEvent.parse(event)).toEqual(event);
  });

  it("carry no time for a record made before steps carried one, and keep the log's order", () => {
    const old = snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [recordOf({ runId: ID.footer, task: FOOTER, history: withoutAt(steps) })] });

    expect(eventsOf(old).map((event) => [event.seq, event.at])).toEqual(steps.map((_, seq) => [seq, null]));
  });
});

describe("the events of a run of several tasks", () => {
  const trouble: RunEntry[] = timed(
    [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.footer, reason: "the check could not run" } },
      { t: "held", surfaceId: ID.footer },
      { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1-0", surfaceId: ID.footer },
      { t: "repair_terminus", attempt: 1, sessionKey: "repair-1-0", status: "completed", rationale: "reinstalled" },
      { t: "breaker_healthy" },
    ],
    "2026-10-01T02:21:30.000Z",
  );
  const snapshot = snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone, footer(3)], runs: [runFileOf(ID.run, trouble)] });

  it("tell what happened to the setup its tasks share, by the entry's place in the run's own log", () => {
    const shared = eventsOf(snapshot).filter((event) => event.surface === null);

    expect(shared.map((event) => [event.run, event.seq, event.type])).toEqual([
      [ID.run, 2, "breaker_changed"],
      [ID.run, 4, "repair_started"],
      [ID.run, 5, "repair_finished"],
      [ID.run, 6, "breaker_changed"],
    ]);
    expect(shared[1]).toMatchObject({ attempt: 1, of: 2 });
  });

  it("put the tasks' events and the run's in the order they were recorded, each log's own order kept", () => {
    const times = eventsOf(snapshot).flatMap((event) => (event.at === null ? [] : [event.at]));

    expect(times).toEqual([...times].sort());
    expect(eventsOf(snapshot).filter((event) => event.surface === ID.footer).map((event) => event.seq)).toEqual([0, 1, 2]);
  });

  it("name the run each of its tasks belongs to", () => {
    expect(new Set(eventsOf(snapshot).map((event) => event.run))).toEqual(new Set([ID.run]));
  });
});
