import { z } from "zod";

// --- Primitives ---

export const SurfaceState = z.enum([
  "PROVISIONING", "PRE_GATING", "AGENT_ACTIVE", "GATING",
  "GATE_MAINTENANCE", "TRIAGE", "CLOSING", "INCOMPLETE_TERMINUS",
  "CLOSED", "ESCALATED", "ABORTED",
]);
export type SurfaceState = z.infer<typeof SurfaceState>;

export const Budget = z.object({
  used: z.number().int().nonnegative(),
  max: z.number().int().positive(),
});
export type Budget = z.infer<typeof Budget>;

export const BudgetSet = z.object({
  correction: Budget,
  gateError: Budget,
  gateMaintenance: Budget,
  terminus: Budget,
  close: Budget,
});
export type BudgetSet = z.infer<typeof BudgetSet>;

export type BudgetPopulation = keyof BudgetSet;

// --- Header ---

// TaskDef is opaque to persistence (defined by a later item) and stays a
// passthrough JSON object. GateRef is typed: gate resolution switches on it.
export const TaskDef = z.record(z.string(), z.unknown());
export type TaskDef = z.infer<typeof TaskDef>;

/** The guards by name, in the order they are told. Each judges one way of weakening the tests. */
export const GuardName = z.enum(["tests-untouched", "tests-unchanged", "check-untouched", "no-skips", "ignored"]);
export type GuardName = z.infer<typeof GuardName>;

export const GateRef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.string(),
    parseMode: z.enum(["tap", "junit", "exitcode"]),
    failOnNewAssertions: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("custom"),
    modulePath: z.string(),
    exportName: z.string().optional(),
    failOnNewAssertions: z.boolean().optional(),
  }),
]);
export type GateRef = z.infer<typeof GateRef>;

/**
 * Which closer this surface uses, as data. A project names a built-in strategy
 * and its parameters, or points at its own closer module; it never implements
 * one inline. No variant takes a base branch: the target is the branch pinned
 * at provisioning, so an owner never restates something the harness already
 * derived. A `custom` `modulePath` that is relative resolves against the
 * repository root, never the worktree, exactly as a custom gate's does.
 */
export const CloserRef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("merge-back"),
    deleteBranch: z.boolean().optional(),
  }),
  // No parameters: the branch to commit to is the surface's own, and the COULD-tier
  // `push` is deliberately absent until it is built rather than parsed and ignored.
  z.object({ type: z.literal("commit-to-branch") }),
  // No parameters: the pull request targets the pinned base branch. The spec's
  // titleTemplate/bodyTemplate are deliberately absent until an owner needs
  // them; the defaults name the surface and the task.
  z.object({ type: z.literal("open-pr") }),
  z.object({
    type: z.literal("custom"),
    modulePath: z.string(),
    exportName: z.string().optional(),
  }),
]);
export type CloserRef = z.infer<typeof CloserRef>;

// The gate's own three-way verdict — reused wherever a status is one report's
// or one entry's, as opposed to a delta/verdict computed from two of them.
export const GateStatus = z.enum(["PASS", "FAIL", "ERROR"]);
export type GateStatus = z.infer<typeof GateStatus>;

export const Assertion = z.object({
  id: z.string(),
  outcome: GateStatus,
  detail: z.string(),
});
export type Assertion = z.infer<typeof Assertion>;

export const GateReport = z.object({
  status: GateStatus,
  assertions: z.array(Assertion),
  detail: z.string().optional(),
});
export type GateReport = z.infer<typeof GateReport>;

/**
 * What a closer returns. A schema, as `GateReport` is, so a custom closer's
 * return value is validated at runtime before the harness believes it.
 */
export const CloseReport = z.object({
  status: z.enum(["DONE", "FAIL", "ERROR"]),
  detail: z.string(),
});
export type CloseReport = z.infer<typeof CloseReport>;

export const NewFailure = z.object({
  id: z.string(),
  baselineOutcome: z.enum(["PASS", "ABSENT"]),
  checkOutcome: z.enum(["FAIL", "ERROR", "ABSENT"]),
  detail: z.string(),
});
export type NewFailure = z.infer<typeof NewFailure>;

export const DeltaResult = z.object({
  pass: z.boolean(),
  newFailures: z.array(NewFailure),
  class: z.enum(["fail", "error"]).nullable(),
});
export type DeltaResult = z.infer<typeof DeltaResult>;

