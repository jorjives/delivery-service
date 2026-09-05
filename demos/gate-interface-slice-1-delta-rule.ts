import { computeDelta } from "../src/delta-rule.js";
import type { GateReport } from "../src/schema.js";

function report(status: GateReport["status"], assertions: GateReport["assertions"]): GateReport {
  return { status, assertions };
}

function run(label: string, baseline: GateReport, check: GateReport, options?: { failOnNewAssertions?: boolean }) {
  const result = computeDelta(baseline, check, options);
  console.log(`\n${label}`);
  console.log(`  verdict: ${result.pass ? "PASS" : "FAIL"}${result.class ? ` (${result.class})` : ""}`);
  if (result.newFailures.length > 0) {
    for (const f of result.newFailures) {
      console.log(`  new failure: ${f.id} (${f.baselineOutcome} -> ${f.checkOutcome})`);
    }
  }
}

// 1. No regressions
run(
  "1. No regressions (identical passing assertions) — expect PASS",
  report("PASS", [{ id: "a", outcome: "PASS", detail: "" }]),
  report("PASS", [{ id: "a", outcome: "PASS", detail: "" }]),
);

// 2. A genuine regression
run(
  "2. Genuine regression (PASS -> FAIL) — expect FAIL naming the assertion",
  report("PASS", [{ id: "a", outcome: "PASS", detail: "" }]),
  report("FAIL", [{ id: "a", outcome: "FAIL", detail: "assertion a broke" }]),
);

// 3. A vanished assertion
run(
  "3. Vanished assertion (PASS -> ABSENT) — expect FAIL naming the assertion",
  report("PASS", [{ id: "a", outcome: "PASS", detail: "" }]),
  report("PASS", []),
);

// 4. Pre-existing red noise
run(
  "4. Pre-existing red noise (baseline FAIL stays FAIL) — expect PASS",
  report("FAIL", [{ id: "a", outcome: "FAIL", detail: "always broken" }]),
  report("FAIL", [{ id: "a", outcome: "FAIL", detail: "always broken" }]),
);

// 5. A brand-new failing assertion (no baseline counterpart), default options
run(
  "5. Brand-new failing assertion, default options — expect PASS",
  report("PASS", []),
  report("FAIL", [{ id: "b", outcome: "FAIL", detail: "new assertion" }]),
);

// 5b. Same scenario with failOnNewAssertions set
run(
  "5b. Brand-new failing assertion, failOnNewAssertions: true — expect FAIL",
  report("PASS", []),
  report("FAIL", [{ id: "b", outcome: "FAIL", detail: "new assertion" }]),
  { failOnNewAssertions: true },
);

// 6. A gate-level ERROR
run(
  "6. Gate-level ERROR — expect FAIL classed as error",
  report("PASS", [{ id: "a", outcome: "PASS", detail: "" }]),
  report("ERROR", [{ id: "a", outcome: "PASS", detail: "" }]),
);
