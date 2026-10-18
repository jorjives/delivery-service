import { z } from "zod";
import { BreakerState, FenceMode, GuardName, OutcomeCause, Population, RepairChanges, RepairStatus, SurfaceState, TriageEntry, Trip, UsageLimit } from "../schema.js";
import { EscalationPacket, SharpenedBrief } from "../triage-role-config.js";

/** The version every report document names itself by. A later version adds keys; it never renames or removes one. */
export const REPORT_SCHEMA = "delivery.report/1";

/**
 * Where one task stands. The first six are the standings a run of several at
 * once already reports; `not_started` is a list task with no run of its own
 * yet, which a list worked down one at a time leaves behind a task that did
 * not finish.
 */
export const Standing = z.enum(["closed", "escalated", "aborted", "paused", "unfinished", "queued", "not_started"]);
export type Standing = z.infer<typeof Standing>;

/** What kind of stop a stopped task was, as the owner is told it. */
export const PlainGroup = z.enum(["needs_your_decision", "failed_after_attempts", "abandoned", "needs_an_engineer", "stopped"]);
export type PlainGroup = z.infer<typeof PlainGroup>;

/** Who must act on a stopped task. `unknown` when the record does not say why it stopped. */
export const Audience = z.enum(["owner", "engineer", "unknown"]);
export type Audience = z.infer<typeof Audience>;

/** An item the item ledger has set aside on this machine, and what it waits on. */
export const ParkedItem = z.object({
  item: z.string(),
  intent: z.string().nullable(),
  reason: z.enum(["decision", "escalated", "attempts"]),
  question: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastRun: z.string().nullable(),
});
export type ParkedItem = z.infer<typeof ParkedItem>;

/**
 * The delivery branch a `--sources` run lands its tasks on: what has landed on it since it opened, what the closer last
 * did with it, and what blocks it. From this machine's ledger.
 */
export const ReportDelivery = z.object({
  branch: z.string(),
  base: z.string(),
  openedAt: z.string(),
  tip: z.string().nullable(),
  landed: z.array(z.object({ run: z.string(), item: z.string(), intent: z.string(), commit: z.string(), at: z.string() })),
  closer: z.object({ status: z.enum(["DONE", "FAIL", "ERROR"]), detail: z.string(), at: z.string() }).nullable(),
  blocked: z.object({ reason: z.string(), at: z.string() }).nullable(),
});
export type ReportDelivery = z.infer<typeof ReportDelivery>;

/**
 * One batch of after-landing steps (spec §5.7): the landed commit and the tasks it held, and each step with what
 * became of it. From this machine's after ledger.
 */
export const ReportAfter = z.object({
  batch: z.string(),
  branch: z.string(),
  commit: z.string(),
  at: z.string(),
  landed: z.array(z.object({ run: z.string(), item: z.string(), intent: z.string() })),
  steps: z.array(z.object({ for: z.string(), label: z.string(), status: z.enum(["done", "failed", "skipped", "pending"]), detail: z.string().nullable(), at: z.string().nullable() })),
});
export type ReportAfter = z.infer<typeof ReportAfter>;

/** A stopped task in the owner's words: every sentence fixed, except the agent's own, which is quoted. */
export const Plain = z.object({
  group: PlainGroup,
  audience: Audience,
  sentence: z.string(),
  /** The agent's own last explanation, verbatim; null when the record holds none. */
  agentSaid: z.string().nullable(),
  /** What to do, in order. Empty when the record backs no advice. */
  next: z.array(z.string()),
});
export type Plain = z.infer<typeof Plain>;

const QueuePosition = z.object({ task: z.number().int().positive(), of: z.number().int().positive() });

const BudgetRow = z.object({
  population: Population,
  used: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});
export type BudgetRow = z.infer<typeof BudgetRow>;

/**
 * One triage round: what set it off, what was decided and why, in the
 * harness's own words, with what the round produced for whoever came next.
 */
