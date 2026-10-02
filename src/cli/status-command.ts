import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { logTail, resumeAction, type ResumeAction } from "../case-file.js";
import { branchName } from "../provision.js";
import type { BreakerState, BreakerCause, RunOutcome, SurfaceState, TaskDef } from "../schema.js";
import { repairsUsed, tripsOf, type Trip } from "../breaker.js";
import { USAGE_LIMIT_WORDS } from "../ports.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { loadConfig } from "./config.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { RunFileNotFound } from "../errors.js";
import { deriveReport } from "../report/derive.js";
import { detailLines, rollUpLines, roundLines } from "../report/detail.js";
import type { ReportDocument, ReportSurface } from "../report/document.js";
import { loadSnapshot, type ReportSubject } from "../report/snapshot.js";
import { findRepository } from "./project.js";
import { packetOf, summariseOutcome } from "./outcome.js";
import { paint } from "../paint.js";
import { BREAKER_PHRASES, nextStepPhrase, STEP_PHRASES } from "./output.js";
import { queueTasks, shapeOf, STOPPED_PART_WAY } from "./queue.js";
import { repoLocked } from "./repo-lock.js";
import { runPlace } from "../run-location.js";
import { newestFirstBy, startedInstant, type RunRecord } from "../run-records.js";
import { queuePositionOf, taskIntent, type QueuePosition } from "../task-list.js";
import { allRuns, allSupervisedRuns, describeRun, NOTHING_HERE, readableUtc, readRun, readSupervisedRun, startedAt, touchedAt, type SupervisedRecord } from "./runs.js";
import { claimedBy, overallOutcome, STANDINGS, standingCounts, supervisedView, type SupervisedView, type TaskStanding, type ViewTask } from "../supervised-view.js";

/**
 * The packet a stopped run left, in the order a person reads it: every field
 * the harness wrote, under a heading saying what it is, and none of it
 * paraphrased. Whoever picks this up was not watching, so the harness's own
 * account is all they have.
 */
function packetLines(packet: EscalationPacket): string[] {
  return [
    "",
    "What the harness saw:",
    packet.evidence,
    "",
    "What had already been tried:",
    packet.dead_ends,
    "",
    "Why it stopped when it did:",
    packet.why_now,
    ...(packet.references.length === 0
      ? []
      : ["", "The agent sessions behind this:", ...packet.references.map((reference) => `  ${reference}`)]),
  ];
}

/**
 * Where a stopped run's work is, checked rather than assumed. The built-in
 * closers keep the branch and clear the scratch working copy away on any
 * outcome that is not accepted, so naming a path that is not there would waste
 * the reader's time; a working copy that did survive is worth naming, and the
 * run's own record is always there.
 */
function whereToLook(record: RunRecord, ctx: CommandContext): string[] {
  const { location } = runPlace(record.repoPath, record.runId, ctx.env);
  return [
    "",
    "Where to look:",
    `  The branch ${branchName(record.caseFile.header.surfaceId)} was kept.`,
    existsSync(location.worktreePath)
      ? `  The agent's working copy is still at ${location.worktreePath}.`
      : "  The agent's working copy has been cleared away.",
    `  Everything this run recorded is in ${record.dir}.`,
  ];
}

/**
 * One run's record, as a person reads it: which run and what it was asked to
 * do, then what happened. A run that did not finish says what picking it up
 * will do next; a run that stopped says so in the words the harness wrote at
 * the time, and where its work was kept. Pure over the record: this reads, and
 * never advances anything.
 */
export async function statusReport(record: RunRecord, ctx: CommandContext, position?: QueuePosition): Promise<string[]> {
  return [
    `Run ${record.runId}, started ${startedAt(record.runId)}: ${taskIntent(record.caseFile.header.taskDef)}`,
    ...(position ? [`It is task ${position.task} of ${position.of} on your list.`] : []),
    ...(await statusBody(record, ctx)),
  ];
}

