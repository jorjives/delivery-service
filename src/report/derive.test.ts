import { describe, expect, it } from "vitest";
import { ReportDocument, stepOf } from "./document.js";
import { deriveReport, mostRecentSubject } from "./derive.js";
import type { OutcomeCause } from "../schema.js";
import type { RecordSnapshot } from "./snapshot.js";
import { attempt, BANNER, BRIEF, closedAt, failedCheck, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, ID, PACKET, recordOf, runFileOf, snapshotOf, stoppedAt, timed } from "./report-fixtures.js";

describe("a report on the project's task list", () => {
  it("stands each task as its latest run left it, and a task with no run as not started", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(doc.kind).toBe("list");
    expect(doc.surfaces.map((surface) => [surface.queue?.task, surface.task, surface.standing, surface.run])).toEqual([
      [1, FORM, "closed", ID.form],
      [2, FOOTER, "escalated", ID.footer],
      [3, HOMEPAGE, "not_started", null],
      [4, BANNER, "not_started", null],
    ]);
    expect(doc.counts).toEqual({ closed: 1, escalated: 1, aborted: 0, paused: 0, unfinished: 0, queued: 0, not_started: 2 });
  });

  it("invents no run for a list worked one task at a time, and knows it is not going once every run has ended", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(doc.run).toBeNull();
    expect(doc.live).toBe(false);
  });

  it("does not claim to know whether a task with no outcome is still going", () => {
    expect(deriveReport(snapshotOf({ records: [formDone, footerWorking] })).live).toBeNull();
  });

  it("takes the newest run of a task as the one that answers for it", () => {
    const again = recordOf({ runId: "fix-the-broken-footer-links-20261002T090000Z", task: FOOTER, history: attempt(1, "fixed"), outcome: closedAt("2026-10-02T09:10:00.000Z") });

    const doc = deriveReport(snapshotOf({ records: [footerFailed, again] }));

    expect(doc.surfaces[1]).toMatchObject({ run: again.runId, standing: "closed" });
  });

  it("validates against its own schema, with every key present", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(ReportDocument.parse(doc)).toEqual(doc);
    expect(Object.keys(doc.surfaces[2] ?? {}).sort()).toEqual(Object.keys(doc.surfaces[0] ?? {}).sort());
  });
});

