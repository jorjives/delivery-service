import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { logTail, resumeAction, type ResumeAction } from "../case-file.js";
import { branchName } from "../provision.js";
import type { SurfaceState } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { packetOf, summariseOutcome } from "./outcome.js";
import { nextStepPhrase, paint } from "./output.js";
import { runPlace } from "./run-location.js";
import { allRuns, describeRun, NOTHING_HERE, readableUtc, readRun, startedAt, startedInstant, type RunRecord } from "./runs.js";
import { taskIntent } from "./settings.js";

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
export async function statusReport(record: RunRecord, ctx: CommandContext): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const opening = `Run ${runId}, started ${startedAt(runId)}: ${taskIntent(caseFile.header.taskDef)}`;
  const { outcome } = caseFile;

  if (!outcome) {
    return [
      opening,
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStepPhrase(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }

  const summary = await summariseOutcome(dir, caseFile);
  const finished = [
    opening,
    paint(ctx.colour, summary.tone, summary.headline),
    `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`,
  ];
  if (outcome.kind === "closed") return [...finished, ...summary.details];

  // Not summary.details: that is the live run's short form, which quotes the
  // evidence alone. Whoever reads this later gets the whole packet instead.
  const packet = outcome.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  return [
    ...finished,
    ...(packet ? packetLines(packet) : []),
    ...(outcome.kind === "aborted" ? summary.details : []),
    ...whereToLook(record, ctx),
  ];
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
export async function statusDocument(record: RunRecord, ctx: CommandContext): Promise<RunStatusDocument> {
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
  };
}

/** How a run ended, as a person reads it in a list. Total over the four names, so a new one does not compile until it has words. */
const OUTCOME_WORDS: Record<RunOutcomeName, string> = {
  closed: "finished",
  escalated: "needs a decision from you",
  aborted: "stopped before it finished",
  unfinished: "hasn't finished yet",
};

export const ALL_AND_ONE =
  "Use either `--all` or a run id, not both: `--all` lists every run, and a run id reads one of them in full.";

/**
 * Newest first, by the second each run id carries rather than by when its
 * record was last written: a list is a history, so resuming an old run today
 * does not make it the newest. A run id with no stamp sorts last, and the sort
 * is stable, so runs that started in the same second keep the order they came
 * in.
 */
export function newestFirst(records: RunRecord[]): RunRecord[] {
  const startedOf = (record: RunRecord): string => startedInstant(record.runId) ?? "";
  return [...records].sort((a, b) => (startedOf(a) < startedOf(b) ? 1 : startedOf(a) > startedOf(b) ? -1 : 0));
}

/** Every run this repository holds, one to a line: which run, when it started, what it was asked to do, and how it ended. */
export function runListing(records: RunRecord[]): string[] {
  if (records.length === 0) return [NOTHING_HERE];
  return [
    `${records.length} run${records.length === 1 ? "" : "s"} in this repository, newest first:`,
    ...records.map((record) => `  ${describeRun(record)} (${OUTCOME_WORDS[runSummary(record).outcome]})`),
    "To read one in full: delivery status <run-id>",
  ];
}

/**
 * `delivery status --all`: every run this repository holds, rather than one.
 * Listing nothing is a complete answer, so an empty repository exits ok here,
 * unlike a lookup of a run that is not there, which is a failure to answer.
 */
async function listRuns(repoPath: string, ctx: CommandContext): Promise<ExitCode> {
  const records = newestFirst(await allRuns(repoPath));
  if (ctx.json) ctx.writeLine(JSON.stringify(records.map(runSummary), null, 2));
  else for (const line of runListing(records)) ctx.writeLine(line);
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
}

/** The run this command means when no id was given: the one whose record was written most recently, finished or not. */
async function mostRecent(repoPath: string): Promise<RunRecord> {
  const [latest] = await allRuns(repoPath);
  if (latest === undefined) throw new Refusal(NOTHING_HERE, EXIT.configuration);
  return latest;
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
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  if (options.all) return listRuns(repoPath, ctx);
  const record = runId === undefined ? await mostRecent(repoPath) : await readRun(repoPath, runId);
  // Indented rather than one line: a person reads this output too, and a parser does not mind.
  if (ctx.json) ctx.writeLine(JSON.stringify(await statusDocument(record, ctx), null, 2));
  else for (const line of await statusReport(record, ctx)) ctx.writeLine(line);
  return EXIT.ok;
}