/** What happened to one run, after the line naming it: the part a run of several at once repeats under a task that needs a decision. */
export async function statusBody(record: RunRecord, ctx: CommandContext): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const { outcome } = caseFile;

  if (!outcome) {
    return [
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStepPhrase(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }

  const summary = await summariseOutcome(dir, caseFile);
  const finished = [paint(ctx.colour, summary.tone, summary.headline), `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`];
  if (outcome.kind === "closed") return [...finished, ...summary.details];

  // Not summary.details: that is the live run's short form, which quotes the
  // evidence alone. Whoever reads this later gets the whole packet instead.
  const packet = outcome.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  return [...finished, ...(packet ? packetLines(packet) : []), ...(outcome.kind === "aborted" ? summary.details : []), ...whereToLook(record, ctx)];
}

/** How a run ended, as one word a script can switch on. "unfinished" is the fourth: a run that is still resumable has not ended at all. */
export type RunOutcomeName = "closed" | "escalated" | "aborted" | "unfinished";

/** One run at a glance: which run, what it was asked to do, when it started and how it ended. */
export interface RunSummary {
  run: string;
  task: string;
  /** ISO 8601, from the run id itself; null when the id carries no stamp. */
  startedAt: string | null;
  outcome: RunOutcomeName;
}

/**
 * Everything the plain-language report says about one run, as one document.
 * Every key is always there: a null says "not that kind of run", so a reader
 * never has to probe for a key, and the shape is the same for all four
 * outcomes. The harness's own names are used unchanged, because this is the
 * one place they are meant to be read.
 */
export interface RunStatusDocument extends RunSummary {
  /** The state the record is in. */
  state: SurfaceState;
  finishedAt: string | null;
  /** How it ended, in the harness's own words. */
  reason: string | null;
  /** Unfinished only: what picking it up would do first. */
  nextStep: ResumeAction | null;
  /** Finished only: the sentence the plain-language report leads with. */
  summary: string | null;
  /**
   * The lines the plain-language report prints under that sentence, empty for a
   * run that has not finished. Not always derivable from the fields beside it: a
   * pull-request closer names its pull request here, and a custom closer says
   * whatever only it knows.
   */
  details: string[];
  branch: string;
  base: string | null;
  /** Everything this run recorded. */
  dir: string;
  /** The agent's working copy, while it is still on disk. */
  worktree: string | null;
  escalation: EscalationPacket | null;
  /** Where this run's task sits in the project's list as it is written now, or null when the list doesn't ask for it. */
  queue: QueuePosition | null;
}

/** One run at a glance, from its record. */
export function runSummary(record: RunRecord): RunSummary {
  return {
    run: record.runId,
    task: taskIntent(record.caseFile.header.taskDef),
    startedAt: startedInstant(record.runId),
    outcome: record.caseFile.outcome?.kind ?? "unfinished",
  };
}

/**
 * One run's record as a script reads it: the same information `statusReport`
 * says in sentences, over the same record, read once. Nothing here advances
 * anything either.
 */
export async function statusDocument(record: RunRecord, ctx: CommandContext, position?: QueuePosition): Promise<RunStatusDocument> {
  const { caseFile, dir, runId } = record;
  const { outcome } = caseFile;
  const { location } = runPlace(record.repoPath, runId, ctx.env);
  const packet = outcome?.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  // Read once, as the report reads it, so the two can never say different things.
  const summary = outcome ? await summariseOutcome(dir, caseFile) : undefined;
  return {
    ...runSummary(record),
    state: caseFile.cursor.state,
    finishedAt: outcome?.at ?? null,
    reason: outcome?.reason ?? null,
    nextStep: outcome ? null : resumeAction(logTail(caseFile)),
    summary: summary?.headline ?? null,
    details: summary?.details ?? [],
    branch: branchName(caseFile.header.surfaceId),
    base: caseFile.header.baseBranch ?? null,
    dir,
    worktree: existsSync(location.worktreePath) ? location.worktreePath : null,
    escalation: packet ?? null,
    queue: position ?? null,
  };
}

/**
 * A run of several tasks at once as one document: the run's own fields, then
 * each task it took with a record, as exactly the document `status --json`
 * gives for that task on its own, and the tasks still to start. Every key is
 * always there; null where it does not apply yet.
 */
export interface SupervisedStatusDocument {
  runId: string;
  /** ISO 8601, from the run id. */
  startedAt: string | null;
  /** How many tasks the list held when the run started. */
  tasks: number;
  concurrency: number;
  /** Whether the run is going right now. */
  live: boolean;
  breaker: BreakerState;
  outcome: RunOutcome["kind"] | null;
  finishedAt: string | null;
  surfaces: RunStatusDocument[];
  queued: { task: string; queue: QueuePosition | null }[];
  reason: string | null;
  cause: Extract<RunOutcome, { kind: "escalated" }>["cause"] | null;
  runBudgets: { gateMaintenance: { used: number; max: number } };
  trips: Trip[];
}

export async function supervisedDocument(view: SupervisedView, ctx: CommandContext): Promise<SupervisedStatusDocument> {
  const { header, outcome } = view.runFile;
  return {
    runId: header.runId,
    startedAt: startedInstant(header.runId),
    tasks: header.tasks,
    concurrency: header.concurrency,
    live: view.live,
    breaker: view.breaker,
    outcome: outcome?.kind ?? null,
    finishedAt: outcome?.at ?? null,
    surfaces: await Promise.all(
      view.tasks.flatMap((task) => (task.record ? [statusDocument(task.record, ctx, task.position)] : [])),
    ),
    queued: view.tasks
      .filter((task) => task.record === undefined)
      .map((task) => ({ task: taskIntent(task.taskDef), queue: task.position ?? null })),
    reason: outcome?.kind === "escalated" ? outcome.reason : null,
    cause: outcome?.kind === "escalated" ? outcome.cause : null,
    runBudgets: { gateMaintenance: { used: repairsUsed(view.runFile.history), max: header.runBudgetMax.gateMaintenance } },
    trips: tripsOf(view.runFile.history),
  };
}

/** How a run ended, as a person reads it in a list. Total over the four names, so a new one does not compile until it has words. */
const OUTCOME_WORDS: Record<RunOutcomeName, string> = {
  closed: "finished",
  escalated: "needs a decision from you",
  aborted: "stopped before it finished",
  unfinished: "hasn't finished yet",
};

/** Where a task of a run of several at once stands, as a person reads it, in a count or on its own line. Total, so a new standing does not compile until it has words. */
const STANDING_WORDS: Record<TaskStanding, string> = {
  closed: "done",
  escalated: "needs your decision",
  aborted: "stopped before it finished",
  paused: "paused until the shared environment is fixed",
  unfinished: "not finished yet",
  queued: "queued",
};

/** A task that would be running if a slot were free. Said only while the run is going: a stopped run's queued tasks are waiting for it to be picked up. */
export const WAITING_FOR_A_SLOT = "queued, waiting for a free slot";

/** A task as the narration names it: its place and words, or its id when the list no longer has it. */
function taskLabel(view: SupervisedView, surfaceId: string): string {
  const task = view.tasks.find((candidate) => candidate.record?.runId === surfaceId);
  if (task === undefined) return surfaceId;
  const tag = task.position ? `[${task.position.task}/${task.position.of}] ` : "";
  return `${tag}${taskIntent(task.taskDef)}`;
}

/** What tripped the breaker, as a person reads it. Total over the kinds, so a new one does not compile until it has words. */
function whatBroke(view: SupervisedView, cause: BreakerCause): string {
  switch (cause.kind) {
    case "gate_maintenance":
      return `It was first noticed by ${taskLabel(view, cause.surfaceId)}: ${cause.reason}.`;
    case "gate_error_aggregate":
      return `The check could not run in ${cause.surfaceIds.length} different tasks: ${cause.surfaceIds.map((surfaceId) => taskLabel(view, surfaceId)).join(", ")}.`;
  }
}

/**
 * What a person reads first when the shared environment is not healthy: that
 * it broke and what is happening about it, which task found it and why, and
 * which tasks it held. Nothing for a run whose environment is healthy.
 */
export function environmentNarration(view: SupervisedView): string[] {
  const { trip } = view;
  if (trip === undefined) return [];
  const limit = trip.ended === "gave_up" ? trip.limit : null;
  const limitWords = limit === null ? "" : USAGE_LIMIT_WORDS[limit];
  const opening =
    limit !== null
      ? `${limitWords.charAt(0).toUpperCase()}${limitWords.slice(1)}, so the run stopped before it could repair the shared environment; no task caused this.`
      : trip.ended === "gave_up"
        ? `The shared environment could not be fixed after ${trip.repairs.length} ${trip.repairs.length === 1 ? "attempt" : "attempts"}, so the run stopped; no task caused this.`
        : `${view.breaker === "REPAIRING" ? "The shared environment is being repaired" : "Something in the shared environment looks broken"}: any task about to check or hand off its work is held until it is fixed.`;
  return [
    opening,
    whatBroke(view, trip.cause),
    `Held: ${trip.held.map((surfaceId) => taskLabel(view, surfaceId)).join(", ")}.`,
    ...(trip.ended === "gave_up" ? [`Once ${limit === null ? "it is fixed" : "the limit no longer applies"}, \`delivery run\` carries the held tasks on.`] : []),
    "",
  ];
}

/** How many tasks stand each way, in words, leaving out any standing no task has: "3 done, 1 needs your decision". */
export function countsLine(tasks: readonly ViewTask[]): string {
  const counts = standingCounts(tasks);
  return STANDINGS.filter((standing) => counts[standing] > 0)
    .map((standing) => `${counts[standing]} ${STANDING_WORDS[standing]}`)
    .join(", ");
}

/** A task's place in the list, what it was asked to do, and its own run id once it has one. */
function taskName(task: ViewTask): string {
  const tag = task.position ? `[${task.position.task}/${task.position.of}] ` : "";
  return `${tag}${taskIntent(task.taskDef)}${task.record ? ` (${task.record.runId})` : ""}`;
}

/** What a task that is going is doing right now, in the words the run itself prints as it goes, and which attempt it is on. */
function inFlight(surface: ReportSurface | undefined): string | undefined {
  if (surface?.state == null) return undefined;
  return `${STEP_PHRASES[surface.state]}${surface.attempts > 0 ? `, attempt ${surface.attempts}` : ""}`;
}

/**
 * One task's line: its place in the list, what it was asked to do, its own run
 * id once it has one (so any task can be read in full with `delivery status <id>`),
 * and where it stands. While the run is going, a task under way says what it
 * is doing; once the run has stopped, nothing is doing anything, so it says
 * only that it has not finished.
 */
function taskLine(task: ViewTask, live: boolean, surface: ReportSurface | undefined): string {
  const standing =
    task.standing === "escalated"
      ? `${STANDING_WORDS.escalated} (see below)`
      : task.standing === "queued" && live
        ? WAITING_FOR_A_SLOT
        : ((task.standing === "unfinished" && live ? inFlight(surface) : undefined) ?? STANDING_WORDS[task.standing]);
  return `  ${taskName(task)}: ${standing}`;
}

export const ALL_AND_ONE =
  "Use either `--all` or a run id, not both: `--all` lists every run, and a run id reads one of them in full.";

export const ALL_AND_DECISIONS =
  "Use either `--all` or `--decisions`, not both: `--all` lists every run, and `--decisions` prints one run's triage rounds in full.";

export const NO_DECISIONS_DATA_YET = "`--decisions` prints the triage rounds as text only for now. Run it without `--json`.";

/** One entry of `status --all --json`: a single run, or a run of several at once with its tasks under it. Every key in both, null where it does not apply. */
export interface ListedRun {
  run: string;
  /** A single run's task; null for a run of several at once, whose tasks are under `tasks`. */
  task: string | null;
  startedAt: string | null;
  outcome: RunOutcomeName;
  tasks: RunSummary[] | null;
}

const isSupervised = (entry: RunRecord | SupervisedView): entry is SupervisedView => "runFile" in entry;
const listedId = (entry: RunRecord | SupervisedView): string => (isSupervised(entry) ? entry.runFile.header.runId : entry.runId);

function listedRun(entry: RunRecord | SupervisedView): ListedRun {
  if (!isSupervised(entry)) return { ...runSummary(entry), tasks: null };
  return {
    run: listedId(entry),
    task: null,
    startedAt: startedInstant(listedId(entry)),
    outcome: overallOutcome(entry),
    tasks: entry.tasks.flatMap((task) => (task.record ? [runSummary(task.record)] : [])),
  };
}

/** Every run this repository holds, one to a line; a run of several at once is one line saying its shape and how its tasks stand. */
export function runListing(entries: (RunRecord | SupervisedView)[]): string[] {
  if (entries.length === 0) return [NOTHING_HERE];
  const line = (entry: RunRecord | SupervisedView): string => {
    if (!isSupervised(entry)) return `${describeRun(entry)} (${OUTCOME_WORDS[runSummary(entry).outcome]})`;
    const { runId, tasks, concurrency } = entry.runFile.header;
    const counts = countsLine(entry.tasks);
    return `${runId}, started ${startedAt(runId)}: ${shapeOf(tasks, concurrency)}${counts === "" ? "" : ` (${counts})`}`;
  };
  return [
    `${entries.length} run${entries.length === 1 ? "" : "s"} in this repository, newest first:`,
    ...entries.map((entry) => `  ${line(entry)}`),
    "To read one in full: delivery status <run-id>",
  ];
}

/**
 * `delivery status --all`: every run this repository holds, rather than one.
 * A run of several at once is one entry, its tasks folded into it. Listing
 * nothing is a complete answer, so an empty repository exits ok here, unlike
 * a lookup of a run that is not there, which is a failure to answer.
 */
async function listRuns(repoPath: string, startDir: string, ctx: CommandContext): Promise<ExitCode> {
  const [records, list, locked, supervised] = await Promise.all([
    allRuns(repoPath),
    listTasks(startDir, repoPath, ctx),
    repoLocked(repoPath),
    allSupervisedRuns(repoPath),
  ]);
  const views = supervised.map((record) => supervisedView(record.runFile, records, list, record.runFile.outcome === undefined && locked));
  const members = new Set(views.flatMap((view) => claimedBy(view.runFile).map((claim) => claim.surfaceId)));
  const entries = newestFirstBy<RunRecord | SupervisedView>([...records.filter((record) => !members.has(record.runId)), ...views], listedId);
  if (ctx.json) ctx.writeLine(JSON.stringify(entries.map(listedRun), null, 2));
  else for (const line of runListing(entries)) ctx.writeLine(line);
  return EXIT.ok;
}

/**
 * What `delivery status` was given on the command line besides the run id.
 * `--last` is accepted and documented as the explicit form of the default, so
 * it is not a field here: with no id at all this command already reports the
 * run touched most recently, and a field nothing reads would invite someone to
 * wire up a second meaning it does not have.
 */
export interface StatusOptions {
  repo?: string;
  /** List every run this repository holds instead of reading one. */
  all?: boolean;
  /** Print every triage round in full, where the usual account gives each one line. */
  decisions?: boolean;
}

/**
 * The run this command means when no id was given: the one whose record was
 * written most recently, of either kind, finished or not. A task that an
 * unfinished run of several at once took counts as that run being touched, so
 * checking on a run that is going reports the run rather than whichever of its
 * tasks moved last; once that run has finished, its tasks are their own again.
 */
async function mostRecent(repoPath: string): Promise<RunRecord | SupervisedRecord> {
  const [[task], supervised] = await Promise.all([allRuns(repoPath), allSupervisedRuns(repoPath)]);
  const [run] = supervised;
  if (task === undefined) {
    if (run === undefined) throw new Refusal(NOTHING_HERE, EXIT.configuration);
    return run;
  }
  if (run !== undefined) {
    const [runTouched, taskTouched] = await Promise.all([touchedAt(run.dir), touchedAt(task.dir)]);
    if (runTouched >= taskTouched) return run;
  }
  const owner = supervised.find(
    (record) => record.runFile.outcome === undefined && claimedBy(record.runFile).some((claim) => claim.surfaceId === task.runId),
  );
  return owner ?? task;
}

/** The project's list as written now, or none when there is no list or the file fails to load: status reads it only to annotate, never to gate. */
export async function listTasks(startDir: string, repoPath: string, ctx: CommandContext): Promise<TaskDef[]> {
  try {
    return queueTasks(await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env }));
  } catch (err) {
    if (err instanceof Refusal) return [];
    throw err;
  }
}