describe("what a report says of one task", () => {
  const [, failed] = deriveReport(snapshotOf({ records: [formDone, footerFailed] })).surfaces;

  it("counts how many times the agent was set to work, and the retries the log shows", () => {
    expect(failed?.attempts).toBe(4);
    expect(failed?.budgets).toEqual([
      { population: "correction", used: 3, max: 3 },
      { population: "gateError", used: 0, max: 3 },
      { population: "gateMaintenance", used: 0, max: 2 },
      { population: "terminus", used: 0, max: 5 },
      { population: "close", used: 0, max: 3 },
    ]);
  });

  it("carries the recorded reason and cause, and the stop in the owner's words", () => {
    expect(failed).toMatchObject({
      reason: "correction budget exhausted (3/3)",
      cause: { kind: "budget", population: "correction" },
      finishedAt: "2026-10-01T02:58:00.000Z",
      startedAt: "2026-10-01T02:20:00Z",
      plain: { group: "failed_after_attempts", audience: "owner", agentSaid: "I fixed 4 of the 6 links.\nThe other 2 point at pages that no longer exist." },
    });
  });

  it("says how the task lands its work, and where", () => {
    expect(failed).toMatchObject({ closer: "merge-back", branch: `surface/${ID.footer}`, base: "main" });
  });

  it("reads a record that pinned no closer as committed to its own branch, as such runs were", () => {
    const old = recordOf({ runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

    expect(deriveReport(snapshotOf({ records: [old] })).surfaces[0]?.closer).toBe("commit-to-branch");
  });

  it("gives a delivered task no plain block: there is nothing to act on", () => {
    expect(deriveReport(snapshotOf({ records: [formDone] })).surfaces[0]?.plain).toBeNull();
  });

  it("quotes nothing as the agent's when its last session ended without a result", () => {
    const cutOff = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [
        ...attempt(1, "an earlier explanation"),
        { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" },
        { t: "terminus", role: "worker", attempt: 2, sessionKey: "worker-2-0", status: "incomplete", rationale: "the AI service is limiting requests", limit: "rate" },
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "terminus" }),
    });

    const [, surface] = deriveReport(snapshotOf({ records: [formDone, cutOff] })).surfaces;

    expect(surface?.plain?.agentSaid).toBeNull();
    expect(surface?.limit).toBe("rate");
    expect(surface?.plain?.sentence).toBe("Stopped because a usage limit was reached: the AI service is limiting requests.");
  });

  it("groups a stop recorded before causes were as stopped, with the recorded reason and no advice", () => {
    const old = recordOf({ runId: ID.footer, task: FOOTER, history: attempt(1, "I gave up"), outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)") });

    const [, surface] = deriveReport(snapshotOf({ records: [formDone, old] })).surfaces;

    expect(surface).toMatchObject({ cause: null, reason: "correction budget exhausted (3/3)", plain: { group: "stopped", audience: "unknown", next: [] } });
  });
});

describe("what a report says of how a task got where it is", () => {
  const refs = {
    [ID.footer]: {
      "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
      "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
      "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET, cause: { kind: "budget", population: "correction" } },
    },
  };
  const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [footerFailed], refs }));
  const [failed] = doc.surfaces;

  it("lists every triage round, oldest first, in the harness's own words", () => {
    expect(failed?.decisions.map((round) => [round.afterAttempt, round.trigger, round.verdict, round.rationale])).toEqual([
      [1, "gate_fail", "reroute", "gate_fail: reroute"],
      [2, "gate_fail", "reroute", "gate_fail: reroute"],
      [3, "gate_fail", "reroute", "gate_fail: reroute"],
      [4, "gate_fail", "escalate", "gate_fail: escalate"],
    ]);
  });

  it("carries the brief a round wrote for the next session, and the packet a round wrote for a person", () => {
    expect(failed?.decisions[0]).toMatchObject({ recorded: true, brief: BRIEF, packet: null });
    expect(failed?.decisions[3]).toMatchObject({ recorded: true, brief: null, packet: PACKET });
    expect(ReportDocument.parse(doc)).toEqual(doc);
  });

  it("tells a round that wrote neither from a round whose ref is not there or is not what a round writes", () => {
    expect(failed?.decisions[1]).toMatchObject({ recorded: true, brief: null, packet: null });
    expect(failed?.decisions[2]).toMatchObject({ recorded: false, brief: null, packet: null });

    const garbled = { [ID.footer]: { "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: { problem: 7 } } } };
    const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [footerFailed], refs: garbled })).surfaces;
    expect(surface?.decisions[0]).toMatchObject({ recorded: false, brief: null, packet: null });
  });

  it("has no rounds for a task nothing set back, and none for a task with no run", () => {
    const quiet = deriveReport(snapshotOf({ records: [formDone] }));

    expect(quiet.surfaces.map((surface) => surface.decisions)).toEqual([[], [], [], []]);
  });

  it("names the state the record is in, and none for a task with no run", () => {
    const working = recordOf({ runId: ID.footer, task: FOOTER, history: attempt(1, "first go"), state: "GATING" });

    const [, going, notStarted] = deriveReport(snapshotOf({ records: [formDone, working] })).surfaces;

    expect(going?.state).toBe("GATING");
    expect(notStarted?.state).toBeNull();
  });
});

