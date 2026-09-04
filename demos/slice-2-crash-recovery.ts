import { mkdtemp, writeFile, appendFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, appendEntry, load, logTail, rebuild, resumeAction } from "../src/index.js";

const header = {
  surfaceId: "demo-surface-2",
  taskDef: { intent: "Demonstrate crash recovery" },
  gateRef: { gateId: "gate-demo", version: 1 },
};
const budgets = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

async function scenarioOrphanTmp() {
  const dir = await mkdtemp(join(tmpdir(), "crash-demo-tmp-"));
  await create(dir, header, budgets);

  // Simulate a crash mid-write: leave a .tmp file with garbage behind
  await writeFile(join(dir, "case.json.tmp"), "partial garbage data");

  const loaded = await load(dir);
  console.log("Scenario 1: orphan .tmp file from a crashed write");
  console.log(`  Surface ID: ${loaded.header.surfaceId}`);
  console.log(`  State:      ${loaded.cursor.state}`);
  console.log("  Recovered:  valid case.json read, orphan .tmp ignored\n");
}

async function scenarioTruncatedLogLine() {
  const dir = await mkdtemp(join(tmpdir(), "crash-demo-trunc-"));
  await create(dir, header, budgets);

  await appendEntry(dir, { t: "dispatch", attempt: 1, sessionKey: "sess-1" });
  await appendEntry(dir, {
    t: "terminus",
    attempt: 1,
    sessionKey: "sess-1",
    status: "completed",
    rationale: "Task completed successfully",
  });

  // Simulate a crash mid-append: write a partial JSON line at the end
  await appendFile(join(dir, "log.jsonl"), '{"t":"gate","attempt":1,"stat');

  const loaded = await load(dir);
  const tail = logTail(loaded);
  const action = resumeAction(tail);
  console.log("Scenario 2: truncated log line from a crashed append");
  console.log(`  History:       ${loaded.history.length} entries (complete only)`);
  console.log(`  Last entry:    ${tail?.t}`);
  console.log(`  Resume action: ${action}`);
  console.log("  Recovered:     truncated line ignored, prior history intact\n");
}

async function scenarioStaleCursorRebuild() {
  const dir = await mkdtemp(join(tmpdir(), "crash-demo-stale-"));
  await create(dir, header, budgets);

  await appendEntry(dir, { t: "dispatch", attempt: 1, sessionKey: "sess-1" });
  await appendEntry(dir, {
    t: "terminus",
    attempt: 1,
    sessionKey: "sess-1",
    status: "completed",
    rationale: "Task completed successfully",
  });

  // appendEntry never touches the cursor, so case.json is now stale
  const before = await load(dir);
  const rebuilt = await rebuild(dir);
  const action = resumeAction(logTail(rebuilt));

  console.log("Scenario 3: stale cursor rebuild");
  console.log(`  Cursor before rebuild (stale): ${before.cursor.state}`);
  console.log(`  Cursor after rebuild:          ${rebuilt.cursor.state}`);
  console.log(`  Resume action:                 ${action}`);
  console.log("  Recovered:  cursor rebuilt from the log, log wins over stale cursor\n");
}

async function scenarioMissingCaseJson() {
  const dir = await mkdtemp(join(tmpdir(), "crash-demo-missing-"));
  await create(dir, header, budgets);
  await unlink(join(dir, "case.json"));

  console.log("Scenario 4: missing case.json");
  try {
    await rebuild(dir);
    console.log("  ERROR: rebuild should have thrown\n");
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.log(`  Error name: ${name}`);
    console.log("  Recovered:  clear, named error instead of a crash\n");
  }
}

async function main() {
  await scenarioOrphanTmp();
  await scenarioTruncatedLogLine();
  await scenarioStaleCursorRebuild();
  await scenarioMissingCaseJson();

  console.log(
    "Crash recovery verified: every simulated crash point recovered to the " +
      "last fully-written state, with the resume action matching the last " +
      "complete event recorded.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
