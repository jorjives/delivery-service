import type { Assertion, GateReport } from "./schema.js";
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
