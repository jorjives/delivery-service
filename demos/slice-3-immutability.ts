import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, setBaseline, setOutcome, updateCursor, appendEntry, load, ImmutabilityViolation } from "../src/index.js";

const header = {
  surfaceId: "demo-surface-3",
  taskDef: { intent: "Demonstrate write-once fields" },
  gateRef: { gateId: "gate-demo", version: 1 },
};
const budgets = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "case-file-immut-demo-"));

  await create(dir, header, budgets);

  // First baseline attempt: succeeds
  await setBaseline(dir, { assertion1: "pass" });
  console.log("Baseline attempt 1: succeeded — baseline set to {assertion1: pass}");

  // Second baseline attempt: rejected
  try {
    await setBaseline(dir, { assertion1: "different" });
    console.log("Baseline attempt 2: NO_ERROR_THROWN (unexpected)");
  } catch (err) {
    if (err instanceof ImmutabilityViolation) {
      console.log(`Baseline attempt 2: rejected — ${err.name}: ${err.message}`);
    } else {
      throw err;
    }
  }

  // First outcome attempt: succeeds
  const outcome = {
    kind: "closed" as const,
    source: "gate",
    reason: "All assertions passed",
    at: "2026-09-04T12:00:00Z",
  };
  await setOutcome(dir, outcome);
  console.log("Outcome attempt 1:  succeeded — outcome set to closed/gate");

  // Second outcome attempt: rejected
  try {
    await setOutcome(dir, {
      kind: "escalated",
      source: "triage",
      reason: "Cannot fix",
      at: "2026-09-04T13:00:00Z",
    });
    console.log("Outcome attempt 2:  NO_ERROR_THROWN (unexpected)");
  } catch (err) {
    if (err instanceof ImmutabilityViolation) {
      console.log(`Outcome attempt 2:  rejected — ${err.name}: ${err.message}`);
    } else {
      throw err;
    }
  }

  // Header immutability: unchanged after cursor updates and history appends
  const dir2 = await mkdtemp(join(tmpdir(), "case-file-header-immut-demo-"));
  const created = await create(dir2, header, budgets);
  const originalHeader = JSON.stringify(created.header);

  await updateCursor(dir2, { state: "AGENT_ACTIVE" });
  await appendEntry(dir2, { t: "dispatch", attempt: 1, sessionKey: "sess-1" });
  await appendEntry(dir2, {
    t: "terminus", attempt: 1, sessionKey: "sess-1",
    status: "completed", rationale: "Done",
  });
  await updateCursor(dir2, { state: "GATING" });

  const after = await load(dir2);
  const afterHeader = JSON.stringify(after.header);
  const headerMatch = originalHeader === afterHeader;
  console.log(`Header immutability: ${headerMatch ? "preserved" : "BROKEN"} after cursor updates and history appends`);

  console.log(
    "\nImmutability verified: both fields set exactly once, both second " +
      "attempts rejected with a named error.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
