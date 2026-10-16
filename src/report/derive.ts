import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { breakerOf, repairsUsed, tripsOf } from "../breaker.js";
import { deriveBudgetsFromLog, deriveStateFromEntry } from "../case-file.js";
import { branchName } from "../provision.js";
import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
import { CloserRef, Population, RepairChanges, type HistoryEntry, type RepairStatus, type RunEntry, type RunFile, type SessionUsage, type TaskDef, type Trip } from "../schema.js";
import { claimedBy, supervisedView } from "../supervised-view.js";
import { findQueueRun, queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
import { guardChanges } from "../task-guards.js";
import { currentStep, stepIndexOf, stepView } from "../workflow-step.js";
import { BriefRef } from "../prompt-assembly.js";
import { PacketRef } from "../surface.js";
import { EscalationPacket } from "../triage-role-config.js";
import { latestOf, REPORT_SCHEMA, ReportSurface, Standing, type DamagedRecord, type Decision, type ReportDocument, type ReportRepair, type ReportRun, type ReportTrip, type StateVisit } from "./document.js";
import { plainOf } from "./plain.js";
import type { DamagedFile, RecordSnapshot, ReportSubject } from "./snapshot.js";

/** What a review's fix pins about landing, read structurally so the report needs nothing from the packs module. */
const PinnedRelease = z.object({ authorisation: z.object({ hold: z.boolean().optional(), landing: CloserRef.optional() }) });

/**
 * How a run's work landed. A review's fix runs through the harness's own
 * finding closer, which keeps a held fix on its branch and lands the rest the
 * project's way, so that delegated closer is what is reported.
 */
function landingOf(header: RunRecord["caseFile"]["header"]): NonNullable<ReportSurface["closer"]> {
  // A run that pinned no closer predates closers being pinned, and was committed to its branch.
  const closer = header.closerRef ?? { type: "commit-to-branch" as const };
  if (closer.type !== "custom" || !/finding-closer\.[jt]s$/.test(closer.modulePath)) return closer.type;
  const release = PinnedRelease.safeParse(header.taskDef).data?.authorisation;
  return release === undefined || release.hold === true || release.landing === undefined ? "commit-to-branch" : release.landing.type;
}

/** A repair as the document tells it, from how it was set going, how it ended, and the refs of the folder it was recorded in. */
function repairOf(
  of: ReportRepair["of"],
  start: { attempt: number; at?: string | undefined },
  max: number,
  end: { status: RepairStatus; changesRef?: string | undefined } | undefined,
  refs: Record<string, unknown>,
): ReportRepair {
  const held = end?.changesRef === undefined ? undefined : RepairChanges.safeParse(refs[end.changesRef]);
  const changes = held?.success ? held.data : undefined;
  return {
    of,
    attempt: start.attempt,
    max,
    at: start.at ?? null,
    status: end?.status ?? null,
    recorded: changes !== undefined,
    files: (changes?.files ?? []).map(({ patch, ...file }) => ({ ...file, patch: patch ?? null })),
    truncated: changes?.truncated ?? false,
  };
}

/**
 * Every repair that ran in one task's working copy, oldest first: its own,
 * each dispatch a burn on its limit, and every run's repair of the shared setup
 * that ran in its copy. Each paired with its end by session key.
 */
function repairsOf(snapshot: RecordSnapshot, record: RunRecord): ReportRepair[] {
  const { history, cursor } = record.caseFile;
  const refs = snapshot.refs[record.runId] ?? {};
  const own = history
    .filter((entry): entry is Extract<HistoryEntry, { t: "dispatch" }> => entry.t === "dispatch" && entry.role === "gate-maintenance")
    .map((dispatch, index) => {
      const end = history.find((entry): entry is Extract<HistoryEntry, { t: "terminus" }> => entry.t === "terminus" && entry.sessionKey === dispatch.sessionKey);
      return repairOf("check", { attempt: index + 1, at: dispatch.at }, cursor.budgets.gateMaintenance.max, end, refs);
    });
  const setup = snapshot.runs.flatMap((run) =>
    run.history
      .filter((entry): entry is Extract<RunEntry, { t: "repair_dispatch" }> => entry.t === "repair_dispatch" && entry.surfaceId === record.runId)
      .map((dispatch) => {
        const end = run.history.find((entry): entry is Extract<RunEntry, { t: "repair_terminus" }> => entry.t === "repair_terminus" && entry.sessionKey === dispatch.sessionKey);
        return repairOf("setup", dispatch, run.header.runBudgetMax.gateMaintenance, end, snapshot.refs[run.header.runId] ?? {});
      }),
  );
  // A stable sort: a record from before steps carried a time keeps its own order, the task's repairs before its runs'.
  return [...own, ...setup].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

export type UsagePart = Pick<ReportSurface, "usage" | "usageRecorded">;

const NO_SESSIONS: UsagePart = { usage: null, usageRecorded: { recorded: 0, sessions: 0 } };

/** One agent session's figure: recorded only when the runtime reported both its cost and its time, since half a figure is not the whole. */
export function sessionUsage(usage: SessionUsage | undefined): UsagePart {
  return usage?.costUsd !== undefined && usage.durationMs !== undefined
    ? { usage: { costUsd: usage.costUsd, durationMs: usage.durationMs }, usageRecorded: { recorded: 1, sessions: 1 } }
    : { usage: null, usageRecorded: { recorded: 0, sessions: 1 } };
}

/** Several figures as one: summed over the sessions that recorded one, every session counted. Null, never zero, when none did. */
export function addUp(parts: readonly UsagePart[]): UsagePart {
  return parts.reduce<UsagePart>(
    (total, part) => ({
      usage:
        part.usage === null
          ? total.usage
          : total.usage === null
            ? part.usage
            : { costUsd: total.usage.costUsd + part.usage.costUsd, durationMs: total.usage.durationMs + part.usage.durationMs },
      usageRecorded: {
        recorded: total.usageRecorded.recorded + part.usageRecorded.recorded,
        sessions: total.usageRecorded.sessions + part.usageRecorded.sessions,
      },
    }),
    NO_SESSIONS,
  );
}

/**
 * Every agent session of one task, in log order: each it set going, paired with
 * its end by session key (a session still going has none yet), and each triage
 * round an agent decided. A round the rules decided ran no session.
 */
function taskUsage(history: readonly HistoryEntry[]): UsagePart {
  return addUp(
    history.flatMap((entry) => {
      if (entry.t === "dispatch") {
        const end = history.find((candidate): candidate is Extract<HistoryEntry, { t: "terminus" }> => candidate.t === "terminus" && candidate.sessionKey === entry.sessionKey);
        // A session the runtime never started (`notRun`) ran nothing that could cost anything: it is no session.
        return end?.notRun ? [] : [sessionUsage(end?.usage)];
      }
      return entry.t === "triage" && entry.usage !== undefined ? [sessionUsage(entry.usage)] : [];
    }),
  );
}

/** A run's own agent sessions: each repair of the setup its tasks share, paired with its end by session key. */
function runUsage(run: RunFile): UsagePart {
  return addUp(
    run.history.flatMap((entry) => {
      if (entry.t !== "repair_dispatch") return [];
      const end = run.history.find((candidate): candidate is Extract<RunEntry, { t: "repair_terminus" }> => candidate.t === "repair_terminus" && candidate.sessionKey === entry.sessionKey);
      return [sessionUsage(end?.usage)];
    }),
  );
}

const Tags = ReportSurface.shape.tags.unwrap();
/** A task's tags as the document carries them: only plain values, so a reader can rely on them; anything else is null. */
const tagsOf = (taskDef: TaskDef): ReportSurface["tags"] => Tags.safeParse(taskDef.tags).data ?? null;

/** A task with no run of its own yet: every fact about a run is null. */
function withoutRun(taskDef: TaskDef, queue: QueuePosition | null, standing: Standing): ReportSurface {
  return {
    run: null,
    task: taskIntent(taskDef),
    tags: tagsOf(taskDef),
    queue,
    standing,
    state: null,
    states: [],
    startedAt: null,
    finishedAt: null,
    lastActivityAt: null,
    reason: null,
    cause: null,
    closer: null,
    branch: null,
    base: null,
    fence: null,
    guards: guardChanges(taskDef),
    workflow: null,
    attempts: 0,
    budgets: [],
    decisions: [],
    repairs: [],
    ...NO_SESSIONS,
    limit: null,
    escalation: null,
    plain: null,
  };
}

/**
 * Every triage round of one record, oldest first, with what each produced. The
 * round's ref is asked the same two questions the harness asks it (`BriefRef`,
 * `PacketRef`), so a report and the next session cannot read it differently.
 */
function decisionsOf(record: RunRecord, refs: Record<string, unknown>): Decision[] {
  return record.caseFile.history.flatMap((entry) => {
    if (entry.t !== "triage") return [];
    const ref = refs[entry.artifactRef];
    const brief = BriefRef.safeParse(ref);
    const packet = PacketRef.safeParse(ref);
    // A round always writes its ref, with `artifact` only when it produced one: a ref with none is a round that wrote none.
    const wroteNeither = typeof ref === "object" && ref !== null && !("artifact" in ref);
    return [
      {
        afterAttempt: entry.afterAttempt,
        trigger: entry.trigger,
        verdict: entry.verdict,
        rationale: entry.rationale,
        recorded: brief.success || packet.success || wroteNeither,
        brief: brief.success ? brief.data.artifact : null,
        packet: packet.success ? packet.data.artifact : null,
      },
    ];
  });
}

/** A trip as the document tells it: the cause names every key, with null where its kind has none. */
const tripOf = ({ cause, ...trip }: Trip): ReportTrip => ({
  ...trip,
  cause: {
    kind: cause.kind,
    surfaceId: cause.surfaceId,
    reason: cause.kind === "gate_maintenance" ? cause.reason : null,
    surfaceIds: cause.kind === "gate_error_aggregate" ? cause.surfaceIds : null,
  },
});

/** The packet a task stopped with, as the run wrote it beside its outcome; null when it wrote none or it cannot be read back. */
function packetOf(packetRef: string | undefined, refs: Record<string, unknown>): EscalationPacket | null {
  if (packetRef === undefined) return null;
  const packet = EscalationPacket.safeParse(refs[packetRef]);
  return packet.success ? packet.data : null;
}

/**
 * The step a task is in once `entry` is recorded, by the fold resuming uses, with one difference: an agent set to
 * work is working. Resuming reads a session with no answer as one that died, which is a judgement about a run that
 * has stopped, not a fact about one that is going.
 */
export function stateAfter(entry: HistoryEntry): StateVisit["state"] {
  return entry.t === "dispatch" && (entry.role ?? "worker") === "worker" ? "AGENT_ACTIVE" : deriveStateFromEntry(entry);
}

/** Every step the log shows a task entering, oldest first, each with the time of the entry that put it there. */
function statesOf(history: readonly HistoryEntry[]): StateVisit[] {
  const visits: StateVisit[] = [];
  for (const entry of history) {
    const state = stateAfter(entry);
    if (visits.at(-1)?.state !== state) visits.push({ state, at: entry.at ?? null });
  }
  return visits;
}

/** The latest time one task's record holds. */
const lastActivityOf = (record: RunRecord): string | null => latestOf([record.caseFile.outcome?.at, ...record.caseFile.history.map((entry) => entry.at)]);

/** One task from its own record. The retries are the log's, by the fold resuming uses, so a report and a resume cannot disagree. */
function withRun(snapshot: RecordSnapshot, record: RunRecord, queue: QueuePosition | null, standing: Standing): ReportSurface {
  const { header, history, outcome, cursor } = record.caseFile;
  // Budgets and attempts are the current step's, as the run itself judges them. A run with no workflow projects to itself.
  const view = stepView(record.caseFile);
  const step = currentStep(record.caseFile);
  const budgets = deriveBudgetsFromLog(view.history, cursor.budgets);
  const lastSession = history.findLast((entry) => entry.t === "terminus");
  const attempts = view.history.filter((entry) => entry.t === "dispatch" && (entry.role ?? "worker") === "worker").length;
  const limit = lastSession?.limit ?? null;
  const cause = outcome?.cause ?? null;
  // A session that ended without a result has no words of the agent's: its rationale is the harness's own.
  const agentSaid = lastSession !== undefined && lastSession.status !== "incomplete" && lastSession.rationale.trim() !== "" ? lastSession.rationale : null;
  return {
    run: record.runId,
    task: taskIntent(header.taskDef),
    tags: tagsOf(header.taskDef),
    queue,
    standing,
    state: cursor.state,
    states: statesOf(history),
    startedAt: startedInstant(record.runId),
    finishedAt: outcome?.at ?? null,
    lastActivityAt: lastActivityOf(record),
    reason: outcome?.reason ?? null,
    cause: cause === null ? null : { kind: cause.kind, role: cause.role ?? null, population: cause.population ?? null, pullRequest: cause.pullRequest ?? null, question: cause.question ?? null },
    // A run that pinned no closer predates closers being pinned, and was committed to its branch.
    closer: landingOf(header),
    branch: branchName(header.surfaceId),
    base: header.baseBranch ?? null,
    fence: header.fence === undefined ? null : { mode: header.fence.mode, present: header.fence.state.present, reason: header.fence.state.reason ?? null },
    guards: guardChanges(header.taskDef, step?.guards),
    workflow:
      header.workflow === undefined || step === undefined
        ? null
        : { name: header.workflow.name, step: stepIndexOf(record.caseFile), of: header.workflow.steps.length, stepName: step.name },
    attempts,
    budgets: Population.options.map((population) => ({ population, used: budgets[population].used, max: budgets[population].max })),
    decisions: decisionsOf(record, snapshot.refs[record.runId] ?? {}),
    repairs: repairsOf(snapshot, record),
    ...taskUsage(history),
    limit,
    escalation: packetOf(outcome?.packetRef, snapshot.refs[record.runId] ?? {}),
    plain:
      standing === "escalated" || standing === "aborted"
        ? plainOf({
            runId: record.runId,
            cause,
            agentStuck: history.findLast((entry) => entry.t === "triage")?.trigger === "worker_escalate",
            attempts,
            limit,
            agentSaid,
            listed: queue !== null,
          })
        : null,
  };
}

function runBlock(runFile: RunFile, records: readonly RunRecord[], governs: boolean): ReportRun {
  const { header, history, outcome } = runFile;
  const taken = new Set(claimedBy(runFile).map((claim) => claim.surfaceId));
  const escalated = outcome?.kind === "escalated" ? outcome : undefined;
  return {
    runId: header.runId,
    startedAt: startedInstant(header.runId),
    tasks: header.tasks,
    concurrency: header.concurrency,
    governs,
    breaker: breakerOf(history),
    outcome: outcome?.kind ?? null,
    finishedAt: outcome?.at ?? null,
    lastActivityAt: latestOf([outcome?.at, ...history.map((entry) => entry.at), ...records.filter((record) => taken.has(record.runId)).map(lastActivityOf)]),
    reason: escalated?.reason ?? null,
    cause: escalated?.cause ?? null,
    limit: history.findLast((entry) => entry.t === "run_escalated")?.limit ?? null,
    runBudgets: { gateMaintenance: { used: repairsUsed(history), max: header.runBudgetMax.gateMaintenance } },
  };
}

function document(
  snapshot: RecordSnapshot,
  parts: { live: boolean | null; run: ReportRun | null; surfaces: ReportSurface[]; incomplete: DamagedRecord[] },
  runFile?: RunFile,
): ReportDocument {
  const counts = Object.fromEntries(Standing.options.map((standing) => [standing, 0])) as Record<Standing, number>;
  for (const surface of parts.surfaces) counts[surface.standing] += 1;
  return { schema: REPORT_SCHEMA, kind: snapshot.subject.kind, counts, ...parts, ...addUp([...parts.surfaces, ...(runFile ? [runUsage(runFile)] : [])]), trips: runFile ? tripsOf(runFile.history).map(tripOf) : [] };
}

const asIncomplete = (damaged: DamagedFile, list: TaskDef[]): DamagedRecord => ({
  run: damaged.runId,
  file: damaged.file,
  queue: damaged.taskDef === undefined ? null : (queuePositionOf(list, damaged.taskDef) ?? null),
});

/** One task's own run. */
function taskReport(snapshot: RecordSnapshot, runId: string): ReportDocument {
  const { records, runs, list, live } = snapshot;
  const record = records.find((candidate) => candidate.runId === runId);
  if (record === undefined) {
    const incomplete = snapshot.damaged.filter((damaged) => damaged.runId === runId).map((damaged) => asIncomplete(damaged, list));
    return document(snapshot, { live: false, run: null, surfaces: [], incomplete });
  }
  const finished = record.caseFile.outcome !== undefined;
  // Only a run of several at once holds the lock, so only a task one of those took can be known to be going.
  const taken = runs.some((run) => run.outcome === undefined && claimedBy(run).some((claim) => claim.surfaceId === runId));
  const surface = withRun(snapshot, record, queuePositionOf(list, record.caseFile.header.taskDef) ?? null, record.caseFile.outcome?.kind ?? "unfinished");
  return document(snapshot, { live: finished ? false : taken ? live : null, run: null, surfaces: [surface], incomplete: [] });
}

/** The tasks of one run of several at once, as `supervisedView` stands them, less any whose record is damaged. */
function runSurfaces(snapshot: RecordSnapshot, runFile: RunFile, live: boolean): { surfaces: ReportSurface[]; incomplete: DamagedRecord[] } {
  const { records, list } = snapshot;
  const claimed = new Set(claimedBy(runFile).map((claim) => claim.surfaceId));
  const damaged = snapshot.damaged.filter((file) => claimed.has(file.runId));
  const view = supervisedView(runFile, records, list, live);
  const surfaces = view.tasks
    // A damaged record's task reads as waiting to the view, which only knows it has no record: it is reported as damaged instead.
    .filter((task) => task.record !== undefined || !damaged.some((file) => isDeepStrictEqual(file.taskDef, task.taskDef)))
    .map((task) =>
      task.record ? withRun(snapshot, task.record, task.position ?? null, task.standing) : withoutRun(task.taskDef, task.position ?? null, task.standing),
    );
  return { surfaces, incomplete: damaged.map((file) => asIncomplete(file, list)) };
}

/** One run of several tasks at once. */
function runReport(snapshot: RecordSnapshot, runId: string): ReportDocument {
  const runFile = snapshot.runs.find((run) => run.header.runId === runId);
  if (runFile === undefined) {
    const incomplete = snapshot.damaged.filter((damaged) => damaged.runId === runId).map((damaged) => asIncomplete(damaged, snapshot.list));
    return document(snapshot, { live: false, run: null, surfaces: [], incomplete });
  }
  const live = runFile.outcome === undefined && snapshot.live;
  return document(snapshot, { live, run: runBlock(runFile, snapshot.records, true), ...runSurfaces(snapshot, runFile, live) }, runFile);
}

/**
 * Whether a run of several tasks still says how the task list stands. It does
 * while it is going, and once it has ended until a task of the list is worked on
 * its own after it began: the list's standing is then that task's, and the run is
 * only history. Decided from the record alone, so a replay and a live watch agree.
 */
function governs(snapshot: RecordSnapshot, run: RunFile): boolean {
  if (run.outcome === undefined) return true;
  const taken = new Set(claimedBy(run).map((claim) => claim.surfaceId));
  const began = startedInstant(run.header.runId) ?? "";
  const worked = [...snapshot.records.map((record) => ({ runId: record.runId, taskDef: record.caseFile.header.taskDef })), ...snapshot.damaged];
  return !worked.some(({ runId, taskDef }) => !taken.has(runId) && (startedInstant(runId) ?? "") > began && snapshot.list.some((task) => isDeepStrictEqual(task, taskDef)));
}

/**
 * The project's task list as the owner experiences it: each task as written
 * now, with the latest run that answers for it. A list worked down one task at
 * a time has no run of its own, so none is invented: a task with no run yet is
 * `not_started`.
 */
function listReport(snapshot: RecordSnapshot): ReportDocument {
  const { list, records, runs } = snapshot;
  // The run of several at once this list was last worked by, if any: the newest that took one of its tasks.
  const run = newestFirstBy(
    runs.filter((candidate) => claimedBy(candidate).some((claim) => queuePositionOf(list, claim.taskDef) !== undefined)),
    (candidate) => candidate.header.runId,
  ).at(0);
  const going = run !== undefined && run.outcome === undefined;
  const live = going && snapshot.live;
  const inRun = going ? runSurfaces(snapshot, run, live) : { surfaces: [], incomplete: [] };

  const incomplete: DamagedRecord[] = [...inRun.incomplete];
  const surfaces: ReportSurface[] = [];
  list.forEach((taskDef, index) => {
    const queue: QueuePosition = { task: index + 1, of: list.length };
    if (incomplete.some((damaged) => damaged.queue?.task === queue.task)) return;
    const taken = inRun.surfaces.find((surface) => surface.queue?.task === queue.task);
    if (taken) return void surfaces.push(taken);

    const record = findQueueRun(records, taskDef);
    // A damaged record answers for the task when it is the newest run of it: an older readable run would be stale news.
    const damaged = newestFirstBy(
      snapshot.damaged.filter((file) => isDeepStrictEqual(file.taskDef, taskDef)),
      (file) => file.runId,
    ).at(0);
    if (damaged && (record === undefined || (startedInstant(damaged.runId) ?? "") > (startedInstant(record.runId) ?? ""))) {
      return void incomplete.push({ run: damaged.runId, file: damaged.file, queue });
    }
    surfaces.push(record ? withRun(snapshot, record, queue, record.caseFile.outcome?.kind ?? "unfinished") : withoutRun(taskDef, queue, "not_started"));
  });
  // A record too damaged to say which task it was for may be one of this list's: named, so the report is marked incomplete.
  for (const file of snapshot.damaged) {
    if (file.taskDef === undefined && !incomplete.some((damaged) => damaged.run === file.runId)) incomplete.push(asIncomplete(file, list));
  }

  const unfinished = surfaces.some((surface) => surface.standing === "unfinished");
  return document(
    snapshot,
    {
      live: going ? live : unfinished ? null : false,
      run: run ? runBlock(run, records, governs(snapshot, run)) : null,
      surfaces,
      incomplete,
    },
    run,
  );
}

/**
 * The run a report falls back to when the project has no task list: the one
 * started most recently, a run of several at once counting as one run and its
 * tasks as part of it. A damaged record is still a run: when it is the newest,
 * it is the subject, so the report names it rather than passing an older run
 * off as the latest. Nothing when the folder holds no run at all.
 */
export function mostRecentSubject(snapshot: RecordSnapshot): ReportSubject | undefined {
  const taken = new Set(snapshot.runs.flatMap((run) => claimedBy(run).map((claim) => claim.surfaceId)));
  const subjects: Exclude<ReportSubject, { kind: "list" }>[] = [
    ...snapshot.runs.map((run) => ({ kind: "run" as const, runId: run.header.runId })),
    ...snapshot.records.filter((record) => !taken.has(record.runId)).map((record) => ({ kind: "task" as const, runId: record.runId })),
    ...snapshot.damaged.filter((file) => !taken.has(file.runId)).map((file) => ({ kind: "task" as const, runId: file.runId })),
  ];
  return newestFirstBy(subjects, (subject) => subject.runId).at(0);
}

/**
 * What happened, as one document. Pure, total and deterministic over the
 * snapshot: it reads no file and no clock, so the same record always gives the
 * same report.
 */
export function deriveReport(snapshot: RecordSnapshot): ReportDocument {
  const { subject } = snapshot;
  switch (subject.kind) {
    case "task":
      return taskReport(snapshot, subject.runId);
    case "run":
      return runReport(snapshot, subject.runId);
    case "list":
      return listReport(snapshot);
  }
}