export const Decision = z.object({
  /** The attempt the round followed. */
  afterAttempt: TriageEntry.shape.afterAttempt,
  trigger: TriageEntry.shape.trigger,
  verdict: TriageEntry.shape.verdict,
  /** The round's reasoning, word for word. */
  rationale: z.string(),
  /** Whether what the round wrote beside the log could be read back. False: `brief` and `packet` are null because the record cannot say, not because the round wrote neither. */
  recorded: z.boolean(),
  /** The brief the round wrote for the next session; null when it wrote none, or when what it wrote cannot be read back (`recorded` says which). */
  brief: SharpenedBrief.nullable(),
  /** The packet the round wrote for a person; null likewise. */
  packet: EscalationPacket.nullable(),
});
export type Decision = z.infer<typeof Decision>;

/** One step a task was in, and when it entered it; `at` is null for a record made before steps carried a time. */
export const StateVisit = z.object({ state: SurfaceState, at: z.string().nullable() });
export type StateVisit = z.infer<typeof StateVisit>;

/**
 * Why a task stopped, as the document tells it. The record's own shape carries
 * `role` and `population` only for the kinds that have one; every key of the
 * document is always present, so this names both, with null where the kind has none.
 */
export const SurfaceCause = z.object({
  kind: OutcomeCause.shape.kind,
  role: OutcomeCause.shape.role.unwrap().nullable(),
  population: OutcomeCause.shape.population.unwrap().nullable(),
  pullRequest: OutcomeCause.shape.pullRequest.unwrap().nullable(),
  question: OutcomeCause.shape.question.unwrap().nullable(),
});

/**
 * What the agent runtime reported for some agent sessions, added up over those
 * that reported both figures: an estimated cost in US dollars, and the time the
 * sessions took. Never zero for lack of data: where nothing was recorded the
 * document holds null instead.
 */
export const UsageTotal = z.object({ costUsd: z.number().nonnegative(), durationMs: z.number().int().nonnegative() });
export type UsageTotal = z.infer<typeof UsageTotal>;

/** How many agent sessions a figure covers (`recorded`) of how many ran (`sessions`): it is the whole only when the two are equal. */
export const UsageCoverage = z.object({ recorded: z.number().int().nonnegative(), sessions: z.number().int().nonnegative() });
export type UsageCoverage = z.infer<typeof UsageCoverage>;

/** One file a repair changed, as the document tells it: `patch` is null for a binary file or one past the size kept. */
export const RepairFile = RepairChanges.shape.files.element.extend({ patch: z.string().nullable() });
export type RepairFile = z.infer<typeof RepairFile>;

/**
 * One repair session that ran in a task's working copy: the task's own repair
 * of the check (`of: "check"`), or its run's repair of the setup every task
 * shares (`of: "setup"`), with what it changed there as recorded. Shown, never
 * judged: `touchesCheck` on a file says only that the check runs it.
 */
export const ReportRepair = z.object({
  of: z.enum(["check", "setup"]),
  /** Which of the repairs its limit allows this was, and how many that limit allows. */
  attempt: z.number().int().positive(),
  max: z.number().int().positive(),
  /** When it was set going; null for a record from before steps carried a time. */
  at: z.string().nullable(),
  /** How its session ended; null while it is still going. */
  status: RepairStatus.nullable(),
  /** Whether the record holds what it changed. False: `files` is empty because the record cannot say, not because it changed nothing. */
  recorded: z.boolean(),
  files: z.array(RepairFile),
  /** Whether a patch was left out: a binary file, or the size kept was reached. */
  truncated: z.boolean(),
});
export type ReportRepair = z.infer<typeof ReportRepair>;

