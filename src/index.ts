export { create, appendEntry, load, logTail } from "./case-file.js";
export type {
  CaseFile,
  CaseFileHeader,
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
  TaskDef,
  GateRef,
  GateState,
} from "./schema.js";
export {
  FileNotFound,
  CorruptCaseFile,
  ImmutabilityViolation,
  WriteFailure,
} from "./errors.js";
