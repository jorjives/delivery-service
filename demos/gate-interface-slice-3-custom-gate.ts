/**
 * UAT demo for Slice 3: Custom Gate
 *
 * Writes small custom gate modules to a temp directory, then loads and runs
 * them: a working gate (default export and named export), a module path that
 * does not resolve, a module missing the `check` method, and a gate that
 * throws.
 *
 * Usage: npx tsx demos/gate-interface-slice-3-custom-gate.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCustomGate, loadCustomGate } from "../src/custom-gate.js";
import type { GateContext } from "../src/command-gate.js";
import type { GateReport } from "../src/schema.js";

function ctx(dir: string): GateContext {
  return {
    worktreePath: dir,
    taskDef: {},
    gateRef: { type: "custom", modulePath: "./gate.mjs" },
  };
}

function printReport(label: string, report: GateReport): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${report.status}`);
  if (report.detail) console.log(`Detail: ${report.detail}`);
  for (const a of report.assertions) {
    console.log(`  [${a.outcome}] ${a.id} — ${a.detail}`);
  }
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "custom-gate-demo-"));

  // --- A working custom gate: counts the .txt files in the worktree ---
  const workingPath = path.join(tmp, "file-count-gate.mjs");
  fs.writeFileSync(workingPath, [
    'import * as fs from "node:fs";',
    "",
    "function report(ctx) {",
    "  const files = fs.readdirSync(ctx.worktreePath).filter((f) => f.endsWith('.txt'));",
    "  return {",
    '    status: "PASS",',
    "    assertions: files.map((f) => ({",
    "      id: `file:${f}`,",
    '      outcome: "PASS",',
    '      detail: "present in the worktree",',
    "    })),",
    "  };",
    "}",
    "",
    "export default { baseline: async (ctx) => report(ctx), check: async (ctx) => report(ctx) };",
    "export const strictGate = {",
    "  baseline: async () => ({ status: 'PASS', assertions: [{ id: 'strict:licence', outcome: 'PASS', detail: 'named export was selected' }] }),",
    "  check: async () => ({ status: 'PASS', assertions: [{ id: 'strict:licence', outcome: 'PASS', detail: 'named export was selected' }] }),",
    "};",
  ].join("\n"));

  // A worktree for the gate to inspect
  const worktree = path.join(tmp, "worktree");
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, "alpha.txt"), "alpha");
  fs.writeFileSync(path.join(worktree, "beta.txt"), "beta");

  const workingGate = await loadCustomGate(workingPath);
  printReport("Working custom gate — baseline", await workingGate.baseline(ctx(worktree)));
  printReport("Working custom gate — check", await workingGate.check(ctx(worktree)));

  // --- A named export other than the default ---
  const namedGate = await loadCustomGate(workingPath, "strictGate");
  printReport("Named export 'strictGate' — baseline", await namedGate.baseline(ctx(worktree)));

  // --- A module path that does not resolve ---
  const missingPath = path.join(tmp, "not-a-real-gate.mjs");
  printReport(
    "Broken — module path does not resolve",
    await createCustomGate(missingPath).baseline(ctx(worktree)),
  );

  // --- A module whose export is missing `check`, rejected at load time ---
  const incompletePath = path.join(tmp, "incomplete-gate.mjs");
  fs.writeFileSync(
    incompletePath,
    "export default { baseline: async () => ({ status: 'PASS', assertions: [] }) };\n",
  );
  try {
    await loadCustomGate(incompletePath);
    console.log("\n=== Broken — export missing 'check' ===");
    console.log("UNEXPECTED: the invalid gate loaded without error");
  } catch (err) {
    console.log("\n=== Broken — export missing 'check' ===");
    console.log(`Rejected at load time: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- A gate that throws ---
  const throwingPath = path.join(tmp, "throwing-gate.mjs");
  fs.writeFileSync(throwingPath, [
    "export default {",
    "  baseline: async () => { throw new Error('the custom gate exploded'); },",
    "  check: async () => ({ status: 'PASS', assertions: [] }),",
    "};",
  ].join("\n"));
  const throwingGate = await loadCustomGate(throwingPath);
  printReport("Throwing gate — baseline", await throwingGate.baseline(ctx(worktree)));

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("\n--- Demo complete ---");
}

main().catch((err) => { console.error(err); process.exit(1); });