/** One task. Every key is always there: null where the record does not hold the fact. */
export const ReportSurface = z.object({
  /** The task's own run id; null for a task with no run yet. */
  run: z.string().nullable(),
  /** The task's wording. */
  task: z.string(),
  /** What the task says of itself for a reader of the data, from its own `tags` when each is a string, number or true/false; null otherwise. A fix of a problem a review found carries `pack`, `findingId`, `severity` and `phase`. */
  tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  /** Its place in the project's list as written now. */
  queue: QueuePosition.nullable(),
  standing: Standing,
  /** The state the record is in; null for a task with no run. Right for a task that is going; a killed run can leave it one step behind its log. */
  state: SurfaceState.nullable(),
  /** Every step the log shows the task entering, oldest first; a step entered again is there again. Empty before the first step is recorded. */
  states: z.array(StateVisit),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** The latest time the record holds: when it ended, else its last recorded step. null when it holds none. Never measured against now. */
  lastActivityAt: z.string().nullable(),
  /** How it ended, as the run recorded it. */
  reason: z.string().nullable(),
  cause: SurfaceCause.nullable(),
  /** How this task's work is landed, as its run pinned it. */
  closer: z.enum(["merge-back", "commit-to-branch", "open-pr", "custom", "delivery-branch"]).nullable(),
  branch: z.string().nullable(),
  base: z.string().nullable(),
  /** Whether the task's sessions ran inside the write fence, how the run was set, and why not when they did not; null for a run recorded before the fence was. */
  fence: z.object({ mode: FenceMode, present: z.boolean(), reason: z.string().nullable() }).nullable(),
  /** How the task's test guards differ from the defaults: what it added and what it turned off; null when they do not. */
  guards: z.object({ added: z.array(GuardName), off: z.array(GuardName) }).nullable(),
  /** The workflow step the task is on, by place and name; null for a task run without a workflow, or with no run. */
  workflow: z.object({ name: z.string(), step: z.number().int().positive(), of: z.number().int().positive(), stepName: z.string() }).nullable(),
  /** How many times the agent was set to work on the task. */
  attempts: z.number().int().nonnegative(),
  budgets: z.array(BudgetRow),
  /** Every triage round, oldest first. */
  decisions: z.array(Decision),
  /** Every repair that ran in the task's working copy, its own and its run's, oldest first. */
  repairs: z.array(ReportRepair),
  /** What the task's own agent sessions took and cost, as the runtime reported them; null when none recorded it. A run's repair of the shared setup is the run's, not the task's. */
  usage: UsageTotal.nullable(),
  /** How many of the task's agent sessions `usage` covers, of how many it set going. */
  usageRecorded: UsageCoverage,
  /** The usage limit that stopped the task's last session, when one did. */
  limit: UsageLimit.nullable(),
  /** The packet the task stopped with, word for word as the harness wrote it for a person; null for a task that did not stop for one, or whose packet cannot be read back. */
  escalation: EscalationPacket.nullable(),
  /** Stopped tasks only. */
  plain: Plain.nullable(),
  /** The work-source item the task was, such as backlog:x.md; null for any other task. */
  item: z.string().nullable(),
});
export type ReportSurface = z.infer<typeof ReportSurface>;

/**
 * What tripped the breaker, as the document tells it. The record holds one shape
 * for each of the two kinds; the document names the keys of both, with null for
 * `reason` where the kind is not `gate_maintenance` and for `surfaceIds` where it
 * is not `gate_error_aggregate`.
 */
export const TripCause = z.object({
  kind: z.enum(["gate_maintenance", "gate_error_aggregate"]),
  surfaceId: z.string().min(1),
  reason: z.string().nullable(),
  surfaceIds: z.array(z.string().min(1)).nullable(),
});

/** One time the setup every task shares broke, as the document tells it: the record's own trip, with its cause given every key. */
export const ReportTrip = Trip.extend({ cause: TripCause });
export type ReportTrip = z.infer<typeof ReportTrip>;

