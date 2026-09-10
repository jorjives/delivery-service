export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog } from "./case-file.js";
export { computeDelta } from "./delta-rule.js";
export { createCommandGate } from "./command-gate.js";
export { createCustomGate, loadCustomGate } from "./custom-gate.js";
export { resolveGate } from "./resolve-gate.js";
export { recordBaseline, runCheck } from "./run-gate.js";
export { branchName, provisionWorktree } from "./provision.js";
export { advance, run } from "./surface.js";
export { noopCloser } from "./ports.js";
export { deterministicRouter } from "./router.js";
export type { AdvanceResult, RunResult } from "./surface.js";
export type {
  AgentRole,
  RoleHandle,
  AgentContext,
  Terminus,
  AgentPort,
  TriageInput,
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
  Assertion,
  GateReport,
  NewFailure,
  DeltaResult,
  DeltaOptions,
} from "./schema.js";
export type { ResumeAction } from "./case-file.js";
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
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
} from "./errors.js";
export { WorkerEnvelope, workerRoleConfig, validateRoleConfig } from "./role-config.js";
export type { Envelope, RoleConfig } from "./role-config.js";
export { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
export type { AssembledPrompt, PromptEvidence } from "./prompt-assembly.js";
export { invoke, DID_NOT_COMPLETE, buildSessionOptions } from "./agent-invoke.js";
export type { SessionEnvironment } from "./agent-invoke.js";
export { createToolAuthority, refusalSentence, outsideWorktreeSentence, authorityRefusal } from "./tool-authority.js";
export type { ToolAuthority } from "./tool-authority.js";