export const DeltaOptions = z.object({
  failOnNewAssertions: z.boolean().optional(),
});
export type DeltaOptions = z.infer<typeof DeltaOptions>;

/**
 * Something written that says something. Whitespace alone is nothing written,
 * so it is refused rather than sent to an agent as a blank instruction. The
 * one non-empty-string check in the codebase: `cli/config.ts`'s `Prose` is
 * this schema too, kept under its own name there for what it reads as prose.
 */
export const Written = z.string().refine((text) => text.trim() !== "");

/** The session options the harness sets itself for every session. The `agent` block may not name them. */
export const HARNESS_OWNED = ["cwd", "systemPrompt", "outputFormat", "resume", "sessionId", "permissionMode", "allowDangerouslySkipPermissions", "pathToClaudeCodeExecutable"] as const;

export const harnessOwned = (key: string): string => `\`agent.${key}\` is set by the harness for every session, so it can't be changed here. Remove it.`;

/**
 * Options for every agent session, passed to Claude Code unchanged: any SDK
 * option the harness does not own (model, effort, maxTurns, plugins, mcpServers,
 * settings, sandbox, ...), so an option is usable the day the SDK ships it. Plus
 * `append`, text added to what every agent is told. `env` is merged with the
 * run's own environment, the harness's own keys winning.
 */
export const AgentOptions = z
  .looseObject({ append: Written.optional(), env: z.record(z.string(), z.string()).optional() })
  .superRefine((options, ctx) => {
    for (const key of HARNESS_OWNED) if (key in options) ctx.addIssue({ code: "custom", path: [key], message: harnessOwned(key) });
  });
export type AgentOptions = z.infer<typeof AgentOptions>;

export const CaseFileHeader = z.object({
  surfaceId: z.string(),
  taskDef: TaskDef,
  gateRef: GateRef,
  // The closer this surface was started with, pinned at CREATE like gateRef so a
  // later configuration change cannot redirect an in-flight surface to a
  // different closer. Optional: case files written before closers were pinned
  // stay valid, and they carry a caller-supplied closer instead.
  closerRef: CloserRef.optional(),
  domainPrompt: z.string().optional(),
  // The project's agent options, pinned at CREATE like domainPrompt so a resumed
  // run's sessions are set up as they were. Optional: older records stay valid.
  agent: AgentOptions.optional(),
  // Records made before `roles` was removed carry what they changed; nothing reads it now.
  roleOverrides: z.unknown().optional(),
  baseline: GateReport.nullable(),
  // The local branch this surface was provisioned from, pinned once at
  // PROVISIONING so a later default-branch change cannot redirect the close.
  baseBranch: z.string().nullable(),
  // The commit the task's worktree started from, pinned with baseBranch at
  // provisioning. The guards diff from it, so moving HEAD back cannot hide a
  // deleted test. Optional: a record made before it was pinned has none.
  startCommit: z.string().optional(),
  // A custom gate's module, hashed when the run started. Checked on every
  // round, so a gate edited mid-run fails the round. Absent for a command gate,
  // whose command the guards already compare, and for older records.
  gateDigest: z.string().optional(),
});
export type CaseFileHeader = z.infer<typeof CaseFileHeader>;

// Header without the fields the surface fills in later — the public input type for create()
export type CreateHeader = Omit<CaseFileHeader, "baseline" | "baseBranch">;

// --- Cursor ---

export const CaseFileCursor = z.object({
  state: SurfaceState,
  budgets: BudgetSet,
  worktreeRef: z.string(),
});
export type CaseFileCursor = z.infer<typeof CaseFileCursor>;

// --- History entries ---

/**
 * When a step was recorded: ISO 8601, UTC. Stamped by the two functions that
 * write a log line (`appendEntry`, `appendRunEntry`) and by nothing else, and
 * read only by reporting: nothing that decides what a run does next reads it.
 * Optional, so every record written before steps carried a time stays valid.
 */
const At = z.iso.datetime();

export const DispatchEntry = z.object({
  t: z.literal("dispatch"),
  attempt: z.number().int().positive(),
  sessionKey: z.string(),
  briefRef: z.string().optional(),
  // Absent means "worker" — every Item 1/2 case file stays valid.
  role: z.enum(["worker", "gate-maintenance"]).optional(),
  at: At.optional(),
});
export type DispatchEntry = z.infer<typeof DispatchEntry>;

