export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setBaseBranch, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog, setbackOf } from "./case-file.js";
export { computeDelta } from "./delta-rule.js";
export { createCommandGate } from "./command-gate.js";
export { createCustomGate, loadCustomGate } from "./custom-gate.js";
export { resolveGate } from "./resolve-gate.js";
export { recordBaseline, runCheck } from "./run-gate.js";
export { branchName, provisionWorktree } from "./provision.js";
export { resolveCloser } from "./resolve-closer.js";
export { createMergeBackCloser } from "./merge-back-closer.js";
export { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
export { failedCloser, teardownWorktree } from "./closer-support.js";
export { createCustomCloser, loadCustomCloser } from "./custom-closer.js";
export { advance, run } from "./surface.js";
export { noopCloser } from "./ports.js";
export { deterministicRouter } from "./router.js";
export type { AdvanceResult, RunResult } from "./surface.js";
export type {
  AgentRole,
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
  CloseOutcome,
  CloseReport,
  CloserPort,
  SurfacePorts,
  SurfaceLocation,
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
  TaskDef,
  GateRef,
  CloserRef,
  Assertion,
  GateReport,
  NewFailure,
  DeltaResult,
  DeltaOptions,
} from "./schema.js";
export type { ResumeAction, Setback } from "./case-file.js";
export type { Gate, GateContext } from "./command-gate.js";
export {
  FileNotFound,
  CorruptCaseFile,
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
} from "./errors.js";
export { WorkerEnvelope, workerRoleConfig, gateMaintenanceRoleConfig, validateRoleConfig, READ_ONLY_TOOLS } from "./role-config.js";
export type { Envelope, RoleConfig } from "./role-config.js";
export { SharpenedBrief, GateRepairBrief, CloseRepairBrief, EscalationPacket, TriageEnvelope, triageRoleConfig } from "./triage-role-config.js";
export { assemblePrompt, resolveEvidence, NO_PRIOR_TRIAGE } from "./prompt-assembly.js";
export type { AssembledPrompt, PromptEvidence, PromptSetback } from "./prompt-assembly.js";
export { invoke, DID_NOT_COMPLETE, buildSessionOptions, createAgentPort } from "./agent-invoke.js";
export type { SessionEnvironment, RoleConfigs } from "./agent-invoke.js";
export { createToolAuthority, refusalSentence, outsideWorktreeSentence, authorityRefusal } from "./tool-authority.js";
export type { ToolAuthority } from "./tool-authority.js";
export { createAgentTriage, needsJudgement, toTriageVerdict, legalVerdicts } from "./triage.js";
export { buildEscalationPacket, resolveEscalationPacket, POPULATION_LABELS, SETBACK_LABELS, NO_PRIOR_ATTEMPTS } from "./escalation-packet.js";
export type { PacketFacts } from "./escalation-packet.js";
