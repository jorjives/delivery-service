import type { Assertion, GateReport } from "./schema.js";
import type { Gate } from "./command-gate.js";
import { validateUniqueIds } from "./parsers.js";
import { DuplicateIdError } from "./errors.js";

export function errorReport(detail: string): GateReport {
  return { status: "ERROR", assertions: [], detail };
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Checks assertion IDs are unique, returning an ERROR report for the caller
 * to short-circuit on if not, or `null` if they're fine.
 */
export function duplicateIdReport(assertions: Assertion[]): GateReport | null {
  try {
    validateUniqueIds(assertions);
    return null;
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      return errorReport(`Duplicate assertion ID: ${err.duplicateId}`);
    }
    throw err;
  }
}

/**
 * A gate that reports the same failure however it is called. Resolution
 * failures use this so a caller never has to distinguish "failed to resolve"
 * from "failed to run" — both are just an ERROR report.
 */
export function failedGate(detail: string): Gate {
  const fail = async (): Promise<GateReport> => errorReport(detail);
  return { baseline: fail, check: fail };
}