describe("a report on a run of several tasks at once", () => {
  const working = footerWorking;
  const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);

  it("stands its tasks as the run's own view does, with the tasks still to take waiting", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone, working], runs: [going] }));

    expect(doc.surfaces.map((surface) => [surface.queue?.task, surface.standing])).toEqual([[1, "closed"], [2, "unfinished"], [3, "queued"], [4, "queued"]]);
    expect(doc.live).toBe(true);
    expect(doc.run).toMatchObject({ runId: ID.run, startedAt: "2026-10-01T02:00:00Z", concurrency: 2, outcome: null, finishedAt: null });
  });

  it("is not going when nothing holds the repository, even though it has not finished", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: false, records: [formDone, working], runs: [going] }));

    expect(doc.live).toBe(false);
  });

  it("is never going once it has an outcome, whoever holds the repository now", () => {
    const drained = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" });

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone], runs: [drained] }));

    expect(doc.live).toBe(false);
    expect(doc.run).toMatchObject({ outcome: "drained", finishedAt: "2026-10-01T05:47:00.000Z", cause: null, reason: null });
  });

  it("says why the run itself stopped, and how many shared repairs it used", () => {
    const gaveUp = runFileOf(
      ID.run,
      [
        fill(1, ID.form, FORM),
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.form, reason: "the check cannot run" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1", surfaceId: ID.form },
        { t: "repair_terminus", attempt: 1, sessionKey: "repair-1", status: "incomplete", rationale: "limited" },
        { t: "run_escalated", reason: "the repair could not run", limit: "spend" },
      ],
      { kind: "escalated", cause: "usage_limit", reason: "the repair could not run", at: "2026-10-01T02:30:00.000Z" },
    );

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [], runs: [gaveUp] }));

    expect(doc.run).toMatchObject({ outcome: "escalated", cause: "usage_limit", limit: "spend", reason: "the repair could not run", runBudgets: { gateMaintenance: { used: 1, max: 2 } } });
  });

  it("is the run a list report names once it took one of the list's tasks", () => {
    const drained = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" });

    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed], runs: [drained] }));

    expect(doc.kind).toBe("list");
    expect(doc.run?.runId).toBe(ID.run);
    expect(doc.live).toBe(false);
  });

  it("gives a list report its tasks' standings while it is going", () => {
    const doc = deriveReport(snapshotOf({ live: true, records: [formDone, working], runs: [going] }));

    expect(doc.live).toBe(true);
    expect(doc.surfaces.map((surface) => surface.standing)).toEqual(["closed", "unfinished", "queued", "queued"]);
  });
});

describe("what a stop left for a person", () => {
  const stopped = recordOf({
    runId: ID.footer,
    task: FOOTER,
    history: attempt(1, "I need the owner to confirm.", "authority"),
    outcome: { ...stoppedAt("2026-10-01T02:58:00.000Z", { kind: "authority", role: "worker" }), packetRef: "escalation" },
  });
  const surfaces = (refs: Record<string, unknown>) => deriveReport(snapshotOf({ records: [formDone, stopped], refs })).surfaces;

  it("is carried word for word: the packet the stopped task's record points at", () => {
    expect(surfaces({ [ID.footer]: { escalation: PACKET } })[1]?.escalation).toEqual(PACKET);
  });

  it("is null, never missing, for a task that left none: one delivered, one not started, one whose packet is not there or is not a packet", () => {
    expect(surfaces({ [ID.footer]: { escalation: PACKET } }).map((surface) => surface.escalation === null)).toEqual([true, false, true, true]);
    expect(surfaces({})[1]?.escalation).toBeNull();
    expect(surfaces({ [ID.footer]: { escalation: { decision: 7 } } })[1]?.escalation).toBeNull();
  });
});

describe("why a task stopped, as the document tells it", () => {
  const causeOf = (cause: OutcomeCause | undefined) =>
    deriveReport(snapshotOf({ records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, history: attempt(1, "x"), outcome: stoppedAt("2026-10-01T02:58:00.000Z", cause) })] })).surfaces[1]?.cause;

  it("names every key, null where its kind has none, so a reader never meets a missing one", () => {
    expect(causeOf({ kind: "authority", role: "worker" })).toEqual({ kind: "authority", role: "worker", population: null });
    expect(causeOf({ kind: "budget", population: "correction" })).toEqual({ kind: "budget", role: null, population: "correction" });
    expect(causeOf({ kind: "provisioning" })).toEqual({ kind: "provisioning", role: null, population: null });
  });

  it("is null for a task that stopped before causes were recorded", () => {
    expect(causeOf(undefined)).toBeNull();
  });
});