/** The kinds of retry a task budgets. */
export const Population = z.enum(["correction", "gateError", "gateMaintenance", "terminus", "close"]);
export type Population = z.infer<typeof Population>;

/** A usage limit that can stop an agent session: the API's request rate, or the account's spending cap. */
export const UsageLimit = z.enum(["rate", "spend"]);
export type UsageLimit = z.infer<typeof UsageLimit>;

/**
 * What the agent runtime reported for one session: its estimated cost in US
 * dollars (the SDK's `total_cost_usd`, which covers any subagents) and how long
 * it took (`duration_ms`). Either is absent when the runtime did not report it.
 * Recorded for reporting only: nothing that decides what a run does next reads it.
 */
export const SessionUsage = z.object({
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type SessionUsage = z.infer<typeof SessionUsage>;

export const TerminusEntry = z.object({
  t: z.literal("terminus"),
  attempt: z.number().int().positive(),
  sessionKey: z.string(),
  status: z.enum(["completed", "escalate", "incomplete"]),
  category: z.enum(["exhaustion", "authority"]).optional(),
  rationale: z.string(),
  role: z.enum(["worker", "gate-maintenance"]).optional(),
  // Incomplete only: no session happened at all. Persisted because the routing
  // decision it drives must be the same whether it is taken live or re-derived
  // from the log on resume. Optional, so every case file written before it
  // existed stays valid and keeps the retry it was recorded expecting.
  notRun: z.literal(true).optional(),
  // Incomplete only: a usage limit stopped the session. Recorded so a report
  // can say so; no routing decision reads it.
  limit: UsageLimit.optional(),
  // Repair sessions only: the ref holding what the session changed in the
  // working copy (`RepairChanges`). Absent for a record made before changes
  // were kept, or where they could not be read. No routing decision reads it.
  changesRef: z.string().optional(),
  // What the runtime reported the session cost and took. Absent for a record made before it was kept, a session that never ran, or one whose end was recovered. No routing decision reads it.
  usage: SessionUsage.optional(),
  at: At.optional(),
});
export type TerminusEntry = z.infer<typeof TerminusEntry>;

/** How a file stands after a repair: renames are told as a deleted file and an added one. */
export const RepairFileStatus = z.enum(["added", "modified", "deleted"]);
export type RepairFileStatus = z.infer<typeof RepairFileStatus>;

/**
 * What one repair session changed in the working copy it ran in, captured
 * with git before its terminus was recorded and kept as a ref beside the log.
 * `patch` is absent for a binary file or one past the size kept; `truncated`
 * says that happened. `touchesCheck` says only that the path is one the check
 * runs, never whether the change was safe. Read only by reporting.
 */
export const RepairChanges = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      status: RepairFileStatus,
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      touchesCheck: z.boolean(),
      patch: z.string().optional(),
    }),
  ),
  truncated: z.boolean(),
});
export type RepairChanges = z.infer<typeof RepairChanges>;

export const GateEntry = z.object({
  t: z.literal("gate"),
  attempt: z.number().int().positive(),
  status: GateStatus,
  newFailures: z.array(z.object({ id: z.string(), detailRef: z.string() })),
  class: z.enum(["fail", "error"]).optional(),
  at: At.optional(),
});
export type GateEntry = z.infer<typeof GateEntry>;

export const TriageEntry = z.object({
  t: z.literal("triage"),
  afterAttempt: z.number().int().positive(),
  trigger: z.string(),
  verdict: z.enum(["reroute", "escalate", "fix_the_gate", "retry_close", "abort", "recheck_gate"]),
  rationale: z.string(),
  artifactRef: z.string(),
  // Present exactly when an agent decided the round: what its session cost and took ({} when its runtime reported nothing). A round the rules decided ran no session and has none. No routing decision reads it.
  usage: SessionUsage.optional(),
  at: At.optional(),
});
export type TriageEntry = z.infer<typeof TriageEntry>;

export const CloseEntry = z.object({
  t: z.literal("close"),
  status: z.enum(["DONE", "FAIL", "ERROR"]),
  detailRef: z.string(),
  at: At.optional(),
});
export type CloseEntry = z.infer<typeof CloseEntry>;

