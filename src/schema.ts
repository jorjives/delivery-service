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

export const CaseFileHeader = z.object({
  surfaceId: z.string(),
  taskDef: TaskDef,
  gateRef: GateRef,
  domainPrompt: z.string().optional(),
  baseline: GateReport.nullable(),
});
export type CaseFileHeader = z.infer<typeof CaseFileHeader>;

// Header without baseline — the public input type for create()
export type CreateHeader = Omit<CaseFileHeader, "baseline">;

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
