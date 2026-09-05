export { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setOutcome, incrementBudget, writeRef, readRef } from "./case-file.js";
export { computeDelta } from "./delta-rule.js";
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
  GateState,
  Assertion,
  GateReport,
  NewFailure,
  DeltaResult,
  DeltaOptions,
} from "./schema.js";
export type { ResumeAction } from "./case-file.js";
export {
  FileNotFound,
  CorruptCaseFile,
  ImmutabilityViolation,
  WriteFailure,
} from "./errors.js";