/**
 * Where this run's task sits in the project's list as it is written now.
 * Nothing for a run the list doesn't ask for, for a project with no list, and
 * for a config file that fails to load: unlike `run` and `validate`, `status`
 * reads the file only to annotate a report, never to gate one, so a broken
 * file just means no queue line rather than a refusal.
 */
async function positionOf(record: RunRecord, startDir: string, ctx: CommandContext): Promise<QueuePosition | undefined> {
  return queuePositionOf(await listTasks(startDir, record.repoPath, ctx), record.caseFile.header.taskDef);
}

/** A run by its id: a run of several at once if one has that id, otherwise a single run, whose absence says the usual "couldn't find" message. */
async function lookUp(repoPath: string, runId: string): Promise<RunRecord | SupervisedRecord> {
  try {
    return await readSupervisedRun(repoPath, runId);
  } catch (err) {
    if (!(err instanceof RunFileNotFound)) throw err;
  }
  return readRun(repoPath, runId);
}

/** A run of several at once, read back with every task's record and the list as written now. Live while it holds the repository. */
async function viewOf(record: SupervisedRecord, repoPath: string, startDir: string, ctx: CommandContext): Promise<SupervisedView> {
  const [locked, records, list] = await Promise.all([repoLocked(repoPath), allRuns(repoPath), listTasks(startDir, repoPath, ctx)]);
  const live = record.runFile.outcome === undefined && locked;
  return supervisedView(record.runFile, records, list, live);
}

