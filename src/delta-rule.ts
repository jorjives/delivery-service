import { isGuard } from "./guards.js";
import { isItemAssertion } from "./item-check.js";
import type { GateReport, DeltaResult, DeltaOptions, NewFailure } from "./schema.js";

export function computeDelta(
  baseline: GateReport,
  check: GateReport,
  options?: DeltaOptions,
): DeltaResult {
  const checkById = new Map(check.assertions.map((a) => [a.id, a]));
  const newFailures: NewFailure[] = [];

  for (const baseAssertion of baseline.assertions) {
    if (baseAssertion.outcome !== "PASS") continue;

    const checkAssertion = checkById.get(baseAssertion.id);

    if (!checkAssertion) {
      newFailures.push({
        id: baseAssertion.id,
        baselineOutcome: "PASS",
        checkOutcome: "ABSENT",
        detail: `Assertion "${baseAssertion.id}" was present at baseline but missing from check`,
      });
    } else if (checkAssertion.outcome === "FAIL" || checkAssertion.outcome === "ERROR") {
      newFailures.push({
        id: baseAssertion.id,
        baselineOutcome: "PASS",
        checkOutcome: checkAssertion.outcome,
        detail: checkAssertion.detail,
      });
    }
  }

  // A guard's or an item's result is never at baseline, so it only ever arrives new: it counts whatever the gate's own option says.
  const baselineIds = new Set(baseline.assertions.map((a) => a.id));
  for (const checkAssertion of check.assertions) {
    const counted = options?.failOnNewAssertions === true || isGuard(checkAssertion.id) || isItemAssertion(checkAssertion.id);
    if (counted && !baselineIds.has(checkAssertion.id) && checkAssertion.outcome !== "PASS") {
      newFailures.push({
        id: checkAssertion.id,
        baselineOutcome: "ABSENT",
        checkOutcome: checkAssertion.outcome,
        detail: checkAssertion.detail,
      });
    }
  }

  const isGateError = check.status === "ERROR";
  const hasNewFailures = newFailures.length > 0;
  const pass = !hasNewFailures && !isGateError;

  let deltaClass: "fail" | "error" | null = null;
  if (isGateError) {
    deltaClass = "error";
  } else if (hasNewFailures) {
    deltaClass = "fail";
  }

  return { pass, newFailures, class: deltaClass };
}
