import { describe, expect, it } from "vitest";
import {
  attempt,
  closedAt,
  failedCheck,
  fill,
  FOOTER,
  FORBIDDEN,
  FORM,
  formDone,
  ID,
  recordOf,
  runFileOf,
  snapshotOf,
  stoppedAt,
  timed,
} from "../report/report-fixtures.js";
import type { RecordSnapshot } from "../report/snapshot.js";
import type { HistoryEntry, RunEntry } from "../schema.js";
import { ReportEvent } from "../report/events.js";
import { emptyStream, streamTick, TIMES_NOT_RECORDED, watchTick, type WatchTick } from "./watch.js";

const MERGE = { type: "merge-back" } as const;
const BASELINE: HistoryEntry = { t: "baseline", status: "PASS" };
const PASSED: HistoryEntry = { t: "gate", attempt: 1, status: "PASS", newFailures: [] };
const HANDED_OVER: HistoryEntry = { t: "close", status: "DONE", detailRef: "close-1" };

/** The footer task as its log grows: the first `steps` of a run that passes its check at the first go, a minute apart from 02:20. */
const footerSteps = timed([BASELINE, ...attempt(1, "fixed the links"), PASSED, HANDED_OVER], "2026-10-01T02:20:00.000Z");
const footerAt = (steps: number, ended = false) =>
  recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: footerSteps.slice(0, steps), ...(ended ? { outcome: closedAt("2026-10-01T02:24:30.000Z") } : {}) });

const fills: RunEntry[] = timed([fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], "2026-10-01T02:00:00.000Z");
const going = (records: RecordSnapshot["records"], run = runFileOf(ID.run, fills)): RecordSnapshot => snapshotOf({ live: true, records, runs: [run] });

/** Several looks in a row, each given what the one before remembered. */
function looks(snapshots: RecordSnapshot[]): WatchTick[] {
  const ticks: WatchTick[] = [];
  for (const snapshot of snapshots) ticks.push(watchTick(ticks.at(-1)?.state, snapshot));
  return ticks;
}

describe("the first look of a watch", () => {
  it("names what it is watching, says stopping it stops nothing else, and gives the picture of every task", () => {
    const { lines, exitCode } = watchTick(undefined, going([formDone, footerAt(3)]));

    expect(lines).toEqual([
      "Watching run run-20261001T020000Z: 2 tasks, up to 2 at once. Ctrl-C stops watching; the run is not affected.",
      "",
      "Right now (last activity 02:22 UTC): 4 tasks: 1 done, 1 working, 2 waiting to start.",
      '  Task 1 of 4: "Add a contact form": merged into main at 02:19',
      '  Task 2 of 4: "Fix the broken footer links": checking the agent\'s work (attempt 1). In this step since 02:22 UTC.',
      '  Task 3 of 4: "Replace the old homepage": waiting to start',
      '  Task 4 of 4: "Add a cookie banner": waiting to start',
      "",
    ]);
    expect(exitCode).toBeNull();
  });

  it("tells nothing that happened before it began", () => {
    const [, second] = looks([going([formDone, footerAt(3)]), going([formDone, footerAt(3)])]);

    expect(second?.lines).toEqual([]);
  });
});