/** Beside a healthy environment, how often the run repaired it: looking back, a repair is part of the run's history. Nothing while it is broken, where the report already leads with that. */
function repairedDuringRun(view: SupervisedView): string {
  const repaired = tripsOf(view.runFile.history).filter((trip) => trip.ended === "repaired").length;
  if (view.breaker !== "HEALTHY" || repaired === 0) return "";
  return ` (repaired ${repaired === 1 ? "once" : repaired === 2 ? "twice" : `${repaired} times`} during this run)`;
}

/**
 * A run of several tasks at once, as a person reads it: which run and its
 * shape, the shared environment, the counts, then one line per task in list
 * order. A task that needs a decision is followed by exactly what `status`
 * says of it on its own, so the decision reads the same wherever it is met.
 * A run that stopped part way says how to carry it on.
 */
/**
 * A run of several tasks at once, as a person reads it: which run and its
 * shape, the shared environment, the counts, then one line per task in list
 * order. A task that needs a decision is followed by exactly what `status`
 * says of it on its own, so the decision reads the same wherever it is met.
 * A run that stopped part way says how to carry it on. Then, from the report
 * document: the retries added up across the run with its shared repair limit,
 * and, when asked for, every task's triage rounds in full.
 */
export async function supervisedReport(view: SupervisedView, ctx: CommandContext, doc: ReportDocument, { full }: { full: boolean }): Promise<string[]> {
  const { header, outcome } = view.runFile;
  const surfaceOf = (task: ViewTask): ReportSurface | undefined => doc.surfaces.find((surface) => surface.run !== null && surface.run === task.record?.runId);
  const counts = countsLine(view.tasks);
  const lines = [
    ...environmentNarration(view),
    `Run ${header.runId}, started ${startedAt(header.runId)}: ${shapeOf(header.tasks, header.concurrency)}`,
    `Environment: ${BREAKER_PHRASES[view.breaker]}${repairedDuringRun(view)}`,
    ...(counts === "" ? [] : [counts]),
    ...(outcome === undefined && !view.live ? [STOPPED_PART_WAY] : []),
    "",
  ];
  for (const task of view.tasks) {
    lines.push(taskLine(task, view.live, surfaceOf(task)));
    if (task.standing === "escalated" && task.record) lines.push(...(await statusBody(task.record, ctx)), "");
  }
  // Exactly one blank line after the tasks, whether or not the last one carried a decision's account.
  if (lines.at(-1) !== "") lines.push("");
  lines.push(...rollUpLines(doc));
  if (full) {
    for (const task of view.tasks) {
      const surface = surfaceOf(task);
      if (surface) lines.push("", `${taskName(task)}:`, ...roundLines(surface.decisions, { full }));
    }
  }
  const readable = view.tasks.find((task) => task.standing === "escalated") ?? view.tasks.find((task) => task.record);
  if (readable?.record) lines.push("", `To read one task in full: delivery status ${readable.record.runId}`);
  const rounds = doc.surfaces.reduce((sum, surface) => sum + surface.decisions.length, 0);
  lines.push("", nextLine(header.runId, `delivery report ${header.runId} (this run in plain words)`, rounds, full));
  return lines;
}

