export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setOutcome, incrementBudget, writeRef, readRef } from "./case-file.js";
export { computeDelta } from "./delta-rule.js";
export { createCommandGate } from "./command-gate.js";
export { createCustomGate, loadCustomGate } from "./custom-gate.js";
export { resolveGate } from "./resolve-gate.js";
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
} from "./errors.js";
