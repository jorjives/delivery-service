import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, appendEntry, load, writeRef, readRef } from "../src/index.js";
import type { HistoryEntry } from "../src/index.js";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "case-file-demo-ref-storage-"));
  console.log(`Case directory: ${dir}\n`);

  const header = {
    surfaceId: "demo-surface-ref-storage",
    taskDef: { intent: "Demonstrate reference storage" },
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
  };
  const budgetDefaults = {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  };

  await create(dir, header, budgetDefaults);
  console.log("Created case file.\n");

  // Write a sample gate-failure detail as a reference
  const failureDetail = {
    assertion: "homepage-loads",
    expected: 200,
    actual: 500,
    screenshot: "base64-data-would-go-here",
    logs: ["GET / -> 500", "Internal Server Error"],
  };
  const refId = "gate-detail-1";
  await writeRef(dir, refId, failureDetail);
  console.log(`Wrote reference "${refId}":`);
  console.log(JSON.stringify(failureDetail, null, 2));

  // Record a history entry pointing at the reference
  const gateEntry: HistoryEntry = {
    t: "gate",
    attempt: 1,
    status: "FAIL",
    newFailures: [{ id: "homepage-loads", detailRef: refId }],
    class: "fail",
  };
  await appendEntry(dir, gateEntry);
  console.log("\nAppended gate-failure history entry pointing at the reference.\n");

  // Load the case file and follow the pointer back
  const loaded = await load(dir);
  const tail = loaded.history.at(-1);
  if (!tail || tail.t !== "gate") {
    throw new Error("expected the last history entry to be a gate entry");
  }
  const firstFailure = tail.newFailures[0];
  if (!firstFailure) {
    throw new Error("expected the gate entry to have a failure");
  }

  const retrieved = await readRef(dir, firstFailure.detailRef);
  console.log(`Followed detailRef "${firstFailure.detailRef}" from history back to the reference:`);
  console.log(JSON.stringify(retrieved, null, 2));

  const matches = JSON.stringify(retrieved) === JSON.stringify(failureDetail);
  console.log(`\nRetrieved content matches what was written: ${matches}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
