export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setBaseBranch, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog, setbackOf } from "./case-file.js";
export { DEFAULT_BUDGETS } from "./budgets.js";
export { computeDelta } from "./delta-rule.js";
export { createCommandGate } from "./command-gate.js";
export { createCustomGate, loadCustomGate } from "./custom-gate.js";
export { resolveGate } from "./resolve-gate.js";
export { recordBaseline, runCheck } from "./run-gate.js";
export { branchName, provisionWorktree } from "./provision.js";
export { resolveCloser } from "./resolve-closer.js";
export { createMergeBackCloser } from "./merge-back-closer.js";
export { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
export { createOpenPrCloser } from "./open-pr-closer.js";
export { failedCloser, teardownWorktree } from "./closer-support.js";
export { createCustomCloser, loadCustomCloser } from "./custom-closer.js";
export { advance, run } from "./surface.js";
export { noopCloser } from "./ports.js";
export { deterministicRouter } from "./router.js";
export type { AdvanceResult, RunResult } from "./surface.js";
export type {
  AgentRole,
  DispatchedRole,
  RoleHandle,
  AgentContext,
  Terminus,
  Incomplete,
  TriageTerminus,
  RoleTerminusMap,
  AgentPort,
  EscalationCause,
  TriageInput,
  TriageArtifact,
  TriageVerdict,
  TriagePort,
  CloseContext,
  DeliveredTask,
  CloseOutcome,
  CloseReport,
  CloserPort,
  RepairRequest,
  CheckErrorReport,
  CheckErrorAnswer,
  RepairCoordinator,
  SurfacePorts,
  SurfaceLocation,
  Metered,
} from "./ports.js";
export type {
  CaseFile,
  CaseFileHeader,
  CreateHeader,
  CaseFileCursor,
  CaseFileOutcome,
  HistoryEntry,
  DispatchEntry,
  TerminusEntry,
  GateEntry,
  TriageEntry,
  CloseEntry,
  SurfaceState,
  BudgetSet,
  Budget,
  BudgetPopulation,
  UsageLimit,
  SessionUsage,
  TaskDef,
  GateRef,
  CloserRef,
  Assertion,
  GateReport,
  NewFailure,
  DeltaResult,
  DeltaOptions,
  RepairChanges,
} from "./schema.js";
export type { ResumeAction, Setback } from "./case-file.js";
export type { Gate, GateContext } from "./command-gate.js";
export {
  FileNotFound,
  CorruptCaseFile,
  RunFileNotFound,
  CorruptRunFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  RunHalted,
} from "./errors.js";
export { WorkerEnvelope, workerRoleConfig, gateMaintenanceRoleConfig, validateRoleConfig } from "./role-config.js";
export type { Envelope, RoleConfig } from "./role-config.js";
export { SharpenedBrief, GateRepairBrief, CloseRepairBrief, EscalationPacket, TriageEnvelope, triageRoleConfig } from "./triage-role-config.js";
export { assemblePrompt, resolveEvidence, NO_PRIOR_TRIAGE } from "./prompt-assembly.js";
export type { AssembledPrompt, PromptEvidence, PromptSetback } from "./prompt-assembly.js";
export { invoke, runSession, DID_NOT_COMPLETE, sessionErrorRef, buildSessionOptions, createAgentPort } from "./agent-invoke.js";
export type { SessionEnvironment, RoleConfigs } from "./agent-invoke.js";
export { createAgentTriage, needsJudgement, toTriageVerdict, legalVerdicts } from "./triage.js";
export { buildEscalationPacket, resolveEscalationPacket, POPULATION_LABELS, SETBACK_LABELS, NO_PRIOR_ATTEMPTS } from "./escalation-packet.js";
export type { PacketFacts } from "./escalation-packet.js";
export { REPORT_SCHEMA, ReportDocument } from "./report/document.js";
export type { Audience, BudgetRow, DamagedRecord, Decision, Plain, PlainGroup, RepairFile, ReportRepair, ReportRun, ReportSurface, ReportTrip, Standing, StateVisit } from "./report/document.js";
export { loadSnapshot } from "./report/snapshot.js";
export type { RecordSnapshot, ReportSubject } from "./report/snapshot.js";
export { deriveReport } from "./report/derive.js";
export { EVENT_SCHEMA, eventsOf, ReportEvent, streamEnded, streamStarted } from "./report/events.js";
export type { StreamEnding } from "./report/events.js";
export { renderText } from "./report/text.js";
export { publishedSchema } from "./report/json-schema.js";
export { repoLocked } from "./repo-lock.js";
export { builtInPacks, loadPack, PACK_SCHEMA, resolvePack } from "./packs/manifest.js";
export type { Pack } from "./packs/manifest.js";
export { checkItem } from "./item-check.js";
export type { CheckResult } from "./item-check.js";
export { containedSession } from "./containment.js";
export { fenceSession, probeFence, fencePaths, FenceSetting } from "./fence.js";
export { landingBoundary } from "./landing-boundary.js";
