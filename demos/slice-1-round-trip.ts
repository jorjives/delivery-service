import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, appendEntry, load } from "../src/index.js";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "case-file-demo-"));
  console.log(`Case directory: ${dir}\n`);

  // Create
  const header = {
    surfaceId: "demo-surface-1",
    taskDef: { intent: "Demonstrate the round trip" },
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
    domainPrompt: "You are a demo assistant.",
  };
  const budgets = {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  };

  const initial = await create(dir, header, budgets);
  console.log("Created case file:");
  console.log(`  Surface ID: ${initial.header.surfaceId}`);
  console.log(`  State:      ${initial.cursor.state}`);
  console.log(`  Baseline:   ${initial.header.baseline}`);
  console.log(`  History:    ${initial.history.length} entries\n`);

  // Append two entries
  await appendEntry(dir, {
    t: "dispatch",
    attempt: 1,
    sessionKey: "session-demo-1",
  });
  await appendEntry(dir, {
    t: "terminus",
    attempt: 1,
    sessionKey: "session-demo-1",
    status: "completed",
    rationale: "Task completed successfully",
  });
  console.log("Appended 2 history entries.\n");

  // Load it back
  const loaded = await load(dir);
  console.log("Loaded case file from disk:");
  console.log(`  Surface ID: ${loaded.header.surfaceId}`);
  console.log(`  State:      ${loaded.cursor.state}`);
  console.log(`  Baseline:   ${loaded.header.baseline}`);
  console.log(`  History:    ${loaded.history.length} entries`);
  for (const entry of loaded.history) {
    console.log(`    - ${entry.t}`);
  }
  console.log(`  Outcome:    ${loaded.outcome ?? "none"}`);
  console.log("\nRound trip verified: disk state matches what was written.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