describe("each later look of a watch", () => {
  it("adds one line for each change recorded since the look before, with its time and the task's place", () => {
    const ticks = looks([going([formDone, footerAt(1)]), going([formDone, footerAt(3)]), going([formDone, footerAt(5, true)])]);

    expect(ticks[1]?.lines).toEqual(["02:22 Task 2 of 4: checking the agent's work."]);
    expect(ticks[2]?.lines).toEqual(["02:23 Task 2 of 4: wrapping up.", "02:24 Task 2 of 4: done, merged into main."]);
    expect(ticks.map((tick) => tick.exitCode)).toEqual([null, null, null]);
  });

  it("says which go of the agent's it is once the agent has been sent back", () => {
    const sentBack = timed([BASELINE, ...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go").slice(0, 1)], "2026-10-01T02:20:00.000Z");
    const footer = (steps: number) => recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: sentBack.slice(0, steps) });

    const [, second] = looks([going([formDone, footer(3)]), going([formDone, footer(6)])]);

    expect(second?.lines).toEqual(["02:23 Task 2 of 4: deciding what to do about a setback.", "02:24 Task 2 of 4: the agent is working (attempt 2)."]);
  });

  it("marks a task that stopped with a symbol as well as words", () => {
    const stopped = recordOf({
      runId: ID.footer,
      task: FOOTER,
      closerRef: MERGE,
      history: timed([BASELINE, ...attempt(1, "I need the owner to confirm.", "authority")], "2026-10-01T02:20:00.000Z"),
      outcome: stoppedAt("2026-10-01T02:23:00.000Z", { kind: "authority", role: "worker" }),
    });

    const [, second] = looks([going([formDone, footerAt(2)]), going([formDone, stopped])]);

    expect(second?.lines).toEqual(["02:23 ! Task 2 of 4: needs your decision."]);
  });

  it("tells trouble with the setup every task shares, its repair, and when tasks carry on, as plain lines", () => {
    const trouble: RunEntry[] = timed(
      [
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.footer, reason: "the check could not run" } },
        { t: "held", surfaceId: ID.footer },
        { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1-0", surfaceId: ID.footer },
        { t: "repair_terminus", attempt: 1, sessionKey: "repair-1-0", status: "completed", rationale: "reinstalled" },
        { t: "breaker_healthy" },
      ],
      "2026-10-01T03:12:00.000Z",
    );
    const records = [formDone, footerAt(3)];

    const [, second] = looks([going(records), going(records, runFileOf(ID.run, [...fills, ...trouble]))]);

    expect(second?.lines).toEqual([
      "03:12 ! The setup the checks need looks broken. Holding tasks about to check or hand over their work while it is repaired.",
      "03:14 The setup is being repaired (repair 1 of 2).",
      "03:16 The setup is repaired; tasks carry on.",
    ]);
  });

  it("never uses the harness's internal names for things", () => {
    const ticks = looks([going([formDone, footerAt(1)]), going([formDone, footerAt(5, true)])]);

    for (const line of ticks.flatMap((tick) => tick.lines)) expect(line.replace(/"[^"]*"/g, "")).not.toMatch(FORBIDDEN);
  });
});