export const BaselineEntry = z.object({
  t: z.literal("baseline"),
  status: GateStatus,
  at: At.optional(),
});
export type BaselineEntry = z.infer<typeof BaselineEntry>;

export const HistoryEntry = z.discriminatedUnion("t", [
  DispatchEntry,
  TerminusEntry,
  GateEntry,
  TriageEntry,
  CloseEntry,
  BaselineEntry,
]);
export type HistoryEntry = z.infer<typeof HistoryEntry>;

// --- Outcome ---

/**
 * Why a task stopped, as a closed set a reader can switch on. Written with the
 * outcome and read only by reporting: nothing that decides what a run does
 * next reads it.
 */
export const OutcomeCause = z.object({
  kind: z.enum([
    "authority",
    "repair_gave_up",
    "session_not_run",
    "budget",
    "triage_failure",
    "triage_escalated",
    "triage_abort",
    "provisioning",
  ]),
  // authority and session_not_run only: whose session it was.
  role: z.enum(["worker", "gate-maintenance"]).optional(),
  // budget only: which retries ran out.
  population: Population.optional(),
});
export type OutcomeCause = z.infer<typeof OutcomeCause>;

export const CaseFileOutcome = z.object({
  kind: z.enum(["closed", "escalated", "aborted"]),
  source: z.string(),
  reason: z.string(),
  at: z.string(), // ISO 8601
  // Escalated only: the ref holding the EscalationPacket a person reads.
  // Optional, so every case file written before packets existed stays valid.
  packetRef: z.string().optional(),
  // Escalated and aborted only. Optional, so every case file written before
  // causes were recorded stays valid; a reader shows such a stop as recorded.
  cause: OutcomeCause.optional(),
});
export type CaseFileOutcome = z.infer<typeof CaseFileOutcome>;

// --- Composed types ---

// What lives in case.json on disk
export const CaseJson = z.object({
  header: CaseFileHeader,
  cursor: CaseFileCursor,
  outcome: CaseFileOutcome.optional(),
});
export type CaseJson = z.infer<typeof CaseJson>;

// The full in-memory case file (case.json + log.jsonl)
export const CaseFile = z.object({
  header: CaseFileHeader,
  cursor: CaseFileCursor,
  history: z.array(HistoryEntry),
  outcome: CaseFileOutcome.optional(),
});
export type CaseFile = z.infer<typeof CaseFile>;

// --- Supervised run file: one run of several tasks at once ---

/** How a task's run ended, as its slot records it: the case file's own outcome kinds. */
export const SlotOutcome = CaseFileOutcome.shape.kind;
export type SlotOutcome = z.infer<typeof SlotOutcome>;

/**
 * Whether the environment every task of a run shares is fit to use. Never
 * stored: it is what the run file's history says, folded through the
 * transition table in `src/breaker.ts`, as a task's position is its log's.
 */
export const BreakerState = z.enum(["HEALTHY", "DEGRADED", "REPAIRING"]);
export type BreakerState = z.infer<typeof BreakerState>;

export const RunHeader = z.object({
  runId: z.string().min(1),
  repoPath: z.string().min(1),
  concurrency: z.number().int().positive(),
  // How many tasks the list held when the run started: the M in "[n/M]".
  tasks: z.number().int().nonnegative(),
  // One repair limit for the whole run, pinned when it starts, as a task pins its budgets.
  runBudgetMax: z.object({ gateMaintenance: z.number().int().positive() }),
});
export type RunHeader = z.infer<typeof RunHeader>;

const Slot = z.number().int().positive();
const SurfaceId = z.string().min(1);

export const RepairStatus = z.enum(["completed", "escalate", "incomplete"]);
export type RepairStatus = z.infer<typeof RepairStatus>;

/** What tripped the breaker. Both kinds name `surfaceId`: the task whose report tripped it, in whose copy the repair runs. */
export const BreakerCause = z.discriminatedUnion("kind", [
  // A task found the check could not run before it had started.
  z.object({ kind: z.literal("gate_maintenance"), surfaceId: SurfaceId, reason: z.string() }),
  // The check kept erroring in different tasks: `surfaceIds` is every task counted, in the order reported.
  z.object({ kind: z.literal("gate_error_aggregate"), surfaceId: SurfaceId, surfaceIds: z.array(SurfaceId).min(2) }),
]);
export type BreakerCause = z.infer<typeof BreakerCause>;