/** The run of several tasks at once a report is about. */
export const ReportRun = z.object({
  runId: z.string(),
  startedAt: z.string().nullable(),
  tasks: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  /** Whether the run says how the report's tasks stand. Always true in a report on the run itself; false in a report on the task list once a task of it was worked on its own after the run began, when the run is only history. */
  governs: z.boolean(),
  /** Whether the setup every task shares is fit to use, as the run's own record leaves it. */
  breaker: BreakerState,
  outcome: z.enum(["drained", "escalated"]).nullable(),
  finishedAt: z.string().nullable(),
  /** The latest time the run's own record or any task it took holds; null when they hold none. */
  lastActivityAt: z.string().nullable(),
  reason: z.string().nullable(),
  cause: z.enum(["shared_environment", "usage_limit"]).nullable(),
  limit: UsageLimit.nullable(),
  runBudgets: z.object({ gateMaintenance: z.object({ used: z.number().int().nonnegative(), max: z.number().int().positive() }) }),
});
export type ReportRun = z.infer<typeof ReportRun>;

/** A record that could not be read back: which run, which of its files, and the list task it answered for when that could still be told. */
export const DamagedRecord = z.object({ run: z.string(), file: z.string(), queue: QueuePosition.nullable() });
export type DamagedRecord = z.infer<typeof DamagedRecord>;

/** The step a task's record shows it in: the last its log entered, or the one the record was created in before any is logged. null for a task with no run. */
export function stepOf(surface: ReportSurface): StateVisit | null {
  return surface.states.at(-1) ?? (surface.state === null ? null : { state: surface.state, at: null });
}

/** The latest of some recorded times; null when there are none. ISO 8601 UTC instants order as text. */
export function latestOf(times: readonly (string | null | undefined)[]): string | null {
  return times.reduce<string | null>((latest, time) => (time != null && (latest === null || time > latest) ? time : latest), null);
}

/**
 * The last time the record shows anything happening, for the whole report. A run of several at once has its own; a
 * list worked one task at a time has only its tasks', and says nothing when a task that ran holds no time at all:
 * that task may have been the last to move.
 */
export function lastActivity(doc: ReportDocument): string | null {
  if (doc.run?.governs) return doc.run.lastActivityAt;
  const ran = doc.surfaces.filter((surface) => surface.run !== null);
  return ran.every((surface) => surface.lastActivityAt !== null) ? latestOf(ran.map((surface) => surface.lastActivityAt)) : null;
}

/**
 * What happened, as data: one document for a single task, a run of several at
 * once, or the project's task list. Derived from the record alone
 * (`deriveReport`) and rendered by whoever reads it (`renderText`).
 */
export const ReportDocument = z.object({
  schema: z.literal(REPORT_SCHEMA),
  kind: z.enum(["task", "run", "list"]),
  /** Whether the work is going right now. null when nothing records it: a run of one task at a time holds no lock. */
  live: z.boolean().nullable(),
  /** Records left out because they are damaged. Non-empty marks the report incomplete. */
  incomplete: z.array(DamagedRecord),
  counts: z.record(Standing, z.number().int().nonnegative()),
  run: ReportRun.nullable(),
  surfaces: z.array(ReportSurface),
  /** Every time the setup the run's tasks share broke, oldest first; empty where the report has no run of several tasks. */
  trips: z.array(ReportTrip),
  /** What every agent session behind the report took and cost: its tasks', and its run's own repairs of the shared setup. null when none recorded it. */
  usage: UsageTotal.nullable(),
  /** How many of those sessions `usage` covers, of how many ran. */
  usageRecorded: UsageCoverage,
  /** Items the item ledger has set aside on this machine, oldest key first; empty when none or no ledger. */
  parked: z.array(ParkedItem),
  /** The delivery branch this machine's runs land on, or null when none was ever opened. */
  delivery: ReportDelivery.nullable(),
  /** After-landing steps: every batch still waiting on a step, then the most recent, oldest first; empty when none ran on this machine. */
  after: z.array(ReportAfter),
});
export type ReportDocument = z.infer<typeof ReportDocument>;
