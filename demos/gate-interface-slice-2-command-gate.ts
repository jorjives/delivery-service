/**
 * UAT demo for Slice 2: Command Gate
 *
 * Runs the command gate in TAP, JUnit, and exit-code modes against
 * small inline scripts, then repeats with one test deliberately broken.
 *
 * Usage: npx tsx demos/gate-interface-slice-2-command-gate.ts
 */
import { createCommandGate } from "../src/command-gate.js";
import type { GateContext } from "../src/command-gate.js";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

function ctx(dir: string): GateContext {
  return { worktreePath: dir, taskDef: {}, gateRef: {} };
}

function printReport(label: string, report: { status: string; assertions: { id: string; outcome: string; detail: string }[]; detail?: string }): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${report.status}`);
  if (report.detail) console.log(`Detail: ${report.detail}`);
  for (const a of report.assertions) {
    console.log(`  [${a.outcome}] ${a.id}`);
  }
}

async function main(): Promise<void> {
  // Create a temp dir with small test scripts
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-demo-"));

  // --- TAP mode ---
  // Write a script that emits TAP output
  const tapScript = path.join(tmp, "tap-test.sh");
  fs.writeFileSync(tapScript, [
    "#!/bin/sh",
    'echo "TAP version 13"',
    'echo "1..3"',
    'echo "ok 1 - addition works"',
    'echo "ok 2 - subtraction works"',
    'echo "ok 3 - multiplication works"',
  ].join("\n"), { mode: 0o755 });

  const tapGate = createCommandGate(`sh ${tapScript}`, "tap");
  printReport("TAP — all passing", await tapGate.baseline(ctx(tmp)));

  // Break one test
  fs.writeFileSync(tapScript, [
    "#!/bin/sh",
    'echo "TAP version 13"',
    'echo "1..3"',
    'echo "ok 1 - addition works"',
    'echo "not ok 2 - subtraction works"',
    'echo "ok 3 - multiplication works"',
  ].join("\n"), { mode: 0o755 });

  printReport("TAP — one broken", await tapGate.check(ctx(tmp)));

  // --- JUnit mode ---
  const junitFile = path.join(tmp, "results.xml");
  fs.writeFileSync(junitFile, `<?xml version="1.0"?>
<testsuite tests="3">
  <testcase classname="MathTest" name="addition"/>
  <testcase classname="MathTest" name="subtraction"/>
  <testcase classname="MathTest" name="multiplication"/>
</testsuite>`);

  const junitGate = createCommandGate(`cat ${junitFile}`, "junit");
  printReport("JUnit — all passing", await junitGate.baseline(ctx(tmp)));

  // Break one test
  fs.writeFileSync(junitFile, `<?xml version="1.0"?>
<testsuite tests="3">
  <testcase classname="MathTest" name="addition"/>
  <testcase classname="MathTest" name="subtraction">
    <failure message="expected 5 got 3"/>
  </testcase>
  <testcase classname="MathTest" name="multiplication"/>
</testsuite>`);

  printReport("JUnit — one broken", await junitGate.check(ctx(tmp)));

  // --- Exit-code mode ---
  const exitScript = path.join(tmp, "exit-test.sh");
  fs.writeFileSync(exitScript, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const exitGate = createCommandGate(`sh ${exitScript}`, "exitcode");
  printReport("Exit-code — passing (exit 0)", await exitGate.baseline(ctx(tmp)));

  fs.writeFileSync(exitScript, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  printReport("Exit-code — failing (exit 1)", await exitGate.check(ctx(tmp)));

  // --- Determinism: same command, unchanged code, run twice ---
  const stableScript = path.join(tmp, "stable-tap.sh");
  fs.writeFileSync(stableScript, [
    "#!/bin/sh",
    'echo "1..2"',
    'echo "ok 1 - alpha"',
    'echo "ok 2 - beta"',
  ].join("\n"), { mode: 0o755 });
  const stableGate = createCommandGate(`sh ${stableScript}`, "tap");
  const run1 = await stableGate.baseline(ctx(tmp));
  const run2 = await stableGate.check(ctx(tmp));
  console.log("\n=== Determinism — same command run twice ===");
  console.log(`Run 1 IDs: ${run1.assertions.map((a) => a.id).join(", ")}`);
  console.log(`Run 2 IDs: ${run2.assertions.map((a) => a.id).join(", ")}`);

  // --- Error handling ---
  const notFoundGate = createCommandGate("totally-nonexistent-cmd-xyz", "tap");
  printReport("Error — command not found", await notFoundGate.baseline(ctx(tmp)));

  const unparseableGate = createCommandGate(`echo "not tap output"`, "tap");
  printReport("Error — unparseable output", await unparseableGate.baseline(ctx(tmp)));

  const dupScript = path.join(tmp, "dup-tap.sh");
  fs.writeFileSync(dupScript, [
    "#!/bin/sh",
    'echo "1..2"',
    'echo "ok 1 - same"',
    'echo "ok 1 - same"',
  ].join("\n"), { mode: 0o755 });
  const dupGate = createCommandGate(`sh ${dupScript}`, "tap");
  printReport("Error — duplicate assertion ID", await dupGate.baseline(ctx(tmp)));

  // A 50ms timeout against a command that sleeps for 5s — real timeout
  // behaviour, without a UAT demo actually waiting on the default 5-minute one.
  const timeoutGate = createCommandGate("sleep 5", "tap", 50);
  printReport("Error — command timed out", await timeoutGate.baseline(ctx(tmp)));

  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("\n--- Demo complete ---");
}

main().catch((err) => { console.error(err); process.exit(1); });