/**
 * The report document for what `status` was asked about: the read model
 * `delivery report` renders, read by the reader it uses. The detail `status`
 * adds beneath its own account is a rendering of this, never a second working
 * out of budgets or rounds.
 */
async function documentOf(repoPath: string, startDir: string, subject: ReportSubject, ctx: CommandContext): Promise<ReportDocument> {
  // ponytail: this reads every record once more than the account above it needed. Serve the account from the
  // same snapshot if a repository with thousands of runs makes `status` slow.
  const [list, live] = await Promise.all([listTasks(startDir, repoPath, ctx), repoLocked(repoPath)]);
  return deriveReport(await loadSnapshot(repoPath, subject, { live, list }));
}

/** Where to go from here: the triage rounds in full, when there are any and they were not just printed, and the report. */
function nextLine(runId: string, report: string, rounds: number, full: boolean): string {
  const more = rounds > 0 && !full ? [`delivery status ${runId} --decisions (every triage round in full)`] : [];
  return `Next: ${[...more, report].join(", ")}`;
}

/**
 * `delivery status`: read one run's record and say what happened to it, for
 * whoever was not watching when it ended. It only ever reads, so it is safe to
 * run against a run that is still going, and a run that needed a person is
 * still a successful read: the exit code says whether the report could be
 * made, never what the run itself decided.
 */
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  // Before the repository is even looked for: a usage mistake is the same
  // mistake wherever it was typed, and hearing about the folder first would
  // send the reader after the wrong problem.
  if (options.all && runId !== undefined) throw new Refusal(ALL_AND_ONE, EXIT.configuration);
  if (options.all && options.decisions) throw new Refusal(ALL_AND_DECISIONS, EXIT.configuration);
  if (options.decisions && ctx.json) throw new Refusal(NO_DECISIONS_DATA_YET, EXIT.configuration);
  const full = options.decisions === true;
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  if (options.all) return listRuns(repoPath, startDir, ctx);
  const record = runId === undefined ? await mostRecent(repoPath) : await lookUp(repoPath, runId);
  if ("runFile" in record) {
    const view = await viewOf(record, repoPath, startDir, ctx);
    if (ctx.json) {
      ctx.writeLine(JSON.stringify(await supervisedDocument(view, ctx), null, 2));
      return EXIT.ok;
    }
    const doc = await documentOf(repoPath, startDir, { kind: "run", runId: view.runFile.header.runId }, ctx);
    for (const line of await supervisedReport(view, ctx, doc, { full })) ctx.writeLine(line);
    return EXIT.ok;
  }
  if (ctx.json) {
    // Indented rather than one line: a person reads this output too, and a parser does not mind.
    ctx.writeLine(JSON.stringify(await statusDocument(record, ctx, await positionOf(record, startDir, ctx)), null, 2));
    return EXIT.ok;
  }
  // The account first, every line as it has always been; then the detail, from the document the report is made from.
  const [surface] = (await documentOf(repoPath, startDir, { kind: "task", runId: record.runId }, ctx)).surfaces;
  const lines = [
    ...(await statusReport(record, ctx, surface?.queue ?? undefined)),
    ...(surface ? ["", ...detailLines(surface, { full })] : []),
    "",
    nextLine(record.runId, "delivery report (your task list)", surface?.decisions.length ?? 0, full),
  ];
  for (const line of lines) ctx.writeLine(line);
  return EXIT.ok;
}
