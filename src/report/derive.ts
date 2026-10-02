import { isDeepStrictEqual } from "node:util";
import { repairsUsed } from "../breaker.js";
import { deriveBudgetsFromLog } from "../case-file.js";
import { branchName } from "../provision.js";
import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
import { Population, type RunFile, type TaskDef } from "../schema.js";
import { claimedBy, supervisedView } from "../supervised-view.js";
import { findQueueRun, queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
import { REPORT_SCHEMA, Standing, type DamagedRecord, type ReportDocument, type ReportRun, type ReportSurface } from "./document.js";
import { plainOf } from "./plain.js";
import type { DamagedFile, RecordSnapshot, ReportSubject } from "./snapshot.js";

/** A task with no run of its own yet: every fact about a run is null. */
function withoutRun(taskDef: TaskDef, queue: QueuePosition | null, standing: Standing): ReportSurface {
  return {
    run: null,
    task: taskIntent(taskDef),
    queue,
    standing,
    startedAt: null,
    finishedAt: null,
    reason: null,
    cause: null,
    closer: null,
    branch: null,
    base: null,
    attempts: 0,
    budgets: [],
    limit: null,
    plain: null,
  };
}

/** One task from its own record. The retries are the log's, by the fold resuming uses, so a report and a resume cannot disagree. */
function withRun(record: RunRecord, queue: QueuePosition | null, standing: Standing): ReportSurface {
  const { header, history, outcome, cursor } = record.caseFile;
  const budgets = deriveBudgetsFromLog(history, cursor.budgets);
  const lastSession = history.findLast((entry) => entry.t === "terminus");
  const attempts = history.filter((entry) => entry.t === "dispatch" && (entry.role ?? "worker") === "worker").length;
  const limit = lastSession?.limit ?? null;
  const cause = outcome?.cause ?? null;
  // A session that ended without a result has no words of the agent's: its rationale is the harness's own.
  const agentSaid = lastSession !== undefined && lastSession.status !== "incomplete" && lastSession.rationale.trim() !== "" ? lastSession.rationale : null;
  return {
    run: record.runId,
    task: taskIntent(header.taskDef),
    queue,
    standing,
    startedAt: startedInstant(record.runId),
    finishedAt: outcome?.at ?? null,
    reason: outcome?.reason ?? null,
    cause,
    // A run that pinned no closer predates closers being pinned, and was committed to its branch.
    closer: header.closerRef?.type ?? "commit-to-branch",
    branch: branchName(header.surfaceId),
    base: header.baseBranch ?? null,
    attempts,
    budgets: Population.options.map((population) => ({ population, used: budgets[population].used, max: budgets[population].max })),
    limit,
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

function runBlock(runFile: RunFile): ReportRun {
  const { header, history, outcome } = runFile;
  const escalated = outcome?.kind === "escalated" ? outcome : undefined;
  return {
    runId: header.runId,
    startedAt: startedInstant(header.runId),
    tasks: header.tasks,
    concurrency: header.concurrency,
    outcome: outcome?.kind ?? null,
    finishedAt: outcome?.at ?? null,
    reason: escalated?.reason ?? null,
    cause: escalated?.cause ?? null,
    limit: history.findLast((entry) => entry.t === "run_escalated")?.limit ?? null,
    runBudgets: { gateMaintenance: { used: repairsUsed(history), max: header.runBudgetMax.gateMaintenance } },
  };
}

function document(
  snapshot: RecordSnapshot,
  parts: { live: boolean | null; run: ReportRun | null; surfaces: ReportSurface[]; incomplete: DamagedRecord[] },
): ReportDocument {
  const counts = Object.fromEntries(Standing.options.map((standing) => [standing, 0])) as Record<Standing, number>;
  for (const surface of parts.surfaces) counts[surface.standing] += 1;
  return { schema: REPORT_SCHEMA, kind: snapshot.subject.kind, counts, ...parts };
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
  const surface = withRun(record, queuePositionOf(list, record.caseFile.header.taskDef) ?? null, record.caseFile.outcome?.kind ?? "unfinished");
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
      task.record ? withRun(task.record, task.position ?? null, task.standing) : withoutRun(task.taskDef, task.position ?? null, task.standing),
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
  return document(snapshot, { live, run: runBlock(runFile), ...runSurfaces(snapshot, runFile, live) });
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
    surfaces.push(record ? withRun(record, queue, record.caseFile.outcome?.kind ?? "unfinished") : withoutRun(taskDef, queue, "not_started"));
  });
  // A record too damaged to say which task it was for may be one of this list's: named, so the report is marked incomplete.
  for (const file of snapshot.damaged) {
    if (file.taskDef === undefined && !incomplete.some((damaged) => damaged.run === file.runId)) incomplete.push(asIncomplete(file, list));
  }

  const unfinished = surfaces.some((surface) => surface.standing === "unfinished");
  return document(snapshot, {
    live: going ? live : unfinished ? null : false,
    run: run ? runBlock(run) : null,
    surfaces,
    incomplete,
  });
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