describe("a watch of a run of several tasks", () => {
  const drained = runFileOf(ID.run, fills, { kind: "drained", at: "2026-10-01T02:58:30.000Z" });
  const footerStopped = recordOf({
    runId: ID.footer,
    task: FOOTER,
    closerRef: MERGE,
    history: timed([BASELINE, ...attempt(1, "I need the owner to confirm.", "authority")], "2026-10-01T02:20:00.000Z"),
    outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "authority", role: "worker" }),
  });

  it("ends when the run finishes, with the counts, where to read more, and the code the run ended with", () => {
    const subject = { kind: "run", runId: ID.run } as const;
    const [, last] = looks([
      { ...going([formDone, footerAt(3)]), subject },
      { ...snapshotOf({ records: [formDone, footerStopped], runs: [drained] }), subject },
    ]);

    expect(last?.lines.at(-1)).toBe("02:58 Run finished: 1 of 2 tasks completed and merged; 1 needs your decision. Run `delivery report run-20261001T020000Z` for what to do.");
    expect(last?.exitCode).toBe(4);
  });

  it("ends the same way when it was following the task list that run was working", () => {
    const [, last] = looks([going([formDone, footerAt(3)]), snapshotOf({ records: [formDone, footerAt(5, true)], runs: [drained] })]);

    expect(last?.lines.at(-1)).toBe("02:58 Run finished: 2 of 4 tasks completed and merged; 2 not started. Run `delivery report` for what to do.");
    expect(last?.exitCode).toBe(0);
  });

  it("says a run that gave up on the setup its tasks share stopped, not finished, and ends with the code that run ended with", () => {
    const gaveUp = runFileOf(ID.run, fills, { kind: "escalated", cause: "shared_environment", reason: "the setup could not be repaired", at: "2026-10-01T03:17:00.000Z" });

    const [, last] = looks([going([formDone, footerAt(3)]), snapshotOf({ records: [formDone, footerAt(3)], runs: [gaveUp] })]);

    expect(last?.lines.at(-1)).toBe("03:17 Run stopped: 4 tasks: 1 done, 1 not finished, 2 not started. Run `delivery report` for what to do.");
    expect(last?.exitCode).toBe(4);
  });

  it("ends a finished run's task list replayed as it ended when followed: by the run's own outcome, not by the first task that did not finish", () => {
    const gaveUp = runFileOf(ID.run, fills, { kind: "escalated", cause: "shared_environment", reason: "the setup could not be repaired", at: "2026-10-01T03:17:00.000Z" });

    const { lines, exitCode } = watchTick(undefined, snapshotOf({ records: [formDone, footerAt(3)], runs: [gaveUp] }));

    expect(lines.at(-1)).toBe("03:17 Run stopped: 4 tasks: 1 done, 1 not finished, 2 not started. Run `delivery report` for what to do.");
    expect(exitCode).toBe(4);
  });

  it("ends a drained run's task list replayed by the run, with the code of the task that stopped", () => {
    const { lines, exitCode } = watchTick(undefined, snapshotOf({ records: [formDone, footerStopped], runs: [drained] }));

    expect(lines.at(-1)).toMatch(/^02:58 Run finished: /);
    expect(exitCode).toBe(4);
  });

  it("ends a list worked one task at a time since an older run took one of its tasks by the task that stopped it, at the time it stopped: the old run says nothing of how the list stands", () => {
    const older = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T02:10:00.000Z" });

    const { lines, exitCode } = watchTick(undefined, snapshotOf({ records: [formDone, footerStopped], runs: [older] }));

    expect(lines.at(-1)).toMatch(/^02:58 Your task list has stopped: /);
    expect(exitCode).toBe(4);
  });

  it("recognises a run that was stopped part way: says so, says how to carry on, and ends ok", () => {
    const { lines, exitCode } = watchTick(undefined, { ...going([formDone, footerAt(3)]), live: false });

    expect(lines.at(-1)).toBe("Work on your task list stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
    expect(exitCode).toBe(0);
  });
});

describe("a watch of a list worked one task at a time", () => {
  const list = (records: RecordSnapshot["records"]): RecordSnapshot => snapshotOf({ list: [FORM, FOOTER].map((intent) => ({ intent })), records });

  it("opens by naming the list, and says once that nothing records whether it is still being worked on", () => {
    const [first, second] = looks([list([formDone, footerAt(3)]), list([formDone, footerAt(4)])]);

    expect(first?.lines.at(0)).toBe("Watching your task list: 2 tasks. Ctrl-C stops watching; the run is not affected.");
    expect(first?.lines.at(-1)).toBe("Nothing records whether your task list is still being worked on. Last recorded activity: 02:22 UTC. Still watching.");
    expect(second?.lines).toEqual(["02:23 Task 2 of 2: wrapping up."]);
  });

  it("keeps waiting between one task finishing and the next starting", () => {
    const { lines, exitCode } = watchTick(undefined, list([formDone]));

    expect(exitCode).toBeNull();
    expect(lines.at(-1)).toBe("Nothing records whether your task list is still being worked on. Last recorded activity: 02:19 UTC. Still watching.");
  });

  it("ends when every task is done, with the code `delivery run` ends with", () => {
    const [, last] = looks([list([formDone, footerAt(4)]), list([formDone, footerAt(5, true)])]);

    expect(last?.lines).toEqual(["02:24 Task 2 of 2: done, merged into main.", "02:24 Every task on your list is done: 2 of 2 tasks completed and merged. Run `delivery report` for what to do."]);
    expect(last?.exitCode).toBe(0);
  });

  it("ends when a task stops the list, with the code `delivery run` ends with for that stop", () => {
    const stopped = (kind: "escalated" | "aborted") =>
      snapshotOf({ records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: attempt(1, "x"), outcome: stoppedAt("2026-10-01T02:58:00.000Z", undefined, "recorded reason", kind) })] });

    const needsOwner = watchTick(undefined, stopped("escalated"));
    const gaveUp = watchTick(undefined, stopped("aborted"));

    expect(needsOwner.lines.at(-1)).toBe("02:58 Your task list has stopped: 1 of 4 tasks completed and merged; 1 stopped, for your engineers; 2 not started. Run `delivery report` for what to do.");
    expect([needsOwner.exitCode, gaveUp.exitCode]).toEqual([4, 5]);
  });
});