describe("what a report says of the setup a run's tasks share", () => {
  const troubled = runFileOf(ID.run, [
    fill(1, ID.form, FORM),
    { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.form, reason: "the check cannot run" } },
    { t: "held", surfaceId: ID.form },
    { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1", surfaceId: ID.form },
  ]);
  const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [footerWorking], runs: [troubled] }));

  it("says how it stands now", () => {
    expect(doc.run?.breaker).toBe("REPAIRING");
    expect(deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone], runs: [runFileOf(ID.run, [fill(1, ID.form, FORM)])] })).run?.breaker).toBe("HEALTHY");
  });

  it("tells each time it broke: why, which tasks were held, and every repair tried", () => {
    expect(doc.trips).toEqual([
      {
        cause: { kind: "gate_maintenance", surfaceId: ID.form, reason: "the check cannot run", surfaceIds: null },
        held: [ID.form],
        repairs: [{ attempt: 1, sessionKey: "repair-1", surfaceId: ID.form, status: null, rationale: null }],
        ended: null,
        reason: null,
        limit: null,
      },
    ]);
    expect(ReportDocument.parse(doc)).toEqual(doc);
  });

  it("gives a trip's cause every key, null where its kind has none, so a reader never meets a missing one", () => {
    const aggregate = runFileOf(ID.run, [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
      { t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId: ID.form, surfaceIds: [ID.form, ID.footer] } },
    ]);
    const { trips } = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [footerWorking], runs: [aggregate] }));

    expect(trips[0]?.cause).toEqual({ kind: "gate_error_aggregate", surfaceId: ID.form, surfaceIds: [ID.form, ID.footer], reason: null });
    expect(doc.trips[0]?.cause).toEqual({ kind: "gate_maintenance", surfaceId: ID.form, reason: "the check cannot run", surfaceIds: null });
  });

  it("tells of none, as an empty list, where no run of several tasks is reported", () => {
    expect(deriveReport(snapshotOf({ records: [formDone, footerFailed] })).trips).toEqual([]);
  });
});

describe("which run a task list's standing belongs to", () => {
  const drained = runFileOf(ID.run, [fill(1, ID.form, FORM)], { kind: "drained", at: "2026-10-01T02:30:00.000Z" });
  const governs = (over: Partial<RecordSnapshot>) => deriveReport(snapshotOf(over)).run?.governs;

  it("is the run's own while it is going, and once it has ended, so long as no task of the list was worked on its own since", () => {
    expect(governs({ live: true, records: [formDone], runs: [runFileOf(ID.run, [fill(1, ID.form, FORM)])] })).toBe(true);
    expect(governs({ records: [formDone], runs: [drained] })).toBe(true);
  });

  it("is no longer the run's once a task of the list has been worked on its own since the run began, whether or not that record can be read", () => {
    expect(governs({ records: [formDone, footerFailed], runs: [drained] })).toBe(false);
    expect(governs({ records: [formDone], damaged: [{ runId: ID.footer, file: ".delivery/runs/x/log.jsonl", taskDef: { intent: FOOTER } }], runs: [drained] })).toBe(false);
  });

  it("is not undone by a task worked on its own before the run began, or by one the run took itself", () => {
    const before = recordOf({ runId: "fix-the-broken-footer-links-20260930T120000Z", task: FOOTER, history: attempt(1, "x"), outcome: stoppedAt("2026-09-30T12:30:00.000Z", undefined) });

    expect(governs({ records: [formDone, before], runs: [drained] })).toBe(true);
  });

  it("is always the run's in a report on the run itself", () => {
    expect(deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone, footerFailed], runs: [drained] })).run?.governs).toBe(true);
  });
});

