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

/**
 * What a project may change about one role, and nothing else: its
 * instructions and its permitted tools. The reply shape stays the harness's
 * own. Each field is optional, and an omitted one keeps the built-in value.
 * No list of valid tool names exists or is checked here: nothing could keep
 * one in step with the installed agent runtime, and what a role can reach is
 * bounded by the tool guard whatever is listed.
 */
export const RoleOverride = z
  .object({
    systemPromptFragment: Written.optional(),
    allowedTools: z.array(Written).min(1).optional(),
  })
  .strict();
export type RoleOverride = z.infer<typeof RoleOverride>;

/** The roles a project may change. Triage is absent on purpose: it stays a library-level choice. */
export const RoleOverrides = z
  .object({
    worker: RoleOverride.optional(),
    gateMaintenance: RoleOverride.optional(),
  })
  .strict();
export type RoleOverrides = z.infer<typeof RoleOverrides>;

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
  // What the project changed about the worker and gate maintenance, pinned at
  // CREATE like domainPrompt so a resumed run is told what it was told before
  // and can never regain a tool its project had taken away. Only the plain
  // fields are kept: the full roles are rebuilt from the shipped ones.
  // Optional: records written before overrides existed stay valid.
  roleOverrides: RoleOverrides.optional(),
  baseline: GateReport.nullable(),
  // The local branch this surface was provisioned from, pinned once at
  // PROVISIONING so a later default-branch change cannot redirect the close.
  baseBranch: z.string().nullable(),
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

export const DispatchEntry = z.object({
  t: z.literal("dispatch"),
  attempt: z.number().int().positive(),
  sessionKey: z.string(),
  briefRef: z.string().optional(),
  // Absent means "worker" — every Item 1/2 case file stays valid.
  role: z.enum(["worker", "gate-maintenance"]).optional(),
});
export type DispatchEntry = z.infer<typeof DispatchEntry>;

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
});
export type TerminusEntry = z.infer<typeof TerminusEntry>;

export const GateEntry = z.object({
  t: z.literal("gate"),
  attempt: z.number().int().positive(),
  status: GateStatus,
  newFailures: z.array(z.object({ id: z.string(), detailRef: z.string() })),
  class: z.enum(["fail", "error"]).optional(),
});
export type GateEntry = z.infer<typeof GateEntry>;

export const TriageEntry = z.object({
  t: z.literal("triage"),
  afterAttempt: z.number().int().positive(),
  trigger: z.string(),
  verdict: z.enum(["reroute", "escalate", "fix_the_gate", "retry_close", "abort", "recheck_gate"]),
  rationale: z.string(),
  artifactRef: z.string(),
});
export type TriageEntry = z.infer<typeof TriageEntry>;

export const CloseEntry = z.object({
  t: z.literal("close"),
  status: z.enum(["DONE", "FAIL", "ERROR"]),
  detailRef: z.string(),
});
export type CloseEntry = z.infer<typeof CloseEntry>;

export const BaselineEntry = z.object({
  t: z.literal("baseline"),
  status: GateStatus,
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

export const CaseFileOutcome = z.object({
  kind: z.enum(["closed", "escalated", "aborted"]),
  source: z.string(),
  reason: z.string(),
  at: z.string(), // ISO 8601
  // Escalated only: the ref holding the EscalationPacket a person reads.
  // Optional, so every case file written before packets existed stays valid.
  packetRef: z.string().optional(),
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

export const RunHeader = z.object({
  runId: z.string().min(1),
  repoPath: z.string().min(1),
  concurrency: z.number().int().positive(),
  // How many tasks the list held when the run started: the M in "[n/M]".
  tasks: z.number().int().nonnegative(),
});
export type RunHeader = z.infer<typeof RunHeader>;

const Slot = z.number().int().positive();

export const RunEntry = z.discriminatedUnion("t", [
  z.object({ t: z.literal("slot_fill"), slot: Slot, surfaceId: z.string().min(1), taskDef: TaskDef }),
  z.object({ t: z.literal("slot_free"), slot: Slot, surfaceId: z.string().min(1), outcome: SlotOutcome }),
]);
export type RunEntry = z.infer<typeof RunEntry>;

export const RunOutcome = z.object({
  // Every task the run could take was taken and has ended.
  kind: z.literal("drained"),
  at: z.string(), // ISO 8601
});
export type RunOutcome = z.infer<typeof RunOutcome>;

// What lives in run.json on disk
export const RunJson = z.object({ header: RunHeader, outcome: RunOutcome.optional() });
export type RunJson = z.infer<typeof RunJson>;

// The full in-memory run file (run.json + log.jsonl)
export const RunFile = z.object({ header: RunHeader, history: z.array(RunEntry), outcome: RunOutcome.optional() });
export type RunFile = z.infer<typeof RunFile>;