/** One repair of the setup every task shares: which attempt, whose copy it ran in, and how its session ended (null while it is still going). */
export const RepairAttempt = z.object({
  attempt: z.number().int().positive(),
  sessionKey: z.string().min(1),
  /** Whose copy and record the repair ran in: the task whose report tripped the breaker. */
  surfaceId: SurfaceId,
  status: RepairStatus.nullable(),
  rationale: z.string().nullable(),
});
export type RepairAttempt = z.infer<typeof RepairAttempt>;

/** One time the shared environment broke: what broke it, every task it held, each repair, and how it ended. Never stored: `tripsOf` folds it from the run's history. */
export const Trip = z.object({
  cause: BreakerCause,
  /** Every task it held, each once, in the order held, the one that found it first. */
  held: z.array(SurfaceId),
  repairs: z.array(RepairAttempt),
  ended: z.enum(["repaired", "gave_up"]).nullable(),
  /** Why the run gave up, when it did. */
  reason: z.string().nullable(),
  /** The usage limit that stopped the repair, when that, not the environment, is why the run gave up. */
  limit: UsageLimit.nullable(),
});
export type Trip = z.infer<typeof Trip>;

export const RunEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("slot_fill"), slot: Slot, surfaceId: SurfaceId, taskDef: TaskDef, at: At.optional() }),
  z.object({ t: z.literal("slot_free"), slot: Slot, surfaceId: SurfaceId, outcome: SlotOutcome, at: At.optional() }),
  // A task found the shared environment broken while it was healthy.
  z.object({ t: z.literal("breaker_degraded"), cause: BreakerCause, at: At.optional() }),
  // A task asked for the shared environment to be repaired; `key` names the setback it asked about, when it has one.
  z.object({ t: z.literal("repair_request"), surfaceId: SurfaceId, key: z.string().nullable(), at: At.optional() }),
  // A task's check kept erroring until its own re-checks ran out. At most one per task since the environment was last healthy.
  z.object({ t: z.literal("gate_error_signal"), surfaceId: SurfaceId, at: At.optional() }),
  // A task was held before checking or handing off its work.
  z.object({ t: z.literal("held"), surfaceId: SurfaceId, at: At.optional() }),
  // The dispatch entry is the burn on the run's repair limit.
  z.object({ t: z.literal("repair_dispatch"), attempt: z.number().int().positive(), sessionKey: z.string().min(1), surfaceId: SurfaceId, at: At.optional() }),
  // `changesRef` names the ref in the run's own folder holding what the repair changed (`RepairChanges`); read only by reporting. `usage` is what the runtime reported its session cost and took.
  z.object({ t: z.literal("repair_terminus"), attempt: z.number().int().positive(), sessionKey: z.string().min(1), status: RepairStatus, rationale: z.string(), changesRef: z.string().optional(), usage: SessionUsage.optional(), at: At.optional() }),
  z.object({ t: z.literal("breaker_healthy"), at: At.optional() }),
  // `limit` is set when a usage limit, not the environment, is why the run stopped.
  z.object({ t: z.literal("run_escalated"), reason: z.string().min(1), limit: UsageLimit.optional(), at: At.optional() }),
]);
export type RunEntry = z.infer<typeof RunEntry>;

export const RunOutcome = z.discriminatedUnion("kind", [
  // Every task the run could take was taken and has ended.
  z.object({ kind: z.literal("drained"), at: z.string() }),
  // The run stopped and no task caused it: its shared environment could not be repaired, or a usage limit stopped the repair.
  z.object({ kind: z.literal("escalated"), cause: z.enum(["shared_environment", "usage_limit"]), reason: z.string().min(1), at: z.string() }),
]);
export type RunOutcome = z.infer<typeof RunOutcome>;

// What lives in run.json on disk
export const RunJson = z.object({ header: RunHeader, outcome: RunOutcome.optional() });
export type RunJson = z.infer<typeof RunJson>;

// The full in-memory run file (run.json + log.jsonl)
export const RunFile = z.object({ header: RunHeader, history: z.array(RunEntry), outcome: RunOutcome.optional() });
export type RunFile = z.infer<typeof RunFile>;