describe("a report on one task's run", () => {
  it("reports that task alone, with its place on the list", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [formDone, footerFailed] }));

    expect(doc.kind).toBe("task");
    expect(doc.surfaces.map((surface) => [surface.run, surface.queue])).toEqual([[ID.footer, { task: 2, of: 4 }]]);
    expect(doc.live).toBe(false);
  });

  it("treats a task the list does not ask for as typed by hand", () => {
    const adHoc = recordOf({ runId: ID.homepage, task: "something else", history: attempt(1, "no"), outcome: stoppedAt("2026-10-01T03:10:00.000Z", { kind: "budget", population: "correction" }) });

    const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.homepage }, records: [adHoc] })).surfaces;

    expect(surface?.queue).toBeNull();
    expect(surface?.plain?.next).toEqual(['Reword the task and run it again: delivery run --task "the reworded task"']);
  });

  it("knows an unfinished task is going only when a run of several that took it holds the repository", () => {
    const working = footerWorking;
    const going = runFileOf(ID.run, [fill(1, ID.footer, FOOTER)]);
    const subject = { kind: "task", runId: ID.footer } as const;

    expect(deriveReport(snapshotOf({ subject, live: true, records: [working], runs: [going] })).live).toBe(true);
    expect(deriveReport(snapshotOf({ subject, live: false, records: [working], runs: [] })).live).toBeNull();
  });
});

