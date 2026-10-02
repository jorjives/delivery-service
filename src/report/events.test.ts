import { describe, expect, it } from "vitest";
import type { HistoryEntry, RunEntry, RunOutcome } from "../schema.js";
import { withoutAt } from "../without-at.js";
import { deriveReport } from "./derive.js";
import { eventsOf, ReportEvent, streamEnded, streamStarted } from "./events.js";
import { attempt, closedAt, failedCheck, fill, FOOTER, footerFailed, FORM, formDone, ID, recordOf, runFileOf, snapshotOf, timed } from "./report-fixtures.js";

const BASELINE: HistoryEntry = { t: "baseline", status: "PASS" };
const steps = timed([BASELINE, ...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go")], "2026-10-01T02:20:00.000Z");
const footer = (count: number, ended = false) =>
  recordOf({ runId: ID.footer, task: FOOTER, history: steps.slice(0, count), ...(ended ? { outcome: closedAt("2026-10-01T02:30:00.000Z") } : {}) });
const task = (count: number, ended = false) => snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [footer(count, ended)] });

describe("the events a record shows", () => {
  it("are one for each entry of a task's log, in the log's order, each with the step the task is in after it", () => {
    const events = eventsOf(task(7));

    expect(events.map((event) => [event.seq, event.at?.slice(11, 16), event.type, "from" in event ? [event.from, event.state, event.attempt] : null])).toEqual([
      [0, "02:20", "surface_state", [null, "AGENT_ACTIVE", 1]],
      [1, "02:21", "surface_state", ["AGENT_ACTIVE", "AGENT_ACTIVE", 1]],
      [2, "02:22", "surface_state", ["AGENT_ACTIVE", "GATING", 1]],
      [3, "02:23", "surface_state", ["GATING", "TRIAGE", 1]],
      [4, "02:24", "triage_decision", ["TRIAGE", "AGENT_ACTIVE", 2]],
      [5, "02:25", "surface_state", ["AGENT_ACTIVE", "AGENT_ACTIVE", 2]],
      [6, "02:26", "surface_state", ["AGENT_ACTIVE", "GATING", 2]],
    ]);
  });

  it("tell a triage round as an event of its own: what set it off, what was decided, and the reasoning word for word", () => {
    expect(eventsOf(task(7))[4]).toEqual({
      schema: "delivery.event/1",
      run: null,
      surface: ID.footer,
      seq: 4,
      at: "2026-10-01T02:24:00.000Z",
      type: "triage_decision",
      state: "AGENT_ACTIVE",
      from: "TRIAGE",
      attempt: 2,
      afterAttempt: 1,
      trigger: "gate_fail",
      verdict: "reroute",
      rationale: "gate_fail: reroute",
    });
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

  it("end with the run's own outcome, after its last entry: every task taken and ended, or stopped with the recorded reason", () => {
    const ended = (outcome: RunOutcome) => eventsOf({ ...snapshot, runs: [runFileOf(ID.run, trouble, outcome)] }).findLast((event) => event.surface === null);
    const head = { schema: "delivery.event/1", run: ID.run, surface: null, seq: trouble.length, type: "run_outcome" };

    expect(ended({ kind: "drained", at: "2026-10-01T02:40:00.000Z" })).toEqual({ ...head, at: "2026-10-01T02:40:00.000Z", outcome: "drained", cause: null, reason: null });
    expect(ended({ kind: "escalated", cause: "shared_environment", reason: "the repairs ran out", at: "2026-10-01T02:41:00.000Z" })).toEqual({
      ...head,
      at: "2026-10-01T02:41:00.000Z",
      outcome: "escalated",
      cause: "shared_environment",
      reason: "the repairs ran out",
    });
  });
});

describe("the two lines a stream begins and ends with", () => {
  const marker = { schema: "delivery.event/1", seq: 0 };
  const none = { closed: 0, escalated: 0, aborted: 0, paused: 0, unfinished: 0, queued: 0, not_started: 0 };

  it("say what is followed: one task by its run, a run of several by its id, and a list worked one at a time as having no run of its own", () => {
    const list = deriveReport(snapshotOf({ records: [formDone] }));
    const drained = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone], runs: [runFileOf(ID.run, [fill(1, ID.form, FORM)])] }));

    expect(streamStarted(deriveReport(task(7)))).toEqual({ ...marker, run: null, surface: ID.footer, at: null, type: "stream_started", subject: "task" });
    expect(streamStarted(list)).toEqual({ ...marker, run: null, surface: null, at: null, type: "stream_started", subject: "list" });
    expect(streamStarted(drained)).toEqual({ ...marker, run: ID.run, surface: null, at: null, type: "stream_started", subject: "run" });
  });

  it("say how one task ended, at the last time its record holds", () => {
    expect(streamEnded(deriveReport(task(7, true)), "ended")).toEqual({
      ...marker,
      run: null,
      surface: ID.footer,
      at: "2026-10-01T02:30:00.000Z",
      type: "stream_ended",
      subject: "task",
      ending: "ended",
      counts: { ...none, closed: 1 },
      runOutcome: null,
      surfaceOutcome: "closed",
    });
  });

  it("say how a run of several tasks ended by the run's own outcome, and name no one task's", () => {
    const run = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], { kind: "drained", at: "2026-10-01T03:00:00.000Z" });
    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, list: [], records: [formDone, footerFailed], runs: [run] }));

    expect(streamEnded(doc, "ended")).toMatchObject({ run: ID.run, surface: null, subject: "run", runOutcome: "drained", surfaceOutcome: null, counts: { closed: 1, escalated: 1 } });
  });

  it("say a task list a run of several tasks governs by that run, whichever task stopped it, and one worked on its own since by no run, whatever run once took one of its tasks", () => {
    const gaveUp = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], { kind: "escalated", cause: "shared_environment", reason: "the repairs ran out", at: "2026-10-01T03:17:00.000Z" });
    const older = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T02:10:00.000Z" });
    const governed = deriveReport(snapshotOf({ records: [formDone, footerFailed], runs: [gaveUp] }));
    const since = deriveReport(snapshotOf({ records: [formDone, footerFailed], runs: [older] }));

    expect(streamStarted(governed)).toMatchObject({ run: ID.run, subject: "list" });
    expect(streamEnded(governed, "ended")).toMatchObject({ run: ID.run, runOutcome: "escalated", surfaceOutcome: null, at: "2026-10-01T03:17:00.000Z" });
    expect(streamStarted(since)).toMatchObject({ run: null, subject: "list" });
    expect(streamEnded(since, "ended")).toMatchObject({ run: null, runOutcome: null, surfaceOutcome: "escalated", at: "2026-10-01T02:58:00.000Z" });
  });

  it("leave an old run out of the events of a task list worked on its own since: no event names it, and none is its outcome", () => {
    const older = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T02:10:00.000Z" });

    const events = eventsOf(snapshotOf({ records: [formDone, footerFailed], runs: [older] }));

    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((event) => event.run !== null || event.type === "run_outcome")).toEqual([]);
  });

  it("say which outcome stopped a list worked one task at a time, and none for a list that is done or has not ended", () => {
    expect(streamEnded(deriveReport(snapshotOf({ records: [formDone, footerFailed] })), "ended")).toMatchObject({ run: null, subject: "list", runOutcome: null, surfaceOutcome: "escalated" });
    expect(streamEnded(deriveReport(snapshotOf({ list: [{ intent: FORM }], records: [formDone] })), "ended")).toMatchObject({ surfaceOutcome: null });
    expect(streamEnded(deriveReport(task(7)), "stopped_part_way")).toMatchObject({ ending: "stopped_part_way", surfaceOutcome: null, at: "2026-10-01T02:26:00.000Z" });
  });

  it("validate against the events' own schema, as every event does", () => {
    const doc = deriveReport(task(7, true));

    for (const event of [streamStarted(doc), ...eventsOf(task(7, true)), streamEnded(doc, "ended")]) expect(ReportEvent.parse(event)).toEqual(event);
  });
});
