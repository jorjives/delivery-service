import type { AgentOptions, CaseFile, CaseFileHeader, WorkflowStep } from "./schema.js";

/**
 * A workflow runs as segments of one task's log: each step after the first opens with a `step` entry. Everything
 * that judges or dispatches reads the current step through `stepView`, so a run with no workflow, and step 1, see
 * the record exactly as it is.
 */

/** Which step the record is on, from 1. The same on the whole record and on a view of it. */
export function stepIndexOf(caseFile: CaseFile): number {
  return caseFile.history.findLast((entry) => entry.t === "step")?.step ?? 1;
}

/** The pinned step the record is on; undefined for a run with no workflow. */
export function currentStep(caseFile: CaseFile): WorkflowStep | undefined {
  return caseFile.header.workflow?.steps[stepIndexOf(caseFile) - 1];
}

/** The step after this one; undefined on the last step and for a run with no workflow. */
export function nextStepOf(caseFile: CaseFile): WorkflowStep | undefined {
  return caseFile.header.workflow?.steps[stepIndexOf(caseFile)];
}

/**
 * The project's agent options with a step's laid over them: the step wins, their `env` is merged, and the project's
 * `append` is kept with the step's after it (the project's is added to every step's context, spec §5.9).
 */
export function mergeAgent(base: AgentOptions | undefined, step: AgentOptions): AgentOptions {
  const env = base?.env === undefined && step.env === undefined ? {} : { env: { ...base?.env, ...step.env } };
  const appended = [base?.append, step.append].filter((text) => text !== undefined);
  const append = appended.length === 0 ? {} : { append: appended.join("\n\n") };
  return { ...base, ...step, ...env, ...append };
}

/**
 * A ref or session key minted for the current step. Unchanged on step 1, so a run with no workflow keeps every
 * key it always had; prefixed after, because a later step's counters start again from its own log.
 */
export function stepKey(caseFile: CaseFile, key: string): string {
  const step = stepIndexOf(caseFile);
  return step === 1 ? key : `step${step}-${key}`;
}

/**
 * The record as the current step sees it: its own gate (or the project's), its own agent options laid over the
 * project's, and from the second step on only its own log, its own baseline and the commit it started from.
 */
export function stepView(caseFile: CaseFile): CaseFile {
  const step = currentStep(caseFile);
  if (step === undefined) return caseFile;
  const own: Partial<CaseFileHeader> = {
    ...(step.gateRef === undefined ? {} : { gateRef: step.gateRef, gateDigest: step.gateDigest }),
    ...(step.agent === undefined ? {} : { agent: mergeAgent(caseFile.header.agent, step.agent) }),
  };
  const opened = caseFile.history.findLastIndex((entry) => entry.t === "step");
  const opening = caseFile.history[opened];
  if (opening?.t !== "step") return { ...caseFile, header: { ...caseFile.header, ...own } };
  const history = caseFile.history.slice(opened);
  const baseline = history.find((entry) => entry.t === "baseline")?.report ?? null;
  return { ...caseFile, header: { ...caseFile.header, ...own, baseline, startCommit: opening.startCommit }, history };
}