describe("a watch of one task's own run", () => {
  const subject = { kind: "task", runId: ID.footer } as const;

  it("follows that task, and ends with the code its run ended with", () => {
    const [first, last] = looks([
      { ...snapshotOf({ list: [], records: [footerAt(3)] }), subject },
      { ...snapshotOf({ list: [], records: [footerAt(5, true)] }), subject },
    ]);

    expect(first?.lines.at(0)).toBe('Watching run fix-the-broken-footer-links-20261001T022000Z: "Fix the broken footer links". Ctrl-C stops watching; the run is not affected.');
    expect(last?.lines).toEqual([
      "02:23 Task \"Fix the broken footer links\": wrapping up.",
      "02:24 Task \"Fix the broken footer links\": done, merged into main.",
      "02:24 This run finished: 1 of 1 task completed and merged. Run `delivery report fix-the-broken-footer-links-20261001T022000Z` for what to do.",
    ]);
    expect(last?.exitCode).toBe(0);
  });
});

describe("a watch of a record made before steps carried a time", () => {
  const old = (steps: number) => recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: [BASELINE, ...attempt(1, "fixed the links"), PASSED].slice(0, steps) });

  it("drops the time from its lines, and says once that times were not recorded", () => {
    const [first, second, third] = looks([going([formDone, old(2)]), going([formDone, old(3)]), going([formDone, old(4)])]);

    expect(first?.lines).toContain('  Task 2 of 4: "Fix the broken footer links": the agent is working (attempt 1).');
    expect(first?.lines.at(-1)).toBe(TIMES_NOT_RECORDED);
    expect(second?.lines).toEqual(["Task 2 of 4: checking the agent's work."]);
    expect(third?.lines).toEqual(["Task 2 of 4: wrapping up."]);
  });
});

describe("a watch of a record that cannot be read", () => {
  it("names the damaged record and ends, rather than waiting on what it cannot follow", () => {
    const { lines, exitCode } = watchTick(undefined, snapshotOf({ subject: { kind: "task", runId: ID.footer }, damaged: [{ runId: ID.footer, file: ".delivery/runs/x/log.jsonl" }] }));

    expect(lines).toContain(`Incomplete report: the record of run ${ID.footer} is damaged (.delivery/runs/x/log.jsonl); nothing else could be read.`);
    expect(exitCode).toBe(0);
  });

  it("says so when the record becomes unreadable while it is watched, rather than ending without a word", () => {
    const subject = { kind: "task", runId: ID.footer } as const;

    const [, second] = looks([
      { ...snapshotOf({ list: [], records: [footerAt(3)] }), subject },
      snapshotOf({ subject, list: [], damaged: [{ runId: ID.footer, file: ".delivery/runs/x/log.jsonl" }] }),
    ]);

    expect(second?.lines).toEqual([`Incomplete report: the record of run ${ID.footer} is damaged (.delivery/runs/x/log.jsonl); nothing else could be read.`]);
    expect(second?.exitCode).toBe(0);
  });
});

