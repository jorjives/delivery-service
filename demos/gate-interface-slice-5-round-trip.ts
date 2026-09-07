/**
 * UAT demo for Slice 5: A Gated Surface's Baseline and History Survive on Disk
 *
 * Takes one sample surface from "no baseline" through a gated attempt to a
 * recorded verdict, then reads the case file back off disk and compares.
 *
 * Usage: npx tsx demos/gate-interface-slice-5-round-trip.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { recordBaseline, runCheck } from "../src/run-gate.js";
import { ImmutabilityViolation } from "../src/errors.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate is a plain shell command reading the sample project's TAP output,
// so "the worker changed the world" is just a rewritten file.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

const surfaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-slice-5-case-"));
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "gate-slice-5-tree-"));

function tap(contents: string): void {
  fs.writeFileSync(path.join(worktree, "report.tap"), contents);
}

async function main(): Promise<void> {
  await create(
    surfaceDir,
    { surfaceId: "surface-demo", taskDef: { intent: "add a feature" }, gateRef },
    budgets,
  );

  console.log("=== 1. Record the baseline ===");
  tap("1..2\nok 1 - alpha\nok 2 - beta\n");
  const baseline = await recordBaseline(surfaceDir, worktree);
  console.log(`Baseline stored: status ${baseline.status}, ${baseline.assertions.length} assertions`);
  for (const a of baseline.assertions) console.log(`  [${a.outcome}] ${a.id}`);

  console.log("\n=== 2. A second baseline for the same surface ===");
  try {
    await recordBaseline(surfaceDir, worktree);
    console.log("Second baseline: NO_ERROR_THROWN (unexpected)");
  } catch (err) {
    if (!(err instanceof ImmutabilityViolation)) throw err;
    console.log(`Second baseline: rejected — ${err.name}: ${err.message}`);
  }

  console.log("\n=== 3. Simulate an attempt that breaks a test, then check ===");
  tap("1..2\nok 1 - alpha\nnot ok 2 - beta\n");
  const failed = await runCheck(surfaceDir, worktree, 1);
  console.log(`Check verdict: pass=${failed.delta.pass}, class=${failed.delta.class}`);
  for (const f of failed.delta.newFailures) {
    console.log(`  New failure: ${f.id} (${f.baselineOutcome} -> ${f.checkOutcome}) — ${f.detail}`);
  }

  console.log("\n=== 4. A second attempt where the gate itself cannot run ===");
  fs.rmSync(path.join(worktree, "report.tap"));
  const errored = await runCheck(surfaceDir, worktree, 2);
  console.log(`Gate report status: ${errored.report.status}`);
  console.log(`Check verdict: pass=${errored.delta.pass}, class=${errored.delta.class}`);

  console.log("\n=== 5. Re-read the case file from disk ===");
  const reread = await load(surfaceDir);
  console.log(
    `Baseline re-read unchanged: ${JSON.stringify(reread.header.baseline) === JSON.stringify(baseline)}`,
  );
  for (const entry of reread.history) {
    if (entry.t !== "gate") continue;
    console.log(
      `  History: attempt ${entry.attempt} — status ${entry.status}, class ${entry.class ?? "none"}, ` +
        `newFailures [${entry.newFailures.map((f) => f.id).join(", ")}]`,
    );
  }

  console.log(
    "\nRound trip complete: baseline stored once, two verdicts appended, all re-read from disk.",
  );
}

await main();