describe("a damaged record", () => {
  const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };

  it("is named with its file and its place on the list, and leaves the other tasks reported", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone], damaged: [damaged] }));

    expect(doc.incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: { task: 2, of: 4 } }]);
    expect(doc.surfaces.map((surface) => surface.queue?.task)).toEqual([1, 3, 4]);
  });

  it("is passed over when a newer run of the same task reads back", () => {
    const again = recordOf({ runId: "fix-the-broken-footer-links-20261002T090000Z", task: FOOTER, history: attempt(1, "fixed"), outcome: closedAt("2026-10-02T09:10:00.000Z") });

    const doc = deriveReport(snapshotOf({ records: [formDone, again], damaged: [damaged] }));

    expect(doc.incomplete).toEqual([]);
    expect(doc.surfaces[1]).toMatchObject({ run: again.runId, standing: "closed" });
  });

  it("is still named when too damaged to say which task it was for", () => {
    const unknown = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/case.json` };

    expect(deriveReport(snapshotOf({ records: [formDone], damaged: [unknown] })).incomplete).toEqual([{ run: ID.footer, file: unknown.file, queue: null }]);
  });

  it("makes a report on that run alone an incomplete report of nothing, not a failure", () => {
    const doc = deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, damaged: [damaged] }));

    expect(doc.surfaces).toEqual([]);
    expect(doc.incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: { task: 2, of: 4 } }]);
  });

  it("is left out of a run of several that took it, and named instead", () => {
    const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);

    const doc = deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone], runs: [going], damaged: [damaged] }));

    expect(doc.incomplete.map((record) => record.run)).toEqual([ID.footer]);
    expect(doc.surfaces.map((surface) => surface.queue?.task)).toEqual([1, 3, 4]);
  });
});

describe("when a report says things happened", () => {
  const steps = timed([{ t: "baseline", status: "PASS" } as const, ...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go").slice(0, 1)], "2026-10-01T02:20:00.000Z");
  const surfaceOf = (history: typeof steps | ReturnType<typeof attempt>, outcome?: ReturnType<typeof closedAt>) =>
    deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [recordOf({ runId: ID.footer, task: FOOTER, history, ...(outcome ? { outcome } : {}) })] })).surfaces[0];

  it("lists every step the log shows the task entering, oldest first, each with the time it was entered", () => {
    expect(surfaceOf(steps)?.states).toEqual([
      { state: "AGENT_ACTIVE", at: "2026-10-01T02:20:00.000Z" },
      { state: "GATING", at: "2026-10-01T02:22:00.000Z" },
      { state: "TRIAGE", at: "2026-10-01T02:23:00.000Z" },
      { state: "AGENT_ACTIVE", at: "2026-10-01T02:24:00.000Z" },
    ]);
  });

  it("shows an agent set to work as working, where picking the run up would treat it as a session that died", () => {
    const working = surfaceOf(steps.slice(0, 2));

    expect(working?.states.at(-1)?.state).toBe("AGENT_ACTIVE");
    expect(working && stepOf(working)).toEqual({ state: "AGENT_ACTIVE", at: "2026-10-01T02:20:00.000Z" });
  });

  it("holds the steps with no time for a record made before steps carried one", () => {
    const old = surfaceOf(attempt(1, "first go"));

    expect(old?.states).toEqual([{ state: "AGENT_ACTIVE", at: null }, { state: "GATING", at: null }]);
    expect(old?.lastActivityAt).toBeNull();
  });

  it("falls back to the step the record was created in before any step is logged, and to nothing for a task with no run", () => {
    const [created, , notStarted] = deriveReport(snapshotOf({ records: [recordOf({ runId: ID.form, task: FORM })] })).surfaces;

    expect(created && stepOf(created)).toEqual({ state: "PROVISIONING", at: null });
    expect(notStarted && stepOf(notStarted)).toBeNull();
  });

  it("takes the latest time a task's record holds as its last activity: its last step, then its outcome once it has ended", () => {
    expect(surfaceOf(steps)?.lastActivityAt).toBe("2026-10-01T02:25:00.000Z");
    expect(surfaceOf(steps, closedAt("2026-10-01T02:40:00.000Z"))?.lastActivityAt).toBe("2026-10-01T02:40:00.000Z");
  });

  it("gives a run of several tasks the latest time its own log or any task it took holds", () => {
    const runOf = (fills: Parameters<typeof runFileOf>[1]) =>
      deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, history: steps })], runs: [runFileOf(ID.run, fills)] })).run;

    expect(runOf([fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)])?.lastActivityAt).toBe("2026-10-01T02:25:00.000Z");
    expect(runOf(timed([fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], "2026-10-01T03:00:00.000Z"))?.lastActivityAt).toBe("2026-10-01T03:01:00.000Z");
    expect(runOf([fill(1, ID.homepage, HOMEPAGE)])?.lastActivityAt).toBeNull();
  });
});

describe("the run a project with no task list is told about", () => {
  it("is the one started most recently, a run of several counting once", () => {
    const run = runFileOf(ID.run, [fill(1, ID.form, FORM)]);

    expect(mostRecentSubject(snapshotOf({ list: [], records: [formDone, footerFailed], runs: [run] }))).toEqual({ kind: "task", runId: ID.footer });
    expect(mostRecentSubject(snapshotOf({ list: [], records: [formDone], runs: [run] }))).toEqual({ kind: "run", runId: ID.run });
  });

  it("is a damaged record when that is the newest run, rather than an older run passed off as the latest", () => {
    const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };
    const snapshot = snapshotOf({ list: [], records: [formDone], damaged: [damaged] });

    expect(mostRecentSubject(snapshot)).toEqual({ kind: "task", runId: ID.footer });
    expect(deriveReport({ ...snapshot, subject: { kind: "task", runId: ID.footer } }).incomplete).toEqual([{ run: ID.footer, file: damaged.file, queue: null }]);
  });

  it("is nothing when the folder holds no run at all", () => {
    expect(mostRecentSubject(snapshotOf({ list: [] }))).toBeUndefined();
  });
});

describe("determinism", () => {
  it("gives the same document for the same snapshot", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed] });

    expect(deriveReport(snapshot)).toEqual(deriveReport(structuredClone(snapshot)));
  });
});
