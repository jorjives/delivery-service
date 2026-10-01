import { z } from "zod";
import { OutcomeCause, UsageLimit } from "../schema.js";

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
  population: z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]),
  used: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});
export type BudgetRow = z.infer<typeof BudgetRow>;

/** One task. Every key is always there: null where the record does not hold the fact. */
export const ReportSurface = z.object({
  /** The task's own run id; null for a task with no run yet. */
  run: z.string().nullable(),
  /** The task's wording. */
  task: z.string(),
  /** Its place in the project's list as written now. */
  queue: QueuePosition.nullable(),
  standing: Standing,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** How it ended, as the run recorded it. */
  reason: z.string().nullable(),
  cause: OutcomeCause.nullable(),
  /** How this task's work is landed, as its run pinned it. */
  closer: z.enum(["merge-back", "commit-to-branch", "open-pr", "custom"]).nullable(),
  branch: z.string().nullable(),
  base: z.string().nullable(),
  /** How many times the agent was set to work on the task. */
  attempts: z.number().int().nonnegative(),
  budgets: z.array(BudgetRow),
  /** The usage limit that stopped the task's last session, when one did. */
  limit: UsageLimit.nullable(),
  /** Stopped tasks only. */
  plain: Plain.nullable(),
});
export type ReportSurface = z.infer<typeof ReportSurface>;

/** The run of several tasks at once a report is about. */
export const ReportRun = z.object({
  runId: z.string(),
  startedAt: z.string().nullable(),
  tasks: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  outcome: z.enum(["drained", "escalated"]).nullable(),
  finishedAt: z.string().nullable(),
  reason: z.string().nullable(),
  cause: z.enum(["shared_environment", "usage_limit"]).nullable(),
  limit: UsageLimit.nullable(),
  runBudgets: z.object({ gateMaintenance: z.object({ used: z.number().int().nonnegative(), max: z.number().int().positive() }) }),
});
export type ReportRun = z.infer<typeof ReportRun>;

/** A record that could not be read back: which run, which of its files, and the list task it answered for when that could still be told. */
export const DamagedRecord = z.object({ run: z.string(), file: z.string(), queue: QueuePosition.nullable() });
export type DamagedRecord = z.infer<typeof DamagedRecord>;

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
});
export type ReportDocument = z.infer<typeof ReportDocument>;