describe("a watch as a stream of data", () => {
  const subject = { kind: "task", runId: ID.footer } as const;
  const footer = (steps: number, ended = false): RecordSnapshot => snapshotOf({ subject, list: [], records: [footerAt(steps, ended)] });

  /** Several looks in a row as a stream, each given what the one before remembered. */
  function stream(snapshots: RecordSnapshot[]): WatchTick[] {
    const ticks: WatchTick[] = [];
    for (const snapshot of snapshots) ticks.push(streamTick(ticks.at(-1)?.state, snapshot));
    return ticks;
  }
  /** Every line read back as the event it is: a line that is not one event fails here. */
  const eventsIn = (lines: string[]): ReportEvent[] => lines.map((line) => ReportEvent.parse(JSON.parse(line)));

  it("begins with a line saying what is followed, then gives every step recorded so far, one event to a line", () => {
    const { lines, exitCode } = streamTick(undefined, footer(3));

    expect(eventsIn(lines).map((event) => [event.type, event.seq])).toEqual([["stream_started", 0], ["surface_state", 0], ["surface_state", 1], ["surface_state", 2]]);
    expect(eventsIn(lines)[0]).toMatchObject({ schema: "delivery.event/1", subject: "task", surface: ID.footer, run: null });
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    expect(exitCode).toBeNull();
  });

  it("adds one event for each step recorded since the look before, and nothing when nothing was", () => {
    const [, second, third] = stream([footer(3), footer(4), footer(4)]);

    expect(eventsIn(second?.lines ?? []).map((event) => [event.type, event.seq])).toEqual([["surface_state", 3]]);
    expect(third?.lines).toEqual([]);
  });

  it("ends with a line saying how what it followed ended, and the code the watch in words ends with", () => {
    const [, last] = stream([footer(3), footer(5, true)]);

    expect(eventsIn(last?.lines ?? []).map((event) => event.type)).toEqual(["surface_state", "surface_state", "surface_outcome", "stream_ended"]);
    expect(eventsIn(last?.lines ?? []).at(-1)).toMatchObject({ ending: "ended", surfaceOutcome: "closed", at: "2026-10-01T02:24:30.000Z" });
    expect(last?.exitCode).toBe(watchTick(undefined, footer(5, true)).exitCode);
  });

  it("gives, for a finished task replayed, exactly the lines following it live gave", () => {
    const live = stream([footer(1), footer(2), footer(2), footer(4), footer(5), footer(5, true)]).flatMap((tick) => tick.lines);

    expect(streamTick(undefined, footer(5, true)).lines).toEqual(live);
  });

  it("gives, for a finished run of several tasks replayed, exactly the lines following it live gave", () => {
    const run = { kind: "run", runId: ID.run } as const;
    const drained = runFileOf(ID.run, fills, { kind: "drained", at: "2026-10-01T02:58:30.000Z" });
    const finished = snapshotOf({ subject: run, records: [formDone, footerAt(5, true)], runs: [drained] });

    const live = stream([{ ...going([formDone, footerAt(2)]), subject: run }, { ...going([formDone, footerAt(4)]), subject: run }, finished]);

    expect(streamTick(undefined, finished).lines).toEqual(live.flatMap((tick) => tick.lines));
    expect(eventsIn(live.at(-1)?.lines ?? []).slice(-2)).toMatchObject([{ type: "run_outcome", outcome: "drained" }, { type: "stream_ended", runOutcome: "drained", run: ID.run }]);
    expect(live.map((tick) => tick.exitCode)).toEqual([null, null, 0]);
  });

  describe("a task list a run of several tasks worked", () => {
    const stoppedFooter = recordOf({
      runId: ID.footer,
      task: FOOTER,
      closerRef: MERGE,
      history: timed([BASELINE, ...attempt(1, "I need the owner to confirm.", "authority")], "2026-10-01T02:20:00.000Z"),
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "authority", role: "worker" }),
    });

    it("gives, once the run gave up with a task unfinished, the lines following it live gave when replayed, and ends with that run's code", () => {
      const gaveUp = runFileOf(ID.run, fills, { kind: "escalated", cause: "shared_environment", reason: "the setup could not be repaired", at: "2026-10-01T03:17:00.000Z" });
      const finished = snapshotOf({ records: [formDone, footerAt(3)], runs: [gaveUp] });

      const live = stream([going([formDone, footerAt(2)]), going([formDone, footerAt(3)]), finished]);
      const replay = streamTick(undefined, finished);

      expect(replay.lines).toEqual(live.flatMap((tick) => tick.lines));
      expect(eventsIn(replay.lines).slice(-2)).toMatchObject([{ type: "run_outcome", outcome: "escalated" }, { type: "stream_ended", ending: "ended", run: ID.run, runOutcome: "escalated", surfaceOutcome: null }]);
      expect([...live.map((tick) => tick.exitCode), replay.exitCode]).toEqual([null, null, 4, 4]);
    });

    it("gives, once the run drained with a task stopped, the lines following it live gave when replayed: the run's outcome, and the stopped task's code", () => {
      const drained = runFileOf(ID.run, fills, { kind: "drained", at: "2026-10-01T02:58:30.000Z" });
      const finished = snapshotOf({ records: [formDone, stoppedFooter], runs: [drained] });

      const live = stream([going([formDone, footerAt(2)]), finished]);
      const replay = streamTick(undefined, finished);

      expect(replay.lines).toEqual(live.flatMap((tick) => tick.lines));
      expect(eventsIn(replay.lines).at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", run: ID.run, runOutcome: "drained", surfaceOutcome: null });
      expect([...live.map((tick) => tick.exitCode), replay.exitCode]).toEqual([null, 4, 4]);
    });

    it("says no run is its own, in a replay as it did live, once a task was worked on its own after the run: the old run is not in the stream, and the stream ends with the stop", () => {
      const older = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T02:10:00.000Z" });
      const finished = snapshotOf({ records: [formDone, stoppedFooter], runs: [older] });

      const live = stream([snapshotOf({ records: [formDone, footerAt(2)], runs: [older] }), finished]);
      const replay = streamTick(undefined, finished);
      const events = eventsIn(replay.lines);

      expect(replay.lines).toEqual(live.flatMap((tick) => tick.lines));
      expect(events[0]).toMatchObject({ type: "stream_started", subject: "list", run: null });
      expect(events.at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", run: null, runOutcome: null, surfaceOutcome: "escalated", at: "2026-10-01T02:58:00.000Z" });
      expect(events.filter((event) => event.run !== null || event.type === "run_outcome")).toEqual([]);
      expect([...live.map((tick) => tick.exitCode), replay.exitCode]).toEqual([null, 4, 4]);
    });
  });

  it("marks a list worked one task at a time as having no run of its own, and ends with the code `delivery run` ends with for that list", () => {
    const stopped = snapshotOf({ records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: attempt(1, "x"), outcome: stoppedAt("2026-10-01T02:58:00.000Z", undefined) })] });

    const { lines, exitCode } = streamTick(undefined, stopped);

    expect(eventsIn(lines)[0]).toMatchObject({ type: "stream_started", subject: "list", run: null, surface: null });
    expect(eventsIn(lines).at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", runOutcome: null, surfaceOutcome: "escalated" });
    expect(exitCode).toBe(4);
  });

  it("says a run known to have been stopped part way ended that way, and a record that cannot be read as unreadable, both ok", () => {
    const killed = streamTick(undefined, { ...going([formDone, footerAt(3)]), live: false });
    const damaged = streamTick(undefined, snapshotOf({ subject, damaged: [{ runId: ID.footer, file: ".delivery/runs/x/log.jsonl" }] }));

    expect(eventsIn(killed.lines).at(-1)).toMatchObject({ type: "stream_ended", ending: "stopped_part_way" });
    expect(eventsIn(damaged.lines).map((event) => event.type)).toEqual(["stream_started", "stream_ended"]);
    expect(eventsIn(damaged.lines).at(-1)).toMatchObject({ ending: "unreadable" });
    expect([killed.exitCode, damaged.exitCode]).toEqual([0, 0]);
  });

  it("keeps waiting, saying nothing, where nothing records whether the work is still going", () => {
    const [first, second] = stream([snapshotOf({ records: [formDone, footerAt(3)] }), snapshotOf({ records: [formDone, footerAt(3)] })]);

    expect(eventsIn(first?.lines ?? []).at(-1)?.type).toBe("surface_state");
    expect(second?.lines).toEqual([]);
    expect([first?.exitCode, second?.exitCode]).toEqual([null, null]);
  });

  it("is a start and an end with nothing between, for a folder that holds no run to follow", () => {
    expect(eventsIn(emptyStream(snapshotOf({ records: [] }))).map((event) => [event.type, "ending" in event ? event.ending : null])).toEqual([
      ["stream_started", null],
      ["stream_ended", "nothing_recorded"],
    ]);
  });
});
